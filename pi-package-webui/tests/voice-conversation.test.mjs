import assert from "node:assert/strict";
import {
  createVoiceConversationController,
  voiceSilenceEventMessage,
  VOICE_UI_STATES,
} from "../public/voice-conversation.mjs";

// Voice-loop unit tests: drive the dependency-injected controller with fake
// speech recognition, fake speech synthesis, and fake timers so the whole
// listen -> prompt -> speak -> listen contract runs deterministically in Node.

class FakeRecognition {
  constructor(log) {
    this.log = log;
    this.started = false;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
  }
  start() {
    if (this.started) throw new Error("InvalidStateError: already started");
    this.started = true;
    this.log.push("recognition:start");
  }
  stop() {
    this.started = false;
    this.log.push("recognition:stop");
    this.onend?.();
  }
  abort() {
    this.started = false;
    this.log.push("recognition:abort");
    this.onend?.();
  }
  emitFinal(text) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
  }
  emitInterim(text) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: false })] });
  }
  emitError(code) {
    this.onerror?.({ error: code });
  }
}

class FakeSynthesis {
  constructor(log) {
    this.log = log;
    this.utterances = [];
    this.cancelled = 0;
  }
  speak(utterance) {
    this.utterances.push(utterance);
    this.log.push(`synthesis:speak:${utterance.text}`);
  }
  cancel() {
    this.cancelled += 1;
    this.log.push("synthesis:cancel");
  }
  lastUtterance() {
    return this.utterances[this.utterances.length - 1];
  }
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutFn: (handler, delayMs) => {
      const id = nextId++;
      timers.set(id, { handler, delayMs });
      return id;
    },
    clearTimeoutFn: (id) => timers.delete(id),
    fireAll: () => {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.handler();
      }
    },
    count: () => timers.size,
  };
}

