import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPiperTtsAdapter, piperVoiceSampleRate, findPiperBinary } from "../lib/providers/tts-piper.mjs";

function fakePiperSpawn({ pcm = Buffer.from([1, 2, 3, 4]), failFlags = [], stderrOnFail = "unrecognized option '--output_raw'" } = {}) {
  const calls = [];
  const spawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { written: "", end(data) { this.written += data ?? ""; }, on() {} };
    child.kill = () => {};
    const rawFlag = args[args.length - 1];
    setImmediate(() => {
      if (failFlags.includes(rawFlag)) {
        child.stderr.emit("data", stderrOnFail);
        child.emit("close", 1);
      } else {
        child.stdout.emit("data", pcm);
        child.emit("close", 0);
      }
    });
    return child;
  };
  return { spawn, calls };
}

const VOICE_JSON = JSON.stringify({ audio: { sample_rate: 22050 } });

test("piper adapter spawns the binary with the model, feeds stdin, returns raw PCM at the voice sample rate", async () => {
  const { spawn, calls } = fakePiperSpawn({ pcm: Buffer.alloc(64, 7) });
  const adapter = createPiperTtsAdapter({
    modelPath: "/voices/de_DE-thorsten-medium.onnx",
    binary: "/usr/bin/piper",
    spawn,
    readFile: () => VOICE_JSON,
    fileExists: () => true,
  });

  const result = await adapter.synthesize("Hallo Welt.");
  assert.deepEqual(calls[0].args, ["--model", "/voices/de_DE-thorsten-medium.onnx", "--output-raw"]);
  assert.equal(result.format, "raw-s16le");
  assert.equal(result.sampleRateHz, 22050);
  assert.equal(result.audio.length, 64);
});

test("piper adapter retries with --output_raw for the legacy C++ binary", async () => {
  const { spawn, calls } = fakePiperSpawn({ failFlags: ["--output-raw"], stderrOnFail: "unknown option: --output-raw" });
  const adapter = createPiperTtsAdapter({
    modelPath: "/voices/v.onnx",
    binary: "/usr/bin/piper",
    spawn,
    readFile: () => VOICE_JSON,
    fileExists: () => true,
  });

  const result = await adapter.synthesize("hello");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args[2], "--output_raw");
  assert.ok(result.audio.length > 0);
});

test("piper probe reports missing binary and missing voice model", async () => {
  const missingBinary = createPiperTtsAdapter({ modelPath: "/v.onnx", findExec: () => undefined, fileExists: () => true });
  assert.match((await missingBinary.probe({})).detail, /not found/);

  const missingModel = createPiperTtsAdapter({ modelPath: "/v.onnx", binary: "/usr/bin/piper", fileExists: () => false });
  assert.match((await missingModel.probe({})).detail, /voice model missing/);
});

test("voice sample rate falls back to 22050 without a sidecar config", () => {
  assert.equal(piperVoiceSampleRate("/v.onnx", { readFile: () => VOICE_JSON }), 22050);
  assert.equal(piperVoiceSampleRate("/v.onnx", { readFile: () => JSON.stringify({ audio: { sample_rate: 16000 } }) }), 16000);
  assert.equal(piperVoiceSampleRate("/v.onnx", { readFile: () => { throw new Error("ENOENT"); } }), 22050);
});

test("findPiperBinary checks both binary names", () => {
  assert.equal(findPiperBinary({}, (name) => (name === "piper-tts" ? "/usr/bin/piper-tts" : undefined)), "/usr/bin/piper-tts");
  assert.equal(findPiperBinary({}, () => undefined), undefined);
});
