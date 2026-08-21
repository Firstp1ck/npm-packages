import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(packageRoot, "bin", "pi-webui.mjs");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-guided-git-fallback-"));
const fakePi = path.join(temporaryRoot, "fake-guided-git-pi.mjs");

await writeFile(fakePi, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const scenario = process.env.GUIDED_GIT_SCENARIO || "settled-success";
const logFile = process.env.GUIDED_GIT_LOG_FILE;
const artifactRoot = process.env.GUIDED_GIT_ARTIFACT_ROOT;
let activeModel = { provider: "fake", id: "original" };
let thinkingLevel = "high";
function log(value) { appendFileSync(logFile, JSON.stringify(value) + "\\n"); }
function send(value) { process.stdout.write(JSON.stringify(value) + "\\n"); }
function event(value) { log({ direction: "event", ...value }); send(value); }
function assistantFailure() { return { role: "assistant", stopReason: "error", content: [{ type: "text", text: "fixture failure" }] }; }
function writeCommitArtifacts(prefix) {
  const directory = join(artifactRoot, "dev", "COMMIT");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "staged-commit-short.txt"), prefix + " short\\n");
  writeFileSync(join(directory, "staged-commit-long.txt"), prefix + " long\\n");
}
function settle({ failed = false, wait = 20 } = {}) {
  setTimeout(() => {
    event({ type: "agent_start" });
    if (failed) {
      const message = assistantFailure();
      event({ type: "message_end", message });
      event({ type: "agent_end", willRetry: false, messages: [message] });
    } else {
      event({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "fixture success" }] } });
      event({ type: "agent_end" });
    }
    event({ type: "agent_settled" });
  }, wait);
}
function settleAfterInternalRetry() {
  setTimeout(() => {
    const first = assistantFailure();
    event({ type: "agent_start" });
    event({ type: "message_end", message: first });
    event({ type: "agent_end", willRetry: true, messages: [first] });
    const final = assistantFailure();
    event({ type: "agent_start" });
    event({ type: "message_end", message: final });
    event({ type: "agent_end", willRetry: false, messages: [final] });
    event({ type: "agent_settled" });
  }, 20);
}
const models = [
  { provider: "fake", id: "original", name: "Original", reasoning: true },
  { provider: "fake", id: "primary", name: "Primary", reasoning: true },
  { provider: "fake", id: "fallback", name: "Fallback", reasoning: false },
];
createInterface({ input: process.stdin }).on("line", (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (!command?.id || !command?.type) return;
  log({ direction: "command", type: command.type, provider: command.provider, modelId: command.modelId, level: command.level, message: command.message, activeModel: activeModel.id, thinkingLevel });
  const response = { type: "response", id: command.id, command: command.type, success: true };
  switch (command.type) {
    case "get_state":
      send({ ...response, data: { model: activeModel, thinkingLevel, isStreaming: false, isCompacting: false, pendingMessageCount: 0, sessionId: "fixture", sessionName: "fixture" } });
      break;
    case "get_available_models":
      send({ ...response, data: { models } });
      break;
    case "get_commands":
      send({ ...response, data: { commands: [] } });
      break;
    case "get_messages":
      send({ ...response, data: { messages: [] } });
      break;
    case "set_model": {
      if ((scenario === "immediate-selection" || scenario === "immediate-double-failure") && command.modelId === "primary") {
        send({ ...response, success: false, error: "SECRET primary selection failure at /private/provider/file.mjs:42" });
      } else if ((scenario === "cancel-during-fallback-selection" && command.modelId === "fallback")
        || (scenario === "cancel-during-primary-selection" && command.modelId === "primary")) {
        setTimeout(() => {
          activeModel = { provider: command.provider, id: command.modelId };
          send({ ...response, data: activeModel });
        }, 350);
      } else {
        activeModel = { provider: command.provider, id: command.modelId };
        send({ ...response, data: activeModel });
      }
      break;
    }
    case "set_thinking_level":
      if (scenario === "immediate-thinking" && activeModel.id === "primary" && command.level === "low") {
        send({ ...response, success: false, error: "fixture primary effort failure" });
      } else {
        thinkingLevel = command.level;
        send({ ...response, data: { level: thinkingLevel } });
      }
      break;
    case "prompt": {
      const model = activeModel.id;
      if ((scenario === "fallback-prompt-failure" || scenario === "immediate-double-failure") && model === "fallback") {
        send({ ...response, success: false, error: "SECRET fallback rejection at /private/provider/file.mjs:99" });
        break;
      }
      if (scenario === "immediate-prompt" && model === "primary") {
        send({ ...response, success: false, error: "fixture primary prompt failure" });
        break;
      }
      if (scenario === "settlement-before-response" && model === "primary") {
        const message = assistantFailure();
        event({ type: "agent_start" });
        event({ type: "message_end", message });
        event({ type: "agent_end", willRetry: false, messages: [message] });
        event({ type: "agent_settled" });
        setTimeout(() => send({ ...response, data: { output: "late prompt acknowledgement" } }), 80);
        break;
      }
      send({ ...response, data: { output: "fixture prompt accepted" } });
      if (scenario === "process-loss" && model === "primary") {
        event({ type: "agent_start" });
        setTimeout(() => process.exit(7), 30);
        break;
      }
      if (scenario === "will-retry-final-failure" && model === "primary") {
        settleAfterInternalRetry();
        break;
      }
      if (scenario === "artifact-primary-then-fallback" && model === "primary") {
        writeCommitArtifacts("primary");
        settle({ failed: true });
        break;
      }
      if (scenario === "artifact-primary-then-fallback" && model === "fallback") {
        setTimeout(() => writeCommitArtifacts("fallback"), 180);
        settle({ failed: false, wait: 230 });
        break;
      }
      const fallbackFailsAfterAcceptance = scenario === "fallback-settled-failure" && model === "fallback";
      const primaryFails = model === "primary" && !["concurrent", "primary-success"].includes(scenario);
      settle({ failed: fallbackFailsAfterAcceptance || primaryFails });
      break;
    }
    default:
      send({ ...response, data: {} });
  }
});
`, "utf8");
await chmod(fakePi, 0o755);

function lines(text) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitFor(check, message, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(40);
  }
  assert.fail(message);
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
  assert.ok(port > 0, "the OS should allocate a test server port");
  return port;
}

async function readReplayedLifecycle(baseURL) {
  const controller = new AbortController();
  const response = await fetch(`${baseURL}/api/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const events = [];
  const deadline = Date.now() + 3_000;
  try {
    while (Date.now() < deadline && events.length < 2) {
      const result = await Promise.race([
        reader.read(),
        delay(500).then(() => ({ timeout: true })),
      ]);
      if (result.timeout) continue;
      if (result.done) break;
      text += decoder.decode(result.value, { stream: true });
      const frames = text.split("\n\n");
      text = frames.pop() || "";
      for (const frame of frames) {
        const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (!data) continue;
        const event = JSON.parse(data);
        if (String(event.type || "").startsWith("webui_git_workflow_generation_fallback_")) events.push(event);
      }
    }
  } finally {
    controller.abort();
  }
  return events;
}

