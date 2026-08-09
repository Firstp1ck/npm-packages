import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, css, serviceWorker] = await Promise.all([
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "service-worker.js"), "utf8"),
]);

assert.match(
  app,
  /const SIDE_PANEL_SECTION_ORDER_STORAGE_KEY = "pi-webui-side-panel-section-order-v1";[\s\S]*const SIDE_PANEL_SECTION_POINTER_DRAG_THRESHOLD_PX = 6;/,
  "side-panel order should use versioned browser storage and the same six-pixel pointer threshold as model ordering",
);
assert.match(
  app,
  /function readStoredSidePanelSectionOrder\(\)[\s\S]*JSON\.parse\(localStorage\.getItem\(SIDE_PANEL_SECTION_ORDER_STORAGE_KEY\)[\s\S]*new Set\([\s\S]*function persistSidePanelSectionOrder\(\)[\s\S]*sidePanelSectionRecords\(\)\.map\(\(\{ id \}\) => id\)/,
  "stored order should be deduplicated and persist the complete current section order",
);
assert.match(
  app,
  /function restoreSidePanelSectionOrder\(\)[\s\S]*rank = new Map\([\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*parent\.append\(section\)/,
  "restore should rank known IDs while appending newly introduced sections in their existing order",
);
assert.match(
  app,
  /function isSidePanelSectionReorderingEnabled\(\) \{\n\s+return !isMobileView\(\) \|\| sidePanelSectionEditMode;[\s\S]*function moveSidePanelSectionRelative\(fromId, targetRecord, insertBefore\) \{\n\s+if \(!isSidePanelSectionReorderingEnabled\(\)\) return false;[\s\S]*parent\.insertBefore\(sourceRecord\.section, targetRecord\.section\)[\s\S]*targetRecord\.section\.nextSibling[\s\S]*persistSidePanelSectionOrder\(\)/,
  "desktop reordering should stay enabled while mobile reordering fails closed outside Edit mode",
);
assert.match(
  app,
  /function moveSidePanelSectionByOffset\(sectionId, offset\) \{\n\s+if \(!isSidePanelSectionReorderingEnabled\(\)\) return false;/,
  "keyboard reordering should follow the desktop-always/mobile-Edit gate",
);
assert.match(
  app,
  /function beginSidePanelSectionPointerDrag\(event, sectionId\) \{\n\s+if \(!isSidePanelSectionReorderingEnabled\(\) \|\| event\.button !== 0/,
  "pointer and touch dragging should follow the responsive reorder gate",
);
assert.match(
  app,
  /function updateSidePanelSectionPointerDrag\(event\)[\s\S]*Math\.hypot[\s\S]*SIDE_PANEL_SECTION_POINTER_DRAG_THRESHOLD_PX[\s\S]*sidePanelSectionToggleFromPoint[\s\S]*getBoundingClientRect\(\)[\s\S]*moveSidePanelSectionRelative/,
  "edit-mode pointer dragging should activate only after the threshold and use header midpoint placement",
);
assert.match(
  app,
  /function endSidePanelSectionPointerDrag\(event\)[\s\S]*sidePanelSectionSuppressClickUntil = Date\.now\(\) \+ 250[\s\S]*focus\(\{ preventScroll: true \}\)/,
  "a completed drag should suppress the accidental toggle click and restore focus",
);
assert.match(
  app,
  /function bindSidePanelSectionToggles\(\)[\s\S]*Date\.now\(\) < sidePanelSectionSuppressClickUntil[\s\S]*!isSidePanelSectionReorderingEnabled\(\) \|\| !event\.altKey[\s\S]*event\.key !== "ArrowUp"[\s\S]*moveSidePanelSectionByOffset[\s\S]*beginSidePanelSectionPointerDrag/,
  "section headers should retain click toggling while the responsive gate controls Alt+Arrow and pointer reordering",
);
assert.match(
  app,
  /restoreSidePanelSectionOrder\(\);\s*restoreSidePanelSectionVisibility\(\);\s*restoreSidePanelSectionState\(\);/,
  "saved order should restore before visibility and accordion state",
);
assert.match(
  app,
  /event\.key === SIDE_PANEL_SECTION_ORDER_STORAGE_KEY\) restoreSidePanelSectionOrder\(\)/,
  "other tabs should apply stored side-panel order changes",
);
assert.match(
  css,
  /\.side-panel-edit-button \{\n\s+display: none;[\s\S]*?\.side-panel\.section-edit-mode \.side-panel-section-toggle\[data-side-panel-section-toggle\] \{\n\s+cursor: grab;\n\s+touch-action: none;\n\s+user-select: none;\n\}[\s\S]*?@media \(max-width: 720px\), \(max-device-width: 720px\), \(pointer: coarse\) and \(hover: none\) \{[\s\S]*?\.side-panel-edit-button \{ display: inline-flex;[\s\S]*?\.side-panel\.section-edit-mode \.side-panel-section-toggle\[data-side-panel-section-toggle\] \{\n\s+border-color:[\s\S]*?box-shadow:[\s\S]*?\.side-panel\.section-edit-mode \.side-panel-section-label::before \{/,
  "desktop should keep drag capture without edit highlighting while mobile restores Edit and its visual affordance",
);
assert.match(html, /id="sidePanelEditButton"[^>]*aria-controls="sidePanel"[^>]*aria-pressed="false"[^>]*aria-label="Edit Control Deck section order"[\s\S]*side-panel-edit-button-label">Edit</, "mobile Control Deck should retain an accessible Edit toggle");
assert.match(app, /function setSidePanelSectionEditMode\(enabled\)[\s\S]*const next = isMobileView\(\) && !!enabled;[\s\S]*classList\.toggle\("section-edit-mode", reorderingEnabled\)[\s\S]*aria-pressed[\s\S]*"Done" : "Edit"[\s\S]*aria-keyshortcuts/, "mobile Edit state and always-enabled desktop reorder affordances should stay synchronized");
assert.match(app, /function setSidePanelCollapsed\(collapsed,[\s\S]*if \(collapsed\) setSidePanelSectionEditMode\(false\);/, "closing the Control Deck should leave transient edit mode");
assert.match(html, /styles\.css\?v=107/, "changed side-panel styles should advance the stylesheet revision");
assert.match(html, /app\.js\?v=121/, "changed side-panel behavior should advance the app revision");
assert.match(serviceWorker, /const CACHE_NAME = "pi-webui-pwa-v84"/, "changed browser assets should advance the PWA cache identity");

console.log("side-panel-section-reorder-static.test.mjs passed");
