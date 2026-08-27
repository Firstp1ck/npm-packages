import { composeMessageWithTexts } from "./attachments.mjs";
import { attachJsonlReader } from "./jsonl.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { LIMITS, ProtocolError, THINKING_LEVELS, boundedError, boundedString, stripAnsi } from "./protocol.mjs";
import { hasExited, spawnOwnedProcess, terminateProcessTree } from "./process-tree.mjs";
import { rowsFromHistory } from "./transcript.mjs";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

// The Pi-side helper extension answers tool, skill, and sampling requests through a command
// prompt and a prefixed notify; see lib/pi-extension/qt-webui-helper.mjs.
export const HELPER_COMMAND = "qt-webui-helper";
export const HELPER_RESPONSE_PREFIX = "__QT_WEBUI_HELPER__";
export const HELPER_EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "pi-extension", "qt-webui-helper.mjs");

// Owns exactly one Pi RPC child and translates its raw records into bounded, typed events.
// The QML client never sees a raw Pi record. All state transitions that used to live in
// PiBridge.qml (prompt acceptance, reconciliation, abort-before-start, provider errors,
// startup readiness, restart) are implemented here so they can be tested without a display.

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const part of content) {
    if (part && part.type === "text" && typeof part.text === "string") text += part.text;
  }
  return text;
}

function safeArgumentSummary(args) {
  if (!args || typeof args !== "object") return "";
  const pieces = [];
  for (const [key, value] of Object.entries(args)) {
    if (pieces.length >= 6) {
      pieces.push("…");
      break;
    }
    let rendered;
    if (typeof value === "string") rendered = value.replace(/\s+/g, " ");
    else if (typeof value === "number" || typeof value === "boolean" || value === null) rendered = String(value);
    else if (Array.isArray(value)) rendered = `[${value.length} items]`;
    else rendered = "{…}";
    pieces.push(`${boundedString(key, 32)}=${boundedString(rendered, 96)}`);
  }
  return boundedString(pieces.join("  "), LIMITS.maxToolSummaryCharacters);
}

// Structured footer payloads (for example from pi-extension-git-footer-status) arrive as JSON
// through setStatus. They are turned into bounded plain-text chips; anything else stays text.
const FOOTER_PAYLOAD_TYPE = "firstpick.git-footer-status.footer";
const HEADER_OWNED_CHIP_KEYS = new Set(["cwd", "model"]);

function footerStatusChips(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw[0] !== "{" || raw.length > LIMITS.maxPiFrameBytes) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.type !== FOOTER_PAYLOAD_TYPE || parsed.version !== 1) return null;
  const chips = [];
  const seen = new Set();
  for (const [group, entries] of [["main", parsed.main], ["meta", parsed.meta]]) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (chips.length >= LIMITS.maxStatusChips) break;
      if (!entry || typeof entry !== "object") continue;
      const key = boundedString(entry.key, 32, "").trim();
      // The window header already shows the workspace and model; do not repeat them as chips.
      if (HEADER_OWNED_CHIP_KEYS.has(key)) continue;
      const label = boundedString(stripAnsi(entry.label), LIMITS.maxStatusChipCharacters, "").trim();
      const value = boundedString(stripAnsi(entry.value), LIMITS.maxStatusChipCharacters, "").trim();
      if (label.length === 0 && value.length === 0) continue;
      const identity = `${label}\u0000${value}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      chips.push({
        group,
        key,
        icon: boundedString(stripAnsi(entry.icon), 4, "").trim(),
        label,
        value,
        title: boundedString(stripAnsi(entry.title), LIMITS.maxNoticeCharacters, "").trim(),
        tone: ["ok", "warning", "error", "muted"].includes(entry.tone) ? entry.tone : "",
      });
    }
  }
  return chips;
}

// Other structured status payloads (JSON objects with a type) are shown by their title so the
// footer never displays raw JSON; the description becomes a tooltip.
function genericStatusPayload(raw) {
  if (typeof raw !== "string" || raw[0] !== "{" || raw.length > LIMITS.maxPiFrameBytes) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") return null;
  const title = boundedString(stripAnsi(parsed.title), LIMITS.maxStatusChipCharacters, "").trim();
  const typeName = parsed.type.split(".").filter(Boolean).slice(-2).join(" ");
  return {
    text: title.length > 0 ? title : boundedString(typeName, LIMITS.maxStatusChipCharacters, "payload"),
    hint: boundedString(stripAnsi(parsed.description), LIMITS.maxNoticeCharacters, "").trim(),
  };
}

// Pi's Model objects carry API endpoints and pricing; the client only needs identity and
// capability flags, each bounded so a large or malformed inventory cannot grow the frame.
export function normalizeModel(model) {
  if (!model || typeof model !== "object") return null;
  const provider = boundedString(stripAnsi(model.provider), LIMITS.maxProviderCharacters, "").trim();
  const id = boundedString(stripAnsi(model.id), LIMITS.maxModelIdCharacters, "").trim();
  if (provider.length === 0 || id.length === 0) return null;
  const input = Array.isArray(model.input) ? model.input.filter((entry) => entry === "text" || entry === "image") : [];
  return {
    provider,
    id,
    name: boundedString(stripAnsi(model.name), LIMITS.maxModelNameCharacters, "").trim(),
    reasoning: model.reasoning === true,
    acceptsImages: input.includes("image"),
    contextWindow: Number.isFinite(model.contextWindow) && model.contextWindow > 0 ? Math.floor(model.contextWindow) : 0,
    maxTokens: Number.isFinite(model.maxTokens) && model.maxTokens > 0 ? Math.floor(model.maxTokens) : 0,
  };
}

export function normalizeModels(list) {
  const models = [];
  const seen = new Set();
  let omitted = 0;
  for (const entry of Array.isArray(list) ? list : []) {
    const model = normalizeModel(entry);
    if (!model) continue;
    const identity = `${model.provider}/${model.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (models.length >= LIMITS.maxModels) {
      omitted += 1;
      continue;
    }
    models.push(model);
  }
  return { models, omitted };
}

