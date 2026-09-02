import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

function functionBody(name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`, "m");
  const match = signature.exec(app);
  assert.ok(match, `${name} should remain a standalone Common Pi options helper`);
  let parenDepth = 0;
  let openBrace = -1;
  for (let index = match.index + match[0].length - 1; index < app.length; index += 1) {
    const char = app[index];
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === "{" && parenDepth === 0) {
      openBrace = index;
      break;
    }
  }
  assert.notEqual(openBrace, -1, `${name} body should open`);
  let depth = 0;
  for (let index = openBrace; index < app.length; index += 1) {
    const char = app[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return app.slice(openBrace + 1, index);
    }
  }
  assert.fail(`${name} body should close`);
}

function occurrences(pattern) {
  return app.match(new RegExp(pattern, "g"))?.length ?? 0;
}

// --- Seam contract: submenu structure is discovered through stable data attributes ---
assert.match(app, /const OPTIONS_SUBMENU_GROUP_SELECTOR = "\[data-options-submenu\]";/, "submenu groups should use the structure worker's stable data attribute seam");
assert.match(app, /const OPTIONS_SUBMENU_TRIGGER_SELECTOR = "\[data-options-submenu-trigger\]";/, "group triggers should use the shared trigger seam");
assert.match(app, /const OPTIONS_SUBMENU_PANEL_SELECTOR = "\[data-options-submenu-panel\]";/, "group panels should use the shared panel seam");
assert.match(app, /const OPTIONS_SUBMENU_BACK_SELECTOR = "\[data-options-submenu-back\]";/, "mobile Back affordances should use the shared back seam");
assert.match(app, /const OPTIONS_SUBMENU_LEFT_CLASS = "opens-left";/, "viewport placement should use the structure worker's opens-left CSS hook");
assert.match(app, /let openOptionsSubmenuGroup = null;/, "exactly one submenu group may be tracked as open");

const submenuPanel = functionBody("optionsSubmenuPanel");
assert.match(submenuPanel, /aria-controls[\s\S]*document\.getElementById\(controlledId\)[\s\S]*OPTIONS_SUBMENU_PANEL_SELECTOR[\s\S]*'\[role="menu"\]'/, "panels should resolve via aria-controls with structural fallbacks");

// --- One open submenu and root-close cleanup ---
const setSubmenuOpen = functionBody("setOptionsSubmenuOpen");
assert.match(setSubmenuOpen, /if \(shouldOpen\) \{\s*for \(const sibling of optionsSubmenuGroups\(\)\) \{\s*if \(sibling !== group\) setOptionsSubmenuOpen\(sibling, false\);/, "opening one group should close every sibling group");
assert.match(setSubmenuOpen, /const shouldOpen = !!open && !trigger\?\.disabled && !trigger\?\.hidden && !group\.hidden;/, "hidden or disabled group triggers must not open");
assert.match(setSubmenuOpen, /trigger\?\.setAttribute\("aria-expanded", shouldOpen \? "true" : "false"\)/, "aria-expanded should stay synchronized with submenu state");
assert.match(setSubmenuOpen, /if \(panel\) panel\.hidden = !shouldOpen;/, "closed submenu panels should be hidden and unfocusable");
assert.match(setSubmenuOpen, /if \(shouldOpen && focusFirstItem\) focusOptionsMenuItem\(optionsSubmenuItems\(group\)\[0\]\);/, "opening with keyboard/tap intent should focus the first submenu item");
assert.match(setSubmenuOpen, /if \(!shouldOpen && restoreFocus\) focusOptionsMenuItem\(trigger\);/, "closing a submenu should restore focus to its trigger");
assert.match(setSubmenuOpen, /scheduleMobileDropdownScrollBoundsUpdate\(\);/, "submenu state changes should refresh bounded mobile dropdown heights");

const setMenuOpen = functionBody("setOptionsMenuOpen");
assert.match(setMenuOpen, /if \(optionsMenuOpen\) syncOptionsSubmenuAvailability\(\);\s*else closeOptionsSubmenus\(\);/, "opening the root should resync availability and closing it should reset nested state");

const closeSubmenus = functionBody("closeOptionsSubmenus");
assert.match(closeSubmenus, /for \(const group of optionsSubmenuGroups\(\)\) setOptionsSubmenuOpen\(group, false\);\s*openOptionsSubmenuGroup = null;/, "closing the root menu should close every nested group");
assert.match(closeSubmenus, /if \(restoreFocus && previous\) focusOptionsMenuItem\(optionsSubmenuTrigger\(previous\)\);/, "an explicit close may restore focus to the previously open trigger");

// --- Dynamic empty-group hiding ---
const syncAvailability = functionBody("syncOptionsSubmenuAvailability");
assert.match(syncAvailability, /if \(optionsSubmenuSyncing\) return;/, "availability synchronization should be re-entrancy safe");
assert.match(syncAvailability, /const unavailable = !available;[\s\S]*if \(group\.hidden !== unavailable\) group\.hidden = unavailable;[\s\S]*if \(trigger\.hidden !== unavailable\) trigger\.hidden = unavailable;[\s\S]*if \(trigger\.disabled !== unavailable\) trigger\.disabled = unavailable;/, "groups without visible children should be hidden and unfocusable without retriggering the attribute observer on unchanged state");
assert.match(syncAvailability, /if \(!available && openOptionsSubmenuGroup === group\) setOptionsSubmenuOpen\(group, false\);/, "an open group that loses every child should close");

const hasVisibleActions = functionBody("optionsSubmenuHasVisibleActions");
assert.match(hasVisibleActions, /!item\.hidden && !item\.disabled && item\.getAttribute\("aria-hidden"\) !== "true"/, "child visibility should follow hidden/disabled/aria-hidden state");
const actionItems = functionBody("optionsSubmenuActionItems");
assert.match(actionItems, /const back = optionsSubmenuBackButton\(group\);[\s\S]*filter\(\(item\) => item !== back\)/, "the Back affordance must not count as a visible group action");
const submenuItems = functionBody("optionsSubmenuItems");
assert.match(submenuItems, /const back = optionsSubmenuBackButton\(group\);[\s\S]*filter\(\(item\) => item !== back/, "arrow entry should focus the first action rather than the mobile-only Back item");

// --- Desktop pointer behavior and viewport direction ---
const initialize = functionBody("initializeOptionsSubmenus");
assert.match(initialize, /group\.addEventListener\("pointerenter", \(event\) => \{\s*if \(event\.pointerType === "touch" \|\| optionsSubmenuUsesDrillIn\(\)\) return;\s*setOptionsSubmenuOpen\(group, true\);/, "hover flyouts should be desktop-only and never required on touch");
assert.match(initialize, /group\.addEventListener\("pointerleave", \(event\) => \{[\s\S]*if \(group\.contains\(document\.activeElement\)\) return;\s*setOptionsSubmenuOpen\(group, false\);/, "pointer leave should not close a group that still holds focus");
assert.match(initialize, /elements\.optionsMenu\.addEventListener\("click", handleOptionsSubmenuClick\);/, "submenu open state should be click-driven");
assert.match(initialize, /elements\.optionsMenu\.addEventListener\("keydown", handleOptionsMenuKeydown\);/, "keyboard navigation should be bound to the root menu panel");
assert.match(initialize, /new MutationObserver\(\(\) => syncOptionsSubmenuAvailability\(\)\)[\s\S]*attributeFilter: \["hidden", "disabled", "aria-hidden"\]/, "conditional child visibility changes should resynchronize group availability");
assert.match(initialize, /window\.addEventListener\("resize", \(\) => \{\s*if \(openOptionsSubmenuGroup\) updateOptionsSubmenuPlacement\(openOptionsSubmenuGroup\);/, "viewport changes should re-evaluate submenu placement");
assert.match(initialize, /if \(!elements\.optionsMenu \|\| !groups\.length\) return;/, "the interaction layer should no-op when no submenu groups exist");

const placement = functionBody("updateOptionsSubmenuPlacement");
assert.match(placement, /if \(optionsSubmenuUsesDrillIn\(\)\) \{[\s\S]*classList\.remove\(OPTIONS_SUBMENU_LEFT_CLASS\)/, "drill-in layouts should not carry desktop flyout direction");
assert.match(placement, /const flipLeft = panelWidth > 0 && spaceRight < panelWidth && anchorRect\.left > spaceRight;/, "flyouts should flip left only when the right edge cannot fit the panel");
assert.match(placement, /group\.classList\.toggle\(OPTIONS_SUBMENU_LEFT_CLASS, flipLeft\);\s*panel\.classList\.toggle\(OPTIONS_SUBMENU_LEFT_CLASS, flipLeft\);/, "direction state should be exposed on the group and the panel");

const drillIn = functionBody("optionsSubmenuUsesDrillIn");
assert.match(drillIn, /if \(isMobileView\(\)\) return true;[\s\S]*OPTIONS_SUBMENU_DRILL_IN_QUERY/, "narrow and coarse-pointer viewports should use tap-driven drill-in");
assert.match(app, /const OPTIONS_SUBMENU_DRILL_IN_QUERY = "\(hover: none\), \(pointer: coarse\)";/, "drill-in detection should cover hover-less and coarse pointers");

// --- Equal-width selections and overflow-only font fitting ---
assert.match(app, /const OPTIONS_MENU_LABEL_MIN_FONT_SIZE_PX = 12;/, "automatic label fitting should retain a readable minimum font size");
const fitLabels = functionBody("fitOptionsMenuLabels");
assert.match(fitLabels, /style\.removeProperty\(OPTIONS_MENU_LABEL_FONT_SIZE_PROPERTY\)[\s\S]*const availableWidth = label\.clientWidth;[\s\S]*const requiredWidth = label\.scrollWidth;/, "each fit pass should restore the natural size before measuring real overflow");
assert.match(fitLabels, /if \(availableWidth <= 0 \|\| requiredWidth <= availableWidth \+ 0\.5\) continue;/, "labels that already fit should keep their natural font size");
assert.match(fitLabels, /Math\.max\([\s\S]*OPTIONS_MENU_LABEL_MIN_FONT_SIZE_PX,[\s\S]*baseFontSize \* \(availableWidth \/ requiredWidth\) \* 98/, "overflowing labels should shrink proportionally without crossing the readable minimum");
assert.match(fitLabels, /style\.setProperty\(OPTIONS_MENU_LABEL_FONT_SIZE_PROPERTY, `\$\{fittedFontSize\}px`\)/, "fitted labels should use the CSS font-size hook without changing button padding");
const scheduleLabelFit = functionBody("scheduleOptionsMenuLabelFit");
assert.match(scheduleLabelFit, /window\.cancelAnimationFrame\(optionsMenuLabelFitFrame\)[\s\S]*window\.requestAnimationFrame\([\s\S]*fitOptionsMenuLabels\(\)/, "label measurement should be coalesced until after layout");
assert.match(setMenuOpen, /if \(optionsMenuOpen\) scheduleOptionsMenuLabelFit\(\);/, "opening the root should fit visible labels");
assert.match(setSubmenuOpen, /if \(shouldOpen\) scheduleOptionsMenuLabelFit\(\);/, "opening a child panel should fit newly visible labels");
assert.match(initialize, /rootMenuContainer\?\.addEventListener\("pointerenter", scheduleOptionsMenuLabelFit\);[\s\S]*rootMenuContainer\?\.addEventListener\("focusin", scheduleOptionsMenuLabelFit\);/, "CSS hover/focus-opened root menus should also fit their visible labels");
assert.match(initialize, /window\.addEventListener\("resize", \(\) => \{[\s\S]*scheduleOptionsMenuLabelFit\(\);/, "viewport changes should refit visible labels");

// --- Tap-driven drill-in and Back behavior ---
const click = functionBody("handleOptionsSubmenuClick");
assert.match(click, /const back = event\.target\?\.closest\?\.\(OPTIONS_SUBMENU_BACK_SELECTOR\);[\s\S]*setOptionsSubmenuOpen\(back\.closest\(OPTIONS_SUBMENU_GROUP_SELECTOR\), false, \{ restoreFocus: true \}\);/, "Back should return to the root page and restore trigger focus");
assert.match(click, /const shouldOpen = openOptionsSubmenuGroup !== group;\s*setOptionsSubmenuOpen\(group, shouldOpen, \{ focusFirstItem: shouldOpen \}\);/, "tapping a group trigger should toggle its page and focus its first item");
assert.match(click, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/, "trigger and Back activation must not fall through to action handling");

// --- Keyboard navigation, nested Escape, focus restoration ---
const keydown = functionBody("handleOptionsMenuKeydown");
assert.match(keydown, /const items = panelGroup \? optionsSubmenuItems\(panelGroup\) : optionsMenuRootItems\(\);/, "arrow navigation should stay inside the focused level");
assert.match(keydown, /if \(event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"\) \{\s*event\.preventDefault\(\);\s*moveOptionsMenuFocus\(items, index, event\.key === "ArrowDown" \? 1 : -1\);/, "Down/Up should move focus within the current level");
assert.match(keydown, /if \(event\.key === "Home" \|\| event\.key === "End"\) \{\s*event\.preventDefault\(\);\s*focusOptionsMenuItem\(event\.key === "Home" \? items\[0\] : items\[items\.length - 1\]\);/, "Home/End should jump to the first/last item of the current level");
assert.match(keydown, /if \(event\.key === "ArrowRight"\) \{[\s\S]*optionsSubmenuTrigger\(group\) === target[\s\S]*setOptionsSubmenuOpen\(group, true, \{ focusFirstItem: true \}\);/, "Right should enter a group and focus its first item");
assert.match(keydown, /if \(event\.key === "ArrowLeft"\) \{\s*if \(!panelGroup\) return;\s*event\.preventDefault\(\);\s*setOptionsSubmenuOpen\(panelGroup, false, \{ restoreFocus: true \}\);/, "Left should leave a group and restore focus to its trigger");
assert.match(keydown, /if \(panelGroup \|\| openOptionsSubmenuGroup\) \{[\s\S]*event\.preventDefault\(\);\s*event\.stopPropagation\(\);[\s\S]*if \(panelGroup\) setOptionsSubmenuOpen\(panelGroup, false, \{ restoreFocus: true \}\);\s*else closeOptionsSubmenus\(\{ restoreFocus: true \}\);/, "Escape should close only the deepest open level and keep the root menu open");
assert.match(keydown, /closeOptionsSubmenus\(\);\s*focusOptionsMenuItem\(elements\.optionsMenuButton\);/, "Escape at root level should defer to the root close handler and restore focus to the menu button");

const moveFocus = functionBody("moveOptionsMenuFocus");
assert.match(moveFocus, /\(currentIndex \+ offset \+ items\.length\) % items\.length/, "arrow navigation should wrap within the level");

const rootItems = functionBody("optionsMenuRootItems");
assert.match(rootItems, /filter\(\(item\) => !isOptionsSubmenuPanelItem\(item\) && isVisibleOptionsMenuItem\(item\)\)/, "root navigation should skip submenu children and invisible items");
const visibleItem = functionBody("isVisibleOptionsMenuItem");
assert.match(visibleItem, /if \(!item \|\| item\.hidden \|\| item\.disabled\) return false;[\s\S]*aria-hidden[\s\S]*!item\.closest\?\.\("\[hidden\]"\)/, "items inside hidden groups should never receive focus");

assert.match(app, /elements\.optionsMenuButton\.addEventListener\("keydown", \(event\) => \{\s*if \(event\.key !== "ArrowDown" && event\.key !== "ArrowUp"\) return;[\s\S]*setOptionsMenuOpen\(true\);[\s\S]*focusOptionsMenuItem\(event\.key === "ArrowDown" \? items\[0\] : items\[items\.length - 1\]\);/, "Down/Up on the root trigger should open the menu and enter it");
assert.match(app, /initializeOptionsSubmenus\(\);/, "the submenu interaction layer should be initialized with the other composer menu listeners");

// --- Preservation: existing action handlers keep their identity and stay unduplicated ---
for (const [id, handler] of [
  ["optionsCommandPaletteButton", "openCommandPalette\\(\\)"],
  ["optionsConversationModeButton", "toggleNaturalConversationMode\\(\\)"],
  ["optionsResumeButton", 'runNativeCommandMenu\\("/resume"\\)'],
  ["optionsReloadButton", 'runNativeCommandMenu\\("/reload"\\)'],
  ["optionsRemoteButton", 'runNativeCommandMenu\\("/remote"\\)'],
  ["optionsNameButton", 'runNativeCommandMenu\\("/name"\\)'],
  ["optionsCloneButton", 'runNativeCommandMenu\\("/clone"\\)'],
  ["optionsSettingsButton", 'runNativeCommandMenu\\("/settings"\\)'],
  ["optionsSummarySetupButton", 'runNativeCommandMenu\\("/summary-setup"\\)'],
  ["optionsWorkflowSetupButton", 'runNativeCommandMenu\\("/workflow-setup"\\)'],
  ["optionsSafetyGuardSetupButton", 'runNativeCommandMenu\\("/safety-guard-setup"\\)'],
  ["optionsGitWorkflowSetupButton", 'runNativeCommandMenu\\("/git-workflow-setup"\\)'],
  ["optionsToolsSetupButton", 'runNativeCommandMenu\\("/tools"\\)'],
  ["optionsSkillsSetupButton", 'runNativeCommandMenu\\("/skills"\\)'],
  ["optionsExportButton", 'runNativeCommandMenu\\("/export"\\)'],
  ["optionsForkButton", 'runNativeCommandMenu\\("/fork"\\)'],
  ["optionsTreeButton", 'runNativeCommandMenu\\("/tree"\\)'],
  ["optionsStatsButton", "openStatsOverlay\\(\\{ refresh: true \\}\\)"],
  ["optionsFooterVisibilityButton", "openGitFooterVisibilityDialog"],
]) {
  assert.match(app, new RegExp(`elements\\.${id}\\??\\.addEventListener\\("click", [^\\n]*${handler}`), `${id} should keep its existing action handler`);
  assert.equal(occurrences(`elements\\.${id}\\??\\.addEventListener\\("click"`), 1, `${id} should be bound exactly once`);
  assert.equal(occurrences(`  ${id}: \\$\\("#${id}"\\),`), 1, `${id} should keep exactly one element reference`);
}

assert.match(app, /elements\.optionsAppendSystemButton\?\.addEventListener\("click", \(\) => \{\s*setOptionsMenuOpen\(false\);\s*void openNativeAppendSystemSelector\(\);\s*\}\);/, "Append-system Prompt should close Common Pi options and open the existing browser picker directly");
assert.equal(app.match(/elements\.optionsAppendSystemButton\?\.addEventListener\("click"/g)?.length ?? 0, 1, "Append-system Prompt should be bound exactly once");
assert.equal(app.match(/  optionsAppendSystemButton: \$\("#optionsAppendSystemButton"\),/g)?.length ?? 0, 1, "Append-system Prompt should have exactly one element reference");

assert.equal(occurrences('elements\\.optionsMenu\\.addEventListener\\("click"'), 1, "the submenu delegate should be bound exactly once");
assert.equal(occurrences('elements\\.optionsMenu\\.addEventListener\\("keydown"'), 1, "the submenu key handler should be bound exactly once");
assert.equal(occurrences("function initializeOptionsSubmenus\\(\\)"), 1, "the initializer should be defined exactly once");
assert.equal(occurrences("\\ninitializeOptionsSubmenus\\(\\);\\n"), 1, "the initializer should be invoked exactly once");

console.log("common options submenus interaction static checks passed");
