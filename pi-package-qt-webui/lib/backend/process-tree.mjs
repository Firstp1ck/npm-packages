import { spawn } from "node:child_process";
import { opendir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LIMITS, ProtocolError } from "./protocol.mjs";

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
export async function waitForProcessGroup(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 1 || process.platform !== "linux") return;
  const deadline = Date.now() + LIMITS.processGroupSweepMs;
  do {
    let live = false;
    let visited = 0;
    for await (const entry of await opendir("/proc")) {
      if (++visited > LIMITS.maxProcessSweepEntries) throw new ProtocolError("limit_exceeded", "Process-group sweep exceeded its process count bound");
      if (!/^\d+$/.test(entry.name)) continue;
      try {
        const stat = await readFile(`/proc/${entry.name}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (Number(fields[2]) === pgid && !["Z", "X"].includes(fields[0])) { live = true; break; }
      } catch (error) { if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error; }
    }
    if (!live) return;
    await delay(LIMITS.processGroupPollMs);
  } while (Date.now() < deadline);
  throw new ProtocolError("unavailable", `Pi process group ${pgid} did not terminate within ${LIMITS.processGroupSweepMs} ms`);
}

export async function terminateProcessTree(child, { graceMs = LIMITS.shutdownGraceMs, signalImpl = signalProcessTree } = {}) {
  const sweep = () => signalImpl === signalProcessTree ? waitForProcessGroup(child?.pid) : Promise.resolve();
  if (hasExited(child) || !Number.isInteger(child?.pid)) {
    signalImpl(child, "SIGKILL");
    await sweep();
    return { escalated: false, alreadyExited: true };
  }
  const result = await new Promise((resolve, reject) => {
    let escalated = false;
    const deadline = setTimeout(() => {
      signalImpl(child, "SIGKILL");
      reject(new ProtocolError("unavailable", `Pi leader ${child.pid} did not exit after escalation`));
    }, graceMs + LIMITS.processGroupSweepMs);
    const timer = setTimeout(() => {
      escalated = true;
      signalImpl(child, "SIGKILL");
    }, graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      // The leader is gone; sweep any grandchildren that ignored SIGTERM.
      signalImpl(child, "SIGKILL");
      resolve({ escalated, alreadyExited: false });
    });
    signalImpl(child, "SIGTERM");
  });
  await sweep();
  return result;
}

// Synchronous best effort used from fatal paths where the event loop will not continue.
export function killProcessTreeNow(child) {
  signalProcessTree(child, "SIGKILL");
}
