export const DEFAULT_ALLOWED_TOOLS = Object.freeze(["read", "grep", "find", "ls"]);
export const CONVERSATION_STATUS_KEY = "natural-conversation";

export function conversationSilenceMessage(timeoutMs = 8000) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `[Conversation mode: the user stayed silent for ${seconds}s after your question. Treat the silence as possible confusion, discomfort, missing context, or an unneeded question; reframe, explain why you asked, or continue without pressuring the user. Do not invent intent from the silence.]`;
}

export const CONVERSATION_SYSTEM_PROMPT = `[NATURAL CONVERSATION MODE ACTIVE]
Conversation mode is read-only and nondestructive. Do not edit files, run shell commands, install packages, publish releases, delete data, or perform external side effects while this mode is active. If the user asks for destructive or write-capable work, explain that they must leave conversation mode first with /talk off. Use only the currently allowed read-only tools when helpful.

Your answer is read aloud by text-to-speech. Write to be heard, not read:
- Answer in the user's language with short, flowing conversational sentences — as if speaking. No headings, bullet lists, tables, markdown, or emoji.
- Never write URLs, file paths, code identifiers, or other symbol-heavy strings verbatim; describe them in plain words instead (say "the local whisper endpoint on port 8178", not the URL; say "the German Thorsten voice", not the model filename).
- Round numbers and spell out units the way a person would say them.
- Skip meta additions that sound wrong when spoken, such as confidence scores, sign-offs, or restating these rules.`;

function safeArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

