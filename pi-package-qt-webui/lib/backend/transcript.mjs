import { renderMarkdown } from "./markdown.mjs";
import { LIMITS, boundedError, boundedString } from "./protocol.mjs";

// Backend-side transcript rows. Two producers feed the same row shape the QML transcript model
// uses: the live event stream (so an inactive tab keeps a bounded transcript the client can
// rebuild from when it is selected) and Pi's persisted message history (so resuming a session
// shows what happened before). The client never re-derives rows from raw Pi messages.

function baseRow(fields) {
  return {
    rowId: fields.rowId,
    messageId: fields.messageId || "",
    role: fields.role,
    kind: fields.kind,
    text: boundedString(fields.text || "", LIMITS.maxMessageCharacters),
    blocksJson: fields.blocksJson || "[]",
    truncated: fields.truncated === true,
    streaming: fields.streaming === true,
    modeLabel: fields.modeLabel || "",
    attachments: fields.attachments || "",
    toolName: fields.toolName || "",
    toolSummary: fields.toolSummary || "",
    toolStatus: fields.toolStatus || "",
    toolDurationMs: fields.toolDurationMs || 0,
    toolOutput: fields.toolOutput || "",
    toolError: fields.toolError || "",
  };
}

export function createTranscriptMirror({ maxRows = LIMITS.maxTranscriptRows } = {}) {
  let rows = [];

  function indexOf(rowId) {
    for (let index = rows.length - 1; index >= 0; index -= 1) if (rows[index].rowId === rowId) return index;
    return -1;
  }

  function append(row) {
    while (rows.length >= maxRows) rows.shift();
    rows.push(baseRow(row));
  }

  function update(rowId, values) {
    const index = indexOf(rowId);
    if (index === -1) return false;
    Object.assign(rows[index], values);
    return true;
  }

  // Mirrors BackendBridge.handleEvent for the row-affecting event types.
  function apply(type, event) {
    switch (type) {
      case "message.user":
        append({ rowId: `user-${event.messageId}`, messageId: event.messageId, role: "user", kind: "user", text: event.text,
          modeLabel: event.mode === "steer" ? "Steering" : event.mode === "followUp" ? "Follow-up" : "",
          attachments: Array.isArray(event.attachments) ? event.attachments.join(", ") : "" });
        break;
      case "part.begin":
        append({ rowId: event.partId, messageId: event.messageId, role: "assistant", kind: event.partKind, text: "", streaming: true });
        break;
      case "part.render": {
        const blocksJson = Array.isArray(event.blocks) ? JSON.stringify(event.blocks) : "[]";
        const values = { text: boundedString(event.text || "", LIMITS.maxMessageCharacters), blocksJson, truncated: event.truncated === true, streaming: event.final !== true };
        if (!update(event.partId, values)) append({ rowId: event.partId, messageId: event.messageId, role: "assistant", kind: event.partKind, ...values });
        break;
      }
      case "part.remove": {
        const index = indexOf(event.partId);
        if (index !== -1) rows.splice(index, 1);
        break;
      }
      case "tool.start":
        append({ rowId: `tool-${event.toolCallId}`, messageId: event.messageId, role: "assistant", kind: "tool", toolName: event.name, toolSummary: event.summary, toolStatus: "running" });
        break;
      case "tool.update":
        update(`tool-${event.toolCallId}`, { toolOutput: boundedString(event.output || "", LIMITS.maxToolOutputCharacters) });
        break;
      case "tool.end": {
        const values = { toolStatus: event.ok ? "ok" : "error", toolDurationMs: Number(event.durationMs) || 0, toolOutput: boundedString(event.output || "", LIMITS.maxToolOutputCharacters), toolError: boundedString(event.error || "", LIMITS.maxErrorCharacters), toolName: event.name || "" };
        if (!update(`tool-${event.toolCallId}`, values)) append({ rowId: `tool-${event.toolCallId}`, role: "assistant", kind: "tool", ...values });
        break;
      }
      case "transcript.reset":
        rows = [];
        break;
      default:
        break;
    }
  }

  function replace(nextRows) {
    rows = nextRows.slice(-maxRows).map(baseRow);
  }

  return {
    apply,
    replace,
    clear() { rows = []; },
    rows() { return rows.map((row) => ({ ...row })); },
    get count() { return rows.length; },
  };
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
}

function safeSummary(args) {
  if (!args || typeof args !== "object") return "";
  const pieces = [];
  for (const [key, value] of Object.entries(args)) {
    if (pieces.length >= 6) {
      pieces.push("…");
      break;
    }
    const rendered = typeof value === "string" ? value.replace(/\s+/g, " ") : typeof value === "number" || typeof value === "boolean" || value === null ? String(value) : Array.isArray(value) ? `[${value.length} items]` : "{…}";
    pieces.push(`${boundedString(key, 32)}=${boundedString(rendered, 96)}`);
  }
  return boundedString(pieces.join("  "), LIMITS.maxToolSummaryCharacters);
}

