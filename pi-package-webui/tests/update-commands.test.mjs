import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { piUpdateCommandSteps, piUpdateCommandText, piUpdateHelpSupportsAll } from "../lib/update-commands.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

assert.deepEqual(piUpdateCommandSteps(), [
  { label: "Pi CLI", args: ["update", "--self"] },
], "Pi-only updates should use the explicit cross-version self flag");

assert.deepEqual(piUpdateCommandSteps({ all: true, supportsAll: true }), [
  { label: "Pi CLI and configured packages", args: ["update", "--all"] },
], "all updates should prefer --all when the selected Pi executable supports it");

const fallbackSteps = piUpdateCommandSteps({ all: true });
assert.deepEqual(fallbackSteps, [
  { label: "Pi CLI", args: ["update", "--self"] },
  { label: "configured Pi packages", args: ["update", "--extensions"] },
], "all updates should split self and extension updates when --all is unavailable");

assert.equal(piUpdateHelpSupportsAll("Usage: pi update [--self|--extensions|--all]"), true);
assert.equal(piUpdateHelpSupportsAll("  --all    Update pi and installed packages"), true);
assert.equal(piUpdateHelpSupportsAll("Usage: pi update [--self] [--extensions]"), false);
assert.equal(piUpdateHelpSupportsAll("  --allow-project-files"), false, "similar option names must not count as --all");

assert.equal(piUpdateCommandText(), "pi update --self");
assert.equal(piUpdateCommandText({ all: true, supportsAll: true }), "pi update --all");
assert.equal(piUpdateCommandText({ all: true }), "pi update --self && pi update --extensions");

const [server, app, readme] = await Promise.all([
  readFile(join(packageRoot, "bin", "pi-webui.mjs"), "utf8"),
  readFile(join(packageRoot, "public", "app.js"), "utf8"),
  readFile(join(packageRoot, "README.md"), "utf8"),
]);
assert.match(server, /async function piUpdateCommandSupportsAll\(command\)[\s\S]*piUpdateHelpSupportsAll/, "server should inspect update help from the selected Pi command");
assert.match(server, /resolveCommand\(\["update", "--help"\]\)[\s\S]*piUpdateCommandSteps\(\{ all, supportsAll \}\)/, "server should plan commands from the capability result");
assert.match(server, /const piTasks = await resolvePiUpdateCommands\(\{ all \}\)/, "all-mode task resolution should preserve the selected Pi update plan");
assert.match(server, /function resolveSelectedPiCommand\(piArgs\)[\s\S]*resolvePiCommandInvocation\(options\.piBin, piArgs\)/, "selected Windows Pi shims should be normalized to an executable Node and CLI invocation");
assert.match(server, /resolveCommandDirectory\(options\.piBin\)[\s\S]*piInstallDirectory[\s\S]*env: piInstallDirectory \? prependedPathEnvironment\(piInstallDirectory\)/, "Pi update tasks should put the selected Pi installation first on PATH");
assert.match(server, /preferredDirectories: \[\.\.\.new Set\(piTasks\.map\(\(task\) => task\.piInstallDirectory\)/, "package-root updates should prefer npm from the selected Pi installation");
assert.match(server, /async function runUpdateTask\(task\)[\s\S]*env: task\.env/, "update task execution should apply its install-aware environment");
assert.match(server, /allCommand: piUpdateCommandText\(\{ all: true, supportsAll: true \}\)[\s\S]*allFallbackCommand: piUpdateCommandText\(\{ all: true \}\)/, "update status should expose preferred and fallback command text");
assert.match(app, /"pi update --all" when supported, otherwise "pi update --self" followed by "pi update --extensions"/, "update confirmation should describe capability selection and fallback");
assert.match(readme, /first checks the selected Pi executable's `pi update --help`[\s\S]*uses `pi update --all` when advertised[\s\S]*otherwise falls back/, "documentation should explain the checked fallback behavior");

console.log("update command planning tests passed");
