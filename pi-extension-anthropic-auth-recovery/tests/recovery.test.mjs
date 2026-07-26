import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildManualRecoveryCommand,
  buildPlanOnlyPrompt,
  buildRecoveryPiArgs,
  classifyAnthropicError,
  discoverRecoveryFiles,
  formatPatchStatusSummary,
  formatRecoveryDiscoveryFailure,
  inspectRecoveryFiles,
  postSecureWebuiRecovery,
  selectRecoveryModel,
  writeRecoveryPromptFile,
} from "../anthropic-subscription-auth-recovery.ts";

function writeResource(file, content = "resource") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writePatchPackage(patch) {
  const root = path.dirname(patch);
  writeResource(patch, "# test patch");
  writeResource(path.join(root, "patch.manifest.json"), JSON.stringify({ lifecycle: { handler: "./scripts/lifecycle.mjs" } }));
  writeResource(path.join(root, "scripts", "lifecycle.mjs"), "export {};\n");
}

test("patch status summary hides already-applied targets and preserves actionable statuses", () => {
  assert.equal(formatPatchStatusSummary([
    { roles: ["native-tui"], status: "already-applied", packageVersion: "0.82.1" },
    { roles: ["webui-rpc"], status: "already-applied", packageVersion: "0.82.1" },
  ]), "");
  assert.equal(formatPatchStatusSummary([
    { roles: ["native-tui"], status: "already-applied", packageVersion: "0.82.1" },
    { roles: ["webui-rpc"], status: "applicable", packageVersion: "0.83.0" },
  ]), "webui-rpc: applicable (0.83.0)");
  assert.equal(formatPatchStatusSummary([]), "no runtime targets discovered");
});

test("error classifiers are provider-scoped, normalized, and stable", () => {
  const message = "400  Third-party apps now draw from your extra usage,\nnot your plan limits. Add more.";
  const first = classifyAnthropicError(message, "anthropic");
  const second = classifyAnthropicError(message.replace("\n", "   "), "anthropic");
  assert.equal(first?.classifier, "third-party-extra-usage-v1");
  assert.equal(first?.fingerprint, second?.fingerprint);
  assert.equal(classifyAnthropicError(message, "openai"), undefined);
  assert.equal(classifyAnthropicError("unrelated Anthropic error", "anthropic"), undefined);
});

test("recovery model selection honors a valid override and otherwise chooses available non-Anthropic auth", () => {
  const models = [
    { provider: "anthropic", id: "claude" },
    { provider: "google", id: "gemini-pro" },
    { provider: "openai-codex", id: "gpt-5.6-codex" },
  ];
  const registry = {
    getAvailable: () => models,
    find: (provider, id) => models.find((model) => model.provider === provider && model.id === id),
    hasConfiguredAuth: (model) => model.provider !== "anthropic",
  };
  assert.deepEqual(selectRecoveryModel(registry, "google/gemini-pro"), models[1]);
  assert.deepEqual(selectRecoveryModel(registry, "anthropic/claude"), models[2]);
  assert.deepEqual(selectRecoveryModel(registry), models[2]);
});

test("automatic recovery prompt is plan-only and Pi args never approve project trust", () => {
  const files = { patchPath: "/safe/patch/PATCH.md", patchctlPath: "/safe/patchctl.mjs" };
  const model = { provider: "openai-codex", id: "gpt-5.6-codex" };
  const prompt = buildPlanOnlyPrompt(files, { provider: "anthropic", id: "claude" });
  assert.match(prompt, /status and patchctl plan only/u);
  assert.match(prompt, /Do not run patchctl apply/u);
  const args = buildRecoveryPiArgs(model, "/tmp/prompt.md");
  assert.ok(args.includes("--no-approve"));
  assert.ok(!args.includes("--approve"));
  assert.match(buildManualRecoveryCommand(model, "/tmp/prompt.md"), /--no-approve/u);
});

