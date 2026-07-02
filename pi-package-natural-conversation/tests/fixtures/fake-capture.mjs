#!/usr/bin/env node
// Fake capture tool for companion integration tests. Emits s16le 16 kHz mono
// PCM on stdout: a stretch of silence, one loud "utterance", then continuous
// silence (so the companion's stalled-capture watchdog never fires).
// Usage: node fake-capture.mjs <pidFile> [--silent]
import { writeFileSync } from "node:fs";

const pidFile = process.argv[2];
const silentOnly = process.argv.includes("--silent");
if (pidFile) writeFileSync(pidFile, String(process.pid));

const SAMPLE_RATE = 16000;

function tone(ms, amplitude) {
  const samples = Math.floor((SAMPLE_RATE * ms) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * amplitude), i * 2);
  }
  return buffer;
}

function silence(ms) {
  return Buffer.alloc(Math.floor((SAMPLE_RATE * ms) / 1000) * 2);
}

process.stdout.on("error", () => process.exit(0));

// Scripted audio, written immediately (the VAD is frame-count based, not
// wall-clock based, so faster-than-realtime is fine).
process.stdout.write(silence(400));
if (!silentOnly) {
  process.stdout.write(tone(700, 8000));
}
process.stdout.write(silence(1200));

// Keep streaming silence so the capture watchdog stays quiet.
setInterval(() => {
  process.stdout.write(silence(100));
}, 50);
