// Sampling parameters shared by the backend (validation, profile merging) and the Pi-side helper
// extension (capability discovery and payload application). Support is declared per provider
// API from public provider contracts; anything not declared is preserved but never applied.

export const SAMPLING_KEYS = Object.freeze(["temperature", "top_p", "frequency_penalty", "presence_penalty", "seed", "top_k", "min_p"]);

export const SAMPLING_RANGES = Object.freeze({
  temperature: { min: 0, max: 2, integer: false, label: "Temperature" },
  top_p: { min: 0, max: 1, integer: false, label: "Top P" },
  frequency_penalty: { min: -2, max: 2, integer: false, label: "Frequency penalty" },
  presence_penalty: { min: -2, max: 2, integer: false, label: "Presence penalty" },
  seed: { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true, label: "Seed" },
  top_k: { min: 1, max: 1000, integer: true, label: "Top K" },
  min_p: { min: 0, max: 1, integer: false, label: "Min P" },
});

const API_KEYS = Object.freeze({
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
});

export const SAMPLING_APIS = Object.freeze(Object.keys(API_KEYS));

// Returns { key: { supported, reason } } for a provider API; unknown APIs support nothing.
export function samplingCapabilities(api, { thinkingActive = false } = {}) {
  const known = typeof api === "string" && Object.hasOwn(API_KEYS, api);
  const capabilities = {};
  for (const key of SAMPLING_KEYS) {
    let supported = known && API_KEYS[api].includes(key);
    let reason = "";
    if (!known) reason = api ? `${api} has not declared sampling support` : "no active model";
    else if (!supported) reason = `${api} does not accept ${SAMPLING_RANGES[key].label.toLowerCase()}`;
    if (supported && key === "temperature" && api === "anthropic-messages" && thinkingActive) {
      supported = false;
      reason = "Anthropic ignores temperature while extended thinking is on";
    }
    capabilities[key] = { supported, reason };
  }
  return capabilities;
}

// Validates a partial parameter object. Returns { values, problems }; values only contains
// accepted keys, and null removes a key. Nothing else survives.
export function validateSamplingParams(raw) {
  const values = {};
  const problems = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { values, problems: { params: "sampling parameters must be an object" } };
  for (const [key, value] of Object.entries(raw)) {
    if (!SAMPLING_KEYS.includes(key)) {
      problems[key] = "unknown parameter";
      continue;
    }
    if (value === null) {
      values[key] = null;
      continue;
    }
    const range = SAMPLING_RANGES[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems[key] = `${range.label} must be a number`;
      continue;
    }
    if (range.integer && !Number.isInteger(value)) {
      problems[key] = `${range.label} must be a whole number`;
      continue;
    }
    if (value < range.min || value > range.max) {
      problems[key] = `${range.label} must be between ${range.min} and ${range.max === Number.MAX_SAFE_INTEGER ? "2^53" : range.max}`;
      continue;
    }
    values[key] = value;
  }
  return { values, problems };
}

// Keeps only the supported keys of a value set.
export function supportedSamplingValues(values, capabilities) {
  const result = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (capabilities[key] && capabilities[key].supported && typeof value === "number") result[key] = value;
  }
  return result;
}

function withNested(payload, field, values) {
  if (Object.keys(values).length === 0) return undefined;
  const existing = payload[field] && typeof payload[field] === "object" && !Array.isArray(payload[field]) ? payload[field] : {};
  return { ...payload, [field]: { ...existing, ...values } };
}

// Places supported values into a provider payload. Returns undefined when nothing applies, which
// tells Pi to keep the payload unchanged.
export function applySamplingToPayload(payload, api, values, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const supported = supportedSamplingValues(values, samplingCapabilities(api, options));
  if (Object.keys(supported).length === 0) return undefined;
  switch (api) {
    case "openai-completions":
    case "openai-responses":
    case "azure-openai-responses":
    case "openai-codex-responses":
    case "anthropic-messages":
    case "mistral-conversations":
      return { ...payload, ...supported };
    case "google-generative-ai":
    case "google-vertex":
      return withNested(payload, "config", {
        ...(Object.hasOwn(supported, "temperature") ? { temperature: supported.temperature } : {}),
        ...(Object.hasOwn(supported, "top_p") ? { topP: supported.top_p } : {}),
        ...(Object.hasOwn(supported, "top_k") ? { topK: supported.top_k } : {}),
        ...(Object.hasOwn(supported, "frequency_penalty") ? { frequencyPenalty: supported.frequency_penalty } : {}),
        ...(Object.hasOwn(supported, "presence_penalty") ? { presencePenalty: supported.presence_penalty } : {}),
        ...(Object.hasOwn(supported, "seed") ? { seed: supported.seed } : {}),
      });
    case "bedrock-converse-stream":
      return withNested(payload, "inferenceConfig", {
        ...(Object.hasOwn(supported, "temperature") ? { temperature: supported.temperature } : {}),
        ...(Object.hasOwn(supported, "top_p") ? { topP: supported.top_p } : {}),
      });
    case "pi-messages":
      return withNested(payload, "options", Object.hasOwn(supported, "temperature") ? { temperature: supported.temperature } : {});
    default:
      return undefined;
  }
}
