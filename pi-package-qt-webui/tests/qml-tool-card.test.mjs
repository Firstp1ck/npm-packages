import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

for (const scale of [1, 2]) test(`tool rows expand and copy at ${scale * 100}% scaling`, { timeout: 30_000 }, async (t) => {
  const qmake = spawnSync("qmake6", ["-query", "QT_INSTALL_BINS"], { encoding: "utf8", timeout: 5_000 });
  if (qmake.error?.code === "ENOENT") return t.skip("Qt 6 qmake6 is unavailable");
  assert.ifError(qmake.error);
  assert.equal(qmake.status, 0, qmake.stderr);
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-tool-card-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ["Theme.qml", "components/ToolCard.qml", "components/AppButton.qml", "components/SelectableText.qml", "components/StatusBadge.qml"]) {
    await writeFile(path.join(directory, path.basename(file)), await readFile(new URL(`../qml/${file}`, import.meta.url), "utf8"));
  }
  await writeFile(path.join(directory, "tst_tool-card.qml"), await readFile(new URL("fixtures/tool-card-checks.qml", import.meta.url), "utf8"));
  const result = spawnSync(path.join(qmake.stdout.trim(), "qmltestrunner"), ["-input", directory, "-o", "-,txt"], {
    env: { ...process.env, QT_QPA_PLATFORM: "offscreen", QT_QUICK_BACKEND: "software", QT_FORCE_STDERR_LOGGING: "1", QT_SCALE_FACTOR: String(scale) },
    encoding: "utf8", timeout: 20_000,
  });
  if (result.error?.code === "ENOENT") return t.skip("Qt 6 qmltestrunner is unavailable");
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /TypeError:|ReferenceError:|Cannot assign|binding loop|FAIL!/i, output);
  t.diagnostic(result.stdout.trim());
});
