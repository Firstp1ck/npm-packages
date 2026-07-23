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

assert.match(
  html,
  /id="sidePanelContextMenu"[^>]*role="menu"[^>]*aria-label="Choose visible side panel sections"[^>]*hidden/,
  "the page should provide an initially hidden, labelled side-panel context menu",
);
assert.match(
  app,
  /const SIDE_PANEL_SECTION_VISIBILITY_STORAGE_KEY = "pi-webui-side-panel-sections-hidden"/,
  "hidden section IDs should use their own browser storage key",
);
assert.match(
  app,
  /function persistSidePanelSectionVisibility\(\)[\s\S]*section\.hidden[\s\S]*localStorage\.setItem\(SIDE_PANEL_SECTION_VISIBILITY_STORAGE_KEY, JSON\.stringify\(hidden\)\)/,
  "section visibility should persist independently from accordion collapse state",
);
assert.match(
  app,
  /function restoreSidePanelSectionVisibility\(\)[\s\S]*readStoredSidePanelSectionHiddenIds\(\)[\s\S]*setSidePanelSectionVisible\(record, !hiddenIds\.has\(record\.id\), \{ persist: false \}\)/,
  "stored hidden section IDs should be restored without rewriting storage",
);
assert.match(
  app,
  /function showSidePanelContextMenu\(event\)[\s\S]*sidePanelSectionRecords\(\)\.map[\s\S]*role", "menuitemcheckbox"[\s\S]*aria-checked[\s\S]*setSidePanelSectionVisible\(record, nextVisible\)/,
  "the context menu should dynamically include every section as a checkable visibility item",
);
assert.match(
  app,
  /function setSidePanelSectionVisible\(record, visible[\s\S]*visible && record\.id === "git"[\s\S]*renderGitPanel\(\)[\s\S]*ensureGitPanelRepositoriesDiscovered/,
  "re-showing an expanded Git section should immediately refresh its deferred content",
);
assert.match(
  app,
  /const focusTarget = trigger\?\.isConnected[\s\S]*elements\.toggleSidePanelButton[\s\S]*focusTarget\.focus/,
  "closing the menu should return focus to its trigger or the persistent panel toggle",
);
assert.match(
  app,
  /side-panel-context-menu-label", "Show sections"[\s\S]*role", "presentation"[\s\S]*aria-hidden", "true"/,
  "the visual menu heading should not violate the menu's accessibility structure",
);
assert.match(
  app,
  /function bindSidePanelContextMenu\(\)[\s\S]*addEventListener\("contextmenu", showSidePanelContextMenu\)[\s\S]*event\.key !== "ContextMenu"[\s\S]*event\.shiftKey && event\.key === "F10"/,
  "the menu should support pointer and standard keyboard context-menu activation",
);
assert.match(
  app,
  /restoreSidePanelSectionVisibility\(\);\s*restoreSidePanelSectionState\(\);/,
  "visibility should restore alongside the existing collapse state during startup",
);
assert.match(
  app,
  /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"[\s\S]*elements\.sidePanelContextMenu\?\.addEventListener\("keydown"[\s\S]*event\.key === "Home" \|\| event\.key === "End"/,
  "context-menu items should be keyboard navigable",
);
assert.match(
  css,
  /\.side-panel-context-menu[\s\S]*max-height:[^;]+[\s\S]*overflow-y: auto[\s\S]*\.side-panel-context-menu-item\[aria-checked="true"\]::before/,
  "the section menu should remain viewport-bounded and visibly mark selected sections",
);

console.log("side-panel-context-menu-static.test.mjs passed");
