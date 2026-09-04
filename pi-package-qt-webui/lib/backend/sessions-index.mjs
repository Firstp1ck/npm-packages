import { createReadStream } from "node:fs";
import { opendir, realpath, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { LIMITS, ProtocolError, boundedString, stripAnsi } from "./protocol.mjs";

export function agentDirectory(env = process.env) {
  const configured = env.PI_CODING_AGENT_DIR;
  if (typeof configured === "string" && configured.length > 0) return configured.startsWith("~/") ? path.join(os.homedir(), configured.slice(2)) : path.resolve(configured);
  return path.join(os.homedir(), ".pi", "agent");
}
export function sessionsDirectory(env = process.env) { return path.join(agentDirectory(env), "sessions"); }
export function sessionDirectoryFor(cwd, env = process.env) {
  const safe = `--${path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(sessionsDirectory(env), safe);
}
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
export async function managedSessionPath(sessionPath, { env = process.env } = {}) {
  const root = path.resolve(sessionsDirectory(env)), resolved = path.resolve(sessionPath);
  if (!resolved.endsWith(".jsonl") || !isWithin(root, resolved)) throw new ProtocolError("invalid_request", "sessionPath must identify a .jsonl file under the active Pi sessions directory");
  let canonicalRoot, stats, identity;
  try { [canonicalRoot, stats, identity] = await Promise.all([realpath(root), stat(resolved), realpath(resolved)]); }
  catch { throw new ProtocolError("unavailable", "That saved session no longer exists or is unreadable"); }
  if (!stats.isFile()) throw new ProtocolError("unavailable", "That saved session no longer exists or is unreadable");
  if (!isWithin(canonicalRoot, identity)) throw new ProtocolError("invalid_request", "sessionPath must identify a .jsonl file under the active Pi sessions directory");
  return { path: resolved, identity };
}

function scanSessionFile(candidate, maxBytes, signal) {
  return new Promise(resolve => {
    const stream = createReadStream(candidate.filePath, { encoding: "utf8", start: 0, end: maxBytes - 1, signal });
    let buffer = "", header = null, name = "", firstMessage = "", messageCount = 0, invalid = false, bytes = 0;
    const line = text => {
      if (!text || invalid) return;
      let entry;
      try { entry = JSON.parse(text); } catch { return; }
      if (!entry || typeof entry !== "object") return;
      if (!header) { if (entry.type !== "session") invalid = true; else header = entry; return; }
      if (entry.type === "session_info") name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (entry.type !== "message" || !entry.message) return;
      messageCount++;
      if (!firstMessage && entry.message.role === "user") {
        const content = entry.message.content;
        firstMessage = typeof content === "string" ? content : Array.isArray(content) ? content.filter(part => part?.type === "text").map(part => part.text).join(" ") : "";
      }
    };
    stream.on("data", chunk => {
      bytes += Buffer.byteLength(chunk);
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    });
    stream.once("error", () => resolve({ row: null, bytes }));
    stream.once("end", () => {
      line(buffer);
      if (!header || invalid) { resolve({ row: null, bytes }); return; }
      const modified = Math.floor(candidate.mtimeMs);
      resolve({ bytes, row: {
        path: candidate.filePath, identity: candidate.identity,
        id: boundedString(header.id, LIMITS.maxRuntimeInfoCharacters, path.basename(candidate.filePath, ".jsonl")),
        name: boundedString(stripAnsi(name), LIMITS.maxRuntimeInfoCharacters, ""),
        cwd: boundedString(header.cwd, LIMITS.maxPathCharacters, ""),
        created: Date.parse(header.timestamp ?? "") || modified, modified, messageCount,
        firstMessage: boundedString(stripAnsi(firstMessage).replace(/\s+/g, " ").trim(), LIMITS.maxSessionPreviewCharacters, ""),
        scanTruncated: candidate.size > maxBytes,
      } });
    });
  });
}

export function createSessionCatalog({ env = process.env, now = () => Date.now(), clock = () => Date.now() } = {}) {
  const scans = new Map(), cursors = new Map(), metadata = new Map();
  let generation = 0, running = null, cacheBytes = 0;
  let latest = { visited: 0, retainedRows: 0, retainedBytes: 0, readBytes: 0, durationMs: 0 };
  function invalidate() { generation++; }
  function prune() {
    for (const [id, scan] of scans) if (scan.expires <= clock()) {
      scans.delete(id);
      for (const token of scan.tokens) cursors.delete(token);
    }
  }
  async function discover(cwd, scope, signal) {
    const started = clock(), deadline = started + LIMITS.catalogScanMs;
    const directory = scope === "workspace" ? sessionDirectoryFor(cwd, env) : sessionsDirectory(env);
    const candidates = [], identities = new Set(), projects = new Set();
    let visited = 0, candidateBytes = 0, readBytes = 0, truncated = false;
    const stopped = () => signal.aborted || clock() >= deadline || visited >= LIMITS.maxCatalogCandidates;
    let root;
    try { root = await realpath(sessionsDirectory(env)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    async function visit(project) {
      if (!root || stopped()) { truncated = true; return; }
      try {
        const projectIdentity = await realpath(project);
        if (!isWithin(root, projectIdentity) || projects.has(projectIdentity)) return;
        projects.add(projectIdentity);
        for await (const entry of await opendir(project)) {
          if (stopped()) { truncated = true; break; }
          visited++;
          if (!entry.name.endsWith(".jsonl")) continue;
          const filePath = path.resolve(project, entry.name);
          try {
            const [stats, identity] = await Promise.all([stat(filePath), realpath(filePath)]);
            if (!stats.isFile() || !isWithin(root, identity) || identities.has(identity)) continue;
            const bytes = Buffer.byteLength(filePath) + Buffer.byteLength(identity) + 128;
            if (candidateBytes + bytes > LIMITS.maxCatalogCandidateBytes) { truncated = true; break; }
            candidateBytes += bytes;
            identities.add(identity);
            candidates.push({ filePath, identity, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, ino: stats.ino });
          } catch {}
        }
      } catch (error) { if (error.code !== "ENOENT" && error.code !== "EACCES") throw error; }
    }
    if (root) {
      if (scope === "workspace") await visit(directory);
      else for await (const entry of await opendir(sessionsDirectory(env))) {
        if (stopped()) { truncated = true; break; }
        visited++;
        if (entry.isDirectory() || entry.isSymbolicLink()) await visit(path.join(sessionsDirectory(env), entry.name));
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.identity.localeCompare(b.identity));
    const rows = [];
    let retainedBytes = 0, retainedRows = 0;
    for (const candidate of candidates) {
      if (signal.aborted || clock() >= deadline || retainedRows >= LIMITS.maxCatalogRows || readBytes >= LIMITS.maxCatalogReadBytes) { truncated = true; break; }
      const key = JSON.stringify([candidate.identity, candidate.ino, candidate.size, candidate.mtimeMs, candidate.ctimeMs]);
      let row = metadata.get(key)?.row;
      if (row === undefined) {
        const result = await scanSessionFile(candidate, Math.min(LIMITS.maxSessionScanBytes, LIMITS.maxCatalogReadBytes - readBytes), signal);
        readBytes += result.bytes;
        row = result.row;
        if (row && !signal.aborted) {
          const bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(row));
          while (metadata.size && (metadata.size >= LIMITS.maxCatalogCacheEntries || cacheBytes + bytes > LIMITS.maxCatalogCacheBytes)) {
            const oldest = metadata.keys().next().value;
            cacheBytes -= metadata.get(oldest).bytes; metadata.delete(oldest);
          }
          if (bytes <= LIMITS.maxCatalogCacheBytes) { metadata.set(key, { row, bytes }); cacheBytes += bytes; }
        }
      }
      if (!row) { rows.push(null); continue; }
      row = Object.freeze({ ...row, path: candidate.filePath, ageMs: Math.max(0, now() - row.modified) });
      const bytes = Buffer.byteLength(JSON.stringify(row));
      if (retainedBytes + bytes > LIMITS.maxCatalogBytes) { truncated = true; break; }
      retainedBytes += bytes; retainedRows++; rows.push(row);
    }
    latest = { visited, retainedRows, retainedBytes, readBytes, candidateBytes, durationMs: clock() - started, rss: process.memoryUsage().rss, peakRss: process.resourceUsage().maxRSS * 1024 };
    return { rows: Object.freeze(rows), directory, truncated, statistics: latest };
  }
  function page(scan, offset) {
    const sessions = [];
    let bytes = 0, end = offset;
    while (end < scan.rows.length && end - offset < LIMITS.maxSessionListEntries) {
      const row = scan.rows[end];
      if (!row) { end++; continue; }
      const size = Buffer.byteLength(JSON.stringify(row));
      if (bytes + size > LIMITS.maxCatalogPageBytes && sessions.length) break;
      sessions.push(row); bytes += size; end++;
    }
    let cursor = null;
    if (end < scan.rows.length) {
      cursor = [...scan.tokens].find(token => cursors.get(token)?.offset === end);
      if (!cursor) {
        if (cursors.size >= LIMITS.maxCatalogCursors) throw new ProtocolError("limit_exceeded", "Too many catalog cursors; restart the refresh");
        cursor = randomBytes(16).toString("hex"); scan.tokens.add(cursor); cursors.set(cursor, { scan, offset: end });
      }
    }
    return { sessions, directory: scan.directory, scope: scan.scope, offset, nextOffset: cursor ? end : null,
      cursor, generation: scan.generation, total: scan.rows.length, omitted: scan.rows.length - end + (scan.truncated ? 1 : 0), truncated: scan.truncated,
      retentionLimit: LIMITS.maxCatalogRows, statistics: scan.statistics };
  }
  async function list(cwd, { scope = "all", cursor, offset = 0 } = {}) {
    if (!["workspace", "all"].includes(scope)) throw new TypeError("scope must be workspace or all");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    prune();
    if (cursor) {
      const found = cursors.get(cursor);
      if (!found || found.scan.scope !== scope) throw new ProtocolError("stale_request", "The catalog cursor expired; refresh the catalog");
      return page(found.scan, found.offset);
    }
    const key = `${scope}:${scope === "all" ? sessionsDirectory(env) : path.resolve(cwd)}`;
    if (running && running.key !== key) throw new ProtocolError("busy", "A session catalog scan is already running");
    if (!running) {
      const scanGeneration = generation;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIMITS.catalogScanMs);
      const promise = discover(cwd, scope, controller.signal).then(result => {
        const id = randomBytes(16).toString("hex");
        const scan = { ...result, scope, generation: scanGeneration, expires: clock() + LIMITS.catalogCursorMs, tokens: new Set() };
        while (scans.size >= LIMITS.maxCatalogScans) {
          const oldest = scans.keys().next().value;
          for (const token of scans.get(oldest).tokens) cursors.delete(token);
          scans.delete(oldest);
        }
        scans.set(id, scan);
        return scan;
      }).finally(() => { clearTimeout(timer); running = null; });
      running = { key, promise, controller };
    }
    // A stalled filesystem retains its one scan slot instead of admitting unbounded background work.
    let timer;
    try {
      const scan = await Promise.race([running.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new ProtocolError("timeout", "Session catalog scan timed out")), LIMITS.catalogScanMs + 50); })]);
      if (scan.generation !== generation) throw new ProtocolError("stale_request", "The catalog changed during discovery; start a fresh scan");
      return page(scan, offset);
    } finally { clearTimeout(timer); }
  }
  return { list, invalidate, stop: () => running?.controller.abort(), diagnostics: () => ({ ...latest, activeScans: running ? 1 : 0, scans: scans.size, cursors: cursors.size, cacheEntries: metadata.size, cacheBytes }) };
}

// Legacy integrators may still request offsets. The bridge uses one backend-owned catalog and
// opaque cursors; this convenience function creates a fresh bounded pass per call.
export async function listSessions(cwd, options = {}) {
  const catalog = createSessionCatalog(options);
  const result = await catalog.list(cwd, { ...options, scope: options.scope ?? "workspace" });
  if ((options.scope ?? "workspace") === "workspace" && (options.offset ?? 0) === 0) return { sessions: result.sessions, omitted: result.omitted, directory: result.directory };
  return result;
}
