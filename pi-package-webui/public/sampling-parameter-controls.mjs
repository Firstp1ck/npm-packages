const PARAMETER_DEFINITIONS = [
  {
    key: "temperature",
    label: "Temperature",
    kind: "number",
    group: "core",
    scopeLabel: "OpenAI-compatible core",
    description: "Controls randomness. A value of 0 is deterministic on common compatible servers.",
    min: 0,
    max: 2,
    step: 0.01,
    slider: { min: 0, max: 2, step: 0.01 },
  },
  {
    key: "top_p",
    label: "Top P",
    kind: "number",
    group: "core",
    scopeLabel: "OpenAI-compatible core",
    description: "Limits sampling to tokens inside the selected cumulative probability mass.",
    min: 0,
    minExclusive: true,
    max: 1,
    step: 0.01,
    slider: { min: 0.01, max: 1, step: 0.01 },
  },
  {
    key: "frequency_penalty",
    label: "Frequency penalty",
    kind: "number",
    group: "core",
    scopeLabel: "OpenAI-compatible core",
    description: "Adjusts repeated-token likelihood according to prior frequency.",
    min: -2,
    max: 2,
    step: 0.1,
    slider: { min: -2, max: 2, step: 0.1 },
  },
  {
    key: "presence_penalty",
    label: "Presence penalty",
    kind: "number",
    group: "core",
    scopeLabel: "OpenAI-compatible core",
    description: "Adjusts repeated-token likelihood according to whether a token appeared.",
    min: -2,
    max: 2,
    step: 0.1,
    slider: { min: -2, max: 2, step: 0.1 },
  },
  {
    key: "seed",
    label: "Seed",
    kind: "integer",
    group: "core",
    scopeLabel: "Provider-dependent core",
    description: "Requests repeatable sampling when supported. Common local servers use -1 for a random seed.",
    min: -1,
    step: 1,
    slider: { min: 0, max: 100000, step: 1 },
  },
  {
    key: "top_k",
    label: "Top K",
    kind: "integer",
    group: "server-extension",
    scopeLabel: "llama.cpp / vLLM extension",
    description: "Limits sampling to the most likely tokens. Common compatible servers use 0 to disable it.",
    min: -1,
    step: 1,
    slider: { min: 0, max: 200, step: 1 },
  },
  {
    key: "min_p",
    label: "Min P",
    kind: "number",
    group: "server-extension",
    scopeLabel: "llama.cpp / vLLM extension",
    description: "Filters tokens relative to the most likely token. Common compatible servers use 0 to disable it.",
    min: 0,
    max: 1,
    step: 0.01,
    slider: { min: 0, max: 1, step: 0.01 },
  },
];

function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    slider: Object.freeze({ ...definition.slider }),
  });
}

export const SAMPLING_PARAMETER_CATALOG = Object.freeze(PARAMETER_DEFINITIONS.map(freezeDefinition));
export const SAMPLING_PARAMETER_KEYS = Object.freeze(SAMPLING_PARAMETER_CATALOG.map(({ key }) => key));

const CATALOG_BY_KEY = new Map(SAMPLING_PARAMETER_CATALOG.map((definition) => [definition.key, definition]));
const NUMERIC_TEXT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export class SamplingParameterValidationError extends Error {
  constructor(message, errors = {}) {
    super(message);
    this.name = "SamplingParameterValidationError";
    this.code = "SAMPLING_PARAMETERS_INVALID";
    this.errors = errors;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Sampling parameter values must contain only finite JSON numbers.");
    return;
  }
  if (typeof value !== "object") throw new TypeError("Sampling parameters must contain only JSON-compatible values.");
  if (seen.has(value)) throw new TypeError("Sampling parameters must not contain circular values.");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    if (!isPlainObject(value)) throw new TypeError("Sampling parameter objects must use a plain object prototype.");
    for (const item of Object.values(value)) assertJsonValue(item, seen);
  }
  seen.delete(value);
}

function cloneJsonObject(value, label = "Sampling parameters") {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
  assertJsonValue(value);
  return JSON.parse(JSON.stringify(value));
}

function errorResult(message) {
  return { valid: false, error: message };
}

