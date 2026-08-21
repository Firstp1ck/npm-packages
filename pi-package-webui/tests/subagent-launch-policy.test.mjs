import assert from "node:assert/strict";
import vm from "node:vm";
import { applySubagentLaunchSlotDefaults } from "../lib/subagent-launch-policy.mjs";
import { defaultSubagentLaunchSlotRoles } from "../lib/subagent-launch-slots.mjs";

const roles = defaultSubagentLaunchSlotRoles();
roles.delegate[0] = { id: "delegate:base", model: "openai-codex/gpt-5.6-luna", thinking: "low" };
roles.reviewer[0] = { id: "reviewer:base", model: "openai-codex/gpt-5.6-sol", thinking: "high" };
roles.reviewer.push({ id: "reviewer:second", model: "openrouter/moonshotai/kimi-k3", thinking: "high" });
roles.worker[0] = { id: "worker:base", model: "openai-codex/gpt-5.6-sol", thinking: "high" };
const unexpiredPermit = () => Date.now() + 60_000;
const WORKFLOW_MARKER_SPOOF = "/* PI_WEBUI_SUBAGENT_LAUNCH_SLOTS_V1 */";

function workflowRuntime() {
  const calls = [];
  const runs = Object.freeze({
    async run(key, params) { calls.push({ method: "run", key, ...params }); return { key, ok: true }; },
    async all(items) { calls.push({ method: "all", items }); return items.map(({ key }) => ({ key, ok: true })); },
    async status() { return {}; },
    ref() { return ""; },
    refs() { return ""; },
  });
  return { calls, runs };
}

function validatingWorkflowRuntime() {
  const calls = [];
  const runs = Object.freeze({
    run(key, params) {
      if (key === "invalid") throw new Error("invalid run key");
      calls.push({ method: "run", key, ...params });
      return Promise.resolve({ key, ok: true });
    },
    all(items) {
      if (items.some((item) => item?.key === "invalid")) throw new Error("invalid all key");
      calls.push({ method: "all", items });
      return Promise.resolve(items.map(({ key }) => ({ key, ok: true })));
    },
    async status() { return {}; },
    ref() { return ""; },
    refs() { return ""; },
  });
  return { calls, runs };
}

async function executeWorkflow(input, runs) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction("runs", input.workflowScript)(runs);
}

async function executeWorkflowInVm(input, runs) {
  const context = vm.createContext({ runs }, { codeGeneration: { strings: false, wasm: false } });
  const compiled = new vm.Script(`(async () => {\n${input.workflowScript}\n})()`, { filename: "workflow-policy-test.js" });
  return compiled.runInContext(context);
}

