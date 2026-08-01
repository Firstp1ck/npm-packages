import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
const TAB_COUNT = 10;
const MESSAGES_PER_TAB = 30;
const TOOL_OUTPUT_BYTES = 128 * 1024;
const DEFER_NO_GO_BYTES = 32 * 1024 * 1024;

// This matches the current cache's retained shape: a complete messages array
// per open tab. Use unique tool output per message so JavaScript cannot hide
// the multi-tab payload behind one shared string reference.
const cache = new Map();
const heapBefore = process.memoryUsage().heapUsed;
for (let tabIndex = 0; tabIndex < TAB_COUNT; tabIndex += 1) {
  const messages = Array.from({ length: MESSAGES_PER_TAB }, (_, messageIndex) => ({
    role: "toolExecution",
    toolName: "fixture-tool",
    result: `${tabIndex}:${messageIndex}:${"x".repeat(TOOL_OUTPUT_BYTES - 32)}`,
  }));
  cache.set(`tab-${tabIndex}`, { messages, sessionKey: `tab-${tabIndex}|fixture-session` });
}
const retainedBytes = Buffer.byteLength(JSON.stringify([...cache.values()].flatMap((entry) => entry.messages)));
const heapDelta = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

assert.match(app, /const tabMessagesCache = new Map\(\)/, "the characterization must cover the real per-tab cache");
assert.match(app, /function cacheMessagesForTab[\s\S]*?tabMessagesCache\.set\(tabId, \{ messages, sessionKey: resolvedSessionKey \}\)/, "the current cache retains complete message arrays by tab");
assert.ok(retainedBytes >= DEFER_NO_GO_BYTES, "the 10-tab long-tool fixture must cross the documented defer/no-go threshold");
assert.equal(cache.size, TAB_COUNT);

console.log(`mobile transcript characterization: ${TAB_COUNT} tabs × ${MESSAGES_PER_TAB} long tool messages retained ${Math.round(retainedBytes / (1024 * 1024))} MiB serialized; heap delta ${Math.round(heapDelta / (1024 * 1024))} MiB. Defer in-memory bounding until it preserves every authoritative final answer and transcript; ${DEFER_NO_GO_BYTES / (1024 * 1024)} MiB retained serialized payload is the follow-up threshold.`);
