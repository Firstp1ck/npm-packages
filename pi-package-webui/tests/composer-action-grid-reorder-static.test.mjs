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

assert.match(html, /id="newSessionButton"[^>]*data-composer-action-id="new"[^>]*data-composer-action-span="1"/, "New should occupy one composer grid cell");
assert.match(html, /id="compactButton"[^>]*data-composer-action-id="compact"[^>]*data-composer-action-span="2"/, "Compact should occupy two composer grid cells");
assert.match(html, /id="sendButton"[^>]*data-composer-action-id="send"[^>]*data-composer-action-span="2"/, "Send should occupy two composer grid cells");
for (const id of ["git", "publish", "native-command", "options", "app-runner", "btw"]) {
  assert.match(html, new RegExp(`data-composer-action-id="${id}"[^>]*data-composer-action-span="1"`), `${id} should occupy one composer grid cell`);
}
assert.match(html, /id="composerActionOrderStatus"[^>]*role="status"[^>]*aria-live="polite"/, "reordering should have a polite live-region announcement");

assert.match(
  css,
  /body\.composer-action-grid-enabled \.composer-row\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*repeat\(auto-fill, minmax\(2\.9rem, 1fr\)\)[\s\S]*grid-auto-flow:\s*dense/,
  "the desktop composer should use a dense responsive grid",
);
assert.match(css, /\[data-composer-action-span="2"\]\s*\{\s*grid-column:\s*span 2;/, "wide actions should span exactly two cells");
assert.match(css, /composer-action-dragging[\s\S]*cursor:\s*grabbing[\s\S]*composer-action-drag-before[\s\S]*composer-action-drag-after/, "dragging and drop targets should have visible affordances");

assert.match(app, /const COMPOSER_ACTION_ORDER_STORAGE_KEY = "pi-webui-composer-action-order-v1";[\s\S]*const COMPOSER_ACTION_POINTER_DRAG_THRESHOLD_PX = 6;/, "composer order should use versioned storage and a bounded drag threshold");
assert.match(app, /function readStoredComposerActionOrder\(\)[\s\S]*localStorage\.getItem\(COMPOSER_ACTION_ORDER_STORAGE_KEY\)[\s\S]*new Set[\s\S]*function persistComposerActionOrder\(\)[\s\S]*localStorage\.setItem\(COMPOSER_ACTION_ORDER_STORAGE_KEY/, "stored order should be validated, deduplicated, and persisted");
assert.match(app, /function applyComposerActionOrder\(orderIds\)[\s\S]*knownIds[\s\S]*completeOrder[\s\S]*--composer-action-order/, "new actions should append safely when restoring an older order");
assert.match(app, /function composerActionRootFromPoint\(clientX, clientY\)[\s\S]*elementFromPoint[\s\S]*function updateComposerActionPointerDrag\(event\)[\s\S]*Math\.hypot[\s\S]*COMPOSER_ACTION_POINTER_DRAG_THRESHOLD_PX[\s\S]*moveComposerActionRelative/, "pointer dragging should activate after the threshold and reorder against the pointed grid action");
assert.match(app, /function initializeComposerActionOrdering\(\)[\s\S]*aria-keyshortcuts[\s\S]*ArrowLeft[\s\S]*ArrowRight[\s\S]*moveComposerActionByOffset[\s\S]*pointerdown/, "keyboard and pointer reordering should be bound together");
assert.match(app, /event\.key === COMPOSER_ACTION_ORDER_STORAGE_KEY\) restoreComposerActionOrder\(\)/, "other tabs should apply persisted composer order changes");
assert.match(app, /initializeComposerActionOrdering\(\);[\s\S]*restoreSidePanelSectionOrder\(\);/, "composer ordering should initialize during guarded app startup");

assert.match(html, /styles\.css\?v=95/, "changed composer styles should advance the stylesheet revision");
assert.match(html, /app\.js\?v=106/, "changed composer behavior should advance the app revision");
assert.match(serviceWorker, /const CACHE_NAME = "pi-webui-pwa-v64"/, "changed browser assets should advance the PWA cache identity");

console.log("composer-action-grid-reorder-static.test.mjs passed");