async function runScenario(scenario, verify) {
  const cwd = path.join(temporaryRoot, scenario);
  const settingsFile = path.join(cwd, "settings.json");
  const logFile = path.join(cwd, "rpc.jsonl");
  await mkdir(cwd, { recursive: true });
  const git = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
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
  if (scenario === "artifact-primary-then-fallback") {
    await mkdir(path.join(cwd, "dev", "COMMIT"), { recursive: true });
    await writeFile(path.join(cwd, "dev", "COMMIT", "staged-commit-short.txt"), "baseline short\n");
    await writeFile(path.join(cwd, "dev", "COMMIT", "staged-commit-long.txt"), "baseline long\n");
  }
  const port = await availablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
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
  const request = async (pathname, { method = "GET", body, timeoutMs = 5_000 } = {}) => {
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
      try { return (await request("/api/health")).status === 200; } catch { return false; }
    }, `server did not start for ${scenario}:\n${output}`, 20_000);
    const readLog = async () => lines(await readFile(logFile, "utf8").catch(() => ""));
    await verify({ request, readLog, baseURL, output: () => output });
  } finally {
    child.kill("SIGTERM");
    await delay(120);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

await runScenario("concurrent", async ({ request, readLog }) => {
  const [left, right] = await Promise.all([
    request("/api/git-workflow/generate", { method: "POST", body: { kind: "branch" } }),
    request("/api/git-workflow/generate", { method: "POST", body: { kind: "branch" } }),
  ]);
  assert.deepEqual([left.status, right.status].sort((a, b) => a - b), [200, 409], "one concurrent request must own the tab and one must be rejected");
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "original"), "the accepted generation should settle and restore");
  assert.equal((await readLog()).filter((entry) => entry.type === "prompt").length, 1, "concurrent requests must dispatch exactly one prompt");
});

