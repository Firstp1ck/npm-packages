import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.dirname(packageRoot);

const read = (relativePath) => readFile(path.join(packageRoot, relativePath), "utf8");

const [
  packageText,
  skill,
  developmentWorkflow,
  publishingChecklist,
  readme,
  technical,
  development,
  routingText,
  repositoryReadme,
] = await Promise.all([
  read("package.json"),
  read("skills/omarchy-plugin/SKILL.md"),
  read("skills/omarchy-plugin/references/DEVELOPMENT-WORKFLOW.md"),
  read("skills/omarchy-plugin/references/PUBLISHING-CHECKLIST.md"),
  read("README.md"),
  read("TECHNICAL.md"),
  read("DEVELOPMENT.md"),
  read("tests/routing/omarchy-plugin.json"),
  readFile(path.join(repositoryRoot, "README.md"), "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  }),
]);

const packageJson = JSON.parse(packageText);
const routing = JSON.parse(routingText);

const expectedPackageFiles = [
  "DEVELOPMENT.md",
  "LICENSE",
  "README.md",
  "TECHNICAL.md",
  "skills/omarchy-plugin/SKILL.md",
  "skills/omarchy-plugin/references/DEVELOPMENT-WORKFLOW.md",
  "skills/omarchy-plugin/references/PUBLISHING-CHECKLIST.md",
  "tests/routing/omarchy-plugin.json",
  "tests/skill-contract.test.mjs",
].sort();

function assertContainsAll(text, patterns) {
  for (const pattern of patterns) assert.match(text, pattern);
}

function assertUniqueStrings(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && value.trim()), `${label} must contain non-empty strings`);
  assert.equal(new Set(values).size, values.length, `${label} must not contain duplicates`);
}

test("package metadata and portable skill identity are exact", () => {
  assert.equal(packageJson.name, "@firstpick/pi-skill-omarchy-plugin");
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.license, "MIT");
  assert.deepEqual(packageJson.pi?.skills, ["./skills"]);
  assert.equal(packageJson.scripts?.test, "node --test tests/skill-contract.test.mjs");
  assert.equal(Object.hasOwn(packageJson, "dependencies"), false);
  assert.deepEqual([...packageJson.files].sort(), expectedPackageFiles);

  assert.match(skill, /^---\nname: omarchy-plugin\n/m);
  assert.match(skill, /description: .*Omarchy Quattro plugins/);
  assertContainsAll(skill, [
    /\[references\/DEVELOPMENT-WORKFLOW\.md\]\(references\/DEVELOPMENT-WORKFLOW\.md\)/,
    /\[references\/PUBLISHING-CHECKLIST\.md\]\(references\/PUBLISHING-CHECKLIST\.md\)/,
    /## Verification/,
    /## Safety and Failure Modes/,
    /## Pi Adapter/,
  ]);
});

test("official guides are primary sources and the current shell reference remains authoritative", () => {
  assertContainsAll(skill, [
    /official development and publishing guides are the primary product sources/i,
    /official Omarchy shell\/plugin reference.*runtime detail/i,
    /https:\/\/omarchyplugins\.com\/develop\.html/,
    /https:\/\/omarchyplugins\.com\/publish\.html/,
  ]);
  assert.match(developmentWorkflow, /official \[development guide\]\(https:\/\/omarchyplugins\.com\/develop\.html\)/);
  assert.match(developmentWorkflow, /shell reference is authoritative for the current runtime contract/i);
  assert.match(publishingChecklist, /official \[publishing guide\]\(https:\/\/omarchyplugins\.com\/publish\.html\)/);
});

test("ordered workflow preserves kind, clone, manifest, validation, and identity contracts", () => {
  assertContainsAll(skill, [
    /Follow these decisions in order/,
    /every declared kind agree with its `entryPoints` key and file/,
    /panel loaded internally by a bar widget is part of that `bar-widget`/,
    /\$HOME\/\.config\/omarchy\/plugins\/<development-id>\//,
    /discovers and enables the copy and can replace the cloned built-in immediately/,
    /Parse JSON, inspect the file tree, reject symlinks/,
    /remove clone-only `omarchy\.clonedFrom` metadata/,
    /must not use the reserved `omarchy\.\*` namespace/,
  ]);

  for (const mapping of [
    /`bar-widget` \| `barWidget` \| `BarWidget\.qml`/,
    /`panel` \| `panel` \| `Panel\.qml`/,
    /`overlay` \| `overlay` \| `Overlay\.qml`/,
    /`menu` \| `menu` \| `Menu\.qml`/,
    /`service` \| `service` \| `Service\.qml`/,
    /`bar` \| `bar` \| `Bar\.qml`/,
  ]) assert.match(developmentWorkflow, mapping);

  assert.match(developmentWorkflow, /Run read-only static checks/);
  assert.match(developmentWorkflow, /Run authorized lifecycle checks/);
});

