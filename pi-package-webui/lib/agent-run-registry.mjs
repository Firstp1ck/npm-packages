import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  AGENT_RUN_LIMITS,
  isTerminalAgentStatus,
  normalizeAgentInstance,
} from "./agent-run-protocol.mjs";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RECORD_MAX_BYTES = 64 * 1024;
const EVENT_LINE_MAX_BYTES = 16 * 1024;
const DEFAULT_EVENT_MAX_BYTES = 256 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function safeId(value, field, maximum = AGENT_RUN_LIMITS.id) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || Buffer.byteLength(text) > maximum || !SAFE_ID.test(text)) throw fail("AGENT_RUN_UNSAFE_ID", `${field} must be an opaque safe identifier`);
  return text;
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail("AGENT_RUN_REGISTRY_SYMLINK", "Agent-run registry directory must not be a symlink");
  if (process.platform !== "win32") await chmod(directory, DIRECTORY_MODE);
  return realpath(directory);
}

async function safeRegularFile(file, canonicalRoot, maximum) {
  const info = await lstat(file).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink() || info.size > maximum) return null;
  const canonical = await realpath(file).catch(() => null);
  if (!canonical || !inside(canonicalRoot, canonical)) return null;
  return { info, canonical };
}

export function agentRunScopeId(agentDir, port) {
  if (!agentDir || typeof agentDir !== "string") throw new TypeError("agentDir is required");
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) throw new TypeError("port must be an integer between 1 and 65535");
  // Deliberately identical to rpc-supervisor-state.mjs scopeDigest semantics.
  return createHash("sha256").update(`${path.resolve(agentDir)}\0${numericPort}`).digest("hex");
}

export function defaultAgentRunStateHome(environment = process.env) {
  return path.resolve(environment.XDG_STATE_HOME || path.join(homedir(), ".local", "state"));
}

export function agentRunRegistryPaths({ agentDir, port, stateHome, scopeId } = {}) {
  const stateRoot = path.resolve(stateHome || defaultAgentRunStateHome());
  const scope = scopeId ? safeId(scopeId, "scopeId") : agentRunScopeId(agentDir, port);
  const webuiRoot = path.join(stateRoot, "pi-webui");
  const registryBase = path.join(webuiRoot, "agent-runs");
  return Object.freeze({ stateRoot, webuiRoot, registryBase, scopeId: scope, root: path.join(registryBase, scope) });
}

export function createAgentRunRecordId() {
  return randomUUID();
}

export function ageAgentRun(instanceValue, now = Date.now(), { staleAfterMs = 30_000, lostAfterMs = 120_000 } = {}) {
  const instance = normalizeAgentInstance(instanceValue);
  if (isTerminalAgentStatus(instance.status) || !["running", "stale"].includes(instance.status)) return instance;
  const elapsed = Math.max(0, now - instance.updatedAt);
  const status = elapsed >= lostAfterMs ? "lost" : elapsed >= staleAfterMs ? "stale" : "running";
  if (status === instance.status) return instance;
  return normalizeAgentInstance({ ...instance, status, endedAt: null });
}

function boundedUtf8(value, maximum) {
  const encoded = Buffer.from(value, "utf8");
  return encoded.length <= maximum ? value : encoded.subarray(0, maximum).toString("utf8");
}

function normalizeArtifactEvent(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("AGENT_RUN_EVENT_INVALID", "Artifact event must be an object");
  const type = safeId(String(value.type || "event"), "event.type", 80);
  const event = { type, at: Number.isSafeInteger(value.at) && value.at >= 0 ? value.at : now };
  for (const [key, maximum] of [["stream", 16], ["tool", 120], ["status", 40], ["message", 8_192]]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string") throw fail("AGENT_RUN_EVENT_INVALID", `event.${key} must be a string`);
    const normalized = boundedUtf8(value[key], maximum);
    if (key !== "message" && /[\u0000-\u001f\u007f]/u.test(normalized)) throw fail("AGENT_RUN_EVENT_INVALID", `event.${key} contains control characters`);
    event[key] = normalized;
  }
  if (value.isError !== undefined) event.isError = value.isError === true;
  if (value.usage && typeof value.usage === "object" && !Array.isArray(value.usage)) {
    const usage = {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
      if (Number.isFinite(value.usage[key]) && value.usage[key] >= 0) usage[key] = Math.floor(value.usage[key]);
    }
    if (Object.keys(usage).length) event.usage = usage;
  }
  const encoded = `${JSON.stringify(event)}\n`;
  if (Buffer.byteLength(encoded) > EVENT_LINE_MAX_BYTES) throw fail("AGENT_RUN_EVENT_TOO_LARGE", `Artifact event exceeds ${EVENT_LINE_MAX_BYTES} bytes`);
  return { event: Object.freeze(event), encoded };
}

