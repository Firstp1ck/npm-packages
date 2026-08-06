import assert from "node:assert/strict";
import {
  UI_LAYOUT_LIMITS,
  defaultUiLayout,
  mergeUiLayout,
  normalizeUiLayout,
  uiLayoutRevision,
  validateUiLayoutPatch,
} from "../lib/ui-layout-settings.mjs";

const defaults = defaultUiLayout();
assert.deepEqual(normalizeUiLayout(undefined), defaults);
assert.deepEqual(normalizeUiLayout({ version: 99, sidePanel: { collapsed: true } }), defaults, "unknown layout versions must fail soft to nullable defaults");

const valid = normalizeUiLayout({
  version: 1,
  sidePanel: {
    sectionOrder: ["files", "controls", "git"],
    collapsedSectionIds: ["git"],
    hiddenSectionIds: [],
    collapsed: false,
    sectionHeights: { files: 120, controls: 640, git: 4096 },
  },
  composerActions: {
    order: ["new", "git", "send"],
    grid: { version: 2, columns: 12, positions: { new: 0, git: 1, send: 10 } },
  },
  footerScopedModelOrder: ["openai-codex/gpt-5.6-sol"],
  terminalTabs: {
    layout: "left",
    customGroups: { version: 1, groups: [{ id: "group-1", title: "Group 1", tabIds: ["tab-a", "tab-b"] }] },
  },
  fileViewerWidth: 560.4,
});
assert.deepEqual(valid.sidePanel.sectionOrder, ["files", "controls", "git"]);
assert.deepEqual(valid.sidePanel.sectionHeights, { files: 120, controls: 640, git: 4096 });
assert.equal(valid.fileViewerWidth, 560);
assert.equal(valid.terminalTabs.layout, "left");

const partiallyMalformed = normalizeUiLayout({
  ...valid,
  sidePanel: {
    ...valid.sidePanel,
    sectionOrder: ["files", "files"],
    collapsed: true,
    sectionHeights: { files: 300, git: UI_LAYOUT_LIMITS.sectionHeightMin - 1 },
  },
  composerActions: { ...valid.composerActions, grid: { version: 2, columns: 999, positions: {} } },
  terminalTabs: { layout: "bottom", customGroups: valid.terminalTabs.customGroups },
});
assert.equal(partiallyMalformed.sidePanel.sectionOrder, null, "a malformed disk field should fail soft independently");
assert.equal(partiallyMalformed.sidePanel.sectionHeights, null, "a malformed height map should fail soft atomically");
assert.equal(partiallyMalformed.sidePanel.collapsed, true, "valid sibling disk fields should survive");
assert.equal(partiallyMalformed.composerActions.grid, null);
assert.equal(partiallyMalformed.terminalTabs.layout, null);
assert.deepEqual(partiallyMalformed.terminalTabs.customGroups, valid.terminalTabs.customGroups);

const merged = mergeUiLayout(valid, {
  sidePanel: { collapsed: true, hiddenSectionIds: null },
  footerScopedModelOrder: [],
  fileViewerWidth: null,
});
assert.equal(merged.sidePanel.collapsed, true);
assert.deepEqual(merged.sidePanel.sectionOrder, valid.sidePanel.sectionOrder, "omitted fields must be preserved");
assert.deepEqual(merged.sidePanel.sectionHeights, valid.sidePanel.sectionHeights, "omitted section heights must be preserved");
assert.equal(merged.sidePanel.hiddenSectionIds, null, "explicit null must clear only the named field");
assert.deepEqual(merged.footerScopedModelOrder, [], "explicit empty arrays are valid resets");
assert.equal(merged.fileViewerWidth, null);

const sectionHeightUpdate = mergeUiLayout(valid, { sidePanel: { sectionHeights: { files: 360, controls: 720 } } });
assert.deepEqual(sectionHeightUpdate.sidePanel.sectionHeights, { files: 360, controls: 720 });
assert.equal(sectionHeightUpdate.sidePanel.collapsed, false, "updating heights must preserve side-panel siblings");
const sectionHeightReset = mergeUiLayout(valid, { sidePanel: { sectionHeights: null } });
assert.equal(sectionHeightReset.sidePanel.sectionHeights, null, "explicit null must reset only section heights");
assert.deepEqual(sectionHeightReset.sidePanel.sectionOrder, valid.sidePanel.sectionOrder);
const sidePanelReset = mergeUiLayout(valid, { sidePanel: null });
assert.deepEqual(sidePanelReset.sidePanel, defaults.sidePanel, "null sidePanel must reset all side-panel fields");

