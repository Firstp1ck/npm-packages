import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { WorkflowValidationError } from "./errors.ts";
import type { WorkflowRunStatus, WorkflowScriptPolicy, WorkflowUsage, WorkflowWorktreeRecord } from "./types.ts";

export const WORKFLOW_PERSISTENCE_SCHEMA_VERSION = 1 as const;
export const WORKFLOW_APPROVAL_ENTRY_TYPE = "workflow-approval-v1";

export type WorkflowApprovalScope = "once" | "remembered";

export type WorkflowApprovalRecordV1 = {
  schemaVersion: 1;
  kind: "approval";
  approvalId: string;
  projectId: string;
  scriptHash: string;
  policyHash: string;
  scope: WorkflowApprovalScope;
  decision: "approved";
  approvedAt: string;
};

export type WorkflowRunRecordV1 = {
  schemaVersion: 1;
  kind: "run";
  runId: string;
  sessionId: string;
  projectId: string;
  workflowName: string;
  sourceType: "json" | "javascript";
  status: WorkflowRunStatus;
  scriptHash?: string;
  policyHash?: string;
  snapshotPath?: string;
  resumedFromRunId?: string;
  input?: Record<string, unknown>;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type WorkflowCallRecordV1 = {
  schemaVersion: 1;
  kind: "call";
  runId: string;
  callId: string;
  callIndex: number;
  phasePath: string[];
  label?: string;
  prompt: string;
  promptHash: string;
  fingerprint: string;
  pipelineKey?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  options: Record<string, unknown>;
  result?: unknown;
  usage?: WorkflowUsage;
  recentEvents?: Array<Record<string, unknown>>;
  worktree?: WorkflowWorktreeRecord;
  startedAt?: string;
  finishedAt?: string;
  resultPath?: string;
  error?: string;
  errorKind?: string;
};

export type WorkflowEventRecordV1 = {
  schemaVersion: 1;
  kind: "event";
  runId: string;
  sequence: number;
  timestamp: string;
  eventType: string;
  data: Record<string, unknown>;
};

export type WorkflowUsageRecordV1 = {
  schemaVersion: 1;
  kind: "usage";
  runId: string;
  scope: "agent" | "phase" | "run";
  scopeId: string;
  usage: WorkflowUsage;
  recordedAt: string;
};

export type WorkflowResultRecordV1 = {
  schemaVersion: 1;
  kind: "result";
  runId: string;
  status: "completed" | "failed" | "cancelled";
  finishedAt: string;
  summary?: string;
  result?: unknown;
  error?: string;
  errorKind?: string;
};

export type WorkflowPersistenceRecordV1 =
  | WorkflowApprovalRecordV1
  | WorkflowRunRecordV1
  | WorkflowCallRecordV1
  | WorkflowEventRecordV1
  | WorkflowUsageRecordV1
  | WorkflowResultRecordV1;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const RUN_STATUSES = new Set<WorkflowRunStatus>(["queued", "validating", "awaiting_approval", "running", "paused", "completed", "failed", "cancelled"]);
const CALL_STATUSES = new Set(["queued", "running", "completed", "failed", "cancelled"]);
const RESULT_STATUSES = new Set(["completed", "failed", "cancelled"]);

export const WORKFLOW_PERSISTENCE_JSON_SCHEMAS = {
  approval: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "kind", "approvalId", "projectId", "scriptHash", "policyHash", "scope", "decision", "approvedAt"],
    properties: {
      schemaVersion: { const: 1 }, kind: { const: "approval" }, approvalId: { type: "string" }, projectId: { type: "string" },
      scriptHash: { type: "string", pattern: HASH_PATTERN.source }, policyHash: { type: "string", pattern: HASH_PATTERN.source },
      scope: { enum: ["once", "remembered"] }, decision: { const: "approved" }, approvedAt: { type: "string", format: "date-time" },
    },
  },
  run: {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "runId", "sessionId", "projectId", "workflowName", "sourceType", "status", "startedAt", "updatedAt"],
    properties: {
      schemaVersion: { const: 1 }, kind: { const: "run" }, runId: { type: "string" }, sessionId: { type: "string" },
      projectId: { type: "string" }, workflowName: { type: "string" }, sourceType: { enum: ["json", "javascript"] },
      status: { enum: ["queued", "validating", "awaiting_approval", "running", "paused", "completed", "failed", "cancelled"] },
      scriptHash: { type: "string", pattern: HASH_PATTERN.source }, policyHash: { type: "string", pattern: HASH_PATTERN.source },
      snapshotPath: { type: "string" }, resumedFromRunId: { type: "string" }, input: { type: "object" }, startedAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
      finishedAt: { type: "string", format: "date-time" },
    },
  },
  call: {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "runId", "callId", "callIndex", "phasePath", "prompt", "promptHash", "fingerprint", "status", "options"],
    properties: {
      schemaVersion: { const: 1 }, kind: { const: "call" }, runId: { type: "string" }, callId: { type: "string" }, callIndex: { type: "integer", minimum: 1 },
      phasePath: { type: "array", items: { type: "string" } }, label: { type: "string" }, prompt: { type: "string" },
      promptHash: { type: "string", pattern: HASH_PATTERN.source }, fingerprint: { type: "string", pattern: HASH_PATTERN.source }, pipelineKey: { type: "string" },
      status: { enum: ["queued", "running", "completed", "failed", "cancelled"] }, options: { type: "object" }, result: {}, usage: { type: "object" },
      recentEvents: { type: "array", items: { type: "object" } }, worktree: { type: "object" }, startedAt: { type: "string", format: "date-time" }, finishedAt: { type: "string", format: "date-time" },
      resultPath: { type: "string" }, error: { type: "string" }, errorKind: { type: "string" },
    },
  },
  event: {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "runId", "sequence", "timestamp", "eventType", "data"],
    properties: {
      schemaVersion: { const: 1 }, kind: { const: "event" }, runId: { type: "string" }, sequence: { type: "integer", minimum: 0 },
      timestamp: { type: "string", format: "date-time" }, eventType: { type: "string" }, data: { type: "object" },
    },
  },
  usage: {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "runId", "scope", "scopeId", "usage", "recordedAt"],
    properties: {
      schemaVersion: { const: 1 }, kind: { const: "usage" }, runId: { type: "string" }, scope: { enum: ["agent", "phase", "run"] },
      scopeId: { type: "string" }, usage: {
        type: "object", additionalProperties: false,
        properties: {
          input: { type: "number", minimum: 0 }, output: { type: "number", minimum: 0 }, cacheRead: { type: "number", minimum: 0 },
          cacheWrite: { type: "number", minimum: 0 }, cost: { type: "number", minimum: 0 }, contextTokens: { type: "number", minimum: 0 }, turns: { type: "number", minimum: 0 },
        },
      },
      recordedAt: { type: "string", format: "date-time" },
    },
  },
  result: {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "runId", "status", "finishedAt"],
    properties: {
      schemaVersion: { const: 1 }, kind: { const: "result" }, runId: { type: "string" }, status: { enum: ["completed", "failed", "cancelled"] },
      finishedAt: { type: "string", format: "date-time" }, summary: { type: "string" }, result: {}, error: { type: "string" }, errorKind: { type: "string" },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && Number.isFinite(Date.parse(value));
}