export function normalizeAllowedTools(value = DEFAULT_ALLOWED_TOOLS) {
  const seen = new Set();
  const result = [];
  for (const name of safeArray(value)) {
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result.length > 0 ? result : [...DEFAULT_ALLOWED_TOOLS];
}

function safeCall(fn, fallback) {
  try {
    return typeof fn === "function" ? fn() : fallback;
  } catch {
    return fallback;
  }
}

function knownToolNames(pi) {
  const tools = safeCall(() => pi.getAllTools(), []);
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return new Set(tools.map((tool) => tool?.name).filter((name) => typeof name === "string"));
}

function filterKnownTools(pi, names) {
  const known = knownToolNames(pi);
  if (!known) return [...names];
  return names.filter((name) => known.has(name));
}

function cloneState(state) {
  return {
    ...state,
    allowedTools: [...state.allowedTools],
    previousActiveTools: state.previousActiveTools ? [...state.previousActiveTools] : undefined,
  };
}

function notify(ctx, message, level = "info") {
  if (!ctx?.hasUI || !ctx.ui?.notify) return;
  ctx.ui.notify(message, level);
}

export function createConversationController(pi, options = {}) {
  const state = {
    enabled: false,
    previousThinkingLevel: undefined,
    previousActiveTools: undefined,
    allowedTools: normalizeAllowedTools(options.allowedTools),
    startedAt: undefined,
    uiState: "off",
    bargeInEnabled: false,
    silenceTimeoutMs: 8000,
    silenceEnabled: true,
    silenceArmed: false,
  };

  function updateStatus(ctx) {
    if (!ctx?.hasUI || !ctx.ui?.setStatus) return;
    if (!state.enabled) {
      ctx.ui.setStatus(CONVERSATION_STATUS_KEY, undefined);
      return;
    }
    const label = `Voice: ${state.uiState ?? "listening"}`;
    const styled = ctx.ui.theme?.fg ? ctx.ui.theme.fg("accent", label) : label;
    ctx.ui.setStatus(CONVERSATION_STATUS_KEY, styled);
  }

  function effectiveAllowedTools() {
    return filterKnownTools(pi, state.allowedTools);
  }

  function ensureConversationConstraints(ctx) {
    if (!state.enabled) return false;
    if (typeof pi.setThinkingLevel === "function") pi.setThinkingLevel("off");
    if (typeof pi.setActiveTools === "function") pi.setActiveTools(effectiveAllowedTools());
    updateStatus(ctx);
    return true;
  }

  function enable(ctx, overrides = {}) {
    if (overrides.allowedTools) state.allowedTools = normalizeAllowedTools(overrides.allowedTools);

    if (state.enabled) {
      ensureConversationConstraints(ctx);
      notify(ctx, "Natural Conversation Mode is already on.", "info");
      return { changed: false, state: cloneState(state) };
    }

    state.previousThinkingLevel = safeCall(() => pi.getThinkingLevel(), undefined);
    state.previousActiveTools = safeCall(() => pi.getActiveTools(), undefined);
    state.enabled = true;
    state.startedAt = new Date().toISOString();
    state.uiState = overrides.uiState ?? "listening";
    state.bargeInEnabled = overrides.bargeInEnabled === true;
    state.silenceArmed = false;
    if (overrides.silenceEnabled !== undefined) state.silenceEnabled = overrides.silenceEnabled === true;
    if (Number.isFinite(overrides.silenceTimeoutMs)) state.silenceTimeoutMs = overrides.silenceTimeoutMs;

    ensureConversationConstraints(ctx);
    notify(ctx, `Natural Conversation Mode on. Thinking is off; tools limited to: ${state.allowedTools.join(", ")}.`, "info");
    return { changed: true, state: cloneState(state) };
  }

  function disable(ctx, options = {}) {
    if (!state.enabled) {
      updateStatus(ctx);
      if (options.notify !== false) notify(ctx, "Natural Conversation Mode is already off.", "info");
      return { changed: false, state: cloneState(state) };
    }

    const previousThinkingLevel = state.previousThinkingLevel;
    const previousActiveTools = state.previousActiveTools ? [...state.previousActiveTools] : undefined;

    state.enabled = false;
    state.startedAt = undefined;
    state.uiState = "off";
    state.silenceArmed = false;
    state.previousThinkingLevel = undefined;
    state.previousActiveTools = undefined;

    if (previousThinkingLevel && typeof pi.setThinkingLevel === "function") pi.setThinkingLevel(previousThinkingLevel);
    if (previousActiveTools && typeof pi.setActiveTools === "function") pi.setActiveTools(filterKnownTools(pi, previousActiveTools));

    updateStatus(ctx);
    if (options.notify !== false) notify(ctx, "Natural Conversation Mode off. Restored previous thinking/tools where available.", "info");
    return { changed: true, state: cloneState(state) };
  }

  function shutdown(ctx) {
    return disable(ctx, { notify: false });
  }

  function isEnabled() {
    return state.enabled;
  }

  function getState() {
    return cloneState(state);
  }

  function statusText() {
    if (!state.enabled) return "Natural Conversation Mode: off";
    return [
      `Natural Conversation Mode: ${state.uiState ?? "on"}`,
      "thinking: off",
      `tools: ${state.allowedTools.join(", ")}`,
      `started: ${state.startedAt ?? "unknown"}`,
    ].join("\n");
  }

  function buildSystemPrompt(systemPrompt = "") {
    if (!state.enabled) return systemPrompt;
    return `${systemPrompt}\n\n${CONVERSATION_SYSTEM_PROMPT}`;
  }

  function handleToolCall(event) {
    if (!state.enabled) return undefined;
    const allowed = new Set(state.allowedTools);
    const toolName = typeof event?.toolName === "string" ? event.toolName : "unknown";
    if (allowed.has(toolName)) return undefined;
    return {
      block: true,
      reason: `Natural Conversation Mode is read-only; blocked tool '${toolName}'. Leave the mode with /talk off to use write, shell, publishing, or other side-effect tools.`,
    };
  }

  function handleUserBash() {
    if (!state.enabled) return undefined;
    return {
      result: {
        output: "Natural Conversation Mode blocks !/!! shell commands. Use /talk off before running shell commands.",
        exitCode: 126,
        cancelled: false,
        truncated: false,
      },
    };
  }

  function setUiState(uiState, ctx) {
    state.uiState = uiState || (state.enabled ? "listening" : "off");
    updateStatus(ctx);
    return cloneState(state);
  }

  /**
   * One-shot silence-event state machine (plan §6.2 / Phase 5b).
   * phases:
   * - "arm":    after an assistant answer; arms only when the answer ends with
   *             a question mark and silence events are enabled. Returns the
   *             timeout the orchestrator should schedule.
   * - "fire":   when the timer expires with no user speech; returns the exact
   *             WebUI-parity silence event message exactly once per question.
   * - "cancel": on any user activity; disarms without firing.
   */
  function handleConversationSilence(options = {}) {
    const phase = options.phase ?? "fire";

    if (phase === "arm") {
      const text = typeof options.assistantText === "string" ? options.assistantText.trim() : "";
      state.silenceArmed = false;
      if (!state.enabled || !state.silenceEnabled || state.silenceTimeoutMs <= 0) return { action: "ignored" };
      if (!text.endsWith("?")) return { action: "ignored" };
      state.silenceArmed = true;
      return { action: "armed", timeoutMs: state.silenceTimeoutMs };
    }

    if (phase === "cancel") {
      const wasArmed = state.silenceArmed;
      state.silenceArmed = false;
      return { action: wasArmed ? "cancelled" : "ignored" };
    }

    if (!state.enabled || !state.silenceArmed) return { action: "ignored" };
    state.silenceArmed = false;
    state.uiState = "silence";
    return { action: "send-silence-event", message: conversationSilenceMessage(state.silenceTimeoutMs) };
  }

  function handleConversationInterrupt(transcript, options = {}) {
    const text = typeof transcript === "string" ? transcript.trim() : "";
    if (!state.enabled || !text) return { action: "ignored", transcript: text };
    if (options.toolPhaseActive) {
      state.uiState = "interrupting";
      return { action: "queue-after-tool", transcript: text };
    }
    state.uiState = "interrupting";
    return { action: "new-turn", transcript: text };
  }

  return {
    enable,
    disable,
    shutdown,
    ensureConversationConstraints,
    updateStatus,
    isEnabled,
    getState,
    statusText,
    buildSystemPrompt,
    handleToolCall,
    handleUserBash,
    setUiState,
    handleConversationInterrupt,
    handleConversationSilence,
  };
}
