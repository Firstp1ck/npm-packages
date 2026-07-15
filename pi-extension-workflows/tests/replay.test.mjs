import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workflowCallFingerprint } from "../src/call-fingerprint.ts";
import { parseWorkflowScript } from "../src/script-parser.ts";
import { createJavaScriptRun, runJavaScriptWorkflow } from "../src/script-runner.ts";
import { loadWorkflowReplayCache } from "../src/replay.ts";
import { WorkflowRunManager } from "../src/run-manager.ts";
import { createWorkflowRunStorage } from "../src/run-storage.ts";
import { createWorkflowStateStore } from "../src/state.ts";

const fingerprintA = workflowCallFingerprint({ phasePath: ["audit"], label: "a", prompt: "inspect", options: { tools: ["read", "grep"], timeoutMs: 10 }, pipelineKey: "pipeline-1:item" });
const fingerprintB = workflowCallFingerprint({ phasePath: ["audit"], label: "a", prompt: "inspect", options: { timeoutMs: 10, tools: ["grep", "read"] }, pipelineKey: "pipeline-1:item" });
assert.equal(fingerprintA, fingerprintB, "normalized semantically equivalent options must fingerprint identically");
assert.notEqual(fingerprintA, workflowCallFingerprint({ phasePath: ["audit"], label: "a", prompt: "changed", options: { tools: ["read", "grep"], timeoutMs: 10 }, pipelineKey: "pipeline-1:item" }));
assert.notEqual(fingerprintA, workflowCallFingerprint({ phasePath: ["audit"], label: "a", prompt: "inspect", options: { tools: ["read", "grep"], timeoutMs: 10 }, pipelineKey: "pipeline-1:other" }));

const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-replay-test-"));
try {
  const storage = createWorkflowRunStorage({ agentDir: temp, sessionId: "session-replay" });
  const manager = new WorkflowRunManager();
  const baseSource = `
export const meta = { name: "replay-demo", description: "Replay demo", pi: { maxAgents: 10 } }
const first = await agent("first", { label: "first" })
const second = await agent("second:" + first, { label: "second" })
const piped = await pipeline(["x"], item => agent("pipe:" + item, { label: "pipe" }), { key: item => "key-" + item })
return { first, second, piped }
`;

  const launch = async ({ runId, sourceCode = baseSource, replay, excludeCallIds = [], failLabel } = {}) => {
    const scriptName = sourceCode.match(/name:\s*["']([a-z0-9][a-z0-9-]*)["']/i)?.[1] ?? "replay-demo";
    const script = parseWorkflowScript(sourceCode, { sourcePath: `${scriptName}.js`, enforceFilename: true });
    const source = { path: `/tmp/${script.meta.name}.js`, scope: "inline", sourceType: "javascript", script };
    const run = createJavaScriptRun(source, {});
    run.runId = runId;
    let spawns = 0;
    const usedReplay = replay ? await loadWorkflowReplayCache(storage, replay, { excludeCallIds }) : undefined;
    const receipt = await manager.launch({
      run,
      storage,
      projectId: "project-replay",
      scriptSnapshot: { source: script.source, hash: script.sourceHash },
      policySnapshot: script.meta.pi,
      async execute(signal, onRunUpdate) {
        return await runJavaScriptWorkflow(source, {}, { hasUI: false }, {
          cwd: process.cwd(), state: createWorkflowStateStore(), storage, run, signal, onRunUpdate, replay: usedReplay,
          taskRunner: {
            async runTask(task) {
              spawns++;
              if (task.id === failLabel) return { ok: false, output: "", error: "planned failure" };
              return { ok: true, output: `result:${task.prompt}` };
            },
          },
        });
      },
    });
    return { run: await receipt.completion, spawns, calls: await storage.readCalls(runId) };
  };

  const first = await launch({ runId: "run-first" });
  assert.equal(first.run.status, "completed");
  assert.equal(first.spawns, 3);
  assert.equal(first.calls.length, 3);
  assert.ok(first.calls.every((call) => call.status === "completed" && call.fingerprint && "result" in call));
  assert.match(first.calls.find((call) => call.label === "pipe").pipelineKey, /^pipeline-1:key:key-x$/);

  const unchanged = await launch({ runId: "run-unchanged", replay: "run-first" });
  assert.equal(unchanged.run.status, "completed");
  assert.equal(unchanged.spawns, 0, "unchanged completed calls must not spawn subprocesses");
  assert.equal(unchanged.run.resumedFromRunId, "run-first");

  const secondCall = first.calls.find((call) => call.label === "second");
  const retry = await launch({ runId: "run-retry", replay: "run-first", excludeCallIds: [secondCall.callId] });
  assert.equal(retry.spawns, 1, "individual retry must not rerun unrelated completed calls");

  const editedSource = baseSource.replace('agent("first"', 'agent("first-edited"');
  const edited = await launch({ runId: "run-edited", sourceCode: editedSource, replay: "run-first" });
  assert.equal(edited.run.status, "completed");
  assert.equal(edited.spawns, 2, "changed call and dependent prompt must rerun while unrelated pipeline result remains cached");

  const failedSource = `export const meta = { name: "failed-replay", description: "Failed replay" }\nreturn await agent("fail", { label: "fail" })`;
  const failed = await launch({ runId: "run-failed", sourceCode: failedSource, failLabel: "fail" });
  assert.equal(failed.run.status, "failed");
  const retriedFailure = await launch({ runId: "run-failed-retry", sourceCode: failedSource, replay: "run-failed" });
  assert.equal(retriedFailure.spawns, 1, "failed calls must never be returned from replay cache");

  const unlabeledSource = `export const meta = { name: "unlabeled-replay", description: "Unlabeled" }\nreturn await agent("unlabeled")`;
  const unlabeledFirst = await launch({ runId: "run-unlabeled-first", sourceCode: unlabeledSource });
  const unlabeledReplay = await launch({ runId: "run-unlabeled-replay", sourceCode: unlabeledSource, replay: "run-unlabeled-first" });
  assert.equal(unlabeledReplay.spawns, 0);
  assert.match(unlabeledReplay.run.resumeWarnings.join("\n"), /add a stable label and pipeline key/);

  const indexedSource = `export const meta = { name: "indexed-replay", description: "Indexed" }\nreturn await pipeline(["x"], item => agent(item, { label: "indexed" }))`;
  const indexedFirst = await launch({ runId: "run-indexed-first", sourceCode: indexedSource });
  const indexedReplay = await launch({ runId: "run-indexed-replay", sourceCode: indexedSource, replay: "run-indexed-first" });
  assert.equal(indexedReplay.spawns, 0);
  assert.match(indexedReplay.run.resumeWarnings.join("\n"), /provide pipeline\(\.\.\., \{ key \}\) before reordering/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("replay tests passed");
