import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH, AUR_REVIEW_SCHEMA_VERSION, type ChangeStats, type ChangedFile, type ReportCandidate, type ReviewSnapshot } from "./types.ts";

const MAX_CHANGED_FILE_SUMMARIES = 500;
const MAX_REPORTS = 20;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_DECLINE_COMMENT_LENGTH = 20_000;
const MAX_CHANGED_FILES = 1_000_000;
const REVIEW_LOCK_WAIT_MS = 8_000;
const REVIEW_LOCK_RETRY_MS = 35;
const REVIEW_LOCK_STALE_GRACE_MS = 120_000;
const HASH = /^[a-f0-9]{64}$/;
const STAT_KEYS: Array<keyof ChangeStats> = ["files", "staged", "unstaged", "untracked", "deleted", "renamed", "unmerged"];

function agentDir(): string {
  return path.resolve(process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"));
}

function recordsDir(): string {
  return path.join(agentDir(), "aur-review", "v2", "reviews");
}

function locksDir(): string {
  return path.join(agentDir(), "aur-review", "v2", "locks");
}

function contained(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function reviewId(repoRoot: string): string {
  return createHash("sha256").update(path.resolve(repoRoot)).digest("hex");
}

function recordPath(repoRoot: string): string {
  const dir = recordsDir();
  const destination = path.join(dir, `${reviewId(repoRoot)}.json`);
  if (!contained(dir, destination)) throw new Error("Unsafe review storage path.");
  return destination;
}

function lockPath(repoRoot: string): string {
  const dir = locksDir();
  const destination = path.join(dir, `${reviewId(repoRoot)}.lock`);
  if (!contained(dir, destination)) throw new Error("Unsafe review lock path.");
  return destination;
}

function recoveryLockPath(repoRoot: string): string {
  const dir = locksDir();
  const destination = path.join(dir, `${reviewId(repoRoot)}.recovery.lock`);
  if (!contained(dir, destination)) throw new Error("Unsafe review recovery lock path.");
  return destination;
}

function hasOnlyKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validDisplayPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH && !value.includes("\0");
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isChangedFile(value: unknown): value is ChangedFile {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["path", "oldPath", "indexStatus", "worktreeStatus", "staged", "unstaged", "untracked", "deleted", "renamed", "unmerged"])) return false;
  const file = value as Partial<ChangedFile>;
  return validDisplayPath(file.path)
    && (file.oldPath === undefined || validDisplayPath(file.oldPath))
    && typeof file.indexStatus === "string" && file.indexStatus.length === 1
    && typeof file.worktreeStatus === "string" && file.worktreeStatus.length === 1
    && typeof file.staged === "boolean"
    && typeof file.unstaged === "boolean"
    && typeof file.untracked === "boolean"
    && typeof file.deleted === "boolean"
    && typeof file.renamed === "boolean"
    && (file.unmerged === undefined || typeof file.unmerged === "boolean");
}

function isReportCandidate(value: unknown): value is ReportCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["path", "size", "source"])) return false;
  const report = value as Partial<ReportCandidate>;
  return validDisplayPath(report.path)
    && Number.isFinite(report.size)
    && report.size >= 0
    && report.size <= MAX_REPORT_BYTES
    && ["explicit", "changed-file", "conventional"].includes(String(report.source));
}

function statsFrom(files: ChangedFile[]): ChangeStats {
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

function validStats(value: unknown, files: ChangedFile[], changedFileTotal: number, truncated: boolean): value is ChangeStats {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, STAT_KEYS)) return false;
  const stats = value as Partial<ChangeStats>;
  if (!STAT_KEYS.every((key) => Number.isInteger(stats[key]) && Number(stats[key]) >= 0 && Number(stats[key]) <= changedFileTotal)) return false;
  if (stats.files !== changedFileTotal) return false;
  const stored = statsFrom(files);
  return STAT_KEYS.every((key) => truncated ? stored[key] <= stats[key]! : stored[key] === stats[key]);
}

