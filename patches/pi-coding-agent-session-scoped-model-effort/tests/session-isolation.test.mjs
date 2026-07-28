import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  AGENT_SESSION_FILE,
  MODEL_SELECTOR_FILE,
  classifyContent,
  transformContent,
} from "../scripts/lifecycle.mjs";

const patchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixturesRoot = path.join(patchRoot, "tests", "fixtures", "compiled-layout");
const agentSource = fs.readFileSync(path.join(fixturesRoot, "agent-session.js"), "utf8");
const selectorSource = fs.readFileSync(path.join(fixturesRoot, "model-selector.js"), "utf8");

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readHistory(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function appendHistory(file, entry) {
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
}

function loadProfile(settingsFile, historyFile) {
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  const profile = {
    model: { provider: settings.defaultProvider, id: settings.defaultModel },
    thinkingLevel: settings.defaultThinkingLevel,
  };
  for (const entry of readHistory(historyFile)) {
    if (entry.type === "model_change") profile.model = { provider: entry.provider, id: entry.modelId };
    if (entry.type === "thinking_level_change") profile.thinkingLevel = entry.level;
  }
  return profile;
}

function createSettingsManager(settingsFile) {
  return {
    setDefaultModelAndProvider(provider, model) {
      const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      writeJson(settingsFile, { ...settings, defaultProvider: provider, defaultModel: model });
    },
    setDefaultThinkingLevel(level) {
      const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      writeJson(settingsFile, { ...settings, defaultThinkingLevel: level });
    },
    setColorScheme() {},
  };
}

function createSession(AgentSession, settingsFile, historyFile) {
  const profile = loadProfile(settingsFile, historyFile);
  const session = new AgentSession();
  session.model = profile.model;
  session.thinkingLevel = profile.thinkingLevel;
  session.availableLevels = ["low", "medium", "high"];
  session.settingsManager = createSettingsManager(settingsFile);
  session.sessionManager = {
    appendModelChange(provider, modelId) {
      appendHistory(historyFile, { type: "model_change", provider, modelId });
    },
    appendThinkingLevelChange(level) {
      appendHistory(historyFile, { type: "thinking_level_change", level });
    },
  };
  session._clampThinkingLevel = (_level, levels) => levels[0];
  session._emit = () => {};
  session._emitModelSelect = async () => {};
  session.extensionRunner = { emit() {} };
  return session;
}

async function importTransformedFixtures(root) {
  const transformedAgent = transformContent(agentSource, AGENT_SESSION_FILE);
  const transformedSelector = transformContent(selectorSource, MODEL_SELECTOR_FILE);
  assert.equal(classifyContent(transformedAgent, AGENT_SESSION_FILE).status, "already-applied");
  assert.equal(classifyContent(transformedSelector, MODEL_SELECTOR_FILE).status, "already-applied");

  const agentFile = path.join(root, "agent-session.transformed.mjs");
  const selectorFile = path.join(root, "model-selector.transformed.mjs");
  fs.writeFileSync(agentFile, transformedAgent, "utf8");
  fs.writeFileSync(selectorFile, transformedSelector, "utf8");
  return {
    ...(await import(pathToFileURL(agentFile).href)),
    ...(await import(pathToFileURL(selectorFile).href)),
  };
}

test("transformed runtime isolates session profiles and preserves static configured defaults", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-scoped-model-effort-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const settingsFile = path.join(root, "settings.json");
  const sessionAHistory = path.join(root, "session-a.jsonl");
  const sessionBHistory = path.join(root, "session-b.jsonl");
  const configuredDefaults = {
    defaultProvider: "configured-provider",
    defaultModel: "configured-model",
    defaultThinkingLevel: "medium",
    unrelatedSetting: "retained-byte-for-byte",
  };
  writeJson(settingsFile, configuredDefaults);
  const settingsBytesBefore = fs.readFileSync(settingsFile);
  const { AgentSession, ModelSelector } = await importTransformedFixtures(root);

  const sessionA = createSession(AgentSession, settingsFile, sessionAHistory);
  const sessionB = createSession(AgentSession, settingsFile, sessionBHistory);
  await sessionA.setModel({ provider: "provider-a", id: "model-a" });
  sessionA.setThinkingLevel("high");
  await sessionB.setModel({ provider: "provider-b", id: "model-b" });
  sessionB.setThinkingLevel("low");

  assert.deepEqual(readHistory(sessionAHistory), [
    { type: "model_change", provider: "provider-a", modelId: "model-a" },
    { type: "thinking_level_change", level: "high" },
  ]);
  assert.deepEqual(readHistory(sessionBHistory), [
    { type: "model_change", provider: "provider-b", modelId: "model-b" },
    { type: "thinking_level_change", level: "low" },
  ]);

  const resumedA = createSession(AgentSession, settingsFile, sessionAHistory);
  const resumedB = createSession(AgentSession, settingsFile, sessionBHistory);
  assert.deepEqual({ model: resumedA.model, thinkingLevel: resumedA.thinkingLevel }, {
    model: { provider: "provider-a", id: "model-a" }, thinkingLevel: "high",
  });
  assert.deepEqual({ model: resumedB.model, thinkingLevel: resumedB.thinkingLevel }, {
    model: { provider: "provider-b", id: "model-b" }, thinkingLevel: "low",
  });

  const selector = new ModelSelector();
  let selectorCallbackModel = null;
  selector.close = () => {};
  selector.settingsManager = createSettingsManager(settingsFile);
  selector.onSelectCallback = (model) => { selectorCallbackModel = model; };
  selector.handleSelect({ provider: "provider-selector", id: "model-selector" });
  assert.deepEqual(selectorCallbackModel, { provider: "provider-selector", id: "model-selector" });

  assert.deepEqual(fs.readFileSync(settingsFile), settingsBytesBefore);
  const freshSession = createSession(AgentSession, settingsFile, path.join(root, "fresh-session.jsonl"));
  assert.deepEqual({ model: freshSession.model, thinkingLevel: freshSession.thinkingLevel }, {
    model: { provider: "configured-provider", id: "configured-model" }, thinkingLevel: "medium",
  });
});
