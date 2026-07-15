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
  const candidates = [
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
