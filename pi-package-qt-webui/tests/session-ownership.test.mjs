import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTabRegistry } from "../lib/backend/tabs.mjs";

async function harness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "qt-ownership-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = path.join(root, "a.jsonl"), b = path.join(root, "b.jsonl"), alias = path.join(root, "alias.jsonl");
  await writeFile(a, "{}\n"); await writeFile(b, "{}\n"); await symlink(a, alias);
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let switches = 0;
  const registry = createTabRegistry({ callerCwd: root, emit() {}, state: { saveTabs() {} }, createSession: ({ emit }) => {
    const runtime = { sessionFile: "" };
    return {
      child: null, start() { emit("pi.status", { ready: true }); },
      snapshot: () => ({ ready: true, active: false, pendingDialogs: 0, runtime }),
      async switchSession(file) { switches++; await barrier; runtime.sessionFile = file; emit("pi.runtime", { sessionFile: file }); return {}; },
      async newSession() { return {}; }, async restart() { return {}; }, async stop() {},
    };
  } });
  return { registry, root, a, b, alias, release, get switches() { return switches; } };
}

test("startup resume reserves mutation and canonical identity synchronously", async t => {
  const h = await harness(t);
  const tab = h.registry.open({ sessionPath: h.a });
  assert(h.registry.isPreparingMutation(tab.id));
  assert.equal(h.switches, 1);
  assert.equal(h.registry.ownerOf(h.alias), tab);
  assert.equal(h.registry.open({ sessionPath: h.alias }), tab, "concurrent alias open reuses reserved owner");
  assert.equal(h.registry.size, 1);
  for (const operation of [() => h.registry.reserveMutation(tab.id), () => h.registry.newSession(tab.id), () => h.registry.restart(tab.id), () => h.registry.switchSession(tab.id, h.b)]) assert.throws(operation, { code: "busy" });
  h.release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.registry.isPreparingMutation(tab.id), false);
  assert.equal(h.registry.ownerOf(h.a), tab);
  const other = h.registry.open();
  await assert.rejects(h.registry.switchSession(other.id, h.alias), { code: "busy" });
  assert.equal(h.registry.isPreparingMutation(other.id), false, "failed claim releases mutation");
  await h.registry.close(tab.id);
  assert.equal(h.registry.ownerOf(h.alias), null);
  assert.notEqual(h.registry.open({ sessionPath: h.alias }).id, tab.id);
});

test("closing retains canonical ownership until process cleanup settles", async t => {
  const h = await harness(t);
  h.release();
  const tab = h.registry.open({ sessionPath: h.a });
  await new Promise(resolve => setImmediate(resolve));
  let finish;
  tab.session.stop = () => new Promise(resolve => { finish = resolve; });
  const closed = h.registry.close(tab.id);
  assert.equal(h.registry.ownerOf(h.alias), tab);
  assert.throws(() => h.registry.open({ sessionPath: h.alias }), { code: "busy" });
  finish(); await closed;
  assert.equal(h.registry.ownerOf(h.alias), null);
});

test("mutation release is idempotent and closes cannot leak identity reservations", async t => {
  const h = await harness(t);
  const tab = h.registry.open();
  const lease = h.registry.reserveMutation(tab.id);
  assert(h.registry.isPreparingMutation(tab.id));
  await lease.run(() => h.registry.newSession(tab.id));
  lease.release(); lease.release();
  assert(!h.registry.isPreparingMutation(tab.id));
  const switching = h.registry.switchSession(tab.id, h.a);
  assert.equal(h.registry.ownerOf(h.alias), tab);
  await h.registry.close(tab.id, { force: true });
  h.release();
  await assert.rejects(switching, { code: "stale_request" });
  assert.equal(h.registry.ownerOf(h.a), null);
});
