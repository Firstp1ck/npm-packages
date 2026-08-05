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

export const TRANSCRIPT_STREAM_MESSAGE_UPDATE_TYPES = Object.freeze(Object.keys(MESSAGE_UPDATE_KINDS));

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

function defaultScheduleFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(callback, 0);
}

function defaultCancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

/**
 * Owns the single frame queue for high-frequency transcript stream events.
 * Every injected sink is transcript-specific; the controller has no generic
 * application-state notification and no dependency on DOM or WebUI chrome.
 */
export function createStreamOutputController({
  scheduleFrame = defaultScheduleFrame,
  cancelFrame = defaultCancelFrame,
  isOwnerCurrent = () => true,
  applyTextUpdate = () => {},
  applyThinkingUpdate = () => {},
  applyToolCallUpdate = () => {},
  applyToolExecutionUpdate = () => {},
  applyStreamError = () => {},
  applyFollowScroll = () => {},
  onUnknownStreamEvent = () => {},
  onStaleOwner = () => {},
} = {}) {
  if (typeof scheduleFrame !== "function" || typeof cancelFrame !== "function") {
    throw new TypeError("scheduleFrame and cancelFrame must be functions");
  }

  let frameHandle = null;
  let pending = [];

  const ownerIsCurrent = (owner) => owner === undefined || isOwnerCurrent(owner) === true;

  const applyEntry = ({ event, classification, owner }) => {
    if (!ownerIsCurrent(owner)) {
      onStaleOwner(event, owner);
      return false;
    }
    switch (classification.kind) {
      case "text":
        applyTextUpdate(event, classification);
        return true;
      case "thinking":
        applyThinkingUpdate(event, classification);
        return true;
      case "tool-call":
        applyToolCallUpdate(event, classification);
        return true;
      case "tool-execution":
        applyToolExecutionUpdate(event, classification);
        return true;
      case "stream-error":
        applyStreamError(event, classification);
        return true;
      default:
        onUnknownStreamEvent(event, classification);
        return false;
    }
  };

  const drain = () => {
    frameHandle = null;
    if (!pending.length) return 0;
    const entries = pending;
    pending = [];
    let applied = 0;
    for (const entry of entries) {
      if (applyEntry(entry)) applied += 1;
    }
    if (applied > 0) applyFollowScroll();
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

  return Object.freeze({
    dispatch(event, { owner } = {}) {
      const classification = classifyTranscriptStreamEvent(event);
      if (!classification) return false;
      if (!ownerIsCurrent(owner)) {
        onStaleOwner(event, owner);
        return true;
      }
      pending.push({ event, classification, owner });
      if (classification.barrier) flush();
      else schedule();
      return true;
    },
    flush,
    barrier() {
      return flush();
    },
    cancel(owner) {
      if (owner === undefined) pending = [];
      else pending = pending.filter((entry) => entry.owner !== owner);
      if (!pending.length && frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
    },
    pendingCount() {
      return pending.length;
    },
    hasScheduledFrame() {
      return frameHandle !== null;
    },
  });
}
