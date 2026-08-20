import assert from "node:assert/strict";
import { applySubagentLaunchSlotDefaults } from "../lib/subagent-launch-policy.mjs";
import { defaultSubagentLaunchSlotRoles } from "../lib/subagent-launch-slots.mjs";

const roles = defaultSubagentLaunchSlotRoles();
roles.delegate[0] = { id: "delegate:base", model: "openai-codex/gpt-5.6-luna", thinking: "low" };
roles.reviewer[0] = { id: "reviewer:base", model: "openai-codex/gpt-5.6-sol", thinking: "high" };
roles.reviewer.push({ id: "reviewer:second", model: "openrouter/moonshotai/kimi-k3", thinking: "high" });
roles.worker[0] = { id: "worker:base", model: "openai-codex/gpt-5.6-sol", thinking: "high" };

{
  const input = { agent: "delegate", task: "Handle a bounded task" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(input.model, "openai-codex/gpt-5.6-luna:low", "a structured single launch should receive its role preset");
  assert.deepEqual(report.applied.map(({ role, occurrence, location }) => [role, occurrence, location]), [["delegate", 1, "agent"]]);
}

{
  const input = { agent: "reviewer", task: "Use the requested model", model: "anthropic/claude-opus-4-8:high" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(input.model, "anthropic/claude-opus-4-8:high", "an explicit launch model must remain authoritative");
  assert.deepEqual(report.applied, []);
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
  ], "same-role occurrences should consume their configured slots in task order while other roles use their own slot sequence");
  assert.equal(report.applied.length, 3);
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
  const calls = [];
  const runtimeRuns = Object.freeze({
    async run(key, params) { calls.push({ key, ...params }); return { key, ok: true }; },
    async all(items) { calls.push(...items); return items.map(({ key }) => ({ key, ok: true })); },
    async status() { return {}; },
    ref() { return ""; },
    refs() { return ""; },
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("runs", input.workflowScript)(runtimeRuns);
  assert.deepEqual(calls.map(({ agent, model }) => [agent, model]), [
    ["reviewer", "openai-codex/gpt-5.6-sol:high"],
    ["worker", "openai-codex/gpt-5.6-sol:high"],
    ["reviewer", "openrouter/moonshotai/kimi-k3:high"],
  ], "workflow runs should consume independent role slots in actual launch order");
  const wrappedOnce = input.workflowScript;
  applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.equal(input.workflowScript, wrappedOnce, "the workflow wrapper should be idempotent");
}

{
  const input = { action: "status", id: "run-1" };
  const report = applySubagentLaunchSlotDefaults("subagent", input, roles);
  assert.deepEqual(report, { applied: [], unsupported: [] }, "management calls must not receive launch defaults");
}

console.log("subagent-launch-policy.test.mjs passed");