function validDecision(value: unknown, snapshot: Partial<ReviewSnapshot>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["state", "decidedAt", "comments", "reviewedFingerprint", "reviewedStagedContentHash", "staleCheckedAt"])) return false;
  const decision = value as ReviewSnapshot["decision"];
  if (!["pending", "approved", "declined", "closed"].includes(decision.state)) return false;
  if (decision.decidedAt !== undefined && !validTimestamp(decision.decidedAt)) return false;
  if (decision.staleCheckedAt !== undefined && !validTimestamp(decision.staleCheckedAt)) return false;
  if (decision.reviewedFingerprint !== undefined && !HASH.test(decision.reviewedFingerprint)) return false;
  if (decision.reviewedStagedContentHash !== undefined && !HASH.test(decision.reviewedStagedContentHash)) return false;
  if (decision.comments !== undefined && typeof decision.comments !== "string") return false;

  const createdAt = typeof snapshot.createdAt === "string" ? Date.parse(snapshot.createdAt) : NaN;
  const updatedAt = typeof snapshot.updatedAt === "string" ? Date.parse(snapshot.updatedAt) : NaN;
  const inSnapshotRange = (timestamp: string | undefined) => timestamp === undefined || (Date.parse(timestamp) >= createdAt && Date.parse(timestamp) <= updatedAt);
  if (!inSnapshotRange(decision.decidedAt) || !inSnapshotRange(decision.staleCheckedAt)) return false;

  const validTerminalContentBinding = snapshot.scope === "staged"
    ? typeof snapshot.stagedContentHash === "string" && decision.reviewedStagedContentHash === snapshot.stagedContentHash
    : snapshot.stagedContentHash === undefined && decision.reviewedStagedContentHash === undefined;

  if (decision.state === "pending") {
    return decision.decidedAt === undefined
      && decision.comments === undefined
      && decision.reviewedFingerprint === undefined
      && decision.reviewedStagedContentHash === undefined;
  }
  if (decision.state === "approved") {
    return validTimestamp(decision.decidedAt)
      && decision.comments === undefined
      && decision.reviewedFingerprint === snapshot.fingerprint
      && validTerminalContentBinding;
  }
  if (decision.state === "declined") {
    return validTimestamp(decision.decidedAt)
      && typeof decision.comments === "string"
      && Boolean(decision.comments.trim())
      && decision.comments.length <= MAX_DECLINE_COMMENT_LENGTH
      && decision.reviewedFingerprint === snapshot.fingerprint
      && validTerminalContentBinding;
  }
  // Close is an explicit non-decision. It must not carry an old approval or
  // decline metadata that a later consumer could misconstrue as authorization.
  return decision.decidedAt === undefined
    && decision.comments === undefined
    && decision.reviewedFingerprint === undefined
    && decision.reviewedStagedContentHash === undefined
    && decision.staleCheckedAt === undefined;
}

/** Fail closed on malformed or relationally inconsistent persisted records. */
export function isReviewSnapshot(value: unknown): value is ReviewSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["schemaVersion", "repoRoot", "scope", "origin", "fingerprint", "stagedContentHash", "createdAt", "updatedAt", "changedFileTotal", "changedFilesTruncated", "changedFiles", "stats", "reportCandidates", "decision"])) return false;
  const snapshot = value as Partial<ReviewSnapshot>;
  const validScopeOrigin = (snapshot.scope === "working-tree" && snapshot.origin === "standalone")
    || (snapshot.scope === "staged" && snapshot.origin === "guided-git");
  const validStagedContentHash = snapshot.scope === "staged"
    ? typeof snapshot.stagedContentHash === "string" && HASH.test(snapshot.stagedContentHash)
    : snapshot.stagedContentHash === undefined;
  const validFiles = Array.isArray(snapshot.changedFiles)
    && snapshot.changedFiles.length <= MAX_CHANGED_FILE_SUMMARIES
    && snapshot.changedFiles.every(isChangedFile);
  const total = snapshot.changedFileTotal;
  const validCounts = Number.isInteger(total)
    && total > 0
    && total <= MAX_CHANGED_FILES
    && typeof snapshot.changedFilesTruncated === "boolean"
    && validFiles
    && (snapshot.changedFilesTruncated ? snapshot.changedFiles.length < total : snapshot.changedFiles.length === total);

  return snapshot.schemaVersion === AUR_REVIEW_SCHEMA_VERSION
    && typeof snapshot.repoRoot === "string"
    && path.isAbsolute(snapshot.repoRoot)
    && validScopeOrigin
    && typeof snapshot.fingerprint === "string"
    && HASH.test(snapshot.fingerprint)
    && validStagedContentHash
    && validTimestamp(snapshot.createdAt)
    && validTimestamp(snapshot.updatedAt)
    && Date.parse(snapshot.createdAt) <= Date.parse(snapshot.updatedAt)
    && validCounts
    && validStats(snapshot.stats, snapshot.changedFiles as ChangedFile[], total, snapshot.changedFilesTruncated as boolean)
    && Array.isArray(snapshot.reportCandidates)
    && snapshot.reportCandidates.length <= MAX_REPORTS
    && snapshot.reportCandidates.every(isReportCandidate)
    && validDecision(snapshot.decision, snapshot);
}

