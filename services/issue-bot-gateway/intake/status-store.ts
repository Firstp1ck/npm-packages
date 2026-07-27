import type { SafeReasonCode, StoredStatus, StoredSubmission } from "../shared/status.js";

export interface D1Result<T = unknown> { results?: T[]; success?: boolean; meta?: { changes?: number } }
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1DatabaseLike { prepare(query: string): D1Statement; batch(statements: D1Statement[]): Promise<D1Result[]> }

interface SubmissionRow {
  id: string; idempotency_key: string; payload_digest: string; policy_version: string; status: StoredStatus; reason_code: SafeReasonCode | null;
  status_nonce: string; status_token_hash: string; ip_bucket_hash: string; issue_url: string | null; issue_number: number | null;
  created_at: number; updated_at: number; model_bound: number;
}

export interface PendingOutbox { id: number; submissionId: string; queuePayload: string; createdAt: number }
export interface NewSubmission {
  id: string; idempotencyKey: string; payloadDigest: string; policyVersion: string; status: "received" | "rejected_prefilter";
  reasonCode: SafeReasonCode | null; statusNonce: string; statusTokenHash: string; ipBucketHash: string; createdAt: number; modelBound: boolean; queuePayload?: string;
}

export interface SubmissionStore {
  getByIdempotency(ipBucketHash: string, idempotencyKey: string): Promise<StoredSubmission | null>;
  reserveDigest(payloadDigest: string, policyVersion: string, submissionId: string, now: number, expiresAt: number): Promise<boolean>;
  releaseDigest(payloadDigest: string, policyVersion: string, submissionId: string): Promise<void>;
  getById(id: string): Promise<StoredSubmission | null>;
  create(input: NewSubmission): Promise<{ created: boolean; record: StoredSubmission; outboxId: number | null }>;
  markQueuedAndDeleteOutbox(submissionId: string, outboxId: number, now: number): Promise<void>;
  markUnavailableAndDeleteOutbox(submissionId: string, outboxId: number | null, now: number): Promise<void>;
  listPendingOutbox(limit: number): Promise<PendingOutbox[]>;
  cleanup(now: number, retentionDays: number): Promise<void>;
}

function record(row: SubmissionRow): StoredSubmission {
  return {
    id: row.id, idempotencyKey: row.idempotency_key, payloadDigest: row.payload_digest, policyVersion: row.policy_version,
    status: row.status, reasonCode: row.reason_code, statusNonce: row.status_nonce, statusTokenHash: row.status_token_hash,
    ipBucketHash: row.ip_bucket_hash, issueUrl: row.issue_url, issueNumber: row.issue_number, createdAt: row.created_at,
    updatedAt: row.updated_at, modelBound: row.model_bound === 1,
  };
}

const SELECT_SUBMISSION = `SELECT id, idempotency_key, payload_digest, policy_version, status, reason_code, status_nonce, status_token_hash, ip_bucket_hash, issue_url, issue_number, created_at, updated_at, model_bound FROM submissions`;

