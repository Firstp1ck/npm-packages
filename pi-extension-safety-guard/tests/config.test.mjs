import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  SAFETY_GUARD_CATEGORIES,
  assertSafetyGuardConfigPatch,
  defaultSafetyGuardConfig,
  mergeSafetyGuardConfig,
  normalizeSafetyGuardConfig,
  readSafetyGuardConfig,
  safetyGuardConfigFile,
  writeSafetyGuardConfig,
} from "../src/config.mjs";

test("defaults enable every guard with three context lines on each side", () => {
  const config = defaultSafetyGuardConfig();

  assert.equal(config.enabled, true);
  assert.deepEqual(Object.keys(config.categories), [...SAFETY_GUARD_CATEGORIES]);
  assert.ok(Object.values(config.categories).every(Boolean));
  assert.deepEqual(config.protectedPaths, { write: true, edit: true });
  assert.deepEqual(config.contextLines, { before: 3, after: 3 });
});

test("nested patches preserve unrelated guard settings", () => {
  const config = mergeSafetyGuardConfig(defaultSafetyGuardConfig(), {
    categories: { docker: false },
    protectedPaths: { edit: false },
    contextLines: { before: 1, after: 7 },
  });

  assert.equal(config.categories.docker, false);
  assert.equal(config.categories.git, true);
  assert.deepEqual(config.protectedPaths, { write: true, edit: false });
  assert.deepEqual(config.contextLines, { before: 1, after: 7 });
});

test("normalization falls back safely and clamps persisted context values", () => {
  const config = normalizeSafetyGuardConfig({
    enabled: "no",
    categories: { git: "no", filesystem: false },
    protectedPaths: { write: 0 },
    contextLines: { before: -2, after: 100 },
  });

  assert.equal(config.enabled, true);
  assert.equal(config.categories.git, true);
  assert.equal(config.categories.filesystem, false);
  assert.equal(config.protectedPaths.write, true);
  assert.deepEqual(config.contextLines, { before: 0, after: 20 });
});

test("API patch validation rejects unknown and out-of-range settings", () => {
  assert.throws(() => assertSafetyGuardConfigPatch({ categories: { unknown: false } }), /Unknown safety guard setting/);
  assert.throws(() => assertSafetyGuardConfigPatch({ contextLines: { before: 21 } }), /integer from 0 to 20/);
  assert.throws(() => assertSafetyGuardConfigPatch({ protectedPaths: { write: "yes" } }), /must be true or false/);
});

test("config is persisted and can use an environment-overridden path", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-safety-guard-test-"));
  const storageFile = safetyGuardConfigFile({ PI_SAFETY_GUARD_CONFIG_FILE: path.join(tempDir, "nested", "guard.json") });
  try {
    const saved = writeSafetyGuardConfig({ enabled: false, contextLines: { before: 2, after: 4 } }, storageFile);
    assert.equal(saved.enabled, false);
    assert.deepEqual(saved.contextLines, { before: 2, after: 4 });
    assert.deepEqual(readSafetyGuardConfig(storageFile), saved);
    const resaved = writeSafetyGuardConfig({ enabled: true, contextLines: { after: 6 } }, storageFile);
    assert.equal(resaved.enabled, true);
    assert.deepEqual(resaved.contextLines, { before: 2, after: 6 });
    assert.equal(JSON.parse(fs.readFileSync(storageFile, "utf8")).version, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
