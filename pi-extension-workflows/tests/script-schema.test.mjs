import assert from "node:assert/strict";
import { WorkflowValidationError } from "../src/errors.ts";
import {
  DEFAULT_WORKFLOW_TIMEOUT_MS,
  HARD_MAX_WORKFLOW_TIMEOUT_MS,
  WORKFLOW_SCRIPT_META_JSON_SCHEMA,
  effectiveWorkflowPolicy,
  validateWorkflowScriptMeta,
} from "../src/script-schema.ts";
import { DEFAULT_MAX_CONCURRENCY, DEFAULT_MAX_TASKS, HARD_MAX_CONCURRENCY } from "../src/schema.ts";

const normalized = validateWorkflowScriptMeta({
  name: "audit-routes",
  description: "Audit routes",
  phases: ["discover", "verify"],
});
assert.equal(normalized.name, "audit-routes");
assert.equal(normalized.pi.version, 1);
assert.equal(normalized.pi.maxConcurrency, DEFAULT_MAX_CONCURRENCY);
assert.equal(normalized.pi.maxAgents, DEFAULT_MAX_TASKS);
assert.equal(normalized.pi.timeoutMs, DEFAULT_WORKFLOW_TIMEOUT_MS);
assert.deepEqual(normalized.pi.permissions, { write: false, shell: false, network: false });
assert.equal(WORKFLOW_SCRIPT_META_JSON_SCHEMA.properties.pi.properties.maxConcurrency.maximum, HARD_MAX_CONCURRENCY);

assert.throws(
  () => validateWorkflowScriptMeta({ name: "bad name", description: "Bad" }),
  (error) => error instanceof WorkflowValidationError && error.issues.some((issue) => issue.includes("slug-like")),
);
assert.throws(
  () => validateWorkflowScriptMeta({ name: "wrong", description: "Bad" }, { expectedName: "expected" }),
  (error) => error instanceof WorkflowValidationError && error.issues.some((issue) => issue.includes("must match filename")),
);
assert.throws(
  () => validateWorkflowScriptMeta({ name: "bad", description: "Bad", phases: ["one", "one"] }),
  (error) => error instanceof WorkflowValidationError && error.issues.some((issue) => issue.includes("duplicate phase")),
);
assert.throws(
  () => validateWorkflowScriptMeta({ name: "bad", description: "Bad", pi: { timeoutMs: HARD_MAX_WORKFLOW_TIMEOUT_MS + 1 } }),
  (error) => error instanceof WorkflowValidationError && error.issues.some((issue) => issue.includes("timeoutMs")),
);
assert.throws(
  () => validateWorkflowScriptMeta({ name: "bad", description: "Bad", pi: { unexpected: true } }),
  (error) => error instanceof WorkflowValidationError && error.issues.some((issue) => issue.includes("not supported")),
);

const effective = effectiveWorkflowPolicy(
  validateWorkflowScriptMeta({
    name: "policy",
    description: "Policy",
    pi: {
      maxConcurrency: 8,
      maxAgents: 90,
      timeoutMs: 60_000,
      permissions: { write: true, shell: true, network: true },
    },
  }).pi,
  {
    maxConcurrency: 2,
    maxAgents: 10,
    timeoutMs: 30_000,
    permissions: { write: false, shell: true, network: false },
  },
);
assert.equal(effective.maxConcurrency, 2);
assert.equal(effective.maxAgents, 10);
assert.equal(effective.timeoutMs, 30_000);
assert.deepEqual(effective.permissions, { write: false, shell: true, network: false });

console.log("script schema tests passed");
