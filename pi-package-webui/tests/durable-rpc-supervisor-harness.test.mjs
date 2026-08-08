import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { connectRpcSupervisor } from "../lib/rpc-supervisor-client.mjs";
import { readSupervisorState, supervisorPaths } from "../lib/rpc-supervisor-state.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(root, "bin", "pi-webui.mjs");
const fakePi = path.join(root, "tests", "fixtures", "fake-pi.mjs");
const port = 39000 + Math.floor(Math.random() * 15000);
const streamPrompt = "fixture continuity delayed stream";

async function request(pathname, { method = "GET", body, timeoutMs = 3_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload;
  try { payload = await response.json(); } catch { payload = undefined; }
  return { status: response.status, body: payload };
}

async function waitFor(label, predicate, { timeoutMs = 12_000, intervalMs = 80 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`${label} did not happen in time${lastError ? `: ${lastError.message}` : ""}`);
}

async function initialSseEvents(tabId, expectedCount = 3) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timed out reading continuity SSE state")), 5_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/events?tab=${encodeURIComponent(tabId)}`, { signal: controller.signal });
    assert.equal(response.status, 200, "replacement server SSE endpoint must open");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = "";
    while (events.length < expectedCount) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (data) events.push(JSON.parse(data));
      }
    }
    return events;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function spawnServer({ cwd, env, output }) {
  const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  return child;
}

async function health() {
  const response = await request("/api/health", { timeoutMs: 1_000 });
  if (response.status !== 200 || response.body?.ok !== true) return null;
  return response.body;
}

async function tabs() {
  const response = await request("/api/tabs");
  assert.equal(response.status, 200, "tabs endpoint should be available");
  return response.body?.data?.tabs || [];
}

