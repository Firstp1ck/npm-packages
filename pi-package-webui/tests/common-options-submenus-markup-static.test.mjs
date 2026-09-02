import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, css] = await Promise.all([
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
]);

const actionContract = {
  optionsCommandPaletteButton: { label: "Command Palette" },
  optionsSettingsButton: { label: "Settings", command: "/settings" },
  optionsConversationModeButton: { label: "Start Natural Conversation", command: "/talk", hidden: true },
  optionsResumeButton: { label: "Resume Session", command: "/resume" },
  optionsNameButton: { label: "Name Session", command: "/name" },
  optionsCloneButton: { label: "Clone Session", command: "/clone" },
  optionsForkButton: { label: "Fork", command: "/fork" },
  optionsTreeButton: { label: "Tree", command: "/tree" },
  optionsExportButton: { label: "Export", command: "/export" },
  optionsAppendSystemButton: { label: "Append-system Prompt" },
  optionsSummarySetupButton: { label: "Session Summary Setup", command: "/summary-setup", hidden: true },
  optionsGitWorkflowSetupButton: { label: "Guided Git Setup", command: "/git-workflow-setup" },
  optionsWorkflowSetupButton: { label: "Workflow Permission Setup", command: "/workflow-setup", hidden: true },
  optionsSafetyGuardSetupButton: { label: "Safety Guard Setup", command: "/safety-guard-setup", hidden: true },
  optionsStatsButton: { label: "Stats Dashboard", command: "/stats-webui", hidden: true },
  optionsFooterVisibilityButton: { label: "Git-footer Visibility", hidden: true },
  optionsRemoteButton: { label: "Open Remote", command: "/remote", hidden: true },
  optionsReloadButton: { label: "Reload Pi", command: "/reload" },
};

