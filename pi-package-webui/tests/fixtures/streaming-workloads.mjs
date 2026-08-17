/**
 * Deterministic streaming workloads for the webui-output-streaming plan
 * (Phase 0 baseline). Every generator is pure and seed-free: the same call
 * always produces the same event sequence, so tests and profiling runs can
 * compare results across revisions byte-for-byte.
 *
 * Events use the same shapes the SSE transport delivers to
 * `createStreamOutputController()`:
 * `{ type: "message_update", assistantMessageEvent: { type, delta, ... } }`
 * and `{ type: "tool_execution_update", ... }`.
 */

const WORD_POOL = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

export function messageUpdateEvent(type, delta = "", extra = {}) {
  return { type: "message_update", assistantMessageEvent: { type, delta, ...extra } };
}

/** 1,000-style small plain-text deltas: short deterministic words plus spaces. */
export function smallTextDeltaEvents(count = 1000) {
  const events = [];
  for (let index = 0; index < count; index += 1) {
    events.push(messageUpdateEvent("text_delta", `${WORD_POOL[index % WORD_POOL.length]} `));
  }
  return events;
}

function deterministicChunk(index, chunkBytes) {
  // No blank lines and no fence markers: a single growing paragraph tail.
  const seed = `p${index.toString(36)} `;
  return seed.repeat(Math.ceil(chunkBytes / seed.length)).slice(0, chunkBytes);
}

/** A long unbroken paragraph (no blank lines) streamed in fixed-size chunks. */
export function longParagraphDeltaEvents(totalBytes, chunkBytes = 64) {
  const events = [];
  let produced = 0;
  let index = 0;
  while (produced < totalBytes) {
    const size = Math.min(chunkBytes, totalBytes - produced);
    events.push(messageUpdateEvent("text_delta", deterministicChunk(index, size)));
    produced += size;
    index += 1;
  }
  return events;
}

/**
 * An open fenced code block streamed in chunks. The fence is never closed, so
 * every publish keeps the whole fence in the mutable Markdown tail.
 * `codeBytes` under ~50,000 with short lines stays inside the syntax-highlight
 * bounds (repeated tokenization case); larger sizes exercise the plain-token
 * fallback plus full-tail re-render case.
 */
export function openFenceDeltaEvents(codeBytes, { language = "js", chunkBytes = 64, lineLength = 40 } = {}) {
  const events = [messageUpdateEvent("text_delta", "```" + language + "\n")];
  let produced = 0;
  let index = 0;
  while (produced < codeBytes) {
    const size = Math.min(chunkBytes, codeBytes - produced);
    let chunk = "";
    while (chunk.length < size) {
      const line = `const v${index.toString(36)} = ${index % 97};`;
      chunk += line.slice(0, Math.min(lineLength, size - chunk.length));
      if (chunk.length < size) chunk += "\n";
      index += 1;
    }
    events.push(messageUpdateEvent("text_delta", chunk));
    produced += size;
  }
  return events;
}

/** A long thinking stream of deterministic reasoning-style deltas. */
export function thinkingStreamEvents(count = 500) {
  const events = [messageUpdateEvent("thinking_start")];
  for (let index = 0; index < count; index += 1) {
    events.push(messageUpdateEvent("thinking_delta", `step ${index}: ${WORD_POOL[index % WORD_POOL.length]}. `));
  }
  events.push(messageUpdateEvent("thinking_end"));
  return events;
}

/**
 * Mixed semantic burst: interleaved thinking, text, tool-call, tool-execution,
 * error, and end barriers in a fixed order for exact-order assertions.
 */
export function mixedSemanticBurstEvents() {
  return [
    messageUpdateEvent("thinking_start"),
    messageUpdateEvent("thinking_delta", "planning "),
    messageUpdateEvent("thinking_delta", "steps"),
    messageUpdateEvent("thinking_end"),
    messageUpdateEvent("text_start"),
    messageUpdateEvent("text_delta", "Running the "),
    messageUpdateEvent("text_delta", "command now."),
    messageUpdateEvent("toolcall_start", "", { toolCallId: "tool-1" }),
    messageUpdateEvent("toolcall_delta", '{"cmd":', { toolCallId: "tool-1" }),
    messageUpdateEvent("toolcall_delta", '"ls"}', { toolCallId: "tool-1" }),
    messageUpdateEvent("toolcall_end", "", { toolCallId: "tool-1" }),
    { type: "tool_execution_update", toolCallId: "tool-1", partialResult: { content: "file-a\n" } },
    { type: "tool_execution_update", toolCallId: "tool-1", partialResult: { content: "file-a\nfile-b\n" } },
    messageUpdateEvent("text_delta", " Done."),
    messageUpdateEvent("error", "", { error: "deterministic-error" }),
    messageUpdateEvent("text_end"),
  ];
}

/**
 * Queue-overflow burst: strictly alternating text/thinking deltas defeat
 * adjacent coalescing, so `pairs * 2` events exercise the entry-limit path of
 * the bounded frame queue.
 */
export function overflowBurstEvents({ pairs = 200 } = {}) {
  const events = [];
  for (let index = 0; index < pairs; index += 1) {
    events.push(messageUpdateEvent("text_delta", `t${index} `));
    events.push(messageUpdateEvent("thinking_delta", `h${index} `));
  }
  return events;
}

/** Concatenate every delta of one assistant-message-event type, in order. */
export function concatenatedDeltaText(events, type = "text_delta") {
  let text = "";
  for (const event of events) {
    const update = event?.assistantMessageEvent;
    if (update?.type === type && typeof update.delta === "string") text += update.delta;
  }
  return text;
}
