import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { LIMITS, boundedString, safeExternalLink } from "./protocol.mjs";

// Desktop helpers run external commands with argument arrays only. Untrusted text is passed as
// a single argument, never interpolated into shell text.

function runDetached(command, args, { spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, { stdio: "ignore", shell: false, detached: true });
    } catch (error) {
      resolve({ delivered: false, reason: error.message });
      return;
    }
    child.once("error", (error) => resolve({ delivered: false, reason: error.code === "ENOENT" ? `${command} is not installed` : error.message }));
    child.once("spawn", () => {
      child.unref();
      resolve({ delivered: true });
    });
  });
}

export function sendDesktopNotification({ title, body = "", spawnImpl } = {}) {
  const safeTitle = boundedString(title, LIMITS.maxNotificationCharacters, "Qt WebUI");
  const safeBody = boundedString(body, LIMITS.maxNotificationCharacters, "");
  // "--" keeps a leading dash in the title from being read as an option.
  return runDetached("notify-send", ["--app-name=Qt WebUI", "--expire-time=8000", "--", safeTitle, safeBody], { spawnImpl });
}

// Opens a local file with the desktop's default application. The path must be an existing
// regular file; it is passed as one argument, so names starting with "-" or containing spaces
// cannot become options or extra arguments.
export function openLocalPath({ path: requested, spawnImpl, statImpl = defaultStat } = {}) {
  const target = typeof requested === "string" ? requested : "";
  if (!target.startsWith("/") || target.includes("\0") || target.length > LIMITS.maxPathCharacters) return Promise.resolve({ delivered: false, reason: "path must be an absolute file path" });
  let stats;
  try {
    stats = statImpl(target);
  } catch (error) {
    return Promise.resolve({ delivered: false, reason: error.code === "ENOENT" ? "the file does not exist" : error.message });
  }
  if (!stats.isFile()) return Promise.resolve({ delivered: false, reason: "only regular files can be opened" });
  return runDetached("xdg-open", [target], { spawnImpl }).then((result) => ({ ...result, path: target }));
}

function defaultStat(target) {
  return statSync(target);
}

export function openExternalLink({ url, spawnImpl } = {}) {
  const href = safeExternalLink(url);
  if (!href) return Promise.resolve({ delivered: false, reason: "link scheme is not allowed" });
  return runDetached("xdg-open", [href], { spawnImpl }).then((result) => ({ ...result, url: href }));
}
