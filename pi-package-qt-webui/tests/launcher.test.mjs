import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  boundedEnvironmentValue,
  detectSystemColorScheme,
  launchQtWebUi,
  parseLauncherArgs,
  prepareLaunch,
  resolvePiCliEntry,
} from "../lib/launcher.mjs";

async function makeFakePiPackage() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qt-webui-pi-"));
  await mkdir(path.join(root, "dist", "bundle"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.js"), "export {};\n");
  await writeFile(path.join(root, "dist", "bundle", "cli.js"), "#!/usr/bin/env node\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "@earendil-works/pi-coding-agent",
    bin: { pi: "dist/bundle/cli.js" },
  }));
  return root;
}

test("parseLauncherArgs supports normal and development mode only", () => {
  assert.deepEqual(parseLauncherArgs([]), { development: false });
  assert.deepEqual(parseLauncherArgs(["dev"]), { development: true });
  assert.throws(() => parseLauncherArgs(["--unknown"]), /Usage: qt-webui \[dev\]/);
  assert.throws(() => parseLauncherArgs(["dev", "extra"]), /Usage/);
});

test("detectSystemColorScheme reads the XDG portal preference", () => {
  const calls = [];
  const spawnSyncImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: "v v u 1\n" };
  };
  assert.equal(detectSystemColorScheme({ spawnSyncImpl, env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/bus" } }), "dark");
  assert.equal(calls[0].command, "busctl");
  assert.deepEqual(calls[0].args.slice(-2), ["org.freedesktop.appearance", "color-scheme"]);
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(calls[0].options.timeout, 1_500);
});

test("detectSystemColorScheme handles light, unset, malformed, and unavailable portals", () => {
  const result = (stdout, status = 0) => detectSystemColorScheme({
    spawnSyncImpl: () => ({ status, stdout }),
  });
  assert.equal(result("v v u 2\n"), "light");
  assert.equal(result("v v u 0\n"), "unknown");
  assert.equal(result("unexpected\n"), "unknown");
  assert.equal(result("v v u 1\n", 1), "unknown");
  assert.equal(detectSystemColorScheme({ spawnSyncImpl: () => { throw new Error("missing"); } }), "unknown");
});

test("resolvePiCliEntry reads the dependency-local Pi bin declaration", async (t) => {
  const dependencyRoot = await makeFakePiPackage();
  t.after(() => rm(dependencyRoot, { recursive: true, force: true }));
  const entry = resolvePiCliEntry({
    resolveDependencyUrl: () => pathToFileURL(path.join(dependencyRoot, "dist", "index.js")).href,
  });
  assert.equal(entry, path.join(dependencyRoot, "dist", "bundle", "cli.js"));
});

test("resolvePiCliEntry reports an actionable dependency error", () => {
  assert.throws(
    () => resolvePiCliEntry({ resolveDependencyUrl: () => { throw new Error("module unavailable"); } }),
    /Reinstall @firstpick\/pi-package-qt-webui.*dependencies are present.*module unavailable/,
  );
});

test("prepareLaunch passes resolved paths and caller cwd as bounded environment values", () => {
  const root = path.resolve("/tmp/qt webui package");
  const cwd = path.resolve("/tmp/project with spaces");
  const piEntry = path.resolve("/tmp/local pi/dist/bundle/cli.js");
  const launch = prepareLaunch({
    argv: ["dev"],
    cwd,
    env: {
      PATH: "/test/bin",
      QT_WEBUI_CALLER_CWD: "/inherited/wrong-cwd",
      QT_WEBUI_SMOKE_MODE: "1",
      QT_WEBUI_THEME_MODE: "dark",
      QT_WEBUI_UNDOCUMENTED: "must-not-pass",
    },
    root,
    nodeExecutable: "/usr/bin/node",
    resolvePiEntry: () => piEntry,
    detectColorScheme: () => "dark",
  });

  assert.equal(launch.command, "quickshell");
  assert.deepEqual(launch.args, ["--path", path.join(root, "qml", "shell.qml")]);
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.cwd, cwd);
  assert.equal(launch.options.stdio, "inherit");
  assert.equal(launch.options.env.QT_WEBUI_CALLER_CWD, cwd);
  assert.equal(launch.options.env.QT_WEBUI_QML_ENTRY, path.join(root, "qml", "shell.qml"));
  assert.equal(launch.options.env.QT_WEBUI_NODE_EXECUTABLE, "/usr/bin/node");
  assert.equal(launch.options.env.QT_WEBUI_PI_CLI_ENTRY, piEntry);
  assert.equal(launch.options.env.QT_WEBUI_DEVELOPMENT_MODE, "1");
  assert.equal(launch.options.env.QT_WEBUI_SYSTEM_COLOR_SCHEME, "dark");
  assert.equal(launch.options.env.PATH, "/test/bin");
  assert.equal(launch.options.env.QT_WEBUI_SMOKE_MODE, undefined);
  assert.equal(launch.options.env.QT_WEBUI_THEME_MODE, undefined);
  assert.equal(launch.options.env.QT_WEBUI_UNDOCUMENTED, undefined);
});

