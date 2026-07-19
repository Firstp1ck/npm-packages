import type { GitSnapshot } from "./git.ts";
import { captureGitSnapshot, resolveExplicitReportPaths, resolveGitRepoRoot } from "./git.ts";
import { readReviewSnapshot, withReviewMutation, writeReviewSnapshot } from "./storage.ts";
import {
  AUR_REVIEW_RPC_PAYLOAD_TYPE,
  AUR_REVIEW_SCHEMA_VERSION,
  type ReviewOrigin,
  type ReviewRpcPayload,
  type ReviewScope,
  type ReviewSnapshot,
} from "./types.ts";

export type ReviewRequestOptions = {
  scope?: ReviewScope;
  origin?: ReviewOrigin;
};

let lastTimestampMs = 0;
function now(after?: string): string {
  const afterMs = after ? Date.parse(after) : 0;
  const timestamp = Math.max(Date.now(), Number.isFinite(afterMs) ? afterMs : 0, lastTimestampMs + 1);
  lastTimestampMs = timestamp;
  return new Date(timestamp).toISOString();
}

export function validReviewScopeOrigin(scope: unknown, origin: unknown): scope is ReviewScope {
  return (scope === "working-tree" && origin === "standalone") || (scope === "staged" && origin === "guided-git");
}

export function normalizeReviewRequest(options: ReviewRequestOptions = {}): Required<ReviewRequestOptions> {
  const scope = options.scope ?? "working-tree";
  const origin = options.origin ?? "standalone";
  if (scope !== "working-tree" && scope !== "staged") throw new Error("Unknown review scope. Use working-tree or staged.");
  if (origin !== "standalone" && origin !== "guided-git") throw new Error("Unknown review origin. Use standalone or guided-git.");
  if (!validReviewScopeOrigin(scope, origin)) throw new Error("Working-tree reviews must use standalone origin and staged reviews must use guided-git origin.");
  return { scope, origin };
}

function reviewFromGit(git: GitSnapshot, existing: ReviewSnapshot | undefined, origin: ReviewOrigin): ReviewSnapshot {
  const timestamp = now(existing?.updatedAt);
  return {
    schemaVersion: AUR_REVIEW_SCHEMA_VERSION,
    repoRoot: git.repoRoot,
    scope: git.scope,
    origin,
    fingerprint: git.fingerprint,
    ...(git.scope === "staged" && git.stagedContentHash ? { stagedContentHash: git.stagedContentHash } : {}),
    createdAt: existing?.fingerprint === git.fingerprint && existing.scope === git.scope && existing.origin === origin ? existing.createdAt : timestamp,
    updatedAt: timestamp,
    changedFileTotal: git.changedFileTotal,
    changedFilesTruncated: git.changedFilesTruncated,
    changedFiles: git.changedFiles,
    stats: git.stats,
    reportCandidates: git.reportCandidates,
    decision: { state: "pending" },
  };
}

function explicitPathsFrom(snapshot: ReviewSnapshot | undefined): string[] {
  return snapshot?.reportCandidates.filter((report) => report.source === "explicit").map((report) => report.path) ?? [];
}

function sameSnapshotVersion(left: ReviewSnapshot | undefined, right: ReviewSnapshot): boolean {
  return !!left
    && left.repoRoot === right.repoRoot
    && left.scope === right.scope
    && left.origin === right.origin
    && left.fingerprint === right.fingerprint
    && left.stagedContentHash === right.stagedContentHash
    && left.updatedAt === right.updatedAt
    && left.decision.state === right.decision.state;
}

async function expectedCurrent(repoRoot: string, expected: ReviewSnapshot): Promise<ReviewSnapshot> {
  const current = await readReviewSnapshot(repoRoot);
  if (!sameSnapshotVersion(current, expected)) {
    throw new Error("Review record changed while this action was in progress. Run /aur-review status or refresh before deciding again.");
  }
  return current;
}

async function markStaleIfExpected(repoRoot: string, expected: ReviewSnapshot): Promise<void> {
  const current = await readReviewSnapshot(repoRoot);
  if (!sameSnapshotVersion(current, expected)) return;
  const staleAt = now(current.updatedAt);
  await writeReviewSnapshot({ ...current, updatedAt: staleAt, decision: { ...current.decision, staleCheckedAt: staleAt } });
}

