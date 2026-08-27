import {
  readWebuiSettings,
  updateWebuiSettings,
  webuiSettingsFile,
} from "@firstpick/pi-package-webui/lib/git-workflow-preferences.mjs";
import {
  exactModelProfile,
  preserveUnavailableResourceNames,
  setExactModelProfile,
} from "@firstpick/pi-package-webui/lib/resource-selection.mjs";
import { LIMITS, ProtocolError } from "./protocol.mjs";
import { validateSamplingParams } from "./sampling.mjs";
import { settingsDirectory } from "./settings.mjs";
import { createJsonFileStore } from "./store.mjs";

// Pi Web UI owns global and exact-model tool/skill profiles. Qt WebUI keeps sampling local,
// combines both stores for its public resource shape, and retains its old tool/skill fields only
// as non-destructive migration input.

const WEBUI_MIGRATION_KEY = "webuiToolSkillState";
const CANONICAL_MIGRATIONS_KEY = "qtWebuiMigrations";

function nameList(value, problems, label) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    problems.push(`${label} must be a list or null`);
    return null;
  }
  const result = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > LIMITS.maxToolNameCharacters * 2 || result.includes(entry)) continue;
    result.push(entry);
    if (result.length >= LIMITS.maxResourceNames) break;
  }
  return result;
}

function sampling(value, problems, label) {
  if (value === null || value === undefined) return {};
  const { values, problems: issues } = validateSamplingParams(value);
  for (const issue of Object.values(issues)) problems.push(`${label}: ${issue}`);
  const result = {};
  for (const [key, entry] of Object.entries(values)) if (entry !== null) result[key] = entry;
  return result;
}

export function validateProfile(raw, problems = [], label = "profile") {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    tools: nameList(source.tools, problems, `${label} tools`),
    skills: nameList(source.skills, problems, `${label} skills`),
    sampling: sampling(source.sampling, problems, `${label} sampling`),
  };
}

export function resourceModelKey(provider, modelId) {
  return JSON.stringify([provider, modelId]);
}

function legacyModelKey(provider, modelId) {
  return `${provider}/${modelId}`;
}

function parsedStoredModelKey(key) {
  if (typeof key !== "string") return null;
  try {
    const tuple = JSON.parse(key);
    if (Array.isArray(tuple) && tuple.length === 2 && tuple.every((part) => typeof part === "string" && part.length > 0)) {
      const [provider, modelId] = tuple;
      if (provider.length <= LIMITS.maxProviderCharacters && modelId.length <= LIMITS.maxModelIdCharacters) {
        return { provider, modelId, tuple: true };
      }
    }
  } catch {
    // Legacy Qt sampling profiles use provider/model keys and are parsed below.
  }
  const split = key.indexOf("/");
  if (split <= 0 || split === key.length - 1) return null;
  const provider = key.slice(0, split);
  const modelId = key.slice(split + 1);
  if (provider.length > LIMITS.maxProviderCharacters || modelId.length > LIMITS.maxModelIdCharacters) return null;
  return { provider, modelId, tuple: false };
}

export function validateResources(raw) {
  const problems = [];
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const models = {};
  if (source.models && typeof source.models === "object" && !Array.isArray(source.models)) {
    for (const [key, value] of Object.entries(source.models)) {
      if (!parsedStoredModelKey(key)) continue;
      if (Object.keys(models).length >= LIMITS.maxModelProfiles) {
        problems.push(`more than ${LIMITS.maxModelProfiles} model profiles; extra entries were ignored`);
        break;
      }
      models[key] = validateProfile(value, problems, `model ${key}`);
    }
  }
  const migrations = source.migrations && typeof source.migrations === "object" && !Array.isArray(source.migrations)
    ? { [WEBUI_MIGRATION_KEY]: source.migrations[WEBUI_MIGRATION_KEY] === true }
    : { [WEBUI_MIGRATION_KEY]: false };
  return { value: { version: 2, global: validateProfile(source.global, problems, "global"), models, migrations }, problems };
}

export function emptyProfile() {
  return { tools: null, skills: null, sampling: {} };
}

export function profileIsInherit(profile) {
  return !profile || (profile.tools === null && profile.skills === null && Object.keys(profile.sampling || {}).length === 0);
}

// Returns a validated copy with one field changed. Sampling objects are patches: null values
// remove individual keys, while a null object clears the scope.
export function updateProfile(profile, field, value) {
  const next = validateProfile(profile);
  next.tools = next.tools === null ? null : [...next.tools];
  next.skills = next.skills === null ? null : [...next.skills];
  next.sampling = { ...next.sampling };
  if (field === "sampling") {
    if (value === null) next.sampling = {};
    else {
      const { values, problems } = validateSamplingParams(value);
      if (Object.keys(problems).length > 0) throw new ProtocolError("invalid_request", Object.values(problems).join("; "));
      for (const [name, entry] of Object.entries(values)) {
        if (entry === null) delete next.sampling[name];
        else next.sampling[name] = entry;
      }
    }
  } else if (field === "tools" || field === "skills") {
    next[field] = value === null ? null : nameList(value, [], field);
  } else throw new ProtocolError("invalid_request", `unknown resource field ${field}`);
  return next;
}