test("prepareLaunch exposes smoke controls only through the explicit test seam", () => {
  const base = {
    env: { QT_WEBUI_SMOKE_MODE: "inherited", PATH: "/test/bin" },
    root: "/tmp/qt-webui",
    cwd: "/tmp/project",
    nodeExecutable: "/usr/bin/node",
    resolvePiEntry: () => "/tmp/pi-cli.js",
    detectColorScheme: () => "dark",
  };
  const launch = prepareLaunch({
    ...base,
    testOnlyEnvironment: {
      QT_WEBUI_SMOKE_MODE: "1",
      QT_WEBUI_SMOKE_CAPTURE_PATH: "/tmp/capture.jsonl",
      QT_WEBUI_SMOKE_STATE_PATH: "/tmp/state.txt",
      QT_WEBUI_THEME_MODE: "dark",
    },
  });
  assert.equal(launch.options.env.QT_WEBUI_SMOKE_MODE, "1");
  assert.equal(launch.options.env.QT_WEBUI_SMOKE_CAPTURE_PATH, "/tmp/capture.jsonl");
  assert.equal(launch.options.env.QT_WEBUI_SMOKE_STATE_PATH, "/tmp/state.txt");
  assert.equal(launch.options.env.QT_WEBUI_THEME_MODE, "dark");
  assert.throws(
    () => prepareLaunch({ ...base, testOnlyEnvironment: { QT_WEBUI_UNDOCUMENTED: "1" } }),
    /Unsupported test-only environment value/,
  );
});

test("boundedEnvironmentValue rejects NUL bytes and oversized values", () => {
  assert.throws(() => boundedEnvironmentValue("QT_WEBUI_VALUE", "has\0nul"), /NUL/);
  assert.throws(() => boundedEnvironmentValue("QT_WEBUI_VALUE", "x".repeat(16 * 1024 + 1)), /byte limit/);
});

test("launchQtWebUi forwards SIGTERM and propagates the conventional exit code", async () => {
  const signalSource = new EventEmitter();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const forwarded = [];
  child.kill = (signal) => {
    forwarded.push(signal);
    child.signalCode = signal;
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };

  const result = launchQtWebUi({
    argv: [],
    cwd: "/tmp",
    env: {},
    root: "/tmp/qt-webui",
    nodeExecutable: "/usr/bin/node",
    resolvePiEntry: () => "/tmp/pi-cli.js",
    spawnImpl: (command, args, options) => {
      assert.equal(command, "quickshell");
      assert.deepEqual(args, ["--path", "/tmp/qt-webui/qml/shell.qml"]);
      assert.equal(options.shell, false);
      return child;
    },
    signalSource,
  });
  signalSource.emit("SIGTERM");
  assert.equal(await result, 143);
  assert.deepEqual(forwarded, ["SIGTERM"]);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
});

test("launchQtWebUi propagates Quickshell exit codes", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  const result = launchQtWebUi({
    resolvePiEntry: () => "/tmp/pi-cli.js",
    spawnImpl: () => {
      queueMicrotask(() => child.emit("close", 23, null));
      return child;
    },
    signalSource: new EventEmitter(),
  });
  assert.equal(await result, 23);
});

test("launchQtWebUi reports an actionable Quickshell lookup failure", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  const result = launchQtWebUi({
    resolvePiEntry: () => "/tmp/pi-cli.js",
    spawnImpl: () => {
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn quickshell ENOENT"), { code: "ENOENT" })));
      return child;
    },
    signalSource: new EventEmitter(),
  });
  await assert.rejects(result, /Install Quickshell 0\.3 or newer.*on PATH.*ENOENT/);
});
