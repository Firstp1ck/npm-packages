// Unit tests for the porcelain=2 status parser and fixture-repo tests for
// git operation detection and snapshot truncation.
//
// Run with:
//   node --test pi-extension-git-footer-status/tests/git-snapshot.test.mjs
//
// Uses Node type stripping for ../index.ts (Node >= 22.18). Runtime package
// imports are stubbed as virtual modules like in stale-ctx.test.mjs, except
// pathExists, which detectGitOperation needs for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const envFlag = (name, fallback) => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw);
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@firstpick/pi-utils") return { url: "virtual:pi-utils", shortCircuit: true };
    if (specifier === "@earendil-works/pi-tui") return { url: "virtual:pi-tui", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "virtual:pi-utils") {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          import { access } from "node:fs/promises";
          export const collectInitialPromptCalibration = () => null;
          export const createInitialPromptEstimateService = () => ({
            refresh: async () => ({ status: "ok" }),
            getSnapshot: () => null,
            getFallbackSnapshot: () => null,
            clear: () => {},
          });
          export const envFlag = ${envFlag.toString()};
          export const estimateStableInitialPromptFromPiContext = async () => null;
          export const estimateTokensFromCharCount = (chars) => Math.ceil(chars / 4);
          export const formatTokens = (n) => String(n);
          export const formatUserPath = (p) => String(p);
          export const pathExists = (p) => access(p).then(() => true, () => false);
        `,
      };
    }
    if (url === "virtual:pi-tui") {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export class Container {
            children = [];
            addChild(component) { this.children.push(component); }
            render(width) { return this.children.flatMap((component) => component.render?.(width) ?? []); }
            invalidate() { for (const component of this.children) component.invalidate?.(); }
          }
          export const Key = { ctrl: (key) => \`ctrl+\${key}\` };
          export const matchesKey = (data, key) => data === key;
          export class SettingsList {
            constructor() {}
            handleInput() {}
            render() { return []; }
            invalidate() {}
          }
          export const truncateToWidth = (s) => String(s);
          export const visibleWidth = (s) => String(s).length;
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const { parseGitPorcelainStatus, detectGitOperation, readGitSnapshot } = await import("../index.ts");

const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Git Footer Test",
  GIT_AUTHOR_EMAIL: "git-footer-test@example.invalid",
  GIT_COMMITTER_NAME: "Git Footer Test",
  GIT_COMMITTER_EMAIL: "git-footer-test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  if (!allowFailure) {
    assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

// Minimal pi stub whose exec runs real commands, matching the shape
// runGit/readGitSnapshot expect.
const realPi = {
  exec(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", env: gitEnv });
    return Promise.resolve({
      code: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      killed: false,
    });
  },
};

async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), "git-footer-snapshot-"));
  git(["init", "-b", "main"], dir);
  await writeFile(path.join(dir, "file.txt"), "base\n");
  git(["add", "file.txt"], dir);
  git(["commit", "-m", "base"], dir);
  return dir;
}

const cleanups = [];
test.after(async () => {
  for (const dir of cleanups) await rm(dir, { recursive: true, force: true });
});

test("parses branch, upstream, counts, renames, and conflicts", () => {
  const oid = "1234567890abcdef1234567890abcdef12345678";
  const status = parseGitPorcelainStatus([
    `# branch.oid ${oid}`,
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 M. N... 100644 100644 100644 aaaa bbbb staged.txt",
    "1 .M N... 100644 100644 100644 aaaa aaaa modified.txt",
    "1 MM N... 100644 100644 100644 aaaa cccc both.txt",
    "2 R. N... 100644 100644 100644 aaaa bbbb R100 new-name.txt\told-name.txt",
    "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflicted.txt",
    "? untracked.txt",
    "",
  ].join("\n"));

  assert.equal(status.branch, "main");
  assert.equal(status.isDetached, false);
  assert.equal(status.upstream, "origin/main");
  assert.equal(status.upstreamGone, false);
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.equal(status.staged, 3, "staged should count M., MM, and R. entries");
  assert.equal(status.unstaged, 2, "unstaged should count .M and MM entries");
  assert.equal(status.untracked, 1);
  assert.equal(status.conflicted, 1);

  const rename = status.changedFiles.find((file) => file.path === "new-name.txt");
  assert.deepEqual(rename, { kind: "staged", path: "new-name.txt", status: "R.", oldPath: "old-name.txt" });

  const conflict = status.changedFiles.find((file) => file.kind === "conflicted");
  assert.deepEqual(conflict, { kind: "conflicted", path: "conflicted.txt", status: "UU" });

  const both = status.changedFiles.filter((file) => file.path === "both.txt");
  assert.deepEqual(both.map((file) => file.kind).sort(), ["modified", "staged"], "MM should produce one staged and one modified entry");
});

test("parses detached HEAD with short oid branch label", () => {
  const status = parseGitPorcelainStatus([
    "# branch.oid 1234567890abcdef1234567890abcdef12345678",
    "# branch.head (detached)",
  ].join("\n"));
  assert.equal(status.isDetached, true);
  assert.equal(status.branch, "detached@1234567");
});

test("parses initial commit state without oid label", () => {
  const status = parseGitPorcelainStatus([
    "# branch.oid (initial)",
    "# branch.head main",
    "? first.txt",
  ].join("\n"));
  assert.equal(status.branch, "main");
  assert.equal(status.isDetached, false);
  assert.equal(status.untracked, 1);
});

