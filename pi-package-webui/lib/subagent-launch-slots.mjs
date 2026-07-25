import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export const SUBAGENT_LAUNCH_SLOTS_VERSION = 1;
export const SUBAGENT_LAUNCH_SLOT_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const SUBAGENT_LAUNCH_SLOT_LIMITS = Object.freeze({
  slotsPerRole: 8,
  totalSlots: 32,
  slotIdLength: 160,
  modelIdLength: 240,
});

export const SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG = Object.freeze([
  { id: "context-builder", title: "Context builder", purpose: "Build focused context before delegation." },
  { id: "delegate", title: "Delegate", purpose: "Coordinate scoped delegation work." },
  { id: "oracle", title: "Oracle", purpose: "Resolve difficult design or implementation questions." },
  { id: "planner", title: "Planner", purpose: "Plan implementation work and acceptance checks." },
  { id: "researcher", title: "Researcher", purpose: "Research evidence and implementation options." },
  { id: "reviewer", title: "Reviewer", purpose: "Review implementation quality and correctness." },
  { id: "scout", title: "Scout", purpose: "Inspect repository context and constraints." },
  { id: "worker", title: "Worker", purpose: "Implement an assigned workstream." },
]);

const ROLE_IDS = new Set(SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG.map((role) => role.id));
const BASE_SLOT_IDS = new Set(SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG.map((role) => `${role.id}:base`));
const SLOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const THINKING_SUFFIX_PATTERN = /:(off|minimal|low|medium|high|xhigh|max)$/i;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactString(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength && value.trim() === value ? value : "";
}

export function subagentLaunchSlotBaseId(roleId) {
  return `${roleId}:base`;
}

export function subagentLaunchSlotModelKey(model) {
  return model?.provider && model?.id ? `${model.provider}/${model.id}` : "";
}

export function supportedSubagentLaunchSlotThinkingLevels(model) {
  if (!model?.reasoning) return ["off"];
  const mapping = isPlainObject(model.thinkingLevelMap) ? model.thinkingLevelMap : {};
  return SUBAGENT_LAUNCH_SLOT_THINKING_LEVELS.filter((level) => {
    if (mapping[level] === null) return false;
    if (["xhigh", "max"].includes(level)) return typeof mapping[level] === "string";
    return true;
  });
}

export function isCanonicalSubagentLaunchSlotModel(value) {
  const model = exactString(value, SUBAGENT_LAUNCH_SLOT_LIMITS.modelIdLength);
  if (!model || !model.includes("/") || /\s/.test(model) || THINKING_SUFFIX_PATTERN.test(model)) return false;
  const [provider, ...idParts] = model.split("/");
  return !!provider && idParts.join("/").length > 0;
}

function isSafeSlotId(value) {
  const id = exactString(value, SUBAGENT_LAUNCH_SLOT_LIMITS.slotIdLength);
  return !!id && SLOT_ID_PATTERN.test(id);
}

function normalizedSlot(value, fallbackId) {
  const raw = isPlainObject(value) ? value : {};
  const id = isSafeSlotId(raw.id) ? raw.id : fallbackId;
  const model = isCanonicalSubagentLaunchSlotModel(raw.model) ? raw.model : null;
  const thinking = SUBAGENT_LAUNCH_SLOT_THINKING_LEVELS.includes(raw.thinking) ? raw.thinking : null;
  return {
    id,
    model,
    thinking: model ? thinking : null,
  };
}

function normalizedRoleSlots(value, roleId) {
  const baseId = subagentLaunchSlotBaseId(roleId);
  const values = Array.isArray(value) ? value : [];
  const slots = [];
  const seen = new Set();
  let base = null;

  for (const value of values) {
    const rawId = isPlainObject(value) && isSafeSlotId(value.id) ? value.id : "";
    if (rawId === baseId && !base) base = normalizedSlot(value, baseId);
  }
  slots.push(base || normalizedSlot({}, baseId));
  seen.add(baseId);

  for (const value of values) {
    const slot = normalizedSlot(value, "");
    if (!slot.id || slot.id === baseId || BASE_SLOT_IDS.has(slot.id) || seen.has(slot.id)) continue;
    if (slots.length >= SUBAGENT_LAUNCH_SLOT_LIMITS.slotsPerRole) break;
    seen.add(slot.id);
    slots.push(slot);
  }
  return slots;
}

