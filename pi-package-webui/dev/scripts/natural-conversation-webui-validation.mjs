#!/usr/bin/env node
// Runtime validation: Natural Conversation Mode through a REAL Web UI tab
// backed by the REAL pi binary (not the fake-pi test fixture).
//
// Boots pi-webui itself, forwards the standalone Natural Conversation package
// as a directory extension into every tab, runs the Phase 2 check list, prints
// a PASS/FAIL table, and exits nonzero on failure. Runs fully offline
// (PI_OFFLINE=1 + --offline): slash commands, get_state, get_commands, and the
// webui-rpc-helper all work without model/API keys; no ordinary model prompts
// are sent.
//
// Usage: node dev/scripts/natural-conversation-webui-validation.mjs [--pi CMD] [--port N] [--work-dir DIR] [--keep-work-dir]
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webuiRoot = path.resolve(scriptDir, "..", "..");
const repoRoot = path.resolve(webuiRoot, "..");
const webuiBin = path.join(webuiRoot, "bin", "pi-webui.mjs");
const ncPackageDir = path.join(repoRoot, "pi-package-natural-conversation");

const EXPECTED_NC_TOOLS = ["find", "grep", "ls", "read"];
const HEALTH_TIMEOUT_MS = 5_000;
const RPC_TIMEOUT_MS = 60_000;
const BOOT_TIMEOUT_MS = 90_000;

const options = {
  pi: "pi",
  port: 0,
  workDir: "",
  keepWorkDir: false,
};

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--pi") options.pi = process.argv[++i];
  else if (arg === "--port") options.port = Number.parseInt(process.argv[++i], 10) || 0;
  else if (arg === "--work-dir") options.workDir = path.resolve(process.argv[++i]);
  else if (arg === "--keep-work-dir") options.keepWorkDir = true;
  else if (arg === "--help" || arg === "-h") {
    console.log("Usage: node dev/scripts/natural-conversation-webui-validation.mjs [--pi CMD] [--port N] [--work-dir DIR] [--keep-work-dir]\n\nRuntime-validates Natural Conversation Mode through a real Web UI tab backed by the real pi binary. Offline; no model calls. Exits 0 only when every check passes.");
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const results = [];
let overallPassed = true;

function record(id, name, passed, observed) {
  results.push({ id, name, passed, observed: String(observed ?? "") });
  if (!passed) overallPassed = false;
  console.log(`${passed ? "PASS" : "FAIL"} ${id}. ${name}${observed ? ` — ${observed}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setEquals(actual, expected) {
  const a = new Set(actual);
  const b = new Set(expected);
  return a.size === b.size && [...a].every((item) => b.has(item));
}

function sortedNames(list) {
  return [...list].sort().join(", ");
}

async function randomFreePort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = 32000 + Math.floor(Math.random() * 20001);
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.listen(candidate, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return candidate;
  }
  throw new Error("Could not find a free port in 32000-52000");
}

let baseUrl = "";

async function api(pathname, { method = "GET", body, timeoutMs = RPC_TIMEOUT_MS } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    // Non-JSON responses only occur on hard failures; callers see status.
  }
  return { status: response.status, body: parsed };
}

async function getThinkingLevel(tabId) {
  const state = await api(`/api/state?tab=${encodeURIComponent(tabId)}`);
  if (state.status !== 200) throw new Error(`get_state failed for tab ${tabId}: HTTP ${state.status} ${state.body?.error || ""}`);
  return String(state.body?.data?.thinkingLevel || "");
}

async function getActiveTools(tabId) {
  const tools = await api(`/api/tools?tab=${encodeURIComponent(tabId)}`);
  if (tools.status !== 200) throw new Error(`tools-state failed for tab ${tabId}: HTTP ${tools.status} ${tools.body?.error || ""}`);
  const list = tools.body?.data?.tools;
  if (!Array.isArray(list)) throw new Error(`tools-state returned no tools array for tab ${tabId}`);
  return list.filter((tool) => tool.enabled === true).map((tool) => String(tool.name)).sort();
}

async function getFeature(tabId) {
  const feature = await api(`/api/features/natural-conversation?tab=${encodeURIComponent(tabId)}`);
  if (feature.status !== 200) throw new Error(`feature endpoint failed for tab ${tabId}: HTTP ${feature.status} ${feature.body?.error || ""}`);
  return feature.body?.data || {};
}

async function waitForHealthy({ expectWebuiPid, timeoutMs = BOOT_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const health = await api("/api/health", { timeoutMs: HEALTH_TIMEOUT_MS });
      const data = health.body || {};
      const pidMatches = expectWebuiPid === undefined || data.webuiPid === expectWebuiPid;
      const tabsRunning = Array.isArray(data.tabs) && data.tabs.length > 0 && data.tabs.every((tab) => tab.running === true);
      if (health.status === 200 && data.ok === true && data.piRunning === true && pidMatches && tabsRunning) return data;
      lastError = `ok=${data.ok} piRunning=${data.piRunning} webuiPid=${data.webuiPid}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await sleep(500);
  }
  throw new Error(`Web UI did not become healthy within ${timeoutMs}ms (last: ${lastError})`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Set to this run's unique work dir once the server is spawned. A tracked PID
// can exit on its own (e.g. the pre-restart server) and be reused by an
// unrelated process before cleanup runs, so never signal a PID whose cmdline
// no longer looks like this run's pi-webui server.
let serverCmdlineMarker = "";

function pidLooksLikeOurServer(pid) {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.includes("pi-webui.mjs") && (!serverCmdlineMarker || cmdline.includes(serverCmdlineMarker));
  } catch {
    // /proc unavailable (non-Linux) or the process is gone; pidAlive() and the
    // SIGTERM-first path remain the only (pre-existing) safeguards.
    return true;
  }
}

async function killPid(pid, label) {
  if (!pid || !pidAlive(pid)) return;
  if (!pidLooksLikeOurServer(pid)) {
    console.error(`  skipping ${label} (pid ${pid}): PID no longer matches this run's server cmdline (reused PID)`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  for (let i = 0; i < 20 && pidAlive(pid); i += 1) await sleep(250);
  if (pidAlive(pid)) {
    console.error(`  ${label} (pid ${pid}) ignored SIGTERM; sending SIGKILL`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    for (let i = 0; i < 20 && pidAlive(pid); i += 1) await sleep(250);
  }
  if (pidAlive(pid)) throw new Error(`Failed to stop ${label} (pid ${pid})`);
}

const serverPids = new Map();

async function cleanup() {
  for (const [pid, label] of [...serverPids.entries()].reverse()) {
    await killPid(pid, label).catch((error) => {
      overallPassed = false;
      console.error(`cleanup failed: ${error.message}`);
    });
  }
  serverPids.clear();
}

let cleanupStarted = false;
async function cleanupOnce() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await cleanup();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanupOnce().finally(() => process.exit(130));
  });
}

