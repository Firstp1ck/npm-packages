import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, css] = await Promise.all([
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
]);
assert.match(app, /const SIDE_PANEL_SECTION_ORDER_STORAGE_KEY = "pi-webui-side-panel-section-order-v1"/);
assert.match(app, /const SIDE_PANEL_SECTION_POINTER_DRAG_THRESHOLD_PX = 6/);
assert.match(app, /function controlDeckSectionRecords\(\)[\s\S]*document\.querySelectorAll\("\[data-side-panel-section\]"\)/);
assert.match(app, /function persistControlDeckSectionLayout\(\)[\s\S]*sectionLayout[\s\S]*markDurableUiLayoutDirty\("sidePanel", "sectionLayout"\)/);
assert.match(app, /function moveSidePanelSectionRelative\(fromId, targetRecord, insertBefore, targetSide = null\)[\s\S]*parent\.insertBefore\(sourceRecord\.section, targetRecord\.section\)/);
assert.match(app, /function moveSidePanelSectionToSide\(sectionId, side\)[\s\S]*effectiveControlDeckPresentation\(\) !== "both"/);
assert.match(app, /function updateSidePanelSectionPointerDrag\(event\)[\s\S]*Math\.hypot[\s\S]*SIDE_PANEL_SECTION_POINTER_DRAG_THRESHOLD_PX[\s\S]*data-control-deck-drop-target/);
assert.match(app, /\["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"\]/);
assert.match(app, /function setOnlySidePanelSectionExpanded[\s\S]*controlDeckSectionSide\(record\.id\) !== targetSide/);
assert.match(app, /function setSidePanelSectionEditMode\(enabled\)[\s\S]*const next = isMobileView\(\) && !!enabled/);
assert.match(html, /id="sidePanelEditButton"[^>]*aria-controls="sidePanel"[^>]*aria-pressed="false"/);
assert.match(html, /data-control-deck-drop-target="left"/);
assert.match(html, /data-control-deck-drop-target="right"/);
assert.match(css, /\.side-panel\.section-edit-mode \.side-panel-section-toggle\[data-side-panel-section-toggle\]/);
assert.match(css, /\.side-panel-section\.drag-over-before/);
console.log("side-panel-section-reorder-static.test.mjs passed");
