import assert from "node:assert/strict";
import {
  DEFAULT_STREAM_PENDING_BYTE_LIMIT,
  DEFAULT_STREAM_PENDING_ENTRY_LIMIT,
  TRANSCRIPT_STREAM_MESSAGE_UPDATE_TYPES,
  classifyTranscriptStreamEvent,
  createStreamOutputController,
  reconcileTranscriptThinkingSnapshot,
} from "../public/stream-output-controller.mjs";

function messageUpdate(type, delta = "", extra = {}) {
  return { type: "message_update", assistantMessageEvent: { type, delta, ...extra } };
}

class FakeFrames {
  next = 1;
  callbacks = new Map();
  cancelled = [];

  schedule = (callback) => {
    const handle = this.next++;
    this.callbacks.set(handle, callback);
    return handle;
  };

  cancel = (handle) => {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  };

  run(handle = this.callbacks.keys().next().value) {
    const callback = this.callbacks.get(handle);
    assert.equal(typeof callback, "function", `frame ${handle} should be pending`);
    this.callbacks.delete(handle);
    callback();
  }
}

assert.deepEqual(TRANSCRIPT_STREAM_MESSAGE_UPDATE_TYPES, [
  "thinking_start", "thinking_delta", "thinking_end",
  "text_start", "text_delta", "text_end",
  "toolcall_start", "toolcall_delta", "toolcall_end",
  "error",
]);
assert.deepEqual(classifyTranscriptStreamEvent(messageUpdate("text_delta")), {
  kind: "text", subtype: "text_delta", recognized: true, barrier: false,
});
assert.equal(classifyTranscriptStreamEvent(messageUpdate("thinking_end")).barrier, true);
assert.equal(classifyTranscriptStreamEvent(messageUpdate("toolcall_end")).kind, "tool-call");
assert.equal(classifyTranscriptStreamEvent({ type: "tool_execution_update" }).kind, "tool-execution");
assert.deepEqual(classifyTranscriptStreamEvent(messageUpdate("future_delta")), {
  kind: "unknown-message-update", subtype: "future_delta", recognized: false, barrier: false,
});
assert.equal(classifyTranscriptStreamEvent({ type: "agent_start" }), null);
assert.equal(DEFAULT_STREAM_PENDING_ENTRY_LIMIT, 128);
assert.equal(DEFAULT_STREAM_PENDING_BYTE_LIMIT, 256 * 1024);
assert.equal(
  reconcileTranscriptThinkingSnapshot("first\n\nsecond\n\nthird\n\nfourth", "first\n\nsecond\n\nthird"),
  "first\n\nsecond\n\nthird\n\nfourth",
  "a regressive final thinking snapshot must not remove an already-rendered tail",
);
assert.equal(reconcileTranscriptThinkingSnapshot("short", "shorter complete"), "shorter complete", "a longer compatible final snapshot should win");
assert.equal(reconcileTranscriptThinkingSnapshot("draft reasoning", "provider correction"), "provider correction", "divergent provider corrections must remain authoritative");

// Adjacent compatible deltas coalesce, while kind changes retain exact order.
{
  const frames = new FakeFrames();
  const calls = [];
  const controller = createStreamOutputController({
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    applyTextUpdate: (event) => calls.push(`text:${event.assistantMessageEvent.delta}`),
    applyThinkingUpdate: (event) => calls.push(`thinking:${event.assistantMessageEvent.delta}`),
    applyToolCallUpdate: (event) => calls.push(`tool-call:${event.assistantMessageEvent.delta}`),
    applyToolExecutionUpdate: (event) => calls.push(`tool-execution:${event.partialResult?.content || ""}`),
    applyFollowScroll: () => calls.push("follow"),
  });
  controller.dispatch(messageUpdate("text_delta", "A"));
  controller.dispatch(messageUpdate("text_delta", "B"));
  controller.dispatch(messageUpdate("thinking_delta", "C"));
  controller.dispatch(messageUpdate("thinking_delta", "D"));
  controller.dispatch(messageUpdate("toolcall_delta", "E", { contentIndex: 2, toolCall: { id: "tool-1" } }));
  controller.dispatch(messageUpdate("toolcall_delta", "F", { contentIndex: 2, toolCall: { id: "tool-1" } }));
  controller.dispatch({ type: "tool_execution_update", toolCallId: "tool-1", partialResult: { content: "partial" } });
  controller.dispatch({ type: "tool_execution_update", toolCallId: "tool-1", partialResult: { content: "complete" } });
  assert.equal(frames.callbacks.size, 1, "all raw updates should share one frame");
  assert.equal(controller.pendingCount(), 4, "four adjacent semantic groups should remain");
  frames.run();
  assert.deepEqual(calls, ["text:AB", "thinking:CD", "tool-call:EF", "tool-execution:complete", "follow"]);
}

