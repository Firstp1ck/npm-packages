import { createIpBucket, createStatusCapability, randomBase64Url, sha256Hex, utf8Length } from "../shared/crypto.js";
import { POLICY_VERSION } from "../shared/catalog.js";
import { queueDigestPreimage, queueMessageFor, validateSubmission } from "../shared/schemas.js";
import { publicStatusEnvelope, type StatusEnvelope, type StoredSubmission } from "../shared/status.js";
import { enqueueSubmission, type QueueProducerLike } from "./enqueue.js";
import { prefilterIssue } from "./prefilters.js";
import { D1QuotaLimiter, type QuotaLimiter } from "./rate-limit.js";
import { D1SubmissionStore, type D1DatabaseLike, type SubmissionStore } from "./status-store.js";
import { verifyTurnstile } from "./turnstile.js";

const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export interface IntakeEnv {
  ISSUE_BOT_DB: D1DatabaseLike;
  ISSUE_BOT_QUEUE: QueueProducerLike;
  TURNSTILE_SECRET_KEY: string;
  IP_HASH_KEY: string;
  STATUS_TOKEN_KEY: string;
  ISSUE_BOT_ADMISSION_ENABLED?: string;
  ISSUE_BOT_POLICY_VERSION?: string;
  ISSUE_BOT_ALLOWED_ORIGINS?: string;
  TURNSTILE_ALLOWED_HOSTNAMES?: string;
  TURNSTILE_EXPECTED_ACTION?: string;
  TURNSTILE_VERIFY_URL?: string;
  SUBMISSION_RETENTION_DAYS?: string;
  DUPLICATE_COOLDOWN_SECONDS?: string;
}

interface ScheduledController { waitUntil?(promise: Promise<unknown>): void }
export interface IntakeDependencies {
  now?: () => number;
  fetch?: typeof fetch;
  store?: SubmissionStore;
  quota?: QuotaLimiter;
}

function configuredOrigins(env: IntakeEnv): Set<string> {
  return new Set((env.ISSUE_BOT_ALLOWED_ORIGINS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
}

function corsHeaders(request: Request, env: IntakeEnv): HeadersInit {
  const origin = request.headers.get("origin");
  if (!origin || !configuredOrigins(env).has(origin)) return { "Vary": "Origin" };
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "600",
    "Vary": "Origin",
  };
}

function json(request: Request, env: IntakeEnv, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...corsHeaders(request, env) } });
}

function requestOriginAllowed(request: Request, env: IntakeEnv): boolean {
  const origin = request.headers.get("origin");
  return !!origin && configuredOrigins(env).has(origin);
}

function capabilityFromRequest(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]{43})$/u);
  return match?.[1] ?? null;
}

function responseForRecord(record: StoredSubmission): StatusEnvelope {
  const response = publicStatusEnvelope(record);
  if (!response) return { ok: true, status: "unavailable", submissionId: record.id, reasonCode: "unavailable" };
  return response;
}

async function statusToken(env: IntakeEnv, record: StoredSubmission): Promise<string> {
  return (await createStatusCapability(env.STATUS_TOKEN_KEY, record.id, record.statusNonce)).token;
}

async function handleStatus(request: Request, env: IntakeEnv, store: SubmissionStore, id: string): Promise<Response> {
  const capability = capabilityFromRequest(request);
  if (!capability || !/^[A-Za-z0-9_-]{22}$/u.test(id)) return json(request, env, { ok: false, error: "not_found" }, 404);
  const record = await store.getById(id);
  if (!record || await sha256Hex(capability) !== record.statusTokenHash) return json(request, env, { ok: false, error: "not_found" }, 404);
  return json(request, env, responseForRecord(record));
}

async function parseJson(request: Request): Promise<unknown | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return null;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BYTES) return null;
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
}

async function submissionResponse(request: Request, env: IntakeEnv, record: StoredSubmission): Promise<Response> {
  const token = await statusToken(env, record);
  const status = responseForRecord(record);
  // The capability is issued on admission/replay only. Polling responses never echo it.
  return json(request, env, { ...status, statusToken: token }, status.status === "queued" ? 202 : 200);
}

