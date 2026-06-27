import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const port = 30000 + Math.floor(Math.random() * 20000);

function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}

async function request(host, pathname, { method = "GET", body, timeoutMs = 5_000 } = {}) {
  const response = await fetch(`http://${host}:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return { status: response.status, body: payload };
}

function runGitFixture(args, cwd, message) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Pi WebUI Test",
      GIT_AUTHOR_EMAIL: "pi-webui-test@example.invalid",
      GIT_COMMITTER_NAME: "Pi WebUI Test",
      GIT_COMMITTER_EMAIL: "pi-webui-test@example.invalid",
    },
  });
  assert.equal(result.status, 0, `${message}\n$ git ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result.stdout.trim();
}

const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-http-harness-"));
const settingsFile = path.join(cwd, "webui-settings.json");
await chmod(fakePi, 0o755);

const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "0.0.0.0", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: "Pi WebUI Test",
    GIT_AUTHOR_EMAIL: "pi-webui-test@example.invalid",
    GIT_COMMITTER_NAME: "Pi WebUI Test",
    GIT_COMMITTER_EMAIL: "pi-webui-test@example.invalid",
    PI_WEBUI_SETTINGS_FILE: settingsFile,
  },
});
let serverOutput = "";
child.stdout.on("data", (chunk) => {
  serverOutput += String(chunk);
});
child.stderr.on("data", (chunk) => {
  serverOutput += String(chunk);
});

