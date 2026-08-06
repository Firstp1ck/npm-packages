import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const SESSION_SUMMARY_CONFIG_VERSION = 1;
export const SESSION_SUMMARY_CONFIG_ENV = "PI_SESSION_SUMMARY_CONFIG_FILE";
export const SESSION_SUMMARY_PROMPT_MAX_CHARS = 8 * 1024;
export const SESSION_SUMMARY_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export const DEFAULT_TITLE_PROMPT = "Create a short, specific title for the session. Keep the current title unless the primary goal or scope changed substantially.";
export const DEFAULT_SUMMARY_PROMPT = "Summarize the session in Markdown with the goal, key decisions, progress, important evidence, open risks, and next steps.";

const updateQueues = new Map();
const LOCK_TIMEOUT_MS = 2_000;
const LOCK_RETRY_MS = 25;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedString(value, fallback, maxLength = SESSION_SUMMARY_PROMPT_MAX_CHARS) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function boundedIdentity(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function thinkingLevel(value) {
  return SESSION_SUMMARY_THINKING_LEVELS.includes(value) ? value : "low";
}

function cadence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(20, Math.round(numeric))) : 3;
}

export function supportedSessionSummaryThinkingLevels(model) {
  if (!model?.reasoning) return ["off"];
  const mapping = model.thinkingLevelMap && typeof model.thinkingLevelMap === "object" ? model.thinkingLevelMap : {};
  return SESSION_SUMMARY_THINKING_LEVELS.filter((level) => {
    if (mapping[level] === null) return false;
    if (["xhigh", "max"].includes(level)) return typeof mapping[level] === "string";
    return true;
  });
}

export function defaultSessionSummaryPreferences() {
  return {
    version: SESSION_SUMMARY_CONFIG_VERSION,
    configured: false,
    enabled: false,
    model: {
      provider: "openai-codex",
      modelId: "gpt-5.6-luna",
      thinkingLevel: "low",
    },
    prompts: {
      title: DEFAULT_TITLE_PROMPT,
      summary: DEFAULT_SUMMARY_PROMPT,
    },
    input: { scope: "text-and-tool-names" },
    context: { injectLatest: false },
    title: { enabled: true, minSettledTurns: 3 },
  };
}

/** Normalize known fields while preserving unknown future fields at every schema level. */
export function normalizeSessionSummaryPreferences(value) {
  const source = objectValue(value);
  const defaults = defaultSessionSummaryPreferences();
  const model = objectValue(source.model);
  const prompts = objectValue(source.prompts);
  const input = objectValue(source.input);
  const context = objectValue(source.context);
  const title = objectValue(source.title);
  const supportedVersion = !Number.isInteger(source.version) || source.version <= SESSION_SUMMARY_CONFIG_VERSION;
  const hasConfiguredModel = typeof model.provider === "string" && !!model.provider.trim()
    && typeof model.modelId === "string" && !!model.modelId.trim();
  const configured = supportedVersion && source.configured === true && hasConfiguredModel;
  return {
    ...source,
    version: Math.max(SESSION_SUMMARY_CONFIG_VERSION, Number.isInteger(source.version) ? source.version : 0),
    configured,
    enabled: configured && source.enabled === true,
    model: {
      ...model,
      provider: boundedIdentity(model.provider, defaults.model.provider, 160),
      modelId: boundedIdentity(model.modelId, defaults.model.modelId, 512),
      thinkingLevel: thinkingLevel(model.thinkingLevel),
    },
    prompts: {
      ...prompts,
      title: boundedString(prompts.title, defaults.prompts.title),
      summary: boundedString(prompts.summary, defaults.prompts.summary),
    },
    input: { ...input, scope: "text-and-tool-names" },
    context: { ...context, injectLatest: context.injectLatest === true },
    title: {
      ...title,
      enabled: title.enabled !== false,
      minSettledTurns: cadence(title.minSettledTurns),
    },
  };
}

export function mergeSessionSummaryPreferences(current, patch) {
  const raw = objectValue(current);
  const next = objectValue(patch);
  return normalizeSessionSummaryPreferences({
    ...raw,
    ...next,
    model: { ...objectValue(raw.model), ...objectValue(next.model) },
    prompts: { ...objectValue(raw.prompts), ...objectValue(next.prompts) },
    input: { ...objectValue(raw.input), ...objectValue(next.input) },
    context: { ...objectValue(raw.context), ...objectValue(next.context) },
    title: { ...objectValue(raw.title), ...objectValue(next.title) },
  });
}

