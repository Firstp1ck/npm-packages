import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { classifyContent, discoverTargets, transformContent, versionInRange } from "../scripts/lifecycle.mjs";

const patchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(patchRoot, "patch.manifest.json"), "utf8"));
const patchctl = path.resolve(patchRoot, "../../pi-skill-patch-md/skills/patch-md/scripts/patchctl.mjs");

function fixture(relative) {
  return fs.readFileSync(path.join(patchRoot, "tests", "fixtures", relative), "utf8");
}

function createRuntime(root, version, source, relativeFile) {
  const codingRoot = path.join(root, `coding-${Math.random().toString(16).slice(2)}`);
  const piAiRoot = path.join(codingRoot, "node_modules", "@earendil-works", "pi-ai");
  fs.mkdirSync(path.join(codingRoot, "dist"), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(piAiRoot, relativeFile)), { recursive: true });
  fs.writeFileSync(path.join(codingRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.80.9", type: "module" }));
  fs.writeFileSync(path.join(codingRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
  fs.writeFileSync(path.join(piAiRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-ai", version, type: "module" }));
  fs.writeFileSync(path.join(piAiRoot, relativeFile), source);
  return { codingRoot, piAiRoot, entry: path.join(codingRoot, "dist", "cli.js"), file: path.join(piAiRoot, relativeFile) };
}

function isolatedEnv(native, webui = "") {
  return {
    ...process.env,
    PI_PATCH_NATIVE_ENTRY: native.entry,
    PI_PATCH_WEBUI_ENTRIES: webui,
    PI_PATCH_RUNTIME_ENTRIES: "",
    PI_PATCH_WEBUI_ROOTS: "",
    PI_WEBUI_PI_BIN: "",
    PI_PATCH_DISABLE_AUTO_WEBUI_DISCOVERY: "1",
  };
}

function runPatchctl(args, cwd, env) {
  const child = spawnSync(process.execPath, [patchctl, ...args], { cwd, env, encoding: "utf8", timeout: 30_000 });
  let payload;
  try { payload = JSON.parse(child.stdout); } catch { payload = { stdout: child.stdout, stderr: child.stderr }; }
  return { status: child.status, payload };
}

test("supported version range is explicit and future versions fail closed", () => {
  assert.equal(versionInRange("0.78.0", ">=0.78.0 <0.81.0"), true);
  assert.equal(versionInRange("0.80.9", ">=0.78.0 <0.81.0"), true);
  assert.equal(versionInRange("0.81.0", ">=0.78.0 <0.81.0"), false);
  assert.equal(versionInRange("future", ">=0.78.0 <0.81.0"), false);
});

for (const [label, relative] of [
  ["pi-ai 0.78 provider layout", "pi-ai-0.78/dist/providers/anthropic.js"],
  ["pi-ai 0.79 provider layout", "pi-ai-0.79/dist/providers/anthropic.js"],
  ["pi-ai 0.80 API layout", "pi-ai-0.80/dist/api/anthropic-messages.js"],
  ["pi-ai 0.80.9 API layout", "pi-ai-0.80.9/dist/api/anthropic-messages.js"],
]) {
  test(`${label} transforms idempotently`, () => {
    const source = fixture(relative);
    assert.equal(classifyContent(source, manifest.profile).status, "applicable");
    const transformed = transformContent(source, manifest.profile);
    assert.equal(classifyContent(transformed, manifest.profile).status, "already-applied");
    assert.equal(transformContent(transformed, manifest.profile), transformed);
    assert.equal((transformed.match(/firstpick-patch:/gu) || []).length, 1);
    assert.equal((transformed.match(/x-claude-code-session-id/gu) || []).length, 1);
  });
}

test("upstreamed implementation is a no-op", () => {
  const source = fixture("upstreamed/anthropic-messages.js");
  assert.equal(classifyContent(source, manifest.profile).status, "upstreamed");
  assert.equal(transformContent(source, manifest.profile), source);
});

test("unknown future implementation is rejected without mutation", () => {
  const source = fixture("future-unknown/anthropic-messages.js");
  assert.equal(classifyContent(source, manifest.profile).status, "unsupported-layout");
  assert.throws(() => transformContent(source, manifest.profile), /Unsupported Anthropic implementation/u);
});

test("runtime discovery resolves native and WebUI dependency graphs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-discovery-"));
  const native = createRuntime(root, "0.80.9", fixture("pi-ai-0.80.9/dist/api/anthropic-messages.js"), "dist/api/anthropic-messages.js");
  const webui = createRuntime(root, "0.79.2", fixture("pi-ai-0.79/dist/providers/anthropic.js"), "dist/providers/anthropic.js");
  const targets = discoverTargets(manifest, isolatedEnv(native, webui.codingRoot));
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.flatMap((target) => target.roles).sort(), ["native-tui", "webui-rpc"]);
  assert.ok(targets.every((target) => target.status === "applicable"));
});

test("shared pi-ai roots are deduplicated and roles are merged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-shared-"));
  const native = createRuntime(root, "0.80.9", fixture("pi-ai-0.80.9/dist/api/anthropic-messages.js"), "dist/api/anthropic-messages.js");
  const secondCoding = path.join(root, "webui-coding");
  fs.mkdirSync(path.join(secondCoding, "node_modules", "@earendil-works"), { recursive: true });
  fs.mkdirSync(path.join(secondCoding, "dist"), { recursive: true });
  fs.writeFileSync(path.join(secondCoding, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.80.9", type: "module" }));
  fs.writeFileSync(path.join(secondCoding, "dist", "cli.js"), "#!/usr/bin/env node\n");
  fs.symlinkSync(native.piAiRoot, path.join(secondCoding, "node_modules", "@earendil-works", "pi-ai"), "dir");
  const targets = discoverTargets(manifest, isolatedEnv(native, secondCoding));
  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0].roles, ["native-tui", "webui-rpc"]);
});