try {
  // Wait for the HTTP server to accept requests.
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      health = await request("127.0.0.1", "/api/health", { timeoutMs: 1_000 });
      if (health.status === 200) break;
    } catch {
      // Server not listening yet.
    }
    await delay(200);
  }
  assert.equal(health?.status, 200, `server should become healthy, output:\n${serverOutput}`);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.piRunning, true, "fake pi RPC process should be attached and running");

  // Static assets: brotli/gzip compression plus ETag revalidation (P0-2).
  const brotliResponse = await fetch(`http://127.0.0.1:${port}/app.js`, {
    headers: { "accept-encoding": "br, gzip" },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(brotliResponse.status, 200);
  assert.equal(brotliResponse.headers.get("content-encoding"), "br", "app.js should be served brotli-compressed");
  assert.equal(brotliResponse.headers.get("cache-control"), "no-cache", "static assets should allow ETag revalidation");
  assert.equal(brotliResponse.headers.get("vary"), "Accept-Encoding");
  const appEtag = brotliResponse.headers.get("etag");
  assert.ok(appEtag, "app.js response should carry an ETag");
  // Node fetch transparently decompresses; equal size proves the brotli
  // round-trip reproduced the exact raw asset.
  const appBody = await brotliResponse.arrayBuffer();
  const rawAppSize = (await stat(join(root, "public", "app.js"))).size;
  assert.equal(appBody.byteLength, rawAppSize, "decompressed app.js should match the raw file byte-for-byte in size");

  const conditionalResponse = await fetch(`http://127.0.0.1:${port}/app.js`, {
    headers: { "if-none-match": appEtag },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(conditionalResponse.status, 304, "matching If-None-Match should return 304");
  await conditionalResponse.arrayBuffer();

  const gzipResponse = await fetch(`http://127.0.0.1:${port}/styles.css`, {
    headers: { "accept-encoding": "gzip" },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(gzipResponse.status, 200);
  assert.equal(gzipResponse.headers.get("content-encoding"), "gzip", "styles.css should fall back to gzip");
  await gzipResponse.arrayBuffer();

  const mermaidModuleResponse = await fetch(`http://127.0.0.1:${port}/vendor/mermaid/mermaid.esm.min.mjs`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(mermaidModuleResponse.status, 200, "Mermaid ESM module should be served from the vendored dependency path");
  assert.match(mermaidModuleResponse.headers.get("content-type") || "", /text\/javascript/, "Mermaid ESM module should use a JavaScript MIME type");
  const mermaidModuleText = await mermaidModuleResponse.text();
  const mermaidChunkPath = mermaidModuleText.match(/\.\/(chunks\/mermaid\.esm\.min\/[A-Za-z0-9._-]+\.mjs)/)?.[1];
  assert.ok(mermaidChunkPath, "Mermaid ESM module should reference same-directory chunks");
  const mermaidChunkResponse = await fetch(`http://127.0.0.1:${port}/vendor/mermaid/${mermaidChunkPath}`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(mermaidChunkResponse.status, 200, "Mermaid ESM chunks should be served for dynamic imports");
  assert.equal(await mermaidChunkResponse.text(), await readFile(join(root, "node_modules", "mermaid", "dist", mermaidChunkPath), "utf8"), "served Mermaid chunks should match the dependency files");

  const tabsResponse = await request("127.0.0.1", "/api/tabs");
  assert.equal(tabsResponse.status, 200);
  const tabList = tabsResponse.body?.data?.tabs || tabsResponse.body?.tabs || [];
  assert.equal(tabList.length, 1, "startup should create one tab for --cwd");
  const tabId = tabList[0].id;
  assert.ok(tabId, "tab should have an id");

  const state = await request("127.0.0.1", `/api/state?tab=${encodeURIComponent(tabId)}`);
  assert.equal(state.status, 200);
  assert.equal(state.body?.data?.model?.provider, "fake", "state should come from the fake pi RPC");

  const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
  if (gitAvailable) {
    const gitInit = await request("127.0.0.1", "/api/git-workflow/init", { method: "POST", body: { tab: tabId } });
    assert.equal(gitInit.status, 200);
    assert.equal(gitInit.body?.ok, true, "git init endpoint should initialize a temp repository");

    const initFileStatus = await request("127.0.0.1", `/api/git-workflow/init-files-status?tab=${encodeURIComponent(tabId)}`);
    assert.equal(initFileStatus.status, 200);
    assert.equal(initFileStatus.body?.ok, true, "init files status endpoint should check README.md and .gitignore");
    assert.equal(initFileStatus.body?.data?.readmeExists, false);
    assert.equal(initFileStatus.body?.data?.gitignoreExists, false);

    const gitReadme = await request("127.0.0.1", "/api/git-workflow/readme", { method: "POST", body: { repoName: "pi-webui-http-harness", stack: "Node.js / TypeScript", tab: tabId } });
    assert.equal(gitReadme.status, 200);
    assert.equal(gitReadme.body?.ok, true, "README endpoint should create/stage README.md and .gitignore");
    assert.equal(gitReadme.body?.data?.readme?.created, true);
    assert.equal(gitReadme.body?.data?.gitignore?.created, true);

    const gitReadmeAgain = await request("127.0.0.1", "/api/git-workflow/readme", { method: "POST", body: { repoName: "pi-webui-http-harness", stack: "Node.js / TypeScript", tab: tabId } });
    assert.equal(gitReadmeAgain.status, 200);
    assert.equal(gitReadmeAgain.body?.ok, true, "README endpoint should re-check existing files without overwriting");
    assert.equal(gitReadmeAgain.body?.data?.readme?.created, false);
    assert.equal(gitReadmeAgain.body?.data?.gitignore?.created, false);

    const gitCommit = await request("127.0.0.1", "/api/git-workflow/initial-commit", { method: "POST", body: { tab: tabId } });
    assert.equal(gitCommit.status, 200);
    assert.equal(gitCommit.body?.ok, true, "initial commit endpoint should commit the staged README.md");

    const gitMain = await request("127.0.0.1", "/api/git-workflow/main-branch", { method: "POST", body: { tab: tabId } });
    assert.equal(gitMain.status, 200);
    assert.equal(gitMain.body?.ok, true, "main branch endpoint should rename the branch");

    const initialWorktrees = await request("127.0.0.1", `/api/git-worktrees?tab=${encodeURIComponent(tabId)}`);
    assert.equal(initialWorktrees.status, 200);
    assert.equal(initialWorktrees.body?.ok, true, "worktree list endpoint should return data for a git repository");
    assert.ok(initialWorktrees.body?.data?.worktrees?.some((worktree) => worktree.isMainWorktree && worktree.current), "worktree list should include the current main worktree");

    await writeFile(path.join(cwd, "guided.txt"), "guided worktree flow\n");
    runGitFixture(["add", "guided.txt"], cwd, "source checkout should stage guided workflow changes");
    await mkdir(path.join(cwd, "dev", "COMMIT"), { recursive: true });
    await writeFile(path.join(cwd, "dev", "COMMIT", "staged-commit-short.txt"), "feat: guided worktree branch\n");
    await writeFile(path.join(cwd, "dev", "COMMIT", "staged-commit-long.txt"), "feat: guided worktree branch\n- feat: cover guided branch worktrees\n");
    const guidedBranch = "feat/guided-worktree";
    const guidedWorktree = await request("127.0.0.1", "/api/git-workflow/branch", {
      method: "POST",
      body: { tab: tabId, branch: guidedBranch, sessionMode: "empty", openTab: true },
      timeoutMs: 20_000,
    });
    assert.equal(guidedWorktree.status, 200);
    assert.equal(guidedWorktree.body?.ok, true, `guided branch worktree endpoint should return ok: ${guidedWorktree.body?.error || ""}`);
    assert.equal(guidedWorktree.body?.data?.created, true, "guided branch flow should create a worktree instead of switching in place");
    assert.equal(guidedWorktree.body?.data?.branch, guidedBranch);
    assert.equal(guidedWorktree.body?.data?.carriedStagedChanges, true, "guided branch worktree should copy staged changes into the worktree index");
    assert.ok(guidedWorktree.body?.data?.copiedMessageFiles?.includes("dev/COMMIT/staged-commit-short.txt"), "guided branch worktree should copy short commit message file");
    assert.ok(guidedWorktree.body?.data?.copiedMessageFiles?.includes("dev/COMMIT/staged-commit-long.txt"), "guided branch worktree should copy long commit message file");
    const guidedWorktreePath = guidedWorktree.body?.data?.worktree?.path || guidedWorktree.body?.data?.path;
    const guidedWorktreeTabId = guidedWorktree.body?.data?.tab?.id;
    assert.ok(guidedWorktreePath, "guided branch worktree response should include the worktree path");
    assert.ok(guidedWorktreeTabId, "guided branch worktree should open a Web UI tab");
    assert.equal(guidedWorktree.body?.data?.tab?.cwd, guidedWorktreePath, "guided worktree tab should be rooted at the worktree path");
    assert.equal(guidedWorktree.body?.data?.tab?.gitWorkspace?.branch, guidedBranch, "guided worktree tab metadata should record the branch");
    assert.equal(runGitFixture(["branch", "--show-current"], cwd, "source checkout should stay on main after guided worktree creation"), "main");
    assert.match(runGitFixture(["status", "--short"], guidedWorktreePath, "guided worktree should have copied staged changes"), /^A  guided\.txt/m);
    const guidedCommit = await request("127.0.0.1", "/api/git-workflow/commit", { method: "POST", body: { variant: "short", tab: guidedWorktreeTabId }, timeoutMs: 20_000 });
    assert.equal(guidedCommit.status, 200);
    assert.equal(guidedCommit.body?.ok, true, "guided worktree tab should continue the commit flow with copied message files");
    assert.equal(runGitFixture(["branch", "--show-current"], guidedWorktreePath, "guided worktree should remain on the PR branch"), guidedBranch);
    const closeGuidedWorktreeTab = await request("127.0.0.1", "/api/tabs/close", { method: "POST", body: { ids: [guidedWorktreeTabId] }, timeoutMs: 10_000 });
    assert.equal(closeGuidedWorktreeTab.status, 200);
    assert.equal(closeGuidedWorktreeTab.body?.ok, true, "guided worktree tab should close before cleanup");
    const removeGuidedWorktree = await request("127.0.0.1", "/api/git-worktrees", { method: "DELETE", body: { tab: tabId, path: guidedWorktreePath, confirmed: true, force: true }, timeoutMs: 20_000 });
    assert.equal(removeGuidedWorktree.status, 200);
    assert.equal(removeGuidedWorktree.body?.ok, true, "guided worktree should be removable after the tab is closed");
    runGitFixture(["reset", "--hard"], cwd, "source checkout should clean staged guided workflow fixture changes");
    await rm(path.join(cwd, "dev"), { recursive: true, force: true });

    const worktreeBranch = "feat/http-worktree";
    const createWorktree = await request("127.0.0.1", "/api/git-worktrees", {
      method: "POST",
      body: { tab: tabId, branchName: worktreeBranch, sessionMode: "empty", openTab: true },
      timeoutMs: 20_000,
    });
    assert.equal(createWorktree.status, 200);
    assert.equal(createWorktree.body?.ok, true, `worktree create endpoint should return ok: ${createWorktree.body?.error || ""}`);
    assert.equal(createWorktree.body?.data?.created, true, "creating a new branch worktree should report created=true");
    assert.equal(createWorktree.body?.data?.branch, worktreeBranch);
    const worktreePath = createWorktree.body?.data?.worktree?.path || createWorktree.body?.data?.path;
    const worktreeTabId = createWorktree.body?.data?.tab?.id;
    assert.ok(worktreePath, "created worktree response should include a worktree path");
    assert.ok(worktreeTabId, "creating a branch worktree should open a tab by default");
    assert.equal(createWorktree.body?.data?.tab?.cwd, worktreePath, "opened worktree tab should be rooted at the worktree path");
    assert.equal(createWorktree.body?.data?.tab?.gitWorkspace?.branch, worktreeBranch, "opened tab metadata should record the worktree branch");
    assert.equal(createWorktree.body?.data?.tab?.gitWorkspace?.worktreePath, worktreePath, "opened tab metadata should record the worktree path");

    const branchesWithWorktree = await request("127.0.0.1", `/api/git-branches?tab=${encodeURIComponent(tabId)}`);
    assert.equal(branchesWithWorktree.status, 200);
    assert.equal(branchesWithWorktree.body?.ok, true, "git branch list should still load after creating a worktree");
    const occupiedBranch = branchesWithWorktree.body?.data?.branches?.find((branch) => branch.name === worktreeBranch);
    assert.equal(occupiedBranch?.occupied, true, "branch list should mark branches checked out in a worktree");
    assert.equal(occupiedBranch?.worktreePath, worktreePath, "branch list should point occupied branches at their worktree");
    assert.equal(occupiedBranch?.worktreeCurrent, false, "main checkout should see the new branch as checked out elsewhere");
    assert.ok(branchesWithWorktree.body?.data?.occupiedBranches?.some((branch) => branch.branch === worktreeBranch && branch.path === worktreePath), "occupied branch summary should include the new worktree");

    const occupiedSwitch = await request("127.0.0.1", "/api/git-branch", { method: "POST", body: { tab: tabId, branch: worktreeBranch } });
    assert.equal(occupiedSwitch.status, 200);
    assert.equal(occupiedSwitch.body?.ok, false, "switching to a branch checked out in another worktree should be refused");
    assert.equal(occupiedSwitch.body?.code, "BRANCH_CHECKED_OUT_ELSEWHERE");
    assert.match(String(occupiedSwitch.body?.error || ""), /Open that worktree instead/);

    const duplicateWorktree = await request("127.0.0.1", "/api/git-worktrees", {
      method: "POST",
      body: { tab: tabId, branchName: worktreeBranch, sessionMode: "empty", openTab: true },
      timeoutMs: 20_000,
    });
    assert.equal(duplicateWorktree.status, 200);
    assert.equal(duplicateWorktree.body?.ok, true, "creating an already checked out branch should reuse the existing worktree");
    assert.equal(duplicateWorktree.body?.data?.created, false);
    assert.equal(duplicateWorktree.body?.data?.openedExisting, true);
    assert.equal(duplicateWorktree.body?.data?.openedExistingTab, true, "already-open worktree tab should be reused");
    assert.equal(duplicateWorktree.body?.data?.tab?.id, worktreeTabId);

    const openedWorktree = await request("127.0.0.1", "/api/git-worktrees/open", {
      method: "POST",
      body: { tab: tabId, path: worktreePath, sessionMode: "empty", openTab: true },
      timeoutMs: 20_000,
    });
    assert.equal(openedWorktree.status, 200);
    assert.equal(openedWorktree.body?.ok, true, "opening an existing worktree should return ok");
    assert.equal(openedWorktree.body?.data?.openedExistingTab, true, "opening an already-open worktree should reuse its tab");
    assert.equal(openedWorktree.body?.data?.tab?.id, worktreeTabId);

    const unconfirmedRemove = await request("127.0.0.1", "/api/git-worktrees", { method: "DELETE", body: { tab: tabId, path: worktreePath } });
    assert.equal(unconfirmedRemove.status, 200);
    assert.equal(unconfirmedRemove.body?.ok, false, "worktree removal should require explicit confirmation");
    assert.match(String(unconfirmedRemove.body?.error || ""), /requires confirmed: true/);

    const busyRemove = await request("127.0.0.1", "/api/git-worktrees", { method: "DELETE", body: { tab: tabId, path: worktreePath, confirmed: true } });
    assert.equal(busyRemove.status, 200);
    assert.equal(busyRemove.body?.ok, false, "worktree removal should be refused while a Web UI tab is open inside it");
    assert.equal(busyRemove.body?.code, "WORKTREE_BUSY");

    const closeWorktreeTab = await request("127.0.0.1", "/api/tabs/close", { method: "POST", body: { ids: [worktreeTabId] }, timeoutMs: 10_000 });
    assert.equal(closeWorktreeTab.status, 200);
    assert.equal(closeWorktreeTab.body?.ok, true, "worktree tab should close before removal");
    assert.ok(closeWorktreeTab.body?.data?.closedIds?.includes(worktreeTabId), "close response should include the worktree tab id");

    const removedWorktree = await request("127.0.0.1", "/api/git-worktrees", { method: "DELETE", body: { tab: tabId, path: worktreePath, confirmed: true }, timeoutMs: 20_000 });
    assert.equal(removedWorktree.status, 200);
    assert.equal(removedWorktree.body?.ok, true, `confirmed worktree removal should succeed: ${removedWorktree.body?.error || ""}`);
    assert.equal(removedWorktree.body?.data?.removed, true);
    assert.equal(removedWorktree.body?.data?.path, worktreePath);

    const worktreesAfterRemoval = await request("127.0.0.1", `/api/git-worktrees?tab=${encodeURIComponent(tabId)}`);
    assert.equal(worktreesAfterRemoval.status, 200);
    assert.equal(worktreesAfterRemoval.body?.ok, true);
    assert.equal(worktreesAfterRemoval.body?.data?.worktrees?.some((worktree) => worktree.path === worktreePath), false, "removed worktree should disappear from list output");
    assert.equal(worktreesAfterRemoval.body?.data?.occupiedBranches?.some((branch) => branch.branch === worktreeBranch), false, "removed worktree should disappear from occupied branch output");

    const remoteFixtureRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-git-remote-"));
    const remoteBare = path.join(remoteFixtureRoot, "origin.git");
    const localRepo = path.join(remoteFixtureRoot, "local");
    const remoteWork = path.join(remoteFixtureRoot, "remote-work");
    runGitFixture(["init", "--bare", remoteBare], remoteFixtureRoot, "remote fixture should initialize a bare origin");
    runGitFixture(["init", localRepo], remoteFixtureRoot, "remote fixture should initialize a local repo");
    runGitFixture(["config", "user.name", "Pi WebUI Test"], localRepo, "local repo should set a user name");
    runGitFixture(["config", "user.email", "pi-webui-test@example.invalid"], localRepo, "local repo should set a user email");
    await writeFile(path.join(localRepo, "incoming.txt"), "base\n");
    runGitFixture(["add", "incoming.txt"], localRepo, "local repo should stage base content");
    runGitFixture(["commit", "-m", "base"], localRepo, "local repo should commit base content");
    runGitFixture(["branch", "-M", "main"], localRepo, "local repo should rename main branch");
    runGitFixture(["remote", "add", "origin", remoteBare], localRepo, "local repo should add bare origin");
    runGitFixture(["push", "-u", "origin", "main"], localRepo, "local repo should push main to bare origin");
    runGitFixture(["symbolic-ref", "HEAD", "refs/heads/main"], remoteBare, "bare origin should advertise main as HEAD");
    runGitFixture(["clone", remoteBare, remoteWork], remoteFixtureRoot, "remote worktree should clone bare origin");
    runGitFixture(["config", "user.name", "Pi WebUI Test"], remoteWork, "remote worktree should set a user name");
    runGitFixture(["config", "user.email", "pi-webui-test@example.invalid"], remoteWork, "remote worktree should set a user email");
    await writeFile(path.join(remoteWork, "incoming.txt"), "base\nremote one\n");
    runGitFixture(["commit", "-am", "remote one"], remoteWork, "remote worktree should commit first incoming change");
    await writeFile(path.join(remoteWork, "incoming.txt"), "base\nremote one\nremote two\n");
    runGitFixture(["commit", "-am", "remote two"], remoteWork, "remote worktree should commit second incoming change");
    runGitFixture(["push", "origin", "main"], remoteWork, "remote worktree should push incoming commits");
    runGitFixture(["fetch", "origin"], localRepo, "local repo should fetch incoming commits");

    const remoteTab = await request("127.0.0.1", "/api/tabs", { method: "POST", body: { cwd: localRepo, title: "remote-behind-fixture" } });
    assert.equal(remoteTab.status, 201);
    const remoteTabId = remoteTab.body?.data?.tab?.id;
    assert.ok(remoteTabId, "remote fixture tab should have an id");
    const incomingChanges = await request("127.0.0.1", `/api/git-changes?tab=${encodeURIComponent(remoteTabId)}`);
    assert.equal(incomingChanges.status, 200);
    assert.equal(incomingChanges.body?.ok, true, "git changes endpoint should load a fetched-behind repo");
    assert.equal(incomingChanges.body?.data?.summary?.behind, 2, "git changes endpoint should report two fetched commits behind");
    assert.equal(incomingChanges.body?.data?.remote?.canPull, true, "git changes endpoint should mark fetched commits as pullable");
    assert.ok(incomingChanges.body?.data?.sections?.some((section) => section.key === "incoming"), "git changes endpoint should include an incoming diff section");

    const pullIncoming = await request("127.0.0.1", "/api/git-changes/pull", { method: "POST", body: { tab: remoteTabId }, timeoutMs: 20_000 });
    assert.equal(pullIncoming.status, 200);
    assert.equal(pullIncoming.body?.ok, true, "pull endpoint should fast-forward fetched incoming commits");
    assert.equal(pullIncoming.body?.data?.changes?.summary?.behind, 0, "pull endpoint should refresh changes with no remote commits left behind");

    const gitRemote = await request("127.0.0.1", "/api/git-workflow/remote", { method: "POST", body: { username: "Firstp1ck", repoName: "pi-webui-http-harness", tab: tabId } });
    assert.equal(gitRemote.status, 200);
    assert.equal(gitRemote.body?.ok, true, "remote endpoint should add origin without pushing");
    assert.equal(gitRemote.body?.data?.remoteUrl, "https://github.com/Firstp1ck/pi-webui-http-harness.git");

    await writeFile(path.join(cwd, "single.txt"), "created\n");
    const gitAddCreated = await request("127.0.0.1", "/api/git-workflow/add", { method: "POST", body: { tab: tabId } });
    assert.equal(gitAddCreated.status, 200);
    assert.equal(gitAddCreated.body?.ok, true, "git add endpoint should stage a new single file");
    const createdDefault = await request("127.0.0.1", `/api/git-workflow/default-commit-message?tab=${encodeURIComponent(tabId)}`);
    assert.equal(createdDefault.status, 200);
    assert.equal(createdDefault.body?.ok, true, "default commit message endpoint should return ok for a staged single file");
    assert.equal(createdDefault.body?.data?.message, "created single.txt");
    const createdCommit = await request("127.0.0.1", "/api/git-workflow/commit", { method: "POST", body: { variant: "input", message: createdDefault.body?.data?.message, tab: tabId } });
    assert.equal(createdCommit.status, 200);
    assert.equal(createdCommit.body?.ok, true, "input commit endpoint should accept the generated single-file default");

    await writeFile(path.join(cwd, "single.txt"), "updated\n");
    const gitAddUpdated = await request("127.0.0.1", "/api/git-workflow/add", { method: "POST", body: { tab: tabId } });
    assert.equal(gitAddUpdated.status, 200);
    assert.equal(gitAddUpdated.body?.ok, true, "git add endpoint should stage a single-file update");
    const updatedDefault = await request("127.0.0.1", `/api/git-workflow/default-commit-message?tab=${encodeURIComponent(tabId)}`);
    assert.equal(updatedDefault.status, 200);
    assert.equal(updatedDefault.body?.data?.message, "updated single.txt");
    const updatedCommit = await request("127.0.0.1", "/api/git-workflow/commit", { method: "POST", body: { variant: "input", message: updatedDefault.body?.data?.message, tab: tabId } });
    assert.equal(updatedCommit.status, 200);
    assert.equal(updatedCommit.body?.ok, true, "input commit endpoint should accept the update default");

    await rm(path.join(cwd, "single.txt"));
    const gitAddDeleted = await request("127.0.0.1", "/api/git-workflow/add", { method: "POST", body: { tab: tabId } });
    assert.equal(gitAddDeleted.status, 200);
    assert.equal(gitAddDeleted.body?.ok, true, "git add endpoint should stage a single-file deletion");
    const deletedDefault = await request("127.0.0.1", `/api/git-workflow/default-commit-message?tab=${encodeURIComponent(tabId)}`);
    assert.equal(deletedDefault.status, 200);
    assert.equal(deletedDefault.body?.data?.message, "deleted single.txt");

    await writeFile(path.join(cwd, "multi-a.txt"), "a\n");
    await writeFile(path.join(cwd, "multi-b.txt"), "b\n");
    const gitAddMultiple = await request("127.0.0.1", "/api/git-workflow/add", { method: "POST", body: { tab: tabId } });
    assert.equal(gitAddMultiple.status, 200);
    assert.equal(gitAddMultiple.body?.ok, true, "git add endpoint should stage multiple files");
    const multipleDefault = await request("127.0.0.1", `/api/git-workflow/default-commit-message?tab=${encodeURIComponent(tabId)}`);
    assert.equal(multipleDefault.status, 200);
    assert.equal(multipleDefault.body?.ok, true, "default commit message endpoint should still return ok when no default is available");
    assert.equal(multipleDefault.body?.data?.message, "", "multiple staged files should not get a default commit message");
  } else {
    console.log("http-endpoints-harness: git not available; skipping git init workflow endpoint checks");
  }

  // Delta transcript endpoint (P1-1): ?since= returns only the tail plus merge metadata.
  const fullMessages = await request("127.0.0.1", `/api/messages?tab=${encodeURIComponent(tabId)}`);
  assert.equal(fullMessages.status, 200);
  assert.equal((fullMessages.body?.data?.messages || []).length, 3, "fake pi should provide a 3-message transcript");
  assert.equal(fullMessages.body?.data?.totalCount, undefined, "full fetches should keep the legacy payload shape");

  const deltaMessages = await request("127.0.0.1", `/api/messages?since=2&tab=${encodeURIComponent(tabId)}`);
  assert.equal(deltaMessages.status, 200);
  assert.equal(deltaMessages.body?.data?.since, 2);
  assert.equal(deltaMessages.body?.data?.totalCount, 3);
  assert.equal((deltaMessages.body?.data?.messages || []).length, 1, "since=2 should return only the tail message");
  assert.equal(deltaMessages.body?.data?.messages?.[0]?.content, "fake follow-up");

  const clampedMessages = await request("127.0.0.1", `/api/messages?since=99&tab=${encodeURIComponent(tabId)}`);
  assert.equal(clampedMessages.status, 200);
  assert.equal(clampedMessages.body?.data?.since, 3, "since beyond the transcript should clamp to the total count");
  assert.equal((clampedMessages.body?.data?.messages || []).length, 0);

  // Custom app runners: save failures must be explicit, saved runners must be runnable,
  // and stale saved runners must explain why they are not shown in the Run menu.
  await writeFile(path.join(cwd, "custom-runner.mjs"), "console.log('custom runner ok')\n");
  const missingCommandRunner = await request("127.0.0.1", "/api/app-runner-config", {
    method: "POST",
    body: { tab: tabId, runner: { label: "Broken custom", command: "definitely-missing-pi-webui-runner", path: "custom-runner.mjs" } },
  });
  assert.equal(missingCommandRunner.status, 400, "saving a custom runner with a missing command should fail visibly");
  assert.match(String(missingCommandRunner.body?.error || ""), /Command is not available: definitely-missing-pi-webui-runner/);

  const savedCustomRunner = await request("127.0.0.1", "/api/app-runner-config", {
    method: "POST",
    body: { tab: tabId, runner: { label: "Custom node", command: process.execPath, path: "custom-runner.mjs" } },
    timeoutMs: 10_000,
  });
  assert.equal(savedCustomRunner.status, 200, `saving a valid custom runner should succeed: ${savedCustomRunner.body?.error || ""}`);
  const customConfigRunner = savedCustomRunner.body?.data?.customRunnerConfig?.runners?.find((runner) => runner.label === "Custom node");
  assert.equal(customConfigRunner?.available, true, "saved custom runner config should mark runnable entries available");
  const customRunner = savedCustomRunner.body?.data?.runners?.find((runner) => runner.custom === true && runner.label === "Custom node");
  assert.ok(customRunner?.id, "saved available custom runner should appear in detected app runners");

  const customRunStart = await request("127.0.0.1", "/api/app-runner", {
    method: "POST",
    body: { tab: tabId, runnerId: customRunner.id },
    timeoutMs: 10_000,
  });
  assert.equal(customRunStart.status, 200, `custom runner start should return ok: ${customRunStart.body?.error || ""}`);
  let customRunState = customRunStart;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (customRunState.body?.data?.activeRun?.status && customRunState.body.data.activeRun.status !== "running") break;
    await delay(100);
    customRunState = await request("127.0.0.1", `/api/app-runners?tab=${encodeURIComponent(tabId)}`, { timeoutMs: 5_000 });
  }
  assert.equal(customRunState.body?.data?.activeRun?.status, "done", "custom runner should finish successfully");
  assert.match((customRunState.body?.data?.activeRun?.lines || []).join("\n"), /custom runner ok/, "custom runner output should be captured");
  await request("127.0.0.1", "/api/app-runner/clear", { method: "POST", body: { tab: tabId } });

  await writeFile(path.join(cwd, "interactive-runner.mjs"), [
    "import readline from 'node:readline';",
    "const rl = readline.createInterface({ input: process.stdin, output: process.stdout });",
    "console.log('interactive ready');",
    "rl.question('name? ', (answer) => {",
    "  console.log(`hello ${answer}`);",
    "  rl.close();",
    "});",
    "",
  ].join("\n"));
  const savedInteractiveRunner = await request("127.0.0.1", "/api/app-runner-config", {
    method: "POST",
    body: { tab: tabId, runner: { label: "Interactive node", command: process.execPath, path: "interactive-runner.mjs" } },
    timeoutMs: 10_000,
  });
  assert.equal(savedInteractiveRunner.status, 200, `saving an interactive custom runner should succeed: ${savedInteractiveRunner.body?.error || ""}`);
  const interactiveRunner = savedInteractiveRunner.body?.data?.runners?.find((runner) => runner.custom === true && runner.label === "Interactive node");
  assert.ok(interactiveRunner?.id, "interactive custom runner should appear in detected app runners");
  const interactiveRunStart = await request("127.0.0.1", "/api/app-runner", {
    method: "POST",
    body: { tab: tabId, runnerId: interactiveRunner.id },
    timeoutMs: 10_000,
  });
  assert.equal(interactiveRunStart.status, 200, `interactive runner start should return ok: ${interactiveRunStart.body?.error || ""}`);
  let interactiveRunState = interactiveRunStart;
  for (let attempt = 0; attempt < 50; attempt++) {
    interactiveRunState = await request("127.0.0.1", `/api/app-runners?tab=${encodeURIComponent(tabId)}`, { timeoutMs: 5_000 });
    const output = [
      ...(interactiveRunState.body?.data?.activeRun?.lines || []),
      interactiveRunState.body?.data?.activeRun?.pendingLine || "",
    ].join("\n");
    if (/name\?/.test(output)) break;
    await delay(100);
  }
  assert.match([
    ...(interactiveRunState.body?.data?.activeRun?.lines || []),
    interactiveRunState.body?.data?.activeRun?.pendingLine || "",
  ].join("\n"), /name\?/, "interactive app runner should expose a prompt without waiting for a newline");
  const interactiveInput = await request("127.0.0.1", "/api/app-runner/input", {
    method: "POST",
    body: { tab: tabId, text: "webui", closeStdin: true },
    timeoutMs: 10_000,
  });
  assert.equal(interactiveInput.status, 200, `interactive app runner input should be accepted: ${interactiveInput.body?.error || ""}`);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (interactiveRunState.body?.data?.activeRun?.status && interactiveRunState.body.data.activeRun.status !== "running") break;
    await delay(100);
    interactiveRunState = await request("127.0.0.1", `/api/app-runners?tab=${encodeURIComponent(tabId)}`, { timeoutMs: 5_000 });
  }
  assert.equal(interactiveRunState.body?.data?.activeRun?.status, "done", "interactive custom runner should finish after stdin");
  const interactiveOutput = (interactiveRunState.body?.data?.activeRun?.lines || []).join("\n");
  assert.match(interactiveOutput, /hello webui/, "interactive custom runner should receive stdin from the app-runner input endpoint");
  assert.match(interactiveOutput, /# stdin sent \(5 chars\) and closed/, "app runner output should show that stdin was sent without echoing the input text itself");
  await request("127.0.0.1", "/api/app-runner/clear", { method: "POST", body: { tab: tabId } });

  await writeFile(path.join(cwd, ".pi-webui-runners.json"), `${JSON.stringify({
    version: 1,
    runners: [{ id: "broken-custom", label: "Broken custom", command: "definitely-missing-pi-webui-runner", path: "custom-runner.mjs" }],
  }, null, 2)}\n`);
  const staleCustomRunner = await request("127.0.0.1", `/api/app-runners?tab=${encodeURIComponent(tabId)}`, { timeoutMs: 10_000 });
  assert.equal(staleCustomRunner.status, 200);
  const brokenConfigRunner = staleCustomRunner.body?.data?.customRunnerConfig?.runners?.find((runner) => runner.label === "Broken custom");
  assert.equal(brokenConfigRunner?.available, false, "unavailable saved custom runners should be flagged in config data");
  assert.match(String(brokenConfigRunner?.unavailableReason || ""), /Command is not available: definitely-missing-pi-webui-runner/);
  assert.equal(staleCustomRunner.body?.data?.runners?.some((runner) => runner.label === "Broken custom"), false, "unavailable custom runners should not appear in runnable menu data");

  // Native slash command routed through the adapter (/copy → get_last_assistant_text).
  const copy = await request("127.0.0.1", "/api/prompt", {
    method: "POST",
    body: { message: "/copy", tab: tabId },
  });
  assert.equal(copy.status, 200);
  assert.equal(copy.body?.data?.status, "succeeded", "native /copy should succeed through the adapter");
  assert.equal(copy.body?.data?.copyText, "fake last text");

  // Bash FIFO queue: concurrent requests must execute serially on the RPC.
  const [bashA, bashB] = await Promise.all([
    request("127.0.0.1", "/api/bash", { method: "POST", body: { command: "echo a", tab: tabId }, timeoutMs: 10_000 }),
    request("127.0.0.1", "/api/bash", { method: "POST", body: { command: "echo b", tab: tabId }, timeoutMs: 10_000 }),
  ]);
  assert.equal(bashA.status, 200);
  assert.equal(bashB.status, 200);
  for (const result of [bashA, bashB]) {
    assert.equal(result.body?.data?.output, "peak:1", "bash queue must never run two commands concurrently");
  }

  // Session-dir confinement: traversal targets are rejected even from localhost.
  const traversalDelete = await request("127.0.0.1", "/api/session-delete", {
    method: "POST",
    body: { sessionPath: path.join(cwd, "outside.jsonl"), confirmed: true, tab: tabId },
  });
  assert.equal(traversalDelete.status, 403, "session delete outside the session dir must return 403");
  assert.match(String(traversalDelete.body?.error || ""), /session directory/i);

  const networkQr = await request("127.0.0.1", "/api/network/qr");
  assert.equal(networkQr.status, 200, "localhost can generate a /remote QR payload");
  assert.equal(networkQr.body?.ok, true);
  assert.match(String(networkQr.body?.data?.url || ""), /^http:\/\//, "remote QR payload should include a display URL");
  assert.ok(Array.isArray(networkQr.body?.data?.qrLines), "remote QR payload should include terminal QR lines");
  assert.equal(networkQr.body?.data?.network?.open, true, "remote QR payload should describe current network state");

  const initialAuth = await request("127.0.0.1", "/api/remote-auth");
  assert.equal(initialAuth.status, 200);
  assert.equal(initialAuth.body?.data?.auth?.enabled, false, "remote PIN auth should be off by default");

  const lan = lanAddress();
  if (lan) {
    const remoteHealthBeforeAuth = await request(lan, "/api/health");
    assert.equal(remoteHealthBeforeAuth.status, 200, "LAN clients should connect without a PIN while auth is off");

    const remoteDelete = await request(lan, "/api/session-delete", {
      method: "POST",
      body: { sessionPath: path.join(cwd, "outside.jsonl"), confirmed: true, tab: tabId },
    });
    assert.equal(remoteDelete.status, 403, "session delete must be localhost-only");

    const remoteExport = await request(lan, "/api/prompt", {
      method: "POST",
      body: { message: "/export", tab: tabId },
    });
    assert.equal(remoteExport.status, 200, "guarded slash commands return blocked adapter cards, not raw HTTP errors");
    assert.equal(remoteExport.body?.data?.status, "blocked", "guards-driven dispatch must block /export for LAN clients");

    const remoteClose = await request(lan, "/api/network/close", { method: "POST" });
    assert.equal(remoteClose.status, 403, "network close must be localhost-only");

    const remoteQr = await request(lan, "/api/network/qr");
    assert.equal(remoteQr.status, 403, "remote QR generation must be localhost-only because it can embed the PIN");

    const remoteWorktreeRemove = await request(lan, "/api/git-worktrees", {
      method: "DELETE",
      body: { path: path.join(cwd, "irrelevant-worktree"), confirmed: true, tab: tabId },
    });
    assert.equal(remoteWorktreeRemove.status, 403, "worktree removal must be localhost-only");

    const enableAuth = await request("127.0.0.1", "/api/remote-auth/settings", { method: "POST", body: { enabled: true } });
    assert.equal(enableAuth.status, 200, "localhost can enable remote PIN auth");
    const pin = enableAuth.body?.data?.auth?.pin;
    assert.match(pin, /^\d{4}$/, "enabling remote auth should generate a 4-digit PIN");

    const remoteHealthWithAuth = await request(lan, "/api/health");
    assert.equal(remoteHealthWithAuth.status, 401, "unauthenticated LAN clients should be challenged while remote auth is on");

    const wrongPin = pin === "0000" ? "0001" : "0000";
    const badLogin = await request(lan, "/api/remote-auth", { method: "POST", body: { pin: wrongPin } });
    assert.equal(badLogin.status, 403, "wrong remote PIN should be rejected");

    const loginResponse = await fetch(`http://${lan}:${port}/api/remote-auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(loginResponse.status, 200, "correct remote PIN should be accepted");
    const authCookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(authCookie, "remote auth login should set an auth cookie");

    const authedHealth = await fetch(`http://${lan}:${port}/api/health`, {
      headers: { cookie: authCookie },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(authedHealth.status, 200, "authenticated LAN client should reach guarded APIs");
    await authedHealth.json();

    const remoteSettings = await fetch(`http://${lan}:${port}/api/remote-auth/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: authCookie },
      body: JSON.stringify({ enabled: false }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(remoteSettings.status, 403, "remote clients must not toggle remote PIN auth settings");
    await remoteSettings.json().catch(() => undefined);

    const disableAuth = await request("127.0.0.1", "/api/remote-auth/settings", { method: "POST", body: { enabled: false } });
    assert.equal(disableAuth.status, 200, "localhost can disable remote PIN auth");
    const remoteHealthAfterDisable = await request(lan, "/api/health");
    assert.equal(remoteHealthAfterDisable.status, 200, "LAN clients should reconnect without a PIN after auth is disabled");
  } else {
    const enableAuth = await request("127.0.0.1", "/api/remote-auth/settings", { method: "POST", body: { enabled: true } });
    assert.equal(enableAuth.status, 200, "localhost can enable remote PIN auth");
    assert.match(enableAuth.body?.data?.auth?.pin, /^\d{4}$/);
    const disableAuth = await request("127.0.0.1", "/api/remote-auth/settings", { method: "POST", body: { enabled: false } });
    assert.equal(disableAuth.status, 200, "localhost can disable remote PIN auth");
    console.log("http-endpoints-harness: no LAN address detected; skipping remote-client checks");
  }

  const localClose = await request("127.0.0.1", "/api/network/close", { method: "POST" });
  assert.equal(localClose.status, 202, "network close from localhost should be accepted");

  const shutdownResponse = await request("127.0.0.1", "/api/shutdown", { method: "POST" });
  assert.equal(shutdownResponse.status, 200);

  for (let attempt = 0; attempt < 50 && child.exitCode === null; attempt++) {
    await delay(100);
  }
  assert.notEqual(child.exitCode, null, "server should exit after /api/shutdown");
} finally {
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(cwd, { recursive: true, force: true });
}

console.log("http-endpoints-harness.test.mjs passed");
