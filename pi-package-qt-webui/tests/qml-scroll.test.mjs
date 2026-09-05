import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const shellUrl = new URL("../qml/shell.qml", import.meta.url);

for (const scale of [1, 2]) test(`real Qt transcript scrolling preserves user intent at ${scale * 100}% scaling`, { timeout: 30_000 }, async (t) => {
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-scroll-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  for (const file of ["components/TranscriptAutoScroll.qml", "Theme.qml"]) {
    await writeFile(path.join(directory, path.basename(file)), await readFile(new URL(`../qml/${file}`, import.meta.url), "utf8"));
  }

  // Run the production ListView handlers with deterministic variable-height rows.
  const shell = await readFile(shellUrl, "utf8");
  const start = shell.lastIndexOf("ListView {", shell.indexOf("id: transcriptList"));
  const end = shell.indexOf("footer: WorkingIndicator", start);
  assert(start >= 0 && end > start);
  const list = shell.slice(start, end)
    .replace("bridge.transcriptModel", "transcriptRows")
    .replace("bridge.compactTranscript ? 6 : 12", "12");
  await writeFile(path.join(directory, "TranscriptUnderTest.qml"), `import QtQuick
import QtQuick.Controls
${list}
    property alias rows: transcriptRows
    property alias scrollBar: transcriptScrollBar
    property alias autoScroll: transcriptAutoScroll
    property bool selectableRows: false
    Theme { id: appTheme }
    ListModel { id: transcriptRows }
    delegate: Rectangle {
        required property real rowHeight
        width: ListView.view.width
        height: rowHeight
        color: "#333333"
        TextEdit {
            anchors.fill: parent
            visible: transcriptList.selectableRows
            enabled: visible
            text: "Selectable transcript output"
            readOnly: true
            selectByMouse: true
        }
    }
}
`);
  await writeFile(path.join(directory, "tst_scroll.qml"), await readFile(new URL("fixtures/scroll-checks.qml", import.meta.url), "utf8"));
  const result = spawnSync(runner, ["-input", directory, "-o", "-,txt"], {
    env: { ...process.env, QT_QPA_PLATFORM: "offscreen", QT_QUICK_BACKEND: "software", QT_FORCE_STDERR_LOGGING: "1", QT_SCALE_FACTOR: String(scale) },
    encoding: "utf8", timeout: 20_000,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.error, undefined, `${result.error?.message ?? ""}\n${output}`);
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /TypeError:|ReferenceError:|Cannot assign|FAIL!/, output);
  t.diagnostic(result.stdout.trim());
});
