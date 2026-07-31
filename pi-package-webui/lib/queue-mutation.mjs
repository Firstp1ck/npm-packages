export const PI_RUNTIME_QUEUE_SOURCE = "pi-runtime";

function queueSnapshot(steering, followUp) {
  return {
    source: PI_RUNTIME_QUEUE_SOURCE,
    steering: [...steering],
    followUp: [...followUp],
  };
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactMessageText(message) {
  if (!message || typeof message !== "object" || !Array.isArray(message.content)) return undefined;
  const textParts = message.content.filter((part) => part?.type === "text");
  if (textParts.length !== 1 || typeof textParts[0].text !== "string") return undefined;
  return textParts[0].text;
}

function matchingQueueMessages(tracked, messages) {
  return Array.isArray(messages)
    && tracked.length === messages.length
    && messages.every((message, index) => exactMessageText(message) === tracked[index]);
}

function mutationFailure(reason, steering, followUp) {
  return { mutated: false, reason, queue: queueSnapshot(steering, followUp) };
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validExpectedSnapshot(expected) {
  return expected
    && typeof expected === "object"
    && isStringArray(expected.steering)
    && isStringArray(expected.followUp);
}

function validIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value < length;
}

/**
 * Mutate the paired private AgentSession follow-up structures synchronously.
 * The installed Pi runtime exposes no public item mutation API, so unknown
 * queue/message layouts deliberately fail closed before either array changes.
 */
export function mutatePiRuntimeFollowUpQueue(session, payload = {}) {
  const steering = session?._steeringMessages;
  const followUp = session?._followUpMessages;
  const steeringMessages = session?.agent?.steeringQueue?.messages;
  const followUpMessages = session?.agent?.followUpQueue?.messages;
  if (!Array.isArray(steering) || !Array.isArray(followUp)
    || !Array.isArray(steeringMessages) || !Array.isArray(followUpMessages)
    || typeof session?._emitQueueUpdate !== "function") {
    return { mutated: false, reason: "queue-unsupported", queue: { source: PI_RUNTIME_QUEUE_SOURCE, steering: [], followUp: [] } };
  }

  const current = queueSnapshot(steering, followUp);
  if (!matchingQueueMessages(steering, steeringMessages) || !matchingQueueMessages(followUp, followUpMessages)) {
    return mutationFailure("queue-desynchronized", steering, followUp);
  }
  if (payload?.source !== PI_RUNTIME_QUEUE_SOURCE || payload?.kind !== "followUp" || !validExpectedSnapshot(payload.expected)) {
    return mutationFailure("invalid-request", steering, followUp);
  }
  if (!arraysEqual(payload.expected.steering, steering) || !arraysEqual(payload.expected.followUp, followUp)) {
    return mutationFailure("queue-changed", steering, followUp);
  }

  const operation = payload.operation;
  if (!operation || typeof operation !== "object" || typeof operation.expectedText !== "string") {
    return mutationFailure("invalid-request", steering, followUp);
  }

  const nextTracked = [...followUp];
  const nextMessages = [...followUpMessages];
  if (operation.type === "edit") {
    if (!validIndex(operation.index, followUp.length) || followUp[operation.index] !== operation.expectedText
      || typeof operation.text !== "string" || !operation.text.trim()) {
      return mutationFailure("invalid-request", steering, followUp);
    }
    const original = followUpMessages[operation.index];
    const textPartIndex = original.content.findIndex((part) => part?.type === "text");
    const nextContent = original.content.map((part, index) => index === textPartIndex ? { ...part, text: operation.text } : part);
    nextTracked[operation.index] = operation.text;
    nextMessages[operation.index] = { ...original, content: nextContent };
  } else if (operation.type === "move") {
    if (!validIndex(operation.from, followUp.length) || !validIndex(operation.to, followUp.length)
      || operation.from === operation.to || followUp[operation.from] !== operation.expectedText) {
      return mutationFailure("invalid-request", steering, followUp);
    }
    const [tracked] = nextTracked.splice(operation.from, 1);
    const [message] = nextMessages.splice(operation.from, 1);
    // `to` is the final zero-based index after the item has been removed.
    nextTracked.splice(operation.to, 0, tracked);
    nextMessages.splice(operation.to, 0, message);
  } else if (operation.type === "delete") {
    if (!validIndex(operation.index, followUp.length) || followUp[operation.index] !== operation.expectedText) {
      return mutationFailure("invalid-request", steering, followUp);
    }
    nextTracked.splice(operation.index, 1);
    nextMessages.splice(operation.index, 1);
  } else {
    return mutationFailure("invalid-request", steering, followUp);
  }

  session._followUpMessages = nextTracked;
  session.agent.followUpQueue.messages = nextMessages;
  session._emitQueueUpdate();
  return { mutated: true, source: PI_RUNTIME_QUEUE_SOURCE, queue: queueSnapshot(steering, nextTracked) };
}
