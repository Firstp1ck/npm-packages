import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { groupConsecutiveThinkingMessages } from "../public/transcript-renderer.mjs";

function thinking(content, timestamp) {
  return { role: "thinking", title: "thinking", content, thinking: content, timestamp };
}

const first = thinking("inspect the renderer", "2026-08-23T13:00:00Z");
assert.equal(groupConsecutiveThinkingMessages([first])[0], first, "a single thinking message should retain its identity");

const grouped = groupConsecutiveThinkingMessages([
  first,
  thinking("confirm the display order", "2026-08-23T13:00:01Z"),
  thinking("verify the final state", "2026-08-23T13:00:02Z"),
]);
assert.equal(grouped.length, 1, "adjacent thinking messages should render as one transcript message");
assert.equal(grouped[0].thinking, "inspect the renderer\n\nconfirm the display order\n\nverify the final state", "grouped thinking should remain chronological and readable");
assert.equal(grouped[0].content, grouped[0].thinking, "copy and rendering paths should receive the same grouped text");
assert.equal(grouped[0].timestamp, first.timestamp, "the grouped message should keep the first block's stable metadata");
assert.equal(grouped[0].thinkingSegmentCount, 3, "the aggregate should retain its source segment count");

const toolCall = { role: "toolCall", toolName: "read", content: {} };
const separated = groupConsecutiveThinkingMessages([
  thinking("before the tool"),
  toolCall,
  thinking("after the tool"),
  thinking("still after the tool"),
]);
assert.deepEqual(separated.map((message) => message.role), ["thinking", "toolCall", "thinking"], "non-thinking transcript messages should remain hard grouping boundaries");
assert.equal(separated[0].thinking, "before the tool");
assert.equal(separated[2].thinking, "after the tool\n\nstill after the tool");

const nonTextThinking = { role: "thinking", content: { provider: "opaque" } };
assert.deepEqual(
  groupConsecutiveThinkingMessages([thinking("before"), nonTextThinking, thinking("after")]),
  [thinking("before"), nonTextThinking, thinking("after")],
  "non-text thinking payloads should not be stringified or merged",
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
assert.match(app, /import \{ createTranscriptRenderer, groupConsecutiveThinkingMessages \} from "\.\/transcript-renderer\.mjs";/, "the browser should import the grouping helper from the transcript renderer");
assert.match(app, /function assistantDisplayMessages\(message\)[\s\S]*?const displayMessages = assistantDisplayMessagesWithoutFailure[\s\S]*?return groupConsecutiveThinkingMessages\(failure \? \[\.\.\.displayMessages, failure\] : displayMessages\);/, "assistant display projection should group adjacent thinking before creating transcript cards");

console.log("thinking-block-grouping.test.mjs passed");
