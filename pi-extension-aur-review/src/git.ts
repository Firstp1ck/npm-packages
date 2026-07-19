import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, open, readlink, realpath, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH, type ChangedFile, type ChangeStats, type ReportCandidate, type ReviewScope } from "./types.ts";

const GIT_TIMEOUT_MS = 10_000;
const GIT_OUTPUT_LIMIT = 4 * 1024 * 1024;
const STATUS_OUTPUT_LIMIT = 2 * 1024 * 1024;
const MAX_CHANGED_FILE_SUMMARIES = 500;
const MAX_REPORTS = 20;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_UNTRACKED_HASH_BYTES = 32 * 1024 * 1024;
export const MAX_UNTRACKED_HASH_FILES = 500;
export const MAX_UNTRACKED_TOTAL_HASH_BYTES = 64 * 1024 * 1024;
const MAX_CONVENTIONAL_ENTRIES = 160;
const MAX_DISPLAY_PATH_PREFIX_BYTES = AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH - 1;
const UNTRACKED_HASH_CHUNK_BYTES = 64 * 1024;
/** Must remain byte-for-byte aligned with pi-package-webui's server helper. */
export const STAGED_CONTENT_HASH_DOMAIN = "firstpick/aur-review/staged-content/v1\0";

export class ReviewGitError extends Error {}

type GitResult = { stdout: Buffer; stderr: Buffer };
type RawChangedFile = ChangedFile & { rawPath: Buffer; rawOldPath?: Buffer };
type UntrackedFileInspection = { absolute: Buffer; info: Awaited<ReturnType<typeof lstat>> };

function utf8(buffer: Buffer): string {
  return buffer.toString("utf8");
}

/**
 * Changed-file summaries are display-only. Keep them bounded and deliberately
 * decode only this prefix; all identity, hashing, and filesystem operations
 * continue to use the original porcelain bytes.
 */
function boundedPathDisplay(value: Buffer): string {
  if (value.length <= AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH) return value.toString("utf8");
  return `${value.subarray(0, MAX_DISPLAY_PATH_PREFIX_BYTES).toString("utf8")}…`;
}

async function runGit(cwd: string, args: string[], options: { input?: Buffer; outputLimit?: number } = {}): Promise<GitResult> {
  const outputLimit = options.outputLimit ?? GIT_OUTPUT_LIMIT;
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", "core.quotepath=false", "-c", "diff.external=", ...args], {
      cwd,
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    const finish = (error?: Error, value?: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const terminateForLimit = () => {
      try { child.kill("SIGKILL"); } catch { /* process already exited */ }
      finish(new ReviewGitError(`Git output exceeded the ${Math.floor(outputLimit / 1024 / 1024)} MiB review safety limit.`));
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* process already exited */ }
      finish(new ReviewGitError(`Git command timed out after ${Math.floor(GIT_TIMEOUT_MS / 1000)} seconds.`));
    }, GIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > outputLimit) return terminateForLimit();
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize <= 64 * 1024) stderr.push(Buffer.from(chunk));
    });
    child.on("error", (error) => finish(new ReviewGitError(`Could not run git: ${error.message}`)));
    child.on("close", (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      if (code !== 0) {
        const detail = utf8(err).trim().slice(0, 1200);
        return finish(new ReviewGitError(detail ? `Git ${args[0]} failed: ${detail}` : `Git ${args[0]} failed with exit code ${code ?? "unknown"}.`));
      }
      finish(undefined, { stdout: out, stderr: err });
    });
    if (options.input) child.stdin.end(options.input);
  });
}

function nthSpace(value: Buffer, count: number): number {
  let found = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== 0x20) continue;
    found++;
    if (found === count) return index;
  }
  return -1;
}

function statusXY(entry: Buffer, fallback = ".."): [string, string] {
  return [
    entry.length > 2 ? String.fromCharCode(entry[2]) : fallback[0],
    entry.length > 3 ? String.fromCharCode(entry[3]) : fallback[1],
  ];
}

