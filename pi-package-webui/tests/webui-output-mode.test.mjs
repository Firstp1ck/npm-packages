import assert from "node:assert/strict";
import {
  browserOutputEvent,
  encodeBrowserSseEvent,
  isOutputModeSemanticBarrier,
  negotiateOutputMode,
  normalizeOutputMode,
  OUTPUT_MODE_COMPACT_V1,
  OUTPUT_MODE_NORMAL,
  resolveOutputModeDefault,
} from "../lib/webui-output-mode.mjs";

assert.equal(normalizeOutputMode("compact-v1"), OUTPUT_MODE_COMPACT_V1);
assert.equal(normalizeOutputMode("unknown", OUTPUT_MODE_COMPACT_V1), OUTPUT_MODE_COMPACT_V1);
assert.equal(normalizeOutputMode(undefined), OUTPUT_MODE_NORMAL);
assert.deepEqual(resolveOutputModeDefault({ cliMode: "compact-v1", envMode: "normal", persistedMode: "normal" }), { mode: "compact-v1", source: "cli" });
assert.deepEqual(resolveOutputModeDefault({ envMode: "compact-v1", persistedMode: "normal" }), { mode: "compact-v1", source: "env" });
assert.deepEqual(resolveOutputModeDefault({ persistedMode: "compact-v1" }), { mode: "compact-v1", source: "persisted" });
assert.deepEqual(resolveOutputModeDefault({ persistedMode: "invalid" }), { mode: "normal", source: "normal" });

assert.deepEqual(negotiateOutputMode({ requestedMode: "auto", protocolVersion: "1", serverDefault: "compact-v1" }), {
  requestedMode: "auto",
  protocolVersion: 1,
  activeMode: "compact-v1",
});
assert.deepEqual(negotiateOutputMode({ requestedMode: "compact-v1", protocolVersion: 1, serverDefault: "normal" }), {
  requestedMode: "compact-v1",
  protocolVersion: 1,
  activeMode: "compact-v1",
});
assert.deepEqual(negotiateOutputMode({ requestedMode: "compact-v1", protocolVersion: undefined, serverDefault: "compact-v1" }), {
  requestedMode: "normal",
  protocolVersion: 0,
  activeMode: "normal",
});
assert.deepEqual(negotiateOutputMode({ requestedMode: "auto", protocolVersion: "2", serverDefault: "compact-v1" }), {
  requestedMode: "normal",
  protocolVersion: 0,
  activeMode: "normal",
});

const canonical = {
  type: "message_update",
  tabId: "tab-1",
  tabActivity: { status: "working" },
  message: { role: "assistant", content: [{ type: "text", text: "accumulated text" }] },
  assistantMessageEvent: {
    type: "text_delta",
    delta: "",
    contentIndex: 2,
    partial: { role: "assistant", content: [{ type: "text", text: "accumulated text" }] },
  },
};
const original = structuredClone(canonical);
const compact = browserOutputEvent(canonical, { outputMode: "compact-v1" });
assert.notStrictEqual(compact, canonical, "compact output must be browser-only");
assert.equal(compact.message, undefined, "duplicate accumulated top-level message should be removed");
assert.equal(compact.assistantMessageEvent.partial, undefined, "duplicate accumulated partial should be removed");
assert.equal(compact.assistantMessageEvent.delta, "", "empty deltas are semantically meaningful");
assert.equal(compact.assistantMessageEvent.contentIndex, 2);
assert.deepEqual(canonical, original, "the parsed/scoped source event must never be mutated");
assert.equal(JSON.parse(encodeBrowserSseEvent(canonical, { outputMode: "compact-v1" })).assistantMessageEvent.delta, "");

const malformed = { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: 4, partial: { text: "must remain" } }, message: { role: "assistant" } };
assert.strictEqual(browserOutputEvent(malformed, { outputMode: "compact-v1" }), malformed, "malformed delta shapes fail open");
const unknown = { type: "message_update", assistantMessageEvent: { type: "unknown_delta", delta: "x", partial: { text: "must remain" } }, message: { role: "assistant" } };
assert.strictEqual(browserOutputEvent(unknown, { outputMode: "compact-v1" }), unknown, "unknown update shapes fail open");
assert.equal(browserOutputEvent({ type: "tool_execution_update", partialResult: {} }, { outputMode: "compact-v1" }), undefined, "compact v1 omits only intermediate tool updates");
assert.deepEqual(browserOutputEvent({ type: "tool_execution_end", result: { content: [] } }, { outputMode: "compact-v1" }), { type: "tool_execution_end", result: { content: [] } });
assert.equal(isOutputModeSemanticBarrier({ type: "message_end" }), true);
assert.equal(isOutputModeSemanticBarrier({ type: "agent_start" }), false);

console.log("webui-output-mode.test.mjs passed");
