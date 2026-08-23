import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceReleaseWorkflow = path.join(packageRoot, "release-workflow.sh");
const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-release-npm-bundled-deps-"));

try {
  const toolsDir = path.join(cwd, "tools");
  const repoDir = path.join(cwd, "repo");
  const packageDir = path.join(repoDir, "fixture");
  const fakeBin = path.join(cwd, "bin");
  const npmLog = path.join(cwd, "npm.log");
  const publishLog = path.join(cwd, "publish.log");

  await mkdir(toolsDir, { recursive: true });
  await mkdir(packageDir, { recursive: true });
  await mkdir(fakeBin, { recursive: true });

  const releaseWorkflow = path.join(toolsDir, "release-workflow.sh");
  await writeFile(releaseWorkflow, await readFile(sourceReleaseWorkflow, "utf8"));
  await chmod(releaseWorkflow, 0o755);

  const passthroughCheck = path.join(toolsDir, "check-publish-readiness.sh");
  await writeFile(passthroughCheck, "#!/bin/sh\nexit 0\n");
  await chmod(passthroughCheck, 0o755);

  const fakeBump = path.join(toolsDir, "bump-package-versions.sh");
  await writeFile(fakeBump, `#!/bin/sh
set -eu
candidate_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --candidate-targets-file)
      candidate_file="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [ -n "$candidate_file" ]; then
  printf 'fixture\\n' > "$candidate_file"
fi
`);
  await chmod(fakeBump, 0o755);

  const fakePublish = path.join(toolsDir, "publish-packages.sh");
  await writeFile(fakePublish, `#!/bin/sh
set -eu
test -f "$PI_NPM_PACKAGES_ROOT/fixture/node_modules/@test/pi-prompts/package.json"
test -d "$PI_NPM_PACKAGES_ROOT/fixture/node_modules/@test/pi-prompts/prompts"
printf '%s\\n' "$PI_NPM_PACKAGES_ROOT" >> "$FAKE_PUBLISH_LOG"
`);
  await chmod(fakePublish, 0o755);

  const fakeNpm = path.join(fakeBin, "npm");
  await writeFile(fakeNpm, `#!/bin/sh
set -eu
printf '%s|%s\\n' "$PWD" "$*" >> "$FAKE_NPM_LOG"
test "\${1:-}" = install
mkdir -p node_modules/@test/pi-prompts/prompts
printf '{"name":"@test/pi-prompts","version":"1.0.0"}\\n' > node_modules/@test/pi-prompts/package.json
printf '# prompt\\n' > node_modules/@test/pi-prompts/prompts/example.md
`);
  await chmod(fakeNpm, 0o755);

  await writeFile(path.join(packageDir, "package.json"), `${JSON.stringify({
    name: "@test/fixture",
    version: "1.0.0",
    dependencies: { "@test/pi-prompts": "1.0.0" },
    bundledDependencies: ["@test/pi-prompts"],
    pi: { prompts: ["./node_modules/@test/pi-prompts/prompts"] },
  }, null, 2)}\n`);

  const env = {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    PI_NPM_PACKAGES_ROOT: repoDir,
    FAKE_NPM_LOG: npmLog,
    FAKE_PUBLISH_LOG: publishLog,
  };

  const plan = spawnSync("bash", [releaseWorkflow, "--plan", "--target", "fixture", "--no-strict-auth"], {
    encoding: "utf8",
    env,
  });
  assert.equal(plan.status, 0, plan.stderr || plan.stdout);
  assert.match(plan.stdout, /Materializing bundled dependencies for fixture: @test\/pi-prompts/u);
  await assert.rejects(readFile(path.join(packageDir, "node_modules", "@test", "pi-prompts", "package.json")));

  const publishRootsAfterPlan = (await readFile(publishLog, "utf8")).trim().split("\n");
  assert.equal(publishRootsAfterPlan.length, 1);
  assert.notEqual(publishRootsAfterPlan[0], repoDir, "plan validation must use the temporary workspace");

  const publish = spawnSync("bash", [releaseWorkflow, "--publish", "--target", "fixture", "--no-strict-auth"], {
    encoding: "utf8",
    env,
  });
  assert.equal(publish.status, 0, publish.stderr || publish.stdout);
  assert.match(publish.stdout, /Materializing bundled dependencies for fixture: @test\/pi-prompts/u);
  assert.match(await readFile(path.join(packageDir, "node_modules", "@test", "pi-prompts", "package.json"), "utf8"), /@test\/pi-prompts/u);

  const npmInvocations = (await readFile(npmLog, "utf8")).trim().split("\n");
  assert.equal(npmInvocations.length, 2);
  for (const invocation of npmInvocations) {
    assert.match(invocation, /install --ignore-scripts --omit=dev --omit=peer --no-save --package-lock=false$/u);
  }

  const publishRoots = (await readFile(publishLog, "utf8")).trim().split("\n");
  assert.deepEqual(publishRoots, [publishRootsAfterPlan[0], repoDir]);
  console.log("bundled-dependencies.test.mjs passed");
} finally {
  await rm(cwd, { recursive: true, force: true });
}
