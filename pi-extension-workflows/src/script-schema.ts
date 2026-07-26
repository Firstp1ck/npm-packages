import { WorkflowValidationError } from "./errors.ts";
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_TASKS,
  HARD_MAX_CONCURRENCY,
  HARD_MAX_TASKS,
} from "./schema.ts";
import type { WorkflowBudgetLimits, WorkflowScriptMeta, WorkflowScriptPermissions, WorkflowScriptPolicy } from "./types.ts";

export const DEFAULT_WORKFLOW_TIMEOUT_MS = 30 * 60 * 1000;
export const HARD_MAX_WORKFLOW_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_WORKFLOW_MEMORY_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_WORKFLOW_MEMORY_BYTES = 128 * 1024 * 1024;
export const DEFAULT_WORKFLOW_STACK_BYTES = 512 * 1024;
export const DEFAULT_WORKFLOW_NESTING_DEPTH = 16;
export const HARD_MAX_WORKFLOW_NESTING_DEPTH = 64;
// QuickJS invokes the interrupt hook at deterministic bytecode intervals. This
// bound limits those checks rather than promising a one-to-one source instruction count.
export const DEFAULT_WORKFLOW_INSTRUCTION_LIMIT = 5_000_000;
export const HARD_MAX_WORKFLOW_INSTRUCTION_LIMIT = 50_000_000;

export const WORKFLOW_SCRIPT_META_JSON_SCHEMA = {
  $id: "https://firstpick.dev/schemas/pi-workflow-script-meta-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["name", "description"],
  properties: {
    name: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
    description: { type: "string", minLength: 1 },
    phases: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 },
    },
    pi: {
      type: "object",
      additionalProperties: false,
      properties: {
        version: { const: 1 },
        inputSchema: {},
        maxConcurrency: { type: "integer", minimum: 1, maximum: HARD_MAX_CONCURRENCY },
        maxAgents: { type: "integer", minimum: 1, maximum: HARD_MAX_TASKS },
        maxNestingDepth: { type: "integer", minimum: 1, maximum: HARD_MAX_WORKFLOW_NESTING_DEPTH },
        timeoutMs: { type: "integer", minimum: 1, maximum: HARD_MAX_WORKFLOW_TIMEOUT_MS },
        budgets: {
          type: "object", additionalProperties: false,
          properties: {
            run: { type: "object", additionalProperties: false, properties: { maxTokens: { type: "integer", minimum: 1 }, maxCostUsd: { type: "number", minimum: 0 }, maxTimeMs: { type: "integer", minimum: 1 }, maxAgents: { type: "integer", minimum: 1 } } },
            phase: { type: "object", additionalProperties: false, properties: { maxTokens: { type: "integer", minimum: 1 }, maxCostUsd: { type: "number", minimum: 0 }, maxTimeMs: { type: "integer", minimum: 1 }, maxAgents: { type: "integer", minimum: 1 } } },
            agent: { type: "object", additionalProperties: false, properties: { maxTokens: { type: "integer", minimum: 1 }, maxTurns: { type: "integer", minimum: 1 } } },
          },
        },
        retry: { type: "object", additionalProperties: false, properties: { maxAttempts: { type: "integer", minimum: 1, maximum: 5 }, baseDelayMs: { type: "integer", minimum: 0 }, maxDelayMs: { type: "integer", minimum: 0 }, jitter: { type: "number", minimum: 0, maximum: 1 } } },
        permissions: {
          type: "object",
          additionalProperties: false,
          properties: {
            write: { type: "boolean" },
            shell: { type: "boolean" },
            network: { type: "boolean" },
          },
        },
      },
    },
  },
} as const;

