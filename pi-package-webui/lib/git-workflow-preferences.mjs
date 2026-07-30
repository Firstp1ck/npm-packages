import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { normalizeSubagentLaunchSlots } from "./subagent-launch-slots.mjs";
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

const WEBUI_SETTINGS_VERSION = 4;
const WEBUI_SETTINGS_FILE_ENV = "PI_WEBUI_SETTINGS_FILE";
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
    },
    commit: {
      language: "en",
      defaultVariant: "short",
      scope: "auto",
    },
    stagingPolicy: "review",
    deliveryMode: "ask",
    verificationPolicy: "ask",
  };
}

export function normalizeGitWorkflowPreferences(value) {
  const defaults = defaultGitWorkflowPreferences();
  const provider = cleanBoundedString(value?.generation?.provider, 160);
  const modelId = cleanBoundedString(value?.generation?.modelId, 512);
  return {
    setupVersion: provider && modelId ? GIT_WORKFLOW_SETUP_VERSION : 0,
    generation: {
      provider,
      modelId,
      thinkingLevel: choice(value?.generation?.thinkingLevel, GIT_WORKFLOW_THINKING_LEVELS, defaults.generation.thinkingLevel),
      unavailablePolicy: choice(value?.generation?.unavailablePolicy, GIT_WORKFLOW_UNAVAILABLE_POLICIES, defaults.generation.unavailablePolicy),
    },
    commit: {
      language: choice(value?.commit?.language, GIT_WORKFLOW_LANGUAGES, defaults.commit.language),
      defaultVariant: choice(value?.commit?.defaultVariant, GIT_WORKFLOW_DEFAULT_VARIANTS, defaults.commit.defaultVariant),
      scope: choice(value?.commit?.scope, GIT_WORKFLOW_SCOPE_POLICIES, defaults.commit.scope),
    },
    stagingPolicy: choice(value?.stagingPolicy, GIT_WORKFLOW_STAGING_POLICIES, defaults.stagingPolicy),
    deliveryMode: choice(value?.deliveryMode, GIT_WORKFLOW_DELIVERY_MODES, defaults.deliveryMode),
    verificationPolicy: choice(value?.verificationPolicy, GIT_WORKFLOW_VERIFICATION_POLICIES, defaults.verificationPolicy),
  };
}

export function mergeGitWorkflowPreferences(current, patch) {
  const base = normalizeGitWorkflowPreferences(current);
  return normalizeGitWorkflowPreferences({
    ...base,
    ...(patch || {}),
    generation: { ...base.generation, ...(patch?.generation || {}) },
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
  return [
    `Model: ${model}`,
    `Thinking: ${value.generation.thinkingLevel}`,
    `Commit: ${value.commit.language} · ${value.commit.defaultVariant} · scope ${value.commit.scope}`,
    `Staging: ${value.stagingPolicy}`,
    `Delivery: ${value.deliveryMode}`,
    `Verification: ${value.verificationPolicy}`,
  ].join("\n");
}

export function webuiSettingsFile(env = process.env) {
  if (env[WEBUI_SETTINGS_FILE_ENV]) return path.resolve(String(env[WEBUI_SETTINGS_FILE_ENV]).replace(/^~(?=$|[\\/])/, homedir()));
  const configRoot = env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(configRoot, "pi-webui", "settings.json");
}

function normalizeNameList(value) {
  if (!Array.isArray(value)) return null;
  const names = [];
  const seen = new Set();
  for (const item of value) {
    const name = cleanBoundedString(item, 256);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function normalizeResourceDefaults(value) {
  return {
    tools: {
      enabledTools: normalizeNameList(value?.tools?.enabledTools),
    },
    skills: {
      enabledSkills: normalizeNameList(value?.skills?.enabledSkills),
    },
  };
}

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
  return {
    ...source,
    version: normalizedSettingsVersion(source),
    remoteAuthEnabled: source.remoteAuthEnabled === true,
    outputModeDefault: normalizeOutputMode(source.outputModeDefault, OUTPUT_MODE_NORMAL),
    gitWorkflow: normalizeGitWorkflowPreferences(source.gitWorkflow),
    resourceDefaults: normalizeResourceDefaults(source.resourceDefaults),
    interfacePreferences: normalizeInterfacePreferences(source.interfacePreferences),
    subagentLaunchSlots: normalizeSubagentLaunchSlots(source.subagentLaunchSlots),
  };
}

async function readRawWebuiSettings(storageFile) {
  try {
    return settingsObject(JSON.parse(await readFile(storageFile, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Cannot read Pi Web UI settings at ${storageFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readWebuiSettings(storageFile = webuiSettingsFile(), { reportInvalidOutputMode = false } = {}) {
  const raw = await readRawWebuiSettings(storageFile);
  const normalized = normalizeWebuiSettings(raw);
  if (reportInvalidOutputMode && raw.outputModeDefault !== undefined && normalized.outputModeDefault !== raw.outputModeDefault) {
    console.warn(`Invalid persisted Web UI output mode ${JSON.stringify(raw.outputModeDefault)} in ${storageFile}; using ${OUTPUT_MODE_NORMAL}.`);
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
  return { settings: normalizeWebuiSettings(source), persistLaunchSlots };
}

async function writeMergedWebuiSettings(rawCurrent, patch, storageFile) {
  const { settings, persistLaunchSlots } = mergeWebuiSettings(rawCurrent, patch);
  const persisted = { ...settings };
  if (!persistLaunchSlots) delete persisted.subagentLaunchSlots;
  await mkdir(path.dirname(storageFile), { recursive: true });
  const temporaryFile = `${storageFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryFile, storageFile);
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
    const rawCurrent = await readRawWebuiSettings(storageFile);
    const current = normalizeWebuiSettings(rawCurrent);
    const patch = await updater(current);
    if (patch === undefined) return current;
    return writeMergedWebuiSettings(rawCurrent, patch, storageFile);
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
