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
  /function moveSidePanelSectionRelative\(fromId, targetRecord, insertBefore\)[\s\S]*parent\.insertBefore\(sourceRecord\.section, targetRecord\.section\)[\s\S]*targetRecord\.section\.nextSibling[\s\S]*persistSidePanelSectionOrder\(\)/,
  "reordering should move the complete section before or after its target and persist immediately",
);
assert.match(
  app,
  /function updateSidePanelSectionPointerDrag\(event\)[\s\S]*Math\.hypot[\s\S]*SIDE_PANEL_SECTION_POINTER_DRAG_THRESHOLD_PX[\s\S]*sidePanelSectionToggleFromPoint[\s\S]*getBoundingClientRect\(\)[\s\S]*moveSidePanelSectionRelative/,
  "pointer dragging should activate only after the threshold and use header midpoint placement",
);
assert.match(
  app,
  /function endSidePanelSectionPointerDrag\(event\)[\s\S]*sidePanelSectionSuppressClickUntil = Date\.now\(\) \+ 250[\s\S]*focus\(\{ preventScroll: true \}\)/,
  "a completed drag should suppress the accidental toggle click and restore focus",
);
assert.match(
  app,
  /function bindSidePanelSectionToggles\(\)[\s\S]*Date\.now\(\) < sidePanelSectionSuppressClickUntil[\s\S]*event\.altKey[\s\S]*event\.key !== "ArrowUp"[\s\S]*moveSidePanelSectionByOffset[\s\S]*beginSidePanelSectionPointerDrag/,
  "section headers should retain click toggling while supporting Alt+Arrow keyboard and pointer reordering",
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
  /\.side-panel-section-toggle\[data-side-panel-section-toggle\][\s\S]*cursor: grab[\s\S]*touch-action: none[\s\S]*\.side-panel-section\.dragging[\s\S]*cursor: grabbing[\s\S]*\.drag-over-before[\s\S]*\.drag-over-after/,
  "section headers should expose model-picker-style grab, dragging, and insertion-marker affordances",
);
assert.match(html, /styles\.css\?v=99/, "changed side-panel styles should advance the stylesheet revision");
assert.match(html, /app\.js\?v=114/, "changed side-panel behavior should advance the app revision");
assert.match(serviceWorker, /const CACHE_NAME = "pi-webui-pwa-v75"/, "changed browser assets should advance the PWA cache identity");

console.log("side-panel-section-reorder-static.test.mjs passed");
