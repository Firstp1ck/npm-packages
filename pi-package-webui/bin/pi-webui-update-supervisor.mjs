#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollbackRuntimePointer, switchRuntimePointer } from "../lib/update/supervisor.mjs";
import { releaseInstallLock, transitionUpdateJournal, updateStatePaths } from "../lib/update/journal.mjs";

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Activation helper requires paired --key value arguments.");
    result[key.slice(2)] = value;
  }
  return result;
}
function integer(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} is invalid`);
  return parsed;
}
async function health(url, expectedVersion, expectedPiVersion, oldBootIdentity) {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(1_500) });
    const body = await response.json();
    return response.ok
      && body?.ok === true
      && (!expectedVersion || body.webuiVersion === expectedVersion)
      && (!expectedPiVersion || body.piVersion === expectedPiVersion)
      && body.bootIdentity
      && body.bootIdentity !== oldBootIdentity ? body : null;
  } catch { return null; }
}
async function waitForHealth(url, expectedVersion, expectedPiVersion, oldBootIdentity, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await health(url, expectedVersion, expectedPiVersion, oldBootIdentity);
    if (body) return body;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}
function launch(launcher, serverArgs, env) {
  const child = spawn(process.execPath, [launcher, ...serverArgs], { cwd: process.cwd(), env, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return child.pid;
}

const options = args(process.argv.slice(2));
const agentDir = path.resolve(options["agent-dir"] || "");
const runtimeRoot = path.resolve(options["runtime-root"] || "");
const serverEntry = path.resolve(options["server-entry"] || "");
const version = String(options.version || "");
const piVersion = String(options["pi-version"] || "");
const outcome = String(options.outcome || "success");
const transactionId = String(options.transaction || "");
const url = String(options.url || "");
const oldBootIdentity = String(options["old-boot"] || "");
const timeoutMs = integer(options["timeout-ms"] || "90000", "timeout");
const serverArgs = JSON.parse(Buffer.from(options["server-args"] || "", "base64url").toString("utf8"));
if (!Array.isArray(serverArgs) || !agentDir || !runtimeRoot || !serverEntry || !version || !piVersion || !url || !transactionId || !new Set(["success", "partial"]).has(outcome)) throw new Error("Activation helper arguments are incomplete.");
const launcher = path.join(path.dirname(fileURLToPath(import.meta.url)), "pi-webui-launcher.mjs");

const lockToken = String(process.env.PI_WEBUI_UPDATE_LOCK_TOKEN || "");
delete process.env.PI_WEBUI_UPDATE_LOCK_TOKEN;
const transferredLock = lockToken ? { path: updateStatePaths(agentDir).installLock, token: lockToken } : null;
let exitCode = 1;
try {
  await transitionUpdateJournal(agentDir, transactionId, "activating", { activation: { runtimeRoot, serverEntry, expectedVersion: version } });
  await switchRuntimePointer(agentDir, { runtimeRoot, serverEntry, version });
  launch(launcher, serverArgs, { ...process.env, PI_WEBUI_ACTIVATION_TRANSACTION: transactionId });
  const activated = await waitForHealth(url, version, piVersion, oldBootIdentity, timeoutMs);
  if (activated) {
    await transitionUpdateJournal(agentDir, transactionId, outcome, { outcome, activated: { version, piVersion, bootIdentity: activated.bootIdentity, at: new Date().toISOString() } });
    exitCode = 0;
  } else {
    await rollbackRuntimePointer(agentDir);
    launch(launcher, serverArgs, { ...process.env, PI_WEBUI_ACTIVATION_TRANSACTION: transactionId, PI_WEBUI_ROLLBACK_TRANSACTION: transactionId });
    const rolledBack = await waitForHealth(url, "", "", oldBootIdentity, Math.min(timeoutMs, 30_000));
    await transitionUpdateJournal(agentDir, transactionId, "rolled-back", { outcome: "rolled-back", rollback: { reachable: Boolean(rolledBack), at: new Date().toISOString(), reason: "Candidate failed the changed-identity health gate." } });
    exitCode = rolledBack ? 2 : 3;
  }
} finally {
  if (transferredLock) await releaseInstallLock(transferredLock).catch(() => false);
}
process.exit(exitCode);