// A realistic 1,000-delta burst is lossless and bounded to one sink call.
{
  const frames = new FakeFrames();
  const chunks = Array.from({ length: 1_000 }, (_, index) => `[${index}]`);
  const applied = [];
  const controller = createStreamOutputController({
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    applyTextUpdate: (event) => applied.push(event.assistantMessageEvent.delta),
  });
  for (let index = 0; index < chunks.length; index += 1) {
    controller.dispatch({ ...messageUpdate("text_delta", chunks[index]), isolationDeltaIndex: index });
  }
  assert.equal(controller.pendingCount(), 1, "adjacent non-empty text deltas should coalesce to one pending entry");
  assert.ok(controller.pendingBytes() <= controller.limits().maxPendingBytes);
  frames.run();
  assert.deepEqual(applied, [chunks.join("")], "coalescing must preserve exact output bytes and order");
}

// Alternating kinds cannot coalesce, so count overflow drains synchronously
// instead of dropping or retaining an unbounded queue.
{
  const frames = new FakeFrames();
  const calls = [];
  const overflows = [];
  const controller = createStreamOutputController({
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    maxPendingEntries: 4,
    maxPendingBytes: 10_000,
    applyTextUpdate: (event) => calls.push(`t${event.assistantMessageEvent.delta}`),
    applyThinkingUpdate: (event) => calls.push(`h${event.assistantMessageEvent.delta}`),
    onOverflow: (overflow) => overflows.push(overflow.reason),
  });
  const expected = [];
  for (let index = 0; index < 21; index += 1) {
    const text = index % 2 === 0;
    expected.push(`${text ? "t" : "h"}${index}`);
    controller.dispatch(messageUpdate(text ? "text_delta" : "thinking_delta", String(index)));
    assert.ok(controller.pendingCount() <= 4, "pending count must never exceed its configured bound");
    assert.ok(controller.pendingBytes() <= 10_000, "pending bytes must never exceed their configured bound");
  }
  controller.barrier("test-overflow-tail");
  assert.deepEqual(calls, expected);
  assert.ok(overflows.includes("entry-limit"));
  assert.equal(frames.callbacks.size, 0);
}

// A single oversize event is applied directly after the prior batch. It is not
// retained beyond the byte bound and no content is lost.
{
  const calls = [];
  const overflows = [];
  const controller = createStreamOutputController({
    maxPendingBytes: 80,
    applyTextUpdate: (event) => calls.push(event.assistantMessageEvent.delta),
    onOverflow: (overflow) => overflows.push(overflow.reason),
  });
  controller.dispatch(messageUpdate("text_delta", "x".repeat(200)));
  assert.equal(controller.pendingCount(), 0);
  assert.equal(controller.pendingBytes(), 0);
  assert.deepEqual(calls, ["x".repeat(200)]);
  assert.ok(overflows.includes("oversize-event"));
}

// Raw and semantic barriers preserve text/thinking/tool/error chronology and
// cancel the retained frame before the transition can mutate chrome.
{
  const frames = new FakeFrames();
  const calls = [];
  const controller = createStreamOutputController({
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    applyTextUpdate: (event) => calls.push(`text:${event.assistantMessageEvent.delta}`),
    applyThinkingUpdate: (event) => calls.push(`thinking:${event.assistantMessageEvent.delta}`),
    applyToolExecutionUpdate: (event) => calls.push(`tool:${event.partialResult.content}`),
    applyStreamError: () => calls.push("error"),
    applyFollowScroll: () => calls.push("follow"),
  });
  controller.dispatch(messageUpdate("text_delta", "tail"));
  controller.dispatch(messageUpdate("thinking_delta", "thought"));
  controller.dispatch({ type: "tool_execution_update", toolCallId: "t", partialResult: { content: "tool tail" } });
  const queuedHandle = frames.callbacks.keys().next().value;
  assert.equal(controller.barrier("auto_retry_start"), 3);
  assert.deepEqual(calls, ["text:tail", "thinking:thought", "tool:tool tail", "follow"]);
  assert.ok(frames.cancelled.includes(queuedHandle));
  controller.dispatch(messageUpdate("thinking_delta", "before-end"));
  controller.dispatch(messageUpdate("thinking_end"));
  assert.deepEqual(calls.slice(-3), ["thinking:before-end", "thinking:", "follow"]);
  controller.dispatch(messageUpdate("error"));
  assert.deepEqual(calls.slice(-2), ["error", "follow"], "stream errors must never be dropped by batching");
  controller.dispatch(messageUpdate("text_delta", "abort-tail"));
  const abortHandle = frames.callbacks.keys().next().value;
  assert.equal(controller.barrier("user-abort"), 1);
  assert.deepEqual(calls.slice(-2), ["text:abort-tail", "follow"], "user abort must synchronously preserve a pending text tail");
  assert.ok(frames.cancelled.includes(abortHandle));
}

