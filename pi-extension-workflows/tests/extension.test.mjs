import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import workflowExtension from "../index.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "pi-workflows-extension-test-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(temp, "agent");

const commands = [];
const commandHandlers = new Map();
const commandDefinitions = new Map();
const tools = [];
const toolDefinitions = new Map();
const activeTools = new Set(["read"]);
const activeToolUpdates = [];
let rejectWorkflowToolActivation = false;
const events = [];
const eventHandlers = new Map();
const busHandlers = new Map();
const busEvents = [];
const sessionMessages = [];

workflowExtension({
  registerCommand(name, definition) {
    commands.push(name);
    commandHandlers.set(name, definition.handler);
    commandDefinitions.set(name, definition);
  },
  registerTool(definition) {
    tools.push(definition.name);
    toolDefinitions.set(definition.name, definition);
  },
  getActiveTools() { return [...activeTools]; },
  getAllTools() { return [{ name: "read" }, ...tools.map((name) => ({ name }))]; },
  setActiveTools(names) {
    const applied = rejectWorkflowToolActivation
      ? names.filter((name) => name !== "workflow_run" && name !== "workflow_status")
      : names;
    activeTools.clear();
    for (const name of applied) activeTools.add(name);
    activeToolUpdates.push([...applied]);
  },
  on(name, handler) {
    events.push(name);
    eventHandlers.set(name, handler);
  },
  appendEntry() {},
  events: {
    on(name, handler) { busHandlers.set(name, handler); },
    emit(name, payload) { busEvents.push({ name, payload }); busHandlers.get(name)?.(payload); },
  },
  sendMessage(message, options) { sessionMessages.push({ message, options }); },
}, {
  taskRunner: {
    async runTask(task, context) {
      context.onSubprocessEvent?.({
        type: "stdout", timestamp: new Date().toISOString(), phaseId: context.phase.id, phaseName: context.phase.name,
        taskId: task.id, taskName: task.name, line: `read activity for ${task.id}`,
      });
      return { ok: true, output: `result for ${task.prompt}`, usage: { input: 7, output: 3, cost: 0.001 } };
    },
  },
});

assert.deepEqual(commands, ["workflow", "workflows", "workflow-clear"]);
assert.equal(commands.includes("workflow-test"), false, "production extension must not publish/register /workflow-test");
assert.deepEqual(tools, ["workflow_run", "workflow_status"]);
assert.match(toolDefinitions.get("workflow_run").description, /Do not use for routine one-agent work/);
assert.match(toolDefinitions.get("workflow_run").promptSnippet, /approved reusable JavaScript workflow/);
assert.ok(toolDefinitions.get("workflow_run").promptGuidelines.every((guideline) => guideline.includes("workflow_run")));
assert.match(toolDefinitions.get("workflow_status").promptSnippet, /workflow run by ID/);
assert.deepEqual(events, ["session_start", "before_agent_start", "agent_end", "session_shutdown"]);

const notifications = [];
const statuses = [];
const widgets = [];
await commandHandlers.get("workflow")("list", {
  cwd: process.cwd(),
  hasUI: true,
  isProjectTrusted: () => false,
  ui: {
    notify(message, level) {
      notifications.push({ message, level });
    },
    setStatus(key, value) { statuses.push({ key, value }); },
    setWidget() {},
  },
});

assert.equal(notifications.at(-1).level, "info");
assert.match(notifications.at(-1).message, /deep-research-minimal/);

