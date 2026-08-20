import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const SESSION_DIR_BLOCK_MESSAGE = "sessionPath must stay inside the Pi session directory";

export function normalizeSessionFilePath(value) {
  const text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

/**
 * Resolve symlinks where possible so confinement checks compare canonical paths.
 * For paths that do not exist yet (e.g. a brand-new session file), realpath the
 * nearest existing ancestor and re-append the rest, so a symlinked session
 * directory (such as ~/.pi pointing into a dotfiles repo) still canonicalizes
 * instead of silently comparing against the unresolved path.
 */
function canonicalSessionPath(value) {
  const resolved = normalizeSessionFilePath(value);
  if (!resolved) return "";
  try {
    return realpathSync(resolved);
  } catch {
    const tail = [];
    let current = resolved;
    while (true) {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      tail.unshift(path.basename(current));
      current = parent;
      try {
        return path.join(realpathSync(current), ...tail);
      } catch {
        // keep walking up
      }
    }
  }
}

/** Empty/missing allowedDirs means no confinement is configured for this call. */
export function isSessionPathAllowed(sessionPath, allowedDirs = []) {
  const dirs = (allowedDirs || []).map((dir) => canonicalSessionPath(dir)).filter(Boolean);
  if (!dirs.length) return true;
  const target = canonicalSessionPath(sessionPath);
  if (!target) return false;
  return dirs.some((dir) => {
    const relative = path.relative(dir, target);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

export function collectOpenSessionFiles(tabs = []) {
  const files = new Set();
  for (const tab of tabs) {
    for (const candidate of [tab?.lastState?.sessionFile, tab?.sessionFile]) {
      const normalized = normalizeSessionFilePath(candidate);
      if (normalized) files.add(normalized);
    }
  }
  return files;
}

export function validateSessionDelete(sessionPath, { openSessionFiles, currentSessionFile, confirmed, allowedDirs } = {}) {
  if (confirmed !== true) {
    return {
      allowed: false,
      reason: "confirmation_required",
      message: "Session delete requires explicit confirmation (confirmed: true).",
    };
  }

  const target = normalizeSessionFilePath(sessionPath);
  if (!target) {
    return { allowed: false, reason: "invalid_path", message: "sessionPath is required" };
  }
  if (!target.endsWith(".jsonl")) {
    return { allowed: false, reason: "invalid_path", message: "sessionPath must point to a .jsonl session file" };
  }
  if (!isSessionPathAllowed(target, allowedDirs)) {
    return { allowed: false, reason: "outside_session_dir", message: SESSION_DIR_BLOCK_MESSAGE };
  }
  if (openSessionFiles?.has(target)) {
    return {
      allowed: false,
      reason: "session_in_use",
      message: "Cannot delete a session that is open in a Web UI tab. Close that tab first.",
    };
  }
  const activePath = normalizeSessionFilePath(currentSessionFile);
  if (activePath && activePath === target) {
    return {
      allowed: false,
      reason: "active_session",
      message: "Cannot delete the active session for this tab. Switch to another session first.",
    };
  }
  return { allowed: true, sessionPath: target };
}

export async function renameSessionMetadata(sessionPath, name, sessionDir, { allowedDirs } = {}) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("name is required");
  const targetPath = normalizeSessionFilePath(sessionPath);
  if (!targetPath.endsWith(".jsonl")) throw new Error("sessionPath must point to a .jsonl session file");
  if (!isSessionPathAllowed(targetPath, allowedDirs)) throw new Error(SESSION_DIR_BLOCK_MESSAGE);
  const targetStats = await stat(targetPath).catch(() => null);
  if (!targetStats?.isFile()) throw new Error(`Session file not found: ${targetPath}`);

  const manager = SessionManager.open(targetPath, sessionDir);
  const previousName = manager.getSessionName();
  const entryId = manager.appendSessionInfo(trimmed);
  return {
    sessionPath: manager.getSessionFile() || targetPath,
    name: trimmed,
    entryId,
    previousName,
  };
}

export async function deleteSessionFile(sessionPath, { allowedDirs } = {}) {
  const targetPath = normalizeSessionFilePath(sessionPath);
  if (!targetPath) throw new Error("sessionPath is required");
  if (!isSessionPathAllowed(targetPath, allowedDirs)) throw new Error(SESSION_DIR_BLOCK_MESSAGE);
  const targetStats = await stat(targetPath).catch(() => null);
  if (!targetStats?.isFile()) throw new Error(`Session file not found: ${targetPath}`);

  const trashArgs = targetPath.startsWith("-") ? ["--", targetPath] : [targetPath];
  const trashResult = spawnSync("trash", trashArgs, { encoding: "utf8" });
  const trashHint = () => {
    const parts = [];
    if (trashResult.error) parts.push(trashResult.error.message);
    const stderr = String(trashResult.stderr || "").trim();
    if (stderr) parts.push(stderr.split("\n")[0] || stderr);
    return parts.length ? `trash: ${parts.join(" · ").slice(0, 200)}` : "";
  };

  if (trashResult.status === 0 || !existsSync(targetPath)) {
    return { sessionPath: targetPath, method: "trash" };
  }

  try {
    await unlink(targetPath);
    return { sessionPath: targetPath, method: "unlink" };
  } catch (error) {
    const unlinkError = error instanceof Error ? error.message : String(error);
    const hint = trashHint();
    throw new Error(hint ? `${unlinkError} (${hint})` : unlinkError);
  }
}
