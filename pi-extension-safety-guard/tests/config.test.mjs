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

test("defaults enable every guard while auto-review remains safely off", () => {
  const config = defaultSafetyGuardConfig();

  assert.equal(config.enabled, true);
  assert.deepEqual(Object.keys(config.categories), [...SAFETY_GUARD_CATEGORIES]);
  assert.ok(Object.values(config.categories).every(Boolean));
  assert.deepEqual(config.protectedPaths, { write: true, edit: true });
  assert.deepEqual(config.contextLines, { before: 3, after: 3 });
  assert.deepEqual(config.autoReview, {
    enabled: false,
    model: { provider: "", modelId: "", thinkingLevel: "off" },
  });
});

test("nested patches preserve unrelated guard settings", () => {
  const config = mergeSafetyGuardConfig(defaultSafetyGuardConfig(), {
    categories: { docker: false },
    protectedPaths: { edit: false },
    contextLines: { before: 1, after: 7 },
    autoReview: { model: { provider: "provider-a", modelId: "model-a", thinkingLevel: "high" } },
  });

  assert.equal(config.categories.docker, false);
  assert.equal(config.categories.git, true);
  assert.deepEqual(config.protectedPaths, { write: true, edit: false });
  assert.deepEqual(config.contextLines, { before: 1, after: 7 });
  assert.deepEqual(config.autoReview, {
    enabled: false,
    model: { provider: "provider-a", modelId: "model-a", thinkingLevel: "high" },
  });
});

test("v1 normalization safely migrates old config and rejects malformed persisted auto-review values", () => {
  const config = normalizeSafetyGuardConfig({
    version: 1,
    enabled: "no",
    categories: { git: "no", filesystem: false },
    protectedPaths: { write: 0 },
    contextLines: { before: -2, after: 100 },
    autoReview: { enabled: "yes", model: { provider: "ba\nd", modelId: 7, thinkingLevel: "ultra" } },
  });

  assert.equal(config.enabled, true);
  assert.equal(config.categories.git, true);
  assert.equal(config.categories.filesystem, false);
  assert.equal(config.protectedPaths.write, true);
  assert.deepEqual(config.contextLines, { before: 0, after: 20 });
  assert.deepEqual(config.autoReview, {
    enabled: false,
    model: { provider: "", modelId: "", thinkingLevel: "off" },
  });

  const oldShape = normalizeSafetyGuardConfig({ version: 1, enabled: false });
  assert.equal(oldShape.version, 1);
  assert.deepEqual(oldShape.autoReview, defaultSafetyGuardConfig().autoReview);
});

test("API patch validation rejects unknown and out-of-range settings", () => {
  assert.throws(() => assertSafetyGuardConfigPatch({ categories: { unknown: false } }), /Unknown safety guard setting/);
  assert.throws(() => assertSafetyGuardConfigPatch({ contextLines: { before: 21 } }), /integer from 0 to 20/);
  assert.throws(() => assertSafetyGuardConfigPatch({ protectedPaths: { write: "yes" } }), /must be true or false/);
  assert.throws(() => assertSafetyGuardConfigPatch({ autoReview: { unknown: true } }), /Unknown safety guard setting/);
  assert.throws(() => assertSafetyGuardConfigPatch({ autoReview: { model: { provider: " spaced " } } }), /trimmed string/);
  assert.throws(() => assertSafetyGuardConfigPatch({ autoReview: { model: { thinkingLevel: "ultra" } } }), /must be one of/);
});

test("config is persisted and can use an environment-overridden path", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-safety-guard-test-"));
  const storageFile = safetyGuardConfigFile({ PI_SAFETY_GUARD_CONFIG_FILE: path.join(tempDir, "nested", "guard.json") });
  try {
    const saved = writeSafetyGuardConfig({
      enabled: false,
      contextLines: { before: 2, after: 4 },
      autoReview: { enabled: true, model: { provider: "provider-a", modelId: "model-a", thinkingLevel: "low" } },
    }, storageFile);
    assert.equal(saved.enabled, false);
    assert.deepEqual(saved.contextLines, { before: 2, after: 4 });
    assert.equal(saved.autoReview.enabled, true);
    assert.deepEqual(readSafetyGuardConfig(storageFile), saved);
    const resaved = writeSafetyGuardConfig({ enabled: true, contextLines: { after: 6 }, autoReview: { enabled: false } }, storageFile);
    assert.equal(resaved.enabled, true);
    assert.deepEqual(resaved.contextLines, { before: 2, after: 6 });
    assert.deepEqual(resaved.autoReview.model, saved.autoReview.model);
    assert.equal(resaved.autoReview.enabled, false);
    assert.equal(JSON.parse(fs.readFileSync(storageFile, "utf8")).version, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
