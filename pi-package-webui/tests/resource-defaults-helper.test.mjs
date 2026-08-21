import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import webuiRpcHelper from "../webui-rpc-helper.mjs";

class EventBus {
  constructor() {
    this.handlers = new Map();
  }

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

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-resource-defaults-"));
const settingsFile = path.join(root, "settings.json");
const previousSettingsFile = process.env.PI_WEBUI_SETTINGS_FILE;
process.env.PI_WEBUI_SETTINGS_FILE = settingsFile;

try {
  const settingsPayload = {
    version: 8,
    resourceDefaults: {
      tools: { enabledTools: ["read", "write"] },
      skills: { enabledSkills: ["skill-a", "skill-c"] },
      modelProfiles: [
        { provider: "provider", modelId: "model-a", tools: { enabledTools: ["bash"] }, skills: { enabledSkills: ["skill-b"] } },
        { provider: "provider", modelId: "model-b", tools: { enabledTools: ["write"] }, skills: { enabledSkills: [] } },
      ],
    },
  };
  await writeFile(settingsFile, "{ invalid settings\n", "utf8");

  const extensionHandlers = new Map();
  const registeredCommands = new Map();
  const notifications = [];
  const appendedEntries = [];
  const bus = new EventBus();
  let activeTools = ["read", "bash", "write"];
  let branchEntries = [];
  let availableSkills = [];
  let runtimeReady = false;

  const pi = {
    events: bus,
    on(name, handler) {
      const handlers = extensionHandlers.get(name) || [];
      handlers.push(handler);
      extensionHandlers.set(name, handlers);
    },
    registerCommand(name, command) { registeredCommands.set(name, command); },
    registerTool() {},
    getAllTools() {
      return ["read", "bash", "write"].map((name) => ({ name, description: `${name} tool`, sourceInfo: { source: "builtin" } }));
    },
    getActiveTools() {
      assert.equal(runtimeReady, true, "extension action methods must not run while the extension factory is loading");
      return [...activeTools];
    },
    setActiveTools(names) { activeTools = [...names]; },
    appendEntry(customType, data) {
      appendedEntries.push({ customType, data });
      branchEntries.push({ type: "custom", customType, data });
    },
  };

  const ctx = {
    mode: "rpc",
    hasUI: true,
    cwd: root,
    model: { provider: "provider", id: "unconfigured" },
    sessionManager: {
      getBranch() { return branchEntries; },
    },
    getSystemPromptOptions() {
      return {
        skills: availableSkills.map((name) => ({ name, description: `${name} skill` })),
      };
    },
    ui: {
      setStatus() {},
      notify(message, type) { notifications.push({ message, type }); },
    },
  };

  webuiRpcHelper(pi);
  runtimeReady = true;
  const helperCommand = registeredCommands.get("webui-helper");
  assert.ok(helperCommand?.handler, "resource defaults test requires the hidden helper command");

  async function runHelper(action, payload = {}) {
    const requestId = `${action}-${notifications.length}`;
    await helperCommand.handler(JSON.stringify({ requestId, action, payload }), ctx);
    const notice = notifications.findLast((entry) => entry.message.includes(`\"requestId\":\"${requestId}\"`));
    assert.ok(notice, `${action} should emit a helper response`);
    const response = JSON.parse(notice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
    assert.equal(response.ok, true, response.error);
    return response.data;
  }

  for (const handler of extensionHandlers.get("session_start") || []) await handler({ reason: "startup" }, ctx);
  assert.deepEqual(activeTools, ["read", "bash", "write"], "an initial settings-read failure must leave Pi's runtime tools unchanged");
  assert.ok(notifications.some((entry) => /tools and skills remain unchanged/i.test(entry.message)), "initial settings failure should emit a bounded warning");
  const applyLaunchSlotDefaults = (extensionHandlers.get("tool_call") || [])[0];
  assert.ok(applyLaunchSlotDefaults, "resource defaults helper should register launch-slot admission");
  const unavailableReviewer = await applyLaunchSlotDefaults({ toolName: "subagent", input: { agent: "reviewer", task: "Review while settings are unavailable" } }, ctx);
  assert.equal(unavailableReviewer?.block, true, "a reviewer-bearing direct launch must fail closed after snapshot load failure");
  assert.match(unavailableReviewer?.reason || "", /snapshot could not be loaded.*Reload the active tab/i);
  const unavailableWorkflow = await applyLaunchSlotDefaults({ toolName: "subagent", input: { workflowScript: "return runs.run('review', {agent:'reviewer', task:'Review'})" } }, ctx);
  assert.equal(unavailableWorkflow?.block, true, "an opaque workflow launch must fail closed after snapshot load failure");
  const unaffectedDelegate = { agent: "delegate", task: "Continue non-reviewer work", model: "provider/delegate" };
  assert.equal(await applyLaunchSlotDefaults({ toolName: "subagent", input: unaffectedDelegate }, ctx), undefined, "a non-reviewer direct launch should remain available after snapshot load failure");
  assert.equal(unaffectedDelegate.model, "provider/delegate");

  await writeFile(settingsFile, `${JSON.stringify(settingsPayload, null, 2)}\n`, "utf8");
  for (const handler of extensionHandlers.get("session_start") || []) await handler({ reason: "settings-restored" }, ctx);
  assert.equal(await applyLaunchSlotDefaults({ toolName: "subagent", input: { agent: "reviewer", task: "Review after reload" } }, ctx), undefined, "a successful reload should clear snapshot-failure admission blocking");
  availableSkills = ["skill-a", "skill-b", "skill-c"];
  assert.deepEqual(activeTools, ["read", "write"], "a new session should inherit the global tool allowlist");
  assert.deepEqual(
    (await runHelper("skills-state")).skills.map((skill) => [skill.name, skill.enabled]),
    [["skill-a", true], ["skill-b", false], ["skill-c", true]],
    "a new session should inherit the global skill allowlist",
  );

  branchEntries = [
    { type: "custom", customType: "webui-tools-config", data: { enabledTools: ["bash"] } },
    { type: "custom", customType: "webui-skills-config", data: { disabledSkills: ["skill-a"] } },
  ];
  for (const handler of extensionHandlers.get("session_start") || []) await handler({ reason: "resume" }, ctx);
  assert.deepEqual(activeTools, ["bash"], "session tool choices should override the global default");
  assert.deepEqual(
    (await runHelper("skills-state")).skills.map((skill) => [skill.name, skill.enabled]),
    [["skill-a", false], ["skill-b", true], ["skill-c", true]],
    "session skill choices should override the global default",
  );

  branchEntries = [];
  ctx.model = { provider: "provider", id: "model-a" };
  for (const handler of extensionHandlers.get("model_select") || []) await handler({ model: ctx.model, source: "set" }, ctx);
  assert.deepEqual(activeTools, ["bash"], "model selection should immediately apply the exact tool profile");
  assert.deepEqual((await runHelper("skills-state")).enabledSkills, ["skill-b"], "model selection should immediately apply the exact skill profile");

  await writeFile(settingsFile, "{ invalid settings\n", "utf8");
  ctx.model = { provider: "provider", id: "model-b" };
  for (const handler of extensionHandlers.get("model_select") || []) await handler({ model: ctx.model, source: "set" }, ctx);
  assert.deepEqual(activeTools, ["bash"], "a later settings-read failure must retain the last safely applied tools");
  assert.deepEqual((await runHelper("skills-state")).enabledSkills, ["skill-b"], "a later settings-read failure must retain the last safely applied skills");
  await writeFile(settingsFile, `${JSON.stringify(settingsPayload, null, 2)}\n`, "utf8");
  ctx.model = { provider: "provider", id: "model-a" };

  await runHelper("tools-set", { enabledTools: ["read"] });
  ctx.model = { provider: "provider", id: "model-b" };
  for (const handler of extensionHandlers.get("model_select") || []) await handler({ model: ctx.model, source: "set" }, ctx);
  assert.deepEqual(activeTools, ["read"], "a session-pinned tool selection should survive model changes");
  assert.deepEqual((await runHelper("skills-state")).enabledSkills, [], "an unpinned skill selection should follow the new model independently");
  const blockedSkill = await (extensionHandlers.get("input") || [])[0]({ text: "/skill:skill-a" }, ctx);
  assert.deepEqual(blockedSkill, { action: "handled" }, "an explicit invocation of a model-disabled skill should be blocked");

  await runHelper("tools-set", { mode: "inherit" });
  assert.deepEqual(activeTools, ["write"], "unpinning tools should immediately restore the active model profile");
  await runHelper("skills-set", { enabledSkills: ["skill-a", "skill-c"] });
  const filteredPrompt = await (extensionHandlers.get("before_agent_start") || [])[0]({
    systemPrompt: "The following skills provide guidance.\n<available_skills>\nold\n</available_skills>\n",
    systemPromptOptions: {
      skills: [
        { name: "skill-a", description: "normal", filePath: "/tmp/a/SKILL.md" },
        { name: "skill-c", description: "user only", filePath: "/tmp/c/SKILL.md", disableModelInvocation: true },
      ],
    },
  }, ctx);
  assert.doesNotMatch(filteredPrompt.systemPrompt, /skill-c/, "disableModelInvocation skills must not be exposed to automatic model invocation");
  assert.deepEqual(appendedEntries.map((entry) => entry.customType), ["webui-tools-config", "webui-tools-config", "webui-skills-config"], "session updates and inherit resets should remain branch-persisted");
  assert.deepEqual(appendedEntries[0].data, { version: 2, mode: "explicit", enabledTools: ["read"] });
  assert.deepEqual(appendedEntries[1].data, { version: 2, mode: "inherit" });

  for (const handler of extensionHandlers.get("session_shutdown") || []) await handler({ reason: "quit" }, ctx);
  console.log("resource-defaults-helper.test.mjs passed");
} finally {
  if (previousSettingsFile === undefined) delete process.env.PI_WEBUI_SETTINGS_FILE;
  else process.env.PI_WEBUI_SETTINGS_FILE = previousSettingsFile;
  await rm(root, { recursive: true, force: true });
}
