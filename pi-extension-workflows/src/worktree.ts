import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isPathInside } from "@firstpick/pi-utils/paths";
import { WorkflowValidationError } from "./errors.ts";
import type { WorkflowWorktreeRecord } from "./types.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return String(result.stdout).trim();
  } catch (error) {
    const detail = String((error as { stderr?: unknown }).stderr ?? (error as Error).message).trim();
    throw new WorkflowValidationError([`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`]);
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unit";
}

async function writeRecord(record: WorkflowWorktreeRecord): Promise<void> {
  const directory = record.patchPath ? path.dirname(record.patchPath) : path.dirname(record.worktreePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, "metadata.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

export async function createWorkflowWorktree(options: {
  repoCwd: string;
  runDir: string;
  runId: string;
  callId: string;
}): Promise<WorkflowWorktreeRecord> {
  const repoRoot = path.resolve(await git(options.repoCwd, ["rev-parse", "--show-toplevel"]));
  if (!isPathInside(repoRoot, path.resolve(options.repoCwd))) throw new WorkflowValidationError(["workflow cwd is outside the detected git repository."]);
  const baseCommit = await git(repoRoot, ["rev-parse", "HEAD"]);
  const initialDirty = Boolean(await git(repoRoot, ["status", "--porcelain=v1"]));
  const unitDir = path.join(options.runDir, "artifacts", "worktrees", safeName(options.callId));
  const worktreePath = path.join(unitDir, "checkout");
  const branch = `pi-workflow/${safeName(options.runId)}/${safeName(options.callId)}`;
  await mkdir(unitDir, { recursive: true, mode: 0o700 });
  await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseCommit]);
  const record: WorkflowWorktreeRecord = {
    schemaVersion: 1,
    runId: options.runId,
    callId: options.callId,
    repoRoot,
    worktreePath,
    baseCommit,
    branch,
    initialDirty,
    changedFiles: [],
    status: "active",
  };
  await writeRecord(record);
  return record;
}

export async function captureWorkflowWorktree(record: WorkflowWorktreeRecord): Promise<WorkflowWorktreeRecord> {
  try { await git(record.worktreePath, ["add", "-N", "--", "."]); } catch { /* empty repositories and ignored-only changes may have nothing to stage */ }
  const status = await git(record.worktreePath, ["status", "--porcelain=v1"]);
  const changedFiles = status.split("\n").filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean);
  const patch = await git(record.worktreePath, ["diff", "--binary", "--no-ext-diff", record.baseCommit, "--", "."]);
  const artifactDir = path.join(path.dirname(record.worktreePath));
  const patchPath = path.join(artifactDir, "changes.patch");
  await writeFile(patchPath, patch ? `${patch}\n` : "", { mode: 0o600 });
  const updated: WorkflowWorktreeRecord = {
    ...record,
    changedFiles,
    patchPath,
    status: changedFiles.length ? "changed" : "clean",
  };
  await writeRecord(updated);
  return updated;
}

export async function verifyWorkflowWorktree(record: WorkflowWorktreeRecord, commands: string[][]): Promise<void> {
  for (const command of commands) {
    if (!command.length) continue;
    try {
      await execFileAsync(command[0], command.slice(1), { cwd: record.worktreePath, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000 });
    } catch (error) {
      const detail = String((error as { stderr?: unknown }).stderr ?? (error as Error).message).trim();
      throw new WorkflowValidationError([`verification failed in ${record.callId}: ${command.join(" ")}${detail ? `: ${detail}` : ""}`]);
    }
  }
}

export async function listWorkflowWorktrees(runDir: string): Promise<WorkflowWorktreeRecord[]> {
  const root = path.join(runDir, "artifacts", "worktrees");
  try {
    const records: WorkflowWorktreeRecord[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const record = JSON.parse(await readFile(path.join(root, entry.name, "metadata.json"), "utf8")) as WorkflowWorktreeRecord;
        if (record?.schemaVersion === 1 && record.runId && record.callId && record.worktreePath) records.push(record);
      } catch { /* incomplete worktree records remain inspectable on disk but are not actionable */ }
    }
    return records.sort((a, b) => a.callId.localeCompare(b.callId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

export async function applyWorkflowWorktrees(runDir: string, verificationCommands: string[][]): Promise<WorkflowWorktreeRecord[]> {
  const records = (await listWorkflowWorktrees(runDir)).filter((record) => record.status === "changed");
  if (!records.length) return [];
  const repoRoots = new Set(records.map((record) => record.repoRoot));
  const baseCommits = new Set(records.map((record) => record.baseCommit));
  if (repoRoots.size !== 1 || baseCommits.size !== 1) throw new WorkflowValidationError(["write units do not share one repository and base commit."]);
  const repoRoot = records[0].repoRoot;
  if (await git(repoRoot, ["status", "--porcelain=v1"])) throw new WorkflowValidationError(["serial apply requires a clean target repository; worktrees were preserved."]);
  for (const record of records) await verifyWorkflowWorktree(record, verificationCommands);
  const patches = records.map((record) => record.patchPath).filter((value): value is string => Boolean(value));
  if (patches.length) {
    const targetCommit = await git(repoRoot, ["rev-parse", "HEAD"]);
    const validationPath = path.join(runDir, "artifacts", `apply-validation-${process.pid}-${Date.now()}`);
    const combinedPatch = path.join(runDir, "artifacts", "combined-apply.patch");
    await git(repoRoot, ["worktree", "add", "--detach", validationPath, targetCommit]);
    try {
      await git(validationPath, ["apply", ...patches]);
      try { await git(validationPath, ["add", "-N", "--", "."]); } catch { /* tracked-only patches need no intent-to-add entries */ }
      const combined = await git(validationPath, ["diff", "--binary", "--no-ext-diff", targetCommit, "--", "."]);
      await writeFile(combinedPatch, combined ? `${combined}\n` : "", { mode: 0o600 });
    } finally {
      try { await git(repoRoot, ["worktree", "remove", "--force", validationPath]); } catch { /* preserve the original validation error */ }
      await rm(validationPath, { recursive: true, force: true });
    }
    if (await git(repoRoot, ["status", "--porcelain=v1"])) throw new WorkflowValidationError(["target repository changed during apply validation; no workflow patch was applied."]);
    await git(repoRoot, ["apply", "--check", combinedPatch]);
    await git(repoRoot, ["apply", combinedPatch]);
  }
  const applied: WorkflowWorktreeRecord[] = [];
  for (const record of records) {
    const updated = { ...record, status: "applied" as const };
    await writeRecord(updated);
    applied.push(updated);
  }
  return applied;
}

export async function cleanupWorkflowWorktrees(runDir: string): Promise<{ removed: string[]; preserved: string[] }> {
  const removed: string[] = [];
  const preserved: string[] = [];
  for (const record of await listWorkflowWorktrees(runDir)) {
    const status = await git(record.worktreePath, ["status", "--porcelain=v1"]);
    if (status && record.status !== "applied") {
      preserved.push(record.worktreePath);
      const updated = { ...record, status: "preserved" as const };
      await writeRecord(updated);
      continue;
    }
    await git(record.repoRoot, ["worktree", "remove", ...(status ? ["--force"] : []), record.worktreePath]);
    try { await git(record.repoRoot, ["branch", "-D", record.branch]); } catch { /* detached or already-removed branches need no cleanup */ }
    await rm(record.worktreePath, { recursive: true, force: true });
    removed.push(record.worktreePath);
  }
  return { removed, preserved };
}
