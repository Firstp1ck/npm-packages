import fs from "node:fs";
import path from "node:path";
import { getAgentEnvPath, getWorkspaceEnvPath } from "./paths.ts";

export type EnvResolution = {
  value?: string;
  source?: "environment" | "workspace .env" | "Pi global .env";
  path?: string;
};

export function parseBooleanFlag(value: string | undefined, fallback = false): boolean {
  const raw = value?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

export function envFlag(name: string, fallback = false): boolean {
  return parseBooleanFlag(process.env[name], fallback);
}

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2] ?? "";
    const commentStart = value.search(/\s#/);
    if (commentStart >= 0) value = value.slice(0, commentStart);
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1] ?? ""] = value.replace(/\\n/g, "\n");
  }
  return values;
}

export function readEnvValue(filePath: string, key: string): string | undefined {
  return parseEnvFile(filePath)[key];
}

export function resolveEnvValue(key: string, options: { includeWorkspace?: boolean; cwd?: string } = {}): EnvResolution {
  const envValue = process.env[key]?.trim();
  if (envValue) return { value: envValue, source: "environment" };

  if (options.includeWorkspace) {
    const workspaceEnvPath = getWorkspaceEnvPath(options.cwd);
    const workspaceValue = readEnvValue(workspaceEnvPath, key)?.trim();
    if (workspaceValue) return { value: workspaceValue, source: "workspace .env", path: workspaceEnvPath };
  }

  const globalEnvPath = getAgentEnvPath();
  const globalValue = readEnvValue(globalEnvPath, key)?.trim();
  if (globalValue) return { value: globalValue, source: "Pi global .env", path: globalEnvPath };

  return {};
}

export function quoteEnvValue(value: string): string {
  return JSON.stringify(value);
}

export function upsertEnvValue(filePath: string, key: string, value: string): void {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const line = `${key}=${quoteEnvValue(value)}`;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, "m");
  content = pattern.test(content) ? content.replace(pattern, line) : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode: 0o600 });
}
