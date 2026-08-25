#!/usr/bin/env node
// Deterministic stand-in for `pi --mode rpc`. It speaks the same LF-delimited JSONL protocol,
// records every command it receives, and replays scripted scenarios keyed by prompt text so
// the backend and the live Quickshell smoke can exercise protocol edges without a provider.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const capturePath = process.env.QT_WEBUI_SMOKE_CAPTURE_PATH;
const statePath = process.env.QT_WEBUI_SMOKE_STATE_PATH;
const startupStage = statePath && existsSync(statePath) ? readFileSync(statePath, "utf8").trim() : "initial";
let startupNoiseSent = false;
const dialogAnswers = new Map();
let dialogReceiptSent = false;
let dialogCancelReceiptSent = false;
let activeAbort = false;
let delayedContinuation = null;

// Model inventory: the reasoning model exposes every level; the fast model has none. The odd
// entries prove the backend drops malformed models and strips terminal color codes.
const MODELS = [
  { id: "fixture-model", name: "Fixture Model", provider: "fixture-provider", api: "fixture", baseUrl: "https://fixture.invalid", reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 16_384, cost: { input: 1, output: 2 } },
  { id: "fixture-fast", name: "Fixture Fast \u001b[31mred\u001b[0m", provider: "fixture-provider", api: "fixture", reasoning: false, input: ["text"], contextWindow: 32_000, maxTokens: 4_096 },
  { id: "other-model", name: "Other Model", provider: "other-provider", api: "other", reasoning: true, input: ["text"], contextWindow: 128_000, maxTokens: 8_192 },
  { id: "", name: "Nameless", provider: "broken" },
  "not a model",
  { id: "fixture-model", name: "Duplicate", provider: "fixture-provider", reasoning: true },
];
let currentModel = MODELS[0];
let currentThinkingLevel = "high";
let compacting = false;

function thinkingLevelsFor(model) {
  return model.reasoning ? ["off", "minimal", "low", "medium", "high"] : ["off"];
}

const MARKDOWN_SAMPLE = [
  "# Heading one",
  "",
  "Some **bold** text, *emphasis*, `inline code`, and a [safe link](https://example.com/docs).",
  "Raw <img src=\"file:///etc/passwd\"> markup and <script>alert(1)</script> must stay inert.",
  "A [blocked link](javascript:alert(1)) and ![an image](https://example.com/image.png).",
  "",
  "```js",
  "const answer = 1 < 2 && \"<b>not bold</b>\";",
  "```",
  "",
  "- first item",
  "- second item",
  "  - nested item",
  "",
  "> quoted **line**",
  "",
  "| col a | col b |",
  "|---|---|",
  "| 1 | 2 |",
].join("\n");

function emit(value, ending = "\n") {
  process.stdout.write(`${JSON.stringify(value)}${ending}`);
}

function response(command, success = true, extra = {}) {
  emit({
    type: "response",
    ...(typeof command.id === "string" ? { id: command.id } : {}),
    command: command.type,
    success,
    ...extra,
  });
}

function capture(command) {
  if (!capturePath) return;
  appendFileSync(capturePath, `${JSON.stringify(command)}\n`);
}

function notify(message, notifyType = "info") {
  emit({ type: "extension_ui_request", id: `notify-${message}`, method: "notify", message, notifyType });
}

function emitDialogs() {
  emit({ type: "extension_ui_request", id: "dialog-select", method: "select", title: "Fixture select", message: "Pick one", options: ["Allow", "Block"], timeout: 60_000 });
  emit({ type: "extension_ui_request", id: "dialog-confirm", method: "confirm", title: "Fixture confirm", message: "Continue?" });
  emit({ type: "extension_ui_request", id: "dialog-input", method: "input", title: "Fixture input", placeholder: "type something" });
  emit({ type: "extension_ui_request", id: "dialog-editor", method: "editor", title: "Fixture editor", prefill: "Line 1\nLine 2" });
  emit({ type: "extension_ui_request", id: "dialog-cancel", method: "input", title: "Fixture cancel", placeholder: "cancel me" });
}