test("temporary recovery prompts use mode 0600", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-prompt-"));
  try {
    const file = await writeRecoveryPromptFile("plan only", root);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(file, "utf8"), "plan only");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery file discovery honors explicit environment paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-discovery-env-"));
  try {
    const patch = path.join(root, "PATCH.md");
    const runner = path.join(root, "patchctl.mjs");
    writePatchPackage(patch);
    writeResource(runner, "runner");
    const result = await discoverRecoveryFiles({
      PI_ANTHROPIC_PATCH_PATH: patch,
      PI_PATCHCTL_PATH: runner,
      PI_AGENT_DIR: path.join(root, "agent"),
    }, root, { moduleDirectory: path.join(root, "module"), packagedPatchctlPath: null });
    assert.deepEqual(result, { patchPath: patch, patchctlPath: runner });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery file discovery supports standard agent paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-discovery-agent-"));
  try {
    const agentDir = path.join(root, "agent");
    const patch = path.join(agentDir, "patches", "pi-anthropic-provider-dist-compat", "PATCH.md");
    const runner = path.join(agentDir, "skills", "patch-md", "scripts", "patchctl.mjs");
    writePatchPackage(patch);
    writeResource(runner, "runner");
    const result = await discoverRecoveryFiles({ PI_CODING_AGENT_DIR: agentDir }, root, {
      moduleDirectory: path.join(root, "module"),
      packagedPatchctlPath: null,
    });
    assert.deepEqual(result, { patchPath: patch, patchctlPath: runner });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery file discovery supports a portable source-checkout ancestor", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-discovery-ancestor-"));
  try {
    const cwd = path.join(root, "projects", "nested", "repo");
    const patch = path.join(root, "patches", "pi-anthropic-provider-dist-compat", "PATCH.md");
    const runner = path.join(root, "pi-skill-patch-md", "skills", "patch-md", "scripts", "patchctl.mjs");
    writePatchPackage(patch);
    writeResource(runner, "runner");
    const result = await discoverRecoveryFiles({ PI_AGENT_DIR: path.join(root, "missing-agent") }, cwd, {
      moduleDirectory: path.join(root, "module"),
      packagedPatchctlPath: null,
    });
    assert.deepEqual(result, { patchPath: patch, patchctlPath: runner });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery discovery prefers self-contained packaged resources", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-discovery-packaged-"));
  try {
    const moduleDirectory = path.join(root, "node_modules", "@firstpick", "pi-extension-anthropic-auth-recovery");
    const cwd = path.join(root, "unrelated", "project");
    const patch = path.join(moduleDirectory, "resources", "pi-anthropic-provider-dist-compat", "PATCH.md");
    const runner = path.join(root, "node_modules", "@firstpick", "pi-skill-patch-md", "skills", "patch-md", "scripts", "patchctl.mjs");
    writePatchPackage(patch);
    writeResource(runner, "runner");
    const discovery = await inspectRecoveryFiles({ PI_AGENT_DIR: path.join(root, "missing-agent") }, cwd, {
      moduleDirectory,
      packagedPatchctlPath: runner,
    });
    assert.deepEqual(discovery.files, { patchPath: patch, patchctlPath: runner });
    assert.deepEqual(discovery.missing, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery discovery reports the exact missing resources and durable remediation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-discovery-missing-"));
  try {
    const discovery = await inspectRecoveryFiles({ PI_AGENT_DIR: path.join(root, "missing-agent") }, path.join(root, "project"), {
      moduleDirectory: path.join(root, "module"),
      packagedPatchctlPath: null,
    });
    assert.deepEqual(discovery.missing, ["compatibility PATCH.md package", "patchctl runner"]);
    assert.match(formatRecoveryDiscoveryFailure(discovery), /Reinstall @firstpick\/pi-extension-anthropic-auth-recovery with dependencies/u);
    assert.match(formatRecoveryDiscoveryFailure(discovery), /restart Pi\/WebUI/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("secure WebUI recovery requires explicit URL and token and sends a bearer credential with timeout", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200, json: async () => ({ requestId: "request-1" }) };
  };
  const request = { prompt: "plan", cwd: "/safe", model: { provider: "openai", id: "model" } };
  assert.deepEqual(await postSecureWebuiRecovery(request, {}, fetchImpl), { ok: false, reason: "secure WebUI recovery endpoint is not configured" });
  const insecure = await postSecureWebuiRecovery(request, { PI_WEBUI_RECOVERY_URL: "http://remote.invalid/recovery", PI_WEBUI_RECOVERY_TOKEN: "secret-test-token" }, fetchImpl);
  assert.deepEqual(insecure, { ok: false, reason: "recovery URL must use HTTPS or loopback HTTP" });
  const result = await postSecureWebuiRecovery(request, { PI_WEBUI_RECOVERY_URL: "https://local.invalid/recovery", PI_WEBUI_RECOVERY_TOKEN: "secret-test-token" }, fetchImpl);
  assert.deepEqual(result, { ok: true, requestId: "request-1" });
  assert.equal(captured.url, "https://local.invalid/recovery");
  assert.equal(captured.options.headers.authorization, "Bearer secret-test-token");
  assert.equal(JSON.parse(captured.options.body).mode, "plan-only");
  assert.ok(captured.options.signal instanceof AbortSignal);
});
