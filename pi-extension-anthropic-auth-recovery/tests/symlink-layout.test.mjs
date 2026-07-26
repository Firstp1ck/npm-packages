import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceEntry = path.join(packageRoot, "anthropic-subscription-auth-recovery.ts");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("preserved dev symlink resolves patch and patchctl from the canonical workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-recovery-symlink-layout-"));
  try {
    const workspace = path.join(root, "workspace");
    const extensionRoot = path.join(workspace, "pi-extension-anthropic-auth-recovery");
    const extensionSource = path.join(extensionRoot, "anthropic-subscription-auth-recovery.ts");
    const patchPath = path.join(workspace, "patches", "pi-anthropic-provider-dist-compat", "PATCH.md");
    const manifestPath = path.join(path.dirname(patchPath), "patch.manifest.json");
    const lifecyclePath = path.join(path.dirname(patchPath), "scripts", "lifecycle.mjs");
    const skillRoot = path.join(workspace, "pi-skill-patch-md");
    const patchctlPath = path.join(skillRoot, "skills", "patch-md", "scripts", "patchctl.mjs");
    const agentExtension = path.join(root, "agent", "extensions", "anthropic-subscription-auth-recovery.ts");

    write(extensionSource, fs.readFileSync(sourceEntry, "utf8"));
    write(patchPath, "# test patch\n");
    write(manifestPath, `${JSON.stringify({ lifecycle: { handler: "./scripts/lifecycle.mjs" } })}\n`);
    write(lifecyclePath, "export {};\n");
    write(patchctlPath, "export {};\n");
    fs.mkdirSync(path.dirname(agentExtension), { recursive: true });
    fs.symlinkSync(extensionSource, agentExtension);
    const workspaceDependency = path.join(workspace, "node_modules", "@firstpick", "pi-skill-patch-md");
    fs.mkdirSync(path.dirname(workspaceDependency), { recursive: true });
    fs.symlinkSync(skillRoot, workspaceDependency, "dir");

    const script = [
      `const extension = await import(${JSON.stringify(`file://${agentExtension}?preserved-dev-symlink`)});`,
      `const discovery = await extension.inspectRecoveryFiles({ PI_AGENT_DIR: ${JSON.stringify(path.join(root, "missing-agent"))} }, ${JSON.stringify(path.join(root, "unrelated-project"))});`,
      "console.log(JSON.stringify(discovery));",
      "if (!discovery.files) process.exit(2);",
    ].join("\n");
    const child = spawnSync(process.execPath, ["--preserve-symlinks", "--experimental-strip-types", "--input-type=module", "-e", script], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(child.status, 0, [child.stderr, child.stdout].filter(Boolean).join("\n"));
    const discovery = JSON.parse(child.stdout);
    assert.deepEqual(discovery.files, { patchPath, patchctlPath });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
