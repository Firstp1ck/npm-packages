import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkflowPolicyCeiling, validateWorkflowPolicyCeiling } from "../src/policy.ts";
import workflowGuard from "../src/subprocess-policy-guard.ts";
import { parseWorkflowScript } from "../src/script-parser.ts";
import { runJavaScriptWorkflow } from "../src/script-runner.ts";
import { createWorkflowRunStorage } from "../src/run-storage.ts";
import { createWorkflowStateStore } from "../src/state.ts";
import { applyWorkflowWorktrees, captureWorkflowWorktree, cleanupWorkflowWorktrees, createWorkflowWorktree, listWorkflowWorktrees } from "../src/worktree.ts";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Workflow Test", GIT_AUTHOR_EMAIL: "workflow@example.invalid", GIT_COMMITTER_NAME: "Workflow Test", GIT_COMMITTER_EMAIL: "workflow@example.invalid" } }).trim();
}

const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-policy-worktree-test-"));
const originalPolicy = process.env.PI_WORKFLOW_AGENT_POLICY;
try {
  const agentDir = path.join(temp, "agent");
  const project = path.join(temp, "project");
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const userPolicy = {
    schemaVersion: 1,
    permissions: { write: true, shell: true, network: true },
    shellAllowlist: ["git", "npm"],
    networkAllowlist: ["example.com", "docs.example.com"],
    verificationCommands: [["node", "-e", "process.exit(0)"]],
  };
  const projectPolicy = {
    schemaVersion: 1,
    permissions: { write: true, shell: false, network: true },
    shellAllowlist: ["git"],
    networkAllowlist: ["docs.example.com"],
    verificationCommands: [["node", "-e", "process.exit(0)"]],
  };
  assert.equal(validateWorkflowPolicyCeiling(userPolicy).permissions.write, true);
  assert.throws(() => validateWorkflowPolicyCeiling({ ...userPolicy, extra: true }), /unsupported field/);
  await writeFile(path.join(agentDir, "workflow-policy.json"), JSON.stringify(userPolicy));
  await writeFile(path.join(project, ".pi", "workflow-policy.json"), JSON.stringify(projectPolicy));
  assert.deepEqual(await loadWorkflowPolicyCeiling({ cwd: project, projectTrusted: true, agentDir }), {
    ...projectPolicy,
    shellAllowlist: [],
    networkAllowlist: ["docs.example.com"],
  });
  assert.deepEqual((await loadWorkflowPolicyCeiling({ cwd: project, projectTrusted: false, agentDir })).permissions, userPolicy.permissions);

  const guardRoot = path.join(temp, "guard-root");
  await mkdir(guardRoot);
  process.env.PI_WORKFLOW_AGENT_POLICY = JSON.stringify({
    root: guardRoot,
    permissions: { write: true, shell: true, network: true },
    allowedTools: ["read", "write", "bash", "fetch_content"],
    shellAllowlist: ["git"],
    networkAllowlist: ["example.com"],
  });
  let toolCall;
  workflowGuard({ on(name, handler) { if (name === "tool_call") toolCall = handler; } });
  assert.equal(await toolCall({ toolName: "write", input: { path: "inside.txt" } }), undefined);
  assert.match((await toolCall({ toolName: "write", input: { path: "../escape.txt" } })).reason, /outside isolated root/);
  assert.equal(await toolCall({ toolName: "bash", input: { command: "git status" } }), undefined);
  assert.match((await toolCall({ toolName: "bash", input: { command: "npm test" } })).reason, /allowlist denied/);
  assert.match((await toolCall({ toolName: "bash", input: { command: "git status && rm x" } })).reason, /without shell operators/);
  assert.equal(await toolCall({ toolName: "fetch_content", input: { url: "https://docs.example.com/page" } }), undefined);
  assert.match((await toolCall({ toolName: "fetch_content", input: { url: "https://evil.invalid" } })).reason, /allowlist denied/);
  assert.match((await toolCall({ toolName: "web_search", input: { query: "anything" } })).reason, /denied tool/);

  const repo = path.join(temp, "repo");
  await mkdir(repo);
  git(repo, ["init", "-b", "main"]);
  await writeFile(path.join(repo, "README.md"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  const storage = createWorkflowRunStorage({ agentDir, sessionId: "session-write" });
  const script = parseWorkflowScript(`
export const meta = { name: "parallel-writes", description: "Parallel writes", pi: { permissions: { write: true }, maxConcurrency: 2, maxAgents: 2 } }
return await parallel([
  () => agent("write a", { label: "writer-a", tools: ["write"] }),
  () => agent("write b", { label: "writer-b", tools: ["edit"] })
], { concurrency: 2 })
`);
  const source = { path: "/tmp/parallel-writes.js", scope: "inline", sourceType: "javascript", script };
  const run = await runJavaScriptWorkflow(source, {}, { hasUI: false }, {
    cwd: repo,
    state: createWorkflowStateStore(),
    storage,
    policy: { ...script.meta.pi, permissions: { write: true, shell: false, network: false }, shellAllowlist: [], networkAllowlist: [], verificationCommands: [["node", "-e", "process.exit(0)"]] },
    taskRunner: {
      async runTask(task, context) {
        await writeFile(path.join(context.cwd, `${task.id}.txt`), `${task.id}\n`);
        return { ok: true, output: `wrote ${task.id}` };
      },
    },
  });
  assert.equal(run.status, "completed");
  const worktrees = await listWorkflowWorktrees(await storage.runDirectory(run.runId));
  assert.equal(worktrees.length, 2);
  assert.notEqual(worktrees[0].worktreePath, worktrees[1].worktreePath, "parallel writers must never share a worktree");
  assert.ok(worktrees.every((unit) => unit.status === "changed" && unit.changedFiles.length === 1 && unit.patchPath));
  await assert.rejects(() => readFile(path.join(repo, "writer-a.txt")), /ENOENT/, "write results must not touch the target checkout before apply");
  const applied = await applyWorkflowWorktrees(await storage.runDirectory(run.runId), [["node", "-e", "process.exit(0)"]]);
  assert.equal(applied.length, 2);
  assert.equal(await readFile(path.join(repo, "writer-a.txt"), "utf8"), "writer-a\n");
  assert.equal(await readFile(path.join(repo, "writer-b.txt"), "utf8"), "writer-b\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "apply writers"]);
  const cleanup = await cleanupWorkflowWorktrees(await storage.runDirectory(run.runId));
  assert.equal(cleanup.removed.length, 2);
  assert.equal(cleanup.preserved.length, 0);

  const noRetryScript = parseWorkflowScript(`export const meta = { name: "write-no-retry", description: "Write no retry", pi: { permissions: { write: true }, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 } } }\nreturn await agent("write once", { label: "writer", tools: ["write"] })`);
  let writeAttempts = 0;
  const noRetryRun = await runJavaScriptWorkflow(
    { path: "/tmp/write-no-retry.js", scope: "inline", sourceType: "javascript", script: noRetryScript }, {}, { hasUI: false },
    {
      cwd: repo, state: createWorkflowStateStore(), storage,
      policy: { ...noRetryScript.meta.pi, permissions: { write: true, shell: false, network: false }, shellAllowlist: [], networkAllowlist: [], verificationCommands: [] },
      taskRunner: { async runTask() { writeAttempts++; return { ok: false, output: "", error: "503 temporary overload" }; } },
    },
  );
  assert.equal(noRetryRun.status, "failed");
  assert.equal(writeAttempts, 1, "write actions must never be duplicated by transient retry policy");
  const noRetryCleanup = await cleanupWorkflowWorktrees(await storage.runDirectory(noRetryRun.runId));
  assert.equal(noRetryCleanup.removed.length, 1);

  const cancelScript = parseWorkflowScript(`export const meta = { name: "write-cancel", description: "Write cancel", pi: { permissions: { write: true } } }\nreturn await agent("write then wait", { label: "cancel-writer", tools: ["write"] })`);
  const cancelController = new AbortController();
  let cancelTaskStarted = false;
  const cancelledPromise = runJavaScriptWorkflow(
    { path: "/tmp/write-cancel.js", scope: "inline", sourceType: "javascript", script: cancelScript }, {}, { hasUI: false },
    {
      cwd: repo, state: createWorkflowStateStore(), storage, signal: cancelController.signal,
      policy: { ...cancelScript.meta.pi, permissions: { write: true, shell: false, network: false }, shellAllowlist: [], networkAllowlist: [], verificationCommands: [] },
      taskRunner: { async runTask(_task, context) { await writeFile(path.join(context.cwd, "cancelled.txt"), "preserve\n"); cancelTaskStarted = true; await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true })); return { ok: false, output: "", error: "aborted" }; } },
    },
  );
  while (!cancelTaskStarted) await new Promise((resolve) => setTimeout(resolve, 2));
  cancelController.abort();
  const cancelledRun = await cancelledPromise;
  assert.equal(cancelledRun.status, "cancelled");
  const cancelledUnits = await listWorkflowWorktrees(await storage.runDirectory(cancelledRun.runId));
  assert.equal(cancelledUnits.length, 1);
  assert.equal(cancelledUnits[0].status, "changed");
  const cancelledCleanup = await cleanupWorkflowWorktrees(await storage.runDirectory(cancelledRun.runId));
  assert.equal(cancelledCleanup.preserved.length, 1, "cancellation recovery must preserve unmerged worktree changes");
  await assert.rejects(() => readFile(path.join(repo, "cancelled.txt")), /ENOENT/);

  const conflictRunDir = await storage.runDirectory("run-conflict");
  const conflictA = await createWorkflowWorktree({ repoCwd: repo, runDir: conflictRunDir, runId: "run-conflict", callId: "a" });
  const conflictB = await createWorkflowWorktree({ repoCwd: repo, runDir: conflictRunDir, runId: "run-conflict", callId: "b" });
  await writeFile(path.join(conflictA.worktreePath, "README.md"), "change a\n");
  await writeFile(path.join(conflictB.worktreePath, "README.md"), "change b\n");
  await captureWorkflowWorktree(conflictA);
  await captureWorkflowWorktree(conflictB);
  await assert.rejects(() => applyWorkflowWorktrees(conflictRunDir, []), /git apply .*failed/);
  assert.equal(await readFile(path.join(repo, "README.md"), "utf8"), "base\n", "conflicting serial apply must leave the target checkout unchanged");
  const conflictCleanup = await cleanupWorkflowWorktrees(conflictRunDir);
  assert.equal(conflictCleanup.preserved.length, 2, "unmerged changes must never be deleted automatically");
} finally {
  if (originalPolicy === undefined) delete process.env.PI_WORKFLOW_AGENT_POLICY;
  else process.env.PI_WORKFLOW_AGENT_POLICY = originalPolicy;
  await rm(temp, { recursive: true, force: true });
}

console.log("policy and worktree tests passed");
