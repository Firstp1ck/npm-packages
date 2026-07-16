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
  await writeFile(settingsFile, `${JSON.stringify({
    version: 3,
    resourceDefaults: {
      tools: { enabledTools: ["read", "write"] },
      skills: { enabledSkills: ["skill-a", "skill-c"] },
    },
  }, null, 2)}\n`, "utf8");

  const extensionHandlers = new Map();
  const registeredCommands = new Map();
  const notifications = [];
  const appendedEntries = [];
  const bus = new EventBus();
  let activeTools = ["read", "bash", "write"];
  let branchEntries = [];
  let availableSkills = [];

  const pi = {
    events: bus,
    on(name, handler) {
      const handlers = extensionHandlers.get(name) || [];
      handlers.push(handler);
      extensionHandlers.set(name, handlers);
    },
    registerCommand(name, command) { registeredCommands.set(name, command); },
    getAllTools() {
      return ["read", "bash", "write"].map((name) => ({ name, description: `${name} tool`, sourceInfo: { source: "builtin" } }));
    },
    getActiveTools() { return [...activeTools]; },
    setActiveTools(names) { activeTools = [...names]; },
    appendEntry(customType, data) { appendedEntries.push({ customType, data }); },
  };

  const ctx = {
    mode: "rpc",
    hasUI: true,
    cwd: root,
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

  await runHelper("tools-set", { enabledTools: ["read"] });
  await runHelper("skills-set", { enabledSkills: ["skill-a", "skill-c"] });
  assert.deepEqual(appendedEntries.map((entry) => entry.customType), ["webui-tools-config", "webui-skills-config"], "session updates should remain branch-persisted");

  for (const handler of extensionHandlers.get("session_shutdown") || []) await handler({ reason: "quit" }, ctx);
  console.log("resource-defaults-helper.test.mjs passed");
} finally {
  if (previousSettingsFile === undefined) delete process.env.PI_WEBUI_SETTINGS_FILE;
  else process.env.PI_WEBUI_SETTINGS_FILE = previousSettingsFile;
  await rm(root, { recursive: true, force: true });
}
