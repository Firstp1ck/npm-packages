import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  AGENT_SESSION_FILE,
  MODEL_SELECTOR_FILE,
  classifyContent,
  discoverTargets,
  transformContent,
} from "../scripts/lifecycle.mjs";

const patchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const lifecycle = path.join(patchRoot, "scripts", "lifecycle.mjs");
const manifest = JSON.parse(fs.readFileSync(path.join(patchRoot, "patch.manifest.json"), "utf8"));
const fixturesRoot = path.join(patchRoot, "tests", "fixtures", "compiled-layout");
const agentSource = fs.readFileSync(path.join(fixturesRoot, "agent-session.js"), "utf8");
const selectorSource = fs.readFileSync(path.join(fixturesRoot, "model-selector.js"), "utf8");

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode === undefined ? "utf8" : { encoding: "utf8", mode });
}

function makeTemp(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createCodingRuntime(root, name, sources = {}) {
  const codingRoot = path.join(root, `${name}-coding-agent`);
  const agentFile = path.join(codingRoot, AGENT_SESSION_FILE);
  const selectorFile = path.join(codingRoot, MODEL_SELECTOR_FILE);
  const entry = path.join(codingRoot, "bin", "pi.mjs");
  write(path.join(codingRoot, "package.json"), `${JSON.stringify({
    name: "@earendil-works/pi-coding-agent",
    version: "0.82.1",
    type: "module",
  })}\n`);
  write(entry, "#!/usr/bin/env node\n");
  write(agentFile, sources.agent ?? agentSource);
  write(selectorFile, sources.selector ?? selectorSource);
  return { codingRoot, entry, agentFile, selectorFile };
}

function createWebUi(root, codingRoot) {
  const webuiRoot = path.join(root, "webui");
  const dependency = path.join(webuiRoot, "node_modules", "@earendil-works", "pi-coding-agent");
  write(path.join(webuiRoot, "package.json"), `${JSON.stringify({
    name: "@firstpick/pi-package-webui",
    version: "0.1.0",
    type: "module",
  })}\n`);
  fs.mkdirSync(path.dirname(dependency), { recursive: true });
  fs.symlinkSync(codingRoot, dependency, process.platform === "win32" ? "junction" : "dir");
  return webuiRoot;
}

function isolatedEnv(native, webuiRoot) {
  return {
    ...process.env,
    PI_PATCH_NATIVE_ENTRY: native.entry,
    PI_PATCH_RUNTIME_ENTRIES: "",
    PI_PATCH_WEBUI_ENTRIES: "",
    PI_PATCH_WEBUI_ROOTS: webuiRoot,
    PI_WEBUI_PI_BIN: "",
  };
}

function runLifecycle(action, env, options = {}) {
  const args = [lifecycle, action, "--manifest", path.join(patchRoot, "patch.manifest.json")];
  if (options.stateDir) args.push("--state-dir", options.stateDir);
  if (options.planFile) args.push("--plan-file", options.planFile);
  if (options.receiptFile) args.push("--receipt-file", options.receiptFile);
  const child = spawnSync(process.execPath, args, {
    cwd: patchRoot,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  let payload;
  try { payload = JSON.parse(child.stdout); } catch { payload = null; }
  return { status: child.status, payload, stderr: child.stderr, stdout: child.stdout };
}

function reviewedPlan(root, plan) {
  const planFile = path.join(root, "reviewed-plan.json");
  write(planFile, `${JSON.stringify({ ...plan, planHash: "test-reviewed-plan-hash" })}\n`);
  return planFile;
}

function fileSnapshot(runtimes) {
  return Object.fromEntries(runtimes.flatMap((runtime) => [
    [runtime.agentFile, fs.readFileSync(runtime.agentFile, "utf8")],
    [runtime.selectorFile, fs.readFileSync(runtime.selectorFile, "utf8")],
  ]));
}

function assertSnapshot(snapshot) {
  for (const [file, content] of Object.entries(snapshot)) assert.equal(fs.readFileSync(file, "utf8"), content, file);
}

function prepareTwoRuntimeLayout(t, prefix) {
  const root = makeTemp(t, prefix);
  const native = createCodingRuntime(root, "native");
  const webuiRuntime = createCodingRuntime(root, "webui-runtime");
  const webuiRoot = createWebUi(root, webuiRuntime.codingRoot);
  return { root, native, webuiRuntime, env: isolatedEnv(native, webuiRoot), stateDir: path.join(root, "state") };
}

test("compiled-layout fixtures parse as JavaScript", () => {
  for (const file of [path.join(fixturesRoot, "agent-session.js"), path.join(fixturesRoot, "model-selector.js")]) {
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", timeout: 30_000 });
    assert.equal(checked.status, 0, checked.stderr);
  }
});

test("exact transform removes only default writes and preserves session behavior", () => {
  assert.equal(classifyContent(agentSource, AGENT_SESSION_FILE).status, "applicable");
  assert.equal(classifyContent(selectorSource, MODEL_SELECTOR_FILE).status, "applicable");

  const transformedAgent = transformContent(agentSource, AGENT_SESSION_FILE);
  const transformedSelector = transformContent(selectorSource, MODEL_SELECTOR_FILE);

  assert.equal((transformedAgent.match(/setDefaultModelAndProvider\(/gu) || []).length, 0);
  assert.equal((transformedAgent.match(/setDefaultThinkingLevel\(/gu) || []).length, 0);
  assert.equal((transformedSelector.match(/setDefaultModelAndProvider\(/gu) || []).length, 0);
  assert.doesNotMatch(transformedSelector, /Save as new default/u);
  for (const preserved of [
    "this.sessionManager.appendModelChange(model.provider, model.id);",
    "this.sessionManager.appendModelChange(next.model.provider, next.model.id);",
    "this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);",
    "this.sessionManager.appendThinkingLevelChange(effectiveLevel);",
    "const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);",
    'this._emit({ type: "thinking_level_changed", level: effectiveLevel });',
    'type: "thinking_level_select",',
    'await this._emitModelSelect(model, previousModel, "set");',
    'await this._emitModelSelect(next.model, currentModel, "cycle");',
    'await this._emitModelSelect(nextModel, currentModel, "cycle");',
    'this.settingsManager.setColorScheme("night");',
  ]) assert.ok(transformedAgent.includes(preserved), preserved);
  assert.ok(transformedSelector.includes('this.settingsManager.setColorScheme("night");'));
  assert.equal((transformedAgent.match(/this\.setThinkingLevel\(thinkingLevel\);/gu) || []).length, 3);
  assert.equal(classifyContent(transformedAgent, AGENT_SESSION_FILE).status, "already-applied");
  assert.equal(classifyContent(transformedSelector, MODEL_SELECTOR_FILE).status, "already-applied");
});

test("applicable content transforms once, while already-applied content is an exact no-op", () => {
  const transformedAgent = transformContent(agentSource, AGENT_SESSION_FILE);
  const transformedSelector = transformContent(selectorSource, MODEL_SELECTOR_FILE);
  assert.equal(transformContent(transformedAgent, AGENT_SESSION_FILE), transformedAgent);
  assert.equal(transformContent(transformedSelector, MODEL_SELECTOR_FILE), transformedSelector);
});

test("missing or duplicate semantic anchors fail closed without a transform", () => {
  const duplicateAgent = agentSource.replace(
    "        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);\n",
    "        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);\n        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);\n",
  );
  const missingAgent = agentSource.replace("        this.sessionManager.appendModelChange(model.provider, model.id);\n", "");
  const duplicateSelector = selectorSource.replace(
    "        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);\n",
    "        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);\n        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);\n",
  );
  const missingSelector = selectorSource.replace("        this.onSelectCallback(model);\n", "");

  for (const [content, relativeFile] of [
    [duplicateAgent, AGENT_SESSION_FILE],
    [missingAgent, AGENT_SESSION_FILE],
    [duplicateSelector, MODEL_SELECTOR_FILE],
    [missingSelector, MODEL_SELECTOR_FILE],
  ]) {
    assert.equal(classifyContent(content, relativeFile).status, "unsupported-layout");
    assert.throws(() => transformContent(content, relativeFile), /Unsupported/u);
  }
});

test("status reports unsupported semantic layouts as blocked", (t) => {
  const root = makeTemp(t, "session-effort-status-blocked");
  const native = createCodingRuntime(root, "native", {
    agent: agentSource.replace("        this.sessionManager.appendModelChange(model.provider, model.id);\n", ""),
  });
  const webuiRoot = createWebUi(root, native.codingRoot);
  const status = runLifecycle("status", isolatedEnv(native, webuiRoot));

  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.payload.blocked, true);
  assert.ok(status.payload.targets.some((target) => target.status === "unsupported-layout"));
});

test("native and WebUI discovery deduplicates a shared real package root and merges roles", (t) => {
  const root = makeTemp(t, "session-effort-shared-root");
  const native = createCodingRuntime(root, "native");
  const webuiRoot = createWebUi(root, native.codingRoot);
  const targets = discoverTargets(manifest, isolatedEnv(native, webuiRoot));

  assert.equal(targets.discoveryErrors.length, 0);
  assert.equal(targets.targets.length, 2);
  assert.ok(targets.targets.every((target) => target.codingAgentRoot === fs.realpathSync(native.codingRoot)));
  assert.ok(targets.targets.every((target) => target.status === "applicable"));
  assert.ok(targets.targets.every((target) => target.roles.join(",") === "native-tui,webui-rpc"));
});

test("partial multi-target state blocks apply and leaves every target byte-identical", (t) => {
  const setup = prepareTwoRuntimeLayout(t, "session-effort-partial");
  fs.writeFileSync(setup.webuiRuntime.agentFile, transformContent(agentSource, AGENT_SESSION_FILE));
  const before = fileSnapshot([setup.native, setup.webuiRuntime]);

  const plan = runLifecycle("plan", setup.env, { stateDir: setup.stateDir });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(plan.payload.blocked, true);
  assert.equal(plan.payload.writes, 0);
  assert.equal(plan.payload.targets.length, 4);
  assert.equal(plan.payload.partialRoots.length, 1);

  const apply = runLifecycle("apply", setup.env, {
    stateDir: setup.stateDir,
    planFile: reviewedPlan(setup.root, plan.payload),
  });
  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /unblocked patchctl plan/u);
  assertSnapshot(before);
});

test("apply preserves modes, verifies receipt hashes, is idempotent, and rolls back exact bytes", (t) => {
  const setup = prepareTwoRuntimeLayout(t, "session-effort-lifecycle");
  const files = [
    setup.native.agentFile,
    setup.native.selectorFile,
    setup.webuiRuntime.agentFile,
    setup.webuiRuntime.selectorFile,
  ];
  const expectedModes = new Map(files.map((file, index) => {
    const mode = index % 2 === 0 ? 0o640 : 0o600;
    fs.chmodSync(file, mode);
    return [file, mode];
  }));
  const before = fileSnapshot([setup.native, setup.webuiRuntime]);

  const plan = runLifecycle("plan", setup.env, { stateDir: setup.stateDir });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(plan.payload.blocked, false);
  assert.equal(plan.payload.writes, 4);
  const apply = runLifecycle("apply", setup.env, {
    stateDir: setup.stateDir,
    planFile: reviewedPlan(setup.root, plan.payload),
  });
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(apply.payload.result.writes, 4);
  assert.equal(apply.payload.receipt.targets.length, 4);
  for (const file of files) assert.equal(fs.statSync(file).mode & 0o777, expectedModes.get(file), file);
  for (const target of apply.payload.receipt.targets) {
    assert.equal(classifyContent(fs.readFileSync(target.path, "utf8"), target.relativeFile).status, "already-applied");
  }

  const receiptFile = path.join(setup.root, "receipt.json");
  write(receiptFile, `${JSON.stringify(apply.payload.receipt)}\n`, 0o600);
  const verify = runLifecycle("verify", setup.env, { stateDir: setup.stateDir, receiptFile });
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(verify.payload.ok, true);
  assert.equal(verify.payload.checks.filter((check) => check.id.startsWith("receipt-")).length, 4);
  assert.ok(verify.payload.checks.filter((check) => check.id.startsWith("receipt-")).every((check) => check.passed));

  const secondPlan = runLifecycle("plan", setup.env, { stateDir: setup.stateDir });
  assert.equal(secondPlan.status, 0, secondPlan.stderr);
  assert.equal(secondPlan.payload.writes, 0);
  assert.equal(secondPlan.payload.noop, true);
  const secondApply = runLifecycle("apply", setup.env, {
    stateDir: setup.stateDir,
    planFile: reviewedPlan(setup.root, secondPlan.payload),
  });
  assert.equal(secondApply.status, 0, secondApply.stderr);
  assert.equal(secondApply.payload.result.writes, 0);

  const rollback = runLifecycle("rollback", setup.env, { stateDir: setup.stateDir, receiptFile });
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(rollback.payload.result.writes, 4);
  assertSnapshot(before);
  for (const file of files) assert.equal(fs.statSync(file).mode & 0o777, expectedModes.get(file), file);
});

test("receipt verification and rollback refuse after-hash drift without overwriting it", (t) => {
  const setup = prepareTwoRuntimeLayout(t, "session-effort-drift");
  const plan = runLifecycle("plan", setup.env, { stateDir: setup.stateDir });
  assert.equal(plan.status, 0, plan.stderr);
  const apply = runLifecycle("apply", setup.env, {
    stateDir: setup.stateDir,
    planFile: reviewedPlan(setup.root, plan.payload),
  });
  assert.equal(apply.status, 0, apply.stderr);
  const receiptFile = path.join(setup.root, "receipt.json");
  write(receiptFile, `${JSON.stringify(apply.payload.receipt)}\n`, 0o600);

  const drifted = `${fs.readFileSync(setup.native.agentFile, "utf8")}// external drift\n`;
  fs.writeFileSync(setup.native.agentFile, drifted);
  const verify = runLifecycle("verify", setup.env, { stateDir: setup.stateDir, receiptFile });
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(verify.payload.ok, false);
  assert.ok(verify.payload.checks.some((check) => check.id.startsWith("receipt-") && check.errors.includes("after hash mismatch")));

  const rollback = runLifecycle("rollback", setup.env, { stateDir: setup.stateDir, receiptFile });
  assert.notEqual(rollback.status, 0);
  assert.match(rollback.stderr, /Rollback refused because target drifted/u);
  assert.equal(fs.readFileSync(setup.native.agentFile, "utf8"), drifted);
});

test("a failed later commit restores earlier writes transactionally", (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("directory-permission failure injection is only reliable for non-root POSIX runs");
    return;
  }
  const root = makeTemp(t, "session-effort-transaction");
  const native = createCodingRuntime(root, "native");
  const webuiRoot = createWebUi(root, native.codingRoot);
  const env = isolatedEnv(native, webuiRoot);
  const stateDir = path.join(root, "state");
  const before = fileSnapshot([native]);
  const plan = runLifecycle("plan", env, { stateDir });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(plan.payload.writes, 2);

  const selectorDirectory = path.dirname(native.selectorFile);
  fs.chmodSync(selectorDirectory, 0o500);
  try {
    const apply = runLifecycle("apply", env, {
      stateDir,
      planFile: reviewedPlan(root, plan.payload),
    });
    assert.notEqual(apply.status, 0, "later selector commit unexpectedly succeeded");
  } finally {
    fs.chmodSync(selectorDirectory, 0o700);
  }
  assertSnapshot(before);
});
