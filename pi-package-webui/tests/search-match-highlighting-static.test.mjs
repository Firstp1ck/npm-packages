import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css, html] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "index.html"), "utf8"),
]);

assert.match(html, /id="fileViewerSearchOverlay"[^>]*aria-hidden="true"[^>]*hidden/, "source search should expose a non-interactive highlight overlay");
assert.match(app, /function renderFileViewerSourceSearchHighlights\(\)[\s\S]*fileViewerSearchMatches\.forEach[\s\S]*make\("mark", `file-viewer-search-match/, "source search should render every match into its synchronized overlay");
assert.match(app, /function renderFileViewerSearchHighlights\(\)[\s\S]*new HighlightConstructor\(\.\.\.ranges\)[\s\S]*file-viewer-search-match[\s\S]*file-viewer-search-current/, "Preview and Changes should use exact all-match and current-match highlights");
assert.match(app, /fileViewerEditor\?\.addEventListener\("scroll", syncFileViewerSearchOverlayScroll\)/, "source highlights should track editor scrolling");

assert.match(app, /function chatSearchRoot\(\)[\s\S]*subagentTerminalTranscript[\s\S]*elements\.chat/, "output search should select the active main or subagent transcript");
assert.match(app, /function collectChatSearchMatches\(query\)[\s\S]*while \(matches\.length < CHAT_SEARCH_MATCH_LIMIT\)[\s\S]*matches\.push\(\{ bubble, start, end:/, "output search should collect every occurrence instead of one result per message");
assert.match(app, /function renderChatSearchHighlights\(\)[\s\S]*chat-search-match[\s\S]*new HighlightConstructor\(\.\.\.ranges\)[\s\S]*chat-search-current/, "output search should render exact all-match and current-match highlights");
assert.match(app, /new MutationObserver\([\s\S]*runChatSearch\(\{ navigate: false \}\)[\s\S]*characterData: true/, "live stream refreshes should reapply open search highlights");
assert.doesNotMatch(css, /body\.subagent-terminal-active \.chat-search-bar/, "the search bar should remain visible in a subagent output view");

assert.match(css, /::highlight\(file-viewer-search-match\),\s*::highlight\(chat-search-match\)/, "file and output searches should share an all-match highlight style");
assert.match(css, /::highlight\(file-viewer-search-current\),\s*::highlight\(chat-search-current\)/, "file and output searches should share a distinct current-match style");

console.log("search match highlighting static tests passed");
