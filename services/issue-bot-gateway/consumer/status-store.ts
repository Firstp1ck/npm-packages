import type { SafeReasonCode, StoredStatus } from "../shared/status.js";

export interface D1Result<T = unknown> { results?: T[]; meta?: { changes?: number } }
export interface D1Statement { bind(...values: unknown[]): D1Statement; first<T>(): Promise<T | null>; run(): Promise<D1Result> }
export interface D1DatabaseLike { prepare(query: string): D1Statement }

export type MutationState = "none" | "post_started" | "ambiguous" | "confirmed";
export type ClaimResult =
  | { kind: "claimed"; status: "checking" | "unknown"; mutationState: MutationState }
  | { kind: "busy" | "not_ready" | "terminal" | "missing" };

interface SubmissionRow {
  id: string;
  payload_digest: string;
  policy_version: string;
  status: StoredStatus;
  processor_lease_id: string | null;
  processor_lease_expires_at: number | null;
  mutation_state: MutationState;
}

const TERMINAL = new Set<StoredStatus>(["created", "rejected", "review", "unavailable"]);
const SELECT = `SELECT id, payload_digest, policy_version, status, processor_lease_id, processor_lease_expires_at, mutation_state FROM submissions`;

function changed(result: D1Result): boolean { return (result.meta?.changes ?? 0) === 1; }

/**
 * Private consumer state transitions. Every mutation matches id, digest, policy and
 * (where held) a lease; no stale delivery can complete another delivery's work.
 */
export interface ConsumerStore {
  claim(id: string, digest: string, policyVersion: string, leaseId: string, now: number, leaseMs: number): Promise<ClaimResult>;
  releaseLease(id: string, digest: string, leaseId: string, now: number): Promise<boolean>;
  recordModelAttempt(id: string, digest: string, leaseId: string, modelId: string, requestId: string | null, latencyMs: number, now: number): Promise<boolean>;
  markPostStarted(id: string, digest: string, leaseId: string, now: number): Promise<boolean>;
  clearPostStartedForRetry(id: string, digest: string, leaseId: string, now: number): Promise<boolean>;
  recordGithubRequest(id: string, digest: string, leaseId: string, requestId: string | null, now: number): Promise<boolean>;
  transition(id: string, digest: string, leaseId: string, status: "created" | "rejected" | "review" | "unavailable" | "unknown", reason: SafeReasonCode, now: number, issue?: { url: string; number: number }): Promise<boolean>;
  markMalformedUnavailable(id: string, digest: string, policyVersion: string, now: number): Promise<boolean>;
  markDlqUnavailable(id: string, digest: string, policyVersion: string, now: number): Promise<boolean>;
}

