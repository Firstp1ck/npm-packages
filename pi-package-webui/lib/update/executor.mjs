import { spawn } from "node:child_process";
import { terminateProcessTree } from "../process-tree.mjs";
import { failedTargetReceipt, reduceUpdateReceipts } from "./verify.mjs";

function boundedAppend(current, chunk, maxLength) {
  const next = current + String(chunk || "");
  return next.length <= maxLength ? next : next.slice(next.length - maxLength);
}

/** Spawn with argument arrays, terminate the whole tree on timeout, and await closure. */
export function executeCommand(command, args = [], {
  cwd,
  env,
  timeoutMs = 120_000,
  closeTimeoutMs = 10_000,
  maxOutputLength = 16_000,
  spawnImpl = spawn,
  terminateTree = terminateProcessTree,
  platform = process.platform,
} = {}) {
  if (!command || !Array.isArray(args)) throw new TypeError("command and argument array are required");
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let terminationError = "";
    let closeTimer;
    const child = spawnImpl(String(command), args.map(String), {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => { stdout = boundedAppend(stdout, chunk, maxOutputLength); });
    child.stderr?.on("data", (chunk) => { stderr = boundedAppend(stderr, chunk, maxOutputLength); });

    const finish = (exitCode, signal, error = null, closureTimedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(closeTimer);
      resolve(Object.freeze({
        command: String(command), args: Object.freeze(args.map(String)), exitCode,
        signal: signal || null, timedOut, closureTimedOut,
        stdout, stderr, error: error ? String(error.message || error) : terminationError,
        durationMs: Date.now() - startedAt,
      }));
    };

    child.once("error", (error) => finish(null, null, error));
    child.once("close", (code, signal) => finish(code, signal));
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        if (!terminateTree(child, "SIGKILL")) terminationError = "Process-tree termination could not be confirmed.";
      } catch (error) {
        terminationError = String(error?.message || error);
      }
      closeTimer = setTimeout(() => {
        try { child.kill?.("SIGKILL"); } catch {}
        finish(null, "SIGKILL", null, true);
      }, Math.max(100, closeTimeoutMs));
      closeTimer.unref?.();
    }, Math.max(1, timeoutMs));
    timeout.unref?.();
  });
}

/** Execute immutable plan targets in order through an injectable runner seam. */
export async function executePlanTargets(plan, {
  runner = executeCommand,
  verifyTarget,
  beforeTarget,
  stopOnFailure = false,
} = {}) {
  if (typeof verifyTarget !== "function") throw new TypeError("verifyTarget is required");
  const receipts = [];
  for (const target of plan?.targets || []) {
    try {
      if (beforeTarget) await beforeTarget(target);
      const commandResult = await runner(target.command.command, target.command.args, { target });
      if (commandResult.exitCode !== 0 || commandResult.timedOut || commandResult.error) {
        receipts.push(failedTargetReceipt(target, commandResult.timedOut ? "Update command timed out." : "Update command failed.", { command: commandResult }));
        if (stopOnFailure) break;
        continue;
      }
      receipts.push(await verifyTarget(target, commandResult));
    } catch (error) {
      receipts.push(failedTargetReceipt(target, String(error?.message || error)));
      if (stopOnFailure) break;
    }
  }
  return reduceUpdateReceipts(receipts);
}
