export const VAD_DEFAULTS = Object.freeze({
  sampleRateHz: 16000,
  frameSamples: 512,
  startDb: 9,
  thresholdDb: null,
  hangoverMs: 800,
  minSpeechMs: 300,
  maxUtteranceMs: 30000,
  preRollMs: 300,
  startFrames: 3,
  endDeltaDb: 3,
  noiseFloorDb: -50,
  floorAlpha: 0.05,
  floorMinDb: -70,
  floorMaxDb: -30,
});

export function frameRmsDb(frame) {
  const samples = frame instanceof Int16Array ? frame : new Int16Array(frame.buffer, frame.byteOffset, Math.floor(frame.byteLength / 2));
  if (samples.length === 0) return -Infinity;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure energy-based VAD state machine over fixed-size s16le mono frames.
 * All timing is derived from frame counts (frameSamples / sampleRateHz), never
 * wall-clock time, so tests and faster-than-realtime capture behave identically.
 */
export function createEnergyVad(options = {}) {
  const cfg = { ...VAD_DEFAULTS, ...options };
  const frameMs = (cfg.frameSamples / cfg.sampleRateHz) * 1000;
  const preRollFrames = Math.max(1, Math.ceil(cfg.preRollMs / frameMs));
  const hangoverFramesNeeded = Math.max(1, Math.ceil(cfg.hangoverMs / frameMs));
  const minSpeechFrames = Math.max(1, Math.ceil(cfg.minSpeechMs / frameMs));
  const maxUtteranceFrames = Math.max(minSpeechFrames, Math.ceil(cfg.maxUtteranceMs / frameMs));

  let speaking = false;
  let noiseFloorDb = clamp(cfg.noiseFloorDb, cfg.floorMinDb, cfg.floorMaxDb);
  let preRoll = [];
  let consecutiveAbove = 0;
  let utteranceFrames = [];
  let hangoverFrames = 0;
  let speechFrameCount = 0;
  let speechFloorDb = noiseFloorDb;

  function startThresholdDb() {
    if (Number.isFinite(cfg.thresholdDb)) return cfg.thresholdDb;
    return noiseFloorDb + cfg.startDb;
  }

  function endThresholdDb() {
    if (Number.isFinite(cfg.thresholdDb)) return cfg.thresholdDb - cfg.startDb + cfg.endDeltaDb;
    return speechFloorDb + cfg.endDeltaDb;
  }

  function updateNoiseFloor(rmsDb) {
    if (!Number.isFinite(rmsDb)) return;
    noiseFloorDb = clamp(noiseFloorDb + cfg.floorAlpha * (rmsDb - noiseFloorDb), cfg.floorMinDb, cfg.floorMaxDb);
  }

  function endUtterance(events, { forced = false } = {}) {
    const effectiveSpeechFrames = speechFrameCount - (forced ? 0 : hangoverFrames);
    const pcm = Buffer.concat(utteranceFrames.map((f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength)));
    const durationMs = Math.round(utteranceFrames.length * frameMs);
    if (effectiveSpeechFrames >= minSpeechFrames) {
      events.push({ type: "speech_end", pcm, durationMs, forced });
    } else {
      events.push({ type: "discarded", durationMs, reason: "too-short" });
    }
    speaking = false;
    utteranceFrames = [];
    hangoverFrames = 0;
    speechFrameCount = 0;
    consecutiveAbove = 0;
    preRoll = [];
  }

  function pushFrame(frame) {
    const view = frame instanceof Int16Array ? frame : new Int16Array(frame.buffer, frame.byteOffset, Math.floor(frame.byteLength / 2));
    const rmsDb = frameRmsDb(view);
    const events = [{ type: "level", rmsDb }];

    if (!speaking) {
      preRoll.push(view);
      if (preRoll.length > preRollFrames + cfg.startFrames) preRoll.shift();

      if (rmsDb > startThresholdDb()) {
        consecutiveAbove += 1;
        if (consecutiveAbove >= cfg.startFrames) {
          speaking = true;
          speechFloorDb = noiseFloorDb;
          utteranceFrames = [...preRoll];
          hangoverFrames = 0;
          speechFrameCount = cfg.startFrames;
          events.push({ type: "speech_start" });
        }
      } else {
        consecutiveAbove = 0;
        updateNoiseFloor(rmsDb);
      }
      return events;
    }

    utteranceFrames.push(view);
    speechFrameCount += 1;
    if (rmsDb > endThresholdDb()) {
      hangoverFrames = 0;
    } else {
      hangoverFrames += 1;
    }

    if (hangoverFrames >= hangoverFramesNeeded) {
      endUtterance(events);
    } else if (utteranceFrames.length >= maxUtteranceFrames) {
      endUtterance(events, { forced: true });
    }
    return events;
  }

  function reset({ keepNoiseFloor = true } = {}) {
    if (!keepNoiseFloor) noiseFloorDb = clamp(cfg.noiseFloorDb, cfg.floorMinDb, cfg.floorMaxDb);
    speaking = false;
    preRoll = [];
    consecutiveAbove = 0;
    utteranceFrames = [];
    hangoverFrames = 0;
    speechFrameCount = 0;
  }

  return {
    frameMs,
    frameSamples: cfg.frameSamples,
    pushFrame,
    reset,
    isSpeaking: () => speaking,
    getNoiseFloorDb: () => noiseFloorDb,
  };
}
