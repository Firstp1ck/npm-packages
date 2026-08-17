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

const resizeStart = app.indexOf("function resizePromptInput()");
const resizeEnd = app.indexOf("\nfunction updateComposerModeButtons", resizeStart);
assert.ok(resizeStart >= 0 && resizeEnd > resizeStart, "resizePromptInput should remain inspectable");
const resizePromptInput = app.slice(resizeStart, resizeEnd);

assert.match(css, /#promptInput \{[\s\S]*max-height: min\(25vh, 10rem\);[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior-y: contain;/, "the prompt should retain bounded growth with native vertical scrolling as its CSS fallback");
assert.match(resizePromptInput, /input\.style\.height = "auto";[\s\S]*Math\.min\(input\.scrollHeight, maxHeight\)[\s\S]*input\.style\.overflowY = "auto";/, "every auto-resize pass should preserve vertical scrolling after the height cap is reached or growth stalls");
assert.doesNotMatch(resizePromptInput, /overflowY[^\n]+"hidden"/, "auto-resizing must not disable the prompt's vertical overflow fallback");
assert.match(html, /styles\.css\?v=130/, "the page should request the scroll-enabled stylesheet revision");
assert.match(html, /app\.js\?v=151/, "the page should request the scroll-enabled app revision");
assert.match(serviceWorker, /const CACHE_NAME = "pi-webui-pwa-v116"/, "the PWA cache identity should advance with the prompt scroll assets");

console.log("prompt-input-vertical-scroll-static.test.mjs passed");
