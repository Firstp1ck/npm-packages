import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "bin/pi-webui.mjs"), "utf8");

test("Control Deck exposes an accessible resize separator", () => {
  assert.match(html, /id="sidePanelResizeHandle"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*aria-label="Resize right Control Deck width"[^>]*tabindex="0"/);
  assert.match(html, /id="sidePanelLeftResizeHandle"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*aria-label="Resize left Control Deck width"[^>]*tabindex="0"/);
  assert.match(css, /--side-panel-width:\s*384px/);
  assert.match(css, /\.file-viewer-resize-handle,[\s\S]*\.side-panel-resize-handle,[\s\S]*\.terminal-tabs-resize-handle \{[\s\S]*width:\s*1\.35rem;[\s\S]*height:\s*5\.2rem;[\s\S]*cursor:\s*col-resize;[\s\S]*touch-action:\s*none;/, "the Control Deck handle must keep its 1.35rem hit target and pointer geometry");
  assert.match(css, /\.side-panel-resize-handle::after \{[\s\S]*left:\s*50%;[\s\S]*width:\s*0\.8rem;[\s\S]*transform:\s*translateX\(-50%\);/, "the painted Control Deck pill should be 0.8rem wide and centered within the hit target");
  assert.match(css, /\.side-panel-resize-handle:hover::after,[\s\S]*\.side-panel-resize-handle:focus-visible::after,[\s\S]*body\.side-panel-resizing \.side-panel-resize-handle::after \{[\s\S]*border-color:/, "hover, focus, and active resizing must style the narrow painted pill rather than the hit target");
  assert.match(css, /\.side-panel-resize-handle-right \{[\s\S]*left:\s*-1\.175rem/);
  assert.match(css, /\.side-panel-resize-handle-left \{[\s\S]*right:\s*-1\.175rem;[\s\S]*left:\s*auto/, "the left Control Deck handle must sit in the workspace-facing inter-column gap");
});

test("desktop layouts and Control Deck content follow the selected width", () => {
  assert.match(css, /\.layout \{[\s\S]*grid-template-columns:\s*minmax\(20rem, var\(--side-panel-left-width, 384px\)\) minmax\(0, 1fr\) minmax\(20rem, var\(--side-panel-right-width, var\(--side-panel-width\)\)\)/);
  assert.match(css, /body\.control-deck-left \.layout[\s\S]*grid-template-columns:/);
  assert.match(css, /body\.control-deck-both \.layout[\s\S]*grid-template-columns:/);
  assert.match(css, /\.side-panel \{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0/);
});

test("Control Deck width is clamped, user-persisted, pointer-resizable, and keyboard-resizable", () => {
  assert.match(app, /const SIDE_PANEL_WIDTH_STORAGE_KEY = "pi-webui-side-panel-width"/);
  assert.match(app, /const SIDE_PANEL_WIDTH_MAX_PX = 4096/);
  assert.match(app, /width >= SIDE_PANEL_WIDTH_MIN_PX && width <= SIDE_PANEL_WIDTH_MAX_PX/);
  assert.match(app, /function persistSidePanelWidth\(width, side = "right"\)[\s\S]*panelWidths[\s\S]*markDurableUiLayoutDirty\("sidePanel", "panelWidths"\)/);
  assert.match(app, /async function restoreSidePanelWidthPreference\(\)[\s\S]*\/api\/interface-preferences[\s\S]*response\.data\?\.preferences\?\.sidePanelWidth[\s\S]*cacheSidePanelWidth/);
  assert.match(server, /url\.pathname === "\/api\/interface-preferences" && req\.method === "GET"/);
  assert.match(server, /url\.pathname === "\/api\/interface-preferences" && req\.method === "PUT"/);
  assert.match(app, /function sidePanelMaxWidth\(side = "right"\)[\s\S]*fileViewerVisible[\s\S]*splitOpen[\s\S]*centralMinimum[\s\S]*otherPanelWidth[\s\S]*available/);
  assert.match(app, /function applySidePanelWidth\(width, \{ persist = false, side = "right" \} = \{\}\)[\s\S]*--side-panel-left-width[\s\S]*--side-panel-right-width[\s\S]*if \(side === "right"\)[\s\S]*--side-panel-width[\s\S]*persistSidePanelWidth/);
  assert.match(app, /function controlDeckSideResizeAvailable\(side = "right"\)[\s\S]*presentation === "left"[\s\S]*presentation === "both"[\s\S]*presentation === "right"/);
  assert.match(app, /function beginSidePanelResize\(event, forcedSide = null\)[\s\S]*controlDeckSideResizeAvailable\(side\)[\s\S]*setPointerCapture[\s\S]*pointermove[\s\S]*pointercancel/);
  assert.match(app, /function updateSidePanelResize\(event\)[\s\S]*state\.side === "left" \? event\.clientX - state\.startX : state\.startX - event\.clientX/);
  assert.match(app, /function persistSidePanelWidth\(width, side = "right"\)[\s\S]*if \(side === "right"\) cacheSidePanelWidth\(rounded\)/, "left width must not overwrite the legacy right-width mirror");
  assert.match(app, /sidePanel:\s*Boolean\(sidePanelSectionPointerDrag\?\.active \|\| sidePanelResizeState\)/, "active side-panel resize must fence durable reconciliation");
  assert.match(app, /function handleSidePanelResizeKeydown\(event\)[\s\S]*ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/);
  assert.match(app, /elements\.sidePanelResizeHandle\?\.addEventListener\("pointerdown", beginSidePanelResize\);\nelements\.sidePanelResizeHandle\?\.addEventListener\("keydown", handleSidePanelResizeKeydown\);/);
  assert.match(app, /elements\.sidePanelResizeHandleLeft\?\.addEventListener\("pointerdown", \(event\) => beginSidePanelResize\(event, "left"\)\);\nelements\.sidePanelResizeHandleLeft\?\.addEventListener\("keydown", handleSidePanelResizeKeydown\);/);
  assert.match(app, /function reconcileControlDeckHosts\(\)[\s\S]*updateSidePanelResizeHandle\(currentSidePanelWidth\("left"\), "left"\)[\s\S]*updateSidePanelResizeHandle\(currentSidePanelWidth\("right"\), "right"\)/);
});

test("Control Deck resizing disables itself in overlay layouts and responds to viewport changes", () => {
  assert.match(app, /function controlDeckSideResizeAvailable\(side = "right"\)[\s\S]*presentation === "overlay"[\s\S]*presentation === "embedded"[\s\S]*collapsedPanels/);
  assert.match(css, /@media \(max-width: 1050px\)[\s\S]*\.file-viewer-resize-handle,[\s\S]*\.side-panel-resize-handle \{\s*display:\s*none/);
  assert.match(app, /window\.addEventListener\("resize", scheduleControlDeckPresentationReconciliation/);
  assert.match(app, /function syncSidePanelWidthForViewport\(\)[\s\S]*applySidePanelWidth\(controlDeckLayout\.panelWidths\?\.left[\s\S]*applySidePanelWidth\(controlDeckLayout\.panelWidths\?\.right/, "viewport reconciliation should preserve both durable widths instead of freezing an in-progress CSS transition");
  assert.match(app, /function updateFileViewerUi\(\)[\s\S]*scheduleControlDeckPresentationReconciliation\(\)/);
  assert.match(app, /function resetFileViewerUi\(\)[\s\S]*scheduleControlDeckPresentationReconciliation\(\)/);
  assert.match(app, /function updateTerminalSplitUi\(\)[\s\S]*scheduleControlDeckPresentationReconciliation\(\)/);
  assert.match(app, /restoreSidePanelWidthPreference\(\);\nrestoreFileViewerWidthPreference\(\);/);
});
