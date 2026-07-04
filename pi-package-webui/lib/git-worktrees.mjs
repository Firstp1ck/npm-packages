import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const WORKTREE_ERROR_CODES = Object.freeze({
  NOT_A_GIT_REPO: "NOT_A_GIT_REPO",
  DETACHED_HEAD: "DETACHED_HEAD",
  BARE_REPO_UNSUPPORTED: "BARE_REPO_UNSUPPORTED",
  INVALID_BRANCH_NAME: "INVALID_BRANCH_NAME",
  BRANCH_CHECKED_OUT_ELSEWHERE: "BRANCH_CHECKED_OUT_ELSEWHERE",
  TARGET_NOT_EMPTY: "TARGET_NOT_EMPTY",
  TARGET_ESCAPES_PARENT: "TARGET_ESCAPES_PARENT",
  DIRTY_WORKTREE: "DIRTY_WORKTREE",
  WORKTREE_BUSY: "WORKTREE_BUSY",
  IS_MAIN_WORKTREE: "IS_MAIN_WORKTREE",
  WORKTREE_NOT_FOUND: "WORKTREE_NOT_FOUND",
  GIT_COMMAND_FAILED: "GIT_COMMAND_FAILED",
});

const GIT_DEFAULT_TIMEOUT_MS = 10_000;
const GIT_MUTATION_TIMEOUT_MS = 10 * 60 * 1000;
const GIT_OUTPUT_LIMIT = 200_000;
const mutationLocks = new Map();

export function makeGitWorktreeError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = details.statusCode || 400;
  error.details = { ...details };
  delete error.details.statusCode;
  return error;
}

export function gitWorktreeErrorPayload(error) {
  return {
    ok: false,
    code: error?.code || WORKTREE_ERROR_CODES.GIT_COMMAND_FAILED,
    error: error?.message || String(error || "Git worktree operation failed"),
    details: error?.details && typeof error.details === "object" ? error.details : {},
  };
}

function runCommand(command, args, { cwd, timeoutMs = GIT_DEFAULT_TIMEOUT_MS, maxOutputLength = GIT_OUTPUT_LIMIT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: undefined, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > maxOutputLength) stdout = stdout.slice(-maxOutputLength);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > maxOutputLength) stderr = stderr.slice(-maxOutputLength);
    });
    child.on("error", (error) => finish({ exitCode: undefined, stdout, stderr, error: error?.message || String(error) }));
    // "close", not "exit": exit can fire before the stdio pipes flush, which
    // intermittently yields empty/truncated stdout for a successful command
    // (e.g. `git rev-parse --show-toplevel` → "" → path.resolve("") →
    // process.cwd() → worktree data read from the wrong repository).
    child.on("close", (exitCode, signal) => finish({ exitCode, signal, stdout, stderr, timedOut: false }));
  });
}

function formatGitCommand(args) {
  return ["git", ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function gitFailureMessage(args, result) {
  if (result?.timedOut) return `${formatGitCommand(args)} timed out`;
  return String(result?.stderr || result?.stdout || result?.error || `${formatGitCommand(args)} failed with exit code ${result?.exitCode ?? "unknown"}`).trim();
}

async function runGit(args, { cwd, timeoutMs = GIT_DEFAULT_TIMEOUT_MS, maxOutputLength = GIT_OUTPUT_LIMIT, code = WORKTREE_ERROR_CODES.GIT_COMMAND_FAILED } = {}) {
  const result = await runCommand("git", args, { cwd, timeoutMs, maxOutputLength });
  if (result.exitCode === 0 && !result.timedOut && !result.error) return result.stdout;
  throw makeGitWorktreeError(code, gitFailureMessage(args, result), { command: formatGitCommand(args), cwd, exitCode: result.exitCode });
}

async function runGitResult(args, { cwd, timeoutMs = GIT_DEFAULT_TIMEOUT_MS, maxOutputLength = GIT_OUTPUT_LIMIT } = {}) {
  return runCommand("git", args, { cwd, timeoutMs, maxOutputLength });
}

function isLockFailure(result) {
  const text = String(`${result?.stderr || ""}\n${result?.stdout || ""}\n${result?.error || ""}`).toLowerCase();
  return /(?:index\.lock|cannot lock ref|unable to create .*\.lock|another git process|file exists)/i.test(text);
}

async function runGitMutationWithRetry(args, { cwd, attempts = 3 } = {}) {
  let lastResult = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await runGitResult(args, { cwd, timeoutMs: GIT_MUTATION_TIMEOUT_MS, maxOutputLength: GIT_OUTPUT_LIMIT });
    if (result.exitCode === 0 && !result.timedOut && !result.error) return result;
    lastResult = result;
    if (!isLockFailure(result) || attempt === attempts - 1) break;
    await delay(140 * (attempt + 1));
  }
  throw makeGitWorktreeError(WORKTREE_ERROR_CODES.GIT_COMMAND_FAILED, gitFailureMessage(args, lastResult), { command: formatGitCommand(args), cwd, exitCode: lastResult?.exitCode });
}

async function withMutationLock(lockKey, fn) {
  const key = String(lockKey || "global");
  const previous = mutationLocks.get(key) || Promise.resolve();
  let release = () => {};
  const blocker = new Promise((resolve) => { release = resolve; });
  const chain = previous.catch(() => {}).then(() => blocker);
  mutationLocks.set(key, chain);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (mutationLocks.get(key) === chain) mutationLocks.delete(key);
  }
}

