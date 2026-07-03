import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CONVERSATION_STYLE_IDS, DEFAULT_CONVERSATION_STYLE } from "./conversation-controller.mjs";

export const VOICE_CONFIG_VERSION = 1;
export const PROTOCOL_VERSION = 1;

export const STT_PROVIDERS = Object.freeze(["local-endpoint", "groq", "openai"]);
export const TTS_PROVIDERS = Object.freeze(["local-endpoint", "piper", "espeak-ng", "openai"]);

export const DEFAULT_ACK_PHRASES = Object.freeze(["Got it, one second.", "Okay, let me check.", "One moment."]);

const value = (validate, fallback) => ({ kind: "value", validate, fallback });
const bool = (fallback) => value((v) => typeof v === "boolean", fallback);
const finite = (fallback, { min = -Infinity, max = Infinity } = {}) =>
  value((v) => Number.isFinite(v) && v >= min && v <= max, fallback);
const finiteOrNull = (fallback, opts) => {
  const inner = finite(fallback, opts);
  return value((v) => v === null || inner.validate(v), fallback);
};
const stringOrNull = (fallback) => value((v) => v === null || (typeof v === "string" && v.length <= 4096), fallback);
const oneOf = (choices, fallback) => value((v) => choices.includes(v), fallback);
const argvOrNull = (fallback) =>
  value((v) => v === null || (Array.isArray(v) && v.length > 0 && v.every((item) => typeof item === "string")), fallback);
const phraseArray = (fallback) =>
  value(
    (v) => Array.isArray(v) && v.length > 0 && v.length <= 8 && v.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 120),
    fallback,
  );
const toolNameArray = (fallback) =>
  value(
    (v) => Array.isArray(v) && v.length <= 32 && v.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 64),
    fallback,
  );
const isoOrNull = () => value((v) => v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v))), null);

