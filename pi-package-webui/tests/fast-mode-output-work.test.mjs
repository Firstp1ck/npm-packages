import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { browserOutputEvent, encodeBrowserSseEvent } from "../lib/webui-output-mode.mjs";
import { createFastModeOutputEvents, fixedFastModeTraceMetadata } from "./fixtures/fast-mode-output-events.mjs";

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function semanticPayload(encodedEvents) {
  const semantics = { lifecycle: [], text: "", indices: [], finalMessage: null, toolEvents: [], errors: [] };
  for (const encoded of encodedEvents) {
    const event = JSON.parse(encoded);
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta") {
        semantics.text += update.delta;
        semantics.indices.push(update.contentIndex ?? event.contentIndex ?? null);
      }
      continue;
    }
    if (["agent_start", "message_start", "message_end", "agent_end"].includes(event.type)) semantics.lifecycle.push(event.type);
    if (event.type === "message_end") semantics.finalMessage = event.message;
    if (["tool_execution_start", "tool_execution_end"].includes(event.type)) {
      semantics.toolEvents.push({ type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, result: event.result });
    }
    if (event.error !== undefined) semantics.errors.push({ type: event.type, error: event.error });
  }
  return semantics;
}

function runProductionSeam(outputMode) {
  const events = createFastModeOutputEvents();
  const original = structuredClone(events);
  const R = events.reduce((total, event) => total + utf8Bytes(JSON.stringify(event)), 0);
  const encoded = events.map((event) => encodeBrowserSseEvent(event, { outputMode })).filter((event) => event !== undefined);
  const S = encoded.reduce((total, payload) => total + utf8Bytes(payload), 0);
  assert.deepEqual(events, original, `${outputMode} production transformation must not mutate parsed/scoped events`);
  return { R, S, encoded, semantic: semanticPayload(encoded) };
}

const normal = runProductionSeam("normal");
const compact = runProductionSeam("compact-v1");
const Wnormal = normal.R + 2 * normal.S;
const Wfast = compact.R + 2 * compact.S;
const ratio = Wnormal / Wfast;
const normalSemanticJson = JSON.stringify(normal.semantic);
const compactSemanticJson = JSON.stringify(compact.semantic);
const normalHash = createHash("sha256").update(normalSemanticJson).digest("hex");
const compactHash = createHash("sha256").update(compactSemanticJson).digest("hex");

assert.deepEqual(compact.semantic, normal.semantic, "normal and compact production outputs must retain ordered final semantics");
assert.equal(compactHash, normalHash, "canonical semantic payload hashes must match");
assert.ok(ratio >= 1.5, `expected Wnormal / Wfast >= 1.5, got ${ratio}`);
assert.equal(normal.semantic.text.length, fixedFastModeTraceMetadata().finalBytes, "the fixed trace should contain 512 × 32 bytes of assistant text");
assert.equal(normal.semantic.indices.length, fixedFastModeTraceMetadata().deltaCount);
assert.equal(browserOutputEvent(createFastModeOutputEvents()[2], { outputMode: "compact-v1" }).message, undefined, "the byte-work gate must call the production compact seam");

console.log(JSON.stringify({
  fixture: fixedFastModeTraceMetadata(),
  R: normal.R,
  Snormal: normal.S,
  Sfast: compact.S,
  Wnormal,
  Wfast,
  ratio: Number(ratio.toFixed(6)),
  semanticHash: normalHash,
}));
console.log("fast-mode-output-work.test.mjs passed");