const modeCtx = {
  cwd: temp,
  hasUI: true,
  mode: "rpc",
  isProjectTrusted: () => true,
  ui: {
    notify(message, level) { notifications.push({ message, level }); },
    async select() { return "Run once"; },
    setStatus(key, value) { statuses.push({ key, value }); },
    setWidget(key, value) { widgets.push({ key, value }); },
  },
};
await commandHandlers.get("workflow")("mode on", modeCtx);
assert.deepEqual(statuses.at(-1), { key: "workflow-mode", value: "Workflow: on" });
assert.deepEqual(activeToolUpdates.at(-1), ["read", "workflow_run", "workflow_status"], "enabling Workflow Mode must add its required tools without disabling existing tools");
activeTools.delete("workflow_run");
activeTools.delete("workflow_status");
const promptUpdate = await eventHandlers.get("before_agent_start")({ systemPrompt: "BASE" }, modeCtx);
assert.match(promptUpdate.systemPrompt, /BASE[\s\S]*Workflow Mode[\s\S]*workflow_run/);
assert.ok(activeTools.has("workflow_run") && activeTools.has("workflow_status"), "Workflow Mode must repair disabled required tools before an agent turn");
assert.equal(statuses.at(-1).value, "Workflow: running");
await eventHandlers.get("agent_end")({}, modeCtx);
assert.equal(statuses.at(-1).value, "Workflow: on");
activeTools.delete("workflow_run");
activeTools.delete("workflow_status");
rejectWorkflowToolActivation = true;
const failedPromptUpdate = await eventHandlers.get("before_agent_start")({ systemPrompt: "BASE" }, modeCtx);
assert.equal(failedPromptUpdate, undefined, "Workflow Mode must not inject its prompt when required tools cannot be activated");
assert.equal(statuses.at(-1).value, "", "Workflow Mode must disable itself when tool activation fails");
assert.equal(notifications.at(-1).level, "error");
assert.match(notifications.at(-1).message, /could not activate required tools: workflow_run, workflow_status/);
rejectWorkflowToolActivation = false;
await commandHandlers.get("workflow")("mode off", modeCtx);
assert.equal(statuses.at(-1).value, "");
assert.ok(busEvents.some((entry) => entry.name === "firstpick:exclusive-mode:v1" && entry.payload.mode === "workflow" && entry.payload.enabled === false));
const modeWidget = widgets.findLast((widget) => widget.key === "workflow-mode:rpc");
assert.match(modeWidget.value[0], /^WORKFLOW_MODE_RPC_PAYLOAD /);
const inspectorWidget = widgets.findLast((widget) => widget.key === "workflow:rpc");
assert.match(inspectorWidget.value[0], /^WORKFLOW_RPC_PAYLOAD /);

busHandlers.get("firstpick:exclusive-mode:v1")({ version: 1, mode: "natural-conversation", enabled: true, updatedAt: new Date().toISOString() });
await commandHandlers.get("workflow")("mode on", modeCtx);
assert.equal(notifications.at(-1).level, "error");
assert.match(notifications.at(-1).message, /conflicts with active exclusive mode 'natural-conversation'/);
busHandlers.get("firstpick:exclusive-mode:v1")({ version: 1, mode: "natural-conversation", enabled: false, updatedAt: new Date().toISOString() });
await commandHandlers.get("workflow")("mode once", modeCtx);
assert.equal(statuses.at(-1).value, "Workflow: once");
const oncePromptUpdate = await eventHandlers.get("before_agent_start")({ systemPrompt: "BASE" }, modeCtx);
assert.match(oncePromptUpdate.systemPrompt, /Workflow Mode/);
await eventHandlers.get("agent_end")({}, modeCtx);
assert.equal(statuses.at(-1).value, "", "mode once must disarm after one agent turn");

activeTools.delete("workflow_run");
activeTools.delete("workflow_status");
await eventHandlers.get("session_start")({}, {
  ...modeCtx,
  sessionManager: {
    getEntries() {
      return [{
        type: "custom",
        customType: "workflow-mode-state",
        data: { schemaVersion: 1, enabled: true, behavior: "persistent", phase: "armed", updatedAt: new Date().toISOString() },
      }];
    },
    getSessionId() { return "restored-mode-test"; },
  },
});
assert.ok(activeTools.has("workflow_run") && activeTools.has("workflow_status"), "restored Workflow Mode must activate its required tools");
assert.equal(statuses.findLast((entry) => entry.key === "workflow-mode").value, "Workflow: on");
await commandHandlers.get("workflow")("mode off", modeCtx);

