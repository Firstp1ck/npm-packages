export const AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH = 1024;
export const AUR_REVIEW_RPC_PAYLOAD_PREFIX = "AUR_REVIEW_RPC_PAYLOAD ";
export const AUR_REVIEW_RPC_PAYLOAD_TYPE = "firstpick.pi-extension-aur-review.review";
export const AUR_REVIEW_RPC_PAYLOAD_VERSION = 3;

const FINGERPRINT = /^[a-f0-9]{64}$/i;
const STAT_KEYS = ["files", "staged", "unstaged", "untracked", "deleted", "renamed", "unmerged"];

function hasOnlyKeys(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

function validTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function aurReviewSafePath(value) {
  const path = String(value || "");
  if (!path || path.length > AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH || path.includes("\0") || path.startsWith("/") || path.startsWith("\\")) return "";
  const parts = path.split("/");
  return parts.every((part) => part && part !== "." && part !== "..") ? path : "";
}

function changedFileStats(files) {
  return files.reduce((stats, file) => ({
    files: stats.files + 1,
    staged: stats.staged + Number(file.staged),
    unstaged: stats.unstaged + Number(file.unstaged),
    untracked: stats.untracked + Number(file.untracked),
    deleted: stats.deleted + Number(file.deleted),
    renamed: stats.renamed + Number(file.renamed),
    unmerged: stats.unmerged + Number(Boolean(file.unmerged)),
  }), { files: 0, staged: 0, unstaged: 0, untracked: 0, deleted: 0, renamed: 0, unmerged: 0 });
}

function validChangedFile(file) {
  return hasOnlyKeys(file, ["path", "oldPath", "indexStatus", "worktreeStatus", "staged", "unstaged", "untracked", "deleted", "renamed", "unmerged"])
    && !!aurReviewSafePath(file.path)
    && (file.oldPath === undefined || !!aurReviewSafePath(file.oldPath))
    && typeof file.indexStatus === "string" && file.indexStatus.length === 1
    && typeof file.worktreeStatus === "string" && file.worktreeStatus.length === 1
    && typeof file.staged === "boolean"
    && typeof file.unstaged === "boolean"
    && typeof file.untracked === "boolean"
    && typeof file.deleted === "boolean"
    && typeof file.renamed === "boolean"
    && (file.unmerged === undefined || typeof file.unmerged === "boolean");
}

function validStats(stats, files, total, truncated) {
  if (!hasOnlyKeys(stats, STAT_KEYS)) return false;
  if (!STAT_KEYS.every((key) => Number.isInteger(stats[key]) && stats[key] >= 0 && stats[key] <= total)) return false;
  if (stats.files !== total) return false;
  const stored = changedFileStats(files);
  return STAT_KEYS.every((key) => truncated ? stored[key] <= stats[key] : stored[key] === stats[key]);
}

function validReport(report) {
  return hasOnlyKeys(report, ["path", "size", "source"])
    && !!aurReviewSafePath(report.path)
    && Number.isFinite(report.size)
    && report.size >= 0
    && report.size <= 2 * 1024 * 1024
    && ["explicit", "changed-file", "conventional"].includes(report.source);
}

/** Fail closed on the authorization-relevant durable-record relations. */
export function parseAurReviewPayload(lines, {
  prefix = AUR_REVIEW_RPC_PAYLOAD_PREFIX,
  type = AUR_REVIEW_RPC_PAYLOAD_TYPE,
  version = AUR_REVIEW_RPC_PAYLOAD_VERSION,
} = {}) {
  const raw = String(lines?.[0] || "").trim();
  if (!raw.startsWith(prefix)) return null;
  try {
    const payload = JSON.parse(raw.slice(prefix.length));
    if (!payload || payload.type !== type || payload.version !== version) return null;
    if (typeof payload.repoRoot !== "string" || !payload.repoRoot || payload.repoRoot.includes("\0") || !/^(?:\/|[A-Za-z]:[\\/])/.test(payload.repoRoot) || !FINGERPRINT.test(String(payload.fingerprint || ""))) return null;
    if (!((payload.scope === "working-tree" && payload.origin === "standalone") || (payload.scope === "staged" && payload.origin === "guided-git"))) return null;
    const stagedPayload = payload.scope === "staged";
    if (stagedPayload ? !FINGERPRINT.test(String(payload.stagedContentHash || "")) : payload.stagedContentHash !== undefined) return null;
    if (!validTimestamp(payload.createdAt) || !validTimestamp(payload.updatedAt) || Date.parse(payload.createdAt) > Date.parse(payload.updatedAt)) return null;
    if (!Number.isInteger(payload.changedFileTotal) || payload.changedFileTotal <= 0 || payload.changedFileTotal > 1_000_000) return null;
    if (typeof payload.changedFilesTruncated !== "boolean" || !Array.isArray(payload.changedFiles) || payload.changedFiles.length > 500 || !payload.changedFiles.every(validChangedFile)) return null;
    if (payload.changedFilesTruncated ? payload.changedFiles.length >= payload.changedFileTotal : payload.changedFiles.length !== payload.changedFileTotal) return null;
    if (!validStats(payload.stats, payload.changedFiles, payload.changedFileTotal, payload.changedFilesTruncated)) return null;
    if (!Array.isArray(payload.reports) || payload.reports.length > 20 || !payload.reports.every(validReport)) return null;
    if (!hasOnlyKeys(payload.decision, ["state", "decidedAt", "reviewedFingerprint", "reviewedStagedContentHash"]) || !["pending", "approved", "declined", "closed"].includes(payload.decision.state)) return null;
    const decision = payload.decision;
    if (["approved", "declined"].includes(decision.state)) {
      if (!validTimestamp(decision.decidedAt)
        || decision.reviewedFingerprint !== payload.fingerprint
        || (stagedPayload ? decision.reviewedStagedContentHash !== payload.stagedContentHash : decision.reviewedStagedContentHash !== undefined)) return null;
      const decidedAt = Date.parse(decision.decidedAt);
      if (decidedAt < Date.parse(payload.createdAt) || decidedAt > Date.parse(payload.updatedAt)) return null;
    } else if (decision.decidedAt !== undefined || decision.reviewedFingerprint !== undefined || decision.reviewedStagedContentHash !== undefined) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