// Combines the three scopes into what the session should run with, and records where each part
// came from so the UI can distinguish "inherited" from "set here".
export function resolveEffective({ session, model, global }) {
  const scopes = [["session", session], ["model", model], ["global", global]];
  const pick = (field) => {
    for (const [name, profile] of scopes) {
      if (profile && profile[field] !== null && profile[field] !== undefined) return { value: profile[field], source: name };
    }
    return { value: null, source: "inherit" };
  };
  const tools = pick("tools");
  const skills = pick("skills");
  const samplingValues = { ...(global?.sampling || {}), ...(model?.sampling || {}), ...(session?.sampling || {}) };
  const samplingSources = {};
  for (const key of Object.keys(samplingValues)) {
    samplingSources[key] = session?.sampling && Object.hasOwn(session.sampling, key) ? "session" : model?.sampling && Object.hasOwn(model.sampling, key) ? "model" : "global";
  }
  return { tools: tools.value, toolsSource: tools.source, skills: skills.value, skillsSource: skills.source, sampling: samplingValues, samplingSources };
}

function selectionFrom(profile, resourceType) {
  const key = resourceType === "tools" ? "enabledTools" : "enabledSkills";
  const value = profile?.[resourceType]?.[key];
  return Array.isArray(value) ? [...value] : null;
}

