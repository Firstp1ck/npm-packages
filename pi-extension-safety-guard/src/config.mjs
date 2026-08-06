import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const SAFETY_GUARD_CONFIG_VERSION = 1;
export const SAFETY_GUARD_CATEGORIES = Object.freeze([
  "git",
  "filesystem",
  "docker",
  "package",
  "system",
  "database",
  "secrets",
]);
export const SAFETY_GUARD_CONTEXT_LINES_MIN = 0;
export const SAFETY_GUARD_CONTEXT_LINES_MAX = 20;
export const SAFETY_GUARD_CONTEXT_LINES_DEFAULT = 3;
export const SAFETY_GUARD_THINKING_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const CONFIG_FILE_ENV = "PI_SAFETY_GUARD_CONFIG_FILE";
const MODEL_IDENTITY_MAX_CHARS = 256;
const TOP_LEVEL_KEYS = new Set(["version", "enabled", "categories", "protectedPaths", "contextLines", "autoReview"]);
const PROTECTED_PATH_KEYS = new Set(["write", "edit"]);
const CONTEXT_LINE_KEYS = new Set(["before", "after"]);
const AUTO_REVIEW_KEYS = new Set(["enabled", "model"]);
const AUTO_REVIEW_MODEL_KEYS = new Set(["provider", "modelId", "thinkingLevel"]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizedBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizedContextLineCount(value, fallback = SAFETY_GUARD_CONTEXT_LINES_DEFAULT) {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(SAFETY_GUARD_CONTEXT_LINES_MIN, Math.min(SAFETY_GUARD_CONTEXT_LINES_MAX, value));
}

function normalizedIdentity(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MODEL_IDENTITY_MAX_CHARS || /[\u0000-\u001f\u007f]/u.test(trimmed)) return "";
  return trimmed;
}

function normalizedThinkingLevel(value) {
  return SAFETY_GUARD_THINKING_LEVELS.includes(value) ? value : "off";
}

export function defaultSafetyGuardConfig() {
  return {
    version: SAFETY_GUARD_CONFIG_VERSION,
    enabled: true,
    categories: Object.fromEntries(SAFETY_GUARD_CATEGORIES.map((category) => [category, true])),
    protectedPaths: {
      write: true,
      edit: true,
    },
    contextLines: {
      before: SAFETY_GUARD_CONTEXT_LINES_DEFAULT,
      after: SAFETY_GUARD_CONTEXT_LINES_DEFAULT,
    },
    autoReview: {
      enabled: false,
      model: {
        provider: "",
        modelId: "",
        thinkingLevel: "off",
      },
    },
  };
}

export function normalizeSafetyGuardConfig(value) {
  const defaults = defaultSafetyGuardConfig();
  const input = isObject(value) ? value : {};
  const categories = isObject(input.categories) ? input.categories : {};
  const protectedPaths = isObject(input.protectedPaths) ? input.protectedPaths : {};
  const contextLines = isObject(input.contextLines) ? input.contextLines : {};
  const autoReview = isObject(input.autoReview) ? input.autoReview : {};
  const autoReviewModel = isObject(autoReview.model) ? autoReview.model : {};

  return {
    version: SAFETY_GUARD_CONFIG_VERSION,
    enabled: normalizedBoolean(input.enabled, defaults.enabled),
    categories: Object.fromEntries(SAFETY_GUARD_CATEGORIES.map((category) => [
      category,
      normalizedBoolean(categories[category], defaults.categories[category]),
    ])),
    protectedPaths: {
      write: normalizedBoolean(protectedPaths.write, defaults.protectedPaths.write),
      edit: normalizedBoolean(protectedPaths.edit, defaults.protectedPaths.edit),
    },
    contextLines: {
      before: normalizedContextLineCount(contextLines.before, defaults.contextLines.before),
      after: normalizedContextLineCount(contextLines.after, defaults.contextLines.after),
    },
    autoReview: {
      enabled: normalizedBoolean(autoReview.enabled, defaults.autoReview.enabled),
      model: {
        provider: normalizedIdentity(autoReviewModel.provider),
        modelId: normalizedIdentity(autoReviewModel.modelId),
        thinkingLevel: normalizedThinkingLevel(autoReviewModel.thinkingLevel),
      },
    },
  };
}

export function mergeSafetyGuardConfig(current, patch) {
  const base = normalizeSafetyGuardConfig(current);
  const input = isObject(patch) ? patch : {};
  return normalizeSafetyGuardConfig({
    ...base,
    ...input,
    categories: { ...base.categories, ...(isObject(input.categories) ? input.categories : {}) },
    protectedPaths: { ...base.protectedPaths, ...(isObject(input.protectedPaths) ? input.protectedPaths : {}) },
    contextLines: { ...base.contextLines, ...(isObject(input.contextLines) ? input.contextLines : {}) },
    autoReview: {
      ...base.autoReview,
      ...(isObject(input.autoReview) ? input.autoReview : {}),
      model: {
        ...base.autoReview.model,
        ...(isObject(input.autoReview) && isObject(input.autoReview.model) ? input.autoReview.model : {}),
      },
    },
  });
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown safety guard setting: ${label}${key}`);
  }
}

function assertOptionalBoolean(value, key) {
  if (value !== undefined && typeof value !== "boolean") throw new TypeError(`${key} must be true or false`);
}

function assertOptionalIdentity(value, key) {
  if (value === undefined) return;
  if (typeof value !== "string" || value !== value.trim() || value.length > MODEL_IDENTITY_MAX_CHARS || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${key} must be a trimmed string of at most ${MODEL_IDENTITY_MAX_CHARS} characters`);
  }
}

