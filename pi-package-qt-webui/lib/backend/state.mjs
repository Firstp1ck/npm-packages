import { LIMITS } from "./protocol.mjs";
import { createJsonFileStore, stateDirectory } from "./store.mjs";

// Window state that should survive a restart but is not a user preference: composer drafts per
// session, recent and pinned directories, recent palette actions, and the open tabs. Lives under
// $XDG_STATE_HOME/qt-webui/state.json with private permissions.

function boundedStringList(list, maxItems, maxCharacters) {
  if (!Array.isArray(list)) return [];
  const result = [];
  const seen = new Set();
  for (const entry of list) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > maxCharacters || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
    if (result.length >= maxItems) break;
  }
  return result;
}

function validateDrafts(raw, problems) {
  const drafts = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined) problems.push("drafts must be an object");
    return drafts;
  }
  const entries = Object.entries(raw)
    .filter(([key, value]) => typeof key === "string" && key.length > 0 && key.length <= LIMITS.maxStateKeyCharacters && value && typeof value === "object" && typeof value.text === "string")
    .map(([key, value]) => [key, { text: value.text.slice(0, LIMITS.maxDraftCharacters), updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0 }])
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, LIMITS.maxDrafts);
  for (const [key, value] of entries) drafts[key] = value;
  return drafts;
}

function validateTabs(raw) {
  if (!Array.isArray(raw)) return [];
  const tabs = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || typeof entry.cwd !== "string" || entry.cwd.length === 0 || entry.cwd.length > LIMITS.maxStateKeyCharacters) continue;
    tabs.push({
      cwd: entry.cwd,
      sessionFile: typeof entry.sessionFile === "string" && entry.sessionFile.length <= LIMITS.maxStateKeyCharacters ? entry.sessionFile : "",
      name: typeof entry.name === "string" ? entry.name.slice(0, LIMITS.maxRuntimeInfoCharacters) : "",
    });
    if (tabs.length >= 16) break;
  }
  return tabs;
}

export function validateState(raw) {
  const problems = [];
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (raw !== null && raw !== undefined && source !== raw) problems.push("state file is not a JSON object");
  return {
    value: {
      drafts: validateDrafts(source.drafts, problems),
      recentDirectories: boundedStringList(source.recentDirectories, LIMITS.maxRecentEntries, LIMITS.maxPathCharacters),
      pinnedDirectories: boundedStringList(source.pinnedDirectories, LIMITS.maxRecentEntries, LIMITS.maxPathCharacters),
      recentActions: boundedStringList(source.recentActions, LIMITS.maxRecentEntries, 128),
      tabs: validateTabs(source.tabs),
      activeTab: Number.isInteger(source.activeTab) && source.activeTab >= 0 ? source.activeTab : 0,
    },
    problems,
  };
}

export function createStateStore({ env = process.env, directory = stateDirectory(env), now = () => Date.now() } = {}) {
  const store = createJsonFileStore({ directory, fileName: "state.json", maxBytes: LIMITS.maxStateFileBytes, validate: validateState });

  function getDraft(key) {
    const draft = store.read().value.drafts[key];
    return draft ? draft.text : "";
  }

  function setDraft(key, text) {
    return store.update((state) => {
      if (text.length === 0) delete state.drafts[key];
      else state.drafts[key] = { text, updatedAt: now() };
      return state;
    }).value.drafts[key]?.text ?? "";
  }

  function pushRecent(listName, entry) {
    return store.update((state) => {
      state[listName] = [entry, ...state[listName].filter((item) => item !== entry)].slice(0, LIMITS.maxRecentEntries);
      return state;
    }).value[listName];
  }

  function togglePinned(directoryPath) {
    return store.update((state) => {
      if (state.pinnedDirectories.includes(directoryPath)) state.pinnedDirectories = state.pinnedDirectories.filter((item) => item !== directoryPath);
      else state.pinnedDirectories = [directoryPath, ...state.pinnedDirectories].slice(0, LIMITS.maxRecentEntries);
      return state;
    }).value.pinnedDirectories;
  }

  function saveTabs(tabs, activeTab) {
    return store.update((state) => {
      state.tabs = tabs;
      state.activeTab = activeTab;
      return state;
    }).value;
  }

  return { read: store.read, update: store.update, getDraft, setDraft, pushRecent, togglePinned, saveTabs, path: store.path, directory };
}
