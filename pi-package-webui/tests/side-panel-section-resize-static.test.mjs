import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css, html, serviceWorker] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "service-worker.js"), "utf8"),
]);

assert.match(app, /const SIDE_PANEL_SECTION_HEIGHT_STORAGE_KEY = "pi-webui-side-panel-section-heights-v1";/, "section heights need an independent local cache map");
assert.match(app, /const SIDE_PANEL_SECTION_HEIGHT_MIN_PX = 120;[\s\S]*const SIDE_PANEL_SECTION_HEIGHT_MAX_PX = 4096;/, "browser bounds should match the approved persistence contract");
assert.match(
  app,
  /function initializeSidePanelSectionResizing\(\)[\s\S]*sidePanelSectionRecords\(\)[\s\S]*make\("div", "side-panel-section-resize-handle"\)[\s\S]*handle\.tabIndex = 0[\s\S]*setAttribute\("role", "separator"\)[\s\S]*setAttribute\("aria-orientation", "horizontal"\)[\s\S]*record\.section\.append\(handle\)/,
  "every declarative section should receive a separate focusable horizontal separator outside the reorder header",
);
assert.match(
  app,
  /function updateSidePanelSectionResizeHandle[\s\S]*aria-valuemin[\s\S]*aria-valuemax[\s\S]*aria-valuenow[\s\S]*aria-valuetext/,
  "resize separators should expose the full ARIA value contract",
);
assert.match(
  app,
  /function beginSidePanelSectionResize[\s\S]*setPointerCapture[\s\S]*pointermove[\s\S]*pointerup[\s\S]*pointercancel[\s\S]*function cancelSidePanelSectionResize[\s\S]*storedHeight/,
  "pointer resizing should use capture and restore the prior preference when cancelled",
);
assert.match(
  app,
  /function handleSidePanelSectionResizeKeydown[\s\S]*event\.shiftKey[\s\S]*ArrowUp[\s\S]*ArrowDown[\s\S]*Home[\s\S]*End[\s\S]*persistSidePanelSectionHeight/,
  "keyboard resizing should support arrows, bounds, and a Shift-modified step",
);
assert.match(
  app,
  /function persistSidePanelSectionHeight[\s\S]*localStorage\.setItem\(SIDE_PANEL_SECTION_HEIGHT_STORAGE_KEY[\s\S]*markDurableUiLayoutDirty\("sidePanel", "sectionHeights"\)/,
  "height updates should write the local map before journaling only the durable sectionHeights subfield",
);
assert.match(
  app,
  /UI_LAYOUT_SIDE_PANEL_FIELDS = \[[^\]]*"sectionHeights"[^\]]*\][\s\S]*function collectDurableSidePanelLayout[\s\S]*sectionHeights: readStoredSidePanelSectionHeights\(\)/,
  "durable layout collection should include sectionHeights as a sidePanel subfield",
);
assert.match(
  app,
  /function applyDurableSidePanelLayout[\s\S]*value\.sectionHeights[\s\S]*writeDurableLayoutCache\(SIDE_PANEL_SECTION_HEIGHT_STORAGE_KEY[\s\S]*restoreSidePanelSectionHeights\(\)/,
  "server snapshots should refresh the independent local map and rendered sections",
);
assert.match(
  app,
  /function durableUiLayoutInteractionActive[\s\S]*sidePanelSectionPointerDrag\?\.active \|\| sidePanelSectionResizeState/,
  "active section resizing should block sidePanel reconciliation and save flushing",
);
assert.match(app, /event\.key === SIDE_PANEL_SECTION_HEIGHT_STORAGE_KEY && !sidePanelSectionResizeState\) restoreSidePanelSectionHeights\(\)/, "same-origin tabs should adopt height-map storage events without echo writes or interrupting a local drag");
assert.match(app, /function setSidePanelSectionVisible[\s\S]*applySidePanelSectionHeight\(record, readStoredSidePanelSectionHeights\(\)\?\.\[record\.id\] \?\? null\)/, "showing a section should immediately restore its height and separator state");
assert.match(app, /if \(field === "sidePanel" && durableUiLayoutInteractionActive\(field\)\) continue;/, "active height resizing should scope snapshot deferral to the Control Deck field");
assert.match(app, /function sidePanelSectionRenderableMaxHeight[\s\S]*body\?\.clientHeight[\s\S]*SIDE_PANEL_SECTION_HEIGHT_MAX_PX/, "desktop rendering should clamp preferences to the available Control Deck body height");
assert.match(app, /function applySidePanelSectionHeight[\s\S]*naturalHeight[\s\S]*Math\.max\(SIDE_PANEL_SECTION_HEIGHT_MIN_PX/, "an unconfigured short section should render at the advertised minimum height");
assert.match(css, /\.side-panel-section-resize-handle[\s\S]*cursor: row-resize[\s\S]*touch-action: none/, "the separator should expose a dedicated row-resize affordance");
assert.match(css, /@media \(max-width: 1050px\)[\s\S]*\.side-panel-section-resize-handle[\s\S]*display: none !important[\s\S]*\.side-panel-section-content[\s\S]*height: auto !important[\s\S]*overflow: visible !important/, "overlay shells should hide separators and restore natural section content height");
assert.match(css, /mobile-canonical-host > \.side-panel-section-content[\s\S]*height: auto !important[\s\S]*overflow: visible !important/, "mobile canonical hosts should never inherit desktop section height constraints");
assert.match(html, /styles\.css\?v=99/, "section resize styles should advance the stylesheet revision");
assert.match(html, /app\.js\?v=114/, "section resize behavior should advance the app revision");
assert.match(serviceWorker, /const CACHE_NAME = "pi-webui-pwa-v75"/, "changed browser assets should advance the PWA cache identity");

console.log("side-panel-section-resize-static.test.mjs passed");
