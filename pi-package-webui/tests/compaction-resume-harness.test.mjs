import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const compactingPi = join(root, "tests", "fixtures", "compacting-pi.mjs");
const port = 30000 + Math.floor(Math.random() * 20000);
const COMPACTION_TRIGGER = "__pi_webui_test_start_compaction__";
const RESUME_PROMPT = "resume automatically after compaction";

async function request(pathname, { method = "GET", body, timeoutMs = 5_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
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

async function waitFor(description, probe, { attempts = 60, intervalMs = 100 } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await probe();
    if (last) return last;
    await delay(intervalMs);
  }
  assert.fail(`${description} did not happen in time${last ? `; last=${JSON.stringify(last)}` : ""}`);
}

const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-compaction-resume-"));
const settingsFile = path.join(cwd, "webui-settings.json");
await chmod(compactingPi, 0o755);

const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", compactingPi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PI_WEBUI_SETTINGS_FILE: settingsFile },
});
let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
child.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

try {
  await waitFor("server health", async () => {
    if (child.exitCode !== null) return false;
    try {
      const health = await request("/api/health", { timeoutMs: 1_000 });
      return health.status === 200 && health.body?.ok === true ? health : false;
    } catch {
      return false;
    }
  }, { attempts: 100, intervalMs: 120 });

  const tabsResponse = await request("/api/tabs");
  assert.equal(tabsResponse.status, 200);
  const tabId = tabsResponse.body?.data?.tabs?.[0]?.id || tabsResponse.body?.tabs?.[0]?.id;
  assert.ok(tabId, "startup tab should have an id");

  const startCompaction = await request("/api/prompt", {
    method: "POST",
    body: { tab: tabId, message: COMPACTION_TRIGGER },
  });
  assert.equal(startCompaction.status, 200, `compaction trigger should be accepted: ${startCompaction.body?.error || serverOutput}`);

  await waitFor("compaction_start state", async () => {
    const state = await request(`/api/state?tab=${encodeURIComponent(tabId)}`);
    return state.body?.data?.isCompacting === true ? state : false;
  });

  const queuedPrompt = await request("/api/prompt", {
    method: "POST",
    body: { tab: tabId, message: RESUME_PROMPT },
  });
  assert.equal(queuedPrompt.status, 202, "prompt sent during compaction should be accepted into the Web UI resume queue");
  assert.equal(queuedPrompt.body?.data?.queuedFor, "compaction");
  assert.equal(queuedPrompt.body?.data?.queueLength, 1);

  const messagesBeforeEnd = await request(`/api/messages?tab=${encodeURIComponent(tabId)}`);
  assert.equal(messagesBeforeEnd.status, 200);
  assert.equal((messagesBeforeEnd.body?.data?.messages || []).some((message) => String(message.content || "").includes(RESUME_PROMPT)), false, "queued prompt should not reach Pi before compaction_end");

  await waitFor("compaction to finish", async () => {
    const state = await request(`/api/state?tab=${encodeURIComponent(tabId)}`);
    return state.body?.data?.isCompacting === false ? state : false;
  }, { attempts: 80, intervalMs: 100 });

  const resumedMessages = await waitFor("queued prompt to resume after compaction", async () => {
    const messages = await request(`/api/messages?tab=${encodeURIComponent(tabId)}`);
    const entries = messages.body?.data?.messages || [];
    return entries.some((message) => String(message.content || "").includes(`prompt:${RESUME_PROMPT}`)) ? messages : false;
  }, { attempts: 80, intervalMs: 100 });
  assert.equal(resumedMessages.status, 200);

  await request("/api/shutdown", { method: "POST" }).catch(() => undefined);
  for (let attempt = 0; attempt < 50 && child.exitCode === null; attempt += 1) await delay(100);
  assert.notEqual(child.exitCode, null, "server should exit after /api/shutdown");
} finally {
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(cwd, { recursive: true, force: true });
}

console.log("compaction-resume-harness.test.mjs passed");