function numericValue(rawValue) {
  if (typeof rawValue === "number") return Number.isFinite(rawValue) ? rawValue : null;
  if (typeof rawValue !== "string") return null;
  const text = rawValue.trim();
  if (!text || !NUMERIC_TEXT_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function rangeMessage(definition) {
  const { label, min, minExclusive, max } = definition;
  if (min !== undefined && max !== undefined) {
    return minExclusive
      ? `${label} must be greater than ${min} and at most ${max}.`
      : `${label} must be from ${min} to ${max}.`;
  }
  if (min !== undefined) return minExclusive ? `${label} must be greater than ${min}.` : `${label} must be at least ${min}.`;
  if (max !== undefined) return `${label} must be at most ${max}.`;
  return `${label} is outside its accepted range.`;
}

export function samplingParameterDefinition(key) {
  return CATALOG_BY_KEY.get(String(key || "")) || null;
}

/**
 * Normalize one backend capability entry. Support is explicit: a missing or
 * malformed per-key map never inherits the legacy whole-API support flag.
 */
export function samplingParameterCapability(parameters, key) {
  const definition = samplingParameterDefinition(key);
  if (!definition) throw new RangeError(`Unknown sampling parameter: ${String(key)}.`);
  const entry = isPlainObject(parameters) && isPlainObject(parameters[key]) ? parameters[key] : null;
  const supported = entry?.supported === true;
  const suppliedReason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
  return {
    supported,
    reason: suppliedReason || (supported
      ? `${definition.label} is supported by the active model.`
      : `${definition.label} is disabled because support was not reported for the active model.`),
    source: typeof entry?.source === "string" && entry.source ? entry.source : supported ? "api" : "unsupported",
  };
}

/** Parse and validate a value from either API state or a native number input. */
export function validateSamplingParameterValue(key, rawValue, { requireNumber = false } = {}) {
  const definition = samplingParameterDefinition(key);
  if (!definition) return errorResult(`Unknown sampling parameter: ${String(key)}.`);
  if (requireNumber && typeof rawValue !== "number") return errorResult(`${definition.label} must be a number.`);
  const value = numericValue(rawValue);
  if (value === null) return errorResult(`${definition.label} must be a finite number.`);
  if (definition.kind === "integer" && !Number.isInteger(value)) {
    return errorResult(`${definition.label} must be an integer.`);
  }
  if (definition.min !== undefined) {
    if (definition.minExclusive ? value <= definition.min : value < definition.min) return errorResult(rangeMessage(definition));
  }
  if (definition.max !== undefined && value > definition.max) return errorResult(rangeMessage(definition));
  return { valid: true, value };
}

/** Validate catalog-known values from a direct JSON write without rejecting unknown keys. */
export function validateSamplingParameterObject(parameters) {
  if (!isPlainObject(parameters)) {
    return { valid: false, errors: { parameters: "Sampling parameters must be a plain object." } };
  }
  const errors = {};
  for (const definition of SAMPLING_PARAMETER_CATALOG) {
    if (!Object.hasOwn(parameters, definition.key)) continue;
    const result = validateSamplingParameterValue(definition.key, parameters[definition.key], { requireNumber: true });
    if (!result.valid) errors[definition.key] = result.error;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Return the slider's visual position without changing the exact number-input value.
 * Values outside the common slider range are represented at the nearest slider edge.
 */
export function samplingParameterSliderValue(key, rawValue) {
  const definition = samplingParameterDefinition(key);
  if (!definition) throw new RangeError(`Unknown sampling parameter: ${String(key)}.`);
  const result = validateSamplingParameterValue(key, rawValue);
  if (!result.valid) return definition.slider.min;
  return Math.min(definition.slider.max, Math.max(definition.slider.min, result.value));
}

/** Split a plain JSON object into catalog-known values and preserved hidden values. */
export function splitSamplingParameters(parameters = {}) {
  const source = cloneJsonObject(parameters);
  const known = {};
  const unknown = {};
  for (const [key, value] of Object.entries(source)) {
    if (CATALOG_BY_KEY.has(key)) known[key] = value;
    else Object.defineProperty(unknown, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return { known, unknown };
}

function validSuggestedValue(key, ...candidates) {
  for (const candidate of candidates) {
    const result = validateSamplingParameterValue(key, candidate);
    if (result.valid) return result.value;
  }
  return "";
}

/**
 * Create a UI draft from the session object. Disabled controls may show a valid model
 * default as a suggestion, but disabled values are never serialized.
 */
export function createSamplingControlDraft(parameters = {}, { defaults = {} } = {}) {
  const session = splitSamplingParameters(parameters);
  const modelDefaults = splitSamplingParameters(defaults);
  const controls = {};
  for (const definition of SAMPLING_PARAMETER_CATALOG) {
    const enabled = Object.hasOwn(session.known, definition.key);
    controls[definition.key] = {
      enabled,
      value: enabled
        ? session.known[definition.key]
        : validSuggestedValue(definition.key, modelDefaults.known[definition.key]),
    };
  }
  return {
    controls,
    preservedUnknown: session.unknown,
  };
}

export function validateSamplingControlDraft(draft) {
  const errors = {};
  const values = {};
  if (!isPlainObject(draft)) return { valid: false, errors: { draft: "Sampling control draft must be an object." }, values };
  if (!isPlainObject(draft.controls)) errors.controls = "Sampling control draft controls must be an object.";
  try {
    cloneJsonObject(draft.preservedUnknown ?? {}, "Preserved sampling parameters");
  } catch (error) {
    errors.preservedUnknown = error.message || String(error);
  }
  const controls = isPlainObject(draft.controls) ? draft.controls : {};
  for (const definition of SAMPLING_PARAMETER_CATALOG) {
    const control = controls[definition.key];
    if (control === undefined) continue;
    if (!isPlainObject(control)) {
      errors[definition.key] = `${definition.label} control state must be an object.`;
      continue;
    }
    if (typeof control.enabled !== "boolean") {
      errors[definition.key] = `${definition.label} enabled state must be a boolean.`;
      continue;
    }
    if (!control.enabled) continue;
    const result = validateSamplingParameterValue(definition.key, control.value);
    if (!result.valid) errors[definition.key] = result.error;
    else values[definition.key] = result.value;
  }
  return { valid: Object.keys(errors).length === 0, errors, values };
}

/** Build the direct JSON API object while preserving unknown values and deleting disabled known keys. */
export function buildSamplingParametersFromDraft(draft) {
  const validation = validateSamplingControlDraft(draft);
  if (!validation.valid) {
    throw new SamplingParameterValidationError(
      `Invalid sampling parameters: ${Object.values(validation.errors).join(" ")}`,
      validation.errors,
    );
  }
  const output = cloneJsonObject(draft.preservedUnknown ?? {}, "Preserved sampling parameters");
  for (const key of SAMPLING_PARAMETER_KEYS) delete output[key];
  for (const [key, value] of Object.entries(validation.values)) output[key] = value;
  return output;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparableDraft(draft) {
  const controls = {};
  const draftControls = isPlainObject(draft?.controls) ? draft.controls : {};
  for (const definition of SAMPLING_PARAMETER_CATALOG) {
    const control = isPlainObject(draftControls[definition.key]) ? draftControls[definition.key] : { enabled: false, value: "" };
    const enabled = control.enabled === true;
    const validation = enabled ? validateSamplingParameterValue(definition.key, control.value) : null;
    controls[definition.key] = {
      enabled,
      value: !enabled ? null : validation?.valid ? validation.value : String(control.value ?? ""),
    };
  }
  let preservedUnknown;
  try {
    preservedUnknown = cloneJsonObject(draft?.preservedUnknown ?? {}, "Preserved sampling parameters");
  } catch {
    preservedUnknown = { invalid: true };
  }
  return { controls, preservedUnknown };
}

/** Compare serialized meaning; equivalent numeric text such as 1 and "1.0" is equal. */
export function samplingControlDraftEquals(left, right) {
  return stableJson(comparableDraft(left)) === stableJson(comparableDraft(right));
}

export function summarizePreservedSamplingParameters(parameters = {}) {
  const preserved = cloneJsonObject(parameters, "Preserved sampling parameters");
  const count = Object.keys(preserved).length;
  return {
    count,
    text: count === 0
      ? "No additional parameters are preserved outside this editor."
      : `${count} additional ${count === 1 ? "parameter is" : "parameters are"} preserved outside this editor.`,
  };
}