export class AgentRunRegistry {
  constructor(options = {}) {
    this.paths = agentRunRegistryPaths(options);
    this.eventMaxBytes = Math.max(EVENT_LINE_MAX_BYTES, Math.min(Number(options.eventMaxBytes) || DEFAULT_EVENT_MAX_BYTES, 4 * 1024 * 1024));
    this.staleAfterMs = Number(options.staleAfterMs) || 30_000;
    this.lostAfterMs = Number(options.lostAfterMs) || 120_000;
    this.finishedRetentionMs = Number(options.finishedRetentionMs) || 24 * 60 * 60_000;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.canonicalRoot = null;
  }

  async init() {
    const canonicalState = await ensurePrivateDirectory(this.paths.stateRoot);
    const canonicalWebui = await ensurePrivateDirectory(this.paths.webuiRoot);
    const canonicalBase = await ensurePrivateDirectory(this.paths.registryBase);
    const canonicalRoot = await ensurePrivateDirectory(this.paths.root);
    if (!inside(canonicalState, canonicalWebui) || !inside(canonicalState, canonicalBase) || !inside(canonicalState, canonicalRoot)) {
      throw fail("AGENT_RUN_REGISTRY_ESCAPE", "Agent-run registry resolves outside the configured private state root");
    }
    this.canonicalRoot = canonicalRoot;
    return this;
  }

