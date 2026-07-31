import assert from "node:assert/strict";
import path from "node:path";
import { prependPathDirectory, prependedPathEnvironment, resolveCommandDirectory, resolveNpmCommandInvocation, resolvePiCommandInvocation } from "../lib/npm-command.mjs";

const windowsExecPath = "C:\\PortableNode\\node.exe";
const bundledCli = "C:\\PortableNode\\node_modules\\npm\\bin\\npm-cli.js";
const requestedArgs = ["install", "--prefix", "C:\\Pi Packages", "@firstpick/example@latest"];

const bundled = resolveNpmCommandInvocation(requestedArgs, {
  platform: "win32",
  execPath: windowsExecPath,
  env: { PATH: "C:\\Windows\\System32;C:\\PortableNode" },
  existsSync: (candidate) => path.win32.normalize(candidate) === path.win32.normalize(bundledCli),
});
assert.equal(bundled.command, windowsExecPath, "Windows npm should run through the current Node executable");
assert.deepEqual(bundled.args, [bundledCli, ...requestedArgs], "Windows npm should prefix arguments with bundled npm-cli.js");
assert.equal(bundled.displayCommand, "npm", "automatic resolution should keep readable npm command output");
assert.equal(bundled.source, "node-cli");

const pathCli = "D:\\NodeOnPath\\node_modules\\npm\\bin\\npm-cli.js";
const fromPath = resolveNpmCommandInvocation(["root", "-g"], {
  platform: "win32",
  execPath: windowsExecPath,
  env: { PATH: "C:\\Windows\\System32;D:\\NodeOnPath" },
  existsSync: (candidate) => path.win32.normalize(candidate) === path.win32.normalize(pathCli),
});
assert.deepEqual(fromPath.args, [pathCli, "root", "-g"], "Windows resolution should find npm-cli.js beside an npm directory on PATH");

const selectedPiDirectory = "C:\\PortablePi";
const selectedPi = `${selectedPiDirectory}\\pi`;
const selectedPiNpmCli = `${selectedPiDirectory}\\node_modules\\npm\\bin\\npm-cli.js`;
const staleNpmDirectory = "C:\\Users\\Example\\AppData\\Roaming\\npm";
const selectedDirectory = resolveCommandDirectory("pi", {
  platform: "win32",
  env: { PATH: `${staleNpmDirectory};${selectedPiDirectory}` },
  existsSync: (candidate) => path.win32.normalize(candidate) === path.win32.normalize(selectedPi),
});
assert.equal(selectedDirectory, selectedPiDirectory, "Pi should be resolved from its actual PATH entry, not an unrelated earlier npm directory");
assert.equal(
  prependPathDirectory(selectedDirectory, { platform: "win32", env: { PATH: `${staleNpmDirectory};${selectedPiDirectory}` } }),
  `${selectedPiDirectory};${staleNpmDirectory}`,
  "the selected Pi installation should lead PATH while its update runs",
);
assert.deepEqual(
  prependedPathEnvironment(selectedDirectory, { platform: "win32", env: { Path: `${staleNpmDirectory};${selectedPiDirectory}` } }),
  { Path: `${selectedPiDirectory};${staleNpmDirectory}` },
  "Windows updates should preserve the existing Path key casing",
);

const fromSelectedPi = resolveNpmCommandInvocation(["install"], {
  platform: "win32",
  execPath: windowsExecPath,
  env: { PATH: `${staleNpmDirectory};${selectedPiDirectory}` },
  preferredDirectories: [selectedDirectory],
  existsSync: (candidate) => path.win32.normalize(candidate) === path.win32.normalize(selectedPiNpmCli),
});
assert.deepEqual(fromSelectedPi.args, [selectedPiNpmCli, "install"], "package updates should use npm bundled beside the selected Pi installation");

const selectedPiNode = `${selectedPiDirectory}\\node.exe`;
const selectedPiCli = `${selectedPiDirectory}\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js`;
const explicitPi = resolvePiCommandInvocation(selectedPi, ["update", "--help"], {
  platform: "win32",
  execPath: windowsExecPath,
  env: { PATH: staleNpmDirectory },
  existsSync: (candidate) => [selectedPi, selectedPiNode, selectedPiCli].some((expected) => path.win32.normalize(candidate) === path.win32.normalize(expected)),
});
assert.equal(explicitPi.command, selectedPiNode, "an explicit Windows Pi shim should run through Node from the same installation");
assert.deepEqual(explicitPi.args, [selectedPiCli, "update", "--help"], "an explicit Windows Pi shim should resolve to that installation's CLI script");

const selectedPiCmd = `${selectedPiDirectory}\\pi.cmd`;
const extensionResolvedPi = resolvePiCommandInvocation(selectedPi, ["--version"], {
  platform: "win32",
  execPath: windowsExecPath,
  env: { PATH: staleNpmDirectory, PATHEXT: ".exe;.cmd" },
  existsSync: (candidate) => [selectedPiCmd, selectedPiNode, selectedPiCli].some((expected) => path.win32.normalize(candidate) === path.win32.normalize(expected)),
});
assert.equal(extensionResolvedPi.command, selectedPiNode, "an extensionless explicit path should resolve a matching pi.cmd through PATHEXT");
assert.deepEqual(extensionResolvedPi.args, [selectedPiCli, "--version"]);

const customPiExecutable = `${selectedPiDirectory}\\custom-pi.exe`;
assert.deepEqual(
  resolvePiCommandInvocation(customPiExecutable, ["--version"], {
    platform: "win32",
    execPath: windowsExecPath,
    existsSync: (candidate) => [customPiExecutable, selectedPiCli].some((expected) => path.win32.normalize(candidate) === path.win32.normalize(expected)),
  }),
  { command: customPiExecutable, args: ["--version"], source: "command" },
  "explicit custom Pi executables should not be replaced by npm-shim normalization",
);

const configuredShim = "E:\\CustomNode\\npm.cmd";
const configuredCli = "E:\\CustomNode\\node_modules\\npm\\bin\\npm-cli.js";
const configured = resolveNpmCommandInvocation(["--version"], {
  platform: "win32",
  execPath: windowsExecPath,
  env: { PI_WEBUI_NPM_BIN: configuredShim, PATH: "" },
  preferredDirectories: [selectedPiDirectory],
  existsSync: (candidate) => path.win32.normalize(candidate) === path.win32.normalize(configuredCli),
});
assert.equal(configured.command, windowsExecPath, "a configured npm.cmd shim should be normalized to its npm CLI");
assert.deepEqual(configured.args, [configuredCli, "--version"]);
assert.equal(configured.displayCommand, configuredShim);

const customExecutable = resolveNpmCommandInvocation(["install"], {
  platform: "win32",
  execPath: windowsExecPath,
  env: { PI_WEBUI_NPM_BIN: "E:\\tools\\custom-npm.exe" },
  existsSync: () => false,
});
assert.deepEqual(customExecutable, {
  command: "E:\\tools\\custom-npm.exe",
  args: ["install"],
  displayCommand: "E:\\tools\\custom-npm.exe",
  displayArgs: ["install"],
  source: "configured-command",
}, "custom executable overrides should remain supported");

const fallback = resolveNpmCommandInvocation(["--version"], {
  platform: "linux",
  execPath: "/usr/bin/node",
  env: { PATH: "/usr/bin" },
  existsSync: () => false,
});
assert.equal(fallback.command, "npm", "non-bundled installations should retain PATH fallback behavior");
assert.deepEqual(fallback.args, ["--version"]);

console.log("npm command resolution tests passed");