async function handleSubmission(request: Request, env: IntakeEnv, store: SubmissionStore, quota: QuotaLimiter, now: number, fetcher: typeof fetch): Promise<Response> {
  if (!requestOriginAllowed(request, env)) return json(request, env, { ok: false, error: "origin_not_allowed" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json(request, env, { ok: false, error: "invalid_request" }, 415);
  const raw = await parseJson(request);
  const submission = validateSubmission(raw);
  if (!submission) return json(request, env, { ok: false, error: "invalid_request" }, 400);

  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !env.IP_HASH_KEY || !env.STATUS_TOKEN_KEY) return json(request, env, { ok: false, error: "unavailable" }, 503);
  const bucket = await createIpBucket(env.IP_HASH_KEY, ip, new Date(now));
  const provisional = queueMessageFor("AAAAAAAAAAAAAAAAAAAAAA", "0".repeat(64), submission.issue);
  const digest = await sha256Hex(queueDigestPreimage(provisional));
  const existing = await store.getByIdempotency(bucket, submission.idempotencyKey);
  if (existing) {
    if (existing.payloadDigest !== digest || existing.policyVersion !== POLICY_VERSION) return json(request, env, { ok: false, error: "idempotency_conflict" }, 409);
    return submissionResponse(request, env, existing);
  }
  if (env.ISSUE_BOT_ADMISSION_ENABLED !== "true" || env.ISSUE_BOT_POLICY_VERSION !== POLICY_VERSION) {
    return json(request, env, { ok: false, error: "unavailable" }, 503);
  }

  const allowedHostnames = (env.TURNSTILE_ALLOWED_HOSTNAMES ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!await verifyTurnstile(submission.turnstileToken, {
    secretKey: env.TURNSTILE_SECRET_KEY,
    expectedAction: env.TURNSTILE_EXPECTED_ACTION || undefined,
    expectedCdata: submission.idempotencyKey,
    remoteIp: ip,
    allowedHostnames,
    endpoint: env.TURNSTILE_VERIFY_URL,
  }, fetcher)) return json(request, env, { ok: false, error: "verification_failed" }, 403);

  const prefilter = prefilterIssue(submission.issue);
  const id = randomBase64Url(16);
  const nonce = randomBase64Url(16);
  const statusCapability = await createStatusCapability(env.STATUS_TOKEN_KEY, id, nonce);
  if (!prefilter.accepted) {
    const persisted = await store.create({
      id, idempotencyKey: submission.idempotencyKey, payloadDigest: digest, policyVersion: POLICY_VERSION, status: "rejected_prefilter",
      reasonCode: prefilter.reasonCode, statusNonce: nonce, statusTokenHash: statusCapability.hash, ipBucketHash: bucket, createdAt: now, modelBound: false,
    });
    if (!persisted.created && (persisted.record.payloadDigest !== digest || persisted.record.policyVersion !== POLICY_VERSION)) return json(request, env, { ok: false, error: "idempotency_conflict" }, 409);
    return submissionResponse(request, env, persisted.record);
  }
  const duplicateCooldownSeconds = Math.min(604_800, Math.max(0, Number(env.DUPLICATE_COOLDOWN_SECONDS ?? "86400") || 0));
  const digestReserved = duplicateCooldownSeconds > 0;
  if (digestReserved && !await store.reserveDigest(digest, POLICY_VERSION, id, now, now + duplicateCooldownSeconds * 1_000)) {
    return json(request, env, { ok: false, error: "duplicate_submission" }, 409);
  }
  if (!await quota.reserve(bucket, now)) {
    if (digestReserved) await store.releaseDigest(digest, POLICY_VERSION, id);
    return json(request, env, { ok: false, error: "rate_limited" }, 429);
  }

  const message = queueMessageFor(id, digest, submission.issue);
  const queuePayload = JSON.stringify(message);
  if (utf8Length(queuePayload) > 96 * 1024) {
    await quota.release?.(bucket, now);
    if (digestReserved) await store.releaseDigest(digest, POLICY_VERSION, id);
    return json(request, env, { ok: false, error: "invalid_request" }, 400);
  }
  let persisted: { created: boolean; record: StoredSubmission; outboxId: number | null };
  try {
    persisted = await store.create({
      id, idempotencyKey: submission.idempotencyKey, payloadDigest: digest, policyVersion: POLICY_VERSION, status: "received", reasonCode: null,
      statusNonce: nonce, statusTokenHash: statusCapability.hash, ipBucketHash: bucket, createdAt: now, modelBound: true, queuePayload,
    });
  } catch {
    await quota.release?.(bucket, now);
    if (digestReserved) await store.releaseDigest(digest, POLICY_VERSION, id);
    return json(request, env, { ok: false, error: "unavailable" }, 503);
  }
  if (!persisted.created) {
    await quota.release?.(bucket, now);
    if (digestReserved) await store.releaseDigest(digest, POLICY_VERSION, id);
    if (persisted.record.payloadDigest !== digest || persisted.record.policyVersion !== POLICY_VERSION) return json(request, env, { ok: false, error: "idempotency_conflict" }, 409);
    return submissionResponse(request, env, persisted.record);
  }
  if (persisted.outboxId === null) return submissionResponse(request, env, persisted.record);
  await enqueueSubmission(store, env.ISSUE_BOT_QUEUE, { id: persisted.outboxId, submissionId: id, queuePayload }, now);
  const current = await store.getById(id) ?? persisted.record;
  return submissionResponse(request, env, current);
}

export function createIntakeWorker(dependencies: IntakeDependencies = {}) {
  const clock = dependencies.now ?? Date.now;
  const fetcher = dependencies.fetch ?? fetch;
  const resolveStore = (env: IntakeEnv) => dependencies.store ?? new D1SubmissionStore(env.ISSUE_BOT_DB);
  const resolveQuota = (env: IntakeEnv) => dependencies.quota ?? new D1QuotaLimiter(env.ISSUE_BOT_DB);

  return {
    async fetch(request: Request, env: IntakeEnv): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        if (!requestOriginAllowed(request, env)) return json(request, env, { ok: false, error: "origin_not_allowed" }, 403);
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }
      if (request.method === "GET" && url.pathname === "/health") return json(request, env, { ok: true, status: "ready" });
      const store = resolveStore(env);
      if (request.method === "POST" && url.pathname === "/v1/submissions") return handleSubmission(request, env, store, resolveQuota(env), clock(), fetcher);
      const match = url.pathname.match(/^\/v1\/submissions\/([A-Za-z0-9_-]{22})$/u);
      if (request.method === "GET" && match) return handleStatus(request, env, store, match[1]);
      return json(request, env, { ok: false, error: "not_found" }, 404);
    },
    async scheduled(_event: unknown, env: IntakeEnv, controller?: ScheduledController): Promise<void> {
      const work = (async () => {
        const store = resolveStore(env);
        const now = clock();
        await store.cleanup(now, Number(env.SUBMISSION_RETENTION_DAYS ?? "7"));
        for (const pending of await store.listPendingOutbox(20)) await enqueueSubmission(store, env.ISSUE_BOT_QUEUE, pending, now);
      })();
      controller?.waitUntil?.(work);
      await work;
    },
  };
}

export default createIntakeWorker();
