import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseWorkflowScript } from "../src/script-parser.ts";
import { createWorkflowRunStorage } from "../src/run-storage.ts";
import { runJavaScriptWorkflow } from "../src/script-runner.ts";
import { createWorkflowStateStore } from "../src/state.ts";

function source(script) {
  return {
    path: "/tmp/script-runner.js",
    scope: "bundled",
    sourceType: "javascript",
    script,
  };
}

const script = parseWorkflowScript(`
export const meta = {
  name: "script-runner",
  description: "Script runner",
  phases: ["discover", "verify"],
  pi: { maxConcurrency: 2, maxAgents: 3, timeoutMs: 5000 }
}
const found = await phase("discover", () => agent("find:" + args.topic, {
  label: "find",
  model: "test-model",
  tools: ["read"],
  cwd: ".",
  timeoutMs: 1000,
  schema: {
    type: "object",
    required: ["files"],
    properties: { files: { type: "array", items: { type: "string" } } }
  }
}))
return await phase("verify", () => agent("verify:" + found.files.join(","), { label: "verify", tools: ["grep"] }))
`);

const persisted = [];
const taskCalls = [];
const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-script-runner-test-"));
const state = createWorkflowStateStore({ appendEntry(_type, data) { persisted.push(data); } });
const run = await runJavaScriptWorkflow(source(script), { topic: "demo" }, { hasUI: false }, {
  cwd: process.cwd(),
  state,
  storage: createWorkflowRunStorage({ agentDir: temp, sessionId: "script-runner-session" }),
  taskRunner: {
    async runTask(task, context) {
      taskCalls.push({ task, context });
      if (task.id === "find") return { ok: true, output: JSON.stringify({ files: ["a.ts", "b.ts"] }) };
      return { ok: true, output: "verified" };
    },
  },
});

assert.equal(run.status, "completed");
assert.equal(run.sourceType, "javascript");
assert.equal(run.scriptHash, script.sourceHash);
assert.equal(await readFile(run.snapshotPath, "utf8"), script.source, "run must reference its byte-exact immutable script snapshot");
assert.match(run.policyHash, /^[a-f0-9]{64}$/);
assert.match(run.projectId, /^project-[a-f0-9]{48}$/);
assert.equal(run.result, "verified");
assert.deepEqual(run.phases.map((phase) => phase.phaseId), ["discover", "verify"]);
assert.deepEqual(run.phases.flatMap((phase) => phase.tasks).map((task) => task.status), ["completed", "completed"]);
assert.match(taskCalls[0].task.prompt, /Return only JSON matching this schema/);
assert.equal(taskCalls[0].task.model, "test-model");
assert.deepEqual(taskCalls[0].task.tools, ["read"]);
assert.equal(taskCalls[0].task.cwd, ".");
assert.equal(taskCalls[0].task.timeoutMs, 1000);
assert.match(taskCalls[1].task.prompt, /^verify:a\.ts,b\.ts[\s\S]*Workflow agent policy:/);
assert.ok(persisted.length >= 4, "script runner should persist lifecycle transitions");
assert.equal(state.getActiveRun(), undefined);
assert.equal(state.getLastRun().status, "completed");

const pipelineScript = parseWorkflowScript(`
export const meta = { name: "pipeline-runner", description: "Pipeline runner", pi: { timeoutMs: 5000 } }
return await pipeline(args.items, async item => {
  await Promise.resolve()
  return agent("item:" + item, { label: "item:" + item })
}, { concurrency: 2, key: item => "key:" + item })
`);
const pipelinePersisted = [];
const pipelineRun = await runJavaScriptWorkflow(source(pipelineScript), { items: ["a", "b"] }, { hasUI: false }, {
  cwd: process.cwd(),
  state: createWorkflowStateStore({ appendEntry(_type, data) { pipelinePersisted.push(data); } }),
  taskRunner: { async runTask(task) { return { ok: true, output: task.prompt }; } },
});
assert.equal(pipelineRun.status, "completed");
assert.deepEqual(pipelineRun.pipelineItems.map((item) => ({ index: item.index, key: item.key, status: item.status })), [
  { index: 0, key: "key:a", status: "completed" },
  { index: 1, key: "key:b", status: "completed" },
]);
assert.deepEqual(
  pipelineRun.phases.flatMap((phase) => phase.tasks).map((task) => task.pipelineKey),
  ["pipeline-1:key:key:a", "pipeline-1:key:key:b"],
  "async pipeline calls must persist their stable pipeline identity on agent tasks",
);
assert.ok(pipelinePersisted.some((snapshot) => snapshot.pipelineItems?.every((item) => item.status === "completed")), "pipeline keys must be persisted in run state");

const invalidStructured = parseWorkflowScript(`
export const meta = { name: "invalid", description: "Invalid", pi: { timeoutMs: 5000 } }
return await agent("invalid", { label: "invalid", schema: { type: "object", required: ["ok"] } })
`);
const failed = await runJavaScriptWorkflow(source(invalidStructured), {}, { hasUI: false }, {
  cwd: process.cwd(),
  state: createWorkflowStateStore(),
  taskRunner: { async runTask() { return { ok: true, output: "not json" }; } },
});
assert.equal(failed.status, "failed");
assert.match(failed.error, /invalid JSON/);

const detachedSource = source(parseWorkflowScript(`
export const meta = { name: "detached-runner", description: "Detached runner", pi: { timeoutMs: 40 } }
agent("late", { label: "late" })
return "done"
`));
const snapshots = [];
const detachedRun = await runJavaScriptWorkflow(detachedSource, {}, { hasUI: false }, {
  cwd: process.cwd(), state: createWorkflowStateStore({ appendEntry(_type, data) { snapshots.push(data); } }),
  taskRunner: { async runTask() { await new Promise(resolve => setTimeout(resolve, 90)); return { ok: true, output: "late output", usage: { input: 1, output: 1 } }; } },
});
assert.equal(detachedRun.status, "failed");
assert.equal(detachedRun.phases.flatMap(phase => phase.tasks)[0].status, "failed");
const finalSnapshot = structuredClone(snapshots.at(-1));
await new Promise(resolve => setTimeout(resolve, 120));
assert.deepEqual(detachedRun, finalSnapshot, "late abort-ignoring task settlement must not mutate the finalized run or persistence snapshot");
const neverSettlingRun = await runJavaScriptWorkflow(source(parseWorkflowScript(`export const meta = { name: "never-settling-runner", description: "Never", pi: { timeoutMs: 40 } }
return await agent("never", { label: "never" })`)), {}, { hasUI: false }, {
  cwd: process.cwd(), state: createWorkflowStateStore(), taskRunner: { async runTask() { return await new Promise(() => {}); } },
});
assert.equal(neverSettlingRun.status, "failed");
assert.equal(neverSettlingRun.phases.flatMap(phase => phase.tasks)[0].status, "failed");

await rm(temp, { recursive: true, force: true });
console.log("script runner tests passed");
