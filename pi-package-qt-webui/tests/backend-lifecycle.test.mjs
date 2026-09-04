import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { LIMITS } from "../lib/backend/protocol.mjs";
import { processAlive, startBackend, waitUntil } from "./helpers/backend-client.mjs";

const REAP_BOUND_MS = LIMITS.shutdownGraceMs + 2_000;
const INVALID_ENTRY_EXIT_MS = 3_000;

async function isolatedDesktopCommands(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "qt-webui-desktop-fixture-"));
  const bin = path.join(temporary, "bin");
  const markers = path.join(temporary, "markers");
  await Promise.all([mkdir(bin), mkdir(markers)]);
  const fixture = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import path from "node:path";
const command = path.basename(process.argv[1]);
writeFileSync(path.join(process.env.QT_WEBUI_TEST_DESKTOP_MARKERS, command), JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }));
if (command === "gdbus") setInterval(() => {}, 60_000);
`;
  await Promise.all(["busctl", "gdbus"].map((command) => writeFile(path.join(bin, command), fixture, { mode: 0o700 })));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return {
    markers,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(temporary, "isolated-bus")}`,
      QT_WEBUI_TEST_DESKTOP_MARKERS: markers,
    },
  };
}

async function backendWithGrandchild(t) {
  const backend = await startBackend({ t, startupTimeoutMs: 1_000 });
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  const started = await backend.waitForEvent("pi.started");
  await backend.send("prompt", { message: "__QT_WEBUI_GRANDCHILD__" });
  const render = await backend.waitForEvent("part.render", (event) => /^grandchild \d+$/.test(event.text));
  const grandchildPid = Number(render.text.split(" ")[1]);
  assert(processAlive(started.pid), "Pi fixture should be running");
  assert(processAlive(grandchildPid), "grandchild should be running");
  return { backend, piPid: started.pid, grandchildPid };
}

test("smoke backend tests do not invoke desktop portal commands", { timeout: 20_000 }, async (t) => {
  const desktop = await isolatedDesktopCommands(t);
  const backend = await startBackend({ t, env: desktop.env, startupTimeoutMs: 1_000 });

  await backend.waitForEvent("backend.ready");
  await delay(100);
  assert.deepEqual(await readdir(desktop.markers), []);
  backend.closeStdin();
  assert.deepEqual(await backend.exitPromise, { code: 0, signal: null });
});

test("an abruptly killed backend cannot orphan its isolated portal monitor", { timeout: 20_000 }, async (t) => {
  const desktop = await isolatedDesktopCommands(t);
  const backend = await startBackend({ t, smoke: false, env: desktop.env, startupTimeoutMs: 1_000 });
  let monitorPid = null;
  t.after(() => {
    if (monitorPid && processAlive(monitorPid)) process.kill(monitorPid, "SIGKILL");
  });

  const started = await backend.waitForEvent("pi.started");
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  const marker = path.join(desktop.markers, "gdbus");
  await waitUntil(() => existsSync(marker), { timeoutMs: 2_000, description: "isolated gdbus monitor start" });
  const captured = JSON.parse(await readFile(marker, "utf8"));
  monitorPid = captured.pid;
  assert.deepEqual(captured.args, [
    "monitor",
    "--session",
    "--dest",
    "org.freedesktop.portal.Desktop",
    "--object-path",
    "/org/freedesktop/portal/desktop",
  ]);
  assert(processAlive(monitorPid));

  // Kill only the backend PID, not its process group. The monitor must still receive the
  // parent-death signal and exit instead of being reparented to PID 1.
  backend.child.kill("SIGKILL");
  assert.equal((await backend.exitPromise).signal, "SIGKILL");
  await waitUntil(() => !processAlive(monitorPid), { timeoutMs: REAP_BOUND_MS, description: "isolated gdbus monitor reaped after direct parent death" });
  await waitUntil(() => !processAlive(started.pid), { timeoutMs: REAP_BOUND_MS, description: "Pi exits on backend EOF" });
});

test("closing stdin (Quickshell exit) terminates and reaps Pi and its children within the shutdown bound", { timeout: 20_000 }, async (t) => {
  const { backend, piPid, grandchildPid } = await backendWithGrandchild(t);
  const started = Date.now();
  backend.closeStdin();
  const exit = await backend.exitPromise;
  assert.deepEqual(exit, { code: 0, signal: null });
  await waitUntil(() => !processAlive(piPid) && !processAlive(grandchildPid), { timeoutMs: REAP_BOUND_MS, description: "Pi tree reaped" });
  assert(Date.now() - started < REAP_BOUND_MS);
  assert(backend.events.some((event) => event.type === "backend.closing" && event.reason === "stdin closed"));
});

