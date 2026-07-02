import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const COMPANION_MARKER = "native-audio-companion";

export function voiceRuntimeDir(env = process.env) {
  const base = typeof env.XDG_RUNTIME_DIR === "string" && env.XDG_RUNTIME_DIR.trim() ? env.XDG_RUNTIME_DIR : tmpdir();
  return join(base, "pi-voice");
}

export function pidFilePath(dir, pid) {
  return join(dir, `${pid}.pid`);
}

export function writePidFile(dir, pid, marker = COMPANION_MARKER) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(pidFilePath(dir, pid), `${marker}\n`, { mode: 0o600 });
}

export function removePidFile(dir, pid) {
  try {
    rmSync(pidFilePath(dir, pid));
  } catch {
    // already gone
  }
}

function defaultReadCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
  } catch {
    return undefined;
  }
}

/**
 * Sweep stale companion pidfiles: dead pids are unlinked; live pids whose
 * cmdline still names the companion get SIGTERM (a previous hard-killed Pi
 * session must never leave a recorder running). Unrelated live pids that
 * merely reused the number are left alone but their stale files are removed.
 */
export function sweepStalePidFiles(dir, {
  marker = COMPANION_MARKER,
  skipPids = [],
  kill = process.kill,
  readCmdline = defaultReadCmdline,
} = {}) {
  const skip = new Set(skipPids.map(Number));
  const result = { killed: [], removed: [] };
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    const match = /^(\d+)\.pid$/.exec(entry);
    if (!match) continue;
    const pid = Number(match[1]);
    if (skip.has(pid)) continue;

    let alive = true;
    try {
      kill(pid, 0);
    } catch {
      alive = false;
    }

    if (alive) {
      const cmdline = readCmdline(pid) ?? "";
      if (!cmdline.includes(marker)) {
        // pid reused by an unrelated process; just drop the stale file
        rmSync(join(dir, entry), { force: true });
        result.removed.push(pid);
        continue;
      }
      try {
        kill(pid, "SIGTERM");
        result.killed.push(pid);
      } catch {
        // race: died between the checks
      }
    }
    rmSync(join(dir, entry), { force: true });
    if (!alive) result.removed.push(pid);
  }
  return result;
}
