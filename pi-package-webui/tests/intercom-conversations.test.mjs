import assert from "node:assert/strict";
import { projectIntercomConversations } from "../lib/intercom-conversations.mjs";

function customEntry(customType, data, id, timestamp, parentId = null) {
  return { type: "custom", customType, data, id, parentId, timestamp };
}

function customMessage(customType, details, content, id, timestamp, parentId = null) {
  return { type: "custom_message", customType, details, content, display: true, id, parentId, timestamp };
}

function assistantToolCall(toolCallId, argumentsValue, id, timestamp) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: {
      role: "assistant",
      timestamp: Date.parse(timestamp),
      content: [{ type: "toolCall", id: toolCallId, toolName: "subagent_supervisor", arguments: argumentsValue }],
    },
  };
}

function toolResult(toolCallId, details, id, timestamp, isError = false) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "subagent_supervisor",
      content: [{ type: "text", text: "untrusted result text must not be projected" }],
      details,
      isError,
      timestamp: Date.parse(timestamp),
    },
  };
}

function projection(entries, options = {}) {
  return projectIntercomConversations(entries, { localSessionId: "local-session", localName: "Local Agent", ...options });
}

function detail(entries, summaryOptions = {}, detailOptions = {}) {
  const summary = projection(entries, summaryOptions);
  assert.ok(summary.conversations[0]?.id, "fixture must produce a conversation summary");
  return projection(entries, { ...summaryOptions, ...detailOptions, conversationId: summary.conversations[0].id }).conversation;
}

{
  const entries = [
    customMessage("intercom_message", {
      from: { id: "peer-1", name: "Agent Alpha", cwd: "/private/peer/path" },
      message: {
        id: "message-in-1",
        timestamp: 1_700_000_000_000,
        content: { text: "Hello from Alpha", attachments: [{ name: "secret.txt", content: "ATTACHMENT_SECRET" }] },
      },
      bodyText: "BODY_TEXT_SECRET",
    }, "rendered message containing PARSED_PROSE_SECRET", "entry-1", "2023-11-14T22:13:20.000Z"),
    customEntry("intercom_sent", {
      to: "Agent Alpha",
      message: { text: "Hello back", replyTo: "message-in-1", attachments: [{ name: "reply.txt", content: "OUTBOUND_ATTACHMENT_SECRET" }] },
      messageId: "message-out-1",
      timestamp: 1_700_000_001_000,
    }, "entry-2", "2023-11-14T22:13:21.000Z"),
    customEntry("intercom_received", {
      from: "Agent Alpha",
      message: { text: "A direct received reply" },
      messageId: "message-received-1",
      timestamp: 1_700_000_002_000,
    }, "entry-3", "2023-11-14T22:13:22.000Z"),
    customMessage("intercom_message", {
      from: { id: "peer-1", name: "Agent Alpha" },
      message: { id: "message-received-1", timestamp: 1_700_000_002_000, content: { text: "A direct received reply" } },
    }, "duplicate rendered prose", "entry-4", "2023-11-14T22:13:22.000Z"),
    customMessage("intercom_message", {
      from: { id: "subagent-result", name: "subagent-result" },
      message: { id: "synthetic-1", timestamp: 1_700_000_003_000, content: { text: "SYNTHETIC_SECRET" } },
    }, "synthetic", "entry-5", "2023-11-14T22:13:23.000Z"),
    customEntry("unrelated_extension", { text: "UNRELATED_CUSTOM_SECRET" }, "entry-6", "2023-11-14T22:13:24.000Z"),
    {
      type: "message",
      id: "entry-7",
      parentId: null,
      timestamp: "2023-11-14T22:13:25.000Z",
      message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "TOOL_RESULT_SECRET" }], isError: false },
    },
  ];

  const summary = projection(entries);
  assert.equal(summary.conversations.length, 1, "all direct events for one stable peer should create one conversation");
  assert.equal(summary.conversations[0].messageCount, 3, "canonical message IDs should deduplicate received representations");
  assert.deepEqual(summary.conversations[0].participants, {
    local: { id: "local-session", name: "Local Agent" },
    peer: { id: "peer-1", name: "Agent Alpha" },
  });
  assert.equal(summary.conversation, null, "summary projection must not expose transcript text");

  const conversation = projection(entries, { conversationId: summary.conversations[0].id }).conversation;
  assert.deepEqual(conversation.messages.map(({ direction, text }) => [direction, text]), [
    ["peer", "Hello from Alpha"],
    ["local", "Hello back"],
    ["peer", "A direct received reply"],
  ]);
  const serialized = JSON.stringify(conversation);
  for (const forbidden of [
    "/private/peer/path",
    "ATTACHMENT_SECRET",
    "OUTBOUND_ATTACHMENT_SECRET",
    "BODY_TEXT_SECRET",
    "PARSED_PROSE_SECRET",
    "SYNTHETIC_SECRET",
    "UNRELATED_CUSTOM_SECRET",
    "TOOL_RESULT_SECRET",
  ]) assert.equal(serialized.includes(forbidden), false, `projection must not expose ${forbidden}`);
}