function maybeEmitDialogReceipts() {
  const expected = [["dialog-select", "value", "Block"], ["dialog-confirm", "confirmed", true], ["dialog-input", "value", "typed value"], ["dialog-editor", "value", "Line 1\nLine 2\nLine 3"]];
  if (!dialogReceiptSent && expected.every(([id, key, value]) => dialogAnswers.get(id)?.[key] === value)) {
    dialogReceiptSent = true;
    notify("QT_WEBUI_SMOKE_DIALOG_ANSWER_RECEIPT");
  }
  if (!dialogCancelReceiptSent && dialogAnswers.get("dialog-cancel")?.cancelled === true) {
    dialogCancelReceiptSent = true;
    notify("QT_WEBUI_SMOKE_DIALOG_CANCEL_RECEIPT");
  }
}

function runStream(command) {
  response(command);
  emit({ type: "agent_start" });
  emit({ type: "message_start", message: { role: "assistant", content: [] } });
  emit({ type: "extension_ui_request", id: "status-plain", method: "setStatus", statusKey: "plain-ext", statusText: "plain status <b>text</b> \u001b[38;2;249;22;22mred\u001b[0m [38;2;1;2;3mraw" });
  emit({ type: "extension_ui_request", id: "status-controls", method: "setStatus", statusKey: "pi-remote-webui:controls", statusText: JSON.stringify({ type: "firstpick.pi-package-remote-webui.controls", version: 1, title: "Remote WebUI", description: "Open, close, and protect LAN access.", commands: { open: "/remote" } }) });
  emit({ type: "extension_ui_request", id: "status-cwd", method: "setStatus", statusKey: "cd-history", statusText: "cwd ~/project" });
  emit({
    type: "extension_ui_request", id: "status-footer", method: "setStatus", statusKey: "git-footer-webui",
    statusText: JSON.stringify({
      type: "firstpick.git-footer-status.footer", version: 1, generatedAt: 1,
      main: [{ key: "pi", icon: "π", label: "pi", value: "45k tok", title: "PI context" }, { key: "git", icon: "", label: "git", value: "main ↑1", title: "Branch <b>main</b>" }, { key: "cwd", label: "cwd", value: "~/project" }],
      meta: [{ key: "speed", label: "speed", value: "42 tok/s" }, { key: "context", label: "pi", value: "45k tok" }, { key: "model", label: "model", value: "x" }, { label: "", value: "" }],
    }),
  });
  emitDialogs();
  emit({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
  emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "thinking about it" } });
  emit({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "thinking about it" } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1 } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "streamed draft" } });
  emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "<b>read</b>", args: { path: "/tmp/<b>file</b>.txt", nested: { deep: true } } });
  emit({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "<b>read</b>", args: {}, partialResult: { content: [{ type: "text", text: "partial <i>output</i>" }] } });
  emit({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "<b>read</b>", result: { content: [{ type: "text", text: "final tool output" }] }, isError: false });
  emit({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "thinking about it" }, { type: "text", text: "authoritative final" }], stopReason: "stop" } });
  setTimeout(() => emit({ type: "agent_settled" }), 30);
}

function runMarkdown(command) {
  response(command);
  emit({ type: "agent_start" });
  emit({ type: "message_start", message: { role: "assistant", content: [] } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  for (const chunk of MARKDOWN_SAMPLE.match(/[\s\S]{1,40}/g)) {
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: chunk } });
  }
  // Delay the authoritative message so the backend's streaming render cadence is observable.
  setTimeout(() => {
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: MARKDOWN_SAMPLE }], stopReason: "stop" } });
    setTimeout(() => emit({ type: "agent_settled" }), 30);
  }, 200);
}

function runProviderError(command) {
  response(command);
  emit({ type: "agent_start" });
  emit({
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: `deterministic provider failure ${"x".repeat(700)}`,
    },
  });
  setTimeout(() => emit({ type: "agent_settled" }), 30);
}

function runToolError(command) {
  response(command);
  emit({ type: "agent_start" });
  emit({ type: "tool_execution_start", toolCallId: "tool-err", toolName: "bash", args: { command: "exit 1" } });
  emit({ type: "tool_execution_end", toolCallId: "tool-err", toolName: "bash", result: { content: [{ type: "text", text: "boom" }] }, isError: true });
  emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "tool failed" }], stopReason: "stop" } });
  setTimeout(() => emit({ type: "agent_settled" }), 30);
}

function runDelayedAbort(command) {
  response(command);
  setTimeout(() => {
    activeAbort = true;
    emit({ type: "agent_start" });
    delayedContinuation = setTimeout(() => {
      activeAbort = false;
      emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "delayed run continued after abort" }] },
      });
      emit({ type: "agent_settled" });
    }, 200);
  }, 120);
}