export function defaultSubagentLaunchSlotRoles() {
  return Object.fromEntries(SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG.map((role) => [
    role.id,
    [{ id: subagentLaunchSlotBaseId(role.id), model: null, thinking: null }],
  ]));
}

export function normalizeSubagentLaunchSlotRoles(value) {
  const rawRoles = isPlainObject(value) ? value : {};
  const normalizedByRole = new Map(SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG.map((role) => [
    role.id,
    normalizedRoleSlots(rawRoles[role.id], role.id),
  ]));
  const roles = {};
  const seen = new Set();
  for (const role of SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG) {
    const base = normalizedByRole.get(role.id)[0];
    roles[role.id] = [base];
    seen.add(base.id);
  }

  let remaining = SUBAGENT_LAUNCH_SLOT_LIMITS.totalSlots - seen.size;
  for (const role of SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG) {
    const slots = roles[role.id];
    for (const slot of normalizedByRole.get(role.id).slice(1)) {
      if (remaining <= 0 || seen.has(slot.id)) continue;
      seen.add(slot.id);
      remaining -= 1;
      slots.push(slot);
    }
  }
  return roles;
}

function normalizeScopeEntry(value) {
  return { roles: normalizeSubagentLaunchSlotRoles(value?.roles) };
}

function isSafeProjectKey(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 4096
    && path.isAbsolute(value)
    && !value.includes("\0");
}

export function normalizeSubagentLaunchSlots(value) {
  const source = isPlainObject(value) ? value : {};
  const projects = {};
  if (isPlainObject(source.projects)) {
    for (const projectKey of Object.keys(source.projects).sort()) {
      if (!isSafeProjectKey(projectKey) || !isPlainObject(source.projects[projectKey])) continue;
      projects[projectKey] = normalizeScopeEntry(source.projects[projectKey]);
    }
  }
  return {
    version: SUBAGENT_LAUNCH_SLOTS_VERSION,
    user: normalizeScopeEntry(source.user),
    projects,
  };
}

