const INTERCOM_TOOL_NAME = "intercom";
const INTERCOM_CUSTOM_TYPE = "intercom_message";

function normalizedToolName(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "";
  const candidate = record.toolName || record.name || record.toolCall?.toolName || record.toolCall?.name;
  return typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
}

function normalizedId(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function assistantToolCallId(part) {
  return normalizedId(part?.id ?? part?.toolCallId ?? part?.tool_call_id
    ?? part?.toolCall?.id ?? part?.toolCall?.toolCallId ?? part?.toolCall?.tool_call_id);
}

function directToolCallId(message) {
  return normalizedId(message?.toolCallId ?? message?.tool_call_id ?? message?.id
    ?? message?.toolCall?.toolCallId ?? message?.toolCall?.tool_call_id ?? message?.toolCall?.id);
}

function toolResultCallId(message) {
  return normalizedId(message?.toolCallId ?? message?.tool_call_id);
}

function isIntercomToolCallPart(part) {
  return part?.type === "toolCall" && normalizedToolName(part) === INTERCOM_TOOL_NAME;
}

function isDirectIntercomToolCall(message) {
  return message?.role === "toolCall" && normalizedToolName(message) === INTERCOM_TOOL_NAME;
}

function isIntercomCustomMessage(message) {
  return message?.role === "custom" && message.customType === INTERCOM_CUSTOM_TYPE;
}

function isPairedIntercomToolResult(message, intercomToolCallIds) {
  if (message?.role !== "toolResult") return false;
  if (normalizedToolName(message) === INTERCOM_TOOL_NAME) return true;
  const id = toolResultCallId(message);
  return Boolean(id) && intercomToolCallIds.has(id);
}

function hasMeaningfulAssistantPart(part) {
  if (typeof part === "string") return Boolean(part.trim());
  if (!part || typeof part !== "object") return part !== undefined && part !== null;
  if (part.type === "text") {
    const text = part.text ?? part.content;
    return typeof text !== "string" || Boolean(text.trim());
  }
  if (part.type === "thinking") {
    const thinking = part.thinking ?? part.text ?? part.content;
    return typeof thinking !== "string" || Boolean(thinking.trim());
  }
  return true;
}

/**
 * Remove generic Intercom transport records from a normalized Pi transcript.
 * The input array, messages, and content parts are never mutated.
 */
export function filterIntercomTranscriptMessages(messages) {
  if (!Array.isArray(messages)) return [];

  const intercomToolCallIds = new Set();
  for (const message of messages) {
    if (isDirectIntercomToolCall(message)) {
      const id = directToolCallId(message);
      if (id) intercomToolCallIds.add(id);
    }
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isIntercomToolCallPart(part)) continue;
      const id = assistantToolCallId(part);
      if (id) intercomToolCallIds.add(id);
    }
  }

  const filtered = [];
  for (const message of messages) {
    if (isIntercomCustomMessage(message) || isDirectIntercomToolCall(message) || isPairedIntercomToolResult(message, intercomToolCallIds)) continue;

    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      filtered.push(message);
      continue;
    }

    const content = message.content.filter((part) => !isIntercomToolCallPart(part));
    if (content.length === message.content.length) {
      filtered.push(message);
      continue;
    }
    if (content.some(hasMeaningfulAssistantPart)) filtered.push({ ...message, content });
  }
  return filtered;
}