await runScenario("immediate-selection", async ({ request, readLog }) => {
  const invalidKind = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "invalid" } });
  assert.equal(invalidKind.status, 400);
  assert.equal((await readLog()).filter((entry) => entry.type === "set_model").length, 0);
  const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.fallbackUsed, true);
  assert.match(result.body.data.generationId, /^[0-9a-f-]{36}$/i);
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "original"), "immediate fallback should restore");
  const restoredLog = await readLog();
  const restoredModelIndex = restoredLog.findIndex((entry) => entry.type === "set_model" && entry.modelId === "original");
  const restoredEffortIndex = restoredLog.findIndex((entry, index) => index > restoredModelIndex && entry.type === "set_thinking_level" && entry.level === "high");
  assert.ok(restoredModelIndex >= 0 && restoredEffortIndex > restoredModelIndex, "restoration should reapply the original reasoning effort after the original model");
  assert.equal(restoredLog.filter((entry) => entry.type === "prompt").length, 1);
});

for (const scenario of ["immediate-thinking", "immediate-prompt"]) {
  await runScenario(scenario, async ({ request, readLog }) => {
    const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "branch" } });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.fallbackUsed, true);
    assert.match(result.body.data.generationId, /^[0-9a-f-]{36}$/i, "every generation kind must receive a server ID");
    await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "original"), `${scenario} should restore`);
    const prompts = (await readLog()).filter((entry) => entry.type === "prompt");
    assert.equal(prompts.filter((entry) => entry.activeModel === "fallback").length, 1);
    if (scenario === "immediate-prompt") assert.equal(prompts[0].message, prompts[1].message);
  });
}

await runScenario("will-retry-final-failure", async ({ request, readLog }) => {
  const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "pr" } });
  assert.equal(result.status, 200);
  assert.match(result.body.data.generationId, /^[0-9a-f-]{36}$/i);
  await waitFor(async () => (await readLog()).filter((entry) => entry.type === "prompt").length === 2, "fallback should run after final settlement");
  const log = await readLog();
  const retryEnd = log.findIndex((entry) => entry.type === "agent_end" && entry.willRetry === true);
  const fallbackPrompt = log.findIndex((entry) => entry.type === "prompt" && entry.activeModel === "fallback");
  assert.ok(retryEnd >= 0 && fallbackPrompt > retryEnd, "Pi internal retry must occur before server fallback");
  assert.equal(log.filter((entry) => entry.type === "prompt" && entry.activeModel === "fallback").length, 1);
});

await runScenario("settlement-before-response", async ({ request, readLog }) => {
  const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "branch" } });
  assert.equal(result.status, 200);
  await waitFor(async () => (await readLog()).filter((entry) => entry.type === "prompt").length === 2, "pending settlement must start one fallback");
  assert.equal((await readLog()).filter((entry) => entry.type === "prompt" && entry.activeModel === "fallback").length, 1);
});

await runScenario("fallback-settled-failure", async ({ request, readLog }) => {
  const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
  assert.equal(result.status, 200);
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "original"), "accepted fallback failure should restore");
  const status = await request("/api/webui-status?detailed=true&events=100");
  assert.equal(status.body.data.events.filter((event) => event.type === "webui_git_workflow_generation_fallback_failed").length, 1);
  assert.equal((await readLog()).filter((entry) => entry.type === "prompt" && entry.activeModel === "fallback").length, 1);
});