async function readLog(logFile) {
  const text = await readFile(logFile, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const work = await mkdtemp(path.join(tmpdir(), "pi-webui-continuity-harness-"));
const agentDir = path.join(work, "agent");
const cwd = path.join(work, "cwd");
const changedCwd = path.join(work, "changed-cwd");
const settingsFile = path.join(work, "settings.json");
const sessionFile = path.join(work, "fixture-session.jsonl");
const logFile = path.join(work, "fake-pi.jsonl");
const output = [];
const environment = {
  ...process.env,
  PI_CODING_AGENT_DIR: agentDir,
  PI_WEBUI_SETTINGS_FILE: settingsFile,
  PI_WEBUI_RPC_SUPERVISOR: "1",
  FAKE_PI_CONTINUITY_MODE: "1",
  FAKE_PI_CONTINUITY_SESSION_FILE: sessionFile,
  FAKE_PI_LOG_FILE: logFile,
};
const paths = await supervisorPaths({ agentDir, port });
let initialServer;
let manualServer;
let observedPiPid;
let observedTabId;

try {
  await writeFile(settingsFile, "{}\n");
  await mkdir(cwd, { recursive: true });
  await mkdir(changedCwd, { recursive: true });
  initialServer = spawnServer({ cwd, env: environment, output });

  const initialHealth = await waitFor("initial supervised server health", health);
  assert.equal(initialHealth.rpcSupervisor?.enabled, true, "harness must opt into the supervisor");
  assert.equal(initialHealth.rpcSupervisor?.attached, true, "server must attach to the supervisor");
  const initialWebuiPid = initialHealth.webuiPid;
  const initialTabs = await tabs();
  assert.equal(initialTabs.length, 1, "isolated server startup should create one tab");
  const initialTab = initialTabs[0];
  observedTabId = initialTab.id;
  observedPiPid = initialTab.pid;
  assert.ok(Number.isInteger(observedPiPid) && observedPiPid > 0, "initial tab must expose its fake Pi PID");
  assert.equal(initialTab.cwd, cwd, "tab metadata must retain the isolated cwd");
  assert.equal(initialTab.sessionFile, sessionFile, "fixture session metadata must be captured before restart");

  const concurrentCwdChanges = await Promise.all([
    request(`/api/tabs/${encodeURIComponent(observedTabId)}`, { method: "PATCH", body: { cwd: changedCwd }, timeoutMs: 12_000 }),
    request(`/api/tabs/${encodeURIComponent(observedTabId)}`, { method: "PATCH", body: { cwd: changedCwd }, timeoutMs: 12_000 }),
  ]);
  assert.deepEqual(concurrentCwdChanges.map((response) => response.status).sort(), [200, 409], "overlapping existing-tab cwd changes should allow one restart and reject the duplicate deterministically");
  const cwdChange = concurrentCwdChanges.find((response) => response.status === 200);
  const rejectedCwdChange = concurrentCwdChanges.find((response) => response.status === 409);
  assert.match(String(rejectedCwdChange.body?.error || ""), /already changing its working folder/i, "rejected overlapping cwd change should explain the active restart");
  assert.equal(cwdChange.body?.data?.changed, true, "existing-tab cwd change should report a real restart");
  assert.equal(cwdChange.body?.data?.tab?.cwd, changedCwd, "cwd change response should expose the replacement cwd");
  assert.notEqual(cwdChange.body?.data?.tab?.pid, observedPiPid, "cwd change should replace the managed Pi child");
  observedPiPid = cwdChange.body.data.tab.pid;
  const cwdChangeState = await request(`/api/state?tab=${encodeURIComponent(observedTabId)}`);
  assert.equal(cwdChangeState.status, 200, "replacement child should answer state requests before cwd PATCH resolves");
  const cwdChangeCommands = await request(`/api/commands?tab=${encodeURIComponent(observedTabId)}`);
  assert.equal(cwdChangeCommands.status, 200, "replacement child should answer command discovery after cwd change");
  const replacementStartup = await waitFor("replacement cwd startup", async () => (
    (await readLog(logFile)).find((entry) => entry.direction === "startup" && entry.pid === observedPiPid && entry.cwd === changedCwd)
  ));
  assert.equal(replacementStartup.cwd, changedCwd, "replacement child process should actually run in the requested cwd");

  const controlledPrompt = await request("/api/prompt", { method: "POST", body: { tab: observedTabId, message: streamPrompt } });
  assert.equal(controlledPrompt.status, 200, "controlled-restart prompt must be accepted once");
  const preRestartTab = (await tabs())[0];
  const restart = await request("/api/restart", { method: "POST" });
  assert.equal(restart.status, 200, "controlled restart must be accepted");
  assert.equal(restart.body?.webuiPid, initialWebuiPid, "restart response must identify the retiring HTTP server");

  const restartedHealth = await waitFor("controlled-restart replacement health", async () => {
    const value = await health();
    return value && value.webuiPid !== initialWebuiPid ? value : null;
  }, { timeoutMs: 15_000 });
  const controlledTabs = await tabs();
  assert.equal(controlledTabs.length, 1, "controlled restart must hydrate instead of spawning duplicate tabs");
  assert.deepEqual(
    controlledTabs.map((tab) => ({ id: tab.id, pid: tab.pid, cwd: tab.cwd, sessionFile: tab.sessionFile, title: tab.title, index: tab.index })),
    [{ id: preRestartTab.id, pid: observedPiPid, cwd: changedCwd, sessionFile, title: preRestartTab.title, index: preRestartTab.index }],
    "controlled restart must retain the same managed tab metadata and Pi PID",
  );
  assert.equal(restartedHealth.piPid, observedPiPid, "controlled restart must retain the active Pi process");
  await waitFor("controlled stream completion", async () => {
    const state = await request(`/api/state?tab=${encodeURIComponent(observedTabId)}`);
    return state.body?.data?.isStreaming === false;
  });

  const abruptPrompt = await request("/api/prompt", { method: "POST", body: { tab: observedTabId, message: streamPrompt } });
  assert.equal(abruptPrompt.status, 200, "abrupt-loss prompt must be accepted once");
  const abruptWebuiPid = restartedHealth.webuiPid;
  process.kill(abruptWebuiPid, "SIGKILL");
  await waitFor("abrupt HTTP server exit", () => !pidIsAlive(abruptWebuiPid));
  await delay(1_500);

  const state = await readSupervisorState(paths);
  assert.ok(state, "supervisor state must remain available after HTTP SIGKILL");

  manualServer = spawnServer({ cwd, env: environment, output });
  const manualHealth = await waitFor("manual same-port replacement health", health, { timeoutMs: 15_000 });
  assert.notEqual(manualHealth.webuiPid, abruptWebuiPid, "manual relaunch must use a new HTTP server process");
  assert.equal(manualHealth.piPid, observedPiPid, "manual same-port relaunch must attach to the original Pi process");
  const manualTabs = await tabs();
  assert.equal(manualTabs.length, 1, "manual relaunch must not duplicate the supervised tab");
  assert.deepEqual(
    manualTabs.map((tab) => ({ id: tab.id, pid: tab.pid, cwd: tab.cwd, sessionFile: tab.sessionFile, title: tab.title, index: tab.index })),
    [{ id: preRestartTab.id, pid: observedPiPid, cwd: changedCwd, sessionFile, title: preRestartTab.title, index: preRestartTab.index }],
    "manual relaunch must retain tab ID, PID, and persisted metadata",
  );

  const reconnectEvents = await initialSseEvents(observedTabId);
  const connectedEvent = reconnectEvents.find((event) => event.type === "webui_connected");
  const replayGapEvent = reconnectEvents.find((event) => event.type === "webui_supervisor_replay_gap");
  assert.equal(connectedEvent?.supervisorReplayGap, true, "actual replacement server must report a truthful cursor-less replay gap");
  assert.equal(Object.hasOwn(connectedEvent || {}, "supervisorGap"), false, "replacement server must use the browser's canonical replay-gap field");
  assert.equal(replayGapEvent?.supervisorReplayGap, true, "replacement SSE must explicitly warn that authoritative replay recovery ran");

  const recoveredState = await request(`/api/state?tab=${encodeURIComponent(observedTabId)}`);
  assert.equal(recoveredState.status, 200, "replacement server must query authoritative Pi state");
  assert.equal(recoveredState.body?.data?.isStreaming, false, "replacement server must observe the completed downtime turn");
  const recoveredMessages = await request(`/api/messages?tab=${encodeURIComponent(observedTabId)}`);
  assert.equal(recoveredMessages.status, 200, "replacement server must expose the authoritative transcript");
  const recoveredTranscript = recoveredMessages.body?.data?.messages || [];
  assert.equal(recoveredTranscript.filter((message) => message?.role === "user" && message.content === streamPrompt).length, 2, "both accepted continuity prompts must appear once in the transcript");
  assert.equal(recoveredTranscript.filter((message) => message?.role === "assistant" && message.content?.[0]?.text === "continuity stream complete").length, 2, "the completed controlled and downtime outputs must each appear once authoritatively");
  const replacementStatus = await request("/api/webui-status?detailed=true&events=200");
  const replayedEventTypes = (replacementStatus.body?.data?.events || []).map((event) => event.type);
  const lastAgentStart = replayedEventTypes.lastIndexOf("agent_start");
  const followingAgentEnd = replayedEventTypes.indexOf("agent_end", lastAgentStart);
  assert.deepEqual(replayedEventTypes.slice(lastAgentStart, followingAgentEnd + 1), ["agent_start", "message_start", "message_update", "message_end", "agent_end"], "replacement server must apply the ordered downtime event stream before authoritative refresh events");

  const commandEntries = (await readLog(logFile)).filter((entry) => entry.direction === "command" && entry.message === streamPrompt);
  assert.equal(commandEntries.length, 2, "each accepted continuity prompt must reach fake Pi exactly once despite server loss");
  assert.equal(new Set(commandEntries.map((entry) => entry.type)).size, 1, "continuity prompt command records must remain identifiable");
  assert.equal(commandEntries[0].type, "prompt");

  const stopped = await request("/api/shutdown", { method: "POST" });
  assert.equal(stopped.status, 200, "explicit shutdown must be accepted");
  await waitFor("explicit HTTP shutdown", () => !pidIsAlive(manualHealth.webuiPid));
  await waitFor("explicit Pi cleanup", () => !pidIsAlive(observedPiPid), { timeoutMs: 8_000 });
  await waitFor("supervisor state cleanup", async () => {
    const remainingState = await readSupervisorState(paths);
    if (!remainingState) return true;
    if (!pidIsAlive(remainingState.pid)) throw new Error(`dead supervisor ${remainingState.pid} left stale state`);
    return false;
  }, { timeoutMs: 12_000 });
  const exitEntries = (await readLog(logFile)).filter((entry) => entry.direction === "exit" && entry.pid === observedPiPid);
  if (process.platform !== "win32") {
    assert.ok(exitEntries.some((entry) => entry.signal === "SIGTERM"), "explicit shutdown must produce the fake-Pi termination marker");
  }
  console.log(`durable-rpc-supervisor-harness.test.mjs passed (Pi PID ${observedPiPid}; tab ${observedTabId})`);
} finally {
  const liveServer = manualServer?.exitCode === null ? manualServer : initialServer?.exitCode === null ? initialServer : null;
  if (liveServer) {
    try { await request("/api/shutdown", { method: "POST", timeoutMs: 1_000 }); } catch {
      try { liveServer.kill("SIGKILL"); } catch {}
    }
  }
  const remaining = await readSupervisorState(paths).catch(() => null);
  if (remaining) {
    const cleanupClient = await connectRpcSupervisor({ agentDir, port, controllerId: "durable-harness-cleanup", connectTimeoutMs: 1_000 }).catch(() => null);
    if (cleanupClient) {
      try { await cleanupClient.shutdown(); } catch {}
      cleanupClient.close();
    }
  }
  await delay(150);
  await rm(work, { recursive: true, force: true });
}
