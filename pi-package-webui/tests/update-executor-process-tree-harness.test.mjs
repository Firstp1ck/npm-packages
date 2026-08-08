import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { executeCommand } from "../lib/update/executor.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-update-tree-"));
const sentinel = path.join(root, "descendant-sentinel.txt");
const fixture = fileURLToPath(new URL("./fixtures/update/tree-timeout-parent.mjs", import.meta.url));
try {
  const result = await executeCommand(process.execPath, [fixture, sentinel], { timeoutMs: 300, closeTimeoutMs: 5_000 });
  assert.equal(result.timedOut, true);
  assert.equal(result.closureTimedOut, false, `timed-out command should close after tree termination: ${JSON.stringify(result)}`);
  assert.deepEqual(result.args, [fixture, sentinel], "executor preserves argument arrays");
  await delay(1_100);
  await assert.rejects(access(sentinel), { code: "ENOENT" }, "a timed-out descendant must not survive to write its delayed sentinel");
  console.log("update-executor-process-tree-harness.test.mjs passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
