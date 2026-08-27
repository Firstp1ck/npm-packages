import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
assert.match(source, /pi\.registerCommand\("tools"/);
assert.match(source, /pi\.registerCommand\("skills"/);
assert.doesNotMatch(
  source,
  /const runtimeToolBaseline\s*=\s*normalizeResourceNameList\(pi\.getActiveTools\(\)\)/,
  "extension action methods must not run while the extension factory is loading",
);
assert.match(source, /const runtimeTools = \(\): string\[\] => runtimeToolBaseline \?\?=/, "the tool baseline should be captured lazily after runtime binding");
assert.match(source, /ctx\.mode !== "tui"/);
assert.match(source, /pi\.on\("model_select"/);
assert.match(source, /await recompute\(ctx, event\.model\)/, "model selection should immediately recompute exact-model resources");
assert.match(source, /"Session only", "Global default", "Model default"/);
assert.match(source, /"Use inherited defaults"/);
assert.match(source, /selectTuiModelProfile\(ctx, \{/, "exact-model profiles should use the shared searchable model picker");
assert.match(source, /selectTuiResources\(ctx, \{/, "resource lists should use the shared keyboard-driven selector");
assert.match(source, /preserveUnavailableResourceNames\(/);
assert.match(source, /setExactModelProfile\(/);
assert.match(source, /skill\.disableModelInvocation !== true/);

console.log("resource-tui-extension.test.mjs passed");
