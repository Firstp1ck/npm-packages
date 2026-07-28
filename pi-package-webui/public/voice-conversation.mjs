// Browser voice loop for Natural Conversation Mode (Phase 3).
// The controller is dependency-injected: speech recognition, speech synthesis,
// timers, and delivery callbacks all arrive through options so Node tests can
// drive the full listen -> prompt -> speak -> listen loop without a browser.
//
// Turn-taking contract (see docs/planned/webui/natural-conversation/NATURAL_CONVERSATION_MODE_PLAN.md):
// - Final transcripts while Pi is idle are sent as normal prompts.
// - Transcripts while the assistant streams final text are interruptions.
// - Transcripts during a tool call/execution are queued until the tool phase
//   ends; they are never injected into an active tool phase.
// - While TTS is speaking, the microphone is paused unless barge-in is enabled.
// - After the assistant asks a question, silence past the timeout emits a
//   single structured silence event instead of guessing user intent.
// - The browser voice loop can be manually paused/resumed without disabling the
//   package-owned conversation-mode safety constraints.

export const VOICE_UI_STATES = [
  "off",
  "listening",
  "transcribing",
  "answering",
  "speaking",
  "interrupting",
  "silence",
  "paused",
  "error",
];

export const DEFAULT_SILENCE_TIMEOUT_MS = 8000;

export function voiceSilenceEventMessage(silentSeconds = Math.round(DEFAULT_SILENCE_TIMEOUT_MS / 1000)) {
  const seconds = Number.isFinite(silentSeconds) && silentSeconds > 0 ? Math.round(silentSeconds) : 8;
  return `[Conversation mode: the user stayed silent for ${seconds}s after your question. Treat the silence as possible confusion, discomfort, missing context, or an unneeded question; reframe, explain why you asked, or continue without pressuring the user. Do not invent intent from the silence.]`;
}

