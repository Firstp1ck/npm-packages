import assert from "node:assert/strict";
import path from "node:path";
import { resolveNpmCommandInvocation } from "../lib/npm-command.mjs";

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

const configuredShim = "E:\\CustomNode\\npm.cmd";
const configuredCli = "E:\\CustomNode\\node_modules\\npm\\bin\\npm-cli.js";
const configured = resolveNpmCommandInvocation(["--version"], {
  platform: "win32",
  execPath: windowsExecPath,
  env: { PI_WEBUI_NPM_BIN: configuredShim, PATH: "" },
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
