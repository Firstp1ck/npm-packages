const MESSAGE_UPDATE_KINDS = Object.freeze({
  thinking_start: "thinking",
  thinking_delta: "thinking",
  thinking_end: "thinking",
  text_start: "text",
  text_delta: "text",
  text_end: "text",
  toolcall_start: "tool-call",
  toolcall_delta: "tool-call",
  toolcall_end: "tool-call",
  error: "stream-error",
});

const COALESCIBLE_DELTA_TYPES = new Set(["thinking_delta", "text_delta", "toolcall_delta"]);
const DIAGNOSTIC_INDEX_LIMIT = 4096;
export const DEFAULT_STREAM_PENDING_ENTRY_LIMIT = 128;
export const DEFAULT_STREAM_PENDING_BYTE_LIMIT = 256 * 1024;

export const TRANSCRIPT_STREAM_MESSAGE_UPDATE_TYPES = Object.freeze(Object.keys(MESSAGE_UPDATE_KINDS));

/**
 * Keep the longer value when a final snapshot is only a prefix of the text
 * already streamed. Divergent snapshots still win so provider corrections or
 * redactions remain authoritative.
 */
export function reconcileTranscriptThinkingSnapshot(accumulated, snapshot) {
  const previous = typeof accumulated === "string" ? accumulated : "";
  const next = typeof snapshot === "string" ? snapshot : "";
  if (!previous) return next;
  if (!next) return previous;
  if (next.startsWith(previous)) return next;
  if (previous.startsWith(next)) return previous;
  return next;
}

export function classifyTranscriptStreamEvent(event) {
  if (event?.type === "tool_execution_update") {
    return Object.freeze({ kind: "tool-execution", subtype: "tool_execution_update", recognized: true, barrier: false });
  }
  if (event?.type !== "message_update") return null;
  const subtype = typeof event.assistantMessageEvent?.type === "string" ? event.assistantMessageEvent.type : "";
  const kind = MESSAGE_UPDATE_KINDS[subtype];
  if (!kind) return Object.freeze({ kind: "unknown-message-update", subtype, recognized: false, barrier: false });
  return Object.freeze({
    kind,
    subtype,
    recognized: true,
    barrier: subtype.endsWith("_end") || subtype === "error",
  });
}

function defaultNow() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function defaultScheduleFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(callback, 0);
}

function defaultCancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

