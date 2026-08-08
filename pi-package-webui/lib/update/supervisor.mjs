import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { updateStatePaths } from "./journal.mjs";

const POINTER_SCHEMA = 1;
const RESTORE_SCHEMA = 1;
const MAX_RESTORE_TABS = 256;
const MAX_RESTORE_BYTES = 2 * 1024 * 1024;

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function managedRuntimePaths(agentDir) {
  const root = updateStatePaths(agentDir).root;
  return Object.freeze({
    root,
    runtimesDir: path.join(root, "runtimes"),
    tempDir: path.join(root, "tmp"),
    currentPointer: path.join(root, "current.json"),
    previousPointer: path.join(root, "previous.json"),
  });
}

async function privateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600).catch(() => undefined);
  try { await rename(temporary, file); } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  await chmod(file, 0o600).catch(() => undefined);
}

export async function readRuntimePointer(agentDir, name = "current") {
  if (!new Set(["current", "previous"]).has(name)) throw new TypeError("pointer name must be current or previous");
  const paths = managedRuntimePaths(agentDir);
  const file = name === "current" ? paths.currentPointer : paths.previousPointer;
  let pointer;
  try { pointer = JSON.parse(await readFile(file, "utf8")); } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
  const runtimeRoot = typeof pointer?.runtimeRoot === "string" ? path.resolve(pointer.runtimeRoot) : "";
  const serverEntry = typeof pointer?.serverEntry === "string" ? path.resolve(pointer.serverEntry) : "";
  if (pointer?.schemaVersion !== POINTER_SCHEMA || !runtimeRoot || !serverEntry || !inside(paths.runtimesDir, runtimeRoot) || !inside(runtimeRoot, serverEntry)) return null;
  try {
    if (!(await stat(runtimeRoot)).isDirectory() || !(await stat(serverEntry)).isFile()) return null;
    const [canonicalRuntimesDir, canonicalRuntimeRoot, canonicalServerEntry] = await Promise.all([
      realpath(paths.runtimesDir),
      realpath(runtimeRoot),
      realpath(serverEntry),
    ]);
    if (!inside(canonicalRuntimesDir, canonicalRuntimeRoot) || !inside(canonicalRuntimeRoot, canonicalServerEntry)) return null;
    return Object.freeze({ ...pointer, runtimeRoot: canonicalRuntimeRoot, serverEntry: canonicalServerEntry });
  } catch { return null; }
}

export async function writeRuntimePointer(agentDir, name, pointer) {
  if (!new Set(["current", "previous"]).has(name)) throw new TypeError("pointer name must be current or previous");
  const paths = managedRuntimePaths(agentDir);
  const runtimeRoot = path.resolve(String(pointer?.runtimeRoot || ""));
  const serverEntry = path.resolve(String(pointer?.serverEntry || ""));
  if (!inside(paths.runtimesDir, runtimeRoot) || !inside(runtimeRoot, serverEntry)) throw Object.assign(new Error("Managed runtime pointer escapes the private runtime root."), { code: "UPDATE_POINTER_ESCAPE" });
  let canonicalRuntimesDir;
  let canonicalRuntimeRoot;
  let canonicalServerEntry;
  try {
    [canonicalRuntimesDir, canonicalRuntimeRoot, canonicalServerEntry] = await Promise.all([
      realpath(paths.runtimesDir),
      realpath(runtimeRoot),
      realpath(serverEntry),
    ]);
  } catch {
    throw Object.assign(new Error("Managed runtime pointer target is incomplete."), { code: "UPDATE_POINTER_INCOMPLETE" });
  }
  if (!inside(canonicalRuntimesDir, canonicalRuntimeRoot) || !inside(canonicalRuntimeRoot, canonicalServerEntry)) {
    throw Object.assign(new Error("Managed runtime pointer resolves outside the private runtime root."), { code: "UPDATE_POINTER_ESCAPE" });
  }
  const record = { schemaVersion: POINTER_SCHEMA, runtimeRoot: canonicalRuntimeRoot, serverEntry: canonicalServerEntry, version: String(pointer.version || ""), activatedAt: pointer.activatedAt || new Date().toISOString() };
  await privateJson(name === "current" ? paths.currentPointer : paths.previousPointer, record);
  return Object.freeze(record);
}

