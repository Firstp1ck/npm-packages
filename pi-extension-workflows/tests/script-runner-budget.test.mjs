import assert from "node:assert/strict";
import { parseWorkflowScript } from "../src/script-parser.ts";
import { runJavaScriptWorkflow } from "../src/script-runner.ts";
import { createWorkflowStateStore } from "../src/state.ts";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function source(name, body) {
  const script = parseWorkflowScript(body, { sourcePath: `${name}.js`, enforceFilename: true });
  return { path: `/tmp/${name}.js`, scope: "inline", sourceType: "javascript", script };
}

async function execute(workflowSource, taskRunner, extra = {}) {
  return await runJavaScriptWorkflow(workflowSource, {}, { hasUI: false }, {
    cwd: process.cwd(),
    state: createWorkflowStateStore(),
    taskRunner,
    ...extra,
  });
}

const sequentialSource = source("budget-sequential", `
export const meta = {
  name: "budget-sequential",
  description: "Sequential token exhaustion",
  pi: { maxConcurrency: 1, maxAgents: 4, timeoutMs: 5000, budgets: { run: { maxTokens: 10 } } }
}
const first = await agent("first", { label: "first" })
return await agent("second:" + first, { label: "second" })
`);
let sequentialSpawns = 0;
const sequentialRun = await execute(sequentialSource, {
  async runTask(task, context) {
    sequentialSpawns++;
    assert.equal(context.agentBudget.maxTokens, 5, "aggregate quantum must become the dispatched agent cap");
    assert.equal(context.agentBudget.maxTurns, 8, "derived token caps must also bound turns by default");
    assert.match(task.prompt, /return your concise best answer before the final allowed turn/i);
    return { ok: true, output: "first-result", usage: { input: 10 } };
  },
});
assert.equal(sequentialRun.status, "failed");
assert.equal(sequentialRun.errorKind, "budget_exhausted");
assert.equal(sequentialSpawns, 1, "a settled overage must prevent the next sequential dispatch");
assert.equal(sequentialRun.phases.flatMap((phase) => phase.tasks)[0].usage.input, 10);

const parallelSource = source("budget-held-parallel", `
export const meta = {
  name: "budget-held-parallel",
  description: "Held parallel admission",
  pi: { maxConcurrency: 2, maxAgents: 4, timeoutMs: 5000, budgets: { run: { maxTokens: 10 } } }
}
return await parallel([
  () => agent("one", { label: "one" }),
  () => agent("two", { label: "two" })
], { concurrency: 2 })
`);
const releaseParallel = [];
const parallelStarted = [];
const parallelPromise = execute(parallelSource, {
  async runTask(task, context) {
    parallelStarted.push({ id: task.id, cap: context.agentBudget.maxTokens });
    await new Promise((resolve) => { releaseParallel.push(resolve); });
    return { ok: true, output: task.id, usage: { input: 1 } };
  },
});
for (let attempt = 0; parallelStarted.length < 2 && attempt < 100; attempt++) await delay(5);
assert.equal(parallelStarted.length, 2, "only the two synchronously reserved calls may reach the held runner");
assert.deepEqual(parallelStarted.map((entry) => entry.cap), [5, 5]);
releaseParallel.splice(0).forEach((release) => release());
const parallelRun = await parallelPromise;
assert.equal(parallelRun.status, "completed");
assert.equal(parallelRun.phases.flatMap((phase) => phase.tasks).length, 2);

const retrySource = source("budget-retry-accounting", `
export const meta = {
  name: "budget-retry-accounting",
  description: "Retry usage accounting",
  pi: {
    maxConcurrency: 1,
    maxAgents: 2,
    timeoutMs: 5000,
    budgets: { run: { maxTokens: 100 } },
    retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 }
  }
}
return await agent("retry", { label: "retry" })
`);
let retryAttempts = 0;
const retryRun = await execute(retrySource, {
  async runTask(_task, context) {
    retryAttempts++;
    assert.equal(context.agentBudget.maxTokens, 50);
    if (retryAttempts === 1) return { ok: false, output: "transient partial", error: "temporary network failure", usage: { input: 2, output: 3 } };
    return { ok: true, output: "settled result", usage: { input: 7, output: 2, cacheRead: 1 } };
  },
});
assert.equal(retryRun.status, "completed");
assert.equal(retryAttempts, 2);
const retriedTask = retryRun.phases.flatMap((phase) => phase.tasks)[0];
assert.deepEqual(retriedTask.usage, { input: 9, output: 5, cacheRead: 1 });
assert.equal(retriedTask.output, "settled result");

const contextUsageSource = source("budget-context-usage", `
export const meta = { name: "budget-context-usage", description: "Context usage merge", pi: { retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 } } }
return await agent("context", { label: "context" })
`);
let contextUsageAttempts = 0;
const contextUsageRun = await execute(contextUsageSource, {
  async runTask() {
    contextUsageAttempts++;
    return contextUsageAttempts === 1
      ? { ok: false, output: "retry", error: "temporary network failure", usage: { input: 2, contextTokens: 100 } }
      : { ok: true, output: "done", usage: { input: 1, contextTokens: 40 } };
  },
});
assert.equal(contextUsageRun.phases[0].tasks[0].usage.contextTokens, 100, "cumulative usage must retain the maximum observed context size");

const noRetrySource = source("budget-no-retry", `
export const meta = {
  name: "budget-no-retry",
  description: "Budget stops never retry",
  pi: {
    maxConcurrency: 1,
    maxAgents: 2,
    timeoutMs: 5000,
    budgets: { agent: { maxTokens: 5 } },
    retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 }
  }
}
return await agent("must stop", { label: "limited", schema: { type: "object" } })
`);
let limitedAttempts = 0;
const noRetryRun = await execute(noRetrySource, {
  async runTask() {
    limitedAttempts++;
    return {
      ok: false,
      output: "partial non-json output",
      error: "temporary network failure",
      usage: { input: 6, output: 1, turns: 1 },
      raw: [{ type: "workflow_agent_budget_stop", reason: "max_tokens", limit: 5, observedTokens: 7, turns: 1 }],
    };
  },
});
assert.equal(noRetryRun.status, "failed");
assert.equal(noRetryRun.errorKind, "budget_exhausted");
assert.equal(limitedAttempts, 1, "budget termination must take precedence over retry classification");
const limitedTask = noRetryRun.phases.flatMap((phase) => phase.tasks)[0];
assert.equal(limitedTask.output, "partial non-json output", "budget classification must preserve partial output before schema validation");
assert.deepEqual(limitedTask.usage, { input: 6, output: 1, turns: 1 });
assert.doesNotMatch(limitedTask.error, /structured-output/i);

const replaySource = source("budget-replay", `
export const meta = {
  name: "budget-replay",
  description: "Replay is charged without spawning",
  pi: { maxConcurrency: 1, maxAgents: 2, timeoutMs: 5000, budgets: { run: { maxTokens: 5 } } }
}
return await agent("cached", { label: "cached" })
`);
let replaySpawns = 0;
const replayRun = await execute(replaySource, {
  async runTask() {
    replaySpawns++;
    return { ok: true, output: "must not run" };
  },
}, {
  replay: {
    sourceRunId: "prior-run",
    take() { return { result: "cached result", usage: { input: 5 } }; },
  },
});
assert.equal(replayRun.status, "completed");
assert.equal(replayRun.result, "cached result");
assert.equal(replaySpawns, 0, "replay hits must not reserve through the task runner or spawn");
assert.equal(replayRun.phases.flatMap((phase) => phase.tasks)[0].usage.input, 5);

console.log("script runner budget tests passed");