function runLimits(command) {
  response(command);
  emit({ type: "agent_start" });
  for (let index = 0; index < 95; index += 1) {
    const text = index === 94 ? "x".repeat(10_000) : `bounded assistant row ${index}`;
    emit({ type: "message_start", message: { role: "assistant", content: [] } });
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
  }
  emit({ type: "agent_settled" });
}

// Thousands of essential tool records with large outputs: exercises the backend's bounded
// outbound queue while the consumer is not reading.
function runFlood(command) {
  response(command);
  emit({ type: "agent_start" });
  const output = "flood output ".repeat(400);
  let sent = 0;
  const pump = () => {
    for (let index = 0; index < 100 && sent < 2500; index += 1, sent += 1) {
      emit({ type: "tool_execution_start", toolCallId: `flood-${sent}`, toolName: "flood", args: { index: sent } });
      emit({ type: "tool_execution_end", toolCallId: `flood-${sent}`, toolName: "flood", result: { content: [{ type: "text", text: output }] }, isError: false });
    }
    if (sent < 2500) {
      setImmediate(pump);
      return;
    }
    emit({ type: "message_start", message: { role: "assistant", content: [] } });
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "flood done" }], stopReason: "stop" } });
    emit({ type: "agent_settled" });
  };
  pump();
}

let grandchild = null;

function runGrandchild(command) {
  response(command);
  grandchild = spawn("sleep", ["300"], { stdio: "ignore" });
  emit({ type: "agent_start" });
  emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `grandchild ${grandchild.pid}` }], stopReason: "stop" } });
  emit({ type: "agent_settled" });
}

