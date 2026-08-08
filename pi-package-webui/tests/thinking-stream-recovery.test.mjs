import assert from "node:assert/strict";
import { ThinkingStreamRecovery, reconcileThinkingSnapshot } from "../lib/thinking-stream-recovery.mjs";

assert.equal(reconcileThinkingSnapshot("complete streamed thinking", "complete streamed"), "complete streamed thinking", "a regressive prefix snapshot must not cut off streamed thinking");
assert.equal(reconcileThinkingSnapshot("complete streamed", "complete streamed thinking"), "complete streamed thinking", "a longer cumulative snapshot should win");
assert.equal(reconcileThinkingSnapshot("draft reasoning", "provider correction"), "provider correction", "divergent authoritative content should still win");

const recovery = new ThinkingStreamRecovery();
recovery.ingest({ type: "message_start", message: { role: "assistant", content: [] } });
recovery.ingest({
  type: "message_update",
  assistantMessageEvent: {
    type: "thinking_delta",
    contentIndex: 0,
    delta: "complete streamed ",
    partial: { role: "assistant", content: [{ type: "thinking", thinking: "complete streamed " }] },
  },
});
recovery.ingest({
  type: "message_update",
  assistantMessageEvent: {
    type: "thinking_delta",
    contentIndex: 0,
    delta: "thinking",
    partial: { role: "assistant", content: [{ type: "thinking", thinking: "complete streamed thinking" }] },
  },
});

const recoveredThinkingEnd = recovery.ingest({
  type: "message_update",
  assistantMessageEvent: {
    type: "thinking_end",
    contentIndex: 0,
    content: "complete streamed",
    partial: { role: "assistant", content: [{ type: "thinking", thinking: "complete streamed" }] },
  },
});
assert.equal(recoveredThinkingEnd.assistantMessageEvent.content, "complete streamed thinking", "thinking_end should expose the complete compatible stream to normal and compact clients");
assert.equal(recoveredThinkingEnd.assistantMessageEvent.partial.content[0].thinking, "complete streamed thinking");

const recoveredMessageEnd = recovery.ingest({
  type: "message_end",
  message: {
    role: "assistant",
    timestamp: 1700000000000,
    content: [
      { type: "thinking", thinking: "complete streamed" },
      { type: "text", text: "final answer" },
    ],
  },
});
assert.equal(recoveredMessageEnd.message.content[0].thinking, "complete streamed thinking", "message settlement should retain the complete streamed thinking block");

const fetched = recovery.applyToMessages([
  { role: "user", timestamp: 1699999999999, content: "prompt" },
  {
    role: "assistant",
    timestamp: 1700000000000,
    content: [
      { type: "thinking", thinking: "complete streamed" },
      { type: "text", text: "final answer" },
    ],
  },
]);
assert.equal(fetched[1].content[0].thinking, "complete streamed thinking", "later get_messages responses should not erase recovered thinking in the main transcript");

const correction = new ThinkingStreamRecovery();
correction.ingest({ type: "message_start", message: { role: "assistant" } });
correction.ingest({
  type: "message_update",
  assistantMessageEvent: {
    type: "thinking_delta",
    contentIndex: 0,
    delta: "draft reasoning",
    partial: { role: "assistant", content: [{ type: "thinking", thinking: "draft reasoning" }] },
  },
});
const correctedEnd = correction.ingest({
  type: "message_end",
  message: {
    role: "assistant",
    timestamp: 1700000000001,
    content: [{ type: "thinking", thinking: "provider correction" }],
  },
});
assert.equal(correctedEnd.message.content[0].thinking, "provider correction", "recovery must not overwrite a divergent provider correction");

console.log("thinking-stream-recovery.test.mjs passed");
