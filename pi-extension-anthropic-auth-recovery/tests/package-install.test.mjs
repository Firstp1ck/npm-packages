import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "..");
const skillRoot = path.join(workspaceRoot, "pi-skill-patch-md");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, [result.stderr, result.stdout].filter(Boolean).join("\n"));
  return result.stdout;
}

function pack(packageDirectory, destination) {
  const output = run("npm", ["pack", "--json", "--pack-destination", destination], packageDirectory);
  const payload = JSON.parse(output);
  const entries = Array.isArray(payload) ? payload : Object.values(payload);
  assert.equal(entries.length, 1);
  assert.equal(typeof entries[0].filename, "string");
  return path.join(destination, entries[0].filename);
}

test("packed extension installs offline with all recovery resources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-recovery-package-install-"));
  try {
    const tarballs = path.join(root, "tarballs");
    const installRoot = path.join(root, "install");
    fs.mkdirSync(tarballs, { recursive: true });
    fs.mkdirSync(installRoot, { recursive: true });
    fs.writeFileSync(path.join(installRoot, "package.json"), JSON.stringify({ private: true }), "utf8");

    const skillTarball = pack(skillRoot, tarballs);
    const extensionTarball = pack(packageRoot, tarballs);
    run("npm", [
      "install",
      "--offline",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      skillTarball,
      extensionTarball,
    ], installRoot);

    const extensionRoot = path.join(installRoot, "node_modules", "@firstpick", "pi-extension-anthropic-auth-recovery");
    const extensionEntry = path.join(extensionRoot, "anthropic-subscription-auth-recovery.ts");
    const patchPath = path.join(extensionRoot, "resources", "pi-anthropic-provider-dist-compat", "PATCH.md");
    const manifestPath = path.join(path.dirname(patchPath), "patch.manifest.json");
    const lifecyclePath = path.join(path.dirname(patchPath), "scripts", "lifecycle.mjs");
    for (const file of [extensionEntry, patchPath, manifestPath, lifecyclePath]) {
      assert.equal(fs.existsSync(file), true, `missing packed resource: ${file}`);
    }

    const requireFromExtension = createRequire(pathToFileURL(extensionEntry));
    const patchctlPath = requireFromExtension.resolve("@firstpick/pi-skill-patch-md/skills/patch-md/scripts/patchctl.mjs");
    assert.match(patchctlPath, /node_modules\/@firstpick\/pi-skill-patch-md\/skills\/patch-md\/scripts\/patchctl\.mjs$/u);

    const stateDirectory = path.join(root, "state");
    const statusOutput = run(process.execPath, [patchctlPath, "status", "--patch", patchPath, "--state-dir", stateDirectory], installRoot);
    const status = JSON.parse(statusOutput);
    assert.equal(status.action, "status");
    assert.equal(status.patchId, "pi.anthropic-provider-dist-compat");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
