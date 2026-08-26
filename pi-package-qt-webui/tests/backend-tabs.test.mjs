import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openLocalPath } from "../lib/backend/desktop.mjs";
import { createDirectory, listDirectory } from "../lib/backend/directories.mjs";
import { createWorktree, defaultWorktreePath, listWorktrees, removeWorktree, runGit, validateBranchName } from "../lib/backend/git.mjs";
import { LIMITS, validateRequest } from "../lib/backend/protocol.mjs";
import { listSessions, sessionDirectoryFor } from "../lib/backend/sessions-index.mjs";
import { createTranscriptMirror, rowsFromHistory } from "../lib/backend/transcript.mjs";
import { startBackend } from "./helpers/backend-client.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: os.tmpdir() };

async function temporary(t, prefix = "qt-webui-tabs-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function makeRepository(t, name = "repo") {
  const base = await temporary(t);
  const root = path.join(base, name);
  await mkdir(root);
  git(root, "init", "-q", "-b", "main");
  await writeFile(path.join(root, "README.md"), "hello\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "init");
  return { base, root };
}

function sessionLine(entry) {
  return `${JSON.stringify(entry)}\n`;
}

async function writeSession(directory, fileName, { id, cwd, name, messages = [], timestamp = "2026-08-01T00:00:00.000Z" }) {
  const lines = [sessionLine({ type: "session", version: 3, id, timestamp, cwd })];
  if (name !== undefined) lines.push(sessionLine({ type: "session_info", id: `${id}-info`, parentId: null, timestamp, name }));
  messages.forEach((message, index) => lines.push(sessionLine({ type: "message", id: `${id}-${index}`, parentId: null, timestamp, message })));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), lines.join(""));
}

// ---- transcript ----------------------------------------------------------------------------

test("transcript mirror follows live events and history translates every message role", () => {
  const mirror = createTranscriptMirror({ maxRows: 2 });
  mirror.apply("message.user", { messageId: "u1", text: "hi", mode: "send", attachments: ["a.txt"] });
  mirror.apply("part.begin", { messageId: "a1", partId: "a1.1", partKind: "text" });
  mirror.apply("part.render", { messageId: "a1", partId: "a1.1", partKind: "text", text: "**bold**", blocks: [{ type: "paragraph", styled: "<b>bold</b>" }], final: true });
  mirror.apply("tool.start", { toolCallId: "t1", name: "bash", summary: "command=ls", messageId: "a1" });
  mirror.apply("tool.update", { toolCallId: "t1", output: "partial" });
  mirror.apply("tool.end", { toolCallId: "t1", name: "bash", ok: false, durationMs: 12, output: "boom", error: "boom" });
  const rows = mirror.rows();
  assert.deepEqual(rows.map((row) => [row.rowId, row.kind]), [["a1.1", "text"], ["tool-t1", "tool"]], "the oldest row is evicted at the bound");
  assert.equal(rows[0].blocksJson, JSON.stringify([{ type: "paragraph", styled: "<b>bold</b>" }]));
  assert.equal(rows[0].streaming, false);
  assert.deepEqual({ status: rows[1].toolStatus, output: rows[1].toolOutput, error: rows[1].toolError, duration: rows[1].toolDurationMs }, { status: "error", output: "boom", error: "boom", duration: 12 });
  mirror.apply("part.remove", { partId: "a1.1" });
  assert.equal(mirror.count, 1);
  mirror.apply("transcript.reset", {});
  assert.equal(mirror.count, 0);

  const history = rowsFromHistory([
    { role: "user", content: "q1" },
    { role: "assistant", content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "# heading" }, { type: "toolCall", id: "c1", name: "read", arguments: { path: "/x" } }], stopReason: "toolUse" },
    { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "out" }], isError: false },
    { role: "bashExecution", command: "ls -la", output: "total 0", exitCode: 1, cancelled: false },
    { role: "assistant", content: [{ type: "text", text: "x".repeat(LIMITS.maxMessageCharacters + 1) }, { type: "toolCall", id: "c2", name: "bash", arguments: {} }], stopReason: "aborted" },
    "junk",
  ]);
  assert.deepEqual(history.rows.map((row) => [row.kind, row.rowId]), [
    ["user", "history-user-1"], ["thinking", "history-2.1"], ["text", "history-2.2"], ["tool", "tool-c1"], ["tool", "history-bash-4"], ["text", "history-5.1"], ["tool", "tool-c2"],
  ]);
  assert.equal(JSON.parse(history.rows[2].blocksJson)[0].type, "heading");
  assert.deepEqual({ status: history.rows[3].toolStatus, output: history.rows[3].toolOutput, summary: history.rows[3].toolSummary }, { status: "ok", output: "out", summary: "path=/x" });
  assert.deepEqual({ status: history.rows[4].toolStatus, error: history.rows[4].toolError }, { status: "error", error: "Exit code 1" });
  assert.equal(history.rows[5].truncated, true);
  assert.equal(history.rows[5].text.length, LIMITS.maxMessageCharacters);
  assert.deepEqual({ status: history.rows[6].toolStatus, error: history.rows[6].toolError }, { status: "error", error: "No result was recorded (interrupted)" });
  assert.equal(history.interrupted, true, "an aborted final reply is interrupted");
  assert.equal(history.messageCount, 5);
  assert.equal(rowsFromHistory([{ role: "user", content: "alone" }]).interrupted, true, "a trailing user message is interrupted");
  assert.equal(rowsFromHistory([{ role: "user", content: "q" }, { role: "assistant", content: "a", stopReason: "stop" }]).interrupted, false);
  const many = rowsFromHistory(Array.from({ length: LIMITS.maxTranscriptRows + 5 }, (_, index) => ({ role: "user", content: `m${index}` })));
  assert.equal(many.rows.length, LIMITS.maxTranscriptRows);
  assert.equal(many.rows[0].text, "m5");
});

