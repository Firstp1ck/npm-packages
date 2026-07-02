import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWav, parseWav } from "../lib/native-audio/wav.mjs";

const companionPath = fileURLToPath(new URL("../lib/native-audio-companion.mjs", import.meta.url));
const fakeCapturePath = fileURLToPath(new URL("./fixtures/fake-capture.mjs", import.meta.url));
const fakePlaybackPath = fileURLToPath(new URL("./fixtures/fake-playback.mjs", import.meta.url));

const TTS_WAV = encodeWav(Buffer.alloc(6400, 1), { sampleRateHz: 16000 });

async function startSttServer(text) {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ text }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}/inference`, close: () => new Promise((r) => server.close(r)) };
}

async function startTtsServer() {
  let requests = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests += 1;
      res.setHeader("content-type", "audio/wav");
      res.end(TTS_WAV);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}/speech`,
    requestCount: () => requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

function makeConfig({ dir, sttUrl, ttsUrl, silentCapture = false }) {
  return {
    native: {
      enabled: true,
      autoStartWithTalkOn: false,
      capture: {
        tool: "auto",
        command: [process.execPath, fakeCapturePath, join(dir, "capture.pid"), ...(silentCapture ? ["--silent"] : [])],
        device: null,
        sampleRateHz: 16000,
      },
      playback: { tool: "auto", command: [process.execPath, fakePlaybackPath, join(dir, "playback.bytes"), "{rate}"], device: null },
      vad: { startDb: 9, thresholdDb: null, hangoverMs: 800, minSpeechMs: 300, maxUtteranceMs: 30000, preRollMs: 300, engine: "energy" },
      stt: { provider: "local-endpoint", url: sttUrl, language: "auto", timeoutMs: 5000 },
      tts: { provider: "local-endpoint", url: ttsUrl, voice: null, rate: 1, timeoutMs: 5000, fallback: "none" },
      headphones: false,
      bargeIn: { enabled: false, selfEchoOverlap: 0.6 },
      silence: { enabled: true, timeoutMs: 8000 },
      allowRemoteProviders: false,
    },
    consent: { nativeAudioAcceptedAt: "2026-07-02T00:00:00Z", hostedSttAcceptedAt: null, hostedTtsAcceptedAt: null },
  };
}

function startCompanion({ dir }) {
  const child = spawn(process.execPath, [companionPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, XDG_RUNTIME_DIR: dir },
  });
  const messages = [];
  const waiters = [];
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  child.stderr.on("data", () => {});
  child.stdin.on("error", () => {});

  return {
    child,
    messages,
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    waitFor(predicate, { timeoutMs = 8000, label = "message" } = {}) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
            reject(new Error(`timed out waiting for ${label}; saw: ${messages.map((m) => m.type).join(",")}`));
          }
        }, timeoutMs).unref();
      });
    },
    waitForExit({ timeoutMs = 5000 } = {}) {
      if (child.exitCode !== null) return Promise.resolve(child.exitCode);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("companion did not exit")), timeoutMs);
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
    },
  };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(fn, { timeoutMs = 5000, intervalMs = 50, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("companion full loop: handshake, capture → VAD → STT transcript, speak lifecycle, graceful shutdown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-companion-"));
  const stt = await startSttServer("hello companion");
  const tts = await startTtsServer();
  const companion = startCompanion({ dir });

  try {
    companion.send({ type: "hello", protocolVersion: 1, config: makeConfig({ dir, sttUrl: stt.url, ttsUrl: tts.url }) });
    const ready = await companion.waitFor((m) => m.type === "ready", { label: "ready" });
    assert.equal(ready.protocolVersion, 1);
    assert.equal(ready.stt.provider, "local-endpoint");
    assert.equal(ready.tts.provider, "local-endpoint");
    assert.ok(existsSync(join(dir, "pi-voice", `${ready.pid}.pid`)), "companion pidfile must exist");

    companion.send({ type: "listen" });
    companion.send({ type: "gate", mode: "open" });

    await companion.waitFor((m) => m.type === "vad" && m.event === "speech_start", { label: "speech_start" });
    const transcript = await companion.waitFor((m) => m.type === "final-transcript", { label: "final-transcript" });
    assert.equal(transcript.text, "hello companion");
    assert.equal(transcript.capturedDuring, "listening");
    assert.ok(transcript.utteranceMs >= 300, `utteranceMs ${transcript.utteranceMs}`);
    assert.ok(transcript.sttMs >= 0);

    companion.send({ type: "speak", id: "s1", text: "Hello back." });
    await companion.waitFor((m) => m.type === "speak-started" && m.id === "s1", { label: "speak-started" });
    const ended = await companion.waitFor((m) => m.type === "speak-ended" && m.id === "s1", { label: "speak-ended" });
    assert.equal(ended.cancelled, false);

    await waitUntil(() => existsSync(join(dir, "playback.bytes")), { label: "playback bytes file" });
    const played = Number(readFileSync(join(dir, "playback.bytes"), "utf8").trim());
    assert.equal(played, parseWav(TTS_WAV).dataLength, "playback must receive the raw PCM payload");

    companion.send({ type: "shutdown" });
    await companion.waitFor((m) => m.type === "bye", { label: "bye" });
    const code = await companion.waitForExit();
    assert.equal(code, 0);
    assert.ok(!existsSync(join(dir, "pi-voice", `${ready.pid}.pid`)), "pidfile must be removed on shutdown");

    const capturePid = Number(readFileSync(join(dir, "capture.pid"), "utf8"));
    await waitUntil(() => !pidAlive(capturePid), { label: "capture process death" });
  } finally {
    if (companion.child.exitCode === null) companion.child.kill("SIGKILL");
    await stt.close();
    await tts.close();
  }
});