test("unsupported discovered version blocks the complete plan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-version-block-"));
  const native = createRuntime(root, "0.80.9", fixture("pi-ai-0.80.9/dist/api/anthropic-messages.js"), "dist/api/anthropic-messages.js");
  const webui = createRuntime(root, "0.81.0", fixture("pi-ai-0.80.9/dist/api/anthropic-messages.js"), "dist/api/anthropic-messages.js");
  const state = path.join(root, "state");
  const args = ["plan", "--patch", path.join(patchRoot, "PATCH.md"), "--state-dir", state];
  const result = runPatchctl(args, patchRoot, isolatedEnv(native, webui.codingRoot));
  assert.equal(result.status, 1);
  assert.equal(result.payload.blocked, true);
  assert.ok(result.payload.targets.some((target) => target.status === "unsupported-version"));
  assert.equal(fs.readFileSync(native.file, "utf8"), fixture("pi-ai-0.80.9/dist/api/anthropic-messages.js"));
});

test("two-runtime apply is transactional, second apply is a no-op, and rollback restores both", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-apply-"));
  const nativeSource = fixture("pi-ai-0.80.9/dist/api/anthropic-messages.js");
  const webuiSource = fixture("pi-ai-0.79/dist/providers/anthropic.js");
  const native = createRuntime(root, "0.80.9", nativeSource, "dist/api/anthropic-messages.js");
  const webui = createRuntime(root, "0.79.2", webuiSource, "dist/providers/anthropic.js");
  const env = isolatedEnv(native, webui.codingRoot);
  const state = path.join(root, "state");
  const common = ["--patch", path.join(patchRoot, "PATCH.md"), "--state-dir", state];

  const plan = runPatchctl(["plan", ...common], patchRoot, env);
  assert.equal(plan.status, 0, JSON.stringify(plan.payload));
  assert.equal(plan.payload.writes, 2);
  const apply = runPatchctl(["apply", ...common, "--plan-hash", plan.payload.planHash], patchRoot, env);
  assert.equal(apply.status, 0, JSON.stringify(apply.payload));
  assert.equal(classifyContent(fs.readFileSync(native.file, "utf8"), manifest.profile).status, "already-applied");
  assert.equal(classifyContent(fs.readFileSync(webui.file, "utf8"), manifest.profile).status, "already-applied");

  const secondPlan = runPatchctl(["plan", ...common], patchRoot, env);
  assert.equal(secondPlan.payload.writes, 0);
  const secondApply = runPatchctl(["apply", ...common, "--plan-hash", secondPlan.payload.planHash], patchRoot, env);
  assert.equal(secondApply.status, 0, JSON.stringify(secondApply.payload));
  assert.equal(secondApply.payload.noop, true);

  const rollback = runPatchctl(["rollback", ...common, "--confirm"], patchRoot, env);
  assert.equal(rollback.status, 0, JSON.stringify(rollback.payload));
  assert.equal(fs.readFileSync(native.file, "utf8"), nativeSource);
  assert.equal(fs.readFileSync(webui.file, "utf8"), webuiSource);
});

test("one unsupported required runtime prevents partial writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-no-partial-"));
  const nativeSource = fixture("pi-ai-0.80.9/dist/api/anthropic-messages.js");
  const native = createRuntime(root, "0.80.9", nativeSource, "dist/api/anthropic-messages.js");
  const webui = createRuntime(root, "0.80.9", fixture("future-unknown/anthropic-messages.js"), "dist/api/anthropic-messages.js");
  const env = isolatedEnv(native, webui.codingRoot);
  const state = path.join(root, "state");
  const common = ["--patch", path.join(patchRoot, "PATCH.md"), "--state-dir", state];
  const plan = runPatchctl(["plan", ...common], patchRoot, env);
  assert.equal(plan.status, 1);
  const apply = runPatchctl(["apply", ...common, "--plan-hash", plan.payload.planHash], patchRoot, env);
  assert.equal(apply.status, 1);
  assert.equal(fs.readFileSync(native.file, "utf8"), nativeSource);
});
