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

const CONFIG_FILE_ENV = "PI_SAFETY_GUARD_CONFIG_FILE";
const TOP_LEVEL_KEYS = new Set(["version", "enabled", "categories", "protectedPaths", "contextLines"]);
const PROTECTED_PATH_KEYS = new Set(["write", "edit"]);
const CONTEXT_LINE_KEYS = new Set(["before", "after"]);

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
  };
}

export function normalizeSafetyGuardConfig(value) {
  const defaults = defaultSafetyGuardConfig();
  const input = isObject(value) ? value : {};
  const categories = isObject(input.categories) ? input.categories : {};
  const protectedPaths = isObject(input.protectedPaths) ? input.protectedPaths : {};
  const contextLines = isObject(input.contextLines) ? input.contextLines : {};

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
  ].join("\n");
}
