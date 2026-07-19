import assert from "node:assert/strict";
import { AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH, AUR_REVIEW_RPC_PAYLOAD_PREFIX, aurReviewSafePath, parseAurReviewPayload } from "../public/aur-review-payload.mjs";

const fingerprint = "a".repeat(64);
const file = {
  path: "PKGBUILD",
  indexStatus: "M",
  worktreeStatus: ".",
  staged: true,
  unstaged: false,
  untracked: false,
  deleted: false,
  renamed: false,
};
const basePayload = {
  type: "firstpick.pi-extension-aur-review.review",
  version: 3,
  repoRoot: "/workspace/repository",
  scope: "staged",
  origin: "guided-git",
  fingerprint,
  stagedContentHash: fingerprint,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:01.000Z",
  changedFileTotal: 1,
  changedFilesTruncated: false,
  changedFiles: [file],
  stats: { files: 1, staged: 1, unstaged: 0, untracked: 0, deleted: 0, renamed: 0, unmerged: 0 },
  reports: [],
  decision: { state: "pending" },
};

function parse(payload) {
  return parseAurReviewPayload([`${AUR_REVIEW_RPC_PAYLOAD_PREFIX}${JSON.stringify(payload)}`]);
}

assert.deepEqual(parse(basePayload), basePayload, "a relationally valid payload should render");
assert.equal(parse({ ...basePayload, createdAt: "2026-06-01T00:00:02.000Z" }), null, "createdAt must not be after updatedAt");
assert.equal(parse({ ...basePayload, updatedAt: "2026-06-01T00:00:01Z" }), null, "timestamps must be canonical ISO strings");
assert.equal(parse({ ...basePayload, stats: { ...basePayload.stats, files: 0 } }), null, "stats.files must equal changedFileTotal");
assert.equal(parse({ ...basePayload, stats: { ...basePayload.stats, staged: 2 } }), null, "each stat must not exceed changedFileTotal");
assert.equal(parse({ ...basePayload, changedFileTotal: 2, stats: { ...basePayload.stats, files: 2, staged: 2 } }), null, "non-truncated arrays must match changedFileTotal");
assert.ok(parse({ ...basePayload, changedFilesTruncated: true, changedFileTotal: 2, stats: { ...basePayload.stats, files: 2, staged: 2 } }), "truncated arrays may summarize fewer stored files than their total stats");
assert.equal(parse({ ...basePayload, changedFilesTruncated: true, changedFileTotal: 1 }), null, "a truncated file array must be strictly shorter than changedFileTotal");
assert.equal(parse({ ...basePayload, changedFilesTruncated: true, changedFileTotal: 2, stats: { ...basePayload.stats, files: 2, staged: 0 } }), null, "truncated arrays still need stats to cover their stored summaries");
assert.equal(parse({ ...basePayload, decision: { state: "approved", decidedAt: "2026-06-01T00:00:01.000Z", reviewedFingerprint: "b".repeat(64), reviewedStagedContentHash: fingerprint } }), null, "terminal decisions must bind the snapshot fingerprint");
assert.equal(parse({ ...basePayload, decision: { state: "approved", decidedAt: "2026-06-01T00:00:01.000Z", reviewedFingerprint: fingerprint, reviewedStagedContentHash: "b".repeat(64) } }), null, "terminal decisions must bind the staged-content hash");
assert.equal(parse({ ...basePayload, decision: { state: "declined", decidedAt: "2026-06-01T00:00:01.000Z", reviewedFingerprint: fingerprint, reviewedStagedContentHash: fingerprint } })?.decision.state, "declined", "matching terminal decisions are accepted");
assert.equal(parse({ ...basePayload, decision: { state: "pending", reviewedFingerprint: fingerprint } }), null, "pending payloads cannot carry terminal fingerprints");
assert.equal(parse({ ...basePayload, decision: { state: "closed", reviewedFingerprint: fingerprint } }), null, "closed payloads cannot carry terminal fingerprints");
assert.equal(parse({ ...basePayload, stagedContentHash: undefined }), null, "staged Guided Git payloads require an exact staged-content hash");
assert.equal(parse({ ...basePayload, scope: "working-tree", origin: "standalone", stagedContentHash: fingerprint }), null, "standalone payloads must not carry a staged-content hash");
assert.equal(parse({ ...basePayload, scope: "staged", origin: "standalone" }), null, "scope/origin pairs fail closed");
assert.equal(parse({ ...basePayload, changedFiles: [{ ...file, path: "../escape" }] }), null, "unsafe display paths fail closed");
assert.equal(aurReviewSafePath("a".repeat(AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH)).length, AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH, "browser display-path maximum includes every displayed character");
assert.equal(aurReviewSafePath("a".repeat(AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH + 1)), "", "browser rejects paths beyond the shared display maximum");
console.log("aur review payload tests passed");