export function normalizeModelScope(value) {
  if (!value || typeof value !== "object" || typeof value.explicit !== "boolean" || !Array.isArray(value.items)) return null;
  const items = [];
  const seen = new Set();
  let omitted = Number.isFinite(value.omitted) && value.omitted > 0 ? Math.floor(value.omitted) : 0;
  for (const entry of value.items) {
    if (!entry || typeof entry !== "object") continue;
    const provider = boundedString(stripAnsi(entry.provider), LIMITS.maxProviderCharacters, "").trim();
    const id = boundedString(stripAnsi(entry.id), LIMITS.maxModelIdCharacters, "").trim();
    if (!provider || !id) continue;
    const identity = `${provider}/${id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (items.length >= LIMITS.maxModels * 2) {
      omitted += 1;
      continue;
    }
    items.push({
      provider,
      id,
      thinkingLevel: THINKING_LEVELS.includes(entry.thinkingLevel) ? entry.thinkingLevel : "",
    });
  }
  return { explicit: value.explicit, items: value.explicit ? items : [], omitted: value.explicit ? omitted : 0 };
}

// Only known levels survive, in Pi's canonical order, so the client never shows a level it
// cannot send back through thinking_set.
export function normalizeThinkingLevels(list) {
  const known = new Set((Array.isArray(list) ? list : []).filter((level) => THINKING_LEVELS.includes(level)));
  const levels = THINKING_LEVELS.filter((level) => known.has(level)).slice(0, LIMITS.maxThinkingLevels);
  return levels.length > 0 ? levels : ["off"];
}

// Slash commands from get_commands: extension commands, prompt templates, and skills. Only the
// fields the composer needs survive, each bounded, and duplicates collapse on the name.
export function normalizeCommands(list) {
  const commands = [];
  const seen = new Set();
  let omitted = 0;
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") continue;
    const name = boundedString(stripAnsi(entry.name), LIMITS.maxCommandNameCharacters, "").trim();
    if (name.length === 0 || /\s/.test(name) || seen.has(name)) continue;
    seen.add(name);
    if (commands.length >= LIMITS.maxCommands) {
      omitted += 1;
      continue;
    }
    commands.push({
      name,
      description: boundedString(stripAnsi(entry.description), LIMITS.maxCommandDescriptionCharacters, "").trim(),
      source: ["extension", "prompt", "skill"].includes(entry.source) ? entry.source : "extension",
      location: ["user", "project", "path"].includes(entry.location) ? entry.location : "",
      path: typeof entry.path === "string" && entry.path.startsWith("/") && entry.path.length <= LIMITS.maxPathCharacters ? entry.path : "",
    });
  }
  return { commands, omitted };
}

export function createPiSession({
  nodeExecutable,
  piCliEntry,
  cwd,
  env = process.env,
  emit,
  spawnImpl = spawnOwnedProcess,
  startupReadinessMs = LIMITS.piStartupReadinessMs,
  promptReconciliationMs = LIMITS.promptReconciliationMs,
  renderCadenceMs = LIMITS.renderCadenceMs,
  shutdownGraceMs = LIMITS.shutdownGraceMs,
  requestTimeouts = LIMITS.requestTimeoutMs,
  now = () => Date.now(),
  helperExtensionPath = HELPER_EXTENSION_PATH,
  helperTimeoutMs = LIMITS.helperTimeoutMs,
}) {
  const session = {
    child: null,
    reader: null,
    ready: false,
    active: false,
    statusKind: "stopped",
    statusText: "Starting…",
    requestSerial: 0,
    pending: new Map(),
    pendingPromptId: "",
    promptGeneration: 0,
    promptLifecycleStarted: false,
    pendingPromptCancellation: false,
    preserveRunError: false,
    awaitingStartupState: false,
    startupTimer: null,
    reconciliationTimer: null,
    restartPending: false,
    shuttingDown: false,
    stopPromise: null,
    messageSerial: 0,
    currentMessage: null,
    tools: new Map(),
    dialogs: new Map(),
    dialogOrder: [],
    runtime: { provider: "", modelId: "", thinkingLevel: "", sessionId: "", sessionName: "" },
    compacting: false,
    lastError: "",
    queues: { steering: [], followUp: [] },
    statusRecords: new Map(),
    helperAvailable: false,
    helperChecked: false,
    helperPending: new Map(),
    helperSerial: 0,
    modelScope: null,
  };

  function setStatus(kind, text) {
    session.statusKind = kind;
    session.statusText = text;
    emit("pi.status", { statusKind: kind, text, ready: session.ready, active: session.active });
  }

  function showError(message) {
    setStatus("error", "Error");
    session.lastError = boundedError(message);
    emit("pi.error", { message: session.lastError });
  }

  function clearError() {
    session.lastError = "";
    emit("pi.error", { message: "" });
  }

  function updateRuntime(data) {
    const model = normalizeModel(data ? data.model : null);
    session.runtime = {
      provider: model ? model.provider : "",
      modelId: model ? model.id : "",
      modelName: model ? model.name : "",
      modelReasoning: model ? model.reasoning : false,
      thinkingLevel: boundedString(data ? data.thinkingLevel : "", LIMITS.maxRuntimeInfoCharacters).trim(),
      sessionId: boundedString(data ? data.sessionId : "", LIMITS.maxRuntimeInfoCharacters).trim(),
      sessionName: boundedString(data ? data.sessionName : "", LIMITS.maxRuntimeInfoCharacters).trim(),
      sessionFile: boundedString(data ? data.sessionFile : "", 1024).trim(),
      messageCount: Number.isInteger(data?.messageCount) ? data.messageCount : 0,
    };
    emit("pi.runtime", session.runtime);
  }

  // Model and thinking changes report only the changed fields; session identity is kept.
  function mergeRuntime({ model, thinkingLevel }) {
    const normalized = model === undefined ? null : normalizeModel(model);
    session.runtime = {
      ...session.runtime,
      ...(normalized ? { provider: normalized.provider, modelId: normalized.id, modelName: normalized.name, modelReasoning: normalized.reasoning } : {}),
      ...(typeof thinkingLevel === "string" ? { thinkingLevel: boundedString(thinkingLevel, LIMITS.maxRuntimeInfoCharacters).trim() } : {}),
    };
    emit("pi.runtime", session.runtime);
  }

  function clearRuntime() {
    session.runtime = { provider: "", modelId: "", modelName: "", modelReasoning: false, thinkingLevel: "", sessionId: "", sessionName: "", sessionFile: "", messageCount: 0 };
    emit("pi.runtime", session.runtime);
  }

  // Reflect complete persisted metadata while keeping the child marked stale by the registry.
  // The next mutation still goes through switch_session before Pi is allowed to write again.
  function applyPersistedSnapshotMetadata(snapshot, messageCount) {
    const model = snapshot?.model && typeof snapshot.model === "object" ? snapshot.model : null;
    session.runtime = {
      ...session.runtime,
      provider: boundedString(model?.provider, LIMITS.maxProviderCharacters, "").trim(),
      modelId: boundedString(model?.modelId ?? model?.id, LIMITS.maxModelIdCharacters, "").trim(),
      thinkingLevel: boundedString(snapshot?.thinkingLevel, LIMITS.maxRuntimeInfoCharacters, "").trim(),
      sessionId: boundedString(snapshot?.sessionId, LIMITS.maxRuntimeInfoCharacters, "").trim(),
      sessionName: boundedString(snapshot?.name, LIMITS.maxRuntimeInfoCharacters, "").trim(),
      sessionFile: boundedString(snapshot?.path ?? session.runtime.sessionFile, 1024, "").trim(),
      messageCount: Number.isInteger(messageCount) ? messageCount : session.runtime.messageCount,
    };
    emit("pi.runtime", session.runtime);
  }

  function nextId(prefix) {
    session.requestSerial += 1;
    return `qt-webui-${prefix}-${session.requestSerial}`;
  }

  function writeRaw(command) {
    if (!session.child || hasExited(session.child) || !session.child.stdin.writable) return false;
    session.child.stdin.write(`${JSON.stringify(command)}\n`);
    return true;
  }

  // Correlated Pi command with explicit timeout. Resolves with the Pi response record.
  function sendCommand(command, { timeoutMs, onPending = null }) {
    return new Promise((resolve, reject) => {
      const id = nextId(command.type.replace(/_/g, "-"));
      if (session.pending.size >= LIMITS.maxPendingRequests) {
        reject(new ProtocolError("busy", "too many Pi requests are pending"));
        return;
      }
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new ProtocolError("timeout", `Pi did not answer ${command.type} within ${timeoutMs} ms`));
      }, timeoutMs);
      session.pending.set(id, { command: command.type, resolve, reject, timer });
      if (onPending) onPending(id);
      if (!writeRaw({ id, ...command })) {
        clearTimeout(timer);
        session.pending.delete(id);
        reject(new ProtocolError("not_running", "Pi is not running"));
      }
    });
  }

  function cancelPendingCommand(id) {
    const pending = session.pending.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    session.pending.delete(id);
    return true;
  }

  function rejectPending(reason) {
    for (const [id, entry] of session.pending) {
      clearTimeout(entry.timer);
      session.pending.delete(id);
      entry.reject(new ProtocolError("not_running", reason));
    }
  }

  function resetRunState() {
    session.pendingPromptId = "";
    session.promptLifecycleStarted = false;
    session.pendingPromptCancellation = false;
    if (session.reconciliationTimer) clearTimeout(session.reconciliationTimer);
    session.reconciliationTimer = null;
  }

  function finishStreamingParts() {
    if (!session.currentMessage) return;
    for (const part of new Set(session.currentMessage.parts.values())) {
      if (part.renderTimer) clearTimeout(part.renderTimer);
      part.renderTimer = null;
    }
  }

  function cancelDialogs(reason) {
    for (const requestId of session.dialogOrder) {
      const dialog = session.dialogs.get(requestId);
      if (!dialog) continue;
      session.dialogs.delete(requestId);
      emit("extension.cancelled", { requestId, reason });
    }
    session.dialogOrder = [];
  }

  // ---- state requests -------------------------------------------------------------------

  async function requestState({ startup = false } = {}) {
    const generation = session.promptGeneration;
    let response;
    try {
      response = await sendCommand({ type: "get_state" }, { timeoutMs: startup ? startupReadinessMs : requestTimeouts.state });
    } catch (error) {
      if (startup && session.awaitingStartupState) {
        session.awaitingStartupState = false;
        session.ready = false;
        session.active = false;
        clearRuntime();
        showError(error.code === "timeout" ? "Pi did not report readiness in time" : error.message);
      }
      throw error;
    }
    if (startup) session.awaitingStartupState = false;
    if (response.success !== true) {
      session.ready = false;
      session.active = false;
      clearRuntime();
      showError(response.error || "Pi did not become ready");
      throw new ProtocolError("pi_error", response.error || "Pi did not become ready");
    }
    updateRuntime(response.data);
    session.ready = true;
    const data = response.data || {};
    if (generation !== session.promptGeneration) {
      // A newer prompt was sent while this state read was in flight; its activity answer is stale.
      return session.runtime;
    }
    session.active = data.isStreaming === true || data.isCompacting === true;
    if (!session.active) resetRunState();
    if (session.preserveRunError && !session.active) setStatus("error", "Error");
    else setStatus(session.active ? "running" : "ready", session.active ? "Running" : "Ready");
    return session.runtime;
  }

  // ---- prompt lifecycle -----------------------------------------------------------------

  // Throws the same errors prompt() would, so callers can consume attachments only after the
  // prompt is known to be acceptable.
  function assertPromptAllowed(mode) {
    if (!session.child || hasExited(session.child) || !session.ready) throw new ProtocolError("not_ready", "Pi is not ready");
    if (mode === "send" && session.active) throw new ProtocolError("busy", "Pi is already running; use steer or follow-up");
  }

  // `attachments` is { images: ImageContent[], texts: [{name, text}], names: string[] } prepared by
  // the attachment store; text attachments become labelled fenced blocks in the message and
  // images travel in Pi's `images` field.
  async function prompt({ message, mode, attachments = null }) {
    assertPromptAllowed(mode);
    const texts = attachments && Array.isArray(attachments.texts) ? attachments.texts : [];
    const images = attachments && Array.isArray(attachments.images) ? attachments.images : [];
    const names = attachments && Array.isArray(attachments.names) ? attachments.names : [];
    const text = composeMessageWithTexts(message.trim(), texts);
    if (mode !== "send" && !session.active) mode = "send";
    session.messageSerial += 1;
    const messageId = `u${session.messageSerial}`;
    emit("message.user", { messageId, text: boundedString(message.trim(), LIMITS.maxMessageCharacters), mode, attachments: names.map((name) => boundedString(name, LIMITS.maxAttachmentNameCharacters)) });

    if (mode === "send") {
      resetRunState();
      session.promptGeneration += 1;
      session.preserveRunError = false;
      session.active = true;
      clearError();
      setStatus("running", "Running");
    }
    const command = mode === "send" ? { type: "prompt", message: text }
      : mode === "steer" ? { type: "steer", message: text }
        : { type: "follow_up", message: text };
    if (images.length > 0) command.images = images;
    let response;
    try {
      response = await sendCommand(command, { timeoutMs: requestTimeouts.prompt });
    } catch (error) {
      if (mode === "send") {
        session.active = false;
        resetRunState();
        showError(error.message);
        requestState().catch(() => {});
      }
      throw error;
    }
    if (response.success === true) {
      if (mode === "send") {
        session.pendingPromptId = "accepted";
        if (!session.promptLifecycleStarted) {
          if (session.reconciliationTimer) clearTimeout(session.reconciliationTimer);
          session.reconciliationTimer = setTimeout(() => {
            session.reconciliationTimer = null;
            if (session.pendingPromptId && !session.promptLifecycleStarted && session.active) requestState().catch(() => {});
          }, promptReconciliationMs);
        }
      }
      return { mode, messageId };
    }
    if (mode === "send") {
      session.active = false;
      resetRunState();
    }
    showError(response.error || "prompt failed");
    requestState().catch(() => {});
    throw new ProtocolError("pi_error", response.error || "prompt failed");
  }

  // A saved sequence: the first entry is sent as a prompt and every later entry is queued as a
  // follow-up, so Pi runs them one after another with its own follow-up semantics.
  async function runSequence({ sequenceId, entries }) {
    assertPromptAllowed("send");
    const first = await prompt({ message: entries[0], mode: "send" });
    let queued = 0;
    for (const entry of entries.slice(1)) {
      await prompt({ message: entry, mode: "followUp" });
      queued += 1;
    }
    return { sequenceId, messageId: first.messageId, sent: 1, queued };
  }

  // ---- sessions: resume, new, rename, history ------------------------------------------

  // Replaces the client transcript with Pi's persisted history for the current session and
  // says when the last exchange looks interrupted instead of presenting it as complete.
  async function loadHistory() {
    const data = await piCommand({ type: "get_messages" }, requestTimeouts.session_switch, "could not read the session history");
    const history = rowsFromHistory(data ? data.messages : []);
    emit("transcript.reset", {});
    for (const row of history.rows) emit("transcript.row", { row });
    if (history.interrupted) emit("notice", { level: "warning", message: "The previous run in this session did not complete; the last request may need to be sent again" });
    return { rows: history.rows.length, messageCount: history.messageCount, interrupted: history.interrupted };
  }

  async function switchSession(sessionPath) {
    requireIdle("switching sessions");
    const data = await piCommand({ type: "switch_session", sessionPath }, requestTimeouts.session_switch, "could not switch sessions");
    if (data && data.cancelled === true) throw new ProtocolError("pi_error", "An extension cancelled the session switch");
    cancelDialogs("Session switched");
    session.queues = { steering: [], followUp: [] };
    emit("queue.update", { steering: [], followUp: [] });
    clearError();
    const history = await loadHistory();
    await requestState();
    return { sessionFile: session.runtime.sessionFile, sessionName: session.runtime.sessionName, ...history };
  }

  async function newSession() {
    requireIdle("starting a new session");
    const data = await piCommand({ type: "new_session" }, requestTimeouts.session_new, "could not start a new session");
    if (data && data.cancelled === true) throw new ProtocolError("pi_error", "An extension cancelled the new session");
    cancelDialogs("New session");
    session.queues = { steering: [], followUp: [] };
    emit("queue.update", { steering: [], followUp: [] });
    clearError();
    emit("transcript.reset", {});
    await requestState();
    return { sessionFile: session.runtime.sessionFile, sessionName: session.runtime.sessionName };
  }

  async function setSessionName(name) {
    requireReady();
    const clean = boundedString(stripAnsi(name), LIMITS.maxRuntimeInfoCharacters, "").trim();
    await piCommand({ type: "set_session_name", name: clean }, requestTimeouts.tab_rename, "could not rename the session");
    session.runtime = { ...session.runtime, sessionName: clean };
    emit("pi.runtime", session.runtime);
    return { sessionName: clean };
  }

  // Token, cost, and context-window usage from get_session_stats, each bounded to finite numbers.
  async function sessionStats() {
    requireReady();
    const data = await piCommand({ type: "get_session_stats" }, requestTimeouts.session_stats, "could not read session statistics");
    const number = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
    const tokens = data && data.tokens && typeof data.tokens === "object" ? data.tokens : {};
    const context = data && data.contextUsage && typeof data.contextUsage === "object" ? data.contextUsage : null;
    return {
      userMessages: number(data?.userMessages),
      assistantMessages: number(data?.assistantMessages),
      toolCalls: number(data?.toolCalls),
      totalMessages: number(data?.totalMessages),
      tokens: { input: number(tokens.input), output: number(tokens.output), cacheRead: number(tokens.cacheRead), cacheWrite: number(tokens.cacheWrite), total: number(tokens.total) },
      cost: number(data?.cost),
      context: context ? { tokens: Number.isFinite(context.tokens) ? context.tokens : null, contextWindow: number(context.contextWindow), percent: Number.isFinite(context.percent) ? Math.max(0, Math.min(100, context.percent)) : null } : null,
    };
  }

  async function listCommands() {
    requireReady();
    const data = await piCommand({ type: "get_commands" }, requestTimeouts.commands_list, "could not list commands");
    const { commands, omitted } = normalizeCommands(data ? data.commands : []);
    session.helperAvailable = commands.some((command) => command.name === HELPER_COMMAND);
    session.helperChecked = true;
    if (omitted > 0) emit("notice", { level: "warning", message: `${omitted} commands are not listed (limit ${LIMITS.maxCommands})` });
    // The helper is internal: it never appears in completion or the palette.
    return { commands: commands.filter((command) => command.name !== HELPER_COMMAND), omitted };
  }

  // ---- helper extension transport -------------------------------------------------------

  async function ensureHelper() {
    requireReady();
    if (!session.helperChecked) await listCommands();
    if (!session.helperAvailable) throw new ProtocolError("unavailable", "The Qt WebUI helper extension is not loaded in this Pi session");
  }

  // Sends one helper request as a command prompt and waits for the matching prefixed notify.
  // Only while idle: a prompt during a run would be treated as input to the model.
  async function helperCall(action, payload = {}) {
    await ensureHelper();
    if (session.active) throw new ProtocolError("busy", "Wait for the current run to finish before changing tools, skills, or sampling");
    session.helperSerial += 1;
    const requestId = `qt-webui-helper-${session.helperSerial}`;
    const message = `/${HELPER_COMMAND} ${JSON.stringify({ requestId, action, payload })}`;
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.helperPending.delete(requestId);
        reject(new ProtocolError("timeout", `The Qt WebUI helper did not answer ${action} within ${helperTimeoutMs} ms`));
      }, helperTimeoutMs);
      session.helperPending.set(requestId, { resolve, reject, timer });
    });
    // Observe the helper leg immediately: an error notify may arrive before Pi's prompt response.
    const answerOutcome = answer.then(
      (data) => ({ kind: "answer", data }),
      (error) => ({ kind: "answer_error", error }),
    );
    let commandId = "";
    const commandOutcome = sendCommand(
      { type: "prompt", message },
      { timeoutMs: requestTimeouts.prompt, onPending: (id) => { commandId = id; } },
    ).then(
      (response) => ({ kind: "command", response }),
      (error) => ({ kind: "command_error", error }),
    );
    const first = await Promise.race([answerOutcome, commandOutcome]);
    if (first.kind === "answer" || first.kind === "answer_error") {
      cancelPendingCommand(commandId);
      if (first.kind === "answer_error") throw first.error;
      return first.data;
    }
    if (first.kind === "command_error" || first.response.success !== true) {
      const pending = session.helperPending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        session.helperPending.delete(requestId);
        pending.reject(first.kind === "command_error"
          ? first.error
          : new ProtocolError("pi_error", first.response.error || `Pi rejected the ${action} request`));
      }
      const settledAnswer = await answerOutcome;
      throw settledAnswer.kind === "answer_error" ? settledAnswer.error : new ProtocolError("pi_error", `Pi rejected the ${action} request`);
    }
    const settledAnswer = await answerOutcome;
    if (settledAnswer.kind === "answer_error") throw settledAnswer.error;
    return settledAnswer.data;
  }

  function handleHelperNotify(raw) {
    if (typeof raw !== "string" || !raw.startsWith(HELPER_RESPONSE_PREFIX)) return false;
    if (raw.length > LIMITS.maxHelperResponseBytes) {
      emit("notice", { level: "warning", message: "Ignored an oversized helper response" });
      return true;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw.slice(HELPER_RESPONSE_PREFIX.length));
    } catch {
      emit("notice", { level: "warning", message: "Ignored a malformed helper response" });
      return true;
    }
    const pending = parsed && typeof parsed.requestId === "string" ? session.helperPending.get(parsed.requestId) : null;
    if (!pending) return true;
    clearTimeout(pending.timer);
    session.helperPending.delete(parsed.requestId);
    if (parsed.ok === true) {
      const scope = normalizeModelScope(parsed.data?.scopedModels);
      if (scope) session.modelScope = scope;
      pending.resolve(parsed.data ?? null);
    } else pending.reject(new ProtocolError("pi_error", boundedError(parsed.error || "helper request failed")));
    return true;
  }

  function rejectHelperPending(reason) {
    for (const [requestId, pending] of session.helperPending) {
      clearTimeout(pending.timer);
      session.helperPending.delete(requestId);
      pending.reject(new ProtocolError("not_running", reason));
    }
  }

  async function helperState() {
    return helperCall("state");
  }

  async function helperApply(payload) {
    return helperCall("apply", payload);
  }

  async function abort() {
    if (!session.active || !session.child || hasExited(session.child)) throw new ProtocolError("not_running", "Nothing is running");
    if (session.pendingPromptId && !session.promptLifecycleStarted) session.pendingPromptCancellation = true;
    setStatus("running", "Stopping…");
    const response = await sendCommand({ type: "abort" }, { timeoutMs: requestTimeouts.abort });
    if (response.success !== true) throw new ProtocolError("pi_error", response.error || "abort failed");
    return null;
  }

  // ---- models, thinking, and compaction -------------------------------------------------

  function requireReady() {
    if (!session.child || hasExited(session.child) || !session.ready) throw new ProtocolError("not_ready", "Pi is not ready");
  }

  function requireIdle(action) {
    requireReady();
    if (session.active) throw new ProtocolError("busy", `Wait for the current run to finish before ${action}`);
  }

  async function piCommand(command, timeoutMs, failure) {
    const response = await sendCommand(command, { timeoutMs });
    if (response.success !== true) throw new ProtocolError("pi_error", response.error || failure);
    return response.data ?? null;
  }

  async function listModels() {
    requireReady();
    const data = await piCommand({ type: "get_available_models" }, requestTimeouts.models_list, "could not list models");
    if (!session.active) {
      try {
        await helperState();
      } catch (error) {
        if (!session.modelScope || error?.code !== "busy") throw error;
      }
    }
    if (!session.modelScope) throw new ProtocolError("busy", "Model scope is not available until the current run finishes");
    const catalogue = Array.isArray(data?.models) ? data.models : [];
    let models;
    let omitted;
    let scope;
    if (session.modelScope.explicit) {
      const available = new Map();
      for (const entry of catalogue) {
        const model = normalizeModel(entry);
        if (!model) continue;
        const identity = `${model.provider}/${model.id}`;
        if (!available.has(identity)) available.set(identity, model);
      }
      models = [];
      let unavailable = 0;
      let boundedOut = 0;
      for (const entry of session.modelScope.items) {
        const model = available.get(`${entry.provider}/${entry.id}`);
        if (!model) {
          unavailable += 1;
          continue;
        }
        if (models.length >= LIMITS.maxModels) {
          boundedOut += 1;
          continue;
        }
        models.push({ ...model, pinnedThinkingLevel: entry.thinkingLevel });
      }
      omitted = session.modelScope.omitted + boundedOut;
      scope = {
        explicit: true,
        source: "session",
        count: session.modelScope.items.length + session.modelScope.omitted,
        unavailable,
      };
    } else {
      ({ models, omitted } = normalizeModels(catalogue));
      scope = { explicit: false, source: "available", count: models.length + omitted, unavailable: 0 };
    }
    if (omitted > 0) emit("notice", { level: "warning", message: `${omitted} configured models are not listed (limit ${LIMITS.maxModels})` });
    return { models, omitted, scope, current: { provider: session.runtime.provider, modelId: session.runtime.modelId } };
  }

  async function setModel({ provider, modelId }) {
    requireIdle("changing the model");
    const model = await piCommand({ type: "set_model", provider, modelId }, requestTimeouts.model_set, "could not change the model");
    const normalized = normalizeModel(model);
    if (!normalized) throw new ProtocolError("pi_error", "Pi did not confirm the model change");
    // The thinking level can change with the model, so read the whole state instead of guessing.
    await requestState();
    return { model: normalized, thinkingLevel: session.runtime.thinkingLevel };
  }

  async function cycleModel() {
    requireIdle("changing the model");
    const data = await piCommand({ type: "cycle_model" }, requestTimeouts.model_cycle, "could not cycle the model");
    if (!data || !data.model) return { changed: false, model: null, thinkingLevel: session.runtime.thinkingLevel };
    mergeRuntime({ model: data.model, thinkingLevel: data.thinkingLevel });
    return { changed: true, model: normalizeModel(data.model), thinkingLevel: session.runtime.thinkingLevel, scoped: data.isScoped === true };
  }

  async function listThinkingLevels() {
    requireReady();
    const data = await piCommand({ type: "get_available_thinking_levels" }, requestTimeouts.thinking_levels, "could not list thinking levels");
    return { levels: normalizeThinkingLevels(data ? data.levels : []), current: session.runtime.thinkingLevel };
  }

  async function setThinkingLevel({ level }) {
    requireIdle("changing the thinking level");
    await piCommand({ type: "set_thinking_level", level }, requestTimeouts.thinking_set, "could not change the thinking level");
    mergeRuntime({ thinkingLevel: level });
    return { level };
  }

  async function cycleThinkingLevel() {
    requireIdle("changing the thinking level");
    const data = await piCommand({ type: "cycle_thinking_level" }, requestTimeouts.thinking_cycle, "could not cycle the thinking level");
    if (!data || typeof data.level !== "string") return { changed: false, level: session.runtime.thinkingLevel };
    mergeRuntime({ thinkingLevel: data.level });
    return { changed: true, level: session.runtime.thinkingLevel };
  }

  // Manual compaction is a blocking Pi operation: the session counts as busy until Pi answers,
  // so prompts and further model changes are refused instead of racing the rebuild.
  async function compact({ instructions }) {
    requireIdle("compacting the context");
    if (session.compacting) throw new ProtocolError("busy", "Compaction is already running");
    session.compacting = true;
    session.active = true;
    setStatus("running", "Compacting…");
    let data;
    try {
      data = await piCommand(
        instructions.length > 0 ? { type: "compact", customInstructions: instructions } : { type: "compact" },
        requestTimeouts.compact,
        "compaction failed",
      );
    } catch (error) {
      session.compacting = false;
      session.active = false;
      setStatus("ready", "Ready");
      emit("notice", { level: "error", message: `Compaction failed: ${boundedError(error.message)}` });
      throw error;
    }
    session.compacting = false;
    session.active = false;
    setStatus("ready", "Ready");
    const tokensBefore = Number.isFinite(data?.tokensBefore) ? Math.max(0, Math.floor(data.tokensBefore)) : 0;
    const estimatedTokensAfter = Number.isFinite(data?.estimatedTokensAfter) ? Math.max(0, Math.floor(data.estimatedTokensAfter)) : 0;
    requestState().catch(() => {});
    return { tokensBefore, estimatedTokensAfter, summary: boundedString(stripAnsi(data?.summary), LIMITS.maxCompactionSummaryCharacters, "") };
  }

  // ---- transcript translation ----------------------------------------------------------

  function beginMessage() {
    finishStreamingParts();
    session.messageSerial += 1;
    session.currentMessage = { id: `a${session.messageSerial}`, parts: new Map(), partSerial: 0, truncatedParts: 0 };
    emit("message.begin", { messageId: session.currentMessage.id });
    return session.currentMessage;
  }

  function partFor(contentIndex, kind) {
    const message = session.currentMessage ?? beginMessage();
    const key = `${kind}:${contentIndex}`;
    let part = message.parts.get(key);
    if (part) return part;
    if (message.parts.size >= LIMITS.maxPartsPerMessage) {
      message.truncatedParts += 1;
      return null;
    }
    if (kind === "thinking") {
      const previous = message.parts.get(`thinking:${contentIndex - 1}`);
      if (previous) {
        message.parts.set(key, previous);
        return previous;
      }
    }
    message.partSerial += 1;
    part = {
      id: `${message.id}.${message.partSerial}`,
      kind,
      text: "",
      truncated: false,
      renderTimer: null,
      dirty: false,
      contentIndex,
      begun: kind !== "thinking",
      fragments: kind === "thinking" ? new Map() : null,
      fragmentTruncated: kind === "thinking" ? new Map() : null,
    };
    message.parts.set(key, part);
    if (part.begun) emit("part.begin", { messageId: message.id, partId: part.id, partKind: kind });
    return part;
  }

  function renderPart(part, { final }) {
    const messageId = session.currentMessage ? session.currentMessage.id : "";
    if (part.renderTimer) clearTimeout(part.renderTimer);
    part.renderTimer = null;
    part.dirty = false;
    if (part.kind === "thinking" && part.text.trim().length === 0) {
      if (part.begun) emit("part.remove", { messageId, partId: part.id });
      part.begun = false;
      return;
    }
    if (!part.begun) {
      emit("part.begin", { messageId, partId: part.id, partKind: part.kind });
      part.begun = true;
    }
    const payload = { messageId, partId: part.id, partKind: part.kind, text: part.text, truncated: part.truncated, final };
    if (part.kind === "text" || part.kind === "thinking") payload.blocks = renderMarkdown(part.text).blocks;
    emit("part.render", payload);
  }

  function schedulePartRender(part) {
    part.dirty = true;
    if (!part.renderTimer) {
      part.renderTimer = setTimeout(() => {
        part.renderTimer = null;
        if (part.dirty) renderPart(part, { final: false });
      }, renderCadenceMs);
    }
  }

  function appendDelta(part, delta) {
    const limit = LIMITS.maxMessageCharacters;
    if (part.text.length >= limit) {
      part.truncated = true;
      return;
    }
    const remaining = limit - part.text.length;
    if (delta.length > remaining) {
      part.text += delta.slice(0, remaining);
      part.truncated = true;
    } else {
      part.text += delta;
    }
    schedulePartRender(part);
  }

  function rebuildThinkingPart(part) {
    const ordered = [...part.fragments.entries()].sort(([left], [right]) => left - right);
    const combined = ordered.map(([, value]) => value).filter((value) => value.trim().length > 0).join("\n\n");
    part.text = boundedString(combined, LIMITS.maxThinkingCharacters);
    part.truncated = combined.length > LIMITS.maxThinkingCharacters || [...part.fragmentTruncated.values()].some(Boolean);
  }

  function setThinkingContent(part, contentIndex, content) {
    const value = typeof content === "string" ? content : "";
    part.fragments.set(contentIndex, boundedString(value, LIMITS.maxThinkingCharacters));
    part.fragmentTruncated.set(contentIndex, value.length > LIMITS.maxThinkingCharacters);
    rebuildThinkingPart(part);
  }

  function appendThinkingDelta(part, contentIndex, delta) {
    setThinkingContent(part, contentIndex, `${part.fragments.get(contentIndex) ?? ""}${delta}`);
    schedulePartRender(part);
  }

  function handleMessageUpdate(record) {
    const update = record.assistantMessageEvent;
    if (!update || typeof update.type !== "string") return;
    const contentIndex = Number.isInteger(update.contentIndex) ? update.contentIndex : 0;
    switch (update.type) {
      case "text_start":
        partFor(contentIndex, "text");
        break;
      case "text_delta": {
        const part = partFor(contentIndex, "text");
        if (part && typeof update.delta === "string") appendDelta(part, update.delta);
        break;
      }
      case "text_end": {
        const part = partFor(contentIndex, "text");
        if (!part) break;
        if (typeof update.content === "string") {
          part.text = boundedString(update.content, LIMITS.maxMessageCharacters);
          part.truncated = update.content.length > LIMITS.maxMessageCharacters;
        }
        renderPart(part, { final: false });
        break;
      }
      case "thinking_start":
        partFor(contentIndex, "thinking");
        break;
      case "thinking_delta": {
        const part = partFor(contentIndex, "thinking");
        if (part && typeof update.delta === "string") appendThinkingDelta(part, contentIndex, update.delta);
        break;
      }
      case "thinking_end": {
        const part = partFor(contentIndex, "thinking");
        if (!part) break;
        if (typeof update.content === "string") setThinkingContent(part, contentIndex, update.content);
        renderPart(part, { final: false });
        break;
      }
      default:
        break;
    }
  }

  function handleMessageEnd(record) {
    const message = record.message;
    if (!message || message.role !== "assistant") return;
    const current = session.currentMessage ?? beginMessage();
    finishStreamingParts();
    for (const part of new Set(current.parts.values())) {
      if (part.kind !== "thinking") continue;
      part.fragments.clear();
      part.fragmentTruncated.clear();
      rebuildThinkingPart(part);
    }
    const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : Array.isArray(message.content) ? message.content : [];
    const seen = new Set();
    const finalParts = new Set();
    content.forEach((entry, contentIndex) => {
      if (!entry || typeof entry !== "object") return;
      if (entry.type === "text" && typeof entry.text === "string") {
        const part = partFor(contentIndex, "text");
        if (!part) return;
        part.text = boundedString(entry.text, LIMITS.maxMessageCharacters);
        part.truncated = entry.text.length > LIMITS.maxMessageCharacters;
        seen.add(part.id);
        finalParts.add(part);
      } else if (entry.type === "thinking" && typeof entry.thinking === "string") {
        const part = partFor(contentIndex, "thinking");
        if (!part) return;
        setThinkingContent(part, contentIndex, entry.thinking);
        seen.add(part.id);
        finalParts.add(part);
      }
    });
    for (const part of finalParts) renderPart(part, { final: true });
    for (const part of new Set(current.parts.values())) {
      if (!seen.has(part.id)) emit("part.remove", { messageId: current.id, partId: part.id });
    }
    emit("message.end", {
      messageId: current.id,
      stopReason: boundedString(message.stopReason, 32, "stop"),
      truncatedParts: current.truncatedParts,
    });
    session.currentMessage = null;
    if (message.stopReason === "error") {
      session.preserveRunError = true;
      showError(message.errorMessage || "Pi provider request failed");
    }
  }

  function toolOutput(result) {
    if (!result || typeof result !== "object") return "";
    return boundedString(contentText(result.content), LIMITS.maxToolOutputCharacters);
  }

  function handleToolStart(record) {
    const toolCallId = boundedString(record.toolCallId, LIMITS.maxRequestIdCharacters, "");
    const name = boundedString(record.toolName, LIMITS.maxToolNameCharacters, "tool");
    const tool = { name, startedAt: now(), updateTimer: null, pendingOutput: null };
    if (toolCallId) session.tools.set(toolCallId, tool);
    setStatus("tool", `Tool · ${name}`);
    emit("tool.start", { toolCallId, name, summary: safeArgumentSummary(record.args), messageId: session.currentMessage ? session.currentMessage.id : "" });
  }

  function handleToolUpdate(record) {
    const toolCallId = boundedString(record.toolCallId, LIMITS.maxRequestIdCharacters, "");
    const tool = session.tools.get(toolCallId);
    if (!tool) return;
    tool.pendingOutput = toolOutput(record.partialResult);
    if (tool.updateTimer) return;
    tool.updateTimer = setTimeout(() => {
      tool.updateTimer = null;
      if (tool.pendingOutput === null) return;
      emit("tool.update", { toolCallId, output: tool.pendingOutput });
      tool.pendingOutput = null;
    }, renderCadenceMs);
  }

  function handleToolEnd(record) {
    const toolCallId = boundedString(record.toolCallId, LIMITS.maxRequestIdCharacters, "");
    const tool = session.tools.get(toolCallId);
    if (tool && tool.updateTimer) clearTimeout(tool.updateTimer);
    session.tools.delete(toolCallId);
    const name = boundedString(record.toolName, LIMITS.maxToolNameCharacters, tool ? tool.name : "tool");
    const isError = record.isError === true;
    const output = toolOutput(record.result);
    emit("tool.end", {
      toolCallId,
      name,
      ok: !isError,
      durationMs: tool ? Math.max(0, now() - tool.startedAt) : 0,
      output,
      error: isError ? boundedError(output || `Tool failed: ${name}`) : "",
    });
    setStatus(session.active ? "running" : "ready", session.active ? "Running" : "Ready");
    if (isError) showError(`Tool failed: ${name}`);
  }

  // ---- extension UI --------------------------------------------------------------------

  function handleExtensionRequest(record) {
    const method = typeof record.method === "string" ? record.method : "";
    const id = typeof record.id === "string" ? boundedString(record.id, LIMITS.maxRequestIdCharacters) : "";
    if (DIALOG_METHODS.has(method)) {
      if (!id) return;
      if (session.dialogs.size >= LIMITS.maxPendingDialogs) {
        writeRaw({ type: "extension_ui_response", id: record.id, cancelled: true });
        emit("notice", { level: "warning", message: `Extension ${method} request was cancelled: too many dialogs are pending` });
        return;
      }
      const options = Array.isArray(record.options)
        ? record.options.slice(0, LIMITS.maxDialogOptions).map((option) => boundedString(typeof option === "string" ? option : option?.label ?? option?.value ?? "", LIMITS.maxDialogOptionCharacters))
        : [];
      const dialog = {
        requestId: id,
        rawId: record.id,
        method,
        title: boundedString(record.title, LIMITS.maxDialogTitleCharacters, method),
        message: boundedString(record.message, LIMITS.maxDialogMessageCharacters, ""),
        options,
        optionsTruncated: Array.isArray(record.options) && record.options.length > LIMITS.maxDialogOptions,
        placeholder: boundedString(record.placeholder, LIMITS.maxDialogOptionCharacters, ""),
        prefill: boundedString(record.prefill, LIMITS.maxDialogValueCharacters, ""),
        timeoutMs: Number.isFinite(record.timeout) && record.timeout > 0 ? Math.floor(record.timeout) : 0,
      };
      session.dialogs.set(id, dialog);
      session.dialogOrder.push(id);
      const { rawId, ...visible } = dialog;
      emit("extension.request", visible);
      return;
    }
    switch (method) {
      case "notify":
        if (handleHelperNotify(record.message)) break;
        emit("extension.notify", {
          level: ["info", "warning", "error"].includes(record.notifyType) ? record.notifyType : "info",
          message: boundedString(stripAnsi(record.message), LIMITS.maxNoticeCharacters, ""),
        });
        break;
      case "setStatus": {
        const key = boundedString(record.statusKey, 64, "");
        const raw = typeof record.statusText === "string" ? record.statusText : "";
        const chips = footerStatusChips(raw);
        const payload = chips ? null : genericStatusPayload(raw);
        const status = {
          key,
          text: chips ? "" : payload ? payload.text : boundedString(stripAnsi(raw), LIMITS.maxNoticeCharacters),
          hint: payload ? payload.hint : "",
          chips: chips ?? [],
        };
        // Kept per key so a tab snapshot can restore the footer exactly as Pi last published it.
        if (status.text.length === 0 && status.chips.length === 0) session.statusRecords.delete(key);
        else {
          session.statusRecords.delete(key);
          if (session.statusRecords.size >= 32) session.statusRecords.delete(session.statusRecords.keys().next().value);
          session.statusRecords.set(key, status);
        }
        emit("extension.status", status);
        break;
      }
      case "set_editor_text":
        emit("composer.setText", { text: boundedString(record.text, LIMITS.maxMessageCharacters, "") });
        break;
      case "setTitle":
        emit("window.title", { title: boundedString(record.title, LIMITS.maxDialogTitleCharacters, "") });
        break;
      default:
        break;
    }
  }

  function answerDialog({ requestId, value, confirmed, cancelled }) {
    const dialog = session.dialogs.get(requestId);
    if (!dialog) throw new ProtocolError("stale_request", "That extension request is no longer pending");
    let response;
    if (cancelled === true) response = { cancelled: true };
    else if (dialog.method === "confirm") {
      if (typeof confirmed !== "boolean") throw new ProtocolError("invalid_request", "confirm dialogs need a boolean confirmed value");
      response = { confirmed };
    } else {
      if (typeof value !== "string") throw new ProtocolError("invalid_request", `${dialog.method} dialogs need a string value`);
      if (dialog.method === "select" && !dialog.options.includes(value)) throw new ProtocolError("invalid_request", "selected value is not one of the offered options");
      response = { value };
    }
    session.dialogs.delete(requestId);
    session.dialogOrder = session.dialogOrder.filter((entry) => entry !== requestId);
    if (!writeRaw({ type: "extension_ui_response", id: dialog.rawId, ...response })) {
      throw new ProtocolError("not_running", "Pi is not running");
    }
    emit("extension.answered", { requestId, method: dialog.method, ...response });
    return { requestId, ...response };
  }

  // ---- raw record dispatch -------------------------------------------------------------

  function handleResponse(record) {
    if (typeof record.id !== "string") return;
    const entry = session.pending.get(record.id);
    if (!entry) return; // stale, duplicate, or unsolicited response
    clearTimeout(entry.timer);
    session.pending.delete(record.id);
    entry.resolve(record);
  }

  function handleRecord(record) {
    if (!record || typeof record.type !== "string") return;
    switch (record.type) {
      case "response":
        handleResponse(record);
        break;
      case "agent_start":
        session.promptLifecycleStarted = true;
        if (session.reconciliationTimer) clearTimeout(session.reconciliationTimer);
        session.reconciliationTimer = null;
        session.active = true;
        setStatus("running", "Running");
        emit("run.start", {});
        if (session.pendingPromptCancellation) {
          session.pendingPromptCancellation = false;
          sendCommand({ type: "abort" }, { timeoutMs: requestTimeouts.abort }).catch(() => {});
        }
        break;
      case "agent_settled":
        finishStreamingParts();
        session.currentMessage = null;
        session.active = false;
        resetRunState();
        setStatus(session.preserveRunError ? "error" : "ready", session.preserveRunError ? "Error" : "Ready");
        emit("run.end", { ok: !session.preserveRunError, aborted: record.aborted === true });
        break;
      case "message_start":
        if (record.message && record.message.role === "assistant") beginMessage();
        break;
      case "message_update":
        handleMessageUpdate(record);
        break;
      case "message_end":
        handleMessageEnd(record);
        break;
      case "tool_execution_start":
        handleToolStart(record);
        break;
      case "tool_execution_update":
        handleToolUpdate(record);
        break;
      case "tool_execution_end":
        handleToolEnd(record);
        break;
      case "queue_update":
        session.queues = {
          steering: (Array.isArray(record.steering) ? record.steering : []).slice(0, LIMITS.maxQueueEntries).map((entry) => boundedString(entry, LIMITS.maxQueueEntryCharacters)),
          followUp: (Array.isArray(record.followUp) ? record.followUp : []).slice(0, LIMITS.maxQueueEntries).map((entry) => boundedString(entry, LIMITS.maxQueueEntryCharacters)),
        };
        emit("queue.update", { ...session.queues });
        break;
      case "compaction_start":
        setStatus("running", "Compacting…");
        emit("notice", { level: "info", message: `Compacting context (${boundedString(record.reason, 32, "manual")})` });
        break;
      case "compaction_end": {
        if (record.errorMessage) emit("notice", { level: "error", message: `Compaction failed: ${boundedString(record.errorMessage, LIMITS.maxNoticeCharacters)}` });
        else if (record.aborted) emit("notice", { level: "info", message: "Compaction aborted" });
        else {
          const result = record.result && typeof record.result === "object" ? record.result : {};
          const before = Number.isFinite(result.tokensBefore) ? Math.floor(result.tokensBefore) : 0;
          const after = Number.isFinite(result.estimatedTokensAfter) ? Math.floor(result.estimatedTokensAfter) : 0;
          emit("notice", { level: "info", message: before > 0 ? `Context compacted: about ${before.toLocaleString("en-US")} → ${after.toLocaleString("en-US")} tokens` : "Context compacted" });
        }
        if (session.active && !session.compacting) setStatus("running", "Running");
        break;
      }
      case "auto_retry_start":
        emit("notice", { level: "warning", message: `Retrying after a transient error (attempt ${Number(record.attempt) || 1} of ${Number(record.maxAttempts) || 1})` });
        break;
      case "auto_retry_end":
        if (record.success === false) emit("notice", { level: "error", message: `Retries exhausted: ${boundedString(record.finalError, LIMITS.maxNoticeCharacters, "unknown error")}` });
        break;
      case "extension_error":
        showError(record.error || "Extension error");
        break;
      case "extension_ui_request":
        handleExtensionRequest(record);
        break;
      default:
        break;
    }
  }

  // ---- process lifecycle ---------------------------------------------------------------

  function start() {
    if (session.child && !hasExited(session.child)) return false;
    session.shuttingDown = false;
    session.ready = false;
    session.active = false;
    session.modelScope = null;
    session.preserveRunError = false;
    session.compacting = false;
    resetRunState();
    session.currentMessage = null;
    session.tools.clear();
    clearRuntime();
    emit("pi.error", { message: "" });
    setStatus("stopped", "Starting…");
    let child;
    try {
      child = spawnImpl(nodeExecutable, [piCliEntry, "--mode", "rpc", ...(helperExtensionPath && existsSync(helperExtensionPath) ? ["--extension", helperExtensionPath] : [])], { cwd, env });
    } catch (error) {
      showError(`Could not start Pi: ${error.message}`);
      return false;
    }
    session.child = child;
    child.once("error", (error) => {
      if (session.child !== child) return;
      showError(`Could not start Pi: ${error.message}`);
    });
    child.stdout.setEncoding("utf8");
    session.reader = attachJsonlReader(child.stdout, {
      maxFrameBytes: LIMITS.maxPiFrameBytes,
      onRecord: (record) => {
        if (session.child === child) handleRecord(record);
      },
      onInvalid: (error) => {
        if (session.child === child) {
          showError(`Invalid Pi RPC record: ${error.message}`);
          emit("notice", { level: "warning", message: "Ignored an invalid Pi RPC record" });
        }
      },
      onOversized: (bytes) => {
        if (session.child === child) emit("notice", { level: "warning", message: `Ignored an oversized Pi RPC record (${bytes} bytes)` });
      },
    });
    child.stderr.setEncoding("utf8");
    attachJsonlReader(child.stderr, {
      maxFrameBytes: LIMITS.maxInboundFrameBytes,
      onRecord: () => {},
      onInvalid: (_error, line) => {
        if (session.child === child && line.trim().length > 0) showError(`Pi: ${line}`);
      },
      onOversized: () => {},
    });
    child.once("exit", (code, signal) => {
      if (session.child !== child) return;
      onChildExit(code, signal);
    });
    emit("pi.started", { pid: child.pid });
    session.awaitingStartupState = true;
    requestState({ startup: true }).catch(() => {});
    return true;
  }

  function onChildExit(code, signal) {
    finishStreamingParts();
    session.child = null;
    session.ready = false;
    session.active = false;
    session.compacting = false;
    session.awaitingStartupState = false;
    resetRunState();
    session.currentMessage = null;
    session.tools.clear();
    rejectPending("Pi exited");
    rejectHelperPending("Pi exited");
    cancelDialogs("Pi exited");
    session.helperAvailable = false;
    session.modelScope = null;
    session.helperChecked = false;
    clearRuntime();
    session.queues = { steering: [], followUp: [] };
    session.statusRecords.clear();
    emit("pi.exit", { code: code ?? null, signal: signal ?? null });
    if (session.restartPending) {
      session.restartPending = false;
      start();
      return;
    }
    if (session.shuttingDown) return;
    session.preserveRunError = false;
    if (code === 0) setStatus("stopped", "Stopped");
    else {
      setStatus("error", `Pi exited (${code ?? signal ?? "unknown"})`);
      emit("pi.error", { message: boundedError(`Pi process exited with code ${code ?? signal ?? "unknown"}`) });
    }
  }

  async function restart() {
    if (session.restartPending) throw new ProtocolError("busy", "A restart is already in progress");
    session.awaitingStartupState = false;
    session.ready = false;
    session.active = false;
    session.compacting = false;
    resetRunState();
    session.preserveRunError = false;
    emit("pi.error", { message: "" });
    setStatus("stopped", "Restarting…");
    if (session.child && !hasExited(session.child)) {
      session.restartPending = true;
      const child = session.child;
      await terminateProcessTree(child, { graceMs: shutdownGraceMs });
      return { restarted: true };
    }
    start();
    return { restarted: true };
  }

  function stop() {
    if (session.stopPromise) return session.stopPromise;
    session.shuttingDown = true;
    session.restartPending = false;
    cancelDialogs("Qt WebUI is closing");
    const child = session.child;
    if (!child || hasExited(child)) {
      session.stopPromise = Promise.resolve({ escalated: false });
      return session.stopPromise;
    }
    try {
      child.stdin.end();
    } catch {
      // Closing stdin is a courtesy; the signal path below is authoritative.
    }
    session.stopPromise = terminateProcessTree(child, { graceMs: shutdownGraceMs });
    return session.stopPromise;
  }

  function pauseInput() {
    if (session.child && !hasExited(session.child)) session.child.stdout.pause();
  }

  function resumeInput() {
    if (session.child && !hasExited(session.child)) session.child.stdout.resume();
  }

  function snapshot() {
    return {
      ready: session.ready,
      active: session.active,
      statusKind: session.statusKind,
      statusText: session.statusText,
      runtime: session.runtime,
      pid: session.child && !hasExited(session.child) ? session.child.pid : null,
      pendingDialogs: session.dialogOrder.length,
      error: session.lastError,
      compacting: session.compacting,
      queues: { ...session.queues },
      dialogs: session.dialogOrder.map((requestId) => {
        const { rawId, ...visible } = session.dialogs.get(requestId);
        return visible;
      }),
      statusRecords: [...session.statusRecords.values()],
    };
  }

  return {
    start,
    stop,
    restart,
    prompt,
    assertPromptAllowed,
    runSequence,
    listCommands,
    helperState,
    helperApply,
    get helperAvailable() {
      return session.helperAvailable;
    },
    sessionStats,
    switchSession,
    newSession,
    setSessionName,
    loadHistory,
    applyPersistedSnapshotMetadata,
    get cwd() {
      return cwd;
    },
    abort,
    requestState: () => requestState(),
    answerDialog,
    listModels,
    setModel,
    cycleModel,
    listThinkingLevels,
    setThinkingLevel,
    cycleThinkingLevel,
    compact,
    pauseInput,
    resumeInput,
    snapshot,
    get child() {
      return session.child;
    },
  };
}
