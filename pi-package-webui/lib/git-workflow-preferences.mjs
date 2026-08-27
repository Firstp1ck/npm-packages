import { mkdir, open, readFile, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeSubagentLaunchSlots } from "./subagent-launch-slots.mjs";
import { normalizeUiLayout } from "./ui-layout-settings.mjs";
import { normalizeResourceDefaults } from "./resource-selection.mjs";
import { normalizeOutputMode, OUTPUT_MODE_NORMAL } from "./webui-output-mode.mjs";

export const GIT_WORKFLOW_SETUP_VERSION = 1;
export const GIT_WORKFLOW_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const GIT_WORKFLOW_LANGUAGES = ["en", "de"];
export const GIT_WORKFLOW_DEFAULT_VARIANTS = ["short", "long"];
export const GIT_WORKFLOW_SCOPE_POLICIES = ["auto", "never", "required"];
export const GIT_WORKFLOW_STAGING_POLICIES = ["review", "preserve", "all"];
export const GIT_WORKFLOW_DELIVERY_MODES = ["ask", "current", "pr-worktree"];
export const GIT_WORKFLOW_VERIFICATION_POLICIES = ["ask", "none"];
export const GIT_WORKFLOW_UNAVAILABLE_POLICIES = ["ask"];

export function supportedGitWorkflowThinkingLevels(model) {
  if (!model?.reasoning) return ["off"];
  const mapping = model.thinkingLevelMap && typeof model.thinkingLevelMap === "object" ? model.thinkingLevelMap : {};
  return GIT_WORKFLOW_THINKING_LEVELS.filter((level) => {
    if (mapping[level] === null) return false;
    if (["xhigh", "max"].includes(level)) return typeof mapping[level] === "string";
    return true;
  });
}

const WEBUI_SETTINGS_VERSION = 8;
const WEBUI_SETTINGS_FILE_ENV = "PI_WEBUI_SETTINGS_FILE";
const WEBUI_SETTINGS_LOCK_TIMEOUT_MS = 2_000;
const WEBUI_SETTINGS_LOCK_RETRY_MS = 25;
const WEBUI_SETTINGS_LOCK_INVALID_RECORD_GRACE_MS = 1_000;
export const WEBUI_SIDE_PANEL_WIDTH_MIN_PX = 320;
export const WEBUI_SIDE_PANEL_WIDTH_MAX_PX = 4096;
const webuiSettingsUpdateQueues = new Map();

function cleanBoundedString(value, maxLength = 512) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function choice(value, choices, fallback) {
  const clean = cleanBoundedString(value, 64);
  return choices.includes(clean) ? clean : fallback;
}

export function defaultGitWorkflowPreferences() {
  return {
    setupVersion: 0,
    generation: {
      provider: "",
      modelId: "",
      thinkingLevel: "low",
      unavailablePolicy: "ask",
      fallback: {
        provider: "",
        modelId: "",
        thinkingLevel: "low",
      },
    },
    commit: {
      language: "en",
      defaultVariant: "short",
      scope: "auto",
    },
    stagingPolicy: "review",
    reviewProcessEnabled: true,
    deliveryMode: "ask",
    verificationPolicy: "ask",
  };
}

export function normalizeGitWorkflowPreferences(value) {
  const defaults = defaultGitWorkflowPreferences();
  const provider = cleanBoundedString(value?.generation?.provider, 160);
  const modelId = cleanBoundedString(value?.generation?.modelId, 512);
  const fallbackProvider = cleanBoundedString(value?.generation?.fallback?.provider, 160);
  const fallbackModelId = cleanBoundedString(value?.generation?.fallback?.modelId, 512);
  return {
    setupVersion: provider && modelId ? GIT_WORKFLOW_SETUP_VERSION : 0,
    generation: {
      provider,
      modelId,
      thinkingLevel: choice(value?.generation?.thinkingLevel, GIT_WORKFLOW_THINKING_LEVELS, defaults.generation.thinkingLevel),
      unavailablePolicy: choice(value?.generation?.unavailablePolicy, GIT_WORKFLOW_UNAVAILABLE_POLICIES, defaults.generation.unavailablePolicy),
      fallback: {
        provider: fallbackProvider,
        modelId: fallbackModelId,
        thinkingLevel: choice(value?.generation?.fallback?.thinkingLevel, GIT_WORKFLOW_THINKING_LEVELS, defaults.generation.fallback.thinkingLevel),
      },
    },
    commit: {
      language: choice(value?.commit?.language, GIT_WORKFLOW_LANGUAGES, defaults.commit.language),
      defaultVariant: choice(value?.commit?.defaultVariant, GIT_WORKFLOW_DEFAULT_VARIANTS, defaults.commit.defaultVariant),
      scope: choice(value?.commit?.scope, GIT_WORKFLOW_SCOPE_POLICIES, defaults.commit.scope),
    },
    stagingPolicy: choice(value?.stagingPolicy, GIT_WORKFLOW_STAGING_POLICIES, defaults.stagingPolicy),
    reviewProcessEnabled: typeof value?.reviewProcessEnabled === "boolean" ? value.reviewProcessEnabled : defaults.reviewProcessEnabled,
    deliveryMode: choice(value?.deliveryMode, GIT_WORKFLOW_DELIVERY_MODES, defaults.deliveryMode),
    verificationPolicy: choice(value?.verificationPolicy, GIT_WORKFLOW_VERIFICATION_POLICIES, defaults.verificationPolicy),
  };
}

