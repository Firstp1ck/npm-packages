import { createHash } from "node:crypto";

export const UI_LAYOUT_VERSION = 3;
export const UI_LAYOUT_REQUEST_MAX_BYTES = 32 * 1024;
export const UI_LAYOUT_LIMITS = Object.freeze({
  idLength: 256,
  titleLength: 160,
  listItems: 128,
  groups: 32,
  gridColumns: 24,
  gridSlots: 4096,
  panelWidthMin: 320,
  panelWidthMax: 4096,
  panelWidthDefault: 384,
  fileViewerWidthMin: 384,
  fileViewerWidthMax: 4096,
  terminalTabsSidebarWidthMin: 208,
  terminalTabsSidebarWidthMax: 4096,
});

const PREVIOUS_UI_LAYOUT_VERSION = 2;
const LEGACY_UI_LAYOUT_VERSION = 1;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TERMINAL_TAB_LAYOUTS = new Set(["top", "left"]);
const CONTROL_DECK_PLACEMENTS = new Set(["right", "left", "both"]);
const SIDES = ["left", "right"];

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalid(message) {
  const error = new TypeError(message);
  error.code = "UI_LAYOUT_INVALID";
  throw error;
}

function assertOnlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) invalid(`${label} contains unsupported field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
}

function boundedString(value, label, maxLength = UI_LAYOUT_LIMITS.idLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    invalid(`${label} must be a non-empty trimmed string of at most ${maxLength} characters without control characters`);
  }
  return value;
}

function boundedUniqueStringList(value, label) {
  if (!Array.isArray(value) || value.length > UI_LAYOUT_LIMITS.listItems) invalid(`${label} must be an array with at most ${UI_LAYOUT_LIMITS.listItems} items`);
  const seen = new Set();
  return value.map((item, index) => {
    const result = boundedString(item, `${label}[${index}]`);
    if (seen.has(result)) invalid(`${label} must not contain duplicate values`);
    seen.add(result);
    return result;
  });
}

function boundedDeterministicStringList(value, label) {
  return boundedUniqueStringList(value, label).sort();
}

function nullable(value, validate) {
  return value === null ? null : validate(value);
}

function validatePlacement(value) {
  if (!CONTROL_DECK_PLACEMENTS.has(value)) invalid("layout.sidePanel.placement must be right, left, both, or null");
  return value;
}

function validateSectionLayout(value) {
  const source = objectValue(value);
  if (!source) invalid("layout.sidePanel.sectionLayout must be an object or null");
  assertOnlyKeys(source, new Set(["order", "leftSectionIds"]), "layout.sidePanel.sectionLayout");
  if (!own(source, "order") || !own(source, "leftSectionIds")) {
    invalid("layout.sidePanel.sectionLayout must include order and leftSectionIds together");
  }
  const order = nullable(source.order, (entry) => boundedUniqueStringList(entry, "layout.sidePanel.sectionLayout.order"));
  const leftSectionIds = nullable(source.leftSectionIds, (entry) => boundedUniqueStringList(entry, "layout.sidePanel.sectionLayout.leftSectionIds"));
  if ((order === null) !== (leftSectionIds === null)) {
    invalid("layout.sidePanel.sectionLayout order and leftSectionIds must both be arrays or both be null");
  }
  if (order !== null) {
    const orderIds = new Set(order);
    if (leftSectionIds.some((id) => !orderIds.has(id))) {
      invalid("layout.sidePanel.sectionLayout.leftSectionIds entries must occur in order");
    }
  }
  return { order, leftSectionIds };
}

function validateBooleanSides(value, label, { partial = false } = {}) {
  const source = objectValue(value);
  if (!source) invalid(`${label} must be an object or null`);
  assertOnlyKeys(source, new Set(SIDES), label);
  if (partial && Object.keys(source).length === 0) invalid(`${label} must name at least one side`);
  const result = {};
  for (const side of SIDES) {
    if (!partial || own(source, side)) {
      const state = source[side] ?? null;
      if (state !== null && typeof state !== "boolean") invalid(`${label}.${side} must be a boolean or null`);
      result[side] = state;
    }
  }
  return result;
}

function validatePanelWidth(value, label) {
  if (!Number.isFinite(value) || value < UI_LAYOUT_LIMITS.panelWidthMin || value > UI_LAYOUT_LIMITS.panelWidthMax) {
    invalid(`${label} must be between ${UI_LAYOUT_LIMITS.panelWidthMin} and ${UI_LAYOUT_LIMITS.panelWidthMax} pixels or null`);
  }
  return Math.round(value);
}

function validatePanelWidths(value, { partial = false } = {}) {
  const source = objectValue(value);
  if (!source) invalid("layout.sidePanel.panelWidths must be an object or null");
  assertOnlyKeys(source, new Set(SIDES), "layout.sidePanel.panelWidths");
  if (partial && Object.keys(source).length === 0) invalid("layout.sidePanel.panelWidths must name at least one side");
  const result = {};
  for (const side of SIDES) {
    if (!partial || own(source, side)) {
      result[side] = nullable(source[side] ?? null, (entry) => validatePanelWidth(entry, `layout.sidePanel.panelWidths.${side}`));
    }
  }
  return result;
}

function validateSidePanel(value, { partial = false } = {}) {
  const source = objectValue(value);
  if (!source) invalid("layout.sidePanel must be an object or null");
  const fields = new Set(["placement", "sectionLayout", "collapsedSectionIds", "hiddenSectionIds", "collapsedPanels", "panelWidths"]);
  assertOnlyKeys(source, fields, "layout.sidePanel");
  if (partial && Object.keys(source).length === 0) invalid("layout.sidePanel must name at least one field");
  const result = {};
  if (!partial || own(source, "placement")) result.placement = nullable(source.placement ?? null, validatePlacement);
  if (!partial || own(source, "sectionLayout")) result.sectionLayout = nullable(source.sectionLayout ?? null, validateSectionLayout);
  for (const field of ["collapsedSectionIds", "hiddenSectionIds"]) {
    if (!partial || own(source, field)) result[field] = nullable(source[field] ?? null, (entry) => boundedUniqueStringList(entry, `layout.sidePanel.${field}`));
  }
  if (!partial || own(source, "collapsedPanels")) {
    result.collapsedPanels = nullable(source.collapsedPanels ?? null, (entry) => validateBooleanSides(entry, "layout.sidePanel.collapsedPanels", { partial }));
  }
  if (!partial || own(source, "panelWidths")) result.panelWidths = nullable(source.panelWidths ?? null, (entry) => validatePanelWidths(entry, { partial }));
  return result;
}

function validateGrid(value) {
  const source = objectValue(value);
  if (!source) invalid("layout.composerActions.grid must be an object or null");
  assertOnlyKeys(source, new Set(["version", "columns", "positions"]), "layout.composerActions.grid");
  if (source.version !== 2) invalid("layout.composerActions.grid.version must be 2");
  if (!Number.isInteger(source.columns) || source.columns < 1 || source.columns > UI_LAYOUT_LIMITS.gridColumns) {
    invalid(`layout.composerActions.grid.columns must be an integer between 1 and ${UI_LAYOUT_LIMITS.gridColumns}`);
  }
  const positions = objectValue(source.positions);
  if (!positions) invalid("layout.composerActions.grid.positions must be an object");
  const entries = Object.entries(positions);
  if (entries.length > UI_LAYOUT_LIMITS.listItems) invalid(`layout.composerActions.grid.positions must contain at most ${UI_LAYOUT_LIMITS.listItems} items`);
  const result = {};
  const usedSlots = new Set();
  for (const [rawId, slot] of entries) {
    const id = boundedString(rawId, "layout.composerActions.grid position id");
    if (UNSAFE_OBJECT_KEYS.has(id)) invalid("layout.composerActions.grid contains an unsupported position id");
    if (!Number.isInteger(slot) || slot < 0 || slot >= UI_LAYOUT_LIMITS.gridSlots) {
      invalid(`layout.composerActions.grid positions must be integers between 0 and ${UI_LAYOUT_LIMITS.gridSlots - 1}`);
    }
    if (usedSlots.has(slot)) invalid("layout.composerActions.grid positions must not reuse a slot");
    usedSlots.add(slot);
    result[id] = slot;
  }
  return { version: 2, columns: source.columns, positions: result };
}

function validateComposerActions(value, { partial = false } = {}) {
  const source = objectValue(value);
  if (!source) invalid("layout.composerActions must be an object or null");
  assertOnlyKeys(source, new Set(["order", "grid"]), "layout.composerActions");
  if (partial && (!own(source, "order") || !own(source, "grid"))) {
    invalid("layout.composerActions must include order and grid together");
  }
  return {
    order: nullable(source.order ?? null, (entry) => boundedUniqueStringList(entry, "layout.composerActions.order")),
    grid: nullable(source.grid ?? null, validateGrid),
  };
}

function validateCustomGroups(value) {
  const source = objectValue(value);
  if (!source) invalid("layout.terminalTabs.customGroups must be an object or null");
  assertOnlyKeys(source, new Set(["version", "groups"]), "layout.terminalTabs.customGroups");
  if (source.version !== 1) invalid("layout.terminalTabs.customGroups.version must be 1");
  if (!Array.isArray(source.groups) || source.groups.length > UI_LAYOUT_LIMITS.groups) {
    invalid(`layout.terminalTabs.customGroups.groups must be an array with at most ${UI_LAYOUT_LIMITS.groups} groups`);
  }
  const groupIds = new Set();
  const claimedTabIds = new Set();
  const groups = source.groups.map((group, index) => {
    const record = objectValue(group);
    if (!record) invalid(`layout.terminalTabs.customGroups.groups[${index}] must be an object`);
    assertOnlyKeys(record, new Set(["id", "title", "tabIds"]), `layout.terminalTabs.customGroups.groups[${index}]`);
    const id = boundedString(record.id, `layout.terminalTabs.customGroups.groups[${index}].id`);
    if (groupIds.has(id)) invalid("layout.terminalTabs.customGroups group ids must be unique");
    groupIds.add(id);
    const title = boundedString(record.title, `layout.terminalTabs.customGroups.groups[${index}].title`, UI_LAYOUT_LIMITS.titleLength);
    const tabIds = boundedUniqueStringList(record.tabIds, `layout.terminalTabs.customGroups.groups[${index}].tabIds`);
    for (const tabId of tabIds) {
      if (claimedTabIds.has(tabId)) invalid("layout.terminalTabs.customGroups tab ids may appear in only one group");
      claimedTabIds.add(tabId);
    }
    return { id, title, tabIds };
  });
  return { version: 1, groups };
}

function validateTerminalTabs(value, { partial = false } = {}) {
  const source = objectValue(value);
  if (!source) invalid("layout.terminalTabs must be an object or null");
  assertOnlyKeys(source, new Set(["layout", "customGroups", "sidebarWidth"]), "layout.terminalTabs");
  if (partial && Object.keys(source).length === 0) invalid("layout.terminalTabs must name at least one field");
  const result = {};
  if (!partial || own(source, "layout")) {
    const layout = source.layout ?? null;
    if (layout !== null && !TERMINAL_TAB_LAYOUTS.has(layout)) invalid("layout.terminalTabs.layout must be top, left, or null");
    result.layout = layout;
  }
  if (!partial || own(source, "customGroups")) result.customGroups = nullable(source.customGroups ?? null, validateCustomGroups);
  if (!partial || own(source, "sidebarWidth")) {
    result.sidebarWidth = nullable(source.sidebarWidth ?? null, (width) => validateBoundedWidth(
      width,
      "layout.terminalTabs.sidebarWidth",
      UI_LAYOUT_LIMITS.terminalTabsSidebarWidthMin,
      UI_LAYOUT_LIMITS.terminalTabsSidebarWidthMax,
    ));
  }
  return result;
}

function validateBoundedWidth(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) invalid(`${label} must be between ${min} and ${max} pixels or null`);
  return Math.round(value);
}

function validateFileViewerWidth(value) {
  return validateBoundedWidth(value, "layout.fileViewerWidth", UI_LAYOUT_LIMITS.fileViewerWidthMin, UI_LAYOUT_LIMITS.fileViewerWidthMax);
}

function validateControlVisibility(value) {
  const source = objectValue(value);
  if (!source) invalid("layout.controlVisibility must be an object or null");
  assertOnlyKeys(source, new Set(["hiddenIds"]), "layout.controlVisibility");
  if (!own(source, "hiddenIds")) invalid("layout.controlVisibility must include hiddenIds");
  return {
    hiddenIds: nullable(source.hiddenIds, (entry) => boundedDeterministicStringList(entry, "layout.controlVisibility.hiddenIds")),
  };
}

export function defaultUiLayout() {
  return {
    version: UI_LAYOUT_VERSION,
    sidePanel: {
      placement: null,
      sectionLayout: { order: null, leftSectionIds: null },
      collapsedSectionIds: null,
      hiddenSectionIds: null,
      collapsedPanels: { left: null, right: null },
      panelWidths: { left: null, right: null },
    },
    composerActions: { order: null, grid: null },
    controlVisibility: { hiddenIds: null },
    footerScopedModelOrder: null,
    terminalTabs: { layout: null, customGroups: null, sidebarWidth: null },
    fileViewerWidth: null,
  };
}

function softField(validate, fallback = null) {
  try {
    return validate();
  } catch {
    return fallback;
  }
}

function normalizeSharedLayoutFields(source, sidePanel, controlVisibility = defaultUiLayout().controlVisibility) {
  const composerActions = objectValue(source.composerActions);
  const terminalTabs = objectValue(source.terminalTabs);
  return {
    version: UI_LAYOUT_VERSION,
    sidePanel,
    composerActions: {
      order: softField(() => nullable(composerActions?.order ?? null, (entry) => boundedUniqueStringList(entry, "uiLayout.composerActions.order"))),
      grid: softField(() => nullable(composerActions?.grid ?? null, validateGrid)),
    },
    controlVisibility,
    footerScopedModelOrder: softField(() => nullable(source.footerScopedModelOrder ?? null, (entry) => boundedUniqueStringList(entry, "uiLayout.footerScopedModelOrder"))),
    terminalTabs: {
      layout: TERMINAL_TAB_LAYOUTS.has(terminalTabs?.layout) ? terminalTabs.layout : null,
      customGroups: softField(() => nullable(terminalTabs?.customGroups ?? null, validateCustomGroups)),
      sidebarWidth: softField(() => nullable(terminalTabs?.sidebarWidth ?? null, (width) => validateBoundedWidth(
        width,
        "uiLayout.terminalTabs.sidebarWidth",
        UI_LAYOUT_LIMITS.terminalTabsSidebarWidthMin,
        UI_LAYOUT_LIMITS.terminalTabsSidebarWidthMax,
      ))),
    },
    fileViewerWidth: softField(() => nullable(source.fileViewerWidth ?? null, validateFileViewerWidth)),
  };
}

function normalizeSideValues(source, validate, fallback) {
  const record = objectValue(source);
  return Object.fromEntries(SIDES.map((side) => [side, softField(() => nullable(record?.[side] ?? null, (value) => validate(value, side)), fallback)]));
}

function normalizedControlVisibility(source) {
  return softField(
    () => source.controlVisibility == null ? defaultUiLayout().controlVisibility : validateControlVisibility(source.controlVisibility),
    defaultUiLayout().controlVisibility,
  );
}

function normalizeCurrentVersion(source, { migrate = false } = {}) {
  const sidePanel = objectValue(source.sidePanel);
  return normalizeSharedLayoutFields(source, {
    placement: CONTROL_DECK_PLACEMENTS.has(sidePanel?.placement) ? sidePanel.placement : null,
    sectionLayout: softField(
      () => sidePanel?.sectionLayout == null ? defaultUiLayout().sidePanel.sectionLayout : validateSectionLayout(sidePanel.sectionLayout),
      defaultUiLayout().sidePanel.sectionLayout,
    ),
    collapsedSectionIds: softField(() => nullable(sidePanel?.collapsedSectionIds ?? null, (entry) => boundedUniqueStringList(entry, "uiLayout.sidePanel.collapsedSectionIds"))),
    hiddenSectionIds: softField(() => nullable(sidePanel?.hiddenSectionIds ?? null, (entry) => boundedUniqueStringList(entry, "uiLayout.sidePanel.hiddenSectionIds"))),
    collapsedPanels: normalizeSideValues(sidePanel?.collapsedPanels, (value, side) => {
      if (typeof value !== "boolean") invalid(`uiLayout.sidePanel.collapsedPanels.${side} must be a boolean or null`);
      return value;
    }, null),
    panelWidths: normalizeSideValues(sidePanel?.panelWidths, (value, side) => validatePanelWidth(value, `uiLayout.sidePanel.panelWidths.${side}`), null),
  }, migrate ? defaultUiLayout().controlVisibility : normalizedControlVisibility(source));
}

function migrateVersionTwo(source) {
  return normalizeCurrentVersion(source, { migrate: true });
}

function migrateVersionOne(source, legacySidePanelWidth) {
  const sidePanel = objectValue(source.sidePanel);
  const order = softField(() => nullable(sidePanel?.sectionOrder ?? null, (entry) => boundedUniqueStringList(entry, "uiLayout.sidePanel.sectionOrder")));
  const rightWidth = softField(
    () => validatePanelWidth(legacySidePanelWidth, "interfacePreferences.sidePanelWidth"),
    UI_LAYOUT_LIMITS.panelWidthDefault,
  );
  return normalizeSharedLayoutFields(source, {
    placement: "right",
    sectionLayout: order === null ? { order: null, leftSectionIds: null } : { order, leftSectionIds: [] },
    collapsedSectionIds: softField(() => nullable(sidePanel?.collapsedSectionIds ?? null, (entry) => boundedUniqueStringList(entry, "uiLayout.sidePanel.collapsedSectionIds"))),
    hiddenSectionIds: softField(() => nullable(sidePanel?.hiddenSectionIds ?? null, (entry) => boundedUniqueStringList(entry, "uiLayout.sidePanel.hiddenSectionIds"))),
    collapsedPanels: {
      left: false,
      right: typeof sidePanel?.collapsed === "boolean" ? sidePanel.collapsed : false,
    },
    panelWidths: { left: UI_LAYOUT_LIMITS.panelWidthDefault, right: rightWidth },
  });
}

export function normalizeUiLayout(value, { legacySidePanelWidth = null } = {}) {
  const source = objectValue(value);
  if (!source) return defaultUiLayout();
  if (source.version === UI_LAYOUT_VERSION) return normalizeCurrentVersion(source);
  if (source.version === PREVIOUS_UI_LAYOUT_VERSION) return migrateVersionTwo(source);
  if (source.version === LEGACY_UI_LAYOUT_VERSION) return migrateVersionOne(source, legacySidePanelWidth);
  return defaultUiLayout();
}

export function validateUiLayoutPatch(value) {
  const source = objectValue(value);
  if (!source) invalid("layout must be an object");
  const allowed = new Set(["version", "sidePanel", "composerActions", "controlVisibility", "footerScopedModelOrder", "terminalTabs", "fileViewerWidth"]);
  assertOnlyKeys(source, allowed, "layout");
  if (own(source, "version") && source.version !== UI_LAYOUT_VERSION) invalid(`layout.version must be ${UI_LAYOUT_VERSION}`);
  const mutableFields = [...allowed].filter((field) => field !== "version" && own(source, field));
  if (mutableFields.length === 0) invalid("layout must name at least one mutable field");
  const patch = {};
  if (own(source, "sidePanel")) patch.sidePanel = nullable(source.sidePanel, (entry) => validateSidePanel(entry, { partial: true }));
  if (own(source, "composerActions")) patch.composerActions = nullable(source.composerActions, (entry) => validateComposerActions(entry, { partial: true }));
  if (own(source, "controlVisibility")) patch.controlVisibility = nullable(source.controlVisibility, validateControlVisibility);
  if (own(source, "footerScopedModelOrder")) patch.footerScopedModelOrder = nullable(source.footerScopedModelOrder, (entry) => boundedUniqueStringList(entry, "layout.footerScopedModelOrder"));
  if (own(source, "terminalTabs")) patch.terminalTabs = nullable(source.terminalTabs, (entry) => validateTerminalTabs(entry, { partial: true }));
  if (own(source, "fileViewerWidth")) patch.fileViewerWidth = nullable(source.fileViewerWidth, validateFileViewerWidth);
  return patch;
}

export function mergeUiLayout(current, patch) {
  const base = normalizeUiLayout(current);
  const value = validateUiLayoutPatch(patch);
  const merged = { ...base };
  if (own(value, "sidePanel")) {
    if (value.sidePanel === null) {
      merged.sidePanel = defaultUiLayout().sidePanel;
    } else {
      merged.sidePanel = { ...base.sidePanel, ...value.sidePanel };
      for (const field of ["collapsedPanels", "panelWidths"]) {
        if (own(value.sidePanel, field) && value.sidePanel[field] !== null) {
          merged.sidePanel[field] = { ...base.sidePanel[field], ...value.sidePanel[field] };
        }
      }
    }
  }
  if (own(value, "composerActions")) merged.composerActions = value.composerActions === null ? defaultUiLayout().composerActions : value.composerActions;
  if (own(value, "controlVisibility")) merged.controlVisibility = value.controlVisibility === null ? defaultUiLayout().controlVisibility : value.controlVisibility;
  if (own(value, "footerScopedModelOrder")) merged.footerScopedModelOrder = value.footerScopedModelOrder;
  if (own(value, "terminalTabs")) {
    merged.terminalTabs = value.terminalTabs === null
      ? defaultUiLayout().terminalTabs
      : { ...base.terminalTabs, ...value.terminalTabs };
  }
  if (own(value, "fileViewerWidth")) merged.fileViewerWidth = value.fileViewerWidth;
  return normalizeUiLayout(merged);
}

export function uiLayoutRevision(value) {
  return createHash("sha256").update(JSON.stringify(normalizeUiLayout(value))).digest("hex");
}
