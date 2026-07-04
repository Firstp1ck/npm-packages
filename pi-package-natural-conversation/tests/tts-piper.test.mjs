import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Warm-mode fake: one long-lived child that "writes" a WAV per stdin line. */
function fakeWarmPiperSpawn({ dieOnSpawn = false, pcm = Buffer.from("RIFFwarm") } = {}) {
  const calls = [];
  let child;
  let fileCounter = 0;
  const spawn = (command, args) => {
    calls.push({ command, args });
    if (!args.includes("--output-dir")) {
      // exec-path fallback child (same shape as fakePiperSpawn's)
      const execChild = new EventEmitter();
      execChild.stdout = new EventEmitter();
      execChild.stderr = new EventEmitter();
      execChild.stdin = { written: "", end(data) { this.written += data ?? ""; }, on() {} };
      execChild.kill = () => {};
      setImmediate(() => {
        execChild.stdout.emit("data", Buffer.from([9, 9]));
        execChild.emit("close", 0);
      });
      return execChild;
    }
    const dir = args[args.indexOf("--output-dir") + 1];
    child = new EventEmitter();
    child.exitCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      on() {},
      write(line) {
        fileCounter += 1;
        const file = join(dir, `${fileCounter}.wav`);
        writeFileSync(file, pcm);
        setImmediate(() => child.stderr.emit("data", `INFO:__main__:Wrote ${file}\n`));
        return true;
      },
    };
    child.kill = () => {
      child.exitCode = 137;
      child.emit("close", 137);
    };
    if (dieOnSpawn) setImmediate(() => { child.exitCode = 1; child.emit("close", 1); });
    return child;
  };
  return { spawn, calls, getChild: () => child };
}

test("keepWarm reuses one piper process, returns WAVs, and cleans up files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-piper-warm-"));
  const { spawn, calls, getChild } = fakeWarmPiperSpawn();
  const adapter = createPiperTtsAdapter({
    modelPath: "/voices/v.onnx",
    binary: "/usr/bin/piper",
    keepWarm: true,
    runtimeDir: dir,
    spawn,
    fileExists: () => true,
  });

  adapter.warmup();
  assert.equal(calls.length, 1, "warmup spawns the persistent process");
  assert.ok(calls[0].args.includes("--output-dir"));

  const first = await adapter.synthesize("Sentence one.");
  const second = await adapter.synthesize("Sentence two.");
  assert.equal(first.format, "wav");
  assert.equal(String(first.audio), "RIFFwarm");
  assert.equal(second.format, "wav");
  assert.equal(calls.length, 1, "warm synthesis never re-spawns");
  assert.deepEqual(readdirSync(dir), [], "WAV files are unlinked immediately after reading");

  adapter.dispose();
  assert.equal(getChild().exitCode, 137, "dispose kills the warm process");
  assert.equal(existsSync(dir), false, "dispose removes the runtime dir");
});

test("a dead warm process degrades to the exec path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-piper-warm-"));
  const { spawn, calls } = fakeWarmPiperSpawn({ dieOnSpawn: true });
  const adapter = createPiperTtsAdapter({
    modelPath: "/voices/v.onnx",
    binary: "/usr/bin/piper",
    keepWarm: true,
    runtimeDir: dir,
    spawn,
    readFile: () => VOICE_JSON,
    fileExists: () => true,
  });

  const result = await adapter.synthesize("hello");
  assert.equal(result.format, "raw-s16le", "falls back to exec output");
  assert.ok(calls.some((c) => c.args.includes("--output-raw")), "exec path was used");
  adapter.dispose();
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
