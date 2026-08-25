import { spawn } from "node:child_process";

// Every child the backend owns runs as the leader of its own process group so the whole tree
// (Pi plus the tools and helpers Pi starts) can be signalled together and reaped on shutdown.

export function spawnOwnedProcess(command, args, { cwd, env, stdio = ["pipe", "pipe", "pipe"] } = {}) {
  return spawn(command, args, {
    cwd,
    env,
    stdio,
    shell: false,
    detached: true,
    windowsHide: true,
  });
}

export function signalProcessTree(child, signal) {
  if (!child || typeof child.pid !== "number") return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    try {
      child.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

export function hasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

// Sends SIGTERM to the tree, escalates to SIGKILL after graceMs, and resolves once the
// direct child has exited (or immediately when it already has).
export function terminateProcessTree(child, { graceMs, signalImpl = signalProcessTree } = {}) {
  if (hasExited(child)) {
    signalImpl(child, "SIGKILL");
    return Promise.resolve({ escalated: false, alreadyExited: true });
  }
  return new Promise((resolve) => {
    let escalated = false;
    const timer = setTimeout(() => {
      escalated = true;
      signalImpl(child, "SIGKILL");
    }, graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      // The leader is gone; sweep any grandchildren that ignored SIGTERM.
      signalImpl(child, "SIGKILL");
      resolve({ escalated, alreadyExited: false });
    });
    signalImpl(child, "SIGTERM");
  });
}

// Synchronous best effort used from fatal paths where the event loop will not continue.
export function killProcessTreeNow(child) {
  signalProcessTree(child, "SIGKILL");
}
