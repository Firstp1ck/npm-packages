import assert from "node:assert/strict";
import { parseWorkflowScript } from "../src/script-parser.ts";
import { executeWorkflowScript } from "../src/script-runtime.ts";

const script = parseWorkflowScript(`
export const meta = {
  name: "runtime-test",
  description: "Runtime test",
  phases: ["discover", "verify"],
  pi: { maxConcurrency: 2, maxAgents: 4, timeoutMs: 5000 }
}
const discovered = await phase("discover", () => pipeline(
  args.items,
  (item, index) => agent("item:" + item, { label: "item:" + index, tools: ["read"] }),
  { concurrency: 4, key: item => "item:" + item }
))
const verified = await phase("verify", () => parallel([
  () => agent("verify:left", { label: "left" }),
  () => agent("verify:right", { label: "right" })
], { concurrency: 2 }))
return { discovered, verified, ambient: [
  typeof globalThis["pro" + "cess"],
  typeof globalThis["requ" + "ire"],
  typeof globalThis["ev" + "al"],
  typeof globalThis["Fun" + "ction"]
] }
`);

let active = 0;
let maxActive = 0;
const requests = [];
const phaseEvents = [];
const pipelineEvents = [];
const execution = await executeWorkflowScript(script, { items: ["a", "b"] }, {
  async agent(request) {
    requests.push(request);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, request.prompt.endsWith("a") ? 20 : 5));
    active--;
    return { prompt: request.prompt, phase: request.phasePath.join("/") };
  },
  onPhaseEvent(event) {
    phaseEvents.push(event);
  },
  onPipelineEvent(event) {
    pipelineEvents.push(event);
  },
});

assert.equal(execution.agentCalls, 4);
assert.ok(execution.interruptChecks >= 0);
assert.equal(maxActive, 2, "host scheduler must enforce script maxConcurrency");
assert.deepEqual(execution.result.discovered.map((item) => item.prompt), ["item:a", "item:b"], "pipeline output order must be stable");
assert.deepEqual(execution.result.verified.map((item) => item.prompt), ["verify:left", "verify:right"], "parallel output order must be stable");
assert.deepEqual(execution.result.ambient, ["undefined", "undefined", "undefined", "undefined"]);
assert.deepEqual(requests.map((request) => request.phasePath.join("/")), ["discover", "discover", "verify", "verify"]);
assert.deepEqual(phaseEvents.map((event) => `${event.type}:${event.name}`), [
  "start:discover",
  "complete:discover",
  "start:verify",
  "complete:verify",
]);
assert.deepEqual(pipelineEvents.map((event) => `${event.type}:${event.index}:${event.key}`), [
  "start:0:item:a",
  "start:1:item:b",
  "complete:1:item:b",
  "complete:0:item:a",
]);

const overBudget = parseWorkflowScript(`
export const meta = { name: "budget", description: "Budget", pi: { maxAgents: 1, timeoutMs: 5000 } }
await agent("one", { label: "one" })
return await agent("two", { label: "two" })
`);
await assert.rejects(
  () => executeWorkflowScript(overBudget, {}, { async agent(request) { return request.prompt } }),
  /maxAgents 1/,
);

const dynamicCode = parseWorkflowScript(`
export const meta = { name: "dynamic-code", description: "Dynamic code", pi: { timeoutMs: 5000 } }
return ({}).constructor.constructor("return 42")()
`);
await assert.rejects(
  () => executeWorkflowScript(dynamicCode, {}, { async agent() { return "unused" } }),
  /function|eval|not a function|disabled/i,
  "Function-constructor indirection must remain disabled inside the interpreter",
);

const infiniteLoop = parseWorkflowScript(`
export const meta = { name: "infinite", description: "Infinite", pi: { timeoutMs: 30 } }
while (true) {}
`);
await assert.rejects(
  () => executeWorkflowScript(infiniteLoop, {}, { async agent() { return "unused" } }),
  /interrupt|timeout|exceeded/i,
  "interpreter deadline must terminate infinite loops",
);

const memoryPressure = parseWorkflowScript(`
export const meta = { name: "memory", description: "Memory", pi: { timeoutMs: 5000 } }
const values = []
while (true) values.push("x".repeat(4096))
`);
await assert.rejects(
  () => executeWorkflowScript(memoryPressure, {}, { async agent() { return "unused" } }, { memoryLimitBytes: 2 * 1024 * 1024 }),
  /memory|allocation|interrupted/i,
  "interpreter memory limit must terminate allocation pressure",
);

const duplicatePipelineKeys = parseWorkflowScript(`
export const meta = { name: "duplicate-keys", description: "Duplicate keys", pi: { timeoutMs: 5000 } }
return await pipeline(["a", "b"], item => agent(item), { key: () => "duplicate" })
`);
await assert.rejects(
  () => executeWorkflowScript(duplicatePipelineKeys, {}, { async agent() { return "unused" } }),
  /pipeline keys must be unique/i,
);

const instructionBudget = parseWorkflowScript(`
export const meta = { name: "instruction-budget", description: "Instruction budget", pi: { timeoutMs: 5000 } }
let value = 0
while (true) value++
`);
await assert.rejects(
  () => executeWorkflowScript(instructionBudget, {}, { async agent() { return "unused" } }, { instructionLimit: 2 }),
  /instruction limit 2/i,
  "deterministic interrupt budget must stop CPU-bound scripts before their wall-clock deadline",
);

const noResult = parseWorkflowScript(`
export const meta = { name: "no-result", description: "No result", pi: { timeoutMs: 5000 } }
await Promise.resolve("done")
`);
await assert.rejects(
  () => executeWorkflowScript(noResult, {}, { async agent() { return "unused" } }),
  /without a top-level return value/i,
);

const nonJsonResult = parseWorkflowScript(`
export const meta = { name: "non-json-result", description: "Non JSON result", pi: { timeoutMs: 5000 } }
return 1n
`);
await assert.rejects(
  () => executeWorkflowScript(nonJsonResult, {}, { async agent() { return "unused" } }),
  /workflow result must be JSON-compatible/i,
);

const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(
  () => executeWorkflowScript(script, { items: [] }, { async agent() { return "unused" } }, { signal: cancelled.signal }),
  /cancel|abort/i,
);

console.log("script runtime tests passed");