{
  const entries = [
    customEntry("intercom_sent", {
      to: "Retry Peer",
      message: { text: "same delivery text" },
      messageId: "retry-original",
      timestamp: 1000,
    }, "retry-entry-1", "1970-01-01T00:00:01.000Z"),
    customEntry("intercom_sent", {
      to: "Retry Peer",
      message: { text: "same delivery text", retryOf: "retry-original", supersedes: "retry-original" },
      messageId: "retry-new",
      timestamp: 2000,
    }, "retry-entry-2", "1970-01-01T00:00:02.000Z"),
  ];
  const conversation = detail(entries);
  assert.equal(conversation.messageCount, 2, "distinct protocol IDs must preserve retries and superseding messages even when text matches");
  assert.deepEqual(conversation.messages.map(({ text }) => text), ["same delivery text", "same delivery text"]);
}

{
  const entries = [
    customMessage("intercom_message", {
      from: { id: "peer-a", name: "Duplicate Name" },
      message: { id: "a-1", timestamp: 1000, content: { text: "from A" } },
    }, "a", "a", "1970-01-01T00:00:01.000Z"),
    customMessage("intercom_message", {
      from: { id: "peer-b", name: "Duplicate Name" },
      message: { id: "b-1", timestamp: 2000, content: { text: "from B" } },
    }, "b", "b", "1970-01-01T00:00:02.000Z"),
    customEntry("intercom_sent", {
      to: "Duplicate Name",
      message: { text: "ambiguous outbound" },
      messageId: "ambiguous-1",
      timestamp: 3000,
    }, "c", "1970-01-01T00:00:03.000Z"),
  ];
  const summary = projection(entries);
  assert.equal(summary.conversations.length, 3, "ambiguous duplicate names must not be guessed into a stable peer conversation");
  assert.deepEqual(new Set(summary.conversations.map(({ participants }) => participants.peer.id)), new Set(["peer-a", "peer-b", null]));
}

{
  const entries = [
    customEntry("intercom_sent", {
      to: "Reused Name",
      message: { text: "sent before the name was reused" },
      messageId: "name-only-old",
      timestamp: 1000,
    }, "name-only-entry", "1970-01-01T00:00:01.000Z"),
    customMessage("intercom_message", {
      from: { id: "new-peer-id", name: "Reused Name" },
      message: { id: "stable-new", timestamp: 2000, content: { text: "new session using the old display name" } },
    }, "new peer", "stable-new-entry", "1970-01-01T00:00:02.000Z"),
  ];
  const summary = projection(entries);
  assert.equal(summary.conversations.length, 2, "name reuse without replyTo evidence must keep the old label-only conversation separate");
  assert.deepEqual(new Set(summary.conversations.map(({ participants }) => participants.peer.id)), new Set(["new-peer-id", null]));
}

{
  const entries = [
    customMessage("intercom_message", {
      from: { id: "renamed-peer", name: "Current Name" },
      message: { id: "rename-in", timestamp: 1000, content: { text: "identity anchor" } },
    }, "anchor", "rename-anchor", "1970-01-01T00:00:01.000Z"),
    customEntry("intercom_sent", {
      to: "Previous Name",
      message: { text: "explicitly linked reply", replyTo: "rename-in" },
      messageId: "rename-out",
      timestamp: 2000,
    }, "rename-reply", "1970-01-01T00:00:02.000Z"),
  ];
  const conversation = detail(entries);
  assert.equal(conversation.participants.peer.id, "renamed-peer", "replyTo remains sufficient evidence to propagate a stable peer ID across a rename");
  assert.equal(conversation.messageCount, 2);
}

