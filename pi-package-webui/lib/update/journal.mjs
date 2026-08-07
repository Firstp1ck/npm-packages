import { randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const TERMINAL_STATES = new Set(["success", "partial", "failed", "rolled-back"]);
const INTERRUPTIBLE_STATES = new Set(["applying", "verifying", "activating"]);
const TRANSITIONS = Object.freeze({
  planned: new Set(["applying", "failed"]),
  applying: new Set(["verifying", "failed", "partial"]),
  verifying: new Set(["activating", "success", "partial", "failed"]),
  activating: new Set(["success", "partial", "failed", "rolled-back"]),
  success: new Set(["rolled-back"]), partial: new Set(), failed: new Set(), "rolled-back": new Set(),
});

export function updateStatePaths(agentDir) {
  const root = path.join(path.resolve(agentDir), "webui");
  return Object.freeze({
    root,
    updatesDir: path.join(root, "updates"),
    locksDir: path.join(root, "locks"),
    installLock: path.join(root, "locks", "install.lock"),
  });
}

function journalPath(agentDir, transactionId) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(String(transactionId || ""))) throw new TypeError("invalid transaction id");
  return path.join(updateStatePaths(agentDir).updatesDir, `${transactionId}.json`);
}

async function writePrivateTemporary(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600).catch(() => undefined);
  return temporary;
}

async function atomicJson(filePath, value) {
  const temporary = await writePrivateTemporary(filePath, value);
  try {
    await rename(temporary, filePath);
    await chmod(filePath, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function atomicCreateJson(filePath, value) {
  const temporary = await writePrivateTemporary(filePath, value);
  try {
    await link(temporary, filePath);
    await chmod(filePath, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function readUpdateJournal(agentDir, transactionId) {
  try {
    return JSON.parse(await readFile(journalPath(agentDir, transactionId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function createUpdateJournal(agentDir, plan, { now = () => new Date() } = {}) {
  if (!plan?.transactionId || !plan?.digest) throw new TypeError("persisted plan with transactionId and digest is required");
  const filePath = journalPath(agentDir, plan.transactionId);
  const timestamp = now().toISOString();
  const journal = { schemaVersion: 1, transactionId: plan.transactionId, planDigest: plan.digest, state: "planned", createdAt: timestamp, updatedAt: timestamp, plan, receipts: [], history: [{ state: "planned", at: timestamp }] };
  try {
    await atomicCreateJson(filePath, journal);
  } catch (error) {
    if (error?.code === "EEXIST") throw Object.assign(new Error("Update journal already exists."), { code: "UPDATE_JOURNAL_EXISTS" });
    throw error;
  }
  return journal;
}

export async function transitionUpdateJournal(agentDir, transactionId, nextState, patch = {}, { now = () => new Date() } = {}) {
  const current = await readUpdateJournal(agentDir, transactionId);
  if (!current) throw Object.assign(new Error("Update journal not found."), { code: "UPDATE_JOURNAL_NOT_FOUND" });
  if (!TRANSITIONS[current.state]?.has(nextState)) throw Object.assign(new Error(`Invalid update transition ${current.state} -> ${nextState}.`), { code: "UPDATE_JOURNAL_TRANSITION" });
  const at = now().toISOString();
  const next = { ...current, ...patch, schemaVersion: 1, transactionId: current.transactionId, planDigest: current.planDigest, plan: current.plan, state: nextState, updatedAt: at, history: [...(current.history || []), { state: nextState, at }] };
  await atomicJson(journalPath(agentDir, transactionId), next);
  return next;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

export async function acquireInstallLock(agentDir, {
  pid = process.pid,
  now = () => new Date(),
  staleAfterMs = 15 * 60_000,
  isProcessAlive = processAlive,
} = {}) {
  const paths = updateStatePaths(agentDir);
  await mkdir(paths.locksDir, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const record = { schemaVersion: 1, token, pid, acquiredAt: now().toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(paths.installLock, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return Object.freeze({ ...record, path: paths.installLock });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existing = null;
      let age = 0;
      try {
        existing = JSON.parse(await readFile(paths.installLock, "utf8"));
        age = now().getTime() - new Date(existing.acquiredAt).getTime();
      } catch {
        const info = await stat(paths.installLock);
        age = now().getTime() - info.mtimeMs;
      }
      const definitelyDead = Number.isInteger(existing?.pid) && existing.pid > 0 && !isProcessAlive(existing.pid);
      const malformedAndOld = !existing && age > staleAfterMs;
      if (age > staleAfterMs && (definitelyDead || malformedAndOld)) {
        await rm(paths.installLock, { force: true });
        continue;
      }
      throw Object.assign(new Error("Another update process owns the install lock."), { code: "UPDATE_LOCKED", owner: existing });
    }
  }
  throw Object.assign(new Error("Unable to acquire the install lock safely."), { code: "UPDATE_LOCKED" });
}

export async function transferInstallLock(lock, pid, { now = () => new Date() } = {}) {
  if (!lock?.path || !lock?.token || !Number.isInteger(pid) || pid <= 0) throw new TypeError("lock token and live destination pid are required");
  const current = JSON.parse(await readFile(lock.path, "utf8"));
  if (current.token !== lock.token) throw Object.assign(new Error("Install lock ownership changed before transfer."), { code: "UPDATE_LOCK_OWNERSHIP_CHANGED" });
  const next = { ...current, pid, transferredAt: now().toISOString() };
  await atomicJson(lock.path, next);
  return Object.freeze({ ...next, path: lock.path });
}

export async function releaseInstallLock(lock) {
  if (!lock?.path || !lock?.token) return false;
  let current;
  try { current = JSON.parse(await readFile(lock.path, "utf8")); } catch { return false; }
  if (current.token !== lock.token) return false;
  await rm(lock.path, { force: true });
  return true;
}

export async function reconcileInterruptedUpdates(agentDir, { recover, now = () => new Date() } = {}) {
  const paths = updateStatePaths(agentDir);
  let entries;
  try { entries = await readdir(paths.updatesDir); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const results = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const transactionId = entry.slice(0, -5);
    const journal = await readUpdateJournal(agentDir, transactionId);
    if (!journal || TERMINAL_STATES.has(journal.state) || !INTERRUPTIBLE_STATES.has(journal.state)) continue;
    let recovery = { state: "failed", error: "Update interrupted before completion." };
    if (typeof recover === "function") recovery = await recover(journal) || recovery;
    const nextState = journal.state === "activating" && recovery.state === "rolled-back" ? "rolled-back" : "failed";
    results.push(await transitionUpdateJournal(agentDir, transactionId, nextState, { ...recovery, state: nextState, reconciled: true }, { now }));
  }
  return results;
}
