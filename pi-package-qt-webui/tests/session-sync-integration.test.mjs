import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SESSION_MUTATION_REQUESTS, createBackend } from "../lib/backend/main.mjs";
import { sessionRevisionKey } from "../lib/backend/session-sync.mjs";
import { sessionDirectoryFor } from "../lib/backend/sessions-index.mjs";
import { createTabRegistry } from "../lib/backend/tabs.mjs";
import { fakePiEntry, startBackend } from "./helpers/backend-client.mjs";

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "qt-webui-live-sync-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function persistedEntries({ id = "live-session", answer = "original answer", extra = [] } = {}) {
  const timestamp = "2026-08-27T00:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id, timestamp, cwd: "/work/live" },
    { type: "message", id: "user-1", parentId: null, timestamp, message: { role: "user", content: "original question", timestamp: 1 } },
    { type: "message", id: "answer-1", parentId: "user-1", timestamp, message: { role: "assistant", content: [{ type: "text", text: answer }], provider: "fixture-provider", model: "fixture-model", timestamp: 2, stopReason: "stop", usage: {} } },
    ...extra,
  ];
  const parentId = entries.at(-1).id;
  const thinkingId = `thinking-${entries.length}`;
  const modelId = `model-${entries.length + 1}`;
  entries.push(
    { type: "thinking_level_change", id: thinkingId, parentId, timestamp, thinkingLevel: "high" },
    { type: "model_change", id: modelId, parentId: thinkingId, timestamp, provider: "fixture-provider", modelId: "fixture-model" },
  );
  return entries;
}