function statusFlags(indexStatus: string, worktreeStatus: string, extra: Partial<ChangedFile> = {}): Omit<RawChangedFile, "path" | "rawPath" | "rawOldPath"> {
  return {
    indexStatus,
    worktreeStatus,
    staged: indexStatus !== "." && indexStatus !== "?",
    unstaged: worktreeStatus !== "." && worktreeStatus !== "?",
    untracked: indexStatus === "?" || worktreeStatus === "?",
    deleted: indexStatus === "D" || worktreeStatus === "D",
    renamed: indexStatus === "R" || worktreeStatus === "R",
    ...extra,
  };
}

function zeroTerminatedFields(status: Buffer): Buffer[] {
  const fields: Buffer[] = [];
  let start = 0;
  while (start < status.length) {
    const end = status.indexOf(0, start);
    if (end < 0) {
      fields.push(Buffer.from(status.subarray(start)));
      break;
    }
    fields.push(Buffer.from(status.subarray(start, end)));
    start = end + 1;
  }
  return fields;
}

/** Parse porcelain-v2 -z without ever converting filename bytes as a whole. */
function parseStatus(status: Buffer): RawChangedFile[] {
  const fields = zeroTerminatedFields(status);
  const changed: RawChangedFile[] = [];
  for (let index = 0; index < fields.length; index++) {
    const entry = fields[index];
    if (entry.length === 0) continue;
    const kind = String.fromCharCode(entry[0]);
    if (kind === "?") {
      const rawPath = Buffer.from(entry.subarray(2));
      changed.push({ path: boundedPathDisplay(rawPath), rawPath, ...statusFlags("?", "?") });
      continue;
    }
    if (kind === "1") {
      const boundary = nthSpace(entry, 8);
      if (boundary < 0) continue;
      const rawPath = Buffer.from(entry.subarray(boundary + 1));
      const [indexStatus, worktreeStatus] = statusXY(entry);
      changed.push({ path: boundedPathDisplay(rawPath), rawPath, ...statusFlags(indexStatus, worktreeStatus) });
      continue;
    }
    if (kind === "2") {
      const boundary = nthSpace(entry, 9);
      if (boundary < 0) continue;
      const rawPath = Buffer.from(entry.subarray(boundary + 1));
      const rawOldPath = Buffer.from(fields[++index] || Buffer.alloc(0));
      const [indexStatus, worktreeStatus] = statusXY(entry);
      changed.push({
        path: boundedPathDisplay(rawPath),
        oldPath: boundedPathDisplay(rawOldPath),
        rawPath,
        rawOldPath,
        ...statusFlags(indexStatus, worktreeStatus, { renamed: true }),
      });
      continue;
    }
    if (kind === "u") {
      const boundary = nthSpace(entry, 10);
      if (boundary < 0) continue;
      const rawPath = Buffer.from(entry.subarray(boundary + 1));
      const [indexStatus, worktreeStatus] = statusXY(entry, "UU");
      changed.push({ path: boundedPathDisplay(rawPath), rawPath, ...statusFlags(indexStatus, worktreeStatus, { unmerged: true }) });
    }
  }
  return changed;
}

function mergeChangedFiles(files: RawChangedFile[]): RawChangedFile[] {
  const merged = new Map<string, RawChangedFile>();
  for (const file of files) {
    const key = file.rawPath.toString("hex");
    const current = merged.get(key);
    if (!current) {
      merged.set(key, file);
      continue;
    }
    current.indexStatus = current.indexStatus === "." ? file.indexStatus : current.indexStatus;
    current.worktreeStatus = current.worktreeStatus === "." ? file.worktreeStatus : current.worktreeStatus;
    current.staged ||= file.staged;
    current.unstaged ||= file.unstaged;
    current.untracked ||= file.untracked;
    current.deleted ||= file.deleted;
    current.renamed ||= file.renamed;
    current.unmerged ||= file.unmerged;
    current.oldPath ||= file.oldPath;
    current.rawOldPath ||= file.rawOldPath;
  }
  return [...merged.values()].sort((left, right) => Buffer.compare(left.rawPath, right.rawPath));
}

