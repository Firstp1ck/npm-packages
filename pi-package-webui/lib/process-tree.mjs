import { spawnSync } from "node:child_process";
import path from "node:path";

const WINDOWS_TREE_KILL_TIMEOUT_MS = 5_000;

function directKill(target, signal) {
  try {
    return target?.kill?.(signal) ?? false;
  } catch {
    return false;
  }
}

function windowsTaskkillCommand() {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  return windowsRoot ? path.join(windowsRoot, "System32", "taskkill.exe") : "taskkill.exe";
}

/**
 * Terminate a spawned process and its descendants.
 *
 * POSIX children must be spawned detached so their PID is also their process
 * group ID. Windows has no equivalent Node signal API, so taskkill /T /F is
 * used instead of child.kill(), which only terminates the direct child.
 */
export function terminateProcessTree(target, signal = "SIGTERM") {
  const hasExited = (target?.exitCode !== undefined && target.exitCode !== null)
    || (target?.signalCode !== undefined && target.signalCode !== null);
  if (!target || hasExited) return false;
  const pid = Number(target.pid);

  if (process.platform === "win32" && Number.isInteger(pid) && pid > 0) {
    try {
      const result = spawnSync(windowsTaskkillCommand(), ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: WINDOWS_TREE_KILL_TIMEOUT_MS,
      });
      if (!result.error && result.status === 0) return true;
    } catch {
      // Fall back to direct-child termination below.
    }
    return directKill(target, "SIGKILL");
  }

  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Fall back when the child is not a process-group leader.
    }
  }
  return directKill(target, signal);
}
