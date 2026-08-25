import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(packageRoot, "bin", "pi-webui.mjs");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-guided-git-native-"));
const fakePi = path.join(temporaryRoot, "fake-guided-git-pi.mjs");

await writeFile(fakePi, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const scenario = process.env.GUIDED_GIT_SCENARIO || "success";
const logFile = process.env.GUIDED_GIT_LOG_FILE;
const artifactRoot = process.env.GUIDED_GIT_ARTIFACT_ROOT;
let activeModel = { provider: "fake", id: "original" };
let thinkingLevel = "high";
function log(value) { appendFileSync(logFile, JSON.stringify(value) + "\\n"); }
function send(value) { process.stdout.write(JSON.stringify(value) + "\\n"); }
function writeCommitArtifacts(prefix) {
  const directory = join(artifactRoot, "dev", "COMMIT");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "staged-commit-short.txt"), "feat: " + prefix + " native generation\\n");
  writeFileSync(join(directory, "staged-commit-long.txt"), "feat: " + prefix + " native generation\\n- feat: verify direct RPC artifact completion\\n");
}
function writeBranchArtifact() {
  const directory = join(artifactRoot, "dev", "COMMIT");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "staged-branch-name.txt"), "feat/native-root-artifacts\\n");
}
const models = [
  { provider: "fake", id: "original", name: "Original", reasoning: true },
  { provider: "fake", id: "primary", name: "Primary", reasoning: true },
  { provider: "fake", id: "fallback", name: "Fallback", reasoning: false },
];
createInterface({ input: process.stdin }).on("line", async (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (!command?.id || !command?.type) return;
  log({ type: command.type, modelId: command.modelId, level: command.level, message: command.message, activeModel: activeModel.id });
  const response = { type: "response", id: command.id, command: command.type, success: true };
  switch (command.type) {
    case "get_state":
      send({ ...response, data: { model: activeModel, thinkingLevel, isStreaming: false, isCompacting: false, pendingMessageCount: 0, sessionId: "fixture", sessionName: "fixture" } });
      break;
    case "get_available_models":
      send({ ...response, data: { models } });
      break;
    case "get_commands":
      send({ ...response, data: { commands: [
        { name: "git-staged-msg", source: scenario === "prompt-only" ? "prompt" : "extension" },
        { name: "git-branch-name", source: "extension" },
        { name: "pr", source: "extension" },
      ] } });
      break;
    case "get_messages":
      send({ ...response, data: { messages: [] } });
      break;
    case "set_model":
      activeModel = { provider: command.provider, id: command.modelId };
      send({ ...response, data: activeModel });
      break;
    case "set_thinking_level":
      thinkingLevel = command.level;
      send({ ...response, data: { level: thinkingLevel } });
      break;
    case "prompt":
      if (scenario === "process-loss") process.exit(12);
      if (scenario === "concurrent" || scenario === "cancellation") await new Promise((resolve) => setTimeout(resolve, 150));
      if (scenario === "provider-failure" && activeModel.id === "primary") {
        send({ ...response, success: false, error: "FIRSTPICK_GUIDED_GIT_PROVIDER_FAILURE: active model generation failed" });
        break;
      }
      if (scenario === "invalid-output") {
        send({ ...response, success: false, error: "Generated commit output did not match the closed format" });
        break;
      }
      if (scenario === "missing-base") {
        send({ ...response, success: false, error: "No configured upstream base, remote default, main, or master branch is available" });
        break;
      }
      if (scenario === "git-failure") {
        send({ ...response, success: false, error: "Git command failed while reading staged changes" });
        break;
      }
      if (!["unsafe-stale-artifact", "cancellation"].includes(scenario)) {
        if (String(command.message || "").startsWith("/git-branch-name")) writeBranchArtifact();
        else writeCommitArtifacts(activeModel.id);
      }
      send({ ...response, data: { output: "native extension command completed" } });
      break;
    case "abort":
      send({ ...response, data: { output: "abort acknowledged" } });
      break;
    default:
      send({ ...response, data: {} });
  }
});
`, "utf8");
await chmod(fakePi, 0o755);

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(40);
  }
  assert.fail(message);
}

function parseLog(text) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function runScenario(scenario, verify) {
  const cwd = path.join(temporaryRoot, scenario);
  const settingsFile = path.join(cwd, "settings.json");
  const logFile = path.join(cwd, "rpc.jsonl");
  await mkdir(cwd, { recursive: true });
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Native RPC Test");
  git(cwd, "config", "user.email", "native-rpc@example.invalid");
  await writeFile(path.join(cwd, "tracked.txt"), "base\n");
  git(cwd, "add", "--", "tracked.txt");
  git(cwd, "commit", "-m", "test: initial");
  await writeFile(path.join(cwd, "tracked.txt"), "staged native change\n");
  git(cwd, "add", "--", "tracked.txt");
  if (scenario === "unsafe-stale-artifact") {
    const artifactDirectory = path.join(cwd, "dev", "COMMIT");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, "staged-commit-short.txt"), "feat: stale native generation\n");
    await writeFile(path.join(artifactDirectory, "staged-commit-long.txt"), "feat: stale native generation\n- feat: preserve the old artifact\n");
  }
  await writeFile(settingsFile, `${JSON.stringify({
    version: 8,
    gitWorkflow: {
      generation: {
        provider: "fake",
        modelId: "primary",
        thinkingLevel: "low",
        unavailablePolicy: "ask",
        fallback: { provider: "fake", modelId: "fallback", thinkingLevel: "off" },
      },
    },
  }, null, 2)}\n`, "utf8");

  const tabCwd = scenario === "nested-cwd" ? path.join(cwd, "nested", "tab") : cwd;
  await mkdir(tabCwd, { recursive: true });
  const port = await availablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverScript, "--cwd", tabCwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_WEBUI_SETTINGS_FILE: settingsFile,
      GUIDED_GIT_SCENARIO: scenario,
      GUIDED_GIT_LOG_FILE: logFile,
      GUIDED_GIT_ARTIFACT_ROOT: cwd,
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const request = async (pathname, { method = "GET", body, timeoutMs = 8_000 } = {}) => {
    const response = await fetch(`${baseURL}${pathname}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await waitFor(async () => {
      try { return (await request("/api/health", { timeoutMs: 1_000 })).status === 200; } catch { return false; }
    }, `server did not start for ${scenario}:\n${output}`, 30_000);
    const readLog = async () => parseLog(await readFile(logFile, "utf8").catch(() => ""));
    await verify({ request, readLog, cwd, tabCwd });
  } finally {
    child.kill("SIGTERM");
    await delay(120);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

try {
  await runScenario("success", async ({ request, readLog, cwd }) => {
    const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.message, "/git-staged-msg en auto");
    assert.equal(result.body.data.fallbackUsed, false);
    assert.equal(await readFile(path.join(cwd, "dev", "COMMIT", "staged-commit-short.txt"), "utf8"), "feat: primary native generation\n");
    const correlated = await request(`/api/git-workflow/message?generationId=${encodeURIComponent(result.body.data.generationId)}`);
    assert.equal(correlated.body.data.ready, true);
    const log = await readLog();
    assert.ok(log.some((entry) => entry.type === "get_commands"));
    assert.equal(log.filter((entry) => entry.type === "prompt").length, 1);
    const primary = log.findIndex((entry) => entry.type === "set_model" && entry.modelId === "primary");
    const restore = log.findIndex((entry) => entry.type === "set_model" && entry.modelId === "original");
    assert.ok(primary >= 0 && restore > primary, "the active model must be restored after native artifact verification");
  });

  await runScenario("nested-cwd", async ({ request, cwd, tabCwd }) => {
    const commit = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
    assert.equal(commit.status, 200);
    const messages = await request(`/api/git-workflow/message?generationId=${encodeURIComponent(commit.body.data.generationId)}`);
    assert.equal(messages.body.data.ready, true);
    assert.equal(messages.body.data.root, cwd);
    assert.equal(messages.body.data.cwd, cwd);
    assert.equal(messages.body.data.shortPath, path.join(cwd, "dev", "COMMIT", "staged-commit-short.txt"));
    await assert.rejects(readFile(path.join(tabCwd, "dev", "COMMIT", "staged-commit-short.txt"), "utf8"));

    const branch = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "branch" } });
    assert.equal(branch.status, 200);
    const branchArtifact = await request(`/api/git-workflow/branch-name?generationId=${encodeURIComponent(branch.body.data.generationId)}`);
    assert.equal(branchArtifact.status, 200);
    assert.equal(branchArtifact.body.data.root, cwd);
    assert.equal(branchArtifact.body.data.cwd, cwd);
    assert.equal(branchArtifact.body.data.branchPath, path.join(cwd, "dev", "COMMIT", "staged-branch-name.txt"));
    assert.equal(branchArtifact.body.data.branch, "feat/native-root-artifacts");
    await assert.rejects(readFile(path.join(tabCwd, "dev", "COMMIT", "staged-branch-name.txt"), "utf8"));
  });

  await runScenario("provider-failure", async ({ request, readLog, cwd }) => {
    const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.fallbackUsed, true);
    assert.equal(await readFile(path.join(cwd, "dev", "COMMIT", "staged-commit-short.txt"), "utf8"), "feat: fallback native generation\n");
    const log = await readLog();
    assert.deepEqual(log.filter((entry) => entry.type === "prompt").map((entry) => entry.activeModel), ["primary", "fallback"]);
    assert.equal(log.filter((entry) => entry.type === "set_model" && entry.modelId === "fallback").length, 1);
    assert.equal(log.filter((entry) => entry.type === "set_model" && entry.modelId === "original").length, 1);
  });

  for (const [scenario, kind, expectedError] of [
    ["invalid-output", "commit", /did not match the closed format/iu],
    ["missing-base", "pr", /No configured upstream base/iu],
    ["git-failure", "commit", /Git command failed while reading staged changes/iu],
    ["unsafe-stale-artifact", "commit", /message files? to be refreshed/iu],
  ]) {
    await runScenario(scenario, async ({ request, readLog }) => {
      const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind } });
      assert.notEqual(result.status, 200, `${scenario} must remain terminal without fallback`);
      assert.match(result.body.error, expectedError);
      const log = await readLog();
      assert.deepEqual(log.filter((entry) => entry.type === "prompt").map((entry) => entry.activeModel), ["primary"]);
      assert.equal(log.filter((entry) => entry.type === "set_model" && entry.modelId === "fallback").length, 0);
    });
  }

  await runScenario("cancellation", async ({ request, readLog }) => {
    const generation = request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
    await waitFor(async () => (await readLog()).some((entry) => entry.type === "prompt"), "native generation did not reach the cancellation barrier");
    const cancelled = await request("/api/git-workflow/cancel", { method: "POST", body: {} });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.cancelled, true);
    assert.notEqual((await generation).status, 200);
    const log = await readLog();
    assert.deepEqual(log.filter((entry) => entry.type === "prompt").map((entry) => entry.activeModel), ["primary"]);
    assert.equal(log.filter((entry) => entry.type === "set_model" && entry.modelId === "fallback").length, 0);
  });

  await runScenario("process-loss", async ({ request, readLog }) => {
    const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
    assert.notEqual(result.status, 200);
    const log = await readLog();
    assert.deepEqual(log.filter((entry) => entry.type === "prompt").map((entry) => entry.activeModel), ["primary"]);
    assert.equal(log.filter((entry) => entry.type === "set_model" && entry.modelId === "fallback").length, 0);
  });

  await runScenario("prompt-only", async ({ request, readLog }) => {
    const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /extension command.*Same-named prompt templates are not used/iu);
    const log = await readLog();
    assert.equal(log.filter((entry) => entry.type === "set_model" || entry.type === "prompt").length, 0);
  });

  await runScenario("concurrent", async ({ request, readLog }) => {
    const [left, right] = await Promise.all([
      request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } }),
      request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } }),
    ]);
    assert.deepEqual([left.status, right.status].sort((a, b) => a - b), [200, 409]);
    assert.equal((await readLog()).filter((entry) => entry.type === "prompt").length, 1);
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