function requireString(record: Record<string, unknown>, key: string, issues: string[], pattern?: RegExp): void {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) issues.push(`${key} must be a non-empty string.`);
  else if (pattern && !pattern.test(value)) issues.push(`${key} has an invalid format.`);
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[], issues: string[]): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(record)) if (!keys.has(key)) issues.push(`unknown field '${key}'.`);
}

function validateCommon(record: Record<string, unknown>, kind: WorkflowPersistenceRecordV1["kind"], issues: string[]): void {
  if (record.schemaVersion !== WORKFLOW_PERSISTENCE_SCHEMA_VERSION) issues.push(`schemaVersion must be ${WORKFLOW_PERSISTENCE_SCHEMA_VERSION}.`);
  if (record.kind !== kind) issues.push(`kind must be '${kind}'.`);
}

export function migrateWorkflowPersistenceRecord(value: unknown): WorkflowPersistenceRecordV1 {
  if (!isRecord(value)) throw new WorkflowValidationError(["persistence record must be an object."]);
  if (value.schemaVersion !== WORKFLOW_PERSISTENCE_SCHEMA_VERSION) {
    throw new WorkflowValidationError([`unsupported persistence schemaVersion '${String(value.schemaVersion)}'; no safe migration is registered.`]);
  }
  return validateWorkflowPersistenceRecord(value);
}

