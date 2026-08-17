import assert from "node:assert/strict";
import {
  UI_LAYOUT_LIMITS,
  UI_LAYOUT_VERSION,
  defaultUiLayout,
  mergeUiLayout,
  normalizeUiLayout,
  uiLayoutRevision,
  validateUiLayoutPatch,
} from "../lib/ui-layout-settings.mjs";

const defaults = defaultUiLayout();
assert.deepEqual(normalizeUiLayout(undefined), defaults);
assert.equal(UI_LAYOUT_VERSION, 3);
assert.deepEqual(defaults.controlVisibility, { hiddenIds: null });
assert.deepEqual(normalizeUiLayout({ version: 99, sidePanel: { placement: "both" } }), defaults, "unknown layout versions must fail soft to nullable defaults");

const completeV1 = {
  version: 1,
  sidePanel: {
    sectionOrder: ["files", "controls", "git"],
    collapsedSectionIds: ["git"],
    hiddenSectionIds: ["files"],
    collapsed: true,
  },
  composerActions: {
    order: ["new", "git", "send"],
    grid: { version: 2, columns: 12, positions: { new: 0, git: 1, send: 10 } },
  },
  footerScopedModelOrder: ["openai-codex/gpt-5.6-sol"],
  terminalTabs: {
    layout: "left",
    customGroups: { version: 1, groups: [{ id: "group-1", title: "Group 1", tabIds: ["tab-a", "tab-b"] }] },
    sidebarWidth: 284.6,
  },
  fileViewerWidth: 560.4,
};
const migrated = normalizeUiLayout(completeV1, { legacySidePanelWidth: 612.4 });
assert.equal(migrated.version, 3);
assert.equal(migrated.sidePanel.placement, "right", "v1 layouts must migrate to the existing right-side presentation");
assert.deepEqual(migrated.sidePanel.sectionLayout, { order: ["files", "controls", "git"], leftSectionIds: [] });
assert.deepEqual(migrated.sidePanel.collapsedSectionIds, ["git"]);
assert.deepEqual(migrated.sidePanel.hiddenSectionIds, ["files"]);
assert.deepEqual(migrated.sidePanel.collapsedPanels, { left: false, right: true });
assert.deepEqual(migrated.sidePanel.panelWidths, { left: 384, right: 612 });
assert.deepEqual(migrated.composerActions, completeV1.composerActions, "composer action order and grid must survive migration");
assert.deepEqual(migrated.footerScopedModelOrder, completeV1.footerScopedModelOrder);
assert.deepEqual(migrated.terminalTabs, { ...completeV1.terminalTabs, sidebarWidth: 285 }, "terminal placement, custom groups, and normalized sidebar width must survive migration");
assert.equal(migrated.fileViewerWidth, 560);
assert.deepEqual(migrated.controlVisibility, { hiddenIds: null }, "v1 layouts must migrate to default control visibility");

const malformedV1 = normalizeUiLayout({
  ...completeV1,
  sidePanel: {
    sectionOrder: ["files", "files"],
    collapsedSectionIds: ["git"],
    hiddenSectionIds: ["files"],
    collapsed: "yes",
  },
  composerActions: { ...completeV1.composerActions, grid: { version: 2, columns: 999, positions: {} } },
  terminalTabs: { layout: "bottom", customGroups: completeV1.terminalTabs.customGroups },
  fileViewerWidth: 200,
}, { legacySidePanelWidth: "bad" });
assert.deepEqual(malformedV1.sidePanel.sectionLayout, { order: null, leftSectionIds: null }, "a malformed v1 order must fail soft atomically");
assert.deepEqual(malformedV1.sidePanel.collapsedSectionIds, ["git"], "valid v1 sibling fields must survive malformed fields");
assert.deepEqual(malformedV1.sidePanel.hiddenSectionIds, ["files"]);
assert.deepEqual(malformedV1.sidePanel.collapsedPanels, { left: false, right: false });
assert.deepEqual(malformedV1.sidePanel.panelWidths, { left: 384, right: 384 });
assert.deepEqual(malformedV1.composerActions.order, completeV1.composerActions.order);
assert.equal(malformedV1.composerActions.grid, null);
assert.equal(malformedV1.terminalTabs.layout, null);
assert.deepEqual(malformedV1.terminalTabs.customGroups, completeV1.terminalTabs.customGroups);
assert.equal(malformedV1.fileViewerWidth, null);

