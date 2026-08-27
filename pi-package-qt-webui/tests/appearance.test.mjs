import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createPortalAppearanceMonitor,
  normalizePortalColorScheme,
  parsePortalReadOutput,
  parsePortalSignalLine,
} from "../lib/backend/appearance.mjs";

function portalSignal(value) {
  return `/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('org.freedesktop.appearance', 'color-scheme', <uint32 ${value}>)`;
}

function fakeMonitorChild({ closeOnSignal = false } = {}) {
  const stdout = new EventEmitter();
  stdout.setEncoding = () => {};
  const child = new EventEmitter();
  child.stdout = stdout;
  child.exitCode = null;
  child.signalCode = null;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (closeOnSignal) queueMicrotask(() => {
      child.signalCode = signal;
      child.emit("close", null, signal);
    });
    return true;
  };
  return child;
}

test("portal appearance parsing accepts only bounded light and dark values", () => {
  assert.equal(normalizePortalColorScheme("dark"), "dark");
  assert.equal(normalizePortalColorScheme("LIGHT"), "unknown");
  assert.equal(parsePortalReadOutput("v v u 1\n"), "dark");
  assert.equal(parsePortalReadOutput("v v u 2\n"), "light");
  assert.equal(parsePortalReadOutput("v v u 0\n"), "unknown");
  assert.equal(parsePortalReadOutput(`u 1${"x".repeat(4096)}`), "unknown");
  assert.equal(parsePortalSignalLine(portalSignal(1)), "dark");
  assert.equal(parsePortalSignalLine(portalSignal(2)), "light");
  assert.equal(parsePortalSignalLine(portalSignal(0)), "unknown");
  assert.equal(parsePortalSignalLine("org.freedesktop.portal.Settings.SettingChanged ('other', 'color-scheme', <uint32 1>)"), "unknown");
});

test("portal monitor uses argument arrays, follows live changes, and waits for normal shutdown", async () => {
  const child = fakeMonitorChild();
  const calls = [];
  const changes = [];
  const monitor = createPortalAppearanceMonitor({
    env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/test-bus" },
    initialColorScheme: "dark",
    readColorScheme: () => "light",
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
    onChange: (mode) => changes.push(mode),
  });

  monitor.start();
  assert.deepEqual(monitor.snapshot(), { portalColorScheme: "light" });
  assert.equal(calls[0].command, "setpriv");
  assert.deepEqual(calls[0].args, [
    "--pdeathsig", "SIGKILL", "--", "gdbus",
    "monitor", "--session", "--dest", "org.freedesktop.portal.Desktop",
    "--object-path", "/org/freedesktop/portal/desktop",
  ]);
  assert.equal(calls[0].options.shell, false);

  child.stdout.emit("data", `${portalSignal(0)}\nnot a signal\n`);
  assert.deepEqual(monitor.snapshot(), { portalColorScheme: "light" });
  child.stdout.emit("data", `${portalSignal(1)}\n`);
  assert.deepEqual(monitor.snapshot(), { portalColorScheme: "dark" });
  child.stdout.emit("data", `${portalSignal(2).slice(0, 40)}`);
  child.stdout.emit("data", `${portalSignal(2).slice(40)}\n`);
  assert.deepEqual(monitor.snapshot(), { portalColorScheme: "light" });
  assert.deepEqual(changes, ["light", "dark", "light"]);

  let stopped = false;
  const stopPromise = monitor.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false, "normal stop must wait for the helper to exit");
  assert.deepEqual(child.signals, ["SIGTERM"]);
  child.signalCode = "SIGTERM";
  child.emit("close", null, "SIGTERM");
  await stopPromise;
  assert.equal(stopped, true);
});

test("portal monitor falls back when the parent-death wrapper is unavailable", async () => {
  const calls = [];
  const children = [];
  const monitor = createPortalAppearanceMonitor({
    readColorScheme: () => "unknown",
    restartDelayMs: 0,
    maxRestartDelayMs: 0,
    spawnImpl: (command, args) => {
      const child = fakeMonitorChild();
      calls.push({ command, args });
      children.push(child);
      return child;
    },
  });

  monitor.start();
  const unavailable = Object.assign(new Error("setpriv unavailable"), { code: "ENOENT" });
  children[0].emit("error", unavailable);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "setpriv");
  assert.equal(calls[1].command, "gdbus");
  assert.deepEqual(calls[1].args, [
    "monitor", "--session", "--dest", "org.freedesktop.portal.Desktop",
    "--object-path", "/org/freedesktop/portal/desktop",
  ]);
  monitor.stopNow();
  assert.deepEqual(children[1].signals, ["SIGKILL"]);
});

