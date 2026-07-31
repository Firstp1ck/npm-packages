import { existsSync } from "node:fs";
import path from "node:path";

function pathApiForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function npmCliPathForDirectory(directory, pathApi) {
  return pathApi.join(directory, "node_modules", "npm", "bin", "npm-cli.js");
}

function npmCliPathForShim(shimPath, pathApi) {
  const baseName = pathApi.basename(shimPath);
  if (!/^npm(?:\.(?:cmd|ps1))?$/i.test(baseName)) return "";
  return npmCliPathForDirectory(pathApi.dirname(shimPath), pathApi);
}

function isJavaScriptPath(filePath) {
  return /\.(?:cjs|mjs|js)$/i.test(String(filePath || ""));
}

function envPathValue(env) {
  return env.PATH || env.Path || env.path || "";
}

function pathEntries(env, pathApi) {
  return String(envPathValue(env))
    .split(pathApi.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function existingPath(candidates, exists) {
  for (const candidate of candidates) {
    try {
      if (candidate && exists(candidate)) return candidate;
    } catch {
      // Continue to the next candidate when a path cannot be inspected.
    }
  }
  return "";
}

function windowsCommandExtensions(command, env, pathApi) {
  if (pathApi.extname(command)) return [""];
  const configured = String(env.PATHEXT || env.PathExt || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
  return ["", ...configured];
}

/** Resolve the directory that supplies a command, using the same PATH order as the process. */
export function resolveCommandDirectory(command, runtime = {}) {
  const env = runtime.env ?? process.env;
  const platform = runtime.platform ?? process.platform;
  const exists = runtime.existsSync ?? existsSync;
  const pathApi = pathApiForPlatform(platform);
  const value = String(command || "").trim().replace(/^"|"$/g, "");
  if (!value) return "";

  const directBase = pathApi.isAbsolute(value)
    ? value
    : value.includes("/") || value.includes("\\")
      ? pathApi.resolve(runtime.cwd ?? process.cwd(), value)
      : "";
  const extensions = platform === "win32" ? windowsCommandExtensions(value, env, pathApi) : [""];
  const pathCandidates = directBase
    ? extensions.map((extension) => `${directBase}${extension}`)
    : pathEntries(env, pathApi).flatMap((entry) => extensions.map((extension) => pathApi.join(entry, `${value}${extension}`)));
  const resolved = existingPath(pathCandidates, exists);
  return resolved ? pathApi.dirname(resolved) : "";
}

/** Put the selected Pi/Node installation first without discarding other PATH entries. */
export function prependPathDirectory(directory, runtime = {}) {
  const env = runtime.env ?? process.env;
  const platform = runtime.platform ?? process.platform;
  const pathApi = pathApiForPlatform(platform);
  const value = String(directory || "").trim();
  if (!value) return envPathValue(env);
  const comparable = (entry) => platform === "win32" ? pathApi.normalize(entry).toLowerCase() : pathApi.normalize(entry);
  const selected = comparable(value);
  const remaining = pathEntries(env, pathApi).filter((entry) => comparable(entry) !== selected);
  return [value, ...remaining].join(pathApi.delimiter);
}

/** Preserve the process's PATH key casing so Windows does not receive Path and PATH entries. */
export function prependedPathEnvironment(directory, runtime = {}) {
  const env = runtime.env ?? process.env;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  return { [pathKey]: prependPathDirectory(directory, runtime) };
}

/** Normalize Windows npm-generated Pi shims to Node plus the installation's CLI script. */
export function resolvePiCommandInvocation(command, args = [], runtime = {}) {
  const env = runtime.env ?? process.env;
  const execPath = runtime.execPath ?? process.execPath;
  const platform = runtime.platform ?? process.platform;
  const exists = runtime.existsSync ?? existsSync;
  const pathApi = pathApiForPlatform(platform);
  const requestedArgs = Array.isArray(args) ? args.map(String) : [];
  const value = String(command || "").trim();

  if (isJavaScriptPath(value)) {
    return { command: execPath, args: [value, ...requestedArgs], source: "node-script" };
  }
  if (platform !== "win32" || !/^pi(?:\.(?:cmd|ps1))?$/i.test(pathApi.basename(value))) {
    return { command: value, args: requestedArgs, source: "command" };
  }

  const installDirectory = resolveCommandDirectory(value, { ...runtime, env, execPath, platform, existsSync: exists });
  const cliPath = pathApi.join(installDirectory, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  if (installDirectory && existingPath([cliPath], exists)) {
    const bundledNode = existingPath([pathApi.join(installDirectory, "node.exe"), execPath], exists) || execPath;
    return { command: bundledNode, args: [cliPath, ...requestedArgs], source: "windows-node-cli", installDirectory };
  }
  return { command: value, args: requestedArgs, source: "command", installDirectory };
}

/**
 * Resolve npm without relying on Windows CreateProcess to discover npm.cmd.
 * The returned display command intentionally remains npm-oriented while the
 * executable command may run npm-cli.js through the current Node executable.
 */
export function resolveNpmCommandInvocation(args = [], runtime = {}) {
  const env = runtime.env ?? process.env;
  const execPath = runtime.execPath ?? process.execPath;
  const platform = runtime.platform ?? process.platform;
  const exists = runtime.existsSync ?? existsSync;
  const pathApi = pathApiForPlatform(platform);
  const requestedArgs = Array.isArray(args) ? args.map(String) : [];
  const configured = String(env.PI_WEBUI_NPM_BIN || "").trim();

  if (configured) {
    const configuredCli = existingPath([
      isJavaScriptPath(configured) ? configured : "",
      npmCliPathForShim(configured, pathApi),
    ], exists);
    if (configuredCli) {
      return {
        command: execPath,
        args: [configuredCli, ...requestedArgs],
        displayCommand: configured,
        displayArgs: requestedArgs,
        source: "configured-cli",
      };
    }
    return {
      command: configured,
      args: requestedArgs,
      displayCommand: configured,
      displayArgs: requestedArgs,
      source: "configured-command",
    };
  }

  const npmExecPath = String(env.npm_execpath || "").trim();
  const preferredDirectories = Array.isArray(runtime.preferredDirectories)
    ? runtime.preferredDirectories.map(String).filter(Boolean)
    : [];
  const candidates = [
    ...preferredDirectories.map((directory) => npmCliPathForDirectory(directory, pathApi)),
    isJavaScriptPath(npmExecPath) ? npmExecPath : "",
    npmCliPathForDirectory(pathApi.dirname(execPath), pathApi),
    ...pathEntries(env, pathApi).map((entry) => npmCliPathForDirectory(entry, pathApi)),
  ];
  const npmCli = existingPath(candidates, exists);
  if (npmCli) {
    return {
      command: execPath,
      args: [npmCli, ...requestedArgs],
      displayCommand: "npm",
      displayArgs: requestedArgs,
      source: "node-cli",
    };
  }

  return {
    command: "npm",
    args: requestedArgs,
    displayCommand: "npm",
    displayArgs: requestedArgs,
    source: "path-fallback",
  };
}
