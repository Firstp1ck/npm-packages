import assert from "node:assert/strict";
import { createIssueBotClient, readIssueBotRuntimeConfig } from "../public/issue-bot-client.mjs";

const submissionId = "AbCdEfGhIjKlMnOpQrStUv";
const statusToken = "a".repeat(43);
const uuid = "123e4567-e89b-42d3-a456-426614174000";
const issue = Object.freeze({
  categoryId: "bug",
  componentId: "webui",
  templateId: "bug-defect-report",
  summary: "Panel fails to open",
  fields: Object.freeze({
    severity: "high",
    expectedBehavior: "The panel opens.",
    actualBehavior: "Nothing appears.",
    reproductionSteps: "1. Open the deck\n2. Select the panel",
  }),
});

const config = Object.freeze({
  enabled: true,
  gatewayBaseUrl: "https://issue-intake.example.test/",
  turnstileSiteKey: "1x00000000000000000000AA",
  privateSecurityReportUrl: "https://github.com/Firstp1ck/pi-coding-agent-forge/security/advisories/new",
});

assert.deepEqual(readIssueBotRuntimeConfig(), {
  enabled: false,
  gatewayBaseUrl: "",
  turnstileSiteKey: "",
  privateSecurityReportUrl: "",
}, "missing public runtime configuration must leave the bot disabled");
assert.equal(readIssueBotRuntimeConfig({ ...config, gatewayBaseUrl: "http://localhost:8787" }).enabled, false, "non-HTTPS gateway configuration must fail closed");
assert.equal(readIssueBotRuntimeConfig({ ...config, turnstileSiteKey: "contains whitespace" }).enabled, false, "invalid public Turnstile configuration must fail closed");

let disabledFetches = 0;
const disabled = createIssueBotClient({ config: readIssueBotRuntimeConfig(), fetchImpl: async () => { disabledFetches += 1; } });
const disabledResult = await disabled.submit({ issue });
assert.equal(disabled.available, false);
assert.equal(disabledResult.result.status, "unavailable");
assert.equal(disabledFetches, 0, "disabled configuration must not contact an arbitrary endpoint");

const calls = [];
const statuses = [];
const client = createIssueBotClient({
  config,
  uuidFactory: () => uuid,
  getTurnstileToken: async ({ siteKey, idempotencyKey }) => {
    assert.equal(siteKey, config.turnstileSiteKey);
    assert.equal(idempotencyKey, uuid, "Turnstile cData must bind the challenge to the admission UUID");
    return "fresh-turnstile-token";
  },
  sleep: async () => {},
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") {
      return new Response(JSON.stringify({
        ok: true,
        status: "queued",
        submissionId,
        statusToken,
        pollAfterMs: 2_500,
      }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      ok: true,
      status: "created",
      submissionId,
      issueUrl: "https://github.com/Firstp1ck/pi-coding-agent-forge/issues/42",
      issueNumber: 42,
    }), { headers: { "content-type": "application/json" } });
  },
});
const completed = await client.submit({ issue, onStatus: (status) => statuses.push(status.status) });
assert.equal(completed.result.status, "created");
assert.equal(completed.result.issueNumber, 42);
assert.equal(completed.handle.refresh instanceof Function, true, "the in-memory opaque refresh handle must support manual polling");
assert.deepEqual(Object.keys(completed.handle), ["refresh"], "the refresh handle must not expose a status capability");
assert.deepEqual(statuses, ["queued", "queued", "created"], "admission and every safe poll state should be observable without raw upstream data");
assert.equal(calls.length, 2);
assert.equal(calls[0].url, "https://issue-intake.example.test/v1/submissions");
assert.equal(calls[0].options.credentials, "omit");
const sent = JSON.parse(calls[0].options.body);
assert.deepEqual(Object.keys(sent).sort(), ["idempotencyKey", "issue", "schemaVersion", "turnstileToken"]);
assert.equal(sent.idempotencyKey, uuid, "each admission uses the injected fresh UUID-v4 source");
assert.deepEqual(sent.issue, issue, "the adapter sends structured wizard state, not canonical title/body fields");
assert.equal("title" in sent.issue, false);
assert.equal("body" in sent.issue, false);
assert.equal(calls[1].options.headers.authorization, `Bearer ${statusToken}`, "only the in-memory capability authorizes status polling");

let timeoutClock = 0;
const timeoutClient = createIssueBotClient({
  config,
  uuidFactory: () => uuid,
  getTurnstileToken: async () => "fresh-turnstile-token",
  sleep: async () => { timeoutClock += 500; },
  now: () => timeoutClock,
  maxPollDurationMs: 500,
  fetchImpl: async (_url, options) => new Response(JSON.stringify(options.method === "POST" ? {
    ok: true, status: "queued", submissionId, statusToken, pollAfterMs: 2_500,
  } : {
    ok: true, status: "checking", submissionId, pollAfterMs: 2_500,
  }), { status: options.method === "POST" ? 202 : 200, headers: { "content-type": "application/json" } }),
});
const timedOut = await timeoutClient.submit({ issue });
assert.equal(timedOut.result.status, "checking");
assert.equal(timedOut.result.timedOut, true, "polling must stop after its bounded duration and retain a manual refresh handle");
assert.equal(typeof timedOut.handle.refresh, "function");

const invalidEnvelopeClient = createIssueBotClient({
  config,
  uuidFactory: () => uuid,
  getTurnstileToken: async () => "fresh-turnstile-token",
  sleep: async () => {},
  fetchImpl: async (_url, options) => new Response(JSON.stringify(options.method === "POST" ? {
    ok: true, status: "queued", submissionId, statusToken, pollAfterMs: 2_500,
  } : {
    ok: true, status: "created", submissionId,
    issueUrl: "https://github.com/Firstp1ck/pi-coding-agent-forge/issues/43", issueNumber: 43, unexpected: true,
  }), { status: options.method === "POST" ? 202 : 200, headers: { "content-type": "application/json" } }),
});
assert.equal((await invalidEnvelopeClient.submit({ issue })).result.status, "unavailable", "unknown response properties must fail closed");

const abortController = new AbortController();
const abortClient = createIssueBotClient({
  config,
  uuidFactory: () => uuid,
  getTurnstileToken: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })),
  fetchImpl: async () => { throw new Error("fetch must not run after Turnstile abort"); },
});
const aborted = abortClient.submit({ issue, signal: abortController.signal });
abortController.abort();
await assert.rejects(aborted, (error) => error?.name === "AbortError", "dialog-close cancellation must abort before admission");

console.log("issue-bot-client.test.mjs passed");
