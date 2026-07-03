import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createLocalSttAdapter } from "../lib/providers/stt-local-endpoint.mjs";
import { createLocalTtsAdapter } from "../lib/providers/tts-local-endpoint.mjs";
import { buildEspeakArgs } from "../lib/providers/tts-espeak.mjs";
import { createHostedSttAdapter } from "../lib/providers/stt-hosted.mjs";
import { createSttAdapter, createTtsChain } from "../lib/providers/select.mjs";
import { encodeWav } from "../lib/native-audio/wav.mjs";

async function startServer(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

const WAV = encodeWav(Buffer.alloc(3200, 0), { sampleRateHz: 16000 });

test("local STT adapter sends Phase-4 multipart shape and parses JSON transcripts", async () => {
  const server = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ text: "hello there" }));
  });
  try {
    const adapter = createLocalSttAdapter({ url: `${server.url}/inference`, language: "en" });
    const result = await adapter.transcribe(WAV);
    assert.equal(result.text, "hello there");

    const request = server.requests[0];
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/inference");
    assert.match(request.headers["content-type"], /multipart\/form-data/);
    const body = request.body.toString("latin1");
    assert.match(body, /name="file"/);
    assert.match(body, /filename="speech\.wav"/);
    assert.match(body, /name="language"/);
    assert.match(body, /Content-Type: audio\/wav/i);
  } finally {
    await server.close();
  }
});

test("local STT adapter tolerates alternate transcript fields and plain text", async () => {
  const jsonServer = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ result: { text: "nested" } }));
  });
  const textServer = await startServer((req, res) => {
    res.setHeader("content-type", "text/plain");
    res.end("  plain transcript \n");
  });
  try {
    assert.equal((await createLocalSttAdapter({ url: jsonServer.url }).transcribe(WAV)).text, "nested");
    assert.equal((await createLocalSttAdapter({ url: textServer.url }).transcribe(WAV)).text, "plain transcript");
  } finally {
    await jsonServer.close();
    await textServer.close();
  }
});

test("STT errors are mapped: timeout, HTTP error, unreachable", async () => {
  const slowServer = await startServer(() => {
    // never respond
  });
  const errorServer = await startServer((req, res) => {
    res.statusCode = 503;
    res.end("busy");
  });
  try {
    await assert.rejects(
      createLocalSttAdapter({ url: slowServer.url, timeoutMs: 100 }).transcribe(WAV),
      (error) => error.code === "provider-timeout",
    );
    await assert.rejects(
      createLocalSttAdapter({ url: errorServer.url }).transcribe(WAV),
      (error) => error.code === "provider-http-error" && /503/.test(error.message),
    );
    await assert.rejects(
      createLocalSttAdapter({ url: "http://127.0.0.1:1/nope", timeoutMs: 500 }).transcribe(WAV),
      (error) => error.code === "provider-unreachable",
    );
  } finally {
    await slowServer.close();
    await errorServer.close();
  }
});

test("local TTS adapter sends JSON shape and accepts binary or audioBase64 responses", async () => {
  const binaryServer = await startServer((req, res) => {
    res.setHeader("content-type", "audio/wav");
    res.end(WAV);
  });
  const jsonServer = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ audioBase64: WAV.toString("base64"), format: "wav" }));
  });
  try {
    const adapter = createLocalTtsAdapter({ url: binaryServer.url, voice: "amy" });
    const binary = await adapter.synthesize("hello");
    assert.equal(binary.format, "wav");
    assert.deepEqual(binary.audio, WAV);

    const sent = JSON.parse(binaryServer.requests[0].body.toString());
    assert.deepEqual(sent, { text: "hello", voice: "amy", format: "wav" });

    const json = await createLocalTtsAdapter({ url: jsonServer.url }).synthesize("hi");
    assert.deepEqual(json.audio, WAV);
    assert.equal(json.format, "wav");
  } finally {
    await binaryServer.close();
    await jsonServer.close();
  }
});

test("espeak-ng argv construction", () => {
  assert.deepEqual(buildEspeakArgs("Hello world", { voice: "en-GB", rate: 1.2 }), [
    "--stdout", "-s", "204", "-v", "en-GB", "--", "Hello world",
  ]);
  assert.deepEqual(buildEspeakArgs("Hi"), ["--stdout", "-s", "170", "--", "Hi"]);
});

test("hosted STT adapter sends bearer auth and model, and requires the API key", async () => {
  const server = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ text: "hosted result" }));
  });
  try {
    const adapter = createHostedSttAdapter({
      provider: "groq",
      env: { GROQ_API_KEY: "gsk-test" },
      baseUrl: `${server.url}/openai/v1/audio/transcriptions`,
    });
    const result = await adapter.transcribe(WAV);
    assert.equal(result.text, "hosted result");
    const request = server.requests[0];
    assert.equal(request.headers.authorization, "Bearer gsk-test");
    const body = request.body.toString("latin1");
    assert.match(body, /name="model"/);
    assert.match(body, /whisper-large-v3-turbo/);

    assert.throws(() => createHostedSttAdapter({ provider: "openai", env: {} }), (error) => error.code === "stt-key-missing");
  } finally {
    await server.close();
  }
});

test("adapter factory refuses hosted providers without consent — no silent fallback", () => {
  const native = {
    allowRemoteProviders: false,
    stt: { provider: "groq", url: null, language: "auto", timeoutMs: 30000 },
    tts: { provider: "openai", url: null, voice: null, rate: 1, timeoutMs: 20000, fallback: "espeak-ng" },
  };
  const consent = { hostedSttAcceptedAt: null, hostedTtsAcceptedAt: null };

  assert.throws(() => createSttAdapter({ native, consent }, { env: { GROQ_API_KEY: "x" } }), (error) => error.code === "consent-required");
  assert.throws(() => createTtsChain({ native, consent }, { env: { OPENAI_API_KEY: "x" } }), (error) => error.code === "consent-required");

  // With consent recorded and remote allowed, construction succeeds.
  const allowed = { ...native, allowRemoteProviders: true };
  const fullConsent = { hostedSttAcceptedAt: "2026-07-02T00:00:00Z", hostedTtsAcceptedAt: "2026-07-02T00:00:00Z" };
  const stt = createSttAdapter({ native: allowed, consent: fullConsent }, { env: { GROQ_API_KEY: "x" } });
  assert.equal(stt.id, "groq");
  const chain = createTtsChain({ native: allowed, consent: fullConsent }, { env: { OPENAI_API_KEY: "x" } });
  assert.equal(chain[0].id, "openai");
  assert.equal(chain[1].id, "espeak-ng");
});

test("TTS chain uses espeak-ng fallback after a local endpoint", () => {
  const native = {
    allowRemoteProviders: false,
    stt: { provider: "local-endpoint", url: "http://127.0.0.1:8178/inference", language: "auto", timeoutMs: 30000 },
    tts: { provider: "local-endpoint", url: "http://127.0.0.1:8179/speech", voice: null, rate: 1, timeoutMs: 20000, fallback: "espeak-ng" },
  };
  const chain = createTtsChain({ native, consent: {} }, {});
  assert.deepEqual(chain.map((a) => a.id), ["local-endpoint", "espeak-ng"]);
});
