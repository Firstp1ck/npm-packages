import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
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

  // Deliberately never consume this body. The fixture emits >2MiB of semantic
  // events, exercising Node's write-backpressure path rather than a synthetic
  // mocked response object.
  const stalled = await fetch(`http://127.0.0.1:${port}/api/events?tab=${encodeURIComponent(tabId)}`, { signal: AbortSignal.timeout(15_000) });
  assert.equal(stalled.status, 200);
  const flood = await json("/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture sse flood" } });
  assert.equal(flood.status, 200, "flood fixture should dispatch through the real server");

  let evicted = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const refreshed = await json("/api/tabs");
    const clientCount = refreshed.body?.data?.tabs?.find((tab) => tab.id === tabId)?.clientCount;
    if (clientCount === 0) {
      evicted = true;
      break;
    }
    await delay(100);
  }
  assert.equal(evicted, true, "the stalled SSE client must be evicted instead of accumulating an unbounded semantic-event queue");

  const reconnected = await fetch(`http://127.0.0.1:${port}/api/events?tab=${encodeURIComponent(tabId)}`, { signal: AbortSignal.timeout(5_000) });
  const firstFrame = await reconnected.body.getReader().read();
  assert.equal(firstFrame.done, false, "a client can reconnect after slow-client eviction");
  assert.match(new TextDecoder().decode(firstFrame.value), /webui_connected/, "reconnection should receive an authoritative connection snapshot");
  await stalled.body?.cancel().catch(() => {});
  await reconnected.body?.cancel().catch(() => {});
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(cwd, { recursive: true, force: true });
}

console.log("sse-backpressure-harness.test.mjs passed");
