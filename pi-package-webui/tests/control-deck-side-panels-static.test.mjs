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

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
assert.equal(ids.length, new Set(ids).size, "the static DOM must not duplicate IDs");
assert.match(html, /id="sidePanelLeft"[^>]*aria-label="Left Control Deck"/);
assert.match(html, /id="sidePanel"[^>]*aria-label="Right Control Deck"/);
assert.match(html, /id="sidePanelBodyLeft"[^>]*data-control-deck-body="left"/);
assert.match(html, /id="sidePanelBodyRight"[^>]*data-control-deck-body="right"/);
assert.match(html, /data-control-deck-drop-target="left"/);
assert.match(html, /data-control-deck-drop-target="right"/);
assert.match(html, /id="controlDeckMovementAnnouncer"[^>]*aria-live="polite"/);
assert.match(html, /<div class="workspace-column">[\s\S]*<section class="chat-panel">[\s\S]*<\/div>\s*<button id="sidePanelBackdrop"/);
assert.match(html, /<option value="left">Sidebar<\/option>/);
assert.match(html, /id="controlDeckPlacementSelect"[\s\S]*<option value="right">Right<\/option>[\s\S]*<option value="left">Left<\/option>[\s\S]*<option value="both">Both<\/option>/);

assert.match(app, /const UI_LAYOUT_SCHEMA_VERSION = 2;/);
assert.match(app, /const UI_LAYOUT_SIDE_PANEL_FIELDS = \["placement", "sectionLayout", "collapsedSectionIds", "hiddenSectionIds", "collapsedPanels", "panelWidths"\]/);
assert.match(app, /const CONTROL_DECK_LAYOUT_STORAGE_KEY = "pi-webui-control-deck-layout-v2"/);
assert.match(app, /function controlDeckSectionRecords\(\)[\s\S]*document\.querySelectorAll\("\[data-side-panel-section\]"\)/);
assert.match(app, /function reconcileControlDeckHosts\(\)[\s\S]*effectiveControlDeckPresentation\(\)[\s\S]*body\.append\(record\.section\)/);
assert.match(app, /function isControlDeckOverlayPresentation\(\)[\s\S]*sidePanelOverlayMedia\?\.matches[\s\S]*minimum/);
assert.match(app, /function effectiveControlDeckPresentation\(\)[\s\S]*"overlay"[\s\S]*normalizeControlDeckPlacement\(controlDeckLayout\.placement\)/);
assert.match(app, /function reconcileControlDeckPlacementConstraint\(\)[\s\S]*querySelector\('option\[value="both"\]'\)[\s\S]*bothOption\.disabled = sidebarPresentation[\s\S]*placement !== "both"[\s\S]*controlDeckLayout\.placement = "right"[\s\S]*cacheControlDeckLayout\(controlDeckLayout, "placement"\)[\s\S]*markDurableUiLayoutDirty\("sidePanel", "placement"\)/, "Sidebar tabs should disable Both and durably reconcile an active Both placement to Right");
assert.match(app, /function reconcileControlDeckHosts\(\)[\s\S]*const placement = reconcileControlDeckPlacementConstraint\(\)[\s\S]*controlDeckPlacementSelect\.value = placement/, "placement constraints should be reconciled before the Control Deck hosts and select are rendered");
assert.match(app, /classList\.toggle\("terminal-tabs-sidebar-start", sidebarPresentation && placement === "right"\)/);
assert.match(app, /function moveSidePanelSectionToSide\(sectionId, side\)/);
assert.match(app, /\["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"\]/);
assert.match(app, /markDurableUiLayoutDirty\("sidePanel", "sectionLayout"\)/);
assert.match(app, /markDurableUiLayoutDirty\("sidePanel", "placement"\)/);
assert.match(app, /markDurableUiLayoutDirty\("sidePanel", "panelWidths"\)/);
assert.match(app, /const mixedWidth = patch\.sidePanel\?\.panelWidths\?\.right[\s\S]*sidePanelWidth: mixedWidth/);
assert.match(app, /value\.field === "sidePanel" && subfield === "sectionOrder"[\s\S]*subfield = "sectionLayout"/);
assert.match(app, /const UI_LAYOUT_PENDING_STORAGE_PREFIX = "pi-webui-ui-layout-pending-v4:"/);
assert.match(app, /const UI_LAYOUT_LEGACY_PENDING_STORAGE_PREFIX = "pi-webui-ui-layout-pending-v3:"/);
assert.match(app, /value\.field === "sidePanel" && subfield === "collapsed"[\s\S]*subfield = "collapsedPanels"/);
assert.match(app, /subfield === "collapsedSectionIds"[\s\S]*durableLayoutIdList\(value\.value\)/);
assert.match(app, /subfield === "hiddenSectionIds"[\s\S]*durableLayoutIdList\(value\.value\)/);
assert.match(app, /function cacheControlDeckLayout\(next = controlDeckLayout, subfield = null\)[\s\S]*readStoredControlDeckLayout\(\)[\s\S]*\[subfield\]: incoming\[subfield\]/);
assert.match(app, /activelyManipulated[\s\S]*subfield === "sectionLayout"[\s\S]*subfield === "panelWidths"/);
assert.match(app, /function controlDeckSideResizeAvailable\(side = "right"\)[\s\S]*presentation === "left"[\s\S]*presentation === "both"[\s\S]*presentation === "right"/);
assert.match(app, /function updateSidePanelResizeHandle\(width = currentSidePanelWidth\("right"\), side = "right"\)/);
assert.match(app, /function handleSidePanelResizeKeydown\(event\)[\s\S]*side === "left"/);
assert.match(css, /\.side-panel-resize-handle-right \{[\s\S]*left:\s*-1\.175rem/);
assert.match(css, /\.side-panel-resize-handle-left \{[\s\S]*right:\s*-1\.175rem;[\s\S]*left:\s*auto/);
assert.match(css, /--side-panel-left-width/);
assert.match(css, /--side-panel-right-width/);
assert.match(css, /body\.control-deck-both \.layout/);
assert.match(css, /side-panel-left-collapsed[\s\S]*side-panel-right-collapsed/);
assert.match(css, /body\.control-deck-overlay \.layout/);
assert.match(css, /body\.terminal-tabs-left \.chat-panel[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(13rem, var\(--terminal-tabs-sidebar-width\)\)/);
assert.match(css, /body\.terminal-tabs-left \.terminal-tabs-shell[\s\S]*grid-column:\s*2/);
assert.match(css, /body\.terminal-tabs-left \.chat-search-bar[\s\S]*body\.terminal-tabs-left \.context-meter-bar[\s\S]*grid-column:\s*1/);
assert.match(css, /body\.terminal-tabs-left\.terminal-tabs-sidebar-start \.chat-panel[\s\S]*grid-template-columns:\s*minmax\(13rem, var\(--terminal-tabs-sidebar-width\)\) minmax\(0, 1fr\)/);
assert.match(css, /body\.terminal-tabs-left\.terminal-tabs-sidebar-start \.terminal-tabs-shell[\s\S]*grid-column:\s*1/);
assert.match(css, /body\.terminal-tabs-left\.terminal-tabs-sidebar-start \.chat[\s\S]*grid-column:\s*2/);
assert.match(css, /body\.embedded-split \.layout,[\s\S]*body\.embedded-split:not\(\.control-deck-left\):not\(\.control-deck-both\) \.layout \{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/, "embedded split terminals should override the more specific default Control Deck columns");
assert.match(css, /body\.embedded-split \.chat-panel,\s*body\.embedded-split\.terminal-tabs-left \.chat-panel \{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*hidden;/, "embedded split terminals should ignore the saved sidebar grid at every iframe width");
assert.match(css, /\.workspace-column[\s\S]*body\.terminal-split-open \.workspace-column[\s\S]*body\.file-viewer-open \.workspace-column[\s\S]*body\.terminal-split-open\.file-viewer-open \.workspace-column/);

console.log("control-deck-side-panels-static.test.mjs passed");
