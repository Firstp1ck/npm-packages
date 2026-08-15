import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css, readme, technical] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "README.md"), "utf8"),
  readFile(join(root, "TECHNICAL.md"), "utf8"),
]);

function appFunctionSource(name, nextName) {
  const start = app.indexOf(`function ${name}(`);
  const nextStarts = [
    app.indexOf(`\nfunction ${nextName}(`, start),
    app.indexOf(`\nasync function ${nextName}(`, start),
  ].filter((index) => index > start);
  const end = nextStarts.length ? Math.min(...nextStarts) : -1;
  assert.ok(start >= 0 && end > start, `${name} should remain a standalone frontend helper`);
  return app.slice(start, end);
}

const workflowControllerSource = appFunctionSource("subagentIsWorkflowController", "subagentCapabilities");
const workflowRenderSource = appFunctionSource("renderSubagentWorkflow", "renderSubagentAgent");
const renderRunSource = appFunctionSource("renderSubagentRun", "subagentGateStatusLabel");
const renderOverviewSource = appFunctionSource("renderSubagents", "refreshSubagents");
const retainedMaterializationSource = appFunctionSource("materializeRetainedSubagentTerminalViews", "subagentTerminalViewGroups");

assert.match(workflowControllerSource, /launcher === "pi-subagents"[\s\S]*function subagentRunAgents[\s\S]*function subagentRunAgentCounts/, "pi-subagents workflow controllers should be separated from model-powered child agents");
const workflowCountContext = {
  subagentAgentStatus(run, agent) { return String(agent?.status || run?.status || "running").toLowerCase(); },
};
vm.runInNewContext(`${workflowControllerSource}\nthis.isWorkflowController = subagentIsWorkflowController; this.workflowAgents = subagentRunAgents; this.workflowCounts = subagentRunAgentCounts; this.runPresentations = subagentRunPresentations; this.workflowStatus = subagentWorkflowPresentationStatus;`, workflowCountContext);
const syntheticWorkflowRun = {
  launcher: "pi-subagents",
  status: "running",
  agents: [
    { id: "run:workflow", name: "workflow", status: "running" },
    { id: "run:worker", name: "worker", status: "running", model: "openai-codex/gpt-5.6-sol", thinking: "high" },
  ],
};
assert.equal(workflowCountContext.isWorkflowController(syntheticWorkflowRun, syntheticWorkflowRun.agents[0]), true);
assert.deepEqual(JSON.parse(JSON.stringify(workflowCountContext.workflowAgents(syntheticWorkflowRun).map((agent) => agent.name))), ["worker"]);
assert.deepEqual(JSON.parse(JSON.stringify(workflowCountContext.workflowCounts([syntheticWorkflowRun]))), { total: 1, running: 1, stale: 0 });
assert.equal(workflowCountContext.isWorkflowController(syntheticWorkflowRun, { name: "workflow", launcher: "pi-subagents", model: "provider/real-model", thinking: "high" }), false, "a real model-powered agent named workflow must remain an agent row");

const recoveredWorkflowRuns = [
  { id: "fleet:23", source: "recovered", launcher: "pi-subagents", status: "done", agents: [{ id: "fleet:23:agent", name: "workflow", status: "done" }] },
  { id: "fleet:24", source: "recovered", launcher: "pi-subagents", status: "running", agents: [{ id: "fleet:24:agent", name: "worker", status: "running", model: "openai-codex/gpt-5.6-sol", thinking: "high" }] },
];
const recoveredPresentations = workflowCountContext.runPresentations(recoveredWorkflowRuns);
assert.equal(recoveredPresentations.length, 1, "adjacent recovered workflow controller and worker runs should form one presentation section");
assert.equal(recoveredPresentations[0].agents[0].run.id, "fleet:24", "nested recovered workers should retain their original run for output selection");
assert.equal(workflowCountContext.workflowStatus(recoveredPresentations[0].run, recoveredPresentations[0].agents), "running", "a running recovered worker should keep its workflow section running");

assert.match(workflowRenderSource, /const status = subagentWorkflowPresentationStatus\(run, agents\);[\s\S]*make\("details", `subagent-workflow[\s\S]*details\.open = !collapsedSubagentWorkflowRunKeys\.has\(key\)[\s\S]*make\("summary", "subagent-workflow-header"\)[\s\S]*renderSubagentAgent\(tab, entry\.run, entry\.agent\)/, "workflow controllers should render as native disclosures using the aggregate presentation lifecycle while preserving each child run");
assert.match(renderRunSource, /subagentWorkflowController\(run\)[\s\S]*subagentRunAgents\(run\)[\s\S]*renderSubagentWorkflow\(tab, run, controller, presentedAgents\)/, "workflow runs should route through the hierarchical renderer");
assert.match(renderOverviewSource, /activeTabs\.reduce\(\(count, tab\) => count \+ Number\(tab\.agentCount \|\| 0\), 0\)[\s\S]*activeTabs\.reduce\(\(count, tab\) => count \+ Number\(tab\.runningAgents \|\| 0\), 0\)/, "overview totals should use count-neutral workflow projections");
assert.match(retainedMaterializationSource, /for \(const agent of subagentRunAgents\(run\)\)/, "retained terminal views should materialize child agents without creating a view for the workflow controller");
assert.match(css, /\.subagent-workflow \{[\s\S]*\.subagent-workflow-header \{[\s\S]*list-style: none;[\s\S]*\.subagent-workflow:not\(\[open\]\)[\s\S]*\.subagent-workflow-agents \{[\s\S]*border-left:/, "workflow disclosures should have a distinct header and nested child-agent rail");
assert.match(readme, /workflow[^\n]*collapsible/i, "the user guide should explain collapsible workflow groups");
assert.match(technical, /workflow controller[^\n]*count/i, "the technical reference should explain count-neutral workflow controllers");

console.log("subagent workflow section static tests passed");
