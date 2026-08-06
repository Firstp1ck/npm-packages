import assert from "node:assert/strict";
import {
  applySupportedSamplingParameters,
  BUILTIN_SAMPLING_APIS,
  filterSupportedSamplingParameters,
  resolveSamplingParameterCapabilities,
  SAMPLING_PARAMETER_KEYS,
} from "../lib/sampling-parameter-capabilities.mjs";

const expectedKeys = {
  "openai-completions": ["temperature", "top_p", "frequency_penalty", "presence_penalty", "seed"],
  "openai-responses": ["temperature", "top_p"],
  "azure-openai-responses": ["temperature", "top_p"],
  "openai-codex-responses": ["temperature"],
  "anthropic-messages": ["temperature"],
  "google-generative-ai": ["temperature", "top_p", "frequency_penalty", "presence_penalty", "seed", "top_k"],
  "google-vertex": ["temperature", "top_p", "frequency_penalty", "presence_penalty", "seed", "top_k"],
  "bedrock-converse-stream": ["temperature", "top_p"],
  "mistral-conversations": ["temperature"],
  "pi-messages": ["temperature"],
};

assert.deepEqual(BUILTIN_SAMPLING_APIS, Object.keys(expectedKeys), "the resolver must cover every built-in Pi API family");
for (const api of BUILTIN_SAMPLING_APIS) {
  const parameters = resolveSamplingParameterCapabilities({ api });
  assert.deepEqual(Object.keys(parameters), SAMPLING_PARAMETER_KEYS, `${api} should return a stable capability entry for every catalog key`);
  assert.deepEqual(
    SAMPLING_PARAMETER_KEYS.filter((key) => parameters[key].supported),
    expectedKeys[api],
    `${api} should expose only verified keys`,
  );
  for (const [key, capability] of Object.entries(parameters)) {
    assert.equal(typeof capability.reason, "string", `${api}/${key} should explain its capability`);
    assert.ok(capability.reason.length > 0);
    assert.ok(["api", "model", "unsupported"].includes(capability.source));
  }
}

const unknown = resolveSamplingParameterCapabilities({ api: "custom-provider-v1" });
assert.ok(Object.values(unknown).every((entry) => entry.supported === false && entry.source === "unsupported"));
assert.match(unknown.temperature.reason, /provider has not declared support/i, "unknown APIs must fail closed with an actionable reason");
assert.ok(Object.values(resolveSamplingParameterCapabilities(null)).every((entry) => entry.supported === false));

const openAiExtension = resolveSamplingParameterCapabilities({
  api: "openai-completions",
  samplingParams: { top_k: 40, min_p: 0.05 },
});
assert.equal(openAiExtension.top_k.supported, true);
assert.equal(openAiExtension.top_k.source, "model");
assert.equal(openAiExtension.min_p.supported, true);
assert.equal(openAiExtension.min_p.source, "model");
assert.equal(resolveSamplingParameterCapabilities({ api: "openai-completions", samplingParams: {} }).top_k.supported, false);

const anthropicModel = { api: "anthropic-messages", reasoning: true, compat: { supportsTemperature: true } };
assert.equal(resolveSamplingParameterCapabilities(anthropicModel, { thinkingLevel: "off" }).temperature.supported, true);
const anthropicThinking = resolveSamplingParameterCapabilities(anthropicModel, { thinkingLevel: "high" }).temperature;
assert.equal(anthropicThinking.supported, false);
assert.match(anthropicThinking.reason, /extended thinking/i);
const anthropicUnsafeModel = resolveSamplingParameterCapabilities({
  api: "anthropic-messages",
  reasoning: false,
  compat: { supportsTemperature: false },
}).temperature;
assert.equal(anthropicUnsafeModel.supported, false);
assert.match(anthropicUnsafeModel.reason, /model marks it unsupported/i);

const allValues = {
  temperature: 0.2,
  top_p: 0.8,
  frequency_penalty: 0.3,
  presence_penalty: 0.4,
  seed: 7,
  top_k: 42,
  min_p: 0.06,
  vendor_extension: "preserved-only",
};
const completionCapabilities = resolveSamplingParameterCapabilities({ api: "openai-completions" });
assert.deepEqual(filterSupportedSamplingParameters(allValues, completionCapabilities), {
  temperature: 0.2,
  top_p: 0.8,
  frequency_penalty: 0.3,
  presence_penalty: 0.4,
  seed: 7,
}, "filtering should omit unsupported and unknown values without modifying stored state");
assert.equal(allValues.vendor_extension, "preserved-only");

