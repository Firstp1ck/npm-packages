import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OPTIONAL_FEATURE_BY_ID, OPTIONAL_FEATURE_CATALOG } from "../lib/optional-feature-catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
const extensionManifest = JSON.parse(await readFile(join(root, "..", "pi-extension-git-guided-workflow", "package.json"), "utf8"));

test("Optional Features installs the Guided Git extension that bundles its prompt companion", () => {
  assert.deepEqual(OPTIONAL_FEATURE_BY_ID.get("gitWorkflow"), {
    featureId: "gitWorkflow",
    packageName: "@firstpick/pi-extension-git-guided-workflow",
    expectedSpec: "^0.1.0",
  });
  assert.equal(OPTIONAL_FEATURE_BY_ID.has("gitGuidedWorkflow"), false, "one package install should own the complete Guided Git feature");
  assert.equal(new Set(OPTIONAL_FEATURE_CATALOG.map(({ featureId }) => featureId)).size, OPTIONAL_FEATURE_CATALOG.length);
  assert.equal(new Set(OPTIONAL_FEATURE_CATALOG.map(({ packageName }) => packageName)).size, OPTIONAL_FEATURE_CATALOG.length);

  assert.equal(extensionManifest.dependencies?.["@firstpick/pi-prompts-git-pr"], "^0.1.6");
  assert.deepEqual(extensionManifest.bundledDependencies, ["@firstpick/pi-prompts-git-pr"]);
  assert.deepEqual(extensionManifest.pi?.prompts, ["./node_modules/@firstpick/pi-prompts-git-pr/prompts"]);

  assert.match(app, /id: "gitWorkflow"[\s\S]*packageName: "@firstpick\/pi-extension-git-guided-workflow"[\s\S]*capabilityLabel: "\/git-guided-workflow"/u);
  assert.match(app, /\["git-guided-workflow", "gitWorkflow"\][\s\S]*\["git-staged-msg", "gitWorkflow"\]/u);
  assert.match(app, /optionalFeatureAvailability\.gitWorkflow = hasAvailableCommand\("git-guided-workflow"\) \|\| hasAvailableCommand\("git-staged-msg"\);/u);
  assert.match(app, /case "git-workflow": return true;/u, "the browser-owned setup must not depend on a removed prompt command");
  assert.match(app, /case "git-workflow": return openNativeGitWorkflowSetupDialog\(\);/u, "Setup must open the Guided Git workflow dialog");
});
