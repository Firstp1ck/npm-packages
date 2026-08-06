import assert from "node:assert/strict";
import {
  SAMPLING_PARAMETER_CATALOG,
  SAMPLING_PARAMETER_KEYS,
  SamplingParameterValidationError,
  buildSamplingParametersFromDraft,
  createSamplingControlDraft,
  samplingControlDraftEquals,
  samplingParameterCapability,
  samplingParameterDefinition,
  samplingParameterSliderValue,
  splitSamplingParameters,
  summarizePreservedSamplingParameters,
  validateSamplingControlDraft,
  validateSamplingParameterObject,
  validateSamplingParameterValue,
} from "../public/sampling-parameter-controls.mjs";

assert.deepEqual(SAMPLING_PARAMETER_KEYS, [
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "top_k",
  "min_p",
], "the catalog should expose exactly the approved core and server-extension parameters");
assert.ok(Object.isFrozen(SAMPLING_PARAMETER_CATALOG));
assert.ok(Object.isFrozen(SAMPLING_PARAMETER_KEYS));
assert.ok(SAMPLING_PARAMETER_CATALOG.every((definition) => Object.isFrozen(definition) && Object.isFrozen(definition.slider)), "catalog metadata should be deeply frozen");
assert.deepEqual(
  SAMPLING_PARAMETER_CATALOG.filter(({ group }) => group === "server-extension").map(({ key }) => key),
  ["top_k", "min_p"],
  "only the approved llama.cpp/vLLM extensions should be grouped as server extensions",
);
assert.equal(samplingParameterDefinition("temperature")?.label, "Temperature");
assert.equal(samplingParameterDefinition("missing"), null);

assert.deepEqual(samplingParameterCapability({
  temperature: { supported: true, reason: "Supported by openai-codex-responses.", source: "api" },
}, "temperature"), {
  supported: true,
  reason: "Supported by openai-codex-responses.",
  source: "api",
}, "an explicit per-key backend capability should be consumed verbatim");
assert.deepEqual(samplingParameterCapability(undefined, "top_p"), {
  supported: false,
  reason: "Top P is disabled because support was not reported for the active model.",
  source: "unsupported",
}, "a missing support.parameters map must fail closed");
assert.equal(samplingParameterCapability({ top_p: { supported: "yes" } }, "top_p").supported, false, "only an exact supported=true declaration enables a control");
assert.throws(() => samplingParameterCapability({}, "missing"), /Unknown sampling parameter/);

function assertValid(key, rawValue, expected = rawValue) {
  assert.deepEqual(validateSamplingParameterValue(key, rawValue), { valid: true, value: expected }, `${key}=${String(rawValue)} should be valid`);
}

function assertInvalid(key, rawValue, pattern) {
  const result = validateSamplingParameterValue(key, rawValue);
  assert.equal(result.valid, false, `${key}=${String(rawValue)} should be invalid`);
  assert.match(result.error, pattern);
}

assertValid("temperature", 0);
assertValid("temperature", 2);
assertValid("temperature", " 1.25 ", 1.25);
assertValid("temperature", "1e-2", 0.01);
assertInvalid("temperature", -0.01, /0 to 2/);
assertInvalid("temperature", 2.01, /0 to 2/);
assertInvalid("temperature", "", /finite number/);
assertInvalid("temperature", "Infinity", /finite number/);
assertInvalid("temperature", Number.NaN, /finite number/);

assertValid("top_p", 0.01);
assertValid("top_p", 1);
assertInvalid("top_p", 0, /greater than 0 and at most 1/);
assertInvalid("top_p", 1.01, /greater than 0 and at most 1/);

for (const key of ["frequency_penalty", "presence_penalty"]) {
  assertValid(key, -2);
  assertValid(key, 2);
  assertInvalid(key, -2.1, /-2 to 2/);
  assertInvalid(key, 2.1, /-2 to 2/);
}

for (const key of ["seed", "top_k"]) {
  assertValid(key, -1);
  assertValid(key, 0);
  assertValid(key, 2147483648);
  assertInvalid(key, -2, /at least -1/);
  assertInvalid(key, 1.5, /integer/);
}

assertValid("min_p", 0);
assertValid("min_p", 1);
assertInvalid("min_p", -0.01, /0 to 1/);
assertInvalid("min_p", 1.01, /0 to 1/);
assertInvalid("missing", 1, /Unknown sampling parameter/);

