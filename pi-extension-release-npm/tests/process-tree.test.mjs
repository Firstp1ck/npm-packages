import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { terminateProcessTree } from "../process-tree.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function killDirectly(pid) {
  if (!isProcessRunning(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Best-effort fixture cleanup.
  }
}

const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-release-npm-tree-"));
let parent;
let childPid = 0;
try {
  await writeFile(path.join(cwd, "child.mjs"), "setInterval(() => {}, 1000);\n");
  await writeFile(path.join(cwd, "parent.mjs"), [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "const childPath = fileURLToPath(new URL('./child.mjs', import.meta.url));",
    "const child = spawn(process.execPath, [childPath], { stdio: 'ignore', windowsHide: true });",
    "writeFileSync('child.pid', `${child.pid}\\n`);",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"));

  parent = spawn(process.execPath, [path.join(cwd, "parent.mjs")], {
    cwd,
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
  });

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      childPid = Number.parseInt((await readFile(path.join(cwd, "child.pid"), "utf8")).trim(), 10);
    } catch {
      childPid = 0;
    }
    if (isProcessRunning(childPid)) break;
    await delay(100);
  }
  assert.equal(isProcessRunning(childPid), true, "fixture descendant should be running before abort");
  assert.equal(terminateProcessTree(parent, "SIGINT"), true, "release abort should start process-tree termination");

  for (let attempt = 0; attempt < 80; attempt++) {
    if (!isProcessRunning(childPid) && (parent.exitCode !== null || parent.signalCode !== null)) break;
    await delay(100);
  }
  const descendantStopped = !isProcessRunning(childPid);
  assert.equal(descendantStopped, true, "release abort must terminate the shell script's descendants");

  const indexSource = await readFile(path.join(root, "index.ts"), "utf8");
  assert.match(indexSource, /terminateProcessTree\(child, "SIGINT"\)/, "release Abort must use process-tree termination");
  console.log("process-tree.test.mjs passed");
} finally {
  if (parent && parent.exitCode === null && parent.signalCode === null) terminateProcessTree(parent, "SIGKILL");
  killDirectly(childPid);
  await rm(cwd, { recursive: true, force: true });
}
