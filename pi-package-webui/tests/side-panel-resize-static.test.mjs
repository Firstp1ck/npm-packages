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
  assert.match(html, /id="sidePanelResizeHandle"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*aria-label="Resize Control Deck width"[^>]*tabindex="0"/);
  assert.match(css, /--side-panel-width:\s*384px/);
  assert.match(css, /\.side-panel-resize-handle[\s\S]*cursor:\s*col-resize[\s\S]*touch-action:\s*none/);
});

test("desktop layouts and Control Deck content follow the selected width", () => {
  assert.match(css, /\.layout \{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(20rem, var\(--side-panel-width\)\)/);
  assert.match(css, /body\.file-viewer-open \.layout \{[\s\S]*minmax\(24rem, var\(--file-viewer-width\)\) minmax\(20rem, var\(--side-panel-width\)\)/);
  assert.match(css, /body\.terminal-split-open\.file-viewer-open \.layout \{[\s\S]*minmax\(20rem, var\(--side-panel-width\)\)/);
  assert.match(css, /\.side-panel \{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0/);
});

test("Control Deck width is clamped, user-persisted, pointer-resizable, and keyboard-resizable", () => {
  assert.match(app, /const SIDE_PANEL_WIDTH_STORAGE_KEY = "pi-webui-side-panel-width"/);
  assert.match(app, /const SIDE_PANEL_WIDTH_MAX_PX = 4096/);
  assert.match(app, /width >= SIDE_PANEL_WIDTH_MIN_PX && width <= SIDE_PANEL_WIDTH_MAX_PX/);
  assert.match(app, /function persistSidePanelWidth\(width\)[\s\S]*\/api\/interface-preferences[\s\S]*sidePanelWidth: rounded[\s\S]*scoped: false/);
  assert.match(app, /async function restoreSidePanelWidthPreference\(\)[\s\S]*\/api\/interface-preferences[\s\S]*response\.data\?\.preferences\?\.sidePanelWidth[\s\S]*cacheSidePanelWidth/);
  assert.match(server, /url\.pathname === "\/api\/interface-preferences" && req\.method === "GET"/);
  assert.match(server, /url\.pathname === "\/api\/interface-preferences" && req\.method === "PUT"/);
  assert.match(app, /function sidePanelMaxWidth\(\)[\s\S]*fileViewerVisible[\s\S]*splitOpen[\s\S]*primaryMinWidth[\s\S]*available/);
  assert.match(app, /function applySidePanelWidth\(width, \{ persist = false \} = \{\}\)[\s\S]*--side-panel-width[\s\S]*persistSidePanelWidth/);
  assert.match(app, /function beginSidePanelResize\(event\)[\s\S]*setPointerCapture[\s\S]*pointermove[\s\S]*pointercancel/);
  assert.match(app, /function updateSidePanelResize\(event\)[\s\S]*state\.startWidth \+ \(state\.startX - event\.clientX\)/);
  assert.match(app, /function handleSidePanelResizeKeydown\(event\)[\s\S]*ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/);
  assert.match(app, /elements\.sidePanelResizeHandle\?\.addEventListener\("pointerdown", beginSidePanelResize\);\nelements\.sidePanelResizeHandle\?\.addEventListener\("keydown", handleSidePanelResizeKeydown\);/);
});

test("Control Deck resizing disables itself in overlay layouts and responds to viewport changes", () => {
  assert.match(app, /const resizeAvailable = !isSidePanelOverlayView\(\) && !document\.body\.classList\.contains\("side-panel-collapsed"\)/);
  assert.match(css, /@media \(max-width: 1050px\)[\s\S]*\.file-viewer-resize-handle,[\s\S]*\.side-panel-resize-handle \{\s*display:\s*none/);
  assert.match(app, /window\.addEventListener\("resize", syncResizablePanelWidthsForViewport/);
  assert.match(app, /function syncSidePanelWidthForViewport\(\)[\s\S]*applySidePanelWidth\(readStoredSidePanelWidth\(\) \|\| currentSidePanelWidth\(\)\)/, "hard-reset startup reconciliation should preserve the durable width instead of freezing an in-progress CSS transition");
  assert.match(app, /function updateFileViewerUi\(\)[\s\S]*requestAnimationFrame\(syncResizablePanelWidthsForViewport\)/);
  assert.match(app, /function closeFileViewer\(\)[\s\S]*requestAnimationFrame\(syncResizablePanelWidthsForViewport\)/);
  assert.match(app, /function updateTerminalSplitUi\(\)[\s\S]*requestAnimationFrame\(syncResizablePanelWidthsForViewport\)/);
  assert.match(app, /restoreSidePanelWidthPreference\(\);\nrestoreFileViewerWidthPreference\(\);/);
});
