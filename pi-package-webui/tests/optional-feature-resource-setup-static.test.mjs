import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, readme, technical] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "README.md"), "utf8"),
  readFile(join(root, "TECHNICAL.md"), "utf8"),
]);

function optionalFeatureBlock(featureId) {
  const match = app.match(new RegExp(`\\{\\n\\s+id: "${featureId}",[\\s\\S]*?\\n\\s+\\},`));
  assert.ok(match, `optional feature ${featureId} should remain declared`);
  return match[0];
}

assert.match(optionalFeatureBlock("tuiSkillsCommand"), /setup: "skills"/, "TUI Skills command should expose a Setup action");
assert.match(optionalFeatureBlock("tuiToolsCommand"), /setup: "tools"/, "TUI Tools command should expose a Setup action");
assert.doesNotMatch(optionalFeatureBlock("questionnaire"), /setup:/, "Native questionnaires should use direct Enable/Disable controls without an unrelated Setup action");
assert.doesNotMatch(app, /Use Setup to manage session and global tool defaults\./, "tool-managed optional features should not refer users to a removed Setup action");
assert.match(app, /function optionalFeatureSetupAvailable\(feature\)[\s\S]*?case "skills": return hasLoadedRpcCommand\("skills"\);[\s\S]*?case "tools":/, "resource Setup actions should require their loaded RPC commands");
assert.match(app, /function openOptionalFeatureSetup\(feature\)[\s\S]*?case "skills": return openNativeSkillsSelector\(\);[\s\S]*?case "tools": return openNativeToolsSelector\(\);/, "resource Setup actions should open the browser-native selectors");
assert.match(app, /if \(detected && feature\.setup\)[\s\S]*?"optional-feature-action setup", "Setup"[\s\S]*?openOptionalFeatureSetup\(feature\)/, "loaded configurable optional features should render a Setup button");
assert.match(readme, /TUI Skills command[\s\S]*TUI Tools command[\s\S]*Setup/, "README should identify the Optional features entry points");
assert.match(technical, /TUI Skills command[\s\S]*TUI Tools command[\s\S]*Skills Setup and Tools Setup/, "technical reference should document both setup targets");

console.log("optional-feature-resource-setup-static.test.mjs passed");
