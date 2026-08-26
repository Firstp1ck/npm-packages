import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  launchQtWebUiDetached,
  registerQtWebUiStartCommand,
} from "../extensions/qt-webui-start.mjs";

function registerCommand(launch) {
  let registration;
  registerQtWebUiStartCommand({
    registerCommand(name, options) {
      registration = { name, options };
    },
  }, { launch });
  return registration;
}

function commandContext(cwd = "/tmp/project") {
  const notifications = [];
  return {
    context: {
      cwd,
      ui: {
        notify(message, level) {
          notifications.push({ message, level });
        },
      },
    },
    notifications,
  };
}

test("Pi extension registers /qt-webui-start and launches the current working directory", async () => {
  const launches = [];
  const registration = registerCommand(async (options) => {
    launches.push(options);
    return { pid: 4321 };
  });
  const { context, notifications } = commandContext("/tmp/project with spaces");

  assert.equal(registration.name, "qt-webui-start");
  assert.equal(registration.options.description, "Start Qt WebUI for the current working directory");
  await registration.options.handler("", context);

  assert.deepEqual(launches, [{ cwd: "/tmp/project with spaces" }]);
  assert.deepEqual(notifications, [{
    message: "Started Qt WebUI for /tmp/project with spaces",
    level: "info",
  }]);
});

test("Pi extension rejects arguments and reports launch failures without starting an agent turn", async () => {
  let launches = 0;
  const registration = registerCommand(async () => {
    launches += 1;
    throw new Error("quickshell was not found");
  });

  const invalid = commandContext();
  await registration.options.handler("unexpected", invalid.context);
  assert.equal(launches, 0);
  assert.deepEqual(invalid.notifications, [{ message: "Usage: /qt-webui-start", level: "warning" }]);

  const failed = commandContext();
  await registration.options.handler("", failed.context);
  assert.equal(launches, 1);
  assert.deepEqual(failed.notifications, [{
    message: "Could not start Qt WebUI: quickshell was not found",
    level: "error",
  }]);
});

test("detached launch reuses the canonical launcher preparation and releases the child", async () => {
  const calls = [];
  let unrefCount = 0;
  const child = new EventEmitter();
  child.pid = 2468;
  child.unref = () => { unrefCount += 1; };

  const resultPromise = launchQtWebUiDetached({
    cwd: "/tmp/workspace",
    prepareLaunchImpl: ({ cwd }) => {
      assert.equal(cwd, "/tmp/workspace");
      return {
        command: "quickshell",
        args: ["--path", "/pkg/qml/shell.qml"],
        options: { cwd, env: { TEST: "1" }, shell: false, stdio: "inherit" },
      };
    },
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });

  assert.deepEqual(await resultPromise, { pid: 2468 });
  assert.equal(unrefCount, 1);
  assert.deepEqual(calls, [{
    command: "quickshell",
    args: ["--path", "/pkg/qml/shell.qml"],
    options: {
      cwd: "/tmp/workspace",
      env: { TEST: "1" },
      shell: false,
      stdio: "ignore",
      detached: true,
    },
  }]);
});

test("detached launch rejects when the GUI process cannot be spawned", async () => {
  const child = new EventEmitter();
  child.unref = () => assert.fail("failed child must not be detached from error handling");

  const launch = launchQtWebUiDetached({
    cwd: "/tmp/workspace",
    prepareLaunchImpl: () => ({ command: "quickshell", args: [], options: {} }),
    spawnImpl: () => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    },
  });

  await assert.rejects(launch, /ENOENT/);
});
