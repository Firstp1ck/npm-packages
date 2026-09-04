import { createJsonFileStore } from "./store.mjs";
import os from "node:os";
import path from "node:path";
import { LIMITS, SETTINGS_SCHEMA, validateSettingValue } from "./protocol.mjs";

// Settings live under the XDG config directory with private permissions. The file is small,
// validated on every read, and replaced atomically so a crash mid-write cannot corrupt it.

export function settingsDirectory(env = process.env) {
  const configHome = typeof env.XDG_CONFIG_HOME === "string" && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : path.join(os.homedir(), ".config");
  return path.join(configHome, "qt-webui");
}

export function defaultSettings() {
  return Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([key, schema]) => [key, Array.isArray(schema.default) ? [...schema.default] : schema.default]));
}

function validated(raw) {
  const settings = defaultSettings();
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { settings, problems: ["settings file is not a JSON object"] };
  for (const [key, value] of Object.entries(raw)) {
    const schema = SETTINGS_SCHEMA[key];
    if (!schema) {
      problems.push(`ignored unknown setting ${key}`);
      continue;
    }
    try {
      settings[key] = validateSettingValue(key, value);
    } catch (error) {
      const detail = String(error?.message ?? error).replace(`setting ${key} must be `, "expected ");
      problems.push(`ignored ${key}: ${detail}`);
    }
  }
  return { settings, problems };
}

export function createSettingsStore({ env = process.env, directory = settingsDirectory(env) } = {}) {
  const store = createJsonFileStore({ directory, fileName: "settings.json", maxBytes: LIMITS.maxSettingsFileBytes,
    validate(raw) {
      if (raw === null) return { value: defaultSettings(), problems: [] };
      const result = validated(raw);
      return { value: result.settings, problems: result.problems };
    },
  });

  function read() {
    const result = store.read();
    return { settings: result.value, problems: result.problems, path: store.path };
  }

  function write(values) {
    const { problems } = validated({ ...defaultSettings(), ...values });
    if (problems.length > 0) throw new Error(problems.join("; "));
    const result = store.update(current => ({ ...current, ...values }));
    return { settings: result.value, path: store.path };
  }

  return { read, write, path: store.path, directory };
}
