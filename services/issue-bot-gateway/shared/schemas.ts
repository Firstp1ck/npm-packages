import { Type } from "typebox";
import { Value } from "typebox/value";
import { canonicalizeIssue, POLICY_VERSION, type CanonicalIssue } from "./catalog.js";

const UUID_V4 = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const SHA256_HEX = "^[0-9a-f]{64}$";
const SUBMISSION_ID = "^[A-Za-z0-9_-]{22}$";

const BrowserIssueSchema = Type.Object({
  categoryId: Type.String({ minLength: 1, maxLength: 96 }),
  componentId: Type.String({ minLength: 1, maxLength: 128 }),
  templateId: Type.String({ minLength: 1, maxLength: 128 }),
  summary: Type.String({ minLength: 1, maxLength: 4_000 }),
  fields: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.String({ minLength: 1, maxLength: 8_000 }), { additionalProperties: false }),
}, { additionalProperties: false });

export const SubmissionSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  idempotencyKey: Type.String({ pattern: UUID_V4 }),
  turnstileToken: Type.String({ minLength: 1, maxLength: 2_048 }),
  issue: BrowserIssueSchema,
}, { additionalProperties: false });

const QueueIssueSchema = Type.Object({
  category_id: Type.String({ minLength: 1, maxLength: 96 }),
  component_id: Type.String({ minLength: 1, maxLength: 128 }),
  template_id: Type.String({ minLength: 1, maxLength: 128 }),
  summary: Type.String({ minLength: 1, maxLength: 160 }),
  fields: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.String({ minLength: 1, maxLength: 4_000 }), { additionalProperties: false }),
  title: Type.String({ minLength: 1, maxLength: 512 }),
  body: Type.String({ minLength: 1, maxLength: 16_000 }),
}, { additionalProperties: false });

export const QueueMessageSchema = Type.Object({
  schema_version: Type.Literal(1),
  submission_id: Type.String({ pattern: SUBMISSION_ID }),
  payload_digest: Type.String({ pattern: SHA256_HEX }),
  policy_version: Type.Literal(POLICY_VERSION),
  issue: QueueIssueSchema,
}, { additionalProperties: false });

export const VERDICT_DECISIONS = ["accept", "reject", "review"] as const;
export const VERDICT_REASON_CODES = [
  "acceptable", "spam", "too_vague", "irrelevant", "abuse", "sensitive_security_report", "secret_or_private_data",
  "prompt_injection", "unsupported_content", "ambiguous",
] as const;
export const VERDICT_RISK_FLAGS = [
  "sensitive_data", "security", "prompt_injection", "abuse", "spam", "private_data", "unsupported_content", "low_specificity",
] as const;

export const VerdictSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  decision: Type.Union(VERDICT_DECISIONS.map((value) => Type.Literal(value))),
  reasonCode: Type.Union(VERDICT_REASON_CODES.map((value) => Type.Literal(value))),
  riskFlags: Type.Array(Type.Union(VERDICT_RISK_FLAGS.map((value) => Type.Literal(value))), { maxItems: 8, uniqueItems: true }),
}, { additionalProperties: false });

/**
 * OpenAI wire schema. Keep local uniqueness enforcement in VerdictSchema; `uniqueItems`
 * is not in the documented strict Structured Outputs subset. Enum/maxItems are supported.
 */
export const VerdictWireSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "decision", "reasonCode", "riskFlags"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    decision: { type: "string", enum: [...VERDICT_DECISIONS] },
    reasonCode: { type: "string", enum: [...VERDICT_REASON_CODES] },
    riskFlags: { type: "array", maxItems: 8, items: { type: "string", enum: [...VERDICT_RISK_FLAGS] } },
  },
});

export interface BrowserSubmission {
  schemaVersion: 1;
  idempotencyKey: string;
  turnstileToken: string;
  issue: { categoryId: string; componentId: string; templateId: string; summary: string; fields: Record<string, string> };
}

export interface ValidatedSubmission extends Omit<BrowserSubmission, "issue"> { issue: CanonicalIssue }
export interface QueueMessage {
  schema_version: 1;
  submission_id: string;
  payload_digest: string;
  policy_version: typeof POLICY_VERSION;
  issue: { category_id: string; component_id: string; template_id: string; summary: string; fields: Record<string, string>; title: string; body: string };
}
export interface Verdict { schemaVersion: 1; decision: "accept" | "reject" | "review"; reasonCode: string; riskFlags: string[] }

export function validateSubmission(value: unknown): ValidatedSubmission | null {
  if (!Value.Check(SubmissionSchema, value)) return null;
  const input = value as BrowserSubmission;
  const issue = canonicalizeIssue(input.issue);
  if (!issue || input.turnstileToken.includes("\u0000")) return null;
  return { schemaVersion: 1, idempotencyKey: input.idempotencyKey, turnstileToken: input.turnstileToken, issue };
}

export function validateQueueMessage(value: unknown): QueueMessage | null {
  if (!Value.Check(QueueMessageSchema, value)) return null;
  const message = value as QueueMessage;
  const canonical = canonicalizeIssue({
    categoryId: message.issue.category_id,
    componentId: message.issue.component_id,
    templateId: message.issue.template_id,
    summary: message.issue.summary,
    fields: message.issue.fields,
  });
  if (!canonical || canonical.title !== message.issue.title || canonical.body !== message.issue.body) return null;
  return message;
}

export function validateVerdict(value: unknown): Verdict | null {
  if (!Value.Check(VerdictSchema, value)) return null;
  return value as Verdict;
}

export function isCreateAuthorized(verdict: Verdict | null): boolean {
  return verdict?.decision === "accept" && verdict.reasonCode === "acceptable" && verdict.riskFlags.length === 0;
}

export function queueDigestPreimage(message: Pick<QueueMessage, "schema_version" | "policy_version" | "issue">): string {
  return JSON.stringify({ schema_version: message.schema_version, policy_version: message.policy_version, issue: message.issue });
}

export function queueMessageFor(submissionId: string, digest: string, issue: CanonicalIssue): QueueMessage {
  return {
    schema_version: 1,
    submission_id: submissionId,
    payload_digest: digest,
    policy_version: POLICY_VERSION,
    issue: {
      category_id: issue.categoryId,
      component_id: issue.componentId,
      template_id: issue.templateId,
      summary: issue.summary,
      fields: issue.fields,
      title: issue.title,
      body: issue.body,
    },
  };
}