export function assertSafetyGuardConfigPatch(value) {
  if (!isObject(value)) throw new TypeError("Safety guard settings must be an object");
  assertKnownKeys(value, TOP_LEVEL_KEYS, "");
  if (value.version !== undefined && value.version !== SAFETY_GUARD_CONFIG_VERSION) {
    throw new TypeError(`version must be ${SAFETY_GUARD_CONFIG_VERSION}`);
  }
  assertOptionalBoolean(value.enabled, "enabled");

  if (value.categories !== undefined) {
    if (!isObject(value.categories)) throw new TypeError("categories must be an object");
    assertKnownKeys(value.categories, new Set(SAFETY_GUARD_CATEGORIES), "categories.");
    for (const category of SAFETY_GUARD_CATEGORIES) assertOptionalBoolean(value.categories[category], `categories.${category}`);
  }

  if (value.protectedPaths !== undefined) {
    if (!isObject(value.protectedPaths)) throw new TypeError("protectedPaths must be an object");
    assertKnownKeys(value.protectedPaths, PROTECTED_PATH_KEYS, "protectedPaths.");
    assertOptionalBoolean(value.protectedPaths.write, "protectedPaths.write");
    assertOptionalBoolean(value.protectedPaths.edit, "protectedPaths.edit");
  }

  if (value.contextLines !== undefined) {
    if (!isObject(value.contextLines)) throw new TypeError("contextLines must be an object");
    assertKnownKeys(value.contextLines, CONTEXT_LINE_KEYS, "contextLines.");
    for (const key of CONTEXT_LINE_KEYS) {
      const count = value.contextLines[key];
      if (count === undefined) continue;
      if (!Number.isInteger(count) || count < SAFETY_GUARD_CONTEXT_LINES_MIN || count > SAFETY_GUARD_CONTEXT_LINES_MAX) {
        throw new TypeError(`contextLines.${key} must be an integer from ${SAFETY_GUARD_CONTEXT_LINES_MIN} to ${SAFETY_GUARD_CONTEXT_LINES_MAX}`);
      }
    }
  }

  if (value.autoReview !== undefined) {
    if (!isObject(value.autoReview)) throw new TypeError("autoReview must be an object");
    assertKnownKeys(value.autoReview, AUTO_REVIEW_KEYS, "autoReview.");
    assertOptionalBoolean(value.autoReview.enabled, "autoReview.enabled");
    if (value.autoReview.model !== undefined) {
      if (!isObject(value.autoReview.model)) throw new TypeError("autoReview.model must be an object");
      assertKnownKeys(value.autoReview.model, AUTO_REVIEW_MODEL_KEYS, "autoReview.model.");
      assertOptionalIdentity(value.autoReview.model.provider, "autoReview.model.provider");
      assertOptionalIdentity(value.autoReview.model.modelId, "autoReview.model.modelId");
      if (value.autoReview.model.thinkingLevel !== undefined && !SAFETY_GUARD_THINKING_LEVELS.includes(value.autoReview.model.thinkingLevel)) {
        throw new TypeError(`autoReview.model.thinkingLevel must be one of: ${SAFETY_GUARD_THINKING_LEVELS.join(", ")}`);
      }
    }
  }
}

export function safetyGuardConfigFile(env = process.env) {
  const configured = env[CONFIG_FILE_ENV];
  if (configured) {
    const expanded = String(configured).replace(/^~(?=$|[\\/])/, homedir());
    return path.resolve(expanded);
  }
  return path.join(homedir(), ".pi", "agent", "safety-guard.json");
}

export function readSafetyGuardConfig(storageFile = safetyGuardConfigFile()) {
  try {
    return normalizeSafetyGuardConfig(JSON.parse(fs.readFileSync(storageFile, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return defaultSafetyGuardConfig();
    throw new Error(`Cannot read safety guard settings at ${storageFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeSafetyGuardConfig(patch, storageFile = safetyGuardConfigFile()) {
  assertSafetyGuardConfigPatch(patch);
  const next = mergeSafetyGuardConfig(readSafetyGuardConfig(storageFile), patch);
  fs.mkdirSync(path.dirname(storageFile), { recursive: true });
  const temporaryFile = `${storageFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryFile, storageFile);
  } catch (error) {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {
      // Preserve the original write failure.
    }
    throw error;
  }
  return next;
}

export function safetyGuardConfigSummary(value) {
  const config = normalizeSafetyGuardConfig(value);
  const enabledCategories = SAFETY_GUARD_CATEGORIES.filter((category) => config.categories[category]);
  return [
    `Guard: ${config.enabled ? "enabled" : "disabled"}`,
    `Command categories: ${enabledCategories.length ? enabledCategories.join(", ") : "none"}`,
    `Protected paths: write ${config.protectedPaths.write ? "on" : "off"}, edit ${config.protectedPaths.edit ? "on" : "off"}`,
    `Command preview: ${config.contextLines.before} lines before, ${config.contextLines.after} lines after`,
    `Auto-review: ${config.autoReview.enabled ? `${config.autoReview.model.provider || "unconfigured"}/${config.autoReview.model.modelId || "unconfigured"} · thinking ${config.autoReview.model.thinkingLevel}` : "disabled"}`,
  ].join("\n");
}
