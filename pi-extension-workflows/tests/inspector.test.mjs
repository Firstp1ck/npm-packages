import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildWorkflowInspectorPayload, validateWorkflowInspectorPayload, workflowInspectorPayloadLine } from "../src/inspector.ts";
import { sha256 } from "../src/persistence-schema.ts";
import { WorkflowRunManager } from "../src/run-manager.ts";
import { createWorkflowRunStorage } from "../src/run-storage.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-inspector-test-"));
try {
  const storage = createWorkflowRunStorage({ agentDir: temp, sessionId: "session-inspector" });
  const source = `export const meta = { name: "inspect-demo", description: "Inspect demo" }\nreturn 1\n`;
  const scriptHash = sha256(source);
  const snapshot = await storage.snapshotScript("run-inspect", source, scriptHash);
  const now = new Date().toISOString();
  await storage.writePolicy("run-inspect", { version: 1, permissions: { write: false, shell: false, network: false } });
  await storage.writeRun({
    schemaVersion: 1, kind: "run", runId: "run-inspect", sessionId: storage.sessionId, projectId: "project-inspect",
    workflowName: "Inspect demo", sourceType: "javascript", status: "completed", scriptHash, snapshotPath: snapshot.scriptPath,
    input: { topic: "inspection" }, startedAt: now, updatedAt: now, finishedAt: now,
  });
  await storage.writeCall({
    schemaVersion: 1, kind: "call", runId: "run-inspect", callId: "call-inspect", callIndex: 1,
    phasePath: ["audit"], label: "inspect", prompt: "Inspect files", promptHash: sha256("Inspect files"), fingerprint: sha256("fingerprint"),
    status: "completed", options: { tools: ["read"] }, result: { files: ["src/index.ts"] },
    recentEvents: [{ type: "stdout", timestamp: now, line: "read src/index.ts" }], startedAt: now, finishedAt: now,
  });
  await storage.appendUsage({ schemaVersion: 1, kind: "usage", runId: "run-inspect", scope: "agent", scopeId: "call-inspect", usage: { input: 10, output: 5 }, recordedAt: now });
  await storage.appendUsage({ schemaVersion: 1, kind: "usage", runId: "run-inspect", scope: "phase", scopeId: "audit", usage: { input: 10, output: 5 }, recordedAt: now });
  await storage.appendUsage({ schemaVersion: 1, kind: "usage", runId: "run-inspect", scope: "run", scopeId: "run-inspect", usage: { input: 10, output: 5, cost: 0.01 }, recordedAt: now });
  await storage.writeResult({ schemaVersion: 1, kind: "result", runId: "run-inspect", status: "completed", finishedAt: now, summary: "inspection complete", result: { ok: true } }, "done");

  const manager = new WorkflowRunManager();
  await manager.restore(storage);
  const payload = await buildWorkflowInspectorPayload({
    manager,
    storage,
    mode: { schemaVersion: 1, enabled: true, behavior: "persistent", phase: "armed", updatedAt: now },
  });
  assert.equal(validateWorkflowInspectorPayload(payload), payload);
  assert.equal(payload.version, 1);
  assert.equal(payload.mode.enabled, true);
  assert.equal(payload.runs.length, 1);
  const run = payload.runs[0];
  assert.equal(run.runId, "run-inspect");
  assert.equal(run.input.topic, "inspection");
  assert.match(run.script, /inspect-demo/);
  assert.deepEqual(run.usage, { input: 10, output: 5, cost: 0.01 });
  assert.deepEqual(run.result, { ok: true });
  assert.equal(run.controls.canSave, true);
  assert.equal(run.phases[0].phaseId, "audit");
  assert.deepEqual(run.phases[0].usage, { input: 10, output: 5 });
  const agent = run.phases[0].agents[0];
  assert.equal(agent.callId, "call-inspect");
  assert.equal(agent.prompt, "Inspect files");
  assert.equal(agent.recentEvents[0].line, "read src/index.ts");
  assert.deepEqual(agent.result, { files: ["src/index.ts"] });
  assert.deepEqual(agent.usage, { input: 10, output: 5 });
  assert.match(workflowInspectorPayloadLine(payload), /^WORKFLOW_RPC_PAYLOAD \{"type":"firstpick\.pi-extension-workflows\.inspector","version":1,/);
  assert.throws(() => validateWorkflowInspectorPayload({ ...payload, version: 2 }), /version is unsupported/);
  assert.throws(() => validateWorkflowInspectorPayload({ ...payload, runs: [{ runId: "bad" }] }), /run payload is invalid/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("inspector tests passed");