test("safety contract treats plugin source and lifecycle operations as high impact", () => {
  assertContainsAll(skill, [
    /unsandboxed with the user's permissions inside the shared, long-running shell process/,
    /Review every dependency, executable, installer, network call, and shell command/,
    /Never start a second Quickshell process/,
    /Plugin trees must contain \*\*no symlinks\*\*/,
    /Runtime disable, re-enable, restart, and removal are state changes/,
  ]);
  assertContainsAll(developmentWorkflow, [
    /reject any plugin tree containing a symlink/,
    /get explicit confirmation for clone, install, enable, disable/,
    /do not execute opaque install snippets/,
  ]);
  assertContainsAll(publishingChecklist, [
    /Plugins run unsandboxed with user permissions in the shared Omarchy shell/,
    /Marketplace validation checks listing structure, not plugin security/,
    /complete tree contains no symlinks/,
  ]);
});

test("publication preparation stops for confirmation before external effects", () => {
  assertContainsAll(skill, [
    /prepare publication files or submission content without submitting it/,
    /Stop before making the repository public, pushing, opening the Marketplace issue form, submitting an issue, or publishing unless.*authorized/i,
    /requested confirmation or the exact publication boundary where work stopped/,
  ]);
  assertContainsAll(publishingChecklist, [
    /This checklist prepares evidence; it does not authorize external actions/,
    /Stop for explicit confirmation/,
    /Authorization for preparation is not authorization for submission/,
    /https:\/\/github\.com\/HANCORE-linux\/omarchy-plugin-marketplace\/issues\/new\?template=submit-plugin\.yml/,
    /do not open it when that would transmit data or create browser state unless.*authorized/i,
    /never imply Marketplace approval from successful issue creation/,
  ]);
});

test("documentation layers provide user guidance without leaking contributor detail", () => {
  assertContainsAll(readme, [
    /^# Omarchy Plugin$/m,
    /^## Helpful when$/m,
    /^## What to share with Pi$/m,
    /^## Try asking$/m,
    /^## What you'll get$/m,
    /^## Keep in mind$/m,
    /^## Install$/m,
    /pi install npm:@firstpick\/pi-skill-omarchy-plugin/,
    /When this package is available from npm/,
    /\[TECHNICAL\.md\]\(TECHNICAL\.md\)/,
  ]);
  assert.doesNotMatch(readme, /tests\//);
  assert.doesNotMatch(readme, /skills\/omarchy-plugin/);

  assert.match(technical, /^# Technical reference: Omarchy Plugin$/m);
  assertContainsAll(technical, [
    /\[Back to README\]\(README\.md\)/,
    /\[Contributor guide\]\(DEVELOPMENT\.md\)/,
    /## Requirements/,
    /## Safety and publication boundary/,
    /## Compatibility and limitations/,
    /## Troubleshooting/,
  ]);
  assert.doesNotMatch(technical, /tests\//);
  assert.doesNotMatch(technical, /skills\/omarchy-plugin/);

  assert.match(development, /^# Development guide: Omarchy Plugin$/m);
  assert.match(development, /Contributor-only implementation, API, architecture, testing, and maintenance information\./);
  assert.match(development, /## Verification/);

  if (repositoryReadme !== null) {
    const catalogMatches = repositoryReadme.match(/\*\*\[Omarchy Plugin\]\(pi-skill-omarchy-plugin\/README\.md\)\*\*/g) ?? [];
    assert.equal(catalogMatches.length, 1, "root catalog must contain exactly one Omarchy Plugin entry");
  }
});

test("routing fixture distinguishes in-scope work from required near-neighbor exclusions", () => {
  assert.equal(routing.skill, "omarchy-plugin");
  assertUniqueStrings(routing.should_trigger, "should_trigger");
  assertUniqueStrings(routing.should_not_trigger, "should_not_trigger");
  assert(Array.isArray(routing.ambiguous) && routing.ambiguous.length >= 2);

  const positive = routing.should_trigger.join("\n");
  assertContainsAll(positive, [/design.*Omarchy Quattro.*plugin/i, /review.*Omarchy plugin repository/i, /troubleshoot.*Omarchy Quattro plugin/i, /Marketplace submission/i]);

  const negative = routing.should_not_trigger.join("\n");
  assertContainsAll(negative, [/Hyprland plugin/i, /generic Qt Quick/i, /standalone QML/i, /Install and enable the existing Omarchy/i]);

  for (const entry of routing.ambiguous) {
    assert.equal(typeof entry.prompt, "string");
    assertUniqueStrings(entry.candidate_skills, `candidate_skills for ${entry.prompt}`);
    assert.equal(typeof entry.decision, "string");
    assert.equal(typeof entry.reason, "string");
    assert.equal(entry.review_status, "reviewed");
  }
});
