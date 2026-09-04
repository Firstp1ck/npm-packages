import { open, readFile, readdir, stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { LIMITS, ProtocolError } from "./protocol.mjs";
import { watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION, SessionManager } from "@earendil-works/pi-coding-agent";

export const SESSION_SYNC_DEFAULTS = Object.freeze({
  catalogCoalesceMs: 75,
  pollIntervalMs: 2_000,
  maxOpenSessions: 8,
  maxProjectWatchers: 256,
});

const DEFAULT_FILESYSTEM = Object.freeze({ open, readFile, readdir, stat, mkdtemp, writeFile, rm, watch });
const DEFAULT_TIMERS = Object.freeze({
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
});

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : error?.name || "Error";
}

function revisionFromStats(stats) {
  return {
    exists: true,
    size: Number(stats.size),
    mtimeMs: Number(stats.mtimeMs),
    ctimeMs: Number(stats.ctimeMs),
    ino: Number(stats.ino ?? 0),
  };
}

export function sessionRevisionKey(revision) {
  if (!revision || revision.exists === false) return `missing:${revision?.error ?? "ENOENT"}`;
  return `${revision.ino}:${revision.size}:${revision.mtimeMs}:${revision.ctimeMs}`;
}

function sameFileRevision(left, right) {
  return sessionRevisionKey(left) === sessionRevisionKey(right);
}