function statsFor(files: RawChangedFile[]): ChangeStats {
  return files.reduce<ChangeStats>((stats, file) => ({
    files: stats.files + 1,
    staged: stats.staged + Number(file.staged),
    unstaged: stats.unstaged + Number(file.unstaged),
    untracked: stats.untracked + Number(file.untracked),
    deleted: stats.deleted + Number(file.deleted),
    renamed: stats.renamed + Number(file.renamed),
    unmerged: stats.unmerged + Number(Boolean(file.unmerged)),
  }), { files: 0, staged: 0, unstaged: 0, untracked: 0, deleted: 0, renamed: 0, unmerged: 0 });
}

export async function resolveGitRepoRoot(cwd: string): Promise<string> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"], { outputLimit: 16 * 1024 });
  const root = utf8(result.stdout).trim();
  if (!root) throw new ReviewGitError("The current directory is not inside a Git working tree.");
  try {
    return await realpath(root);
  } catch {
    throw new ReviewGitError("Git returned an inaccessible working-tree root.");
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function isLikelyReportPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);
  return /(?:^|[._ -])(?:reports?|reviews?|audits?|validations?|test-results?|results?)(?:[._ -]|$)/.test(base)
    && /\.(?:md|txt|json|html?|xml|log)$/i.test(base);
}

async function safeReportCandidate(repoRoot: string, requestedPath: string, source: ReportCandidate["source"]): Promise<ReportCandidate | undefined> {
  const input = requestedPath.trim();
  if (!input || input.includes("\0") || path.isAbsolute(input)) return undefined;
  const candidate = path.resolve(repoRoot, input);
  if (!isInside(repoRoot, candidate)) return undefined;
  let realRoot: string;
  let realCandidate: string;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    [realRoot, realCandidate, info] = await Promise.all([realpath(repoRoot), realpath(candidate), stat(candidate)]);
  } catch {
    return undefined;
  }
  if (!isInside(realRoot, realCandidate) || !info.isFile() || info.size > MAX_REPORT_BYTES) return undefined;
  return { path: path.relative(repoRoot, candidate).split(path.sep).join("/"), size: info.size, source };
}

async function conventionalReportPaths(repoRoot: string): Promise<string[]> {
  // `aur-packages` keeps its historical scanner output here. It remains a
  // conventional source (not an implicit approval input), newest report first.
  const roots = ["dev/scripts/aur-scan", "reports", "report", ".pi/reports", "docs/reports", "artifacts", "test-results"];
  const found: Array<{ path: string; mtimeMs: number }> = [];
  const seen = new Set<string>();
  const visit = async (relative: string, depth: number): Promise<void> => {
    if (found.length >= MAX_CONVENTIONAL_ENTRIES || depth > 2) return;
    const absolute = path.resolve(repoRoot, relative);
    if (!isInside(repoRoot, absolute)) return;
    let entries: Awaited<ReturnType<typeof readdir>>;
    try { entries = await readdir(absolute, { withFileTypes: true }); } catch { return; }
    entries.sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      if (found.length >= MAX_CONVENTIONAL_ENTRIES) break;
      const next = path.posix.join(relative.split(path.sep).join("/"), entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(next, depth + 1);
      else if (entry.isFile() && isLikelyReportPath(next) && !seen.has(next)) {
        try {
          const info = await stat(path.resolve(repoRoot, next));
          if (!info.isFile()) continue;
          seen.add(next);
          found.push({ path: next, mtimeMs: info.mtimeMs });
        } catch { /* ignored: candidate disappeared or became inaccessible */ }
      }
    }
  };
  for (const root of roots) await visit(root, 0);
  return found
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path))
    .slice(0, MAX_CONVENTIONAL_ENTRIES)
    .map((entry) => entry.path);
}

export async function resolveExplicitReportPaths(repoRoot: string, paths: string[]): Promise<ReportCandidate[]> {
  if (paths.length > MAX_REPORTS) throw new ReviewGitError(`At most ${MAX_REPORTS} report paths may be requested.`);
  const candidates: ReportCandidate[] = [];
  for (const requested of paths) {
    const candidate = await safeReportCandidate(repoRoot, requested, "explicit");
    if (!candidate) throw new ReviewGitError(`Report path must be a regular file inside the repository and no larger than 2 MiB: ${requested}`);
    if (!candidates.some((item) => item.path === candidate.path)) candidates.push(candidate);
  }
  return candidates;
}

