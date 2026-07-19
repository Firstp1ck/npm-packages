import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

test("untracked replacement between lstat and open fails the bounded hash safely", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aur-review-hash-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "AUR Review Test");
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-qm", "initial");

  const target = path.join(root, "untracked.txt");
  const replacement = path.join(root, "replacement.txt");
  await writeFile(target, "original\n");
  await writeFile(replacement, "replacement\n");

  const originalOpen = fs.promises.open;
  let armed = true;
  fs.promises.open = async (candidate, ...args) => {
    if (armed && path.resolve(String(candidate)) === target) {
      armed = false;
      await rename(replacement, target);
    }
    return await originalOpen.call(fs.promises, candidate, ...args);
  };
  syncBuiltinESMExports();
  try {
    const { captureGitSnapshot } = await import("../src/git.ts");
    await assert.rejects(() => captureGitSnapshot(root), /Untracked path changed while snapshotting: untracked\.txt/);
    assert.equal(armed, false, "test hook must replace the file after lstat and before open");
  } finally {
    fs.promises.open = originalOpen;
    syncBuiltinESMExports();
  }
});