function jsonl(entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function persistedSnapshot({ revision = { exists: true, ino: 1, size: 1, mtimeMs: 1, ctimeMs: 1 }, messages = [], leafId = "leaf", name = "" } = {}) {
  return {
    revision,
    sessionId: "live-session",
    name,
    leafId,
    thinkingLevel: "high",
    model: { provider: "fixture-provider", modelId: "fixture-model" },
    messages,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(check, description) {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createRegistryHarness({ cwd, sessionPath, switchDeferreds = [] }) {
  const events = [];
  let emitSession = () => {};
  let switchCalls = 0;
  const runtime = {
    sessionId: "live-session",
    provider: "fixture-provider",
    modelId: "fixture-model",
    thinkingLevel: "high",
  };
  const sessionSnapshot = { active: false, ready: true, statusKind: "ready", statusText: "Ready", pendingDialogs: 0, pid: 1, runtime };
  const registry = createTabRegistry({
    emit: (type, payload) => events.push({ type, ...payload }),
    state: { saveTabs() {}, read: () => ({ value: { tabs: [], activeTab: -1 }, problems: [] }) },
    callerCwd: cwd,
    createSession: ({ emit }) => {
      emitSession = emit;
      return {
      child: null,
      start() { emit("pi.runtime", { sessionFile: sessionPath, sessionName: "" }); },
      snapshot: () => sessionSnapshot,
      pauseInput() {},
      resumeInput() {},
      stop: async () => {},
      restart: async () => ({}),
      newSession: async () => ({}),
      switchSession: async () => {
        const pending = switchDeferreds[switchCalls];
        switchCalls += 1;
        if (pending) await pending.promise;
        return { cancelled: false };
      },
      applyPersistedSnapshotMetadata(snapshot) {
        runtime.sessionId = snapshot.sessionId;
        runtime.provider = snapshot.model?.provider ?? "";
        runtime.modelId = snapshot.model?.modelId ?? "";
        runtime.thinkingLevel = snapshot.thinkingLevel;
      },
    };
    },
  });
  const tab = registry.open({ cwd });
  return { registry, tab, events, emitSession: (type, payload) => emitSession(type, payload), get switchCalls() { return switchCalls; } };
}

function createBackendHarness({
  root,
  cwd,
  sessionPath,
  loadSessionSnapshot,
  sessionSyncNow = () => Date.now(),
  setOpenSessionPaths = async (paths) => paths,
}) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  let monitorOptions;
  const monitoredCalls = [];
  const acknowledgments = [];
  let active = false;
  const runtime = {
    sessionId: "live-session",
    provider: "fixture-provider",
    modelId: "fixture-model",
    thinkingLevel: "high",
  };
  const monitor = {
    start: async () => true,
    stop: async () => {},
    setOpenSessionPaths: async (paths) => {
      monitoredCalls.push(paths);
      return setOpenSessionPaths(paths);
    },
    acknowledgeSessionRevision: (changedPath, revisionKey) => { acknowledgments.push({ path: changedPath, revisionKey }); return true; },
  };
  const backend = createBackend({
    input,
    output,
    env: {
      ...process.env,
      QT_WEBUI_PI_CLI_ENTRY: fakePiEntry,
      QT_WEBUI_CALLER_CWD: cwd,
      PI_CODING_AGENT_DIR: path.join(root, "agent"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    createSessionMonitor: (options) => { monitorOptions = options; return monitor; },
    loadSessionSnapshot,
    sessionSyncNow,
    createTabSession: ({ emit }) => ({
      child: null,
      start() { emit("pi.runtime", { sessionFile: sessionPath, sessionName: "" }); },
      snapshot: () => ({ active, ready: true, statusKind: active ? "running" : "ready", statusText: active ? "Running" : "Ready", pendingDialogs: 0, pid: 1, runtime }),
      pauseInput() {},
      resumeInput() {},
      stop: async () => {},
      restart: async () => ({}),
      newSession: async () => ({}),
      switchSession: async () => ({ cancelled: false }),
      applyPersistedSnapshotMetadata(snapshot) {
        runtime.sessionId = snapshot.sessionId;
        runtime.provider = snapshot.model?.provider ?? "";
        runtime.modelId = snapshot.model?.modelId ?? "";
        runtime.thinkingLevel = snapshot.thinkingLevel;
      },
    }),
  });
  const tab = backend.registry.open({ cwd });
  return {
    backend,
    tab,
    monitor,
    get monitorOptions() { return monitorOptions; },
    monitoredCalls,
    acknowledgments,
    setActive(value) { active = value; },
  };
}

async function writeSession(agentDir, cwd, name, entries) {
  const directory = sessionDirectoryFor(cwd, { PI_CODING_AGENT_DIR: agentDir });
  await mkdir(directory, { recursive: true });
  const sessionPath = path.join(directory, name);
  await writeFile(sessionPath, jsonl(entries));
  return { directory, sessionPath };
}

async function readyBackendWithSession(t, { cancelSwitchAt = "" } = {}) {
  const root = await temporary(t);
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "workspace");
  await mkdir(cwd);
  const written = await writeSession(agentDir, cwd, "live.jsonl", persistedEntries());
  const backend = await startBackend({
    cwd,
    startupTimeoutMs: 1_000,
    env: {
      PI_CODING_AGENT_DIR: agentDir,
      ...(cancelSwitchAt ? { QT_WEBUI_FIXTURE_CANCEL_SWITCH_AT: cancelSwitchAt } : {}),
    },
  });
  t.after(async () => {
    if (!backend.exit) {
      backend.closeStdin();
      await backend.exitPromise;
    }
  });
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  const switched = await backend.send("session_switch", { sessionPath: written.sessionPath });
  assert.equal(switched.ok, true);
  await backend.waitForEvent("pi.runtime", (event) => event.sessionFile === written.sessionPath);
  return { backend, ...written, agentDir, cwd, tabId: (await backend.send("tabs_list")).data.activeTab };
}

function externalExchange(answer) {
  const timestamp = "2026-08-27T00:00:01.000Z";
  return [
    { type: "message", id: "user-2", parentId: "answer-1", timestamp, message: { role: "user", content: "external question", timestamp: 3 } },
    { type: "message", id: "answer-2", parentId: "user-2", timestamp, message: { role: "assistant", content: [{ type: "text", text: answer }], provider: "fixture-provider", model: "fixture-model", timestamp: 4, stopReason: "stop", usage: {} } },
  ];
}

function revision(serial) {
  return { exists: true, ino: 1, size: serial, mtimeMs: serial, ctimeMs: serial };
}

function changeFor(sessionPath, serial) {
  const value = revision(serial);
  return { path: sessionPath, revision: value, revisionKey: sessionRevisionKey(value), reason: "test" };
}

test("consecutive Qt-owned appends ignore changing leaf identity and do not schedule a rebind", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const sessionPath = path.join(root, "session.jsonl");
  await mkdir(cwd);
  await writeFile(sessionPath, "{}\n");
  const harness = createRegistryHarness({ cwd, sessionPath });
  const first = { role: "user", content: "first local write", timestamp: 1 };
  const second = { role: "user", content: "second local write", timestamp: 2 };

  harness.emitSession("message.user", { messageId: "local-1", text: first.content, mode: "send", attachments: [] });
  assert.deepEqual(harness.registry.applyExternalSnapshot(sessionPath, persistedSnapshot({ messages: [first], leafId: "leaf-1" })), { applied: false, reason: "equal" });
  harness.emitSession("message.user", { messageId: "local-2", text: second.content, mode: "send", attachments: [] });
  assert.deepEqual(harness.registry.applyExternalSnapshot(sessionPath, persistedSnapshot({ messages: [first, second], leafId: "leaf-2" })), { applied: false, reason: "equal" });

  assert.equal(await harness.registry.prepareMutation(harness.tab.id), false, "the next prompt has no stale rebind to prepare");
  assert.equal(harness.switchCalls, 0);
  assert.equal(harness.events.filter((event) => event.type === "transcript.reset").length, 0);
});

test("same-tab stale preparation is shared and an older rebind cannot clear a newer generation", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const sessionPath = path.join(root, "session.jsonl");
  await mkdir(cwd);
  await writeFile(sessionPath, "{}\n");
  const firstSwitch = deferred();
  const secondSwitch = deferred();
  const harness = createRegistryHarness({ cwd, sessionPath, switchDeferreds: [firstSwitch, secondSwitch] });
  const oldMessage = { role: "user", content: "external generation one", timestamp: 1 };
  const newMessage = { role: "user", content: "external generation two", timestamp: 2 };
  harness.registry.applyExternalSnapshot(sessionPath, persistedSnapshot({ messages: [oldMessage], leafId: "external-1" }));

  const preparationOne = harness.registry.prepareMutation(harness.tab.id);
  const sharedPreparation = harness.registry.prepareMutation(harness.tab.id);
  assert.equal(preparationOne, sharedPreparation, "concurrent mutation guards share one same-session switch");
  assert.equal(harness.switchCalls, 1);
  harness.registry.applyExternalSnapshot(sessionPath, persistedSnapshot({ messages: [oldMessage, newMessage], leafId: "external-2" }));
  firstSwitch.resolve();
  await Promise.all([preparationOne, sharedPreparation]);

  const newerPreparation = harness.registry.prepareMutation(harness.tab.id);
  assert.equal(harness.switchCalls, 2, "the newer external generation remains fenced after the older switch completes");
  secondSwitch.resolve();
  assert.equal(await newerPreparation, true);
  assert.equal(await harness.registry.prepareMutation(harness.tab.id), false);
});

test("superseded snapshot loads are skipped before apply and only the newest burst revision is acknowledged", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await mkdir(cwd);
  const { sessionPath } = await writeSession(agentDir, cwd, "ordered.jsonl", persistedEntries());
  const firstLoad = deferred();
  let loadCalls = 0;
  const newest = { role: "user", content: "newest burst", timestamp: 2 };
  const harness = createBackendHarness({
    root,
    cwd,
    sessionPath,
    loadSessionSnapshot: async () => {
      loadCalls += 1;
      if (loadCalls === 1) return firstLoad.promise;
      return persistedSnapshot({ revision: revision(2), messages: [newest], leafId: "newest" });
    },
  });
  await waitUntil(() => harness.monitoredCalls.some((paths) => paths.includes(sessionPath)), "managed path registration");
  harness.monitorOptions.onSessionChange(changeFor(sessionPath, 1));
  await waitUntil(() => loadCalls === 1, "first snapshot load");
  harness.monitorOptions.onSessionChange(changeFor(sessionPath, 2));
  firstLoad.resolve(persistedSnapshot({ revision: revision(1), messages: [{ role: "user", content: "superseded", timestamp: 1 }], leafId: "old" }));

  await waitUntil(() => harness.tab.mirror.rows().some((row) => row.text === "newest burst"), "newest revision projection");
  assert.equal(harness.tab.mirror.rows().some((row) => row.text === "superseded"), false);
  assert.deepEqual(harness.acknowledgments.map((entry) => entry.revisionKey), [sessionRevisionKey(revision(2))]);
});

test("a tab that becomes busy during snapshot loading defers apply until a fresh idle reconciliation", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await mkdir(cwd);
  const { sessionPath } = await writeSession(agentDir, cwd, "busy-after-load.jsonl", persistedEntries());
  const firstLoad = deferred();
  let loadCalls = 0;
  const loaded = persistedSnapshot({ revision: revision(1), messages: [{ role: "user", content: "apply only when idle", timestamp: 1 }] });
  const harness = createBackendHarness({
    root,
    cwd,
    sessionPath,
    loadSessionSnapshot: async () => {
      loadCalls += 1;
      return loadCalls === 1 ? firstLoad.promise : loaded;
    },
  });
  await waitUntil(() => harness.monitoredCalls.some((paths) => paths.includes(sessionPath)), "managed path registration");
  const change = changeFor(sessionPath, 1);
  harness.monitorOptions.onSessionChange(change);
  await waitUntil(() => loadCalls === 1, "snapshot load start");
  harness.setActive(true);
  firstLoad.resolve(loaded);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.tab.mirror.rows().length, 0, "post-load busy state prevents projection");
  assert.deepEqual(harness.backend.sessionSyncSnapshot().pendingPaths, [sessionPath]);

  harness.setActive(false);
  harness.monitorOptions.onSessionChange(change);
  await waitUntil(() => harness.tab.mirror.rows().some((row) => row.text === "apply only when idle"), "idle retry projection");
  assert.equal(loadCalls, 2);
});

