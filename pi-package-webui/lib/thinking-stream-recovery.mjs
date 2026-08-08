const COMPLETED_RECOVERY_LIMIT = 128;

function text(value) {
  return typeof value === "string" ? value : "";
}

function thinkingContentIndex(event = {}, update = event.assistantMessageEvent || {}) {
  const value = update.contentIndex ?? event.contentIndex;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function thinkingPart(part) {
  return !!(part && typeof part === "object" && (part.type === "thinking" || typeof part.thinking === "string"));
}

function thinkingPartText(part) {
  if (!thinkingPart(part)) return "";
  return text(part.thinking) || text(part.content) || text(part.text);
}

function messageThinkingAt(message, contentIndex) {
  if (!Array.isArray(message?.content)) return "";
  return thinkingPartText(message.content[contentIndex]);
}

function messageThinkingTemplateAt(message, contentIndex) {
  if (!Array.isArray(message?.content)) return null;
  const part = message.content[contentIndex];
  return thinkingPart(part) ? part : null;
}

/**
 * Prefer the longer value only when the two snapshots are prefix-compatible.
 * Divergent authoritative content wins so provider corrections/redactions are
 * never silently overwritten by an earlier stream accumulator.
 */
export function reconcileThinkingSnapshot(accumulated, snapshot) {
  const previous = text(accumulated);
  const next = text(snapshot);
  if (!previous) return next;
  if (!next) return previous;
  if (next.startsWith(previous)) return next;
  if (previous.startsWith(next)) return previous;
  return next;
}

function replaceThinkingAt(message, contentIndex, recovered, template = null) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content) || !recovered) return message;
  const current = message.content[contentIndex];
  let replacement = null;
  if (thinkingPart(current)) {
    replacement = { ...current, type: current.type || "thinking", thinking: recovered };
  } else if (thinkingPart(template) && contentIndex <= message.content.length) {
    replacement = { ...template, type: template.type || "thinking", thinking: recovered };
  }
  if (!replacement) return message;
  const content = [...message.content];
  if (contentIndex < content.length) content[contentIndex] = replacement;
  else content.push(replacement);
  return { ...message, content };
}

function recoveryKey(timestamp, contentIndex) {
  if (timestamp === undefined || timestamp === null || timestamp === "") return "";
  return `${String(timestamp)}|${contentIndex}`;
}

export class ThinkingStreamRecovery {
  #active = new Map();
  #completed = new Map();

  ingest(rawEvent) {
    if (!rawEvent || typeof rawEvent !== "object") return rawEvent;
    const event = rawEvent;
    if (event.type === "message_start" && event.message?.role === "assistant") {
      this.#active.clear();
      return event;
    }
    if (event.type === "message_update") return this.#ingestUpdate(event);
    if (event.type === "message_end" && event.message?.role === "assistant") return this.#ingestEnd(event);
    return event;
  }

  applyToMessages(messages) {
    if (!Array.isArray(messages) || this.#completed.size === 0) return messages;
    let changed = false;
    const recoveredMessages = messages.map((message) => {
      if (message?.role !== "assistant") return message;
      let recoveredMessage = message;
      for (const record of this.#completed.values()) {
        if (record.timestamp !== String(message.timestamp ?? "")) continue;
        const authoritative = messageThinkingAt(recoveredMessage, record.contentIndex);
        const recovered = reconcileThinkingSnapshot(record.text, authoritative);
        if (recovered !== authoritative) {
          recoveredMessage = replaceThinkingAt(recoveredMessage, record.contentIndex, recovered, record.template);
        }
      }
      if (recoveredMessage !== message) changed = true;
      return recoveredMessage;
    });
    return changed ? recoveredMessages : messages;
  }

  #ingestUpdate(event) {
    const update = event.assistantMessageEvent;
    if (!update || typeof update !== "object" || !["thinking_start", "thinking_delta", "thinking_end"].includes(update.type)) return event;
    const contentIndex = thinkingContentIndex(event, update);
    const existing = this.#active.get(contentIndex) || { text: "", template: null };
    const partialText = messageThinkingAt(update.partial, contentIndex);
    const direct = text(update.content) || text(update.thinking);
    const delta = text(update.delta);
    const template = messageThinkingTemplateAt(update.partial, contentIndex) || existing.template;
    let recovered = existing.text;

    if (update.type === "thinking_delta") {
      const appended = recovered + delta;
      recovered = partialText ? reconcileThinkingSnapshot(appended, partialText) : appended;
    } else {
      recovered = reconcileThinkingSnapshot(recovered, direct || partialText || delta);
    }
    this.#active.set(contentIndex, { text: recovered, template });

    if (update.type !== "thinking_end" || !recovered) return event;
    const authoritative = direct || partialText || delta;
    if (recovered === authoritative && (!delta || delta === recovered)) return event;
    const patchedUpdate = { ...update, content: recovered };
    if (Object.prototype.hasOwnProperty.call(patchedUpdate, "delta")) patchedUpdate.delta = recovered;
    if (update.partial) patchedUpdate.partial = replaceThinkingAt(update.partial, contentIndex, recovered, template);
    return { ...event, assistantMessageEvent: patchedUpdate };
  }

  #ingestEnd(event) {
    let message = event.message;
    for (const [contentIndex, record] of this.#active) {
      if (!record.text) continue;
      const authoritative = messageThinkingAt(message, contentIndex);
      const recovered = reconcileThinkingSnapshot(record.text, authoritative);
      if (recovered !== authoritative) message = replaceThinkingAt(message, contentIndex, recovered, record.template);
      const key = recoveryKey(message.timestamp, contentIndex);
      if (key) this.#rememberCompleted(key, {
        timestamp: String(message.timestamp),
        contentIndex,
        text: recovered,
        template: record.template,
      });
    }
    this.#active.clear();
    return message === event.message ? event : { ...event, message };
  }

  #rememberCompleted(key, record) {
    this.#completed.delete(key);
    this.#completed.set(key, record);
    while (this.#completed.size > COMPLETED_RECOVERY_LIMIT) this.#completed.delete(this.#completed.keys().next().value);
  }
}
