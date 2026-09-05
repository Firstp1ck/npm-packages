import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const componentFiles = [
  "AppButton.qml",
  "CompletionPopup.qml",
  "DropUpPicker.qml",
  "SelectableText.qml",
  "StatusBadge.qml",
  "TabStrip.qml",
];
const dialogFiles = [
  "AppDialog.qml",
  "ConfirmDialog.qml",
  "DirectoryDialog.qml",
  "ExtensionDialog.qml",
  "LinkDialog.qml",
  "PickerDialog.qml",
];

for (const scale of [1, 2]) test(`real Qt dialogs and interactive rows select without activation at ${scale * 100}% scaling`, { timeout: 30_000 }, async (t) => {
  const qmake = spawnSync("qmake6", ["-query", "QT_INSTALL_BINS"], { encoding: "utf8", timeout: 5_000 });
  if (qmake.error?.code === "ENOENT") return t.skip("Qt 6 qmake6 is unavailable on PATH");
  assert.ifError(qmake.error);
  assert.equal(qmake.status, 0, qmake.stderr);
  const runner = path.join(qmake.stdout.trim(), "qmltestrunner");
  const probe = spawnSync(runner, ["-help"], {
    env: { ...process.env, QT_QPA_PLATFORM: "offscreen" }, encoding: "utf8", timeout: 5_000,
  });
  if (probe.error?.code === "ENOENT") return t.skip("Qt 6 qmltestrunner is unavailable");
  assert.ifError(probe.error);
  assert.equal(probe.status, 0, probe.stderr);

  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-dialog-selectable-text-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [folder, files] of [["components", componentFiles], ["dialogs", dialogFiles]]) {
    await mkdir(path.join(directory, folder));
    for (const file of files) await cp(new URL(`../qml/${folder}/${file}`, import.meta.url), path.join(directory, folder, file));
  }
  await cp(new URL("../qml/Theme.qml", import.meta.url), path.join(directory, "Theme.qml"));
  await writeFile(path.join(directory, "tst_dialog-selectable-text.qml"), await readFile(new URL("fixtures/dialog-selectable-text-checks.qml", import.meta.url), "utf8"));

  const result = spawnSync(runner, ["-input", directory, "-o", "-,txt"], {
    env: {
      ...process.env,
      QT_QPA_PLATFORM: "offscreen",
      QT_QUICK_BACKEND: "software",
      QT_FORCE_STDERR_LOGGING: "1",
      QT_SCALE_FACTOR: String(scale),
    },
    encoding: "utf8",
    timeout: 20_000,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.error, undefined, `${result.error?.message ?? ""}\n${output}`);
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /TypeError:|ReferenceError:|Cannot assign|FAIL!/, output);
  t.diagnostic(result.stdout.trim());
});
