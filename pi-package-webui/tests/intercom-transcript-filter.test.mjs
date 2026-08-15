import assert from "node:assert/strict";
import { filterIntercomTranscriptMessages } from "../lib/intercom-transcript-filter.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

{
  const messages = [
    { role: "custom", customType: "intercom_message", content: "rendered Intercom prose" },
    { role: "custom", customType: "other_extension", content: "keep custom output" },
    { role: "user", content: "prose mentioning intercom is unrelated" },
  ];
  const result = filterIntercomTranscriptMessages(messages);
  assert.deepEqual(result, messages.slice(1), "only explicitly typed intercom_message custom records should be removed");
}

{
  const intercomCall = { type: "toolCall", id: "intercom-mixed", name: " interCOM ", arguments: { message: "hidden" } };
  const readCall = { type: "toolCall", id: "read-mixed", toolName: "read", arguments: { path: "README.md" } };
  const mixed = {
    role: "assistant",
    timestamp: 1234,
    content: [
      { type: "thinking", thinking: "retain reasoning" },
      { type: "text", text: "retain answer" },
      intercomCall,
      { type: "image", data: "retain-image" },
      readCall,
    ],
  };
  const input = [mixed];
  const before = structuredClone(input);
  deepFreeze(input);
  const result = filterIntercomTranscriptMessages(input);
  assert.deepEqual(result, [{ ...mixed, content: mixed.content.filter((part) => part !== intercomCall) }], "mixed assistant messages should retain all non-Intercom content in order");
  assert.deepEqual(input, before, "filtering must not mutate the input transcript or nested content");
  assert.notEqual(result[0], mixed, "a changed assistant message should be copied");
  assert.equal(result[0].content[0], mixed.content[0], "unchanged content parts should retain their references");
  assert.equal(result[0].content.at(-1), readCall, "unrelated tool calls should retain their references");
}

{
  const messages = [
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "paired-no-name", toolName: "intercom", arguments: {} }] },
    { role: "toolResult", toolCallId: "paired-no-name", content: [{ type: "text", text: "hidden paired result" }] },
    { role: "toolResult", toolCallId: "orphan-intercom", toolName: " InterCom ", content: [{ type: "text", text: "hidden orphan result" }] },
    { role: "toolResult", toolCallId: "orphan-read", toolName: "read", content: [{ type: "text", text: "keep unrelated result" }] },
    { role: "toolResult", id: "paired-no-name", toolName: "read", content: [{ type: "text", text: "record IDs are not pairing IDs" }] },
  ];
  assert.deepEqual(filterIntercomTranscriptMessages(messages), [messages[3], messages[4]], "paired unnamed and explicitly named orphan Intercom results should be removed only by explicit toolCallId");
}

{
  const messages = [
    { role: "toolCall", id: "direct-record-id", toolCallId: "direct-intercom", toolName: "intercom", arguments: { message: "hidden" } },
    { role: "toolResult", toolCallId: "direct-intercom", content: "hidden direct result" },
    { role: "toolCall", toolCallId: "direct-read", toolName: "read", arguments: { path: "README.md" } },
  ];
  assert.deepEqual(filterIntercomTranscriptMessages(messages), [messages[2]], "direct normalized Intercom tool-call records and their paired results should be removed");
}

{
  const messages = [
    { role: "user", content: [{ type: "text", text: "unchanged prompt" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "unchanged thought" }, { type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "pwd" } }] },
    { role: "toolResult", toolCallId: "bash-1", toolName: "bash", content: [{ type: "text", text: "/tmp" }] },
    { role: "custom", customType: "unrelated", content: "unchanged custom record" },
  ];
  const before = structuredClone(messages);
  deepFreeze(messages);
  const result = filterIntercomTranscriptMessages(messages);
  assert.deepEqual(result, before, "unrelated transcript records should remain unchanged");
  assert.ok(result.every((message, index) => message === messages[index]), "unchanged records should retain object identity");
  assert.deepEqual(messages, before, "an unchanged frozen input must not be mutated");
}

{
  const onlyIntercom = { role: "assistant", content: [{ type: "toolCall", id: "only-intercom", toolName: "intercom", arguments: {} }] };
  const noMeaningAfterFilter = {
    role: "assistant",
    content: [
      { type: "text", text: "   " },
      { type: "thinking", thinking: "\n" },
      { type: "toolCall", id: "intercom-with-empty-parts", toolName: "intercom", arguments: {} },
    ],
  };
  const unrelatedEmpty = { role: "assistant", content: [{ type: "text", text: "" }] };
  const result = filterIntercomTranscriptMessages([onlyIntercom, noMeaningAfterFilter, unrelatedEmpty]);
  assert.deepEqual(result, [unrelatedEmpty], "assistants emptied by Intercom filtering should be removed without changing unrelated empty records");
}

assert.deepEqual(filterIntercomTranscriptMessages(undefined), [], "non-array transcript input should produce an empty list");

console.log("intercom-transcript-filter.test.mjs passed");