export function mergeGitWorkflowPreferences(current, patch) {
  const base = normalizeGitWorkflowPreferences(current);
  return normalizeGitWorkflowPreferences({
    ...base,
    ...(patch || {}),
    generation: {
      ...base.generation,
      ...(patch?.generation || {}),
      fallback: { ...base.generation.fallback, ...(patch?.generation?.fallback || {}) },
    },
    commit: { ...base.commit, ...(patch?.commit || {}) },
  });
}

export function isGitWorkflowSetupComplete(preferences) {
  const normalized = normalizeGitWorkflowPreferences(preferences);
  return normalized.setupVersion === GIT_WORKFLOW_SETUP_VERSION && !!normalized.generation.provider && !!normalized.generation.modelId;
}

export function gitWorkflowPreferencesSummary(preferences) {
  const value = normalizeGitWorkflowPreferences(preferences);
  const model = isGitWorkflowSetupComplete(value) ? `${value.generation.provider}/${value.generation.modelId}` : "not configured";
  const fallback = value.generation.fallback.provider && value.generation.fallback.modelId
    ? `${value.generation.fallback.provider}/${value.generation.fallback.modelId} · ${value.generation.fallback.thinkingLevel}`
    : "disabled";
  return [
    `Model: ${model}`,
    `Thinking: ${value.generation.thinkingLevel}`,
    `Fallback: ${fallback}`,
    `Commit: ${value.commit.language} · ${value.commit.defaultVariant} · scope ${value.commit.scope}`,
    `Staging: ${value.stagingPolicy}`,
    `Review process: ${value.reviewProcessEnabled ? "enabled" : "disabled"}`,
    `Delivery: ${value.deliveryMode}`,
    `Verification: ${value.verificationPolicy}`,
  ].join("\n");
}

export function webuiSettingsFile(env = process.env) {
  if (env[WEBUI_SETTINGS_FILE_ENV]) return path.resolve(String(env[WEBUI_SETTINGS_FILE_ENV]).replace(/^~(?=$|[\\/])/, homedir()));
  return path.join(homedir(), ".pi", "webui", "settings.json");
}

export function legacyWebuiSettingsFile(env = process.env) {
  const configRoot = env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(configRoot, "pi-webui", "settings.json");
}

export { normalizeResourceDefaults } from "./resource-selection.mjs";

export function normalizeInterfacePreferences(value) {
  const rawSidePanelWidth = value?.sidePanelWidth;
  const sidePanelWidth = rawSidePanelWidth === null || rawSidePanelWidth === undefined ? Number.NaN : Number(rawSidePanelWidth);
  return {
    sidePanelWidth: Number.isFinite(sidePanelWidth)
      ? Math.max(WEBUI_SIDE_PANEL_WIDTH_MIN_PX, Math.min(WEBUI_SIDE_PANEL_WIDTH_MAX_PX, Math.round(sidePanelWidth)))
      : null,
  };
}

function settingsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedSettingsVersion(value) {
  const stored = Number.isInteger(value?.version) ? value.version : 0;
  return Math.max(WEBUI_SETTINGS_VERSION, stored, value?.subagentLaunchSlots !== undefined ? 5 : 0);
}

