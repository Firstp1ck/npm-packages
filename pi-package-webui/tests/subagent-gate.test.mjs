import assert from "node:assert/strict";
import { registerSubagentGate } from "../lib/subagent-gate.mjs";

class EventBus {
  constructor() { this.handlers = new Map(); }
  on(name, handler) {
    const handlers = this.handlers.get(name) || new Set();
    handlers.add(handler);
    this.handlers.set(name, handlers);
    return () => handlers.delete(handler);
  }
  emit(name, value) {
    for (const handler of [...(this.handlers.get(name) || [])]) handler(value);
  }
}

function createHarness(script) {
  const events = new EventBus();
  let tool;
  let runSerial = 0;
  const requests = [];
  const pi = {
    events,
    registerTool(value) { tool = value; },
  };
  const registration = registerSubagentGate(pi);
  events.on("subagents:rpc:v1:request", (request) => {
    requests.push(request);
    if (request.method === "stop") {
      events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { version: 1, requestId: request.requestId, success: true, data: { state: "stopping" } });
      return;
    }
    assert.equal(request.method, "spawn");
    const next = script.shift();
    assert.ok(next, `unexpected spawn request for ${request.params?.agent}`);
    if (next.spawnError) {
      events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
        version: 1,
        requestId: request.requestId,
        success: false,
        error: { code: next.code || "execution_failed", message: next.spawnError },
      });
      return;
    }
    const runId = next.runId || `gate-run-${++runSerial}`;
    const respond = () => {
      if (next.completeBeforeReply && !next.noCompletion) events.emit("subagent:async-complete", { runId, ...next.completion });
      events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
        version: 1,
        requestId: request.requestId,
        success: true,
        data: { details: next.noRunId ? {} : { asyncId: runId } },
      });
      if (!next.completeBeforeReply && !next.noCompletion) queueMicrotask(() => events.emit("subagent:async-complete", { runId, ...next.completion }));
    };
    if (next.replyDelayMs) setTimeout(respond, next.replyDelayMs);
    else respond();
  });
  return { tool, requests, dispose: () => registration.dispose() };
}

function completion({ agent = "reviewer", model = "anthropic/claude-opus-4-8", output = "Useful result", error, success = true, state = success ? "complete" : "failed", ...extra } = {}) {
  return {
    success,
    state,
    summary: error || output,
    results: [{ agent, model, output, error, success, ...extra }],
  };
}

async function execute(tool, params, signal = new AbortController().signal) {
  return tool.execute("test-call", params, signal, undefined);
}

async function executeFailure(tool, params, signal = new AbortController().signal) {
  try {
    await execute(tool, params, signal);
    assert.fail("expected subagent gate failure");
  } catch (error) {
    assert.equal(error.name, "SubagentGateError");
    return error.details;
  }
}

function workflowChildParams(request) {
  const script = request.params?.workflowScript;
  const prefix = 'return runs.run("gate", ';
  assert.equal(typeof script, "string");
  assert.ok(script.startsWith(prefix));
  assert.ok(script.endsWith(");"));
  return JSON.parse(script.slice(prefix.length, -2));
}

{
  const harness = createHarness([{ completeBeforeReply: true, completion: completion() }]);
  const result = await execute(harness.tool, { tasks: [{ agent: "reviewer", task: "Review" }] });
  assert.equal(result.isError, undefined);
  assert.equal(result.details.gate.status, "satisfied");
  assert.equal(result.details.gate.qualifyingSuccesses, 1);
  assert.equal(result.details.gate.attempts.length, 1, "completion emitted before the spawn reply should be recovered from the cache");
  const spawn = harness.requests.find((request) => request.method === "spawn");
  assert.equal(spawn.params.agent, undefined, "public RPC must not use removed direct execution");
  assert.equal(spawn.params.task, undefined, "public RPC must not use removed direct execution");
  assert.equal(spawn.params.async, true, "the wrapper workflow must remain asynchronous");
  assert.deepEqual(workflowChildParams(spawn), { agent: "reviewer", task: "Review", async: false });
  harness.dispose();
}

{
  const harness = createHarness([{ completion: completion({ output: "All child controls preserved" }) }]);
  await execute(harness.tool, {
    attemptTimeoutMs: 4567,
    tasks: [{
      agent: "reviewer",
      task: "Review quoted task: `x`",
      model: "openai/gpt-5.4",
      context: "fresh",
      cwd: "/tmp/repo",
      skill: ["audit"],
      output: "summary",
      outputMode: "inline",
      acceptance: { verify: true },
    }],
  });
  const spawn = harness.requests.find((request) => request.method === "spawn");
  assert.equal(spawn.params.timeoutMs, 4567);
  assert.deepEqual(workflowChildParams(spawn), {
    agent: "reviewer",
    task: "Review quoted task: `x`",
    model: "openai/gpt-5.4",
    context: "fresh",
    cwd: "/tmp/repo",
    skill: ["audit"],
    output: "summary",
    outputMode: "inline",
    acceptance: { verify: true },
    async: false,
  });
  harness.dispose();
}

