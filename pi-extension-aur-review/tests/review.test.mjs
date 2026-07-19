import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import aurReviewExtension, { parseAurReviewArgs } from "../index.ts";
import { captureGitSnapshot, MAX_UNTRACKED_HASH_FILES, MAX_UNTRACKED_TOTAL_HASH_BYTES, resolveExplicitReportPaths } from "../src/git.ts";
import {
  approveReview,
  assertCurrentFingerprint,
  closeReview,
  currentReview,
  declineReview,
  refreshReview,
  reviewRpcPayload,
  startReview,
} from "../src/review.ts";
import { isReviewSnapshot, readReviewSnapshot, writeReviewSnapshot } from "../src/storage.ts";
import { AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH } from "../src/types.ts";

const reviewModuleUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "review.ts")).href;
const childDecisionScript = `
const review = await import(process.env.AUR_REVIEW_TEST_REVIEW_MODULE);
const [operation, root] = process.argv.slice(1);
try {
  const snapshot = operation === "approve"
    ? await review.approveReview(root)
    : await review.declineReview(root, "Concurrent child-process decline");
  process.stdout.write(JSON.stringify({ ok: true, state: snapshot.decision.state }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
}
`;

async function childDecision(operation, root, agentDir) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", childDecisionScript, operation, root], {
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, AUR_REVIEW_TEST_REVIEW_MODULE: reviewModuleUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`child ${operation} exited ${code}: ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`child ${operation} returned invalid JSON: ${stdout}\n${stderr}`)); }
    });
  });
}

async function tempRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aur-review-test-"));
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "aur-review-agent-"));
  const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "AUR Review Test");
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  await writeFile(path.join(root, "deleted.txt"), "delete me\n");
  await writeFile(path.join(root, "rename-me.txt"), "rename me\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  t.after(async () => {
    if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(agentDir, { recursive: true, force: true })]);
  });
  return { root, agentDir, git };
}

test("fingerprint binds staged, unstaged, deleted, renamed, and untracked state", async (t) => {
  const { root, git } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "unstaged content\n");
  await writeFile(path.join(root, "staged.txt"), "staged content\n");
  git("add", "staged.txt");
  git("rm", "-q", "deleted.txt");
  git("mv", "rename-me.txt", "renamed.txt");
  await writeFile(path.join(root, "report final.md"), "# Review report\n");

  const first = await captureGitSnapshot(root);
  assert.equal(first.changedFileTotal, 5);
  assert.equal(first.stats.staged >= 3, true, "staged add/delete/rename should be represented");
  assert.equal(first.stats.unstaged, 1);
  assert.equal(first.stats.untracked, 1);
  assert.equal(first.stats.deleted, 1);
  assert.equal(first.stats.renamed, 1);
  assert.ok(first.changedFiles.some((file) => file.path === "renamed.txt" && file.oldPath === "rename-me.txt" && file.renamed));
  assert.deepEqual(first.reportCandidates, [{ path: "report final.md", size: 16, source: "changed-file" }]);

  await writeFile(path.join(root, "report final.md"), "# Review report changed\n");
  const second = await captureGitSnapshot(root);
  assert.notEqual(second.fingerprint, first.fingerprint, "untracked content must invalidate the review fingerprint");
});

test("review records are durable outside the repository and decisions fail stale", async (t) => {
  const { root, agentDir, git } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "pending review\n");
  await writeFile(path.join(root, "reports.md"), "# Report\n");
  const started = await startReview(root, ["reports.md"]);
  assert.equal(started.decision.state, "pending");
  assert.equal(started.reportCandidates[0].source, "explicit");
  assert.match(started.fingerprint, /^[a-f0-9]{64}$/);
  const stored = await currentReview(root);
  assert.equal(stored?.fingerprint, started.fingerprint);

  const storageRoot = path.join(agentDir, "aur-review", "v2", "reviews");
  assert.equal((await lstat(storageRoot)).isDirectory(), true);
  assert.equal((await readFile(path.join(root, ".gitignore"), "utf8").catch(() => "")).includes("aur-review"), false, "review metadata must not be created in the repo");

  await writeFile(path.join(root, "tracked.txt"), "review changed\n");
  await assert.rejects(() => approveReview(root), /Review is stale/);
  const staleRecord = await currentReview(root);
  assert.ok(staleRecord?.decision.staleCheckedAt, "stale check is persisted without approving");

  const refreshed = await refreshReview(root);
  assert.equal(refreshed.decision.state, "pending");
  assert.notEqual(refreshed.fingerprint, started.fingerprint);
  await assert.rejects(() => declineReview(root, "   "), /comments are required/i);
  const declined = await declineReview(root, "Please update the package metadata.\nThen rerun validation.");
  assert.equal(declined.decision.state, "declined");
  assert.equal(declined.decision.comments, "Please update the package metadata.\nThen rerun validation.");
  assert.equal((await readReviewSnapshot(root))?.decision.state, "declined");

  const closed = await closeReview(root);
  assert.equal(closed.decision.state, "closed");
  assert.notEqual(closed.decision.state, "approved");
  git("status", "--porcelain");
});

test("staged snapshots ignore unrelated worktree changes and fail stale after index changes", async (t) => {
  const { root, git } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "staged v1\n");
  git("add", "tracked.txt");
  const started = await startReview(root, [], { scope: "staged", origin: "guided-git" });
  assert.equal(started.scope, "staged");
  assert.equal(started.origin, "guided-git");
  assert.equal(started.stats.staged, 1);
  assert.equal(started.stats.unstaged, 0);
  assert.equal(started.stats.untracked, 0);
  assert.match(started.stagedContentHash || "", /^[a-f0-9]{64}$/i, "staged reviews persist an exact cached-diff hash");
  const stagedPayload = reviewRpcPayload(started);
  assert.equal(stagedPayload.stagedContentHash, started.stagedContentHash, "RPC payload carries the staged-content binding");
  const approved = await approveReview(root);
  assert.equal(approved.decision.reviewedStagedContentHash, started.stagedContentHash, "approval binds the exact staged-content hash");
  assert.equal(isReviewSnapshot(approved), true, "durable staged approval validates its content binding");
  assert.equal(isReviewSnapshot({ ...approved, stagedContentHash: undefined }), false, "staged records require a durable staged-content hash");
  assert.equal(isReviewSnapshot({ ...approved, decision: { ...approved.decision, reviewedStagedContentHash: "b".repeat(64) } }), false, "terminal staged decisions require the matching durable staged-content hash");

  await writeFile(path.join(root, "tracked.txt"), "unstaged only\n");
  await writeFile(path.join(root, "unrelated.txt"), "untracked only\n");
  const unchangedIndex = await captureGitSnapshot(root, [], "staged");
  assert.equal(unchangedIndex.fingerprint, started.fingerprint, "unstaged and untracked changes must not affect a staged review");
  await assert.doesNotReject(() => assertCurrentFingerprint(root, approved));

  await writeFile(path.join(root, "tracked.txt"), "staged v2\n");
  git("add", "tracked.txt");
  await assert.rejects(() => assertCurrentFingerprint(root, approved), /stale/i);
  const refreshed = await refreshReview(root);
  assert.equal(refreshed.scope, "staged", "refresh must preserve stored staged scope");
  assert.equal(refreshed.origin, "guided-git", "refresh must preserve stored guided origin");
});

test("conventional aur-scan reports are bounded and newest first", async (t) => {
  const { root, git } = await tempRepo(t);
  const scanDir = path.join(root, "dev", "scripts", "aur-scan");
  const older = path.join(scanDir, "older-security-review.md");
  const newer = path.join(scanDir, "newer-security-review.md");
  await mkdir(scanDir, { recursive: true });
  await writeFile(older, "old\n");
  await writeFile(newer, "new\n");
  const base = Date.now() / 1000;
  await utimes(older, base - 60, base - 60);
  await utimes(newer, base, base);
  git("add", "dev/scripts/aur-scan");
  git("commit", "-qm", "add historical reports");
  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  const snapshot = await captureGitSnapshot(root);
  const reports = snapshot.reportCandidates.filter((report) => report.source === "conventional" && report.path.startsWith("dev/scripts/aur-scan/"));
  assert.deepEqual(reports.map((report) => report.path), ["dev/scripts/aur-scan/newer-security-review.md", "dev/scripts/aur-scan/older-security-review.md"]);
});

test("report discovery rejects traversal and symlink escapes", async (t) => {
  const { root } = await tempRepo(t);
  const outside = path.join(os.tmpdir(), `aur-review-outside-${process.pid}.md`);
  await writeFile(outside, "outside\n");
  t.after(() => rm(outside, { force: true }));
  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  await symlink(outside, path.join(root, "escaped-report.md"));
  await assert.rejects(() => resolveExplicitReportPaths(root, ["../outside.md"]), /inside the repository/);
  await assert.rejects(() => resolveExplicitReportPaths(root, ["escaped-report.md"]), /inside the repository/);

  await writeFile(path.join(root, "valid-report.md"), "valid\n");
  await chmod(path.join(root, "valid-report.md"), 0o644);
  assert.deepEqual(await resolveExplicitReportPaths(root, ["valid-report.md"]), [{ path: "valid-report.md", size: 6, source: "explicit" }]);
});

test("payload excludes report contents and persisted schema fails closed", async (t) => {
  const { root } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  await writeFile(path.join(root, "audit-report.md"), "TOP SECRET REPORT CONTENT\n");
  const snapshot = await startReview(root);
  const payload = reviewRpcPayload(snapshot);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /audit-report\.md/);
  assert.doesNotMatch(serialized, /TOP SECRET REPORT CONTENT/);
  assert.equal(payload.type, "firstpick.pi-extension-aur-review.review");
  assert.equal(payload.version, 3);
  assert.equal(payload.scope, "working-tree");
  assert.equal(payload.origin, "standalone");
  assert.equal(isReviewSnapshot({ ...snapshot, unexpected: true }), false, "unknown persisted fields must fail closed");
  assert.equal(isReviewSnapshot({ ...snapshot, schemaVersion: 1 }), false, "old records must fail closed after the unreleased schema update");
  assert.equal(isReviewSnapshot({ ...snapshot, scope: "staged" }), false, "invalid scope/origin pairs must fail closed");
  assert.equal(isReviewSnapshot({ ...snapshot, fingerprint: "not-a-hash" }), false);
  assert.equal(snapshot.stagedContentHash, undefined, "standalone working-tree snapshots do not manufacture a staged-content hash");
  await assert.doesNotReject(() => assertCurrentFingerprint(root, snapshot));
});

test("POSIX invalid-byte paths retain raw status bytes for untracked, staged, and renamed snapshots", async (t) => {
  const { root, git } = await tempRepo(t);
  const bytePath = (prefix) => Buffer.concat([Buffer.from(`${root}${path.sep}${prefix}-`), Buffer.from([0xff]), Buffer.from(".txt")]);
  const untrackedPath = bytePath("untracked");
  await writeFile(untrackedPath, "untracked v1\n");
  const untrackedFirst = await captureGitSnapshot(root);
  assert.ok(untrackedFirst.changedFiles.some((file) => file.path.startsWith("untracked-") && file.path.includes("\ufffd")), "invalid path bytes should only be decoded for display");
  await writeFile(untrackedPath, "untracked v2\n");
  const untrackedSecond = await captureGitSnapshot(root);
  assert.notEqual(untrackedSecond.fingerprint, untrackedFirst.fingerprint, "raw-byte untracked paths must remain hashable and invalidate on content changes");

  const stagedPath = bytePath("staged");
  await writeFile(stagedPath, "staged\n");
  git("add", "-A");
  const staged = await captureGitSnapshot(root, [], "staged");
  assert.ok(staged.changedFiles.some((file) => file.path.startsWith("staged-") && file.path.includes("\ufffd")), "staged invalid-byte names should be represented by bounded display text without changing raw identity");

  git("commit", "-qm", "add invalid byte names");
  const renameFrom = bytePath("rename-from");
  const renameTo = bytePath("rename-to");
  await writeFile(renameFrom, "rename bytes\n");
  git("add", "-A");
  git("commit", "-qm", "add invalid rename source");
  await rename(renameFrom, renameTo);
  git("add", "-A");
  const renamed = await captureGitSnapshot(root, [], "staged");
  assert.ok(renamed.changedFiles.some((file) => file.renamed && file.path.startsWith("rename-to-") && file.oldPath?.startsWith("rename-from-")), "rename records should preserve both raw paths through porcelain-v2 -z parsing");
});

test("display paths reserve room for the truncation ellipsis", async (t) => {
  const { root } = await tempRepo(t);
  const segments = Array.from({ length: 12 }, (_, index) => `${index}-${"nested".repeat(15)}`);
  const relative = path.join(...segments, "review-target.txt");
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), "long path\n");
  const snapshot = await captureGitSnapshot(root);
  const displayed = snapshot.changedFiles.find((file) => file.untracked)?.path || "";
  assert.ok(displayed.endsWith("…"), "long display paths should be visibly truncated");
  assert.ok(displayed.length <= AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH, "display path length includes the ellipsis");
});

test("untracked hashing is deterministic and enforces aggregate file and byte limits", async (t) => {
  const { root } = await tempRepo(t);
  await writeFile(path.join(root, "zeta.txt"), "z\n");
  await writeFile(path.join(root, "alpha.txt"), "a\n");
  const first = await captureGitSnapshot(root);
  const second = await captureGitSnapshot(root);
  assert.equal(second.fingerprint, first.fingerprint, "ordinary untracked snapshots should remain deterministic");
  assert.deepEqual(first.changedFiles.map((file) => file.path), ["alpha.txt", "zeta.txt"], "changed-file summaries should retain raw-byte lexical ordering");

  for (let index = 0; index <= MAX_UNTRACKED_HASH_FILES; index++) {
    await writeFile(path.join(root, `file-limit-${index}.txt`), "x");
  }
  await assert.rejects(() => captureGitSnapshot(root), /At most .* untracked files may be hashed/i);
});

test("untracked aggregate byte safety limit is checked before content reads", async (t) => {
  const { root } = await tempRepo(t);
  const perFile = Math.floor(MAX_UNTRACKED_TOTAL_HASH_BYTES / 3) + 1;
  for (let index = 0; index < 3; index++) {
    const file = path.join(root, `aggregate-${index}.bin`);
    await writeFile(file, "");
    await truncate(file, perFile);
  }
  await assert.rejects(() => captureGitSnapshot(root), /aggregate review snapshot safety limit/i);
});

test("durable writes and decisions serialize same-repository races", async (t) => {
  const { root } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  const started = await startReview(root);

  const originalNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    await Promise.all([writeReviewSnapshot(started), writeReviewSnapshot(started)]);
  } finally {
    Date.now = originalNow;
  }
  assert.equal((await readReviewSnapshot(root))?.fingerprint, started.fingerprint, "same-millisecond storage writes must use distinct temporary names");

  const decisions = await Promise.allSettled([approveReview(root), declineReview(root, "Concurrent decline")]);
  assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1, "only one concurrent pending decision may persist");
  assert.equal(decisions.filter((result) => result.status === "rejected").length, 1, "the losing decision must fail rather than overwrite the winner");
  assert.ok(["approved", "declined"].includes((await currentReview(root))?.decision.state || ""));
});

test("child-process approve versus decline has one durable winner", async (t) => {
  const { root, agentDir } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  await startReview(root);

  const results = await Promise.all([
    childDecision("approve", root, agentDir),
    childDecision("decline", root, agentDir),
  ]);
  const successful = results.filter((result) => result.ok);
  const rejected = results.filter((result) => !result.ok);
  assert.equal(successful.length, 1, `exactly one child transition must win: ${JSON.stringify(results)}`);
  assert.equal(rejected.length, 1, `the losing child must reject rather than overwrite: ${JSON.stringify(results)}`);
  assert.match(rejected[0].error, /changed while this action was in progress|No pending repository review/i);
  assert.equal((await currentReview(root))?.decision.state, successful[0].state, "durable terminal state must agree with the sole successful child transition");
});

test("persisted schema enforces relational invariants without rejecting valid truncation", async (t) => {
  const { root } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  const snapshot = await startReview(root);
  const decidedAt = new Date(Date.parse(snapshot.updatedAt) + 1).toISOString();
  const approved = { ...snapshot, updatedAt: decidedAt, decision: { state: "approved", decidedAt, reviewedFingerprint: snapshot.fingerprint } };
  assert.equal(isReviewSnapshot(approved), true);
  assert.equal(isReviewSnapshot({ ...approved, decision: { ...approved.decision, reviewedFingerprint: "b".repeat(64) } }), false, "decision fingerprint must equal the snapshot fingerprint");
  assert.equal(isReviewSnapshot({ ...approved, decision: { ...approved.decision, comments: "decline text" } }), false, "approved records cannot carry decline comments");
  assert.equal(isReviewSnapshot({ ...snapshot, createdAt: "not-a-timestamp" }), false, "invalid persisted timestamps fail closed");
  assert.equal(isReviewSnapshot({ ...snapshot, changedFileTotal: 2, stats: { ...snapshot.stats, files: 2 } }), false, "non-truncated totals must equal stored summary count");
  const truncated = {
    ...snapshot,
    changedFileTotal: 501,
    changedFilesTruncated: true,
    stats: { ...snapshot.stats, files: 501, unstaged: 501 },
  };
  assert.equal(isReviewSnapshot(truncated), true, "a truncated snapshot may have more total files than its bounded stored array");
});

test("extension uses native confirmation/editor gates and publishes decision events", async (t) => {
  const { root } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  await startReview(root);
  const commands = new Map();
  const tools = new Map();
  const events = [];
  const messages = [];
  const registeredEvents = new Map();
  aurReviewExtension({
    registerCommand(name, options) { commands.set(name, options); },
    registerTool(tool) { tools.set(tool.name, tool); },
    on(name, handler) { registeredEvents.set(name, handler); },
    events: { emit(name, payload) { events.push({ name, payload }); } },
    sendUserMessage(message, options) { messages.push({ message, options }); },
  });
  assert.ok(commands.has("aur-review"));
  assert.ok(tools.has("aur_review_request"));
  assert.deepEqual(tools.get("aur_review_request").parameters.properties.scope.enum, ["working-tree", "staged"], "tool scope must use a Google-compatible string enum");
  assert.deepEqual(tools.get("aur_review_request").parameters.properties.origin.enum, ["standalone", "guided-git"], "tool origin must use a Google-compatible string enum");
  assert.ok(registeredEvents.has("session_start"));

  const notifications = [];
  let confirmCalls = 0;
  let editorCalls = 0;
  const context = {
    cwd: root,
    hasUI: true,
    mode: "tui",
    isIdle: () => true,
    ui: {
      notify(message, level) { notifications.push({ message, level }); },
      select: async () => "Done",
      confirm: async () => { confirmCalls++; return true; },
      editor: async () => { editorCalls++; return "Fix the source array.\nRerun the package test."; },
      setWidget() {},
    },
  };
  await commands.get("aur-review").handler("approve", context);
  assert.equal(confirmCalls, 1, "approval must use the native confirmation gate");
  assert.equal((await currentReview(root))?.decision.state, "approved");
  assert.equal(events.at(-1)?.name, "aur-review:decision");
  assert.equal(events.at(-1)?.payload.decision, "approved");

  await refreshReview(root);
  await commands.get("aur-review").handler("decline", context);
  assert.equal(editorCalls, 1, "decline must collect multiline comments through the native editor");
  assert.equal((await currentReview(root))?.decision.state, "declined");
  assert.equal(events.at(-1)?.payload.decision, "declined");
  assert.match(messages.at(-1)?.message || "", /Make only the necessary changes/);
  assert.equal(messages.at(-1)?.options, undefined, "idle remediation should start immediately rather than queue a follow-up");
  assert.ok(notifications.some((entry) => /approved/i.test(entry.message)));
});

test("RPC close publishes a closed review before clearing its widget", async (t) => {
  const { root, git } = await tempRepo(t);
  await writeFile(path.join(root, "tracked.txt"), "staged\n");
  git("add", "tracked.txt");
  const commands = new Map();
  aurReviewExtension({
    registerCommand(name, options) { commands.set(name, options); },
    registerTool() {},
    on() {},
    events: { emit() {} },
    sendUserMessage() {},
  });
  const widgets = [];
  const context = {
    cwd: root,
    hasUI: true,
    mode: "rpc",
    ui: {
      notify() {},
      setWidget(...args) { widgets.push(args); },
    },
  };
  await commands.get("aur-review").handler("start --scope staged --origin guided-git", context);
  widgets.length = 0;
  await commands.get("aur-review").handler("close", context);
  assert.equal(widgets.length, 2, "close should publish state and then clear the card");
  assert.match(widgets[0][1][0], /"state":"closed"/, "the browser must receive a non-authorizing closed payload before removal");
  assert.equal(widgets[1][1], undefined, "close should remove the rendered widget after reconciliation");
});

test("command parser validates review scope/origin and only accepts start options", () => {
  assert.deepEqual(parseAurReviewArgs(""), { action: "start", reportPaths: [], scope: "working-tree", origin: "standalone" });
  assert.deepEqual(parseAurReviewArgs('start --report "reports/final report.md" --report=summary.md'), { action: "start", reportPaths: ["reports/final report.md", "summary.md"], scope: "working-tree", origin: "standalone" });
  assert.deepEqual(parseAurReviewArgs("start --scope staged --origin guided-git"), { action: "start", reportPaths: [], scope: "staged", origin: "guided-git" });
  assert.throws(() => parseAurReviewArgs("start --scope unknown"), /Unknown review scope/);
  assert.throws(() => parseAurReviewArgs("start --scope staged --origin standalone"), /must use/);
  assert.throws(() => parseAurReviewArgs("refresh --scope staged"), /only supported/);
  assert.throws(() => parseAurReviewArgs("approve --report report.md"), /only supported/);
  assert.throws(() => parseAurReviewArgs("start --unknown"), /Unknown/);
});