// Translates Pi's get_messages history into rows. Returns the last maxRows rows plus whether the
// final exchange looks interrupted (a user message without an answer, or an aborted/failed reply)
// so the client can say so instead of presenting the history as complete.
export function rowsFromHistory(messages, { maxRows = LIMITS.maxTranscriptRows } = {}) {
  const rows = [];
  const toolRows = new Map();
  let serial = 0;
  let lastRole = "";
  let lastStopReason = "";
  const push = (row) => {
    rows.push(baseRow(row));
    if (rows.length > maxRows) rows.shift();
  };
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== "object") continue;
    serial += 1;
    if (message.role === "user") {
      const images = Array.isArray(message.content) ? message.content.filter((part) => part && part.type === "image").length : 0;
      push({ rowId: `history-user-${serial}`, messageId: `h${serial}`, role: "user", kind: "user", text: contentText(message.content), attachments: images > 0 ? `${images} image${images === 1 ? "" : "s"}` : "" });
      lastRole = "user";
      lastStopReason = "";
    } else if (message.role === "assistant") {
      const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : Array.isArray(message.content) ? message.content : [];
      let partIndex = 0;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        if (partIndex >= LIMITS.maxPartsPerMessage) break;
        if (part.type === "text" && typeof part.text === "string") {
          partIndex += 1;
          const text = boundedString(part.text, LIMITS.maxMessageCharacters);
          push({ rowId: `history-${serial}.${partIndex}`, messageId: `h${serial}`, role: "assistant", kind: "text", text, blocksJson: JSON.stringify(renderMarkdown(text).blocks), truncated: part.text.length > LIMITS.maxMessageCharacters });
        } else if (part.type === "thinking" && typeof part.thinking === "string") {
          partIndex += 1;
          push({ rowId: `history-${serial}.${partIndex}`, messageId: `h${serial}`, role: "assistant", kind: "thinking", text: boundedString(part.thinking, LIMITS.maxThinkingCharacters), truncated: part.thinking.length > LIMITS.maxThinkingCharacters });
        } else if (part.type === "toolCall") {
          partIndex += 1;
          const toolCallId = boundedString(part.id, LIMITS.maxRequestIdCharacters, `${serial}.${partIndex}`);
          const row = { rowId: `tool-${toolCallId}`, messageId: `h${serial}`, role: "assistant", kind: "tool", toolName: boundedString(part.name, LIMITS.maxToolNameCharacters, "tool"), toolSummary: safeSummary(part.arguments), toolStatus: "running" };
          toolRows.set(toolCallId, row);
          push(row);
        }
      }
      lastRole = "assistant";
      lastStopReason = typeof message.stopReason === "string" ? message.stopReason : "";
    } else if (message.role === "toolResult") {
      const toolCallId = boundedString(message.toolCallId, LIMITS.maxRequestIdCharacters, "");
      const output = boundedString(contentText(message.content), LIMITS.maxToolOutputCharacters);
      const values = { toolStatus: message.isError === true ? "error" : "ok", toolOutput: output, toolError: message.isError === true ? boundedError(output || "Tool failed") : "" };
      const existing = rows.find((row) => row.rowId === `tool-${toolCallId}`);
      if (existing) Object.assign(existing, values);
      else if (toolRows.has(toolCallId)) Object.assign(toolRows.get(toolCallId), values);
      lastRole = "toolResult";
    } else if (message.role === "bashExecution") {
      push({ rowId: `history-bash-${serial}`, messageId: `h${serial}`, role: "assistant", kind: "tool", toolName: "bash", toolSummary: boundedString(`command=${String(message.command ?? "").replace(/\s+/g, " ")}`, LIMITS.maxToolSummaryCharacters),
        toolStatus: message.exitCode === 0 && message.cancelled !== true ? "ok" : "error", toolOutput: boundedString(message.output, LIMITS.maxToolOutputCharacters), toolError: message.cancelled === true ? "Cancelled" : message.exitCode === 0 ? "" : `Exit code ${message.exitCode}` });
      lastRole = "bashExecution";
    }
  }
  // Tool calls that never received a result are reported as interrupted rather than running.
  for (const row of rows) if (row.kind === "tool" && row.toolStatus === "running") {
    row.toolStatus = "error";
    row.toolError = "No result was recorded (interrupted)";
  }
  const interrupted = lastRole === "user" || lastRole === "toolResult" || lastStopReason === "aborted" || lastStopReason === "error";
  return { rows, interrupted, messageCount: serial };
}
