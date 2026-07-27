import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error The canonical browser implementation is an intentionally untyped ESM fixture.
import { buildIssuePayload, createIssueWizardCatalog } from "../../../pi-package-webui/public/issue-wizard-state.mjs";
import { CATALOG, canonicalizeIssue } from "../shared/catalog.js";
import { sha256Hex } from "../shared/crypto.js";
import { isCreateAuthorized, queueDigestPreimage, queueMessageFor, validateQueueMessage, validateSubmission, validateVerdict } from "../shared/schemas.js";

const browserState = {
  categoryId: "bug", componentId: "webui", templateId: "bug-defect-report", summary: " Preview [breaks]\n on launch ",
  fields: { severity: "high", expectedBehavior: "A preview appears.", actualBehavior: "# heading\n- fake list", reproductionSteps: "1. Open preview\r\n2. Observe failure" },
};

test("policy-v1 catalog and every canonical template remain byte-compatible with the live browser catalog", () => {
  const app = readFileSync(new URL("../../../pi-package-webui/public/app.js", import.meta.url), "utf8");
  const optionalBlock = app.match(/const OPTIONAL_FEATURES = \[([\s\S]*?)\n\];\nconst OPTIONAL_FEATURE_BY_ID/u)?.[1] ?? "";
  const liveLabels = [...optionalBlock.matchAll(/\n\s+label: "([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(liveLabels.length > 0, "the parity fixture must extract the live OPTIONAL_FEATURES labels");
  const browserCatalog = createIssueWizardCatalog(liveLabels);
  assert.deepEqual(CATALOG.categories.map((entry) => entry.label), browserCatalog.categories.map((entry: { label: string }) => entry.label));
  assert.deepEqual(CATALOG.components.map((entry) => entry.label), browserCatalog.components.map((entry: { label: string }) => entry.label));

  for (const template of CATALOG.templates) {
    const state = {
      categoryId: template.categoryIds[0], componentId: "webui", templateId: template.id, summary: `Parity for ${template.id} @maintainer #123`,
      fields: Object.fromEntries(template.fields.map((field) => [field.id, field.options?.[0]?.id ?? `Details for ${field.id} @maintainer #123.`])),
    };
    const server = canonicalizeIssue(state);
    assert.ok(server, `server catalog should build ${template.id}`);
    assert.deepEqual({ title: server.title, body: server.body }, buildIssuePayload(state, browserCatalog), `${template.id} must be byte-identical`);
    assert.doesNotMatch(server.title + server.body, /@maintainer|#123/u, "GitHub mentions and issue references must be neutralized");
  }
});

test("submission validation rejects unknown fields and unsafe Unicode while normalizing canonical input", () => {
  const valid = {
    schemaVersion: 1, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", turnstileToken: "challenge",
    issue: { ...browserState, fields: { ...browserState.fields } },
  };
  const normalized = validateSubmission(valid);
  assert.ok(normalized);
  assert.equal(normalized.issue.summary, "Preview breaks on launch");
  assert.equal(validateSubmission({ ...valid, unexpected: true }), null);
  assert.equal(validateSubmission({ ...valid, issue: { ...valid.issue, fields: { ...valid.issue.fields, extra: "no" } } }), null);
  assert.equal(validateSubmission({ ...valid, issue: { ...valid.issue, summary: "bad\u202Etext" } }), null);
  assert.equal(validateSubmission({ ...valid, idempotencyKey: "123e4567-e89b-12d3-a456-426614174000" }), null);
});

test("queue digest preimage and exact message validation reject tampering", async () => {
  const issue = canonicalizeIssue(browserState);
  assert.ok(issue);
  const partial = queueMessageFor("AAAAAAAAAAAAAAAAAAAAAA", "0".repeat(64), issue);
  const digest = await sha256Hex(queueDigestPreimage(partial));
  const message = queueMessageFor("AAAAAAAAAAAAAAAAAAAAAA", digest, issue);
  assert.deepEqual(validateQueueMessage(message), message);
  assert.equal(validateQueueMessage({ ...message, issue: { ...message.issue, title: "client title" } }), null);
  assert.equal(validateQueueMessage({ ...message, policy_version: "2" }), null);
  assert.equal(validateQueueMessage({ ...message, extra: true }), null);
});

test("verdict schema permits only the frozen creation authorization tuple", () => {
  const accepted = validateVerdict({ schemaVersion: 1, decision: "accept", reasonCode: "acceptable", riskFlags: [] });
  assert.ok(accepted);
  assert.equal(isCreateAuthorized(accepted), true);
  assert.equal(isCreateAuthorized(validateVerdict({ schemaVersion: 1, decision: "accept", reasonCode: "spam", riskFlags: [] })), false);
  assert.equal(validateVerdict({ schemaVersion: 1, decision: "accept", reasonCode: "acceptable", riskFlags: [], extra: true }), null);
  assert.equal(validateVerdict({ schemaVersion: 1, decision: "accept", reasonCode: "acceptable", riskFlags: ["spam", "spam"] }), null);
});
