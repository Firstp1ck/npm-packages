import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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

async function rmWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EBUSY" && error?.code !== "EPERM" && error?.code !== "ENOTEMPTY") throw error;
      await delay(150 * (attempt + 1));
    }
  }
  throw lastError;
}

async function pathExists(target) {
  return !!(await stat(target).catch(() => null));
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
const harnessSideEffectsRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-http-harness-side-effects-"));
const settingsFile = path.join(harnessSideEffectsRoot, "webui-settings.json");
const openCommandLog = path.join(harnessSideEffectsRoot, "open-default.log");
const openCommandScript = path.join(harnessSideEffectsRoot, "fake-open-default.mjs");
const fakeOpenBinDir = path.join(harnessSideEffectsRoot, "bin");
await chmod(fakePi, 0o755);
await mkdir(fakeOpenBinDir, { recursive: true });
await writeFile(openCommandScript, `#!/usr/bin/env node\nimport { appendFile } from "node:fs/promises";\nawait appendFile(process.env.PI_WEBUI_OPEN_LOG, "custom-open\\t" + process.argv.slice(2).join("\\t") + "\\n", "utf8");\n`, "utf8");
await chmod(openCommandScript, 0o755);
await writeFile(path.join(fakeOpenBinDir, "xdg-open"), `#!/usr/bin/env node\nimport { appendFile } from "node:fs/promises";\nawait appendFile(process.env.PI_WEBUI_OPEN_LOG, "xdg-open\\t" + process.argv.slice(2).join("\\t") + "\\n", "utf8");\n`, "utf8");
await writeFile(path.join(fakeOpenBinDir, "gio"), `#!/usr/bin/env node\nimport { appendFile } from "node:fs/promises";\nawait appendFile(process.env.PI_WEBUI_OPEN_LOG, "gio\\t" + process.argv.slice(2).join("\\t") + "\\n", "utf8");\n`, "utf8");
await writeFile(path.join(fakeOpenBinDir, "xdg-mime"), `#!/usr/bin/env node\nconst [,, verb, mode, value = ""] = process.argv;\nif (verb === "query" && mode === "filetype") {\n  if (value.endsWith(".piunknown")) console.log("application/x-pi-unknown");\n  else if (value.endsWith(".md")) console.log("text/markdown");\n  else console.log("text/plain");\n  process.exit(0);\n}\nif (verb === "query" && mode === "default") {\n  if (value === "text/plain") console.log("fake-text-editor.desktop");\n  process.exit(0);\n}\nprocess.exit(1);\n`, "utf8");
await Promise.all(["xdg-open", "gio", "xdg-mime"].map((name) => chmod(path.join(fakeOpenBinDir, name), 0o755)));

const voiceProviderRequests = [];
const voiceProvider = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  voiceProviderRequests.push({ method: req.method, url: req.url, contentType: req.headers["content-type"], bodyLength: body.length });
  if (req.url === "/stt") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "fake transcript from local stt" }));
    return;
  }
  if (req.url === "/tts") {
    res.writeHead(200, { "content-type": "audio/mpeg" });
    res.end(Buffer.from("fake mp3 bytes"));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});
await new Promise((resolve) => voiceProvider.listen(0, "127.0.0.1", resolve));
const voiceProviderPort = voiceProvider.address().port;

