const DELTA_COUNT = 512;
const DELTA_BYTES = 32;

function fixedDelta(index) {
  return `d${String(index).padStart(4, "0")}${"x".repeat(DELTA_BYTES - 5)}`;
}

function assistantSnapshot(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  };
}

export function createFastModeOutputEvents() {
  const events = [
    { type: "agent_start", tabId: "fast-mode-trace" },
    { type: "tool_execution_start", tabId: "fast-mode-trace", toolCallId: "trace-tool", toolName: "read", args: { path: "trace.txt" } },
    { type: "tool_execution_end", tabId: "fast-mode-trace", toolCallId: "trace-tool", toolName: "read", isError: false, result: { content: [{ type: "text", text: "trace result" }] } },
    { type: "pi_stdout_parse_error", tabId: "fast-mode-trace", error: "trace diagnostic" },
    { type: "message_start", tabId: "fast-mode-trace", message: { role: "assistant" } },
  ];
  let accumulated = "";
  for (let index = 0; index < DELTA_COUNT; index += 1) {
    const delta = fixedDelta(index);
    accumulated += delta;
    const snapshot = assistantSnapshot(accumulated);
    events.push({
      type: "message_update",
      tabId: "fast-mode-trace",
      contentIndex: 0,
      message: snapshot,
      assistantMessageEvent: {
        type: "text_delta",
        delta,
        contentIndex: 0,
        partial: assistantSnapshot(accumulated),
      },
    });
  }
  events.push(
    { type: "message_end", tabId: "fast-mode-trace", message: assistantSnapshot(accumulated) },
    { type: "agent_end", tabId: "fast-mode-trace" },
  );
  return events;
}

export function fixedFastModeTraceMetadata() {
  return { deltaCount: DELTA_COUNT, deltaBytes: DELTA_BYTES, finalBytes: DELTA_COUNT * DELTA_BYTES };
}
