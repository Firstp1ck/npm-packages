import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_TITLE_PROMPT,
  SESSION_SUMMARY_PROMPT_MAX_CHARS,
  defaultSessionSummaryPreferences,
  mergeSessionSummaryPreferences,
  normalizeSessionSummaryPreferences,
  readSessionSummaryPreferences,
  sessionSummaryConfigFile,
  supportedSessionSummaryThinkingLevels,
  writeSessionSummaryPreferences,
} from "../lib/session-summary-preferences.mjs";

const defaults = defaultSessionSummaryPreferences();
assert.deepEqual(defaults.model, { provider: "openai-codex", modelId: "gpt-5.6-luna", thinkingLevel: "low" });
assert.equal(defaults.configured, false);
assert.equal(defaults.enabled, false);
assert.equal(defaults.context.injectLatest, false);
assert.deepEqual(defaults.title, { enabled: true, minSettledTurns: 3 });
assert.equal(defaults.input.scope, "text-and-tool-names");

const normalized = normalizeSessionSummaryPreferences({
  version: 7,
  configured: true,
  enabled: true,
  futureTopLevel: { retained: true },
  model: { provider: " custom ", modelId: " model ", thinkingLevel: "invalid", futureModel: 42 },
  prompts: { title: " ", summary: "x".repeat(SESSION_SUMMARY_PROMPT_MAX_CHARS + 10), futurePrompt: true },
  input: { scope: "unsafe", futureInput: true },
  context: { injectLatest: true, futureContext: true },
  title: { enabled: false, minSettledTurns: 99, futureTitle: true },
});
assert.equal(normalized.version, 7, "newer config versions survive normalization");
assert.equal(normalized.configured, false, "newer config versions fail closed");
assert.equal(normalized.enabled, false, "newer config versions cannot trigger generation");
assert.deepEqual(normalized.futureTopLevel, { retained: true });
assert.equal(normalized.model.provider, "custom");
assert.equal(normalized.model.modelId, "model");
assert.equal(normalized.model.thinkingLevel, "low");
assert.equal(normalized.model.futureModel, 42);
assert.equal(normalized.prompts.title, DEFAULT_TITLE_PROMPT);
assert.equal(normalized.prompts.summary.length, SESSION_SUMMARY_PROMPT_MAX_CHARS);
assert.equal(normalized.prompts.futurePrompt, true);
assert.equal(normalized.input.scope, "text-and-tool-names", "privacy scope is immutable");
assert.equal(normalized.context.injectLatest, true);
assert.deepEqual(normalized.title, { enabled: false, minSettledTurns: 20, futureTitle: true });

assert.equal(normalizeSessionSummaryPreferences({ configured: false, enabled: true }).enabled, false, "automatic generation fails closed until configured");
const merged = mergeSessionSummaryPreferences(normalized, { model: { modelId: "next" }, title: { minSettledTurns: 1 } });
assert.equal(merged.model.provider, "custom");
assert.equal(merged.model.modelId, "next");
assert.equal(merged.model.futureModel, 42);
assert.equal(merged.title.minSettledTurns, 1);
assert.equal(merged.title.futureTitle, true);

assert.deepEqual(supportedSessionSummaryThinkingLevels({ reasoning: false }), ["off"]);
assert.deepEqual(
  supportedSessionSummaryThinkingLevels({ reasoning: true, thinkingLevelMap: { xhigh: null, max: "max" } }),
  ["off", "minimal", "low", "medium", "high", "max"],
);

const directory = await mkdtemp(join(tmpdir(), "session-summary-preferences-"));
try {
  const storageFile = join(directory, "nested", "summary.json");
  assert.equal(sessionSummaryConfigFile({ PI_SESSION_SUMMARY_CONFIG_FILE: storageFile }), storageFile);
  assert.equal((await readSessionSummaryPreferences(storageFile)).configured, false);

  await writeSessionSummaryPreferences({
    configured: true,
    enabled: true,
    model: { provider: "openai-codex", modelId: "gpt-5.6-luna", thinkingLevel: "low" },
    unknown: "keep",
    prompts: { title: "One", summary: "Two", unknownPrompt: "keep" },
  }, storageFile);
  let persisted = JSON.parse(await readFile(storageFile, "utf8"));
  assert.equal(persisted.unknown, "keep");
  assert.equal(persisted.prompts.unknownPrompt, "keep");
  if (process.platform !== "win32") assert.equal((await stat(storageFile)).mode & 0o777, 0o600);

  await Promise.all([
    writeSessionSummaryPreferences({ context: { injectLatest: true } }, storageFile),
    writeSessionSummaryPreferences({ title: { minSettledTurns: 5 } }, storageFile),
  ]);
  persisted = JSON.parse(await readFile(storageFile, "utf8"));
  assert.equal(persisted.context.injectLatest, true, "serialized updates preserve concurrent patches");
  assert.equal(persisted.title.minSettledTurns, 5);
  assert.equal(persisted.unknown, "keep");

  const malformedFile = join(directory, "malformed.json");
  await writeFile(malformedFile, "{not json", { mode: 0o600 });
  await assert.rejects(readSessionSummaryPreferences(malformedFile), { code: "SESSION_SUMMARY_CONFIG_READ_FAILED" });
  await assert.rejects(writeSessionSummaryPreferences({ configured: true }, malformedFile), { code: "SESSION_SUMMARY_CONFIG_READ_FAILED" });
  assert.equal(await readFile(malformedFile, "utf8"), "{not json", "malformed configuration is never overwritten");
} finally {
  await rm(directory, { recursive: true, force: true });
}

assert.equal(typeof DEFAULT_SUMMARY_PROMPT, "string");
console.log("session-summary preferences tests passed");