export class D1ConsumerStore implements ConsumerStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async claim(id: string, digest: string, policyVersion: string, leaseId: string, now: number, leaseMs: number): Promise<ClaimResult> {
    const row = await this.db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<SubmissionRow>();
    if (!row) return { kind: "missing" };
    if (row.payload_digest !== digest || row.policy_version !== policyVersion) return { kind: "terminal" };
    if (row.status === "received") return { kind: "not_ready" };
    if (TERMINAL.has(row.status) || row.status === "rejected_prefilter") return { kind: "terminal" };
    if (row.status !== "queued" && row.status !== "checking" && row.status !== "unknown") return { kind: "terminal" };
    if (row.processor_lease_expires_at !== null && row.processor_lease_expires_at > now) return { kind: "busy" };
    const result = await this.db.prepare(`UPDATE submissions
      SET status = CASE WHEN status = 'queued' THEN 'checking' ELSE status END,
          processor_lease_id = ?, processor_lease_expires_at = ?, delivery_attempt_count = delivery_attempt_count + 1,
          last_delivery_at = ?, updated_at = ?
      WHERE id = ? AND payload_digest = ? AND policy_version = ? AND status = ?
        AND (processor_lease_expires_at IS NULL OR processor_lease_expires_at <= ?)`)
      .bind(leaseId, now + leaseMs, now, now, id, digest, policyVersion, row.status, now).run();
    if (!changed(result)) return { kind: "busy" };
    if (row.status === "queued") await this.audit("checking", id, now);
    return { kind: "claimed", status: row.status === "unknown" ? "unknown" : "checking", mutationState: row.mutation_state };
  }

  async releaseLease(id: string, digest: string, leaseId: string, now: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE submissions SET processor_lease_id = NULL, processor_lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND payload_digest = ? AND processor_lease_id = ? AND status IN ('checking', 'unknown')`)
      .bind(now, id, digest, leaseId).run();
    return changed(result);
  }

  async recordModelAttempt(id: string, digest: string, leaseId: string, modelId: string, requestId: string | null, latencyMs: number, now: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE submissions SET model_id = ?, openai_request_id = ?, model_latency_ms = ?, updated_at = ?
      WHERE id = ? AND payload_digest = ? AND processor_lease_id = ? AND status = 'checking'`)
      .bind(modelId, requestId, Math.max(0, Math.floor(latencyMs)), now, id, digest, leaseId).run();
    return changed(result);
  }

  async markPostStarted(id: string, digest: string, leaseId: string, now: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE submissions SET mutation_state = 'post_started', github_attempt_count = github_attempt_count + 1, updated_at = ?
      WHERE id = ? AND payload_digest = ? AND processor_lease_id = ? AND status = 'checking' AND mutation_state = 'none'`)
      .bind(now, id, digest, leaseId).run();
    return changed(result);
  }

  async clearPostStartedForRetry(id: string, digest: string, leaseId: string, now: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE submissions SET mutation_state = 'none', processor_lease_id = NULL,
      processor_lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND payload_digest = ? AND processor_lease_id = ? AND status = 'checking' AND mutation_state = 'post_started'`)
      .bind(now, id, digest, leaseId).run();
    return changed(result);
  }

  async recordGithubRequest(id: string, digest: string, leaseId: string, requestId: string | null, now: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE submissions SET github_request_id = ?, updated_at = ?
      WHERE id = ? AND payload_digest = ? AND processor_lease_id = ? AND status = 'checking' AND mutation_state = 'post_started'`)
      .bind(requestId, now, id, digest, leaseId).run();
    return changed(result);
  }

  async transition(id: string, digest: string, leaseId: string, status: "created" | "rejected" | "review" | "unavailable" | "unknown", reason: SafeReasonCode, now: number, issue?: { url: string; number: number }): Promise<boolean> {
    const sourceStatuses = status === "created" || status === "unavailable" ? "'checking', 'unknown'" : status === "unknown" ? "'checking'" : "'checking'";
    const mutationState = status === "created" ? "confirmed" : status === "unknown" ? "ambiguous" : null;
    const result = await this.db.prepare(`UPDATE submissions SET status = ?, reason_code = ?, issue_url = ?, issue_number = ?,
      mutation_state = COALESCE(?, mutation_state), processor_lease_id = NULL, processor_lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND payload_digest = ? AND processor_lease_id = ? AND status IN (${sourceStatuses})`)
      .bind(status, reason, issue?.url ?? null, issue?.number ?? null, mutationState, now, id, digest, leaseId).run();
    if (changed(result)) await this.audit(status, id, now);
    return changed(result);
  }

  async markMalformedUnavailable(id: string, digest: string, policyVersion: string, now: number): Promise<boolean> {
    return this.markUnleasedUnavailable(id, digest, policyVersion, now);
  }

  async markDlqUnavailable(id: string, digest: string, policyVersion: string, now: number): Promise<boolean> {
    return this.markUnleasedUnavailable(id, digest, policyVersion, now);
  }

  private async markUnleasedUnavailable(id: string, digest: string, policyVersion: string, now: number): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE submissions SET status = 'unavailable', reason_code = 'unavailable',
      processor_lease_id = NULL, processor_lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND payload_digest = ? AND policy_version = ? AND status IN ('received', 'queued', 'checking', 'unknown')`)
      .bind(now, id, digest, policyVersion).run();
    if (changed(result)) await this.audit("unavailable", id, now);
    return changed(result);
  }

  private async audit(eventType: "checking" | "created" | "rejected" | "review" | "unavailable" | "unknown", submissionId: string, now: number): Promise<void> {
    await this.db.prepare("INSERT INTO audit_events (submission_id, event_type, created_at) VALUES (?, ?, ?)").bind(submissionId, eventType, now).run();
  }
}
