import test from "node:test";
import assert from "node:assert/strict";
import { createEnergyVad, frameRmsDb, VAD_DEFAULTS } from "../lib/native-audio/vad.mjs";

const FRAME_SAMPLES = 512;

function toneFrame(amplitude) {
  const frame = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    frame[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * amplitude);
  }
  return frame;
}

function silenceFrame() {
  return new Int16Array(FRAME_SAMPLES);
}

function collect(vad, frames) {
  const events = [];
  for (const frame of frames) events.push(...vad.pushFrame(frame));
  return events.filter((event) => event.type !== "level");
}

const LOUD = toneFrame(8000); // sine RMS ≈ -15.3 dBFS, far above the -50 default floor + 9 dB

test("frameRmsDb computes sensible levels", () => {
  assert.equal(frameRmsDb(silenceFrame()), -Infinity);
  const loudDb = frameRmsDb(LOUD);
  assert.ok(loudDb > -16 && loudDb < -14, `expected ≈ -15.3 dBFS, got ${loudDb}`);
});

test("pure silence never starts speech", () => {
  const vad = createEnergyVad();
  const events = collect(vad, Array.from({ length: 200 }, silenceFrame));
  assert.deepEqual(events, []);
  assert.equal(vad.isSpeaking(), false);
});

test("speech starts after 3 consecutive frames above threshold", () => {
  const vad = createEnergyVad();
  let events = collect(vad, [LOUD, LOUD]);
  assert.deepEqual(events, []);
  events = collect(vad, [LOUD]);
  assert.deepEqual(events.map((e) => e.type), ["speech_start"]);
});

test("hangover ends the utterance and pre-roll is included", () => {
  const vad = createEnergyVad();
  // Distinctive quiet-but-nonzero pre-roll content (value 3 ≈ -81 dBFS).
  const preRollFrame = new Int16Array(FRAME_SAMPLES).fill(3);
  const hangoverFrames = Math.ceil(VAD_DEFAULTS.hangoverMs / 32);

  const events = collect(vad, [
    ...Array.from({ length: 12 }, () => preRollFrame),
    ...Array.from({ length: 15 }, () => LOUD), // ≈ 480 ms of speech
    ...Array.from({ length: hangoverFrames }, silenceFrame),
  ]);

  assert.deepEqual(events.map((e) => e.type), ["speech_start", "speech_end"]);
  const end = events[1];
  assert.equal(end.forced, false);
  // The utterance must start with pre-roll frames (value 3), not the loud tone.
  const firstSample = end.pcm.readInt16LE(0);
  assert.equal(firstSample, 3);
  // preRoll (~10) + trigger frames are included ahead of the loud audio.
  assert.ok(end.durationMs >= 15 * 32, `duration ${end.durationMs}`);
});

test("short clicks are discarded without an STT call", () => {
  const vad = createEnergyVad();
  const hangoverFrames = Math.ceil(VAD_DEFAULTS.hangoverMs / 32);
  const events = collect(vad, [
    ...Array.from({ length: 3 }, () => LOUD), // ~96 ms — below the 300 ms minimum
    ...Array.from({ length: hangoverFrames }, silenceFrame),
  ]);
  assert.deepEqual(events.map((e) => e.type), ["speech_start", "discarded"]);
  assert.equal(events[1].reason, "too-short");
});

test("max utterance duration forces an endpoint", () => {
  const vad = createEnergyVad({ maxUtteranceMs: 1000 });
  const events = collect(vad, Array.from({ length: 40 }, () => LOUD));
  // Continued loud audio after the forced endpoint legitimately re-triggers.
  assert.deepEqual(events.slice(0, 2).map((e) => e.type), ["speech_start", "speech_end"]);
  assert.equal(events[1].forced, true);
  assert.ok(events[1].durationMs <= 1100, `forced endpoint too late: ${events[1].durationMs}ms`);
});

test("fixed thresholdDb overrides the adaptive floor", () => {
  const vad = createEnergyVad({ thresholdDb: -5 });
  // -13 dBFS tone is below the -5 dBFS fixed threshold: never starts.
  const events = collect(vad, Array.from({ length: 30 }, () => LOUD));
  assert.deepEqual(events, []);
});

test("adaptive floor rises with sustained background noise", () => {
  const vad = createEnergyVad();
  const noise = toneFrame(300); // ≈ -42 dBFS background
  collect(vad, Array.from({ length: 400 }, () => noise));
  assert.ok(vad.getNoiseFloorDb() > -46, `floor should adapt upward, got ${vad.getNoiseFloorDb()}`);
});
