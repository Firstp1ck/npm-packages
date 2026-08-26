import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { LIMITS } from "./protocol.mjs";

// Workspace path index used for `@` completion and later for the file tree. Paths are relative
// to the workspace root, never leave it, and are bounded in count and depth. Inside a Git
// repository the index comes from `git ls-files` so ignored build output stays out; elsewhere a
// bounded directory walk is used. The index is cached briefly so typing does not rescan.

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".hg", ".svn", "__pycache__", ".cache"]);

// True when `candidate` (already resolved through symlinks) is the workspace root or inside it.
export function resolveInsideWorkspace(root, candidate) {
  let resolvedRoot;
  try {
    resolvedRoot = realpathSync(root);
  } catch {
    return false;
  }
  const relative = path.relative(resolvedRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Resolves a workspace-relative or absolute path to an absolute path inside the workspace, or
// null when it escapes (through `..`, an absolute path elsewhere, or a symlink). The final
// component may not exist yet (create operations), but every parent must resolve inside.
export function confinePath(root, requested) {
  const text = String(requested ?? "");
  if (text.includes("\0") || text.length > LIMITS.maxPathCharacters) return null;
  const absolute = path.resolve(root, text);
  const parent = path.dirname(absolute);
  let resolvedParent;
  try {
    resolvedParent = realpathSync(parent);
  } catch {
    return null;
  }
  if (!resolveInsideWorkspace(root, resolvedParent)) return null;
  const target = path.join(resolvedParent, path.basename(absolute));
  try {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink()) {
      const real = realpathSync(target);
      if (!resolveInsideWorkspace(root, real)) return null;
    }
  } catch {
    // Missing final component is allowed.
  }
  return target;
}

function runGitListing(root, { spawnImpl }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl("git", ["-c", "core.quotepath=off", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, LIMITS.workspaceCommandTimeoutMs);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMITS.maxWorkspaceCommandOutputBytes) {
        child.kill("SIGKILL");
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", () => finish(null));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(Buffer.concat(chunks).toString("utf8").split("\0").filter((entry) => entry.length > 0));
    });
  });
}

function walkDirectory(root) {
  const files = [];
  let truncated = false;
  const visit = (relative, depth) => {
    if (truncated) return;
    let entries;
    try {
      entries = readdirSync(path.join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= LIMITS.maxWorkspaceEntries) {
        truncated = true;
        return;
      }
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (depth + 1 >= LIMITS.maxWorkspaceDepth) continue;
        visit(childRelative, depth + 1);
      } else if (entry.isFile()) {
        files.push(childRelative);
      }
    }
  };
  visit("", 0);
  return { files, truncated };
}

function directoriesOf(files) {
  const directories = new Set();
  for (const file of files) {
    let cursor = path.posix.dirname(file);
    while (cursor && cursor !== "." && !directories.has(cursor)) {
      directories.add(cursor);
      cursor = path.posix.dirname(cursor);
    }
  }
  return [...directories].sort();
}

export function createWorkspaceIndex({ root, spawnImpl = spawn, now = () => Date.now() }) {
  let cache = null;
  let inflight = null;

  async function build() {
    const inGit = existsSync(path.join(root, ".git"));
    let files = inGit ? await runGitListing(root, { spawnImpl }) : null;
    let truncated = false;
    if (files) {
      files = files.filter((entry) => entry.split("/").length <= LIMITS.maxWorkspaceDepth && !entry.split("/").some((segment) => SKIPPED_DIRECTORIES.has(segment)));
      if (files.length > LIMITS.maxWorkspaceEntries) {
        files.length = LIMITS.maxWorkspaceEntries;
        truncated = true;
      }
      files.sort();
    } else {
      const walked = walkDirectory(root);
      files = walked.files;
      truncated = walked.truncated;
    }
    return { files, directories: directoriesOf(files), truncated, source: files && inGit ? "git" : "walk", builtAt: now() };
  }

  async function snapshot({ force = false } = {}) {
    if (!force && cache && now() - cache.builtAt < LIMITS.workspaceIndexTtlMs) return cache;
    if (!inflight) {
      inflight = build().then((result) => {
        cache = result;
        inflight = null;
        return result;
      }, (error) => {
        inflight = null;
        throw error;
      });
    }
    return inflight;
  }

  // Ranks paths for a completion query: basename prefix, then path prefix, then substring, then
  // an in-order subsequence. Directories are marked so the client can append a slash.
  async function complete(query) {
    const index = await snapshot();
    const needle = String(query ?? "").trim().replace(/^@/, "").toLowerCase();
    const candidates = [...index.directories.map((entry) => ({ path: entry, directory: true })), ...index.files.map((entry) => ({ path: entry, directory: false }))];
    const scored = [];
    for (const candidate of candidates) {
      const lower = candidate.path.toLowerCase();
      const base = path.posix.basename(lower);
      let score;
      if (needle.length === 0) score = 4;
      else if (base.startsWith(needle)) score = 0;
      else if (lower.startsWith(needle)) score = 1;
      else if (lower.includes(needle)) score = 2;
      else if (isSubsequence(needle, lower)) score = 3;
      else continue;
      scored.push({ score, candidate });
    }
    scored.sort((a, b) => a.score - b.score || a.candidate.path.length - b.candidate.path.length || a.candidate.path.localeCompare(b.candidate.path));
    return {
      suggestions: scored.slice(0, LIMITS.maxPathSuggestions).map((entry) => entry.candidate),
      total: scored.length,
      truncated: index.truncated,
      source: index.source,
    };
  }

  function invalidate() {
    cache = null;
  }

  return { snapshot, complete, invalidate, root };
}

function isSubsequence(needle, haystack) {
  let position = 0;
  for (const character of haystack) {
    if (character === needle[position]) position += 1;
    if (position === needle.length) return true;
  }
  return needle.length === 0;
}