test("same-revision snapshot failures back off exponentially and a new revision retries immediately", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await mkdir(cwd);
  const { sessionPath } = await writeSession(agentDir, cwd, "backoff.jsonl", persistedEntries());
  let currentTime = 0;
  let loadCalls = 0;
  const harness = createBackendHarness({
    root,
    cwd,
    sessionPath,
    sessionSyncNow: () => currentTime,
    loadSessionSnapshot: async () => {
      loadCalls += 1;
      if (loadCalls < 3) throw Object.assign(new Error("incomplete"), { code: "EINCOMPLETE" });
      return persistedSnapshot({ revision: revision(2), messages: [{ role: "user", content: "recovered revision", timestamp: 1 }] });
    },
  });
  await waitUntil(() => harness.monitoredCalls.some((paths) => paths.includes(sessionPath)), "managed path registration");
  const unchanged = changeFor(sessionPath, 1);
  harness.monitorOptions.onSessionChange(unchanged);
  await waitUntil(() => loadCalls === 1, "first failed load");
  harness.monitorOptions.onSessionChange(unchanged);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadCalls, 1, "the same failed revision is suppressed inside its first backoff window");

  currentTime = 2_000;
  harness.monitorOptions.onSessionChange(unchanged);
  await waitUntil(() => loadCalls === 2, "backoff retry");
  currentTime = 2_001;
  harness.monitorOptions.onSessionChange(changeFor(sessionPath, 2));
  await waitUntil(() => loadCalls === 3, "new-revision immediate retry");
  await waitUntil(() => harness.backend.sessionSyncSnapshot().failurePaths.length === 0, "failure reset after recovery");
  assert(harness.tab.mirror.rows().some((row) => row.text === "recovered revision"));
});