const completeV2 = {
  version: 2,
  sidePanel: {
    placement: "both",
    sectionLayout: { order: ["files", "controls", "git", "future-section"], leftSectionIds: ["files", "future-section"] },
    collapsedSectionIds: ["git"],
    hiddenSectionIds: [],
    collapsedPanels: { left: true, right: false },
    panelWidths: { left: 420.4, right: 640.6 },
  },
  composerActions: completeV1.composerActions,
  footerScopedModelOrder: completeV1.footerScopedModelOrder,
  terminalTabs: completeV1.terminalTabs,
  fileViewerWidth: 560,
};
const migratedV2 = normalizeUiLayout(completeV2);
assert.equal(migratedV2.version, 3);
assert.deepEqual(migratedV2.controlVisibility, { hiddenIds: null }, "v2 layouts must gain default control visibility");
assert.deepEqual(migratedV2.sidePanel.sectionLayout, completeV2.sidePanel.sectionLayout, "v2 side-panel state must survive migration");
assert.deepEqual(migratedV2.composerActions, completeV2.composerActions, "v2 composer state must survive migration");
assert.deepEqual(migratedV2.footerScopedModelOrder, completeV2.footerScopedModelOrder);
assert.deepEqual(migratedV2.terminalTabs, { ...completeV2.terminalTabs, sidebarWidth: 285 });
assert.equal(migratedV2.fileViewerWidth, completeV2.fileViewerWidth);

const valid = normalizeUiLayout({
  ...completeV2,
  version: 3,
  controlVisibility: { hiddenIds: ["tag.future-kind", "composer.new", "control-deck.sponsor"] },
});
assert.equal(valid.sidePanel.placement, "both");
assert.deepEqual(valid.sidePanel.sectionLayout.leftSectionIds, ["files", "future-section"], "unknown historical section ids may be retained");
assert.deepEqual(valid.sidePanel.panelWidths, { left: 420, right: 641 });
assert.equal(valid.fileViewerWidth, 560);
assert.equal(valid.terminalTabs.layout, "left");
assert.equal(valid.terminalTabs.sidebarWidth, 285);
assert.deepEqual(
  valid.controlVisibility.hiddenIds,
  ["composer.new", "control-deck.sponsor", "tag.future-kind"],
  "visibility ids must normalize deterministically while retaining unknown well-formed future ids",
);

const partiallyMalformed = normalizeUiLayout({
  ...valid,
  sidePanel: {
    ...valid.sidePanel,
    placement: "center",
    sectionLayout: { order: ["files", "controls"], leftSectionIds: ["missing"] },
    collapsedPanels: { left: "yes", right: true },
    panelWidths: { left: 1, right: 700 },
  },
});
assert.equal(partiallyMalformed.sidePanel.placement, null);
assert.deepEqual(partiallyMalformed.sidePanel.sectionLayout, defaults.sidePanel.sectionLayout, "section layout must fail soft as one atomic field");
assert.deepEqual(partiallyMalformed.sidePanel.collapsedPanels, { left: null, right: true }, "malformed side values must not erase valid siblings on disk");
assert.deepEqual(partiallyMalformed.sidePanel.panelWidths, { left: null, right: 700 });
assert.deepEqual(partiallyMalformed.composerActions, valid.composerActions, "unrelated valid envelope fields must survive malformed side-panel fields");
assert.deepEqual(partiallyMalformed.controlVisibility, valid.controlVisibility, "unrelated visibility state must survive malformed side-panel fields");

const malformedVisibility = normalizeUiLayout({
  ...valid,
  controlVisibility: { hiddenIds: ["composer.new", "composer.new"] },
});
assert.deepEqual(malformedVisibility.controlVisibility, defaults.controlVisibility, "malformed persisted visibility must fail soft without affecting sibling fields");
assert.deepEqual(malformedVisibility.sidePanel, valid.sidePanel);

const merged = mergeUiLayout(valid, {
  version: 3,
  sidePanel: {
    placement: "left",
    collapsedPanels: { right: true },
    panelWidths: { left: 500.2 },
    hiddenSectionIds: null,
  },
  controlVisibility: { hiddenIds: [] },
  footerScopedModelOrder: [],
  fileViewerWidth: null,
});
assert.equal(merged.sidePanel.placement, "left");
assert.deepEqual(merged.sidePanel.sectionLayout, valid.sidePanel.sectionLayout, "omitted atomic section layout must be preserved");
assert.deepEqual(merged.sidePanel.collapsedPanels, { left: true, right: true }, "side-specific partial state must preserve its sibling");
assert.deepEqual(merged.sidePanel.panelWidths, { left: 500, right: 641 });
assert.equal(merged.sidePanel.hiddenSectionIds, null, "explicit null must clear only the named field");
assert.deepEqual(merged.controlVisibility, { hiddenIds: [] }, "an explicit empty visibility list must preserve show-all state");
assert.deepEqual(merged.footerScopedModelOrder, [], "explicit empty arrays are valid resets");
assert.equal(merged.fileViewerWidth, null);