const groups = [
  {
    key: "session",
    label: "Session",
    triggerId: "optionsSessionSubmenuButton",
    panelId: "optionsSessionSubmenu",
    actions: ["optionsResumeButton", "optionsNameButton", "optionsCloneButton", "optionsForkButton", "optionsTreeButton", "optionsExportButton"],
  },
  {
    key: "feature-setup",
    label: "Feature Setup",
    triggerId: "optionsFeatureSetupSubmenuButton",
    panelId: "optionsFeatureSetupSubmenu",
    actions: ["optionsAppendSystemButton", "optionsSummarySetupButton", "optionsGitWorkflowSetupButton"],
  },
  {
    key: "safety-permissions",
    label: "Safety &amp; Permissions",
    triggerId: "optionsSafetyPermissionsSubmenuButton",
    panelId: "optionsSafetyPermissionsSubmenu",
    actions: ["optionsWorkflowSetupButton", "optionsSafetyGuardSetupButton"],
  },
  {
    key: "view-diagnostics",
    label: "View &amp; Diagnostics",
    triggerId: "optionsViewDiagnosticsSubmenuButton",
    panelId: "optionsViewDiagnosticsSubmenu",
    actions: ["optionsStatsButton", "optionsFooterVisibilityButton"],
  },
  {
    key: "remote-system",
    label: "Remote &amp; System",
    triggerId: "optionsRemoteSystemSubmenuButton",
    panelId: "optionsRemoteSystemSubmenu",
    actions: ["optionsRemoteButton", "optionsReloadButton"],
  },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buttonMarkup(id) {
  const match = html.match(new RegExp(`<button\\b[^>]*\\bid="${escapeRegExp(id)}"[^>]*>[\\s\\S]*?<\\/button>`));
  assert.ok(match, `${id} should exist as a button`);
  return match[0];
}

const menuStart = html.indexOf('<div id="optionsMenu"');
const menuEnd = html.indexOf('<div id="appRunnerMenu"', menuStart);
assert.ok(menuStart >= 0 && menuEnd > menuStart, "the Common Pi options block should remain bounded by its stable IDs");
const menuMarkup = html.slice(menuStart, menuEnd);
assert.match(menuMarkup, /^<div id="optionsMenu"[^>]*role="menu"[^>]*aria-label="Common Pi options">/, "the root should remain a labelled menu");
assert.doesNotMatch(menuMarkup, /id="options(?:Tools|Skills)SetupButton"/, "Tools Setup and Skills Setup should not appear in Common Pi options");

const allActionIds = Object.keys(actionContract);
for (const [id, contract] of Object.entries(actionContract)) {
  assert.equal((html.match(new RegExp(`\\bid="${escapeRegExp(id)}"`, "g")) || []).length, 1, `${id} should occur exactly once`);
  const button = buttonMarkup(id);
  assert.match(button, /\brole="menuitem"/, `${id} should retain menuitem semantics`);
  assert.match(button, new RegExp(`<span>${escapeRegExp(contract.label)}<\\/span>`), `${id} should retain its label`);
  if (contract.command) assert.match(button, new RegExp(`\\bdata-command="${escapeRegExp(contract.command)}"`), `${id} should retain ${contract.command}`);
  else assert.doesNotMatch(button, /\bdata-command=/, `${id} should not gain a command contract`);
  if (contract.hidden) assert.match(button, /\shidden(?:\s|>)/, `${id} should retain its conditional hidden default`);
}

const firstGroupStart = menuMarkup.indexOf('<div class="composer-options-submenu"');
const rootQuickActionMarkup = menuMarkup.slice(0, firstGroupStart);
const rootQuickActions = allActionIds.filter((id) => rootQuickActionMarkup.includes(`id="${id}"`));
assert.deepEqual(rootQuickActions, ["optionsCommandPaletteButton", "optionsSettingsButton", "optionsConversationModeButton"], "only the three approved quick actions should remain at the root");

for (let index = 0; index < groups.length; index += 1) {
  const group = groups[index];
  const wrapperMarker = `<div class="composer-options-submenu" role="none" data-options-submenu="${group.key}">`;
  const groupStart = menuMarkup.indexOf(wrapperMarker);
  const nextStart = index + 1 < groups.length
    ? menuMarkup.indexOf(`<div class="composer-options-submenu" role="none" data-options-submenu="${groups[index + 1].key}">`, groupStart)
    : menuMarkup.length;
  assert.ok(groupStart >= 0 && nextStart > groupStart, `${group.label} should have one semantic group wrapper`);
  const groupMarkup = menuMarkup.slice(groupStart, nextStart);
  const trigger = buttonMarkup(group.triggerId);

  assert.equal((html.match(new RegExp(`\\bid="${group.triggerId}"`, "g")) || []).length, 1, `${group.triggerId} should be stable and unique`);
  assert.equal((html.match(new RegExp(`\\bid="${group.panelId}"`, "g")) || []).length, 1, `${group.panelId} should be stable and unique`);
  assert.match(trigger, /\bclass="[^"]*composer-options-submenu-trigger[^"]*"/, `${group.label} should expose the trigger behavior hook`);
  assert.match(trigger, /\brole="menuitem"/, `${group.label} trigger should be a menuitem`);
  assert.match(trigger, /\baria-haspopup="menu"/, `${group.label} trigger should announce its submenu`);
  assert.match(trigger, /\baria-expanded="false"/, `${group.label} trigger should start collapsed`);
  assert.match(trigger, new RegExp(`\\baria-controls="${group.panelId}"`), `${group.label} trigger should control its panel`);
  assert.match(trigger, /\bdata-options-submenu-trigger(?:\s|>)/, `${group.label} trigger should expose the JS hook`);
  assert.match(trigger, new RegExp(`<span>${escapeRegExp(group.label)}<\\/span>`), `${group.label} trigger should retain the approved group label`);
  assert.match(groupMarkup, new RegExp(`<div id="${group.panelId}" class="composer-options-submenu-panel" role="menu" aria-labelledby="${group.triggerId}" data-options-submenu-panel>`), `${group.label} panel should be labelled by its trigger`);
  assert.match(groupMarkup, /class="[^"]*composer-options-submenu-back[^"]*"[^>]*role="menuitem"[^>]*data-options-submenu-back[\s\S]*?<span>Back<\/span>/, `${group.label} should contain an explicit Back menuitem`);

  const actualActions = allActionIds
    .filter((id) => groupMarkup.includes(`id="${id}"`))
    .sort((left, right) => groupMarkup.indexOf(`id="${left}"`) - groupMarkup.indexOf(`id="${right}"`));
  assert.deepEqual(actualActions, group.actions, `${group.label} should contain exactly its approved actions in order`);
}

assert.equal((menuMarkup.match(/\bdata-options-submenu="/g) || []).length, 5, "there should be exactly five submenu groups");
assert.equal((menuMarkup.match(/\bdata-options-submenu-back(?:\s|>)/g) || []).length, 5, "every group should have exactly one Back action");
assert.equal((menuMarkup.match(/\bdata-options-submenu-panel(?:\s|>)/g) || []).length, 5, "every group should have exactly one panel behavior hook");

assert.match(css, /\.composer-options-menu-panel\s*\{[\s\S]*?--composer-options-selection-width: min\(13\.5rem, calc\(100vw - 2rem\)\);[\s\S]*?width: var\(--composer-options-selection-width\);[\s\S]*?min-width: var\(--composer-options-selection-width\);[\s\S]*?max-width: var\(--composer-options-selection-width\);/, "the root dropdown should use one explicit shared selection width");
assert.match(css, /\.composer-options-submenu-panel\s*\{[\s\S]*?position: absolute;[\s\S]*?width: 100%;[\s\S]*?min-width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?max-height: min\(60vh, 24rem\);[\s\S]*?overflow-y: auto;/, "desktop flyouts should match the root width and remain independently scroll-bounded");
assert.match(css, /\.composer-options-menu-item\s*\{[\s\S]*?box-sizing: border-box;[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?padding-inline: 0\.78rem;/, "every root and nested selection should fill the shared width with consistent side padding");
assert.match(css, /\.composer-options-menu-item > span:not\(\[aria-hidden="true"\]\):not\(\.composer-options-submenu-chevron\)\s*\{[\s\S]*?min-width: 0;[\s\S]*?font-size: var\(--options-menu-label-font-size, inherit\);[\s\S]*?white-space: nowrap;/, "menu labels should expose a bounded font-size fitting hook without changing side padding");
assert.match(css, /\.composer-options-submenu\.opens-left > \.composer-options-submenu-panel,[\s\S]*?\.composer-options-submenu-panel\.opens-left\s*\{[\s\S]*?inset-inline: auto calc\(100% \+ 0\.3rem\);/, "desktop flyouts should expose an opens-left viewport hook");
assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\.composer-options-submenu:hover > \.composer-options-submenu-panel,[\s\S]*?\.composer-options-submenu:focus-within > \.composer-options-submenu-panel/, "fine pointers should receive hover/focus flyouts");

const drillInRuleIndex = css.indexOf(".composer-options-menu-panel.submenu-open");
const drillInMediaIndex = css.lastIndexOf("@media", drillInRuleIndex);
assert.ok(drillInRuleIndex > 0 && drillInMediaIndex > 0, "mobile drill-in rules should exist inside a media query");
const drillInCss = css.slice(drillInMediaIndex, css.indexOf("  .command-suggest {", drillInRuleIndex));
assert.match(drillInCss, /^@media \(max-width: 720px\), \(max-device-width: 720px\), \(pointer: coarse\) and \(hover: none\)/, "narrow and coarse-pointer layouts should share the drill-in contract");
assert.match(drillInCss, /\.composer-options-submenu-panel,[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?max-height: 100%;[\s\S]*?overflow-y: auto;/, "mobile child pages should fill the bounded root panel and scroll internally");
assert.match(drillInCss, /\.composer-options-submenu-trigger,[\s\S]*?\.composer-options-submenu-panel > \.composer-options-menu-item\s*\{\s*min-height: 44px;/, "mobile triggers, Back actions, and child actions should meet the 44px target minimum");
assert.match(drillInCss, /\.composer-options-submenu-back\s*\{[\s\S]*?display: inline-flex;/, "mobile child pages should visibly expose their Back action");
assert.match(drillInCss, /\.composer-options-submenu:hover > \.composer-options-submenu-panel,[\s\S]*?display: none;[\s\S]*?aria-expanded="true"\] \+ \.composer-options-submenu-panel[\s\S]*?display: flex;/, "mobile drill-in should depend on explicit state rather than hover");

console.log("Common Pi options submenu markup and responsive CSS contract verified.");