function printTable() {
  console.log("\nResult table:");
  const rows = [["#", "Result", "Check", "Observed"], ...results.map((row) => [String(row.id), row.passed ? "PASS" : "FAIL", row.name, row.observed])];
  const widths = [0, 0, 0, 0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
  for (const [index, row] of rows.entries()) {
    console.log(`| ${row.map((cell, col) => cell.padEnd(widths[col])).join(" | ")} |`);
    if (index === 0) console.log(`|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`);
  }
}

async function main() {
  if (!existsSync(webuiBin)) throw new Error(`pi-webui entry point not found: ${webuiBin}`);
  if (!existsSync(path.join(ncPackageDir, "package.json"))) throw new Error(`Natural Conversation package not found: ${ncPackageDir}`);

  const workDir = options.workDir || await mkdtemp(path.join(os.tmpdir(), "nc-webui-validation-"));
  // Both the original and the restarted server carry this run's unique work
  // dir in their argv (--cwd <workDir>/workspace), making it a safe kill guard.
  serverCmdlineMarker = workDir;
  const workspaceDir = path.join(workDir, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  const settingsFile = path.join(workDir, "webui-settings.json");
  const serverLog = path.join(workDir, "server.log");
  const port = options.port || await randomFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  const serverArgs = [
    webuiBin,
    "--cwd", workspaceDir,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--pi", options.pi,
    "--no-session",
    "--",
    "--offline",
    "--no-context-files",
    // Suppress the user's curated ~/.pi/agent resources so /talk can only come
    // from the forwarded package extension below (deterministic tool baseline).
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    "--thinking", "high",
    "--extension", ncPackageDir,
  ];
  console.log(`Work dir: ${workDir}`);
  console.log(`Server log: ${serverLog}`);
  console.log(`Launch: PI_OFFLINE=1 PI_WEBUI_SETTINGS_FILE=${settingsFile} node ${serverArgs.join(" ")}`);

  const logStream = createWriteStream(serverLog);
  const server = spawn(process.execPath, serverArgs, {
    cwd: webuiRoot,
    env: { ...process.env, PI_OFFLINE: "1", PI_WEBUI_SETTINGS_FILE: settingsFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);
  serverPids.set(server.pid, "pi-webui server");

  try {
    // 1. Server healthy with the real pi binary.
    let health;
    try {
      health = await waitForHealthy();
    } catch (error) {
      const tail = existsSync(serverLog) ? readFileSync(serverLog, "utf8").split("\n").slice(-15).join("\n") : "(no log)";
      throw new Error(`${error.message}\n--- server log tail ---\n${tail}`);
    }
    const tabA = String(health.tabs?.[0]?.id || "");
    record(1, "Server healthy with real pi", health.ok === true && health.piRunning === true && !!tabA,
      `ok=${health.ok} piRunning=${health.piRunning} piPid=${health.piPid} tabA=${tabA}`);
    if (!tabA) throw new Error("No initial tab; aborting");

    // 2. Feature detection on tab A.
    const feature = await getFeature(tabA);
    const commands = Array.isArray(feature.commands) ? feature.commands : [];
    const hasCommands = ["talk", "voice", "conversation"].every((name) => commands.includes(name));
    record(2, "Feature detection (available, commands, mode off)",
      feature.available === true && hasCommands && feature.mode?.enabled === false,
      `available=${feature.available} commands=[${commands.join(", ")}] mode.enabled=${feature.mode?.enabled} packageInstalled=${feature.packageInstalled} (observed, not asserted)`);

    // 3. Baseline state on tab A.
    const baselineThinkingA = await getThinkingLevel(tabA);
    const baselineToolsA = await getActiveTools(tabA);
    record(3, "Baseline tab A (thinking high, tools recorded)", baselineThinkingA === "high",
      `thinkingLevel=${baselineThinkingA} activeTools={${sortedNames(baselineToolsA)}}`);

    // 4. Create tab B and record its baseline.
    const created = await api("/api/tabs", { method: "POST", body: {} });
    const tabB = String(created.body?.data?.tab?.id || "");
    let baselineThinkingB = "";
    if (created.status === 201 && tabB) {
      for (let i = 0; i < 20 && !baselineThinkingB; i += 1) {
        baselineThinkingB = await getThinkingLevel(tabB).catch(() => "");
        if (!baselineThinkingB) await sleep(500);
      }
    }
    record(4, "Create tab B with baseline thinking", created.status === 201 && !!tabB && baselineThinkingB === "high",
      `HTTP ${created.status} tabB=${tabB} thinkingLevel=${baselineThinkingB}`);
    if (!tabB) throw new Error("Tab B was not created; aborting");

    // 5. Enable Natural Conversation Mode on tab A.
    const enable = await api("/api/conversation-mode", { method: "POST", body: { enabled: true, tab: tabA } });
    record(5, "Enable mode on tab A", enable.status === 200 && enable.body?.data?.mode?.enabled === true,
      `HTTP ${enable.status} mode.enabled=${enable.body?.data?.mode?.enabled} uiState=${enable.body?.data?.mode?.uiState}`);

    // 6. Constraint enforcement (real pi truth via get_state + rpc helper).
    const enabledThinking = await getThinkingLevel(tabA);
    const enabledTools = await getActiveTools(tabA);
    record(6, "Constraints enforced (thinking off, tools read/grep/find/ls)",
      enabledThinking === "off" && setEquals(enabledTools, EXPECTED_NC_TOOLS),
      `thinkingLevel=${enabledThinking} activeTools={${sortedNames(enabledTools)}}`);

    // 7. Tab isolation: tab B unaffected and fully usable.
    const isolatedThinkingB = await getThinkingLevel(tabB);
    const featureB = await getFeature(tabB);
    const bashB = await api("/api/bash", { method: "POST", body: { command: "echo nc-webui-validation-tab-b", tab: tabB } });
    record(7, "Tab B isolated (thinking unchanged, mode off, bash allowed)",
      isolatedThinkingB === baselineThinkingB && featureB.mode?.enabled === false && bashB.status === 200,
      `thinkingLevel=${isolatedThinkingB} mode.enabled=${featureB.mode?.enabled} bash HTTP ${bashB.status}`);

    // 8. Web UI guards on tab A while enabled.
    const blockedSlash = await api("/api/prompt", { method: "POST", body: { message: "/copy", tab: tabA } });
    const blockedSettings = await api("/api/settings", { method: "POST", body: { thinkingLevel: "high", tab: tabA } });
    const blockedBash = await api("/api/bash", { method: "POST", body: { command: "echo blocked", tab: tabA } });
    const allowedTalk = await api("/api/prompt", { method: "POST", body: { message: "/talk status", tab: tabA } });
    const slashBlockedProperly = blockedSlash.status === 409 && /Natural Conversation/i.test(String(blockedSlash.body?.error || ""));
    record(8, "Guards while enabled (/copy 409, settings 409, bash 409, /talk status 200)",
      slashBlockedProperly && blockedSettings.status === 409 && blockedBash.status === 409 && allowedTalk.status === 200,
      `/copy HTTP ${blockedSlash.status}, settings HTTP ${blockedSettings.status}, bash HTTP ${blockedBash.status}, /talk status HTTP ${allowedTalk.status}`);

    // 9. Disable restores tab A baselines.
    const disable = await api("/api/conversation-mode", { method: "POST", body: { enabled: false, tab: tabA } });
    const restoredThinking = await getThinkingLevel(tabA);
    const restoredTools = await getActiveTools(tabA);
    record(9, "Disable restores baseline thinking and tools",
      disable.status === 200 && disable.body?.data?.mode?.enabled === false
        && restoredThinking === baselineThinkingA && setEquals(restoredTools, baselineToolsA),
      `HTTP ${disable.status} thinkingLevel=${restoredThinking} activeTools={${sortedNames(restoredTools)}}`);

    // 10. Restart semantics: mode state is tab-local and resets with the
    // underlying pi process. Accepted outcomes: constraints reapply, or the
    // mode clearly turns off. It must never report enabled while the fresh pi
    // process is unconstrained.
    const reEnable = await api("/api/conversation-mode", { method: "POST", body: { enabled: true, tab: tabA } });
    if (reEnable.status !== 200) throw new Error(`re-enable before restart failed: HTTP ${reEnable.status}`);
    const restart = await api("/api/restart", { method: "POST", body: {} });
    const nextWebuiPid = restart.body?.nextWebuiPid;
    if (restart.status !== 200 || !nextWebuiPid) throw new Error(`restart failed: HTTP ${restart.status}`);
    serverPids.set(nextWebuiPid, "restarted pi-webui server");
    await waitForHealthy({ expectWebuiPid: nextWebuiPid });
    const tabsAfterRestart = await api("/api/tabs");
    const tabAAfterRestart = (tabsAfterRestart.body?.data?.tabs || []).find((tab) => tab.id === tabA);
    if (!tabAAfterRestart) throw new Error("tab A was not restored after restart");
    const featureAfterRestart = await getFeature(tabA);
    const thinkingAfterRestart = await getThinkingLevel(tabA);
    const toolsAfterRestart = await getActiveTools(tabA);
    const modeEnabledAfterRestart = featureAfterRestart.mode?.enabled === true;
    const constrained = thinkingAfterRestart === "off" && setEquals(toolsAfterRestart, EXPECTED_NC_TOOLS);
    const restartOutcome = modeEnabledAfterRestart
      ? (constrained ? "constraints reapplied" : "INVALID: enabled but unconstrained")
      : "mode clearly turned off";
    record(10, "Restart resets tab-local mode safely",
      modeEnabledAfterRestart ? constrained : true,
      `outcome=${restartOutcome}; mode.enabled=${modeEnabledAfterRestart} thinkingLevel=${thinkingAfterRestart} activeTools={${sortedNames(toolsAfterRestart)}}`);

    // 11. Status-event path: /talk on|off sent directly through /api/prompt
    // must drive the Web UI mode state via the package's setStatus events.
    const talkOn = await api("/api/prompt", { method: "POST", body: { message: "/talk on", tab: tabA } });
    let modeAfterTalkOn = {};
    for (let i = 0; i < 30; i += 1) {
      modeAfterTalkOn = (await getFeature(tabA)).mode || {};
      if (modeAfterTalkOn.enabled === true) break;
      await sleep(500);
    }
    const talkOff = await api("/api/prompt", { method: "POST", body: { message: "/talk off", tab: tabA } });
    let modeAfterTalkOff = {};
    for (let i = 0; i < 30; i += 1) {
      modeAfterTalkOff = (await getFeature(tabA)).mode || {};
      if (modeAfterTalkOff.enabled === false) break;
      await sleep(500);
    }
    record(11, "Status events observed for /talk on|off via /api/prompt",
      talkOn.status === 200 && modeAfterTalkOn.enabled === true && modeAfterTalkOn.statusText === "Voice: listening"
        && talkOff.status === 200 && modeAfterTalkOff.enabled === false,
      `/talk on HTTP ${talkOn.status} -> enabled=${modeAfterTalkOn.enabled} statusText="${modeAfterTalkOn.statusText}"; /talk off HTTP ${talkOff.status} -> enabled=${modeAfterTalkOff.enabled}`);
  } finally {
    await cleanupOnce();
    if (!options.keepWorkDir && !options.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  overallPassed = false;
  console.error(`\nFATAL: ${error?.message || error}`);
  await cleanupOnce();
}

printTable();
console.log(`\n${overallPassed ? "PASS" : "FAIL"}: ${results.filter((row) => row.passed).length}/${results.length} checks passed`);
process.exit(overallPassed ? 0 : 1);