const sidePanelReset = mergeUiLayout(valid, { sidePanel: null });
assert.deepEqual(sidePanelReset.sidePanel, defaults.sidePanel, "null sidePanel must reset all side-panel fields");
const composerReset = mergeUiLayout(valid, { composerActions: { order: [], grid: null } });
assert.deepEqual(composerReset.composerActions, { order: [], grid: null });
const terminalReset = mergeUiLayout(valid, { terminalTabs: null });
assert.deepEqual(terminalReset.terminalTabs, defaults.terminalTabs);
const visibilityReset = mergeUiLayout(valid, { controlVisibility: { hiddenIds: null } });
assert.deepEqual(visibilityReset.controlVisibility, { hiddenIds: null }, "null hiddenIds must restore defaults/no explicit preference");
const visibilityObjectReset = mergeUiLayout(valid, { controlVisibility: null });
assert.deepEqual(visibilityObjectReset.controlVisibility, defaults.controlVisibility);

assert.throws(() => validateUiLayoutPatch({}), /at least one mutable field/);
assert.throws(() => validateUiLayoutPatch({ unknown: true }), /unsupported field/);
assert.throws(() => validateUiLayoutPatch({ version: 2, fileViewerWidth: 500 }), /version must be 3/, "stale v2 writes must be rejected");
assert.throws(() => validateUiLayoutPatch({ composerActions: { order: ["send"] } }), /order and grid together/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { sectionOrder: ["files"] } }), /unsupported field: sectionOrder/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { collapsed: true } }), /unsupported field: collapsed/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { placement: "center" } }), /must be right, left, both/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { sectionLayout: { order: ["files"] } } }), /order and leftSectionIds together/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { sectionLayout: { order: ["files", "files"], leftSectionIds: [] } } }), /duplicate/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { sectionLayout: { order: ["files"], leftSectionIds: ["git"] } } }), /must occur in order/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { collapsedPanels: {} } }), /name at least one side/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { collapsedPanels: { left: "yes" } } }), /boolean or null/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { panelWidths: { left: UI_LAYOUT_LIMITS.panelWidthMin - 1 } } }), /must be between/);
assert.throws(() => validateUiLayoutPatch({ sidePanel: { panelWidths: { right: UI_LAYOUT_LIMITS.panelWidthMax + 1 } } }), /must be between/);
assert.throws(() => validateUiLayoutPatch({ fileViewerWidth: UI_LAYOUT_LIMITS.fileViewerWidthMin - 1 }), /must be between/);
assert.throws(() => validateUiLayoutPatch({ terminalTabs: { sidebarWidth: UI_LAYOUT_LIMITS.terminalTabsSidebarWidthMin - 1 } }), /must be between/);
assert.throws(() => validateUiLayoutPatch({ controlVisibility: {} }), /must include hiddenIds/);
assert.throws(() => validateUiLayoutPatch({ controlVisibility: { hiddenIds: "composer.new" } }), /must be an array/);
assert.throws(() => validateUiLayoutPatch({ controlVisibility: { hiddenIds: ["composer.new", "composer.new"] } }), /duplicate/);
assert.throws(() => validateUiLayoutPatch({ controlVisibility: { hiddenIds: [" composer.new"] } }), /trimmed string/);
assert.throws(() => validateUiLayoutPatch({ controlVisibility: { hiddenIds: Array.from({ length: UI_LAYOUT_LIMITS.listItems + 1 }, (_, index) => `future.item-${index}`) } }), /at most/);
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
assert.equal(uiLayoutRevision(defaults), uiLayoutRevision(normalizeUiLayout({ version: 3 })), "equivalent normalized layouts need stable revisions");
assert.equal(
  uiLayoutRevision(completeV1),
  uiLayoutRevision(normalizeUiLayout(completeV1)),
  "a migrated v1 envelope and its canonical v3 representation need the same revision",
);
assert.equal(
  uiLayoutRevision({ ...valid, controlVisibility: { hiddenIds: ["tag.future-kind", "control-deck.sponsor", "composer.new"] } }),
  uiLayoutRevision(valid),
  "equivalent hidden sets must have a stable revision independent of input order",
);
assert.notEqual(uiLayoutRevision(valid), uiLayoutRevision(merged), "layout and visibility changes must change the revision");
assert.notEqual(
  uiLayoutRevision(valid),
  uiLayoutRevision(mergeUiLayout(valid, { sidePanel: { sectionLayout: { order: ["controls", "files", "git", "future-section"], leftSectionIds: ["files"] } } })),
  "atomic assignment/order changes must change the revision",
);

console.log("ui-layout-settings.test.mjs passed");
