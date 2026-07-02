#!/usr/bin/env node
// Native audio companion child process. Spawned by lib/native-audio-loop.mjs
// with JSONL over stdio; audio bytes never cross the pipe. This process has
// zero Pi API access — it reports capture-level facts and plays what it is
// told to speak; all safety policy lives in the parent extension.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createEnergyVad } from "./native-audio/vad.mjs";
import { encodeWav, parseWav, isWav } from "./native-audio/wav.mjs";
import { resolveCaptureCommand } from "./native-audio/capture.mjs";
import { resolvePlaybackCommand } from "./native-audio/playback.mjs";
import { COMPANION_MARKER, removePidFile, voiceRuntimeDir, writePidFile } from "./native-audio/pidfiles.mjs";
import { frameRmsDb } from "./native-audio/vad.mjs";
import { createSttAdapter, createTtsChain } from "./providers/select.mjs";

export const PROTOCOL_VERSION = 1;

const LEVEL_INTERVAL_MS = 250;
const TAIL_GUARD_MS = 250;
const CAPTURE_WATCHDOG_MS = 2000;
const CAPTURE_RESTART_LIMIT = 3;
const STT_FAILURE_LIMIT = 3;

const state = {
  config: null, // resolved native.* block
  consent: null,
  gate: "closed",
  capState: "idle", // idle | listening | capturing | transcribing | paused
  captureChild: null,
  captureWanted: false,
  captureBuffer: Buffer.alloc(0),
  captureRestarts: 0,
  lastCaptureDataAt: 0,
  watchdogTimer: null,
  vad: null,
  stt: null,
  sttError: null,
  ttsChain: [],
  ttsError: null,
  sttFailures: 0,
  speakQueue: [],
  currentSpeak: null, // { id, abort, player, cancelled }
  speaking: false,
  lastSpeakEndedAt: 0,
  lastLevelAt: 0,
  pidDir: null,
  shuttingDown: false,
};

function send(message) {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch {
    dieNow();
  }
}

function sendState(capState) {
  if (state.capState === capState) return;
  state.capState = capState;
  send({ type: "state", state: capState });
}

function sendError(code, message, { fatal = false } = {}) {
  send({ type: "error", code, message: String(message ?? "").slice(0, 500), fatal });
  if (fatal) shutdownNow(1);
}

function killChildrenSync(signal = "SIGKILL") {
  for (const child of [state.captureChild, state.currentSpeak?.player]) {
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  }
}

function cleanupPidFile() {
  if (state.pidDir) removePidFile(state.pidDir, process.pid);
}

function shutdownNow(exitCode = 0) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  if (state.watchdogTimer) clearInterval(state.watchdogTimer);
  stopCapture();
  cancelAllSpeech();
  killChildrenSync();
  cleanupPidFile();
  process.exit(exitCode);
}