test("force-close prunes pending, reconciling, and failure state before an in-flight load can apply", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await mkdir(cwd);
  const { sessionPath } = await writeSession(agentDir, cwd, "closing.jsonl", persistedEntries());
  const pendingLoad = deferred();
  let loadCalls = 0;
  const harness = createBackendHarness({
    root,
    cwd,
    sessionPath,
    loadSessionSnapshot: async () => { loadCalls += 1; return pendingLoad.promise; },
  });
  await waitUntil(() => harness.monitoredCalls.some((paths) => paths.includes(sessionPath)), "managed path registration");
  harness.monitorOptions.onSessionChange(changeFor(sessionPath, 1));
  await waitUntil(() => loadCalls === 1, "in-flight projection");
  await harness.backend.registry.close(harness.tab.id, { force: true });
  assert.deepEqual(harness.backend.sessionSyncSnapshot(), { pendingPaths: [], reconcilingPaths: [], failurePaths: [], monitoredPaths: [], futurePaths: [] });
  pendingLoad.resolve(persistedSnapshot({ revision: revision(1), messages: [{ role: "user", content: "must not apply", timestamp: 1 }] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.tab.mirror.rows().some((row) => row.text === "must not apply"), false);
  await waitUntil(() => harness.backend.sessionSyncSnapshot().monitoredPaths.length === 0, "closed monitor path removal");
});

test("a missing future session file becomes monitored and externally synchronized after a catalog event", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await mkdir(cwd);
  const directory = sessionDirectoryFor(cwd, { PI_CODING_AGENT_DIR: agentDir });
  await mkdir(directory, { recursive: true });
  const sessionPath = path.join(directory, "future.jsonl");
  let loadCalls = 0;
  const loaded = persistedSnapshot({
    revision: revision(1),
    messages: [{ role: "user", content: "created after runtime publication", timestamp: 1 }],
  });
  const harness = createBackendHarness({
    root,
    cwd,
    sessionPath,
    loadSessionSnapshot: async () => { loadCalls += 1; return loaded; },
  });

  await waitUntil(() => harness.monitoredCalls.length > 0, "initial future-path validation");
  assert.deepEqual(harness.monitoredCalls.at(-1), [], "a nonexistent path is not passed to the monitor");
  assert.deepEqual(harness.backend.sessionSyncSnapshot().futurePaths, [sessionPath], "the registry-owned missing path remains bounded for revalidation");

  await writeFile(sessionPath, jsonl(persistedEntries()));
  harness.monitorOptions.onCatalogChange({ reason: "filesystem" });
  await waitUntil(() => harness.monitoredCalls.at(-1)?.includes(sessionPath), "future path monitor registration without another runtime event");
  assert.deepEqual(harness.backend.sessionSyncSnapshot().futurePaths, []);
  harness.monitorOptions.onSessionChange(changeFor(sessionPath, 1));
  await waitUntil(() => harness.tab.mirror.rows().some((row) => row.text === "created after runtime publication"), "external projection for the created file");
  assert.equal(loadCalls, 1);
});