export function normalizeWebuiSettings(value) {
  const source = settingsObject(value);
  const storedVersion = Number.isInteger(source.version) ? source.version : 0;
  const resourceDefaultsSource = storedVersion >= 8
    ? source.resourceDefaults
    : { ...settingsObject(source.resourceDefaults), modelProfiles: [] };
  const interfacePreferences = normalizeInterfacePreferences(source.interfacePreferences);
  const legacyLayoutSource = source.uiLayout === undefined
    && interfacePreferences.sidePanelWidth !== null
    && (!Number.isInteger(source.version) || source.version < WEBUI_SETTINGS_VERSION)
    ? { version: 1 }
    : source.uiLayout;
  return {
    ...source,
    version: normalizedSettingsVersion(source),
    remoteAuthEnabled: source.remoteAuthEnabled === true,
    outputModeDefault: normalizeOutputMode(source.outputModeDefault, OUTPUT_MODE_NORMAL),
    gitWorkflow: normalizeGitWorkflowPreferences(source.gitWorkflow),
    resourceDefaults: normalizeResourceDefaults(resourceDefaultsSource),
    interfacePreferences,
    uiLayout: normalizeUiLayout(legacyLayoutSource, { legacySidePanelWidth: interfacePreferences.sidePanelWidth }),
    subagentLaunchSlots: normalizeSubagentLaunchSlots(source.subagentLaunchSlots),
  };
}

function settingsReadError(storageFile, error) {
  const wrapped = new Error(`Cannot read Pi Web UI settings at ${storageFile}: ${error instanceof Error ? error.message : String(error)}`);
  wrapped.code = "WEBUI_SETTINGS_READ_FAILED";
  wrapped.cause = error;
  return wrapped;
}