// ---- sessions index ------------------------------------------------------------------------

test("session listing matches Pi's directory encoding, reads headers and names, and stays bounded", async (t) => {
  const agentDir = await temporary(t, "qt-webui-agent-");
  const cwd = "/home/someone/project with spaces:x";
  const env = { PI_CODING_AGENT_DIR: agentDir };
  const directory = sessionDirectoryFor(cwd, env);
  const { getDefaultSessionDir } = await import("@earendil-works/pi-coding-agent/dist/core/session-manager.js").catch(() => ({ getDefaultSessionDir: null }));
  if (getDefaultSessionDir) {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      assert.equal(directory, getDefaultSessionDir(cwd), "the encoding must match Pi exactly");
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
  assert.deepEqual(await listSessions(cwd, { env }), { sessions: [], omitted: 0, directory });
  await writeSession(directory, "2026-08-01_older.jsonl", { id: "older", cwd, name: "Older [31mred[0m", messages: [{ role: "user", content: "first  question", timestamp: 1000 }, { role: "assistant", content: "answer", timestamp: 2000 }] });
  await writeSession(directory, "2026-08-02_newer.jsonl", { id: "newer", cwd, messages: [{ role: "user", content: [{ type: "text", text: "array content" }], timestamp: 5000 }] });
  await writeFile(path.join(directory, "broken.jsonl"), "{\"type\":\"message\"}\n");
  await writeFile(path.join(directory, "notes.txt"), "ignored");
  await mkdir(path.join(directory, "dir.jsonl"));
  const listed = await listSessions(cwd, { env, now: () => 10_000 });
  assert.deepEqual(listed.sessions.map((session) => [session.id, session.name, session.messageCount, session.firstMessage, session.modified, session.ageMs]), [
    ["newer", "", 1, "array content", 5000, 5000],
    ["older", "Older red", 2, "first question", 2000, 8000],
  ]);
  assert.equal(listed.omitted, 0);
  for (let index = 0; index < LIMITS.maxSessionListEntries; index += 1) await writeSession(directory, `bulk-${String(index).padStart(3, "0")}.jsonl`, { id: `bulk-${index}`, cwd });
  const bounded = await listSessions(cwd, { env });
  assert.equal(bounded.sessions.length, LIMITS.maxSessionListEntries);
  assert.equal(bounded.omitted, 3, "files beyond the bound are counted even when they turn out to be invalid");
});

// ---- directories ---------------------------------------------------------------------------

test("directory listing is bounded, marks hidden and git folders, and folder creation is validated", async (t) => {
  const root = await temporary(t);
  await mkdir(path.join(root, "alpha", ".git"), { recursive: true });
  await mkdir(path.join(root, ".hidden"));
  await mkdir(path.join(root, "beta"));
  await writeFile(path.join(root, "file.txt"), "x");
  await symlink(path.join(root, "beta"), path.join(root, "link-to-beta"));
  const listing = listDirectory(root);
  assert.deepEqual(listing.entries.map((entry) => [entry.name, entry.git, entry.hidden]), [["alpha", true, false], ["beta", false, false], ["link-to-beta", false, false]]);
  assert.equal(listing.hiddenCount, 1);
  assert.equal(listing.parent, path.dirname(await realpath(root)));
  assert.equal(listDirectory(root, { showHidden: true }).entries[0].name, ".hidden");
  assert.equal(listDirectory("~").path, await realpath(os.homedir()));
  assert.throws(() => listDirectory(path.join(root, "file.txt")), /not a folder/);
  assert.throws(() => listDirectory(path.join(root, "missing")), /does not exist: .*missing/);
  assert.throws(() => listDirectory("relative"), /absolute/);
  assert.equal(createDirectory(root, "gamma").path, path.join(await realpath(root), "gamma"));
  assert.throws(() => createDirectory(root, "gamma"), /already exists/);
  for (const bad of ["", "a/b", "..", ".", "a\\b"]) assert.throws(() => createDirectory(root, bad), /cannot be empty or contain slashes/, `name ${JSON.stringify(bad)}`);
  for (let index = 0; index < LIMITS.maxDirectoryEntries + 1; index += 1) await mkdir(path.join(root, "beta", `d${String(index).padStart(4, "0")}`));
  const bounded = listDirectory(path.join(root, "beta"));
  assert.equal(bounded.entries.length, LIMITS.maxDirectoryEntries);
  assert.equal(bounded.omitted, 1);
});

async function realpath(target) {
  const { realpath: real } = await import("node:fs/promises");
  return real(target);
}

// ---- git worktrees -------------------------------------------------------------------------

test("worktree creation validates names, handles spaces, detached HEAD, conflicts, nesting, and rolls back failures", async (t) => {
  const { base, root } = await makeRepository(t, "my repo");
  for (const bad of ["", "bad name", "-lead", "a..b", "x/", "/x", "x.lock", "a@{b", "x".repeat(LIMITS.maxBranchNameCharacters + 1)]) assert.equal(validateBranchName(bad), null, `branch ${JSON.stringify(bad)}`);
  assert.equal(validateBranchName("feature/one-2"), "feature/one-2");
  assert.equal(defaultWorktreePath(root, "feature/x"), path.join(base, "my repo-feature-x"));
  assert.equal((await listWorktrees(root)).length, 1);

  const created = await createWorktree({ cwd: root, branch: "feature/spaces" });
  assert.deepEqual({ branch: created.branch, path: created.path, base: created.base, detached: created.detachedBase }, { branch: "feature/spaces", path: path.join(base, "my repo-feature-spaces"), base: "main", detached: false });
  assert(existsSync(path.join(created.path, "README.md")));
  assert.deepEqual((await listWorktrees(root)).map((entry) => entry.branch).sort(), ["feature/spaces", "main"]);
  await assert.rejects(createWorktree({ cwd: root, branch: "feature/spaces", targetPath: path.join(base, "other") }), /already exists; choose another name/);
  await assert.rejects(createWorktree({ cwd: root, branch: "feature/again", targetPath: created.path }), /already exists$/);
  await assert.rejects(createWorktree({ cwd: root, branch: "bad name" }), /not a valid branch name/);
  await assert.rejects(createWorktree({ cwd: base, branch: "x" }), /not inside a Git repository/);
  await assert.rejects(createWorktree({ cwd: root, branch: "feature/base", base: "no such base" }), /base must be a branch name or commit/);

  const nested = await createWorktree({ cwd: root, branch: "feature/nested", targetPath: ".worktrees/nested one" });
  assert.equal(nested.path, path.join(root, ".worktrees", "nested one"));
  assert((await listWorktrees(root)).some((entry) => entry.path === nested.path));

  git(root, "checkout", "-q", "--detach", "HEAD");
  const detached = await createWorktree({ cwd: root, branch: "feature/from-detached" });
  assert.equal(detached.detachedBase, true);
  assert.match(detached.base, /^[0-9a-f]{7,}$/);

  // A failing `git worktree add` must leave the repository unchanged: no directory, no branch.
  const failing = (command, args, options) => {
    if (args.includes("add")) return spawnSyncLike(128, "fatal: simulated failure\n");
    return spawnSyncLike(null, "", command, args, options);
  };
  await assert.rejects(createWorktree({ cwd: root, branch: "feature/failing", spawnImpl: failing }), /simulated failure\. The repository was left unchanged\./);
  assert(!existsSync(path.join(base, "my repo-feature-failing")));
  assert.equal(git(root, "branch", "--list", "feature/failing"), "");

  const removed = await removeWorktree({ cwd: root, worktreePath: nested.path, force: true });
  assert.equal(removed.path, nested.path);
  assert(!existsSync(nested.path));
  await assert.rejects(removeWorktree({ cwd: root, worktreePath: root }), /main worktree cannot be removed/);

  const timedOut = await runGit(["log"], { cwd: root, timeoutMs: 1, spawnImpl: (command, args, options) => spawnSyncLike(null, "", command, args, { ...options, delayMs: 200 }) });
  assert.equal(timedOut.timedOut, true);
});

// A child process stand-in: either a canned failure or the real git invocation.
function spawnSyncLike(forcedCode, stderrText, command, args, options) {
  const { spawn } = require_child_process();
  if (forcedCode !== null) {
    const { EventEmitter } = require_events();
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.emit("data", Buffer.from(stderrText));
      child.emit("close", forcedCode);
    });
    return child;
  }
  if (options && options.delayMs) {
    return spawn("sleep", ["1"], { stdio: ["ignore", "pipe", "pipe"] });
  }
  return spawn(command, args, { ...options, env: { ...GIT_ENV, ...options.env } });
}