test("flags upstream gone when branch.upstream exists without branch.ab", () => {
  const status = parseGitPorcelainStatus([
    "# branch.oid 1234567890abcdef1234567890abcdef12345678",
    "# branch.head feature",
    "# branch.upstream origin/feature",
  ].join("\n"));
  assert.equal(status.upstream, "origin/feature");
  assert.equal(status.upstreamGone, true);
});

test("reports no upstream when branch.upstream header is absent", () => {
  const status = parseGitPorcelainStatus([
    "# branch.oid 1234567890abcdef1234567890abcdef12345678",
    "# branch.head local-only",
  ].join("\n"));
  assert.equal(status.upstream, undefined);
  assert.equal(status.upstreamGone, false);
});

test("detects git operations in fixture repos", { skip: !gitAvailable }, async () => {
  // Merge conflict
  const mergeRepo = await makeRepo();
  cleanups.push(mergeRepo);
  git(["checkout", "-b", "side"], mergeRepo);
  await writeFile(path.join(mergeRepo, "file.txt"), "side\n");
  git(["commit", "-am", "side"], mergeRepo);
  git(["checkout", "main"], mergeRepo);
  await writeFile(path.join(mergeRepo, "file.txt"), "main\n");
  git(["commit", "-am", "main"], mergeRepo);
  const merge = git(["merge", "side"], mergeRepo, { allowFailure: true });
  assert.notEqual(merge.status, 0, "merge fixture should conflict");
  assert.equal(await detectGitOperation(realPi, mergeRepo), "MERGING");

  const mergeSnapshot = await readGitSnapshot(realPi, mergeRepo);
  assert.equal(mergeSnapshot.operation, "MERGING");
  assert.equal(mergeSnapshot.conflicted, 1);
  assert.deepEqual(
    mergeSnapshot.changedFiles.filter((file) => file.kind === "conflicted"),
    [{ kind: "conflicted", path: "file.txt", status: "UU" }],
  );

  // Rebase conflict
  const rebaseRepo = await makeRepo();
  cleanups.push(rebaseRepo);
  git(["checkout", "-b", "side"], rebaseRepo);
  await writeFile(path.join(rebaseRepo, "file.txt"), "side\n");
  git(["commit", "-am", "side"], rebaseRepo);
  git(["checkout", "main"], rebaseRepo);
  await writeFile(path.join(rebaseRepo, "file.txt"), "main\n");
  git(["commit", "-am", "main"], rebaseRepo);
  git(["checkout", "side"], rebaseRepo);
  const rebase = git(["rebase", "main"], rebaseRepo, { allowFailure: true });
  assert.notEqual(rebase.status, 0, "rebase fixture should conflict");
  assert.equal(await detectGitOperation(realPi, rebaseRepo), "REBASING");

  // Cherry-pick conflict
  const cherryRepo = await makeRepo();
  cleanups.push(cherryRepo);
  git(["checkout", "-b", "side"], cherryRepo);
  await writeFile(path.join(cherryRepo, "file.txt"), "side\n");
  git(["commit", "-am", "side"], cherryRepo);
  git(["checkout", "main"], cherryRepo);
  await writeFile(path.join(cherryRepo, "file.txt"), "main\n");
  git(["commit", "-am", "main"], cherryRepo);
  const cherry = git(["cherry-pick", "side"], cherryRepo, { allowFailure: true });
  assert.notEqual(cherry.status, 0, "cherry-pick fixture should conflict");
  assert.equal(await detectGitOperation(realPi, cherryRepo), "CHERRY-PICK");

  // Revert conflict
  const revertRepo = await makeRepo();
  cleanups.push(revertRepo);
  await writeFile(path.join(revertRepo, "file.txt"), "second\n");
  git(["commit", "-am", "second"], revertRepo);
  await writeFile(path.join(revertRepo, "file.txt"), "third\n");
  git(["commit", "-am", "third"], revertRepo);
  const revert = git(["revert", "--no-edit", "HEAD~1"], revertRepo, { allowFailure: true });
  assert.notEqual(revert.status, 0, "revert fixture should conflict");
  assert.equal(await detectGitOperation(realPi, revertRepo), "REVERTING");

  // Bisect
  const bisectRepo = await makeRepo();
  cleanups.push(bisectRepo);
  git(["bisect", "start"], bisectRepo);
  assert.equal(await detectGitOperation(realPi, bisectRepo), "BISECT");

  // Clean repo has no operation
  const cleanRepo = await makeRepo();
  cleanups.push(cleanRepo);
  assert.equal(await detectGitOperation(realPi, cleanRepo), undefined);
});

test("caps changedFiles at 80 and flags truncation", { skip: !gitAvailable }, async () => {
  const repo = await makeRepo();
  cleanups.push(repo);
  for (let i = 0; i < 85; i++) {
    await writeFile(path.join(repo, `untracked-${String(i).padStart(3, "0")}.txt`), "x\n");
  }
  const snapshot = await readGitSnapshot(realPi, repo);
  assert.equal(snapshot.changedFiles.length, 80);
  assert.equal(snapshot.changedFilesTotal, 85);
  assert.equal(snapshot.changedFilesTruncated, true);
  assert.equal(snapshot.untracked, 85);

  const smallRepo = await makeRepo();
  cleanups.push(smallRepo);
  await writeFile(path.join(smallRepo, "one.txt"), "x\n");
  const smallSnapshot = await readGitSnapshot(realPi, smallRepo);
  assert.equal(smallSnapshot.changedFilesTotal, 1);
  assert.equal(smallSnapshot.changedFilesTruncated, false);
});
