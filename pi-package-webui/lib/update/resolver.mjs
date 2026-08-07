import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { resolveCommandDirectory, resolvePiCommandInvocation } from "../npm-command.mjs";

const VERSION_PATTERN = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=\s|$)/m;

function clean(value) {
  return String(value ?? "").trim();
}

export function parseRuntimeVersion(value) {
  return clean(value).match(VERSION_PATTERN)?.[1] || "";
}

function pathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function canonicalize(filePath, runtime) {
  if (!filePath) return "";
  const realpath = runtime.realpathSync ?? realpathSync;
  try {
    return realpath(filePath);
  } catch {
    return pathApi(runtime.platform ?? process.platform).resolve(filePath);
  }
}

function resolvedExecutablePath(command, runtime) {
  const api = pathApi(runtime.platform ?? process.platform);
  const value = clean(command).replace(/^"|"$/g, "");
  if (api.isAbsolute(value) || value.includes("/") || value.includes("\\")) return value;
  const directory = resolveCommandDirectory(value, runtime);
  return directory ? api.join(directory, value) : value;
}

function cliFromInvocation(invocation) {
  const first = invocation.args?.[0] || "";
  return /(?:^|[\\/])cli\.(?:c?js|mjs)$/i.test(first) ? first : "";
}

function packageRootFromCli(cliPath, platform) {
  if (!cliPath) return "";
  const api = pathApi(platform);
  const normalized = api.normalize(cliPath);
  return api.basename(api.dirname(normalized)).toLowerCase() === "dist"
    ? api.dirname(api.dirname(normalized))
    : api.dirname(normalized);
}

function explicitResolution(command, runtime) {
  const platform = runtime.platform ?? process.platform;
  const api = pathApi(platform);
  const exists = runtime.existsSync ?? existsSync;
  const requested = clean(command).replace(/^"|"$/g, "");
  if (!requested) return { ok: false, reason: "No explicit Pi executable was supplied." };
  const isPath = api.isAbsolute(requested) || requested.includes("/") || requested.includes("\\");
  const directory = resolveCommandDirectory(requested, runtime);
  if (!isPath && !directory) {
    return { ok: false, reason: "The explicit Pi command is opaque or cannot be resolved to one executable." };
  }
  if (isPath) {
    try {
      if (!exists(requested) && !directory) return { ok: false, reason: "The explicit Pi executable does not exist." };
    } catch {
      return { ok: false, reason: "The explicit Pi executable cannot be inspected safely." };
    }
  }
  return { ok: true };
}

async function probePi({ command, source, runCommand, runtime, timeoutMs, probeVersion }) {
  const invocation = resolvePiCommandInvocation(command, [], runtime);
  const cliPath = cliFromInvocation(invocation);
  let version = "";
  if (probeVersion) {
    const result = await runCommand(invocation.command, [...invocation.args, "--version"], {
      timeoutMs,
      maxOutputLength: 4_000,
    });
    version = result?.exitCode === 0 && !result?.timedOut && !result?.error
      ? parseRuntimeVersion(`${result.stdout || ""}\n${result.stderr || ""}`)
      : "";
    if (!version) return null;
  }

  const canonicalCli = canonicalize(cliPath, runtime);
  const canonicalExecutable = canonicalize(resolvedExecutablePath(invocation.command, runtime), runtime);
  const canonicalRequested = canonicalize(resolvedExecutablePath(command, runtime), runtime);
  const identityPath = canonicalCli || (source === "explicit" ? canonicalRequested : canonicalExecutable);
  return Object.freeze({
    kind: "pi",
    source,
    version,
    canonicalId: `pi:${identityPath}`,
    executable: canonicalExecutable,
    cliPath: canonicalCli,
    packageRoot: packageRootFromCli(canonicalCli, runtime.platform ?? process.platform)
      || (source === "explicit" && canonicalRequested ? pathApi(runtime.platform ?? process.platform).dirname(canonicalRequested) : ""),
    invocation: Object.freeze({ command: invocation.command, args: Object.freeze([...invocation.args]) }),
  });
}

/**
 * Resolve the same Pi runtime used for tabs and updates. Bundled Pi wins over
 * PATH unless an exact explicit executable was supplied. PATH is reported
 * separately and is never selected merely because it is newer.
 */
export async function resolveCanonicalPiRuntime({
  explicitCommand = "",
  bundledCli = "",
  pathCommand = "pi",
  runCommand,
  timeoutMs = 10_000,
  probeVersion = true,
  runtime = {},
} = {}) {
  if (typeof runCommand !== "function") throw new TypeError("runCommand is required");
  const exists = runtime.existsSync ?? existsSync;
  const explicit = clean(explicitCommand);

  if (explicit) {
    const resolution = explicitResolution(explicit, runtime);
    if (!resolution.ok) {
      return Object.freeze({ active: null, path: null, refusal: Object.freeze({ code: "explicit-pi-unresolved", message: resolution.reason }) });
    }
    const active = await probePi({ command: explicit, source: "explicit", runCommand, runtime, timeoutMs, probeVersion }).catch(() => null);
    return Object.freeze({
      active,
      path: null,
      refusal: active ? null : Object.freeze({ code: "explicit-pi-unverifiable", message: "The exact explicit Pi executable did not report a supported version." }),
    });
  }

  let bundledAvailable = false;
  try { bundledAvailable = Boolean(bundledCli && exists(bundledCli)); } catch {}
  const active = bundledAvailable
    ? await probePi({ command: bundledCli, source: "bundled", runCommand, runtime, timeoutMs, probeVersion }).catch(() => null)
    : await probePi({ command: pathCommand, source: "path", runCommand, runtime, timeoutMs, probeVersion }).catch(() => null);
  const pathIdentity = bundledAvailable
    ? await probePi({ command: pathCommand, source: "path", runCommand, runtime, timeoutMs, probeVersion }).catch(() => null)
    : active;

  return Object.freeze({
    active,
    path: pathIdentity,
    refusal: active ? null : Object.freeze({ code: "pi-runtime-unverifiable", message: "No supported active Pi runtime could be verified." }),
  });
}

export function resolveWebuiRuntimeIdentity({ packageRoot, packageName, version, owner } = {}, runtime = {}) {
  const root = canonicalize(packageRoot, runtime);
  const normalizedVersion = clean(version).replace(/^v/i, "");
  if (!root || !packageName || !normalizedVersion) throw new TypeError("packageRoot, packageName, and version are required");
  return Object.freeze({
    kind: "webui",
    source: "active-package",
    packageName: clean(packageName),
    version: normalizedVersion,
    packageRoot: root,
    owner: owner ? Object.freeze({ ...owner }) : null,
    canonicalId: `webui:${root}`,
  });
}

export function sameRuntimeIdentity(left, right) {
  return Boolean(left?.canonicalId && right?.canonicalId && left.canonicalId === right.canonicalId);
}
