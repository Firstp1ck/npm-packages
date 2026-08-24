import { win32 } from "node:path";

export const WINDOWS_DRIVES_PICKER_PATH = "::pi-webui-windows-drives::";
export const WINDOWS_DRIVE_DISCOVERY_TIMEOUT_MS = 3_000;
export const WINDOWS_DRIVE_DISCOVERY_MAX_OUTPUT = 4_096;
export const WINDOWS_DRIVE_DISCOVERY_CACHE_TTL_MS = 10_000;

const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/]$/;
const WINDOWS_DRIVE_DESIGNATOR_PATTERN = /^[A-Za-z]:$/;
const WINDOWS_DRIVE_DISCOVERY_SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);",
  "[System.IO.DriveInfo]::GetDrives()",
  "| Where-Object { try { $_.IsReady } catch { $false } }",
  "| ForEach-Object { $_.RootDirectory.FullName }",
].join(" ");

export function normalizeWindowsDriveRoot(value) {
  const root = String(value ?? "");
  if (!WINDOWS_DRIVE_ROOT_PATTERN.test(root)) return null;
  return `${root[0].toUpperCase()}:\\`;
}

export function isWindowsDriveRoot(value) {
  return normalizeWindowsDriveRoot(value) !== null;
}

export function parseWindowsDriveRoots(output) {
  return mergeWindowsDriveRoots(String(output ?? "").split(/\r?\n/));
}

export function windowsDriveRootsFromKnownPaths(values) {
  const roots = [];
  for (const value of values || []) {
    const candidate = String(value ?? "");
    if (!candidate) continue;
    if (WINDOWS_DRIVE_DESIGNATOR_PATTERN.test(candidate)) {
      roots.push(`${candidate}\\`);
      continue;
    }
    roots.push(win32.parse(candidate).root);
  }
  return mergeWindowsDriveRoots(roots);
}

export function mergeWindowsDriveRoots(...groups) {
  const roots = new Map();
  for (const group of groups) {
    for (const value of group || []) {
      const root = normalizeWindowsDriveRoot(value);
      if (root) roots.set(root.toLowerCase(), root);
    }
  }
  return [...roots.values()].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}

export function windowsDrivesPickerData(driveRoots, roots = []) {
  return {
    cwd: "",
    displayCwd: "This PC",
    parent: null,
    roots,
    directories: mergeWindowsDriveRoots(driveRoots).map((root) => ({
      name: root,
      cwd: root,
      displayCwd: root,
      hidden: false,
    })),
    truncated: false,
    selectable: false,
  };
}

export function createWindowsDriveRootDiscovery({
  runCommand,
  now = Date.now,
  cacheTtlMs = WINDOWS_DRIVE_DISCOVERY_CACHE_TTL_MS,
} = {}) {
  if (typeof runCommand !== "function") throw new TypeError("runCommand is required");

  let cached = { expiresAt: 0, roots: [] };
  let pending = null;

  async function discover(cwd) {
    let roots = [];
    try {
      const result = await runCommand("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_DRIVE_DISCOVERY_SCRIPT,
      ], {
        cwd,
        timeoutMs: WINDOWS_DRIVE_DISCOVERY_TIMEOUT_MS,
        maxOutputLength: WINDOWS_DRIVE_DISCOVERY_MAX_OUTPUT,
        utf8Output: true,
      });
      if (result?.exitCode === 0 && !result.timedOut && !result.stdoutTruncated && !result.error) {
        roots = parseWindowsDriveRoots(result.stdout);
      }
    } catch {
      // Known roots keep the picker usable when PowerShell is unavailable.
    }
    cached = { expiresAt: now() + Math.max(0, cacheTtlMs), roots };
    return roots;
  }

  return async function getWindowsDriveRoots({ cwd, knownPaths = [] } = {}) {
    const knownRoots = windowsDriveRootsFromKnownPaths(knownPaths);
    if (cached.expiresAt > now()) return mergeWindowsDriveRoots(cached.roots, knownRoots);
    if (!pending) pending = discover(cwd).finally(() => { pending = null; });
    return mergeWindowsDriveRoots(await pending, knownRoots);
  };
}
