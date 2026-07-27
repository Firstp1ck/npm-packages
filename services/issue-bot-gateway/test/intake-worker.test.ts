import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeWorker, type IntakeEnv } from "../intake/index.js";
import type { QueueProducerLike } from "../intake/enqueue.js";
import type { QuotaLimiter } from "../intake/rate-limit.js";
import type { NewSubmission, PendingOutbox, SubmissionStore } from "../intake/status-store.js";
import type { StoredSubmission } from "../shared/status.js";

class MemoryStore implements SubmissionStore {
  readonly byId = new Map<string, StoredSubmission>();
  readonly byKey = new Map<string, string>();
  readonly outbox: PendingOutbox[] = [];
  readonly digestReservations = new Map<string, { submissionId: string; expiresAt: number }>();
  async getByIdempotency(bucket: string, key: string) { const id = this.byKey.get(`${bucket}:${key}`); return id ? this.byId.get(id) ?? null : null; }
  async reserveDigest(digest: string, policyVersion: string, submissionId: string, now: number, expiresAt: number) {
    const key = `${policyVersion}:${digest}`; const existing = this.digestReservations.get(key);
    if (existing && existing.expiresAt > now) return false;
    this.digestReservations.set(key, { submissionId, expiresAt }); return true;
  }
  async releaseDigest(digest: string, policyVersion: string, submissionId: string) {
    const key = `${policyVersion}:${digest}`; if (this.digestReservations.get(key)?.submissionId === submissionId) this.digestReservations.delete(key);
  }
  async getById(id: string) { return this.byId.get(id) ?? null; }
  async create(input: NewSubmission) {
    const existing = await this.getByIdempotency(input.ipBucketHash, input.idempotencyKey);
    if (existing) return { created: false, record: existing, outboxId: null };
    const record: StoredSubmission = {
      id: input.id, idempotencyKey: input.idempotencyKey, payloadDigest: input.payloadDigest, policyVersion: input.policyVersion,
      status: input.status, reasonCode: input.reasonCode, statusNonce: input.statusNonce, statusTokenHash: input.statusTokenHash,
      ipBucketHash: input.ipBucketHash, issueUrl: null, issueNumber: null, createdAt: input.createdAt, updatedAt: input.createdAt, modelBound: input.modelBound,
    };
    this.byId.set(record.id, record); this.byKey.set(`${record.ipBucketHash}:${record.idempotencyKey}`, record.id);
    let outboxId: number | null = null;
    if (input.queuePayload) {
      outboxId = this.outbox.length + 1;
      this.outbox.push({ id: outboxId, submissionId: input.id, queuePayload: input.queuePayload, createdAt: input.createdAt });
    }
    return { created: true, record, outboxId };
  }
  async markQueuedAndDeleteOutbox(id: string, outboxId: number, now: number) {
    const record = this.byId.get(id); if (record && record.status === "received") { record.status = "queued"; record.updatedAt = now; }
    const index = this.outbox.findIndex((entry) => entry.id === outboxId); if (index >= 0) this.outbox.splice(index, 1);
  }
  async markUnavailableAndDeleteOutbox(id: string, outboxId: number | null, now: number) {
    const record = this.byId.get(id); if (record && (record.status === "received" || record.status === "queued")) { record.status = "unavailable"; record.reasonCode = "unavailable"; record.updatedAt = now; }
    if (outboxId !== null) { const index = this.outbox.findIndex((entry) => entry.id === outboxId); if (index >= 0) this.outbox.splice(index, 1); }
  }
  async listPendingOutbox(limit: number) { return this.outbox.slice(0, limit); }
  async cleanup() {}
}

class MemoryQueue implements QueueProducerLike {
  messages: unknown[] = [];
  constructor(private readonly fail = false) {}
  async send(message: unknown) { if (this.fail) throw new Error("test queue failure"); this.messages.push(message); }
}

const env: IntakeEnv = {
  ISSUE_BOT_DB: {} as IntakeEnv["ISSUE_BOT_DB"], ISSUE_BOT_QUEUE: new MemoryQueue(), TURNSTILE_SECRET_KEY: "test-turnstile-secret",
  IP_HASH_KEY: "test-ip-key", STATUS_TOKEN_KEY: "test-status-key", ISSUE_BOT_ADMISSION_ENABLED: "true", ISSUE_BOT_POLICY_VERSION: "1",
  ISSUE_BOT_ALLOWED_ORIGINS: "https://webui.example.test", TURNSTILE_ALLOWED_HOSTNAMES: "webui.example.test", TURNSTILE_EXPECTED_ACTION: "issue_bot_submit",
};
const validIssue = {
  categoryId: "bug", componentId: "webui", templateId: "bug-defect-report", summary: "Panel fails to open",
  fields: { severity: "high", expectedBehavior: "The panel opens.", actualBehavior: "Nothing appears.", reproductionSteps: "1. Open the deck\n2. Select the panel" },
};
function request(payload: unknown, idempotencyKey = "123e4567-e89b-42d3-a456-426614174000") {
  return new Request("https://gateway.example.test/v1/submissions", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://webui.example.test", "cf-connecting-ip": "192.0.2.8" },
    body: JSON.stringify({ schemaVersion: 1, idempotencyKey, turnstileToken: "turnstile-token", issue: payload }),
  });
}
function worker(store: MemoryStore, quota: QuotaLimiter = { reserve: async () => true }, queue = new MemoryQueue()) {
  const currentEnv = { ...env, ISSUE_BOT_QUEUE: queue };
  return { currentEnv, queue, handler: createIntakeWorker({ store, quota, now: () => 1_740_000_000_000, fetch: async (_url, init) => {
    const body = init?.body as URLSearchParams;
    return new Response(JSON.stringify({ success: true, hostname: "webui.example.test", action: "issue_bot_submit", cdata: body.get("idempotency_key") }));
  } }) };
}

