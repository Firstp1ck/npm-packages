import assert from "node:assert/strict";
import {
  TRANSCRIPT_STREAM_MESSAGE_UPDATE_TYPES,
  classifyTranscriptStreamEvent,
  createStreamOutputController,
} from "../public/stream-output-controller.mjs";

function messageUpdate(type, delta = "") {
  return { type: "message_update", assistantMessageEvent: { type, delta } };
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

const frames = new FakeFrames();
const calls = [];
let currentOwner = "tab-a:1";
const controller = createStreamOutputController({
  scheduleFrame: frames.schedule,
  cancelFrame: frames.cancel,
  isOwnerCurrent: (owner) => owner === currentOwner,
  applyTextUpdate: (event) => calls.push(`text:${event.assistantMessageEvent.delta}`),
  applyThinkingUpdate: (event) => calls.push(`thinking:${event.assistantMessageEvent.delta}`),
  applyToolCallUpdate: (event) => calls.push(`tool-call:${event.assistantMessageEvent.delta}`),
  applyToolExecutionUpdate: (event) => calls.push(`tool-execution:${event.partialResult?.content || ""}`),
  applyStreamError: () => calls.push("stream-error"),
  applyFollowScroll: () => calls.push("follow"),
  onUnknownStreamEvent: (_event, classification) => calls.push(`unknown:${classification.subtype}`),
  onStaleOwner: (_event, owner) => calls.push(`stale:${owner}`),
});

assert.equal(controller.dispatch({ type: "agent_start" }, { owner: currentOwner }), false, "semantic events must remain available to lifecycle dispatch");
assert.equal(controller.dispatch(messageUpdate("text_delta", "A"), { owner: currentOwner }), true);
assert.equal(controller.dispatch(messageUpdate("thinking_delta", "B"), { owner: currentOwner }), true);
assert.equal(controller.dispatch(messageUpdate("toolcall_delta", "C"), { owner: currentOwner }), true);
assert.equal(controller.dispatch({ type: "tool_execution_update", partialResult: { content: "D" } }, { owner: currentOwner }), true);
assert.equal(frames.callbacks.size, 1, "all raw updates should share one scheduled frame");
assert.equal(controller.pendingCount(), 4);
frames.run();
assert.deepEqual(calls, ["text:A", "thinking:B", "tool-call:C", "tool-execution:D", "follow"], "queued updates must retain server order and follow once per frame");
assert.equal(controller.pendingCount(), 0);
assert.equal(controller.hasScheduledFrame(), false);

calls.length = 0;
controller.dispatch(messageUpdate("text_delta", "queued"), { owner: currentOwner });
const queuedHandle = frames.callbacks.keys().next().value;
assert.equal(controller.barrier(), 1, "a semantic barrier should flush pending transcript output synchronously");
assert.deepEqual(calls, ["text:queued", "follow"]);
assert.ok(frames.cancelled.includes(queuedHandle), "barrier flush should cancel the retained frame");
assert.equal(frames.callbacks.size, 0);

calls.length = 0;
controller.dispatch(messageUpdate("thinking_delta", "before-end"), { owner: currentOwner });
controller.dispatch(messageUpdate("thinking_end"), { owner: currentOwner });
assert.deepEqual(calls, ["thinking:before-end", "thinking:", "follow"], "recognized end fragments should act as synchronous barriers without reordering");
assert.equal(frames.callbacks.size, 0);

calls.length = 0;
controller.dispatch(messageUpdate("text_delta", "drop"), { owner: currentOwner });
controller.cancel(currentOwner);
assert.equal(controller.pendingCount(), 0);
assert.equal(frames.callbacks.size, 0, "owner cancellation should remove its retained frame");
assert.deepEqual(calls, []);

calls.length = 0;
assert.equal(controller.dispatch(messageUpdate("text_delta", "stale-now"), { owner: "tab-b:1" }), true, "stale raw events should be consumed without reaching global dispatch");
assert.deepEqual(calls, ["stale:tab-b:1"]);
assert.equal(frames.callbacks.size, 0);

calls.length = 0;
controller.dispatch(messageUpdate("text_delta", "stale-later"), { owner: currentOwner });
currentOwner = "tab-a:2";
frames.run();
assert.deepEqual(calls, ["stale:tab-a:1"], "an owner that becomes stale before its frame must not mutate the transcript");

calls.length = 0;
currentOwner = "tab-a:2";
controller.dispatch(messageUpdate("future_delta", "ignored"), { owner: currentOwner });
frames.run();
assert.deepEqual(calls, ["unknown:future_delta"], "unknown message updates should fail closed without requesting follow-scroll");

for (const mode of ["normal", "compact-v1"]) {
  const parityFrames = new FakeFrames();
  const seen = [];
  const parityController = createStreamOutputController({
    scheduleFrame: parityFrames.schedule,
    cancelFrame: parityFrames.cancel,
    applyTextUpdate: (event) => seen.push(`${mode}:${event.assistantMessageEvent.delta}`),
    applyFollowScroll: () => seen.push(`${mode}:follow`),
  });
  parityController.dispatch(messageUpdate("text_delta", "same"));
  parityFrames.run();
  assert.deepEqual(seen, [`${mode}:same`, `${mode}:follow`], `${mode} should use the same controller ordering contract`);
}

console.log("stream-output-controller.test.mjs passed");