const META_KEYS = new Set(["name", "description", "phases", "pi"]);
const POLICY_KEYS = new Set(["version", "inputSchema", "maxConcurrency", "maxAgents", "maxNestingDepth", "timeoutMs", "permissions", "budgets", "retry"]);
const PERMISSION_KEYS = new Set(["write", "shell", "network"]);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, issues: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${path}.${key} is not supported in workflow script schema v1.`);
  }
}

function normalizePermissions(value: unknown, issues: string[]): WorkflowScriptPermissions {
  const permissions: WorkflowScriptPermissions = { write: false, shell: false, network: false };
  if (value === undefined) return permissions;
  if (!isRecord(value)) {
    issues.push("meta.pi.permissions must be an object when provided.");
    return permissions;
  }

  rejectUnknownKeys(value, PERMISSION_KEYS, "meta.pi.permissions", issues);
  for (const key of PERMISSION_KEYS) {
    const requested = value[key];
    if (requested === undefined) continue;
    if (typeof requested !== "boolean") issues.push(`meta.pi.permissions.${key} must be a boolean.`);
    else permissions[key as keyof WorkflowScriptPermissions] = requested;
  }
  return permissions;
}

function normalizeAgentBudgetLimits(value: unknown, path: string, issues: string[]): { maxTokens?: number; maxTurns?: number } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) { issues.push(`${path} must be an object.`); return undefined; }
  rejectUnknownKeys(value, new Set(["maxTokens", "maxTurns"]), path, issues);
  const limits: { maxTokens?: number; maxTurns?: number } = {};
  for (const key of ["maxTokens", "maxTurns"] as const) {
    if (value[key] !== undefined && !positiveInteger(value[key])) issues.push(`${path}.${key} must be a positive integer.`);
    else if (value[key] !== undefined) limits[key] = Number(value[key]);
  }
  return limits;
}

function normalizeBudgetLimits(value: unknown, path: string, issues: string[]): WorkflowBudgetLimits | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) { issues.push(`${path} must be an object.`); return undefined; }
  rejectUnknownKeys(value, new Set(["maxTokens", "maxCostUsd", "maxTimeMs", "maxAgents"]), path, issues);
  const limits: WorkflowBudgetLimits = {};
  for (const key of ["maxTokens", "maxTimeMs", "maxAgents"] as const) {
    if (value[key] !== undefined && (!positiveInteger(value[key]))) issues.push(`${path}.${key} must be a positive integer.`);
    else if (value[key] !== undefined) limits[key] = Number(value[key]);
  }
  if (value.maxCostUsd !== undefined && (typeof value.maxCostUsd !== "number" || !Number.isFinite(value.maxCostUsd) || value.maxCostUsd < 0)) issues.push(`${path}.maxCostUsd must be a finite non-negative number.`);
  else if (value.maxCostUsd !== undefined) limits.maxCostUsd = value.maxCostUsd;
  return limits;
}

function normalizePolicy(value: unknown, issues: string[]): WorkflowScriptPolicy {
  const policy: WorkflowScriptPolicy = {
    version: 1,
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
    maxAgents: DEFAULT_MAX_TASKS,
    maxNestingDepth: DEFAULT_WORKFLOW_NESTING_DEPTH,
    timeoutMs: DEFAULT_WORKFLOW_TIMEOUT_MS,
    permissions: { write: false, shell: false, network: false },
  };

  if (value === undefined) return policy;
  if (!isRecord(value)) {
    issues.push("meta.pi must be an object when provided.");
    return policy;
  }

  rejectUnknownKeys(value, POLICY_KEYS, "meta.pi", issues);
  if (value.version !== undefined && value.version !== 1) issues.push("meta.pi.version must be 1.");
  if (value.inputSchema !== undefined) policy.inputSchema = value.inputSchema;

  if (value.maxConcurrency !== undefined) {
    if (!positiveInteger(value.maxConcurrency)) issues.push("meta.pi.maxConcurrency must be a positive integer.");
    else if (value.maxConcurrency > HARD_MAX_CONCURRENCY) issues.push(`meta.pi.maxConcurrency must be <= ${HARD_MAX_CONCURRENCY}.`);
    else policy.maxConcurrency = value.maxConcurrency;
  }

  if (value.maxAgents !== undefined) {
    if (!positiveInteger(value.maxAgents)) issues.push("meta.pi.maxAgents must be a positive integer.");
    else if (value.maxAgents > HARD_MAX_TASKS) issues.push(`meta.pi.maxAgents must be <= ${HARD_MAX_TASKS}.`);
    else policy.maxAgents = value.maxAgents;
  }

  if (value.maxNestingDepth !== undefined) {
    if (!positiveInteger(value.maxNestingDepth)) issues.push("meta.pi.maxNestingDepth must be a positive integer.");
    else if (value.maxNestingDepth > HARD_MAX_WORKFLOW_NESTING_DEPTH) issues.push(`meta.pi.maxNestingDepth must be <= ${HARD_MAX_WORKFLOW_NESTING_DEPTH}.`);
    else policy.maxNestingDepth = value.maxNestingDepth;
  }

  if (value.timeoutMs !== undefined) {
    if (!positiveInteger(value.timeoutMs)) issues.push("meta.pi.timeoutMs must be a positive integer.");
    else if (value.timeoutMs > HARD_MAX_WORKFLOW_TIMEOUT_MS) {
      issues.push(`meta.pi.timeoutMs must be <= ${HARD_MAX_WORKFLOW_TIMEOUT_MS}.`);
    } else policy.timeoutMs = value.timeoutMs;
  }

  policy.permissions = normalizePermissions(value.permissions, issues);
  if (value.budgets !== undefined) {
    if (!isRecord(value.budgets)) issues.push("meta.pi.budgets must be an object.");
    else {
      rejectUnknownKeys(value.budgets, new Set(["run", "phase", "agent"]), "meta.pi.budgets", issues);
      const runBudget = normalizeBudgetLimits(value.budgets.run, "meta.pi.budgets.run", issues);
      const phaseBudget = normalizeBudgetLimits(value.budgets.phase, "meta.pi.budgets.phase", issues);
      const agentBudget = normalizeAgentBudgetLimits(value.budgets.agent, "meta.pi.budgets.agent", issues);
      policy.budgets = {
        ...(runBudget ? { run: runBudget } : {}),
        ...(phaseBudget ? { phase: phaseBudget } : {}),
        ...(agentBudget ? { agent: agentBudget } : {}),
      };
    }
  }
  if (value.retry !== undefined) {
    if (!isRecord(value.retry)) issues.push("meta.pi.retry must be an object.");
    else {
      rejectUnknownKeys(value.retry, new Set(["maxAttempts", "baseDelayMs", "maxDelayMs", "jitter"]), "meta.pi.retry", issues);
      const maxAttempts = value.retry.maxAttempts ?? 1;
      const baseDelayMs = value.retry.baseDelayMs ?? 250;
      const maxDelayMs = value.retry.maxDelayMs ?? 5000;
      const jitter = value.retry.jitter ?? 0.2;
      if (!Number.isInteger(maxAttempts) || Number(maxAttempts) < 1 || Number(maxAttempts) > 5) issues.push("meta.pi.retry.maxAttempts must be an integer from 1 to 5.");
      if (!Number.isInteger(baseDelayMs) || Number(baseDelayMs) < 0) issues.push("meta.pi.retry.baseDelayMs must be a non-negative integer.");
      if (!Number.isInteger(maxDelayMs) || Number(maxDelayMs) < Number(baseDelayMs)) issues.push("meta.pi.retry.maxDelayMs must be an integer >= baseDelayMs.");
      if (typeof jitter !== "number" || !Number.isFinite(jitter) || jitter < 0 || jitter > 1) issues.push("meta.pi.retry.jitter must be between 0 and 1.");
      policy.retry = { maxAttempts: Number(maxAttempts), baseDelayMs: Number(baseDelayMs), maxDelayMs: Number(maxDelayMs), jitter: Number(jitter) };
    }
  }
  return policy;
}

export function validateWorkflowScriptMeta(
  value: unknown,
  options: { sourcePath?: string; expectedName?: string } = {},
): WorkflowScriptMeta {
  const issues: string[] = [];
  if (!isRecord(value)) throw new WorkflowValidationError(["meta must be a static object literal."], options.sourcePath);

  rejectUnknownKeys(value, META_KEYS, "meta", issues);
  if (!nonEmptyString(value.name)) issues.push("meta.name must be a non-empty string.");
  else {
    if (!SLUG_PATTERN.test(value.name)) issues.push("meta.name must be slug-like: letters, numbers, dots, underscores, or dashes.");
    if (options.expectedName && value.name !== options.expectedName) {
      issues.push(`meta.name '${value.name}' must match filename '${options.expectedName}.js'.`);
    }
  }
  if (!nonEmptyString(value.description)) issues.push("meta.description must be a non-empty string.");

  let phases: string[] | undefined;
  if (value.phases !== undefined) {
    if (!Array.isArray(value.phases)) issues.push("meta.phases must be an array of strings when provided.");
    else {
      const seen = new Set<string>();
      phases = [];
      value.phases.forEach((phase, index) => {
        if (!nonEmptyString(phase)) issues.push(`meta.phases[${index}] must be a non-empty string.`);
        else if (seen.has(phase)) issues.push(`meta.phases contains duplicate phase '${phase}'.`);
        else {
          seen.add(phase);
          phases?.push(phase);
        }
      });
    }
  }

  const pi = normalizePolicy(value.pi, issues);
  if (issues.length > 0) throw new WorkflowValidationError(issues, options.sourcePath);

  return {
    name: value.name as string,
    description: value.description as string,
    ...(phases ? { phases } : {}),
    pi,
  };
}

export function effectiveWorkflowPolicy(
  requested: WorkflowScriptPolicy,
  ceiling: Partial<WorkflowScriptPolicy> = {},
): WorkflowScriptPolicy {
  const ceilingPermissions = ceiling.permissions ?? { write: false, shell: false, network: false };
  return {
    version: 1,
    ...(requested.inputSchema === undefined ? {} : { inputSchema: requested.inputSchema }),
    maxConcurrency: Math.max(1, Math.min(requested.maxConcurrency, ceiling.maxConcurrency ?? HARD_MAX_CONCURRENCY)),
    maxAgents: Math.max(1, Math.min(requested.maxAgents, ceiling.maxAgents ?? HARD_MAX_TASKS)),
    maxNestingDepth: Math.max(1, Math.min(requested.maxNestingDepth ?? DEFAULT_WORKFLOW_NESTING_DEPTH, ceiling.maxNestingDepth ?? HARD_MAX_WORKFLOW_NESTING_DEPTH)),
    timeoutMs: Math.max(1, Math.min(requested.timeoutMs, ceiling.timeoutMs ?? HARD_MAX_WORKFLOW_TIMEOUT_MS)),
    permissions: {
      write: requested.permissions.write && Boolean(ceilingPermissions.write),
      shell: requested.permissions.shell && Boolean(ceilingPermissions.shell),
      network: requested.permissions.network && Boolean(ceilingPermissions.network),
    },
    shellAllowlist: requested.permissions.shell && Boolean(ceilingPermissions.shell) ? [...new Set(ceiling.shellAllowlist ?? [])].sort() : [],
    networkAllowlist: requested.permissions.network && Boolean(ceilingPermissions.network) ? [...new Set(ceiling.networkAllowlist ?? [])].sort() : [],
    verificationCommands: requested.permissions.write && Boolean(ceilingPermissions.write) ? structuredClone(ceiling.verificationCommands ?? []) : [],
    ...(requested.budgets ? { budgets: {
      ...(requested.budgets.run ? { run: { ...requested.budgets.run, maxAgents: Math.min(requested.budgets.run.maxAgents ?? requested.maxAgents, requested.maxAgents), maxTimeMs: Math.min(requested.budgets.run.maxTimeMs ?? requested.timeoutMs, requested.timeoutMs) } } : {}),
      ...(requested.budgets.phase ? { phase: { ...requested.budgets.phase, maxAgents: Math.min(requested.budgets.phase.maxAgents ?? requested.maxAgents, requested.maxAgents), maxTimeMs: Math.min(requested.budgets.phase.maxTimeMs ?? requested.timeoutMs, requested.timeoutMs) } } : {}),
      ...(requested.budgets.agent ? { agent: { ...requested.budgets.agent } } : {}),
    } } : {}),
    ...(requested.retry ? { retry: structuredClone(requested.retry) } : {}),
  };
}
