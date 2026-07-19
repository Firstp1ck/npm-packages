import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(root, "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const reviewModuleUrl = pathToFileURL(join(workspaceRoot, "pi-extension-aur-review", "src", "git.ts")).href;
const port = 41000 + Math.floor(Math.random() * 10000);

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function extensionSnapshot(repo) {
  const script = `
    import { captureGitSnapshot } from ${JSON.stringify(reviewModuleUrl)};
    try {
      const snapshot = await captureGitSnapshot(process.env.HASH_CONTRACT_REPO, [], "staged");
      process.stdout.write(JSON.stringify({ ok: true, stagedContentHash: snapshot.stagedContentHash }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  `;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], {
    encoding: "utf8",
    env: { ...process.env, HASH_CONTRACT_REPO: repo },
  });
  assert.equal(result.status, 0, `extension hash helper failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const repo = await mkdtemp(path.join(tmpdir(), "pi-webui-staged-hash-contract-"));
const agentDir = await mkdtemp(path.join(tmpdir(), "pi-webui-staged-hash-agent-"));
await chmod(fakePi, 0o755);
const child = spawn(process.execPath, [serverScript, "--cwd", repo, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PI_WEBUI_SETTINGS_FILE: path.join(agentDir, "settings.json"),
  },
});
let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
child.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

try {
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      health = await request("/api/health");
      if (health.status === 200) break;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(health?.status, 200, `server did not start:\n${serverOutput}`);
  const tabs = await request("/api/tabs");
  const tabId = tabs.body?.data?.tabs?.[0]?.id;
  assert.ok(tabId, "contract server should expose its startup tab");
  const staged = async () => {
    const result = await request(`/api/git-workflow/staged-content?tab=${encodeURIComponent(tabId)}`);
    assert.equal(result.status, 200, `staged-content endpoint should be read-only and available: ${result.body?.error || ""}`);
    assert.equal(result.body?.ok, true, result.body?.error || "staged-content endpoint failed");
    return result.body.data;
  };
  const assertMatchesExtension = async (label) => {
    const server = await staged();
    const extension = extensionSnapshot(repo);
    assert.equal(server.hasStagedChanges, true, `${label}: server should find staged content`);
    assert.equal(extension.ok, true, `${label}: extension should capture staged content (${extension.error || ""})`);
    assert.match(server.stagedContentHash || "", /^[a-f0-9]{64}$/i, `${label}: server should return a SHA-256 staged-content hash`);
    assert.equal(server.stagedContentHash, extension.stagedContentHash, `${label}: extension and server staged-content hashes must match`);
    return server.stagedContentHash;
  };

  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Hash Contract");
  git(repo, "config", "user.email", "hash-contract@example.invalid");

  // Empty/unborn state has no substantive index content and exposes no token.
  assert.deepEqual(await staged(), { root: repo, hasStagedChanges: false, stagedContentHash: null });
  const emptyExtension = extensionSnapshot(repo);
  assert.equal(emptyExtension.ok, false, "extension should reject an empty staged review");
  assert.match(emptyExtension.error, /No substantive staged changes/i);

  // Unborn HEAD must use the index-vs-empty-tree diff without a HEAD lookup.
  await writeFile(path.join(repo, "normal.txt"), "unborn normal\n");
  git(repo, "add", "normal.txt");
  await assertMatchesExtension("unborn normal");
  git(repo, "commit", "-qm", "base");
  await writeFile(path.join(repo, "deleted.txt"), "delete\n");
  await writeFile(path.join(repo, "rename-from.txt"), "rename\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "fixtures");

  const reset = () => git(repo, "reset", "--hard", "HEAD");
  await writeFile(path.join(repo, "normal.txt"), "ordinary staged edit\n");
  git(repo, "add", "normal.txt");
  await assertMatchesExtension("normal text");
  reset();

  await writeFile(path.join(repo, "binary.bin"), Buffer.from([0, 1, 2, 0xff, 0x0a]));
  git(repo, "add", "binary.bin");
  await assertMatchesExtension("binary");
  reset();

  await writeFile(path.join(repo, "normal.txt"), "#!/bin/sh\necho mode\n");
  await chmod(path.join(repo, "normal.txt"), 0o755);
  git(repo, "add", "normal.txt");
  await assertMatchesExtension("mode");
  reset();

  await symlink("normal.txt", path.join(repo, "normal-link"));
  git(repo, "add", "normal-link");
  await assertMatchesExtension("symlink");
  reset();

  await writeFile(path.join(repo, "added.txt"), "added\n");
  git(repo, "rm", "-q", "deleted.txt");
  git(repo, "mv", "rename-from.txt", "rename-to.txt");
  git(repo, "add", "added.txt");
  await assertMatchesExtension("add delete rename");
  reset();

  // A server mutation rechecks an untrusted expected token at its own action
  // boundary, rejecting drift before either generation or commit can consume it.
  await writeFile(path.join(repo, "normal.txt"), "approved v1\n");
  git(repo, "add", "normal.txt");
  const approvedHash = await assertMatchesExtension("post-approval baseline");
  await writeFile(path.join(repo, "normal.txt"), "drifted v2\n");
  git(repo, "add", "normal.txt");
  const driftedGeneration = await request("/api/git-workflow/generate", { method: "POST", body: { tab: tabId, kind: "commit", expectedStagedContentHash: approvedHash } });
  assert.equal(driftedGeneration.status, 409, "staged drift must be rejected before commit-message generation");
  assert.match(driftedGeneration.body?.error || "", /Staged content changed after manual approval/i);
  const driftedCommit = await request("/api/git-workflow/commit", { method: "POST", body: { tab: tabId, variant: "input", message: "must not commit", expectedStagedContentHash: approvedHash } });
  assert.equal(driftedCommit.status, 200);
  assert.equal(driftedCommit.body?.ok, false, "staged drift must be rejected before commit");
  assert.match(driftedCommit.body?.error || "", /Staged content changed after manual approval/i);
  reset();

  assert.deepEqual(await staged(), { root: repo, hasStagedChanges: false, stagedContentHash: null }, "reset index should return the no-staged state");
  const resetExtension = extensionSnapshot(repo);
  assert.equal(resetExtension.ok, false, "extension should reject reset/no-staged content");

  console.log("staged content hash contract tests passed");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await Promise.all([rm(repo, { recursive: true, force: true }), rm(agentDir, { recursive: true, force: true })]);
}
