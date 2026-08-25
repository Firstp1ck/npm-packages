import { spawn } from "node:child_process";
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

export function openExternalLink({ url, spawnImpl } = {}) {
  const href = safeExternalLink(url);
  if (!href) return Promise.resolve({ delivered: false, reason: "link scheme is not allowed" });
  return runDetached("xdg-open", [href], { spawnImpl }).then((result) => ({ ...result, url: href }));
}
