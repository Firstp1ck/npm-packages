import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
  );
  return result;
}

function packedFilename(stdout) {
  const parsed = JSON.parse(stdout);
  const record = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  assert.equal(typeof record?.filename, "string", "npm pack JSON should include a filename");
  return record.filename;
}

test("packed package installs in isolation and resolves packaged paths", { timeout: 180_000 }, async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "qt-webui-packed-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const artifacts = path.join(workspace, "artifacts");
  const fakePiRoot = path.join(workspace, "fake-pi");
  const installRoot = path.join(workspace, "install");
  const fakeBin = path.join(workspace, "bin");
  await mkdir(path.join(fakePiRoot, "dist", "bundle"), { recursive: true });
  await mkdir(artifacts, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(path.join(fakePiRoot, "package.json"), JSON.stringify({
    name: "@earendil-works/pi-coding-agent",
    version: "0.84.3",
    type: "module",
    main: "dist/index.js",
    bin: { pi: "dist/bundle/cli.js" },
  }));
  await writeFile(path.join(fakePiRoot, "dist", "index.js"), "export {};\n");
  await writeFile(path.join(fakePiRoot, "dist", "bundle", "cli.js"), "#!/usr/bin/env node\n");

  const fakePiPack = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], { cwd: fakePiRoot });
  const fakePiTarball = path.join(artifacts, packedFilename(fakePiPack.stdout));
  const packagePack = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], { cwd: packageRoot });
  const packageTarball = path.join(artifacts, packedFilename(packagePack.stdout));

  run("npm", ["install", "--prefix", installRoot, "--ignore-scripts", "--no-audit", "--no-fund", fakePiTarball]);
  run("npm", ["install", "--prefix", installRoot, "--ignore-scripts", "--no-audit", "--no-fund", "--offline", packageTarball]);

  const fakeQuickshell = path.join(fakeBin, "quickshell");
  await cp(path.join(packageRoot, "tests", "fixtures", "fake-quickshell.mjs"), fakeQuickshell);
  await chmod(fakeQuickshell, 0o755);

  const capturePath = path.join(workspace, "capture.json");
  const installedBinDirectory = path.join(installRoot, "node_modules", ".bin");
  const invocation = run("qt-webui", ["dev"], {
    cwd: workspace,
    env: {
      ...process.env,
      PATH: `${installedBinDirectory}${path.delimiter}${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      FAKE_QUICKSHELL_CAPTURE_PATH: capturePath,
    },
  });
  assert.equal(invocation.stderr, "");

  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  const installedPackageRoot = path.join(installRoot, "node_modules", "@firstpick", "pi-package-qt-webui");
  const expectedQmlEntry = path.join(installedPackageRoot, "qml", "shell.qml");
  const expectedPiEntry = path.join(installRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
  assert.deepEqual(capture.argv, ["--path", expectedQmlEntry]);
  assert.equal(capture.cwd, workspace);
  assert.equal(capture.env.QT_WEBUI_CALLER_CWD, workspace);
  assert.equal(capture.env.QT_WEBUI_QML_ENTRY, expectedQmlEntry);
  assert.equal(capture.env.QT_WEBUI_BACKEND_ENTRY, path.join(installedPackageRoot, "lib", "backend", "main.mjs"));
  assert.equal(capture.env.QT_WEBUI_PI_CLI_ENTRY, expectedPiEntry);
  assert.equal(capture.env.QT_WEBUI_DEVELOPMENT_MODE, "1");
  assert.equal(capture.env.QT_WEBUI_NODE_EXECUTABLE, process.execPath);
});
