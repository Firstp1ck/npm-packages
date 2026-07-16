import assert from "node:assert/strict";
import {
  classifyGitPathFailure,
  classifyWindowsReservedGitPath,
  findWindowsReservedGitPath,
  windowsReservedGitPathFailure,
} from "../lib/git-command-errors.mjs";

assert.deepEqual(classifyWindowsReservedGitPath("NUL"), {
  path: "NUL",
  component: "NUL",
  deviceName: "NUL",
});
assert.deepEqual(classifyWindowsReservedGitPath("nested/aux.txt"), {
  path: "nested/aux.txt",
  component: "aux.txt",
  deviceName: "AUX",
});
assert.equal(classifyWindowsReservedGitPath("frontend/null-state.ts"), null);
assert.equal(classifyWindowsReservedGitPath("COM10.log"), null);
assert.equal(findWindowsReservedGitPath(["normal.txt", "nested/LPT1.log", "later.txt"])?.path, "nested/LPT1.log");
assert.equal(findWindowsReservedGitPath("normal.txt\0folder/PRN\0")?.path, "folder/PRN");

const exactFailure = classifyGitPathFailure({
  exitCode: 128,
  stderr: [
    "error: short read while indexing NUL",
    "error: NUL: failed to insert into database",
    "error: unable to index file 'NUL'",
    "fatal: adding files failed",
  ].join("\n"),
});
assert.equal(exactFailure?.code, "INVALID_WORKTREE_PATH");
assert.equal(exactFailure?.error, 'Git cannot index the Windows-reserved path "NUL".');
assert.match(exactFailure?.hint || "", /Delete or rename "NUL"/);
assert.match(exactFailure?.hint || "", /earlier failed git add may already have staged files/);

assert.equal(classifyGitPathFailure({ exitCode: 128, stderr: "fatal: not a git repository" }), null);
assert.equal(classifyGitPathFailure({ exitCode: 1, stderr: "error: unable to index file 'ordinary.txt'" }), null);
assert.equal(windowsReservedGitPathFailure("ordinary.txt"), null);

console.log("git command error tests passed");