test("catalog bursts behind a slow future-path validation coalesce to one follow-up pass", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await mkdir(cwd);
  const directory = sessionDirectoryFor(cwd, { PI_CODING_AGENT_DIR: agentDir });
  await mkdir(directory, { recursive: true });
  const sessionPath = path.join(directory, "future-burst.jsonl");
  const heldValidation = deferred();
  let validationPasses = 0;
  const harness = createBackendHarness({
    root,
    cwd,
    sessionPath,
    loadSessionSnapshot: async () => persistedSnapshot(),
    setOpenSessionPaths: async () => {
      validationPasses += 1;
      if (validationPasses === 1) await heldValidation.promise;
    },
  });

  await waitUntil(() => validationPasses === 1 && harness.backend.sessionSyncSnapshot().futurePaths.length === 1, "held future-path validation");
  for (let index = 0; index < 50; index += 1) harness.monitorOptions.onCatalogChange({ reason: "filesystem" });
  assert.equal(validationPasses, 1, "catalog events do not start parallel validation passes");

  heldValidation.resolve();
  await waitUntil(() => validationPasses === 2, "single dirty follow-up validation");
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(validationPasses, 2, "the burst creates exactly one follow-up pass");
  assert.deepEqual(harness.monitoredCalls, [[], []]);
});