export async function switchRuntimePointer(agentDir, candidate) {
  const current = await readRuntimePointer(agentDir, "current");
  if (current) await writeRuntimePointer(agentDir, "previous", current);
  const next = await writeRuntimePointer(agentDir, "current", candidate);
  return Object.freeze({ current: next, previous: current });
}

export async function rollbackRuntimePointer(agentDir) {
  const paths = managedRuntimePaths(agentDir);
  const previous = await readRuntimePointer(agentDir, "previous");
  const current = await readRuntimePointer(agentDir, "current");
  if (!previous) {
    await rm(paths.currentPointer, { force: true });
    if (current) await writeRuntimePointer(agentDir, "previous", current);
    return Object.freeze({ current: null, previous: current, bootstrapFallback: true });
  }
  await writeRuntimePointer(agentDir, "current", previous);
  if (current) await writeRuntimePointer(agentDir, "previous", current);
  return Object.freeze({ current: previous, previous: current, bootstrapFallback: false });
}

function normalizeRestoreTab(item, seen) {
  if (!item || typeof item !== "object") return null;
  const text = (value, max) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  const rawId = text(item.id, 128);
  const id = rawId && /^[A-Za-z0-9._:-]+$/.test(rawId) && !seen.has(rawId) ? rawId : undefined;
  if (id) seen.add(id);
  const tab = { id, title: text(item.title, 160), titleSource: text(item.titleSource, 32), cwd: text(item.cwd, 4096), sessionFile: text(item.sessionFile, 4096), conversationStarted: item.conversationStarted === true };
  if (Number.isInteger(item.index) && item.index > 0) tab.index = item.index;
  return tab;
}

export async function createRestoreFile(agentDir, tabs, { now = () => new Date() } = {}) {
  const paths = managedRuntimePaths(agentDir);
  const seen = new Set();
  const normalized = (Array.isArray(tabs) ? tabs : []).map((item) => normalizeRestoreTab(item, seen)).filter(Boolean).slice(0, MAX_RESTORE_TABS);
  const payload = { schemaVersion: RESTORE_SCHEMA, createdAt: now().toISOString(), tabs: normalized };
  const encoded = `${JSON.stringify(payload)}\n`;
  if (Buffer.byteLength(encoded) > MAX_RESTORE_BYTES) throw Object.assign(new Error("Restore descriptor file exceeds the private handoff limit."), { code: "RESTORE_FILE_TOO_LARGE" });
  await mkdir(paths.tempDir, { recursive: true, mode: 0o700 });
  const file = path.join(paths.tempDir, `restore-${randomUUID()}.json`);
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(encoded, "utf8"); await handle.sync(); } finally { await handle.close(); }
  return Object.freeze({ file, count: normalized.length });
}

export async function readRestoreFileOnce(file, agentDir) {
  if (!file) return [];
  const paths = managedRuntimePaths(agentDir);
  const resolved = path.resolve(file);
  if (!inside(paths.tempDir, resolved)) throw Object.assign(new Error("Restore descriptor path is outside the private temp root."), { code: "RESTORE_FILE_ESCAPE" });
  let raw;
  try {
    const info = await stat(resolved);
    if (!info.isFile() || info.size > MAX_RESTORE_BYTES) throw new Error("Restore descriptor is not a bounded file.");
    raw = await readFile(resolved, "utf8");
  } finally {
    await rm(resolved, { force: true }).catch(() => undefined);
  }
  const parsed = JSON.parse(raw);
  if (parsed?.schemaVersion !== RESTORE_SCHEMA || !Array.isArray(parsed.tabs) || parsed.tabs.length > MAX_RESTORE_TABS) throw new Error("Restore descriptor schema is invalid.");
  const seen = new Set();
  return parsed.tabs.map((item) => normalizeRestoreTab(item, seen)).filter(Boolean);
}