{
  const requestId = "native-request-1";
  const entries = [
    customMessage("subagent_supervisor_request", {
      id: requestId,
      reason: "need_decision",
      expectsReply: true,
      runId: "run-1",
      agent: "implementation-worker",
      childIndex: 2,
    }, `Choose the safe option.\n\nReply with: subagent_supervisor({ action: "reply", replyTo: "${requestId}", message: "..." })`, "native-request-entry", "2026-08-15T10:00:00.000Z"),
    assistantToolCall("native-call-1", { action: "reply", replyTo: requestId, message: "Use the bounded implementation." }, "native-call-entry", "2026-08-15T10:00:01.000Z"),
    toolResult("native-call-1", { replyTo: requestId, runId: "run-1", agent: "implementation-worker" }, "native-result-entry", "2026-08-15T10:00:02.000Z"),
    toolResult("native-call-1", { replyTo: requestId, runId: "run-1", agent: "implementation-worker" }, "native-result-duplicate", "2026-08-15T10:00:02.500Z"),
    assistantToolCall("native-call-failed", { action: "reply", replyTo: requestId, message: "FAILED_REPLY_SECRET" }, "failed-call-entry", "2026-08-15T10:00:03.000Z"),
    toolResult("native-call-failed", { replyTo: requestId, runId: "run-1", agent: "implementation-worker" }, "failed-result-entry", "2026-08-15T10:00:04.000Z", true),
    assistantToolCall("native-call-mismatch", { action: "reply", replyTo: requestId, message: "MISMATCH_REPLY_SECRET" }, "mismatch-call-entry", "2026-08-15T10:00:05.000Z"),
    toolResult("native-call-mismatch", { replyTo: requestId, runId: "other-run", agent: "implementation-worker" }, "mismatch-result-entry", "2026-08-15T10:00:06.000Z"),
  ];

  const conversation = detail(entries);
  assert.deepEqual(conversation.participants.peer, { id: "run-1:2", name: "implementation-worker" });
  assert.deepEqual(conversation.messages.map(({ direction, text }) => [direction, text]), [
    ["peer", "Choose the safe option."],
    ["local", "Use the bounded implementation."],
  ], "duplicate successful native tool results must still produce one reply event");
  assert.equal(conversation.messageCount, 2, "native request/reply identity should remain deduplicated");
  assert.equal(JSON.stringify(conversation).includes("Reply with:"), false, "native transport reply instructions are not chat text");
  assert.equal(JSON.stringify(conversation).includes("FAILED_REPLY_SECRET"), false, "failed native replies must be excluded");
  assert.equal(JSON.stringify(conversation).includes("MISMATCH_REPLY_SECRET"), false, "mismatched native replies must be excluded");
}

{
  const entries = [];
  for (let index = 0; index < 5; index++) {
    entries.push(customMessage("intercom_message", {
      from: { id: "bounded-peer", name: "Bounded Peer" },
      message: { id: `bounded-${index}`, timestamp: 1000 + index, content: { text: `${index}:${"é".repeat(100)}` } },
    }, "bounded", `bounded-entry-${index}`, new Date(1000 + index).toISOString()));
  }
  const summaryOptions = { maxMessagesPerConversation: 2, maxMessageTextBytes: 12 };
  const conversation = detail(entries, summaryOptions);
  assert.equal(conversation.messageCount, 5, "summary count should retain the total before display truncation");
  assert.equal(conversation.messages.length, 2, "oldest messages should be dropped at the configured conversation limit");
  assert.equal(conversation.truncatedBefore, true);
  assert.deepEqual(conversation.messages.map(({ text }) => text.slice(0, 2)), ["3:", "4:"], "newest bounded messages should remain ordered");
  assert.ok(conversation.messages.every(({ text, truncatedText }) => Buffer.byteLength(text, "utf8") <= 12 && truncatedText), "message text must be byte-bounded and marked");

  const tightSummary = projection(entries, { maxResponseBytes: 400 });
  const tightProjection = projection(entries, { maxResponseBytes: 400, conversationId: tightSummary.conversations[0].id });
  assert.ok(Buffer.byteLength(JSON.stringify(tightProjection), "utf8") <= 400, "the complete projected response should respect the serialized response bound");
  assert.equal(tightProjection.conversation.truncatedBefore, true, "response-size trimming must be explicit");
}