function sameSelection(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertExactModelSelection(resourceDefaults, provider, modelId, resourceType, expected) {
  const actual = selectionFrom(exactModelProfile(resourceDefaults, provider, modelId), resourceType);
  if (!sameSelection(actual, expected)) {
    throw new ProtocolError("limit_exceeded", "Pi Web UI could not retain the exact-model resource profile within its supported profile limit");
  }
}

function canonicalMigrationComplete(canonical) {
  return canonical?.resourceDefaults?.[CANONICAL_MIGRATIONS_KEY]?.[WEBUI_MIGRATION_KEY] === true;
}

function localProfilesByIdentity(local) {
  const profiles = new Map();
  for (const [storedKey, profile] of Object.entries(local.value.models)) {
    const parsed = parsedStoredModelKey(storedKey);
    if (!parsed) continue;
    const identity = resourceModelKey(parsed.provider, parsed.modelId);
    const current = profiles.get(identity);
    if (!current || parsed.tuple) profiles.set(identity, { profile, tuple: parsed.tuple });
  }
  return profiles;
}

export function createResourceStore({
  env = process.env,
  directory = settingsDirectory(env),
  sharedPath = webuiSettingsFile(env),
} = {}) {
  const localStore = createJsonFileStore({ directory, fileName: "resources.json", maxBytes: LIMITS.maxResourcesFileBytes, validate: validateResources });
  let migrationPromise = null;

  async function migrateLegacyProfiles(local) {
    return updateWebuiSettings((current) => {
      if (canonicalMigrationComplete(current)) return undefined;
      let resourceDefaults = current.resourceDefaults;
      const globalPatch = {};
      for (const resourceType of ["tools", "skills"]) {
        const selectionKey = resourceType === "tools" ? "enabledTools" : "enabledSkills";
        if (selectionFrom(resourceDefaults, resourceType) === null && local.value.global[resourceType] !== null) {
          globalPatch[resourceType] = { ...resourceDefaults[resourceType], [selectionKey]: [...local.value.global[resourceType]] };
        }
      }
      if (Object.keys(globalPatch).length > 0) resourceDefaults = { ...resourceDefaults, ...globalPatch };

      for (const [identity, legacy] of Object.entries(local.value.models)) {
        const parsed = parsedStoredModelKey(identity);
        if (!parsed) continue;
        const { provider, modelId } = parsed;
        for (const resourceType of ["tools", "skills"]) {
          const existing = exactModelProfile(resourceDefaults, provider, modelId);
          if (selectionFrom(existing, resourceType) !== null || legacy[resourceType] === null) continue;
          const modelProfiles = setExactModelProfile(resourceDefaults, provider, modelId, resourceType, legacy[resourceType]);
          const nextDefaults = { ...resourceDefaults, modelProfiles };
          assertExactModelSelection(nextDefaults, provider, modelId, resourceType, legacy[resourceType]);
          resourceDefaults = nextDefaults;
        }
      }
      return {
        resourceDefaults: {
          ...resourceDefaults,
          [CANONICAL_MIGRATIONS_KEY]: {
            ...(resourceDefaults[CANONICAL_MIGRATIONS_KEY] || {}),
            [WEBUI_MIGRATION_KEY]: true,
          },
        },
      };
    }, sharedPath);
  }

  async function canonicalSettings(local) {
    if (local.value.migrations[WEBUI_MIGRATION_KEY] || local.problems.length > 0) return readWebuiSettings(sharedPath);
    const current = await readWebuiSettings(sharedPath);
    if (canonicalMigrationComplete(current)) return current;
    if (!migrationPromise) migrationPromise = migrateLegacyProfiles(local).finally(() => { migrationPromise = null; });
    return migrationPromise;
  }

  function combine(local, canonical) {
    const defaults = canonical.resourceDefaults;
    const global = {
      tools: selectionFrom(defaults, "tools"),
      skills: selectionFrom(defaults, "skills"),
      sampling: { ...local.value.global.sampling },
    };
    const localProfiles = localProfilesByIdentity(local);
    const canonicalProfiles = Array.isArray(defaults.modelProfiles) ? defaults.modelProfiles : [];
    const identities = new Set(localProfiles.keys());
    for (const profile of canonicalProfiles) identities.add(resourceModelKey(profile.provider, profile.modelId));
    const models = {};
    for (const identity of identities) {
      const [provider, modelId] = JSON.parse(identity);
      const canonicalProfile = exactModelProfile(defaults, provider, modelId);
      models[identity] = {
        tools: selectionFrom(canonicalProfile, "tools"),
        skills: selectionFrom(canonicalProfile, "skills"),
        sampling: { ...(localProfiles.get(identity)?.profile.sampling || {}) },
      };
    }
    return {
      value: {
        version: 2,
        global,
        models,
        migrations: { [WEBUI_MIGRATION_KEY]: local.value.migrations[WEBUI_MIGRATION_KEY] || canonicalMigrationComplete(canonical) },
      },
      problems: local.problems,
      path: local.path,
      sharedPath,
    };
  }

  async function read() {
    const local = localStore.read();
    return combine(local, await canonicalSettings(local));
  }

  async function profileFor(scope, provider, modelId) {
    const value = (await read()).value;
    if (scope === "global") return value.global;
    if (scope === "model") return value.models[resourceModelKey(provider, modelId)] ?? emptyProfile();
    throw new ProtocolError("invalid_request", "scope must be global or model");
  }

  // Tool/skill writes go through Pi Web UI's locked latest-snapshot updater. Sampling remains in
  // Qt WebUI's private store. visibleNames lets callers retain configured resources that are not
  // currently loaded while replacing only the visible part of an enabled list. Every successful
  // update returns the exact combined snapshot produced by its commit, without a fallible reread.
  async function update(scope, { provider, modelId }, field, value, { visibleNames = null } = {}) {
    if (scope !== "global" && scope !== "model") throw new ProtocolError("invalid_request", "scope must be global or model");
    if (scope === "model" && (!provider || !modelId)) throw new ProtocolError("invalid_request", "a model profile needs the active model");
    const local = localStore.read();
    const canonical = await canonicalSettings(local);
    if (field === "sampling") {
      const written = localStore.update((state) => {
        const tupleKey = resourceModelKey(provider, modelId);
        const legacyKey = legacyModelKey(provider, modelId);
        const key = scope === "model" && (provider.includes("/") || Object.hasOwn(state.models, tupleKey)) ? tupleKey : legacyKey;
        let profile = scope === "global" ? state.global : state.models[key];
        if (!profile) {
          if (Object.keys(state.models).length >= LIMITS.maxModelProfiles) throw new ProtocolError("limit_exceeded", `At most ${LIMITS.maxModelProfiles} model profiles can be saved`);
          profile = emptyProfile();
          state.models[key] = profile;
        }
        const updated = updateProfile(profile, field, value);
        profile.sampling = updated.sampling;
        if (scope === "model" && profileIsInherit(profile)) delete state.models[key];
        return state;
      });
      return combine({ ...written, problems: [] }, canonical);
    }
    if (field !== "tools" && field !== "skills") throw new ProtocolError("invalid_request", `unknown resource field ${field}`);

    const normalized = updateProfile(emptyProfile(), field, value)[field];
    const committed = await updateWebuiSettings((current) => {
      const selectionKey = field === "tools" ? "enabledTools" : "enabledSkills";
      const currentProfile = scope === "global"
        ? current.resourceDefaults
        : exactModelProfile(current.resourceDefaults, provider, modelId);
      const previous = selectionFrom(currentProfile, field);
      const enabledNames = normalized === null
        ? null
        : Array.isArray(visibleNames)
          ? preserveUnavailableResourceNames(previous, visibleNames, normalized)
          : normalized;
      if (scope === "global") {
        return { resourceDefaults: { [field]: { [selectionKey]: enabledNames } } };
      }
      const modelProfiles = setExactModelProfile(current.resourceDefaults, provider, modelId, field, enabledNames);
      assertExactModelSelection({ ...current.resourceDefaults, modelProfiles }, provider, modelId, field, enabledNames);
      return { resourceDefaults: { modelProfiles } };
    }, sharedPath);
    return combine(local, committed);
  }

  return {
    read,
    profileFor,
    update,
    path: localStore.path,
    sharedPath,
    directory,
  };
}
