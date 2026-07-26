import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RPC_SUPERVISOR_PROTOCOL, sanitizeSupervisorData } from "./rpc-supervisor-protocol.mjs";

const STATE_FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const STARTUP_LOCK_STALE_MS = 30_000;

function scopeDigest(agentDir, port) {
  return createHash("sha256").update(`${path.resolve(agentDir)}\0${port}`).digest("hex");
}

async function secureMkdir(directory) {
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  if (process.platform !== "win32") await chmod(directory, DIRECTORY_MODE);
}

export async function supervisorPaths({ agentDir, port, runtimeDir } = {}) {
  if (!agentDir || typeof agentDir !== "string") throw new TypeError("agentDir is required");
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new TypeError("port must be an integer between 1 and 65535");
  const root = runtimeDir ? path.resolve(runtimeDir) : path.join(path.resolve(agentDir), "webui-rpc-supervisor");
  const scopeId = scopeDigest(agentDir, Number(port));
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\pi-webui-rpc-${scopeId}`
    : path.join(root, `${scopeId.slice(0, 24)}.sock`);
  return {
    root,
    scopeId,
    socketPath,
    stateFile: path.join(root, `${scopeId}.json`),
    journalFile: path.join(root, `${scopeId}.journal.jsonl`),
    lockFile: path.join(root, `${scopeId}.start.lock`),
  };
}

export async function ensureSupervisorRuntime(paths) {
  await secureMkdir(paths.root);
}

export function newSupervisorToken() {
  return randomBytes(32).toString("base64url");
}

function validateState(value, paths) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.scopeId !== paths.scopeId || value.socketPath !== paths.socketPath) return null;
  if (!value.token || typeof value.token !== "string" || !value.instanceId || typeof value.instanceId !== "string") return null;
  if (!Number.isInteger(value.pid) || value.pid < 1) return null;
  if (!value.version || !Number.isInteger(value.version.major) || !Number.isInteger(value.version.minor)) return null;
  return value;
}

export async function readSupervisorState(paths) {
  try {
    const text = await readFile(paths.stateFile, "utf8");
    return validateState(JSON.parse(text), paths);
  } catch {
    return null;
  }
}

export async function writeSupervisorState(paths, state) {
  await ensureSupervisorRuntime(paths);
  const payload = {
    scopeId: paths.scopeId,
    socketPath: paths.socketPath,
    version: RPC_SUPERVISOR_PROTOCOL,
    ...sanitizeSupervisorData(state),
  };
  // The local token is needed by the server adapter; sanitizer intentionally
  // never receives it so no secret-key heuristic can remove the state token.
  if (typeof state?.token === "string") payload.token = state.token;
  const temporary = `${paths.stateFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload)}\n`, { mode: STATE_FILE_MODE });
  if (process.platform !== "win32") await chmod(temporary, STATE_FILE_MODE);
  await rename(temporary, paths.stateFile);
  if (process.platform !== "win32") await chmod(paths.stateFile, STATE_FILE_MODE);
  return payload;
}

export function supervisorPidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Remove private runtime files only for the recorded supervisor incarnation.
 * Startup callers must hold the startup lock and independently confirm death.
 */
export async function removeSupervisorState(paths, { removeSocket = false, instanceId } = {}) {
  if (instanceId !== undefined) {
    const current = await readSupervisorState(paths);
    if (!current || current.instanceId !== instanceId) return false;
  }
  await rm(paths.stateFile, { force: true });
  if (removeSocket && process.platform !== "win32") {
    const info = await lstat(paths.socketPath).catch(() => null);
    if (info?.isSocket()) await rm(paths.socketPath, { force: true });
  }
  return true;
}

/** Append an intentionally secret-stripped bounded metadata record. */
export async function appendSupervisorJournal(paths, entry, { maxBytes = 256 * 1024 } = {}) {
  await ensureSupervisorRuntime(paths);
  const record = `${JSON.stringify(sanitizeSupervisorData({ at: new Date().toISOString(), ...entry }))}\n`;
  if (Buffer.byteLength(record) > 64 * 1024) throw new RangeError("supervisor journal record exceeds 65536 bytes");
  const existing = await stat(paths.journalFile).catch(() => null);
  if (existing?.size && existing.size + Buffer.byteLength(record) > maxBytes) {
    await writeFile(paths.journalFile, record, { mode: STATE_FILE_MODE });
  } else {
    await writeFile(paths.journalFile, record, { flag: "a", mode: STATE_FILE_MODE });
  }
  if (process.platform !== "win32") await chmod(paths.journalFile, STATE_FILE_MODE);
}

export async function acquireStartupLock(paths, { staleMs = STARTUP_LOCK_STALE_MS } = {}) {
  await ensureSupervisorRuntime(paths);
  try {
    const handle = await open(paths.lockFile, "wx", STATE_FILE_MODE);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`);
    return async () => {
      await handle.close().catch(() => {});
      await rm(paths.lockFile, { force: true }).catch(() => {});
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const lock = await stat(paths.lockFile).catch(() => null);
    if (lock && Date.now() - lock.mtimeMs > staleMs) {
      await rm(paths.lockFile, { force: true });
      return acquireStartupLock(paths, { staleMs });
    }
    return null;
  }
}

export async function waitForSupervisorState(paths, { timeoutMs = 8_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readSupervisorState(paths);
    if (state) return state;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export function sanitizedSupervisorEnvironment(source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^PI_WEBUI_RPC_SUPERVISOR(?:_|$)/i.test(key) || /^RPC_SUPERVISOR_(?:TOKEN|SECRET)/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export function defaultAgentDir() {
  return process.env.PI_CODING_AGENT_DIR || path.join(tmpdir(), "pi-agent");
}
