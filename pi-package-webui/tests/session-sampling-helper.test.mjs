import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import webuiRpcHelper from "../webui-rpc-helper.mjs";

class EventBus {
  constructor() { this.handlers = new Map(); }
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

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-session-sampling-"));
const settingsFile = path.join(root, "settings.json");
const previousSettingsFile = process.env.PI_WEBUI_SETTINGS_FILE;
process.env.PI_WEBUI_SETTINGS_FILE = settingsFile;

try {
  await writeFile(settingsFile, `${JSON.stringify({ version: 3 })}\n`, "utf8");
  const extensionHandlers = new Map();
  const registeredCommands = new Map();
  const notifications = [];
  const appendedEntries = [];
  const bus = new EventBus();
  let branchEntries = [{
    type: "custom",
    customType: "webui-session-sampling-params-v1",
    data: { version: 1, samplingParams: { temperature: 0.4, nested: { top_k: 12 } } },
  }];
  let model = {
    provider: "fixture",
    id: "compatible-model",
    name: "Compatible model",
    api: "openai-completions",
    samplingParams: { temperature: 0.8, top_p: 0.95 },
  };

  const pi = {
    events: bus,
    on(name, handler) {
      const handlers = extensionHandlers.get(name) || [];
      handlers.push(handler);
      extensionHandlers.set(name, handlers);
    },
    registerCommand(name, command) { registeredCommands.set(name, command); },
    registerTool() {},
    getAllTools() { return []; },
    getActiveTools() { return []; },
    setActiveTools() {},
    appendEntry(customType, data) { appendedEntries.push({ customType, data }); },
    getCommands() { return []; },
  };

  const ctx = {
    mode: "rpc",
    hasUI: true,
    cwd: root,
    sessionManager: { getBranch() { return branchEntries; } },
    get model() { return model; },
    thinkingLevel: "off",
    getSystemPromptOptions() { return { skills: [] }; },
    isIdle() { return true; },
    ui: {
      setStatus() {},
      notify(message, type) { notifications.push({ message, type }); },
    },
  };

  webuiRpcHelper(pi);
  const helperCommand = registeredCommands.get("webui-helper");
  assert.ok(helperCommand?.handler, "sampling test requires the hidden helper command");

  async function runHelper(action, payload = {}, { ok = true } = {}) {
    const requestId = `${action}-${notifications.length}`;
    await helperCommand.handler(JSON.stringify({ requestId, action, payload }), ctx);
    const notice = notifications.findLast((entry) => entry.message.includes(`\"requestId\":\"${requestId}\"`));
    assert.ok(notice, `${action} should emit a helper response`);
    const response = JSON.parse(notice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
    assert.equal(response.ok, ok, response.error);
    return response;
  }

  for (const handler of extensionHandlers.get("session_start") || []) await handler({ reason: "resume" }, ctx);
  const restored = (await runHelper("sampling-state")).data;
  assert.deepEqual(restored.session, { temperature: 0.4, nested: { top_k: 12 } });
  assert.deepEqual(restored.defaults, { temperature: 0.8, top_p: 0.95 });
  assert.deepEqual(restored.effective, { temperature: 0.4, top_p: 0.95 }, "unknown stored keys should be preserved but inert");
  assert.equal(restored.support.supported, true);
  assert.equal(restored.support.api, "openai-completions");
  assert.deepEqual(Object.keys(restored.support.parameters), [
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "seed",
    "top_k",
    "min_p",
  ]);
  assert.equal(restored.support.parameters.temperature.supported, true);
  assert.equal(restored.support.parameters.top_k.supported, false);
  assert.deepEqual(restored.support.model, {
    provider: "fixture",
    id: "compatible-model",
    name: "Compatible model",
  }, "sampling state should read the active model from the public context property");

  const requestHook = (extensionHandlers.get("before_provider_request") || [])[0];
  assert.ok(requestHook, "sampling test requires the provider request hook");
  assert.deepEqual(
    await requestHook({ payload: { model: "compatible-model", temperature: 1, messages: [] } }, ctx),
    { model: "compatible-model", temperature: 0.4, messages: [] },
    "only supported session values should win for compatible requests",
  );

  const updated = (await runHelper("sampling-set", { samplingParams: { temperature: 0.2, top_p: 0.9, extra: [1, { enabled: true }] } })).data;
  assert.deepEqual(updated.session, { temperature: 0.2, top_p: 0.9, extra: [1, { enabled: true }] });
  assert.deepEqual(appendedEntries.at(-1), {
    customType: "webui-session-sampling-params-v1",
    data: { version: 1, samplingParams: { temperature: 0.2, top_p: 0.9, extra: [1, { enabled: true }] } },
  });

  const persistedCount = appendedEntries.length;
  const invalidKnownWrites = [
    [{ temperature: "0.2" }, /Temperature must be a number\./],
    [{ top_p: 0 }, /Top P must be greater than 0 and at most 1\./],
    [{ seed: 1.5 }, /Seed must be an integer\./],
  ];
  for (const [samplingParams, errorPattern] of invalidKnownWrites) {
    const rejected = await runHelper("sampling-set", { samplingParams }, { ok: false });
    assert.match(rejected.error, errorPattern, "direct helper writes should explicitly reject invalid catalog values");
    assert.equal(appendedEntries.length, persistedCount, "invalid catalog values must not persist");
    assert.deepEqual((await runHelper("sampling-state")).data.session, updated.session, "invalid catalog values must not replace active state");
  }
  assert.match((await runHelper("sampling-set", { samplingParams: [] }, { ok: false })).error, /JSON object/i);
  assert.match((await runHelper("sampling-set", { samplingParams: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`key${index}`, index])) }, { ok: false })).error, /at most 128/i);
  assert.match((await runHelper("sampling-set", { samplingParams: { prompt: "x".repeat(17 * 1024) } }, { ok: false })).error, /at most 16384 bytes/i);
  assert.equal(appendedEntries.length, persistedCount, "rejected values must not persist or replace active state");
  assert.deepEqual((await runHelper("sampling-state")).data.session, updated.session);

  for (const api of ["openai-responses", "azure-openai-responses"]) {
    model = { ...model, api };
    assert.equal((await runHelper("sampling-state")).data.support.supported, true, `${api} should be supported`);
    assert.equal((await requestHook({ payload: { input: [] } }, ctx)).temperature, 0.2);
  }

  model = {
    ...model,
    provider: "openai-codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    api: "openai-codex-responses",
  };
  const codex = (await runHelper("sampling-state")).data;
  assert.deepEqual(codex.support.model, {
    provider: "openai-codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
  }, "Codex models should be recognized by the per-key capability contract");
  assert.equal(codex.support.api, "openai-codex-responses");
  assert.equal(codex.support.supported, true);
  assert.equal(codex.support.parameters.temperature.supported, true);
  assert.equal(codex.support.parameters.top_p.supported, false);
  assert.deepEqual(codex.effective, { temperature: 0.2 }, "Codex should expose only its verified temperature value");
  assert.deepEqual(await requestHook({ payload: { model: "gpt-5.6-sol", input: [], service_tier: "priority" } }, ctx), {
    model: "gpt-5.6-sol",
    input: [],
    service_tier: "priority",
    temperature: 0.2,
  }, "unsupported stored values must not overwrite unrelated provider payload fields");

  model = { ...model, api: "anthropic-messages", reasoning: true, compat: { supportsTemperature: true } };
  ctx.thinkingLevel = "high";
  const thinking = (await runHelper("sampling-state")).data;
  assert.equal(thinking.support.supported, false);
  assert.match(thinking.support.parameters.temperature.reason, /extended thinking/i);
  assert.deepEqual(thinking.session, updated.session, "unsupported models should retain the complete session override");
  assert.deepEqual(thinking.effective, {}, "conditionally unsupported values should disappear from effective state");
  assert.equal(await requestHook({ payload: { model: "claude", thinking: { type: "enabled" } } }, ctx), undefined, "Anthropic thinking payloads must remain untouched");

  model = { ...model, api: "custom-provider-v1" };
  ctx.thinkingLevel = "off";
  const unsupported = (await runHelper("sampling-state")).data;
  assert.equal(unsupported.support.supported, false);
  assert.ok(Object.values(unsupported.support.parameters).every((entry) => entry.supported === false));
  assert.deepEqual(unsupported.session, updated.session, "unknown APIs should preserve the session override");
  assert.deepEqual(unsupported.effective, {}, "unknown APIs should fail closed");
  assert.equal(await requestHook({ payload: { model: "unsupported", temperature: 1 } }, ctx), undefined, "unknown provider payloads must remain untouched");

  model = { ...model, api: "openai-completions", reasoning: false };
  const reactivated = (await runHelper("sampling-state")).data;
  assert.deepEqual(reactivated.effective, { temperature: 0.2, top_p: 0.9 }, "preserved values should reactivate after switching back to a compatible API");

  const reset = (await runHelper("sampling-reset")).data;
  assert.deepEqual(reset.session, {});
  assert.deepEqual(appendedEntries.at(-1), {
    customType: "webui-session-sampling-params-v1",
    data: { version: 1, samplingParams: {} },
  }, "reset must persist an empty entry so earlier branch values cannot reappear");

  branchEntries = [
    branchEntries[0],
    { type: "custom", customType: "webui-session-sampling-params-v1", data: { version: 1, samplingParams: { top_p: 0.5 } } },
    { type: "custom", customType: "webui-session-sampling-params-v1", data: { version: 1, samplingParams: {} } },
  ];
  for (const handler of extensionHandlers.get("session_tree") || []) await handler({ newLeafId: "leaf-reset" }, ctx);
  assert.deepEqual((await runHelper("sampling-state")).data.session, {}, "tree navigation should restore the last value on the active branch");

  branchEntries = [{
    type: "custom",
    customType: "webui-session-sampling-params-v1",
    data: { version: 1, samplingParams: ["invalid persisted shape"] },
  }];
  for (const handler of extensionHandlers.get("session_tree") || []) await handler({ newLeafId: "leaf-invalid" }, ctx);
  assert.deepEqual((await runHelper("sampling-state")).data.session, {}, "malformed persisted entries should fail closed");

  for (const handler of extensionHandlers.get("session_shutdown") || []) await handler({ reason: "quit" }, ctx);
  console.log("session-sampling-helper.test.mjs passed");
} finally {
  if (previousSettingsFile === undefined) delete process.env.PI_WEBUI_SETTINGS_FILE;
  else process.env.PI_WEBUI_SETTINGS_FILE = previousSettingsFile;
  await rm(root, { recursive: true, force: true });
}
