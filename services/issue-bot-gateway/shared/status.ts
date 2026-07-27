export const PUBLIC_STATUSES = ["queued", "checking", "created", "rejected", "review", "unavailable", "unknown"] as const;
export type PublicStatus = typeof PUBLIC_STATUSES[number];
export type StoredStatus = "received" | "rejected_prefilter" | PublicStatus;

/** Values in browser/API responses; never serialize upstream errors or user text. */
export const SAFE_REASON_CODES = [
  "acceptable", "invalid_submission", "sensitive_content", "rate_limited", "not_accepted", "manual_review", "admission_disabled", "unavailable", "unknown",
] as const;
export type SafeReasonCode = typeof SAFE_REASON_CODES[number];

export interface StoredSubmission {
  id: string;
  idempotencyKey: string;
  payloadDigest: string;
  policyVersion: string;
  status: StoredStatus;
  reasonCode: SafeReasonCode | null;
  statusNonce: string;
  statusTokenHash: string;
  ipBucketHash: string;
  issueUrl: string | null;
  issueNumber: number | null;
  createdAt: number;
  updatedAt: number;
  modelBound: boolean;
}

export type StatusEnvelope =
  | { ok: true; status: "queued" | "checking"; submissionId: string; pollAfterMs: number }
  | { ok: true; status: "created"; submissionId: string; issueUrl: string; issueNumber: number }
  | { ok: true; status: "rejected" | "review" | "unavailable" | "unknown"; submissionId: string; reasonCode: SafeReasonCode };

export function isSafeReasonCode(value: string | null): value is SafeReasonCode {
  return value !== null && (SAFE_REASON_CODES as readonly string[]).includes(value);
}

export function publicStatusEnvelope(record: StoredSubmission): StatusEnvelope | null {
  // `received` is an internal outbox state. It is deliberately presented as queued so
  // a recovery retry never reveals queue implementation timing to the browser.
  if (record.status === "received") return { ok: true, status: "queued", submissionId: record.id, pollAfterMs: 2_500 };
  if (record.status === "rejected_prefilter") return { ok: true, status: "rejected", submissionId: record.id, reasonCode: record.reasonCode ?? "not_accepted" };
  if (record.status === "queued" || record.status === "checking") {
    return { ok: true, status: record.status, submissionId: record.id, pollAfterMs: 2_500 };
  }
  if (record.status === "created" && record.issueUrl && typeof record.issueNumber === "number" && Number.isSafeInteger(record.issueNumber)) {
    return { ok: true, status: "created", submissionId: record.id, issueUrl: record.issueUrl, issueNumber: record.issueNumber };
  }
  const reasonCode = isSafeReasonCode(record.reasonCode) ? record.reasonCode : record.status === "review" ? "manual_review" : record.status === "unknown" ? "unknown" : "unavailable";
  if (record.status === "rejected" || record.status === "review" || record.status === "unavailable" || record.status === "unknown") {
    return { ok: true, status: record.status, submissionId: record.id, reasonCode };
  }
  return null;
}
