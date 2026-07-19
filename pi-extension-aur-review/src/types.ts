export const AUR_REVIEW_SCHEMA_VERSION = 3 as const;
/** Maximum display string length, including a truncation ellipsis. */
export const AUR_REVIEW_MAX_DISPLAY_PATH_LENGTH = 1024;
export const AUR_REVIEW_RPC_WIDGET_KEY = "aur-review:rpc";
export const AUR_REVIEW_RPC_PAYLOAD_PREFIX = "AUR_REVIEW_RPC_PAYLOAD ";
export const AUR_REVIEW_RPC_PAYLOAD_TYPE = "firstpick.pi-extension-aur-review.review";
export const AUR_REVIEW_DECISION_EVENT = "aur-review:decision";
export const AUR_REVIEW_DECISION_EVENT_TYPE = "firstpick.pi-extension-aur-review.decision";

export type ReviewScope = "working-tree" | "staged";
export type ReviewOrigin = "standalone" | "guided-git";
export type ReviewDecisionState = "pending" | "approved" | "declined" | "closed";

export const REVIEW_SCOPES = ["working-tree", "staged"] as const;
export const REVIEW_ORIGINS = ["standalone", "guided-git"] as const;

export type ChangedFile = {
  path: string;
  oldPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  deleted: boolean;
  renamed: boolean;
  unmerged?: boolean;
};

export type ChangeStats = {
  files: number;
  staged: number;
  unstaged: number;
  untracked: number;
  deleted: number;
  renamed: number;
  unmerged: number;
};

export type ReportCandidate = {
  path: string;
  size: number;
  source: "explicit" | "changed-file" | "conventional";
};

export type ReviewDecision = {
  state: ReviewDecisionState;
  decidedAt?: string;
  comments?: string;
  reviewedFingerprint?: string;
  /** Present only for staged Guided Git terminal decisions. */
  reviewedStagedContentHash?: string;
  staleCheckedAt?: string;
};

export type ReviewSnapshot = {
  schemaVersion: typeof AUR_REVIEW_SCHEMA_VERSION;
  repoRoot: string;
  scope: ReviewScope;
  origin: ReviewOrigin;
  fingerprint: string;
  /** Exact bounded cached-diff digest for staged Guided Git reviews only. */
  stagedContentHash?: string;
  createdAt: string;
  updatedAt: string;
  changedFileTotal: number;
  changedFilesTruncated: boolean;
  changedFiles: ChangedFile[];
  stats: ChangeStats;
  reportCandidates: ReportCandidate[];
  decision: ReviewDecision;
};

export type ReviewRpcPayload = {
  type: typeof AUR_REVIEW_RPC_PAYLOAD_TYPE;
  version: 3;
  repoRoot: string;
  scope: ReviewScope;
  origin: ReviewOrigin;
  fingerprint: string;
  /** Exact bounded cached-diff digest for staged Guided Git reviews only. */
  stagedContentHash?: string;
  createdAt: string;
  updatedAt: string;
  changedFileTotal: number;
  changedFilesTruncated: boolean;
  changedFiles: ChangedFile[];
  stats: ChangeStats;
  reports: Array<Pick<ReportCandidate, "path" | "size" | "source">>;
  decision: Pick<ReviewDecision, "state" | "decidedAt" | "reviewedFingerprint" | "reviewedStagedContentHash">;
  commands: {
    start: string;
    refresh: string;
    status: string;
    approve: string;
    decline: string;
    close: string;
  };
};

export type ReviewDecisionEvent = {
  type: typeof AUR_REVIEW_DECISION_EVENT_TYPE;
  version: 3;
  repoRoot: string;
  scope: ReviewScope;
  origin: ReviewOrigin;
  fingerprint: string;
  /** Exact bounded cached-diff digest for staged Guided Git decisions only. */
  stagedContentHash?: string;
  /** Matches stagedContentHash for staged Guided Git terminal decisions. */
  reviewedStagedContentHash?: string;
  decision: "approved" | "declined";
  decidedAt: string;
  comments?: string;
  changedFiles: ChangedFile[];
};