const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "0.0.0.0", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: "Pi WebUI Test",
    GIT_AUTHOR_EMAIL: "pi-webui-test@example.invalid",
    GIT_COMMITTER_NAME: "Pi WebUI Test",
    GIT_COMMITTER_EMAIL: "pi-webui-test@example.invalid",
    PATH: `${fakeOpenBinDir}${path.delimiter}${process.env.PATH || ""}`,
    PI_CODING_AGENT_DIR: path.join(harnessSideEffectsRoot, "agent"),
    PI_WEBUI_SETTINGS_FILE: settingsFile,
    ...(process.platform === "linux" ? {} : { PI_WEBUI_OPEN_COMMAND: openCommandScript }),
    PI_WEBUI_OPEN_LOG: openCommandLog,
    FAKE_PI_VOICE_SCRIPTS: "1",
    PI_VOICE_STT_URL: `http://127.0.0.1:${voiceProviderPort}/stt`,
    PI_VOICE_TTS_URL: `http://127.0.0.1:${voiceProviderPort}/tts`,
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

  // The browser voice loop is dynamically imported by app.js; a missing static
  // allowlist entry would 404 the module and silently disable voice mode.
  const voiceModuleResponse = await fetch(`http://127.0.0.1:${port}/voice-conversation.mjs`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(voiceModuleResponse.status, 200, "voice-conversation.mjs must be served for the Natural Conversation browser voice loop");
  assert.match(voiceModuleResponse.headers.get("content-type") || "", /text\/javascript/, "voice-conversation.mjs should use a JavaScript MIME type");
  const voiceModuleBody = await voiceModuleResponse.arrayBuffer();
  const rawVoiceModuleSize = (await stat(join(root, "public", "voice-conversation.mjs"))).size;
  assert.equal(voiceModuleBody.byteLength, rawVoiceModuleSize, "served voice-conversation.mjs should match the raw file byte-for-byte in size");

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

  const subagentFixtureStart = await request("127.0.0.1", "/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture subagents running" } });
  assert.equal(subagentFixtureStart.status, 200, "subagent fixture status should be accepted");
  let subagentsResponse;
  for (let attempt = 0; attempt < 20; attempt++) {
    subagentsResponse = await request("127.0.0.1", "/api/subagents");
    if (subagentsResponse.body?.data?.totalAgents === 2) break;
    await delay(50);
  }
  assert.equal(subagentsResponse?.status, 200, "subagent overview endpoint should respond");
  assert.equal(subagentsResponse.body?.data?.totalAgents, 2, "subagent overview should count all running agents");
  assert.equal(subagentsResponse.body?.data?.tabs?.[0]?.tabId, tabId, "subagent overview should group agents under their terminal tab");
  assert.deepEqual(subagentsResponse.body?.data?.tabs?.[0]?.runs?.[0]?.agents?.map((agent) => agent.name), ["reviewer", "scout"], "subagent overview should preserve agent order within the session run");
  const subagentOutputResponse = await request("127.0.0.1", `/api/subagents/output?tab=${encodeURIComponent(tabId)}&run=${encodeURIComponent("fixture-run")}&agent=${encodeURIComponent("fixture-run:0")}`);
  assert.equal(subagentOutputResponse.status, 200, "running subagent output endpoint should respond");
  assert.equal(subagentOutputResponse.body?.data?.agent?.name, "reviewer", "subagent output should target the selected child agent");
  assert.deepEqual(subagentOutputResponse.body?.data?.agent?.recentOutput, ["Inspecting current implementation", "Waiting for the next tool result"], "subagent output should preserve bounded live output lines");
  assert.equal(subagentOutputResponse.body?.data?.agent?.currentToolArgs, "README.md", "subagent output should include current tool state");
  const unknownSubagentOutput = await request("127.0.0.1", `/api/subagents/output?tab=${encodeURIComponent(tabId)}&run=missing&agent=missing`);
  assert.equal(unknownSubagentOutput.status, 404, "subagent output endpoint should reject untracked selections");
  const subagentFixtureClear = await request("127.0.0.1", "/api/prompt", { method: "POST", body: { tab: tabId, message: "fixture subagents clear" } });
  assert.equal(subagentFixtureClear.status, 200, "subagent fixture clear should be accepted");
  for (let attempt = 0; attempt < 20; attempt++) {
    subagentsResponse = await request("127.0.0.1", "/api/subagents");
    if (subagentsResponse.body?.data?.totalAgents === 0) break;
    await delay(50);
  }
  assert.equal(subagentsResponse.body?.data?.totalAgents, 0, "completed subagents should disappear from the running overview");

  const state = await request("127.0.0.1", `/api/state?tab=${encodeURIComponent(tabId)}`);
  assert.equal(state.status, 200);
  assert.equal(state.body?.data?.model?.provider, "fake", "state should come from the fake pi RPC");

  const forkSourceTab = await request("127.0.0.1", "/api/tabs", { method: "POST", body: { cwd, title: "fork-running-source" } });
  assert.equal(forkSourceTab.status, 201, `fork source tab should open: ${forkSourceTab.body?.error || ""}`);
  const forkSourceTabId = forkSourceTab.body?.data?.tab?.id;
  assert.ok(forkSourceTabId, "fork source tab should have an id");
  const runningPrompt = "voice test slow fork fixture";
  const runningPromptResponse = await request("127.0.0.1", "/api/prompt", { method: "POST", body: { message: runningPrompt, tab: forkSourceTabId }, timeoutMs: 10_000 });
  assert.equal(runningPromptResponse.status, 200, `slow scripted prompt should start: ${runningPromptResponse.body?.error || ""}`);
  let streamingState;
  for (let attempt = 0; attempt < 30; attempt++) {
    streamingState = await request("127.0.0.1", `/api/state?tab=${encodeURIComponent(forkSourceTabId)}`);
    if (streamingState.body?.data?.isStreaming === true) break;
    await delay(100);
  }
  assert.equal(streamingState?.body?.data?.isStreaming, true, "source tab should still be running before fork");
  const forkMessagesWhileRunning = await request("127.0.0.1", `/api/fork-messages?tab=${encodeURIComponent(forkSourceTabId)}`);
  assert.equal(forkMessagesWhileRunning.status, 200, "fork selector data should load while the source tab is running");
  const runningForkPoint = (forkMessagesWhileRunning.body?.data?.messages || []).find((item) => item.text === runningPrompt);
  assert.ok(runningForkPoint?.entryId, "running prompt should be available as a fork point");
  const forkWhileRunning = await request("127.0.0.1", "/api/fork", { method: "POST", body: { tab: forkSourceTabId, entryId: runningForkPoint.entryId }, timeoutMs: 10_000 });
  assert.equal(forkWhileRunning.status, 200, `fork while running should succeed: ${forkWhileRunning.body?.error || ""}`);
  const forkedTabId = forkWhileRunning.body?.data?.tab?.id;
  assert.ok(forkedTabId, "fork response should include the opened fork tab");
  assert.notEqual(forkedTabId, forkSourceTabId, "forking should create a new tab instead of replacing the running source tab");
  assert.equal(forkWhileRunning.body?.data?.text, runningPrompt, "fork response should restore the selected prompt text for editing");
  assert.ok((forkWhileRunning.body?.data?.tabs || []).some((tab) => tab.id === forkSourceTabId), "fork response should keep the original running tab in the tab list");
  assert.ok((forkWhileRunning.body?.data?.tabs || []).some((tab) => tab.id === forkedTabId), "fork response should include the new fork tab in the tab list");
  assert.match(String(forkWhileRunning.body?.data?.sessionFile || ""), /\.jsonl$/, "fork response should include the new session file");
  const forkSessionContent = await readFile(forkWhileRunning.body.data.sessionFile, "utf8");
  assert.match(forkSessionContent, /"type":"session"/, "forked session file should be written before opening its tab");
  const sourceAfterFork = await request("127.0.0.1", `/api/state?tab=${encodeURIComponent(forkSourceTabId)}`);
  assert.equal(sourceAfterFork.status, 200, "source tab should still respond after forking");
  for (let attempt = 0; attempt < 40 && sourceAfterFork.body?.data?.isStreaming; attempt++) {
    const next = await request("127.0.0.1", `/api/state?tab=${encodeURIComponent(forkSourceTabId)}`);
    if (!next.body?.data?.isStreaming) break;
    await delay(100);
  }
  const closeForkTestTabs = await request("127.0.0.1", "/api/tabs/close", { method: "POST", body: { ids: [forkSourceTabId, forkedTabId] }, timeoutMs: 10_000 });
  assert.equal(closeForkTestTabs.status, 200, "fork test tabs should close before continuing baseline endpoint checks");

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

    const bypassCommit = await request("127.0.0.1", `/api/git-workflow/initial-commit?tab=${encodeURIComponent(tabId)}`);
    assert.equal(bypassCommit.status, 405, "GET on a mutating git workflow path should be refused with 405");
    assert.equal(bypassCommit.body?.ok, false, "GET bypass refusal should carry ok: false");
    const headAfterBypass = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
    assert.notEqual(headAfterBypass.status, 0, "GET bypass attempt must not create a commit");

    const bypassPush = await request("127.0.0.1", `/api/git-workflow/push?tab=${encodeURIComponent(tabId)}`);
    assert.equal(bypassPush.status, 405, "GET /api/git-workflow/push should be refused with 405");

    const bypassAdd = await request("127.0.0.1", `/api/git-workflow/add?tab=${encodeURIComponent(tabId)}`);
    assert.equal(bypassAdd.status, 405, "GET /api/git-workflow/add should be refused with 405");

    const postReadonly = await request("127.0.0.1", "/api/git-workflow/default-commit-message", { method: "POST", body: { tab: tabId } });
    assert.equal(postReadonly.status, 405, "POST on a read-only git workflow path should be refused with 405");

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

    // ---- Git action endpoints: staging, operations, stash, fetch/divergence, undo, tags, prune ----

    const gitFixturesRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-git-actions-"));
    const makeFixtureRepo = async (name) => {
      const dir = path.join(gitFixturesRoot, name);
      await mkdir(dir, { recursive: true });
      runGitFixture(["init", "-b", "main", dir], gitFixturesRoot, `${name} fixture should initialize`);
      runGitFixture(["config", "user.name", "Pi WebUI Test"], dir, `${name} fixture should set user name`);
      runGitFixture(["config", "user.email", "pi-webui-test@example.invalid"], dir, `${name} fixture should set user email`);
      await writeFile(path.join(dir, "file.txt"), "base\n");
      runGitFixture(["add", "file.txt"], dir, `${name} fixture should stage base`);
      runGitFixture(["commit", "-m", "base"], dir, `${name} fixture should commit base`);
      return dir;
    };
    const openFixtureTab = async (dir, title) => {
      const created = await request("127.0.0.1", "/api/tabs", { method: "POST", body: { cwd: dir, title } });
      assert.equal(created.status, 201, `${title} tab should open`);
      const id = created.body?.data?.tab?.id;
      assert.ok(id, `${title} tab should have an id`);
      return id;
    };

    // Staging endpoints
    const stagingRepo = await makeFixtureRepo("staging");
    const stagingTab = await openFixtureTab(stagingRepo, "staging-fixture");
    await writeFile(path.join(stagingRepo, "file.txt"), "modified\n");
    await writeFile(path.join(stagingRepo, "loose.txt"), "loose\n");

    const stageFile = await request("127.0.0.1", "/api/git-changes/stage-file", { method: "POST", body: { tab: stagingTab, path: "file.txt" } });
    assert.equal(stageFile.status, 200);
    assert.equal(stageFile.body?.ok, true, "stage-file endpoint should stage a modified file");
    assert.equal(stageFile.body?.data?.changes?.summary?.staged, 1, "stage-file should report one staged file afterwards");

    const unstageFile = await request("127.0.0.1", "/api/git-changes/unstage-file", { method: "POST", body: { tab: stagingTab, path: "file.txt" } });
    assert.equal(unstageFile.status, 200);
    assert.equal(unstageFile.body?.ok, true, "unstage-file endpoint should unstage the file");
    assert.equal(unstageFile.body?.data?.changes?.summary?.staged, 0, "unstage-file should report zero staged files afterwards");

    const discardUnconfirmed = await request("127.0.0.1", "/api/git-changes/discard-file", { method: "POST", body: { tab: stagingTab, path: "file.txt" } });
    assert.equal(discardUnconfirmed.status, 409, "discard-file without confirmed: true should be refused");
    const discardConfirmed = await request("127.0.0.1", "/api/git-changes/discard-file", { method: "POST", body: { tab: stagingTab, path: "file.txt", confirmed: true } });
    assert.equal(discardConfirmed.status, 200);
    assert.equal(discardConfirmed.body?.ok, true, "confirmed discard-file should restore the file");
    assert.equal(await readFile(path.join(stagingRepo, "file.txt"), "utf8"), "base\n", "discard-file should restore committed content");

    const escapeStage = await request("127.0.0.1", "/api/git-changes/stage-file", { method: "POST", body: { tab: stagingTab, path: "../outside.txt" } });
    assert.equal(escapeStage.body?.ok, false, "stage-file must reject paths escaping the repository root");

    const deleteTracked = await request("127.0.0.1", "/api/git-changes/delete-untracked", { method: "POST", body: { tab: stagingTab, path: "file.txt", confirmed: true } });
    assert.equal(deleteTracked.status, 409, "delete-untracked must refuse tracked files");
    const deleteUnconfirmed = await request("127.0.0.1", "/api/git-changes/delete-untracked", { method: "POST", body: { tab: stagingTab, path: "loose.txt" } });
    assert.equal(deleteUnconfirmed.status, 409, "delete-untracked without confirmed: true should be refused");
    const deleteConfirmed = await request("127.0.0.1", "/api/git-changes/delete-untracked", { method: "POST", body: { tab: stagingTab, path: "loose.txt", confirmed: true } });
    assert.equal(deleteConfirmed.status, 200);
    assert.equal(deleteConfirmed.body?.ok, true, "confirmed delete-untracked should delete the file");
    assert.equal(await readFile(path.join(stagingRepo, "loose.txt"), "utf8").then(() => true, () => false), false, "delete-untracked should remove the file from disk");

    // Diff truncation transparency: a diff larger than the 500KB cap must be flagged.
    const truncationRepo = await makeFixtureRepo("diff-truncation");
    const truncationTab = await openFixtureTab(truncationRepo, "diff-truncation-fixture");
    const bigLines = Array.from({ length: 24_000 }, (_, index) => `line ${index} ${"x".repeat(24)}`).join("\n");
    await writeFile(path.join(truncationRepo, "big.txt"), `${bigLines}\n`);
    runGitFixture(["add", "big.txt"], truncationRepo, "truncation fixture should stage the big file");
    runGitFixture(["commit", "-m", "big base"], truncationRepo, "truncation fixture should commit the big file");
    const flipped = Array.from({ length: 24_000 }, (_, index) => `LINE ${index} ${"y".repeat(24)}`).join("\n");
    await writeFile(path.join(truncationRepo, "big.txt"), `${flipped}\n`);
    const truncatedChanges = await request("127.0.0.1", `/api/git-changes?tab=${encodeURIComponent(truncationTab)}`, { timeoutMs: 20_000 });
    assert.equal(truncatedChanges.body?.ok, true, "git changes should load the oversized diff repo");
    const unstagedSection = (truncatedChanges.body?.data?.sections || []).find((section) => section.key === "unstaged");
    assert.ok(unstagedSection, "unstaged section should exist for the oversized diff");
    assert.equal(unstagedSection.truncated, true, "oversized diffs must carry a structured truncated flag");
    assert.ok(Number(unstagedSection.capBytes) > 0, "truncated sections must report the cap size");
    const stagedSection = (truncatedChanges.body?.data?.sections || []).find((section) => section.key === "staged");
    assert.equal(stagedSection?.truncated, false, "small diffs must not be flagged as truncated");

    // Merge conflict lifecycle
    const makeConflictRepo = async (name) => {
      const dir = await makeFixtureRepo(name);
      runGitFixture(["checkout", "-b", "side"], dir, `${name} fixture should branch`);
      await writeFile(path.join(dir, "file.txt"), "side\n");
      runGitFixture(["commit", "-am", "side"], dir, `${name} fixture should commit side`);
      runGitFixture(["checkout", "main"], dir, `${name} fixture should return to main`);
      await writeFile(path.join(dir, "file.txt"), "main\n");
      runGitFixture(["commit", "-am", "main"], dir, `${name} fixture should commit main`);
      const merge = spawnSync("git", ["merge", "side"], { cwd: dir, encoding: "utf8" });
      assert.notEqual(merge.status, 0, `${name} fixture merge should conflict`);
      return dir;
    };

    const mergeRepo = await makeConflictRepo("merge-conflict");
    const mergeTab = await openFixtureTab(mergeRepo, "merge-conflict-fixture");
    const operationSnapshot = await request("127.0.0.1", `/api/git-operation?tab=${encodeURIComponent(mergeTab)}`);
    assert.equal(operationSnapshot.status, 200);
    assert.equal(operationSnapshot.body?.ok, true, "operation endpoint should read a merging repo");
    assert.equal(operationSnapshot.body?.data?.operation, "merge");
    assert.equal(operationSnapshot.body?.data?.canContinue, false, "merge with conflicts must not be continuable");
    assert.equal(operationSnapshot.body?.data?.conflicts?.[0]?.path, "file.txt");
    assert.equal(operationSnapshot.body?.data?.conflicts?.[0]?.status, "UU");
    assert.equal(operationSnapshot.body?.data?.conflicts?.[0]?.preview?.hasMarkers, true, "conflict preview should detect conflict markers");

    const continueBlocked = await request("127.0.0.1", "/api/git-operation/continue", { method: "POST", body: { tab: mergeTab } });
    assert.equal(continueBlocked.status, 200);
    assert.equal(continueBlocked.body?.ok, false, "continue with unmerged paths must fail");
    assert.equal(continueBlocked.body?.code, "UNMERGED_PATHS");

    await writeFile(path.join(mergeRepo, "file.txt"), "resolved\n");
    const markResolved = await request("127.0.0.1", "/api/git-operation/stage-file", { method: "POST", body: { tab: mergeTab, path: "file.txt" } });
    assert.equal(markResolved.status, 200);
    assert.equal(markResolved.body?.ok, true, "operation stage-file should mark the conflict as resolved");
    assert.equal(markResolved.body?.data?.operation?.canContinue, true, "after staging the only conflict, continue should be possible");

    const continueMerge = await request("127.0.0.1", "/api/git-operation/continue", { method: "POST", body: { tab: mergeTab }, timeoutMs: 20_000 });
    assert.equal(continueMerge.status, 200);
    assert.equal(continueMerge.body?.ok, true, `continue should commit the resolved merge: ${continueMerge.body?.error || ""}`);
    assert.equal(continueMerge.body?.data?.operation?.operation, null, "after continuing, no operation should remain");

    const abortRepo = await makeConflictRepo("merge-abort");
    const abortTab = await openFixtureTab(abortRepo, "merge-abort-fixture");
    const abortUnconfirmed = await request("127.0.0.1", "/api/git-operation/abort", { method: "POST", body: { tab: abortTab } });
    assert.equal(abortUnconfirmed.status, 409, "abort without confirmed: true should be refused");
    const abortConfirmed = await request("127.0.0.1", "/api/git-operation/abort", { method: "POST", body: { tab: abortTab, confirmed: true }, timeoutMs: 20_000 });
    assert.equal(abortConfirmed.status, 200);
    assert.equal(abortConfirmed.body?.ok, true, "confirmed abort should stop the merge");
    assert.equal(abortConfirmed.body?.data?.operation?.operation, null, "after aborting, no operation should remain");
    assert.equal(await readFile(path.join(abortRepo, "file.txt"), "utf8"), "main\n", "abort should restore the pre-merge content");

    // Rebase lifecycle: skip support + abort
    const rebaseRepo = await makeFixtureRepo("rebase-conflict");
    runGitFixture(["checkout", "-b", "side"], rebaseRepo, "rebase fixture should branch");
    await writeFile(path.join(rebaseRepo, "file.txt"), "side\n");
    runGitFixture(["commit", "-am", "side"], rebaseRepo, "rebase fixture should commit side");
    runGitFixture(["checkout", "main"], rebaseRepo, "rebase fixture should return to main");
    await writeFile(path.join(rebaseRepo, "file.txt"), "main\n");
    runGitFixture(["commit", "-am", "main"], rebaseRepo, "rebase fixture should commit main");
    runGitFixture(["checkout", "side"], rebaseRepo, "rebase fixture should return to side");
    const rebaseStart = spawnSync("git", ["rebase", "main"], { cwd: rebaseRepo, encoding: "utf8" });
    assert.notEqual(rebaseStart.status, 0, "rebase fixture should conflict");
    const rebaseTab = await openFixtureTab(rebaseRepo, "rebase-conflict-fixture");
    const rebaseSnapshot = await request("127.0.0.1", `/api/git-operation?tab=${encodeURIComponent(rebaseTab)}`);
    assert.equal(rebaseSnapshot.body?.data?.operation, "rebase");
    assert.equal(rebaseSnapshot.body?.data?.canSkip, true, "rebase should support skip");
    const rebaseAbort = await request("127.0.0.1", "/api/git-operation/abort", { method: "POST", body: { tab: rebaseTab, confirmed: true }, timeoutMs: 20_000 });
    assert.equal(rebaseAbort.body?.ok, true, "confirmed rebase abort should succeed");

    // Bisect lifecycle
    const bisectRepo = await makeFixtureRepo("bisect");
    runGitFixture(["bisect", "start"], bisectRepo, "bisect fixture should start");
    const bisectTab = await openFixtureTab(bisectRepo, "bisect-fixture");
    const bisectSnapshot = await request("127.0.0.1", `/api/git-operation?tab=${encodeURIComponent(bisectTab)}`);
    assert.equal(bisectSnapshot.body?.data?.operation, "bisect");
    const bisectInvalid = await request("127.0.0.1", "/api/git-operation/bisect", { method: "POST", body: { tab: bisectTab, verdict: "evil" } });
    assert.equal(bisectInvalid.status, 400, "invalid bisect verdicts must be rejected");
    const bisectResetUnconfirmed = await request("127.0.0.1", "/api/git-operation/bisect", { method: "POST", body: { tab: bisectTab, verdict: "reset" } });
    assert.equal(bisectResetUnconfirmed.status, 409, "bisect reset without confirmed: true should be refused");
    const bisectReset = await request("127.0.0.1", "/api/git-operation/bisect", { method: "POST", body: { tab: bisectTab, verdict: "reset", confirmed: true }, timeoutMs: 20_000 });
    assert.equal(bisectReset.body?.ok, true, "confirmed bisect reset should succeed");
    assert.equal(bisectReset.body?.data?.operation?.operation, null, "after reset, no bisect should remain");

    // Stash lifecycle
    const stashRepo = await makeFixtureRepo("stash");
    const stashTab = await openFixtureTab(stashRepo, "stash-fixture");
    await writeFile(path.join(stashRepo, "file.txt"), "stash me\n");
    await writeFile(path.join(stashRepo, "new-file.txt"), "untracked\n");
    const stashSave = await request("127.0.0.1", "/api/git-stash/save", { method: "POST", body: { tab: stashTab, includeUntracked: true, message: "harness stash" } });
    assert.equal(stashSave.status, 200);
    assert.equal(stashSave.body?.ok, true, `stash save should succeed: ${stashSave.body?.error || ""}`);
    assert.equal(stashSave.body?.data?.stashes?.length, 1, "stash save should leave one stash entry");

    const stashList = await request("127.0.0.1", `/api/git-stash?tab=${encodeURIComponent(stashTab)}`);
    assert.equal(stashList.body?.ok, true);
    assert.equal(stashList.body?.data?.stashes?.[0]?.ref, "stash@{0}");
    assert.match(stashList.body?.data?.stashes?.[0]?.subject || "", /harness stash/);

    const stashShow = await request("127.0.0.1", `/api/git-stash/show?ref=${encodeURIComponent("stash@{0}")}&tab=${encodeURIComponent(stashTab)}`);
    assert.equal(stashShow.body?.ok, true, "stash show should return a preview");
    assert.match(stashShow.body?.data?.stat || "", /file\.txt/, "stash preview should mention the stashed file");

    const stashBadRef = await request("127.0.0.1", `/api/git-stash/show?ref=${encodeURIComponent("stash@{0}; rm -rf /")}&tab=${encodeURIComponent(stashTab)}`);
    assert.equal(stashBadRef.status, 400, "malformed stash refs must be rejected");

    const stashApply = await request("127.0.0.1", "/api/git-stash/apply", { method: "POST", body: { tab: stashTab, ref: "stash@{0}" } });
    assert.equal(stashApply.body?.ok, true, `stash apply should succeed: ${stashApply.body?.error || ""}`);
    assert.equal(await readFile(path.join(stashRepo, "file.txt"), "utf8"), "stash me\n", "stash apply should restore the stashed content");

    const stashDropUnconfirmed = await request("127.0.0.1", "/api/git-stash/drop", { method: "POST", body: { tab: stashTab, ref: "stash@{0}" } });
    assert.equal(stashDropUnconfirmed.status, 409, "stash drop without confirmed: true should be refused");
    const stashDrop = await request("127.0.0.1", "/api/git-stash/drop", { method: "POST", body: { tab: stashTab, ref: "stash@{0}", confirmed: true } });
    assert.equal(stashDrop.body?.ok, true, "confirmed stash drop should succeed");
    assert.equal(stashDrop.body?.data?.stashes?.length, 0, "dropping the only stash should empty the list");

    // Fetch, divergence classification, integrate, push classification
    await writeFile(path.join(remoteWork, "incoming.txt"), "base\nremote one\nremote two\nremote three\n");
    runGitFixture(["commit", "-am", "remote three"], remoteWork, "remote worktree should commit third incoming change");
    runGitFixture(["push", "origin", "main"], remoteWork, "remote worktree should push the third commit");
    await writeFile(path.join(localRepo, "local-only.txt"), "local\n");
    runGitFixture(["add", "local-only.txt"], localRepo, "local repo should stage local divergence");
    runGitFixture(["commit", "-m", "local divergence"], localRepo, "local repo should commit local divergence");

    const fetchResult = await request("127.0.0.1", "/api/git-fetch", { method: "POST", body: { tab: remoteTabId }, timeoutMs: 30_000 });
    assert.equal(fetchResult.status, 200);
    assert.equal(fetchResult.body?.ok, true, `fetch endpoint should fetch from the bare origin: ${fetchResult.body?.error || ""}`);
    assert.equal(fetchResult.body?.data?.changes?.summary?.behind, 1, "fetch should reveal the remote commit");
    assert.equal(fetchResult.body?.data?.changes?.remote?.diverged, true, "fetch should reveal divergence");
    assert.equal(fetchResult.body?.data?.changes?.remote?.canPull, false, "diverged branches must not offer one-click pull");

    const divergedPull = await request("127.0.0.1", "/api/git-changes/pull", { method: "POST", body: { tab: remoteTabId }, timeoutMs: 30_000 });
    assert.equal(divergedPull.body?.ok, false, "ff-only pull must fail on diverged branches");
    assert.equal(divergedPull.body?.code, "DIVERGED", "diverged pull failures should be classified");
    assert.ok(divergedPull.body?.hint, "diverged pull failures should carry a hint");

    const integrateUnconfirmed = await request("127.0.0.1", "/api/git-changes/integrate", { method: "POST", body: { tab: remoteTabId, mode: "merge" } });
    assert.equal(integrateUnconfirmed.status, 409, "integrate without confirmed: true should be refused");
    const integrateMerge = await request("127.0.0.1", "/api/git-changes/integrate", { method: "POST", body: { tab: remoteTabId, mode: "merge", confirmed: true }, timeoutMs: 30_000 });
    assert.equal(integrateMerge.body?.ok, true, `confirmed merge integrate should succeed: ${integrateMerge.body?.error || ""}`);
    assert.equal(integrateMerge.body?.data?.changes?.summary?.behind, 0, "after integrating, nothing should remain behind");

    const pushDiverged = await request("127.0.0.1", "/api/git-workflow/push", { method: "POST", body: { tab: remoteTabId }, timeoutMs: 30_000 });
    assert.equal(pushDiverged.body?.ok, true, `push should succeed after integration: ${pushDiverged.body?.error || ""}`);
    assert.equal(pushDiverged.body?.data?.branch, "main");
    assert.equal(pushDiverged.body?.data?.protectedBranch, true, "pushing main should be flagged as a protected branch");

    // Undo guards: pushed commits must not be undoable
    const undoPushedState = await request("127.0.0.1", `/api/git-undo?tab=${encodeURIComponent(remoteTabId)}`);
    assert.equal(undoPushedState.body?.ok, true);
    assert.equal(undoPushedState.body?.data?.canUndoLastCommit, false, "a pushed HEAD must not be undoable");
    const undoPushed = await request("127.0.0.1", "/api/git-undo/last-commit", { method: "POST", body: { tab: remoteTabId, confirmed: true } });
    assert.equal(undoPushed.status, 409, "undoing a pushed commit must be refused");

    // Undo/amend on an unpushed repo
    const undoRepo = await makeFixtureRepo("undo");
    const undoTab = await openFixtureTab(undoRepo, "undo-fixture");
    await writeFile(path.join(undoRepo, "file.txt"), "second\n");
    runGitFixture(["commit", "-am", "second"], undoRepo, "undo fixture should commit a second change");

    const undoState = await request("127.0.0.1", `/api/git-undo?tab=${encodeURIComponent(undoTab)}`);
    assert.equal(undoState.body?.ok, true);
    assert.equal(undoState.body?.data?.canUndoLastCommit, true, "an unpushed commit with a parent should be undoable");
    assert.equal(undoState.body?.data?.lastCommit?.subject, "second");

    const undoUnconfirmed = await request("127.0.0.1", "/api/git-undo/last-commit", { method: "POST", body: { tab: undoTab } });
    assert.equal(undoUnconfirmed.status, 409, "undo without confirmed: true should be refused");
    const undoConfirmed = await request("127.0.0.1", "/api/git-undo/last-commit", { method: "POST", body: { tab: undoTab, confirmed: true } });
    assert.equal(undoConfirmed.body?.ok, true, `confirmed undo should soft-reset: ${undoConfirmed.body?.error || ""}`);
    assert.equal(undoConfirmed.body?.data?.restoreCommand, "git reset --soft ORIG_HEAD");
    assert.equal(undoConfirmed.body?.data?.changes?.summary?.staged, 1, "soft reset should keep the change staged");
    assert.equal(runGitFixture(["log", "-1", "--format=%s"], undoRepo, "undo fixture should read HEAD subject"), "base", "undo should move HEAD back to the base commit");

    const undoNoParent = await request("127.0.0.1", "/api/git-undo/last-commit", { method: "POST", body: { tab: undoTab, confirmed: true } });
    assert.equal(undoNoParent.status, 409, "undoing the root commit must be refused");

    const amendWithStaged = await request("127.0.0.1", "/api/git-undo/amend-message", { method: "POST", body: { tab: undoTab, confirmed: true, message: "nope" } });
    assert.equal(amendWithStaged.status, 409, "amending with staged changes must be refused");
    runGitFixture(["commit", "-m", "second again"], undoRepo, "undo fixture should re-commit the staged change");
    const amendUnconfirmed = await request("127.0.0.1", "/api/git-undo/amend-message", { method: "POST", body: { tab: undoTab, message: "amended subject" } });
    assert.equal(amendUnconfirmed.status, 409, "amend without confirmed: true should be refused");
    const amendConfirmed = await request("127.0.0.1", "/api/git-undo/amend-message", { method: "POST", body: { tab: undoTab, confirmed: true, message: "amended subject" } });
    assert.equal(amendConfirmed.body?.ok, true, `confirmed amend should rewrite the message: ${amendConfirmed.body?.error || ""}`);
    assert.equal(runGitFixture(["log", "-1", "--format=%s"], undoRepo, "undo fixture should read amended subject"), "amended subject");

    const reflog = await request("127.0.0.1", `/api/git-reflog?tab=${encodeURIComponent(undoTab)}`);
    assert.equal(reflog.body?.ok, true, "reflog endpoint should return entries");
    assert.ok((reflog.body?.data?.entries || []).length >= 3, "reflog should include the undo/amend history");
    assert.match(reflog.body?.data?.entries?.[0]?.selector || "", /^HEAD@\{0\}$/);

    // Tags
    const tagInvalid = await request("127.0.0.1", "/api/git-tags/create", { method: "POST", body: { tab: undoTab, confirmed: true, name: "bad tag" } });
    assert.equal(tagInvalid.status, 400, "invalid tag names must be rejected");
    const tagUnconfirmed = await request("127.0.0.1", "/api/git-tags/create", { method: "POST", body: { tab: undoTab, name: "v0.0.1-harness", message: "harness tag" } });
    assert.equal(tagUnconfirmed.status, 409, "tag creation without confirmed: true should be refused");
    const tagCreate = await request("127.0.0.1", "/api/git-tags/create", { method: "POST", body: { tab: undoTab, confirmed: true, name: "v0.0.1-harness", message: "harness tag" } });
    assert.equal(tagCreate.body?.ok, true, `confirmed tag creation should succeed: ${tagCreate.body?.error || ""}`);
    const tagList = await request("127.0.0.1", `/api/git-tags?tab=${encodeURIComponent(undoTab)}`);
    assert.equal(tagList.body?.ok, true);
    const createdTag = (tagList.body?.data?.tags || []).find((tag) => tag.name === "v0.0.1-harness");
    assert.ok(createdTag, "created tag should appear in the tag list");
    assert.equal(createdTag.annotated, true, "created tag should be annotated");
    assert.equal(createdTag.atHead, true, "created tag should point at HEAD");

    // Signing diagnostics + submodule status (read-only)
    const signing = await request("127.0.0.1", `/api/git-signing?tab=${encodeURIComponent(undoTab)}`);
    assert.equal(signing.body?.ok, true, "signing diagnostics should load");
    assert.equal(signing.body?.data?.mismatch, false, "fixture repo should not report a signing mismatch");
    const submodules = await request("127.0.0.1", `/api/git-submodules?tab=${encodeURIComponent(undoTab)}`);
    assert.equal(submodules.body?.ok, true, "submodule status should load");
    assert.equal(submodules.body?.data?.hasSubmodules, false, "fixture repo has no submodules");

    // Worktree prune (dry run + confirmed)
    const pruneDryRun = await request("127.0.0.1", `/api/git-worktrees/prune?tab=${encodeURIComponent(undoTab)}`);
    assert.equal(pruneDryRun.body?.ok, true, "prune dry run should load");
    assert.equal(pruneDryRun.body?.data?.dryRun, true);
    const pruneUnconfirmed = await request("127.0.0.1", "/api/git-worktrees/prune", { method: "POST", body: { tab: undoTab } });
    assert.equal(pruneUnconfirmed.status, 409, "prune without confirmed: true should be refused");
    const pruneConfirmed = await request("127.0.0.1", "/api/git-worktrees/prune", { method: "POST", body: { tab: undoTab, confirmed: true }, timeoutMs: 20_000 });
    assert.equal(pruneConfirmed.body?.ok, true, `confirmed prune should succeed: ${pruneConfirmed.body?.error || ""}`);

    const closeGitActionTabs = await request("127.0.0.1", "/api/tabs/close", { method: "POST", body: { ids: [stagingTab, truncationTab, mergeTab, abortTab, rebaseTab, bisectTab, stashTab, undoTab] }, timeoutMs: 10_000 });
    assert.equal(closeGitActionTabs.status, 200, "git action fixture tabs should close");
    await rmWithRetry(gitFixturesRoot);
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

  const scriptVersion = spawnSync("script", ["--version"], { encoding: "utf8" });
  const utilLinuxScriptAvailable = process.platform !== "win32" && scriptVersion.status === 0 && /util-linux/i.test(`${scriptVersion.stdout}\n${scriptVersion.stderr}`);
  const bashAvailable = spawnSync("bash", ["--version"], { encoding: "utf8" }).status === 0;
  if (utilLinuxScriptAvailable && bashAvailable) {
    await mkdir(path.join(cwd, "qa"), { recursive: true });
    await writeFile(path.join(cwd, "qa", "read-p-runner.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "read -r -p 'choice? ' answer",
      "printf 'selected:%s\\n' \"$answer\"",
      "",
    ].join("\n"));
    const savedReadPromptRunner = await request("127.0.0.1", "/api/app-runner-config", {
      method: "POST",
      body: { tab: tabId, runner: { label: "Read prompt bash", command: "bash", path: "qa/read-p-runner.sh" } },
      timeoutMs: 10_000,
    });
    assert.equal(savedReadPromptRunner.status, 200, `saving a bash read -p runner should succeed: ${savedReadPromptRunner.body?.error || ""}`);
    const readPromptRunner = savedReadPromptRunner.body?.data?.runners?.find((runner) => runner.custom === true && runner.label === "Read prompt bash");
    assert.ok(readPromptRunner?.id, "bash read -p runner should appear in detected app runners");
    const readPromptStart = await request("127.0.0.1", "/api/app-runner", {
      method: "POST",
      body: { tab: tabId, runnerId: readPromptRunner.id },
      timeoutMs: 10_000,
    });
    assert.equal(readPromptStart.status, 200, `bash read -p runner start should return ok: ${readPromptStart.body?.error || ""}`);
    assert.equal(readPromptStart.body?.data?.activeRun?.executionMode, "pty", "bash read -p runner should use the PTY-backed execution path when util-linux script is available");
    let readPromptState = readPromptStart;
    for (let attempt = 0; attempt < 50; attempt++) {
      readPromptState = await request("127.0.0.1", `/api/app-runners?tab=${encodeURIComponent(tabId)}`, { timeoutMs: 5_000 });
      const output = [
        ...(readPromptState.body?.data?.activeRun?.lines || []),
        readPromptState.body?.data?.activeRun?.pendingLine || "",
      ].join("\n");
      if (/choice\?/.test(output)) break;
      await delay(100);
    }
    assert.match([
      ...(readPromptState.body?.data?.activeRun?.lines || []),
      readPromptState.body?.data?.activeRun?.pendingLine || "",
    ].join("\n"), /choice\?/, "bash read -p prompts should be captured before a trailing newline");
    const readPromptInput = await request("127.0.0.1", "/api/app-runner/input", {
      method: "POST",
      body: { tab: tabId, text: "alpha", closeStdin: true },
      timeoutMs: 10_000,
    });
    assert.equal(readPromptInput.status, 200, `bash read -p runner input should be accepted: ${readPromptInput.body?.error || ""}`);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (readPromptState.body?.data?.activeRun?.status && readPromptState.body.data.activeRun.status !== "running") break;
      await delay(100);
      readPromptState = await request("127.0.0.1", `/api/app-runners?tab=${encodeURIComponent(tabId)}`, { timeoutMs: 5_000 });
    }
    assert.equal(readPromptState.body?.data?.activeRun?.status, "done", "bash read -p runner should finish after stdin");
    const readPromptOutput = (readPromptState.body?.data?.activeRun?.lines || []).join("\n");
    assert.match(readPromptOutput, /selected:alpha/, "bash read -p runner should receive stdin from the app-runner input endpoint");
    assert.doesNotMatch(readPromptOutput, /^alpha$/m, "PTY-backed app runner should not echo raw stdin into captured output");
    await request("127.0.0.1", "/api/app-runner/clear", { method: "POST", body: { tab: tabId } });
  }

  if (process.platform !== "win32") {
    await writeFile(path.join(cwd, "signal-runner.mjs"), [
      "import { writeFileSync } from 'node:fs';",
      "process.on('SIGINT', () => { writeFileSync('signal-result.txt', 'SIGINT\\n'); process.exit(130); });",
      "process.on('SIGTERM', () => { writeFileSync('signal-result.txt', 'SIGTERM\\n'); process.exit(143); });",
      "console.log('signal runner ready');",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"));
    const savedSignalRunner = await request("127.0.0.1", "/api/app-runner-config", {
      method: "POST",
      body: { tab: tabId, runner: { label: "Signal node", command: process.execPath, path: "signal-runner.mjs" } },
      timeoutMs: 10_000,
    });
    assert.equal(savedSignalRunner.status, 200, `saving a signal custom runner should succeed: ${savedSignalRunner.body?.error || ""}`);
    const signalRunner = savedSignalRunner.body?.data?.runners?.find((runner) => runner.custom === true && runner.label === "Signal node");
    assert.ok(signalRunner?.id, "signal custom runner should appear in detected app runners");
    let signalRunState = await request("127.0.0.1", "/api/app-runner", {
      method: "POST",
      body: { tab: tabId, runnerId: signalRunner.id },
      timeoutMs: 10_000,
    });
    assert.equal(signalRunState.status, 200, `signal runner start should return ok: ${signalRunState.body?.error || ""}`);
    for (let attempt = 0; attempt < 50; attempt++) {
      signalRunState = await request("127.0.0.1", `/api/app-runners?tab=${encodeURIComponent(tabId)}`, { timeoutMs: 5_000 });
      const output = [
        ...(signalRunState.body?.data?.activeRun?.lines || []),
        signalRunState.body?.data?.activeRun?.pendingLine || "",
      ].join("\n");
      if (/signal runner ready/.test(output)) break;
      await delay(100);
    }
    assert.match([
      ...(signalRunState.body?.data?.activeRun?.lines || []),
      signalRunState.body?.data?.activeRun?.pendingLine || "",
    ].join("\n"), /signal runner ready/, "signal app runner should start before stop is requested");
    const signalStop = await request("127.0.0.1", "/api/app-runner/stop", { method: "POST", body: { tab: tabId }, timeoutMs: 10_000 });
    assert.equal(signalStop.status, 200, `signal runner stop should return ok: ${signalStop.body?.error || ""}`);
    assert.match((signalStop.body?.data?.activeRun?.lines || []).join("\n"), /sending Ctrl\+C/, "Web UI stop should document Ctrl+C-equivalent interruption");
    let signalResult = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      signalRunState = await request("127.0.0.1", `/api/app-runners?tab=${encodeURIComponent(tabId)}`, { timeoutMs: 5_000 });
      try {
        signalResult = await readFile(path.join(cwd, "signal-result.txt"), "utf8");
      } catch {
        signalResult = "";
      }
      const signalRunStopped = signalRunState.body?.data?.activeRun?.status && signalRunState.body.data.activeRun.status !== "running";
      if (signalResult && signalRunStopped) break;
      await delay(100);
    }
    assert.equal(signalResult.trim(), "SIGINT", "Web UI app-runner stop should deliver SIGINT like terminal Ctrl+C, not SIGTERM");
    assert.notEqual(signalRunState.body?.data?.activeRun?.status, "running", "signal app runner should fully stop before cleanup continues");
    await request("127.0.0.1", "/api/app-runner/clear", { method: "POST", body: { tab: tabId } });
  }

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

  // File tree/viewer APIs stay scoped to the requested tab cwd and reject unsafe content.
  const filesRoot = path.join(cwd, "files-fixture");
  const viewerRelative = "files-fixture/viewer.txt";
  const markdownRelative = "files-fixture/docs/readme.md";
  const binaryRelative = "files-fixture/binary.bin";
  const noDefaultRelative = "files-fixture/no-default.piunknown";
  const largeRelative = "files-fixture/large.txt";
  const movableFileRelative = "files-fixture/move-me.txt";
  const movedFileRelative = "files-fixture/docs/moved-file.txt";
  const movableDirectoryRelative = "files-fixture/move-dir";
  const movedDirectoryRelative = "files-fixture/docs/move-dir";
  const deleteFileRelative = "files-fixture/delete-me.txt";
  const deleteDirectoryRelative = "files-fixture/delete-dir";
  const depthEightFileRelative = "deep-search/f1/f2/f3/f4/f5/f6/depth-eight-file.txt";
  const depthEightDirectoryRelative = "deep-search/d1/d2/d3/d4/d5/d6/depth-eight-dir";
  const depthNineFileRelative = "deep-search/t1/t2/t3/t4/t5/t6/t7/too-deep-file.txt";
  await mkdir(path.join(filesRoot, "docs"), { recursive: true });
  await mkdir(path.join(cwd, path.dirname(depthEightFileRelative)), { recursive: true });
  await mkdir(path.join(cwd, depthEightDirectoryRelative), { recursive: true });
  await mkdir(path.join(cwd, path.dirname(depthNineFileRelative)), { recursive: true });
  await writeFile(path.join(cwd, viewerRelative), "hello file viewer\nsecond line\n", "utf8");
  await writeFile(path.join(cwd, markdownRelative), "# File Viewer\n\nMarkdown preview support.\n", "utf8");
  await writeFile(path.join(cwd, noDefaultRelative), "unknown extension should use text/plain editor fallback\n", "utf8");
  await writeFile(path.join(cwd, depthEightFileRelative), "depth 8 search fixture\n", "utf8");
  await writeFile(path.join(cwd, depthNineFileRelative), "depth 9 search fixture\n", "utf8");
  await writeFile(path.join(cwd, binaryRelative), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(cwd, largeRelative), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
  await writeFile(path.join(cwd, movableFileRelative), "move me\n", "utf8");
  await mkdir(path.join(cwd, movableDirectoryRelative), { recursive: true });
  await writeFile(path.join(cwd, movableDirectoryRelative, "nested.txt"), "nested move\n", "utf8");
  await writeFile(path.join(cwd, deleteFileRelative), "delete me\n", "utf8");
  await mkdir(path.join(cwd, deleteDirectoryRelative), { recursive: true });
  await writeFile(path.join(cwd, deleteDirectoryRelative, "nested.txt"), "nested delete\n", "utf8");

  const fileTree = await request("127.0.0.1", `/api/files?tab=${encodeURIComponent(tabId)}&path=${encodeURIComponent("files-fixture")}`);
  assert.equal(fileTree.status, 200, `file tree endpoint should list workspace directories: ${fileTree.body?.error || ""}`);
  assert.equal(fileTree.body?.ok, true);
  const fileTreeEntries = fileTree.body?.data?.entries || [];
  assert.equal(fileTreeEntries.find((entry) => entry.name === "docs")?.type, "directory", "file tree should identify subdirectories");
  assert.equal(fileTreeEntries.find((entry) => entry.name === "viewer.txt")?.type, "file", "file tree should identify regular files");

  const fileSearch = await request("127.0.0.1", `/api/files/search?tab=${encodeURIComponent(tabId)}&q=${encodeURIComponent("readme")}`);
  assert.equal(fileSearch.status, 200, `file search endpoint should search workspace files: ${fileSearch.body?.error || ""}`);
  assert.equal(fileSearch.body?.ok, true);
  const fileSearchEntries = fileSearch.body?.data?.entries || [];
  assert.equal(fileSearchEntries.find((entry) => entry.path === markdownRelative)?.type, "file", "file search should find matching files recursively");

  const directorySearch = await request("127.0.0.1", `/api/files/search?tab=${encodeURIComponent(tabId)}&q=${encodeURIComponent("docs")}`);
  assert.equal(directorySearch.status, 200, `file search endpoint should search directories: ${directorySearch.body?.error || ""}`);
  assert.equal(directorySearch.body?.data?.entries?.find((entry) => entry.path === "files-fixture/docs")?.type, "directory", "file search should find matching directories");

  const depthLimitedSearch = await request("127.0.0.1", `/api/files/search?tab=${encodeURIComponent(tabId)}&q=${encodeURIComponent("depth")}`);
  assert.equal(depthLimitedSearch.status, 200, `file search endpoint should honor depth-limited recursive search: ${depthLimitedSearch.body?.error || ""}`);
  assert.equal(depthLimitedSearch.body?.data?.maxDepth, 8, "file search should advertise the recursive depth cap");
  assert.equal(depthLimitedSearch.body?.data?.entries?.find((entry) => entry.path === depthEightFileRelative)?.type, "file", "file search should find matching files at depth 8");
  assert.equal(depthLimitedSearch.body?.data?.entries?.find((entry) => entry.path === depthEightDirectoryRelative)?.type, "directory", "file search should find matching directories at depth 8");
  assert.equal(depthLimitedSearch.body?.data?.entries?.some((entry) => entry.path === depthNineFileRelative), false, "file search should not descend past depth 8");

  const emptyFileSearch = await request("127.0.0.1", `/api/files/search?tab=${encodeURIComponent(tabId)}&q=`);
  assert.equal(emptyFileSearch.status, 200, "empty file search should be accepted");
  assert.deepEqual(emptyFileSearch.body?.data?.entries, [], "empty file search should not scan the workspace");

  const textContent = await request("127.0.0.1", `/api/files/content?tab=${encodeURIComponent(tabId)}&path=${encodeURIComponent(viewerRelative)}`);
  assert.equal(textContent.status, 200, `text file should open in WebUI: ${textContent.body?.error || ""}`);
  assert.equal(textContent.body?.data?.content, "hello file viewer\nsecond line\n");
  assert.equal(textContent.body?.data?.language, "text");

  const markdownContent = await request("127.0.0.1", `/api/files/content?tab=${encodeURIComponent(tabId)}&path=${encodeURIComponent(markdownRelative)}`);
  assert.equal(markdownContent.status, 200, `markdown file should open in WebUI: ${markdownContent.body?.error || ""}`);
  assert.equal(markdownContent.body?.data?.language, "markdown", "markdown files should get markdown viewer support metadata");

  const emptyDefaultOpen = await request("127.0.0.1", "/api/files/open-default", { method: "POST", body: { tab: tabId, path: "" } });
  assert.equal(emptyDefaultOpen.status, 400, "default editor opens should reject empty paths instead of opening the workspace root");
  assert.match(String(emptyDefaultOpen.body?.error || ""), /Path to open is required/i);

  const defaultOpen = await request("127.0.0.1", "/api/files/open-default", { method: "POST", body: { tab: tabId, path: viewerRelative } });
  assert.equal(defaultOpen.status, 200, `default editor should open the requested file: ${defaultOpen.body?.error || ""}`);
  assert.equal(defaultOpen.body?.data?.path, viewerRelative, "default editor endpoint should report the requested file path");
  const openedAbsolutePath = path.join(cwd, viewerRelative);
  let openLog = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    openLog = await readFile(openCommandLog, "utf8").catch(() => "");
    if (openLog.includes(openedAbsolutePath)) break;
    await delay(50);
  }
  assert.ok(openLog.includes(openedAbsolutePath), "default editor command should receive the currently opened file path");

  if (process.platform === "linux") {
    const fallbackOpen = await request("127.0.0.1", "/api/files/open-default", { method: "POST", body: { tab: tabId, path: noDefaultRelative } });
    assert.equal(fallbackOpen.status, 200, `default editor should fall back to the .txt editor for unassociated files: ${fallbackOpen.body?.error || ""}`);
    assert.equal(fallbackOpen.body?.data?.path, noDefaultRelative, "default editor fallback should report the requested file path");
    assert.equal(fallbackOpen.body?.data?.fallbackToTextEditor, true, "unassociated files should be opened through the text/plain fallback");
    assert.equal(fallbackOpen.body?.data?.desktopFile, "fake-text-editor.desktop", "fallback should use the text/plain desktop app association");
    const fallbackAbsolutePath = path.join(cwd, noDefaultRelative);
    for (let attempt = 0; attempt < 20; attempt++) {
      openLog = await readFile(openCommandLog, "utf8").catch(() => "");
      if (openLog.includes(`gio\tlaunch\tfake-text-editor.desktop\t${fallbackAbsolutePath}`)) break;
      await delay(50);
    }
    assert.ok(openLog.includes(`gio\tlaunch\tfake-text-editor.desktop\t${fallbackAbsolutePath}`), "default editor fallback should invoke the text/plain editor for the requested file");
  }

  const savedFile = await request("127.0.0.1", "/api/files/content", {
    method: "POST",
    body: { tab: tabId, path: viewerRelative, content: "updated from WebUI\n", mtimeMs: textContent.body?.data?.mtimeMs },
  });
  assert.equal(savedFile.status, 200, `file save should succeed from localhost: ${savedFile.body?.error || ""}`);
  assert.equal(await readFile(path.join(cwd, viewerRelative), "utf8"), "updated from WebUI\n", "file save endpoint should write UTF-8 text content");

  const moveUnconfirmed = await request("127.0.0.1", "/api/files/move", { method: "POST", body: { tab: tabId, path: movableFileRelative, toPath: movedFileRelative } });
  assert.equal(moveUnconfirmed.status, 409, "file moves require explicit confirmation");

  const moveFile = await request("127.0.0.1", "/api/files/move", { method: "POST", body: { tab: tabId, path: movableFileRelative, toPath: movedFileRelative, confirmed: true } });
  assert.equal(moveFile.status, 200, `file move should succeed from localhost: ${moveFile.body?.error || ""}`);
  assert.equal(moveFile.body?.data?.destination, movedFileRelative, "move endpoint should report the new relative file path");
  assert.equal(await readFile(path.join(cwd, movedFileRelative), "utf8"), "move me\n", "move endpoint should relocate file contents");
  assert.equal(await pathExists(path.join(cwd, movableFileRelative)), false, "move endpoint should remove the original file path");

  const moveDirectory = await request("127.0.0.1", "/api/files/move", { method: "POST", body: { tab: tabId, path: movableDirectoryRelative, toPath: "files-fixture/docs", confirmed: true } });
  assert.equal(moveDirectory.status, 200, `directory move should succeed from localhost: ${moveDirectory.body?.error || ""}`);
  assert.equal(moveDirectory.body?.data?.destination, movedDirectoryRelative, "moving to an existing directory should place the source under that directory");
  assert.equal(await readFile(path.join(cwd, movedDirectoryRelative, "nested.txt"), "utf8"), "nested move\n", "move endpoint should relocate directory contents");
  assert.equal(await pathExists(path.join(cwd, movableDirectoryRelative)), false, "directory move endpoint should remove the original directory path");

  const moveExistingDestination = await request("127.0.0.1", "/api/files/move", { method: "POST", body: { tab: tabId, path: movedFileRelative, toPath: markdownRelative, confirmed: true } });
  assert.equal(moveExistingDestination.status, 409, "move endpoint should refuse to overwrite an existing destination");

  const deleteUnconfirmed = await request("127.0.0.1", "/api/files", { method: "DELETE", body: { tab: tabId, path: deleteFileRelative } });
  assert.equal(deleteUnconfirmed.status, 409, "file deletes require explicit confirmation");

  const deleteFile = await request("127.0.0.1", "/api/files", { method: "DELETE", body: { tab: tabId, path: deleteFileRelative, confirmed: true } });
  assert.equal(deleteFile.status, 200, `file delete should succeed from localhost: ${deleteFile.body?.error || ""}`);
  assert.equal(deleteFile.body?.data?.deleted, true, "delete endpoint should report successful file deletion");
  assert.equal(await pathExists(path.join(cwd, deleteFileRelative)), false, "delete endpoint should remove regular files");

  const deleteDirectory = await request("127.0.0.1", "/api/files", { method: "DELETE", body: { tab: tabId, path: deleteDirectoryRelative, confirmed: true } });
  assert.equal(deleteDirectory.status, 200, `directory delete should succeed from localhost: ${deleteDirectory.body?.error || ""}`);
  assert.equal(deleteDirectory.body?.data?.type, "directory", "delete endpoint should report directory deletions");
  assert.equal(await pathExists(path.join(cwd, deleteDirectoryRelative)), false, "delete endpoint should remove directories recursively");

  const deleteWorkspaceRoot = await request("127.0.0.1", "/api/files", { method: "DELETE", body: { tab: tabId, path: "", confirmed: true } });
  assert.equal(deleteWorkspaceRoot.status, 400, "delete endpoint must refuse deleting the active workspace root");

  const binaryContent = await request("127.0.0.1", `/api/files/content?tab=${encodeURIComponent(tabId)}&path=${encodeURIComponent(binaryRelative)}`);
  assert.equal(binaryContent.status, 415, "binary files should be rejected by the WebUI file viewer");
  assert.match(String(binaryContent.body?.error || ""), /binary/i);

  const oversizedContent = await request("127.0.0.1", `/api/files/content?tab=${encodeURIComponent(tabId)}&path=${encodeURIComponent(largeRelative)}`);
  assert.equal(oversizedContent.status, 413, "oversized files should be rejected by the WebUI file viewer");
  assert.match(String(oversizedContent.body?.error || ""), /too large/i);

  const outsideRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-files-outside-"));
  try {
    const outsideFile = path.join(outsideRoot, "outside.txt");
    await writeFile(outsideFile, "outside\n", "utf8");
    const outsideAbsolute = await request("127.0.0.1", `/api/files/content?tab=${encodeURIComponent(tabId)}&path=${encodeURIComponent(outsideFile)}`);
    assert.equal(outsideAbsolute.status, 403, "absolute paths outside the active tab cwd should be rejected");
    assert.match(String(outsideAbsolute.body?.error || ""), /active tab working directory/i);

    const outsideDelete = await request("127.0.0.1", "/api/files", { method: "DELETE", body: { tab: tabId, path: outsideFile, confirmed: true } });
    assert.equal(outsideDelete.status, 403, "delete endpoint should reject absolute paths outside the active tab cwd");

    const outsideMoveDestination = await request("127.0.0.1", "/api/files/move", { method: "POST", body: { tab: tabId, path: movedFileRelative, toPath: outsideFile, confirmed: true } });
    assert.equal(outsideMoveDestination.status, 403, "move endpoint should reject destinations outside the active tab cwd");

    const symlinkPath = path.join(filesRoot, "outside-link.txt");
    try {
      await symlink(outsideFile, symlinkPath);
      const symlinkEscape = await request("127.0.0.1", `/api/files/content?tab=${encodeURIComponent(tabId)}&path=${encodeURIComponent("files-fixture/outside-link.txt")}`);
      assert.equal(symlinkEscape.status, 403, "symlinks resolving outside the active tab cwd should be rejected");
      assert.match(String(symlinkEscape.body?.error || ""), /escapes the active tab working directory/i);
    } catch (error) {
      if (!["EPERM", "EACCES", "EINVAL", "ENOTSUP"].includes(error?.code)) throw error;
      console.log(`http-endpoints-harness: symlink unavailable (${error.code}); skipping file symlink confinement check`);
    }
  } finally {
    await rmWithRetry(outsideRoot);
  }

  const filesTab = await request("127.0.0.1", "/api/tabs", { method: "POST", body: { cwd: filesRoot, title: "files-fixture" } });
  assert.equal(filesTab.status, 201, `file fixture tab should open: ${filesTab.body?.error || ""}`);
  const filesTabId = filesTab.body?.data?.tab?.id;
  assert.ok(filesTabId, "file fixture tab should have an id");
  const scopedFileContent = await request("127.0.0.1", `/api/files/content?tab=${encodeURIComponent(filesTabId)}&path=${encodeURIComponent("viewer.txt")}`);
  assert.equal(scopedFileContent.status, 200, "file paths should resolve against the requested tab cwd");
  const wrongTabContent = await request("127.0.0.1", `/api/files/content?tab=${encodeURIComponent(tabId)}&path=${encodeURIComponent("viewer.txt")}`);
  assert.equal(wrongTabContent.status, 404, "file paths should not bleed across tab cwd scopes");
  const closeFilesTab = await request("127.0.0.1", "/api/tabs/close", { method: "POST", body: { ids: [filesTabId] }, timeoutMs: 10_000 });
  assert.equal(closeFilesTab.status, 200, "file fixture tab should close after scoped file checks");

  // Natural Conversation shell: /talk availability drives per-tab status and safety guards.
  const conversationFeature = await request("127.0.0.1", `/api/features/natural-conversation?tab=${encodeURIComponent(tabId)}`);
  assert.equal(conversationFeature.status, 200);
  assert.equal(conversationFeature.body?.data?.available, true, "fake /talk command should make Natural Conversation available");
  assert.ok(conversationFeature.body?.data?.commands?.includes("talk"), "Natural Conversation feature data should expose loaded /talk commands");
  assert.equal(conversationFeature.body?.data?.mode?.enabled, false, "Natural Conversation should start disabled per tab");

  const conversationVoices = await request("127.0.0.1", `/api/conversation-voices?tab=${encodeURIComponent(tabId)}`);
  assert.equal(conversationVoices.status, 200);
  assert.ok(Array.isArray(conversationVoices.body?.data?.voices), "conversation-voices should return a voices array");
  assert.ok(
    conversationVoices.body.data.voices.some((voice) => voice.id === "de_DE-thorsten-medium"),
    "conversation-voices should include the mirrored Piper catalog",
  );
  const badVoice = await request("127.0.0.1", "/api/conversation-voice", {
    method: "POST",
    body: { voice: "../etc/passwd; rm -rf", tab: tabId },
  });
  assert.equal(badVoice.status, 400, "conversation-voice must reject ids that are not plain voice names");

  const conversationOn = await request("127.0.0.1", "/api/conversation-mode", {
    method: "POST",
    body: { enabled: true, tab: tabId },
  });
  assert.equal(conversationOn.status, 200, `conversation-mode on should succeed: ${conversationOn.body?.error || ""}`);
  assert.equal(conversationOn.body?.data?.mode?.enabled, true, "conversation-mode on should update tab-local mode state");
  assert.equal(conversationOn.body?.tab?.conversationMode?.enabled, true, "conversation mode should be included in returned tab metadata");

  const conversationState = await request("127.0.0.1", `/api/state?tab=${encodeURIComponent(tabId)}`);
  assert.equal(conversationState.status, 200);
  assert.equal(conversationState.body?.data?.thinkingLevel, "off", "Natural Conversation shell should keep thinking forced off");

  const blockedSlash = await request("127.0.0.1", "/api/prompt", { method: "POST", body: { message: "/copy", tab: tabId } });
  assert.equal(blockedSlash.status, 409, "non-/talk slash commands should be blocked while Natural Conversation is active");
  assert.match(String(blockedSlash.body?.error || ""), /Natural Conversation Mode is active; slash commands are blocked/);

  const blockedSettings = await request("127.0.0.1", "/api/settings", { method: "POST", body: { thinkingLevel: "high", tab: tabId } });
  assert.equal(blockedSettings.status, 409, "settings changes should be blocked while Natural Conversation is active");
  assert.match(String(blockedSettings.body?.error || ""), /settings changes are blocked/);

  const blockedBash = await request("127.0.0.1", "/api/bash", { method: "POST", body: { command: "echo blocked", tab: tabId } });
  assert.equal(blockedBash.status, 409, "user bash should be blocked while Natural Conversation is active");
  assert.match(String(blockedBash.body?.error || ""), /bash is blocked|Natural Conversation Mode is active/);

  const blockedFileSave = await request("127.0.0.1", "/api/files/content", { method: "POST", body: { tab: tabId, path: viewerRelative, content: "blocked by conversation mode\n" } });
  assert.equal(blockedFileSave.status, 409, "file edits should be blocked while Natural Conversation is active");
  assert.equal(blockedFileSave.body?.error, "file edits are blocked");

  const blockedFileDelete = await request("127.0.0.1", "/api/files", { method: "DELETE", body: { tab: tabId, path: viewerRelative, confirmed: true } });
  assert.equal(blockedFileDelete.status, 409, "file deletes should be blocked while Natural Conversation is active");
  assert.match(String(blockedFileDelete.body?.error || ""), /file deletion is blocked/i);

  const blockedFileMove = await request("127.0.0.1", "/api/files/move", { method: "POST", body: { tab: tabId, path: viewerRelative, toPath: "files-fixture/blocked-move.txt", confirmed: true } });
  assert.equal(blockedFileMove.status, 409, "file moves should be blocked while Natural Conversation is active");
  assert.match(String(blockedFileMove.body?.error || ""), /file moves are blocked/i);

  const allowedConversationPrompt = await request("127.0.0.1", "/api/prompt", { method: "POST", body: { message: "Explain the current repo briefly", tab: tabId } });
  assert.equal(allowedConversationPrompt.status, 200, "ordinary prompts remain allowed while Natural Conversation is active");

  const localStt = await request("127.0.0.1", "/api/stt/transcribe", { method: "POST", body: { tab: tabId, provider: "local", mimeType: "audio/webm", audioBase64: Buffer.from("fake audio").toString("base64") } });
  assert.equal(localStt.status, 200, `local STT fallback should transcribe through the configured endpoint: ${localStt.body?.error || ""}`);
  assert.equal(localStt.body?.data?.provider, "local");
  assert.equal(localStt.body?.data?.text, "fake transcript from local stt");
  assert.ok(voiceProviderRequests.some((item) => item.url === "/stt" && /multipart\/form-data/.test(String(item.contentType || ""))), "local STT should receive a multipart audio upload");

  const localTts = await request("127.0.0.1", "/api/tts/speech", { method: "POST", body: { tab: tabId, provider: "local", text: "Say this aloud" } });
  assert.equal(localTts.status, 200, `local TTS fallback should synthesize through the configured endpoint: ${localTts.body?.error || ""}`);
  assert.equal(localTts.body?.data?.provider, "local");
  assert.equal(localTts.body?.data?.contentType, "audio/mpeg");
  assert.equal(Buffer.from(localTts.body?.data?.audioBase64 || "", "base64").toString("utf8"), "fake mp3 bytes");
  assert.ok(voiceProviderRequests.some((item) => item.url === "/tts" && /application\/json/.test(String(item.contentType || ""))), "local TTS should receive a JSON text synthesis request");

  const conversationOff = await request("127.0.0.1", "/api/conversation-mode", {
    method: "POST",
    body: { enabled: false, tab: tabId },
  });
  assert.equal(conversationOff.status, 200, `conversation-mode off should succeed: ${conversationOff.body?.error || ""}`);
  assert.equal(conversationOff.body?.data?.mode?.enabled, false, "conversation-mode off should restore normal WebUI actions");

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

    const remoteSttWithoutConsent = await request(lan, "/api/stt/transcribe", {
      method: "POST",
      body: { tab: tabId, provider: "local", mimeType: "audio/webm", audioBase64: Buffer.from("fake remote audio").toString("base64") },
    });
    assert.equal(remoteSttWithoutConsent.status, 403, "remote STT uploads must require explicit microphone streaming consent");
    assert.match(String(remoteSttWithoutConsent.body?.error || ""), /explicit.*remote microphone streaming consent/i);

    const remoteSttWithConsent = await request(lan, "/api/stt/transcribe", {
      method: "POST",
      body: { tab: tabId, provider: "local", mimeType: "audio/webm", audioBase64: Buffer.from("fake remote audio").toString("base64"), remoteMicStreamingConsentAccepted: true },
    });
    assert.equal(remoteSttWithConsent.status, 200, "remote STT uploads should proceed after explicit per-request consent");
    assert.equal(remoteSttWithConsent.body?.data?.text, "fake transcript from local stt");

    const remoteDelete = await request(lan, "/api/session-delete", {
      method: "POST",
      body: { sessionPath: path.join(cwd, "outside.jsonl"), confirmed: true, tab: tabId },
    });
    assert.equal(remoteDelete.status, 403, "session delete must be localhost-only");

    const remoteFileSave = await request(lan, "/api/files/content", {
      method: "POST",
      body: { tab: tabId, path: viewerRelative, content: "remote save should be blocked\n" },
    });
    assert.equal(remoteFileSave.status, 403, "file saves must be localhost-only");

    const remoteFileOpenDefault = await request(lan, "/api/files/open-default", {
      method: "POST",
      body: { tab: tabId, path: viewerRelative },
    });
    assert.equal(remoteFileOpenDefault.status, 403, "opening files in the default editor must be localhost-only");

    const remoteFileDelete = await request(lan, "/api/files", {
      method: "DELETE",
      body: { tab: tabId, path: viewerRelative, confirmed: true },
    });
    assert.equal(remoteFileDelete.status, 403, "file deletes must be localhost-only");

    const remoteFileMove = await request(lan, "/api/files/move", {
      method: "POST",
      body: { tab: tabId, path: viewerRelative, toPath: "files-fixture/remote-move.txt", confirmed: true },
    });
    assert.equal(remoteFileMove.status, 403, "file moves must be localhost-only");

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
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await new Promise((resolve) => voiceProvider.close(() => resolve()));
  await rmWithRetry(cwd);
  await rmWithRetry(harnessSideEffectsRoot);
}

console.log("http-endpoints-harness.test.mjs passed");