export async function sweepRestoreFiles(agentDir, { olderThanMs = 24 * 60 * 60_000, now = Date.now() } = {}) {
  const { tempDir } = managedRuntimePaths(agentDir);
  let entries = [];
  try { entries = await readdir(tempDir); } catch (error) { if (error?.code === "ENOENT") return 0; throw error; }
  let removed = 0;
  for (const name of entries.filter((entry) => /^restore-[a-f0-9-]+\.json$/i.test(entry))) {
    const file = path.join(tempDir, name);
    try { if (now - (await stat(file)).mtimeMs > olderThanMs) { await rm(file, { force: true }); removed += 1; } } catch {}
  }
  return removed;
}

export async function listenWithRetry(server, { port, host, attempts = 40, initialDelayMs = 250 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError); server.once("listening", onListening); server.listen(port, host);
      });
      return attempt + 1;
    } catch (error) {
      if (error?.code !== "EADDRINUSE" || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, initialDelayMs));
    }
  }
  throw new Error("Listener retry exhausted.");
}

export async function probeCandidateRuntime(serverEntry, { expectedVersion, expectedPiVersion, timeoutMs = 20_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(process.execPath, [serverEntry, "--candidate-probe"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PI_WEBUI_CANDIDATE_PROBE: "1" } });
    let stdout = "", stderr = "", settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(Object.freeze(result)); };
    child.stdout?.on("data", (chunk) => { stdout = (stdout + chunk).slice(-16_000); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_000); });
    child.once("error", (error) => finish({ ok: false, error: String(error.message || error), stdout, stderr }));
    child.once("close", (code) => {
      let data = null;
      try { data = JSON.parse(stdout.trim().split(/\r?\n/).at(-1)); } catch {}
      const ok = code === 0
        && data?.ok === true
        && (!expectedVersion || data.version === expectedVersion)
        && (!expectedPiVersion || data.piVersion === expectedPiVersion);
      finish({ ok, code, data, stdout, stderr, error: ok ? "" : "Candidate probe did not verify the expected Web UI runtime." });
    });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} finish({ ok: false, timedOut: true, stdout, stderr, error: "Candidate probe timed out." }); }, timeoutMs);
    timer.unref?.();
  });
}

export async function collectManagedRuntimes(agentDir, { protectedRoots = [], keepHealthyForMs = 7 * 24 * 60 * 60_000, now = Date.now() } = {}) {
  const paths = managedRuntimePaths(agentDir);
  const statePaths = updateStatePaths(agentDir);
  const current = await readRuntimePointer(agentDir, "current");
  const previous = await readRuntimePointer(agentDir, "previous");
  const protectedSet = new Set([current?.runtimeRoot, previous?.runtimeRoot, ...protectedRoots].filter(Boolean).map((item) => path.resolve(item)));
  try {
    for (const name of await readdir(statePaths.updatesDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const journal = JSON.parse(await readFile(path.join(statePaths.updatesDir, name), "utf8"));
        for (const target of journal?.plan?.targets || []) {
          const runtimeRoot = target?.metadata?.runtimeRoot;
          if (runtimeRoot && inside(paths.runtimesDir, runtimeRoot)) protectedSet.add(path.resolve(runtimeRoot));
        }
      } catch {}
    }
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  let entries = [];
  try { entries = await readdir(paths.runtimesDir, { withFileTypes: true }); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(paths.runtimesDir, entry.name);
    if (protectedSet.has(path.resolve(root))) continue;
    try {
      const info = await stat(root);
      if (now - info.mtimeMs < keepHealthyForMs) continue;
      await rm(root, { recursive: true, force: true });
      removed.push(root);
    } catch {}
  }
  return removed;
}

export const UPDATE_RESTORE_LIMIT = MAX_RESTORE_TABS;