// Dead-man switch: stdin EOF/error is guaranteed when the Pi process dies,
// however it dies. Exit (and take capture/playback children along) fast.
function dieNow() {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  killChildrenSync();
  cleanupPidFile();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Capture / VAD / STT
// ---------------------------------------------------------------------------

function frameBytes() {
  return 512 * 2; // 512-sample s16le frames
}

function startCapture() {
  if (state.captureChild || !state.config) return;
  const resolved = resolveCaptureCommand(state.config.capture);
  if (!resolved) {
    sendError("capture-unavailable", "No capture tool found (tried pw-record, parecord, arecord, ffmpeg)");
    sendState("paused");
    return;
  }
  let child;
  try {
    child = spawn(resolved.argv[0], resolved.argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    sendError("capture-failed", `capture spawn failed: ${error.message}`);
    sendState("paused");
    return;
  }
  state.captureChild = child;
  state.captureBuffer = Buffer.alloc(0);
  state.lastCaptureDataAt = Date.now();
  child.stdout.on("data", onCaptureData);
  child.stderr.on("data", () => {});
  child.on("error", () => {});
  child.on("close", () => {
    if (state.captureChild !== child) return;
    state.captureChild = null;
    if (state.captureWanted && !state.shuttingDown) restartCapture("capture_exited");
  });
  if (state.capState !== "capturing") sendState("listening");
}

function stopCapture() {
  state.captureWanted = false;
  const child = state.captureChild;
  state.captureChild = null;
  state.captureBuffer = Buffer.alloc(0);
  state.vad?.reset();
  if (child && child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

function restartCapture(kind) {
  state.captureRestarts += 1;
  if (state.captureRestarts > CAPTURE_RESTART_LIMIT) {
    state.captureWanted = false;
    sendError("capture-lost", "capture restart budget exhausted; audio paused");
    sendState("paused");
    return;
  }
  send({ type: "device_event", kind, attempt: state.captureRestarts });
  const child = state.captureChild;
  state.captureChild = null;
  if (child && child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  setTimeout(() => {
    if (state.captureWanted && !state.shuttingDown && !state.captureChild) startCapture();
  }, 250 * state.captureRestarts).unref();
}

function gateIsOpen() {
  if (state.gate === "closed") return false;
  if (state.capState === "transcribing") return false;
  if (Date.now() - state.lastSpeakEndedAt < TAIL_GUARD_MS) return false;
  if (state.speaking && state.gate !== "barge_in") return false;
  return true;
}

function onCaptureData(chunk) {
  state.lastCaptureDataAt = Date.now();
  state.captureRestarts = 0;
  state.captureBuffer = state.captureBuffer.length ? Buffer.concat([state.captureBuffer, chunk]) : chunk;
  const size = frameBytes();
  while (state.captureBuffer.length >= size) {
    const frame = state.captureBuffer.subarray(0, size);
    state.captureBuffer = state.captureBuffer.subarray(size);
    handleFrame(frame);
  }
}

function handleFrame(frame) {
  if (!state.vad) return;
  if (!gateIsOpen()) {
    // Half-duplex: keep the device warm but never treat gated audio as speech.
    if (state.vad.isSpeaking()) state.vad.reset();
    const now = Date.now();
    if (now - state.lastLevelAt >= LEVEL_INTERVAL_MS) {
      state.lastLevelAt = now;
      send({ type: "level", rmsDb: round1(frameRmsDb(frame)) });
    }
    return;
  }

  const capturedDuring = state.speaking ? "speaking" : "listening";
  for (const event of state.vad.pushFrame(frame)) {
    if (event.type === "level") {
      const now = Date.now();
      if (now - state.lastLevelAt >= LEVEL_INTERVAL_MS) {
        state.lastLevelAt = now;
        send({ type: "level", rmsDb: round1(event.rmsDb) });
      }
    } else if (event.type === "speech_start") {
      sendState("capturing");
      send({ type: "vad", event: "speech_start" });
    } else if (event.type === "speech_end") {
      send({ type: "vad", event: "speech_end" });
      void transcribeUtterance(event.pcm, event.durationMs, capturedDuring);
    } else if (event.type === "discarded") {
      sendState("listening");
    }
  }
}

async function transcribeUtterance(pcm, utteranceMs, capturedDuring) {
  sendState("transcribing");
  if (!state.stt) {
    sendError("stt-not-configured", state.sttError ?? "STT provider is not configured; run /talk setup");
    sendState("listening");
    return;
  }
  const wav = encodeWav(pcm, { sampleRateHz: state.config.capture.sampleRateHz ?? 16000 });
  try {
    const { text, ms } = await state.stt.transcribe(wav, {});
    state.sttFailures = 0;
    const trimmed = String(text ?? "").trim();
    if (trimmed) {
      send({ type: "final-transcript", text: trimmed, utteranceMs, sttMs: ms, capturedDuring });
      send({ type: "metrics", turn: { utteranceMs, sttMs: ms } });
    }
  } catch (error) {
    state.sttFailures += 1;
    if (state.sttFailures >= STT_FAILURE_LIMIT) {
      sendError("stt-unavailable", `STT failed ${state.sttFailures} times: ${error.message}`);
      state.sttFailures = 0;
      stopCapture();
      sendState("paused");
      return;
    }
    sendError("stt-failed", error.message);
  }
  if (state.capState === "transcribing") sendState(state.captureChild ? "listening" : "paused");
}

// ---------------------------------------------------------------------------
// TTS / playback
// ---------------------------------------------------------------------------

function cancelAllSpeech() {
  for (const item of state.speakQueue.splice(0)) {
    send({ type: "speak-ended", id: item.id, cancelled: true });
  }
  cancelCurrentSpeak();
}

function cancelCurrentSpeak() {
  const current = state.currentSpeak;
  if (!current) return;
  current.cancelled = true;
  current.abort.abort();
  if (current.player && current.player.exitCode === null) {
    try {
      current.player.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

function enqueueSpeak(id, text) {
  state.speakQueue.push({ id, text });
  void drainSpeakQueue();
}

let draining = false;
async function drainSpeakQueue() {
  if (draining) return;
  draining = true;
  try {
    while (state.speakQueue.length > 0 && !state.shuttingDown) {
      const item = state.speakQueue.shift();
      await speakOne(item);
    }
  } finally {
    draining = false;
    state.speaking = false;
  }
}

async function speakOne(item) {
  const current = { id: item.id, abort: new AbortController(), player: null, cancelled: false };
  state.currentSpeak = current;
  state.speaking = true;
  send({ type: "speak-started", id: item.id });

  let ended = false;
  const endSpeak = (cancelled) => {
    if (ended) return;
    ended = true;
    state.currentSpeak = null;
    state.lastSpeakEndedAt = Date.now();
    send({ type: "speak-ended", id: item.id, cancelled });
  };

  try {
    let payload;
    let lastError;
    for (const adapter of state.ttsChain) {
      if (current.cancelled) break;
      try {
        payload = await adapter.synthesize(item.text, { signal: current.abort.signal });
        break;
      } catch (error) {
        if (error?.code === "tts-cancelled") break;
        lastError = error;
      }
    }
    if (current.cancelled) {
      endSpeak(true);
      return;
    }
    if (!payload) {
      sendError("tts-unavailable", lastError?.message ?? state.ttsError ?? "No TTS provider produced audio");
      endSpeak(false);
      return;
    }
    await playAudio(payload, current);
    endSpeak(current.cancelled);
  } catch (error) {
    sendError("playback-failed", error.message);
    endSpeak(current.cancelled);
  }
}

async function playAudio(payload, current) {
  let pcm = payload.audio;
  let sampleRateHz = Number.isFinite(payload.sampleRateHz) ? payload.sampleRateHz : 16000;
  if (payload.format === "wav" || isWav(payload.audio)) {
    const parsed = parseWav(payload.audio);
    if (!parsed || parsed.audioFormat !== 1) throw new Error("TTS returned audio that is not PCM WAV");
    pcm = parsed.data;
    sampleRateHz = parsed.sampleRateHz;
  }
  const resolved = resolvePlaybackCommand(state.config.playback, { sampleRateHz });
  if (!resolved) throw new Error("No playback tool found (tried pw-play, paplay, aplay, ffplay)");

  await new Promise((resolve, reject) => {
    let player;
    try {
      player = spawn(resolved.argv[0], resolved.argv.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
    } catch (error) {
      reject(new Error(`playback spawn failed: ${error.message}`));
      return;
    }
    current.player = player;
    player.on("error", (error) => reject(new Error(`playback failed: ${error.message}`)));
    player.on("close", () => resolve());
    player.stdin.on("error", () => {});
    player.stdin.end(pcm);
  });
}

// ---------------------------------------------------------------------------
// Probes (setup / doctor)
// ---------------------------------------------------------------------------

async function runProbe(id, target) {
  let result;
  try {
    if (target === "mic") result = await probeMic();
    else if (target === "speaker") result = await probeSpeaker();
    else if (target === "stt") result = state.stt ? await state.stt.probe({}) : { ok: false, detail: state.sttError ?? "STT not configured" };
    else if (target === "tts") result = await probeTts();
    else result = { ok: false, detail: `unknown probe target '${target}'` };
  } catch (error) {
    result = { ok: false, detail: error?.message ?? String(error) };
  }
  send({ type: "probe-result", id, target, ...result });
}

async function probeMic() {
  const resolved = resolveCaptureCommand(state.config.capture);
  if (!resolved) return { ok: false, detail: "no capture tool found" };
  const sampleRateHz = resolved.sampleRateHz;
  const wantedBytes = Math.floor(sampleRateHz * 2 * 1.2);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(resolved.argv[0], resolved.argv.slice(1), { stdio: ["ignore", "pipe", "ignore"] });
    } catch (error) {
      resolve({ ok: false, detail: `capture spawn failed: ${error.message}` });
      return;
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      const pcm = Buffer.concat(chunks);
      if (pcm.length < sampleRateHz * 2 * 0.2) {
        resolve({ ok: false, detail: `${resolved.tool}: captured too little audio (${pcm.length} bytes)`, tool: resolved.tool });
        return;
      }
      const frameSize = 512 * 2;
      const levels = [];
      for (let offset = 0; offset + frameSize <= pcm.length; offset += frameSize) {
        levels.push(frameRmsDb(pcm.subarray(offset, offset + frameSize)));
      }
      const finite = levels.filter(Number.isFinite).sort((a, b) => a - b);
      const peak = finite.length ? finite[finite.length - 1] : -Infinity;
      const median = finite.length ? finite[Math.floor(finite.length / 2)] : -Infinity;
      resolve({
        ok: true,
        detail: `${resolved.tool}, peak ${round1(peak)} dBFS, noise floor ${round1(median)} dBFS`,
        tool: resolved.tool,
        peakDb: round1(peak),
        noiseFloorDb: round1(median),
      });
    };
    const timer = setTimeout(finish, 2500);
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= wantedBytes) {
        clearTimeout(timer);
        finish();
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ ok: false, detail: `${resolved.tool} failed to start` });
      }
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function generateTone({ sampleRateHz = 16000, frequencyHz = 440, durationMs = 500, amplitude = 0.3 } = {}) {
  const samples = Math.floor((sampleRateHz * durationMs) / 1000);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * frequencyHz * i) / sampleRateHz) * amplitude * 32767);
    pcm.writeInt16LE(value, i * 2);
  }
  return pcm;
}

async function probeSpeaker() {
  const sampleRateHz = 16000;
  const resolved = resolvePlaybackCommand(state.config.playback, { sampleRateHz });
  if (!resolved) return { ok: false, detail: "no playback tool found" };
  const pcm = generateTone({ sampleRateHz });
  try {
    await new Promise((resolve, reject) => {
      const player = spawn(resolved.argv[0], resolved.argv.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
      player.on("error", (error) => reject(new Error(`${resolved.tool} failed: ${error.message}`)));
      player.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${resolved.tool} exited with code ${code}`))));
      player.stdin.on("error", () => {});
      player.stdin.end(pcm);
    });
    return { ok: true, detail: `${resolved.tool} played a 440 Hz test tone`, tool: resolved.tool };
  } catch (error) {
    return { ok: false, detail: error.message, tool: resolved.tool };
  }
}

async function probeTts() {
  if (state.ttsChain.length === 0) return { ok: false, detail: state.ttsError ?? "no TTS provider configured" };
  const details = [];
  let ok = false;
  for (const adapter of state.ttsChain) {
    const result = await adapter.probe({});
    details.push(`${adapter.id}: ${result.detail}`);
    if (result.ok) ok = true;
  }
  return { ok, detail: details.join("; ") };
}

// ---------------------------------------------------------------------------
// Protocol handling
// ---------------------------------------------------------------------------

function handleHello(message) {
  if (message.protocolVersion !== PROTOCOL_VERSION) {
    sendError("protocol-mismatch", `companion speaks protocol ${PROTOCOL_VERSION}, extension sent ${message.protocolVersion}; update the package`, { fatal: true });
    return;
  }
  state.config = message.config?.native ?? message.config ?? {};
  state.consent = message.config?.consent ?? {};
  state.vad = createEnergyVad({
    ...state.config.vad,
    sampleRateHz: state.config.capture?.sampleRateHz ?? 16000,
  });

  try {
    state.stt = createSttAdapter({ native: state.config, consent: state.consent }, {});
  } catch (error) {
    state.stt = null;
    state.sttError = error.message;
  }
  try {
    state.ttsChain = createTtsChain({ native: state.config, consent: state.consent }, {});
  } catch (error) {
    state.ttsChain = [];
    state.ttsError = error.message;
  }

  state.pidDir = voiceRuntimeDir();
  try {
    writePidFile(state.pidDir, process.pid, COMPANION_MARKER);
  } catch {
    state.pidDir = null;
  }

  state.watchdogTimer = setInterval(() => {
    if (!state.captureWanted || !state.captureChild || state.shuttingDown) return;
    if (Date.now() - state.lastCaptureDataAt > CAPTURE_WATCHDOG_MS) restartCapture("capture_stalled");
  }, 500);
  state.watchdogTimer.unref?.();

  const captureResolved = resolveCaptureCommand(state.config.capture ?? {});
  const playbackResolved = resolvePlaybackCommand(state.config.playback ?? {}, { sampleRateHz: 16000 });
  send({
    type: "ready",
    protocolVersion: PROTOCOL_VERSION,
    pid: process.pid,
    capture: { tool: captureResolved?.tool ?? null },
    playback: { tool: playbackResolved?.tool ?? null },
    stt: { provider: state.stt?.id ?? null, error: state.sttError ?? undefined },
    tts: { provider: state.ttsChain[0]?.id ?? null, error: state.ttsError ?? undefined },
  });
}

function deepMerge(target, patch) {
  for (const [key, patchValue] of Object.entries(patch ?? {})) {
    if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue) && target[key] && typeof target[key] === "object") {
      deepMerge(target[key], patchValue);
    } else {
      target[key] = patchValue;
    }
  }
  return target;
}

function handleMessage(message) {
  switch (message.type) {
    case "hello":
      handleHello(message);
      break;
    case "gate":
      state.gate = ["open", "interrupt_only", "barge_in", "closed"].includes(message.mode) ? message.mode : "closed";
      break;
    case "listen":
      state.captureWanted = true;
      state.captureRestarts = 0;
      startCapture();
      break;
    case "pause":
      stopCapture();
      sendState("paused");
      break;
    case "speak":
      if (typeof message.id === "string" && typeof message.text === "string") enqueueSpeak(message.id, message.text);
      break;
    case "cancel-speak":
      if (message.id) {
        if (state.currentSpeak?.id === message.id) cancelCurrentSpeak();
        else {
          const index = state.speakQueue.findIndex((item) => item.id === message.id);
          if (index >= 0) {
            const [item] = state.speakQueue.splice(index, 1);
            send({ type: "speak-ended", id: item.id, cancelled: true });
          }
        }
      } else {
        cancelAllSpeech();
      }
      break;
    case "set-config":
      if (state.config && message.patch) {
        deepMerge(state.config, message.patch);
        if (message.patch.vad) {
          state.vad = createEnergyVad({ ...state.config.vad, sampleRateHz: state.config.capture?.sampleRateHz ?? 16000 });
        }
        if (message.patch.stt) {
          try {
            state.stt = createSttAdapter({ native: state.config, consent: state.consent }, {});
            state.sttError = null;
          } catch (error) {
            state.stt = null;
            state.sttError = error.message;
          }
        }
        if (message.patch.tts) {
          try {
            state.ttsChain = createTtsChain({ native: state.config, consent: state.consent }, {});
            state.ttsError = null;
          } catch (error) {
            state.ttsChain = [];
            state.ttsError = error.message;
          }
        }
      }
      break;
    case "probe":
      void runProbe(message.id, message.target);
      break;
    case "shutdown":
      // Flush "bye" before exiting; process.exit would truncate pending pipe writes.
      try {
        process.stdout.write(`${JSON.stringify({ type: "bye" })}\n`, () => shutdownNow(0));
      } catch {
        shutdownNow(0);
      }
      setTimeout(() => shutdownNow(0), 200).unref?.();
      break;
    default:
      break; // unknown message types are ignored (additive protocol)
  }
}

function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : -99;
}

export function main() {
  process.on("exit", () => killChildrenSync());
  process.on("SIGTERM", () => shutdownNow(0));
  process.on("SIGINT", () => shutdownNow(0));
  process.on("uncaughtException", (error) => {
    try {
      sendError("companion-crash", error?.stack ?? String(error));
    } finally {
      shutdownNow(1);
    }
  });
  process.stdout.on("error", dieNow);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    try {
      handleMessage(message);
    } catch (error) {
      sendError("companion-error", error?.message ?? String(error));
    }
  });
  rl.on("close", dieNow);
  process.stdin.on("error", dieNow);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