export function validateWorkflowPersistenceRecord(value: unknown): WorkflowPersistenceRecordV1 {
  if (!isRecord(value)) throw new WorkflowValidationError(["persistence record must be an object."]);
  const issues: string[] = [];
  const kind = value.kind;
  if (!["approval", "run", "call", "event", "usage", "result"].includes(String(kind))) {
    throw new WorkflowValidationError(["persistence record kind is unsupported."]);
  }

  if (kind === "approval") {
    validateCommon(value, "approval", issues);
    rejectUnknown(value, ["schemaVersion", "kind", "approvalId", "projectId", "scriptHash", "policyHash", "scope", "decision", "approvedAt"], issues);
    requireString(value, "approvalId", issues, ID_PATTERN);
    requireString(value, "projectId", issues, ID_PATTERN);
    requireString(value, "scriptHash", issues, HASH_PATTERN);
    requireString(value, "policyHash", issues, HASH_PATTERN);
    if (value.scope !== "once" && value.scope !== "remembered") issues.push("scope must be 'once' or 'remembered'.");
    if (value.decision !== "approved") issues.push("decision must be 'approved'.");
    if (!isIsoDate(value.approvedAt)) issues.push("approvedAt must be an ISO date-time.");
  } else if (kind === "run") {
    validateCommon(value, "run", issues);
    rejectUnknown(value, ["schemaVersion", "kind", "runId", "sessionId", "projectId", "workflowName", "sourceType", "status", "scriptHash", "policyHash", "snapshotPath", "resumedFromRunId", "input", "startedAt", "updatedAt", "finishedAt"], issues);
    for (const key of ["runId", "sessionId", "projectId", "workflowName"]) requireString(value, key, issues);
    if (value.sourceType !== "json" && value.sourceType !== "javascript") issues.push("sourceType must be 'json' or 'javascript'.");
    if (!RUN_STATUSES.has(value.status as WorkflowRunStatus)) issues.push("status is invalid.");
    if (value.scriptHash !== undefined) requireString(value, "scriptHash", issues, HASH_PATTERN);
    if (value.policyHash !== undefined) requireString(value, "policyHash", issues, HASH_PATTERN);
    if (value.snapshotPath !== undefined) requireString(value, "snapshotPath", issues);
    if (value.resumedFromRunId !== undefined) requireString(value, "resumedFromRunId", issues);
    if (value.input !== undefined && !isRecord(value.input)) issues.push("input must be an object.");
    if (!isIsoDate(value.startedAt)) issues.push("startedAt must be an ISO date-time.");
    if (!isIsoDate(value.updatedAt)) issues.push("updatedAt must be an ISO date-time.");
    if (value.finishedAt !== undefined && !isIsoDate(value.finishedAt)) issues.push("finishedAt must be an ISO date-time.");
  } else if (kind === "call") {
    validateCommon(value, "call", issues);
    rejectUnknown(value, ["schemaVersion", "kind", "runId", "callId", "callIndex", "phasePath", "label", "prompt", "promptHash", "fingerprint", "pipelineKey", "status", "options", "result", "usage", "recentEvents", "worktree", "startedAt", "finishedAt", "resultPath", "error", "errorKind"], issues);
    requireString(value, "runId", issues);
    requireString(value, "callId", issues);
    if (!Number.isSafeInteger(value.callIndex) || Number(value.callIndex) < 1) issues.push("callIndex must be a positive safe integer.");
    requireString(value, "prompt", issues);
    requireString(value, "promptHash", issues, HASH_PATTERN);
    requireString(value, "fingerprint", issues, HASH_PATTERN);
    if (value.pipelineKey !== undefined) requireString(value, "pipelineKey", issues);
    if (!Array.isArray(value.phasePath) || value.phasePath.some((part) => typeof part !== "string" || !part)) issues.push("phasePath must be an array of non-empty strings.");
    if (!CALL_STATUSES.has(String(value.status))) issues.push("status is invalid.");
    if (!isRecord(value.options)) issues.push("options must be an object.");
    if (value.usage !== undefined && !isRecord(value.usage)) issues.push("usage must be an object.");
    if (value.recentEvents !== undefined && (!Array.isArray(value.recentEvents) || value.recentEvents.some((event) => !isRecord(event)))) issues.push("recentEvents must be an array of objects.");
    if (value.worktree !== undefined && !isRecord(value.worktree)) issues.push("worktree must be an object.");
    for (const key of ["startedAt", "finishedAt"]) if (value[key] !== undefined && !isIsoDate(value[key])) issues.push(`${key} must be an ISO date-time.`);
    for (const key of ["label", "resultPath", "error", "errorKind"]) if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key])) issues.push(`${key} must be a non-empty string.`);
  } else if (kind === "event") {
    validateCommon(value, "event", issues);
    rejectUnknown(value, ["schemaVersion", "kind", "runId", "sequence", "timestamp", "eventType", "data"], issues);
    requireString(value, "runId", issues);
    requireString(value, "eventType", issues);
    if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0) issues.push("sequence must be a non-negative safe integer.");
    if (!isIsoDate(value.timestamp)) issues.push("timestamp must be an ISO date-time.");
    if (!isRecord(value.data)) issues.push("data must be an object.");
  } else if (kind === "usage") {
    validateCommon(value, "usage", issues);
    rejectUnknown(value, ["schemaVersion", "kind", "runId", "scope", "scopeId", "usage", "recordedAt"], issues);
    requireString(value, "runId", issues);
    requireString(value, "scopeId", issues);
    if (!(["agent", "phase", "run"] as unknown[]).includes(value.scope)) issues.push("scope is invalid.");
    if (!isRecord(value.usage)) issues.push("usage must be an object.");
    else for (const [key, item] of Object.entries(value.usage)) if (typeof item !== "number" || !Number.isFinite(item) || item < 0) issues.push(`usage.${key} must be a finite non-negative number.`);
    if (!isIsoDate(value.recordedAt)) issues.push("recordedAt must be an ISO date-time.");
  } else {
    validateCommon(value, "result", issues);
    rejectUnknown(value, ["schemaVersion", "kind", "runId", "status", "finishedAt", "summary", "result", "error", "errorKind"], issues);
    requireString(value, "runId", issues);
    if (!RESULT_STATUSES.has(String(value.status))) issues.push("status is invalid.");
    if (!isIsoDate(value.finishedAt)) issues.push("finishedAt must be an ISO date-time.");
    for (const key of ["summary", "error", "errorKind"]) if (value[key] !== undefined && typeof value[key] !== "string") issues.push(`${key} must be a string.`);
  }

  if (issues.length > 0) throw new WorkflowValidationError(issues);
  return value as WorkflowPersistenceRecordV1;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new WorkflowValidationError(["value cannot be represented as canonical JSON."]);
  return encoded;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashWorkflowPolicy(policy: WorkflowScriptPolicy): string {
  return sha256(canonicalJson(policy));
}

