import { LIMITS, ProtocolError } from "./protocol.mjs";
import { validateSamplingParams } from "./sampling.mjs";
import { settingsDirectory } from "./settings.mjs";
import { createJsonFileStore } from "./store.mjs";

// Tool, skill, and sampling profiles in three scopes. `null` means "inherit from the next scope"
// (and finally Pi's own defaults); an empty list is an intentional "none". Global and model
// profiles persist in the config directory; the session scope lives with the Pi session.
//
// Effective resolution: session ?? model ?? global ?? inherit. Sampling values merge in the same
// order, so a session value overrides a model value which overrides a global value.

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

export function validateResources(raw) {
  const problems = [];
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const models = {};
  if (source.models && typeof source.models === "object" && !Array.isArray(source.models)) {
    for (const [key, value] of Object.entries(source.models)) {
      if (typeof key !== "string" || !key.includes("/") || key.length > LIMITS.maxProviderCharacters + LIMITS.maxModelIdCharacters + 1) continue;
      if (Object.keys(models).length >= LIMITS.maxModelProfiles) {
        problems.push(`more than ${LIMITS.maxModelProfiles} model profiles; extra entries were ignored`);
        break;
      }
      models[key] = validateProfile(value, problems, `model ${key}`);
    }
  }
  return { value: { version: 1, global: validateProfile(source.global, problems, "global"), models }, problems };
}

export function emptyProfile() {
  return { tools: null, skills: null, sampling: {} };
}

export function profileIsInherit(profile) {
  return !profile || (profile.tools === null && profile.skills === null && Object.keys(profile.sampling || {}).length === 0);
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

export function createResourceStore({ env = process.env, directory = settingsDirectory(env) } = {}) {
  const store = createJsonFileStore({ directory, fileName: "resources.json", maxBytes: LIMITS.maxResourcesFileBytes, validate: validateResources });

  function read() {
    return store.read();
  }

  function modelKey(provider, modelId) {
    return `${provider}/${modelId}`;
  }

  function profileFor(scope, provider, modelId) {
    const value = store.read().value;
    if (scope === "global") return value.global;
    if (scope === "model") return value.models[modelKey(provider, modelId)] ?? emptyProfile();
    throw new ProtocolError("invalid_request", "scope must be global or model");
  }

  // Updates one field of a scope. `tools`/`skills`: list or null; `sampling`: partial object with
  // null removing a key, or `null` to clear every value.
  function update(scope, { provider, modelId }, field, value) {
    if (scope === "model" && (!provider || !modelId)) throw new ProtocolError("invalid_request", "a model profile needs the active model");
    let saved = null;
    store.update((state) => {
      const key = modelKey(provider, modelId);
      let profile = scope === "global" ? state.global : state.models[key];
      if (!profile) {
        if (Object.keys(state.models).length >= LIMITS.maxModelProfiles) throw new ProtocolError("limit_exceeded", `At most ${LIMITS.maxModelProfiles} model profiles can be saved`);
        profile = emptyProfile();
        state.models[key] = profile;
      }
      if (field === "sampling") {
        if (value === null) profile.sampling = {};
        else {
          const { values, problems } = validateSamplingParams(value);
          if (Object.keys(problems).length > 0) throw new ProtocolError("invalid_request", Object.values(problems).join("; "));
          for (const [name, entry] of Object.entries(values)) {
            if (entry === null) delete profile.sampling[name];
            else profile.sampling[name] = entry;
          }
        }
      } else {
        profile[field] = value === null ? null : nameList(value, [], field);
      }
      if (scope === "model" && profileIsInherit(profile)) delete state.models[key];
      saved = scope === "global" ? state.global : state.models[key] ?? emptyProfile();
      return state;
    });
    return saved;
  }

  return { read, profileFor, update, path: store.path, directory };
}