assert.deepEqual(validateSamplingParameterObject({
  temperature: 0.5,
  top_p: 0.9,
  seed: 7,
  vendor_extension: { mode: "strict" },
}), { valid: true, errors: {} }, "direct JSON validation should accept valid catalog numbers and preserve unknown-key freedom");
assert.deepEqual(validateSamplingParameterObject({ temperature: "0.5", top_p: 0, seed: 1.5 }), {
  valid: false,
  errors: {
    temperature: "Temperature must be a number.",
    top_p: "Top P must be greater than 0 and at most 1.",
    seed: "Seed must be an integer.",
  },
}, "direct JSON validation should enforce numeric type, range, and integer catalog constraints");
assert.equal(validateSamplingParameterObject({ vendor_extension: [1, { enabled: true }] }).valid, true);
assert.equal(validateSamplingParameterObject([]).valid, false);

const sliderDraft = createSamplingControlDraft({ top_k: 1000, seed: -1, top_p: 0.5 });
assert.equal(samplingParameterSliderValue("top_k", sliderDraft.controls.top_k.value), 200, "the top_k slider should stop at its common maximum");
assert.equal(sliderDraft.controls.top_k.value, 1000, "calculating slider position must not clamp the exact number value");
assert.equal(samplingParameterSliderValue("seed", sliderDraft.controls.seed.value), 0, "seed -1 should remain exact while its slider rests at the common minimum");
assert.equal(sliderDraft.controls.seed.value, -1);
assert.equal(samplingParameterSliderValue("top_p", sliderDraft.controls.top_p.value), 0.5);
assert.equal(samplingParameterSliderValue("top_p", "not-a-number"), 0.01, "invalid input should use a safe visual slider position only");
assert.throws(() => samplingParameterSliderValue("missing", 1), /Unknown sampling parameter/);

const source = JSON.parse('{"temperature":0.4,"top_k":42,"vendor_mode":{"name":"fast","weights":[1,2]},"__proto__":{"polluted":true}}');
const split = splitSamplingParameters(source);
assert.deepEqual(split.known, { temperature: 0.4, top_k: 42 });
assert.deepEqual(split.unknown.vendor_mode, { name: "fast", weights: [1, 2] });
assert.equal(Object.hasOwn(split.unknown, "__proto__"), true, "a JSON __proto__ key should remain an inert own property");
assert.equal({}.polluted, undefined, "splitting untrusted JSON keys must not alter Object.prototype");
split.unknown.vendor_mode.weights.push(3);
assert.deepEqual(source.vendor_mode.weights, [1, 2], "split output should not alias API state");

assert.throws(() => splitSamplingParameters([]), /plain object/);
assert.throws(() => splitSamplingParameters(new (class Sampling {})()), /plain object/);
assert.throws(() => splitSamplingParameters({ custom: new Date() }), /plain object prototype/);
assert.throws(() => splitSamplingParameters({ custom: Number.NaN }), /finite JSON numbers/);
const circular = {};
circular.self = circular;
assert.throws(() => splitSamplingParameters(circular), /circular/);

const draft = createSamplingControlDraft(
  { temperature: 0.3, top_p: 0, vendor_flag: true, nested_vendor: { mode: "strict" } },
  { defaults: { temperature: 1, frequency_penalty: 0.5, seed: "invalid" } },
);
assert.equal(draft.controls.temperature.enabled, true);
assert.equal(draft.controls.temperature.value, 0.3, "an enabled session value should win over a model default");
assert.equal(draft.controls.top_p.enabled, true);
assert.equal(draft.controls.top_p.value, 0, "an invalid existing value should be retained for an explicit validation error");
assert.equal(draft.controls.frequency_penalty.enabled, false);
assert.equal(draft.controls.frequency_penalty.value, 0.5, "a valid model default may be shown as a disabled suggestion");
assert.equal(draft.controls.seed.enabled, false);
assert.equal(draft.controls.seed.value, "", "an invalid model default must not become an editable suggestion");
assert.equal(draft.controls.presence_penalty.value, "", "an absent parameter must not receive an invented value");
assert.deepEqual(draft.preservedUnknown, { vendor_flag: true, nested_vendor: { mode: "strict" } });

const invalidDraft = validateSamplingControlDraft(draft);
assert.equal(invalidDraft.valid, false);
assert.match(invalidDraft.errors.top_p, /greater than 0/);
assert.throws(
  () => buildSamplingParametersFromDraft(draft),
  (error) => error instanceof SamplingParameterValidationError
    && error.code === "SAMPLING_PARAMETERS_INVALID"
    && Boolean(error.errors.top_p),
  "invalid legacy values should block serialization instead of being silently clamped",
);