function positiveLimit(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function eventByteSize(event) {
  try {
    return Math.max(1, JSON.stringify(event).length * 2);
  } catch {
    return DEFAULT_STREAM_PENDING_BYTE_LIMIT;
  }
}

function eventDebugIndex(event) {
  const value = Number(event?.isolationDeltaIndex ?? event?.streamIsolationIndex);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function toolCallIdentity(event) {
  const update = event?.assistantMessageEvent || {};
  return String(event?.toolCallId || update.toolCallId || update.toolCall?.id || update.id || "");
}

function entryCoalesceKey({ event, classification, owner }) {
  if (COALESCIBLE_DELTA_TYPES.has(classification.subtype)) {
    const update = event?.assistantMessageEvent || {};
    if (typeof update.delta !== "string") return "";
    const contentIndex = Number.isInteger(Number(update.contentIndex)) ? Number(update.contentIndex) : "";
    const toolId = classification.subtype === "toolcall_delta" ? toolCallIdentity(event) : "";
    return `${String(owner ?? "")}|${classification.subtype}|${contentIndex}|${toolId}`;
  }
  if (classification.kind === "tool-execution" && event?.partialResult && typeof event.partialResult === "object") {
    const toolId = toolCallIdentity(event);
    return toolId ? `${String(owner ?? "")}|tool-execution|${toolId}` : "";
  }
  return "";
}

function mergedAdjacentEntry(previous, incoming) {
  const previousKey = entryCoalesceKey(previous);
  if (!previousKey || previousKey !== entryCoalesceKey(incoming)) return null;
  if (incoming.classification.kind === "tool-execution") {
    const event = incoming.event;
    return {
      ...incoming,
      event,
      receivedAt: previous.receivedAt !== undefined ? previous.receivedAt : incoming.receivedAt,
      bytes: eventByteSize(event),
      sourceCount: previous.sourceCount + incoming.sourceCount,
      sourceIndexes: [...previous.sourceIndexes, ...incoming.sourceIndexes].slice(-DIAGNOSTIC_INDEX_LIMIT),
    };
  }
  const previousUpdate = previous.event.assistantMessageEvent || {};
  const incomingUpdate = incoming.event.assistantMessageEvent || {};
  const event = {
    ...incoming.event,
    assistantMessageEvent: {
      ...incomingUpdate,
      delta: `${typeof previousUpdate.delta === "string" ? previousUpdate.delta : ""}${typeof incomingUpdate.delta === "string" ? incomingUpdate.delta : ""}`,
    },
  };
  return {
    ...incoming,
    event,
    receivedAt: previous.receivedAt !== undefined ? previous.receivedAt : incoming.receivedAt,
    bytes: eventByteSize(event),
    sourceCount: previous.sourceCount + incoming.sourceCount,
    sourceIndexes: [...previous.sourceIndexes, ...incoming.sourceIndexes].slice(-DIAGNOSTIC_INDEX_LIMIT),
  };
}

/**
 * Owns the bounded frame queue for high-frequency transcript stream events.
 * Adjacent compatible deltas are losslessly coalesced while event-kind and
 * semantic barriers retain server order. Overflow synchronously drains the
 * current batch; a single oversize event is applied directly, never dropped.
 * Every injected sink is transcript-specific and the optional diagnostic hook
 * is inert unless explicitly supplied by a test/debug caller.
 */
export function createStreamOutputController({
  scheduleFrame = defaultScheduleFrame,
  cancelFrame = defaultCancelFrame,
  now = defaultNow,
  isOwnerCurrent = () => true,
  applyTextUpdate = () => {},
  applyThinkingUpdate = () => {},
  applyToolCallUpdate = () => {},
  applyToolExecutionUpdate = () => {},
  applyStreamError = () => {},
  applyFollowScroll = () => {},
  onUnknownStreamEvent = () => {},
  onStaleOwner = () => {},
  onOverflow = () => {},
  onDiagnostic,
  maxPendingEntries,
  maxPendingBytes,
} = {}) {
  if (typeof scheduleFrame !== "function" || typeof cancelFrame !== "function") {
    throw new TypeError("scheduleFrame and cancelFrame must be functions");
  }
  if (typeof now !== "function") throw new TypeError("now must be a function");
  const entryLimit = positiveLimit(maxPendingEntries, DEFAULT_STREAM_PENDING_ENTRY_LIMIT, "maxPendingEntries");
  const byteLimit = positiveLimit(maxPendingBytes, DEFAULT_STREAM_PENDING_BYTE_LIMIT, "maxPendingBytes");
  const diagnosticsEnabled = typeof onDiagnostic === "function";
  const emitDiagnostic = diagnosticsEnabled
    ? (record) => {
        try {
          onDiagnostic(Object.freeze(record));
        } catch {
          // Test/debug instrumentation must never alter stream behavior.
        }
      }
    : () => {};

  let frameHandle = null;
  let pending = [];
  let pendingBytes = 0;

  const ownerIsCurrent = (owner) => owner === undefined || isOwnerCurrent(owner) === true;

  const reportStale = (event, owner, classification, phase) => {
    onStaleOwner(event, owner);
    emitDiagnostic({ type: "stale", phase, owner, kind: classification?.kind || "", subtype: classification?.subtype || "", index: eventDebugIndex(event) });
  };

  const applyEntry = ({ event, classification, owner, sourceCount = 1, sourceIndexes = [] }) => {
    if (!ownerIsCurrent(owner)) {
      reportStale(event, owner, classification, "apply");
      return false;
    }
    let applied = true;
    switch (classification.kind) {
      case "text":
        applyTextUpdate(event, classification);
        break;
      case "thinking":
        applyThinkingUpdate(event, classification);
        break;
      case "tool-call":
        applyToolCallUpdate(event, classification);
        break;
      case "tool-execution":
        applyToolExecutionUpdate(event, classification);
        break;
      case "stream-error":
        applyStreamError(event, classification);
        break;
      default:
        onUnknownStreamEvent(event, classification, owner);
        applied = false;
        break;
    }
    emitDiagnostic({
      type: "apply",
      owner,
      kind: classification.kind,
      subtype: classification.subtype,
      applied,
      sourceCount,
      sourceIndexes: Object.freeze([...sourceIndexes]),
    });
    return applied;
  };

  const drain = () => {
    frameHandle = null;
    if (!pending.length) return 0;
    const entries = pending;
    pending = [];
    pendingBytes = 0;
    // Latency/duration measurement only runs when a diagnostic hook is
    // installed so the disabled hot path never pays for clock reads.
    const drainStart = diagnosticsEnabled ? now() : 0;
    let applied = 0;
    for (const entry of entries) {
      if (applyEntry(entry)) applied += 1;
    }
    if (applied > 0) applyFollowScroll();
    if (diagnosticsEnabled) {
      let maxAgeMs = 0;
      for (const entry of entries) {
        if (typeof entry.receivedAt === "number") maxAgeMs = Math.max(maxAgeMs, drainStart - entry.receivedAt);
      }
      emitDiagnostic({
        type: "batch",
        entries: entries.length,
        sourceCount: entries.reduce((total, entry) => total + entry.sourceCount, 0),
        applied,
        maxAgeMs,
        drainMs: now() - drainStart,
      });
    }
    return applied;
  };

  const schedule = () => {
    if (frameHandle !== null) return;
    frameHandle = scheduleFrame(drain);
  };

  const flush = () => {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    return drain();
  };

  const applyOversize = (entry) => {
    const applyStart = diagnosticsEnabled ? now() : 0;
    const applied = applyEntry(entry) ? 1 : 0;
    if (applied) applyFollowScroll();
    if (diagnosticsEnabled) {
      const maxAgeMs = typeof entry.receivedAt === "number" ? Math.max(0, applyStart - entry.receivedAt) : 0;
      emitDiagnostic({ type: "batch", entries: 1, sourceCount: entry.sourceCount, applied, direct: true, maxAgeMs, drainMs: now() - applyStart });
    }
    return applied;
  };

  const enqueue = (entry) => {
    const last = pending[pending.length - 1];
    const merged = last ? mergedAdjacentEntry(last, entry) : null;
    if (merged && pendingBytes - last.bytes + merged.bytes <= byteLimit) {
      pending[pending.length - 1] = merged;
      pendingBytes = pendingBytes - last.bytes + merged.bytes;
      emitDiagnostic({ type: "queued", coalesced: true, pendingCount: pending.length, pendingBytes, sourceCount: merged.sourceCount });
      return;
    }

    if (merged || pending.length >= entryLimit || pendingBytes + entry.bytes > byteLimit) {
      const reason = merged ? "coalesced-byte-limit" : pending.length >= entryLimit ? "entry-limit" : "byte-limit";
      onOverflow({ reason, pendingCount: pending.length, pendingBytes, incomingBytes: entry.bytes });
      emitDiagnostic({ type: "overflow", reason, pendingCount: pending.length, pendingBytes, incomingBytes: entry.bytes });
      flush();
    }

    if (entry.bytes > byteLimit) {
      onOverflow({ reason: "oversize-event", pendingCount: 0, pendingBytes: 0, incomingBytes: entry.bytes });
      emitDiagnostic({ type: "overflow", reason: "oversize-event", pendingCount: 0, pendingBytes: 0, incomingBytes: entry.bytes });
      applyOversize(entry);
      return;
    }

    pending.push(entry);
    pendingBytes += entry.bytes;
    emitDiagnostic({ type: "queued", coalesced: false, pendingCount: pending.length, pendingBytes, sourceCount: entry.sourceCount });
  };

  return Object.freeze({
    dispatch(event, { owner } = {}) {
      const classification = classifyTranscriptStreamEvent(event);
      if (!classification) return false;
      const index = eventDebugIndex(event);
      emitDiagnostic({ type: "receipt", owner, kind: classification.kind, subtype: classification.subtype, index });
      if (!ownerIsCurrent(owner)) {
        reportStale(event, owner, classification, "dispatch");
        return true;
      }
      const entry = {
        event,
        classification,
        owner,
        receivedAt: diagnosticsEnabled ? now() : undefined,
        bytes: eventByteSize(event),
        sourceCount: 1,
        sourceIndexes: diagnosticsEnabled && index !== null ? [index] : [],
      };
      enqueue(entry);
      if (classification.barrier) {
        emitDiagnostic({ type: "barrier", reason: classification.subtype, pendingCount: pending.length, pendingBytes });
        flush();
      } else if (pending.length) {
        schedule();
      }
      return true;
    },
    flush,
    barrier(reason = "semantic") {
      emitDiagnostic({ type: "barrier", reason: String(reason || "semantic"), pendingCount: pending.length, pendingBytes });
      return flush();
    },
    cancel(owner) {
      if (owner === undefined) pending = [];
      else pending = pending.filter((entry) => entry.owner !== owner);
      pendingBytes = pending.reduce((total, entry) => total + entry.bytes, 0);
      if (!pending.length && frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
      emitDiagnostic({ type: "cancel", owner, pendingCount: pending.length, pendingBytes });
    },
    pendingCount() {
      return pending.length;
    },
    pendingBytes() {
      return pendingBytes;
    },
    limits() {
      return Object.freeze({ maxPendingEntries: entryLimit, maxPendingBytes: byteLimit });
    },
    hasScheduledFrame() {
      return frameHandle !== null;
    },
  });
}
