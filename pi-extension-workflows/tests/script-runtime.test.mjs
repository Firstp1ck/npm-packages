import assert from "node:assert/strict";
import { WorkflowError } from "../src/errors.ts";
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

const pendingTimeout = parseWorkflowScript(`
export const meta = { name: "pending-timeout", description: "Pending timeout", pi: { timeoutMs: 40 } }
await new Promise(() => {})
return "unreachable"
`);
const timeoutStartedAt = Date.now();
await assert.rejects(
  () => executeWorkflowScript(pendingTimeout, {}, { async agent() { return "unused" } }),
  (error) => error instanceof WorkflowError
    && error.kind === "timeout"
    && error.message === "Workflow exceeded timeout 40ms.",
  "a permanently pending top-level promise must reject with the categorized workflow deadline",
);
assert.ok(Date.now() - timeoutStartedAt < 1000, "pending workflow timeout must settle promptly");

const pendingAbort = parseWorkflowScript(`
export const meta = { name: "pending-abort", description: "Pending abort", pi: { timeoutMs: 5000 } }
await new Promise(() => {})
return "unreachable"
`);
const pendingAbortController = new AbortController();
const abortStartedAt = Date.now();
const pendingAbortExecution = executeWorkflowScript(
  pendingAbort,
  {},
  { async agent() { return "unused" } },
  { signal: pendingAbortController.signal },
);
setTimeout(() => pendingAbortController.abort(), 20);
await assert.rejects(
  () => pendingAbortExecution,
  (error) => error instanceof WorkflowError
    && error.kind === "cancelled"
    && error.message === "Workflow run was cancelled",
  "explicit abort must settle a permanently pending top-level promise with the cancellation contract",
);
assert.ok(Date.now() - abortStartedAt < 1000, "pending workflow abort must settle promptly");

const shadowedPrimitive = parseWorkflowScript(`
export const meta = { name: "shadowed-primitive", description: "Shadowed primitive", pi: { timeoutMs: 5000 } }
function callLocal(agent) { return agent("local") }
return await phase("outer", () => callLocal(value => ({ local: value })))
`);
assert.deepEqual(
  (await executeWorkflowScript(shadowedPrimitive, {}, { async agent() { throw new Error("host agent must not run for a shadowed local binding"); } })).result,
  { local: "local" },
  "lexically shadowed primitive names must keep ordinary JavaScript semantics",
);

const generatedNameCollision = parseWorkflowScript(`
export const meta = { name: "generated-name-collision", description: "Generated name collision", pi: { timeoutMs: 5000 } }
const __pi_workflow_api_1 = "preserved"
return phase("outer", async () => ({ value: __pi_workflow_api_1 }))
`);
assert.deepEqual(
  (await executeWorkflowScript(generatedNameCollision, {}, { async agent() { return "unused"; } })).result,
  { value: "preserved" },
  "callback transform names must not collide with workflow identifiers",
);

const callbackClosureBindings = parseWorkflowScript(`
export const meta = { name: "callback-closure-bindings", description: "Callback closures", pi: { timeoutMs: 5000 } }
async function phaseWithClosures() {
  const agent = value => "outer-agent:" + value
  const phase = value => "outer-phase:" + value
  const parallel = value => "outer-parallel:" + value
  const pipeline = value => "outer-pipeline:" + value
  return { agent: agent("x"), phase: phase("x"), parallel: parallel("x"), pipeline: pipeline("x") }
}
return phaseWithClosures()
`);
// `globalThis` is unavailable to workflow scripts; the direct variants below
// exercise transformed calls in scopes that capture capability-named locals.
const phaseClosureBindings = parseWorkflowScript(`
export const meta = { name: "phase-closure-bindings", description: "Phase closures", pi: { timeoutMs: 5000 } }
async function run() {
  const agent = value => "outer-agent:" + value
  const parallel = value => "outer-parallel:" + value
  const pipeline = value => "outer-pipeline:" + value
  return await phase("outer", () => ({ agent: agent("x"), parallel: parallel("x"), pipeline: pipeline("x") }))
}
return run()
`);
assert.deepEqual(
  (await executeWorkflowScript(phaseClosureBindings, {}, { async agent() { throw new Error("captured agent must not invoke host"); } })).result,
  { agent: "outer-agent:x", parallel: "outer-parallel:x", pipeline: "outer-pipeline:x" },
  "transformed phase callbacks must preserve captured capability-named bindings",
);
const pipelineClosureBindings = parseWorkflowScript(`
export const meta = { name: "pipeline-closure-bindings", description: "Pipeline closures", pi: { timeoutMs: 5000 } }
async function run() {
  const agent = value => "outer-agent:" + value
  const phase = value => "outer-phase:" + value
  const parallel = value => "outer-parallel:" + value
  return await pipeline(["x"], item => ({ agent: agent(item), phase: phase(item), parallel: parallel(item) }))
}
return run()
`);
assert.deepEqual(
  (await executeWorkflowScript(pipelineClosureBindings, {}, { async agent() { throw new Error("captured agent must not invoke host"); } })).result,
  [{ agent: "outer-agent:x", phase: "outer-phase:x", parallel: "outer-parallel:x" }],
  "transformed pipeline callbacks must preserve captured capability-named bindings",
);

