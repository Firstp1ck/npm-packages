function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function entryId(entry) {
  return nonEmptyString(entry?.id);
}

function assistantToolCallId(part) {
  return nonEmptyString(part?.id) || nonEmptyString(part?.toolCallId);
}

function toolResultCallId(message) {
  return nonEmptyString(message?.toolCallId);
}

function toolName(record) {
  return nonEmptyString(record?.toolName) || nonEmptyString(record?.name);
}

function targetFor(toolCallId, name = "") {
  return {
    toolCallId,
    toolName: name,
    startEntryId: null,
    finishEntryId: null,
  };
}

/**
 * Extract minimal tool-call boundaries from persisted Pi session entries.
 * Duplicate boundaries are resolved deterministically by keeping the first
 * persisted entry ID for each boundary.
 */
export function sessionTreeEventTargets(entries) {
  if (!Array.isArray(entries)) return [];

  const targets = new Map();
  for (const entry of entries) {
    const persistedEntryId = entryId(entry);
    if (!persistedEntryId || entry?.type !== "message") continue;

    const message = entry.message;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type !== "toolCall") continue;
        const toolCallId = assistantToolCallId(part);
        if (!toolCallId) continue;
        const existing = targets.get(toolCallId);
        const target = existing || targetFor(toolCallId, toolName(part));
        if (!target.toolName) target.toolName = toolName(part);
        if (!target.startEntryId) target.startEntryId = persistedEntryId;
        if (!existing) targets.set(toolCallId, target);
      }
      continue;
    }

    if (message?.role === "toolResult") {
      const toolCallId = toolResultCallId(message);
      if (!toolCallId) continue;
      const existing = targets.get(toolCallId);
      const target = existing || targetFor(toolCallId, toolName(message));
      if (!target.toolName) target.toolName = toolName(message);
      if (!target.finishEntryId) target.finishEntryId = persistedEntryId;
      if (!existing) targets.set(toolCallId, target);
    }
  }

  return [...targets.values()];
}