{
  const entries = Array.from({ length: 6 }, (_, index) => customMessage("intercom_message", {
    from: { id: "source-bounded-peer", name: "Source Bounded Peer" },
    message: { id: `source-bounded-${index}`, timestamp: 1000 + index, content: { text: `source ${index}` } },
  }, "source", `source-entry-${index}`, new Date(1000 + index).toISOString()));

  const sourceBounded = detail(entries, { maxSourceEntries: 3 });
  assert.deepEqual(sourceBounded.messages.map(({ text }) => text), ["source 3", "source 4", "source 5"], "source-entry bounds should retain the newest branch history");
  assert.equal(sourceBounded.messageCount, 3);
  assert.equal(sourceBounded.truncatedBefore, true, "dropping older source entries must surface explicit truncation");

  const eventBounded = detail(entries, { maxAcceptedEvents: 2 });
  assert.deepEqual(eventBounded.messages.map(({ text }) => text), ["source 4", "source 5"], "accepted-event bounds should retain newest accepted events");
  assert.equal(eventBounded.messageCount, 2);
  assert.equal(eventBounded.truncatedBefore, true);
}

{
  const entries = ["oldest", "middle", "newest"].map((text, index) => customMessage("intercom_message", {
    from: { id: "text-budget-peer", name: "Text Budget Peer" },
    message: { id: `text-budget-${index}`, timestamp: 1000 + index, content: { text } },
  }, "text budget", `text-budget-entry-${index}`, new Date(1000 + index).toISOString()));
  const conversation = detail(entries, { maxAcceptedTextBytes: 8 });
  assert.deepEqual(conversation.messages.map(({ text }) => text), ["mi", "newest"], "the text budget should retain and byte-truncate the newest possible history");
  assert.equal(conversation.messages[0].truncatedText, true);
  assert.equal(conversation.truncatedBefore, true);
}

{
  const chainLength = 3_000;
  const entries = [];
  for (let index = chainLength - 1; index >= 0; index--) {
    entries.push(customMessage("intercom_message", {
      from: index === 0 ? { id: "chain-peer-id", name: "Chain Peer" } : { name: "Chain Peer" },
      message: {
        id: `chain-${index}`,
        ...(index > 0 ? { replyTo: `chain-${index - 1}` } : {}),
        timestamp: 1000 + index,
        content: { text: `chain message ${index}` },
      },
    }, "chain", `chain-entry-${index}`, new Date(1000 + index).toISOString()));
  }
  const summary = projection(entries);
  assert.equal(summary.conversations.length, 1, "a long reverse reply chain should resolve as one explicit identity component");
  assert.equal(summary.conversations[0].participants.peer.id, "chain-peer-id");
  assert.equal(summary.conversations[0].messageCount, chainLength);
}

{
  const malformed = [
    customMessage("intercom_message", { from: { id: "peer" }, message: { content: { text: "missing message ID" } } }, "unsafe content", "bad-1", "invalid"),
    customEntry("intercom_sent", { to: "peer", message: { text: "missing message ID" } }, "bad-2", "invalid"),
    customMessage("subagent_supervisor_request", { id: "request", runId: "run", agent: "agent", childIndex: -1 }, "invalid child", "bad-3", "invalid"),
    assistantToolCall("orphan-call", { action: "reply", replyTo: "missing-request", message: "orphan" }, "bad-4", "2026-08-15T00:00:00.000Z"),
    toolResult("orphan-call", { replyTo: "missing-request", runId: "run", agent: "agent" }, "bad-5", "2026-08-15T00:00:01.000Z"),
  ];
  assert.deepEqual(projection(malformed), { version: 1, conversations: [], conversation: null, truncatedConversations: 0 });
  assert.equal(projection([], { conversationId: "conv_does-not-exist" }).conversation, null);
}

{
  const entries = Array.from({ length: 4 }, (_, index) => customMessage("intercom_message", {
    from: { id: `peer-${index}`, name: `Peer ${index}` },
    message: { id: `message-${index}`, timestamp: 1000 + index, content: { text: `message ${index}` } },
  }, "message", `entry-${index}`, new Date(1000 + index).toISOString()));
  const summary = projection(entries, { maxConversations: 2 });
  assert.deepEqual(summary.conversations.map(({ participants }) => participants.peer.name), ["Peer 3", "Peer 2"], "most recent conversations should win the bounded summary list");
  assert.equal(summary.truncatedConversations, 2);
}

console.log("intercom-conversations: ok");
