import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireInstallLock, releaseInstallLock } from "../lib/update/journal.mjs";

if (process.argv[2] === "--contender") {
  const root = process.argv[3];
  const holdMs = Number.parseInt(process.argv[4], 10);
  try {
    const lock = await acquireInstallLock(root);
    process.stdout.write("acquired\n");
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    await releaseInstallLock(lock);
    process.exit(0);
  } catch (error) {
    process.stdout.write(`${error.code || "error"}\n`);
    process.exit(error.code === "UPDATE_LOCKED" ? 2 : 3);
  }
}

function contender(root, holdMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--contender", root, String(holdMs)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => resolve({ code, output }));
  });
}

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-lock-process-"));
try {
  const firstPromise = contender(root, 700);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = await contender(root, 0);
  const first = await firstPromise;
  assert.equal(first.code, 0, first.output);
  assert.equal(second.code, 2, second.output);
  assert.match(second.output, /UPDATE_LOCKED/);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("update lock multiprocess harness passed");