test("escaping file and directory symlinks are neither monitored nor projected", async (t) => {
  const root = await temporary(t);
  const cwd = path.join(root, "workspace");
  const sessionsRoot = path.join(root, "agent", "sessions");
  const outside = path.join(root, "outside");
  await Promise.all([mkdir(cwd), mkdir(path.join(sessionsRoot, "project"), { recursive: true }), mkdir(outside)]);
  const outsideFile = path.join(outside, "outside.jsonl");
  await writeFile(outsideFile, jsonl(persistedEntries()));
  const escapingFile = path.join(sessionsRoot, "project", "file-link.jsonl");
  await symlink(outsideFile, escapingFile);
  const outsideDirectory = path.join(outside, "directory");
  await mkdir(outsideDirectory);
  await writeFile(path.join(outsideDirectory, "directory-link.jsonl"), jsonl(persistedEntries()));
  const escapingDirectory = path.join(sessionsRoot, "directory-link");
  await symlink(outsideDirectory, escapingDirectory);

  for (const sessionPath of [escapingFile, path.join(escapingDirectory, "directory-link.jsonl")]) {
    let loadCalls = 0;
    const harness = createBackendHarness({
      root,
      cwd,
      sessionPath,
      loadSessionSnapshot: async () => { loadCalls += 1; return persistedSnapshot({ revision: revision(1) }); },
    });
    await waitUntil(() => harness.monitoredCalls.length > 0, "confinement validation");
    assert.deepEqual(harness.monitoredCalls.at(-1), []);
    harness.monitorOptions.onSessionChange(changeFor(sessionPath, 1));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loadCalls, 0);
    assert.equal(harness.backend.sessionSyncSnapshot().pendingPaths.length, 0);
  }
});

test("catalog invalidation, equal suppression, active refresh, malformed retention, and rebind-before-prompt", { timeout: 20_000 }, async (t) => {
  const { backend, sessionPath, directory, agentDir, cwd } = await readyBackendWithSession(t);

  const equalBaseline = backend.events.at(-1).seq;
  await writeFile(sessionPath, jsonl(persistedEntries()));
  await backend.waitForEvent("sessions.changed", (event) => event.seq > equalBaseline && event.reason === "filesystem");
  await delay(250);
  const equalResets = backend.events.filter((event) => event.type === "transcript.reset" && event.seq > equalBaseline);
  assert.equal(equalResets.length, 0, "a complete snapshot equal to the tab mirror is acknowledged without replay");

  const catalogBaseline = backend.events.at(-1).seq;
  await writeSession(agentDir, cwd, "catalog-only.jsonl", persistedEntries({ id: "catalog-only" }));
  await backend.waitForEvent("sessions.changed", (event) => event.seq > catalogBaseline && event.reason === "filesystem");

  const malformedBaseline = backend.events.at(-1).seq;
  await writeFile(sessionPath, jsonl(persistedEntries()).slice(0, -7));
  await backend.waitForEvent("notice", (event) => event.seq > malformedBaseline && /Session synchronization:/.test(event.message));
  await delay(150);
  assert.equal(backend.events.filter((event) => event.type === "transcript.reset" && event.seq > malformedBaseline).length, 0,
    "a partial snapshot retains the last complete transcript");

  const changed = persistedEntries({ extra: externalExchange("external answer") });
  await writeFile(sessionPath, jsonl(changed));
  const reset = await backend.waitForEvent("transcript.reset", (event) => event.seq > malformedBaseline);
  const row = await backend.waitForEvent("transcript.row", (event) => event.seq > reset.seq && event.row?.text === "external answer");
  assert.equal(row.tab, (await backend.send("tabs_list")).data.activeTab);

  const beforePrompt = (await backend.readCapture()).length;
  const prompted = await backend.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" });
  assert.equal(prompted.ok, true);
  const commands = (await backend.readCapture()).slice(beforePrompt);
  assert.deepEqual(commands.slice(0, 4).map((command) => command.type), ["switch_session", "get_messages", "get_state", "prompt"],
    "the stale child rebinds through the normal session switch flow before writing the prompt");
  assert.equal(commands[0].sessionPath, sessionPath);
  assert.equal(path.dirname(sessionPath), directory);
});