// Hidden-frame delay preserves the tail; a stale owner is rejected both at
// dispatch and if ownership changes before the delayed frame runs.
{
  const frames = new FakeFrames();
  const calls = [];
  let currentOwner = "tab-a:1";
  const controller = createStreamOutputController({
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    isOwnerCurrent: (owner) => owner === currentOwner,
    applyTextUpdate: (event) => calls.push(event.assistantMessageEvent.delta),
    onStaleOwner: (_event, owner) => calls.push(`stale:${owner}`),
  });
  controller.dispatch(messageUpdate("text_delta", "hidden-tail"), { owner: currentOwner });
  assert.deepEqual(calls, [], "a throttled/hidden frame may remain pending without losing output");
  controller.barrier("visibility-barrier");
  assert.deepEqual(calls, ["hidden-tail"]);
  controller.dispatch(messageUpdate("text_delta", "stale-later"), { owner: currentOwner });
  currentOwner = "tab-a:2";
  frames.run();
  assert.deepEqual(calls, ["hidden-tail", "stale:tab-a:1"]);
  assert.equal(controller.dispatch(messageUpdate("text_delta", "stale-now"), { owner: "tab-b:1" }), true);
  assert.deepEqual(calls, ["hidden-tail", "stale:tab-a:1", "stale:tab-b:1"]);
}

// Unknown transcript-shaped events remain isolated but reach the fallback with
// bounded diagnostic metadata; indexed coalesced input reports receipt/apply.
{
  const frames = new FakeFrames();
  const unknown = [];
  const diagnostics = [];
  const controller = createStreamOutputController({
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    applyTextUpdate: () => {},
    onUnknownStreamEvent: (event, classification, owner) => unknown.push({ event, classification, owner }),
    onDiagnostic: (record) => diagnostics.push(record),
  });
  controller.dispatch({ ...messageUpdate("text_delta", "A"), isolationDeltaIndex: 0 }, { owner: "tab:1" });
  controller.dispatch({ ...messageUpdate("text_delta", "B"), isolationDeltaIndex: 1 }, { owner: "tab:1" });
  controller.dispatch(messageUpdate("future_delta", "preserve me"), { owner: "tab:1" });
  frames.run();
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].event.assistantMessageEvent.delta, "preserve me");
  assert.equal(unknown[0].classification.subtype, "future_delta");
  const receipts = diagnostics.filter((record) => record.type === "receipt");
  assert.deepEqual(receipts.slice(0, 2).map((record) => record.index), [0, 1]);
  const textApply = diagnostics.find((record) => record.type === "apply" && record.kind === "text");
  assert.equal(textApply.sourceCount, 2);
  assert.deepEqual(textApply.sourceIndexes, [0, 1]);
}

for (const mode of ["normal", "compact-v1"]) {
  const frames = new FakeFrames();
  const seen = [];
  const controller = createStreamOutputController({
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    applyTextUpdate: (event) => seen.push(`${mode}:${event.assistantMessageEvent.delta}`),
    applyFollowScroll: () => seen.push(`${mode}:follow`),
  });
  controller.dispatch(messageUpdate("text_delta", "same"));
  controller.dispatch(messageUpdate("text_delta", " output"));
  frames.run();
  assert.deepEqual(seen, [`${mode}:same output`, `${mode}:follow`], `${mode} should use the same coalescing and ordering contract`);
}

assert.throws(() => createStreamOutputController({ maxPendingEntries: 0 }), /positive safe integer/);
assert.throws(() => createStreamOutputController({ maxPendingBytes: -1 }), /positive safe integer/);

console.log("stream-output-controller.test.mjs passed");