function require_child_process() {
  return process.getBuiltinModule("node:child_process");
}

function require_events() {
  return process.getBuiltinModule("node:events");
}

// ---- protocol ------------------------------------------------------------------------------

test("validateRequest bounds tab, session, directory, and worktree requests", () => {
  const valid = (type, fields) => validateRequest({ v: 1, id: "x", type, ...fields });
  assert.equal(valid("prompt", { message: "hi", tab: "tab-2" }).tab, "tab-2");
  assert.equal(valid("prompt", { message: "hi" }).tab, undefined);
  assert.throws(() => valid("prompt", { message: "hi", tab: "" }), /tab must be/);
  assert.throws(() => valid("prompt", { message: "hi", tab: "t".repeat(LIMITS.maxTabIdCharacters + 1) }), /tab must be/);
  assert.deepEqual(valid("tab_open", {}), { id: "x", type: "tab_open", cwd: "", sessionPath: "", name: "" });
  assert.equal(valid("tab_open", { cwd: "~/x" }).cwd, "~/x");
  assert.throws(() => valid("tab_open", { cwd: "relative" }), /absolute/);
  assert.throws(() => valid("tab_open", { sessionPath: "rel.jsonl" }), /absolute/);
  assert.equal(valid("tab_close", {}).force, false);
  assert.throws(() => valid("tab_close", { force: "yes" }), /force must be boolean/);
  assert.throws(() => valid("tab_rename", { name: "n".repeat(LIMITS.maxTabNameCharacters + 1) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => valid("tab_move", { delta: 2 }), /delta/);
  assert.throws(() => valid("session_switch", { sessionPath: "/a/b.txt" }), /\.jsonl/);
  assert.equal(valid("session_switch", { sessionPath: "/a/b.jsonl" }).sessionPath, "/a/b.jsonl");
  assert.equal(valid("directory_list", {}).showHidden, false);
  assert.throws(() => valid("directory_create", { path: "/a" }), /string name/);
  assert.throws(() => valid("directory_pin", { path: "x" }), /absolute/);
  assert.throws(() => valid("worktree_create", { branch: "b" }), /confirmed: true/);
  assert.deepEqual(valid("worktree_create", { branch: "b", confirmed: true }), { id: "x", type: "worktree_create", branch: "b", base: "", path: "", confirmed: true, openTab: true });
  assert.equal(valid("worktree_create", { branch: "b", confirmed: true, openTab: false }).openTab, false);
});

test("open_path validation, session statistics, recent actions, and diagnostics", async (t) => {
  const root = await temporary(t);
  await writeFile(path.join(root, "SKILL.md"), "# skill\n");
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push([command, args]);
    const { EventEmitter } = process.getBuiltinModule("node:events");
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  assert.deepEqual(await openLocalPath({ path: path.join(root, "SKILL.md"), spawnImpl }), { delivered: true, path: path.join(root, "SKILL.md") });
  assert.deepEqual(calls, [["xdg-open", [path.join(root, "SKILL.md")]]]);
  assert.match((await openLocalPath({ path: path.join(root, "missing.md"), spawnImpl })).reason, /does not exist/);
  assert.match((await openLocalPath({ path: root, spawnImpl })).reason, /regular files/);
  assert.match((await openLocalPath({ path: "relative.md", spawnImpl })).reason, /absolute/);
  assert.equal(calls.length, 1, "invalid paths never reach xdg-open");
  assert.throws(() => validateRequest({ v: 1, id: "o", type: "open_path", path: "x" }), /absolute/);
  assert.throws(() => validateRequest({ v: 1, id: "r", type: "recent_action", action: "bad key!" }), /plain identifiers/);
  assert.equal(validateRequest({ v: 1, id: "r", type: "recent_action", action: "action:toggle-compact" }).action, "action:toggle-compact");

  const backend = await readyBackend(t, { cwd: root });
  const stats = await backend.send("session_stats");
  assert.deepEqual(stats.data, { userMessages: 3, assistantMessages: 2, toolCalls: 1, totalMessages: 7, tokens: { input: 50_000, output: 10_000, cacheRead: 40_000, cacheWrite: 5_000, total: 105_000 }, cost: 0.45, context: { tokens: 60_000, contextWindow: 200_000, percent: 30 } });
  const suppressed = await backend.send("open_path", { path: path.join(root, "SKILL.md") });
  assert.equal(suppressed.data.suppressed, "smoke-mode");
  assert.deepEqual((await backend.send("recent_action", { action: "action:search" })).data.recentActions, ["action:search"]);
  assert.deepEqual((await backend.send("recent_action", { action: "action:events" })).data.recentActions, ["action:events", "action:search"]);
  assert.deepEqual((await backend.send("hello")).data.recentActions, ["action:events", "action:search"]);
  const diagnostics = await backend.send("diagnostics");
  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.data.tabs.tabs.length, 1);
  assert(diagnostics.data.stats.sequence > 0);
  assert.equal(typeof diagnostics.data.paths.state, "string");
  assert.equal(diagnostics.data.limits.maxTabs, LIMITS.maxTabs);
});

// ---- backend integration -------------------------------------------------------------------

async function readyBackend(t, options = {}) {
  const backend = await startBackend({ startupTimeoutMs: 1_000, ...options });
  t.after(async () => {
    if (backend.exit) return;
    backend.child.kill("SIGKILL");
    await backend.exitPromise;
  });
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  return backend;
}

test("tabs run isolated sessions, badge inactive tabs, replay transcripts on select, refuse to close busy tabs, and restore after restart", async (t) => {
  const first = await temporary(t);
  const second = await temporary(t);
  const stateHome = await temporary(t, "qt-webui-state-");
  const backend = await readyBackend(t, { cwd: first, env: { XDG_STATE_HOME: stateHome } });
  const hello = await backend.send("hello");
  assert.equal(hello.data.tabs.tabs.length, 1);
  const firstTab = hello.data.tabs.activeTab;
  assert.equal(hello.data.tabs.tabs[0].cwd, await realpath(first));
  assert(backend.events.every((event) => event.type.startsWith("backend.") || event.type === "tabs.update" || event.type === "transcript.reset" || event.type === "settings.changed" || event.tab === firstTab), "session events carry the tab id");

  const opened = await backend.send("tab_open", { cwd: second });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const secondTab = opened.data.tab.id;
  assert.notEqual(secondTab, firstTab);
  assert.equal(opened.data.tab.cwd, await realpath(second));
  await backend.waitForEvent("pi.status", (event) => event.tab === secondTab && event.statusKind === "ready");
  assert.deepEqual((await backend.send("tabs_list")).data.tabs.map((tab) => tab.id), [firstTab, secondTab]);
  assert.equal((await backend.send("tabs_list")).data.activeTab, secondTab);

  // Work in the first (inactive) tab: its events are tagged and its unread badge grows.
  const promptInFirst = await backend.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__", tab: firstTab });
  assert.equal(promptInFirst.ok, true);
  await backend.waitForEvent("pi.status", (event) => event.tab === firstTab && event.statusKind === "ready" && event.seq > backend.events.find((entry) => entry.type === "message.user" && entry.tab === firstTab).seq);
  await backend.send("prompt", { message: "__QT_WEBUI_STREAM__", tab: firstTab });
  await backend.waitForEvent("run.end", (event) => event.tab === firstTab);
  const badges = await backend.waitForEvent("tabs.update", (event) => event.tabs.find((tab) => tab.id === firstTab).unread >= 1 && event.tabs.find((tab) => tab.id === firstTab).needsInput === 5);
  assert.equal(badges.tabs.find((tab) => tab.id === secondTab).unread, 0);
  const secondUser = backend.events.filter((event) => event.type === "message.user");
  assert(secondUser.every((event) => event.tab === firstTab));

  // Selecting the first tab replays its bounded transcript and reports pending dialogs.
  const beforeSelect = backend.events.length;
  const selected = await backend.send("tab_select", { tab: firstTab });
  assert.equal(selected.data.tab.id, firstTab);
  assert.equal(selected.data.session.dialogs.length, 5);
  assert.equal(selected.data.session.statusRecords.length, 4);
  const replayed = backend.events.slice(beforeSelect).filter((event) => event.tab === firstTab && (event.type === "transcript.reset" || event.type === "transcript.row"));
  assert.equal(replayed[0].type, "transcript.reset");
  assert.deepEqual(replayed.slice(1).map((event) => event.row.kind), ["user", "user", "thinking", "text", "tool"]);
  assert.equal(replayed.at(-1).row.toolOutput, "final tool output");
  assert.equal((await backend.send("tabs_list")).data.tabs.find((tab) => tab.id === firstTab).unread, 0);
  for (const id of ["dialog-select", "dialog-confirm", "dialog-input", "dialog-editor", "dialog-cancel"]) await backend.send("extension_response", { requestId: id, cancelled: true, tab: firstTab });

  // A busy tab refuses to close without force; force stops its Pi tree.
  await backend.send("prompt", { message: "__QT_WEBUI_DELAYED_ABORT__", tab: secondTab });
  await backend.waitForEvent("run.start", (event) => event.tab === secondTab);
  const refused = await backend.send("tab_close", { tab: secondTab });
  assert.equal(refused.error.code, "busy");
  const secondPid = (await backend.send("tabs_list")).data.tabs.find((tab) => tab.id === secondTab).pid;
  const closed = await backend.send("tab_close", { tab: secondTab, force: true });
  assert.equal(closed.data.closed, secondTab);
  assert.equal(closed.data.activeTab, firstTab);
  await waitUntil(() => !processAlive(secondPid), "second Pi to exit");
  assert.deepEqual((await backend.send("tabs_list")).data.tabs.map((tab) => tab.id), [firstTab]);

  // Rename reaches Pi and the saved layout; closing the last tab replaces it with a fresh one.
  const renamed = await backend.send("tab_rename", { name: "Renamed tab" });
  assert.deepEqual({ name: renamed.data.tab.name, sessionRenamed: renamed.data.sessionRenamed }, { name: "Renamed tab", sessionRenamed: true });
  await backend.waitForEvent("pi.runtime", (event) => event.tab === firstTab && event.sessionName === "Renamed tab");
  const saved = JSON.parse(await readFile(path.join(stateHome, "qt-webui", "state.json"), "utf8"));
  assert.deepEqual(saved.tabs, [{ cwd: await realpath(first), sessionFile: "/tmp/fixture-session.jsonl", name: "Renamed tab" }]);
  const lastClosed = await backend.send("tab_close", {});
  assert.equal(lastClosed.data.closed, firstTab);
  const remaining = (await backend.send("tabs_list")).data.tabs;
  assert.equal(remaining.length, 1);
  assert.notEqual(remaining[0].id, firstTab);
  assert.equal(remaining[0].cwd, await realpath(first));
  const captured = await backend.readCapture();
  assert.deepEqual(captured.filter((command) => command.type === "set_session_name").map((command) => command.name), ["Renamed tab"]);
  await backend.send("shutdown");
  await backend.exitPromise;

  // Restart: the saved layout is restored (the vanished directory is skipped) and the caller
  // directory gets a tab that is selected.
  await writeFile(path.join(stateHome, "qt-webui", "state.json"), JSON.stringify({ tabs: [{ cwd: await realpath(second), sessionFile: "/tmp/resume-me.jsonl", name: "Second" }, { cwd: path.join(first, "gone") }], activeTab: 0 }));
  await writeFile("/tmp/resume-me.jsonl", "{\"type\":\"session\",\"id\":\"resume-me\"}\n");
  t.after(() => rm("/tmp/resume-me.jsonl", { force: true }));
  const restarted = await startBackend({ cwd: first, env: { XDG_STATE_HOME: stateHome }, startupTimeoutMs: 1_000 });
  t.after(async () => {
    if (restarted.exit) return;
    restarted.child.kill("SIGKILL");
    await restarted.exitPromise;
  });
  const tabsAfter = await restarted.waitForEvent("tabs.update", (event) => event.tabs.length === 2);
  assert.deepEqual(tabsAfter.tabs.map((tab) => [tab.cwd, tab.name]), [[await realpath(second), "Second"], [await realpath(first), ""]]);
  assert.equal(tabsAfter.activeTab, tabsAfter.tabs[1].id, "the launch directory is selected");
  await restarted.waitForEvent("notice", (event) => /folder no longer exists/.test(event.message));
  const resumedTab = tabsAfter.tabs[0].id;
  await restarted.waitForEvent("pi.runtime", (event) => event.tab === resumedTab && event.sessionFile === "/tmp/resume-me.jsonl", 10_000);
  const rows = restarted.events.filter((event) => event.type === "transcript.row" && event.tab === resumedTab);
  assert.deepEqual(rows.map((event) => event.row.kind), ["user", "thinking", "text", "tool", "text"], "the restored tab resumed its session history");
  await restarted.send("shutdown");
  await restarted.exitPromise;
});

test("broader resource profiles reconcile every idle matching tab before commit and the next turn sees them", async (t) => {
  const first = await temporary(t);
  const second = await temporary(t);
  const backend = await readyBackend(t, { cwd: first });
  const hello = await backend.send("hello");
  const firstTab = hello.data.tabs.activeTab;
  assert.equal((await backend.send("tools_set", { tab: firstTab, scope: "session", enabledTools: [] })).ok, true);

  const opened = await backend.send("tab_open", { cwd: second });
  const secondTab = opened.data.tab.id;
  await backend.waitForEvent("pi.status", (event) => event.tab === secondTab && event.statusKind === "ready");

  const global = await backend.send("skills_set", { tab: firstTab, scope: "global", enabledSkills: ["review"] });
  assert.equal(global.ok, true, JSON.stringify(global));
  const exactModel = await backend.send("tools_set", { tab: firstTab, scope: "model", enabledTools: ["write"] });
  assert.equal(exactModel.ok, true, JSON.stringify(exactModel));

  // No tab selection and no resources_state refresh occurs before this turn in the other tab.
  const beforeTurn = backend.events.length;
  assert.equal((await backend.send("prompt", { tab: secondTab, message: "__QT_WEBUI_EFFECTIVE__" })).ok, true);
  const applied = await backend.waitForEvent("extension.notify", (event) => event.seq > (backend.events[beforeTurn - 1]?.seq || 0)
    && event.tab === secondTab && event.message.startsWith("QT_WEBUI_HELPER_EFFECTIVE "));
  assert.deepEqual(JSON.parse(applied.message.slice("QT_WEBUI_HELPER_EFFECTIVE ".length)), {
    tools: ["write"], skills: ["review"], sampling: {},
  });
  await backend.waitForEvent("pi.status", (event) => event.tab === secondTab && event.statusKind === "ready" && event.seq > applied.seq);

  const secondState = await backend.send("resources_state", { tab: secondTab });
  assert.deepEqual(secondState.data.profiles.session.tools, null);
  assert.deepEqual(secondState.data.effective.tools, ["write"]);
  assert.deepEqual(secondState.data.effective.skills, ["review"]);
  assert.equal(secondState.data.effective.skillsSource, "global");
  assert.equal((await backend.send("tools_set", { tab: secondTab, scope: "session", enabledTools: ["write"] })).ok, true);

  const firstState = await backend.send("resources_state", { tab: firstTab });
  assert.deepEqual(firstState.data.profiles.session.tools, []);
  assert.deepEqual(firstState.data.effective.tools, []);
  const secondAgain = await backend.send("resources_state", { tab: secondTab });
  assert.deepEqual(secondAgain.data.profiles.session.tools, ["write"]);

  await backend.send("prompt", { message: "__QT_WEBUI_DELAYED_ABORT__", tab: secondTab });
  await backend.waitForEvent("run.start", (event) => event.tab === secondTab);
  const refused = await backend.send("skills_set", { tab: firstTab, scope: "global", enabledSkills: [] });
  assert.equal(refused.error.code, "busy", "a broader change is refused while any affected tab is active");
  await backend.send("abort", { tab: secondTab });
  await backend.waitForEvent("run.end", (event) => event.tab === secondTab);
  assert(backend.events.filter((event) => event.type === "resources.changed").every((event) => event.tab === firstTab || event.tab === secondTab));
});

test("broader profile transactions fence compaction and session lifecycle through commit and rollback", async (t) => {
  async function waitForHelperCalls(backend, count) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const calls = (await backend.readCapture()).filter((command) => command.type === "prompt" && command.message.startsWith("/qt-webui-helper "));
      if (calls.length >= count) return calls;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`timed out waiting for ${count} helper calls`);
  }

  async function assertFencedRequests(backend, tab, label) {
    const responses = await Promise.all([
      backend.send("compact", { tab }),
      backend.send("restart", { tab }),
      backend.send("tab_close", { tab, force: true }),
      backend.send("session_switch", { tab, sessionPath: `/tmp/${label}-resume.jsonl` }),
      backend.send("session_new", { tab }),
    ]);
    assert.deepEqual(responses.map((response) => response.error?.code), ["busy", "busy", "busy", "busy", "busy"], `${label} keeps every lifecycle request fenced`);
  }

  async function assertNormalAfterSettlement(backend, tab, label) {
    const compacted = await backend.send("compact", { tab });
    assert.equal(compacted.ok, true, `${label}: compact follows its normal contract after settlement`);
    const switched = await backend.send("session_switch", { tab, sessionPath: `/tmp/${label}-resume.jsonl` });
    assert.equal(switched.ok, true, `${label}: session switch succeeds after settlement`);
    const fresh = await backend.send("session_new", { tab });
    assert.equal(fresh.ok, true, `${label}: new session succeeds after settlement`);
    const beforeRestart = backend.events.at(-1)?.seq || 0;
    const restarted = await backend.send("restart", { tab });
    assert.equal(restarted.ok, true, `${label}: restart succeeds after settlement`);
    await backend.waitForEvent("pi.status", (event) => event.tab === tab && event.statusKind === "ready" && event.seq > beforeRestart);
    const closed = await backend.send("tab_close", { tab });
    assert.equal(closed.ok, true, `${label}: ordinary non-force close retains its normal idle semantics`);
  }

  async function runScenario(label, rollback) {
    const first = await temporary(t, `qt-webui-lifecycle-${label}-a-`);
    const second = await temporary(t, `qt-webui-lifecycle-${label}-b-`);
    const backend = await readyBackend(t, { cwd: first, env: { QT_WEBUI_FIXTURE_HELPER_NOTIFY_DELAY_MS: "100" } });
    const firstTab = (await backend.send("hello")).data.tabs.activeTab;
    const opened = await backend.send("tab_open", { cwd: second });
    const secondTab = opened.data.tab.id;
    await backend.waitForEvent("pi.status", (event) => event.tab === secondTab && event.statusKind === "ready");
    if (rollback) await mkdir(path.join(backend.temporary, "config", "qt-webui", "resources.json"), { recursive: true });

    const transaction = backend.send("skills_set", { tab: firstTab, scope: "global", enabledSkills: ["review"] });
    await waitForHelperCalls(backend, 1);
    await assertFencedRequests(backend, secondTab, `${label}-apply`);
    if (rollback) {
      await waitForHelperCalls(backend, 5);
      await assertFencedRequests(backend, secondTab, `${label}-rollback`);
    }

    const settled = await transaction;
    if (rollback) {
      assert.equal(settled.error.code, "internal_error");
    } else {
      assert.equal(settled.ok, true, JSON.stringify(settled));
    }
    await assertNormalAfterSettlement(backend, secondTab, label);
  }

  await runScenario("commit", false);
  await runScenario("rollback", true);
});

