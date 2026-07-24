import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");

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
      // Server startup is asynchronous.
    }
    await delay(50);
  }
  assert.fail(`server did not become healthy:\n${output()}`);
}

async function openSse(port, tabId, query = "") {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/events?tab=${encodeURIComponent(tabId)}${query}`, { signal: controller.signal });
  assert.equal(response.status, 200, "SSE connection should open");
  const client = { controller, events: [], waiters: new Set(), readerError: null };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buffer = "";
    try {
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
          client.events.push(event);
          for (const wake of client.waiters) wake();
          client.waiters.clear();
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) client.readerError = error;
      for (const wake of client.waiters) wake();
      client.waiters.clear();
    }
  })();
  return client;
}

async function waitForEvent(client, predicate, { from = 0, timeoutMs = 8_000 } = {}) {
  let index = from;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    while (index < client.events.length) {
      const event = client.events[index++];
      if (predicate(event)) return event;
    }
    if (client.readerError) throw client.readerError;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.waiters.delete(wake);
        reject(new Error("timed out waiting for SSE event"));
      }, Math.max(1, deadline - Date.now()));
      const wake = () => {
        clearTimeout(timer);
        client.waiters.delete(wake);
        resolve();
      };
      client.waiters.add(wake);
    });
  }
  throw new Error("timed out waiting for SSE event");
}

async function stopServer(server) {
  for (const client of server.clients) client.controller.abort();
  if (server.child?.exitCode === null && server.child?.signalCode === null) {
    const exited = new Promise((resolve) => server.child.once("exit", resolve));
    server.child.kill("SIGKILL");
    await exited;
  }
  await rm(server.cwd, { recursive: true, force: true });
}

const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-fast-mode-harness-"));
const settingsFile = path.join(cwd, "settings.json");
const port = nextPort();
let child;
const server = { child: null, cwd, clients: [] };
let output = "";
try {
  await writeFile(settingsFile, `${JSON.stringify({ outputModeDefault: "normal" })}\n`);
  await chmod(fakePi, 0o755);
  child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_CODING_AGENT_DIR: path.join(cwd, "agent"), PI_WEBUI_SETTINGS_FILE: settingsFile },
  });
  server.child = child;
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const health = await waitForHealth(port, child, () => output);
  assert.deepEqual(health.body.outputMode, { persistedDefault: "normal", effectiveDefault: "normal", source: "persisted", overridden: false });
  const tabId = (await request(port, "/api/tabs")).body?.data?.tabs?.[0]?.id;
  assert.ok(tabId, "server should create an RPC tab");

  const auto = await openSse(port, tabId, "&outputMode=auto&outputModeProtocol=1");
  const compact = await openSse(port, tabId, "&outputMode=compact-v1&outputModeProtocol=1");
  const legacy = await openSse(port, tabId, "&outputMode=auto");
  server.clients.push(auto, compact, legacy);
  assert.deepEqual((await waitForEvent(auto, (event) => event.type === "webui_connected")).outputMode, {
    protocolVersion: 1, requestedMode: "auto", activeMode: "normal", serverDefault: "normal", serverDefaultSource: "persisted",
  });
  assert.equal((await waitForEvent(compact, (event) => event.type === "webui_connected")).outputMode.activeMode, "compact-v1");
  assert.deepEqual((await waitForEvent(legacy, (event) => event.type === "webui_connected")).outputMode, {
    protocolVersion: 0, requestedMode: "normal", activeMode: "normal", serverDefault: "normal", serverDefaultSource: "persisted",
  });

  const autoStart = auto.events.length;
  const compactStart = compact.events.length;
  const prompt = await request(port, "/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture fast mode flow" } });
  assert.equal(prompt.status, 200, `fixture prompt should run: ${prompt.body?.error || ""}`);
  const normalDelta = await waitForEvent(auto, (event) => event.type === "message_update", { from: autoStart });
  const compactDelta = await waitForEvent(compact, (event) => event.type === "message_update", { from: compactStart });
  assert.ok(normalDelta.message && normalDelta.assistantMessageEvent.partial, "normal clients retain accumulated message snapshots");
  assert.equal(compactDelta.message, undefined, "compact clients omit duplicate accumulated message snapshots");
  assert.equal(compactDelta.assistantMessageEvent.partial, undefined, "compact clients omit duplicate partial snapshots");
  await waitForEvent(auto, (event) => event.type === "tool_execution_update", { from: autoStart });
  await waitForEvent(compact, (event) => event.type === "tool_execution_end", { from: compactStart });
  await waitForEvent(compact, (event) => event.type === "agent_end", { from: compactStart });
  assert.equal(compact.events.slice(compactStart).some((event) => event.type === "tool_execution_update"), false, "only compact intermediate tool updates are omitted");
  assert.ok(compact.events.slice(compactStart).some((event) => event.type === "pi_stderr"), "diagnostics must pass through compact routing");
  assert.ok(compact.events.slice(compactStart).some((event) => event.type === "extension_ui_request" && event.method === "confirm"), "extension dialogs must pass through compact routing");

  const switchToCompactAt = auto.events.length;
  const outputPut = await request(port, "/api/webui-output-mode", { method: "PUT", body: { outputModeDefault: "compact-v1" } });
  assert.equal(outputPut.status, 200);
  assert.deepEqual(outputPut.body.data, { persistedDefault: "compact-v1", effectiveDefault: "compact-v1", source: "persisted", overridden: false });
  assert.equal((await waitForEvent(auto, (event) => event.type === "webui_output_mode", { from: switchToCompactAt })).activeMode, "compact-v1", "idle auto clients should switch immediately");
  assert.equal(compact.events.slice(compactStart).some((event) => event.type === "webui_output_mode"), false, "explicit client choices never follow the server default");

  const switchToNormalAt = auto.events.length;
  await request(port, "/api/webui-output-mode", { method: "PUT", body: { outputModeDefault: "normal" } });
  await waitForEvent(auto, (event) => event.type === "webui_output_mode" && event.activeMode === "normal", { from: switchToNormalAt });
  const barrierStart = auto.events.length;
  assert.equal((await request(port, "/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture fast mode barrier" } })).status, 200);
  await waitForEvent(auto, (event) => event.type === "message_update", { from: barrierStart });
  assert.equal((await request(port, "/api/webui-output-mode", { method: "PUT", body: { outputModeDefault: "compact-v1" } })).status, 200);
  const messageEnd = await waitForEvent(auto, (event) => event.type === "message_end", { from: barrierStart });
  assert.ok(messageEnd.message, "the current semantic unit must retain its old normal representation");
  const control = await waitForEvent(auto, (event) => event.type === "webui_output_mode" && event.activeMode === "compact-v1", { from: barrierStart });
  assert.ok(auto.events.indexOf(messageEnd) < auto.events.indexOf(control), "control must follow the semantic barrier");
  const afterBarrier = auto.events.length;
  assert.equal((await request(port, "/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture fast mode flow" } })).status, 200);
  assert.equal((await waitForEvent(auto, (event) => event.type === "message_update", { from: afterBarrier })).message, undefined, "events after the control use compact representation");

  const historyStart = auto.events.length;
  assert.equal((await request(port, "/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture fast mode history" } })).status, 200);
  await waitForEvent(auto, (event) => event.type === "agent_end", { from: historyStart });
  const detailed = await request(port, "/api/webui-status?detailed=1&events=200");
  const summary = detailed.body?.data?.events?.findLast((event) => event.type === "message_update" && event.deltaCount === 512);
  assert.deepEqual({ deltaCount: summary?.deltaCount, deltaChars: summary?.deltaChars, deltaUtf8Bytes: summary?.deltaUtf8Bytes }, { deltaCount: 512, deltaChars: 2048, deltaUtf8Bytes: 2048 }, "debug history should coalesce all canonical deltas without retaining content");
  assert.equal(Object.hasOwn(summary || {}, "message"), false);
  assert.equal(Object.hasOwn(summary || {}, "partial"), false);

  const invalid = await request(port, "/api/webui-output-mode", { method: "PUT", body: { outputModeDefault: "fast" } });
  assert.equal(invalid.status, 400, "configuration API should reject invalid persisted mode values");
} finally {
  await stopServer(server);
}

console.log("fast-mode-sse-harness.test.mjs passed");