await mkdir(path.join(temp, ".pi", "workflows"), { recursive: true });
await writeFile(path.join(temp, ".pi", "workflows", "project-js.js"), `
export const meta = { name: "project-js", description: "Project JS", pi: { timeoutMs: 5000 } }
return { echoed: args.value }
`);
await commandHandlers.get("workflow")('run project-js {"value":"ok"}', {
  cwd: temp,
  hasUI: true,
  isProjectTrusted: () => true,
  ui: {
    notify(message, level) { notifications.push({ message, level }); },
    async select() { return "Run once"; },
    setStatus() {},
    setWidget() {},
  },
});
assert.equal(notifications.at(-1).level, "info");
assert.match(notifications.at(-1).message, /Workflow launched: project-js/);
for (let attempt = 0; attempt < 100 && !sessionMessages.some((entry) => entry.message.customType === "workflow-result" && entry.message.details?.workflowKey === "project-js"); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(sessionMessages.some((entry) => entry.message.customType === "workflow-request" && entry.message.details?.workflowKey === "project-js"));
assert.ok(sessionMessages.some((entry) => entry.message.customType === "workflow-result" && entry.message.details?.status === "completed"));

const inlineResult = await toolDefinitions.get("workflow_run").execute("tool-call", {
  script: `export const meta = { name: "inline-test", description: "Inline test", pi: { timeoutMs: 5000 } }\nreturn { echoed: args.value }`,
  args: { value: "inline-ok" },
  confirmRun: true,
}, undefined, undefined, modeCtx);
assert.equal(inlineResult.details.status, "async_launched");
assert.match(inlineResult.details.runId, /^workflow-/);
assert.match(inlineResult.details.taskId, /^workflow-task-workflow-/);
assert.match(inlineResult.details.scriptPath, /workflow-runs[/\\]ephemeral[/\\].+[/\\]workflow\.js$/);
assert.equal(inlineResult.terminate, true);
for (let attempt = 0; attempt < 100 && !sessionMessages.some((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === inlineResult.details.runId); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const inlineMessage = sessionMessages.find((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === inlineResult.details.runId);
assert.equal(inlineMessage.message.details.status, "completed");
assert.match(inlineMessage.message.content, /inline-ok/);

const inspectedResult = await toolDefinitions.get("workflow_run").execute("tool-call-inspected", {
  script: `export const meta = { name: "inspected-run", description: "Inspected run" }\nreturn await phase("audit", () => agent("Inspect workflow files", { label: "inspector", tools: ["read"] }))`,
  confirmRun: true,
}, undefined, undefined, modeCtx);
for (let attempt = 0; attempt < 100 && !sessionMessages.some((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === inspectedResult.details.runId); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const nativeSelections = [];
await commandHandlers.get("workflows")("", {
  cwd: temp,
  hasUI: true,
  mode: "tui",
  isProjectTrusted: () => true,
  ui: {
    notify(message, level) { notifications.push({ message, level }); },
    async select(title, options) {
      nativeSelections.push({ title, options });
      if (title === "Select workflow run") return options.find((option) => option.includes(inspectedResult.details.runId));
      if (title.startsWith("Inspected run")) return "Inspect phases and agents";
      if (title === "Select workflow phase") return options[0];
      if (title === "Select workflow agent") return options[0];
      return "Close";
    },
  },
});
assert.deepEqual(nativeSelections.map((selection) => selection.title).slice(0, 4), ["Select workflow run", "Inspected run (completed)", "Select workflow phase", "Select workflow agent"]);
assert.match(notifications.at(-1).message, /Prompt:[\s\S]*Inspect workflow files[\s\S]*Recent activity:[\s\S]*read activity for inspector[\s\S]*Result:[\s\S]*result for Inspect workflow files[\s\S]*Usage:/);
let replayConfirmation = "";
await commandHandlers.get("workflows")("", {
  cwd: temp,
  hasUI: true,
  mode: "tui",
  isProjectTrusted: () => true,
  ui: {
    notify(message, level) { notifications.push({ message, level }); },
    async select(title, options) {
      if (title === "Select workflow run") return options.find((option) => option.includes(inspectedResult.details.runId));
      return "Replay";
    },
    async confirm(title, message) { replayConfirmation = `${title}\n${message}`; return false; },
  },
});
assert.match(replayConfirmation, /Replay workflow\?[\s\S]*Launch a replay/);

await commandHandlers.get("workflow")(`save ${inlineResult.details.runId} --user`, modeCtx);
assert.equal(notifications.at(-1).level, "success");
assert.match(notifications.at(-1).message, /Saved workflow 'inline-test'/);
assert.match(await readFile(path.join(process.env.PI_CODING_AGENT_DIR, "workflows", "inline-test.js"), "utf8"), /name: "inline-test"/);
const rootCompletions = commandDefinitions.get("workflow").getArgumentCompletions("deep");
assert.ok(rootCompletions.some((item) => item.value === "deep-research-minimal"));
const runCompletions = commandDefinitions.get("workflow").getArgumentCompletions("run pro");
assert.ok(runCompletions.some((item) => item.value === "run project-js"));
const statusCompletions = commandDefinitions.get("workflow").getArgumentCompletions(`status ${inlineResult.details.runId.slice(0, 12)}`);
assert.ok(statusCompletions.some((item) => item.value === `status ${inlineResult.details.runId}`));
const saveFlagCompletions = commandDefinitions.get("workflow").getArgumentCompletions(`save ${inlineResult.details.runId} --u`);
assert.deepEqual(saveFlagCompletions.map((item) => item.value), [`save ${inlineResult.details.runId} --user`]);

const pathResult = await toolDefinitions.get("workflow_run").execute("tool-call-path", {
  scriptPath: ".pi/workflows/project-js.js",
  script: "this invalid source must lose to scriptPath precedence",
  name: "missing-name-must-lose",
  args: { value: "path-ok" },
  confirmRun: true,
}, undefined, undefined, modeCtx);
assert.equal(pathResult.details.status, "async_launched");
for (let attempt = 0; attempt < 100 && !sessionMessages.some((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === pathResult.details.runId); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const pathMessage = sessionMessages.find((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === pathResult.details.runId);
assert.equal(pathMessage.message.details.workflowKey, "project-js");
assert.match(pathMessage.message.content, /path-ok/);

const resumeResult = await toolDefinitions.get("workflow_run").execute("tool-call-resume", {
  resumeFromRunId: inlineResult.details.runId,
  confirmRun: true,
}, undefined, undefined, modeCtx);
assert.equal(resumeResult.details.status, "async_launched");
assert.notEqual(resumeResult.details.runId, inlineResult.details.runId);
for (let attempt = 0; attempt < 100 && !sessionMessages.some((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === resumeResult.details.runId); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const resumeMessage = sessionMessages.find((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === resumeResult.details.runId);
assert.equal(resumeMessage.message.details.status, "completed");
assert.match(resumeMessage.message.content, /inline-ok/, "resume without explicit args must reuse persisted input");
await assert.rejects(
  () => toolDefinitions.get("workflow_run").execute("tool-call-policy-denied", {
    script: `export const meta = { name: "write-denied", description: "Write denied", pi: { permissions: { write: true } } }\nreturn 1`,
    confirmRun: true,
  }, undefined, undefined, modeCtx),
  /Workflow policy denied/,
);
await assert.rejects(
  () => toolDefinitions.get("workflow_run").execute("tool-call-cancelled", {
    script: `export const meta = { name: "cancelled-inline", description: "Cancelled" }\nreturn 1`,
    confirmRun: true,
  }, undefined, undefined, {
    ...modeCtx,
    ui: { ...modeCtx.ui, async select() { return "Cancel"; } },
  }),
  /approval was cancelled/,
);

let rememberedSelections = 0;
const rememberedSource = `export const meta = { name: "remembered-inline", description: "Remembered", pi: { timeoutMs: 5000 } }\nreturn { ok: args.ok }`;
const rememberedCtx = {
  ...modeCtx,
  ui: {
    ...modeCtx.ui,
    async select() {
      rememberedSelections++;
      return "Remember approval for this exact script and policy";
    },
  },
};
const rememberedFirst = await toolDefinitions.get("workflow_run").execute("tool-call-remember-1", {
  script: rememberedSource,
  args: { ok: "first" },
  confirmRun: true,
}, undefined, undefined, rememberedCtx);
for (let attempt = 0; attempt < 100 && !sessionMessages.some((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === rememberedFirst.details.runId); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const rememberedSecond = await toolDefinitions.get("workflow_run").execute("tool-call-remember-2", {
  script: rememberedSource,
  args: { ok: "second" },
  confirmRun: true,
}, undefined, undefined, { cwd: temp, hasUI: false, isProjectTrusted: () => true });
for (let attempt = 0; attempt < 100 && !sessionMessages.some((entry) => entry.message.customType === "workflow-result" && entry.message.details?.runId === rememberedSecond.details.runId); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.equal(rememberedSelections, 1, "remembered exact-script approval must skip later dialogs");

if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
await rm(temp, { recursive: true, force: true });

console.log("extension tests passed");
