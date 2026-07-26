import assert from "node:assert/strict";
import {
  WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS,
  WORKFLOW_SUBAGENTS_EVENT,
  buildWorkflowSubagentsSnapshot,
  publishWorkflowSubagentsSnapshot,
} from "../src/webui-subagents.ts";

const now = "2026-07-26T12:00:00.000Z";

function task(overrides = {}) {
  return {
    taskId: "inspect",
    name: "Inspect workflow state",
    label: "inspector",
    callIndex: 1,
    status: "running",
    options: { model: "openai/gpt-5" },
    recentEvents: [
      {
        type: "start",
        timestamp: now,
        phaseId: "audit",
        phaseName: "Audit",
        taskId: "inspect",
        taskName: "Inspect workflow state",
        command: "pi -p super-secret-workflow-prompt",
        cwd: "/private/worktree",
      },
      {
        type: "stdout",
        timestamp: now,
        phaseId: "audit",
        phaseName: "Audit",
        taskId: "inspect",
        taskName: "Inspect workflow state",
        line: "authoritative live output",
      },
    ],
    output: "super-secret-final-result",
    result: { secret: "super-secret-final-result" },
    error: "super-secret-error",
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    runId: "workflow-run-a",
    workflowKey: "workflow-key",
    workflowName: "Workflow A",
    sourcePath: "/private/workflow.js",
    status: "running",
    input: { secret: "super-secret-workflow-prompt" },
    startedAt: now,
    updatedAt: now,
    phases: [{ phaseId: "audit", name: "Audit", status: "running", tasks: [task()] }],
    ...overrides,
  };
}

const active = run();
const terminal = run({ runId: "workflow-run-terminal", status: "completed" });
const manager = { active: () => [terminal, active] };
const snapshot = buildWorkflowSubagentsSnapshot(manager, new Date(now));

assert.equal(snapshot.version, 1);
assert.equal(snapshot.updatedAt, now);
assert.equal(snapshot.runs.length, 1, "terminal workflow runs must be removed from the complete snapshot");
const [publishedRun] = snapshot.runs;
assert.equal(publishedRun.id, "workflow:workflow-run-a");
assert.equal(publishedRun.source, "workflow");
assert.equal(publishedRun.name, "Workflow A");
assert.equal(publishedRun.agents.length, 1);
const [agent] = publishedRun.agents;
assert.match(agent.id, /^workflow:workflow-run-a:phase:audit:call:call-/);
assert.equal(agent.name, "inspector");
assert.equal(agent.model, "openai/gpt-5");
assert.equal(agent.activityState, "stdout");
assert.deepEqual(agent.recentOutput, ["authoritative live output"]);
assert.equal(Object.hasOwn(agent, "thinking"), false, "thinking must be omitted because workflow state has no authoritative thinking value");

const serialized = JSON.stringify(snapshot);
for (const secret of ["super-secret-workflow-prompt", "super-secret-final-result", "super-secret-error", "/private/worktree", "/private/workflow.js"]) {
  assert.equal(serialized.includes(secret), false, `snapshot must not publish ${secret}`);
}

const modelUnknown = buildWorkflowSubagentsSnapshot({
  active: () => [run({ phases: [{ phaseId: "audit", name: "Audit", status: "running", tasks: [task({ options: {}, recentEvents: [] })] }] })],
}, new Date(now));
assert.equal(Object.hasOwn(modelUnknown.runs[0].agents[0], "model"), false, "model must be omitted when live state did not record one");
assert.equal(Object.hasOwn(modelUnknown.runs[0].agents[0], "recentOutput"), false, "recent output must be omitted when no live event supplied it");

const longIdentitySnapshot = buildWorkflowSubagentsSnapshot({
  active: () => [run({
    runId: `run-${"r".repeat(400)}`,
    phases: [{ phaseId: `phase-${"p".repeat(400)}`, name: "Long phase", status: "running", tasks: [task()] }],
  })],
}, new Date(now));
assert.ok(Buffer.byteLength(longIdentitySnapshot.runs[0].id, "utf8") <= WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.runIdentifierBytes, "public workflow run IDs must fit the server overview bound");
assert.ok(Buffer.byteLength(longIdentitySnapshot.runs[0].agents[0].id, "utf8") <= WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.agentIdentifierBytes, "public workflow agent IDs must fit the selected-output bound");

const longLine = "x".repeat(WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.recentOutputLineBytes * 2);
const boundedRuns = Array.from({ length: WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.runs + 2 }, (_unused, runIndex) => run({
  runId: `workflow-run-${String(runIndex).padStart(2, "0")}`,
  startedAt: `2026-07-26T12:00:${String(runIndex).padStart(2, "0")}.000Z`,
  phases: [{
    phaseId: "audit",
    name: "Audit",
    status: "running",
    tasks: Array.from({ length: WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.agentsPerRun + 2 }, (_unused, taskIndex) => task({
      taskId: `task-${taskIndex}`,
      callIndex: taskIndex + 1,
      recentEvents: [{ type: "stdout", timestamp: now, phaseId: "audit", phaseName: "Audit", taskId: `task-${taskIndex}`, taskName: "Inspect", line: longLine }],
    })),
  }],
}));
const bounded = buildWorkflowSubagentsSnapshot({ active: () => boundedRuns }, new Date(now));
assert.equal(bounded.runs.length, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.runs, "active run snapshots must be bounded");
assert.equal(bounded.runs[0].agents.length, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.agentsPerRun, "agent snapshots must be bounded per run");
assert.ok(bounded.runs[0].agents.every((entry) => Buffer.byteLength(entry.recentOutput[0], "utf8") <= WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.recentOutputLineBytes));

const emitted = [];
const published = publishWorkflowSubagentsSnapshot({ active: () => [active] }, (event, payload) => emitted.push({ event, payload }));
assert.equal(emitted.length, 1);
assert.equal(emitted[0].event, WORKFLOW_SUBAGENTS_EVENT);
assert.deepEqual(emitted[0].payload, published);

const empty = buildWorkflowSubagentsSnapshot({ active: () => [] }, new Date(now));
assert.deepEqual(empty.runs, [], "an empty complete snapshot must explicitly clear workflow rows");

console.log("webui subagents tests passed");
