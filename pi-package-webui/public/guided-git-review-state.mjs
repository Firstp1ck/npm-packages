const GUIDED_SCOPE = "staged";
const GUIDED_ORIGIN = "guided-git";
const FINGERPRINT = /^[a-f0-9]{64}$/i;
const RECOVERY_PROCESSES = new Set(["stage", "review"]);
const LATER_PROCESSES = new Set(["message", "commit", "push"]);

/** A decline is content-specific: retries require a different staged digest. */
export function guidedGitReviewCanRequestStagedContent(workflow, stagedContentHash) {
  return !workflow?.guidedReviewDeclinedStagedContentHash
    || workflow.guidedReviewDeclinedStagedContentHash !== stagedContentHash;
}

function validGuidedPayload(payload) {
  return !!payload
    && payload.scope === GUIDED_SCOPE
    && payload.origin === GUIDED_ORIGIN
    && typeof payload.repoRoot === "string"
    && payload.repoRoot.length > 0
    && FINGERPRINT.test(String(payload.fingerprint || ""))
    && FINGERPRINT.test(String(payload.stagedContentHash || ""))
    && typeof payload.updatedAt === "string"
    && Number.isFinite(Date.parse(payload.updatedAt))
    && payload.decision
    && ["pending", "approved", "declined", "closed"].includes(payload.decision.state);
}

function sameReview(workflow, payload) {
  return workflow.guidedReviewFingerprint === payload.fingerprint
    && workflow.guidedReviewRepoRoot === payload.repoRoot
    && workflow.guidedReviewStagedContentHash === payload.stagedContentHash;
}

export function guidedGitReviewHasApprovedBinding(workflow) {
  return workflow?.guidedReviewStatus === "approved"
    && typeof workflow.guidedReviewRepoRoot === "string"
    && workflow.guidedReviewRepoRoot.length > 0
    && FINGERPRINT.test(String(workflow.guidedReviewFingerprint || ""))
    && FINGERPRINT.test(String(workflow.guidedReviewStagedContentHash || ""));
}

function isGuidedReviewGateActive(workflow) {
  if (!workflow?.active) return false;
  // A malformed or lost approved binding is not a legacy workflow. Keep it
  // fail-closed so no later process can consume staged content without a new
  // matching review.
  if (workflow.guidedReviewStatus === "approved" && !guidedGitReviewHasApprovedBinding(workflow)) return true;
  // The requirement remains after Stage/Review recovery, decline, close, or a
  // cleared card. Only the matching approval transition may clear it.
  if (workflow.guidedReviewRequired === true) return true;
  return ["reviewRequesting", "review"].includes(workflow.step)
    && ["requesting", "pending"].includes(workflow.guidedReviewStatus);
}

/**
 * Recovery stays available while a staged review gate is active, but later
 * process navigation cannot bypass an outstanding review decision.
 */
export function guidedGitReviewProcessNavigationAllowed(workflow, process) {
  if (!isGuidedReviewGateActive(workflow)) return true;
  if (RECOVERY_PROCESSES.has(process)) return true;
  return !LATER_PROCESSES.has(process);
}

function clearedGuidedGitReviewPatch(workflow, guidedReviewRequired) {
  return {
    guidedReviewStatus: "",
    guidedReviewFingerprint: "",
    guidedReviewRepoRoot: "",
    guidedReviewStagedContentHash: "",
    guidedReviewRequestedAt: 0,
    guidedReviewDeclinedStagedContentHash: workflow?.guidedReviewDeclinedStagedContentHash || "",
    guidedReviewRequired,
  };
}

/**
 * Return the review-state patch for a process selection, or null when the
 * requested process is blocked. Later process navigation retains the exact
 * approved binding; recovery deliberately clears it and requires a new review.
 */
export function guidedGitReviewProcessSelectionPatch(workflow, process) {
  if (!guidedGitReviewProcessNavigationAllowed(workflow, process)) return null;
  const reviewWasRequired = workflow?.guidedReviewRequired === true || workflow?.guidedReviewStatus === "approved";
  if (RECOVERY_PROCESSES.has(process)) return clearedGuidedGitReviewPatch(workflow, reviewWasRequired);
  if (guidedGitReviewHasApprovedBinding(workflow)) {
    return {
      guidedReviewStatus: workflow.guidedReviewStatus,
      guidedReviewFingerprint: workflow.guidedReviewFingerprint,
      guidedReviewRepoRoot: workflow.guidedReviewRepoRoot,
      guidedReviewStagedContentHash: workflow.guidedReviewStagedContentHash,
      guidedReviewRequestedAt: workflow.guidedReviewRequestedAt || 0,
      guidedReviewDeclinedStagedContentHash: workflow.guidedReviewDeclinedStagedContentHash || "",
      guidedReviewRequired: false,
    };
  }
  return clearedGuidedGitReviewPatch(workflow, false);
}

/** A cleared matching pending widget is equivalent to an explicit close. */
export function guidedGitReviewWidgetRemovalTransition(workflow) {
  return workflow?.active
    && workflow.step === "review"
    && workflow.guidedReviewStatus === "pending"
    && typeof workflow.guidedReviewFingerprint === "string"
    && workflow.guidedReviewFingerprint.length > 0
    && typeof workflow.guidedReviewRepoRoot === "string"
    && workflow.guidedReviewRepoRoot.length > 0
    && FINGERPRINT.test(String(workflow.guidedReviewStagedContentHash || ""))
    ? "closed"
    : "ignore";
}

/**
 * Return the only valid Guided Git transition for an already schema-validated
 * browser payload. Keeping this pure makes approval gating independently testable.
 */
export function guidedGitReviewTransition(workflow, payload) {
  if (!workflow?.active || !["reviewRequesting", "review"].includes(workflow.step) || !validGuidedPayload(payload)) return "ignore";
  const decision = payload.decision.state;
  const requestedAt = Number(workflow.guidedReviewRequestedAt || 0);
  const isFreshRequestPayload = workflow.guidedReviewStatus === "requesting"
    && (!requestedAt || Date.parse(payload.updatedAt) >= requestedAt);
  if (decision === "pending") {
    if (isFreshRequestPayload) return "pending";
    return workflow.guidedReviewStatus === "pending" && sameReview(workflow, payload) ? "pending" : "ignore";
  }
  if (decision === "closed") {
    if (isFreshRequestPayload) return "closed";
    return workflow.guidedReviewStatus === "pending" && sameReview(workflow, payload) ? "closed" : "ignore";
  }
  if (!["approved", "declined"].includes(decision) || workflow.guidedReviewStatus !== "pending" || !sameReview(workflow, payload)) return "ignore";
  if (payload.decision.reviewedFingerprint !== payload.fingerprint
    || payload.decision.reviewedStagedContentHash !== payload.stagedContentHash
    || typeof payload.decision.decidedAt !== "string"
    || !Number.isFinite(Date.parse(payload.decision.decidedAt))) return "ignore";
  return decision;
}
