import { moderateSubmission } from "../consumer/moderation.js";
import { canonicalizeIssue } from "../shared/catalog.js";
import { sha256Hex } from "../shared/crypto.js";
import { queueDigestPreimage, queueMessageFor } from "../shared/schemas.js";

const apiKey = process.env.OPENAI_API_KEY ?? "";
const model = process.env.ISSUE_BOT_MODEL ?? "gpt-5.6-terra";
if (!apiKey) {
  console.error("OPENAI_API_KEY is required. The canary never prints or stores it.");
  process.exit(2);
}

const issue = canonicalizeIssue({
  categoryId: "bug",
  componentId: "webui",
  templateId: "bug-defect-report",
  summary: "Synthetic staging canary panel does not open",
  fields: {
    severity: "low",
    expectedBehavior: "The synthetic panel opens.",
    actualBehavior: "The synthetic panel stays closed.",
    reproductionSteps: "1. Run the approved canary\n2. Observe the synthetic result",
  },
});
if (!issue) throw new Error("synthetic canary fixture is invalid");
const partial = queueMessageFor("CANARYCANARYCANARYCANA", "0".repeat(64), issue);
const message = queueMessageFor(partial.submission_id, await sha256Hex(queueDigestPreimage(partial)), issue);
const result = await moderateSubmission(message, { OPENAI_API_KEY: apiKey, ISSUE_BOT_MODEL: model }, fetch);
if (result.kind !== "verdict") {
  console.error(JSON.stringify({ ok: false, model, result: result.kind, requestId: result.metadata.requestId }));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  model,
  requestId: result.metadata.requestId,
  decision: result.verdict.decision,
  reasonCode: result.verdict.reasonCode,
  riskFlagCount: result.verdict.riskFlags.length,
}));