async function canonicalPath(value) {
  const resolved = path.resolve(String(value || ""));
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

function samePath(left, right) {
  return path.resolve(String(left || "")) === path.resolve(String(right || ""));
}

export function pathInside(parentPath, childPath) {
  const parent = path.resolve(String(parentPath || ""));
  const child = path.resolve(String(childPath || ""));
  const relative = path.relative(parent, child);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function directoryEntries(targetPath) {
  try {
    return await readdir(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertTargetUsable(targetPath, { explicit = false, allowedParent = "" } = {}) {
  const resolved = path.resolve(targetPath);
  if (resolved.includes("\0")) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.TARGET_ESCAPES_PARENT, "Worktree path contains a NUL byte", { path: resolved });
  }
  if (allowedParent && !pathInside(allowedParent, resolved)) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.TARGET_ESCAPES_PARENT, `Worktree path must stay inside ${allowedParent}`, { path: resolved, allowedParent });
  }
  let info = null;
  try {
    info = await stat(resolved);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!info) return resolved;
  if (!info.isDirectory()) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.TARGET_NOT_EMPTY, `Worktree path already exists and is not a directory: ${resolved}`, { path: resolved });
  }
  const entries = await directoryEntries(resolved);
  if (entries && entries.length > 0) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.TARGET_NOT_EMPTY, `Worktree path already exists and is not empty: ${resolved}`, { path: resolved, explicit });
  }
  return resolved;
}

function branchFromRef(ref) {
  const text = String(ref || "").trim();
  return text.startsWith("refs/heads/") ? text.slice("refs/heads/".length) : text || null;
}

export function parseGitWorktreePorcelain(text = "") {
  const worktrees = [];
  let current = null;
  const pushCurrent = () => {
    if (!current) return;
    current.branch = current.detached ? null : current.branch || null;
    current.head = current.head || "";
    current.detached = current.detached === true || !current.branch;
    current.bare = current.bare === true;
    current.locked = current.locked === true;
    current.prunable = current.prunable === true;
    worktrees.push(current);
  };

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("worktree ")) {
      pushCurrent();
      current = {
        path: line.slice("worktree ".length).trim(),
        branch: null,
        head: "",
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length).trim();
    else if (line.startsWith("branch ")) current.branch = branchFromRef(line.slice("branch ".length));
    else if (line === "detached") current.detached = true;
    else if (line === "bare") current.bare = true;
    else if (line.startsWith("locked")) {
      current.locked = true;
      current.lockedReason = line.slice("locked".length).trim();
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
      current.prunableReason = line.slice("prunable".length).trim();
    }
  }
  pushCurrent();
  return worktrees;
}