const lexicalBindings = parseWorkflowScript(`
export const meta = { name: "lexical-bindings", description: "Lexical bindings", pi: { timeoutMs: 5000 } }
const values = []
for (let phase = value => value + 1, index = 0; index < 1; index++) values.push(phase(index))
function nestedVar() {
  if (false) { var pipeline = 1 }
  return typeof pipeline
}
switch ("phase") {
  case "phase": {
    const phase = value => "switch:" + value
    values.push(phase("local"))
    break
  }
}
try { throw "caught" } catch (phase) { values.push(phase) }
function localFunction() {
  function pipeline(value) { return "function:" + value }
  return pipeline("local")
}
values.push(nestedVar(), localFunction())
return values
`);
assert.deepEqual(
  (await executeWorkflowScript(lexicalBindings, {}, { async agent() { throw new Error("host agent must not run for local bindings"); } })).result,
  [1, "switch:local", "caught", "undefined", "function:local"],
  "loop, nested var, switch, catch, and function bindings must shadow runtime capabilities lexically",
);

const unsupportedNamedCallbacks = parseWorkflowScript(`
export const meta = { name: "unsupported-named-callbacks", description: "Unsupported named callbacks", pi: { timeoutMs: 5000 } }
const helpers = {
  async run(item) {
    await Promise.resolve()
    return agent("member:" + item.id)
  }
}
async function restWorker(...args) {
  const [item] = args
  await Promise.resolve()
  return agent("rest:" + item.id)
}
const phaseDefault = async (_unused = "default") => {
  await Promise.resolve()
  return agent("phase-default:" + _unused)
}
await phase("outer", phaseDefault)
return await pipeline([{ id: "x" }], helpers.run, { key: ({ id }) => id }).then(() => pipeline([{ id: "y" }], restWorker, { key: ({ id }) => id }))
`);
await assert.rejects(
  () => executeWorkflowScript(unsupportedNamedCallbacks, {}, { async agent() { return "unused"; } }),
  /inline function expression or arrow function/i,
  "named or member phase\/pipeline callbacks must fail closed instead of silently using root context",
);

const phaseAliasScript = parseWorkflowScript(`
export const meta = { name: "phase-alias", description: "Phase alias", pi: { timeoutMs: 5000 } }
const runPhase = phase
return await runPhase("outer", async () => agent("phase-alias"))
`);
let phaseAliasAgentCalls = 0;
await assert.rejects(
  () => executeWorkflowScript(phaseAliasScript, {}, { async agent() { phaseAliasAgentCalls += 1; return "unexpected"; } }),
  (error) => error instanceof WorkflowError
    && error.kind === "validation_error"
    && /phase must be called directly; aliased or first-class references are not supported/i.test(error.message),
  "direct phase aliases must be rejected before execution",
);
assert.equal(phaseAliasAgentCalls, 0, "phase alias rejection must happen before any host agent side effect");

const pipelineAliasScript = parseWorkflowScript(`
export const meta = { name: "pipeline-alias", description: "Pipeline alias", pi: { timeoutMs: 5000 } }
const runPipeline = pipeline
return await runPipeline([{ id: "x" }], async (item, index) => agent(item.id + ":" + index), { key: ({ id }) => id })
`);
let pipelineAliasAgentCalls = 0;
await assert.rejects(
  () => executeWorkflowScript(pipelineAliasScript, {}, { async agent() { pipelineAliasAgentCalls += 1; return "unexpected"; } }),
  (error) => error instanceof WorkflowError
    && error.kind === "validation_error"
    && /pipeline must be called directly; aliased or first-class references are not supported/i.test(error.message),
  "direct pipeline aliases must be rejected before execution",
);
assert.equal(pipelineAliasAgentCalls, 0, "pipeline alias rejection must happen before any host agent side effect");