test("dead-man switch: losing stdin kills the capture child and exits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-companion-"));
  const stt = await startSttServer("unused");
  const tts = await startTtsServer();
  const companion = startCompanion({ dir });

  try {
    companion.send({ type: "hello", protocolVersion: 1, config: makeConfig({ dir, sttUrl: stt.url, ttsUrl: tts.url, silentCapture: true }) });
    await companion.waitFor((m) => m.type === "ready", { label: "ready" });
    companion.send({ type: "listen" });
    await waitUntil(() => existsSync(join(dir, "capture.pid")), { label: "capture pidfile" });
    const capturePid = Number(readFileSync(join(dir, "capture.pid"), "utf8"));
    assert.ok(pidAlive(capturePid), "capture fixture must be running");

    // Simulate the Pi process dying without any graceful shutdown.
    companion.child.stdin.destroy();

    await companion.waitForExit();
    await waitUntil(() => !pidAlive(capturePid), { label: "capture process death after stdin EOF" });
  } finally {
    if (companion.child.exitCode === null) companion.child.kill("SIGKILL");
    await stt.close();
    await tts.close();
  }
});

test("set-config live-swaps the TTS provider for subsequent speak requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-companion-"));
  const stt = await startSttServer("unused");
  const ttsA = await startTtsServer();
  const ttsB = await startTtsServer();
  const companion = startCompanion({ dir });

  try {
    companion.send({ type: "hello", protocolVersion: 1, config: makeConfig({ dir, sttUrl: stt.url, ttsUrl: ttsA.url, silentCapture: true }) });
    await companion.waitFor((m) => m.type === "ready", { label: "ready" });

    companion.send({ type: "speak", id: "s1", text: "first" });
    await companion.waitFor((m) => m.type === "speak-ended" && m.id === "s1", { label: "speak-ended s1" });
    assert.equal(ttsA.requestCount(), 1);

    companion.send({ type: "set-config", patch: { tts: { url: ttsB.url } } });
    companion.send({ type: "speak", id: "s2", text: "second" });
    await companion.waitFor((m) => m.type === "speak-ended" && m.id === "s2", { label: "speak-ended s2" });
    assert.equal(ttsA.requestCount(), 1, "old TTS endpoint must not be used after the swap");
    assert.equal(ttsB.requestCount(), 1, "new TTS endpoint must serve the next utterance");

    companion.send({ type: "shutdown" });
    await companion.waitForExit();
  } finally {
    if (companion.child.exitCode === null) companion.child.kill("SIGKILL");
    await stt.close();
    await ttsA.close();
    await ttsB.close();
  }
});

test("empty transcripts are dropped silently and the loop returns to listening", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-companion-"));
  const stt = await startSttServer("");
  const tts = await startTtsServer();
  const companion = startCompanion({ dir });

  try {
    companion.send({ type: "hello", protocolVersion: 1, config: makeConfig({ dir, sttUrl: stt.url, ttsUrl: tts.url }) });
    await companion.waitFor((m) => m.type === "ready", { label: "ready" });
    companion.send({ type: "listen" });
    companion.send({ type: "gate", mode: "open" });

    await companion.waitFor((m) => m.type === "vad" && m.event === "speech_end", { label: "speech_end" });
    await companion.waitFor((m) => m.type === "state" && m.state === "transcribing", { label: "transcribing state" });
    const marker = companion.messages.length;
    await waitUntil(
      () => companion.messages.slice(marker).some((m) => m.type === "state" && m.state === "listening"),
      { label: "listening state after empty transcript" },
    );
    assert.equal(companion.messages.some((m) => m.type === "final-transcript"), false, "no transcript may be dispatched for empty STT results");

    companion.send({ type: "shutdown" });
    await companion.waitForExit();
  } finally {
    if (companion.child.exitCode === null) companion.child.kill("SIGKILL");
    await stt.close();
    await tts.close();
  }
});