async function decorateWorktree(raw, repo, currentPath) {
  const resolvedPath = await canonicalPath(raw.path);
  const mainPath = repo.mainWorktreePath;
  return {
    repoRoot: mainPath,
    commonGitDir: repo.commonGitDir,
    path: resolvedPath,
    branch: raw.branch || null,
    head: raw.head || "",
    detached: raw.detached === true,
    bare: raw.bare === true,
    locked: raw.locked === true,
    prunable: raw.prunable === true,
    current: samePath(resolvedPath, currentPath),
    isMainWorktree: samePath(resolvedPath, mainPath),
    ...(raw.lockedReason ? { lockedReason: raw.lockedReason } : {}),
    ...(raw.prunableReason ? { prunableReason: raw.prunableReason } : {}),
  };
}

async function discoverRepository(cwd) {
  const sourceCwd = path.resolve(String(cwd || process.cwd()));
  let currentTopLevel;
  try {
    currentTopLevel = (await runGit(["rev-parse", "--show-toplevel"], { cwd: sourceCwd, code: WORKTREE_ERROR_CODES.NOT_A_GIT_REPO })).trim();
  } catch (error) {
    if (error?.code === WORKTREE_ERROR_CODES.NOT_A_GIT_REPO || /not a git repository/i.test(error?.message || "")) {
      throw makeGitWorktreeError(WORKTREE_ERROR_CODES.NOT_A_GIT_REPO, `Not inside a Git repository: ${sourceCwd}`, { cwd: sourceCwd, statusCode: 404 });
    }
    throw error;
  }
  const currentWorktreePath = await canonicalPath(currentTopLevel);
  const commonRaw = (await runGit(["rev-parse", "--git-common-dir"], { cwd: currentWorktreePath })).trim();
  const commonGitDir = await canonicalPath(path.isAbsolute(commonRaw) ? commonRaw : path.resolve(currentWorktreePath, commonRaw));
  const listText = await runGit(["worktree", "list", "--porcelain"], { cwd: currentWorktreePath, maxOutputLength: GIT_OUTPUT_LIMIT });
  const rawWorktrees = parseGitWorktreePorcelain(listText);
  if (!rawWorktrees.length) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.NOT_A_GIT_REPO, `Cannot list Git worktrees for ${currentWorktreePath}`, { cwd: sourceCwd });
  }
  if (rawWorktrees[0]?.bare) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.BARE_REPO_UNSUPPORTED, "Bare repositories are not supported by Pi worktree tabs yet", { cwd: sourceCwd, commonGitDir });
  }
  const mainWorktreePath = await canonicalPath(rawWorktrees[0].path);
  const repoName = path.basename(mainWorktreePath) || "repo";
  const defaultWorktreesRoot = path.join(path.dirname(mainWorktreePath), `${repoName}.worktrees`);
  return {
    sourceCwd,
    currentWorktreePath,
    commonGitDir,
    mainWorktreePath,
    repoName,
    defaultWorktreesRoot,
    rawWorktrees,
  };
}

async function readWorktreeData(cwd) {
  const repo = await discoverRepository(cwd);
  const worktrees = await Promise.all(repo.rawWorktrees.map((item) => decorateWorktree(item, repo, repo.currentWorktreePath)));
  const current = worktrees.find((item) => item.current) || null;
  const occupiedBranches = worktrees
    .filter((item) => item.branch && !item.bare && !item.prunable)
    .map((item) => ({ branch: item.branch, path: item.path, current: item.current, isMainWorktree: item.isMainWorktree }));
  return {
    cwd: repo.sourceCwd,
    sourceCwd: repo.sourceCwd,
    repoRoot: repo.mainWorktreePath,
    commonGitDir: repo.commonGitDir,
    currentWorktreePath: repo.currentWorktreePath,
    currentBranch: current?.branch || null,
    defaultWorktreesRoot: repo.defaultWorktreesRoot,
    generatedAt: new Date().toISOString(),
    worktrees,
    occupiedBranches,
  };
}

export async function listGitWorktrees(cwd) {
  return readWorktreeData(cwd);
}

function cleanBranchName(value) {
  const branch = String(value || "").trim();
  if (!branch || branch.includes("\0") || branch.includes("@{") || branch.startsWith("-") || branch.startsWith("/")) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.INVALID_BRANCH_NAME, "Invalid Git branch name", { branch });
  }
  return branch;
}

