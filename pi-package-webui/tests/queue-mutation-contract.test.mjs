import assert from "node:assert/strict";
import { mutatePiRuntimeFollowUpQueue } from "../lib/queue-mutation.mjs";

function queuedMessage(text, extra = {}) {
  return {
    role: "user",
    timestamp: 1234,
    metadata: { origin: "fixture" },
    content: [{ type: "text", text }, { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
    ...extra,
  };
}

function fixture({ steering = ["steer"], followUp = ["first", "second", "third"], steeringMessages, followUpMessages } = {}) {
  let events = 0;
  const session = {
    _steeringMessages: [...steering],
    _followUpMessages: [...followUp],
    agent: {
      steeringQueue: { messages: steeringMessages || steering.map((text) => queuedMessage(text)) },
      followUpQueue: { messages: followUpMessages || followUp.map((text) => queuedMessage(text)) },
    },
    _emitQueueUpdate() { events += 1; },
  };
  return { session, eventCount: () => events };
}

function expected(session) {
  return { steering: [...session._steeringMessages], followUp: [...session._followUpMessages] };
}

function editRequest(session, index, text, expectedText = session._followUpMessages[index]) {
  return {
    source: "pi-runtime",
    kind: "followUp",
    expected: expected(session),
    operation: { type: "edit", index, expectedText, text },
  };
}

function moveRequest(session, from, to, expectedText = session._followUpMessages[from]) {
  return {
    source: "pi-runtime",
    kind: "followUp",
    expected: expected(session),
    operation: { type: "move", from, to, expectedText },
  };
}

{
  const { session, eventCount } = fixture();
  const beforeMessage = session.agent.followUpQueue.messages[1];
  const beforeImage = beforeMessage.content[1];
  const result = mutatePiRuntimeFollowUpQueue(session, editRequest(session, 1, "edited"));
  assert.deepEqual(result, {
    mutated: true,
    source: "pi-runtime",
    queue: { source: "pi-runtime", steering: ["steer"], followUp: ["first", "edited", "third"] },
  });
  assert.deepEqual(session._followUpMessages, ["first", "edited", "third"]);
  assert.equal(session.agent.followUpQueue.messages[1].role, "user", "edit preserves message role");
  assert.equal(session.agent.followUpQueue.messages[1].timestamp, 1234, "edit preserves message timestamp");
  assert.deepEqual(session.agent.followUpQueue.messages[1].metadata, { origin: "fixture" }, "edit preserves metadata");
  assert.strictEqual(session.agent.followUpQueue.messages[1].content[1], beforeImage, "edit preserves image content exactly");
  assert.equal(beforeMessage.content[0].text, "second", "edit does not mutate the original message object");
  assert.equal(eventCount(), 1, "successful edit emits exactly one queue update");
}

{
  const { session, eventCount } = fixture();
  const firstMessage = session.agent.followUpQueue.messages[0];
  const result = mutatePiRuntimeFollowUpQueue(session, moveRequest(session, 0, 2));
  assert.equal(result.mutated, true);
  assert.deepEqual(session._followUpMessages, ["second", "third", "first"], "move uses the final post-removal index");
  assert.strictEqual(session.agent.followUpQueue.messages[2], firstMessage, "move keeps the message object paired with its tracking string");
  assert.equal(eventCount(), 1, "successful move emits exactly one queue update");
}

{
  const { session, eventCount } = fixture({ followUp: ["same", "same"] });
  const result = mutatePiRuntimeFollowUpQueue(session, editRequest(session, 1, "changed"));
  assert.equal(result.mutated, true, "duplicate text is safe when the requested index and complete snapshot match");
  assert.deepEqual(session._followUpMessages, ["same", "changed"]);
  assert.equal(eventCount(), 1);
}

for (const staleMutation of [
  (session) => { session._followUpMessages.push("new"); session.agent.followUpQueue.messages.push(queuedMessage("new")); },
  (session) => { session._followUpMessages.shift(); session.agent.followUpQueue.messages.shift(); },
  (session) => { session._followUpMessages.reverse(); session.agent.followUpQueue.messages.reverse(); },
]) {
  const { session, eventCount } = fixture();
  const request = editRequest(session, 1, "edited");
  staleMutation(session);
  const before = structuredClone({ tracking: session._followUpMessages, messages: session.agent.followUpQueue.messages });
  const result = mutatePiRuntimeFollowUpQueue(session, request);
  assert.equal(result.mutated, false);
  assert.equal(result.reason, "queue-changed", "a stale full snapshot is rejected");
  assert.deepEqual({ tracking: session._followUpMessages, messages: session.agent.followUpQueue.messages }, before, "stale mutations leave paired arrays untouched");
  assert.equal(eventCount(), 0, "stale mutations emit no queue update");
}

{
  const { session, eventCount } = fixture();
  session.agent.followUpQueue.messages[1] = queuedMessage("different");
  const before = structuredClone({ tracking: session._followUpMessages, messages: session.agent.followUpQueue.messages });
  const result = mutatePiRuntimeFollowUpQueue(session, editRequest(session, 1, "edited"));
  assert.equal(result.reason, "queue-desynchronized");
  assert.deepEqual({ tracking: session._followUpMessages, messages: session.agent.followUpQueue.messages }, before);
  assert.equal(eventCount(), 0);
}

for (const requestFor of [
  (session) => ({ ...editRequest(session, 1, ""), operation: { ...editRequest(session, 1, "").operation, text: "   " } }),
  (session) => editRequest(session, 99, "edited"),
  (session) => moveRequest(session, 0, 0),
  (session) => moveRequest(session, 0, 99),
  (session) => ({ ...editRequest(session, 1, "edited"), source: "webui-compaction" }),
  (session) => ({ ...editRequest(session, 1, "edited"), kind: "steering" }),
]) {
  const { session, eventCount } = fixture();
  const before = structuredClone({ tracking: session._followUpMessages, messages: session.agent.followUpQueue.messages });
  const result = mutatePiRuntimeFollowUpQueue(session, requestFor(session));
  assert.equal(result.mutated, false);
  assert.equal(result.reason, "invalid-request");
  assert.deepEqual({ tracking: session._followUpMessages, messages: session.agent.followUpQueue.messages }, before);
  assert.equal(eventCount(), 0, "invalid mutations emit no queue update");
}

{
  const { session, eventCount } = fixture();
  session.agent.followUpQueue.messages[0].content.push({ type: "text", text: "unexpected" });
  const result = mutatePiRuntimeFollowUpQueue(session, editRequest(session, 0, "edited"));
  assert.equal(result.reason, "queue-desynchronized", "unknown message text layouts fail closed");
  assert.equal(eventCount(), 0);
}

{
  const result = mutatePiRuntimeFollowUpQueue({}, { source: "pi-runtime", kind: "followUp", expected: { steering: [], followUp: [] }, operation: { type: "edit", index: 0, expectedText: "x", text: "y" } });
  assert.deepEqual(result, { mutated: false, reason: "queue-unsupported", queue: { source: "pi-runtime", steering: [], followUp: [] } }, "missing private Pi structures fail closed");
}

console.log("queue-mutation-contract.test.mjs passed");
