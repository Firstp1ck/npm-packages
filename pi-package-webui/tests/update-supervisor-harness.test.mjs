import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listenWithRetry,
  managedRuntimePaths,
  probeCandidateRuntime,
  readRuntimePointer,
  rollbackRuntimePointer,
  switchRuntimePointer,
  writeRuntimePointer,
} from "../lib/update/supervisor.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-supervisor-"));
try {
  const paths = managedRuntimePaths(root);
  const makeRuntime = async (name, version) => {
    const runtimeRoot = path.join(paths.runtimesDir, name);
    const serverEntry = path.join(runtimeRoot, "bin", "pi-webui.mjs");
    await mkdir(path.dirname(serverEntry), { recursive: true });
    await writeFile(serverEntry, `if (process.argv[2] === "--candidate-probe") console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)},piVersion:"9.9.9"}));\n`, "utf8");
    return { runtimeRoot, serverEntry, version };
  };
  const first = await makeRuntime("first", "1.0.0");
  const second = await makeRuntime("second", "2.0.0");
  await switchRuntimePointer(root, first);
  assert.equal((await readRuntimePointer(root, "current")).version, "1.0.0");
  const bootstrapRollback = await rollbackRuntimePointer(root);
  assert.equal(bootstrapRollback.bootstrapFallback, true, "the first failed managed activation must fall back to the installed bootstrap");
  assert.equal(await readRuntimePointer(root, "current"), null);
  await switchRuntimePointer(root, first);
  await switchRuntimePointer(root, second);
  assert.equal((await readRuntimePointer(root, "current")).version, "2.0.0");
  assert.equal((await readRuntimePointer(root, "previous")).version, "1.0.0");
  await rollbackRuntimePointer(root);
  assert.equal((await readRuntimePointer(root, "current")).version, "1.0.0");
  await assert.rejects(() => writeRuntimePointer(root, "current", { runtimeRoot: path.join(root, "escape"), serverEntry: path.join(root, "escape", "server.mjs"), version: "3.0.0" }), /escapes/);
  const probe = await probeCandidateRuntime(second.serverEntry, { expectedVersion: "2.0.0", expectedPiVersion: "9.9.9" });
  assert.equal(probe.ok, true);
  assert.equal((await probeCandidateRuntime(second.serverEntry, { expectedVersion: "2.0.0", expectedPiVersion: "8.8.8" })).ok, false);
  const wrongProbe = await probeCandidateRuntime(second.serverEntry, { expectedVersion: "9.0.0" });
  assert.equal(wrongProbe.ok, false);

  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const port = occupied.address().port;
  const replacement = createServer((_req, res) => res.end("ok"));
  setTimeout(() => occupied.close(), 180);
  const attempt = await listenWithRetry(replacement, { port, host: "127.0.0.1", attempts: 6, initialDelayMs: 50 });
  assert.ok(attempt > 1, "EADDRINUSE startup should retry with bounded backoff");
  await new Promise((resolve) => replacement.close(resolve));
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("update supervisor harness passed");
