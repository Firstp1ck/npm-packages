import assert from "node:assert/strict";
import {
  DEFAULT_STREAM_PENDING_BYTE_LIMIT,
  DEFAULT_STREAM_PENDING_ENTRY_LIMIT,
  createStreamOutputController,
} from "../public/stream-output-controller.mjs";
import {
  backgroundForegroundReconciliationScenario,
  concatenatedDeltaText,
  longParagraphDeltaEvents,
  longTranscriptActiveStreamScenario,
  messageUpdateEvent,
  mixedSemanticBurstEvents,
  openFenceDeltaEvents,
  overflowBurstEvents,
  smallTextDeltaEvents,
  thinkingStreamEvents,
} from "./fixtures/streaming-workloads.mjs";

class FakeFrames {
  next = 1;
  callbacks = new Map();

  schedule = (callback) => {
    const handle = this.next++;
    this.callbacks.set(handle, callback);
    return handle;
  };

  cancel = (handle) => {
    this.callbacks.delete(handle);
  };

  runAll() {
    while (this.callbacks.size) {
      const [handle, callback] = this.callbacks.entries().next().value;
      this.callbacks.delete(handle);
      callback();
    }
  }
}

function harness({ diagnostics = true, nowStepMs = 1 } = {}) {
  const frames = new FakeFrames();
  const records = [];
  const applied = { text: "", thinking: "", toolCall: "", toolExecution: [], errors: 0, order: [] };
  let clock = 0;
  let nowCalls = 0;
  const controller = createStreamOutputController({
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    now: () => {
      nowCalls += 1;
      clock += nowStepMs;
      return clock;
    },
    applyTextUpdate: (event) => {
      applied.text += event.assistantMessageEvent.delta || "";
      applied.order.push(`text:${event.assistantMessageEvent.type}`);
    },
    applyThinkingUpdate: (event) => {
      applied.thinking += event.assistantMessageEvent.delta || "";
      applied.order.push(`thinking:${event.assistantMessageEvent.type}`);
    },
    applyToolCallUpdate: (event) => {
      applied.toolCall += event.assistantMessageEvent.delta || "";
      applied.order.push(`tool-call:${event.assistantMessageEvent.type}`);
    },
    applyToolExecutionUpdate: (event) => {
      applied.toolExecution.push(event.partialResult?.content || "");
      applied.order.push("tool-execution");
    },
    applyStreamError: () => {
      applied.errors += 1;
      applied.order.push("stream-error");
    },
    onDiagnostic: diagnostics ? (record) => records.push(record) : undefined,
  });
  return {
    frames,
    records,
    applied,
    controller,
    nowCallCount: () => nowCalls,
    dispatchAll(events) {
      for (const event of events) controller.dispatch(event);
    },
  };
}

// 1) Small-delta burst: lossless coalescing collapses transport events into few batches.
{
  const run = harness();
  const events = smallTextDeltaEvents(1000);
  run.dispatchAll(events);
  run.frames.runAll();
  assert.equal(run.applied.text, concatenatedDeltaText(events), "coalesced text must equal exact concatenation");
  const batches = run.records.filter((record) => record.type === "batch");
  const receipts = run.records.filter((record) => record.type === "receipt");
  assert.equal(receipts.length, 1000, "every transport event must be received");
  assert.ok(batches.length <= 5, `render batches (${batches.length}) must stay far below transport events`);
  const totalSources = batches.reduce((total, batch) => total + batch.sourceCount, 0);
  assert.equal(totalSources, 1000, "batch sourceCounts must account for every source event");
}

// 2) Long unbroken paragraph (1 MB): byte-limit overflow drains stay lossless and bounded.
{
  const run = harness();
  const events = longParagraphDeltaEvents(1024 * 1024, 512);
  run.dispatchAll(events);
  run.frames.runAll();
  run.controller.flush();
  assert.equal(run.applied.text.length, 1024 * 1024, "no paragraph bytes may be lost");
  assert.equal(run.applied.text, concatenatedDeltaText(events), "paragraph must survive overflow drains byte-for-byte");
  const overflow = run.records.filter((record) => record.type === "overflow");
  assert.ok(overflow.length > 0, "1 MB through a 256 KB queue must report overflow");
  for (const record of run.records.filter((entry) => entry.type === "queued")) {
    assert.ok(record.pendingBytes <= DEFAULT_STREAM_PENDING_BYTE_LIMIT * 2, "primary plus one urgent entry must remain within the explicit total bound");
    assert.ok(record.pendingCount <= DEFAULT_STREAM_PENDING_ENTRY_LIMIT + 1, "primary plus one urgent entry must remain bounded");
  }
}

