import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { canonicalizeIssue } from "../shared/catalog.js";
import { sha256Hex } from "../shared/crypto.js";
import { queueDigestPreimage, queueMessageFor, type QueueMessage } from "../shared/schemas.js";
import type { SafeReasonCode, StoredStatus } from "../shared/status.js";
import { createGithubAppJwt } from "../consumer/github-app.js";
import { createConsumerWorker, type ConsumerEnv, type QueueMessageLike } from "../consumer/index.js";
import type { ClaimResult, ConsumerStore, MutationState } from "../consumer/status-store.js";

const NOW = 1_740_000_000_000;

interface MemoryRecord {
  status: StoredStatus;
  mutationState: MutationState;
  leaseId: string | null;
  digest: string;
  policyVersion: string;
  reason: SafeReasonCode | null;
  issueUrl: string | null;
  issueNumber: number | null;
  modelId: string | null;
  openaiRequestId: string | null;
  modelLatencyMs: number | null;
  githubRequestId: string | null;
  deliveries: number;
  githubAttempts: number;
}

class MemoryConsumerStore implements ConsumerStore {
  readonly record: MemoryRecord;
  readonly events: string[] = [];
  constructor(message: QueueMessage, status: StoredStatus = "queued", mutationState: MutationState = "none") {
    this.record = { status, mutationState, leaseId: null, digest: message.payload_digest, policyVersion: message.policy_version, reason: null, issueUrl: null, issueNumber: null, modelId: null, openaiRequestId: null, modelLatencyMs: null, githubRequestId: null, deliveries: 0, githubAttempts: 0 };
  }
  async claim(_id: string, digest: string, policyVersion: string, leaseId: string): Promise<ClaimResult> {
    if (digest !== this.record.digest || policyVersion !== this.record.policyVersion) return { kind: "terminal" };
    if (this.record.status === "received") return { kind: "not_ready" };
    if (["created", "rejected", "review", "unavailable", "rejected_prefilter"].includes(this.record.status)) return { kind: "terminal" };
    if (this.record.leaseId) return { kind: "busy" };
    this.record.leaseId = leaseId;
    this.record.deliveries += 1;
    if (this.record.status === "queued") this.record.status = "checking";
    this.events.push("claim");
    return { kind: "claimed", status: this.record.status === "unknown" ? "unknown" : "checking", mutationState: this.record.mutationState };
  }
  async releaseLease(_id: string, _digest: string, leaseId: string): Promise<boolean> {
    if (this.record.leaseId !== leaseId) return false;
    this.record.leaseId = null; this.events.push("release"); return true;
  }
  async recordModelAttempt(_id: string, _digest: string, leaseId: string, modelId: string, requestId: string | null, latencyMs: number): Promise<boolean> {
    if (this.record.status !== "checking" || this.record.leaseId !== leaseId) return false;
    this.record.modelId = modelId; this.record.openaiRequestId = requestId; this.record.modelLatencyMs = latencyMs; this.events.push("model"); return true;
  }
  async markPostStarted(_id: string, _digest: string, leaseId: string): Promise<boolean> {
    if (this.record.status !== "checking" || this.record.leaseId !== leaseId || this.record.mutationState !== "none") return false;
    this.record.mutationState = "post_started"; this.record.githubAttempts += 1; this.events.push("post_started"); return true;
  }
  async clearPostStartedForRetry(_id: string, _digest: string, leaseId: string): Promise<boolean> {
    if (this.record.status !== "checking" || this.record.leaseId !== leaseId || this.record.mutationState !== "post_started") return false;
    this.record.mutationState = "none"; this.record.leaseId = null; this.events.push("rate_limit_retry"); return true;
  }
  async recordGithubRequest(_id: string, _digest: string, leaseId: string, requestId: string | null): Promise<boolean> {
    if (this.record.status !== "checking" || this.record.leaseId !== leaseId || this.record.mutationState !== "post_started") return false;
    this.record.githubRequestId = requestId; this.events.push("github_request"); return true;
  }
  async transition(_id: string, _digest: string, leaseId: string, status: "created" | "rejected" | "review" | "unavailable" | "unknown", reason: SafeReasonCode, _now: number, issue?: { url: string; number: number }): Promise<boolean> {
    if (this.record.leaseId !== leaseId) return false;
    if (status === "unknown" && this.record.status !== "checking" && this.record.status !== "unknown") return false;
    if (status !== "unknown" && this.record.status !== "checking" && this.record.status !== "unknown") return false;
    this.record.status = status; this.record.reason = reason; this.record.leaseId = null;
    if (status === "created") { this.record.mutationState = "confirmed"; this.record.issueUrl = issue?.url ?? null; this.record.issueNumber = issue?.number ?? null; }
    if (status === "unknown") this.record.mutationState = "ambiguous";
    this.events.push(status); return true;
  }
  async markMalformedUnavailable(_id: string, digest: string, policyVersion: string): Promise<boolean> {
    if (digest !== this.record.digest || policyVersion !== this.record.policyVersion) return false;
    this.record.status = "unavailable"; this.record.reason = "unavailable"; this.events.push("malformed"); return true;
  }
  async markDlqUnavailable(_id: string, digest: string, policyVersion: string): Promise<boolean> {
    if (digest !== this.record.digest || policyVersion !== this.record.policyVersion) return false;
    this.record.status = "unavailable"; this.record.reason = "unavailable"; this.record.leaseId = null; this.events.push("dlq"); return true;
  }
}

