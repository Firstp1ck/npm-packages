import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startBackend } from "./helpers/backend-client.mjs";
import { LIMITS } from "../lib/backend/protocol.mjs";

test("stderr and request producers remain bounded and resume without losing essential records", { timeout: 20_000 }, async t => {
  const b = await startBackend({ t });
  await b.waitForEvent("pi.status", e => e.ready);
  assert((await b.send("prompt", { message: "__QT_WEBUI_STDERR_FLOOD__" })).ok);
  let peakRss = 0;
  const sample = async () => {
    try { const status = await readFile(`/proc/${b.child.pid}/status`, "utf8"); peakRss = Math.max(peakRss, Number(status.match(/VmRSS:\s+(\d+)/)?.[1] || 0) * 1024); } catch {}
  };
  b.pause();
  for (let i = 0; i < 10; i++) { await sample(); await delay(50); }
  const requests = Array.from({ length: 20 }, () => b.send("settings_get"));
  await delay(150);
  b.resume();
  for (const response of await Promise.all(requests)) assert(response.ok || response.error.code === "busy", JSON.stringify(response));
  await b.waitForEvent("pi.error", e => e.message.startsWith("Pi: pressure-stderr-3999"));
  assert.equal(b.events.filter(e => e.type === "pi.error" && e.message.startsWith("Pi: pressure-stderr-")).length, 4000);
  const stats = (await b.send("hello")).data.stats;
  peakRss = Math.max(peakRss, stats.peakRss);
  assert(stats.backpressurePauses > 0, JSON.stringify(stats));
  assert(stats.maxWritableLength <= LIMITS.maxTransportBytes + LIMITS.transportControlBytes, JSON.stringify({ stats, peakRss }));
  assert(stats.peakQueuedRecords <= LIMITS.maxTransportRecords + LIMITS.maxControlRequests, JSON.stringify({ stats, peakRss }));
  assert(stats.peakAdmittedWork <= LIMITS.maxPendingRequests + LIMITS.maxControlRequests);
  assert(peakRss < 512 * 1024 * 1024, JSON.stringify({ stats, peakRss }));
  t.diagnostic(JSON.stringify({ peakRss, ...stats }));
});

test("shutdown remains admitted while the output consumer is stalled", { timeout: 10_000 }, async t => {
  const b = await startBackend({ t });
  await b.waitForEvent("pi.status", event => event.ready);
  await b.send("prompt", { message: "__QT_WEBUI_FLOOD__" });
  b.pause();
  await delay(500);
  b.raw(JSON.stringify({ v: 1, id: "control-shutdown", type: "shutdown" }) + "\n");
  assert.equal((await b.waitForExit(LIMITS.shutdownGraceMs + 1500)).code, 0);
  b.resume();
});

test("a consumer that never drains exits within the slow-consumer shutdown bound", { timeout: 15_000 }, async t => {
  const b = await startBackend({ t });
  await b.waitForEvent("pi.status", e => e.ready);
  await b.send("prompt", { message: "__QT_WEBUI_FLOOD__" });
  b.pause();
  const before = Date.now();
  const exit = await b.waitForExit(LIMITS.transportDrainMs + LIMITS.shutdownGraceMs + 2000);
  assert.equal(exit.code, 75);
  assert(Date.now() - before < LIMITS.transportDrainMs + LIMITS.shutdownGraceMs + 2000);
  b.resume();
});