test("admission validates, queues, and capability-protects content-free status", async () => {
  const store = new MemoryStore(); const run = worker(store);
  const response = await run.handler.fetch(request(validIssue), run.currentEnv);
  assert.equal(response.status, 202);
  const body = await response.json() as { ok: boolean; status: string; submissionId: string; statusToken: string; pollAfterMs: number };
  assert.deepEqual(Object.keys(body).sort(), ["ok", "pollAfterMs", "status", "statusToken", "submissionId"]);
  assert.equal(body.status, "queued"); assert.equal(run.queue.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(store.byId.values().next().value), /Panel fails to open/);
  const poll = await run.handler.fetch(new Request(`https://gateway.example.test/v1/submissions/${body.submissionId}`, { headers: { authorization: `Bearer ${body.statusToken}`, origin: "https://webui.example.test" } }), run.currentEnv);
  assert.deepEqual(await poll.json(), { ok: true, status: "queued", submissionId: body.submissionId, pollAfterMs: 2500 });
});

test("replay is deterministic, conflict is rejected, and wrong capability is indistinguishable", async () => {
  const store = new MemoryStore(); const run = worker(store);
  const first = await run.handler.fetch(request(validIssue), run.currentEnv);
  const firstBody = await first.json() as { submissionId: string; statusToken: string };
  const replay = await run.handler.fetch(request(validIssue), run.currentEnv);
  const replayBody = await replay.json() as { submissionId: string; statusToken: string };
  assert.equal(replayBody.submissionId, firstBody.submissionId); assert.equal(replayBody.statusToken, firstBody.statusToken); assert.equal(run.queue.messages.length, 1);
  const conflict = await run.handler.fetch(request({ ...validIssue, summary: "Other report" }), run.currentEnv);
  assert.equal(conflict.status, 409);
  const wrong = await run.handler.fetch(new Request(`https://gateway.example.test/v1/submissions/${firstBody.submissionId}`, { headers: { authorization: "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } }), run.currentEnv);
  assert.equal(wrong.status, 404); assert.deepEqual(await wrong.json(), { ok: false, error: "not_found" });
});

test("same content under a fresh idempotency key is rejected during the digest cooldown", async () => {
  const store = new MemoryStore(); const run = worker(store);
  const first = await run.handler.fetch(request(validIssue), run.currentEnv);
  assert.equal(first.status, 202);
  const duplicate = await run.handler.fetch(request(validIssue, "223e4567-e89b-42d3-a456-426614174000"), run.currentEnv);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { ok: false, error: "duplicate_submission" });
  assert.equal(run.queue.messages.length, 1);
});

test("deterministic sensitive and schema failures never enqueue", async () => {
  const store = new MemoryStore(); const run = worker(store);
  const sensitive = await run.handler.fetch(request({ ...validIssue, fields: { ...validIssue.fields, actualBehavior: "This is a security vulnerability with an exploit." } }), run.currentEnv);
  assert.equal(sensitive.status, 200);
  assert.equal((await sensitive.json() as { status: string }).status, "rejected"); assert.equal(run.queue.messages.length, 0);
  const malformed = await run.handler.fetch(request({ ...validIssue, fields: { ...validIssue.fields, unexpected: "x" } }), run.currentEnv);
  assert.equal(malformed.status, 400); assert.equal(run.queue.messages.length, 0);
});

test("Turnstile failure fails closed before admission", async () => {
  const store = new MemoryStore();
  const handler = createIntakeWorker({ store, quota: { reserve: async () => true }, now: () => 1_740_000_000_000, fetch: async () => new Response(JSON.stringify({ success: false })) });
  const response = await handler.fetch(request(validIssue), { ...env, ISSUE_BOT_QUEUE: new MemoryQueue() });
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, error: "verification_failed" });
  assert.equal(store.byId.size, 0);
});

test("admission defaults closed, origin failures fail closed, quota failure and queue failure create no pending prose", async () => {
  const store = new MemoryStore(); const closed = worker(store);
  const disabled = await closed.handler.fetch(request(validIssue), { ...closed.currentEnv, ISSUE_BOT_ADMISSION_ENABLED: "false" });
  assert.equal(disabled.status, 503);
  const badOrigin = await closed.handler.fetch(new Request("https://gateway.example.test/v1/submissions", { method: "POST", headers: { "content-type": "application/json", origin: "https://other.example.test", "cf-connecting-ip": "192.0.2.8" }, body: JSON.stringify({ schemaVersion: 1, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", turnstileToken: "t", issue: validIssue }) }), closed.currentEnv);
  assert.equal(badOrigin.status, 403);
  const quotaBlocked = worker(new MemoryStore(), { reserve: async () => false });
  const quotaResult = await quotaBlocked.handler.fetch(request(validIssue), quotaBlocked.currentEnv);
  assert.equal(quotaResult.status, 429);
  const store2 = new MemoryStore(); const failed = worker(store2, { reserve: async () => true }, new MemoryQueue(true));
  const result = await failed.handler.fetch(request(validIssue), failed.currentEnv);
  assert.equal((await result.json() as { status: string }).status, "unavailable"); assert.equal(store2.outbox.length, 0);
});
