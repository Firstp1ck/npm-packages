import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function getAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR?.trim();
  if (env) return path.resolve(expandTilde(env));
  return path.join(os.homedir(), ".pi", "agent");
}

export function resolvePathFromAgentDir(configuredPath: string): string {
  return path.isAbsolute(configuredPath) ? path.normalize(configuredPath) : path.resolve(getAgentDir(), configuredPath);
}

export function getPiDir(): string {
  return path.dirname(getAgentDir());
}

export function getAgentEnvPath(): string {
  return path.join(getAgentDir(), ".env");
}

export function getAgentSettingsPath(): string {
  return path.join(getAgentDir(), "settings.json");
}

export function getWorkspaceEnvPath(cwd = process.cwd()): string {
  return path.join(cwd, ".env");
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const exists = pathExists;

export function xdgDataHome(env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string {
  return env.XDG_DATA_HOME?.trim() || path.join(homeDir, ".local", "share");
}

export function xdgConfigHome(env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string {
  return env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config");
}

export function expandTilde(input: string, homeDir = os.homedir()): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  if (input === "$HOME") return homeDir;
  if (input.startsWith("$HOME/")) return path.join(homeDir, input.slice(6));
  return input;
}

export function stripAtPathPrefix(input: string): string {
  return input.trim().replace(/^@+/, "");
}

export function resolveUserPath(input: string, cwd = process.cwd(), options: { stripAtPrefix?: boolean } = {}): string {
  const cleaned = options.stripAtPrefix === false ? input.trim() : stripAtPathPrefix(input);
  const expanded = expandTilde(cleaned);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
}

export function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(a) === normalize(b);
}

export function isPathInside(basePath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(basePath), path.resolve(candidatePath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function safeResolveInside(basePath: string, reference: string): string {
  const base = path.resolve(basePath);
  const candidate = resolveUserPath(reference, base);
  if (!isPathInside(base, candidate)) throw new Error(`Path escapes base directory: ${reference}`);
  return candidate;
}

export function formatUserPath(filePath: string, homeDir = os.homedir()): string {
  const normalized = path.resolve(filePath);
  const home = path.resolve(homeDir);
  if (normalized === home) return "~";
  if (normalized.startsWith(`${home}${path.sep}`)) return `~/${normalized.slice(home.length + 1).split(path.sep).join("/")}`;
  return normalized;
}
