import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const port = 30000 + Math.floor(Math.random() * 20000);
const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-remote-auth-settings-"));
const settingsFile = path.join(cwd, "webui-settings.json");
const safetyGuardSettingsFile = path.join(cwd, "safety-guard.json");

async function request(pathname, { method = "GET", body, timeoutMs = 5_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => undefined);
  return { status: response.status, body: payload };
}

await chmod(fakePi, 0o755);
await writeFile(settingsFile, `${JSON.stringify({ version: 1, remoteAuthEnabled: true }, null, 2)}\n`, "utf8");

const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PI_WEBUI_SETTINGS_FILE: settingsFile,
    PI_SAFETY_GUARD_CONFIG_FILE: safetyGuardSettingsFile,
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
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
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

  const startupAuth = await request("/api/remote-auth");
  assert.equal(startupAuth.status, 200);
  assert.equal(startupAuth.body?.data?.auth?.enabled, true, "saved Remote PIN auth setting should enable auth at next startup");
  assert.match(startupAuth.body?.data?.auth?.pin, /^\d{4}$/, "startup auth should generate a fresh PIN, not persist one");

  const initialSafetyGuardSetup = await request("/api/safety-guard/config");
  assert.equal(initialSafetyGuardSetup.status, 200);
  assert.equal(initialSafetyGuardSetup.body?.data?.config?.enabled, true, "safety guard should default to enabled");
  assert.deepEqual(initialSafetyGuardSetup.body?.data?.config?.contextLines, { before: 3, after: 3 });
  assert.ok(initialSafetyGuardSetup.body?.data?.categories?.includes("database"));

  const invalidSafetyGuardSetup = await request("/api/safety-guard/config", {
    method: "POST",
    body: { config: { contextLines: { before: 21 } } },
  });
  assert.equal(invalidSafetyGuardSetup.status, 400, "setup should reject context limits outside the canonical range");

  const savedSafetyGuardSetup = await request("/api/safety-guard/config", {
    method: "POST",
    body: {
      config: {
        enabled: false,
        categories: { docker: false },
        protectedPaths: { edit: false },
        contextLines: { before: 2, after: 4 },
      },
    },
  });
  assert.equal(savedSafetyGuardSetup.status, 200);
  assert.equal(savedSafetyGuardSetup.body?.data?.config?.enabled, false);
  assert.equal(savedSafetyGuardSetup.body?.data?.config?.categories?.docker, false);
  assert.deepEqual(savedSafetyGuardSetup.body?.data?.config?.contextLines, { before: 2, after: 4 });
  const persistedSafetyGuardSetup = JSON.parse(await readFile(safetyGuardSettingsFile, "utf8"));
  assert.equal(persistedSafetyGuardSetup.protectedPaths?.edit, false);

  const initialGitSetup = await request("/api/git-workflow/preferences");
  assert.equal(initialGitSetup.status, 200);
  assert.equal(initialGitSetup.body?.data?.configured, false, "guided Git should require first-time model setup");
  assert.equal(initialGitSetup.body?.data?.preferences?.stagingPolicy, "review", "review/select should be the safe staging default");
  assert.equal(initialGitSetup.body?.data?.models?.[0]?.id, "fake-model");

  const unsupportedEffort = await request("/api/git-workflow/preferences", {
    method: "POST",
    body: { preferences: { generation: { provider: "fake", modelId: "fake-model", thinkingLevel: "low" } } },
  });
  assert.equal(unsupportedEffort.status, 400, "setup should reject effort levels unsupported by the selected model");

  const invalidStagingPolicy = await request("/api/git-workflow/preferences", {
    method: "POST",
    body: { preferences: { generation: { provider: "fake", modelId: "fake-model", thinkingLevel: "off" }, stagingPolicy: "everything" } },
  });
  assert.equal(invalidStagingPolicy.status, 400, "setup should reject invalid preference choices instead of silently normalizing them");

  const savedGitSetup = await request("/api/git-workflow/preferences", {
    method: "POST",
    body: {
      preferences: {
        generation: { provider: "fake", modelId: "fake-model", thinkingLevel: "off", unavailablePolicy: "ask" },
        commit: { language: "de", defaultVariant: "long", scope: "required" },
        stagingPolicy: "review",
        deliveryMode: "ask",
        verificationPolicy: "ask",
      },
    },
  });
  assert.equal(savedGitSetup.status, 200);
  assert.equal(savedGitSetup.body?.data?.configured, true);
  assert.equal(savedGitSetup.body?.data?.preferences?.commit?.language, "de");

  const generation = await request("/api/git-workflow/generate", { method: "POST", body: { kind: "commit" } });
  assert.equal(generation.status, 200);
  assert.equal(generation.body?.data?.message, "/git-staged-msg de required");
  assert.deepEqual(generation.body?.data?.generation, { provider: "fake", modelId: "fake-model", thinkingLevel: "off" });

  const disableAuth = await request("/api/remote-auth/settings", { method: "POST", body: { enabled: false } });
  assert.equal(disableAuth.status, 200);
  const savedAfterDisable = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(savedAfterDisable.version, 4, "Web UI settings should migrate to the output-mode schema version");
  assert.equal(savedAfterDisable.remoteAuthEnabled, false, "disabling Remote PIN auth should persist the off preference");
  assert.equal(savedAfterDisable.gitWorkflow?.generation?.modelId, "fake-model", "Remote PIN updates should preserve guided Git preferences");

  const enableAuth = await request("/api/remote-auth/settings", { method: "POST", body: { enabled: true } });
  assert.equal(enableAuth.status, 200);
  const savedAfterEnable = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(savedAfterEnable.remoteAuthEnabled, true, "enabling Remote PIN auth should persist the on preference");

  console.log("remote-auth-settings-harness.test.mjs passed");
} finally {
  child.kill("SIGTERM");
  await delay(150);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(cwd, { recursive: true, force: true });
}