const cases = [
  {
    api: "openai-completions",
    payload: { model: "chat", messages: [], untouched: true },
    expected: { model: "chat", messages: [], untouched: true, temperature: 0.2, top_p: 0.8, frequency_penalty: 0.3, presence_penalty: 0.4, seed: 7 },
  },
  {
    api: "openai-responses",
    payload: { model: "response", input: [], metadata: { trace: true } },
    expected: { model: "response", input: [], metadata: { trace: true }, temperature: 0.2, top_p: 0.8 },
  },
  {
    api: "azure-openai-responses",
    payload: { model: "deployment", input: [], service_tier: "default" },
    expected: { model: "deployment", input: [], service_tier: "default", temperature: 0.2, top_p: 0.8 },
  },
  {
    api: "openai-codex-responses",
    payload: { model: "gpt-5.6-sol", input: [], reasoning: { effort: "high" } },
    expected: { model: "gpt-5.6-sol", input: [], reasoning: { effort: "high" }, temperature: 0.2 },
  },
  {
    api: "anthropic-messages",
    model: { reasoning: true, compat: { supportsTemperature: true } },
    options: { thinkingLevel: "off" },
    payload: { model: "claude", messages: [], max_tokens: 2048 },
    expected: { model: "claude", messages: [], max_tokens: 2048, temperature: 0.2 },
  },
  {
    api: "google-generative-ai",
    payload: { model: "gemini", contents: [], config: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } } },
    expected: { model: "gemini", contents: [], config: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2, topP: 0.8, topK: 42, frequencyPenalty: 0.3, presencePenalty: 0.4, seed: 7 } },
  },
  {
    api: "google-vertex",
    payload: { contents: [], config: { systemInstruction: "keep", custom: { nested: true } } },
    expected: { contents: [], config: { systemInstruction: "keep", custom: { nested: true }, temperature: 0.2, topP: 0.8, topK: 42, frequencyPenalty: 0.3, presencePenalty: 0.4, seed: 7 } },
  },
  {
    api: "bedrock-converse-stream",
    payload: { modelId: "bedrock", messages: [], inferenceConfig: { maxTokens: 512 }, additionalModelRequestFields: { keep: true } },
    expected: { modelId: "bedrock", messages: [], inferenceConfig: { maxTokens: 512, temperature: 0.2, topP: 0.8 }, additionalModelRequestFields: { keep: true } },
  },
  {
    api: "mistral-conversations",
    payload: { model: "mistral", inputs: [], maxTokens: 1024 },
    expected: { model: "mistral", inputs: [], maxTokens: 1024, temperature: 0.2 },
  },
  {
    api: "pi-messages",
    payload: { model: "pi", context: { messages: [] }, options: { maxTokens: 512, reasoning: "high" } },
    expected: { model: "pi", context: { messages: [] }, options: { maxTokens: 512, reasoning: "high", temperature: 0.2 } },
  },
];

for (const testCase of cases) {
  const model = { api: testCase.api, ...(testCase.model || {}) };
  const originalPayload = structuredClone(testCase.payload);
  const result = applySupportedSamplingParameters(testCase.payload, model, allValues, testCase.options);
  assert.deepEqual(result, testCase.expected, `${testCase.api} should map only verified values to its API-native payload`);
  assert.deepEqual(testCase.payload, originalPayload, `${testCase.api} mapping must not mutate the provider payload`);
}

assert.equal(
  applySupportedSamplingParameters({ request: true }, { api: "custom-provider-v1" }, allValues),
  undefined,
  "unknown APIs must not receive any stored sampling values",
);
assert.equal(
  applySupportedSamplingParameters({ model: "claude", thinking: { type: "enabled", budget_tokens: 1024 } }, anthropicModel, allValues, { thinkingLevel: "off" }),
  undefined,
  "the final Anthropic payload safety check must not add temperature when extended thinking is present",
);
assert.equal(
  applySupportedSamplingParameters({ model: "claude" }, anthropicModel, allValues, { thinkingLevel: "high" }),
  undefined,
  "active Anthropic thinking must filter temperature before payload application",
);
assert.equal(applySupportedSamplingParameters([], { api: "openai-completions" }, allValues), undefined);

console.log("sampling-parameter-capabilities.test.mjs passed");
