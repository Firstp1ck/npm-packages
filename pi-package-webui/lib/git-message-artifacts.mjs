import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const DEFAULT_STABLE_READ_ATTEMPTS = 3;
const DEFAULT_STABLE_READ_DELAY_MS = 20;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function artifactIdentity(stats, bytes) {
  return {
    size: Number(stats.size),
    mtimeNs: String(stats.mtimeNs),
    ctimeNs: String(stats.ctimeNs),
    ino: String(stats.ino),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function sameStatIdentity(left, right) {
  return left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.ino === right.ino;
}

export function sameGitMessageArtifactVersion(left, right) {
  if (!left?.exists || !right?.exists) return left?.exists === right?.exists;
  return left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.ino === right.ino
    && left.sha256 === right.sha256;
}

export async function readStableGitMessageArtifact(filePath, {
  attempts = DEFAULT_STABLE_READ_ATTEMPTS,
  retryDelayMs = DEFAULT_STABLE_READ_DELAY_MS,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      const before = await stat(filePath, { bigint: true });
      if (!before.isFile()) return { exists: false, path: filePath, reason: "not-file" };
      const bytes = await readFile(filePath);
      const after = await stat(filePath, { bigint: true });
      const beforeIdentity = artifactIdentity(before, bytes);
      const afterIdentity = artifactIdentity(after, bytes);
      if (sameStatIdentity(beforeIdentity, afterIdentity)) {
        return {
          exists: true,
          path: filePath,
          text: bytes.toString("utf8"),
          ...afterIdentity,
        };
      }
      lastError = new Error(`Git message artifact changed while it was being read: ${filePath}`);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return { exists: false, path: filePath, reason: "missing" };
      }
      lastError = error;
    }
    if (attempt + 1 < attempts && retryDelayMs > 0) await delay(retryDelayMs);
  }
  throw lastError || new Error(`Could not read a stable Git message artifact: ${filePath}`);
}

export async function readStableGitMessageArtifactPair({ shortPath, longPath }, options) {
  const [short, long] = await Promise.all([
    readStableGitMessageArtifact(shortPath, options),
    readStableGitMessageArtifact(longPath, options),
  ]);
  return { short, long };
}

export function sameGitMessageArtifactPair(left, right) {
  return sameGitMessageArtifactVersion(left?.short, right?.short)
    && sameGitMessageArtifactVersion(left?.long, right?.long);
}

export function gitMessageArtifactPairReadiness(baseline, current) {
  const missing = [];
  const unchanged = [];
  const empty = [];
  for (const key of ["short", "long"]) {
    const before = baseline?.[key] || { exists: false };
    const after = current?.[key] || { exists: false };
    if (!after.exists) {
      missing.push(key);
      continue;
    }
    if (sameGitMessageArtifactVersion(before, after)) unchanged.push(key);
    if (!String(after.text || "").trim()) empty.push(key);
  }
  const ready = missing.length === 0 && unchanged.length === 0 && empty.length === 0;
  let reason = "Generated commit message files are ready.";
  if (missing.length) reason = `Waiting for generated ${missing.join(" and ")} message file${missing.length === 1 ? "" : "s"}.`;
  else if (unchanged.length) reason = `Waiting for ${unchanged.join(" and ")} message file${unchanged.length === 1 ? "" : "s"} to be refreshed for this generation.`;
  else if (empty.length) reason = `Waiting for generated ${empty.join(" and ")} message file${empty.length === 1 ? "" : "s"} to contain a message.`;
  return { ready, reason, missing, unchanged, empty };
}