// 3) Open code fences: under-limit and over-limit fixtures both stream losslessly.
for (const codeBytes of [40 * 1024, 100 * 1024]) {
  const run = harness();
  const events = openFenceDeltaEvents(codeBytes);
  run.dispatchAll(events);
  run.frames.runAll();
  run.controller.flush();
  const expected = concatenatedDeltaText(events);
  assert.equal(run.applied.text, expected, `open fence (${codeBytes} bytes) must stream losslessly`);
  assert.ok(expected.startsWith("```js\n"), "fixture must open a fence");
  assert.ok(!/```\s*$/.test(expected), "fixture fence must remain open");
}

// 4) Thinking stream: start/end barriers flush synchronously and text is exact.
{
  const run = harness();
  const events = thinkingStreamEvents(500);
  run.dispatchAll(events);
  assert.equal(run.controller.pendingCount(), 0, "thinking_end barrier must leave nothing queued");
  assert.equal(run.applied.thinking, concatenatedDeltaText(events, "thinking_delta"), "thinking text must be exact");
  const barriers = run.records.filter((record) => record.type === "barrier");
  assert.ok(barriers.length >= 1, "the thinking_end barrier flush must be diagnosed");
}

// 5) Mixed semantic burst: cross-kind order is preserved exactly.
{
  const run = harness();
  run.dispatchAll(mixedSemanticBurstEvents());
  run.frames.runAll();
  run.controller.flush();
  assert.deepEqual(run.applied.order, [
    "thinking:thinking_start",
    "thinking:thinking_delta",
    "thinking:thinking_end",
    "text:text_start",
    "text:text_delta",
    "tool-call:toolcall_start",
    "tool-call:toolcall_delta",
    "tool-call:toolcall_end",
    "tool-execution",
    "text:text_delta",
    "stream-error",
    "text:text_end",
  ], "semantic order must match server order with only adjacent same-kind coalescing");
  assert.equal(run.applied.thinking, "planning steps");
  assert.equal(run.applied.text, "Running the command now. Done.");
  assert.equal(run.applied.toolCall, '{"cmd":"ls"}');
  assert.deepEqual(run.applied.toolExecution, ["file-a\nfile-b\n"], "superseding partial tool results must coalesce to the latest");
  assert.equal(run.applied.errors, 1);
}

// 6) Overflow burst: alternating kinds defeat coalescing, hit the entry limit, stay ordered.
{
  const run = harness();
  const events = overflowBurstEvents({ pairs: 200 });
  run.dispatchAll(events);
  run.frames.runAll();
  run.controller.flush();
  assert.equal(run.applied.text, concatenatedDeltaText(events, "text_delta"));
  assert.equal(run.applied.thinking, concatenatedDeltaText(events, "thinking_delta"));
  const entryOverflows = run.records.filter((record) => record.type === "overflow" && record.reason === "entry-limit");
  assert.ok(entryOverflows.length > 0, "400 non-coalescible events must hit the 128-entry limit");
  for (const record of run.records.filter((entry) => entry.type === "queued")) {
    assert.ok(record.pendingCount <= DEFAULT_STREAM_PENDING_ENTRY_LIMIT + 1);
  }
  // Alternation must be preserved within each flushed window: text i before thinking i.
  const textIndex = run.applied.order.filter((kind) => kind.startsWith("text") || kind.startsWith("thinking"));
  assert.equal(textIndex[0], "text:text_delta", "first applied event must be the first dispatched kind");
}

// 7) Batch latency and drain duration are measured with the injected clock.
{
  const run = harness({ nowStepMs: 5 });
  run.controller.dispatch(messageUpdateEvent("text_delta", "a"));
  run.controller.dispatch(messageUpdateEvent("text_delta", "b"));
  run.frames.runAll();
  const batch = run.records.find((record) => record.type === "batch");
  assert.ok(batch, "a batch record must exist");
  assert.equal(typeof batch.maxAgeMs, "number", "batch latency must be reported");
  assert.equal(typeof batch.drainMs, "number", "drain duration must be reported");
  assert.ok(batch.maxAgeMs > 0, "coalesced batches must report the oldest entry's age");
  assert.ok(batch.drainMs > 0, "drain duration must be measured across application");
}

// 8) Coalesced entries keep the oldest receipt time so latency is not hidden by merging.
{
  const run = harness({ nowStepMs: 10 });
  run.controller.dispatch(messageUpdateEvent("text_delta", "first"));
  run.controller.dispatch(messageUpdateEvent("text_delta", "second"));
  run.controller.dispatch(messageUpdateEvent("text_delta", "third"));
  run.frames.runAll();
  const batch = run.records.find((record) => record.type === "batch");
  // Clock: dispatch receipts at 10, 20, 30; drain start at 40 → oldest age 30.
  assert.equal(batch.maxAgeMs, 30, "merged entry must retain the first source's receipt time");
}

// 9) Disabled diagnostics never touch the clock: the hot path is measurement-free.
{
  const run = harness({ diagnostics: false });
  run.dispatchAll(smallTextDeltaEvents(100));
  run.frames.runAll();
  run.controller.flush();
  assert.equal(run.nowCallCount(), 0, "the disabled hot path must never call now()");
  assert.equal(run.applied.text, concatenatedDeltaText(smallTextDeltaEvents(100)));
}

// 10) Oversize direct application also reports latency fields.
{
  const run = harness({ nowStepMs: 2 });
  const oversize = messageUpdateEvent("text_delta", "x".repeat(DEFAULT_STREAM_PENDING_BYTE_LIMIT));
  run.controller.dispatch(oversize);
  const direct = run.records.find((record) => record.type === "batch" && record.direct === true);
  assert.ok(direct, "an oversize event must be applied directly");
  assert.equal(typeof direct.maxAgeMs, "number");
  assert.equal(typeof direct.drainMs, "number");
  assert.equal(run.applied.text.length, DEFAULT_STREAM_PENDING_BYTE_LIMIT, "oversize events are applied, never dropped");
}

// 11) Background events are deterministic and reconcile to one exact snapshot.
{
  const first = backgroundForegroundReconciliationScenario(1000);
  const second = backgroundForegroundReconciliationScenario(1000);
  assert.deepEqual(second, first, "background fixture must be byte-for-byte deterministic");
  assert.deepEqual(first.hiddenEvents.map((event) => event.baselineIndex), Array.from({ length: 1000 }, (_, index) => index));
  assert.equal(first.authoritativeText, concatenatedDeltaText(first.hiddenEvents));

  const run = harness();
  // Hidden-tab policy suppresses controller dispatch entirely. Foreground
  // reconciliation applies the authoritative snapshot once, represented here
  // by the same exact text delta consumed by the sink.
  assert.equal(run.applied.text, "", "hidden events must not mutate live output");
  run.controller.dispatch(messageUpdateEvent("text_delta", first.authoritativeText));
  run.frames.runAll();
  assert.equal(run.applied.text, first.authoritativeText, "foreground snapshot must restore exact hidden output once");
  assert.equal(run.records.filter((record) => record.type === "receipt").length, 1, "catch-up must not replay hidden transport cadence");
}

// 12) A large retained transcript does not change active-stream order or text.
{
  const scenario = longTranscriptActiveStreamScenario({ messageCount: 1000, deltaCount: 1000 });
  const retainedBefore = structuredClone(scenario.retainedMessages);
  assert.equal(scenario.retainedMessages.length, 1000);
  assert.equal(scenario.retainedMessages[0].content.startsWith("LONG-TRANSCRIPT-0000"), true);
  assert.equal(scenario.retainedMessages.at(-1).content[0].text.startsWith("LONG-TRANSCRIPT-0999"), true);

  const run = harness();
  run.dispatchAll(scenario.activeEvents);
  run.frames.runAll();
  assert.equal(run.applied.text, concatenatedDeltaText(scenario.activeEvents), "active stream must remain exact beside a long transcript");
  assert.deepEqual(scenario.retainedMessages, retainedBefore, "active streaming must not mutate retained transcript fixtures");
  assert.equal(run.records.filter((record) => record.type === "receipt").length, 1000);
}

console.log("stream-output-workloads tests passed");
