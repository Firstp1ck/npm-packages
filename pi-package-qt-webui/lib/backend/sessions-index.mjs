import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LIMITS, ProtocolError, boundedString, stripAnsi } from "./protocol.mjs";

// Lists Pi's persisted sessions by reading the session files Pi keeps under
// $PI_CODING_AGENT_DIR/sessions/<encoded cwd>/. Workspace listings keep their historical bounded
// shape; the all-project catalog uses stable, bounded pages. Only the header, session_info
// entries, and message counts are read, and each file is scanned up to a byte budget.

export function agentDirectory(env = process.env) {
  const configured = env.PI_CODING_AGENT_DIR;
  if (typeof configured === "string" && configured.length > 0) return configured.startsWith("~/") ? path.join(os.homedir(), configured.slice(2)) : path.resolve(configured);
  return path.join(os.homedir(), ".pi", "agent");
}

export function sessionsDirectory(env = process.env) {
  return path.join(agentDirectory(env), "sessions");
}

// Mirrors Pi's getDefaultSessionDirPath encoding exactly (verified against the Pi package in tests).
export function sessionDirectoryFor(cwd, env = process.env) {
  const resolved = path.resolve(cwd);
  const safe = `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(sessionsDirectory(env), safe);
}

function scanSessionFile(filePath) {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf8", start: 0, end: LIMITS.maxSessionScanBytes - 1 });
    let buffer = "";
    let header = null;
    let name = "";
    let messageCount = 0;
    let firstMessage = "";
    let lastTimestamp = 0;
    let invalid = false;
    const handleLine = (line) => {
      if (line.length === 0 || invalid) return;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return; // a partial last line inside the scan budget is expected
      }
      if (!entry || typeof entry !== "object") return;
      if (!header) {
        if (entry.type !== "session") {
          invalid = true;
          return;
        }
        header = entry;
        return;
      }
      if (entry.type === "session_info") name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") return;
      messageCount += 1;
      const timestamp = typeof entry.message.timestamp === "number" ? entry.message.timestamp : Date.parse(entry.timestamp ?? "");
      if (Number.isFinite(timestamp) && timestamp > lastTimestamp) lastTimestamp = timestamp;
      if (!firstMessage && entry.message.role === "user") {
        const content = entry.message.content;
        firstMessage = typeof content === "string" ? content : Array.isArray(content) ? content.filter((part) => part && part.type === "text").map((part) => part.text).join(" ") : "";
      }
    };
    stream.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
    stream.once("error", () => resolve(null));
    stream.once("end", () => {
      handleLine(buffer);
      if (!header || invalid) {
        resolve(null);
        return;
      }
      resolve({ header, name, messageCount, firstMessage, lastTimestamp });
    });
  });
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function candidatesFromDirectory(directory, canonicalRoot, seenIdentities, { ignoreReadError = false } = {}) {
  let names;
  try {
    const directoryIdentity = await realpath(directory);
    if (!isWithin(canonicalRoot, directoryIdentity)) return [];
    names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if ((error && error.code === "ENOENT") || ignoreReadError) return [];
    throw error;
  }
  const candidates = [];
  for (const name of names) {
    const filePath = path.resolve(directory, name);
    try {
      const [stats, identity] = await Promise.all([stat(filePath), realpath(filePath)]);
      if (!stats.isFile() || !isWithin(canonicalRoot, identity) || seenIdentities.has(identity)) continue;
      seenIdentities.add(identity);
      candidates.push({ filePath, identity, mtimeMs: stats.mtimeMs, size: stats.size });
    } catch {
      // A file that vanished, became unreadable, escaped the root, or stopped being a candidate is skipped.
    }
  }
  return candidates;
}

async function catalogCandidates(cwd, scope, env) {
  const root = sessionsDirectory(env);
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const seenIdentities = new Set();
  if (scope === "workspace") return candidatesFromDirectory(sessionDirectoryFor(cwd, env), canonicalRoot, seenIdentities);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    candidates.push(...await candidatesFromDirectory(path.join(root, entry.name), canonicalRoot, seenIdentities, { ignoreReadError: true }));
  }
  return candidates;
}

export async function managedSessionPath(sessionPath, { env = process.env } = {}) {
  const root = path.resolve(sessionsDirectory(env));
  const resolved = path.resolve(sessionPath);
  if (!resolved.endsWith(".jsonl") || !isWithin(root, resolved)) {
    throw new ProtocolError("invalid_request", "sessionPath must identify a .jsonl file under the active Pi sessions directory");
  }
  let canonicalRoot;
  let stats;
  let identity;
  try {
    [canonicalRoot, stats, identity] = await Promise.all([realpath(root), stat(resolved), realpath(resolved)]);
  } catch {
    throw new ProtocolError("unavailable", "That saved session no longer exists or is unreadable");
  }
  if (!stats.isFile()) throw new ProtocolError("unavailable", "That saved session no longer exists or is unreadable");
  if (!isWithin(canonicalRoot, identity)) {
    throw new ProtocolError("invalid_request", "sessionPath must identify a .jsonl file under the active Pi sessions directory");
  }
  return { path: resolved, identity };
}

export async function listSessions(cwd, { env = process.env, now = () => Date.now(), scope = "workspace", offset = 0 } = {}) {
  if (scope !== "workspace" && scope !== "all") throw new TypeError("scope must be workspace or all");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
  const directory = scope === "workspace" ? sessionDirectoryFor(cwd, env) : sessionsDirectory(env);
  const candidates = await catalogCandidates(cwd, scope, env);
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.identity.localeCompare(b.identity));
  const pageEnd = Math.min(candidates.length, offset + LIMITS.maxSessionListEntries);
  const sessions = [];
  for (const candidate of candidates.slice(offset, pageEnd)) {
    const scanned = await scanSessionFile(candidate.filePath);
    if (!scanned) continue;
    const modified = Math.floor(candidate.mtimeMs);
    sessions.push({
      path: candidate.filePath,
      identity: candidate.identity,
      id: boundedString(scanned.header.id, LIMITS.maxRuntimeInfoCharacters, path.basename(candidate.filePath, ".jsonl")),
      name: boundedString(stripAnsi(scanned.name), LIMITS.maxRuntimeInfoCharacters, ""),
      cwd: boundedString(scanned.header.cwd, LIMITS.maxPathCharacters, ""),
      created: Date.parse(scanned.header.timestamp ?? "") || modified,
      modified,
      ageMs: Math.max(0, now() - modified),
      messageCount: scanned.messageCount,
      firstMessage: boundedString(stripAnsi(scanned.firstMessage).replace(/\s+/g, " ").trim(), LIMITS.maxSessionPreviewCharacters, ""),
      scanTruncated: candidate.size > LIMITS.maxSessionScanBytes,
    });
  }
  sessions.sort((a, b) => b.modified - a.modified || a.identity.localeCompare(b.identity));
  const omitted = Math.max(0, candidates.length - pageEnd);
  if (scope === "workspace" && offset === 0) return { sessions, omitted, directory };
  return {
    sessions,
    omitted,
    directory,
    scope,
    offset,
    nextOffset: pageEnd < candidates.length ? pageEnd : null,
    total: candidates.length,
  };
}