const phaseDefaultAliasScript = parseWorkflowScript(`
export const meta = { name: "phase-default-alias", description: "Phase default alias", pi: { timeoutMs: 5000 } }
return await phase("outer", async (cb = phase) => cb("inner", async () => agent("phase-default-alias")))
`);
let phaseDefaultAliasAgentCalls = 0;
await assert.rejects(
  () => executeWorkflowScript(phaseDefaultAliasScript, {}, { async agent() { phaseDefaultAliasAgentCalls += 1; return "unexpected"; } }),
  (error) => error instanceof WorkflowError
    && error.kind === "validation_error"
    && /phase must be called directly; aliased or first-class references are not supported/i.test(error.message),
  "default-parameter aliases of phase must be rejected before execution",
);
assert.equal(phaseDefaultAliasAgentCalls, 0, "phase default-parameter alias rejection must happen before any host agent side effect");

const pipelineDefaultAliasScript = parseWorkflowScript(`
export const meta = { name: "pipeline-default-alias", description: "Pipeline default alias", pi: { timeoutMs: 5000 } }
return await phase("outer", async (runPipeline = pipeline) => runPipeline([{ id: "x" }], async (item, index) => agent(item.id + ":" + index), { key: ({ id }) => id }))
`);
let pipelineDefaultAliasAgentCalls = 0;
await assert.rejects(
  () => executeWorkflowScript(pipelineDefaultAliasScript, {}, { async agent() { pipelineDefaultAliasAgentCalls += 1; return "unexpected"; } }),
  (error) => error instanceof WorkflowError
    && error.kind === "validation_error"
    && /pipeline must be called directly; aliased or first-class references are not supported/i.test(error.message),
  "default-parameter aliases of pipeline must be rejected before execution",
);
assert.equal(pipelineDefaultAliasAgentCalls, 0, "pipeline default-parameter alias rejection must happen before any host agent side effect");

const defaultInitializerShadowing = parseWorkflowScript(`
export const meta = { name: "default-initializer-shadowing", description: "Default initializer shadowing", pi: { timeoutMs: 5000 } }
return await phase("outer", async (phase = async (_name, run) => await run(), cb = phase) => cb("inner", async () => ({ local: "shadowed" })))
`);
assert.deepEqual(
  (await executeWorkflowScript(defaultInitializerShadowing, {}, { async agent() { throw new Error("host agent must not run for default initializer shadowing"); } })).result,
  { local: "shadowed" },
  "earlier parameter shadowing in default initializers must keep ordinary JavaScript semantics",
);

const passedCapabilityScript = parseWorkflowScript(`
export const meta = { name: "passed-capability", description: "Passed capability", pi: { timeoutMs: 5000 } }
function keep(value) { return value }
keep(phase)
return "unreachable"
`);
await assert.rejects(
  () => executeWorkflowScript(passedCapabilityScript, {}, { async agent() { return "unused"; } }),
  (error) => error instanceof WorkflowError
    && error.kind === "validation_error"
    && /phase must be called directly; aliased or first-class references are not supported/i.test(error.message),
  "passing phase as a first-class value must also be rejected before execution",
);

const inlineCallbackShapes = parseWorkflowScript(`
export const meta = { name: "inline-callback-shapes", description: "Inline callback shapes", pi: { timeoutMs: 5000 } }
const member = await phase("outer", async () => pipeline([{ id: "x" }], async ({ id }, index = 0) => {
  await Promise.resolve()
  return agent("member:" + id + ":" + index)
}, { key: ({ id }) => id }))
const rest = await phase("rest-phase", async () => pipeline([{ id: "y" }], async (...args) => {
  const [{ id }, index] = args
  await Promise.resolve()
  return agent("rest:" + id + ":" + index)
}, { key: ({ id }) => id }))
const phaseResult = await phase("default-phase", async (_unused = "default") => {
  await Promise.resolve()
  return agent("phase-default:" + _unused)
})
return { member, rest, phaseResult }
`);
const callbackShapeRequests = [];
await executeWorkflowScript(inlineCallbackShapes, {}, {
  async agent(request) {
    callbackShapeRequests.push(request);
    return request.prompt;
  },
});
assert.deepEqual(
  callbackShapeRequests.map((request) => ({ prompt: request.prompt, phasePath: request.phasePath, hasPipelineKey: typeof request.pipelineKey === "string" && request.pipelineKey.length > 0 })),
  [
    { prompt: "member:x:0", phasePath: ["outer"], hasPipelineKey: true },
    { prompt: "rest:y:0", phasePath: ["rest-phase"], hasPipelineKey: true },
    { prompt: "phase-default:default", phasePath: ["default-phase"], hasPipelineKey: false },
  ],
  "inline destructured/default/rest callbacks must preserve logical context",
);

