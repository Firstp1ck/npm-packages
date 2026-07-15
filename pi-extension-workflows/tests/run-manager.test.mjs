import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256 } from "../src/persistence-schema.ts";
import { WorkflowRunManager } from "../src/run-manager.ts";
import { createWorkflowRunStorage } from "../src/run-storage.ts";
import { transitionWorkflowRun } from "../src/run-status.ts";
import { WorkflowAgentScheduler } from "../src/scheduler.ts";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-run-manager-test-"));

function run(runId, name = runId) {
  const now = new Date().toISOString();
  return {
    runId,
    workflowKey: name,
    workflowName: name,
    sourceType: "javascript",
    status: "queued",
    input: {},
    phases: [],
    startedAt: now,
    updatedAt: now,
  };
}

try {
  const storage = createWorkflowRunStorage({ agentDir: temp, sessionId: "session-manager" });
  const requests = [];
  const results = [];
  const persistenceErrors = [];
  const manager = new WorkflowRunManager({
    onRequest(value) { requests.push(value.runId); },
    onResult(value) { results.push(value.runId); },
    onPersistenceError(value, error) { persistenceErrors.push({ runId: value.runId, error }); },
  });

  let release;
  const source = "export const meta = {};\nreturn { ok: true };\n";
  const managedRun = run("run-managed", "managed");
  const receipt = await manager.launch({
    run: managedRun,
    storage,
    projectId: "project-test",
    scriptSnapshot: { source, hash: sha256(source) },
    policySnapshot: { version: 1, permissions: { write: false, shell: false, network: false } },
    async execute(_signal, onUpdate) {
      transitionWorkflowRun(managedRun, "validating");
      onUpdate(managedRun);
      transitionWorkflowRun(managedRun, "running");
      managedRun.phases.push({
        phaseId: "audit",
        name: "Audit",
        status: "running",
        startedAt: new Date().toISOString(),
        tasks: [{
          taskId: "inspect",
          name: "Inspect",
          label: "inspect",
          callIndex: 1,
          status: "running",
          prompt: "inspect prompt",
          promptHash: sha256("inspect prompt"),
          fingerprint: sha256("inspect fingerprint"),
          options: { tools: ["read"] },
          startedAt: new Date().toISOString(),
        }],
      });
      onUpdate(managedRun);
      await new Promise((resolve) => { release = resolve; });
      const task = managedRun.phases[0].tasks[0];
      task.status = "completed";
      task.output = "done";
      task.result = "done";
      task.usage = { input: 10, output: 4, cost: 0.01, turns: 1 };
      task.finishedAt = new Date().toISOString();
      managedRun.phases[0].status = "completed";
      managedRun.phases[0].finishedAt = task.finishedAt;
      managedRun.result = { ok: true };
      managedRun.summary = "completed summary";
      transitionWorkflowRun(managedRun, "completed");
      onUpdate(managedRun);
      return managedRun;
    },
  });

  assert.equal(receipt.status, "async_launched");
  assert.equal(receipt.runId, "run-managed");
  assert.equal(receipt.taskId, "workflow-task-run-managed");
  assert.match(receipt.scriptPath, /workflow-runs[/\\]session-manager[/\\]run-managed[/\\]workflow\.js$/);
  assert.deepEqual(requests, ["run-managed"]);
  assert.notEqual(managedRun.status, "completed", "launch must return while execution is still in progress");
  assert.equal((await storage.readRun("run-managed")).status, "queued", "accepted state must be durable before asynchronous launch returns");

  while (!release) await delay(1);
  release();
  const completed = await receipt.completion;
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, { ok: true });
  assert.deepEqual(completed.usage, { input: 10, output: 4, cost: 0.01, turns: 1 });
  assert.deepEqual(results, ["run-managed"]);
  assert.deepEqual(persistenceErrors, []);

  const runDir = await storage.runDirectory("run-managed");
  const durableRun = JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8"));
  assert.equal(durableRun.status, "completed");
  assert.equal(durableRun.snapshotPath, receipt.scriptPath);
  assert.deepEqual(JSON.parse(await readFile(path.join(runDir, "policy.json"), "utf8")), { permissions: { network: false, shell: false, write: false }, version: 1 });
  const eventLines = (await readFile(path.join(runDir, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(eventLines.some((event) => event.eventType === "run.accepted"));
  assert.ok(eventLines.some((event) => event.eventType === "run.finished"));
  const callFiles = await readdir(path.join(runDir, "calls"));
  assert.equal(callFiles.length, 1);
  const call = JSON.parse(await readFile(path.join(runDir, "calls", callFiles[0]), "utf8"));
  assert.equal(call.status, "completed");
  assert.equal(call.label, "inspect");
  const usageLines = (await readFile(path.join(runDir, "usage.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(usageLines.some((entry) => entry.scope === "agent"));
  assert.ok(usageLines.some((entry) => entry.scope === "phase" && entry.scopeId === "audit"));
  assert.ok(usageLines.some((entry) => entry.scope === "run"));
  const resultRecord = JSON.parse(await readFile(path.join(runDir, "result.json"), "utf8"));
  assert.equal(resultRecord.status, "completed");
  assert.deepEqual(resultRecord.result, { ok: true });
  assert.match(await readFile(path.join(runDir, "result.md"), "utf8"), /"ok": true/);

  let releaseParallelA;
  let releaseParallelB;
  const parallelRunA = run("run-parallel-a", "parallel-a");
  const parallelRunB = run("run-parallel-b", "parallel-b");
  const launchParallel = (value, setRelease) => manager.launch({
    run: value,
    storage,
    projectId: "project-test",
    policySnapshot: { version: 1, permissions: { write: false, shell: false, network: false } },
    async execute(_signal, onUpdate) {
      transitionWorkflowRun(value, "running");
      onUpdate(value);
      await new Promise((resolve) => setRelease(resolve));
      value.result = value.runId;
      transitionWorkflowRun(value, "completed");
      onUpdate(value);
      return value;
    },
  });
  const [parallelReceiptA, parallelReceiptB] = await Promise.all([
    launchParallel(parallelRunA, (releaseValue) => { releaseParallelA = releaseValue; }),
    launchParallel(parallelRunB, (releaseValue) => { releaseParallelB = releaseValue; }),
  ]);
  while (!releaseParallelA || !releaseParallelB) await delay(1);
  assert.equal(manager.active().filter((value) => value.runId.startsWith("run-parallel-")).length, 2, "run controllers must support multiple simultaneous runs");
  releaseParallelA();
  releaseParallelB();
  assert.deepEqual((await Promise.all([parallelReceiptA.completion, parallelReceiptB.completion])).map((value) => value.status), ["completed", "completed"]);

  const pauseScheduler = new WorkflowAgentScheduler(1);
  const pauseRun = run("run-pause", "pause");
  let releasePauseActive;
  let pauseQueuedStarted = false;
  const pauseReceipt = await manager.launch({
    run: pauseRun,
    storage,
    projectId: "project-test",
    scheduler: pauseScheduler,
    policySnapshot: { version: 1, permissions: { write: false, shell: false, network: false } },
    async execute(_signal, onUpdate) {
      transitionWorkflowRun(pauseRun, "running");
      onUpdate(pauseRun);
      const first = pauseScheduler.schedule({ runId: pauseRun.runId }, async () => await new Promise((resolve) => { releasePauseActive = resolve; }));
      while (!releasePauseActive) await delay(1);
      const second = pauseScheduler.schedule({ runId: pauseRun.runId }, async () => { pauseQueuedStarted = true; return "second"; });
      await first;
      await second;
      transitionWorkflowRun(pauseRun, "completed");
      onUpdate(pauseRun);
      return pauseRun;
    },
  });
  while (!releasePauseActive) await delay(1);
  assert.equal(manager.pause(pauseRun.runId), true);
  assert.equal(pauseRun.status, "paused");
  releasePauseActive("first");
  await delay(10);
  assert.equal(pauseQueuedStarted, false, "manager pause must let active calls finish without starting queued calls");
  assert.equal(manager.resume(pauseRun.runId), true);
  assert.equal((await pauseReceipt.completion).status, "completed");
  assert.equal(pauseQueuedStarted, true);

  const failedRun = run("run-failed", "failed");
  const failedReceipt = await manager.launch({
    run: failedRun,
    storage,
    projectId: "project-test",
    policySnapshot: { version: 1, permissions: { write: false, shell: false, network: false } },
    async execute(_signal, onUpdate) {
      transitionWorkflowRun(failedRun, "running");
      onUpdate(failedRun);
      throw new Error("expected managed failure");
    },
  });
  const managedFailure = await failedReceipt.completion;
  assert.equal(managedFailure.status, "failed");
  assert.match(managedFailure.error, /expected managed failure/);

  const abortedRun = run("run-aborted", "aborted");
  const abortedReceipt = await manager.launch({
    run: abortedRun,
    storage,
    projectId: "project-test",
    policySnapshot: { version: 1, permissions: { write: false, shell: false, network: false } },
    async execute(signal, onUpdate) {
      transitionWorkflowRun(abortedRun, "running");
      onUpdate(abortedRun);
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      return abortedRun;
    },
  });
  while (abortedRun.status !== "running") await delay(1);
  assert.equal(manager.abort("run-aborted"), true);
  assert.equal((await abortedReceipt.completion).status, "cancelled");
  assert.equal(manager.abort("run-aborted"), false);

  assert.throws(() => transitionWorkflowRun(completed, "running"), /invalid workflow run transition/);

  const interrupted = {
    schemaVersion: 1,
    kind: "run",
    runId: "run-interrupted",
    sessionId: storage.sessionId,
    projectId: "project-test",
    workflowName: "interrupted",
    sourceType: "javascript",
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await storage.writeRun(interrupted);
  const restartedManager = new WorkflowRunManager();
  const restored = await restartedManager.restore(storage);
  assert.ok(restored.some((record) => record.runId === "run-managed" && record.status === "completed"));
  assert.equal(restartedManager.getRecord("run-interrupted").status, "failed");

  const shutdownRun = run("run-shutdown", "shutdown");
  const shutdownReceipt = await manager.launch({
    run: shutdownRun,
    storage,
    projectId: "project-test",
    policySnapshot: { version: 1, permissions: { write: false, shell: false, network: false } },
    async execute(signal, onUpdate) {
      transitionWorkflowRun(shutdownRun, "running");
      onUpdate(shutdownRun);
      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return shutdownRun;
    },
  });
  while (shutdownRun.status !== "running") await delay(1);
  await manager.shutdown("test shutdown");
  assert.equal((await shutdownReceipt.completion).status, "cancelled");
  assert.equal(manager.active().length, 0);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("run manager tests passed");
