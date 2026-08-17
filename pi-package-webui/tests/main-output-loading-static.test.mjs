import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, css, serviceWorker, readme, development] = await Promise.all([
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "service-worker.js"), "utf8"),
  readFile(join(root, "README.md"), "utf8"),
  readFile(join(root, "DEVELOPMENT.md"), "utf8"),
]);

function sourceBetween(startMarker, endMarker, label) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${label} should remain an inspectable standalone block`);
  return app.slice(start, end);
}

assert.match(
  html,
  /id="mainOutputLoading" class="main-output-loading" role="status" aria-live="polite" aria-atomic="true" aria-controls="chat" hidden>[\s\S]*?main-output-loading-spinner[\s\S]*?Loading agent output…[\s\S]*?<div id="chat" class="chat" aria-live="polite" aria-busy="false">/,
  "the main output should own an inline, accessible loading status before the transcript",
);
assert.doesNotMatch(html, /<dialog[^>]+id="mainOutputLoading"/, "loading feedback must not use a popup dialog");
assert.match(app, /mainOutputLoading: \$\("#mainOutputLoading"\)/, "the browser should bind the inline status element");
assert.match(app, /const mainOutputLoadingRequests = new Set\(\);[\s\S]*MAIN_OUTPUT_LOADING_REVEAL_DELAY_MS = 120/, "loading requests should have bounded concurrent ownership and a short anti-flicker delay");

const loadingHelpers = sourceBetween("function mainOutputLoadingRequestIsCurrent(", "\nasync function refreshMessages(", "main output loading helpers");
assert.match(loadingHelpers, /isCurrentTabContext\(request\.tabContext\)/, "only the active tab generation should control visible loading feedback");
assert.match(loadingHelpers, /setAttribute\("aria-busy", active \? "true" : "false"\)/, "the transcript should expose request state immediately to assistive technology");
assert.match(loadingHelpers, /setTimeout\([\s\S]*MAIN_OUTPUT_LOADING_REVEAL_DELAY_MS/, "visible animation should be delayed to avoid flashing on fast requests");
assert.match(loadingHelpers, /mainOutputLoadingRequests\.add\(request\)/, "overlapping requests should receive independent tokens");
assert.match(loadingHelpers, /mainOutputLoadingRequests\.delete\(request\)/, "settled requests should release only their own token");
assert.doesNotMatch(loadingHelpers, /showModal|alert\(|confirm\(/, "main output loading must remain non-modal");

const refreshMessages = sourceBetween("async function refreshMessages(", "\nasync function refreshModels(", "refreshMessages");
assert.match(refreshMessages, /const loadingRequest = beginMainOutputLoading\(tabContext\);\s*try \{/, "message fetches should begin loading before awaiting transcript data");
assert.match(refreshMessages, /finally \{\s*finishMainOutputLoading\(loadingRequest\);\s*\}/, "success, failure, and stale responses should all clear their request token");
assert.match(app, /activeTabId = nextTabId;\s*renderMainOutputLoading\(\);/, "tab changes should immediately reconcile stale and current request visibility");

assert.match(css, /\.main-output-loading\[hidden\] \{ display: none !important; \}/, "hidden loading feedback should not consume layout space");
assert.match(css, /\.main-output-loading \{[\s\S]*?pointer-events: none;[\s\S]*?font-size: var\(--text-xs\)/, "the inline status should remain compact and non-blocking");
assert.match(css, /\.main-output-loading-spinner \{[\s\S]*?animation: main-output-loading-spin 780ms linear infinite/, "the status should include a visible spinner animation");
assert.match(css, /@keyframes main-output-loading-spin/, "the spinner should have a local animation contract");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 1ms !important;[\s\S]*?animation-iteration-count: 1 !important;/, "the existing reduced-motion policy should stop repeated spinner motion");
assert.match(css, /body\.terminal-tabs-left \.main-output-loading,[\s\S]*?body\.terminal-tabs-left \.chat \{ grid-row: 4; \}/, "sidebar tab placement should keep the status inside the transcript grid row");
assert.match(css, /body\.subagent-terminal-active \.main-output-loading,/, "main-output loading feedback should stay hidden in the dedicated subagent view");

assert.match(html, /styles\.css\?v=126/, "the stylesheet cache query should advance");
assert.match(html, /app\.js\?v=148/, "the app cache query should advance");
assert.match(serviceWorker, /const CACHE_NAME = "pi-webui-pwa-v112"/, "the PWA cache identity should advance with browser assets");
assert.match(readme, /Loading agent output/, "user documentation should describe the visible loading feedback");
assert.match(development, /main output loading/i, "developer documentation should preserve the request-ownership contract");

console.log("main output loading static tests passed");
