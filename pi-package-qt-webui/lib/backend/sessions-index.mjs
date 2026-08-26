import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LIMITS, boundedString, stripAnsi } from "./protocol.mjs";

// Lists Pi's persisted sessions for a workspace by reading the session files Pi keeps under
// $PI_CODING_AGENT_DIR/sessions/<encoded cwd>/. Only the header, session_info entries, and
// message counts are read, each file is scanned up to a byte budget, and the result is bounded,
// so a directory with thousands of large sessions cannot stall the backend.

export function agentDirectory(env = process.env) {
  const configured = env.PI_CODING_AGENT_DIR;
  if (typeof configured === "string" && configured.length > 0) return configured.startsWith("~/") ? path.join(os.homedir(), configured.slice(2)) : path.resolve(configured);
  return path.join(os.homedir(), ".pi", "agent");
}

// Mirrors Pi's getDefaultSessionDirPath encoding exactly (verified against the Pi package in tests).
export function sessionDirectoryFor(cwd, env = process.env) {
  const resolved = path.resolve(cwd);
  const safe = `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(agentDirectory(env), "sessions", safe);
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

export async function listSessions(cwd, { env = process.env, now = () => Date.now() } = {}) {
  const directory = sessionDirectoryFor(cwd, env);
  let names;
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if (error && error.code === "ENOENT") return { sessions: [], omitted: 0, directory };
    throw error;
  }
  const candidates = [];
  for (const name of names) {
    const filePath = path.join(directory, name);
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) continue;
      candidates.push({ filePath, mtimeMs: stats.mtimeMs, size: stats.size });
    } catch {
      // A file that vanished between readdir and stat is simply not a session anymore.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const omitted = Math.max(0, candidates.length - LIMITS.maxSessionListEntries);
  const sessions = [];
  for (const candidate of candidates.slice(0, LIMITS.maxSessionListEntries)) {
    const scanned = await scanSessionFile(candidate.filePath);
    if (!scanned) continue;
    const modified = scanned.lastTimestamp > 0 ? scanned.lastTimestamp : candidate.mtimeMs;
    sessions.push({
      path: candidate.filePath,
      id: boundedString(scanned.header.id, LIMITS.maxRuntimeInfoCharacters, path.basename(candidate.filePath, ".jsonl")),
      name: boundedString(stripAnsi(scanned.name), LIMITS.maxRuntimeInfoCharacters, ""),
      cwd: boundedString(scanned.header.cwd, LIMITS.maxPathCharacters, ""),
      created: Date.parse(scanned.header.timestamp ?? "") || Math.floor(candidate.mtimeMs),
      modified: Math.floor(modified),
      ageMs: Math.max(0, now() - Math.floor(modified)),
      messageCount: scanned.messageCount,
      firstMessage: boundedString(stripAnsi(scanned.firstMessage).replace(/\s+/g, " ").trim(), LIMITS.maxSessionPreviewCharacters, ""),
      scanTruncated: candidate.size > LIMITS.maxSessionScanBytes,
    });
  }
  sessions.sort((a, b) => b.modified - a.modified);
  return { sessions, omitted, directory };
}