  async #producerDirectory(producerId, { create = true } = {}) {
    if (!this.canonicalRoot) await this.init();
    const producer = safeId(producerId, "producerId", AGENT_RUN_LIMITS.providerId);
    const directory = path.join(this.paths.root, producer);
    if (create) {
      const canonical = await ensurePrivateDirectory(directory);
      if (!inside(this.canonicalRoot, canonical)) throw fail("AGENT_RUN_REGISTRY_ESCAPE", "Producer directory escapes the registry root");
      return { producer, directory, canonical };
    }
    const info = await lstat(directory).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) return null;
    const canonical = await realpath(directory).catch(() => null);
    return canonical && inside(this.canonicalRoot, canonical) ? { producer, directory, canonical } : null;
  }

  async writeRecord(producerId, instanceValue, { recordId } = {}) {
    const producer = await this.#producerDirectory(producerId);
    const id = safeId(recordId || createAgentRunRecordId(), "recordId");
    let instance = normalizeAgentInstance(instanceValue);
    if (instance.provider !== "webui-registry") throw fail("AGENT_RUN_PROVIDER_INVALID", "Cross-process registry records must use provider webui-registry");
    if (instance.outputRef.kind !== "none" && instance.outputRef.id !== id) {
      throw fail("AGENT_RUN_OUTPUT_ID_INVALID", "Registry outputRef.id must equal its opaque record ID");
    }
    const file = path.join(producer.directory, `${id}.json`);
    const temporary = path.join(producer.directory, `.${id}.${process.pid}.${randomUUID()}.tmp`);
    const encoded = `${JSON.stringify(instance)}\n`;
    if (Buffer.byteLength(encoded) > RECORD_MAX_BYTES) throw fail("AGENT_RUN_RECORD_TOO_LARGE", `Record exceeds ${RECORD_MAX_BYTES} bytes`);
    await writeFile(temporary, encoded, { encoding: "utf8", mode: FILE_MODE, flag: "wx" });
    if (process.platform !== "win32") await chmod(temporary, FILE_MODE);
    try {
      await rename(temporary, file);
      if (process.platform !== "win32") await chmod(file, FILE_MODE);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return Object.freeze({ producerId: producer.producer, recordId: id, instance });
  }

  async writeSessionLocator(producerId, recordId, sessionFile, { allowedRoots = [] } = {}) {
    const producer = await this.#producerDirectory(producerId);
    const id = safeId(recordId, "recordId");
    const roots = [];
    for (const root of allowedRoots) {
      const canonical = await realpath(path.resolve(root)).catch(() => null);
      if (canonical) roots.push(canonical);
    }
    if (!roots.length) throw fail("AGENT_RUN_SESSION_ROOT_REQUIRED", "A configured Pi session root is required");
    const info = await lstat(sessionFile).catch(() => null);
    const canonicalSession = info?.isFile() && !info.isSymbolicLink() ? await realpath(sessionFile).catch(() => null) : null;
    if (!canonicalSession || !roots.some((root) => inside(root, canonicalSession) && root !== canonicalSession)) {
      throw fail("AGENT_RUN_SESSION_ESCAPE", "Session locator must resolve inside a configured Pi session root");
    }
    const file = path.join(producer.directory, `${id}.session-locator`);
    const temporary = path.join(producer.directory, `.${id}.${process.pid}.${randomUUID()}.locator.tmp`);
    await writeFile(temporary, `${JSON.stringify({ version: 1, sessionFile: canonicalSession })}\n`, { encoding: "utf8", mode: FILE_MODE, flag: "wx" });
    if (process.platform !== "win32") await chmod(temporary, FILE_MODE);
    try {
      await rename(temporary, file);
      if (process.platform !== "win32") await chmod(file, FILE_MODE);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return Object.freeze({ id, sessionFile: canonicalSession });
  }

  async resolveSessionLocator(outputId, { allowedRoots = [] } = {}) {
    const id = safeId(outputId, "outputId");
    const snapshot = await this.readRecords();
    const owner = snapshot.artifacts.get(id);
    if (!owner || owner.kind !== "session-jsonl") return null;
    const producer = await this.#producerDirectory(owner.producerId, { create: false });
    if (!producer) return null;
    const locatorFile = path.join(producer.directory, `${id}.session-locator`);
    const safe = await safeRegularFile(locatorFile, producer.canonical, RECORD_MAX_BYTES);
    if (!safe) return null;
    let locator;
    try { locator = JSON.parse(await readFile(safe.canonical, "utf8")); } catch { return null; }
    if (locator?.version !== 1 || typeof locator.sessionFile !== "string") return null;
    const canonicalSession = await realpath(locator.sessionFile).catch(() => null);
    const info = canonicalSession ? await lstat(canonicalSession).catch(() => null) : null;
    if (!info?.isFile() || info.isSymbolicLink()) return null;
    const roots = await Promise.all(allowedRoots.map((root) => realpath(path.resolve(root)).catch(() => null)));
    if (!roots.some((root) => root && inside(root, canonicalSession) && root !== canonicalSession)) return null;
    return Object.freeze({ id, kind: owner.kind, sessionFile: canonicalSession });
  }

  async appendArtifactEvent(producerId, recordId, eventValue) {
    const producer = await this.#producerDirectory(producerId);
    const id = safeId(recordId, "recordId");
    const { event, encoded } = normalizeArtifactEvent(eventValue, this.now());
    const file = path.join(producer.directory, `${id}.events.jsonl`);
    let existing = "";
    const safe = await safeRegularFile(file, producer.canonical, this.eventMaxBytes).catch(() => null);
    if (safe) existing = await readFile(safe.canonical, "utf8");
    const lines = `${existing}${encoded}`.split("\n").filter(Boolean);
    let bytes = 0;
    const kept = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = `${lines[index]}\n`;
      const size = Buffer.byteLength(line);
      if (size > EVENT_LINE_MAX_BYTES) continue;
      if (bytes + size > this.eventMaxBytes) break;
      bytes += size;
      kept.push(line);
    }
    kept.reverse();
    const temporary = path.join(producer.directory, `.${id}.${process.pid}.${randomUUID()}.events.tmp`);
    await writeFile(temporary, kept.join(""), { encoding: "utf8", mode: FILE_MODE, flag: "wx" });
    if (process.platform !== "win32") await chmod(temporary, FILE_MODE);
    try {
      await rename(temporary, file);
      if (process.platform !== "win32") await chmod(file, FILE_MODE);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return event;
  }

  async readRecords({ now = this.now(), maxRecords = 2_048 } = {}) {
    if (!this.canonicalRoot) await this.init();
    const records = [];
    const diagnostics = [];
    const artifacts = new Map();
    let omitted = 0;
    const producers = await readdir(this.paths.root, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of producers) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_ID.test(entry.name)) {
        diagnostics.push({ code: "ignored-producer", producerId: SAFE_ID.test(entry.name) ? entry.name : undefined });
        continue;
      }
      const producer = await this.#producerDirectory(entry.name, { create: false });
      if (!producer) { diagnostics.push({ code: "unsafe-producer", producerId: entry.name }); continue; }
      const entries = await readdir(producer.directory, { withFileTypes: true }).catch(() => []);
      for (const fileEntry of entries) {
        if (!fileEntry.name.endsWith(".json") || fileEntry.name.endsWith(".events.jsonl")) continue;
        if (records.length >= maxRecords) { omitted += 1; continue; }
        const recordId = fileEntry.name.slice(0, -5);
        if (!SAFE_ID.test(recordId) || fileEntry.isSymbolicLink()) { diagnostics.push({ code: "unsafe-record", producerId: entry.name }); continue; }
        const file = path.join(producer.directory, fileEntry.name);
        const safe = await safeRegularFile(file, producer.canonical, RECORD_MAX_BYTES).catch(() => null);
        if (!safe) { diagnostics.push({ code: "unsafe-or-oversized-record", producerId: entry.name, recordId }); continue; }
        try {
          const parsed = JSON.parse(await readFile(safe.canonical, "utf8"));
          const instance = ageAgentRun(normalizeAgentInstance(parsed), now, { staleAfterMs: this.staleAfterMs, lostAfterMs: this.lostAfterMs });
          if (instance.provider !== "webui-registry") throw new Error("provider is not webui-registry");
          if (instance.outputRef.kind !== "none") {
            if (instance.outputRef.id !== recordId) throw new Error("output ID does not match record ID");
            artifacts.set(recordId, { producerId: entry.name, recordId, kind: instance.outputRef.kind });
          }
          records.push(Object.freeze({ producerId: entry.name, recordId, instance }));
        } catch {
          diagnostics.push({ code: "invalid-record", producerId: entry.name, recordId });
        }
      }
    }
    return Object.freeze({ records: Object.freeze(records), diagnostics: Object.freeze(diagnostics.slice(0, 128)), omitted, artifacts });
  }

  async readArtifact(outputId, { maxBytes = this.eventMaxBytes } = {}) {
    const id = safeId(outputId, "outputId");
    const snapshot = await this.readRecords();
    const owner = snapshot.artifacts.get(id);
    if (!owner) return null;
    const producer = await this.#producerDirectory(owner.producerId, { create: false });
    if (!producer) return null;
    const file = path.join(producer.directory, `${id}.events.jsonl`);
    const safe = await safeRegularFile(file, producer.canonical, Math.min(maxBytes, this.eventMaxBytes));
    if (!safe) return null;
    const text = await readFile(safe.canonical, "utf8");
    const events = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      if (Buffer.byteLength(line) > EVENT_LINE_MAX_BYTES) continue;
      try { events.push(JSON.parse(line)); } catch {}
    }
    return Object.freeze({ id, kind: owner.kind, events: Object.freeze(events), bytes: Buffer.byteLength(text) });
  }

  async prune({ now = this.now(), retentionMs = this.finishedRetentionMs } = {}) {
    const snapshot = await this.readRecords({ now });
    let removed = 0;
    for (const record of snapshot.records) {
      if (!isTerminalAgentStatus(record.instance.status)) continue;
      const terminalAt = record.instance.endedAt ?? record.instance.updatedAt;
      if (now - terminalAt < retentionMs) continue;
      const producer = await this.#producerDirectory(record.producerId, { create: false });
      if (!producer) continue;
      await Promise.all([
        rm(path.join(producer.directory, `${record.recordId}.json`), { force: true }),
        rm(path.join(producer.directory, `${record.recordId}.events.jsonl`), { force: true }),
        rm(path.join(producer.directory, `${record.recordId}.session-locator`), { force: true }),
      ]);
      removed += 1;
    }
    return removed;
  }
}

export const AGENT_RUN_REGISTRY_LIMITS = Object.freeze({
  recordBytes: RECORD_MAX_BYTES,
  eventLineBytes: EVENT_LINE_MAX_BYTES,
  defaultEventBytes: DEFAULT_EVENT_MAX_BYTES,
});
