// Versioned JSON-lines protocol between the Quickshell QML client and the Node backend.
//
// Every frame is one JSON object terminated by "\n". Requests flow from QML to the backend,
// responses answer exactly one request by id, and events are unsolicited backend records.
// All numeric budgets used by both processes live here so tests can exercise each limit.

export const PROTOCOL_VERSION = 1;

export const LIMITS = Object.freeze({
  // Framing
  maxInboundFrameBytes: 256 * 1024,
  maxOutboundFrameBytes: 256 * 1024,
  maxPiFrameBytes: 4 * 1024 * 1024,
  // Outbound event queue while the QML consumer is slow
  maxQueuedRecords: 2000,
  maxQueuedBytes: 4 * 1024 * 1024,
  // Request handling
  maxPendingRequests: 64,
  maxRequestIdCharacters: 96,
  requestTimeoutMs: Object.freeze({
    hello: 5_000,
    prompt: 30_000,
    abort: 10_000,
    state: 10_000,
    restart: 20_000,
    extension_response: 5_000,
    settings_get: 5_000,
    settings_set: 5_000,
    open_link: 5_000,
    notify: 5_000,
    shutdown: 5_000,
    debug_crash: 5_000,
    models_list: 10_000,
    model_set: 10_000,
    model_cycle: 10_000,
    thinking_levels: 5_000,
    thinking_set: 5_000,
    thinking_cycle: 5_000,
    compact: 120_000,
  }),
  // Pi lifecycle
  piStartupReadinessMs: 15_000,
  promptReconciliationMs: 150,
  shutdownGraceMs: 3_000,
  // Transcript content
  maxTranscriptRows: 80,
  maxMessageCharacters: 8192,
  maxThinkingCharacters: 8192,
  maxErrorCharacters: 512,
  maxRuntimeInfoCharacters: 160,
  maxPartsPerMessage: 64,
  maxToolSummaryCharacters: 256,
  maxToolOutputCharacters: 4096,
  maxToolNameCharacters: 64,
  renderCadenceMs: 80,
  // Markdown
  maxMarkdownInputCharacters: 8192,
  maxMarkdownBlocks: 200,
  maxMarkdownDepth: 4,
  maxTableRows: 50,
  maxTableColumns: 12,
  maxListItems: 200,
  // Extension dialogs
  maxPendingDialogs: 16,
  maxDialogOptions: 64,
  maxDialogOptionCharacters: 256,
  maxDialogTitleCharacters: 256,
  maxDialogMessageCharacters: 4096,
  maxDialogValueCharacters: 16 * 1024,
  // Notifications and links
  maxNotificationCharacters: 256,
  maxLinkUrlCharacters: 2048,
  // Settings
  maxSettingsFileBytes: 64 * 1024,
  // Extension status chips (structured footer payloads)
  maxStatusChips: 18,
  maxStatusChipCharacters: 64,
  // Notices and queues
  maxNoticeCharacters: 512,
  maxQueueEntries: 32,
  maxQueueEntryCharacters: 256,
  // Models, thinking levels, and manual compaction
  maxModels: 256,
  maxProviderCharacters: 64,
  maxModelIdCharacters: 128,
  maxModelNameCharacters: 96,
  maxThinkingLevels: 8,
  maxCompactionInstructionCharacters: 1024,
  maxCompactionSummaryCharacters: 512,
});

// Every thinking level Pi can report; a model exposes a subset through get_available_thinking_levels.
export const THINKING_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export const ALLOWED_LINK_SCHEMES = Object.freeze(["http:", "https:", "mailto:"]);

export const REQUEST_TYPES = Object.freeze(Object.keys(LIMITS.requestTimeoutMs));

export const SETTINGS_SCHEMA = Object.freeze({
  compactTranscript: { type: "boolean", default: false },
  showThinking: { type: "boolean", default: true },
  desktopNotifications: { type: "boolean", default: true },
});

