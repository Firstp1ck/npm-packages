import test from "node:test";
import assert from "node:assert/strict";
import { encodeWav, parseWav, isWav } from "../lib/native-audio/wav.mjs";

test("encodeWav writes a valid 44-byte RIFF header", () => {
  const pcm = Buffer.alloc(3200, 0);
  const wav = encodeWav(pcm, { sampleRateHz: 16000, channels: 1, bitsPerSample: 16 });

  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.toString("ascii", 12, 16), "fmt ");
  assert.equal(wav.readUInt32LE(16), 16);
  assert.equal(wav.readUInt16LE(20), 1); // PCM
  assert.equal(wav.readUInt16LE(22), 1); // mono
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(28), 32000); // byte rate
  assert.equal(wav.readUInt16LE(32), 2); // block align
  assert.equal(wav.readUInt16LE(34), 16); // bit depth
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), pcm.length);
});

test("parseWav round-trips encodeWav output", () => {
  const pcm = Buffer.from(Array.from({ length: 64 }, (_, i) => i % 256));
  const wav = encodeWav(pcm, { sampleRateHz: 22050 });
  const parsed = parseWav(wav);

  assert.ok(parsed);
  assert.equal(parsed.audioFormat, 1);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.sampleRateHz, 22050);
  assert.equal(parsed.bitsPerSample, 16);
  assert.equal(parsed.dataLength, pcm.length);
  assert.deepEqual(parsed.data, pcm);
});

test("parseWav rejects garbage and isWav detects headers", () => {
  assert.equal(parseWav(Buffer.from("not a wav file at all")), undefined);
  assert.equal(isWav(Buffer.from("nope")), false);
  assert.equal(isWav(encodeWav(Buffer.alloc(4))), true);
});
