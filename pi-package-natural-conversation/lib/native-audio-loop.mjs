import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { loadVoiceConfig, resolveRuntimeVoiceConfig, hasNativeConsent, safeEndpointLabel } from "./voice-config.mjs";
import { sweepStalePidFiles, voiceRuntimeDir } from "./native-audio/pidfiles.mjs";
import { speakableTextFromMarkdown, splitIntoSpeechChunks } from "./native-audio/speech-text.mjs";
import { isSelfEcho } from "./native-audio/self-echo.mjs";

export const PROTOCOL_VERSION = 1;
export const AUDIO_WIDGET_KEY = "natural-conversation-audio";

const DEFAULT_TIMINGS = Object.freeze({
  handshakeMs: 3000,
  byeMs: 1000,
  stdinCloseMs: 500,
  sigtermMs: 1000,
  restartBackoffMs: [500, 2000, 8000],
  restartWindowMs: 60000,
  restartLimit: 3,
  steerDebounceMs: 400,
  probeTimeoutMs: 15000,
  maxPendingInterrupts: 3,
});

function defaultCompanionPath() {
  return fileURLToPath(new URL("./native-audio-companion.mjs", import.meta.url));
}

function notify(ctx, message, level = "info") {
  if (ctx?.hasUI && ctx.ui?.notify) ctx.ui.notify(message, level);
}

/**
 * Extension-side native audio orchestrator.
 *
 * Safety invariants (plan §3):
 * - refuses to spawn unless the conversation controller is enabled;
 * - never touches tools/thinking/prompt policy — transcripts enter Pi only
 *   through pi.sendUserMessage(), so all controller guards apply unchanged;
 * - `/talk off` and session shutdown tear the companion down before the
 *   controller restores tools/thinking;
 * - any failure degrades to Phase-1 safe text mode, never to wider access.
 */
