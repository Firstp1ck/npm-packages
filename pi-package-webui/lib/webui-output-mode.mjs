export const OUTPUT_MODE_NORMAL = "normal";
export const OUTPUT_MODE_COMPACT_V1 = "compact-v1";
export const OUTPUT_MODE_PROTOCOL_VERSION = 1;

const OUTPUT_MODES = new Set([OUTPUT_MODE_NORMAL, OUTPUT_MODE_COMPACT_V1]);
const COMPACT_MESSAGE_UPDATE_TYPES = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);
const COMPACT_SELF_CONTAINED_END_TYPES = new Set(["text_end", "thinking_end", "toolcall_end", "tool_call_end"]);
const SEMANTIC_BARRIER_TYPES = new Set([
  "message_end",
  "tool_execution_end",
  "agent_end",
  "agent_settled",
  "compaction_end",
  "pi_process_exit",
  "pi_process_error",
]);

function cleanOutputMode(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasProtocolVersionOne(value) {
  return value === OUTPUT_MODE_PROTOCOL_VERSION || value === String(OUTPUT_MODE_PROTOCOL_VERSION);
}

function directSelfContainedEnd(update) {
  if (!COMPACT_SELF_CONTAINED_END_TYPES.has(update?.type)) return false;
  return Object.prototype.hasOwnProperty.call(update, "content")
    || Object.prototype.hasOwnProperty.call(update, "toolCall")
    || Object.prototype.hasOwnProperty.call(update, "error")
    || Object.prototype.hasOwnProperty.call(update, "isError");
}

function compactAssistantMessageUpdate(event) {
  if (!event || typeof event !== "object" || event.type !== "message_update") return null;
  const update = event.assistantMessageEvent;
  if (!update || typeof update !== "object" || Array.isArray(update)) return null;

  const hasDirectDelta = COMPACT_MESSAGE_UPDATE_TYPES.has(update.type) && typeof update.delta === "string";
  if (!hasDirectDelta && !directSelfContainedEnd(update)) return null;

  const compactUpdate = { ...update };
  delete compactUpdate.partial;
  const compactEvent = { ...event, assistantMessageEvent: compactUpdate };
  delete compactEvent.message;
  return compactEvent;
}

export function normalizeOutputMode(value, fallback = OUTPUT_MODE_NORMAL) {
  const normalizedFallback = OUTPUT_MODES.has(cleanOutputMode(fallback)) ? cleanOutputMode(fallback) : OUTPUT_MODE_NORMAL;
  const normalizedValue = cleanOutputMode(value);
  return OUTPUT_MODES.has(normalizedValue) ? normalizedValue : normalizedFallback;
}

export function resolveOutputModeDefault({ cliMode, envMode, persistedMode } = {}) {
  const cli = cleanOutputMode(cliMode);
  if (OUTPUT_MODES.has(cli)) return { mode: cli, source: "cli" };
  const env = cleanOutputMode(envMode);
  if (OUTPUT_MODES.has(env)) return { mode: env, source: "env" };
  const persisted = cleanOutputMode(persistedMode);
  if (OUTPUT_MODES.has(persisted)) return { mode: persisted, source: "persisted" };
  return { mode: OUTPUT_MODE_NORMAL, source: "normal" };
}

export function negotiateOutputMode({ requestedMode, protocolVersion, serverDefault } = {}) {
  const protocolAccepted = hasProtocolVersionOne(protocolVersion);
  const requested = cleanOutputMode(requestedMode);
  const validRequest = protocolAccepted && ["auto", OUTPUT_MODE_NORMAL, OUTPUT_MODE_COMPACT_V1].includes(requested);
  if (!validRequest) {
    return {
      requestedMode: OUTPUT_MODE_NORMAL,
      protocolVersion: 0,
      activeMode: OUTPUT_MODE_NORMAL,
    };
  }

  return {
    requestedMode: requested,
    protocolVersion: OUTPUT_MODE_PROTOCOL_VERSION,
    activeMode: requested === "auto" ? normalizeOutputMode(serverDefault) : requested,
  };
}

export function browserOutputEvent(event, { outputMode = OUTPUT_MODE_NORMAL } = {}) {
  if (normalizeOutputMode(outputMode) !== OUTPUT_MODE_COMPACT_V1) return event;
  if (event?.type === "tool_execution_update") return undefined;
  return compactAssistantMessageUpdate(event) || event;
}

export function encodeBrowserSseEvent(event, { outputMode = OUTPUT_MODE_NORMAL } = {}) {
  const browserEvent = browserOutputEvent(event, { outputMode });
  return browserEvent === undefined ? undefined : JSON.stringify(browserEvent);
}

export function isOutputModeSemanticBarrier(event) {
  return SEMANTIC_BARRIER_TYPES.has(event?.type);
}
