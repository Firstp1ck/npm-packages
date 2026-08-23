import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { groupConsecutiveThinkingItems, groupConsecutiveThinkingMessages } from "../public/transcript-renderer.mjs";

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

function assistantItem(index, content) {
  return {
    message: { role: "assistant", timestamp: `2026-08-23T13:00:0${index}Z`, content: [{ type: "thinking", thinking: content }] },
    messageIndex: index,
    order: index,
  };
}

const separateAssistantMessages = [
  assistantItem(1, "first assistant message"),
  assistantItem(2, "second assistant message"),
  assistantItem(3, "third assistant message"),
];
const groupedItems = groupConsecutiveThinkingItems(separateAssistantMessages, (item) => {
  const part = item.message.content[0];
  return thinking(part.thinking, item.message.timestamp);
});
assert.equal(groupedItems.length, 1, "thinking-only assistant messages should collapse after transcript ordering");
assert.equal(groupedItems[0].message.thinking, "first assistant message\n\nsecond assistant message\n\nthird assistant message");
assert.equal(groupedItems[0].thinkingGroupSourceCount, 3, "the transcript aggregate should retain its source item count");

const finalOutputItem = { message: { role: "assistant", content: [{ type: "text", text: "answer" }] }, messageIndex: 4, order: 4 };
const itemBoundary = groupConsecutiveThinkingItems(
  [assistantItem(1, "before"), finalOutputItem, assistantItem(2, "after")],
  (item) => item.message.content[0]?.type === "thinking" ? thinking(item.message.content[0].thinking) : null,
);
assert.deepEqual(itemBoundary.map((item) => item.message.role), ["assistant", "assistant", "assistant"], "a rendered final-output item should keep separate thinking runs apart");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
assert.match(app, /import \{ createTranscriptRenderer, groupConsecutiveThinkingItems, groupConsecutiveThinkingMessages \} from "\.\/transcript-renderer\.mjs";/, "the browser should import both grouping helpers from the transcript renderer");
assert.match(app, /function assistantDisplayMessages\(message\)[\s\S]*?const displayMessages = assistantDisplayMessagesWithoutFailure[\s\S]*?return groupConsecutiveThinkingMessages\(failure \? \[\.\.\.displayMessages, failure\] : displayMessages\);/, "assistant display projection should group adjacent thinking inside one assistant message");
assert.match(app, /function transcriptItemThinkingMessage\(item\)[\s\S]*?assistantDisplayMessages\(message\)[\s\S]*?displayMessages\.length !== 1[\s\S]*?role !== "thinking"/, "only transcript items that render as one thinking card should be eligible for cross-message grouping");
assert.match(app, /function groupConsecutiveThinkingTranscriptItems\(items\)[\s\S]*?groupConsecutiveThinkingItems\(items, transcriptItemThinkingMessage\)[\s\S]*?transcriptKey: `thinking-group:\$\{sourceKey\}`/, "cross-message groups should receive one stable transcript identity");
assert.match(app, /const groupedThinking = compactOutputActive\(\) \? ordered : groupConsecutiveThinkingTranscriptItems\(ordered\);[\s\S]*?groupWorkflowStatusTranscriptItems\(groupedThinking, toolResults\)/, "normal transcripts should group thinking after complete chronological ordering");

console.log("thinking-block-grouping.test.mjs passed");
