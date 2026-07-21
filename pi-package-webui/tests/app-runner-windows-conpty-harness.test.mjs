import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("app-runner-windows-conpty-harness.test.mjs skipped (Windows only)");
  process.exit(0);
}

assert.equal(spawnSync("bash", ["--version"], { stdio: "ignore" }).status, 0, "Windows ConPTY test requires bash on PATH");
await import("node-pty");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const port = 30000 + Math.floor(Math.random() * 20000);

async function request(pathname, { method = "GET", body, timeoutMs = 5_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => undefined);
  return { status: response.status, body: payload };
}

async function waitFor(description, probe, { attempts = 100, intervalMs = 100 } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await probe();
    if (last) return last;
    await delay(intervalMs);
  }
  assert.fail(`${description} did not happen in time${last ? `; last=${JSON.stringify(last)}` : ""}`);
}

async function rmWithRetry(target) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 7 || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code)) throw error;
      await delay(150 * (attempt + 1));
    }
  }
}

const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-conpty-"));
const settingsFile = path.join(cwd, "webui-settings.json");
await chmod(fakePi, 0o755);
await writeFile(path.join(cwd, "interactive-fixture"), [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "if [[ -t 0 && -t 1 ]]; then printf 'tty=yes\\n'; else printf 'tty=no\\n'; fi",
  "read -r -p 'choice? ' answer",
  "printf 'selected:%s\\n' \"$answer\"",
  "",
].join("\n"));

const server = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PI_WEBUI_SETTINGS_FILE: settingsFile },
  windowsHide: true,
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

try {
  await waitFor("server health", async () => {
    if (server.exitCode !== null) return false;
    try {
      const health = await request("/api/health", { timeoutMs: 1_000 });
      return health.status === 200 && health.body?.ok === true;
    } catch {
      return false;
    }
  });

  const tabsResponse = await request("/api/tabs");
  const tabId = tabsResponse.body?.data?.tabs?.[0]?.id || tabsResponse.body?.tabs?.[0]?.id;
  assert.ok(tabId, `startup tab should exist, output:\n${serverOutput}`);

  const saved = await request("/api/app-runner-config", {
    method: "POST",
    body: { tab: tabId, runner: { label: "Windows ConPTY bash", command: "bash", path: "interactive-fixture" } },
    timeoutMs: 10_000,
  });
  assert.equal(saved.status, 200, `saving ConPTY runner should succeed: ${saved.body?.error || serverOutput}`);
  const runner = saved.body?.data?.runners?.find((item) => item.custom === true && item.label === "Windows ConPTY bash");
  assert.ok(runner?.id, "Windows ConPTY custom runner should be available");

  let state = await request("/api/app-runner", {
    method: "POST",
    body: { tab: tabId, runnerId: runner.id },
    timeoutMs: 10_000,
  });
  assert.equal(state.status, 200, `ConPTY runner should start: ${state.body?.error || serverOutput}`);
  assert.equal(state.body?.data?.activeRun?.executionMode, "conpty", "Windows runner should use ConPTY");

  await waitFor("TTY prompt", async () => {
    state = await request(`/api/app-runners?tab=${encodeURIComponent(tabId)}`);
    const output = [...(state.body?.data?.activeRun?.lines || []), state.body?.data?.activeRun?.pendingLine || ""].join("\n");
    return /tty=yes/.test(output) && /choice\?/.test(output);
  });

  const input = await request("/api/app-runner/input", {
    method: "POST",
    body: { tab: tabId, text: "alpha", closeStdin: true },
    timeoutMs: 10_000,
  });
  assert.equal(input.status, 200, `ConPTY input should be accepted: ${input.body?.error || serverOutput}`);

  await waitFor("interactive runner completion", async () => {
    state = await request(`/api/app-runners?tab=${encodeURIComponent(tabId)}`);
    return state.body?.data?.activeRun?.status === "done";
  });
  const output = [...(state.body?.data?.activeRun?.lines || []), state.body?.data?.activeRun?.pendingLine || ""].join("\n");
  assert.match(output, /selected:alpha/, "Windows ConPTY runner should receive WebUI input");

  await request("/api/shutdown", { method: "POST" }).catch(() => undefined);
  for (let attempt = 0; attempt < 50 && server.exitCode === null; attempt += 1) await delay(100);
  assert.notEqual(server.exitCode, null, "server should exit after shutdown");
  console.log("app-runner-windows-conpty-harness.test.mjs passed");
} finally {
  if (server.exitCode === null) {
    await request("/api/shutdown", { method: "POST", timeoutMs: 1_000 }).catch(() => undefined);
    for (let attempt = 0; attempt < 20 && server.exitCode === null; attempt += 1) await delay(100);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await rmWithRetry(cwd);
}
