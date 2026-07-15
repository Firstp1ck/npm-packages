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

async function waitFor(description, probe, { attempts = 80, intervalMs = 100 } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await probe();
    if (last) return last;
    await delay(intervalMs);
  }
  assert.fail(`${description} did not happen in time${last ? `; last=${JSON.stringify(last)}` : ""}`);
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function killFixtureProcess(pid) {
  if (!isProcessRunning(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Best-effort cleanup after a failed assertion.
  }
}

const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-app-runner-tree-"));
const settingsFile = path.join(cwd, "webui-settings.json");
await chmod(fakePi, 0o755);
await writeFile(path.join(cwd, "tree-child.mjs"), "setInterval(() => {}, 1000);\n");
await writeFile(path.join(cwd, "tree-parent.mjs"), [
  "import { spawn } from 'node:child_process';",
  "import { writeFileSync } from 'node:fs';",
  "import { fileURLToPath } from 'node:url';",
  "const childPath = fileURLToPath(new URL('./tree-child.mjs', import.meta.url));",
  "const child = spawn(process.execPath, [childPath], { stdio: 'ignore', windowsHide: true });",
  "writeFileSync('tree-child.pid', `${child.pid}\\n`);",
  "console.log(`tree runner ready ${child.pid}`);",
  "setInterval(() => {}, 1000);",
  "",
].join("\n"));

const server = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PI_WEBUI_SETTINGS_FILE: settingsFile,
    PI_WEBUI_APP_RUNNER_PTY: "off",
  },
  windowsHide: true,
});
let serverOutput = "";
let runnerPid = 0;
let treeChildPid = 0;
server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

try {
  await waitFor("server health", async () => {
    if (server.exitCode !== null) return false;
    try {
      const health = await request("/api/health", { timeoutMs: 1_000 });
      return health.status === 200 && health.body?.ok === true ? health : false;
    } catch {
      return false;
    }
  }, { attempts: 100, intervalMs: 120 });

  const tabsResponse = await request("/api/tabs");
  const tabId = tabsResponse.body?.data?.tabs?.[0]?.id || tabsResponse.body?.tabs?.[0]?.id;
  assert.ok(tabId, `startup tab should exist, output:\n${serverOutput}`);

  const saved = await request("/api/app-runner-config", {
    method: "POST",
    body: { tab: tabId, runner: { label: "Process tree node", command: process.execPath, path: "tree-parent.mjs" } },
    timeoutMs: 10_000,
  });
  assert.equal(saved.status, 200, `saving a process-tree runner should succeed: ${saved.body?.error || serverOutput}`);
  const runner = saved.body?.data?.runners?.find((item) => item.custom === true && item.label === "Process tree node");
  assert.ok(runner?.id, "process-tree custom runner should appear in detected app runners");

  let state = await request("/api/app-runner", {
    method: "POST",
    body: { tab: tabId, runnerId: runner.id },
    timeoutMs: 10_000,
  });
  assert.equal(state.status, 200, `process-tree runner should start: ${state.body?.error || serverOutput}`);
  runnerPid = Number(state.body?.data?.activeRun?.pid) || 0;

  await waitFor("runner parent and child startup", async () => {
    state = await request(`/api/app-runners?tab=${encodeURIComponent(tabId)}`);
    try {
      treeChildPid = Number.parseInt((await readFile(path.join(cwd, "tree-child.pid"), "utf8")).trim(), 10);
    } catch {
      treeChildPid = 0;
    }
    const output = [
      ...(state.body?.data?.activeRun?.lines || []),
      state.body?.data?.activeRun?.pendingLine || "",
    ].join("\n");
    return isProcessRunning(treeChildPid) && /tree runner ready/.test(output) ? true : false;
  });

  const stopped = await request("/api/app-runner/stop", {
    method: "POST",
    body: { tab: tabId },
    timeoutMs: 10_000,
  });
  assert.equal(stopped.status, 200, `process-tree stop should return ok: ${stopped.body?.error || serverOutput}`);
  const stopOutput = (stopped.body?.data?.activeRun?.lines || []).join("\n");
  if (process.platform === "win32") assert.match(stopOutput, /terminating Windows process tree/);
  else assert.match(stopOutput, /sending Ctrl\+C/);

  await waitFor("runner and descendant termination", async () => {
    state = await request(`/api/app-runners?tab=${encodeURIComponent(tabId)}`);
    const status = state.body?.data?.activeRun?.status;
    return status && status !== "running" && !isProcessRunning(treeChildPid) ? true : false;
  });
  assert.equal(isProcessRunning(treeChildPid), false, "stopping an app runner must not orphan its server child");

  await request("/api/shutdown", { method: "POST" }).catch(() => undefined);
  for (let attempt = 0; attempt < 50 && server.exitCode === null; attempt += 1) await delay(100);
  assert.notEqual(server.exitCode, null, "server should exit after /api/shutdown");
  console.log("app-runner-process-tree-harness.test.mjs passed");
} finally {
  if (server.exitCode === null) {
    await request("/api/shutdown", { method: "POST", timeoutMs: 1_000 }).catch(() => undefined);
    for (let attempt = 0; attempt < 20 && server.exitCode === null; attempt += 1) await delay(100);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  killFixtureProcess(runnerPid);
  killFixtureProcess(treeChildPid);
  await rm(cwd, { recursive: true, force: true });
}
