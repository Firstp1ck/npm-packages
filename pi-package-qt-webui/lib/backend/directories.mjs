import { mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIMITS, ProtocolError } from "./protocol.mjs";

// Directory browsing for the workspace picker. This is the one place that deliberately leaves
// the workspace: the user is choosing a new one. Results stay bounded and hidden entries are
// opt-in. Creating a folder only ever adds one directory under a path the user typed or chose.

export function listDirectory(requested, { showHidden = false } = {}) {
  const text = String(requested ?? "").trim();
  const expanded = text.length === 0 || text === "~" ? os.homedir() : text.startsWith("~/") ? path.join(os.homedir(), text.slice(2)) : text;
  if (expanded.includes("\0") || !path.isAbsolute(expanded)) throw new ProtocolError("invalid_request", "The path must be absolute");
  let resolved;
  try {
    resolved = realpathSync(expanded);
  } catch (error) {
    throw new ProtocolError("rejected", error.code === "ENOENT" ? `That folder does not exist: ${expanded}` : `Cannot open the folder: ${error.message}`);
  }
  let stats;
  try {
    stats = statSync(resolved);
  } catch (error) {
    throw new ProtocolError("rejected", `Cannot open the folder: ${error.message}`);
  }
  if (!stats.isDirectory()) throw new ProtocolError("rejected", "That path is not a folder");
  let entries;
  try {
    entries = readdirSync(resolved, { withFileTypes: true });
  } catch (error) {
    throw new ProtocolError("rejected", error.code === "EACCES" ? "Permission denied" : `Cannot read the folder: ${error.message}`);
  }
  const directories = [];
  let hiddenCount = 0;
  let omitted = 0;
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(path.join(resolved, entry.name)).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    if (!isDirectory) continue;
    if (entry.name.startsWith(".")) {
      hiddenCount += 1;
      if (!showHidden) continue;
    }
    if (directories.length >= LIMITS.maxDirectoryEntries) {
      omitted += 1;
      continue;
    }
    directories.push({ name: entry.name, path: path.join(resolved, entry.name), hidden: entry.name.startsWith("."), git: false });
  }
  for (const directory of directories) {
    try {
      directory.git = statSync(path.join(directory.path, ".git")).isDirectory();
    } catch {
      // Not a repository (or unreadable), which is fine for a hint.
    }
  }
  const parent = path.dirname(resolved);
  return { path: resolved, parent: parent === resolved ? "" : parent, entries: directories, hiddenCount, omitted, home: os.homedir() };
}

export function createDirectory(parentPath, name) {
  const cleanName = String(name ?? "").trim();
  if (cleanName.length === 0 || cleanName.length > 255 || cleanName === "." || cleanName === ".." || /[\/\\\0]/.test(cleanName)) {
    throw new ProtocolError("invalid_request", "Folder names cannot be empty or contain slashes");
  }
  const parent = listDirectory(parentPath).path;
  const target = path.join(parent, cleanName);
  try {
    mkdirSync(target, { mode: 0o755 });
  } catch (error) {
    throw new ProtocolError("rejected", error.code === "EEXIST" ? "A folder with that name already exists" : `Cannot create the folder: ${error.message}`);
  }
  return { path: target };
}

// The path a tab may switch to: an existing, readable directory. Returns the real path.
export function resolveWorkspaceDirectory(requested) {
  return listDirectory(requested).path;
}