class FakeMessage implements QueueMessageLike {
  acked = 0;
  retries: Array<{ delaySeconds?: number } | undefined> = [];
  constructor(readonly body: unknown) {}
  ack() { this.acked += 1; }
  retry(options?: { delaySeconds?: number }) { this.retries.push(options); }
}

async function privateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/(.{64})/gu, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

test("GitHub App JWT accepts both PKCS#8 and GitHub-style PKCS#1 PEM keys", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.ok(await createGithubAppJwt("123", pkcs1, NOW));
  assert.ok(await createGithubAppJwt("123", pkcs8, NOW));
});

async function validMessage(summary = "The panel does not open"): Promise<QueueMessage> {
  const issue = canonicalizeIssue({
    categoryId: "bug", componentId: "webui", templateId: "bug-defect-report", summary,
    fields: { severity: "high", expectedBehavior: "The panel should appear.", actualBehavior: "No panel appears.", reproductionSteps: "1. Open the deck\n2. Choose the panel" },
  });
  assert.ok(issue);
  const partial = queueMessageFor("AAAAAAAAAAAAAAAAAAAAAA", "0".repeat(64), issue);
  return queueMessageFor(partial.submission_id, await sha256Hex(queueDigestPreimage(partial)), issue);
}

const ACCEPT = { schemaVersion: 1, decision: "accept", reasonCode: "acceptable", riskFlags: [] };
function openAiResponse(verdict: unknown = ACCEPT): Response {
  return new Response(JSON.stringify({
    id: "resp_fake_123", status: "completed", error: null, incomplete_details: null,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(verdict) }] }],
  }), { headers: { "x-request-id": "req-openai-123" } });
}
function json(value: unknown, status = 200, headers?: HeadersInit): Response { return new Response(JSON.stringify(value), { status, headers }); }