test("persisted sessions can be listed, resumed with history and an interruption warning, and replaced by a new session", async (t) => {
  const cwd = await temporary(t);
  const agentDir = await temporary(t, "qt-webui-agent-");
  const directory = sessionDirectoryFor(cwd, { PI_CODING_AGENT_DIR: agentDir });
  await writeSession(directory, "one_resume-me.jsonl", { id: "resume-me", cwd, name: "Resumable", messages: [{ role: "user", content: "earlier question" }] });
  await writeSession(directory, "two_interrupted.jsonl", { id: "interrupted", cwd, messages: [{ role: "user", content: "please continue" }] });
  await writeSession(directory, "three_cancel-me.jsonl", { id: "cancel-me", cwd });
  const backend = await readyBackend(t, { cwd, env: { PI_CODING_AGENT_DIR: agentDir } });
  const listed = await backend.send("sessions_list");
  assert.deepEqual(listed.data.sessions.map((session) => [session.id, session.name, session.messageCount]).sort(), [["cancel-me", "", 0], ["interrupted", "", 1], ["resume-me", "Resumable", 1]]);
  assert.equal(listed.data.current, "/tmp/fixture-session.jsonl");

  const resumePath = path.join(directory, "one_resume-me.jsonl");
  const before = backend.events.length;
  const resumed = await backend.send("session_switch", { sessionPath: resumePath });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.deepEqual({ file: resumed.data.sessionFile, name: resumed.data.sessionName, rows: resumed.data.rows, interrupted: resumed.data.interrupted }, { file: resumePath, name: "Resumed session", rows: 5, interrupted: false });
  const replay = backend.events.slice(before).filter((event) => event.type === "transcript.reset" || event.type === "transcript.row");
  assert.equal(replay[0].type, "transcript.reset");
  assert.deepEqual(replay.slice(1).map((event) => [event.row.kind, event.row.text || event.row.toolName]), [["user", "earlier question"], ["thinking", "earlier thinking"], ["text", "earlier **answer**"], ["tool", "read"], ["text", "done"]]);
  assert.equal(replay[4].row.toolOutput, "file contents");
  const runtime = backend.events.filter((event) => event.type === "pi.runtime").at(-1);
  assert.equal(runtime.sessionFile, resumePath);

  const interrupted = await backend.send("session_switch", { sessionPath: path.join(directory, "two_interrupted.jsonl") });
  assert.equal(interrupted.data.interrupted, true);
  await backend.waitForEvent("notice", (event) => /did not complete/.test(event.message));
  const interruptedRow = backend.events.filter((event) => event.type === "transcript.row").at(-1);
  assert.deepEqual({ text: interruptedRow.row.text, attachments: interruptedRow.row.attachments }, { text: "please continue", attachments: "1 image" });

  const cancelled = await backend.send("session_switch", { sessionPath: path.join(directory, "three_cancel-me.jsonl") });
  assert.equal(cancelled.error.code, "pi_error");
  assert.match(cancelled.error.message, /cancelled the session switch/);

  const fresh = await backend.send("session_new");
  assert.equal(fresh.ok, true);
  assert.match(fresh.data.sessionFile, /fixture-session-1\.jsonl$/);
  assert.equal(backend.events.filter((event) => event.type === "transcript.reset").length, 3, "two switches plus new (no hello replay in this test)");

  await backend.send("prompt", { message: "__QT_WEBUI_DELAYED_ABORT__" });
  await backend.waitForEvent("run.start");
  assert.equal((await backend.send("session_new")).error.code, "busy");
  assert.equal((await backend.send("session_switch", { sessionPath: resumePath })).error.code, "busy");
  await backend.send("abort");
  await backend.waitForEvent("run.end");
  const commands = await backend.readCapture();
  assert.deepEqual(commands.filter((command) => command.type === "switch_session").map((command) => path.basename(command.sessionPath)), ["one_resume-me.jsonl", "two_interrupted.jsonl", "three_cancel-me.jsonl"]);
  assert.equal(commands.filter((command) => command.type === "get_messages").length, 2, "history is read only after a switch Pi accepted");
});

