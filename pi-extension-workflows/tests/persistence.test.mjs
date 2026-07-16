import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowApprovalStore } from "../src/approval.ts";
import {
  WORKFLOW_APPROVAL_ENTRY_TYPE,
  WORKFLOW_PERSISTENCE_JSON_SCHEMAS,
  approvalMatches,
  canonicalJson,
  createWorkflowApprovalRecord,
  hashWorkflowPolicy,
  migrateWorkflowPersistenceRecord,
  sha256,
  validateWorkflowPersistenceRecord,
  workflowProjectIdentity,
} from "../src/persistence-schema.ts";
import { createWorkflowRunStorage } from "../src/run-storage.ts";

const now = new Date().toISOString();
const hashA = sha256("a");
const hashB = sha256("b");
const projectId = "project-0123456789abcdef0123456789abcdef0123456789abcdef";

assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
assert.equal(hashWorkflowPolicy({
  version: 1,
  maxConcurrency: 3,
  maxAgents: 50,
  maxNestingDepth: 16,
  timeoutMs: 1000,
  permissions: { write: false, shell: false, network: false },
}), hashWorkflowPolicy({
  permissions: { network: false, shell: false, write: false },
  timeoutMs: 1000,
  maxNestingDepth: 16,
  maxAgents: 50,
  maxConcurrency: 3,
  version: 1,
}));
assert.notEqual(hashWorkflowPolicy({
  version: 1,
  maxConcurrency: 3,
  maxAgents: 50,
  maxNestingDepth: 16,
  timeoutMs: 1000,
  permissions: { write: false, shell: false, network: false },
}), hashWorkflowPolicy({
  version: 1,
  maxConcurrency: 3,
  maxAgents: 50,
  maxNestingDepth: 17,
  timeoutMs: 1000,
  permissions: { write: false, shell: false, network: false },
}), "maxNestingDepth must participate in policy identity and approval hashing");

const approval = createWorkflowApprovalRecord({ projectId, scriptHash: hashA, policyHash: hashB, scope: "remembered", approvedAt: now });
assert.equal(approvalMatches(approval, { projectId, scriptHash: hashA, policyHash: hashB }), true);
assert.equal(approvalMatches(approval, { projectId, scriptHash: sha256("changed"), policyHash: hashB }), false, "script changes must invalidate approval");
assert.equal(approvalMatches(approval, { projectId, scriptHash: hashA, policyHash: sha256("changed-policy") }), false, "policy changes must invalidate approval");
assert.equal(validateWorkflowPersistenceRecord(approval).kind, "approval");
assert.equal(migrateWorkflowPersistenceRecord(approval).schemaVersion, 1);
assert.throws(() => migrateWorkflowPersistenceRecord({ ...approval, schemaVersion: 2 }), /no safe migration is registered/);
assert.throws(() => validateWorkflowPersistenceRecord({ ...approval, unexpected: true }), /unknown field 'unexpected'/);
assert.ok(WORKFLOW_PERSISTENCE_JSON_SCHEMAS.run.properties.snapshotPath, "run schema must represent optional snapshot fields");
assert.ok(WORKFLOW_PERSISTENCE_JSON_SCHEMAS.usage.properties.usage.properties.cost, "usage schema must represent every usage field");

const persistedEntries = [];
const approvals = createWorkflowApprovalStore({ appendEntry(customType, data) { persistedEntries.push({ type: "custom", customType, data }); } });
const key = { projectId, scriptHash: hashA, policyHash: hashB };
approvals.approve(key, "once");
assert.equal(approvals.consume(key), true);
assert.equal(approvals.consume(key), false, "one-shot approval must be consumed exactly once");
approvals.approve(key, "remembered");
assert.equal(persistedEntries.at(-1).customType, WORKFLOW_APPROVAL_ENTRY_TYPE);
assert.equal(approvals.consume(key), true);
assert.equal(approvals.isApproved(key), true, "remembered approval remains valid after use");

const restored = createWorkflowApprovalStore();
assert.equal(restored.restoreFromEntries([
  ...persistedEntries,
  { type: "custom", customType: WORKFLOW_APPROVAL_ENTRY_TYPE, data: { ...approval, schemaVersion: 99 } },
]), 1, "invalid or future approval records must fail closed");
assert.equal(restored.isApproved(key), true);
assert.equal(restored.isApproved({ ...key, policyHash: sha256("new") }), false);

const validRecords = [
  {
    schemaVersion: 1, kind: "run", runId: "run-1", sessionId: "session-1", projectId, workflowName: "demo", sourceType: "javascript",
    status: "running", scriptHash: hashA, policyHash: hashB, snapshotPath: "/tmp/workflow.js", startedAt: now, updatedAt: now,
  },
  {
    schemaVersion: 1, kind: "call", runId: "run-1", callId: "call-1", callIndex: 1, phasePath: ["audit"], label: "audit",
    prompt: "Audit files", promptHash: hashA, fingerprint: hashB, status: "completed", options: { tools: ["read"] }, result: "done",
    startedAt: now, finishedAt: now, resultPath: "calls/call-1.json",
  },
  { schemaVersion: 1, kind: "event", runId: "run-1", sequence: 0, timestamp: now, eventType: "run.started", data: {} },
  { schemaVersion: 1, kind: "usage", runId: "run-1", scope: "run", scopeId: "run-1", usage: { input: 1, output: 2, cost: 0 }, recordedAt: now },
  { schemaVersion: 1, kind: "result", runId: "run-1", status: "completed", finishedAt: now, summary: "done", result: { ok: true } },
];
for (const record of validRecords) assert.equal(validateWorkflowPersistenceRecord(record).kind, record.kind);
assert.throws(() => validateWorkflowPersistenceRecord({ ...validRecords[2], sequence: -1 }), /sequence must be a non-negative/);
assert.throws(() => validateWorkflowPersistenceRecord({ ...validRecords[3], usage: { cost: -1 } }), /finite non-negative/);

const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-persistence-test-"));
try {
  const identityA = await workflowProjectIdentity(temp);
  const identityB = await workflowProjectIdentity(path.join(temp, "."));
  assert.equal(identityA, identityB, "project identity must use the canonical project path");

  const storage = createWorkflowRunStorage({ agentDir: temp, sessionId: "session-safe" });
  const source = "export const meta = {};\nreturn 1;\n";
  const sourceHash = sha256(source);
  const snapshot = await storage.snapshotScript("run-safe", source, sourceHash);
  assert.equal(snapshot.scriptHash, sourceHash);
  assert.equal(await readFile(snapshot.scriptPath, "utf8"), source);
  assert.match(snapshot.scriptPath, /workflow-runs[/\\]session-safe[/\\]run-safe[/\\]workflow\.js$/);

  const repeated = await storage.snapshotScript("run-safe", source, sourceHash);
  assert.equal(repeated.scriptPath, snapshot.scriptPath, "repeating identical persistence must be idempotent");
  const changed = `${source}// changed\n`;
  await assert.rejects(() => storage.snapshotScript("run-safe", changed, sha256(changed)), /already exists with different bytes/);
  await assert.rejects(() => storage.snapshotScript("..", source, sourceHash), /unsafe path characters/);
  await assert.rejects(() => storage.snapshotScript("run-hash", source, hashA), /source hash changed/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("persistence tests passed");
