import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

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

const WEBUI_SETTINGS_VERSION = 3;
const WEBUI_SETTINGS_FILE_ENV = "PI_WEBUI_SETTINGS_FILE";

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

export function normalizeWebuiSettings(value) {
  return {
    version: WEBUI_SETTINGS_VERSION,
    remoteAuthEnabled: value?.remoteAuthEnabled === true,
    gitWorkflow: normalizeGitWorkflowPreferences(value?.gitWorkflow),
    resourceDefaults: normalizeResourceDefaults(value?.resourceDefaults),
  };
}

export async function readWebuiSettings(storageFile = webuiSettingsFile()) {
  try {
    return normalizeWebuiSettings(JSON.parse(await readFile(storageFile, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return normalizeWebuiSettings({});
    throw new Error(`Cannot read Pi Web UI settings at ${storageFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeWebuiSettings(patch, storageFile = webuiSettingsFile()) {
  const current = await readWebuiSettings(storageFile);
  const next = normalizeWebuiSettings({
    ...current,
    ...(patch || {}),
    gitWorkflow: patch?.gitWorkflow
      ? mergeGitWorkflowPreferences(current.gitWorkflow, patch.gitWorkflow)
      : current.gitWorkflow,
    resourceDefaults: patch?.resourceDefaults
      ? {
          ...current.resourceDefaults,
          ...patch.resourceDefaults,
          tools: { ...current.resourceDefaults.tools, ...(patch.resourceDefaults.tools || {}) },
          skills: { ...current.resourceDefaults.skills, ...(patch.resourceDefaults.skills || {}) },
        }
      : current.resourceDefaults,
  });
  await mkdir(path.dirname(storageFile), { recursive: true });
  const temporaryFile = `${storageFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryFile, storageFile);
  return next;
}

export async function readGitWorkflowPreferences(storageFile = webuiSettingsFile()) {
  return (await readWebuiSettings(storageFile)).gitWorkflow;
}

export async function writeGitWorkflowPreferences(patch, storageFile = webuiSettingsFile()) {
  return (await writeWebuiSettings({ gitWorkflow: patch }, storageFile)).gitWorkflow;
}
