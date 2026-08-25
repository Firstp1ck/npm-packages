#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const capturePath = process.env.QT_WEBUI_SMOKE_CAPTURE_PATH;
const statePath = process.env.QT_WEBUI_SMOKE_STATE_PATH;
const startupStage = statePath && existsSync(statePath) ? readFileSync(statePath, "utf8").trim() : "initial";
let startupNoiseSent = false;
let dialogResponses = new Set();
let dialogReceiptSent = false;
let activeAbort = false;
let delayedContinuation = null;

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

function emitDialogs() {
  for (const method of ["select", "confirm", "input", "editor"]) {
    emit({ type: "extension_ui_request", id: `dialog-${method}`, method, title: `Fixture ${method}` });
  }
}

function maybeEmitDialogReceipt() {
  if (dialogReceiptSent || dialogResponses.size !== 4) return;
  dialogReceiptSent = true;
  emit({
    type: "extension_ui_request",
    id: "dialog-receipt",
    method: "notify",
    message: "QT_WEBUI_SMOKE_DIALOG_CANCEL_RECEIPT",
    notifyType: "info",
  });
}

function runStream(command) {
  response(command);
  emit({ type: "agent_start" });
  emitDialogs();
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "streamed draft" } });
  emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "<b>read</b>", args: {} });
  emit({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "<b>read</b>", result: { ok: true }, isError: false });
  emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "authoritative final" }] } });
  setTimeout(() => emit({ type: "agent_settled" }), 30);
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
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
  }
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
    }
    const lineEnding = startupStage === "initial" ? "\r\n" : "\n";
    emit({
      type: "response",
      id: command.id,
      command: "get_state",
      success: true,
      data: {
        model: { provider: "fixture-provider", id: "fixture-model" },
        thinkingLevel: "high",
        isStreaming: false,
        isCompacting: false,
      },
    }, lineEnding);
    return;
  }

  if (command.type === "extension_ui_response") {
    if (command.cancelled === true && typeof command.id === "string" && command.id.startsWith("dialog-")) {
      dialogResponses.add(command.id);
      maybeEmitDialogReceipt();
    }
    return;
  }

  if (command.type === "abort") {
    response(command);
    if (activeAbort) {
      activeAbort = false;
      clearTimeout(delayedContinuation);
      delayedContinuation = null;
      emit({
        type: "extension_ui_request",
        id: "delayed-abort-receipt",
        method: "notify",
        message: "QT_WEBUI_SMOKE_DELAYED_AGENT_ABORTED",
        notifyType: "info",
      });
      emit({ type: "agent_settled", aborted: true });
    }
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
    case "__QT_WEBUI_IMMEDIATE__":
      response(command);
      break;
    case "__QT_WEBUI_PROVIDER_ERROR__":
      runProviderError(command);
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

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line) return;
  try {
    const command = JSON.parse(line);
    if (command && typeof command === "object") handle(command);
  } catch (error) {
    process.stderr.write(`fake-pi-rpc received invalid JSON: ${error.message}\n`);
    process.exitCode = 2;
  }
});
