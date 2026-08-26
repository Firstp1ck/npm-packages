import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Small private JSON documents under the XDG config or state directories. Every store validates
// on read, replaces the file atomically, and keeps owner-only permissions. Oversized or invalid
// files fall back to the validated default instead of failing the caller.

export function xdgDirectory(env, variable, fallbackSegments) {
  const configured = env[variable];
  const base = typeof configured === "string" && path.isAbsolute(configured) ? configured : path.join(os.homedir(), ...fallbackSegments);
  return path.join(base, "qt-webui");
}

export function stateDirectory(env = process.env) {
  return xdgDirectory(env, "XDG_STATE_HOME", [".local", "state"]);
}

export function createJsonFileStore({ directory, fileName, maxBytes, validate }) {
  const filePath = path.join(directory, fileName);

  // Returns { value, problems }. `value` is always validated, so callers never see raw JSON.
  function read() {
    let text;
    try {
      const size = statSync(filePath).size;
      if (size > maxBytes) return { value: validate(null).value, problems: [`${fileName} exceeds ${maxBytes} bytes; using defaults`], path: filePath };
      text = readFileSync(filePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return { value: validate(null).value, problems: [], path: filePath };
      return { value: validate(null).value, problems: [`could not read ${fileName}: ${error.message}`], path: filePath };
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { value: validate(null).value, problems: [`${fileName} is not valid JSON: ${error.message}`], path: filePath };
    }
    const { value, problems } = validate(parsed);
    return { value, problems, path: filePath };
  }

  function write(value) {
    const { value: validated, problems } = validate(value);
    if (problems.length > 0) throw new Error(problems.join("; "));
    const text = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`${fileName} would exceed ${maxBytes} bytes`);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      chmodSync(directory, 0o700);
    } catch {
      // Directory permissions can only be tightened on filesystems that support modes.
    }
    const temporary = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, text, { mode: 0o600 });
    renameSync(temporary, filePath);
    return { value: validated, path: filePath };
  }

  // Read, mutate, write in one step; the mutator receives the validated value.
  function update(mutate) {
    const current = read().value;
    const next = mutate(current) ?? current;
    return write(next);
  }

  return { read, write, update, path: filePath, directory };
}
