import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const APPEND_SYSTEM_FILE_NAME = "APPEND_SYSTEM.md";
export const APPEND_SYSTEM_DISCOVERY_LIMITS = Object.freeze({
  maxDepth: 10,
  maxVisitedDirectories: 2_048,
  maxCandidates: 256,
  maxDiagnostics: 64,
});

export const APPEND_SYSTEM_DIAGNOSTIC_MESSAGES = Object.freeze({
  "candidate-limit": "Additional APPEND_SYSTEM.md candidates were omitted because the candidate limit was reached.",
  "diagnostic-limit": "Additional scan diagnostics were omitted because the diagnostic limit was reached.",
  "directory-inaccessible": "This directory could not be read and was skipped.",
  "directory-limit": "Additional directories were not scanned because the directory limit was reached.",
  "root-inaccessible": "This discovery root could not be read and was skipped.",
  "root-missing": "This discovery root does not exist and was skipped.",
  "root-not-directory": "This discovery root is not a directory and was skipped.",
  "saved-selection-invalid": "The saved APPEND_SYSTEM.md selection is no longer available from the approved discovery roots.",
  "symlink-entry": "This symbolic-link entry was skipped and was not followed.",
  "symlink-inaccessible": "This symbolic-link target could not be resolved and was skipped.",
  "symlink-unsupported-target": "This symbolic-link target is not a regular file or directory and was skipped.",
});

export const APPEND_SYSTEM_DIAGNOSTIC_KINDS = Object.freeze(Object.keys(APPEND_SYSTEM_DIAGNOSTIC_MESSAGES));

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function cleanPath(value) {
  if (typeof value !== "string" || hasControlCharacters(value)) return null;
  const clean = value.trim();
  if (!clean || clean.length > 4_096 || !path.isAbsolute(clean)) return null;
  return path.normalize(clean);
}

export function normalizeAppendSystemPromptPath(value) {
  if (value === null || value === undefined) return null;
  return cleanPath(value);
}

export function normalizeAppendSystemPromptRootPath(value) {
  if (value === null || value === undefined) return null;
  return cleanPath(value);
}

function diagnosticCollector() {
  const diagnostics = [];
  let truncated = false;
  return {
    diagnostics,
    add(kind, diagnosticPath = "") {
      if (!Object.hasOwn(APPEND_SYSTEM_DIAGNOSTIC_MESSAGES, kind)) return;
      const normalizedPath = typeof diagnosticPath === "string" && !hasControlCharacters(diagnosticPath)
        ? diagnosticPath.slice(0, 4_096)
        : "";
      if (diagnostics.length < APPEND_SYSTEM_DISCOVERY_LIMITS.maxDiagnostics - 1) {
        diagnostics.push({ kind, path: normalizedPath, message: APPEND_SYSTEM_DIAGNOSTIC_MESSAGES[kind] });
        return;
      }
      truncated = true;
      if (!diagnostics.some((item) => item.kind === "diagnostic-limit")) {
        diagnostics.push({ kind: "diagnostic-limit", path: "", message: APPEND_SYSTEM_DIAGNOSTIC_MESSAGES["diagnostic-limit"] });
      }
    },
    get truncated() {
      return truncated;
    },
  };
}

async function resolveDiscoveryRoot(root, diagnostics) {
  const requestedPath = path.resolve(root.path);
  let canonicalPath;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch (error) {
    diagnostics.add(error?.code === "ENOENT" ? "root-missing" : "root-inaccessible", requestedPath);
    return { ...root, path: requestedPath, scan: false };
  }

  try {
    const info = await stat(canonicalPath);
    if (!info.isDirectory()) {
      diagnostics.add("root-not-directory", requestedPath);
      return { ...root, path: requestedPath, scan: false };
    }
  } catch {
    diagnostics.add("root-inaccessible", requestedPath);
    return { ...root, path: requestedPath, scan: false };
  }

  return { ...root, path: requestedPath, canonicalPath, scan: true };
}

function discoveryRootInputs({ piRoot, cwd }) {
  return [
    { path: piRoot || path.join(homedir(), ".pi"), label: "Pi home" },
    { path: cwd, label: "Current folder" },
  ].filter((root) => typeof root.path === "string" && root.path.trim() && !hasControlCharacters(root.path));
}

