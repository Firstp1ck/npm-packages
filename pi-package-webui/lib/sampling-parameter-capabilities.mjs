import { SAMPLING_PARAMETER_KEYS } from "../public/sampling-parameter-controls.mjs";

export { SAMPLING_PARAMETER_KEYS };

export const BUILTIN_SAMPLING_APIS = Object.freeze([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "google-vertex",
  "bedrock-converse-stream",
  "mistral-conversations",
  "pi-messages",
]);

const LABELS = Object.freeze({
  temperature: "Temperature",
  top_p: "Top P",
  frequency_penalty: "Frequency Penalty",
  presence_penalty: "Presence Penalty",
  seed: "Seed",
  top_k: "Top K",
  min_p: "Min P",
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

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function activeAnthropicThinking(model, thinkingLevel) {
  return model?.reasoning === true && typeof thinkingLevel === "string" && thinkingLevel !== "off";
}

function unsupportedReason(api, key) {
  if (!api || !Object.hasOwn(API_KEYS, api)) {
    return `${LABELS[key]} is disabled because this provider has not declared support.`;
  }
  return `${api} does not declare ${LABELS[key]} support.`;
}

/** Resolve deterministic, per-key support from the active model contract. */
export function resolveSamplingParameterCapabilities(model, { thinkingLevel } = {}) {
  const api = typeof model?.api === "string" ? model.api : null;
  const declared = Object.hasOwn(API_KEYS, api) ? new Set(API_KEYS[api]) : new Set();
  const defaults = plainObject(model?.samplingParams) ? model.samplingParams : {};
  const parameters = {};

  for (const key of SAMPLING_PARAMETER_KEYS) {
    let supported = declared.has(key);
    let source = supported ? "api" : "unsupported";
    let reason = supported ? `Supported by ${api}.` : unsupportedReason(api, key);

    if (api === "openai-completions" && (key === "top_k" || key === "min_p") && Object.hasOwn(defaults, key)) {
      supported = true;
      source = "model";
      reason = `Supported by ${api} because the active model declares ${LABELS[key]}.`;
    }

    if (api === "anthropic-messages" && key === "temperature" && supported) {
      if (model?.compat?.supportsTemperature === false) {
        supported = false;
        source = "unsupported";
        reason = "Temperature is disabled because the active Anthropic model marks it unsupported.";
      } else if (activeAnthropicThinking(model, thinkingLevel)) {
        supported = false;
        source = "unsupported";
        reason = "Temperature is disabled while Anthropic extended thinking is active.";
      }
    }

    parameters[key] = { supported, reason, source };
  }

  return parameters;
}

export function filterSupportedSamplingParameters(values, parameters) {
  if (!plainObject(values)) return {};
  const filtered = {};
  for (const key of SAMPLING_PARAMETER_KEYS) {
    if (parameters?.[key]?.supported === true && Object.hasOwn(values, key)) filtered[key] = values[key];
  }
  return filtered;
}

function mergeNested(payload, property, additions) {
  const existing = plainObject(payload[property]) ? payload[property] : {};
  return { ...payload, [property]: { ...existing, ...additions } };
}

function anthropicPayloadHasThinking(payload) {
  const type = plainObject(payload.thinking) ? payload.thinking.type : undefined;
  return type === "enabled" || type === "adaptive";
}

/** Apply already-stored values to an API-native provider payload without mutating it. */
export function applySupportedSamplingParameters(payload, model, values, { thinkingLevel } = {}) {
  if (!plainObject(payload)) return undefined;
  const api = typeof model?.api === "string" ? model.api : null;
  const parameters = resolveSamplingParameterCapabilities(model, { thinkingLevel });
  const supported = filterSupportedSamplingParameters(values, parameters);
  if (Object.keys(supported).length === 0) return undefined;

  if (api === "anthropic-messages" && anthropicPayloadHasThinking(payload)) {
    delete supported.temperature;
    if (Object.keys(supported).length === 0) return undefined;
  }

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
      return mergeNested(payload, "config", {
        ...(Object.hasOwn(supported, "temperature") && { temperature: supported.temperature }),
        ...(Object.hasOwn(supported, "top_p") && { topP: supported.top_p }),
        ...(Object.hasOwn(supported, "top_k") && { topK: supported.top_k }),
        ...(Object.hasOwn(supported, "frequency_penalty") && { frequencyPenalty: supported.frequency_penalty }),
        ...(Object.hasOwn(supported, "presence_penalty") && { presencePenalty: supported.presence_penalty }),
        ...(Object.hasOwn(supported, "seed") && { seed: supported.seed }),
      });
    case "bedrock-converse-stream":
      return mergeNested(payload, "inferenceConfig", {
        ...(Object.hasOwn(supported, "temperature") && { temperature: supported.temperature }),
        ...(Object.hasOwn(supported, "top_p") && { topP: supported.top_p }),
      });
    case "pi-messages":
      return mergeNested(payload, "options", {
        ...(Object.hasOwn(supported, "temperature") && { temperature: supported.temperature }),
      });
    default:
      return undefined;
  }
}

export function samplingApiSupportsAnyParameter(model, options) {
  return Object.values(resolveSamplingParameterCapabilities(model, options)).some((capability) => capability.supported);
}