interface FakeGateway { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }>; posts: Array<Record<string, unknown>> }
function fakeGateway(options: { verdict?: unknown; openAiPayload?: unknown; markerIssue?: { number: number; body: string; user?: { login: string; type: string } } | null; post?: "success" | "throw" | "forbidden" | "rate_limited"; openAiError?: boolean } = {}): FakeGateway {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const posts: Array<Record<string, unknown>> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const request = init ?? {}; calls.push({ url, init: request });
    if (url.includes("/v1/responses")) {
      if (options.openAiError) throw new Error("synthetic upstream timeout");
      return options.openAiPayload === undefined ? openAiResponse(options.verdict) : json(options.openAiPayload);
    }
    if (url.includes("/access_tokens")) return json({ token: "test-installation-token-123456789" });
    if (request.method === "GET" && url.includes("/issues?")) return json(options.markerIssue ? [options.markerIssue] : []);
    if (request.method === "POST" && /\/issues$/u.test(url)) {
      posts.push(JSON.parse(String(request.body)) as Record<string, unknown>);
      if (options.post === "throw") throw new Error("synthetic ambiguous network outcome");
      if (options.post === "forbidden") return json({ message: "forbidden" }, 403, { "x-github-request-id": "gh-forbidden" });
      if (options.post === "rate_limited") return json({ message: "slow down" }, 429, { "retry-after": "30", "x-github-request-id": "gh-rate-limit" });
      return json({ number: 42 }, 201, { "x-github-request-id": "gh-create-123" });
    }
    throw new Error(`unexpected fake request ${url}`);
  }) as typeof globalThis.fetch;
  return { fetch: fetcher, calls, posts };
}

async function environment(overrides: Partial<ConsumerEnv> = {}): Promise<ConsumerEnv> {
  return {
    ISSUE_BOT_DB: {} as ConsumerEnv["ISSUE_BOT_DB"], OPENAI_API_KEY: "test-openai-key", GITHUB_APP_ID: "123", GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY: await privateKeyPem(), ISSUE_BOT_CREATE_ENABLED: "true", ISSUE_BOT_MODEL: "gpt-5.6-terra",
    ISSUE_BOT_GITHUB_OWNER: "firstpick", ISSUE_BOT_GITHUB_REPOSITORY: "pi-webui", ISSUE_BOT_GITHUB_APP_SLUG: "pi-webui-issue-bot",
    ISSUE_BOT_LABELS: "bug,webui", ISSUE_BOT_MAIN_QUEUE_NAME: "pi-webui-issue-bot", ISSUE_BOT_DLQ_NAME: "pi-webui-issue-bot-dlq",
    ...overrides,
  };
}

async function deliver(worker: ReturnType<typeof createConsumerWorker>, env: ConsumerEnv, message: FakeMessage, queue = "pi-webui-issue-bot") {
  await worker.queue({ queue, messages: [message] }, env);
}

test("strict accept makes a tool-free redacted model request then one down-scoped GitHub creation", async () => {
  const message = await validMessage("Panel opens https://outside.invalid/path but then fails");
  const store = new MemoryConsumerStore(message); const gateway = fakeGateway(); const env = await environment();
  const worker = createConsumerWorker({ now: () => NOW, fetch: gateway.fetch, store }); const queued = new FakeMessage(message);
  await deliver(worker, env, queued);

  assert.equal(queued.acked, 1); assert.equal(queued.retries.length, 0); assert.equal(store.record.status, "created");
  assert.equal(store.record.modelId, "gpt-5.6-terra"); assert.equal(store.record.openaiRequestId, "req-openai-123");
  assert.equal(store.record.githubAttempts, 1); assert.equal(gateway.posts.length, 1);
  assert.deepEqual(store.events.slice(-3), ["post_started", "github_request", "created"]);
  const openAi = JSON.parse(String(gateway.calls[0].init.body)) as Record<string, unknown>;
  assert.equal("tools" in openAi, false); assert.equal(openAi.model, "gpt-5.6-terra"); assert.equal(openAi.max_output_tokens, 2_048);
  assert.equal(JSON.stringify(openAi).includes("outside.invalid"), false);
  const input = openAi.input as Array<{ role: string; content: Array<{ text: string }> }>;
  assert.equal(input[0].role, "developer"); assert.match(input[1].content[0].text, /^BEGIN_[0-9a-f]{24}/u);
  const text = openAi.text as { format: { strict: boolean; schema: { additionalProperties: boolean; properties: { riskFlags: object } } } };
  assert.equal(text.format.strict, true); assert.equal(text.format.schema.additionalProperties, false);
  assert.equal("uniqueItems" in text.format.schema.properties.riskFlags, false); assert.equal(JSON.stringify(text.format.schema).includes('"const"'), false);
  const tokenCall = gateway.calls.find((call) => call.url.includes("/access_tokens")); assert.ok(tokenCall);
  assert.deepEqual(JSON.parse(String(tokenCall.init.body)), { repositories: ["pi-webui"], permissions: { issues: "write" } });
  const jwt = String((tokenCall.init.headers as Record<string, string>).authorization).slice("Bearer ".length).split(".");
  assert.equal(JSON.parse(atob(jwt[0].replace(/-/g, "+").replace(/_/g, "/"))).alg, "RS256");
  const post = gateway.posts[0]; assert.equal(post.title, message.issue.title); assert.deepEqual(post.labels, ["bug", "webui"]);
  assert.match(String(post.body), /<!-- pi-webui-issue-bot:v1:AAAAAAAAAAAAAAAAAAAAAA:[0-9a-f]{16} -->/u);
  assert.equal("fetch" in worker, false);
});

