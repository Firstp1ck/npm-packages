import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildManualRecoveryCommand,
  buildPlanOnlyPrompt,
  buildRecoveryPiArgs,
  classifyAnthropicError,
  discoverRecoveryFiles,
  postSecureWebuiRecovery,
  selectRecoveryModel,
  writeRecoveryPromptFile,
} from "../src/anthropic-subscription-auth-recovery.ts";

const patchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const patchctl = path.resolve(patchRoot, "../../pi-skill-patch-md/skills/patch-md/scripts/patchctl.mjs");

function runPatchctl(args, cwd, env) {
  const child = spawnSync(process.execPath, [patchctl, ...args], { cwd, env, encoding: "utf8", timeout: 30_000 });
  let payload;
  try { payload = JSON.parse(child.stdout); } catch { payload = { stdout: child.stdout, stderr: child.stderr }; }
  return { status: child.status, payload };
}

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
  const file = await writeRecoveryPromptFile("plan only", root);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, "utf8"), "plan only");
});

test("recovery file discovery uses environment/candidate paths without a username constant", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-discovery-"));
  const patch = path.join(root, "PATCH.md");
  const runner = path.join(root, "patchctl.mjs");
  fs.writeFileSync(patch, "patch");
  fs.writeFileSync(runner, "runner");
  const result = await discoverRecoveryFiles({ PI_ANTHROPIC_PATCH_PATH: patch, PI_PATCHCTL_PATH: runner, PI_AGENT_DIR: path.join(root, "agent") }, root);
  assert.deepEqual(result, { patchPath: patch, patchctlPath: runner });
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

test("recovery lifecycle status/plan are read-only, apply is idempotent, verify passes, and rollback removes a new install", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-lifecycle-"));
  const agentDir = path.join(root, "agent");
  const stateDir = path.join(root, "state");
  const env = { ...process.env, PI_AGENT_DIR: agentDir };
  const common = ["--patch", path.join(patchRoot, "PATCH.md"), "--state-dir", stateDir];

  const status = runPatchctl(["status", ...common], patchRoot, env);
  assert.equal(status.status, 0, JSON.stringify(status.payload));
  assert.equal(status.payload.targets[0].status, "missing");
  assert.equal(fs.existsSync(agentDir), false, "status must not create the agent directory");

  const plan = runPatchctl(["plan", ...common], patchRoot, env);
  assert.equal(plan.status, 0, JSON.stringify(plan.payload));
  assert.equal(plan.payload.writes, 1);
  assert.equal(fs.existsSync(agentDir), false, "plan must be read-only");

  const apply = runPatchctl(["apply", ...common, "--plan-hash", plan.payload.planHash], patchRoot, env);
  assert.equal(apply.status, 0, JSON.stringify(apply.payload));
  const installed = path.join(agentDir, "extensions", "anthropic-subscription-auth-recovery.ts");
  assert.equal(fs.statSync(installed).mode & 0o777, 0o600);

  const verify = runPatchctl(["verify", ...common], patchRoot, env);
  assert.equal(verify.status, 0, JSON.stringify(verify.payload));
  assert.equal(verify.payload.ok, true);

  const secondPlan = runPatchctl(["plan", ...common], patchRoot, env);
  assert.equal(secondPlan.payload.writes, 0);
  const secondApply = runPatchctl(["apply", ...common, "--plan-hash", secondPlan.payload.planHash], patchRoot, env);
  assert.equal(secondApply.status, 0, JSON.stringify(secondApply.payload));
  assert.equal(secondApply.payload.noop, true);

  const rollback = runPatchctl(["rollback", ...common, "--confirm"], patchRoot, env);
  assert.equal(rollback.status, 0, JSON.stringify(rollback.payload));
  assert.equal(fs.existsSync(installed), false);
});
