import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SESSION_SYNC_DEFAULTS,
  createSessionSyncMonitor,
  loadPersistedSessionSnapshot,
} from "../lib/backend/session-sync.mjs";

class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.timeouts = new Map();
    this.intervals = new Map();
    this.clearedIntervals = [];
  }

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timeouts.set(id, { callback, delay });
    return id;
  };

  clearTimeout = (id) => {
    this.timeouts.delete(id);
  };

  setInterval = (callback, delay) => {
    const id = this.nextId++;
    this.intervals.set(id, { callback, delay });
    return id;
  };

  clearInterval = (id) => {
    this.clearedIntervals.push(id);
    this.intervals.delete(id);
  };

  async flushTimeouts() {
    const pending = [...this.timeouts.values()];
    this.timeouts.clear();
    for (const timer of pending) timer.callback();
    await new Promise((resolve) => setImmediate(resolve));
  }

  async tickIntervals() {
    for (const timer of [...this.intervals.values()]) timer.callback();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

class FakeWatcher extends EventEmitter {
  constructor(directory, callback) {
    super();
    this.directory = directory;
    this.callback = callback;
    this.closeCount = 0;
  }

  signal(eventType, filename) {
    this.callback(eventType, filename);
  }

  close() {
    this.closeCount += 1;
  }
}

function directoryEntry(name, directory = true) {
  return { name, isDirectory: () => directory };
}

class FakeFilesystem {
  constructor(root) {
    this.root = root;
    this.directories = [];
    this.revisions = new Map();
    this.watchers = [];
    this.statCalls = [];
    this.watchError = null;
  }

  readdir = async (directory) => {
    assert.equal(directory, this.root);
    return this.directories.map((name) => directoryEntry(name));
  };

  stat = async (filePath) => {
    this.statCalls.push(filePath);
    const value = this.revisions.get(filePath);
    if (value instanceof Error) throw value;
    if (!value) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return value;
  };

  watch = (directory, _options, callback) => {
    if (this.watchError) throw this.watchError;
    const watcher = new FakeWatcher(directory, callback);
    this.watchers.push(watcher);
    return watcher;
  };

  watcher(directory) {
    return this.watchers.findLast((watcher) => watcher.directory === directory && watcher.closeCount === 0);
  }
}

function stats(size, mtimeMs, ino = 1) {
  return { size, mtimeMs, ctimeMs: mtimeMs, ino };
}

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function jsonl(entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-session-sync-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function sessionEntries({ version = 3, answer = "after compaction" } = {}) {
  const timestamp = "2026-08-27T00:00:00.000Z";
  return [
    { type: "session", version, id: "session-1", timestamp, cwd: "/work/project" },
    { type: "message", id: "old", parentId: null, timestamp, message: { role: "user", content: "summarized old question", timestamp: 1 } },
    { type: "message", id: "kept", parentId: "old", timestamp, message: { role: "user", content: "kept question", timestamp: 2 } },
    { type: "thinking_level_change", id: "thinking", parentId: "kept", timestamp, thinkingLevel: "high" },
    { type: "compaction", id: "compact", parentId: "thinking", timestamp, summary: "compact summary", firstKeptEntryId: "kept", tokensBefore: 123 },
    { type: "message", id: "answer", parentId: "compact", timestamp, message: { role: "assistant", content: [{ type: "text", text: answer }], provider: "test-provider", model: "test-model", timestamp: 3, stopReason: "stop", usage: {} } },
    { type: "session_info", id: "info", parentId: "answer", timestamp, name: "Snapshot name" },
  ];
}

test("monitor bounds topology watchers, refreshes immediate projects, coalesces catalog changes, and stops once", async () => {
  const root = "/agent/sessions";
  const filesystem = new FakeFilesystem(root);
  const timers = new FakeTimers();
  const catalogEvents = [];
  filesystem.directories = ["project-c", "project-a", "project-b"];
  const monitor = createSessionSyncMonitor({
    sessionsRoot: root,
    filesystem,
    timers,
    maxProjectWatchers: 2,
    onCatalogChange: (event) => catalogEvents.push(event),
  });

  assert.equal(await monitor.start(), true);
  assert.deepEqual(filesystem.watchers.map((watcher) => watcher.directory), [root, path.join(root, "project-a"), path.join(root, "project-b")]);
  assert.equal([...timers.intervals.values()][0].delay, SESSION_SYNC_DEFAULTS.pollIntervalMs);

  const removed = filesystem.watcher(path.join(root, "project-a"));
  filesystem.directories = ["project-b", "project-c"];
  filesystem.watcher(path.join(root, "project-a")).signal("change", "one.jsonl");
  filesystem.watcher(path.join(root, "project-b")).signal("rename", "two.jsonl");
  filesystem.watcher(root).signal("rename", "project-c");
  assert.equal(catalogEvents.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(removed.closeCount, 1, "a root topology event removes a vanished project watcher");
  assert(filesystem.watcher(path.join(root, "project-c")), "a root topology event watches the new project");
  await timers.flushTimeouts();
  assert.equal(catalogEvents.length, 1, "a burst across all watched directories emits one catalog invalidation");

  assert.equal(monitor.snapshot().projectWatcherCount, 2);

  await monitor.stop();
  await monitor.stop();
  assert(filesystem.watchers.every((watcher) => watcher.closeCount === 1));
  assert.equal(timers.intervals.size, 0);
  assert.equal(timers.timeouts.size, 0);
  assert.equal(monitor.snapshot().stopped, true);
});

test("project append, change, and delete hints are coalesced and only target matching open sessions", async () => {
  const root = "/agent/sessions";
  const project = path.join(root, "project");
  const sessionPath = path.join(project, "open.jsonl");
  const filesystem = new FakeFilesystem(root);
  const timers = new FakeTimers();
  const changes = [];
  filesystem.directories = ["project"];
  filesystem.revisions.set(sessionPath, stats(10, 1));
  const monitor = createSessionSyncMonitor({ sessionsRoot: root, filesystem, timers, onSessionChange: (change) => changes.push(change) });
  await monitor.setOpenSessionPaths([sessionPath]);
  await monitor.start();
  const watcher = filesystem.watcher(project);

  filesystem.revisions.set(sessionPath, stats(20, 2));
  watcher.signal("rename", "open.jsonl");
  watcher.signal("change", Buffer.from("open.jsonl"));
  watcher.signal("change", "closed.jsonl");
  await timers.flushTimeouts();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, "watch");
  assert.equal(changes[0].revision.exists, true);
  assert.equal(monitor.acknowledgeSessionRevision(sessionPath, changes[0].revisionKey), true);

  watcher.signal("change", "open.jsonl");
  await timers.flushTimeouts();
  assert.equal(changes.length, 2, "a filesystem hint is honored even if coarse stat fields did not move");
  monitor.acknowledgeSessionRevision(sessionPath, changes[1].revision);

  filesystem.revisions.set(sessionPath, codedError("ENOENT"));
  watcher.signal("rename", "open.jsonl");
  await timers.flushTimeouts();
  assert.equal(changes.length, 3);
  assert.deepEqual(changes[2].revision, { exists: false, error: "ENOENT" });
  await monitor.stop();
});

test("polling detects missed open-file revisions, retries until acknowledgment, and enforces the open-file bound", async () => {
  const root = "/agent/sessions";
  const filesystem = new FakeFilesystem(root);
  const timers = new FakeTimers();
  const changes = [];
  const candidates = Array.from({ length: 11 }, (_, index) => path.join(root, "project", `${index}.jsonl`));
  for (const [index, candidate] of candidates.entries()) filesystem.revisions.set(candidate, stats(index + 1, 1, index + 1));
  const monitor = createSessionSyncMonitor({ sessionsRoot: root, filesystem, timers, onSessionChange: (change) => changes.push(change) });
  const accepted = await monitor.setOpenSessionPaths([...candidates, candidates[0], "/outside/not-managed.jsonl"]);
  assert.deepEqual(accepted, candidates.slice(0, SESSION_SYNC_DEFAULTS.maxOpenSessions));
  assert.equal(monitor.snapshot().openSessionPaths.length, SESSION_SYNC_DEFAULTS.maxOpenSessions);
  await monitor.start();

  filesystem.revisions.set(candidates[0], stats(99, 2, 1));
  await timers.tickIntervals();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, "poll");
  await timers.tickIntervals();
  assert.equal(changes.length, 2, "an unacknowledged revision is retried on the next poll");
  assert.equal(changes[1].revisionKey, changes[0].revisionKey);
  assert.equal(monitor.acknowledgeSessionRevision(candidates[0], changes[0].revision), true);
  await timers.tickIntervals();
  assert.equal(changes.length, 2);
  assert.equal(filesystem.statCalls.some((candidate) => candidate === candidates[8]), false, "paths beyond the bound are never polled");
  await monitor.stop();
});

test("watch setup failure is bounded by failure class while polling remains available", async () => {
  const root = "/agent/sessions";
  const sessionPath = path.join(root, "project", "open.jsonl");
  const filesystem = new FakeFilesystem(root);
  const timers = new FakeTimers();
  const warnings = [];
  const changes = [];
  filesystem.watchError = codedError("ENOSPC");
  filesystem.revisions.set(sessionPath, stats(1, 1));
  const monitor = createSessionSyncMonitor({ sessionsRoot: root, filesystem, timers, onWarning: (warning) => warnings.push(warning), onSessionChange: (change) => changes.push(change) });
  await monitor.setOpenSessionPaths([sessionPath]);
  await monitor.start();
  await monitor.refreshTopology();
  assert.equal(warnings.length, 1);
  filesystem.revisions.set(sessionPath, stats(2, 2));
  await monitor.pollNow();
  assert.equal(changes.length, 1);
  await monitor.stop();
});

test("snapshot loader uses Pi's compaction-aware context without modifying the source", async (t) => {
  const directory = await temporary(t);
  const sessionPath = path.join(directory, "session.jsonl");
  const source = jsonl(sessionEntries({ version: 2 }));
  await writeFile(sessionPath, source);

  const snapshot = await loadPersistedSessionSnapshot(sessionPath);
  assert.equal(await readFile(sessionPath, "utf8"), source, "Pi migrations are confined to the isolated copy");
  assert.equal(snapshot.sessionId, "session-1");
  assert.equal(snapshot.cwd, "/work/project");
  assert.equal(snapshot.name, "Snapshot name");
  assert.equal(snapshot.thinkingLevel, "high");
  assert.deepEqual(snapshot.model, { provider: "test-provider", modelId: "test-model" });
  assert.equal(snapshot.sourceVersion, 2);
  assert.equal(snapshot.projectedVersion, 3);
  const rendered = JSON.stringify(snapshot.messages);
  assert.doesNotMatch(rendered, /summarized old question/);
  assert.match(rendered, /compact summary/);
  assert.match(rendered, /kept question/);
  assert.match(rendered, /after compaction/);
});

test("malformed, partial, and unstable snapshots reject without replacing the last valid result and can be retried", async (t) => {
  const directory = await temporary(t);
  const sessionPath = path.join(directory, "session.jsonl");
  await writeFile(sessionPath, jsonl(sessionEntries()));
  const retained = await loadPersistedSessionSnapshot(sessionPath);

  await writeFile(sessionPath, jsonl(sessionEntries()).slice(0, -8));
  await assert.rejects(loadPersistedSessionSnapshot(sessionPath), /incomplete final line/);
  assert.match(JSON.stringify(retained.messages), /after compaction/);

  await writeFile(sessionPath, `${jsonl(sessionEntries())}{not-json}\n`);
  await assert.rejects(loadPersistedSessionSnapshot(sessionPath), /malformed JSON/);
  assert.match(JSON.stringify(retained.messages), /after compaction/);

  await writeFile(sessionPath, jsonl(sessionEntries({ answer: "completed retry" })));
  const retried = await loadPersistedSessionSnapshot(sessionPath);
  assert.match(JSON.stringify(retried.messages), /completed retry/);
  assert.doesNotMatch(JSON.stringify(retained.messages), /completed retry/);

  let statCall = 0;
  const actual = await import("node:fs/promises");
  const unstableFilesystem = {
    ...actual,
    stat: async (filePath) => {
      const value = await actual.stat(filePath);
      statCall += 1;
      return statCall === 2 ? { ...value, mtimeMs: value.mtimeMs + 1 } : value;
    },
  };
  await assert.rejects(loadPersistedSessionSnapshot(sessionPath, { filesystem: unstableFilesystem }), /changed while it was being read/);
});
