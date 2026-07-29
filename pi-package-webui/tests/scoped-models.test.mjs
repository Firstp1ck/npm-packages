import assert from "node:assert/strict";
import { resolveScopedModelsFromPatterns } from "../lib/scoped-models.mjs";

const models = [
  { provider: "anthropic", id: "claude-fable-5", name: "Claude Fable 5" },
  { provider: "openrouter", id: "anthropic/claude-fable-5", name: "Claude Fable 5" },
  { provider: "openrouter", id: "anthropic/claude-fable-5:batch", name: "Claude Fable 5 Batch" },
  { provider: "openrouter", id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash" },
  { provider: "openrouter", id: "google/gemini-3.6-flash:batch", name: "Gemini 3.6 Flash Batch" },
  { provider: "openrouter", id: "openrouter/auto", name: "Auto" },
  { provider: "openrouter", id: "openrouter/auto-beta", name: "Auto Beta" },
];

const exactPatterns = [
  "anthropic/claude-fable-5",
  "openrouter/google/gemini-3.6-flash",
  "openrouter/openrouter/auto",
];
const exact = await resolveScopedModelsFromPatterns(exactPatterns, models);
assert.deepEqual(
  exact.map((model) => `${model.provider}/${model.id}`),
  exactPatterns,
  "exact Pi scope entries must not expand to cross-provider, batch, or similarly named models",
);

const withThinking = await resolveScopedModelsFromPatterns(["anthropic/claude-fable-5:high"], models);
assert.deepEqual(withThinking.map((model) => `${model.provider}/${model.id}`), ["anthropic/claude-fable-5"]);

const exactColonId = await resolveScopedModelsFromPatterns(["openrouter/anthropic/claude-fable-5:batch"], models);
assert.deepEqual(exactColonId.map((model) => `${model.provider}/${model.id}`), ["openrouter/anthropic/claude-fable-5:batch"]);

const glob = await resolveScopedModelsFromPatterns(["openrouter/google/gemini-3.6-flash*"], models);
assert.deepEqual(
  glob.map((model) => `${model.provider}/${model.id}`),
  ["openrouter/google/gemini-3.6-flash", "openrouter/google/gemini-3.6-flash:batch"],
  "explicit Pi glob patterns must retain their intentional expansion behavior",
);

assert.deepEqual(await resolveScopedModelsFromPatterns([null, ""], models), []);
assert.deepEqual(await resolveScopedModelsFromPatterns(exactPatterns, null), []);

console.log("scoped-models.test.mjs passed");