test("directories and worktrees are served over the protocol and a worktree opens in a new tab", async (t) => {
  const { base, root } = await makeRepository(t);
  const stateHome = await temporary(t, "qt-webui-state-");
  const backend = await readyBackend(t, { cwd: root, env: { XDG_STATE_HOME: stateHome, ...GIT_ENV } });
  const listing = await backend.send("directory_list", { path: base });
  assert.equal(listing.ok, true, JSON.stringify(listing));
  assert.deepEqual(listing.data.entries.map((entry) => [entry.name, entry.git]), [["repo", true]]);
  assert.deepEqual({ recent: listing.data.recent, pinned: listing.data.pinned }, { recent: [], pinned: [] });
  const created = await backend.send("directory_create", { path: base, name: "new folder" });
  assert.equal(created.data.path, path.join(await realpath(base), "new folder"));
  assert.deepEqual((await backend.send("directory_pin", { path: created.data.path })).data.pinned, [created.data.path]);
  assert.equal((await backend.send("directory_list", { path: "/definitely/missing/path" })).error.code, "rejected");

  assert.equal((await backend.send("worktrees_list")).data.worktrees.length, 1);
  const unconfirmed = await backend.send("worktree_create", { branch: "feature/ui" });
  assert.equal(unconfirmed.error.code, "invalid_request");
  const plan = await backend.send("worktree_plan", { branch: "feature/ui" });
  assert.deepEqual({ branch: plan.data.branch, path: plan.data.path, base: plan.data.base, detached: plan.data.detachedBase, nested: plan.data.nested, problems: plan.data.problems }, { branch: "feature/ui", path: path.join(await realpath(base), "repo-feature-ui"), base: "main", detached: false, nested: false, problems: [] });
  assert.deepEqual((await backend.send("worktree_plan", { branch: "main", path: "." })).data.problems, ["The worktree path must differ from the repository", `${await realpath(root)} already exists`, "Branch main already exists"]);
  assert.equal((await backend.send("worktree_plan", { branch: "bad name" })).error.code, "invalid_request");
  const worktree = await backend.send("worktree_create", { branch: "feature/ui", confirmed: true });
  assert.equal(worktree.ok, true, JSON.stringify(worktree));
  assert.equal(worktree.data.worktree.path, path.join(await realpath(base), "repo-feature-ui"));
  assert.equal(worktree.data.tab.tab.cwd, worktree.data.worktree.path);
  assert.equal((await backend.send("tabs_list")).data.activeTab, worktree.data.tab.tab.id);
  await backend.waitForEvent("pi.status", (event) => event.tab === worktree.data.tab.tab.id && event.statusKind === "ready");
  const conflict = await backend.send("worktree_create", { branch: "feature/ui", confirmed: true, tab: (await backend.send("tabs_list")).data.tabs[0].id });
  assert.equal(conflict.error.code, "rejected");
  const state = JSON.parse(await readFile(path.join(stateHome, "qt-webui", "state.json"), "utf8"));
  assert.deepEqual(state.recentDirectories, [worktree.data.worktree.path]);
  assert.deepEqual(state.tabs.map((tab) => tab.name), ["", "feature/ui"]);
});

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function waitUntil(check, description, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${description}`));
      setTimeout(tick, 25);
    };
    tick();
  });
}
