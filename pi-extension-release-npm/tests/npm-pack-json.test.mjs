import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bumpScript = path.join(packageRoot, "bump-package-versions.sh");
const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-release-npm-pack-json-"));

try {
  const packageName = "@test/npm12-shape";
  const packageDir = path.join(cwd, "npm12-shape");
  const remotePackageDir = path.join(cwd, "remote", "package");
  const fakeBin = path.join(cwd, "bin");
  const packageJson = `${JSON.stringify({ name: packageName, version: "1.0.0", files: ["index.js"] }, null, 2)}\n`;

  await mkdir(packageDir, { recursive: true });
  await mkdir(remotePackageDir, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(path.join(packageDir, "package.json"), packageJson);
  await writeFile(path.join(packageDir, "index.js"), "export const value = 1;\n");
  await writeFile(path.join(remotePackageDir, "package.json"), packageJson);
  await writeFile(path.join(remotePackageDir, "index.js"), "export const value = 1;\n");

  const tarball = path.join(cwd, "test-npm12-shape-1.0.0.tgz");
  const packed = spawnSync("tar", ["-czf", tarball, "-C", path.join(cwd, "remote"), "package"], {
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);

  const fakeNpm = path.join(fakeBin, "npm");
  await writeFile(fakeNpm, `#!/bin/sh
set -eu
case "$1" in
  view)
    printf '"1.0.0"\\n'
    ;;
  pack)
    case " $* " in
      *" --dry-run "*)
        cat <<'JSON'
{"${packageName}":{"name":"${packageName}","version":"1.0.0","files":[{"path":"index.js"},{"path":"package.json"}]}}
JSON
        ;;
      *)
        cp "$FAKE_REMOTE_TARBALL" "$PWD/test-npm12-shape-1.0.0.tgz"
        printf 'test-npm12-shape-1.0.0.tgz\\n'
        ;;
    esac
    ;;
  *)
    printf 'unexpected fake npm command: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`);
  await chmod(fakeNpm, 0o755);

  const result = spawnSync("bash", [bumpScript, "--target", path.basename(packageDir)], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      PI_NPM_PACKAGES_ROOT: cwd,
      FAKE_REMOTE_TARBALL: tarball,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /publishable changes vs npm: no/u);
  assert.match(result.stdout, /action: unchanged \(no publishable changes\)/u);
  assert.match(result.stdout, /errors: 0/u);
  console.log("npm-pack-json.test.mjs passed");
} finally {
  await rm(cwd, { recursive: true, force: true });
}