async function discoverReports(repoRoot: string, files: RawChangedFile[], explicitPaths: string[]): Promise<ReportCandidate[]> {
  const candidates = await resolveExplicitReportPaths(repoRoot, explicitPaths);
  const add = (candidate: ReportCandidate | undefined) => {
    if (!candidate || candidates.length >= MAX_REPORTS || candidates.some((item) => item.path === candidate.path)) return;
    candidates.push(candidate);
  };
  for (const file of files) {
    if (file.deleted || !isLikelyReportPath(file.path)) continue;
    add(await safeReportCandidate(repoRoot, file.path, "changed-file"));
  }
  for (const file of await conventionalReportPaths(repoRoot)) add(await safeReportCandidate(repoRoot, file, "conventional"));
  return candidates;
}

export type GitSnapshot = {
  repoRoot: string;
  scope: ReviewScope;
  fingerprint: string;
  /** Exact cached-diff digest for staged Guided Git snapshots only. */
  stagedContentHash?: string;
  changedFiles: ChangedFile[];
  changedFileTotal: number;
  changedFilesTruncated: boolean;
  stats: ChangeStats;
  reportCandidates: ReportCandidate[];
};

function untrackedPath(repoRoot: string, file: RawChangedFile): Buffer {
  // Buffer paths retain unusual POSIX filename bytes. Git itself only reports
  // repository-relative paths, and the status parser keeps those bytes exact.
  return Buffer.concat([Buffer.from(repoRoot), Buffer.from(path.sep), file.rawPath]);
}

async function inspectUntrackedFile(repoRoot: string, file: RawChangedFile): Promise<UntrackedFileInspection> {
  const absolute = untrackedPath(repoRoot, file);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(absolute);
  } catch {
    throw new ReviewGitError(`Untracked path disappeared while snapshotting: ${file.path}`);
  }
  if (!info.isFile() && !info.isSymbolicLink()) throw new ReviewGitError(`Untracked path is not a regular file or symlink: ${file.path}`);
  if (info.size > MAX_UNTRACKED_HASH_BYTES) {
    throw new ReviewGitError(`Untracked file exceeds the ${Math.floor(MAX_UNTRACKED_HASH_BYTES / 1024 / 1024)} MiB review snapshot safety limit: ${file.path}`);
  }
  return { absolute, info };
}