export function sessionSummaryConfigFile(env = process.env) {
  const configured = env[SESSION_SUMMARY_CONFIG_ENV];
  if (configured) return path.resolve(String(configured).replace(/^~(?=$|[\\/])/, homedir()));
  return path.join(homedir(), ".pi", "agent", "session-summary.json");
}

function readError(storageFile, error) {
  const wrapped = new Error(`Cannot read session-summary settings at ${storageFile}: ${error instanceof Error ? error.message : String(error)}`);
  wrapped.code = "SESSION_SUMMARY_CONFIG_READ_FAILED";
  wrapped.cause = error;
  return wrapped;
}

async function readRaw(storageFile, { missing = {} } = {}) {
  let text;
  try {
    text = await readFile(storageFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return missing;
    throw readError(storageFile, error);
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("configuration must contain a JSON object");
    return parsed;
  } catch (error) {
    throw readError(storageFile, error);
  }
}

function processIsDead(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

async function withConfigLock(storageFile, operation) {
  await mkdir(path.dirname(storageFile), { recursive: true, mode: 0o700 });
  const lockDirectory = `${storageFile}.lock`;
  const ownerFile = path.join(lockDirectory, "owner.json");
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 });
      await writeFile(ownerFile, `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`, { mode: 0o600 });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const owner = JSON.parse(await readFile(ownerFile, "utf8"));
        stale = processIsDead(owner?.pid);
      } catch {
        try {
          stale = Date.now() - (await stat(lockDirectory)).mtimeMs > LOCK_TIMEOUT_MS;
        } catch (statError) {
          if (statError?.code === "ENOENT") continue;
          throw statError;
        }
      }
      if (stale) {
        await rm(lockDirectory, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        const timeout = new Error("Timed out waiting for the session-summary configuration lock");
        timeout.code = "SESSION_SUMMARY_CONFIG_LOCK_TIMEOUT";
        throw timeout;
      }
      await delay(Math.max(1, Math.min(LOCK_RETRY_MS, deadline - Date.now())));
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

async function renameWithRetry(source, target) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (process.platform !== "win32" || !["EACCES", "EBUSY", "EPERM"].includes(error?.code)) throw error;
      await delay(25 * (attempt + 1));
    }
  }
  throw lastError;
}

async function writePrivateAtomic(storageFile, value) {
  await mkdir(path.dirname(storageFile), { recursive: true, mode: 0o700 });
  const temporaryFile = path.join(path.dirname(storageFile), `.${path.basename(storageFile)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  let handle;
  try {
    handle = await open(temporaryFile, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(temporaryFile, storageFile);
    const persisted = await open(storageFile, "r+");
    await persisted.chmod(0o600);
    await persisted.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readSessionSummaryPreferences(storageFile = sessionSummaryConfigFile()) {
  return normalizeSessionSummaryPreferences(await readRaw(storageFile));
}

export function updateSessionSummaryPreferences(updater, storageFile = sessionSummaryConfigFile()) {
  const key = path.resolve(storageFile);
  const previous = updateQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => withConfigLock(storageFile, async () => {
    const raw = await readRaw(storageFile);
    const normalized = normalizeSessionSummaryPreferences(raw);
    const patch = await updater(normalized);
    if (patch === undefined) return normalized;
    const merged = mergeSessionSummaryPreferences(raw, patch);
    await writePrivateAtomic(storageFile, merged);
    return merged;
  }));
  updateQueues.set(key, current);
  return current.finally(() => {
    if (updateQueues.get(key) === current) updateQueues.delete(key);
  });
}

export function writeSessionSummaryPreferences(patch, storageFile = sessionSummaryConfigFile()) {
  return updateSessionSummaryPreferences(() => patch, storageFile);
}

export function sessionSummaryPreferencesSummary(value) {
  const preferences = normalizeSessionSummaryPreferences(value);
  return [
    `Configured: ${preferences.configured ? "yes" : "no"}`,
    `Automatic generation: ${preferences.enabled ? "on" : "off"}`,
    `Model: ${preferences.model.provider}/${preferences.model.modelId}`,
    `Thinking: ${preferences.model.thinkingLevel}`,
    `Input: user/final-assistant text and tool names only`,
    `Context injection: ${preferences.context.injectLatest ? "latest only" : "off"}`,
    `Titles: ${preferences.title.enabled ? `on (minimum ${preferences.title.minSettledTurns} settled user turns)` : "off"}`,
  ].join("\n");
}
