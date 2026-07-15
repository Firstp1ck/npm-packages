import assert from "node:assert/strict";
import {
  WORKFLOW_MODE_ENTRY_TYPE,
  WORKFLOW_MODE_RPC_PAYLOAD_PREFIX,
  WORKFLOW_MODE_RPC_WIDGET_KEY,
  createWorkflowModeController,
  latestWorkflowModeFromEntries,
  workflowModeDescription,
  workflowModeStatusText,
} from "../src/mode.ts";

const persisted = [];
const statuses = [];
const widgets = [];
const controller = createWorkflowModeController({ appendEntry(type, data) { persisted.push({ type, data }); } });
const ctx = {
  hasUI: true,
  mode: "rpc",
  ui: {
    setStatus(key, value) { statuses.push({ key, value }); },
    setWidget(key, value) { widgets.push({ key, value }); },
  },
};

assert.equal(controller.isEnabled(), false);
assert.equal(workflowModeStatusText(controller.getState()), "");
controller.setEnabled(true, ctx);
assert.equal(controller.getState().phase, "armed");
assert.equal(statuses.at(-1).value, "Workflow: on");
assert.equal(persisted.at(-1).type, WORKFLOW_MODE_ENTRY_TYPE);
assert.match(workflowModeDescription(controller.getState()), /is on/);

controller.setRunning(true, ctx);
assert.equal(controller.getState().phase, "running");
assert.equal(statuses.at(-1).value, "Workflow: running");
assert.match(controller.buildSystemPrompt("BASE"), /BASE[\s\S]*Workflow Mode[\s\S]*workflow_run/);
controller.setRunning(false, ctx);
assert.equal(controller.getState().phase, "armed");

controller.toggle(ctx);
assert.equal(controller.isEnabled(), false);
assert.equal(statuses.at(-1).value, "");
assert.equal(controller.buildSystemPrompt("BASE"), "BASE");

controller.armOnce(ctx);
assert.equal(controller.getState().behavior, "once");
assert.equal(statuses.at(-1).value, "Workflow: once");
assert.equal(widgets.at(-1).key, WORKFLOW_MODE_RPC_WIDGET_KEY);
const rpcPayload = JSON.parse(widgets.at(-1).value[0].slice(WORKFLOW_MODE_RPC_PAYLOAD_PREFIX.length));
assert.deepEqual({ type: rpcPayload.type, version: rpcPayload.version, enabled: rpcPayload.enabled, behavior: rpcPayload.behavior, phase: rpcPayload.phase }, {
  type: "firstpick.pi-extension-workflows.mode",
  version: 1,
  enabled: true,
  behavior: "once",
  phase: "armed",
});
controller.setRunning(true, ctx);
controller.finishTurn(ctx);
assert.equal(controller.isEnabled(), false, "one-shot mode must disarm after one agent turn");
assert.equal(statuses.at(-1).value, "");

const tuiWidgets = [];
controller.setEnabled(true, { hasUI: true, mode: "tui", ui: { setStatus() {}, setWidget(key) { tuiWidgets.push(key); } } });
assert.deepEqual(tuiWidgets, [], "native TUI should receive human-readable status without RPC payload widgets");
controller.setEnabled(false, ctx);

const restoredEntry = {
  type: "custom",
  customType: WORKFLOW_MODE_ENTRY_TYPE,
  data: { schemaVersion: 1, enabled: true, behavior: "persistent", phase: "running", updatedAt: new Date().toISOString() },
};
assert.equal(latestWorkflowModeFromEntries([restoredEntry]).enabled, true);
const restored = createWorkflowModeController();
restored.restoreFromEntries([restoredEntry]);
assert.equal(restored.getState().phase, "armed", "restored running modes should return to the safe armed state");
assert.equal(restored.isEnabled(), true);

console.log("mode tests passed");
