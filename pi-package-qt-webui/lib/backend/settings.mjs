import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from "node:fs";
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
  const filePath = path.join(directory, "settings.json");

  function read() {
    let text;
    try {
      const size = statSync(filePath).size;
      if (size > LIMITS.maxSettingsFileBytes) {
        return { settings: defaultSettings(), problems: [`settings file exceeds ${LIMITS.maxSettingsFileBytes} bytes; using defaults`], path: filePath };
      }
      text = readFileSync(filePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return { settings: defaultSettings(), problems: [], path: filePath };
      return { settings: defaultSettings(), problems: [`could not read settings: ${error.message}`], path: filePath };
    }
    try {
      const { settings, problems } = validated(JSON.parse(text));
      return { settings, problems, path: filePath };
    } catch (error) {
      return { settings: defaultSettings(), problems: [`settings file is not valid JSON: ${error.message}`], path: filePath };
    }
  }

  function write(values) {
    const current = read().settings;
    const { settings, problems } = validated({ ...current, ...values });
    if (problems.length > 0) throw new Error(problems.join("; "));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      chmodSync(directory, 0o700);
    } catch {
      // Directory permissions can only be tightened on filesystems that support modes.
    }
    const temporary = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, filePath);
    return { settings, path: filePath };
  }

  return { read, write, path: filePath, directory };
}
