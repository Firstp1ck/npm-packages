const MAX_RESOURCE_NAME_LENGTH = 256;
const MAX_PROVIDER_LENGTH = 160;
const MAX_MODEL_ID_LENGTH = 512;
const MAX_MODEL_PROFILES = 512;

export function cleanResourceString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeResourceNameList(value) {
  if (!Array.isArray(value)) return null;
  const names = [];
  const seen = new Set();
  for (const item of value) {
    const name = cleanResourceString(item, MAX_RESOURCE_NAME_LENGTH);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function resourceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeResourceSelection(value, key) {
  const source = resourceObject(value);
  return { ...source, [key]: normalizeResourceNameList(source[key]) };
}

export function normalizeModelProfiles(value) {
  if (!Array.isArray(value)) return [];
  const profiles = [];
  const indexes = new Map();
  for (const candidate of value.slice(0, MAX_MODEL_PROFILES)) {
    const source = resourceObject(candidate);
    const provider = cleanResourceString(source.provider, MAX_PROVIDER_LENGTH);
    const modelId = cleanResourceString(source.modelId, MAX_MODEL_ID_LENGTH);
    if (!provider || !modelId) continue;
    const profile = {
      ...source,
      provider,
      modelId,
      tools: normalizeResourceSelection(source.tools, "enabledTools"),
      skills: normalizeResourceSelection(source.skills, "enabledSkills"),
    };
    if (profile.tools.enabledTools === null && profile.skills.enabledSkills === null) {
      const existingIndex = indexes.get(`${provider}\0${modelId}`);
      if (existingIndex !== undefined) {
        profiles.splice(existingIndex, 1);
        indexes.clear();
        profiles.forEach((entry, index) => indexes.set(`${entry.provider}\0${entry.modelId}`, index));
      }
      continue;
    }
    const key = `${provider}\0${modelId}`;
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, profiles.length);
      profiles.push(profile);
    } else {
      profiles[existingIndex] = profile;
    }
  }
  return profiles;
}

export function normalizeResourceDefaults(value) {
  const source = resourceObject(value);
  return {
    ...source,
    tools: normalizeResourceSelection(source.tools, "enabledTools"),
    skills: normalizeResourceSelection(source.skills, "enabledSkills"),
    modelProfiles: normalizeModelProfiles(source.modelProfiles),
  };
}

export function exactModelProfile(resourceDefaults, provider, modelId) {
  if (!provider || !modelId) return null;
  return normalizeModelProfiles(resourceDefaults?.modelProfiles)
    .find((profile) => profile.provider === provider && profile.modelId === modelId) || null;
}

export function resolveResourceSelection(resourceDefaults, resourceType, provider, modelId, runtimeDefault = null) {
  const selectionKey = resourceType === "tools" ? "enabledTools" : "enabledSkills";
  const profile = exactModelProfile(resourceDefaults, provider, modelId);
  const modelSelection = normalizeResourceNameList(profile?.[resourceType]?.[selectionKey]);
  if (modelSelection !== null) return { names: modelSelection, source: "model" };
  const globalSelection = normalizeResourceNameList(resourceDefaults?.[resourceType]?.[selectionKey]);
  if (globalSelection !== null) return { names: globalSelection, source: "global" };
  return { names: normalizeResourceNameList(runtimeDefault), source: "runtime" };
}

export function branchResourceDirective(entryData, resourceType) {
  const data = entryData && typeof entryData === "object" ? entryData : {};
  if (data.version === 2 && data.mode === "inherit") return { pinned: false, names: null, legacyDisabledNames: null };
  const selectionKey = resourceType === "tools" ? "enabledTools" : "enabledSkills";
  const names = normalizeResourceNameList(data[selectionKey]);
  if (names !== null) return { pinned: true, names, legacyDisabledNames: null };
  if (resourceType === "skills") {
    const disabled = normalizeResourceNameList(data.disabledSkills);
    if (disabled !== null) return { pinned: true, names: null, legacyDisabledNames: disabled };
  }
  return { pinned: false, names: null, legacyDisabledNames: null };
}

export function setExactModelProfile(resourceDefaults, providerValue, modelIdValue, resourceType, enabledNames) {
  const provider = cleanResourceString(providerValue, MAX_PROVIDER_LENGTH);
  const modelId = cleanResourceString(modelIdValue, MAX_MODEL_ID_LENGTH);
  if (!provider || !modelId) throw new Error("Model resource profile requires an exact provider and model ID");
  const selectionKey = resourceType === "tools" ? "enabledTools" : "enabledSkills";
  const nextSelection = normalizeResourceNameList(enabledNames);
  const normalized = normalizeResourceDefaults(resourceDefaults);
  const profiles = normalized.modelProfiles.map((profile) => ({
    ...profile,
    tools: { ...profile.tools },
    skills: { ...profile.skills },
  }));
  const index = profiles.findIndex((profile) => profile.provider === provider && profile.modelId === modelId);
  const profile = index >= 0 ? profiles[index] : {
    provider,
    modelId,
    tools: { enabledTools: null },
    skills: { enabledSkills: null },
  };
  profile[resourceType][selectionKey] = nextSelection;
  if (profile.tools.enabledTools === null && profile.skills.enabledSkills === null) {
    if (index >= 0) profiles.splice(index, 1);
  } else if (index >= 0) profiles[index] = profile;
  else profiles.push(profile);
  return normalizeModelProfiles(profiles);
}

export function preserveUnavailableResourceNames(previousNames, visibleNames, selectedVisibleNames) {
  const visible = new Set(normalizeResourceNameList(visibleNames) || []);
  const selected = normalizeResourceNameList(selectedVisibleNames) || [];
  const unavailable = (normalizeResourceNameList(previousNames) || []).filter((name) => !visible.has(name));
  return normalizeResourceNameList([...selected, ...unavailable]) || [];
}
