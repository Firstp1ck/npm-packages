import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeIssue } from "../shared/catalog.js";
import { sha256Hex } from "../shared/crypto.js";
import { queueDigestPreimage, queueMessageFor, type QueueMessage } from "../shared/schemas.js";
import type { SafeReasonCode, StoredStatus } from "../shared/status.js";
import { createConsumerWorker, type ConsumerEnv, type QueueMessageLike } from "../consumer/index.js";
import type { ClaimResult, ConsumerStore, MutationState } from "../consumer/status-store.js";

class FlowStore implements ConsumerStore {
  status: StoredStatus = "queued";
  mutation: MutationState = "none";
  lease: string | null = null;
  postStarts = 0;
  constructor(private readonly message: QueueMessage) {}
  async claim(_id: string, digest: string, policy: string, lease: string): Promise<ClaimResult> {
    if (digest !== this.message.payload_digest || policy !== this.message.policy_version || this.status === "created") return { kind: "terminal" };
    if (this.lease) return { kind: "busy" };
    this.lease = lease; if (this.status === "queued") this.status = "checking";
    return { kind: "claimed", status: this.status === "unknown" ? "unknown" : "checking", mutationState: this.mutation };
  }
  async releaseLease(_id: string, _digest: string, lease: string) { if (this.lease !== lease) return false; this.lease = null; return true; }
  async recordModelAttempt(_id: string, _digest: string, lease: string) { return this.status === "checking" && this.lease === lease; }
  async markPostStarted(_id: string, _digest: string, lease: string) { if (this.status !== "checking" || this.lease !== lease || this.mutation !== "none") return false; this.mutation = "post_started"; this.postStarts += 1; return true; }
  async clearPostStartedForRetry(_id: string, _digest: string, lease: string) { if (this.lease !== lease || this.mutation !== "post_started") return false; this.mutation = "none"; this.lease = null; return true; }
  async recordGithubRequest(_id: string, _digest: string, lease: string) { return this.status === "checking" && this.lease === lease && this.mutation === "post_started"; }
  async transition(_id: string, _digest: string, lease: string, status: "created" | "rejected" | "review" | "unavailable" | "unknown", _reason: SafeReasonCode, _now: number, issue?: { url: string; number: number }) {
    if (this.lease !== lease) return false; this.status = status; this.lease = null; if (status === "created") { this.mutation = "confirmed"; assert.equal(issue?.number, 101); } if (status === "unknown") this.mutation = "ambiguous"; return true;
  }
  async markMalformedUnavailable() { this.status = "unavailable"; return true; }
  async markDlqUnavailable() { this.status = "unavailable"; return true; }
}

class Delivery implements QueueMessageLike {
  acked = 0; retries = 0;
  constructor(readonly body: unknown) {}
  ack() { this.acked += 1; }
  retry() { this.retries += 1; }
}

async function pem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let raw = ""; for (const byte of bytes) raw += String.fromCharCode(byte);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(raw).replace(/(.{64})/gu, "$1\n")}\n-----END PRIVATE KEY-----`;
}

async function queueMessage(): Promise<QueueMessage> {
  const issue = canonicalizeIssue({
    categoryId: "bug", componentId: "webui", templateId: "bug-defect-report", summary: "The panel is not visible",
    fields: { severity: "high", expectedBehavior: "A panel is visible.", actualBehavior: "Nothing is visible.", reproductionSteps: "1. Open deck\n2. Select panel" },
  });
  assert.ok(issue);
  const partial = queueMessageFor("BBBBBBBBBBBBBBBBBBBBBB", "0".repeat(64), issue);
  return queueMessageFor(partial.submission_id, await sha256Hex(queueDigestPreimage(partial)), issue);
}

test("e2e fake queue -> strict OpenAI -> GitHub App -> D1 state creates exactly one issue across redelivery", async () => {
  const message = await queueMessage(); const store = new FlowStore(message); let postCount = 0; const modelBodies: unknown[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/responses")) {
      modelBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: "resp-e2e", status: "completed", error: null, incomplete_details: null,
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ schemaVersion: 1, decision: "accept", reasonCode: "acceptable", riskFlags: [] }) }] }],
      }));
    }
    if (url.includes("/access_tokens")) return new Response(JSON.stringify({ token: "test-installation-token-123456789" }));
    if (init?.method === "GET") return new Response(JSON.stringify([]));
    if (init?.method === "POST") { postCount += 1; return new Response(JSON.stringify({ number: 101 }), { status: 201 }); }
    throw new Error("unexpected fake request");
  }) as typeof fetch;
  const env: ConsumerEnv = {
    ISSUE_BOT_DB: {} as ConsumerEnv["ISSUE_BOT_DB"], OPENAI_API_KEY: "test-openai-key", GITHUB_APP_ID: "123", GITHUB_APP_INSTALLATION_ID: "456", GITHUB_APP_PRIVATE_KEY: await pem(),
    ISSUE_BOT_CREATE_ENABLED: "true", ISSUE_BOT_MODEL: "gpt-5.6-terra", ISSUE_BOT_GITHUB_OWNER: "firstpick", ISSUE_BOT_GITHUB_REPOSITORY: "pi-webui",
    ISSUE_BOT_GITHUB_APP_SLUG: "pi-webui-issue-bot", ISSUE_BOT_MAIN_QUEUE_NAME: "pi-webui-issue-bot",
  };
  const worker = createConsumerWorker({ now: () => 1_740_000_000_000, fetch: fakeFetch, store });
  const first = new Delivery(message); await worker.queue({ queue: "pi-webui-issue-bot", messages: [first] }, env);
  const redelivery = new Delivery(message); await worker.queue({ queue: "pi-webui-issue-bot", messages: [redelivery] }, env);

  assert.equal(first.acked, 1); assert.equal(redelivery.acked, 1); assert.equal(first.retries + redelivery.retries, 0);
  assert.equal(store.status, "created"); assert.equal(store.postStarts, 1); assert.equal(postCount, 1);
  assert.equal(modelBodies.length, 1); assert.equal("tools" in (modelBodies[0] as object), false);
});
