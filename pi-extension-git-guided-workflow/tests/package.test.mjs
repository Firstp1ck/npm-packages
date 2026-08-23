import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const promptManifest = JSON.parse(await readFile(new URL("../../pi-package-prompts-git-pr/package.json", import.meta.url), "utf8"));

test("the extension bundles and registers the Git prompt companion", () => {
  assert.equal(promptManifest.name, "@firstpick/pi-prompts-git-pr");
  assert.equal(promptManifest.version, "0.1.6");
  assert.equal(manifest.dependencies?.[promptManifest.name], "^0.1.6");
  assert.deepEqual(manifest.bundledDependencies, [promptManifest.name]);
  assert.deepEqual(manifest.pi?.prompts, ["./node_modules/@firstpick/pi-prompts-git-pr/prompts"]);
  assert.deepEqual(manifest.pi?.extensions, ["./index.ts"]);
});