async function tick(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function createHarness({ bargeInEnabled = false, silenceTimeoutMs = 8000, tts = true, stt = true, failTranscript = false } = {}) {
  const log = [];
  const recognition = new FakeRecognition(log);
  const synthesis = tts ? new FakeSynthesis(log) : null;
  const transcripts = [];
  const silenceEvents = [];
  const partialTranscripts = [];
  const states = [];
  const events = [];
  const timers = createFakeTimers();
  const controller = createVoiceConversationController({
    recognitionFactory: stt ? () => recognition : () => null,
    synthesis,
    utteranceFactory: tts ? (text) => ({ text, onend: null, onerror: null }) : null,
    sendTranscript: async (text, { reason } = {}) => {
      if (failTranscript) throw new Error("send failed");
      transcripts.push({ text, reason });
    },
    sendSilenceEvent: async (info) => {
      silenceEvents.push(info);
    },
    onPartialTranscript: (text) => partialTranscripts.push(text),
    onStateChange: (uiState) => states.push(uiState),
    onEvent: (message, level) => events.push({ message, level }),
    bargeInEnabled,
    silenceTimeoutMs,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  return { controller, recognition, synthesis, transcripts, silenceEvents, partialTranscripts, states, events, timers, log };
}

// Exported state vocabulary matches the plan's visible states.
for (const expected of ["off", "listening", "transcribing", "answering", "speaking", "interrupting", "silence", "paused", "error"]) {
  assert.ok(VOICE_UI_STATES.includes(expected), `VOICE_UI_STATES should include ${expected}`);
}
assert.match(voiceSilenceEventMessage(8), /stayed silent for 8s/, "silence event message should carry the silent duration");
assert.match(voiceSilenceEventMessage(8), /Do not invent intent/, "silence event message should instruct conservative interpretation");

// 1. start(): recognition begins and state is listening.
{
  const h = createHarness();
  h.controller.start();
  assert.equal(h.controller.getState().uiState, "listening", "start should enter listening");
  assert.equal(h.recognition.started, true, "start should start recognition");
  assert.equal(h.controller.isActive(), true);
}

// 2. Final transcript while idle is sent as a normal prompt.
{
  const h = createHarness();
  h.controller.start();
  h.recognition.emitInterim("what is");
  assert.equal(h.controller.getState().uiState, "transcribing", "interim results should show transcribing");
  assert.equal(h.controller.getState().partialTranscript, "what is", "interim results should be exposed as a partial transcript");
  assert.deepEqual(h.partialTranscripts, ["what is"], "partial transcript listeners should receive interim text");
  h.recognition.emitFinal("what is this repo about");
  await tick();
  assert.deepEqual(h.transcripts, [{ text: "what is this repo about", reason: "prompt" }]);
  assert.equal(h.controller.getState().partialTranscript, "", "final transcripts should clear the partial preview");
  assert.deepEqual(h.partialTranscripts, ["what is", ""], "partial transcript listeners should be cleared on final text");
  assert.equal(h.controller.getState().uiState, "answering", "sent transcript should show answering");
}

// 3. Turn end speaks the final answer, pauses the mic, then resumes listening.
{
  const h = createHarness();
  h.controller.start();
  h.controller.setAssistantActivity({ streaming: true });
  h.controller.handleAssistantTurnEnd("The tests all pass.", { askedQuestion: false });
  assert.equal(h.controller.getState().uiState, "speaking", "final text should be spoken");
  assert.equal(h.synthesis.lastUtterance().text, "The tests all pass.");
  assert.equal(h.recognition.started, false, "mic should be paused while speaking without barge-in");
  h.synthesis.lastUtterance().onend();
  assert.equal(h.controller.getState().uiState, "listening", "TTS end should resume listening");
  assert.equal(h.recognition.started, true, "recognition should restart after speaking");
  assert.equal(h.timers.count(), 0, "no silence timer without a question");
}

// 4. Barge-in enabled: speech during TTS cancels it and interrupts.
{
  const h = createHarness({ bargeInEnabled: true });
  h.controller.start();
  h.controller.handleAssistantTurnEnd("Long answer being spoken aloud.", { askedQuestion: false });
  assert.equal(h.controller.getState().uiState, "speaking");
  assert.equal(h.recognition.started, true, "barge-in keeps the mic open while speaking");
  const cancelledBefore = h.synthesis.cancelled;
  h.recognition.emitFinal("stop and try something else");
  await tick();
  assert.ok(h.synthesis.cancelled > cancelledBefore, "barge-in should cancel active TTS");
  assert.deepEqual(h.transcripts, [{ text: "stop and try something else", reason: "interrupt" }]);
  assert.equal(h.controller.getState().uiState, "answering");
}

// 5. Speech during assistant final-output streaming is an interruption.
{
  const h = createHarness();
  h.controller.start();
  h.controller.setAssistantActivity({ streaming: true });
  h.recognition.emitFinal("actually use the other file");
  await tick();
  assert.deepEqual(h.transcripts, [{ text: "actually use the other file", reason: "interrupt" }]);
}

// 6. Speech during a tool phase is queued, then flushed after the tool ends.
{
  const h = createHarness();
  h.controller.start();
  h.controller.setAssistantActivity({ streaming: true, toolRunning: true });
  h.recognition.emitFinal("wait, stop reading files");
  await tick();
  assert.deepEqual(h.transcripts, [], "transcripts must not be injected during a tool phase");
  assert.equal(h.controller.getState().uiState, "interrupting");
  assert.equal(h.controller.getState().queuedInterrupt, "wait, stop reading files");
  h.controller.setAssistantActivity({ toolRunning: false });
  await tick();
  assert.deepEqual(h.transcripts, [{ text: "wait, stop reading files", reason: "interrupt" }], "queued interrupt should flush after the tool phase");
}

// 7. A queued interrupt still pending at turn end becomes the next prompt and
// suppresses speaking the interrupted answer.
{
  const h = createHarness();
  h.controller.start();
  h.controller.setAssistantActivity({ streaming: true, toolRunning: true });
  h.recognition.emitFinal("never mind, different question");
  await tick();
  h.controller.handleAssistantTurnEnd("Here is the answer you interrupted.", { askedQuestion: false });
  await tick();
  assert.deepEqual(h.transcripts, [{ text: "never mind, different question", reason: "prompt" }], "queued interrupt should be delivered as the next turn");
  assert.equal(h.synthesis.utterances.length, 0, "the interrupted answer must not be spoken");
}

// 8. Questions arm the silence timer; timeout emits one structured event.
{
  const h = createHarness();
  h.controller.start();
  h.controller.handleAssistantTurnEnd("Should I continue with the refactor?", { askedQuestion: true });
  h.synthesis.lastUtterance().onend();
  assert.equal(h.timers.count(), 1, "a question should arm the silence timer");
  h.timers.fireAll();
  await tick();
  assert.equal(h.silenceEvents.length, 1, "silence timeout should emit one event");
  assert.equal(h.silenceEvents[0].silentSeconds, 8);
  assert.equal(h.controller.getState().uiState, "answering", "silence event hands the turn back to the assistant");
}

// 9. User speech cancels a pending silence timer.
{
  const h = createHarness();
  h.controller.start();
  h.controller.handleAssistantTurnEnd("Which branch should I use?", { askedQuestion: true });
  h.synthesis.lastUtterance().onend();
  assert.equal(h.timers.count(), 1);
  h.recognition.emitFinal("use the main branch");
  await tick();
  assert.equal(h.timers.count(), 0, "answering the question should cancel the silence timer");
  assert.deepEqual(h.transcripts, [{ text: "use the main branch", reason: "prompt" }]);
  assert.equal(h.silenceEvents.length, 0);
}

// 10. Manual composer activity cancels the silence timer too.
{
  const h = createHarness();
  h.controller.start();
  h.controller.handleAssistantTurnEnd("Anything else?", { askedQuestion: true });
  h.synthesis.lastUtterance().onend();
  assert.equal(h.timers.count(), 1);
  h.controller.handleUserActivity();
  assert.equal(h.timers.count(), 0, "typed prompts should cancel the silence timer");
}

// 11. STT unavailable: paused state, but answers are still spoken.
{
  const h = createHarness({ stt: false });
  h.controller.start();
  assert.equal(h.controller.getState().uiState, "paused", "missing STT should pause listening, not error");
  h.controller.handleAssistantTurnEnd("Spoken without a microphone.", { askedQuestion: false });
  assert.equal(h.synthesis.lastUtterance().text, "Spoken without a microphone.");
  h.synthesis.lastUtterance().onend();
  assert.equal(h.controller.getState().uiState, "paused", "loop stays paused when STT is unavailable");
}

// 12. Neither STT nor TTS: explicit error state.
{
  const h = createHarness({ stt: false, tts: false });
  h.controller.start();
  assert.equal(h.controller.getState().uiState, "error");
}

// 13. Microphone permission denial surfaces as an error and stops listening.
{
  const h = createHarness();
  h.controller.start();
  h.recognition.emitError("not-allowed");
  assert.equal(h.controller.getState().uiState, "error");
  assert.equal(h.recognition.started, false, "denied permission should stop recognition");
  assert.ok(h.events.some((event) => event.level === "error" && /Microphone access was denied/.test(event.message)));
}

// 14. Benign recognition end restarts listening automatically.
{
  const h = createHarness();
  h.controller.start();
  h.recognition.started = false;
  h.recognition.onend();
  assert.equal(h.recognition.started, true, "spontaneous recognition end should restart the mic");
}

// 15. Manual pause stops listening without disabling the safe conversation mode;
// resume restarts the microphone and accepts transcripts again.
{
  const h = createHarness();
  h.controller.start();
  h.controller.pause();
  assert.equal(h.controller.isActive(), true, "pause must keep the controller active");
  assert.equal(h.controller.getState().uiState, "paused");
  assert.equal(h.controller.getState().userPaused, true);
  assert.equal(h.recognition.started, false, "pause should stop recognition");
  h.recognition.onend();
  assert.equal(h.recognition.started, false, "paused recognition must not auto-restart on onend");
  h.recognition.emitFinal("ignored while paused");
  await tick();
  assert.deepEqual(h.transcripts, [], "paused transcripts should be dropped");
  h.controller.resume();
  assert.equal(h.controller.getState().userPaused, false);
  assert.equal(h.controller.getState().uiState, "listening");
  assert.equal(h.recognition.started, true, "resume should restart recognition");
  h.recognition.emitFinal("resume listening");
  await tick();
  assert.deepEqual(h.transcripts, [{ text: "resume listening", reason: "prompt" }]);
}

// 16. Pause clears pending silence timers and suppresses speaking the completed turn.
{
  const h = createHarness();
  h.controller.start();
  h.controller.handleAssistantTurnEnd("Should I wait?", { askedQuestion: true });
  h.synthesis.lastUtterance().onend();
  assert.equal(h.timers.count(), 1, "question should arm silence timer before pause");
  h.controller.pause();
  assert.equal(h.timers.count(), 0, "pause should clear pending silence timers");
  h.controller.setAssistantActivity({ streaming: true });
  h.controller.handleAssistantTurnEnd("This should not be spoken while paused.", { askedQuestion: false });
  assert.equal(h.synthesis.utterances.length, 1, "paused turn end should not enqueue new TTS");
}

// 17. stop() tears everything down.
{
  const h = createHarness();
  h.controller.start();
  h.controller.handleAssistantTurnEnd("Do you want more detail?", { askedQuestion: true });
  h.controller.stop();
  assert.equal(h.controller.getState().uiState, "off");
  assert.equal(h.controller.isActive(), false);
  assert.equal(h.recognition.started, false, "stop should stop recognition");
  assert.equal(h.timers.count(), 0, "stop should clear pending silence timers");
  h.recognition.emitFinal("this should be ignored");
  await tick();
  assert.deepEqual(h.transcripts, [], "transcripts after stop are dropped");
}

// 18. Failed transcript delivery returns the loop to listening.
{
  const h = createHarness({ failTranscript: true });
  h.controller.start();
  h.recognition.emitFinal("this will fail to send");
  await tick();
  assert.equal(h.controller.getState().uiState, "listening", "send failures should fall back to listening");
  assert.ok(h.events.some((event) => event.level === "error" && /Failed to send voice transcript/.test(event.message)));
}

console.log("voice-conversation controller checks passed");
