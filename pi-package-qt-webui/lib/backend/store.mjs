import { chmodSync, closeSync, constants, fstatSync, ftruncateSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { LIMITS, ProtocolError } from "./protocol.mjs";

export function xdgDirectory(env, variable, fallbackSegments) {
  const configured = env[variable];
  const base = typeof configured === "string" && path.isAbsolute(configured) ? configured : path.join(os.homedir(), ...fallbackSegments);
  return path.join(base, "qt-webui");
}

export function stateDirectory(env = process.env) {
  return xdgDirectory(env, "XDG_STATE_HOME", [".local", "state"]);
}

export function readBoundedFileSync(file, maxBytes) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("not a regular file");
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > maxBytes) throw new ProtocolError("limit_exceeded", `file exceeds ${maxBytes} bytes`);
    return buffer.subarray(0, size);
  } finally { closeSync(fd); }
}

// flock locks the inherited open-file description. The parent retains that descriptor until
// commit; the kernel releases it on crash. Never unlink the stable inode while waiters may use it.
export function withDocumentLock(file, mutate) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const fd = openSync(`${file}.lock`, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  let acquired = false;
  try {
    const lock = spawnSync("flock", ["-w", String(LIMITS.storeLockWaitMs / 1000), "3"], { stdio: ["ignore", "pipe", "pipe", fd], timeout: LIMITS.storeLockCommandMs, maxBuffer: 4096 });
    if (lock.error || lock.status !== 0) throw new ProtocolError("busy", lock.error?.code === "ENOENT" ? "Qt settings require the util-linux flock command" : "Another window is updating this document; retry after it finishes");
    acquired = true;
    ftruncateSync(fd, 0);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
    return mutate();
  } finally {
    if (acquired) ftruncateSync(fd, 0);
    closeSync(fd);
  }
}

// Shared Qt documents use one latest-read/validate/replace transaction. Unknown top-level keys
// remain on disk but are not exposed as validated settings. No lock or parse failure writes data.
export function createJsonFileStore({ directory, fileName, maxBytes, validate }) {
  const filePath = path.join(directory, fileName);
  const knownKeys = new Set(Object.keys(validate(null).value));

  function readDocument() {
    let raw = null;
    let problems = [];
    try {
      raw = JSON.parse(readBoundedFileSync(filePath, maxBytes).toString("utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") problems = [error instanceof SyntaxError ? `${fileName} is not valid JSON: ${error.message}` : `could not read ${fileName}: ${error.message}; using defaults`];
    }
    const result = validate(raw);
    return { raw, value: result.value, problems: [...problems, ...result.problems], path: filePath };
  }

  function read() {
    const { raw, ...result } = readDocument();
    return result;
  }

  function writeUnlocked(value, raw) {
    const { value: validated, problems } = validate(value);
    if (problems.length > 0) throw new Error(problems.join("; "));
    const unknown = raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => !knownKeys.has(key))) : {};
    const text = `${JSON.stringify({ ...unknown, ...validated }, null, 2)}\n`;
    if (Buffer.byteLength(text) > maxBytes) throw new ProtocolError("limit_exceeded", `${fileName} would exceed ${maxBytes} bytes`);
    const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
      renameSync(temporary, filePath);
    } finally {
      try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return { value: validated, path: filePath };
  }

  function write(value) {
    return withDocumentLock(filePath, () => writeUnlocked(value, readDocument().raw));
  }

  function update(mutate) {
    return withDocumentLock(filePath, () => {
      const current = readDocument();
      const before = JSON.stringify(current.value);
      const next = mutate(current.value) ?? current.value;
      if (next && typeof next.then === "function") throw new TypeError("Document mutations must be synchronous");
      if (current.raw !== null && current.problems.length === 0 && JSON.stringify(next) === before) return { value: next, path: filePath };
      return writeUnlocked(next, current.raw);
    });
  }

  return { read, write, update, path: filePath, directory };
}