test("malformed and semantically non-exact model verdicts fail closed without GitHub", async () => {
  const malformed = await validMessage(); const malformedStore = new MemoryConsumerStore(malformed); const malformedGateway = fakeGateway({ verdict: { ...ACCEPT, extra: true } });
  await deliver(createConsumerWorker({ now: () => NOW, fetch: malformedGateway.fetch, store: malformedStore }), await environment(), new FakeMessage(malformed));
  assert.equal(malformedStore.record.status, "review"); assert.equal(malformedGateway.posts.length, 0);

  const risky = await validMessage(); const riskyStore = new MemoryConsumerStore(risky); const riskyGateway = fakeGateway({ verdict: { ...ACCEPT, riskFlags: ["spam"] } });
  await deliver(createConsumerWorker({ now: () => NOW, fetch: riskyGateway.fetch, store: riskyStore }), await environment(), new FakeMessage(risky));
  assert.equal(riskyStore.record.status, "rejected"); assert.equal(riskyGateway.posts.length, 0);

  for (const payload of [
    { status: "incomplete", error: null, incomplete_details: { reason: "max_output_tokens" }, output: [] },
    { status: "completed", error: null, incomplete_details: null, output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] },
    { status: "completed", error: null, incomplete_details: null, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(ACCEPT) }, { type: "output_text", text: JSON.stringify(ACCEPT) }] }] },
  ]) {
    const message = await validMessage(); const store = new MemoryConsumerStore(message); const gateway = fakeGateway({ openAiPayload: payload });
    await deliver(createConsumerWorker({ now: () => NOW, fetch: gateway.fetch, store }), await environment(), new FakeMessage(message));
    assert.equal(store.record.status, "review"); assert.equal(gateway.posts.length, 0);
  }
});

test("transient OpenAI failures use queue retry and persist no mutation barrier", async () => {
  const message = await validMessage(); const store = new MemoryConsumerStore(message); const gateway = fakeGateway({ openAiError: true }); const queued = new FakeMessage(message);
  await deliver(createConsumerWorker({ now: () => NOW, fetch: gateway.fetch, store }), await environment(), queued);
  assert.equal(queued.acked, 0); assert.equal(queued.retries.length, 1); assert.equal(store.record.status, "checking");
  assert.equal(store.record.leaseId, null); assert.equal(store.record.mutationState, "none"); assert.equal(gateway.posts.length, 0);
});