export class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function boundedString(value, limit, fallback = "") {
  const text = typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

// Terminal escape sequences (colors, cursor moves, OSC titles) never reach the QML side as text.
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|\[\d{1,3}(?:;\d{1,3}){1,5}m/g;

export function stripAnsi(value) {
  return String(value ?? "").replace(ANSI_PATTERN, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

export function boundedError(value) {
  return boundedString(value, LIMITS.maxErrorCharacters, "Unknown error");
}

function validateRequestId(id) {
  if (typeof id !== "string" || id.length === 0) throw new ProtocolError("invalid_request", "request id must be a non-empty string");
  if (id.length > LIMITS.maxRequestIdCharacters) throw new ProtocolError("invalid_request", "request id is too long");
  return id;
}

function requireString(request, field, limit) {
  const value = request[field];
  if (typeof value !== "string") throw new ProtocolError("invalid_request", `${request.type} requires a string ${field}`);
  if (value.length > limit) throw new ProtocolError("limit_exceeded", `${field} exceeds ${limit} characters`);
  return value;
}

// Validates one decoded inbound frame and returns a normalized request. Throws ProtocolError.
export function validateRequest(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    throw new ProtocolError("invalid_request", "request must be a JSON object");
  }
  if (frame.v !== PROTOCOL_VERSION) {
    throw new ProtocolError("unsupported_version", `unsupported protocol version ${String(frame.v)}`);
  }
  const id = validateRequestId(frame.id);
  const type = frame.type;
  if (typeof type !== "string" || !REQUEST_TYPES.includes(type)) {
    throw new ProtocolError("unknown_request", `unknown request type ${String(type)}`);
  }
  const request = { id, type };
  switch (type) {
    case "prompt": {
      request.message = requireString(frame, "message", LIMITS.maxMessageCharacters);
      if (request.message.trim().length === 0) throw new ProtocolError("invalid_request", "prompt message is empty");
      const mode = frame.mode ?? "send";
      if (!["send", "steer", "followUp"].includes(mode)) throw new ProtocolError("invalid_request", "prompt mode must be send, steer, or followUp");
      request.mode = mode;
      break;
    }
    case "extension_response": {
      request.requestId = requireString(frame, "requestId", LIMITS.maxRequestIdCharacters);
      const answered = ["value", "confirmed", "cancelled"].filter((key) => frame[key] !== undefined);
      if (answered.length !== 1) throw new ProtocolError("invalid_request", "extension response needs exactly one of value, confirmed, cancelled");
      if (frame.value !== undefined) request.value = requireString(frame, "value", LIMITS.maxDialogValueCharacters);
      if (frame.confirmed !== undefined) {
        if (typeof frame.confirmed !== "boolean") throw new ProtocolError("invalid_request", "confirmed must be boolean");
        request.confirmed = frame.confirmed;
      }
      if (frame.cancelled !== undefined) {
        if (frame.cancelled !== true) throw new ProtocolError("invalid_request", "cancelled must be true when present");
        request.cancelled = true;
      }
      break;
    }
    case "settings_set": {
      if (!frame.values || typeof frame.values !== "object" || Array.isArray(frame.values)) {
        throw new ProtocolError("invalid_request", "settings_set requires a values object");
      }
      request.values = {};
      for (const [key, value] of Object.entries(frame.values)) {
        const schema = SETTINGS_SCHEMA[key];
        if (!schema) throw new ProtocolError("invalid_request", `unknown setting ${key}`);
        if (typeof value !== schema.type) throw new ProtocolError("invalid_request", `setting ${key} must be ${schema.type}`);
        request.values[key] = value;
      }
      break;
    }
    case "open_link": {
      request.url = requireString(frame, "url", LIMITS.maxLinkUrlCharacters);
      break;
    }
    case "notify": {
      request.title = requireString(frame, "title", LIMITS.maxNotificationCharacters);
      request.body = frame.body === undefined ? "" : requireString(frame, "body", LIMITS.maxNotificationCharacters);
      break;
    }
    case "model_set": {
      request.provider = requireString(frame, "provider", LIMITS.maxProviderCharacters);
      request.modelId = requireString(frame, "modelId", LIMITS.maxModelIdCharacters);
      if (request.provider.trim().length === 0 || request.modelId.trim().length === 0) {
        throw new ProtocolError("invalid_request", "model_set requires a provider and a modelId");
      }
      break;
    }
    case "thinking_set": {
      const level = frame.level;
      if (typeof level !== "string" || !THINKING_LEVELS.includes(level)) {
        throw new ProtocolError("invalid_request", `thinking level must be one of ${THINKING_LEVELS.join(", ")}`);
      }
      request.level = level;
      break;
    }
    case "compact": {
      request.instructions = frame.instructions === undefined ? "" : requireString(frame, "instructions", LIMITS.maxCompactionInstructionCharacters);
      break;
    }
    default:
      break;
  }
  return request;
}

export function encodeFrame(record) {
  return `${JSON.stringify(record)}\n`;
}

export function makeResponse(id, data = null) {
  return { v: PROTOCOL_VERSION, kind: "response", id, ok: true, data };
}

export function makeErrorResponse(id, code, message) {
  return { v: PROTOCOL_VERSION, kind: "response", id, ok: false, error: { code, message: boundedError(message) } };
}

const RESERVED_FRAME_KEYS = ["v", "kind", "type", "id"];

export function makeEvent(type, payload = {}) {
  for (const key of RESERVED_FRAME_KEYS) {
    if (key in payload) throw new Error(`event payload for ${type} must not use the reserved frame key ${key}`);
  }
  return { v: PROTOCOL_VERSION, kind: "event", type, ...payload };
}

// Parses an external link and returns the normalized URL, or null when the scheme or shape is disallowed.
export function safeExternalLink(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > LIMITS.maxLinkUrlCharacters) return null;
  if (/[\u0000-\u0020\u007f]/.test(value)) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!ALLOWED_LINK_SCHEMES.includes(parsed.protocol)) return null;
  if (parsed.protocol !== "mailto:" && parsed.hostname.length === 0) return null;
  if (parsed.username.length > 0 || parsed.password.length > 0) return null;
  return parsed.href;
}
