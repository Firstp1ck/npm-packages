import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  BUILTIN_SAMPLING_APIS,
  resolveSamplingParameterCapabilities,
} from "../lib/sampling-parameter-capabilities.mjs";
import { terminateProcessTree } from "../lib/process-tree.mjs";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(packageRoot, "bin", "pi-webui.mjs");
const fakePi = path.join(packageRoot, "tests", "fixtures", "fake-pi.mjs");
const root = await mkdtemp(path.join(tmpdir(), "pi-webui-sampling-http-"));
const agentDir = path.join(root, "agent");
const cwd = path.join(root, "project");
const settingsFile = path.join(root, "settings.json");
const port = 30000 + Math.floor(Math.random() * 20000);

await mkdir(agentDir, { recursive: true });
await mkdir(cwd, { recursive: true });
await writeFile(path.join(agentDir, "trust.json"), `${JSON.stringify({ [cwd]: true }, null, 2)}\n`, "utf8");
await writeFile(settingsFile, `${JSON.stringify({ version: 3 })}\n`, "utf8");
await chmod(fakePi, 0o755);

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  let payload;
  try { payload = await response.json(); } catch { payload = undefined; }
  return { status: response.status, body: payload, headers: response.headers };
}

const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PI_WEBUI_SETTINGS_FILE: settingsFile,
    PI_WEBUI_RPC_SUPERVISOR: "0",
  },
});
let output = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });

try {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      health = await request("/api/health");
      if (health.status === 200 && health.body?.piRunning === true) break;
    } catch {
      // The focused server is still starting.
    }
    await delay(100);
  }
  assert.equal(health?.status, 200, `server should become healthy\n${output}`);
  assert.equal(health.body?.piRunning, true, `fake Pi should be running\n${output}`);

  const tabs = await request("/api/tabs");
  const tabId = tabs.body?.data?.tabs?.[0]?.id;
  assert.ok(tabId, "sampling HTTP test requires a startup tab");
  const endpoint = `/api/tabs/${encodeURIComponent(tabId)}/sampling-parameters`;

  const initial = await request(endpoint);
  assert.equal(initial.status, 200, initial.body?.error);
  assert.equal(initial.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(initial.body?.data?.session, {});
  assert.deepEqual(initial.body?.data?.defaults, { temperature: 0.7 });
  assert.deepEqual(initial.body?.data?.effective, { temperature: 0.7 });
  const initialSupport = initial.body?.data?.support;
  assert.equal(initialSupport?.supported, true);
  assert.equal(initialSupport?.api, "openai-completions", "the additive capability map must preserve the legacy API diagnostic");
  assert.deepEqual(initialSupport?.model, { provider: "fake", id: "fake-model", name: "Fake Model" });
  assert.deepEqual(initialSupport?.compatibleApis, BUILTIN_SAMPLING_APIS, "the fake diagnostic API list should derive from production");
  assert.equal(initialSupport?.message, "Session sampling parameters apply to subsequent provider requests.");
  assert.deepEqual(Object.keys(initialSupport?.parameters || {}), [
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "seed",
    "top_k",
    "min_p",
  ]);
  assert.deepEqual(
    initialSupport?.parameters,
    resolveSamplingParameterCapabilities({ api: "openai-completions" }),
    "the fake per-key capability map should remain in parity with the production resolver",
  );
  assert.deepEqual(initialSupport?.parameters?.temperature, {
    supported: true,
    reason: "Supported by openai-completions.",
    source: "api",
  });
  assert.deepEqual(initialSupport?.parameters?.top_k, {
    supported: false,
    reason: "openai-completions does not declare Top K support.",
    source: "unsupported",
  });

  const stored = { temperature: 0.2, top_p: 0.9, top_k: 40, vendor_mode: "strict" };
  const saved = await request(endpoint, { method: "PUT", body: stored });
  assert.equal(saved.status, 200, saved.body?.error);
  assert.deepEqual(saved.body?.data?.session, stored, "unsupported and unknown values must remain stored");
  assert.deepEqual(saved.body?.data?.effective, { temperature: 0.2, top_p: 0.9 }, "unsupported and unknown stored values must remain inert");
  assert.deepEqual(saved.body?.data?.support, initialSupport, "writes must retain capability and backward-compatible support fields");
  const reloaded = await request(endpoint);
  assert.deepEqual(reloaded.body?.data?.session, stored);
  assert.deepEqual(reloaded.body?.data?.effective, { temperature: 0.2, top_p: 0.9 });

  const invalidKnownWrites = [
    [{ temperature: "0.2" }, /Temperature must be a number\./],
    [{ top_p: 0 }, /Top P must be greater than 0 and at most 1\./],
    [{ seed: 1.5 }, /Seed must be an integer\./],
  ];
  for (const [body, errorPattern] of invalidKnownWrites) {
    const rejected = await request(endpoint, { method: "PUT", body });
    assert.equal(rejected.status, 400, "HTTP writes should reject invalid catalog values");
    assert.match(rejected.body?.error || "", errorPattern, "HTTP rejection should identify the violated catalog constraint");
    assert.deepEqual((await request(endpoint)).body?.data?.session, stored, "invalid catalog values must not replace active HTTP state");
  }

  const rejected = await request(endpoint, { method: "PUT", body: ["not-an-object"] });
  assert.equal(rejected.status, 400, "non-object roots should be rejected by the helper");
  assert.deepEqual((await request(endpoint)).body?.data?.session, stored, "rejected writes must preserve active state");

  const malformed = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: '{"temperature":',
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(malformed.status, 400, "malformed JSON should be reported as a client error");
  const empty = await request(endpoint, { method: "PUT" });
  assert.equal(empty.status, 400, "an absent body must not silently reset sampling state");
  assert.deepEqual((await request(endpoint)).body?.data?.session, stored, "malformed and empty writes must preserve active state");

  const reset = await request(endpoint, { method: "PUT", body: {} });
  assert.equal(reset.status, 200, reset.body?.error);
  assert.deepEqual(reset.body?.data?.session, {});
  assert.deepEqual(reset.body?.data?.effective, { temperature: 0.7 });
  assert.deepEqual(reset.body?.data?.support, initialSupport, "reset must not remove additive or legacy support fields");
  assert.equal((await request("/api/tabs/missing-tab/sampling-parameters")).status, 404);

  const oversized = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(21 * 1024) }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(oversized.status, 413, "sampling writes should be bounded at HTTP ingress");

  console.log("session-sampling-http.test.mjs passed");
} finally {
  try { await request("/api/shutdown", { method: "POST", body: {} }); } catch { /* Best-effort graceful shutdown. */ }
  if (child.exitCode === null) terminateProcessTree(child);
  await rm(root, { recursive: true, force: true });
}