test("ambiguous create becomes reconciliation-only and never posts a second time", async () => {
  const message = await validMessage(); const store = new MemoryConsumerStore(message); const firstGateway = fakeGateway({ post: "throw" }); const env = await environment();
  const first = new FakeMessage(message); await deliver(createConsumerWorker({ now: () => NOW, fetch: firstGateway.fetch, store }), env, first);
  assert.equal(first.acked, 1); assert.equal(store.record.status, "unknown"); assert.equal(store.record.mutationState, "ambiguous"); assert.equal(firstGateway.posts.length, 1);

  const redeliveryGateway = fakeGateway({ markerIssue: null }); const redelivery = new FakeMessage(message);
  await deliver(createConsumerWorker({ now: () => NOW + 60_000, fetch: redeliveryGateway.fetch, store }), env, redelivery);
  assert.equal(redelivery.acked, 1); assert.equal(redeliveryGateway.posts.length, 0); assert.equal(store.record.status, "unknown");
  assert.equal(redeliveryGateway.calls.filter((call) => call.url.includes("/v1/responses")).length, 0);
});

test("exact marker reconciliation resolves a redelivery without a post", async () => {
  const message = await validMessage(); const marker = `<!-- pi-webui-issue-bot:v1:${message.submission_id}:${message.payload_digest.slice(0, 16)} -->`;
  const store = new MemoryConsumerStore(message, "unknown", "post_started");
  const gateway = fakeGateway({ markerIssue: { number: 73, body: `body\n${marker}`, user: { login: "pi-webui-issue-bot[bot]", type: "Bot" } } });
  const queued = new FakeMessage(message);
  await deliver(createConsumerWorker({ now: () => NOW, fetch: gateway.fetch, store }), await environment(), queued);
  assert.equal(queued.acked, 1); assert.equal(store.record.status, "created"); assert.equal(store.record.issueNumber, 73); assert.equal(gateway.posts.length, 0);
});

test("a definitive GitHub rate limit clears the mutation barrier before delayed retry", async () => {
  const message = await validMessage(); const store = new MemoryConsumerStore(message); const gateway = fakeGateway({ post: "rate_limited" });
  const queued = new FakeMessage(message);
  await deliver(createConsumerWorker({ now: () => NOW, fetch: gateway.fetch, store }), await environment(), queued);
  assert.equal(queued.acked, 0); assert.deepEqual(queued.retries, [{ delaySeconds: 30 }]);
  assert.equal(store.record.status, "checking"); assert.equal(store.record.mutationState, "none"); assert.equal(store.record.leaseId, null);
});

test("DLQ deliveries become unavailable without model or GitHub calls and malformed queue input cannot create", async () => {
  const message = await validMessage(); const store = new MemoryConsumerStore(message); const gateway = fakeGateway(); const env = await environment(); const dlq = new FakeMessage(message);
  await deliver(createConsumerWorker({ now: () => NOW, fetch: gateway.fetch, store }), env, dlq, "pi-webui-issue-bot-dlq");
  assert.equal(dlq.acked, 1); assert.equal(store.record.status, "unavailable"); assert.equal(gateway.calls.length, 0);

  const misconfigured = new FakeMessage(message); const misconfiguredStore = new MemoryConsumerStore(message);
  await deliver(createConsumerWorker({ now: () => NOW, fetch: gateway.fetch, store: misconfiguredStore }), await environment({ ISSUE_BOT_MAIN_QUEUE_NAME: undefined }), misconfigured);
  assert.equal(misconfigured.acked, 1); assert.equal(misconfiguredStore.record.status, "unavailable"); assert.equal(gateway.calls.length, 0);

  const tampered = { ...message, issue: { ...message.issue, title: "not canonical" } }; const noCall = new FakeMessage(tampered);
  await deliver(createConsumerWorker({ now: () => NOW, fetch: gateway.fetch, store: new MemoryConsumerStore(message) }), env, noCall);
  assert.equal(noCall.acked, 1); assert.equal(gateway.posts.length, 0);
});
