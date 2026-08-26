import { spawn, spawnSync } from "node:child_process";

const MAX_PORTAL_OUTPUT_BYTES = 4 * 1024;
const PORTAL_NAMESPACE = "org.freedesktop.appearance";
const PORTAL_KEY = "color-scheme";

export function normalizePortalColorScheme(value) {
  return value === "dark" || value === "light" ? value : "unknown";
}

export function parsePortalReadOutput(output) {
  const text = typeof output === "string" ? output : String(output ?? "");
  if (Buffer.byteLength(text, "utf8") > MAX_PORTAL_OUTPUT_BYTES) return "unknown";
  const match = text.match(/\bu\s+(\d+)\s*$/);
  if (match?.[1] === "1") return "dark";
  if (match?.[1] === "2") return "light";
  return "unknown";
}

export function readPortalColorScheme({ spawnSyncImpl = spawnSync, env = process.env } = {}) {
  try {
    const result = spawnSyncImpl("busctl", [
      "--user",
      "call",
      "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop",
      "org.freedesktop.portal.Settings",
      "Read",
      "ss",
      PORTAL_NAMESPACE,
      PORTAL_KEY,
    ], {
      encoding: "utf8",
      env,
      timeout: 1_500,
      maxBuffer: MAX_PORTAL_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0) return "unknown";
    return parsePortalReadOutput(result.stdout);
  } catch {
    return "unknown";
  }
}

export function parsePortalSignalLine(line) {
  const text = typeof line === "string" ? line : String(line ?? "");
  if (Buffer.byteLength(text, "utf8") > MAX_PORTAL_OUTPUT_BYTES) return "unknown";
  if (!text.includes("org.freedesktop.portal.Settings.SettingChanged")) return "unknown";
  if (!text.includes(`'${PORTAL_NAMESPACE}'`) || !text.includes(`'${PORTAL_KEY}'`)) return "unknown";
  const match = text.match(/\buint32\s+(\d+)\b/);
  if (match?.[1] === "1") return "dark";
  if (match?.[1] === "2") return "light";
  return "unknown";
}

export function createPortalAppearanceMonitor({
  env = process.env,
  initialColorScheme = env.QT_WEBUI_SYSTEM_COLOR_SCHEME,
  spawnImpl = spawn,
  readColorScheme = () => readPortalColorScheme({ env }),
  onChange = () => {},
  restartDelayMs = 1_000,
  maxRestartDelayMs = 30_000,
  stopGraceMs = 500,
} = {}) {
  let colorScheme = normalizePortalColorScheme(initialColorScheme);
  let child = null;
  let stoppingChild = null;
  let buffer = "";
  let active = false;
  let restartTimer = null;
  let retryCount = 0;

  function apply(value) {
    const next = normalizePortalColorScheme(value);
    if (next === "unknown" || next === colorScheme) return false;
    colorScheme = next;
    onChange(colorScheme);
    return true;
  }

  function consume(chunk) {
    retryCount = 0;
    buffer += typeof chunk === "string" ? chunk : String(chunk ?? "");
    if (Buffer.byteLength(buffer, "utf8") > MAX_PORTAL_OUTPUT_BYTES) {
      const newline = buffer.lastIndexOf("\n");
      buffer = newline >= 0 ? buffer.slice(newline + 1) : "";
    }
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      apply(parsePortalSignalLine(line));
    }
  }

  function clearRestart() {
    if (restartTimer === null) return;
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  function scheduleRestart() {
    if (!active || child || restartTimer !== null) return;
    const delay = Math.min(maxRestartDelayMs, restartDelayMs * (2 ** Math.min(retryCount, 5)));
    retryCount += 1;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      spawnMonitor();
    }, Math.max(0, delay));
    restartTimer.unref?.();
  }

  function monitorEnded(monitor) {
    if (child !== monitor) return;
    child = null;
    buffer = "";
    scheduleRestart();
  }

  function spawnMonitor() {
    if (!active || child) return;
    apply(readColorScheme());
    try {
      const monitor = spawnImpl("gdbus", [
        "monitor",
        "--session",
        "--dest",
        "org.freedesktop.portal.Desktop",
        "--object-path",
        "/org/freedesktop/portal/desktop",
      ], {
        env,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      child = monitor;
      monitor.stdout?.setEncoding?.("utf8");
      monitor.stdout?.on?.("data", consume);
      monitor.once?.("error", () => monitorEnded(monitor));
      monitor.once?.("close", () => monitorEnded(monitor));
    } catch {
      child = null;
      scheduleRestart();
    }
  }

  function start() {
    if (active) return;
    active = true;
    retryCount = 0;
    spawnMonitor();
  }

  function isRunning(monitor) {
    return Boolean(monitor && monitor.exitCode === null && monitor.signalCode === null);
  }

  function signal(monitor, value) {
    try {
      monitor.kill(value);
    } catch {
      // The helper may have exited between the liveness check and the signal.
    }
  }

  function waitForExit(monitor, timeoutMs) {
    if (!isRunning(monitor)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (exited) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        monitor.removeListener?.("exit", exitedHandler);
        monitor.removeListener?.("close", exitedHandler);
        monitor.removeListener?.("error", exitedHandler);
        resolve(exited);
      };
      const exitedHandler = () => finish(true);
      const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
      monitor.once?.("exit", exitedHandler);
      monitor.once?.("close", exitedHandler);
      monitor.once?.("error", exitedHandler);
    });
  }

  async function stop() {
    active = false;
    clearRestart();
    const monitor = child;
    child = null;
    stoppingChild = monitor;
    buffer = "";
    if (!isRunning(monitor)) {
      if (stoppingChild === monitor) stoppingChild = null;
      return;
    }
    try {
      signal(monitor, "SIGTERM");
      if (await waitForExit(monitor, stopGraceMs)) return;
      signal(monitor, "SIGKILL");
      await waitForExit(monitor, stopGraceMs);
    } finally {
      if (stoppingChild === monitor) stoppingChild = null;
    }
  }

  function stopNow() {
    active = false;
    clearRestart();
    const monitors = new Set([child, stoppingChild].filter(Boolean));
    child = null;
    buffer = "";
    for (const monitor of monitors) {
      if (isRunning(monitor)) signal(monitor, "SIGKILL");
    }
  }

  return {
    start,
    stop,
    stopNow,
    apply,
    snapshot: () => ({ portalColorScheme: colorScheme }),
  };
}