test("external refresh waits for an active run to settle", { timeout: 20_000 }, async (t) => {
  const { backend, sessionPath } = await readyBackendWithSession(t);
  const accepted = await backend.send("prompt", { message: "__QT_WEBUI_DELAYED_ABORT__" });
  assert.equal(accepted.ok, true);
  const started = await backend.waitForEvent("run.start");
  await writeFile(sessionPath, jsonl(persistedEntries({ extra: externalExchange("after settlement") })));
  await delay(180);
  assert.equal(backend.events.some((event) => event.type === "transcript.row" && event.seq > started.seq && event.row?.text === "after settlement"), false);
  const settled = await backend.waitForEvent("run.end", (event) => event.seq > started.seq);
  const reset = await backend.waitForEvent("transcript.reset", (event) => event.seq > settled.seq);
  await backend.waitForEvent("transcript.row", (event) => event.seq > reset.seq && event.row?.text === "after settlement");
});

test("an external refresh on an inactive tab increments unread without replaying that transcript", { timeout: 20_000 }, async (t) => {
  const { backend, sessionPath, cwd, tabId } = await readyBackendWithSession(t);
  const opened = await backend.send("tab_open", { cwd });
  assert.equal(opened.ok, true);
  assert.notEqual(opened.data.tab.id, tabId);
  const baseline = backend.events.at(-1).seq;

  await writeFile(sessionPath, jsonl(persistedEntries({ extra: externalExchange("background answer") })));
  const update = await backend.waitForEvent("tabs.update", (event) => event.seq > baseline && event.tabs.some((tab) => tab.id === tabId && tab.unread === 1));
  assert.equal(update.activeTab, opened.data.tab.id);
  await delay(150);
  assert.equal(backend.events.some((event) => event.type === "transcript.reset" && event.seq > baseline && event.tab === tabId), false);
});

test("a cancelled stale rebind refuses the mutation and leaves it fenced for retry", { timeout: 20_000 }, async (t) => {
  const { backend, sessionPath } = await readyBackendWithSession(t, { cancelSwitchAt: "2" });
  const baseline = backend.events.at(-1).seq;
  await writeFile(sessionPath, jsonl(persistedEntries({ extra: externalExchange("needs rebind") })));
  await backend.waitForEvent("transcript.reset", (event) => event.seq > baseline);

  const captureBaseline = (await backend.readCapture()).length;
  const refused = await backend.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" });
  assert.equal(refused.error.code, "pi_error");
  assert.match(refused.error.message, /cancelled the session switch/);
  const refusedCommands = (await backend.readCapture()).slice(captureBaseline);
  assert.deepEqual(refusedCommands.map((command) => command.type), ["switch_session"]);

  const retried = await backend.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" });
  assert.equal(retried.ok, true);
});

test("the centralized mutation fence covers every approved persisted-session mutation", () => {
  assert.deepEqual([...SESSION_MUTATION_REQUESTS].sort(), [
    "compact",
    "model_cycle",
    "model_set",
    "prompt",
    "resources_state",
    "sampling_set",
    "sequence_run",
    "skills_set",
    "tab_rename",
    "thinking_cycle",
    "thinking_set",
    "tools_set",
  ]);
});

test("backend shutdown stops the owned monitor exactly once", async (t) => {
  const root = await temporary(t);
  const input = new PassThrough();
  const output = new PassThrough();
  let stopCount = 0;
  let exitCode = null;
  const monitor = {
    start: async () => true,
    stop: async () => { stopCount += 1; },
    setOpenSessionPaths: async () => [],
    acknowledgeSessionRevision: () => true,
  };
  const backend = createBackend({
    input,
    output,
    env: {
      ...process.env,
      QT_WEBUI_PI_CLI_ENTRY: fakePiEntry,
      QT_WEBUI_CALLER_CWD: root,
      PI_CODING_AGENT_DIR: path.join(root, "agent"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    createSessionMonitor: () => monitor,
    exit: (code) => { exitCode = code; },
  });

  await backend.shutdown(0, "test cleanup");
  await backend.shutdown(0, "duplicate cleanup");
  assert.equal(stopCount, 1);
  assert.equal(exitCode, 0);
});