function assertCompleteJsonl(content, filePath) {
  if (content.length === 0) throw new Error(`Persisted session is empty: ${filePath}`);
  if (content[content.length - 1] !== 0x0a) throw new Error(`Persisted session has an incomplete final line: ${filePath}`);
  const entries = [];
  const lines = content.toString("utf8").split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim()) continue;
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch (error) {
      throw new Error(`Persisted session has malformed JSON on line ${index + 1}: ${filePath}`, { cause: error });
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Persisted session has an invalid entry on line ${index + 1}: ${filePath}`);
    }
    entries.push(entry);
  }
  const header = entries[0];
  if (!header || header.type !== "session" || typeof header.id !== "string") {
    throw new Error(`Persisted session has no valid header: ${filePath}`);
  }
  return header;
}

/**
 * Load one stable, complete persisted branch without allowing SessionManager migrations to touch
 * the source. Pi opens an isolated byte-for-byte copy and supplies the authoritative branch and
 * compaction projection through buildSessionContext().
 */
export async function loadPersistedSessionSnapshotInProcess(sessionPath, {
  filesystem = DEFAULT_FILESYSTEM,
  SessionManagerClass = SessionManager,
  temporaryRoot = os.tmpdir(),
  temporaryDirectory: ownedDirectory,
} = {}) {
  const resolvedPath = path.resolve(sessionPath);
  const before = revisionFromStats(await filesystem.stat(resolvedPath));
  if (before.size > LIMITS.maxSnapshotInputBytes) throw new ProtocolError("limit_exceeded", `Persisted session exceeds ${LIMITS.maxSnapshotInputBytes} input bytes`);
  const fd = await filesystem.open(resolvedPath, "r");
  let content;
  try {
    const storage = Buffer.alloc(LIMITS.maxSnapshotInputBytes + 1);
    let count = 0;
    while (count < storage.length) {
      const read = await fd.read(storage, count, Math.min(64 * 1024, storage.length - count), null);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count > LIMITS.maxSnapshotInputBytes) throw new ProtocolError("limit_exceeded", "Persisted session grew beyond the snapshot input limit");
    content = storage.subarray(0, count);
  } finally { await fd.close(); }
  const sourceHeader = assertCompleteJsonl(content, resolvedPath);
  const after = revisionFromStats(await filesystem.stat(resolvedPath));
  if (content.length !== after.size || !sameFileRevision(before, after)) {
    throw new Error(`Persisted session changed while it was being read: ${resolvedPath}`);
  }

  let temporaryDirectory;
  try {
    temporaryDirectory = ownedDirectory ?? await filesystem.mkdtemp(path.join(temporaryRoot, "qt-webui-session-snapshot-"));
    const isolatedPath = path.join(temporaryDirectory, "session.jsonl");
    await filesystem.writeFile(isolatedPath, content, { mode: 0o600 });
    const manager = SessionManagerClass.open(isolatedPath, temporaryDirectory);
    const context = manager.buildSessionContext();
    const header = manager.getHeader() ?? sourceHeader;
    return {
      path: resolvedPath,
      revision: after,
      sessionId: header.id,
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      name: manager.getSessionName() ?? "",
      leafId: manager.getLeafId(),
      messages: Array.isArray(context.messages) ? context.messages : [],
      thinkingLevel: typeof context.thinkingLevel === "string" ? context.thinkingLevel : "off",
      model: context.model ?? null,
      sourceVersion: Number(sourceHeader.version ?? 1),
      projectedVersion: Number(header.version ?? CURRENT_SESSION_VERSION),
    };
  } finally {
    if (temporaryDirectory) await filesystem.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const snapshotQueue = [];
const activeSnapshotJobs = new Set();
let activeSnapshotLoads = 0;
let peakSnapshotLoads = 0;
let peakSnapshotRss = 0;
let snapshotCleanupFailures = 0;
export function snapshotLoadDiagnostics() {
  peakSnapshotRss = Math.max(peakSnapshotRss, process.resourceUsage().maxRSS * 1024);
  return { active: activeSnapshotLoads, queued: snapshotQueue.length, reservedBytes: activeSnapshotLoads * LIMITS.maxSnapshotInputBytes,
    peakReservedBytes: peakSnapshotLoads * LIMITS.maxSnapshotInputBytes, peakRss: peakSnapshotRss, cleanupFailures: snapshotCleanupFailures };
}

function pumpSnapshots() {
  while (snapshotQueue.length && activeSnapshotLoads < LIMITS.maxConcurrentSnapshotLoads) {
    const job = snapshotQueue.shift();
    if (job.done) continue;
    if (job.options.isCurrent && !job.options.isCurrent()) { job.finish(new ProtocolError("stale_request", "Snapshot load was superseded")); continue; }
    activeSnapshotLoads++;
    activeSnapshotJobs.add(job);
    peakSnapshotLoads = Math.max(peakSnapshotLoads, activeSnapshotLoads);
    job.cleanup = (async () => {
      let worker, directory;
      try {
        directory = await mkdtemp(path.join(job.options.temporaryRoot ?? os.tmpdir(), "qt-webui-session-snapshot-"));
        if (job.done) return;
        worker = new Worker(job.options.workerUrl ?? new URL("./snapshot-worker.mjs", import.meta.url), {
          execArgv: [],
          workerData: { path: job.path, directory },
          resourceLimits: { maxOldGenerationSizeMb: LIMITS.snapshotWorkerHeapMiB },
        });
        job.cancel = () => { void worker.terminate(); };
        await new Promise(resolve => {
          worker.once("message", message => {
            if (message.error) job.finish(Object.assign(new Error(message.error.message), { code: message.error.code }));
            else if (job.options.isCurrent && !job.options.isCurrent()) job.finish(new ProtocolError("stale_request", "Snapshot load was superseded"));
            else {
              peakSnapshotRss = Math.max(peakSnapshotRss, process.memoryUsage().rss);
              try { job.finish(null, JSON.parse(message.json)); } catch (error) { job.finish(error); }
            }
            resolve();
          });
          worker.once("error", error => { job.finish(error); resolve(); });
          worker.once("exit", code => { if (!job.done) job.finish(new ProtocolError("unavailable", `Snapshot worker exited (${code})`)); resolve(); });
        });
      } catch (error) { job.finish(error); }
      finally {
        try {
          if (worker) await worker.terminate();
          if (directory) await rm(directory, { recursive: true, force: true });
        } catch {
          snapshotCleanupFailures++;
        } finally {
          activeSnapshotLoads--;
          activeSnapshotJobs.delete(job);
          pumpSnapshots();
        }
      }
    })();
  }
}

export async function stopSnapshotLoads() {
  const jobs = [...snapshotQueue.splice(0), ...activeSnapshotJobs];
  for (const job of jobs) {
    job.finish(new ProtocolError("stale_request", "Snapshot loading stopped"));
    job.cancel?.();
  }
  await Promise.allSettled(jobs.map(job => job.cleanup).filter(Boolean));
}

export function loadPersistedSessionSnapshot(sessionPath, options = {}) {
  // Trusted injected implementations remain directly testable; production always uses a killable worker.
  if (options.filesystem || options.SessionManagerClass) return loadPersistedSessionSnapshotInProcess(sessionPath, options);
  if (snapshotQueue.length >= LIMITS.maxQueuedSnapshotLoads) return Promise.reject(new ProtocolError("busy", "The snapshot load queue is full; the previous transcript is retained"));
  return new Promise((resolve, reject) => {
    const job = { path: path.resolve(sessionPath), options, done: false, cancel: null, finish(error, result) {
      if (job.done) return;
      job.done = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    } };
    const timer = setTimeout(() => {
      const index = snapshotQueue.indexOf(job);
      if (index >= 0) snapshotQueue.splice(index, 1);
      job.finish(new ProtocolError("timeout", "Persisted snapshot load timed out; the previous transcript is retained"));
      job.cancel?.();
    }, Math.min(options.timeoutMs ?? LIMITS.snapshotLoadMs, LIMITS.snapshotLoadMs));
    snapshotQueue.push(job);
    pumpSnapshots();
  });
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function invoke(callback, value) {
  try {
    const result = callback(value);
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // A consumer callback must not take down the monitor.
  }
}

/**
 * Watch the sessions root plus a bounded set of immediate project directories. Directory events
 * are hints; acknowledged revisions prevent self-write loops, while unacknowledged revisions are
 * retried by the two-second stat poll.
 */
export function createSessionSyncMonitor({
  sessionsRoot,
  onCatalogChange = () => {},
  onSessionChange = () => {},
  onWarning = () => {},
  filesystem = DEFAULT_FILESYSTEM,
  timers = DEFAULT_TIMERS,
  catalogCoalesceMs = SESSION_SYNC_DEFAULTS.catalogCoalesceMs,
  pollIntervalMs = SESSION_SYNC_DEFAULTS.pollIntervalMs,
  maxOpenSessions = SESSION_SYNC_DEFAULTS.maxOpenSessions,
  maxProjectWatchers = SESSION_SYNC_DEFAULTS.maxProjectWatchers,
} = {}) {
  if (typeof sessionsRoot !== "string" || sessionsRoot.length === 0) throw new TypeError("sessionsRoot is required");
  if (!Number.isSafeInteger(maxOpenSessions) || maxOpenSessions < 1) throw new TypeError("maxOpenSessions must be a positive integer");
  if (!Number.isSafeInteger(maxProjectWatchers) || maxProjectWatchers < 0) throw new TypeError("maxProjectWatchers must be a non-negative integer");

  const root = path.resolve(sessionsRoot);
  const projectWatchers = new Map();
  const openPaths = new Set();
  const observedRevisions = new Map();
  const pendingRevisions = new Map();
  const warned = new Set();
  const forcedPaths = new Set();
  let rootWatcher = null;
  let started = false;
  let stopped = false;
  let catalogTimer = null;
  let sessionTimer = null;
  let pollTimer = null;
  let topologyPromise = null;
  let pollPromise = null;

  const warnOnce = (operation, error) => {
    const key = `${operation}:${errorCode(error)}`;
    if (warned.has(key)) return;
    warned.add(key);
    invoke(onWarning, { operation, code: errorCode(error), message: String(error?.message ?? error) });
  };

  const closeWatcher = (watcher) => {
    try {
      watcher?.close();
    } catch (error) {
      warnOnce("watch-close", error);
    }
  };

  const queueCatalogChange = () => {
    if (stopped || catalogTimer !== null) return;
    catalogTimer = timers.setTimeout(() => {
      catalogTimer = null;
      if (!stopped) invoke(onCatalogChange, { reason: "filesystem" });
    }, catalogCoalesceMs);
  };

  const inspectPath = async (sessionPath, { force = false, reason = "poll" } = {}) => {
    let revision;
    try {
      revision = revisionFromStats(await filesystem.stat(sessionPath));
    } catch (error) {
      revision = { exists: false, error: errorCode(error) };
    }
    if (stopped || !openPaths.has(sessionPath)) return;
    const key = sessionRevisionKey(revision);
    const previous = observedRevisions.get(sessionPath);
    if (previous === undefined) {
      observedRevisions.set(sessionPath, key);
      return;
    }
    if (force || previous !== key) {
      observedRevisions.set(sessionPath, key);
      pendingRevisions.set(sessionPath, { key, revision });
    }
    const pending = pendingRevisions.get(sessionPath);
    if (pending) invoke(onSessionChange, { path: sessionPath, revision: pending.revision, revisionKey: pending.key, reason });
  };

  const poll = async () => {
    if (stopped || pollPromise) return pollPromise;
    pollPromise = (async () => {
      await Promise.all([...openPaths].map((sessionPath) => inspectPath(sessionPath)));
      await refreshTopology();
    })().finally(() => {
      pollPromise = null;
    });
    return pollPromise;
  };

  const queueSessionInspection = (paths) => {
    for (const sessionPath of paths) forcedPaths.add(sessionPath);
    if (stopped || sessionTimer !== null) return;
    sessionTimer = timers.setTimeout(() => {
      sessionTimer = null;
      const queued = [...forcedPaths];
      forcedPaths.clear();
      void Promise.all(queued.map((sessionPath) => inspectPath(sessionPath, { force: true, reason: "watch" })));
    }, catalogCoalesceMs);
  };

  const openPathsForEvent = (directory, filename) => {
    const paths = [];
    const decoded = Buffer.isBuffer(filename) ? filename.toString("utf8") : filename;
    for (const sessionPath of openPaths) {
      if (path.dirname(sessionPath) !== directory) continue;
      if (typeof decoded !== "string" || decoded.length === 0 || path.basename(sessionPath) === decoded) paths.push(sessionPath);
    }
    return paths;
  };

  const attachWatcherError = (watcher, directory, rootWatch) => {
    if (!watcher || typeof watcher.once !== "function") return;
    watcher.once("error", (error) => {
      warnOnce("watch", error);
      closeWatcher(watcher);
      if (rootWatch && rootWatcher === watcher) rootWatcher = null;
      if (!rootWatch && projectWatchers.get(directory) === watcher) projectWatchers.delete(directory);
    });
  };

  const watchDirectory = (directory, rootWatch = false) => {
    try {
      const watcher = filesystem.watch(directory, { persistent: false }, (_eventType, filename) => {
        if (stopped) return;
        queueCatalogChange();
        if (rootWatch) {
          void refreshTopology();
        } else {
          queueSessionInspection(openPathsForEvent(directory, filename));
        }
      });
      attachWatcherError(watcher, directory, rootWatch);
      return watcher;
    } catch (error) {
      warnOnce("watch", error);
      return null;
    }
  };

  async function refreshTopology() {
    if (stopped || topologyPromise) return topologyPromise;
    topologyPromise = (async () => {
      if (!rootWatcher) rootWatcher = watchDirectory(root, true);
      let entries;
      try {
        entries = await filesystem.readdir(root, { withFileTypes: true });
      } catch (error) {
        if (errorCode(error) !== "ENOENT") warnOnce("topology-read", error);
        entries = [];
      }
      if (stopped) return;
      const desired = entries
        .filter((entry) => entry?.isDirectory?.())
        .map((entry) => path.join(root, entry.name))
        .sort()
        .slice(0, maxProjectWatchers);
      const desiredSet = new Set(desired);
      for (const [directory, watcher] of projectWatchers) {
        if (!desiredSet.has(directory)) {
          closeWatcher(watcher);
          projectWatchers.delete(directory);
        }
      }
      for (const directory of desired) {
        if (projectWatchers.has(directory)) continue;
        const watcher = watchDirectory(directory);
        if (watcher) projectWatchers.set(directory, watcher);
      }
    })().finally(() => {
      topologyPromise = null;
    });
    return topologyPromise;
  }

  const setOpenSessionPaths = async (sessionPaths) => {
    const bounded = [];
    const seen = new Set();
    for (const candidate of Array.isArray(sessionPaths) ? sessionPaths : []) {
      if (typeof candidate !== "string") continue;
      const resolved = path.resolve(candidate);
      if (!resolved.endsWith(".jsonl") || !isPathInside(root, resolved) || seen.has(resolved)) continue;
      seen.add(resolved);
      bounded.push(resolved);
      if (bounded.length === maxOpenSessions) break;
    }
    const next = new Set(bounded);
    for (const sessionPath of openPaths) {
      if (next.has(sessionPath)) continue;
      observedRevisions.delete(sessionPath);
      pendingRevisions.delete(sessionPath);
      forcedPaths.delete(sessionPath);
    }
    openPaths.clear();
    for (const sessionPath of bounded) openPaths.add(sessionPath);
    await Promise.all(bounded.filter((sessionPath) => !observedRevisions.has(sessionPath)).map((sessionPath) => inspectPath(sessionPath)));
    return bounded.slice();
  };

  const acknowledgeSessionRevision = (sessionPath, revision) => {
    const resolved = path.resolve(sessionPath);
    const key = typeof revision === "string" ? revision : sessionRevisionKey(revision);
    const pending = pendingRevisions.get(resolved);
    if (!pending || pending.key !== key) return false;
    pendingRevisions.delete(resolved);
    return true;
  };

  const start = async () => {
    if (stopped) return false;
    if (started) return true;
    started = true;
    await refreshTopology();
    if (stopped) return false;
    pollTimer = timers.setInterval(() => void poll(), pollIntervalMs);
    return true;
  };

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (catalogTimer !== null) timers.clearTimeout(catalogTimer);
    if (sessionTimer !== null) timers.clearTimeout(sessionTimer);
    if (pollTimer !== null) timers.clearInterval(pollTimer);
    catalogTimer = null;
    sessionTimer = null;
    pollTimer = null;
    closeWatcher(rootWatcher);
    rootWatcher = null;
    for (const watcher of projectWatchers.values()) closeWatcher(watcher);
    projectWatchers.clear();
    forcedPaths.clear();
    pendingRevisions.clear();
    await Promise.allSettled([topologyPromise, pollPromise].filter(Boolean));
  };

  const snapshot = () => ({
    started,
    stopped,
    rootWatched: rootWatcher !== null,
    projectWatcherCount: projectWatchers.size,
    openSessionPaths: [...openPaths],
    pendingSessionCount: pendingRevisions.size,
    warningCount: warned.size,
  });

  return { start, stop, refreshTopology, pollNow: poll, setOpenSessionPaths, acknowledgeSessionRevision, snapshot };
}