async function readRawWebuiSettings(storageFile, { missing = {} } = {}) {
  let text;
  try {
    text = await readFile(storageFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return missing;
    throw settingsReadError(storageFile, error);
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("settings must contain a JSON object");
    return parsed;
  } catch (error) {
    throw settingsReadError(storageFile, error);
  }
}

function isDefaultSettingsTarget(storageFile, env = process.env) {
  return !env[WEBUI_SETTINGS_FILE_ENV] && path.resolve(storageFile) === path.resolve(webuiSettingsFile(env));
}

async function ensurePrivateSettingsDirectory(storageFile) {
  await mkdir(path.dirname(storageFile), { recursive: true, mode: 0o700 });
}

function lockDirectoryFor(storageFile) {
  return `${storageFile}.lock`;
}

function lockOwnerIsDead(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function settingsLockRecordNameMetadata(name) {
  const match = name.match(/^(\d+)-(\d+)-[^/]+\.json$/);
  if (!match) return {};
  const ownerPid = Number(match[1]);
  const createdAt = Number(match[2]);
  return {
    ownerPid: Number.isSafeInteger(ownerPid) && ownerPid > 0 ? ownerPid : undefined,
    createdAt: Number.isSafeInteger(createdAt) && createdAt > 0 ? createdAt : undefined,
  };
}

async function readSettingsLockRecords(lockDirectory) {
  const names = (await readdir(lockDirectory)).filter((name) => name.endsWith(".json")).sort();
  const records = await Promise.all(names.map(async (name) => {
    const recordFile = path.join(lockDirectory, name);
    const nameMetadata = settingsLockRecordNameMetadata(name);
    try {
      const [value, fileStat] = await Promise.all([
        readFile(recordFile, "utf8").then((text) => JSON.parse(text)),
        stat(recordFile),
      ]);
      const valid = Number.isSafeInteger(value?.pid)
        && value.pid > 0
        && typeof value?.token === "string"
        && value.token.length > 0
        && ["pending", "active"].includes(value?.state);
      const createdAt = Number.isSafeInteger(value?.createdAt) && value.createdAt > 0
        ? value.createdAt
        : nameMetadata.createdAt;
      return {
        ...value,
        ownerPid: nameMetadata.ownerPid,
        createdAt,
        name,
        recordFile,
        mtimeMs: fileStat.mtimeMs,
        valid,
      };
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      const fileStat = await stat(recordFile).catch(() => undefined);
      return { ...nameMetadata, name, recordFile, mtimeMs: fileStat?.mtimeMs, valid: false };
    }
  }));
  return records.filter(Boolean);
}

async function renameWithWindowsRetry(source, target) {
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

async function writeSettingsLockRecord(recordFile, value) {
  const temporaryFile = `${recordFile}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  let handle;
  try {
    handle = await open(temporaryFile, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithWindowsRetry(temporaryFile, recordFile);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }
}

async function releaseSettingsLock(lockDirectory, recordFile) {
  await rm(recordFile, { force: true });
  await rmdir(lockDirectory).catch((error) => {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") throw error;
  });
}

export async function withWebuiSettingsLock(storageFile, operation, {
  timeoutMs = WEBUI_SETTINGS_LOCK_TIMEOUT_MS,
  retryMs = WEBUI_SETTINGS_LOCK_RETRY_MS,
} = {}) {
  await ensurePrivateSettingsDirectory(storageFile);
  const lockDirectory = lockDirectoryFor(storageFile);
  await mkdir(lockDirectory, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const createdAt = Date.now();
  const token = `${process.pid}-${createdAt}-${Math.random().toString(16).slice(2)}`;
  const recordFile = path.join(lockDirectory, `${token}.json`);
  const ownRecord = { pid: process.pid, token, state: "pending", createdAt };
  let handle;
  try {
    handle = await open(recordFile, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(ownRecord)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(recordFile, { force: true }).catch(() => {});
    throw error;
  }

  const deadline = Date.now() + Math.max(0, timeoutMs);
  let acquired = false;
  try {
    while (!acquired) {
      let records = await readSettingsLockRecords(lockDirectory);
      let removedStaleRecord = false;
      for (const record of records) {
        const ownerPid = record.valid ? record.pid : record.ownerPid;
        const ownerIsDead = lockOwnerIsDead(ownerPid);
        const recordAgeMs = Math.max(
          Number.isFinite(record.mtimeMs) ? Date.now() - record.mtimeMs : 0,
          Number.isSafeInteger(record.createdAt) ? Date.now() - record.createdAt : 0,
        );
        const invalidRecordIsStale = !record.valid
          && (ownerIsDead || recordAgeMs >= WEBUI_SETTINGS_LOCK_INVALID_RECORD_GRACE_MS);
        if ((record.valid && ownerIsDead) || invalidRecordIsStale) {
          await rm(record.recordFile, { force: true });
          removedStaleRecord = true;
        }
      }
      if (removedStaleRecord) continue;

      const active = records.filter((record) => record.valid && record.state === "active");
      if (active.length === 1 && active[0].token === token) {
        acquired = true;
        break;
      }
      if (active.length === 0 && records[0]?.token === token && records[0]?.valid) {
        ownRecord.state = "active";
        await writeSettingsLockRecord(recordFile, ownRecord);
        continue;
      }
      if (Date.now() >= deadline) {
        const timeoutError = new Error("Timed out waiting for the Pi Web UI settings lock");
        timeoutError.code = "WEBUI_SETTINGS_LOCK_TIMEOUT";
        throw timeoutError;
      }
      await delay(Math.max(1, Math.min(retryMs, deadline - Date.now())));
    }
    return await operation();
  } finally {
    await releaseSettingsLock(lockDirectory, recordFile);
  }
}

async function syncDirectoryBestEffort(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is unsupported on some platforms/filesystems.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writePrivateAtomicSettings(storageFile, value) {
  await ensurePrivateSettingsDirectory(storageFile);
  const temporaryFile = path.join(
    path.dirname(storageFile),
    `.${path.basename(storageFile)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryFile, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithWindowsRetry(temporaryFile, storageFile);
    await syncDirectoryBestEffort(path.dirname(storageFile));
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }
}

export async function migrateLegacyWebuiSettings(targetFile, legacyFile) {
  if (path.resolve(targetFile) === path.resolve(legacyFile)) return false;
  try {
    await readFile(targetFile, "utf8");
    return false;
  } catch (error) {
    if (error?.code !== "ENOENT") throw settingsReadError(targetFile, error);
  }
  let legacy;
  try {
    legacy = await readRawWebuiSettings(legacyFile, { missing: null });
  } catch {
    return false;
  }
  if (!legacy) return false;
  return withWebuiSettingsLock(targetFile, async () => {
    try {
      await readFile(targetFile, "utf8");
      return false;
    } catch (error) {
      if (error?.code !== "ENOENT") throw settingsReadError(targetFile, error);
    }
    const { settings, persistLaunchSlots, persistedUiLayout } = mergeWebuiSettings(legacy, {});
    const persisted = { ...settings, uiLayout: persistedUiLayout };
    if (!persistLaunchSlots) delete persisted.subagentLaunchSlots;
    await writePrivateAtomicSettings(targetFile, persisted);
    return true;
  });
}

async function ensureDefaultSettingsMigration(storageFile, env = process.env) {
  if (!isDefaultSettingsTarget(storageFile, env)) return false;
  return migrateLegacyWebuiSettings(storageFile, legacyWebuiSettingsFile(env));
}

export async function readWebuiSettings(storageFile = webuiSettingsFile(), { reportInvalidOutputMode = false } = {}) {
  await ensureDefaultSettingsMigration(storageFile);
  const raw = await readRawWebuiSettings(storageFile);
  const normalized = normalizeWebuiSettings(raw);
  if (reportInvalidOutputMode && raw.outputModeDefault !== undefined && normalized.outputModeDefault !== raw.outputModeDefault) {
    console.warn(`Invalid persisted Web UI output mode ${JSON.stringify(raw.outputModeDefault)}; using ${OUTPUT_MODE_NORMAL}.`);
  }
  return normalized;
}

function mergeWebuiSettings(rawCurrent, patch) {
  const raw = settingsObject(rawCurrent);
  const current = normalizeWebuiSettings(raw);
  const patchValue = settingsObject(patch);
  const hasLaunchSlotPatch = Object.hasOwn(patchValue, "subagentLaunchSlots");
  const persistLaunchSlots = raw.subagentLaunchSlots !== undefined || hasLaunchSlotPatch;
  const source = {
    ...raw,
    ...patchValue,
    gitWorkflow: patchValue.gitWorkflow
      ? mergeGitWorkflowPreferences(current.gitWorkflow, patchValue.gitWorkflow)
      : current.gitWorkflow,
    resourceDefaults: patchValue.resourceDefaults
      ? {
          ...current.resourceDefaults,
          ...patchValue.resourceDefaults,
          tools: { ...current.resourceDefaults.tools, ...(patchValue.resourceDefaults.tools || {}) },
          skills: { ...current.resourceDefaults.skills, ...(patchValue.resourceDefaults.skills || {}) },
        }
      : current.resourceDefaults,
    interfacePreferences: patchValue.interfacePreferences
      ? { ...current.interfacePreferences, ...patchValue.interfacePreferences }
      : current.interfacePreferences,
    uiLayout: Object.hasOwn(patchValue, "uiLayout")
      ? normalizeUiLayout(patchValue.uiLayout)
      : current.uiLayout,
  };
  if (persistLaunchSlots) {
    source.subagentLaunchSlots = hasLaunchSlotPatch
      ? normalizeSubagentLaunchSlots(patchValue.subagentLaunchSlots)
      : normalizeSubagentLaunchSlots(raw.subagentLaunchSlots);
    source.version = Math.max(5, Number.isInteger(raw.version) ? raw.version : 0);
  } else {
    delete source.subagentLaunchSlots;
    source.version = Math.max(WEBUI_SETTINGS_VERSION, Number.isInteger(raw.version) ? raw.version : 0);
  }
  const settings = normalizeWebuiSettings(source);
  const rawLayoutVersion = Number.isInteger(raw.uiLayout?.version) ? raw.uiLayout.version : 0;
  const persistedUiLayout = !Object.hasOwn(patchValue, "uiLayout") && rawLayoutVersion > settings.uiLayout.version
    ? raw.uiLayout
    : settings.uiLayout;
  return { settings, persistLaunchSlots, persistedUiLayout };
}

async function writeMergedWebuiSettings(rawCurrent, patch, storageFile) {
  const { settings, persistLaunchSlots, persistedUiLayout } = mergeWebuiSettings(rawCurrent, patch);
  const persisted = { ...settings, uiLayout: persistedUiLayout };
  if (!persistLaunchSlots) delete persisted.subagentLaunchSlots;
  await writePrivateAtomicSettings(storageFile, persisted);
  return settings;
}

/**
 * Applies a settings patch against the latest on-disk snapshot and writes it
 * atomically. Returning undefined from the updater avoids an unnecessary write.
 */
export function updateWebuiSettings(updater, storageFile = webuiSettingsFile()) {
  const queueKey = path.resolve(storageFile);
  const previous = webuiSettingsUpdateQueues.get(queueKey) || Promise.resolve();
  const currentUpdate = previous.catch(() => {}).then(async () => {
    await ensureDefaultSettingsMigration(storageFile);
    return withWebuiSettingsLock(storageFile, async () => {
      const rawCurrent = await readRawWebuiSettings(storageFile);
      const current = normalizeWebuiSettings(rawCurrent);
      const patch = await updater(current);
      if (patch === undefined) return current;
      return writeMergedWebuiSettings(rawCurrent, patch, storageFile);
    });
  });
  webuiSettingsUpdateQueues.set(queueKey, currentUpdate);
  return currentUpdate.finally(() => {
    if (webuiSettingsUpdateQueues.get(queueKey) === currentUpdate) webuiSettingsUpdateQueues.delete(queueKey);
  });
}

export async function writeWebuiSettings(patch, storageFile = webuiSettingsFile()) {
  return updateWebuiSettings(() => patch, storageFile);
}

export async function readGitWorkflowPreferences(storageFile = webuiSettingsFile()) {
  return (await readWebuiSettings(storageFile)).gitWorkflow;
}

export async function writeGitWorkflowPreferences(patch, storageFile = webuiSettingsFile()) {
  return (await writeWebuiSettings({ gitWorkflow: patch }, storageFile)).gitWorkflow;
}