export async function readReviewSnapshot(repoRoot: string): Promise<ReviewSnapshot | undefined> {
  try {
    const raw = await readFile(recordPath(repoRoot), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isReviewSnapshot(parsed) && path.resolve(parsed.repoRoot) === path.resolve(repoRoot) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const mutationTails = new Map<string, Promise<void>>();

type ReviewLockOwner = {
  token: string;
  pid: number;
  host: string;
  createdAt: string;
};

function isReviewLockOwner(value: unknown): value is ReviewLockOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Partial<ReviewLockOwner>;
  return typeof owner.token === "string"
    && /^[a-f0-9-]{16,}$/i.test(owner.token)
    && Number.isInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.host === "string"
    && owner.host.length > 0
    && validTimestamp(owner.createdAt);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function releaseReviewLock(lock: string, token: string): Promise<void> {
  try {
    const raw = await readFile(path.join(lock, "owner.json"), "utf8");
    const owner: unknown = JSON.parse(raw);
    // A lock can only be reclaimed after its directory disappears. Verify the
    // unique token before removal so an old holder can never release a newer
    // owner that acquired the same repository lock.
    if (!isReviewLockOwner(owner) || owner.token !== token) return;
    await rm(lock, { recursive: true, force: true });
  } catch {
    // Lock cleanup is best effort. A live stale lock will be recovered only
    // by the conservative checks below, never by blindly deleting it.
  }
}

async function recoverStaleReviewLock(repoRoot: string, lock: string): Promise<void> {
  const recoveryLock = recoveryLockPath(repoRoot);
  try {
    // Serialize recovery itself. Without this guard, two contenders could
    // both identify an old owner and one could remove a newer lock acquired
    // after the other contender's check.
    await mkdir(recoveryLock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
  try {
    let lockInfo: Awaited<ReturnType<typeof stat>>;
    try {
      lockInfo = await stat(lock);
    } catch {
      return;
    }
    const ageMs = Math.max(0, Date.now() - lockInfo.mtimeMs);
    let owner: unknown;
    try {
      owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8"));
    } catch {
      // A process may crash after atomic mkdir but before writing owner.json.
      // Leave a recent incomplete lock alone; only an old incomplete lock is
      // safely reclaimable.
      if (ageMs >= REVIEW_LOCK_STALE_GRACE_MS) await rm(lock, { recursive: true, force: true });
      return;
    }
    if (!isReviewLockOwner(owner)) {
      if (ageMs >= REVIEW_LOCK_STALE_GRACE_MS) await rm(lock, { recursive: true, force: true });
      return;
    }
    // PID liveness is meaningful only on this host. A foreign-host lock is
    // not guessed stale merely because its owner cannot be inspected locally.
    if (owner.host === hostname() && !processIsAlive(owner.pid)) await rm(lock, { recursive: true, force: true });
  } finally {
    await rm(recoveryLock, { recursive: true, force: true });
  }
}

async function acquireReviewLock(repoRoot: string): Promise<() => Promise<void>> {
  const dir = locksDir();
  const lock = lockPath(repoRoot);
  if (!contained(dir, lock)) throw new Error("Unsafe review lock path.");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + REVIEW_LOCK_WAIT_MS;
  const token = randomUUID();
  const owner: ReviewLockOwner = { token, pid: process.pid, host: hostname(), createdAt: new Date().toISOString() };

  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      try {
        await writeFile(path.join(lock, "owner.json"), `${JSON.stringify(owner)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      } catch (error) {
        await rm(lock, { recursive: true, force: true });
        throw error;
      }
      return async () => await releaseReviewLock(lock, token);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await recoverStaleReviewLock(repoRoot, lock);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the repository review lock after ${Math.ceil(REVIEW_LOCK_WAIT_MS / 1000)} seconds.`);
      }
      await sleep(REVIEW_LOCK_RETRY_MS + Math.floor(Math.random() * REVIEW_LOCK_RETRY_MS));
    }
  }
}

/** Serialize in-process and cross-process read/check/write transitions for one canonical repository. */
export async function withReviewMutation<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(repoRoot);
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let releaseLocal: () => void = () => {};
  const own = new Promise<void>((resolve) => { releaseLocal = resolve; });
  const tail = previous.catch(() => undefined).then(() => own);
  mutationTails.set(key, tail);
  await previous.catch(() => undefined);
  let releaseExternal: (() => Promise<void>) | undefined;
  try {
    releaseExternal = await acquireReviewLock(key);
    return await operation();
  } finally {
    await releaseExternal?.();
    releaseLocal();
    if (mutationTails.get(key) === tail) mutationTails.delete(key);
  }
}

/** Write one private review record atomically outside the reviewed repository. */
export async function writeReviewSnapshot(snapshot: ReviewSnapshot): Promise<void> {
  if (!isReviewSnapshot(snapshot)) throw new Error("Refusing to write an invalid review snapshot.");
  const dir = recordsDir();
  const destination = recordPath(snapshot.repoRoot);
  if (!contained(dir, destination)) throw new Error("Unsafe review storage path.");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, `.${path.basename(destination)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  if (!contained(dir, temporary)) throw new Error("Unsafe temporary review storage path.");
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
}
