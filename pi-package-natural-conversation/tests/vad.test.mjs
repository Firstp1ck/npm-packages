import test from "node:test";
import assert from "node:assert/strict";
import { createEnergyVad, frameRmsDb, frameVoicedness, VAD_DEFAULTS } from "../lib/native-audio/vad.mjs";

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

// Deterministic loud white noise (seeded LCG): high energy, no pitch period.
function noiseFrame(amplitude = 8000, seed = 12345) {
  const frame = new Int16Array(FRAME_SAMPLES);
  let value = seed;
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    frame[i] = Math.round(((value / 0x7fffffff) * 2 - 1) * amplitude);
  }
  return frame;
}

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
  assert.ok(end.voicedMs >= 250, `voiced tone must report voice evidence, got ${end.voicedMs}ms`);
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

test("active speech frames exclude trailing hangover (barge-in debounce input)", () => {
  const vad = createEnergyVad();
  assert.equal(vad.getActiveSpeechFrames(), 0);

  // A short blip: active frames stay near the trigger count while silence
  // accumulates in the hangover, so a 250 ms debounce never confirms it.
  collect(vad, Array.from({ length: 4 }, () => LOUD));
  const afterBlip = vad.getActiveSpeechFrames();
  assert.ok(afterBlip >= 3 && afterBlip <= 4, `blip active frames: ${afterBlip}`);
  collect(vad, Array.from({ length: 10 }, silenceFrame)); // 320 ms of quiet, still within hangover
  assert.equal(vad.isSpeaking(), true);
  assert.ok(vad.getActiveSpeechFrames() <= afterBlip, "hangover silence must not count as active speech");

  // Sustained speech keeps growing past any debounce window.
  collect(vad, Array.from({ length: 12 }, () => LOUD));
  assert.ok(vad.getActiveSpeechFrames() * 32 >= 250, `sustained speech active ms: ${vad.getActiveSpeechFrames() * 32}`);

  // After the utterance ends, the counter resets.
  collect(vad, Array.from({ length: Math.ceil(VAD_DEFAULTS.hangoverMs / 32) }, silenceFrame));
  assert.equal(vad.isSpeaking(), false);
  assert.equal(vad.getActiveSpeechFrames(), 0);
});

test("voicedness separates periodic (voice-like) audio from noise", () => {
  assert.ok(frameVoicedness(LOUD) > 0.8, `tone voicedness ${frameVoicedness(LOUD)}`);
  assert.ok(frameVoicedness(noiseFrame()) < 0.4, `noise voicedness ${frameVoicedness(noiseFrame())}`);
  assert.equal(frameVoicedness(silenceFrame()), 0);
});

test("loud non-voice noise accumulates active frames but not voiced frames", () => {
  const vad = createEnergyVad();
  // 20 frames (~640 ms) of loud white noise — starts an utterance…
  let seed = 1;
  const frames = Array.from({ length: 20 }, () => noiseFrame(8000, seed++));
  collect(vad, frames);
  assert.equal(vad.isSpeaking(), true);
  assert.ok(vad.getActiveSpeechFrames() >= 15, "noise is loud enough to count as active");
  // …but almost none of it passes the voiced check, so a 250 ms barge-in
  // confirmation (≈ 8 frames) can never be reached by typing/clatter.
  assert.ok(vad.getVoicedSpeechFrames() <= 2, `voiced frames from noise: ${vad.getVoicedSpeechFrames()}`);

  // A voice-like tone at the same level confirms quickly.
  const voiced = createEnergyVad();
  collect(voiced, Array.from({ length: 20 }, () => LOUD));
  assert.ok(voiced.getVoicedSpeechFrames() * 32 >= 250, `voiced ms: ${voiced.getVoicedSpeechFrames() * 32}`);
});

test("quiet voice below the barge-in margin stays unconfirmed but still transcribes", () => {
  // Fixed threshold -30 dBFS; tone at ~-27 dBFS is 3 dB above it — enough to
  // start an utterance, not enough to clear the +5 dB barge-in margin.
  const vad = createEnergyVad({ thresholdDb: -30 });
  const soft = toneFrame(2100); // RMS ≈ -26.9 dBFS
  collect(vad, Array.from({ length: 20 }, () => soft));
  assert.equal(vad.isSpeaking(), true, "soft speech still opens an utterance");
  assert.equal(vad.getVoicedSpeechFrames(), 0, "but never confirms a barge-in");
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
