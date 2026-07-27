import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { D1ConsumerStore } from "../consumer/status-store.js";
import { D1QuotaLimiter } from "../intake/rate-limit.js";
import { D1SubmissionStore, type D1DatabaseLike, type D1Result, type D1Statement } from "../intake/status-store.js";

class SqliteD1Statement implements D1Statement {
  private values: unknown[] = [];
  constructor(readonly db: DatabaseSync, readonly sql: string) {}
  bind(...values: unknown[]): D1Statement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.values as never[]) as T | undefined) ?? null; }
  async all<T>(): Promise<D1Result<T>> { return { results: this.db.prepare(this.sql).all(...this.values as never[]) as T[] }; }
  async run(): Promise<D1Result> {
    const result = this.db.prepare(this.sql).run(...this.values as never[]);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 implements D1DatabaseLike {
  constructor(readonly db = new DatabaseSync(":memory:")) {}
  prepare(sql: string): D1Statement { return new SqliteD1Statement(this.db, sql); }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

const NOW = 1_740_000_000_000;
const DIGEST = "a".repeat(64);

function database(): SqliteD1 {
  const d1 = new SqliteD1();
  d1.db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  return d1;
}

function submission(id: string, key: string) {
  return {
    id,
    idempotencyKey: key,
    payloadDigest: DIGEST,
    policyVersion: "1",
    status: "received" as const,
    reasonCode: null,
    statusNonce: "B".repeat(22),
    statusTokenHash: "c".repeat(64),
    ipBucketHash: "d".repeat(43),
    createdAt: NOW,
    modelBound: true,
    queuePayload: '{"safe":"fixture"}',
  };
}

test("real SQLite migration enforces idempotency, leases, mutation barrier, transitions, quotas, and cleanup", async () => {
  const d1 = database();
  const intake = new D1SubmissionStore(d1);
  const [first, duplicate] = await Promise.all([
    intake.create(submission("AAAAAAAAAAAAAAAAAAAAAA", "123e4567-e89b-42d3-a456-426614174000")),
    intake.create(submission("BBBBBBBBBBBBBBBBBBBBBB", "123e4567-e89b-42d3-a456-426614174000")),
  ]);
  assert.equal([first.created, duplicate.created].filter(Boolean).length, 1);
  const reservationDigest = "e".repeat(64);
  const reservations = await Promise.all([
    intake.reserveDigest(reservationDigest, "1", "CCCCCCCCCCCCCCCCCCCCCC", NOW, NOW + 60_000),
    intake.reserveDigest(reservationDigest, "1", "DDDDDDDDDDDDDDDDDDDDDD", NOW, NOW + 60_000),
  ]);
  assert.equal(reservations.filter(Boolean).length, 1, "concurrent duplicate digests must admit exactly one reservation");
  const created = first.created ? first : duplicate;
  assert.ok(created.outboxId);
  await intake.markQueuedAndDeleteOutbox(created.record.id, created.outboxId, NOW + 1);

  const consumer = new D1ConsumerStore(d1);
  const claim = await consumer.claim(created.record.id, DIGEST, "1", "lease-one", NOW + 2, 240_000);
  assert.equal(claim.kind, "claimed");
  assert.equal((await consumer.claim(created.record.id, DIGEST, "1", "lease-two", NOW + 3, 240_000)).kind, "busy");
  assert.equal(await consumer.markPostStarted(created.record.id, DIGEST, "lease-one", NOW + 4), true);
  assert.equal(await consumer.markPostStarted(created.record.id, DIGEST, "lease-one", NOW + 5), false);
  assert.equal(await consumer.clearPostStartedForRetry(created.record.id, DIGEST, "lease-one", NOW + 6), true);

  const reclaimed = await consumer.claim(created.record.id, DIGEST, "1", "lease-three", NOW + 7, 240_000);
  assert.equal(reclaimed.kind, "claimed");
  d1.db.prepare("INSERT INTO quota_counters (bucket_hash, window_kind, count, updated_at) VALUES (?, 'active', 1, ?), ('global', 'active', 1, ?)")
    .run(created.record.ipBucketHash, NOW, NOW);
  assert.equal(await consumer.transition(created.record.id, DIGEST, "lease-three", "unknown", "unknown", NOW + 8), true);
  assert.equal(d1.db.prepare("SELECT count FROM quota_counters WHERE bucket_hash = ? AND window_kind = 'active'").get(created.record.ipBucketHash)?.count, 0);

  const unknownClaim = await consumer.claim(created.record.id, DIGEST, "1", "lease-four", NOW + 9, 240_000);
  assert.equal(unknownClaim.kind, "claimed");
  assert.equal(await consumer.transition(created.record.id, DIGEST, "lease-four", "created", "acceptable", NOW + 10, { url: "https://github.com/firstpick/repo/issues/1", number: 1 }), true);

  const limiter = new D1QuotaLimiter(d1, { cooldownMs: 0, perHour: 1, perDay: 1, globalActive: 1, globalPerDay: 1 });
  assert.equal(await limiter.reserve("quota-bucket", NOW + 20), true);
  assert.equal(await limiter.reserve("quota-bucket", NOW + 21), false);

  d1.db.prepare(`INSERT INTO submissions (
    id, idempotency_key, payload_digest, policy_version, status, reason_code, status_nonce, status_token_hash,
    ip_bucket_hash, model_bound, created_at, updated_at
  ) VALUES (?, ?, ?, '1', 'queued', NULL, ?, ?, ?, 1, ?, ?)`)
    .run("EEEEEEEEEEEEEEEEEEEEEE", "323e4567-e89b-42d3-a456-426614174000", "f".repeat(64), "G".repeat(22), "1".repeat(64), "stale-bucket", 0, 0);
  d1.db.prepare("INSERT INTO quota_counters (bucket_hash, window_kind, count, updated_at) VALUES ('stale-bucket', 'active', 1, 0)").run();
  d1.db.prepare("UPDATE quota_counters SET updated_at = ? WHERE window_kind <> 'active'").run(0);
  await intake.cleanup(NOW + 8 * 86_400_000, 7);
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM quota_counters WHERE window_kind <> 'active'").get()?.count, 0);
  assert.equal(d1.db.prepare("SELECT status FROM submissions WHERE id = 'EEEEEEEEEEEEEEEEEEEEEE'").get()?.status, "unavailable");
  assert.equal(d1.db.prepare("SELECT count FROM quota_counters WHERE bucket_hash = 'stale-bucket' AND window_kind = 'active'").get()?.count, 0);
  d1.db.close();
});