test("SIGTERM and SIGINT produce conventional exit codes and reap the Pi tree", { timeout: 30_000 }, async (t) => {
  for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]]) {
    const { backend, piPid, grandchildPid } = await backendWithGrandchild(t);
    backend.kill(signal);
    const exit = await backend.exitPromise;
    assert.deepEqual(exit, { code, signal: null }, signal);
    await waitUntil(() => !processAlive(piPid) && !processAlive(grandchildPid), { timeoutMs: REAP_BOUND_MS, description: `${signal} reaped tree` });
  }
});

test("an abruptly killed backend leaves Pi to notice EOF and stop its own children", { timeout: 20_000 }, async (t) => {
  const { backend, piPid, grandchildPid } = await backendWithGrandchild(t);
  backend.kill("SIGKILL");
  const exit = await backend.exitPromise;
  assert.equal(exit.signal, "SIGKILL");
  await waitUntil(() => !processAlive(piPid), { timeoutMs: REAP_BOUND_MS, description: "Pi exits on EOF" });
  await waitUntil(() => !processAlive(grandchildPid), { timeoutMs: REAP_BOUND_MS, description: "Pi stops its tool child" });
});

test("a fatal backend error reports itself, kills the Pi tree, and exits non-zero", { timeout: 20_000 }, async (t) => {
  const { backend, piPid, grandchildPid } = await backendWithGrandchild(t);
  const crash = await backend.send("debug_crash").catch((error) => ({ rejected: error.message }));
  assert(crash.data?.crashing === true || crash.rejected, JSON.stringify(crash));
  const exit = await backend.exitPromise;
  assert.equal(exit.code, 70);
  assert(backend.events.some((event) => event.type === "backend.fatal" && /deterministic backend crash/.test(event.message)));
  await waitUntil(() => !processAlive(piPid) && !processAlive(grandchildPid), { timeoutMs: REAP_BOUND_MS, description: "tree killed after fatal" });
});

test("debug_crash is refused outside smoke mode and a missing Pi entry fails fast", { timeout: 20_000 }, async (t) => {
  const desktop = await isolatedDesktopCommands(t);
  const backend = await startBackend({ t, smoke: false, env: desktop.env, startupTimeoutMs: 1_000 });
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  const refused = await backend.send("debug_crash");
  assert.equal(refused.error.code, "unknown_request");
  backend.closeStdin();
  await backend.exitPromise;

  const broken = await startBackend({ t, piCliEntry: "relative/pi.js" });
  const exit = await broken.waitForExit(INVALID_ENTRY_EXIT_MS);
  assert.equal(exit.code, 64);
  assert(broken.events.some((event) => event.type === "backend.fatal" && /absolute path/.test(event.message)));
  assert(!broken.events.some((event) => event.type === "pi.started"));
  assert.deepEqual(await broken.readCapture(), []);
});

test("generic environment cannot replace the protected Pi fixture entry", { timeout: 10_000 }, async (t) => {
  const backend = await startBackend({ t, env: { QT_WEBUI_PI_CLI_ENTRY: "relative/pi.js" } });
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  await assert.rejects(backend.waitForExit(20), /timed out waiting for backend exit.*\nevents:.*pi.started.*\nstderr:/s);
  const started = await backend.waitForEvent("pi.started");
  backend.closeStdin();
  assert.equal((await backend.waitForExit()).code, 0);
  await waitUntil(() => !processAlive(started.pid), { description: `fixture ${started.pid} exits` });
});

test("spontaneous Pi leader exit sweeps its retained group before replacement", { timeout: 20_000 }, async (t) => {
  const { backend, piPid, grandchildPid } = await backendWithGrandchild(t);
  process.kill(piPid, "SIGKILL");
  await backend.waitForEvent("pi.exit");
  const before = backend.events.filter(event => event.type === "pi.started").length;
  const restart = await backend.send("restart");
  assert.equal(restart.ok, true, JSON.stringify(restart));
  const started = await backend.waitForEvent("pi.started", event => event.pid !== piPid);
  await waitUntil(() => !processAlive(grandchildPid), { timeoutMs: REAP_BOUND_MS, description: `old Pi ${piPid} tool ${grandchildPid} gone before replacement ${started.pid}` });
  assert.equal(backend.events.filter(event => event.type === "pi.started").length, before + 1);
  assert.equal((await backend.send("hello")).ok, true);
});

test("restarting Pi terminates the previous tree before starting a new child", { timeout: 20_000 }, async (t) => {
  const { backend, piPid, grandchildPid } = await backendWithGrandchild(t);
  const restart = await backend.send("restart");
  assert.equal(restart.ok, true);
  const started = await backend.waitForEvent("pi.started", (event) => event.pid !== piPid);
  await waitUntil(() => !processAlive(piPid) && !processAlive(grandchildPid), { timeoutMs: REAP_BOUND_MS, description: "old tree reaped" });
  assert(processAlive(started.pid));
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready" && event.seq > started.seq);
  backend.closeStdin();
  await backend.exitPromise;
  await waitUntil(() => !processAlive(started.pid), { timeoutMs: REAP_BOUND_MS, description: "new tree reaped" });
});
