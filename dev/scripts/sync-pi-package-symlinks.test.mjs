import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const script = path.join(scriptDir, "sync-pi-package-symlinks.sh");
const webuiLib = path.join(repoRoot, "pi-package-webui", "lib");
const work = await mkdtemp(path.join(tmpdir(), "pi-sync-symlinks-"));
const extensions = path.join(work, "extensions");

try {
  await mkdir(extensions, { recursive: true });
  await symlink(webuiLib, path.join(extensions, "lib"));

  const result = spawnSync(script, ["--dry-run", "--color=never"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PI_EXT_DIR: extensions,
      PI_SKILL_DIR: path.join(work, "skills"),
      PI_THEME_DIR: path.join(work, "themes"),
      PI_PROMPT_DIR: path.join(work, "prompts"),
    },
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`OK\\s+${escapeRegex(path.join(extensions, "lib"))} -> ${escapeRegex(webuiLib)}`));
  assert.doesNotMatch(result.stdout, new RegExp(`RM\\s+${escapeRegex(path.join(extensions, "lib"))}`));
  assert.match(result.stdout, /Ext deps:\s+total=1 ok=1 linked=0 relinked=0 renamed=0 skipped=0/);
  console.log("sync Pi package symlink tests passed");
} finally {
  await rm(work, { recursive: true, force: true });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
