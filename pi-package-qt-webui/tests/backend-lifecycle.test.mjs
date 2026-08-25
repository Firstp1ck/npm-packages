import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS } from "../lib/backend/protocol.mjs";
import { processAlive, startBackend, waitUntil } from "./helpers/backend-client.mjs";

const REAP_BOUND_MS = LIMITS.shutdownGraceMs + 2_000;

async function backendWithGrandchild(t) {
  const backend = await startBackend({ startupTimeoutMs: 1_000 });
  t.after(async () => {
    if (!backend.exit) {
      backend.child.kill("SIGKILL");
      await backend.exitPromise;
    }
  });
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  const started = await backend.waitForEvent("pi.started");
  await backend.send("prompt", { message: "__QT_WEBUI_GRANDCHILD__" });
  const render = await backend.waitForEvent("part.render", (event) => /^grandchild \d+$/.test(event.text));
  const grandchildPid = Number(render.text.split(" ")[1]);
  assert(processAlive(started.pid), "Pi fixture should be running");
  assert(processAlive(grandchildPid), "grandchild should be running");
  return { backend, piPid: started.pid, grandchildPid };
}

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
  const backend = await startBackend({ smoke: false, startupTimeoutMs: 1_000 });
  t.after(async () => {
    if (!backend.exit) {
      backend.child.kill("SIGKILL");
      await backend.exitPromise;
    }
  });
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  const refused = await backend.send("debug_crash");
  assert.equal(refused.error.code, "unknown_request");
  backend.closeStdin();
  await backend.exitPromise;

  const broken = await startBackend({ env: { QT_WEBUI_PI_CLI_ENTRY: "relative/pi.js" } });
  const exit = await broken.exitPromise;
  assert.equal(exit.code, 64);
  assert(broken.events.some((event) => event.type === "backend.fatal" && /absolute path/.test(event.message)));
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
