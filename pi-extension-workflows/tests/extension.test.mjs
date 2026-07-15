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
});

assert.deepEqual(commands, ["workflow", "workflows", "workflow-clear"]);
assert.equal(commands.includes("workflow-test"), false, "production extension must not publish/register /workflow-test");
assert.deepEqual(tools, ["workflow_run", "workflow_status"]);
assert.match(toolDefinitions.get("workflow_run").description, /Do not use for routine one-agent work/);
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
const promptUpdate = await eventHandlers.get("before_agent_start")({ systemPrompt: "BASE" }, modeCtx);
assert.match(promptUpdate.systemPrompt, /BASE[\s\S]*Workflow Mode[\s\S]*workflow_run/);
assert.equal(statuses.at(-1).value, "Workflow: running");
await eventHandlers.get("agent_end")({}, modeCtx);
assert.equal(statuses.at(-1).value, "Workflow: on");
await commandHandlers.get("workflow")("mode off", modeCtx);
assert.equal(statuses.at(-1).value, "");
assert.ok(busEvents.some((entry) => entry.name === "firstpick:exclusive-mode:v1" && entry.payload.mode === "workflow" && entry.payload.enabled === false));
assert.equal(widgets.at(-1).key, "workflow-mode:rpc");
assert.match(widgets.at(-1).value[0], /^WORKFLOW_MODE_RPC_PAYLOAD /);

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

await assert.rejects(
  () => toolDefinitions.get("workflow_run").execute("tool-call-resume", {
    name: "project-js",
    resumeFromRunId: inlineResult.details.runId,
    confirmRun: true,
  }, undefined, undefined, modeCtx),
  /requires replay support from milestone M7/,
);
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
