import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const port = 30000 + Math.floor(Math.random() * 20000);
const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-safety-guard-auto-review-"));
const safetyGuardSettingsFile = path.join(cwd, "safety-guard.json");

async function request(pathname, { method = "GET", body, timeoutMs = 5_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

async function removeWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code)) throw error;
      await delay(100 + attempt * 50);
    }
  }
  throw lastError;
}

await chmod(fakePi, 0o755);
const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PI_SAFETY_GUARD_CONFIG_FILE: safetyGuardSettingsFile, PI_WEBUI_RPC_SUPERVISOR: "0" },
});
let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
child.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

try {
  let health;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      health = await request("/api/health", { timeoutMs: 1_000 });
      if (health.status === 200) break;
    } catch {
      // Server not listening yet.
    }
    await delay(200);
  }
  assert.equal(health?.status, 200, `server should become healthy, output:\n${serverOutput}`);

  const initial = await request("/api/safety-guard/config");
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body?.data?.config?.autoReview, {
    enabled: false,
    model: { provider: "", modelId: "", thinkingLevel: "off" },
  });
  assert.equal(initial.body?.data?.models?.[0]?.provider, "fake");
  assert.equal(initial.body?.data?.models?.[0]?.id, "fake-model");
  assert.deepEqual(initial.body?.data?.modelThinkingLevels, { "fake/fake-model": ["off"] });

  const unavailable = await request("/api/safety-guard/config", {
    method: "POST",
    body: { config: { autoReview: { enabled: true, model: { provider: "fake", modelId: "missing-model", thinkingLevel: "off" } } } },
  });
  assert.equal(unavailable.status, 400);
  assert.match(unavailable.body?.error || "", /not currently available/);

  const unsupported = await request("/api/safety-guard/config", {
    method: "POST",
    body: { config: { autoReview: { enabled: true, model: { provider: "fake", modelId: "fake-model", thinkingLevel: "low" } } } },
  });
  assert.equal(unsupported.status, 400);
  assert.match(unsupported.body?.error || "", /does not support thinking level low/);

  const enabled = await request("/api/safety-guard/config", {
    method: "POST",
    body: { config: { autoReview: { enabled: true, model: { provider: "fake", modelId: "fake-model", thinkingLevel: "off" } } } },
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body?.data?.config?.autoReview?.enabled, true);

  const disabledWithRetainedSelection = await request("/api/safety-guard/config", {
    method: "POST",
    body: { config: { autoReview: { enabled: false, model: { provider: "fake", modelId: "missing-model", thinkingLevel: "low" } } } },
  });
  assert.equal(disabledWithRetainedSelection.status, 200, "disabled auto-review should tolerate retained selections without runtime validation");
  assert.deepEqual(disabledWithRetainedSelection.body?.data?.config?.autoReview, {
    enabled: false,
    model: { provider: "fake", modelId: "missing-model", thinkingLevel: "low" },
  });

  const persisted = JSON.parse(await readFile(safetyGuardSettingsFile, "utf8"));
  assert.deepEqual(persisted.autoReview, disabledWithRetainedSelection.body.data.config.autoReview);
  console.log("safety-guard-auto-review-harness.test.mjs passed");
} finally {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(2_000)]);
  }
  await removeWithRetry(cwd);
}