{
  const harness = createHarness([
    { completion: completion({ success: false, error: "provider overloaded (503)", output: "" }) },
    { completion: completion({ model: "openrouter/moonshotai/kimi-k3", output: "Recovered result" }) },
  ]);
  const result = await execute(harness.tool, {
    tasks: [{
      agent: "reviewer",
      task: "Review",
      model: "anthropic/claude-opus-4-8",
      fallbackModels: ["openrouter/moonshotai/kimi-k3"],
      retrySafety: "read-only",
    }],
  });
  assert.equal(result.details.gate.status, "satisfied");
  assert.deepEqual(result.details.gate.attempts.map((attempt) => [attempt.status, attempt.failureKind, attempt.provider]), [
    ["failed", "transient-provider", "anthropic"],
    ["succeeded", undefined, "openrouter"],
  ]);
  assert.equal(harness.requests.filter((request) => request.method === "spawn").length, 2);
  harness.dispose();
}

{
  const harness = createHarness([{ completion: completion({ success: false, error: "provider overloaded (503)", output: "" }) }]);
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "worker", task: "Edit files", retrySafety: "may-write" }],
    maxAttemptsPerTask: 3,
  });
  assert.equal(details.gate.status, "failed");
  assert.equal(details.gate.attempts.length, 1, "a started may-write task must not be automatically retried");
  harness.dispose();
}

{
  const harness = createHarness([
    { spawnError: "temporary async runner startup failure" },
    { completion: completion({ agent: "worker", model: "openai-codex/gpt-5.6-terra", output: "Writer started only after retry" }) },
  ]);
  const result = await execute(harness.tool, {
    tasks: [{ agent: "worker", task: "Edit files", retrySafety: "may-write" }],
  });
  assert.equal(result.details.gate.status, "satisfied");
  assert.equal(result.details.gate.attempts.length, 2, "a pre-launch failure may be retried even for may-write tasks");
  assert.equal(result.details.gate.attempts[0].failureKind, "pre-launch");
  harness.dispose();
}

{
  const harness = createHarness([{ completion: completion({ success: false, state: "stopped", error: "Stopped by user", output: "", stopped: true }) }]);
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "reviewer", task: "Review", retrySafety: "read-only" }],
    maxAttemptsPerTask: 3,
  });
  assert.equal(details.gate.attempts.length, 1);
  assert.equal(details.gate.attempts[0].failureKind, "stopped");
  harness.dispose();
}

{
  const harness = createHarness([
    { completion: completion({ agent: "reviewer-a", model: "anthropic/claude-opus-4-8", output: "First provider result" }) },
    { completion: completion({ agent: "reviewer-b", model: "anthropic/claude-fable-5", output: "Duplicate provider result" }) },
    { completion: completion({ agent: "reviewer-b", model: "openrouter/moonshotai/kimi-k3", output: "Distinct provider result" }) },
  ]);
  const result = await execute(harness.tool, {
    tasks: [
      { agent: "reviewer-a", task: "Review A", model: "anthropic/claude-opus-4-8", retrySafety: "read-only" },
      {
        agent: "reviewer-b",
        task: "Review B",
        model: "anthropic/claude-fable-5",
        fallbackModels: ["openrouter/moonshotai/kimi-k3"],
        retrySafety: "read-only",
      },
    ],
    requiredSuccesses: 2,
    requireDistinctProviders: true,
    concurrency: 1,
  });
  assert.equal(result.details.gate.status, "satisfied");
  assert.equal(result.details.gate.qualifyingSuccesses, 2);
  assert.deepEqual(result.details.gate.attempts.map((attempt) => [attempt.status, attempt.failureKind, attempt.provider]), [
    ["succeeded", undefined, "anthropic"],
    ["not-qualifying", "provider-diversity", "anthropic"],
    ["succeeded", undefined, "openrouter"],
  ]);
  harness.dispose();
}

