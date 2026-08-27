import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

test("package identity, command, dependency, and runtime requirements are declared", () => {
  assert.equal(manifest.name, "@firstpick/pi-package-qt-webui");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.bin?.["qt-webui"], "./bin/qt-webui.mjs");
  assert.deepEqual(manifest.pi?.extensions, ["./extensions/qt-webui-start.mjs"]);
  assert.match(manifest.dependencies?.["@earendil-works/pi-coding-agent"] ?? "", /^\^0\.84\./);
  assert.match(manifest.dependencies?.["@firstpick/pi-package-webui"] ?? "", /^\^0\.9\.9$/);
  assert.equal(manifest.engines?.node, ">=22.19.0");
  assert.deepEqual(manifest.os, ["linux"]);
});

test("package allowlist includes the Pi extension, runtime, QML, tests, and documentation", () => {
  for (const entry of ["bin", "extensions", "lib", "qml", "screenshots", "tests", "README.md", "TECHNICAL.md", "DEVELOPMENT.md", "LICENSE"]) {
    assert(manifest.files.includes(entry), `package files should include ${entry}`);
  }
});

test("README session screenshot is a nontrivial PNG", async () => {
  const screenshot = await readFile(path.join(root, "screenshots", "session-settlement.png"));
  assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert(screenshot.readUInt32BE(16) >= 560, "screenshot width should show the supported minimum window");
  assert(screenshot.readUInt32BE(20) >= 520, "screenshot height should show the supported minimum window");
});

test("development and test scripts use the source launcher without lifecycle hooks", () => {
  assert.equal(manifest.scripts.dev, "node ./bin/qt-webui.mjs dev");
  assert.equal(manifest.scripts.test, "node tests/run-all.mjs");
  for (const lifecycleName of ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"]) {
    assert.equal(manifest.scripts[lifecycleName], undefined, `${lifecycleName} should not be defined`);
  }
});

test("qt-webui npm bin is executable", async () => {
  const mode = (await stat(path.join(root, "bin", "qt-webui.mjs"))).mode;
  assert.notEqual(mode & 0o111, 0, "bin/qt-webui.mjs should have an executable bit");
});

test("launcher uses argument arrays and disables shell execution", async () => {
  const source = await readFile(path.join(root, "lib", "launcher.mjs"), "utf8");
  assert.match(source, /args:\s*\["--path", qmlEntry\]/);
  assert.match(source, /shell:\s*false/);
  assert.match(source, /!name\.startsWith\("QT_WEBUI_"\)/);
  assert.doesNotMatch(source, /exec(?:File)?Sync\s*\(/);
});