async function assertCurrentFingerprintForSnapshot(repoRoot: string, reviewed: ReviewSnapshot): Promise<void> {
  const request = normalizeReviewRequest({ scope: reviewed.scope, origin: reviewed.origin });
  let current: GitSnapshot | undefined;
  try {
    current = await captureGitSnapshot(repoRoot, explicitPathsFrom(reviewed), request.scope);
  } catch (error) {
    await markStaleIfExpected(repoRoot, reviewed);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Review is stale or unavailable: ${detail} Run /aur-review refresh and review the current ${reviewed.scope} diff before deciding.`);
  }
  if (current.repoRoot !== reviewed.repoRoot
    || current.scope !== reviewed.scope
    || current.fingerprint !== reviewed.fingerprint
    || current.stagedContentHash !== reviewed.stagedContentHash) {
    await markStaleIfExpected(repoRoot, reviewed);
    throw new Error(`Review is stale: the Git ${reviewed.scope} snapshot changed. Run /aur-review refresh and review the current diff before deciding.`);
  }
}

export async function startReview(cwd: string, reportPaths: string[] = [], options: ReviewRequestOptions = {}): Promise<ReviewSnapshot> {
  const request = normalizeReviewRequest(options);
  const repoRoot = await resolveGitRepoRoot(cwd);
  return await withReviewMutation(repoRoot, async () => {
    const existing = await readReviewSnapshot(repoRoot);
    const combinedReports = [...new Set([...explicitPathsFrom(existing), ...reportPaths])];
    const git = await captureGitSnapshot(repoRoot, combinedReports, request.scope);
    const snapshot = reviewFromGit(git, existing, request.origin);
    await writeReviewSnapshot(snapshot);
    return snapshot;
  });
}

export async function refreshReview(cwd: string): Promise<ReviewSnapshot> {
  const repoRoot = await resolveGitRepoRoot(cwd);
  // Capture this version before queueing so a concurrent decision cannot be
  // replaced by a refresh that began against an older pending record.
  const expected = await readReviewSnapshot(repoRoot);
  if (!expected) throw new Error("No repository review record exists for this Git working tree. Run /aur-review start.");
  return await withReviewMutation(repoRoot, async () => {
    const existing = await expectedCurrent(repoRoot, expected);
    const request = normalizeReviewRequest({ scope: existing.scope, origin: existing.origin });
    const git = await captureGitSnapshot(repoRoot, explicitPathsFrom(existing), request.scope);
    const snapshot = reviewFromGit(git, existing, request.origin);
    await writeReviewSnapshot(snapshot);
    return snapshot;
  });
}

export async function requestReview(cwd: string, reportPaths: string[] = [], options: ReviewRequestOptions = {}): Promise<ReviewSnapshot> {
  return await startReview(cwd, reportPaths, options);
}

export async function currentReview(cwd: string): Promise<ReviewSnapshot | undefined> {
  return await readReviewSnapshot(await resolveGitRepoRoot(cwd));
}

export async function assertCurrentFingerprint(cwd: string, reviewed: ReviewSnapshot): Promise<void> {
  const repoRoot = await resolveGitRepoRoot(cwd);
  await withReviewMutation(repoRoot, async () => {
    const current = await expectedCurrent(repoRoot, reviewed);
    await assertCurrentFingerprintForSnapshot(repoRoot, current);
  });
}

async function pendingReviewForDecision(cwd: string): Promise<{ repoRoot: string; expected: ReviewSnapshot }> {
  const repoRoot = await resolveGitRepoRoot(cwd);
  const expected = await readReviewSnapshot(repoRoot);
  if (!expected || expected.decision.state !== "pending") throw new Error("No pending repository review exists for this Git working tree. Run /aur-review start first.");
  return { repoRoot, expected };
}

export async function approveReview(cwd: string): Promise<ReviewSnapshot> {
  const { repoRoot, expected } = await pendingReviewForDecision(cwd);
  return await withReviewMutation(repoRoot, async () => {
    const reviewed = await expectedCurrent(repoRoot, expected);
    if (reviewed.decision.state !== "pending") throw new Error("No pending repository review exists for this Git working tree. Run /aur-review start first.");
    await assertCurrentFingerprintForSnapshot(repoRoot, reviewed);
    const decidedAt = now(reviewed.updatedAt);
    const approved: ReviewSnapshot = {
      ...reviewed,
      updatedAt: decidedAt,
      decision: {
        state: "approved",
        decidedAt,
        reviewedFingerprint: reviewed.fingerprint,
        ...(reviewed.scope === "staged" && reviewed.stagedContentHash ? { reviewedStagedContentHash: reviewed.stagedContentHash } : {}),
      },
    };
    await writeReviewSnapshot(approved);
    return approved;
  });
}

export async function declineReview(cwd: string, comments: string): Promise<ReviewSnapshot> {
  const cleaned = comments.trim();
  if (!cleaned) throw new Error("Decline comments are required.");
  if (cleaned.length > 20_000) throw new Error("Decline comments must be 20,000 characters or fewer.");
  const { repoRoot, expected } = await pendingReviewForDecision(cwd);
  return await withReviewMutation(repoRoot, async () => {
    const reviewed = await expectedCurrent(repoRoot, expected);
    if (reviewed.decision.state !== "pending") throw new Error("No pending repository review exists for this Git working tree. Run /aur-review start first.");
    await assertCurrentFingerprintForSnapshot(repoRoot, reviewed);
    const decidedAt = now(reviewed.updatedAt);
    const declined: ReviewSnapshot = {
      ...reviewed,
      updatedAt: decidedAt,
      decision: {
        state: "declined",
        decidedAt,
        comments: cleaned,
        reviewedFingerprint: reviewed.fingerprint,
        ...(reviewed.scope === "staged" && reviewed.stagedContentHash ? { reviewedStagedContentHash: reviewed.stagedContentHash } : {}),
      },
    };
    await writeReviewSnapshot(declined);
    return declined;
  });
}

export async function closeReview(cwd: string): Promise<ReviewSnapshot> {
  const repoRoot = await resolveGitRepoRoot(cwd);
  return await withReviewMutation(repoRoot, async () => {
    const reviewed = await readReviewSnapshot(repoRoot);
    if (!reviewed) throw new Error("No repository review record exists for this Git working tree.");
    const closed: ReviewSnapshot = {
      ...reviewed,
      updatedAt: now(reviewed.updatedAt),
      // A close is deliberately non-authorizing, even when a prior record was
      // terminal. Do not carry approval/decline fields into the closed state.
      decision: { state: "closed" },
    };
    await writeReviewSnapshot(closed);
    return closed;
  });
}

export async function validateReportPaths(cwd: string, reportPaths: string[]): Promise<void> {
  const repoRoot = await resolveGitRepoRoot(cwd);
  await resolveExplicitReportPaths(repoRoot, reportPaths);
}

function startCommand(snapshot: ReviewSnapshot): string {
  return snapshot.scope === "staged"
    ? "/aur-review start --scope staged --origin guided-git"
    : "/aur-review start";
}

export function reviewRpcPayload(snapshot: ReviewSnapshot): ReviewRpcPayload {
  return {
    type: AUR_REVIEW_RPC_PAYLOAD_TYPE,
    version: 3,
    repoRoot: snapshot.repoRoot,
    scope: snapshot.scope,
    origin: snapshot.origin,
    fingerprint: snapshot.fingerprint,
    ...(snapshot.scope === "staged" && snapshot.stagedContentHash ? { stagedContentHash: snapshot.stagedContentHash } : {}),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    changedFileTotal: snapshot.changedFileTotal,
    changedFilesTruncated: snapshot.changedFilesTruncated,
    changedFiles: snapshot.changedFiles,
    stats: snapshot.stats,
    reports: snapshot.reportCandidates.map(({ path, size, source }) => ({ path, size, source })),
    decision: {
      state: snapshot.decision.state,
      decidedAt: snapshot.decision.decidedAt,
      reviewedFingerprint: snapshot.decision.reviewedFingerprint,
      reviewedStagedContentHash: snapshot.decision.reviewedStagedContentHash,
    },
    commands: {
      start: startCommand(snapshot),
      refresh: "/aur-review refresh",
      status: "/aur-review status",
      approve: "/aur-review approve",
      decline: "/aur-review decline",
      close: "/aur-review close",
    },
  };
}

export function reviewStatusText(snapshot: ReviewSnapshot): string {
  return `Manual repository review ${snapshot.decision.state}: ${snapshot.changedFileTotal} ${snapshot.scope} changed file${snapshot.changedFileTotal === 1 ? "" : "s"}; fingerprint ${snapshot.fingerprint.slice(0, 12)}.`;
}
