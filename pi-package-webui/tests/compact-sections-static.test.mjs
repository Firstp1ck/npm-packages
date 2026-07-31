import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(join(root, "public", "styles.css"), "utf8");

function ruleBlock(selector, from = 0) {
  const start = css.indexOf(`${selector} {`, from);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS rule: ${selector}`);
  return css.slice(start, end + 1);
}

function propertyValue(block, property) {
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${property.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}:\\s*([^;]+);`));
  assert.ok(match, `missing ${property} in CSS rule`);
  return match[1].trim();
}

const compactStart = css.indexOf("/* Compact high-density surfaces:");
const responsiveStart = css.indexOf("@media (max-width: 1050px)");
assert.ok(compactStart >= 0 && responsiveStart > compactStart, "compact desktop overrides should stay before responsive rules so mobile adaptations win");

assert.match(
  css,
  /\/\* Compact high-density surfaces:[\s\S]*\.app-runner-widget \{[\s\S]*margin-block:\s*0\.18rem;[\s\S]*padding:\s*0\.52rem;[\s\S]*\.app-runner-live-widget \.release-npm-output-details\[open\] \.release-npm-terminal \{[\s\S]*height:\s*clamp\(8rem, 26dvh, 18rem\)/,
  "App Runner should use compact widget chrome and a smaller live terminal",
);
assert.match(
  css,
  /\/\* Compact high-density surfaces:[\s\S]*\.subagent-launch-slots-summary \{[\s\S]*min-height:\s*2\.35rem;[\s\S]*\.subagents-box \{[\s\S]*padding:\s*0\.48rem;[\s\S]*\.subagent-tab-header \{[\s\S]*min-height:\s*36px;/,
  "Subagents side-panel chrome should use the minimal scoped density treatment",
);
assert.match(
  css,
  /\/\* Keep the Files tree visual language while giving Git its denser data-list rhythm\. \*\/[\s\S]*\.git-side-panel-folder-summary,[\s\S]*\.git-side-panel-file \{[\s\S]*min-height:\s*1\.55rem;[\s\S]*padding:\s*0\.08rem 0\.26rem;[\s\S]*border:\s*1px solid transparent;[\s\S]*border-radius:\s*0\.5rem;[\s\S]*\.git-side-panel-file:focus-visible \{[\s\S]*box-shadow:\s*inset 2px 0 0 var\(--ctp-blue\)/,
  "Git changed-file rows should keep the Files tree visual language with denser spacing", 
);
assert.match(
  css,
  /\/\* Compact high-density surfaces:[\s\S]*\.git-workflow-panel \{[\s\S]*gap:\s*0\.48rem;[\s\S]*max-height:\s*min\(28rem, 40dvh\);[\s\S]*padding:\s*0\.62rem;[\s\S]*\.git-workflow-output \{[\s\S]*min-height:\s*3\.5rem;/,
  "Guided Git should use the scoped compact panel and output sizing",
);

const filesRow = ruleBlock(".file-tree-item");
const gitRows = ruleBlock(".git-side-panel-folder-summary,\n.git-side-panel-file", compactStart);
for (const property of ["color", "border-radius", "background"]) {
  assert.equal(propertyValue(gitRows, property), propertyValue(filesRow, property), `Git and Files rows should share ${property}`);
}
assert.equal(propertyValue(gitRows, "min-height"), "1.55rem", "Git file rows should keep the compact data-list height");
assert.equal(propertyValue(gitRows, "padding"), "0.08rem 0.26rem", "Git file rows should keep their compact padding");
const gitTree = ruleBlock(".git-side-panel-tree", compactStart);
assert.equal(propertyValue(gitTree, "gap"), "0", "Git tree rows should not add inter-row gaps");
assert.equal(propertyValue(gitTree, "padding"), "0.14rem 0.18rem", "Git tree container padding should remain compact");
const denseGitRowsStart = css.indexOf("/* Keep the Files tree visual language", compactStart);
const genericDetailsStart = css.indexOf("\ndetails {\n  margin: 0.5rem 0;");
assert.notEqual(genericDetailsStart, -1, "missing generic details card rule");
const genericDetails = ruleBlock("details", genericDetailsStart);
assert.equal(propertyValue(genericDetails, "padding"), "0.6rem", "generic details padding should remain explicit in the base stylesheet");
const gitFolderContainer = ruleBlock(".git-side-panel-folder", denseGitRowsStart);
assert.equal(propertyValue(gitFolderContainer, "margin"), "0", "Git directories should reset generic details margins");
assert.equal(propertyValue(gitFolderContainer, "padding"), "0", "Git directories should reset the generic details padding that creates inter-row gaps");
assert.equal(propertyValue(gitFolderContainer, "border"), "0", "Git directories should not inherit generic details borders");
assert.equal(propertyValue(gitFolderContainer, "border-radius"), "0", "Git directories should not retain generic details corner geometry");
assert.equal(propertyValue(gitFolderContainer, "background"), "transparent", "Git directories should not inherit generic details card backgrounds");
const gitFolderRow = ruleBlock(".git-side-panel-folder-summary", denseGitRowsStart);
assert.equal(propertyValue(gitFolderRow, "gap"), "0.18rem", "Git directory label spacing should remain compact");
assert.equal(propertyValue(gitFolderRow, "min-height"), "1.25rem", "Git directories should be denser than file rows");
assert.equal(propertyValue(gitFolderRow, "padding"), "0 0.2rem", "Git directories should remove vertical padding");
assert.equal(propertyValue(gitFolderRow, "line-height"), "1.1", "Git directory text should retain a compact readable line box");
const gitFolderChevron = ruleBlock(".git-side-panel-folder-chevron", denseGitRowsStart);
assert.equal(propertyValue(gitFolderChevron, "font-size"), "0.78rem", "Git directory chevrons should remain compact");
assert.equal(propertyValue(gitFolderChevron, "line-height"), "1", "Git directory chevrons should remain vertically centered");
const gitFolderBody = ruleBlock(".git-side-panel-folder-body", denseGitRowsStart);
assert.equal(propertyValue(gitFolderBody, "gap"), "0", "Nested Git entries should not add vertical gaps");
assert.equal(propertyValue(gitFolderBody, "margin"), "0 0 0 0.48rem", "Nested Git indentation should remain shallow");
assert.equal(propertyValue(gitFolderBody, "padding-left"), "0.24rem", "Nested guide padding should remain shallow");
assert.equal(propertyValue(filesRow, "border-color"), "transparent", "Files rows should start with a transparent border");
assert.equal(propertyValue(gitRows, "border"), "1px solid transparent", "Git rows should provide the same transparent one-pixel border geometry");
const filesHover = ruleBlock(".file-tree-item:hover,\n.file-tree-item:focus-visible");
const gitHover = ruleBlock(".git-side-panel-folder-summary:hover,\n.git-side-panel-folder-summary:focus-visible,\n.git-side-panel-file:hover,\n.git-side-panel-file:focus-visible", compactStart);
for (const property of ["border-color", "background", "box-shadow"]) {
  assert.equal(propertyValue(gitHover, property), propertyValue(filesHover, property), `Git and Files rows should share hover/focus ${property}`);
}

const coarseStart = css.indexOf("@media (pointer: coarse)", compactStart);
const coarseEnd = css.indexOf("@media (prefers-reduced-motion: reduce)", coarseStart);
assert.ok(coarseStart > compactStart && coarseEnd > coarseStart, "coarse-pointer protections should follow compact desktop overrides");
const coarseBlock = css.slice(coarseStart, coarseEnd);
for (const selector of [
  ".app-runner-output-controls .release-npm-action",
  ".subagent-open-mode-field select",
  ".subagent-launch-slots-summary",
  ".subagent-tab-header",
  ".git-side-panel-repository-toggle",
  ".git-side-panel-tab",
  ".git-side-panel-folder-summary",
  ".git-side-panel-file",
  "button.git-workflow-step",
  ".git-workflow-message-input",
]) {
  assert.ok(coarseBlock.includes(selector), `${selector} should retain a coarse-pointer target floor`);
}
assert.match(coarseBlock, /min-height:\s*44px;/, "coarse-pointer compact controls should retain a 44px target floor");
const guidedGitTouchRule = css.indexOf("#gitWorkflowCancelButton { min-height: 44px; }");
assert.ok(guidedGitTouchRule > compactStart, "Guided Git action touch targets should override compact desktop sizing");

console.log("compact-sections-static.test.mjs passed");