function handle(command) {
  capture(command);

  if (command.type === "get_state") {
    if (startupStage === "failed-state") {
      if (statePath) writeFileSync(statePath, "missing-state\n");
      response(command, false, { error: "deterministic startup state failure" });
      return;
    }
    if (startupStage === "missing-state") {
      if (statePath) writeFileSync(statePath, "recovered-state\n");
      return;
    }
    if (!startupNoiseSent && startupStage === "initial") {
      startupNoiseSent = true;
      process.stdout.write("{malformed rpc record}\n");
      emit({ type: "future_unknown_event", payload: "must be ignored" });
      emit({ type: "response", id: "qt-webui-stale-0", command: "get_state", success: true, data: { model: null } });
    }
    const lineEnding = startupStage === "initial" ? "\r\n" : "\n";
    emit({
      type: "response",
      id: command.id,
      command: "get_state",
      success: true,
      data: {
        model: currentModel,
        thinkingLevel: currentThinkingLevel,
        isStreaming: false,
        isCompacting: compacting,
        sessionId: "fixture-session",
        sessionName: "Fixture session",
        sessionFile: "/tmp/fixture-session.jsonl",
        messageCount: 0,
      },
    }, lineEnding);
    return;
  }

  if (command.type === "extension_ui_response") {
    if (typeof command.id === "string" && command.id.startsWith("dialog-")) {
      dialogAnswers.set(command.id, command);
      maybeEmitDialogReceipts();
    }
    return;
  }

  if (command.type === "abort") {
    response(command);
    if (activeAbort) {
      activeAbort = false;
      clearTimeout(delayedContinuation);
      delayedContinuation = null;
      notify("QT_WEBUI_SMOKE_DELAYED_AGENT_ABORTED");
      emit({ type: "agent_settled", aborted: true });
    }
    return;
  }

  if (command.type === "get_available_models") {
    response(command, true, { data: { models: process.env.QT_WEBUI_FIXTURE_MANY_MODELS === "1"
      ? MODELS.concat(Array.from({ length: 300 }, (_, index) => ({ id: `bulk-${index}`, name: `Bulk ${index}`, provider: "bulk", reasoning: false })))
      : MODELS } });
    return;
  }

  if (command.type === "set_model") {
    const model = MODELS.find((entry) => entry && typeof entry === "object" && entry.id === command.modelId && entry.provider === command.provider && entry.id.length > 0);
    if (!model) {
      response(command, false, { error: `unknown model ${command.provider}/${command.modelId}` });
      return;
    }
    currentModel = model;
    if (!thinkingLevelsFor(model).includes(currentThinkingLevel)) currentThinkingLevel = "off";
    response(command, true, { data: model });
    return;
  }

  if (command.type === "cycle_model") {
    const selectable = MODELS.filter((entry) => entry && typeof entry === "object" && entry.id.length > 0 && entry.name !== "Duplicate");
    const next = selectable[(selectable.indexOf(currentModel) + 1) % selectable.length];
    currentModel = next;
    if (!thinkingLevelsFor(next).includes(currentThinkingLevel)) currentThinkingLevel = "off";
    response(command, true, { data: { model: next, thinkingLevel: currentThinkingLevel, isScoped: false } });
    return;
  }

  if (command.type === "get_available_thinking_levels") {
    response(command, true, { data: { levels: thinkingLevelsFor(currentModel).concat(["bogus"]) } });
    return;
  }

  if (command.type === "set_thinking_level") {
    if (!thinkingLevelsFor(currentModel).includes(command.level)) {
      response(command, false, { error: `thinking level ${command.level} is not supported by ${currentModel.id}` });
      return;
    }
    currentThinkingLevel = command.level;
    response(command);
    return;
  }

  if (command.type === "cycle_thinking_level") {
    const levels = thinkingLevelsFor(currentModel);
    if (levels.length < 2) {
      response(command, true, { data: null });
      return;
    }
    currentThinkingLevel = levels[(levels.indexOf(currentThinkingLevel) + 1) % levels.length];
    response(command, true, { data: { level: currentThinkingLevel } });
    return;
  }

  if (command.type === "compact") {
    compacting = true;
    emit({ type: "compaction_start", reason: "manual" });
    setTimeout(() => {
      compacting = false;
      if (command.customInstructions === "__QT_WEBUI_COMPACT_FAIL__") {
        emit({ type: "compaction_end", reason: "manual", result: null, aborted: false, errorMessage: "deterministic compaction failure" });
        response(command, false, { error: "deterministic compaction failure" });
        return;
      }
      const result = { summary: `Summary (${command.customInstructions ?? "default"}) \u001b[32mok\u001b[0m`, firstKeptEntryId: "kept-1", tokensBefore: 150_000, estimatedTokensAfter: 32_000, details: {} };
      emit({ type: "compaction_end", reason: "manual", result, aborted: false, willRetry: false });
      response(command, true, { data: result });
    }, 60);
    return;
  }

  if (command.type === "steer" || command.type === "follow_up") {
    response(command);
    emit({ type: "queue_update", steering: command.type === "steer" ? [command.message] : [], followUp: command.type === "follow_up" ? [command.message] : [] });
    return;
  }

  if (command.type !== "prompt") {
    response(command, false, { error: `unsupported fixture command: ${command.type}` });
    return;
  }

  switch (command.message) {
    case "__QT_WEBUI_STREAM__":
      runStream(command);
      break;
    case "__QT_WEBUI_MARKDOWN__":
      runMarkdown(command);
      break;
    case "__QT_WEBUI_IMMEDIATE__":
      response(command);
      break;
    case "__QT_WEBUI_PROVIDER_ERROR__":
      runProviderError(command);
      break;
    case "__QT_WEBUI_TOOL_ERROR__":
      runToolError(command);
      break;
    case "__QT_WEBUI_FAIL__":
      response(command, false, { error: "deterministic prompt rejection" });
      break;
    case "__QT_WEBUI_DELAYED_ABORT__":
      runDelayedAbort(command);
      break;
    case "__QT_WEBUI_LIMITS__":
      runLimits(command);
      break;
    case "__QT_WEBUI_FLOOD__":
      runFlood(command);
      break;
    case "__QT_WEBUI_GRANDCHILD__":
      runGrandchild(command);
      break;
    case "__QT_WEBUI_SILENT__":
      // Accept the prompt but never answer: exercises client-side timeouts.
      break;
    case "__QT_WEBUI_EXIT__":
      response(command);
      if (statePath) writeFileSync(statePath, "failed-state\n");
      setTimeout(() => process.exit(23), 20);
      break;
    default:
      response(command, false, { error: "unexpected fixture prompt" });
      break;
  }
}

// Strict LF-only JSONL reader (Pi's protocol forbids readline's Unicode separators).
const decoder = new StringDecoder("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    let line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line) continue;
    try {
      const command = JSON.parse(line);
      if (command && typeof command === "object") handle(command);
    } catch (error) {
      process.stderr.write(`fake-pi-rpc received invalid JSON: ${error.message}\n`);
      process.exitCode = 2;
    }
  }
});
process.stdin.on("end", () => {
  // Like Pi, stop owned tool processes when the client goes away, then exit.
  clearTimeout(delayedContinuation);
  if (grandchild && grandchild.exitCode === null) grandchild.kill("SIGTERM");
  process.exit(process.exitCode ?? 0);
});