export function createNativeAudioLoop(pi, controller, deps = {}) {
  const spawn = deps.spawn ?? nodeSpawn;
  const env = deps.env ?? process.env;
  const loadConfig = deps.loadConfig ?? (() => loadVoiceConfig({ env }));
  const companionPath = deps.companionPath ?? defaultCompanionPath();
  const kill = deps.kill ?? process.kill.bind(process);
  const now = deps.now ?? Date.now;
  const timings = { ...DEFAULT_TIMINGS, ...deps.timings };
  const sweep = deps.sweep ?? (() => sweepStalePidFiles(voiceRuntimeDir(env)));
  const onExitHook = deps.registerExitHook ?? ((fn) => process.on("exit", fn));

  const state = {
    phase: "off", // off | starting | running | paused | error
    child: null,
    childPid: null,
    stopping: false,
    ready: null, // ready message payload
    resolvedNative: null,
    consent: null,
    lastCtx: undefined,
    lastError: null,
    stderrRing: [],
    exitTimestamps: [],
    restartTimer: null,
    agentStreaming: false,
    toolPhaseActive: false,
    pendingInterrupts: [],
    steerTimer: null,
    speakCounter: 0,
    pendingSpeakIds: new Set(),
    lastSpokenText: "",
    lastAnswerText: "",
    silenceTimer: null,
    metrics: {},
    probeWaiters: new Map(),
    probeCounter: 0,
    exitHookInstalled: false,
    startedAt: null,
  };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function ctxOf(ctx) {
    if (ctx) state.lastCtx = ctx;
    return ctx ?? state.lastCtx;
  }

  function setUiState(uiState, ctx) {
    if (controller.isEnabled()) controller.setUiState(uiState, ctxOf(ctx));
  }

  function updateWidget(ctx) {
    const target = ctxOf(ctx);
    if (!target?.hasUI || !target.ui?.setWidget) return;
    if (state.phase === "running") {
      const mic = state.ready?.capture?.tool ?? "?";
      const stt = state.ready?.stt?.provider ?? "not configured";
      target.ui.setWidget(AUDIO_WIDGET_KEY, [`● Voice listening — mic: ${mic} — stt: ${stt} — /talk audio off to stop`]);
    } else if (state.phase === "paused") {
      target.ui.setWidget(AUDIO_WIDGET_KEY, ["◌ Voice paused — /talk resume to continue"]);
    } else {
      target.ui.setWidget(AUDIO_WIDGET_KEY, undefined);
    }
  }

  function sendToCompanion(message) {
    const child = state.child;
    if (!child || child.exitCode !== null) return false;
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  function killGroup(signal) {
    if (!state.childPid) return;
    try {
      kill(-state.childPid, signal);
    } catch {
      try {
        kill(state.childPid, signal);
      } catch {
        // already gone
      }
    }
  }

  function clearTimers() {
    for (const key of ["restartTimer", "steerTimer", "silenceTimer"]) {
      if (state[key]) {
        clearTimeout(state[key]);
        state[key] = null;
      }
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForExit(child, ms) {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  // ------------------------------------------------------------------
  // lifecycle
  // ------------------------------------------------------------------

  function resolveStartConfig(ctx, { requireEnabled = true } = {}) {
    const loaded = loadConfig();
    for (const warning of loaded.warnings) notify(ctx, `voice.json: ${warning}`, "warning");
    if (requireEnabled && !loaded.config.native.enabled) {
      notify(ctx, "Native audio is not configured. Run /talk setup first.", "warning");
      return undefined;
    }
    if (requireEnabled && !hasNativeConsent(loaded.config)) {
      notify(ctx, "Native audio consent has not been recorded. Run /talk setup first.", "warning");
      return undefined;
    }
    const resolved = resolveRuntimeVoiceConfig(loaded.config, env);
    if (resolved.errors.length > 0) {
      for (const error of resolved.errors) notify(ctx, `voice config: ${error}`, "error");
      return undefined;
    }
    return { native: resolved.native, consent: loaded.config.consent, config: loaded.config };
  }

  function spawnCompanion() {
    const child = spawn(process.execPath, [companionPath], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env,
    });
    child.stdin.on("error", () => {});
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      handleCompanionMessage(message);
    });
    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        state.stderrRing.push(line.trim());
        if (state.stderrRing.length > 20) state.stderrRing.shift();
      }
    });
    child.on("exit", () => handleCompanionExit(child));
    return child;
  }

  function installExitHook() {
    if (state.exitHookInstalled) return;
    state.exitHookInstalled = true;
    onExitHook(() => {
      // Best-effort synchronous group kill; the companion's stdin dead-man
      // switch is the guaranteed layer.
      if (state.child && state.child.exitCode === null) killGroup("SIGKILL");
    });
  }

  async function start(ctx, { auto = false } = {}) {
    const target = ctxOf(ctx);
    if (state.phase === "running" || state.phase === "starting") {
      if (!auto) notify(target, "Native audio is already running.", "info");
      return false;
    }
    if (!controller.isEnabled()) {
      notify(target, "Enable conversation safe mode first with /talk on.", "warning");
      return false;
    }
    const resolved = resolveStartConfig(target);
    if (!resolved) {
      if (auto) return false;
      setUiState("listening", target);
      return false;
    }

    try {
      sweep();
    } catch {
      // sweeping is best-effort
    }

    state.phase = "starting";
    state.stopping = false;
    state.stderrRing = [];
    state.resolvedNative = resolved.native;
    state.consent = resolved.consent;

    let child;
    try {
      child = spawnCompanion();
    } catch (error) {
      state.phase = "error";
      state.lastError = `companion spawn failed: ${error.message}`;
      notify(target, state.lastError, "error");
      return false;
    }
    state.child = child;
    state.childPid = child.pid ?? null;
    installExitHook();

    const readyPromise = new Promise((resolve) => {
      state.readyResolve = resolve;
    });
    sendToCompanion({ type: "hello", protocolVersion: PROTOCOL_VERSION, config: { native: resolved.native, consent: resolved.consent } });

    const ready = await Promise.race([readyPromise, sleep(timings.handshakeMs).then(() => undefined)]);
    if (!ready) {
      state.lastError = "companion did not answer the handshake in time";
      killGroup("SIGKILL");
      state.child = null;
      state.childPid = null;
      state.phase = "error";
      setUiState("error", target);
      notify(target, `Native audio failed to start: ${state.lastError}`, "error");
      return false;
    }

    state.ready = ready;
    state.phase = "running";
    state.startedAt = now();
    state.lastError = null;
    if (ready.stt?.error) notify(target, `STT provider issue: ${ready.stt.error}`, "warning");
    if (ready.tts?.error) notify(target, `TTS provider issue: ${ready.tts.error}`, "warning");

    sendToCompanion({ type: "listen" });
    sendToCompanion({ type: "gate", mode: "open" });
    setUiState("listening", target);
    updateWidget(target);
    if (!auto) notify(target, `Native audio on — mic: ${ready.capture?.tool ?? "?"}, stt: ${ready.stt?.provider ?? "none"}, tts: ${ready.tts?.provider ?? "none"}.`, "info");
    return true;
  }

  async function stop(ctx, { notify: shouldNotify = true, uiState = "listening" } = {}) {
    const target = ctxOf(ctx);
    clearTimers();
    const child = state.child;
    if (!child) {
      state.phase = "off";
      updateWidget(target);
      return true;
    }
    state.stopping = true;
    state.phase = "off";

    sendToCompanion({ type: "shutdown" });
    let exited = await waitForExit(child, timings.byeMs);
    if (!exited) {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      exited = await waitForExit(child, timings.stdinCloseMs);
    }
    if (!exited) {
      killGroup("SIGTERM");
      exited = await waitForExit(child, timings.sigtermMs);
    }
    if (!exited) killGroup("SIGKILL");

    state.child = null;
    state.childPid = null;
    state.ready = null;
    state.stopping = false;
    state.pendingSpeakIds.clear();
    state.pendingInterrupts = [];
    updateWidget(target);
    if (controller.isEnabled()) setUiState(uiState, target);
    if (shouldNotify) notify(target, "Native audio off.", "info");
    return true;
  }

  function stopSync() {
    if (state.child && state.child.exitCode === null) killGroup("SIGKILL");
  }

  function pause(ctx) {
    const target = ctxOf(ctx);
    if (state.phase !== "running") {
      notify(target, "Native audio is not running.", "warning");
      return false;
    }
    sendToCompanion({ type: "pause", reason: "user" });
    state.phase = "paused";
    setUiState("paused", target);
    updateWidget(target);
    notify(target, "Voice capture paused — the microphone process is stopped. /talk resume to continue.", "info");
    return true;
  }

  function resume(ctx) {
    const target = ctxOf(ctx);
    if (state.phase !== "paused") {
      notify(target, state.phase === "running" ? "Native audio is already listening." : "Native audio is not running. Use /talk audio on.", "warning");
      return false;
    }
    sendToCompanion({ type: "listen" });
    sendToCompanion({ type: "gate", mode: "open" });
    state.phase = "running";
    setUiState("listening", target);
    updateWidget(target);
    return true;
  }

  function handleCompanionExit(child) {
    if (state.child !== child) return;
    state.child = null;
    state.childPid = null;
    state.ready = null;
    if (state.stopping) return;

    // Unexpected exit: restart with backoff, give up after the budget.
    const timestamp = now();
    state.exitTimestamps = state.exitTimestamps.filter((t) => timestamp - t < timings.restartWindowMs);
    state.exitTimestamps.push(timestamp);
    const attempts = state.exitTimestamps.length;
    const target = state.lastCtx;

    if (attempts > timings.restartLimit) {
      state.phase = "error";
      state.lastError = state.stderrRing[state.stderrRing.length - 1] ?? "companion exited repeatedly";
      setUiState("error", target);
      updateWidget(target);
      notify(target, `Native audio stopped after repeated failures: ${state.lastError}. Safe text mode stays on; use /talk audio on to retry.`, "error");
      return;
    }

    state.phase = "starting";
    const backoff = timings.restartBackoffMs[Math.min(attempts - 1, timings.restartBackoffMs.length - 1)];
    notify(target, `Native audio companion exited unexpectedly; restarting in ${backoff}ms.`, "warning");
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      state.phase = "off";
      void start(target, { auto: true });
    }, backoff);
    state.restartTimer.unref?.();
  }

  // ------------------------------------------------------------------
  // companion → extension messages
  // ------------------------------------------------------------------

  function handleCompanionMessage(message) {
    switch (message.type) {
      case "ready":
        state.readyResolve?.(message);
        state.readyResolve = null;
        break;
      case "state":
        if (message.state === "paused" && state.phase === "running") {
          state.phase = "paused";
          setUiState("paused");
          updateWidget();
        } else if (message.state === "transcribing" && !state.agentStreaming) {
          setUiState("transcribing");
        } else if (message.state === "listening" && !state.agentStreaming && state.pendingSpeakIds.size === 0 && state.phase === "running") {
          setUiState("listening");
        }
        break;
      case "vad":
        if (message.event === "speech_start") cancelSilenceTimer();
        break;
      case "final-transcript":
        handleFinalTranscript(message);
        break;
      case "speak-started":
        break;
      case "speak-ended":
        state.pendingSpeakIds.delete(message.id);
        if (state.pendingSpeakIds.size === 0 && !state.agentStreaming && state.phase === "running") {
          sendToCompanion({ type: "gate", mode: "open" });
          setUiState("listening");
          armSilenceTimer();
        }
        break;
      case "metrics":
        state.metrics = { ...state.metrics, ...message.turn, at: now() };
        break;
      case "device_event":
        if (message.attempt === 1) notify(state.lastCtx, "Voice capture restarted after a device hiccup.", "warning");
        break;
      case "error":
        state.lastError = `${message.code}: ${message.message}`;
        if (message.code === "stt-unavailable" || message.code === "capture-lost" || message.code === "capture-unavailable") {
          state.phase = "paused";
          setUiState("paused");
          updateWidget();
          notify(state.lastCtx, `Native audio paused — ${state.lastError}. Fix the provider and /talk resume, or /talk audio off.`, "error");
        } else if (!message.fatal) {
          notify(state.lastCtx, `Native audio: ${state.lastError}`, "warning");
        }
        break;
      case "probe-result": {
        const waiter = state.probeWaiters.get(message.id);
        if (waiter) {
          state.probeWaiters.delete(message.id);
          waiter(message);
        }
        break;
      }
      case "bye":
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // transcript dispatch (the ONLY path into Pi; plan §3 rule 1)
  // ------------------------------------------------------------------

  function dispatchUserMessage(text, options) {
    try {
      pi.sendUserMessage(text, options);
    } catch {
      // The agent may have started streaming between our check and the send;
      // steer is always legal while streaming.
      try {
        pi.sendUserMessage(text, { deliverAs: "steer" });
      } catch {
        notify(state.lastCtx, "Failed to deliver voice transcript to the agent.", "error");
      }
    }
  }

  function flushPendingInterrupts() {
    if (state.steerTimer) {
      clearTimeout(state.steerTimer);
      state.steerTimer = null;
    }
    if (state.pendingInterrupts.length === 0) return;
    const joined = state.pendingInterrupts.join("\n");
    state.pendingInterrupts = [];
    if (state.agentStreaming) dispatchUserMessage(joined, { deliverAs: "steer" });
    else dispatchUserMessage(joined);
  }

  function handleFinalTranscript(message) {
    const text = String(message.text ?? "").trim();
    if (!text || !controller.isEnabled() || state.phase !== "running") return;
    cancelSilenceTimer();

    const overlap = state.resolvedNative?.bargeIn?.selfEchoOverlap ?? 0.6;
    if ((message.capturedDuring === "speaking" || state.pendingSpeakIds.size > 0) && state.lastSpokenText &&
      isSelfEcho(text, state.lastSpokenText, { threshold: overlap })) {
      return; // our own TTS audio picked up by the mic
    }

    // Any accepted user turn flushes the TTS queue wholesale.
    if (state.pendingSpeakIds.size > 0) {
      sendToCompanion({ type: "cancel-speak" });
    }

    if (state.agentStreaming) {
      const result = controller.handleConversationInterrupt(text, { toolPhaseActive: state.toolPhaseActive });
      if (result.action === "ignored") return;
      if (state.pendingInterrupts.length >= timings.maxPendingInterrupts) {
        state.pendingInterrupts.shift();
        notify(state.lastCtx, "Voice interruptions are queuing up; dropped the oldest one.", "warning");
      }
      state.pendingInterrupts.push(text);
      setUiState("interrupting");
      if (state.toolPhaseActive) notify(state.lastCtx, "Will interrupt after the current tool finishes.", "info");
      if (!state.steerTimer) {
        state.steerTimer = setTimeout(() => {
          state.steerTimer = null;
          flushPendingInterrupts();
        }, timings.steerDebounceMs);
        state.steerTimer.unref?.();
      }
      return;
    }

    setUiState("answering");
    dispatchUserMessage(text);
  }

  // ------------------------------------------------------------------
  // agent lifecycle → gate + speech
  // ------------------------------------------------------------------

  function active() {
    return state.phase === "running" || state.phase === "paused";
  }

  function handleAgentStart(ctx) {
    ctxOf(ctx);
    state.agentStreaming = true;
    state.toolPhaseActive = false;
    if (!active()) return;
    cancelSilenceTimer();
    sendToCompanion({ type: "gate", mode: "interrupt_only" });
    setUiState("answering", ctx);
  }

  function handleToolExecutionStart(ctx) {
    ctxOf(ctx);
    state.toolPhaseActive = true;
    if (active()) sendToCompanion({ type: "gate", mode: "closed" });
  }

  function handleToolExecutionEnd(ctx) {
    ctxOf(ctx);
    state.toolPhaseActive = false;
    if (active() && state.agentStreaming) sendToCompanion({ type: "gate", mode: "interrupt_only" });
  }

  function finalAssistantText(event) {
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role !== "assistant") continue;
      const content = message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("\n");
      }
      return "";
    }
    return "";
  }

  function handleAgentEnd(event, ctx) {
    const target = ctxOf(ctx);
    state.agentStreaming = false;
    state.toolPhaseActive = false;
    if (!controller.isEnabled()) return;

    // Transcripts that arrived at the very end of a turn become a new turn.
    if (state.pendingInterrupts.length > 0) {
      flushPendingInterrupts();
      return;
    }
    if (!active()) return;

    const rawText = finalAssistantText(event);
    state.lastAnswerText = rawText.trim();
    const speakable = speakableTextFromMarkdown(rawText);
    const chunks = state.phase === "running" ? splitIntoSpeechChunks(speakable) : [];

    if (chunks.length === 0) {
      sendToCompanion({ type: "gate", mode: "open" });
      setUiState("listening", target);
      armSilenceTimer();
      return;
    }

    state.lastSpokenText = speakable.slice(-1500);
    const bargeIn = state.resolvedNative?.headphones || state.resolvedNative?.bargeIn?.enabled;
    sendToCompanion({ type: "gate", mode: bargeIn ? "barge_in" : "closed" });
    setUiState("speaking", target);
    for (const chunk of chunks) {
      state.speakCounter += 1;
      const id = `s${state.speakCounter}`;
      state.pendingSpeakIds.add(id);
      sendToCompanion({ type: "speak", id, text: chunk });
    }
  }

  function notifyUserInput(ctx) {
    ctxOf(ctx);
    cancelSilenceTimer();
  }

  // ------------------------------------------------------------------
  // silence events (Phase 5b; controller is the one-shot authority)
  // ------------------------------------------------------------------

  function cancelSilenceTimer() {
    if (state.silenceTimer) {
      clearTimeout(state.silenceTimer);
      state.silenceTimer = null;
    }
    controller.handleConversationSilence?.({ phase: "cancel" });
  }

  function armSilenceTimer() {
    if (state.phase !== "running") return;
    if (!state.lastAnswerText) return;
    if (state.resolvedNative?.silence?.enabled === false) return;
    const armed = controller.handleConversationSilence?.({ phase: "arm", assistantText: state.lastAnswerText });
    if (!armed || armed.action !== "armed") return;
    state.lastAnswerText = "";
    if (state.silenceTimer) clearTimeout(state.silenceTimer);
    state.silenceTimer = setTimeout(() => {
      state.silenceTimer = null;
      const fired = controller.handleConversationSilence?.({ phase: "fire" });
      if (fired?.action === "send-silence-event" && state.phase === "running" && !state.agentStreaming) {
        controller.updateStatus(state.lastCtx);
        dispatchUserMessage(fired.message);
      }
    }, armed.timeoutMs);
    state.silenceTimer.unref?.();
  }

  /**
   * Live-apply a TTS config change (e.g. a voice switch) to a running
   * companion. Config persistence stays with the caller; this only updates
   * the in-flight session.
   */
  function applyTtsConfig(patch) {
    if (state.resolvedNative) state.resolvedNative.tts = { ...state.resolvedNative.tts, ...patch };
    if (state.ready?.tts && patch.provider) state.ready.tts.provider = patch.provider;
    if (state.child) sendToCompanion({ type: "set-config", patch: { tts: patch } });
    updateWidget();
  }

  // ------------------------------------------------------------------
  // diagnostics
  // ------------------------------------------------------------------

  async function probeRunning(target) {
    state.probeCounter += 1;
    const id = `p${state.probeCounter}`;
    const promise = new Promise((resolve) => {
      state.probeWaiters.set(id, resolve);
      setTimeout(() => {
        if (state.probeWaiters.delete(id)) resolve({ target, ok: false, detail: "probe timed out" });
      }, timings.probeTimeoutMs).unref?.();
    });
    sendToCompanion({ type: "probe", id, target });
    return promise;
  }

  async function runProbes(ctx, targets, { configOverride } = {}) {
    const target = ctxOf(ctx);
    if (!controller.isEnabled()) {
      notify(target, "Enable conversation safe mode first with /talk on (probes may open the microphone).", "warning");
      return undefined;
    }

    if (state.phase === "running" || state.phase === "paused") {
      const results = [];
      for (const probeTarget of targets) results.push(await probeRunning(probeTarget));
      return results;
    }

    // Short-lived companion just for the probes.
    let resolved;
    if (configOverride) {
      resolved = configOverride;
    } else {
      const loaded = loadConfig();
      const runtime = resolveRuntimeVoiceConfig(loaded.config, env);
      if (runtime.errors.length > 0) {
        for (const error of runtime.errors) notify(target, `voice config: ${error}`, "error");
        return undefined;
      }
      resolved = { native: runtime.native, consent: loaded.config.consent };
    }

    let child;
    try {
      child = spawn(process.execPath, [companionPath], { stdio: ["pipe", "pipe", "pipe"], detached: true, env });
    } catch (error) {
      notify(target, `doctor: companion spawn failed: ${error.message}`, "error");
      return undefined;
    }
    child.stdin.on("error", () => {});
    const results = [];
    try {
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
      const pending = new Map();
      let readyResolve;
      const readyPromise = new Promise((resolve) => {
        readyResolve = resolve;
      });
      rl.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.type === "ready") readyResolve(message);
        if (message.type === "probe-result") pending.get(message.id)?.(message);
      });
      child.stdin.write(`${JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, config: resolved })}\n`);
      const ready = await Promise.race([readyPromise, sleep(timings.handshakeMs).then(() => undefined)]);
      if (!ready) {
        notify(target, "doctor: companion did not answer the handshake", "error");
        return undefined;
      }
      let counter = 0;
      for (const probeTarget of targets) {
        counter += 1;
        const id = `d${counter}`;
        const promise = new Promise((resolve) => {
          pending.set(id, resolve);
          setTimeout(() => {
            if (pending.delete(id)) resolve({ target: probeTarget, ok: false, detail: "probe timed out" });
          }, timings.probeTimeoutMs).unref?.();
        });
        child.stdin.write(`${JSON.stringify({ type: "probe", id, target: probeTarget })}\n`);
        results.push(await promise);
      }
      child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
      await waitForExit(child, timings.byeMs);
    } finally {
      if (child.exitCode === null) {
        try {
          kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // already gone
          }
        }
      }
    }
    return results;
  }

  async function doctor(ctx, targetArg) {
    const target = ctxOf(ctx);
    const targets = ["mic", "speaker", "stt", "tts"].includes(targetArg) ? [targetArg] : ["mic", "speaker", "stt", "tts"];
    const results = await runProbes(target, targets);
    if (!results) return undefined;
    const lines = results.map((result) => `${result.ok ? "✔" : "✘"} ${result.target}: ${result.detail}`);
    notify(target, ["Native audio doctor:", ...lines].join("\n"), results.every((r) => r.ok) ? "info" : "warning");
    return results;
  }

  // ------------------------------------------------------------------
  // status
  // ------------------------------------------------------------------

  function statusLines() {
    const lines = [`native audio: ${state.phase}`];
    if (state.childPid) lines.push(`companion pid: ${state.childPid}${state.startedAt ? ` (up ${Math.round((now() - state.startedAt) / 1000)}s)` : ""}`);
    if (state.ready) {
      lines.push(`capture: ${state.ready.capture?.tool ?? "none"}`);
      lines.push(`playback: ${state.ready.playback?.tool ?? "none"}`);
      const sttUrl = state.resolvedNative?.stt?.url;
      const ttsUrl = state.resolvedNative?.tts?.url;
      lines.push(`stt: ${state.ready.stt?.provider ?? "none"}${sttUrl ? ` (${safeEndpointLabel(sttUrl)})` : ""}`);
      lines.push(`tts: ${state.ready.tts?.provider ?? "none"}${ttsUrl ? ` (${safeEndpointLabel(ttsUrl)})` : ""}`);
    }
    if (state.metrics.at) {
      const parts = [];
      if (Number.isFinite(state.metrics.utteranceMs)) parts.push(`utterance ${state.metrics.utteranceMs}ms`);
      if (Number.isFinite(state.metrics.sttMs)) parts.push(`stt ${state.metrics.sttMs}ms`);
      if (parts.length) lines.push(`last turn: ${parts.join(", ")}`);
    }
    if (state.lastError) lines.push(`last error: ${state.lastError}`);
    return lines;
  }

  return {
    start,
    stop,
    stopSync,
    pause,
    resume,
    doctor,
    runProbes,
    statusLines,
    isRunning: () => state.phase === "running",
    isActive: active,
    getPhase: () => state.phase,
    handleAgentStart,
    handleAgentEnd,
    handleToolExecutionStart,
    handleToolExecutionEnd,
    notifyUserInput,
    applyTtsConfig,
    handleCompanionMessage, // exposed for tests
    _state: state,
  };
}
