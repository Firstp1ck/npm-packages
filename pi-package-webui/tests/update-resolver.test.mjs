import assert from "node:assert/strict";
import path from "node:path";
import { resolveCanonicalPiRuntime, resolveWebuiRuntimeIdentity, sameRuntimeIdentity } from "../lib/update/resolver.mjs";

const bundledCli = "C:\\Agent\\npm\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js";
const pathDir = "C:\\PathPi";
const pathCli = `${pathDir}\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js`;
const explicitDir = "C:\\ExplicitPi";
const explicitShim = `${explicitDir}\\pi.cmd`;
const explicitCli = `${explicitDir}\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js`;
const existing = new Set([bundledCli, `${pathDir}\\pi.CMD`, pathCli, explicitShim, explicitCli, `${pathDir}\\node.exe`, `${explicitDir}\\node.exe`, "C:\\Node\\node.exe"]);
const runtime = {
  platform: "win32",
  execPath: "C:\\Node\\node.exe",
  env: { PATH: pathDir, PATHEXT: ".EXE;.CMD" },
  existsSync: (candidate) => existing.has(path.win32.normalize(candidate)),
  realpathSync: (candidate) => path.win32.normalize(candidate),
};
const calls = [];
async function runCommand(command, args, options) {
  calls.push({ command, args, options });
  const cli = args[0];
  if (cli === bundledCli) return { exitCode: 0, stdout: "pi 1.2.3", stderr: "" };
  if (path.win32.normalize(cli || "") === path.win32.normalize(pathCli)) return { exitCode: 0, stdout: "9.9.9", stderr: "" };
  if (path.win32.normalize(cli || "") === path.win32.normalize(explicitCli)) return { exitCode: 0, stdout: "v2.4.6", stderr: "" };
  return { exitCode: 1, stdout: "", stderr: "missing" };
}

const selected = await resolveCanonicalPiRuntime({ bundledCli, runCommand, runtime });
assert.equal(selected.active.source, "bundled");
assert.equal(selected.active.version, "1.2.3");
assert.equal(selected.path.source, "path");
assert.equal(selected.path.version, "9.9.9");
assert.notEqual(selected.active.canonicalId, selected.path.canonicalId, "a newer PATH Pi must remain separately reported and untouched");
assert.deepEqual(selected.active.invocation.args, [bundledCli], "JavaScript launchers preserve argument arrays through Node normalization");

const explicit = await resolveCanonicalPiRuntime({ explicitCommand: explicitShim, bundledCli, runCommand, runtime });
assert.equal(explicit.active.source, "explicit");
assert.equal(explicit.active.cliPath, explicitCli);
assert.deepEqual(explicit.active.invocation.args, [explicitCli], "Windows explicit shims normalize to their exact installation CLI");
assert.equal(explicit.path, null, "explicit identity does not silently consult PATH");

const opaque = await resolveCanonicalPiRuntime({ explicitCommand: "opaque-custom-pi", runCommand, runtime });
assert.equal(opaque.active, null);
assert.equal(opaque.refusal.code, "explicit-pi-unresolved");

const unsupported = await resolveCanonicalPiRuntime({ bundledCli: "C:\\Missing\\cli.js", pathCommand: "missing-pi", runCommand, runtime });
assert.equal(unsupported.active, null);
assert.equal(unsupported.refusal.code, "pi-runtime-unverifiable");

const webui = resolveWebuiRuntimeIdentity({ packageRoot: "C:\\Agent\\npm\\node_modules\\@firstpick\\pi-package-webui", packageName: "@firstpick/pi-package-webui", version: "v0.8.6" }, runtime);
assert.equal(webui.version, "0.8.6");
assert.equal(sameRuntimeIdentity(webui, { canonicalId: webui.canonicalId }), true);
assert.ok(calls.every((call) => Array.isArray(call.args)));
assert.ok(calls.every((call) => call.options?.timeoutMs === 10_000), "runtime probes should use the fail-closed ten-second budget by default");
console.log("update-resolver.test.mjs passed");
