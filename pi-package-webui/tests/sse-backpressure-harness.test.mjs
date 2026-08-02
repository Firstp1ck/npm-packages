import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const port = await freePort();
const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-sse-backpressure-"));
const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PI_WEBUI_RPC_SUPERVISOR: "0",
    PI_CODING_AGENT_DIR: join(cwd, "agent"),
    PI_WEBUI_SETTINGS_FILE: join(cwd, "settings.json"),
    FAKE_PI_SSE_FLOOD: "1",
  },
});
let output = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });

async function json(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: await response.json() };
}

try {
  let health;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      health = await json("/api/health");
      if (health.status === 200) break;
    } catch {
      // Wait for the real server and fake Pi child.
    }
    await delay(100);
  }
  assert.equal(health?.status, 200, `server should start for backpressure test:\n${output}`);
  const tabs = await json("/api/tabs");
  const tabId = tabs.body?.data?.tabs?.[0]?.id;
  assert.ok(tabId, "fixture server should expose an initial tab");

  // Undici continues draining the transport even when application code has not
  // consumed response.body. A >2MiB burst must therefore survive transient
  // ServerResponse backpressure instead of being mistaken for a dead client.
  const flowing = await fetch(`http://127.0.0.1:${port}/api/events?tab=${encodeURIComponent(tabId)}`, { signal: AbortSignal.timeout(15_000) });
  assert.equal(flowing.status, 200);
  const flowingFlood = await json("/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture sse flood" } });
  assert.equal(flowingFlood.status, 200, "flood fixture should dispatch through the real server");
  await delay(500);
  const flowingTabs = await json("/api/tabs");
  assert.equal(flowingTabs.body?.data?.tabs?.find((tab) => tab.id === tabId)?.clientCount, 1, "a transport-draining SSE client must survive transient backpressure");
  await flowing.body?.cancel();

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const refreshed = await json("/api/tabs");
    if (refreshed.body?.data?.tabs?.find((tab) => tab.id === tabId)?.clientCount === 0) break;
    await delay(50);
  }

  // A paused raw socket does not drain the HTTP transport. It must be evicted
  // within the bounded queue/timeout policy, but with a complete final chunk so
  // Chromium does not surface ERR_INCOMPLETE_CHUNKED_ENCODING on reconnection.
  const stalled = connect({ host: "127.0.0.1", port });
  let stalledResponse = "";
  stalled.on("data", (chunk) => { stalledResponse += String(chunk); });
  stalled.pause();
  await new Promise((resolve, reject) => {
    stalled.once("connect", resolve);
    stalled.once("error", reject);
  });
  stalled.write(`GET /api/events?tab=${encodeURIComponent(tabId)} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n\r\n`);

  let connected = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const refreshed = await json("/api/tabs");
    if (refreshed.body?.data?.tabs?.find((tab) => tab.id === tabId)?.clientCount === 1) {
      connected = true;
      break;
    }
    await delay(50);
  }
  assert.equal(connected, true, "the paused raw SSE client should connect before the flood");
  const stalledFlood = await json("/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture sse stall flood" } });
  assert.equal(stalledFlood.status, 200, "stalled-client flood should dispatch through the real server");

  let evicted = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const refreshed = await json("/api/tabs");
    const clientCount = refreshed.body?.data?.tabs?.find((tab) => tab.id === tabId)?.clientCount;
    if (clientCount === 0) {
      evicted = true;
      break;
    }
    await delay(50);
  }
  assert.equal(evicted, true, "a transport-stalled SSE client must be evicted instead of accumulating an unbounded semantic-event queue");
  stalled.resume();
  for (let attempt = 0; attempt < 100 && !stalledResponse.includes("\r\n0\r\n\r\n"); attempt += 1) await delay(50);
  assert.match(stalledResponse, /\r\n0\r\n\r\n/, "backpressure eviction must complete the chunked SSE response without truncating it");
  stalled.destroy();

  const reconnected = await fetch(`http://127.0.0.1:${port}/api/events?tab=${encodeURIComponent(tabId)}`, { signal: AbortSignal.timeout(5_000) });
  const firstFrame = await reconnected.body.getReader().read();
  assert.equal(firstFrame.done, false, "a client can reconnect after slow-client eviction");
  assert.match(new TextDecoder().decode(firstFrame.value), /webui_connected/, "reconnection should receive an authoritative connection snapshot");
  await reconnected.body?.cancel().catch(() => {});
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(cwd, { recursive: true, force: true });
}

console.log("sse-backpressure-harness.test.mjs passed");