test("portal monitor restarts after failure", async () => {
  const children = [];
  const reads = ["light", "dark"];
  const monitor = createPortalAppearanceMonitor({
    initialColorScheme: "dark",
    readColorScheme: () => reads.shift() || "dark",
    restartDelayMs: 0,
    maxRestartDelayMs: 0,
    spawnImpl: () => {
      const child = fakeMonitorChild();
      children.push(child);
      return child;
    },
  });

  monitor.start();
  assert.equal(children.length, 1);
  children[0].exitCode = 1;
  children[0].emit("close", 1, null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(children.length, 2);
  assert.deepEqual(monitor.snapshot(), { portalColorScheme: "dark" });

  monitor.stopNow();
  assert.deepEqual(children[1].signals, ["SIGKILL"]);
});

test("portal monitor stop cancels a queued restart", async () => {
  const children = [];
  const monitor = createPortalAppearanceMonitor({
    readColorScheme: () => "unknown",
    restartDelayMs: 30,
    maxRestartDelayMs: 30,
    spawnImpl: () => {
      const child = fakeMonitorChild();
      children.push(child);
      return child;
    },
  });

  monitor.start();
  children[0].exitCode = 1;
  children[0].emit("close", 1, null);
  await monitor.stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(children.length, 1, "stopping while restart is queued must prevent the respawn");
});

test("portal monitor escalates when the helper ignores SIGTERM", async () => {
  const child = fakeMonitorChild();
  const monitor = createPortalAppearanceMonitor({
    spawnImpl: () => child,
    readColorScheme: () => "unknown",
    stopGraceMs: 5,
  });
  monitor.start();
  await monitor.stop();
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("forced stop kills a helper already undergoing graceful shutdown", async () => {
  const child = fakeMonitorChild();
  const monitor = createPortalAppearanceMonitor({
    spawnImpl: () => child,
    readColorScheme: () => "unknown",
    stopGraceMs: 100,
  });

  monitor.start();
  const stopPromise = monitor.stop();
  assert.deepEqual(child.signals, ["SIGTERM"]);
  monitor.stopNow();
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  child.signalCode = "SIGKILL";
  child.emit("close", null, "SIGKILL");
  await stopPromise;
});

test("unavailable portal reads and monitors retain the last valid startup value", async () => {
  const changes = [];
  const monitor = createPortalAppearanceMonitor({
    initialColorScheme: "dark",
    readColorScheme: () => "unknown",
    spawnImpl: () => { throw new Error("gdbus unavailable"); },
    onChange: (mode) => changes.push(mode),
  });
  assert.doesNotThrow(() => monitor.start());
  assert.deepEqual(monitor.snapshot(), { portalColorScheme: "dark" });
  assert.deepEqual(changes, []);
  await assert.doesNotReject(monitor.stop());
});

test("built-in filled button foreground pairs meet WCAG AA at 12px", () => {
  const luminance = (hex) => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map((part) => Number.parseInt(part, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (first, second) => {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  const pairs = [
    ["#5f529b", "#ffffff"], ["#504584", "#ffffff"], ["#443972", "#ffffff"],
    ["#afa2ee", "#100e18"], ["#c2b8f7", "#100e18"], ["#9386d3", "#100e18"],
    ["#a6434e", "#ffffff"], ["#8f3540", "#ffffff"], ["#762b35", "#ffffff"],
    ["#d7828a", "#100e18"], ["#e39aa1", "#100e18"], ["#bd6670", "#100e18"],
    ["#8a6500", "#ffffff"], ["#735300", "#ffffff"], ["#5d4300", "#ffffff"],
    ["#d1ad75", "#100e18"], ["#dfc28c", "#100e18"], ["#b8965b", "#100e18"],
  ];
  for (const [background, foreground] of pairs) {
    assert(contrast(background, foreground) >= 4.5, `${foreground} on ${background} must meet 4.5:1`);
  }
});
