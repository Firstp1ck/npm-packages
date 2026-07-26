import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createSubprocessTaskRunner } from "../src/task-runner.ts";

const fixture = fileURLToPath(new URL("./fixtures/assistant-message-stream.mjs", import.meta.url));
const runner = createSubprocessTaskRunner({
  terminationGraceMs: 100,
  invocation: { command: process.execPath, argsPrefix: [fixture] },
});

function context(agentBudget) {
  return {
    cwd: process.cwd(),
    input: {},
    run: { runId: "budget-subprocess-run" },
    phase: { id: "budget", name: "Budget", mode: "sequential", tasks: [] },
    priorOutputs: "",
    agentBudget,
  };
}

const tokenResult = await runner.runTask(
  { id: "token", name: "Token", prompt: "stream" },
  context({ maxTokens: 6 }),
);
assert.equal(tokenResult.ok, false);
assert.match(tokenResult.error, /token limit 6 reached/i);
assert.equal(tokenResult.usage.input, 4);
assert.equal(tokenResult.usage.output, 6);
assert.equal(tokenResult.usage.turns, 2);
assert.match(tokenResult.output, /partial turn one/);
assert.match(tokenResult.output, /partial turn two/);
assert.ok(
  tokenResult.raw.some((event) => event?.type === "workflow_agent_budget_stop" && event.reason === "max_tokens"),
  "token termination must retain a structured internal reason in raw events",
);

const turnResult = await runner.runTask(
  { id: "turn", name: "Turn", prompt: "stream" },
  context({ maxTurns: 2 }),
);
assert.equal(turnResult.ok, false);
assert.match(turnResult.error, /turn limit 2 reached/i);
assert.equal(turnResult.usage.input, 4);
assert.equal(turnResult.usage.output, 6);
assert.equal(turnResult.usage.turns, 2);
assert.match(turnResult.output, /partial turn one/);
assert.match(turnResult.output, /partial turn two/);
assert.ok(
  turnResult.raw.some((event) => event?.type === "workflow_agent_budget_stop" && event.reason === "max_turns"),
  "turn termination must retain a structured internal reason in raw events",
);

const finalResult = await runner.runTask(
  { id: "final", name: "Final", prompt: "final-stop" },
  context({ maxTurns: 1 }),
);
assert.equal(finalResult.ok, true, "a model-authored final response at the turn limit must complete successfully");
assert.equal(finalResult.output, "concise final answer");
assert.equal(finalResult.usage.turns, 1);

const errorResult = await runner.runTask(
  { id: "error", name: "Error", prompt: "final-error" },
  context({ maxTurns: 1 }),
);
assert.equal(errorResult.ok, false);
assert.equal(errorResult.error, "provider failed", "assistant/provider errors take precedence over a coincident turn boundary");
assert.ok(!errorResult.raw.some((event) => event?.type === "workflow_agent_budget_stop"), "provider errors must not be rewritten as budget stops");

const trailingResult = await runner.runTask(
  { id: "trailing", name: "Trailing", prompt: "no-newline-budget" },
  context({ maxTokens: 1 }),
);
assert.equal(trailingResult.ok, false);
assert.match(trailingResult.error, /token limit 1 reached/i);
assert.match(trailingResult.output, /trailing partial/);
assert.ok(trailingResult.raw.some((event) => event?.type === "workflow_agent_budget_stop"), "an unterminated final JSON record must retain its budget marker without leaking cleanup state");

console.log("task runner budget tests passed");