function sameUntrackedFileIdentity(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function changedUntrackedFileError(file: RawChangedFile): ReviewGitError {
  return new ReviewGitError(`Untracked path changed while snapshotting: ${file.path}`);
}

async function hashUntrackedFile(
  file: RawChangedFile,
  inspection: UntrackedFileInspection,
  consumeBytes: (bytes: number) => void,
  remainingAggregateBytes: () => number,
): Promise<Buffer> {
  const { absolute, info } = inspection;
  const metadata = Buffer.from(`${info.mode & 0o7777}:${info.size}:`);
  if (info.isSymbolicLink()) {
    let target: Buffer;
    let after: Awaited<ReturnType<typeof lstat>>;
    try {
      target = await readlink(absolute, { encoding: "buffer" });
      after = await lstat(absolute);
    } catch {
      throw new ReviewGitError(`Untracked path disappeared while snapshotting: ${file.path}`);
    }
    if (!sameUntrackedFileIdentity(info, after)) throw changedUntrackedFileError(file);
    if (target.length > MAX_UNTRACKED_HASH_BYTES) {
      throw new ReviewGitError(`Untracked file exceeds the ${Math.floor(MAX_UNTRACKED_HASH_BYTES / 1024 / 1024)} MiB review snapshot safety limit: ${file.path}`);
    }
    consumeBytes(target.length);
    return Buffer.concat([file.rawPath, Buffer.from([0]), metadata, Buffer.from("symlink:"), target, Buffer.from([0])]);
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(absolute, "r");
  } catch {
    throw new ReviewGitError(`Untracked path disappeared while snapshotting: ${file.path}`);
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameUntrackedFileIdentity(info, opened)) throw changedUntrackedFileError(file);

    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(UNTRACKED_HASH_CHUNK_BYTES);
    let readTotal = 0;
    let position = 0;
    while (readTotal < info.size) {
      const perFileRemaining = MAX_UNTRACKED_HASH_BYTES - readTotal;
      const aggregateRemaining = remainingAggregateBytes();
      if (perFileRemaining <= 0) {
        throw new ReviewGitError(`Untracked file exceeds the ${Math.floor(MAX_UNTRACKED_HASH_BYTES / 1024 / 1024)} MiB review snapshot safety limit: ${file.path}`);
      }
      if (aggregateRemaining <= 0) {
        throw new ReviewGitError(`Untracked files exceed the ${Math.floor(MAX_UNTRACKED_TOTAL_HASH_BYTES / 1024 / 1024)} MiB aggregate review snapshot safety limit.`);
      }
      const length = Math.min(chunk.length, info.size - readTotal, perFileRemaining, aggregateRemaining);
      const { bytesRead } = await handle.read(chunk, 0, length, position);
      if (bytesRead === 0) break;
      readTotal += bytesRead;
      consumeBytes(bytesRead);
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }

    const [afterHandle, afterPath] = await Promise.all([handle.stat(), lstat(absolute)]);
    if (readTotal !== info.size || !sameUntrackedFileIdentity(info, afterHandle) || !sameUntrackedFileIdentity(info, afterPath)) {
      throw changedUntrackedFileError(file);
    }
    return Buffer.concat([file.rawPath, Buffer.from([0]), metadata, Buffer.from("file:"), hash.digest(), Buffer.from([0])]);
  } catch (error) {
    if (error instanceof ReviewGitError) throw error;
    throw new ReviewGitError(`Untracked path disappeared while snapshotting: ${file.path}`);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function hashUntrackedFiles(repoRoot: string, files: RawChangedFile[]): Promise<Buffer> {
  const untracked = files.filter((file) => file.untracked);
  if (untracked.length > MAX_UNTRACKED_HASH_FILES) {
    throw new ReviewGitError(`At most ${MAX_UNTRACKED_HASH_FILES} untracked files may be hashed in one review snapshot.`);
  }

  // Preflight the aggregate before reading contents. Hashing then proceeds in
  // raw-byte sorted order, one file at a time, bounding memory and I/O.
  const inspected: Array<{ file: RawChangedFile; inspection: UntrackedFileInspection }> = [];
  let totalBytes = 0;
  for (const file of untracked) {
    const inspection = await inspectUntrackedFile(repoRoot, file);
    totalBytes += inspection.info.size;
    if (totalBytes > MAX_UNTRACKED_TOTAL_HASH_BYTES) {
      throw new ReviewGitError(`Untracked files exceed the ${Math.floor(MAX_UNTRACKED_TOTAL_HASH_BYTES / 1024 / 1024)} MiB aggregate review snapshot safety limit.`);
    }
    inspected.push({ file, inspection });
  }

  let actualBytesRead = 0;
  const remainingAggregateBytes = () => MAX_UNTRACKED_TOTAL_HASH_BYTES - actualBytesRead;
  const consumeBytes = (bytes: number) => {
    if (bytes > remainingAggregateBytes()) {
      throw new ReviewGitError(`Untracked files exceed the ${Math.floor(MAX_UNTRACKED_TOTAL_HASH_BYTES / 1024 / 1024)} MiB aggregate review snapshot safety limit.`);
    }
    actualBytesRead += bytes;
  };
  const parts: Buffer[] = [];
  for (const item of inspected) parts.push(await hashUntrackedFile(item.file, item.inspection, consumeBytes, remainingAggregateBytes));
  return Buffer.concat(parts);
}

function stagedFileOnly(file: RawChangedFile): RawChangedFile {
  // A path can have both index and worktree modifications. For staged review,
  // only the index side is visible and hashed; later worktree edits are excluded.
  return { ...file, worktreeStatus: ".", unstaged: false, untracked: false };
}

function stagedStatusFingerprint(files: RawChangedFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(file.rawPath, Buffer.from([0]), Buffer.from(file.indexStatus), Buffer.from([0]));
    if (file.rawOldPath) parts.push(file.rawOldPath, Buffer.from([0]));
  }
  return Buffer.concat(parts);
}

/**
 * The Guided Git approval token deliberately covers only the exact bytes that
 * `git commit` can consume from the index. The fixed domain prevents this
 * digest from being confused with a review fingerprint or arbitrary file hash.
 */
export function stagedContentHashForDiff(stagedDiff: Buffer): string {
  return createHash("sha256").update(STAGED_CONTENT_HASH_DOMAIN).update(stagedDiff).digest("hex");
}

/** Capture a deterministic review snapshot without placing metadata in the worktree. */
export async function captureGitSnapshot(cwd: string, explicitReportPaths: string[] = [], scope: ReviewScope = "working-tree"): Promise<GitSnapshot> {
  if (scope !== "working-tree" && scope !== "staged") throw new ReviewGitError("Unknown review scope.");
  const repoRoot = await resolveGitRepoRoot(cwd);
  const statusResult = await runGit(repoRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--renames"], { outputLimit: STATUS_OUTPUT_LIMIT });
  const parsed = mergeChangedFiles(parseStatus(statusResult.stdout));

  if (scope === "staged") {
    const stagedFiles = parsed.filter((file) => file.staged).map(stagedFileOnly);
    if (stagedFiles.length === 0) throw new ReviewGitError("No substantive staged changes are available for review.");
    const staged = await runGit(repoRoot, ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--"]);
    if (staged.stdout.length === 0) throw new ReviewGitError("No substantive staged changes are available for review.");

    const hash = createHash("sha256");
    for (const part of [
      Buffer.from("aur-review/git-snapshot/v2\0staged\0"),
      Buffer.from(repoRoot), Buffer.from([0]),
      Buffer.from("staged-status\0"), stagedStatusFingerprint(stagedFiles),
      Buffer.from("staged-diff\0"), staged.stdout,
    ]) hash.update(part);

    const changedFiles = stagedFiles.slice(0, MAX_CHANGED_FILE_SUMMARIES).map(({ rawPath: _rawPath, rawOldPath: _rawOldPath, ...file }) => file);
    return {
      repoRoot,
      scope,
      fingerprint: hash.digest("hex"),
      stagedContentHash: stagedContentHashForDiff(staged.stdout),
      changedFiles,
      changedFileTotal: stagedFiles.length,
      changedFilesTruncated: stagedFiles.length > changedFiles.length,
      stats: statsFor(stagedFiles),
      reportCandidates: await discoverReports(repoRoot, stagedFiles, explicitReportPaths),
    };
  }

  if (parsed.length === 0) throw new ReviewGitError("No staged, unstaged, deleted, renamed, or untracked changes are available for review.");
  const [staged, unstaged, untrackedHashes] = await Promise.all([
    runGit(repoRoot, ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--"]),
    runGit(repoRoot, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--"]),
    hashUntrackedFiles(repoRoot, parsed),
  ]);

  const hash = createHash("sha256");
  for (const part of [
    Buffer.from("aur-review/git-snapshot/v2\0working-tree\0"),
    Buffer.from(repoRoot), Buffer.from([0]),
    Buffer.from("status\0"), statusResult.stdout,
    Buffer.from("staged\0"), staged.stdout,
    Buffer.from("unstaged\0"), unstaged.stdout,
    Buffer.from("untracked-hashes\0"), untrackedHashes,
  ]) hash.update(part);

  const changedFiles = parsed.slice(0, MAX_CHANGED_FILE_SUMMARIES).map(({ rawPath: _rawPath, rawOldPath: _rawOldPath, ...file }) => file);
  return {
    repoRoot,
    scope,
    fingerprint: hash.digest("hex"),
    changedFiles,
    changedFileTotal: parsed.length,
    changedFilesTruncated: parsed.length > changedFiles.length,
    stats: statsFor(parsed),
    reportCandidates: await discoverReports(repoRoot, parsed, explicitReportPaths),
  };
}