async function resolveSymbolicLink(entryPath, diagnostics) {
  try {
    const canonicalPath = await realpath(entryPath);
    return { canonicalPath, info: await stat(canonicalPath) };
  } catch {
    diagnostics.add("symlink-inaccessible", entryPath);
    return null;
  }
}

/**
 * Discovers exact visible-name APPEND_SYSTEM.md regular files under the lexical
 * roots. Directory links are followed, and all output classes are capped by
 * APPEND_SYSTEM_DISCOVERY_LIMITS.
 */
export async function discoverAppendSystemFiles({ piRoot, cwd, savedPath = null, excludedPaths = [] } = {}) {
  const diagnostics = diagnosticCollector();
  const excludedCandidatePaths = new Set(
    (Array.isArray(excludedPaths) ? excludedPaths : []).map(cleanPath).filter(Boolean),
  );
  const resolvedRoots = [];
  for (const root of discoveryRootInputs({ piRoot, cwd })) {
    resolvedRoots.push(await resolveDiscoveryRoot(root, diagnostics));
  }

  const roots = [];
  const seenRootPaths = new Set();
  for (const root of resolvedRoots) {
    if (seenRootPaths.has(root.path)) continue;
    seenRootPaths.add(root.path);
    roots.push({ path: root.path, label: root.label });
  }

  const candidatesByPath = new Map();
  const addCandidate = (candidatePath, rootLabel) => {
    const normalizedPath = cleanPath(candidatePath);
    if (!normalizedPath || candidatesByPath.has(normalizedPath)) return;
    if (candidatesByPath.size < APPEND_SYSTEM_DISCOVERY_LIMITS.maxCandidates) {
      candidatesByPath.set(normalizedPath, { path: normalizedPath, rootLabel });
    } else if (!candidateLimitReached) {
      candidateLimitReached = true;
      diagnostics.add("candidate-limit");
    }
  };
  const scannedRemainingDepth = new Map();
  const scanStates = resolvedRoots
    .filter((root) => root.scan)
    .map((root) => ({
      root,
      queue: [{ directory: root.path, canonicalDirectory: root.canonicalPath, depth: 0 }],
      queueIndex: 0,
    }));
  let visitedDirectories = 0;
  let directoryLimitReached = false;
  let candidateLimitReached = false;

  // Round-robin traversal prevents either approved root from consuming the shared
  // directory budget before the other root receives a deterministic scan turn.
  while (visitedDirectories < APPEND_SYSTEM_DISCOVERY_LIMITS.maxVisitedDirectories) {
    let scannedInRound = false;
    for (const state of scanStates) {
      let current;
      while (state.queueIndex < state.queue.length) {
        const queued = state.queue[state.queueIndex];
        state.queueIndex += 1;
        const remainingDepth = APPEND_SYSTEM_DISCOVERY_LIMITS.maxDepth - queued.depth;
        if ((scannedRemainingDepth.get(queued.canonicalDirectory) ?? -1) >= remainingDepth) continue;
        current = queued;
        scannedRemainingDepth.set(current.canonicalDirectory, remainingDepth);
        break;
      }
      if (!current) continue;
      if (visitedDirectories >= APPEND_SYSTEM_DISCOVERY_LIMITS.maxVisitedDirectories) {
        directoryLimitReached = true;
        break;
      }
      scannedInRound = true;
      visitedDirectories += 1;

      let entries;
      try {
        entries = await readdir(current.directory, { withFileTypes: true });
      } catch {
        diagnostics.add("directory-inaccessible", current.directory);
        continue;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

      for (const entry of entries) {
        const entryPath = path.join(current.directory, entry.name);
        if (entry.isSymbolicLink()) {
          const resolvedLink = await resolveSymbolicLink(entryPath, diagnostics);
          if (!resolvedLink) continue;
          if (resolvedLink.info.isFile()) {
            if (entry.name === APPEND_SYSTEM_FILE_NAME && !excludedCandidatePaths.has(entryPath)) {
              addCandidate(entryPath, state.root.label);
            }
            continue;
          }
          if (resolvedLink.info.isDirectory()) {
            if (current.depth < APPEND_SYSTEM_DISCOVERY_LIMITS.maxDepth) {
              state.queue.push({
                directory: entryPath,
                canonicalDirectory: resolvedLink.canonicalPath,
                depth: current.depth + 1,
              });
            }
            continue;
          }
          diagnostics.add("symlink-unsupported-target", entryPath);
          continue;
        }
        if (entry.isFile() && entry.name === APPEND_SYSTEM_FILE_NAME && !excludedCandidatePaths.has(entryPath)) {
          addCandidate(entryPath, state.root.label);
          continue;
        }
        if (entry.isDirectory() && current.depth < APPEND_SYSTEM_DISCOVERY_LIMITS.maxDepth) {
          let canonicalDirectory;
          try {
            canonicalDirectory = await realpath(entryPath);
          } catch {
            diagnostics.add("directory-inaccessible", entryPath);
            continue;
          }
          state.queue.push({ directory: entryPath, canonicalDirectory, depth: current.depth + 1 });
        }
      }
    }
    if (!scannedInRound || directoryLimitReached) break;
  }

  if (!directoryLimitReached && visitedDirectories >= APPEND_SYSTEM_DISCOVERY_LIMITS.maxVisitedDirectories) {
    directoryLimitReached = scanStates.some((state) => state.queueIndex < state.queue.length);
  }
  if (directoryLimitReached) diagnostics.add("directory-limit");

  const candidates = [...candidatesByPath.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const appendSystemPromptPath = normalizeAppendSystemPromptPath(savedPath);
  if (appendSystemPromptPath && !candidatesByPath.has(appendSystemPromptPath)) {
    diagnostics.add("saved-selection-invalid", appendSystemPromptPath);
  }

  return {
    appendSystemPromptPath,
    roots,
    candidates,
    diagnostics: diagnostics.diagnostics,
    limits: {
      ...APPEND_SYSTEM_DISCOVERY_LIMITS,
      visitedDirectories,
      truncated: {
        directories: directoryLimitReached,
        candidates: candidateLimitReached,
        diagnostics: diagnostics.truncated,
      },
    },
  };
}

/**
 * Revalidates a saved lexical root/path pair without discovery caps. Symlinks
 * may resolve outside the root, but the final visible path must resolve to a
 * regular file.
 */
export async function validateSavedAppendSystemSelection(value, rootValue) {
  const savedPath = cleanPath(value);
  const rootPath = cleanPath(rootValue);
  if (!savedPath || !rootPath || path.basename(savedPath) !== APPEND_SYSTEM_FILE_NAME) return null;

  const relativePath = path.relative(rootPath, savedPath);
  if (!relativePath || path.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) return null;
  const segments = relativePath.split(path.sep);
  if (segments.length - 1 > APPEND_SYSTEM_DISCOVERY_LIMITS.maxDepth) return null;

  try {
    await realpath(rootPath);
    const rootInfo = await stat(rootPath);
    if (!rootInfo.isDirectory()) return null;

    await realpath(savedPath);
    const savedInfo = await stat(savedPath);
    if (!savedInfo.isFile()) return null;
    return { path: savedPath, rootPath };
  } catch {
    return null;
  }
}

/** Confirms a submitted visible alias appears in a fresh bounded scan. */
export async function validateAppendSystemSelection(value, options = {}) {
  const submittedPath = cleanPath(value);
  if (!submittedPath || path.basename(submittedPath) !== APPEND_SYSTEM_FILE_NAME) return null;

  const discovery = await discoverAppendSystemFiles({ ...options, savedPath: submittedPath });
  const candidate = discovery.candidates.find((item) => item.path === submittedPath);
  if (!candidate) return null;
  const rootPath = discovery.roots.find((root) => root.label === candidate.rootLabel)?.path;
  if (!rootPath) return null;
  try {
    const finalInfo = await stat(submittedPath);
    if (!finalInfo.isFile()) return null;
  } catch {
    return null;
  }
  return { path: submittedPath, rootPath, discovery };
}
