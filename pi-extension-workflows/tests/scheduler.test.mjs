import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkflowScript } from "../src/script-parser.ts";
import { runJavaScriptWorkflow } from "../src/script-runner.ts";
import { WorkflowAgentScheduler } from "../src/scheduler.ts";
import { createWorkflowStateStore } from "../src/state.ts";
import { createSubprocessTaskRunner } from "../src/task-runner.ts";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = new WorkflowAgentScheduler(2);
let active = 0;
let maxActive = 0;
const started = [];
const results = await Promise.all(Array.from({ length: 6 }, (_, index) => scheduler.schedule({ runId: `run-${index % 2}`, callId: `call-${index}` }, async () => {
  started.push(index);
  active++;
  maxActive = Math.max(maxActive, active);
  await delay(index % 2 ? 5 : 15);
  active--;
  return index;
})));
assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
assert.deepEqual(started, [0, 1, 2, 3, 4, 5], "global scheduler queue must be FIFO");
assert.equal(maxActive, 2);
assert.deepEqual(scheduler.snapshot(), { maxConcurrency: 2, active: 0, queued: 0 });

const single = new WorkflowAgentScheduler(1);
let releaseFirst;
const first = single.schedule({}, async () => await new Promise((resolve) => { releaseFirst = resolve; }));
while (!releaseFirst) await delay(1);
const queuedAbort = new AbortController();
const queued = single.schedule({ signal: queuedAbort.signal }, async () => "must-not-run");
queuedAbort.abort();
await assert.rejects(() => queued, /cancel|abort/i);
releaseFirst("done");
assert.equal(await first, "done");
assert.deepEqual(single.snapshot(), { maxConcurrency: 1, active: 0, queued: 0 });

await assert.rejects(
  () => single.schedule({ timeoutMs: 20, callId: "slow" }, async (signal) => {
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return "late";
  }),
  /Agent timeout for slow exceeded 20ms/,
);

function source(name) {
  const script = parseWorkflowScript(`
export const meta = { name: "${name}", description: "${name}", pi: { maxConcurrency: 4, maxAgents: 4, timeoutMs: 5000 } }
return await parallel([
  () => agent("${name}:a", { label: "a" }),
  () => agent("${name}:b", { label: "b" })
], { concurrency: 2 })
`);
  return { path: `/tmp/${name}.js`, scope: "inline", sourceType: "javascript", script };
}

const shared = new WorkflowAgentScheduler(2);
active = 0;
maxActive = 0;
const fakeRunner = {
  async runTask(task, context) {
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(15);
    active--;
    if (context.signal.aborted) return { ok: false, output: "", error: "aborted" };
    return { ok: true, output: task.prompt };
  },
};
const [runA, runB] = await Promise.all([
  runJavaScriptWorkflow(source("scheduler-a"), {}, { hasUI: false }, { cwd: process.cwd(), state: createWorkflowStateStore(), taskRunner: fakeRunner, scheduler: shared }),
  runJavaScriptWorkflow(source("scheduler-b"), {}, { hasUI: false }, { cwd: process.cwd(), state: createWorkflowStateStore(), taskRunner: fakeRunner, scheduler: shared }),
]);
assert.equal(runA.status, "completed");
assert.equal(runB.status, "completed");
assert.equal(maxActive, 2, "one scheduler must cap subprocess concurrency across independent runs");

const timeoutScript = parseWorkflowScript(`
export const meta = { name: "agent-timeout", description: "Agent timeout", pi: { timeoutMs: 5000 } }
return await agent("slow", { label: "slow", timeoutMs: 20 })
`);
const timeoutRun = await runJavaScriptWorkflow(
  { path: "/tmp/agent-timeout.js", scope: "inline", sourceType: "javascript", script: timeoutScript },
  {},
  { hasUI: false },
  {
    cwd: process.cwd(),
    state: createWorkflowStateStore(),
    scheduler: new WorkflowAgentScheduler(1),
    taskRunner: {
      async runTask(_task, context) {
        await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true }));
        return { ok: false, output: "", error: "aborted" };
      },
    },
  },
);
assert.equal(timeoutRun.status, "failed");
assert.match(timeoutRun.error, /Agent timeout for slow exceeded 20ms/);

const escaped = await createSubprocessTaskRunner().runTask(
  { id: "escape", name: "Escape", prompt: "unused", cwd: "../outside" },
  { cwd: process.cwd(), input: {}, run: runA, phase: { id: "test", name: "Test", mode: "sequential", tasks: [] }, priorOutputs: "" },
);
assert.equal(escaped.ok, false);
assert.match(escaped.error, /escapes the workflow root/);

if (process.platform !== "win32") {
  const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-process-tree-test-"));
  try {
    await mkdir(path.join(temp, "cwd"));
    const pidFile = path.join(temp, "child.pid");
    const controller = new AbortController();
    const fixture = fileURLToPath(new URL("./fixtures/process-tree-child.mjs", import.meta.url));
    const runner = createSubprocessTaskRunner({
      terminationGraceMs: 50,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
    });
    const runPromise = runner.runTask(
      { id: "tree", name: "Tree", prompt: pidFile },
      { cwd: path.join(temp, "cwd"), input: {}, run: runA, phase: { id: "tree", name: "Tree", mode: "sequential", tasks: [] }, priorOutputs: "", signal: controller.signal },
    );
    let childPid;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { childPid = Number(await readFile(pidFile, "utf8")); break; } catch { await delay(5); }
    }
    assert.ok(Number.isInteger(childPid) && childPid > 0, "fixture must publish its grandchild pid");
    controller.abort();
    const cancelledResult = await runPromise;
    assert.equal(cancelledResult.ok, false);
    assert.match(cancelledResult.error, /aborted/i);
    await delay(150);
    assert.throws(() => process.kill(childPid, 0), (error) => error?.code === "ESRCH", "cancel must terminate the complete subprocess process group");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

console.log("scheduler tests passed");