{
  const input = { agent: "delegate", task: "Handle a bounded task" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(input.model, "openai-codex/gpt-5.6-luna:low", "a structured single launch should receive its role preset");
  assert.deepEqual(report.applied.map(({ role, occurrence, location }) => [role, occurrence, location]), [["delegate", 1, "agent"]]);
  assert.deepEqual(report.blocked, []);
}

{
  const input = { agent: "reviewer", task: "Use the configured model", model: "openai-codex/gpt-5.6-sol:high" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(input.model, "openai-codex/gpt-5.6-sol:high", "an exact explicit reviewer model should remain unchanged");
  assert.deepEqual(report.blocked, []);
}

{
  const input = { agent: "reviewer", task: "Use the requested model", model: "anthropic/claude-opus-4-8:high" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(input.model, "anthropic/claude-opus-4-8:high", "an explicit reviewer mismatch must not be silently overwritten");
  assert.deepEqual(report.blocked, [{
    code: "reviewer-model-mismatch",
    role: "reviewer",
    occurrence: 1,
    location: "agent",
    slotId: "reviewer:base",
    expectedModel: "openai-codex/gpt-5.6-sol:high",
    requestedModel: "anthropic/claude-opus-4-8:high",
    correctionModel: "openai-codex/gpt-5.6-sol:high",
  }]);
}

{
  const input = { agent: "reviewer", task: "Use lower thinking", model: "openai-codex/gpt-5.6-sol:low" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(report.blocked[0]?.code, "reviewer-thinking-mismatch", "a recognized terminal thinking suffix should be compared separately");
  assert.equal(report.blocked[0]?.expectedModel, "openai-codex/gpt-5.6-sol:high");
  assert.equal(report.blocked[0]?.requestedModel, "openai-codex/gpt-5.6-sol:low");
}

{
  const input = { agent: "reviewer", task: "Use an approved deviation", model: "anthropic/claude-opus-4-8:high" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles, {
    deviations: [
      { id: "wrong-slot", role: "reviewer", occurrence: 2, requestedModel: input.model, expiresAt: unexpiredPermit() },
      { id: "permit-1", role: "reviewer", occurrence: 1, requestedModel: input.model, expiresAt: unexpiredPermit() },
    ],
  });
  assert.deepEqual(report.blocked, []);
  assert.deepEqual(report.consumedDeviationIds, ["permit-1"], "only the matching occurrence/model deviation should be consumed");
}

{
  const input = { agent: "reviewer", task: "Do not accept an unbounded descriptor", model: "other/model:high" };
  const deviations = Array.from({ length: 9 }, (_, index) => ({
    id: `permit-${index + 1}`,
    role: "reviewer",
    occurrence: index === 8 ? 1 : 2,
    requestedModel: input.model,
    expiresAt: unexpiredPermit(),
  }));
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles, { deviations });
  assert.equal(report.blocked[0]?.code, "reviewer-model-mismatch", "deviation matching must ignore descriptors beyond the eight-item bound");
  assert.deepEqual(report.consumedDeviationIds, []);
}

{
  const input = {
    tasks: [
      { agent: "reviewer", task: "Review correctness", model: "openai-codex/gpt-5.6-sol:high" },
      { agent: "worker", task: "Implement the fix", model: "custom/worker-model:low" },
      { agent: "reviewer", task: "Review tests", model: "openai-codex/gpt-5.6-sol:high" },
    ],
  };
  const report = applySubagentLaunchSlotDefaults("subagent_gate", input, roles);
  assert.equal(report.blocked.length, 1);
  assert.deepEqual(
    { code: report.blocked[0].code, occurrence: report.blocked[0].occurrence, location: report.blocked[0].location },
    { code: "reviewer-model-mismatch", occurrence: 2, location: "tasks[2]" },
    "reviewer occurrences should be enforced in task order independently of other roles",
  );
  assert.equal(input.tasks[1].model, "custom/worker-model:low", "non-reviewer explicit models must remain unchanged and unenforced");
}

{
  const input = {
    tasks: [
      { agent: "reviewer", task: "Review correctness" },
      { agent: "worker", task: "Implement the fix" },
      { agent: "reviewer", task: "Review tests" },
    ],
  };
  const report = applySubagentLaunchSlotDefaults("subagent_gate", input, roles);
  assert.deepEqual(input.tasks.map((task) => task.model), [
    "openai-codex/gpt-5.6-sol:high",
    "openai-codex/gpt-5.6-sol:high",
    "openrouter/moonshotai/kimi-k3:high",
  ], "omitted models should still consume their configured role slots in task order");
  assert.equal(report.applied.length, 3);
  assert.deepEqual(report.blocked, []);
}

{
  const input = { tasks: [{ agent: "reviewer", task: "A", count: 2 }] };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(input.tasks[0].model, undefined, "one counted task must not collapse heterogeneous reviewer slots into one model");
  assert.equal(report.unsupported[0]?.reason, "count-needs-explicit-tasks");
}

{
  const input = {
    workflowScript: "const first = await runs.run('review-1', {agent:'reviewer', task:'Review one'}); return runs.all([{key:'work', agent:'worker', task:'Implement'}, {key:'review-2', agent:'reviewer', task:'Review two'}])",
  };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.match(input.workflowScript, /PI_WEBUI_SUBAGENT_LAUNCH_SLOTS_V1/, "workflow source should receive one runtime wrapper instead of heuristic call-site edits");
  assert.equal(report.applied[0]?.reason, "runtime-role-defaults");
  const runtime = workflowRuntime();
  await executeWorkflow(input, runtime.runs);
  assert.deepEqual(runtime.calls[0], {
    method: "run",
    key: "review-1",
    agent: "reviewer",
    task: "Review one",
    model: "openai-codex/gpt-5.6-sol:high",
  });
  assert.deepEqual(runtime.calls[1].items.map(({ agent, model }) => [agent, model]), [
    ["worker", "openai-codex/gpt-5.6-sol:high"],
    ["reviewer", "openrouter/moonshotai/kimi-k3:high"],
  ], "workflow runs should fill omitted models in actual launch order");
  const wrappedOnce = input.workflowScript;
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(input.workflowScript, wrappedOnce, "the workflow wrapper should be idempotent");
}

{
  const input = {
    workflowScript: "return runs.run('review-1', {agent:'reviewer', task:'Review one', model:'other/model:high'})",
  };
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  const runtime = workflowRuntime();
  await assert.rejects(
    executeWorkflow(input, runtime.runs),
    (error) => {
      assert.equal(error.code, "reviewer-model-policy-blocked");
      assert.deepEqual(error.decisions.map(({ code, occurrence, location }) => ({ code, occurrence, location })), [
        { code: "reviewer-model-mismatch", occurrence: 1, location: "runs.run" },
      ]);
      return true;
    },
  );
  assert.deepEqual(runtime.calls, [], "a blocked runs.run must not reach the original runtime");
}

{
  const input = {
    workflowScript: "return runs.all([{key:'review-1', agent:'reviewer', task:'One', model:'other/one:high'}, {key:'review-2', agent:'reviewer', task:'Two', model:'other/two:high'}])",
  };
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  const runtime = workflowRuntime();
  await assert.rejects(
    executeWorkflow(input, runtime.runs),
    (error) => {
      assert.equal(error.code, "reviewer-model-policy-blocked");
      assert.deepEqual(error.decisions.map(({ occurrence, location }) => ({ occurrence, location })), [
        { occurrence: 1, location: "runs.all[0]" },
        { occurrence: 2, location: "runs.all[1]" },
      ], "runs.all should preflight every item before reporting its bounded decisions");
      return true;
    },
  );
  assert.deepEqual(runtime.calls, [], "a runs.all mismatch must be detected before the original runs.all receives children");
}

{
  const input = {
    workflowScript: "return runs.all([{key:'review-1', agent:'reviewer', task:'One', model:'other/one:high'}, {key:'review-2', agent:'reviewer', task:'Two', model:'openrouter/moonshotai/kimi-k3:high'}])",
  };
  applySubagentLaunchSlotDefaults("subagent", input, roles, {
    deviations: [{ id: "workflow-permit", role: "reviewer", occurrence: 1, requestedModel: "other/one:high", expiresAt: unexpiredPermit() }],
  });
  const runtime = workflowRuntime();
  await executeWorkflow(input, runtime.runs);
  assert.equal(runtime.calls.length, 1, "a matching workflow deviation should admit the atomic run group");
  assert.equal(runtime.calls[0].method, "all");
}

{
  for (const method of ["run", "all"]) {
    const call = method === "run"
      ? "return runs.run('review', {agent:'reviewer', task:'Review', model:'other/model:high'})"
      : "return runs.all([{key:'review', agent:'reviewer', task:'Review', model:'other/model:high'}])";
    const input = { workflowScript: `${WORKFLOW_MARKER_SPOOF}\n${call}` };
    applySubagentLaunchSlotDefaults("subagent", input, roles);
    const runtime = workflowRuntime();
    await assert.rejects(executeWorkflow(input, runtime.runs), (error) => error.code === "reviewer-model-policy-blocked");
    assert.deepEqual(runtime.calls, [], `a model-supplied wrapper marker must not bypass runs.${method}`);
  }
}

{
  const input = { workflowScript: "return runs.run('review', {agent:'reviewer', task:'VM execution'})" };
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  const runtime = workflowRuntime();
  await executeWorkflowInVm(input, runtime.runs);
  assert.equal(runtime.calls[0]?.model, "openai-codex/gpt-5.6-sol:high", "the wrapper must execute in the real workflow runtime's string-code-generation-disabled VM shape");
}

{
  const privateNames = [
    "__piWebuiUserWorkflow",
    "__piWebuiRoleSlots",
    "__piWebuiDeviations",
    "__piWebuiThinkingPattern",
    "__piWebuiNow",
    "__piWebuiRoleOccurrences",
    "__piWebuiConsumedDeviationIndexes",
    "__piWebuiOriginalRuns",
    "__piWebuiParseModel",
    "__piWebuiPrepare",
    "__piWebuiThrowBlocked",
    "__piWebuiRuns",
  ];
  const input = { workflowScript: `return [${privateNames.map((name) => `typeof ${name}`).join(",")}];` };
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  const runtime = workflowRuntime();
  assert.deepEqual(await executeWorkflow(input, runtime.runs), privateNames.map(() => "undefined"), "supplied workflow code must not close over wrapper-private state");

  const bypass = { workflowScript: "return __piWebuiOriginalRuns.run('review', {agent:'reviewer', task:'Bypass', model:'other/model:high'})" };
  applySubagentLaunchSlotDefaults("subagent", bypass, roles);
  await assert.rejects(executeWorkflow(bypass, runtime.runs), /__piWebuiOriginalRuns is not defined/);
  assert.deepEqual(runtime.calls, [], "supplied workflow code must not reach the original runs object by generated identifier");
}

{
  for (const method of ["run", "all"]) {
    const leakKey = `__piWebuiPolicyPoisonLeaks_${method}`;
    const call = method === "run"
      ? "return await runs.run('review', {agent:'reviewer', task:'Review', model:'other/model:high'});"
      : "return await runs.all([{key:'review', agent:'reviewer', task:'Review', model:'other/model:high'}]);";
    const input = {
      workflowScript: `
        const leaks = [];
        globalThis[${JSON.stringify(leakKey)}] = leaks;
        const originalArrayIsArray = Array.isArray;
        const originalFindIndex = Array.prototype.findIndex;
        const originalSetHas = Set.prototype.has;
        const originalSetAdd = Set.prototype.add;
        const originalObjectAssign = Object.assign;
        Array.isArray = function (value) { leaks[leaks.length] = value; return originalArrayIsArray(value); };
        Array.prototype.findIndex = function () { leaks[leaks.length] = this; return 0; };
        Set.prototype.has = function () { leaks[leaks.length] = this; return false; };
        Set.prototype.add = function () { leaks[leaks.length] = this; return this; };
        Object.assign = function (target) { leaks[leaks.length] = target; return target; };
        try {
          ${call}
        } finally {
          Array.isArray = originalArrayIsArray;
          Array.prototype.findIndex = originalFindIndex;
          Set.prototype.has = originalSetHas;
          Set.prototype.add = originalSetAdd;
          Object.assign = originalObjectAssign;
        }
      `,
    };
    applySubagentLaunchSlotDefaults("subagent", input, roles);
    const runtime = workflowRuntime();
    await assert.rejects(executeWorkflow(input, runtime.runs), (error) => error.code === "reviewer-model-policy-blocked");
    assert.deepEqual(runtime.calls, [], `runs.${method} must still block a no-permit mismatch after mutable intrinsic poisoning`);
    assert.deepEqual(globalThis[leakKey], [], `runs.${method} policy must not expose private state through poisoned intrinsics`);
    delete globalThis[leakKey];
  }
}

{
  for (const method of ["run", "all"]) {
    const call = method === "run"
      ? "return await runs.run('review', {agent:'reviewer', task:'Review', model:'other/model:high'});"
      : "return await runs.all([{key:'review', agent:'reviewer', task:'Review', model:'other/model:high'}]);";
    const input = {
      workflowScript: `
        const previous = Object.getOwnPropertyDescriptor(Array.prototype, '0');
        Object.defineProperty(Array.prototype, '0', {
          configurable: true,
          set() { throw new Error('private indexed assignment reached poisoned prototype'); },
        });
        try {
          ${call}
        } finally {
          if (previous) Object.defineProperty(Array.prototype, '0', previous);
          else delete Array.prototype[0];
        }
      `,
    };
    applySubagentLaunchSlotDefaults("subagent", input, roles);
    const runtime = workflowRuntime();
    await assert.rejects(
      executeWorkflow(input, runtime.runs),
      (error) => error.code === "reviewer-model-policy-blocked",
      `runs.${method} must define private array entries as own properties despite numeric prototype setters`,
    );
    assert.deepEqual(runtime.calls, [], `runs.${method} must not admit a mismatch through an inherited numeric setter`);
  }
}

{
  const input = {
    workflowScript: `
      let leakedSlots;
      const previous = Object.getOwnPropertyDescriptor(Array.prototype, '2');
      Object.defineProperty(Array.prototype, '2', {
        configurable: true,
        get() { leakedSlots = this; return undefined; },
      });
      try {
        try {
          await runs.all([
            {key:'blocked', agent:'reviewer', task:'Block', model:'other/model:high'},
            {key:'second', agent:'reviewer', task:'Second'},
            {key:'overflow', agent:'reviewer', task:'Overflow'},
          ]);
        } catch (error) {
          if (error.code !== 'reviewer-model-policy-blocked') throw error;
        }
      } finally {
        if (previous) Object.defineProperty(Array.prototype, '2', previous);
        else delete Array.prototype[2];
      }
      if (leakedSlots) {
        leakedSlots[0].model = 'other/model:high';
        return runs.run('bypass', {agent:'reviewer', task:'Bypass', model:'other/model:high'});
      }
      return 'protected';
    `,
  };
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  const runtime = workflowRuntime();
  assert.equal(await executeWorkflow(input, runtime.runs), "protected", "slot overflow must not consult inherited numeric getters on private slot arrays");
  assert.deepEqual(runtime.calls, [], "an inherited slot getter must not leak mutable slot policy or admit a retry");
}

{
  const poison = { workflowScript: "Set.prototype.has = () => false; WeakSet.prototype.has = () => true; return 'isolated';" };
  applySubagentLaunchSlotDefaults("subagent", poison, roles);
  assert.equal(await executeWorkflowInVm(poison, workflowRuntime().runs), "isolated");

  const direct = { agent: "reviewer", task: "Host policy remains pristine", model: "other/model:high" };
  const directReport = applySubagentLaunchSlotDefaults("subagent", direct, roles);
  assert.equal(directReport.blocked[0]?.code, "reviewer-model-mismatch", "workflow VM prototype poisoning must not affect later host-side policy calls");

  const nextWorkflow = { workflowScript: "return runs.run('review', {agent:'reviewer', task:'Next VM', model:'other/model:high'})" };
  applySubagentLaunchSlotDefaults("subagent", nextWorkflow, roles);
  const runtime = workflowRuntime();
  await assert.rejects(executeWorkflowInVm(nextWorkflow, runtime.runs), (error) => error.code === "reviewer-model-policy-blocked");
  assert.deepEqual(runtime.calls, [], "each top-level workflow VM must start with independent intrinsics");
}

{
  const readsKey = "__piWebuiRunSnapshotReads";
  const expectedModel = "openai-codex/gpt-5.6-sol:high";
  const input = {
    workflowScript: `
      const reads = { agent: 0, model: 0 };
      const target = { task: 'Stateful proxy review' };
      const params = new Proxy(target, {
        ownKeys() { return ['agent', 'task', 'model']; },
        getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
        get(source, property) {
          if (property === 'agent') return ++reads.agent <= 2 ? 'reviewer' : 'worker';
          if (property === 'model') return ++reads.model <= 3 ? ${JSON.stringify(expectedModel)} : 'other/model:high';
          return source[property];
        },
      });
      const result = await runs.run('review', params);
      globalThis[${JSON.stringify(readsKey)}] = reads;
      return result;
    `,
  };
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  const received = [];
  const runtimeRuns = Object.freeze({
    run(key, params) { received.push({ key, params }); return Promise.resolve({ key, ok: true }); },
    all() { throw new Error("unexpected runs.all"); },
    async status() { return {}; },
    ref() { return ""; },
    refs() { return ""; },
  });
  await executeWorkflow(input, runtimeRuns);
  assert.deepEqual(globalThis[readsKey], { agent: 1, model: 1 }, "runs.run should read stateful policy fields only while creating its snapshot");
  assert.equal(received[0]?.params.agent, "reviewer");
  assert.equal(received[0]?.params.model, expectedModel, "runs.run must forward the same model snapshot that policy admitted");
  assert.equal(Object.getOwnPropertyDescriptor(received[0]?.params, "model")?.get, undefined, "the forwarded runs.run snapshot must not retain a user getter");
  delete globalThis[readsKey];
}

{
  const readsKey = "__piWebuiAllSnapshotReads";
  const expectedModel = "openai-codex/gpt-5.6-sol:high";
  const input = {
    workflowScript: `
      const reads = { agent: 0, model: 0 };
      const item = {
        key: 'review',
        task: 'Stateful getter review',
        get agent() { reads.agent += 1; return reads.agent === 1 ? 'reviewer' : 'worker'; },
        get model() { reads.model += 1; return reads.model === 1 ? ${JSON.stringify(expectedModel)} : 'other/model:high'; },
      };
      const result = await runs.all([item]);
      globalThis[${JSON.stringify(readsKey)}] = reads;
      return result;
    `,
  };
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  const received = [];
  const runtimeRuns = Object.freeze({
    run() { throw new Error("unexpected runs.run"); },
    all(items) { received.push(items); return Promise.resolve(items.map(({ key }) => ({ key, ok: true }))); },
    async status() { return {}; },
    ref() { return ""; },
    refs() { return ""; },
  });
  await executeWorkflow(input, runtimeRuns);
  const receivedItem = received[0]?.[0];
  assert.deepEqual(globalThis[readsKey], { agent: 1, model: 1 }, "runs.all should snapshot each stateful item before policy evaluation");
  assert.equal(receivedItem?.agent, "reviewer");
  assert.equal(receivedItem?.model, expectedModel, "runs.all must forward the same item snapshot that policy admitted");
  assert.equal(Object.getOwnPropertyDescriptor(receivedItem, "model")?.get, undefined, "the forwarded runs.all snapshot must not retain a user getter");
  delete globalThis[readsKey];
}

{
  const expiresAt = Date.now() + 1_000;
  const input = { workflowScript: "return runs.run('review', {agent:'reviewer', task:'Delayed review', model:'other/model:high'})" };
  applySubagentLaunchSlotDefaults("subagent", input, roles, {
    deviations: [{ id: "expiring-workflow-permit", role: "reviewer", occurrence: 1, requestedModel: "other/model:high", expiresAt }],
  });
  const runtime = workflowRuntime();
  const realDateNow = Date.now;
  Date.now = () => expiresAt + 1;
  try {
    await assert.rejects(executeWorkflow(input, runtime.runs), (error) => error.code === "reviewer-model-policy-blocked");
  } finally {
    Date.now = realDateNow;
  }
  assert.deepEqual(runtime.calls, [], "a leased permit that expires before use must not admit a delayed workflow child");
}

{
  for (const method of ["run", "all"]) {
    const call = method === "run"
      ? "try { runs.run('invalid', params); } catch {} return runs.run('valid', params);"
      : "try { runs.all([{key:'invalid', ...params}]); } catch {} return runs.all([{key:'valid', ...params}]);";
    const input = {
      workflowScript: `const params = {agent:'reviewer', task:'Retry after validation', model:'other/model:high'}; ${call}`,
    };
    applySubagentLaunchSlotDefaults("subagent", input, roles, {
      deviations: [{ id: `retry-${method}`, role: "reviewer", occurrence: 1, requestedModel: "other/model:high", expiresAt: unexpiredPermit() }],
    });
    const runtime = validatingWorkflowRuntime();
    await executeWorkflow(input, runtime.runs);
    assert.equal(runtime.calls.length, 1, `runs.${method} should retry after synchronous validation rejects the first call`);
    const admitted = method === "run" ? runtime.calls[0] : runtime.calls[0].items[0];
    assert.equal(admitted.model, "other/model:high", `runs.${method} should not spend occurrence or permit state on synchronous validation failure`);
  }
}

{
  const input = { action: "status", id: "run-1" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.deepEqual(report, {
    applied: [],
    unsupported: [],
    blocked: [],
    consumedDeviationIds: [],
  }, "management calls must not receive launch defaults or policy decisions");
}

console.log("subagent-launch-policy.test.mjs passed");