await runScenario("cancel-during-primary-selection", async ({ request, readLog }) => {
  const pending = request("/api/git-workflow/generate", { method: "POST", body: { kind: "branch" } });
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "primary"), "primary selection should be delayed");
  const cancellation = await request("/api/git-workflow/cancel", { method: "POST", body: {} });
  assert.equal(cancellation.body.data.cancelled, true);
  const result = await pending;
  assert.equal(result.status, 409);
  assert.match(result.body.error, /cancelled/i, "primary cancellation should keep its ordinary error instead of masquerading as fallback failure");
  await waitFor(async () => (await readLog()).filter((entry) => entry.type === "set_model" && entry.modelId === "original").length >= 1, "cancelled primary selection should restore");
  assert.equal((await readLog()).filter((entry) => entry.type === "prompt").length, 0, "cancelled primary selection must never dispatch a prompt");
});

await runScenario("cancel-during-fallback-selection", async ({ request, readLog }) => {
  const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "branch" } });
  assert.equal(result.status, 200);
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "fallback"), "fallback selection should be delayed");
  const cancellation = await request("/api/git-workflow/cancel", { method: "POST", body: {} });
  assert.equal(cancellation.body.data.cancelled, true);
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "original"), "cancellation should restore ownership profile");
  assert.equal((await readLog()).filter((entry) => entry.type === "prompt" && entry.activeModel === "fallback").length, 0, "cancelled fallback selection must never dispatch a prompt");
});

await runScenario("artifact-primary-then-fallback", async ({ request, readLog }) => {
  const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
  assert.equal(result.status, 200);
  const generationId = result.body.data.generationId;
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "fallback"), "fallback should begin after primary artifacts");
  const intermediate = await request(`/api/git-workflow/message?generationId=${encodeURIComponent(generationId)}`);
  assert.equal(intermediate.body.data.ready, false, "failed-primary artifacts must remain pending while fallback runs");
  assert.equal(intermediate.body.data.running, true, "the browser must be told that the correlated fallback generation is still active");
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "set_model" && entry.modelId === "original"), "fallback artifact generation should settle");
  const final = await request(`/api/git-workflow/message?generationId=${encodeURIComponent(generationId)}`);
  assert.equal(final.body.data.ready, true);
  assert.equal(final.body.data.short, "fallback short");
  assert.equal(final.body.data.long, "fallback long");
});

await runScenario("immediate-double-failure", async ({ request, baseURL }) => {
  const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "pr" } });
  assert.equal(result.status, 500);
  assert.equal(result.body.error, "Guided Git generation failed after the configured model attempts.");
  assert.match(result.body.gitWorkflowGeneration.generationId, /^[0-9a-f-]{36}$/i);
  const replayed = await readReplayedLifecycle(baseURL);
  assert.deepEqual(replayed.map((event) => event.type), [
    "webui_git_workflow_generation_fallback_started",
    "webui_git_workflow_generation_fallback_failed",
  ]);
  for (const event of replayed) {
    assert.equal(event.replayed, true);
    assert.equal(event.generationId, result.body.gitWorkflowGeneration.generationId);
    assert.doesNotMatch(JSON.stringify(event), /SECRET|private\/provider|file\.mjs/i, "lifecycle messages must be bounded and redacted");
  }
});

await runScenario("process-loss", async ({ request, readLog }) => {
  const result = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
  assert.equal(result.status, 200);
  await waitFor(async () => (await readLog()).some((entry) => entry.type === "agent_start"), "process-loss run should start");
  await delay(250);
  const log = await readLog();
  assert.equal(log.filter((entry) => entry.type === "set_model" && entry.modelId === "fallback").length, 0, "process loss must not start fallback");
  const artifact = await request(`/api/git-workflow/message?generationId=${encodeURIComponent(result.body.data.generationId)}`);
  assert.equal(artifact.body.data.ready, false);
  assert.equal(artifact.body.data.expired, true);
});

const serverSource = await readFile(serverScript, "utf8");
assert.match(serverSource, /tab\.gitWorkflowGeneration = record;[\s\S]*await assertExpectedStagedContentHash/, "tab ownership must be reserved before preflight awaits");
assert.match(serverSource, /modelResponse = await[\s\S]*assertGitWorkflowGenerationOwnership[\s\S]*thinkingResponse = await[\s\S]*assertGitWorkflowGenerationOwnership/, "profile awaits must recheck exact ownership");
assert.match(serverSource, /replayGitWorkflowFallbackLifecycle\(tab, client\)/, "EventSource connections must replay bounded fallback lifecycle state");

await rm(temporaryRoot, { recursive: true, force: true });
console.log("guided-git-fallback-runtime.test.mjs passed");