{
  const harness = createHarness([{ noCompletion: true }]);
  const controller = new AbortController();
  queueMicrotask(() => controller.abort());
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "reviewer", task: "Review", retrySafety: "read-only" }],
  }, controller.signal);
  assert.equal(details.gate.status, "cancelled");
  assert.equal(details.gate.attempts[0].status, "cancelled", "a cancelled gate must not retain a misleading running attempt");
  assert.ok(details.gate.attempts[0].endedAt);
  assert.equal(harness.requests.filter((request) => request.method === "stop").length, 1, "cancelling the gate should stop its live async child");
  harness.dispose();
}

{
  const harness = createHarness([{ replyDelayMs: 10, noCompletion: true }]);
  const controller = new AbortController();
  queueMicrotask(() => controller.abort());
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "worker", task: "Edit files", retrySafety: "may-write", phase: "implementation" }],
    maxAttemptsPerTask: 3,
  }, controller.signal);
  assert.equal(details.gate.attempts.length, 1, "abort during spawn must not be classified as a retryable pre-launch failure");
  assert.equal(details.gate.attempts[0].status, "cancelled");
  assert.equal(details.gate.attempts[0].phase, "implementation");
  assert.equal(harness.requests.filter((request) => request.method === "stop").length, 1, "a late spawn reply must still be reconciled and stopped");
  harness.dispose();
}

{
  const harness = createHarness([{ noRunId: true, noCompletion: true }]);
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "worker", task: "Edit files", retrySafety: "may-write" }],
    maxAttemptsPerTask: 3,
  });
  assert.equal(details.gate.attempts.length, 1, "a success reply without a run id is ambiguous and must not relaunch a writer");
  assert.equal(details.gate.attempts[0].failureKind, "protocol-ambiguous");
  harness.dispose();
}

{
  const harness = createHarness([{ completion: completion({ success: false, state: "interrupted", error: "Paused for input", output: "", interrupted: true }) }]);
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "reviewer", task: "Review", retrySafety: "read-only" }],
    maxAttemptsPerTask: 3,
  });
  assert.equal(details.gate.attempts.length, 1);
  assert.equal(details.gate.attempts[0].failureKind, "interrupted");
  harness.dispose();
}

{
  const harness = createHarness([
    { completion: completion({ success: false, error: "provider overloaded (503)", output: "" }) },
    { completion: completion({ success: false, error: "provider overloaded again (503)", output: "" }) },
  ]);
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "reviewer", task: "Review", retrySafety: "read-only" }],
    maxAttemptsPerTask: 2,
  });
  assert.equal(details.gate.attempts.length, 2, "transient retries must stop at the explicit attempt budget");
  assert.deepEqual(details.exhaustedSlots, [0]);
  harness.dispose();
}

{
  const harness = createHarness([]);
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "reviewer", task: "Review", model: "anthropic/claude-opus-4-8", retrySafety: "read-only" }],
    excludedProviders: ["anthropic"],
  });
  assert.equal(details.gate.attempts[0].failureKind, "provider-exhausted");
  assert.equal(harness.requests.filter((request) => request.method === "spawn").length, 0, "known-excluded model candidates must not spend a child launch");
  harness.dispose();
}

{
  const harness = createHarness([{ completion: completion() }]);
  const result = await execute(harness.tool, {
    tasks: [
      { agent: "reviewer", task: "Review A", retrySafety: "read-only" },
      { agent: "reviewer", task: "Review B", retrySafety: "read-only" },
    ],
    requiredSuccesses: 1,
    concurrency: 1,
  });
  assert.equal(harness.requests.filter((request) => request.method === "spawn").length, 1, "queued slots must not launch after quorum is already satisfied");
  assert.deepEqual(result.details.skippedSlots, [1]);
  harness.dispose();
}

{
  const harness = createHarness([{ noCompletion: true }]);
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "reviewer", task: "Review", retrySafety: "read-only" }],
    gateTimeoutMs: 5,
  });
  assert.equal(details.gate.status, "failed");
  assert.equal(details.gate.attempts[0].status, "cancelled");
  assert.equal(details.gate.attempts[0].failureKind, "timeout");
  assert.equal(harness.requests.filter((request) => request.method === "stop").length, 1);
  harness.dispose();
}

{
  const harness = createHarness([{ spawnError: "Unknown agent: missing", code: "invalid_params" }]);
  const details = await executeFailure(harness.tool, {
    tasks: [{ agent: "missing", task: "Do work", retrySafety: "read-only" }],
    maxAttemptsPerTask: 3,
  });
  assert.equal(details.gate.attempts.length, 1, "deterministic invalid configuration must not be repeated blindly");
  assert.equal(details.gate.attempts[0].failureKind, "configuration");
  harness.dispose();
}

console.log("subagent-gate.test.mjs passed");