const composerReset = mergeUiLayout(valid, { composerActions: { order: [], grid: null } });
assert.deepEqual(composerReset.composerActions, { order: [], grid: null });
const terminalReset = mergeUiLayout(valid, { terminalTabs: null });
assert.deepEqual(terminalReset.terminalTabs, defaults.terminalTabs);

assert.throws(() => validateUiLayoutPatch({}), /at least one mutable field/);
assert.throws(() => validateUiLayoutPatch({ unknown: true }), /unsupported field/);
assert.throws(() => validateUiLayoutPatch({ version: 2, fileViewerWidth: 500 }), /version must be 1/);
assert.throws(() => validateUiLayoutPatch({ composerActions: { order: ["send"] } }), /order and grid together/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { collapsed: "yes" } }), /boolean or null/);
for (const unsafeId of ["__proto__", "constructor", "prototype"]) {
  const sectionHeights = JSON.parse(`{"${unsafeId}":240}`);
  assert.throws(
    () => validateUiLayoutPatch({ sidePanel: { sectionHeights } }),
    /unsupported section id/,
    `${unsafeId} must not be accepted as a section id`,
  );
}
const excessiveSectionHeights = Object.fromEntries(
  Array.from({ length: UI_LAYOUT_LIMITS.listItems + 1 }, (_, index) => [`section-${index}`, 240]),
);
assert.throws(
  () => validateUiLayoutPatch({ sidePanel: { sectionHeights: excessiveSectionHeights } }),
  /at most 128 items/,
);
for (const invalidHeight of [
  UI_LAYOUT_LIMITS.sectionHeightMin - 1,
  UI_LAYOUT_LIMITS.sectionHeightMax + 1,
  240.5,
  "240",
  null,
  Number.NaN,
  Number.POSITIVE_INFINITY,
]) {
  assert.throws(
    () => validateUiLayoutPatch({ sidePanel: { sectionHeights: { files: invalidHeight } } }),
    /values must be integers between 120 and 4096/,
    `${String(invalidHeight)} must not be accepted as a section height`,
  );
}
assert.throws(() => validateUiLayoutPatch({ sidePanel: { sectionHeights: [] } }), /must be an object or null/);
assert.deepEqual(
  validateUiLayoutPatch({ sidePanel: { sectionHeights: {} } }),
  { sidePanel: { sectionHeights: {} } },
  "an empty map is a valid explicit reset",
);
assert.throws(() => validateUiLayoutPatch({ fileViewerWidth: UI_LAYOUT_LIMITS.fileViewerWidthMin - 1 }), /must be between/);
assert.throws(() => validateUiLayoutPatch({ footerScopedModelOrder: Array(UI_LAYOUT_LIMITS.listItems + 1).fill("model") }), /at most/);
assert.throws(() => validateUiLayoutPatch({
  composerActions: { order: ["a", "b"], grid: { version: 2, columns: 2, positions: { a: 0, b: 0 } } },
}), /must not reuse a slot/);
assert.throws(() => validateUiLayoutPatch({
  terminalTabs: {
    customGroups: {
      version: 1,
      groups: [
        { id: "one", title: "One", tabIds: ["tab-a"] },
        { id: "two", title: "Two", tabIds: ["tab-a"] },
      ],
    },
  },
}), /only one group/);

assert.match(uiLayoutRevision(defaults), /^[a-f0-9]{64}$/);
assert.equal(uiLayoutRevision(defaults), uiLayoutRevision(normalizeUiLayout({ version: 1 })), "equivalent normalized layouts need stable revisions");
assert.notEqual(uiLayoutRevision(defaults), uiLayoutRevision(merged), "layout changes must change the revision");

console.log("ui-layout-settings.test.mjs passed");