const VOICE_CONFIG_SCHEMA = {
  kind: "object",
  fields: {
    version: value((v) => v === VOICE_CONFIG_VERSION, VOICE_CONFIG_VERSION),
    native: {
      kind: "object",
      fields: {
        enabled: bool(false),
        autoStartWithTalkOn: bool(true),
        capture: {
          kind: "object",
          fields: {
            tool: oneOf(["auto", "pw-record", "parecord", "arecord", "ffmpeg"], "auto"),
            command: argvOrNull(null),
            device: stringOrNull(null),
            sampleRateHz: finite(16000, { min: 8000, max: 48000 }),
          },
        },
        playback: {
          kind: "object",
          fields: {
            tool: oneOf(["auto", "pw-play", "paplay", "aplay", "ffplay"], "auto"),
            command: argvOrNull(null),
            device: stringOrNull(null),
          },
        },
        vad: {
          kind: "object",
          fields: {
            startDb: finite(9, { min: 1, max: 40 }),
            thresholdDb: finiteOrNull(null, { min: -70, max: 0 }),
            hangoverMs: finite(800, { min: 100, max: 5000 }),
            minSpeechMs: finite(300, { min: 50, max: 5000 }),
            maxUtteranceMs: finite(30000, { min: 1000, max: 120000 }),
            preRollMs: finite(300, { min: 0, max: 2000 }),
            engine: oneOf(["energy"], "energy"),
          },
        },
        stt: {
          kind: "object",
          fields: {
            provider: oneOf([...STT_PROVIDERS], "local-endpoint"),
            url: stringOrNull(null),
            language: stringOrNull("auto"),
            timeoutMs: finite(30000, { min: 1000, max: 120000 }),
          },
        },
        tts: {
          kind: "object",
          fields: {
            provider: oneOf([...TTS_PROVIDERS], "local-endpoint"),
            url: stringOrNull(null),
            modelPath: stringOrNull(null),
            voice: stringOrNull(null),
            rate: finite(1.0, { min: 0.5, max: 2.0 }),
            timeoutMs: finite(20000, { min: 1000, max: 120000 }),
            fallback: oneOf(["espeak-ng", "none"], "espeak-ng"),
            // Speak completed sentences while the answer is still streaming.
            // Falls back to final-answer-only speech automatically when the
            // host Pi does not emit message_update deltas.
            streamSentences: bool(true),
            // Keep one piper process alive with the model loaded (~100 ms per
            // sentence instead of ~800 ms). Exec-per-utterance when false.
            keepWarm: bool(true),
          },
        },
        headphones: bool(false),
        bargeIn: {
          kind: "object",
          fields: {
            enabled: bool(false),
            selfEchoOverlap: finite(0.6, { min: 0, max: 1 }),
            // Cancel TTS as soon as VAD confirms the user speaking. Only acted
            // on in headphones mode, where the mic cannot hear our playback.
            cancelOnSpeechStart: bool(true),
            // Sustained VOICED-speech time before speech counts as a real
            // barge-in (debounces coughs/keystrokes away from cancelOnSpeechStart).
            confirmMs: finite(250, { min: 0, max: 2000 }),
            // Barge-in frames must beat the start threshold by this many dB —
            // interrupting is deliberate, so it may demand a louder voice.
            marginDb: finite(5, { min: 0, max: 30 }),
          },
        },
        acknowledgement: {
          kind: "object",
          fields: {
            enabled: bool(false),
            delayMs: finite(700, { min: 200, max: 5000 }),
            phrases: phraseArray(DEFAULT_ACK_PHRASES),
          },
        },
        silence: {
          kind: "object",
          fields: {
            enabled: bool(true),
            timeoutMs: finite(8000, { min: 1000, max: 120000 }),
          },
        },
        allowRemoteProviders: bool(false),
      },
    },
    style: {
      kind: "object",
      fields: {
        preset: oneOf([...CONVERSATION_STYLE_IDS], DEFAULT_CONVERSATION_STYLE),
      },
    },
    tools: {
      kind: "object",
      fields: {
        // Extra tool names allowed in conversation mode on top of the
        // read-only defaults (read/grep/find/ls) — e.g. search tools from
        // other extensions. The tool-call guard still blocks everything else;
        // only add tools that cannot write or run commands.
        allow: toolNameArray([]),
      },
    },
    consent: {
      kind: "object",
      fields: {
        nativeAudioAcceptedAt: isoOrNull(),
        hostedSttAcceptedAt: isoOrNull(),
        hostedTtsAcceptedAt: isoOrNull(),
      },
    },
  },
};

function buildDefaults(node) {
  if (node.kind === "object") {
    const result = {};
    for (const [key, child] of Object.entries(node.fields)) result[key] = buildDefaults(child);
    return result;
  }
  return typeof node.fallback === "object" && node.fallback !== null ? structuredClone(node.fallback) : node.fallback;
}

export function defaultVoiceConfig() {
  return buildDefaults(VOICE_CONFIG_SCHEMA);
}

function validateNode(node, raw, path, warnings) {
  if (node.kind === "object") {
    const result = buildDefaults(node);
    if (raw === undefined || raw === null) return result;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      warnings.push(`${path || "config"}: expected an object; using defaults`);
      return result;
    }
    for (const [key, rawValue] of Object.entries(raw)) {
      const childPath = path ? `${path}.${key}` : key;
      const child = node.fields[key];
      if (!child) {
        warnings.push(`${childPath}: unknown key ignored`);
        continue;
      }
      result[key] = validateNode(child, rawValue, childPath, warnings);
    }
    return result;
  }
  if (raw === undefined) return buildDefaults(node);
  if (!node.validate(raw)) {
    warnings.push(`${path}: invalid value; using default`);
    return buildDefaults(node);
  }
  return Array.isArray(raw) ? [...raw] : raw;
}

/**
 * Validate a raw voice.json object. Unknown keys warn and are dropped (this
 * is also how "no secrets in config files" is enforced on save: only schema
 * keys survive). Invalid values fall back to defaults with a warning. An
 * unknown version refuses the file entirely and returns defaults.
 */