export function subagentLaunchSlotScopeEntry(config, scope, projectKey) {
  const normalized = normalizeSubagentLaunchSlots(config);
  if (scope === "user") return { entry: normalized.user, inherited: false };
  if (scope !== "project") throw new Error("scope must be user or project");
  if (!isSafeProjectKey(projectKey)) throw new Error("projectKey must be an absolute canonical path");
  const entry = normalized.projects[projectKey];
  return { entry: entry || normalized.user, inherited: !entry };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function subagentLaunchSlotRevision(config, scope, projectKey) {
  const normalized = normalizeSubagentLaunchSlots(config);
  let revisionValue;
  if (scope === "user") {
    revisionValue = { scope: "user", entry: normalized.user };
  } else if (scope === "project") {
    if (!isSafeProjectKey(projectKey)) throw new Error("projectKey must be an absolute canonical path");
    const projectEntry = normalized.projects[projectKey];
    revisionValue = projectEntry
      ? { scope: "project", projectKey, entry: projectEntry }
      : { scope: "project", projectKey, inherited: true, user: normalized.user };
  } else {
    throw new Error("scope must be user or project");
  }
  return createHash("sha256").update(stableJson(revisionValue)).digest("hex");
}

export function validateSubagentLaunchSlotRoles(value, models = []) {
  if (!isPlainObject(value)) throw new Error("roles must be an object");
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !ROLE_IDS.has(key));
  if (unknown.length) throw new Error(`Unknown subagent role: ${unknown[0]}`);

  const availableModels = new Map();
  for (const model of Array.isArray(models) ? models : []) {
    const key = subagentLaunchSlotModelKey(model);
    if (key) availableModels.set(key, model);
  }

  const seenIds = new Set();
  let totalSlots = 0;
  for (const role of SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG) {
    const slots = value[role.id];
    if (!Array.isArray(slots)) throw new Error(`${role.id} slots are required`);
    if (slots.length < 1) throw new Error(`${role.id} requires its base slot`);
    if (slots.length > SUBAGENT_LAUNCH_SLOT_LIMITS.slotsPerRole) {
      throw new Error(`${role.id} is limited to ${SUBAGENT_LAUNCH_SLOT_LIMITS.slotsPerRole} slots`);
    }
    const baseId = subagentLaunchSlotBaseId(role.id);
    if (slots.filter((slot) => slot?.id === baseId).length !== 1) {
      throw new Error(`${role.id} requires exactly one base slot`);
    }
    for (const slot of slots) {
      if (!isPlainObject(slot) || !isSafeSlotId(slot.id)) throw new Error(`${role.id} has an invalid slot id`);
      if (seenIds.has(slot.id)) throw new Error(`Duplicate slot id: ${slot.id}`);
      seenIds.add(slot.id);
      totalSlots += 1;
      if (totalSlots > SUBAGENT_LAUNCH_SLOT_LIMITS.totalSlots) {
        throw new Error(`Launch slots are limited to ${SUBAGENT_LAUNCH_SLOT_LIMITS.totalSlots} total`);
      }

      if (slot.model !== null && !isCanonicalSubagentLaunchSlotModel(slot.model)) {
        throw new Error(`${slot.id} has an invalid model`);
      }
      if (slot.thinking !== null && !SUBAGENT_LAUNCH_SLOT_THINKING_LEVELS.includes(slot.thinking)) {
        throw new Error(`${slot.id} has an unsupported thinking level`);
      }
      if (slot.model === null && slot.thinking !== null) {
        throw new Error(`${slot.id} cannot set thinking while inheriting its model`);
      }
      if (slot.model) {
        const model = availableModels.get(slot.model);
        if (!model) throw new Error(`Selected model is not currently available: ${slot.model}`);
        if (slot.thinking && !supportedSubagentLaunchSlotThinkingLevels(model).includes(slot.thinking)) {
          throw new Error(`${slot.model} does not support thinking level ${slot.thinking}`);
        }
      }
    }
  }
  return normalizeSubagentLaunchSlotRoles(value);
}

export async function resolveSubagentLaunchSlotProjectKey(cwd) {
  const fallback = path.resolve(String(cwd || process.cwd()));
  let current;
  try {
    current = await realpath(fallback);
  } catch {
    return fallback;
  }
  const canonicalCwd = current;

  while (true) {
    for (const marker of [".pi", ".git"]) {
      try {
        await lstat(path.join(current, marker));
        return current;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return canonicalCwd;
    current = parent;
  }
}

export function subagentLaunchSlotProjectLabel(projectKey) {
  return path.basename(projectKey) || projectKey;
}

export function formatSubagentLaunchSlotGuidance(roles) {
  const normalized = normalizeSubagentLaunchSlotRoles(roles);
  const assignments = [];
  for (const role of SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG) {
    const slots = normalized[role.id];
    if (!slots.some((slot) => slot.model)) continue;
    for (const [index, slot] of slots.entries()) {
      const model = slot.model
        ? slot.thinking ? `${slot.model}:${slot.thinking}` : slot.model
        : "<inherit; omit the model field>";
      assignments.push(`- ${role.id} slot ${index + 1}: agent=${role.id} model=${model}`);
    }
  }
  if (!assignments.length) return "";
  return [
    "## WebUI subagent launch slots",
    "These are default model assignments for future delegation in this Pi tab. Explicit user instructions in the current request win.",
    ...assignments.slice(0, SUBAGENT_LAUNCH_SLOT_LIMITS.totalSlots),
    "When launching multiple slots of one role, create separate task entries so each model remains explicit; do not replace them with count when model specs differ.",
  ].join("\n");
}