/** D1-backed status/idempotency/outbox store. It never writes user prose to submissions or audit rows. */
export class D1SubmissionStore implements SubmissionStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async getByIdempotency(ipBucketHash: string, idempotencyKey: string): Promise<StoredSubmission | null> {
    const row = await this.db.prepare(`${SELECT_SUBMISSION} WHERE ip_bucket_hash = ? AND idempotency_key = ?`).bind(ipBucketHash, idempotencyKey).first<SubmissionRow>();
    return row ? record(row) : null;
  }

  async reserveDigest(payloadDigest: string, policyVersion: string, submissionId: string, now: number, expiresAt: number): Promise<boolean> {
    const result = await this.db.prepare(`INSERT INTO digest_reservations (payload_digest, policy_version, submission_id, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(payload_digest, policy_version) DO UPDATE SET submission_id = excluded.submission_id, expires_at = excluded.expires_at
      WHERE digest_reservations.expires_at <= ?`).bind(payloadDigest, policyVersion, submissionId, expiresAt, now).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async releaseDigest(payloadDigest: string, policyVersion: string, submissionId: string): Promise<void> {
    await this.db.prepare("DELETE FROM digest_reservations WHERE payload_digest = ? AND policy_version = ? AND submission_id = ?")
      .bind(payloadDigest, policyVersion, submissionId).run();
  }

  async getById(id: string): Promise<StoredSubmission | null> {
    const row = await this.db.prepare(`${SELECT_SUBMISSION} WHERE id = ?`).bind(id).first<SubmissionRow>();
    return row ? record(row) : null;
  }

  async create(input: NewSubmission): Promise<{ created: boolean; record: StoredSubmission; outboxId: number | null }> {
    const insertSubmission = this.db.prepare(`INSERT INTO submissions (
      id, idempotency_key, payload_digest, policy_version, status, reason_code, status_nonce, status_token_hash, ip_bucket_hash,
      model_bound, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      input.id, input.idempotencyKey, input.payloadDigest, input.policyVersion, input.status, input.reasonCode, input.statusNonce,
      input.statusTokenHash, input.ipBucketHash, input.modelBound ? 1 : 0, input.createdAt, input.createdAt,
    );
    const statements = [insertSubmission];
    if (input.queuePayload) {
      statements.push(this.db.prepare("INSERT INTO enqueue_outbox (submission_id, queue_payload, created_at) VALUES (?, ?, ?)").bind(input.id, input.queuePayload, input.createdAt));
    }
    statements.push(this.db.prepare("INSERT INTO audit_events (submission_id, event_type, created_at) VALUES (?, ?, ?)").bind(input.id, input.status === "received" ? "admitted" : "prefilter_rejected", input.createdAt));
    try {
      await this.db.batch(statements);
    } catch {
      const existing = await this.getByIdempotency(input.ipBucketHash, input.idempotencyKey);
      if (existing) return { created: false, record: existing, outboxId: null };
      throw new Error("submission persistence failed");
    }
    const created = await this.getById(input.id);
    if (!created) throw new Error("submission persistence verification failed");
    const outbox = input.queuePayload
      ? await this.db.prepare("SELECT id FROM enqueue_outbox WHERE submission_id = ?").bind(input.id).first<{ id: number }>()
      : null;
    if (input.queuePayload && (!outbox || !Number.isSafeInteger(outbox.id))) throw new Error("submission outbox verification failed");
    return { created: true, record: created, outboxId: outbox?.id ?? null };
  }

  async markQueuedAndDeleteOutbox(submissionId: string, outboxId: number, now: number): Promise<void> {
    const statements = [
      this.db.prepare("UPDATE submissions SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'received'").bind(now, submissionId),
      this.db.prepare("DELETE FROM enqueue_outbox WHERE id = ? AND submission_id = ?").bind(outboxId, submissionId),
      this.audit("enqueue_succeeded", submissionId, now),
    ];
    await this.db.batch(statements);
  }

  async markUnavailableAndDeleteOutbox(submissionId: string, outboxId: number | null, now: number): Promise<void> {
    const statements = [
      this.db.prepare("UPDATE submissions SET status = 'unavailable', reason_code = 'unavailable', updated_at = ? WHERE id = ? AND status IN ('received', 'queued')").bind(now, submissionId),
      this.audit("enqueue_failed", submissionId, now),
    ];
    if (outboxId !== null) statements.splice(1, 0, this.db.prepare("DELETE FROM enqueue_outbox WHERE id = ? AND submission_id = ?").bind(outboxId, submissionId));
    await this.db.batch(statements);
  }

  async listPendingOutbox(limit: number): Promise<PendingOutbox[]> {
    const result = await this.db.prepare(`SELECT o.id, o.submission_id, o.queue_payload, o.created_at
      FROM enqueue_outbox o JOIN submissions s ON s.id = o.submission_id
      WHERE s.status = 'received' ORDER BY o.id ASC LIMIT ?`).bind(limit).all<{ id: number; submission_id: string; queue_payload: string; created_at: number }>();
    return (result.results ?? []).map((row) => ({ id: row.id, submissionId: row.submission_id, queuePayload: row.queue_payload, createdAt: row.created_at }));
  }

  async cleanup(now: number, retentionDays: number): Promise<void> {
    const staleReceived = now - 10 * 60_000;
    const staleInFlight = now - 60 * 60_000;
    const expired = now - Math.max(1, retentionDays) * 86_400_000;
    const statements = [
      this.db.prepare("UPDATE submissions SET status = 'unavailable', reason_code = 'unavailable', updated_at = ? WHERE status = 'received' AND created_at < ?").bind(now, staleReceived),
      this.db.prepare("UPDATE submissions SET status = 'unavailable', reason_code = 'unavailable', processor_lease_id = NULL, processor_lease_expires_at = NULL, updated_at = ? WHERE status IN ('queued', 'checking') AND updated_at < ?").bind(now, staleInFlight),
      this.db.prepare("DELETE FROM enqueue_outbox WHERE created_at < ?").bind(staleReceived),
      this.db.prepare("DELETE FROM audit_events WHERE created_at < ?").bind(expired),
      this.db.prepare("DELETE FROM quota_counters WHERE window_kind <> 'active' AND updated_at < ?").bind(expired),
      this.db.prepare("DELETE FROM digest_reservations WHERE expires_at <= ?").bind(now),
      this.db.prepare("DELETE FROM submissions WHERE status IN ('created', 'rejected', 'review', 'unavailable', 'unknown', 'rejected_prefilter') AND updated_at < ?").bind(expired),
    ];
    await this.db.batch(statements);
  }

  private audit(eventType: "enqueue_succeeded" | "enqueue_failed", submissionId: string, now: number): D1Statement {
    return this.db.prepare("INSERT INTO audit_events (submission_id, event_type, created_at) VALUES (?, ?, ?)").bind(submissionId, eventType, now);
  }
}