export function createVoiceConversationController(options = {}) {
  const {
    recognitionFactory = null,
    synthesis = null,
    utteranceFactory = null,
    sendTranscript = async () => {},
    sendSilenceEvent = async () => {},
    onPartialTranscript = () => {},
    onStateChange = () => {},
    onEvent = () => {},
    bargeInEnabled = false,
    silenceTimeoutMs = DEFAULT_SILENCE_TIMEOUT_MS,
    setTimeoutFn = (handler, delayMs) => setTimeout(handler, delayMs),
    clearTimeoutFn = (id) => clearTimeout(id),
  } = options;

  const state = {
    active: false,
    uiState: "off",
    sttAvailable: null,
    ttsAvailable: !!(synthesis && typeof utteranceFactory === "function"),
    assistantStreaming: false,
    toolRunning: false,
    speaking: false,
    userPaused: false,
    partialTranscript: "",
    queuedInterrupt: "",
    lastError: "",
  };

  let recognition = null;
  let recognitionRunning = false;
  let recognitionPausedForSpeech = false;
  let silenceTimer = null;
  let currentUtterance = null;

  function snapshot() {
    return { ...state };
  }

  function setUiState(uiState, detail = {}) {
    state.uiState = uiState;
    try {
      onStateChange(uiState, { ...snapshot(), ...detail });
    } catch {
      // State listeners must never break the voice loop.
    }
  }

  function emitEvent(message, level = "info") {
    try {
      onEvent(message, level);
    } catch {
      // Log listeners must never break the voice loop.
    }
  }

  function setPartialTranscript(text = "") {
    const partialTranscript = String(text || "").trim();
    if (state.partialTranscript === partialTranscript) return;
    state.partialTranscript = partialTranscript;
    try {
      onPartialTranscript(partialTranscript, snapshot());
    } catch {
      // Partial transcript listeners must never break the voice loop.
    }
  }

  function clearPartialTranscript() {
    setPartialTranscript("");
  }

  function clearSilenceTimer() {
    if (silenceTimer === null) return;
    clearTimeoutFn(silenceTimer);
    silenceTimer = null;
  }

  function startSilenceTimer() {
    clearSilenceTimer();
    if (!state.active || !silenceTimeoutMs || silenceTimeoutMs <= 0) return;
    silenceTimer = setTimeoutFn(() => {
      silenceTimer = null;
      if (!state.active || state.speaking || state.assistantStreaming) return;
      if (state.uiState !== "listening" && state.uiState !== "transcribing") return;
      setUiState("silence");
      const silentSeconds = Math.round(silenceTimeoutMs / 1000);
      Promise.resolve(sendSilenceEvent({ silentSeconds }))
        .then(() => {
          if (state.active && state.uiState === "silence") setUiState("answering", { reason: "silence" });
        })
        .catch((error) => {
          emitEvent(`Failed to send voice silence event: ${error?.message || error}`, "warn");
          if (state.active && state.uiState === "silence") setUiState("listening");
        });
    }, silenceTimeoutMs);
  }

  function ensureRecognition() {
    if (recognition) return recognition;
    if (typeof recognitionFactory !== "function") {
      state.sttAvailable = false;
      return null;
    }
    let created = null;
    try {
      created = recognitionFactory();
    } catch {
      created = null;
    }
    if (!created) {
      state.sttAvailable = false;
      return null;
    }
    recognition = created;
    try {
      recognition.continuous = true;
      recognition.interimResults = true;
    } catch {
      // Some engines expose read-only configuration; keep their defaults.
    }
    recognition.onresult = handleRecognitionResult;
    recognition.onerror = handleRecognitionError;
    recognition.onend = handleRecognitionEnd;
    return recognition;
  }

  function startRecognition() {
    const instance = ensureRecognition();
    if (!instance) return false;
    recognitionPausedForSpeech = false;
    if (recognitionRunning) return true;
    try {
      instance.start();
      recognitionRunning = true;
    } catch {
      // start() throws InvalidStateError when already started; treat as running.
      recognitionRunning = true;
    }
    state.sttAvailable = true;
    return true;
  }

  function stopRecognition({ forSpeech = false } = {}) {
    recognitionPausedForSpeech = forSpeech;
    if (!recognition || !recognitionRunning) return;
    recognitionRunning = false;
    try {
      if (typeof recognition.abort === "function") recognition.abort();
      else recognition.stop();
    } catch {
      // Recognition may already be stopped by the engine.
    }
  }

  function handleRecognitionEnd() {
    recognitionRunning = false;
    if (!state.active || state.userPaused || recognitionPausedForSpeech || state.uiState === "error") return;
    // Browsers stop recognition spontaneously after silence; keep listening.
    try {
      recognition.start();
      recognitionRunning = true;
    } catch {
      // Engine refused an immediate restart; the next turn end restarts it.
    }
  }

  function handleRecognitionError(event) {
    const code = String(event?.error || "");
    if (code === "not-allowed" || code === "service-not-allowed") {
      state.lastError = code;
      // Enter the error state before stopping so onend does not auto-restart.
      setUiState("error", { reason: code });
      stopRecognition();
      emitEvent("Microphone access was denied, so Natural Conversation Mode cannot listen. Allow microphone access for this site, then end and restart the conversation.", "error");
      return;
    }
    if (code === "no-speech" || code === "aborted") return;
    emitEvent(`Speech recognition error: ${code || "unknown"}`, "warn");
  }

  function handleRecognitionResult(event) {
    if (!state.active) return;
    const results = event?.results || [];
    let finalText = "";
    let interimText = "";
    for (let index = event?.resultIndex || 0; index < results.length; index += 1) {
      const result = results[index];
      if (!result) continue;
      const alternative = result[0];
      const text = alternative && typeof alternative.transcript === "string" ? alternative.transcript : "";
      if (result.isFinal) finalText += text;
      else if (text.trim()) interimText += text;
    }
    if (finalText.trim()) {
      clearPartialTranscript();
      handleFinalTranscript(finalText.trim());
      return;
    }
    if (interimText.trim()) {
      setPartialTranscript(interimText.trim());
      if (state.uiState === "listening") setUiState("transcribing");
    }
  }

  function deliverTranscript(text, reason) {
    Promise.resolve(sendTranscript(text, { reason }))
      .then(() => {
        if (state.active && state.uiState !== "error" && state.uiState !== "off") setUiState("answering", { reason });
      })
      .catch((error) => {
        emitEvent(`Failed to send voice transcript: ${error?.message || error}`, "error");
        if (state.active && state.uiState !== "error") setUiState("listening");
      });
  }

  function handleFinalTranscript(text) {
    const transcript = String(text || "").trim();
    if (!transcript || !state.active || state.userPaused) return;
    clearPartialTranscript();
    clearSilenceTimer();
    if (state.speaking) {
      // Barge-in: only reachable when bargeInEnabled keeps the mic open during TTS.
      stopSpeaking();
      setUiState("interrupting", { transcript });
      deliverTranscript(transcript, "interrupt");
      return;
    }
    if (state.assistantStreaming && state.toolRunning) {
      state.queuedInterrupt = state.queuedInterrupt ? `${state.queuedInterrupt} ${transcript}` : transcript;
      setUiState("interrupting", { queued: true, transcript });
      emitEvent("Voice interruption queued; it will be delivered after the current tool phase ends.", "info");
      return;
    }
    if (state.assistantStreaming) {
      setUiState("interrupting", { transcript });
      deliverTranscript(transcript, "interrupt");
      return;
    }
    setUiState("answering", { transcript });
    deliverTranscript(transcript, "prompt");
  }

  function flushQueuedInterrupt() {
    const text = state.queuedInterrupt;
    state.queuedInterrupt = "";
    if (!text || !state.active) return;
    setUiState("interrupting", { queued: true });
    deliverTranscript(text, state.assistantStreaming ? "interrupt" : "prompt");
  }

  function setAssistantActivity(patch = {}) {
    if (!state.active) return snapshot();
    const wasToolRunning = state.toolRunning;
    const wasStreaming = state.assistantStreaming;
    if (typeof patch.streaming === "boolean") state.assistantStreaming = patch.streaming;
    if (typeof patch.toolRunning === "boolean") state.toolRunning = patch.toolRunning;
    if (state.assistantStreaming && !wasStreaming) {
      clearSilenceTimer();
      if (!state.userPaused && !state.speaking && state.uiState !== "interrupting") setUiState("answering");
    }
    if (wasToolRunning && !state.toolRunning && state.queuedInterrupt) flushQueuedInterrupt();
    else if (wasStreaming && !state.assistantStreaming && state.queuedInterrupt) flushQueuedInterrupt();
    return snapshot();
  }

  function stopSpeaking() {
    const utterance = currentUtterance;
    currentUtterance = null;
    state.speaking = false;
    recognitionPausedForSpeech = false;
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    try {
      synthesis?.cancel?.();
    } catch {
      // Synthesis may already be idle.
    }
  }

  function resumeListeningAfterTurn({ askedQuestion = false } = {}) {
    if (!state.active) return;
    if (state.userPaused) {
      setUiState("paused", { reason: "manual" });
      return;
    }
    const listening = startRecognition();
    if (listening) setUiState("listening");
    else if (state.uiState !== "error") setUiState("paused", { reason: "stt-unavailable" });
    if (askedQuestion && listening) startSilenceTimer();
  }

  function speak(text, { askedQuestion = false } = {}) {
    const spoken = String(text || "").trim();
    if (state.userPaused) return;
    if (!spoken || !state.ttsAvailable) {
      resumeListeningAfterTurn({ askedQuestion: askedQuestion && !!spoken });
      return;
    }
    stopSpeaking();
    if (!bargeInEnabled) stopRecognition({ forSpeech: true });
    let utterance = null;
    try {
      utterance = utteranceFactory(spoken);
    } catch {
      utterance = null;
    }
    if (!utterance) {
      resumeListeningAfterTurn({ askedQuestion });
      return;
    }
    state.speaking = true;
    setUiState("speaking");
    currentUtterance = utterance;
    const finish = () => {
      if (currentUtterance !== utterance) return;
      currentUtterance = null;
      state.speaking = false;
      recognitionPausedForSpeech = false;
      if (!state.active) return;
      resumeListeningAfterTurn({ askedQuestion });
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    try {
      synthesis.speak(utterance);
    } catch (error) {
      emitEvent(`Speech synthesis failed: ${error?.message || error}`, "warn");
      finish();
    }
  }

  function handleAssistantTurnEnd(finalText, { askedQuestion = false } = {}) {
    if (!state.active) return snapshot();
    state.assistantStreaming = false;
    state.toolRunning = false;
    if (state.userPaused) return snapshot();
    if (state.queuedInterrupt) {
      flushQueuedInterrupt();
      return snapshot();
    }
    speak(finalText, { askedQuestion });
    return snapshot();
  }

  function handleUserActivity() {
    clearSilenceTimer();
  }

  function start() {
    if (state.active) return snapshot();
    state.active = true;
    state.userPaused = false;
    state.queuedInterrupt = "";
    state.assistantStreaming = false;
    state.toolRunning = false;
    state.lastError = "";
    const listening = startRecognition();
    if (listening) {
      setUiState("listening");
    } else if (state.ttsAvailable) {
      setUiState("paused", { reason: "stt-unavailable" });
      emitEvent("Browser speech recognition is unavailable here; Pi answers will still be spoken, but the microphone stays off. Type prompts normally or configure another STT provider in a later phase.", "warn");
    } else {
      setUiState("error", { reason: "speech-unsupported" });
      emitEvent("This browser exposes neither speech recognition nor speech synthesis, so the Natural Conversation voice loop cannot run.", "error");
    }
    return snapshot();
  }

  function pause({ reason = "manual" } = {}) {
    if (!state.active) return snapshot();
    state.userPaused = true;
    clearSilenceTimer();
    clearPartialTranscript();
    stopSpeaking();
    stopRecognition({ forSpeech: true });
    setUiState("paused", { reason });
    return snapshot();
  }

  function resume() {
    if (!state.active) return snapshot();
    state.userPaused = false;
    recognitionPausedForSpeech = false;
    if (state.assistantStreaming) {
      if (!state.toolRunning) startRecognition();
      setUiState("answering", { reason: "manual-resume" });
      return snapshot();
    }
    resumeListeningAfterTurn();
    return snapshot();
  }

  function togglePaused() {
    return state.userPaused ? resume() : pause();
  }

  function stop() {
    if (!state.active) {
      state.uiState = "off";
      return snapshot();
    }
    state.active = false;
    state.userPaused = false;
    clearSilenceTimer();
    clearPartialTranscript();
    stopSpeaking();
    stopRecognition();
    state.assistantStreaming = false;
    state.toolRunning = false;
    state.queuedInterrupt = "";
    setUiState("off");
    return snapshot();
  }

  return {
    start,
    stop,
    pause,
    resume,
    togglePaused,
    getState: snapshot,
    isActive: () => state.active,
    setAssistantActivity,
    handleAssistantTurnEnd,
    handleUserActivity,
  };
}
