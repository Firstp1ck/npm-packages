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
  assert.match(manifest.dependencies?.["@earendil-works/pi-coding-agent"] ?? "", /^\^0\.84\./);
  assert.equal(manifest.engines?.node, ">=22.19.0");
  assert.deepEqual(manifest.os, ["linux"]);
});

test("package allowlist predeclares W2 QML and includes W1 runtime and documentation", () => {
  for (const entry of ["bin", "lib", "qml", "tests", "README.md", "TECHNICAL.md", "DEVELOPMENT.md", "LICENSE"]) {
    assert(manifest.files.includes(entry), `package files should include ${entry}`);
  }
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