export async function workflowProjectIdentity(cwd: string): Promise<string> {
  let normalized: string;
  try {
    normalized = await realpath(cwd);
  } catch {
    normalized = path.resolve(cwd);
  }
  return `project-${sha256(normalized).slice(0, 48)}`;
}

export function workflowApprovalId(projectId: string, scriptHash: string, policyHash: string): string {
  return `approval-${sha256(`${projectId}\0${scriptHash}\0${policyHash}`).slice(0, 48)}`;
}

export function createWorkflowApprovalRecord(input: {
  projectId: string;
  scriptHash: string;
  policyHash: string;
  scope: WorkflowApprovalScope;
  approvedAt?: string;
}): WorkflowApprovalRecordV1 {
  return validateWorkflowPersistenceRecord({
    schemaVersion: WORKFLOW_PERSISTENCE_SCHEMA_VERSION,
    kind: "approval",
    approvalId: workflowApprovalId(input.projectId, input.scriptHash, input.policyHash),
    projectId: input.projectId,
    scriptHash: input.scriptHash,
    policyHash: input.policyHash,
    scope: input.scope,
    decision: "approved",
    approvedAt: input.approvedAt ?? new Date().toISOString(),
  }) as WorkflowApprovalRecordV1;
}

export function approvalMatches(record: WorkflowApprovalRecordV1, input: { projectId: string; scriptHash: string; policyHash: string }): boolean {
  return record.schemaVersion === 1
    && record.decision === "approved"
    && record.projectId === input.projectId
    && record.scriptHash === input.scriptHash
    && record.policyHash === input.policyHash
    && record.approvalId === workflowApprovalId(input.projectId, input.scriptHash, input.policyHash);
}
