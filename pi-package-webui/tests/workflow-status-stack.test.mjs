import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  groupConsecutiveWorkflowStatusItems,
  isCompletedWorkflowStatusExecution,
  workflowStatusSnapshot,
} from "../public/workflow-status-stack.mjs";

function statusItem(id, status = "running", patch = {}) {
  return {
    messageIndex: Number(id.replace(/\D/g, "")) || 0,
    order: Number(id.replace(/\D/g, "")) || 0,
    message: {
      role: "toolExecution",
      toolName: "workflow_status",
      toolCallId: id,
      timestamp: `2026-07-26T19:00:0${id.at(-1)}Z`,
      arguments: {},
      result: { content: [{ type: "text", text: `Workflow: release\nRun: run-1\nStatus: ${status}\nTasks: 1/3 completed` }] },
      ...patch,
    },
  };
}

assert.equal(isCompletedWorkflowStatusExecution(statusItem("call-1").message), true, "completed workflow_status executions should be eligible");
assert.equal(isCompletedWorkflowStatusExecution(statusItem("call-1", "running", { isPartial: true }).message), false, "partial workflow_status executions should remain standalone");
assert.equal(isCompletedWorkflowStatusExecution(statusItem("call-1", "completed", { live: true }).message), false, "live workflow_status executions should remain standalone until persisted");
assert.equal(isCompletedWorkflowStatusExecution({ ...statusItem("call-1").message, toolName: "workflow_run" }), false, "other workflow tools should remain standalone");

const one = groupConsecutiveWorkflowStatusItems([statusItem("call-1")]);
assert.equal(one.length, 1, "a single status update should not gain stack chrome");
assert.equal(one[0].message.role, "toolExecution");

const stacked = groupConsecutiveWorkflowStatusItems([statusItem("call-1"), statusItem("call-2", "completed")]);
assert.equal(stacked.length, 1, "adjacent completed status updates should collapse into one transcript item");
assert.equal(stacked[0].message.role, "workflowStatusStack");
assert.equal(stacked[0].message.workflowStatusUpdates.length, 2);
assert.equal(stacked[0].message.workflowStatusUpdates[0].toolCallId, "call-1", "stack members should remain chronological");
assert.equal(stacked[0].message.workflowStatusUpdates.at(-1).toolCallId, "call-2", "the latest update should remain last");
assert.match(stacked[0].transcriptKey, /^workflow-status-stack:call-1$/, "the first tool call should provide a stable stack key");
const noIdStack = groupConsecutiveWorkflowStatusItems([
  { ...statusItem("call-1"), messageIndex: 0, message: { ...statusItem("call-1").message, toolCallId: "" } },
  { ...statusItem("call-2"), messageIndex: 1, message: { ...statusItem("call-2").message, toolCallId: "" } },
]);
assert.equal(noIdStack[0].transcriptKey, "workflow-status-stack:m:0", "zero-valued message indices should remain valid collision-resistant fallback keys");

const barrier = { messageIndex: 2, order: 2, message: { role: "user", content: "continue" } };
const separated = groupConsecutiveWorkflowStatusItems([statusItem("call-1"), barrier, statusItem("call-2")]);
assert.equal(separated.length, 3, "non-status transcript items should break a stack");
assert.deepEqual(separated.map((item) => item.message.role), ["toolExecution", "user", "toolExecution"]);

const withLiveBoundary = groupConsecutiveWorkflowStatusItems([
  statusItem("call-1"),
  statusItem("call-2", "running", { isPartial: true }),
  statusItem("call-3"),
]);
assert.equal(withLiveBoundary.length, 3, "a live status update should be a hard stack boundary");

const errored = groupConsecutiveWorkflowStatusItems([
  statusItem("call-1"),
  statusItem("call-2", "failed", { isError: true, result: { isError: true, content: [{ type: "text", text: "Status: failed" }] } }),
]);
assert.equal(errored[0].message.isError, true, "a member error should mark the aggregate stack");

assert.deepEqual(
  workflowStatusSnapshot("Workflow: release\nRun: run-1\nStatus: completed\nTasks: 3/3 completed"),
  { workflow: "release", run: "run-1", status: "completed", tasks: "3/3 completed", fallback: "Workflow: release" },
  "the latest workflow result should produce a concise structured snapshot",
);
assert.equal(workflowStatusSnapshot("No workflow run has been recorded in this session.").fallback, "No workflow run has been recorded in this session.");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
]);
assert.match(app, /function workflowStatusExecutionFromTranscriptItem\(item, toolResults\)[\s\S]*visibleMessages\.length !== 1[\s\S]*toolCall\.toolName !== "workflow_status"[\s\S]*toolResults instanceof Map[\s\S]*toolExecutionMessageFromCall/, "app integration should project only isolated, completed workflow_status calls using the prebuilt result map");
assert.match(app, /function groupWorkflowStatusTranscriptItems\(items, toolResults\)[\s\S]*compactOutputActive\(\)[\s\S]*groupConsecutiveWorkflowStatusItems\(projected\)/, "compact mode should remain unchanged and normal transcript items should group before reconciliation");
assert.match(app, /function toolExecutionMessageFromCall\([\s\S]*function appendTranscriptMessage[\s\S]*toolExecutionMessageFromCall\(displayMessage\)/, "normal and stacked transcript paths should share tool-call projection");
assert.match(app, /function renderWorkflowStatusStack\(parent, message\)[\s\S]*snapshotFields[\s\S]*make\("details", "workflow-status-stack-details"\)[\s\S]*make\("summary", "workflow-status-stack-summary"\)[\s\S]*aria-label[\s\S]*renderSingleToolExecution\(memberBody, update\)/, "the stack should use an accessible native disclosure and retain the normal renderer for every member");
assert.doesNotMatch(app.match(/function renderWorkflowStatusStack\(parent, message\)[\s\S]*?\n\}/)?.[0] || "", /aria-live/, "historical status stacks should not create repetitive live-region announcements");
assert.match(css, /\.workflow-status-stack-summary:focus-visible[\s\S]*outline:/, "the stack disclosure should expose keyboard focus");
assert.match(css, /\.workflow-status-stack-members[\s\S]*max-height:[\s\S]*overflow:\s*auto/, "expanded status history should remain bounded and scrollable");

console.log("workflow-status-stack.test.mjs passed");