const asyncContexts = parseWorkflowScript(`
export const meta = { name: "async-contexts", description: "Async contexts", pi: { maxConcurrency: 3, timeoutMs: 5000 } }
const phases = await Promise.all([
  phase("a", async () => { await Promise.resolve(); return agent("phase:a") }),
  phase("b", async () => { await Promise.resolve(); return agent("phase:b") })
])
const piped = await pipeline(
  [{ id: "x" }],
  async item => {
    await Promise.resolve()
    return phase("inside-pipeline", async () => {
      await Promise.resolve()
      return agent("pipeline:" + item.id)
    })
  },
  { key: item => "item:" + item.id }
)
return { phases, piped }
`);
const contextRequests = [];
await executeWorkflowScript(asyncContexts, {}, {
  async agent(request) {
    contextRequests.push(request);
    return request.prompt;
  },
});
assert.deepEqual(
  contextRequests.slice(0, 2).map((request) => request.phasePath),
  [["a"], ["b"]],
  "overlapping phases must retain independent logical paths across await",
);
assert.deepEqual(contextRequests[2].phasePath, ["inside-pipeline"]);
assert.equal(
  contextRequests[2].pipelineKey,
  "pipeline-1:key:item:x",
  "pipeline identity must survive await and a nested phase call",
);

const depthAtLimit = parseWorkflowScript(`
export const meta = { name: "depth-at-limit", description: "Depth at limit", pi: { maxNestingDepth: 2, timeoutMs: 5000 } }
return phase("level-one", () => pipeline(["ok"], item => agent(item)))
`);
assert.deepEqual(
  (await executeWorkflowScript(depthAtLimit, {}, { async agent(request) { return request.prompt } })).result,
  ["ok"],
  "phase/pipeline orchestration at maxNestingDepth must be accepted",
);

const depthOverLimit = parseWorkflowScript(`
export const meta = { name: "depth-over-limit", description: "Depth over limit", pi: { maxNestingDepth: 2, timeoutMs: 5000 } }
return phase("level-one", () => pipeline(["over"], item => phase("level-three", () => agent(item))))
`);
await assert.rejects(
  () => executeWorkflowScript(depthOverLimit, {}, { async agent() { return "unused" } }),
  (error) => error instanceof WorkflowError
    && error.kind === "budget_exhausted"
    && error.message === "Workflow exceeded maxNestingDepth 2.",
  "the first orchestration call over maxNestingDepth must fail deterministically",
);

const hungAgentScript = parseWorkflowScript(`
export const meta = { name: "hung-agent", description: "Hung agent", pi: { timeoutMs: 40 } }
return await agent("hang")
`);
const hungTimeoutStartedAt = Date.now();
await assert.rejects(
  () => executeWorkflowScript(hungAgentScript, {}, { async agent() { return await new Promise(() => {}); } }),
  (error) => error instanceof WorkflowError
    && error.kind === "timeout"
    && error.message === "Workflow exceeded timeout 40ms.",
  "a hung host agent must time out at the configured workflow deadline",
);
assert.ok(Date.now() - hungTimeoutStartedAt < 500, "hung host-agent timeout must settle promptly without a multi-second cleanup delay");

const hungAbortScript = parseWorkflowScript(`
export const meta = { name: "hung-agent-abort", description: "Hung agent abort", pi: { timeoutMs: 5000 } }
return await agent("hang-abort")
`);
const hungAbortController = new AbortController();
const hungAbortStartedAt = Date.now();
const hungAbortExecution = executeWorkflowScript(
  hungAbortScript,
  {},
  { async agent() { return await new Promise(() => {}); } },
  { signal: hungAbortController.signal },
);
setTimeout(() => hungAbortController.abort(), 20);
await assert.rejects(
  () => hungAbortExecution,
  (error) => error instanceof WorkflowError
    && error.kind === "cancelled"
    && error.message === "Workflow run was cancelled",
  "explicit abort must promptly cancel a hung host agent",
);
assert.ok(Date.now() - hungAbortStartedAt < 500, "hung host-agent abort must settle promptly without waiting for ignored host cleanup");

const detachedAgentScript = parseWorkflowScript(`
export const meta = { name: "detached-agent", description: "Detached agent", pi: { timeoutMs: 5000 } }
agent("must not outlive completion")
return "invalid-completion"
`);
let detachedAgentSignal;
await assert.rejects(
  () => executeWorkflowScript(detachedAgentScript, {}, {
    async agent(_request, signal) {
      detachedAgentSignal = signal;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "late";
    },
  }),
  (error) => error instanceof WorkflowError
    && error.kind === "task_error"
    && /host agent operations remain outstanding/.test(error.message),
  "top-level completion with detached agent work must fail rather than mark the run completed",
);
assert.equal(detachedAgentSignal?.aborted, true, "detached host work must receive an abort signal");

const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(
  () => executeWorkflowScript(script, { items: [] }, { async agent() { return "unused" } }, { signal: cancelled.signal }),
  /cancel|abort/i,
);

console.log("script runtime tests passed");