const editedDraft = structuredClone(draft);
editedDraft.controls.top_p.value = "0.9";
editedDraft.controls.temperature.enabled = false;
editedDraft.controls.frequency_penalty.enabled = true;
editedDraft.controls.frequency_penalty.value = "-1.2";
editedDraft.controls.top_k.enabled = true;
editedDraft.controls.top_k.value = "1000";
const validDraft = validateSamplingControlDraft(editedDraft);
assert.deepEqual(validDraft, {
  valid: true,
  errors: {},
  values: { top_p: 0.9, frequency_penalty: -1.2, top_k: 1000 },
});
assert.deepEqual(buildSamplingParametersFromDraft(editedDraft), {
  vendor_flag: true,
  nested_vendor: { mode: "strict" },
  top_p: 0.9,
  frequency_penalty: -1.2,
  top_k: 1000,
}, "enabled known controls should merge over cloned hidden values while disabled known controls disappear");
assert.equal(draft.controls.temperature.enabled, true, "editing a cloned draft must not mutate the loaded draft");

const defensiveDraft = {
  controls: {
    temperature: { enabled: false, value: 1 },
    min_p: { enabled: true, value: 0.2 },
  },
  preservedUnknown: { temperature: 1.8, vendor: "kept" },
};
assert.deepEqual(buildSamplingParametersFromDraft(defensiveDraft), { vendor: "kept", min_p: 0.2 }, "known keys must be deleted from the preserved map before enabled controls are merged");
assert.deepEqual(buildSamplingParametersFromDraft({ controls: {}, preservedUnknown: {} }), {});
assert.equal(validateSamplingControlDraft({ controls: { seed: { enabled: "yes", value: 1 } }, preservedUnknown: {} }).valid, false);
assert.equal(validateSamplingControlDraft({ controls: { seed: 1 }, preservedUnknown: {} }).valid, false);
assert.equal(validateSamplingControlDraft(null).valid, false);
assert.equal(validateSamplingControlDraft({ controls: {}, preservedUnknown: [] }).valid, false);

const hiddenProto = JSON.parse('{"__proto__":{"polluted":true},"custom":7}');
const protoOutput = buildSamplingParametersFromDraft({ controls: {}, preservedUnknown: hiddenProto });
assert.equal(Object.hasOwn(protoOutput, "__proto__"), true);
assert.equal(protoOutput.custom, 7);
assert.equal({}.polluted, undefined, "serializing hidden keys must remain prototype-safe");

assert.deepEqual(summarizePreservedSamplingParameters({}), {
  count: 0,
  text: "No additional parameters are preserved outside this editor.",
});
assert.deepEqual(summarizePreservedSamplingParameters({ vendor: true }), {
  count: 1,
  text: "1 additional parameter is preserved outside this editor.",
});
assert.deepEqual(summarizePreservedSamplingParameters({ one: 1, two: 2 }), {
  count: 2,
  text: "2 additional parameters are preserved outside this editor.",
});
assert.doesNotMatch(summarizePreservedSamplingParameters({ secret_vendor_key: true }).text, /secret_vendor_key/, "the summary should not expose hidden JSON keys");

const equivalentA = createSamplingControlDraft({ temperature: 1, custom: { b: 2, a: 1 } });
const equivalentB = createSamplingControlDraft({ custom: { a: 1, b: 2 }, temperature: 1 });
equivalentB.controls.temperature.value = "1.0";
assert.equal(samplingControlDraftEquals(equivalentA, equivalentB), true, "numeric text and hidden object key order should not create a dirty draft");
equivalentB.controls.temperature.value = "1.1";
assert.equal(samplingControlDraftEquals(equivalentA, equivalentB), false);
equivalentB.controls.temperature.enabled = false;
assert.equal(samplingControlDraftEquals(equivalentA, equivalentB), false, "enabled state is part of draft meaning");
const invalidA = createSamplingControlDraft({});
const invalidB = createSamplingControlDraft({});
invalidA.controls.temperature.enabled = true;
invalidB.controls.temperature.enabled = true;
invalidA.controls.temperature.value = "bad-a";
invalidB.controls.temperature.value = "bad-b";
assert.equal(samplingControlDraftEquals(invalidA, invalidB), false, "distinct invalid edits must remain distinguishable");

console.log("sampling-parameter-controls.test.mjs passed");
