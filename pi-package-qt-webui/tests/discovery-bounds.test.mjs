import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { createSessionCatalog, sessionDirectoryFor } from "../lib/backend/sessions-index.mjs";
import { loadPersistedSessionSnapshot, snapshotLoadDiagnostics } from "../lib/backend/session-sync.mjs";
import { LIMITS } from "../lib/backend/protocol.mjs";

async function root(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "qt-discovery-bounds-")); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
const header = id => JSON.stringify({ type: "session", version: 3, id, cwd: "/workspace", timestamp: "2026-01-01T00:00:00Z" }) + "\n";

test("catalog cursor keeps page membership stable across recency changes and invalidation", async t => {
  const directory = await root(t), env = { PI_CODING_AGENT_DIR: directory };
  const project = sessionDirectoryFor("/workspace", env);
  await fs.mkdir(project, { recursive: true });
  for (let i = 0; i < 201; i++) {
    const file = path.join(project, `${i}.jsonl`);
    await fs.writeFile(file, header(String(i)));
    await fs.utimes(file, new Date(100000 + i), new Date(100000 + i));
  }
  let clock = Date.now();
  const catalog = createSessionCatalog({ env, clock: () => clock });
  const first = await catalog.list("/workspace");
  const before = catalog.diagnostics();
  await fs.utimes(path.join(project, "0.jsonl"), new Date(), new Date());
  catalog.invalidate();
  const second = await catalog.list("/workspace", { cursor: first.cursor });
  assert.equal(new Set([...first.sessions, ...second.sessions].map(row => row.id)).size, 201);
  assert.equal(second.sessions[0].id, "0");
  assert.deepEqual(catalog.diagnostics(), before, "paging does not rescan or mutate the snapshot");
  clock += LIMITS.catalogCursorMs + 1;
  await assert.rejects(catalog.list("/workspace", { cursor: first.cursor }), { code: "stale_request" });
});

test("synthetic catalog bounds discovery, retention, cache, and wall time", { timeout: 30_000 }, async t => {
  const directory = await root(t), env = { PI_CODING_AGENT_DIR: directory };
  const project = sessionDirectoryFor("/workspace", env);
  await fs.mkdir(project, { recursive: true });
  for (let start = 0; start < LIMITS.maxCatalogCandidates + 20; start += 64) {
    await Promise.all(Array.from({ length: 64 }, (_, i) => fs.writeFile(path.join(project, `${start + i}.jsonl`), header(String(start + i)))));
  }
  const catalog = createSessionCatalog({ env });
  let page = await catalog.list("/workspace");
  let rows = page.sessions.length;
  assert(page.truncated);
  while (page.cursor) { page = await catalog.list("/workspace", { cursor: page.cursor }); rows += page.sessions.length; }
  const stats = catalog.diagnostics();
  assert(rows <= LIMITS.maxCatalogRows, JSON.stringify(stats));
  assert(stats.visited <= LIMITS.maxCatalogCandidates && stats.retainedBytes <= LIMITS.maxCatalogBytes && stats.readBytes <= LIMITS.maxCatalogReadBytes, JSON.stringify(stats));
  assert(stats.cacheEntries <= LIMITS.maxCatalogCacheEntries && stats.cacheBytes <= LIMITS.maxCatalogCacheBytes, JSON.stringify(stats));
  assert(stats.durationMs < LIMITS.catalogScanMs + 500, JSON.stringify(stats));
  assert(stats.peakRss < 512 * 1024 * 1024, JSON.stringify(stats));
  t.diagnostic(JSON.stringify(stats));
});

test("oversized concurrent snapshots retain the source within aggregate reservation limits", { timeout: 20_000 }, async t => {
  const directory = await root(t), file = path.join(directory, "large.jsonl");
  await fs.writeFile(file, header("oversized"));
  await fs.truncate(file, LIMITS.maxSnapshotInputBytes + 1);
  let peakRss = process.memoryUsage().rss;
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  t.after(() => clearInterval(sample));
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => loadPersistedSessionSnapshot(file, { temporaryRoot: directory })));
  for (const outcome of outcomes) { assert.equal(outcome.status, "rejected"); assert.equal(outcome.reason.code, "limit_exceeded"); }
  assert.equal((await fs.stat(file)).size, LIMITS.maxSnapshotInputBytes + 1);
  for (let i = 0; snapshotLoadDiagnostics().active && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(snapshotLoadDiagnostics().active, 0);
  assert.equal((await fs.readdir(directory)).filter(name => name.startsWith("qt-webui-session-snapshot-")).length, 0);
  const diagnostics = snapshotLoadDiagnostics();
  peakRss = Math.max(peakRss, diagnostics.peakRss);
  assert(diagnostics.peakReservedBytes <= LIMITS.maxConcurrentSnapshotLoads * LIMITS.maxSnapshotInputBytes);
  assert(peakRss < 768 * 1024 * 1024, JSON.stringify({ peakRss, diagnostics }));
  t.diagnostic(JSON.stringify({ ...diagnostics, peakRss }));
});

test("snapshot deadlines terminate stuck workers and obsolete queued work never starts", { timeout: 10_000 }, async t => {
  const directory = await root(t), file = path.join(directory, "valid.jsonl");
  await fs.writeFile(file, header("valid"));
  const original = await fs.readFile(file, "utf8");
  const options = { workerUrl: new URL("./fixtures/snapshot-hang.mjs", import.meta.url), timeoutMs: 200, temporaryRoot: directory };
  const first = loadPersistedSessionSnapshot(file, options);
  const second = loadPersistedSessionSnapshot(file, options);
  let current = true;
  const queued = loadPersistedSessionSnapshot(file, { isCurrent: () => current, temporaryRoot: directory });
  current = false;
  const result = await Promise.allSettled([first, second, queued]);
  assert.deepEqual(result.map(entry => entry.reason?.code), ["timeout", "timeout", "stale_request"]);
  for (let i = 0; snapshotLoadDiagnostics().active && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(snapshotLoadDiagnostics().active, 0);
  assert.equal(await fs.readFile(file, "utf8"), original);
  assert.deepEqual(await fs.readdir(directory), ["valid.jsonl"]);
  assert.equal((await loadPersistedSessionSnapshot(file, { temporaryRoot: directory })).sessionId, "valid", "a valid revision can retry immediately");
});

test("byte-counted snapshot reads reject growth after stat without truncating the source", async t => {
  const directory = await root(t), file = path.join(directory, "growing.jsonl");
  const original = header("growing");
  await fs.writeFile(file, original);
  const filesystem = { ...fs, async open(...args) {
    const fd = await fs.open(...args);
    let grew = false;
    return { close: () => fd.close(), async read(...readArgs) {
      const result = await fd.read(...readArgs);
      if (!grew) { grew = true; await fs.appendFile(file, Buffer.alloc(LIMITS.maxSnapshotInputBytes, 32)); }
      return result;
    } };
  } };
  await assert.rejects(loadPersistedSessionSnapshot(file, { filesystem }), { code: "limit_exceeded" });
  assert.equal((await fs.stat(file)).size, Buffer.byteLength(original) + LIMITS.maxSnapshotInputBytes);
});