export function validateVoiceConfig(raw) {
  const warnings = [];
  if (raw === undefined || raw === null) return { config: defaultVoiceConfig(), warnings };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("voice.json is not an object; using defaults");
    return { config: defaultVoiceConfig(), warnings };
  }
  if (raw.version !== undefined && raw.version !== VOICE_CONFIG_VERSION) {
    warnings.push(`voice.json version ${raw.version} is not supported (expected ${VOICE_CONFIG_VERSION}); using defaults`);
    return { config: defaultVoiceConfig(), warnings };
  }
  const config = validateNode(VOICE_CONFIG_SCHEMA, raw, "", warnings);
  return { config, warnings };
}

export function voiceConfigPath(env = process.env) {
  if (typeof env.PI_VOICE_CONFIG_PATH === "string" && env.PI_VOICE_CONFIG_PATH.trim()) return env.PI_VOICE_CONFIG_PATH;
  return join(homedir(), ".pi", "agent", "voice.json");
}

export function loadVoiceConfig({ env = process.env, path } = {}) {
  const configPath = path ?? voiceConfigPath(env);
  let rawText;
  try {
    rawText = readFileSync(configPath, "utf8");
  } catch {
    return { config: defaultVoiceConfig(), warnings: [], path: configPath, exists: false };
  }
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return {
      config: defaultVoiceConfig(),
      warnings: [`${configPath} is not valid JSON; using defaults`],
      path: configPath,
      exists: true,
    };
  }
  const { config, warnings } = validateVoiceConfig(raw);
  return { config, warnings, path: configPath, exists: true };
}

/** Atomic write (temp file + rename), mode 0600, schema-sanitized. */
export function saveVoiceConfig(config, { env = process.env, path } = {}) {
  const configPath = path ?? voiceConfigPath(env);
  const { config: sanitized, warnings } = validateVoiceConfig(config);
  mkdirSync(dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, configPath);
  return { config: sanitized, warnings, path: configPath };
}

export function isLoopbackUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function safeEndpointLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "(invalid url)";
  }
}

export function hasNativeConsent(config) {
  return Boolean(config?.consent?.nativeAudioAcceptedAt);
}

/**
 * Resolve the runtime config handed to the companion in `hello`.
 * Env URLs win over voice.json. Enforces:
 * - non-loopback endpoint URLs require `native.allowRemoteProviders`;
 * - hosted providers require env API key + recorded hosted consent +
 *   `allowRemoteProviders` (never a silent fallback target).
 * Secrets are NOT copied into the resolved config; the companion reads keys
 * from its own environment.
 */
export function resolveRuntimeVoiceConfig(config, env = process.env) {
  const errors = [];
  const warnings = [];
  const native = structuredClone(config.native);
  const consent = config.consent ?? {};

  const sttUrl = (typeof env.PI_VOICE_STT_URL === "string" && env.PI_VOICE_STT_URL.trim()) || native.stt.url || null;
  const ttsUrl = (typeof env.PI_VOICE_TTS_URL === "string" && env.PI_VOICE_TTS_URL.trim()) || native.tts.url || null;
  native.stt.url = sttUrl;
  native.tts.url = ttsUrl;

  for (const [kind, provider, url] of [["stt", native.stt.provider, sttUrl], ["tts", native.tts.provider, ttsUrl]]) {
    if (provider === "local-endpoint") {
      if (url && !isLoopbackUrl(url) && !native.allowRemoteProviders) {
        errors.push(`${kind}: endpoint ${safeEndpointLabel(url)} is not loopback and allowRemoteProviders is false`);
      }
      continue;
    }
    if (provider === "espeak-ng" || provider === "piper") continue; // fully local exec providers
    // hosted providers (groq/openai)
    const keyName = provider === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY";
    const consentKey = kind === "stt" ? "hostedSttAcceptedAt" : "hostedTtsAcceptedAt";
    if (!native.allowRemoteProviders) errors.push(`${kind}: hosted provider '${provider}' requires allowRemoteProviders`);
    if (!consent[consentKey]) errors.push(`${kind}: hosted provider '${provider}' requires recorded consent (run /talk setup)`);
    if (!env[keyName]) errors.push(`${kind}: hosted provider '${provider}' requires ${keyName} in the environment`);
  }

  return { native, errors, warnings };
}
