import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const PI_RPC_JSONL_LINE_MAX_BYTES = 32 * 1024 * 1024;

function nextPort() {
  return 32000 + Math.floor(Math.random() * 20000);
}

async function request(port, pathname, { method = "GET", body, timeoutMs = 10_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return { status: response.status, body: payload };
}

async function waitForHealth(port, child, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const health = await request(port, "/api/health", { timeoutMs: 1_000 });
      if (health.status === 200) return health;
    } catch {
      // The server is still starting.
    }
    await delay(50);
  }
  assert.fail(`server did not become healthy:\n${output()}`);
}

async function waitForSseEvent(port, tabId, predicate, trigger) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timed out waiting for SSE event")), 30_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/events?tab=${encodeURIComponent(tabId)}`, { signal: controller.signal });
    assert.equal(response.status, 200, "SSE connection should open");
    const triggerPromise = Promise.resolve().then(trigger);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        if (predicate(event)) return { event, triggerResult: await triggerPromise };
      }
    }
    throw new Error("SSE stream ended before the expected event");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function stopServerProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
}

async function startServer({ oversizedLineBytes = 0 } = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-transport-hardening-"));
  const port = nextPort();
  let child;
  try {
    await chmod(fakePi, 0o755);
    let output = "";
    child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: path.join(cwd, "agent"),
        ...(oversizedLineBytes ? { FAKE_PI_OVERSIZED_JSONL_BYTES: String(oversizedLineBytes) } : {}),
      },
    });
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    await waitForHealth(port, child, () => output);
    const tabs = await request(port, "/api/tabs");
    const tabId = tabs.body?.data?.tabs?.[0]?.id;
    assert.ok(tabId, "server should create an initial RPC tab");
    return { child, cwd, output: () => output, port, tabId };
  } catch (error) {
    await stopServerProcess(child);
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

async function stopServer(server) {
  await stopServerProcess(server.child);
  await rm(server.cwd, { recursive: true, force: true });
}

let server;
try {
  server = await startServer();
  // Closing the parent-side reader reproduces a server stderr sink that can no
  // longer accept Pi diagnostics. The server must keep serving its browser API.
  server.child.stderr.destroy();
  await delay(25);
  const stderrResult = await waitForSseEvent(
    server.port,
    server.tabId,
    (event) => event.type === "pi_stderr_sink_error",
    () => request(server.port, "/api/prompt", { method: "POST", body: { tab: server.tabId, message: "fixture stderr diagnostic" } }),
  );
  assert.equal(stderrResult.triggerResult.status, 200, "Pi stderr diagnostics should not fail the prompt request when server stderr is closed");
  assert.match(stderrResult.event.error || "", /stderr could not be mirrored/i, "browser clients should receive the stderr sink diagnostic");
  await delay(50);
  assert.equal(server.child.exitCode, null, "closed server stderr must not terminate the WebUI process");
  assert.equal((await request(server.port, "/api/health")).status, 200, "WebUI should remain healthy after the closed-stderr diagnostic");
  await stopServer(server);
  server = null;

  server = await startServer({ oversizedLineBytes: PI_RPC_JSONL_LINE_MAX_BYTES + 1024 });
  const oversizedResult = await waitForSseEvent(
    server.port,
    server.tabId,
    (event) => event.type === "pi_stdout_line_too_large",
    () => request(server.port, "/api/prompt", { method: "POST", timeoutMs: 30_000, body: { tab: server.tabId, message: "fixture oversized jsonl" } }),
  );
  assert.equal(oversizedResult.event.maxBytes, PI_RPC_JSONL_LINE_MAX_BYTES, "the discard diagnostic should expose the explicit physical-line limit");
  assert.equal(oversizedResult.triggerResult.status, 200, "the valid RPC response after an oversized unterminated line should still be parsed");
  assert.equal(oversizedResult.triggerResult.body?.data?.output, "fake oversized JSONL line discarded");
  assert.equal((await request(server.port, `/api/state?tab=${encodeURIComponent(server.tabId)}`)).status, 200, "the server should continue parsing later RPC traffic after discarding the oversized line");
} finally {
  if (server) await stopServer(server);
}

console.log("transport hardening harness passed");
