import assert from "node:assert/strict";
import { sessionTreeEventTargets } from "../lib/session-tree-event-targets.mjs";

function messageEntry(id, message) {
  return { type: "message", id, parentId: null, timestamp: "2026-08-20T12:00:00.000Z", message };
}

{
  const entries = [
    messageEntry("assistant-1", {
      role: "assistant",
      content: [
        { type: "text", text: "PRIVATE_ASSISTANT_TEXT" },
        { type: "toolCall", id: "call-read", name: "read", arguments: { path: "/private/secret.txt" } },
        { type: "toolCall", toolCallId: "call-bash", toolName: "bash", arguments: { command: "printenv TOKEN" } },
      ],
    }),
    messageEntry("result-read", {
      role: "toolResult",
      toolCallId: "call-read",
      toolName: "read",
      content: [{ type: "text", text: "PRIVATE_READ_RESULT" }],
    }),
    messageEntry("result-bash", {
      role: "toolResult",
      toolCallId: "call-bash",
      toolName: "bash",
      content: [{ type: "text", text: "PRIVATE_BASH_RESULT" }],
    }),
  ];

  const targets = sessionTreeEventTargets(entries);
  assert.deepEqual(targets, [
    { toolCallId: "call-read", toolName: "read", startEntryId: "assistant-1", finishEntryId: "result-read" },
    { toolCallId: "call-bash", toolName: "bash", startEntryId: "assistant-1", finishEntryId: "result-bash" },
  ], "multiple calls should map their shared assistant start and distinct result finishes in call order");
  assert.equal(JSON.stringify(targets).includes("PRIVATE_"), false, "message and result content must not enter event targets");
  assert.equal(JSON.stringify(targets).includes("/private/secret.txt"), false, "tool arguments must not enter event targets");
  assert.deepEqual(Object.keys(targets[0]), ["toolCallId", "toolName", "startEntryId", "finishEntryId"], "the contract should expose only the four approved fields");
  assert.doesNotThrow(() => JSON.stringify(targets), "event targets should be JSON-safe");
}

{
  const entries = [
    messageEntry("assistant-first", {
      role: "assistant",
      content: [
        { type: "toolCall", id: "duplicate", name: "first-name", arguments: { secret: "FIRST_ARGUMENT_SECRET" } },
        { type: "toolCall", id: "", name: "missing-id" },
        { type: "toolCall", name: "also-missing-id" },
      ],
    }),
    messageEntry("assistant-later", {
      role: "assistant",
      content: [{ type: "toolCall", id: "duplicate", name: "later-name", arguments: { secret: "LATER_ARGUMENT_SECRET" } }],
    }),
    messageEntry("result-first", {
      role: "toolResult",
      toolCallId: "duplicate",
      toolName: "result-name",
      content: "FIRST_RESULT_SECRET",
    }),
    messageEntry("result-later", {
      role: "toolResult",
      toolCallId: "duplicate",
      toolName: "later-result-name",
      content: "LATER_RESULT_SECRET",
    }),
    messageEntry("result-missing-id", { role: "toolResult", toolName: "read", content: "MISSING_ID_RESULT_SECRET" }),
    messageEntry("not-a-tool-call", { role: "assistant", content: [{ type: "text", text: "ignore" }] }),
    { type: "message", message: { role: "toolResult", toolCallId: "missing-entry-id", toolName: "read" } },
  ];

  assert.deepEqual(sessionTreeEventTargets(entries), [
    { toolCallId: "duplicate", toolName: "first-name", startEntryId: "assistant-first", finishEntryId: "result-first" },
  ], "missing IDs should be ignored and duplicate boundaries should keep their first stable entry IDs and tool name");
}

{
  const finishOnly = sessionTreeEventTargets([
    messageEntry("finish-only-entry", {
      role: "toolResult",
      toolCallId: "finish-only",
      toolName: "write",
      content: [{ type: "text", text: "FINISH_ONLY_RESULT_SECRET" }],
    }),
  ]);
  assert.deepEqual(finishOnly, [
    { toolCallId: "finish-only", toolName: "write", startEntryId: null, finishEntryId: "finish-only-entry" },
  ], "persisted finish-only records should remain navigable without inventing a start boundary");
}

{
  const resultBeforeCall = sessionTreeEventTargets([
    messageEntry("finish-before-start", { role: "toolResult", toolCallId: "out-of-order", toolName: "bash", content: "secret" }),
    messageEntry("start-after-finish", { role: "assistant", content: [{ type: "toolCall", id: "out-of-order", name: "bash", arguments: {} }] }),
  ]);
  assert.deepEqual(resultBeforeCall, [
    { toolCallId: "out-of-order", toolName: "bash", startEntryId: "start-after-finish", finishEntryId: "finish-before-start" },
  ], "merge logic should fill either boundary without depending on entry ordering");
}

assert.deepEqual(sessionTreeEventTargets(undefined), [], "non-array input should return an empty JSON-safe list");
assert.deepEqual(sessionTreeEventTargets([null, {}, { type: "message", id: "empty-message" }]), [], "malformed entries should be ignored");

console.log("session-tree-event-targets.test.mjs passed");