async function validateBranchName(repo, branch) {
  const result = await runGitResult(["check-ref-format", "--branch", branch], { cwd: repo.repoRoot, timeoutMs: 5000, maxOutputLength: 20_000 });
  if (result.exitCode !== 0 || result.timedOut || result.error) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.INVALID_BRANCH_NAME, gitFailureMessage(["check-ref-format", "--branch", branch], result), { branch });
  }
}

async function branchExists(repoRoot, branch) {
  const result = await runGitResult(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repoRoot, timeoutMs: 5000, maxOutputLength: 20_000 });
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw makeGitWorktreeError(WORKTREE_ERROR_CODES.GIT_COMMAND_FAILED, gitFailureMessage(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], result), { branch });
}

export function slugifyWorktreeBranch(branch) {
  const slug = String(branch || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[-.]{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || "branch";
}

function branchHash(branch) {
  return createHash("sha1").update(String(branch || "")).digest("hex").slice(0, 6);
}

async function pathExistsNonEmpty(targetPath) {
  const info = await stat(targetPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return false;
  if (!info.isDirectory()) return true;
  const entries = await readdir(targetPath).catch(() => []);
  return entries.length > 0;
}

async function defaultWorktreePath(repo, branch, worktrees) {
  const root = repo.defaultWorktreesRoot;
  await mkdir(root, { recursive: true });
  const slug = slugifyWorktreeBranch(branch);
  const candidates = [path.join(root, slug), path.join(root, `${slug}-${branchHash(branch)}`)];
  for (let i = 2; i <= 25; i += 1) candidates.push(path.join(root, `${slug}-${i}`));

  for (const candidate of candidates) {
    const occupied = worktrees.find((item) => samePath(item.path, candidate));
    if (occupied && occupied.branch === branch) return candidate;
    if (occupied) continue;
    if (!(await pathExistsNonEmpty(candidate))) return candidate;
  }
  throw makeGitWorktreeError(WORKTREE_ERROR_CODES.TARGET_NOT_EMPTY, `No available worktree path under ${root} for ${branch}`, { branch, defaultWorktreesRoot: root });
}

async function resolveCreateTarget(repo, branch, worktrees, requestedPath) {
  if (requestedPath) {
    const targetPath = path.resolve(repo.sourceCwd, String(requestedPath));
    if (pathInside(repo.commonGitDir, targetPath)) {
      throw makeGitWorktreeError(WORKTREE_ERROR_CODES.TARGET_ESCAPES_PARENT, "Worktree path cannot be inside the Git common directory", { path: targetPath, commonGitDir: repo.commonGitDir });
    }
    if (samePath(targetPath, repo.repoRoot)) {
      throw makeGitWorktreeError(WORKTREE_ERROR_CODES.TARGET_NOT_EMPTY, "Worktree path cannot be the main checkout", { path: targetPath });
    }
    return assertTargetUsable(targetPath, { explicit: true });
  }
  const targetPath = await defaultWorktreePath(repo, branch, worktrees);
  return assertTargetUsable(targetPath, { allowedParent: repo.defaultWorktreesRoot });
}

function responseBase(data, worktree) {
  return {
    repoRoot: data.repoRoot,
    commonGitDir: data.commonGitDir,
    currentWorktreePath: data.currentWorktreePath,
    defaultWorktreesRoot: data.defaultWorktreesRoot,
    worktree,
    worktrees: data.worktrees,
    occupiedBranches: data.occupiedBranches,
  };
}

function occupiedBranch(worktrees, branch) {
  return worktrees.find((item) => item.branch === branch && !item.bare && !item.prunable) || null;
}

export async function createGitWorktree(cwd, request = {}) {
  const branch = cleanBranchName(request.branchName || request.branch);
  let data = await readWorktreeData(cwd);
  await validateBranchName(data, branch);

  return withMutationLock(data.commonGitDir, async () => {
    data = await readWorktreeData(cwd);
    const existing = occupiedBranch(data.worktrees, branch);
    if (existing) {
      return {
        ok: true,
        created: false,
        openedExisting: true,
        code: WORKTREE_ERROR_CODES.BRANCH_CHECKED_OUT_ELSEWHERE,
        message: `Branch ${branch} is already checked out at ${existing.path}`,
        branch,
        ...responseBase(data, existing),
      };
    }

    const targetPath = await resolveCreateTarget(data, branch, data.worktrees, request.path);
    const exists = await branchExists(data.repoRoot, branch);
    const baseRef = String(request.baseRef || "").trim();
    const args = exists
      ? ["worktree", "add", targetPath, branch]
      : ["worktree", "add", "-b", branch, targetPath, ...(baseRef ? [baseRef] : [])];
    const worktreeAddCwd = data.currentWorktreePath || data.repoRoot;

    try {
      await runGitMutationWithRetry(args, { cwd: worktreeAddCwd });
    } catch (error) {
      const refreshed = await readWorktreeData(cwd).catch(() => data);
      const occupied = occupiedBranch(refreshed.worktrees || [], branch);
      if (occupied) {
        return {
          ok: true,
          created: false,
          openedExisting: true,
          code: WORKTREE_ERROR_CODES.BRANCH_CHECKED_OUT_ELSEWHERE,
          message: `Branch ${branch} is already checked out at ${occupied.path}`,
          branch,
          ...responseBase(refreshed, occupied),
        };
      }
      throw error;
    }

    const refreshed = await readWorktreeData(targetPath);
    const created = refreshed.worktrees.find((item) => samePath(item.path, targetPath)) || occupiedBranch(refreshed.worktrees, branch);
    return {
      ok: true,
      created: true,
      openedExisting: false,
      branch,
      path: targetPath,
      ...responseBase(refreshed, created || { path: targetPath, branch }),
    };
  });
}

export async function openGitWorktree(cwd, worktreePath) {
  const data = await readWorktreeData(cwd);
  const requested = path.resolve(data.sourceCwd || cwd, String(worktreePath || ""));
  const requestedCanonical = await canonicalPath(requested);
  const worktree = data.worktrees.find((item) => samePath(item.path, requestedCanonical));
  if (!worktree) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.WORKTREE_NOT_FOUND, `Git worktree not found: ${requested}`, { path: requested });
  }
  return { ok: true, ...responseBase(data, worktree) };
}

export async function removeGitWorktree(cwd, worktreePath, { force = false } = {}) {
  let data = await readWorktreeData(cwd);
  const requested = path.resolve(data.sourceCwd || cwd, String(worktreePath || ""));
  const requestedCanonical = await canonicalPath(requested);
  const worktree = data.worktrees.find((item) => samePath(item.path, requestedCanonical));
  if (!worktree) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.WORKTREE_NOT_FOUND, `Git worktree not found: ${requested}`, { path: requested });
  }
  if (worktree.isMainWorktree) {
    throw makeGitWorktreeError(WORKTREE_ERROR_CODES.IS_MAIN_WORKTREE, "Refusing to remove the main worktree", { path: worktree.path });
  }

  if (!force) {
    const statusText = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: worktree.path, maxOutputLength: 120_000 });
    if (statusText.trim()) {
      throw makeGitWorktreeError(WORKTREE_ERROR_CODES.DIRTY_WORKTREE, "Refusing to remove a dirty worktree without force", { path: worktree.path });
    }
  }

  return withMutationLock(data.commonGitDir, async () => {
    data = await readWorktreeData(cwd);
    const fresh = data.worktrees.find((item) => samePath(item.path, requestedCanonical));
    if (!fresh) return { ok: true, removed: false, path: requestedCanonical, ...responseBase(data, worktree) };
    if (fresh.isMainWorktree) {
      throw makeGitWorktreeError(WORKTREE_ERROR_CODES.IS_MAIN_WORKTREE, "Refusing to remove the main worktree", { path: fresh.path });
    }
    const args = ["worktree", "remove", ...(force ? ["--force"] : []), fresh.path];
    await runGitMutationWithRetry(args, { cwd: data.repoRoot });
    const refreshed = await readWorktreeData(data.repoRoot).catch(() => data);
    return { ok: true, removed: true, path: fresh.path, branch: fresh.branch, ...responseBase(refreshed, fresh) };
  });
}
