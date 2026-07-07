#!/usr/bin/env node
// Minimal JSONL RPC stub standing in for the pi coding agent so HTTP endpoint
// tests can boot the real pi-webui server without a model provider.
//
// Optional env-gated features (default off; without them the voice scripting
// and logging additions are inert and command responses are unchanged, except
// that "steer" now gets an explicit success payload instead of the generic
// default-case response — no test asserts on either shape):
// - FAKE_PI_LOG_FILE=<path>: append one JSON line per received RPC command
//   ({direction:"command", type, message}) plus one per scripted event emitted
//   ({direction:"event", type}), so browser-driver tests can assert ordering.
// - FAKE_PI_VOICE_SCRIPTS=1: prompts containing "voice test say|question|tool|slow"
//   respond success and then asynchronously emit a scripted agent event flow
//   (agent_start/message_*/tool_execution_*/agent_end) over stdout; the scripted
//   assistant turns are appended to a dynamic transcript returned by
//   get_messages AFTER the three baseline messages, and get_state reports
//   isStreaming=true while a scripted flow runs.
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

const sessionIndex = process.argv.indexOf("--session");
const sessionFile = sessionIndex !== -1 ? process.argv[sessionIndex + 1] : undefined;

let activeBash = 0;
let peakBash = 0;
let thinkingLevel = "off";
let conversationEnabled = false;

const voiceScriptsEnabled = process.env.FAKE_PI_VOICE_SCRIPTS === "1";
const commandLogFile = process.env.FAKE_PI_LOG_FILE || "";
const staticEntries = [
  { type: "message", id: "u0000001", parentId: null, timestamp: new Date(1000).toISOString(), message: { role: "user", content: "fake prompt", timestamp: 1000 } },
  { type: "message", id: "a0000001", parentId: "u0000001", timestamp: new Date(2000).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "fake answer" }], timestamp: 2000 } },
  { type: "message", id: "u0000002", parentId: "a0000001", timestamp: new Date(3000).toISOString(), message: { role: "user", content: "fake follow-up", timestamp: 3000 } },
];
const dynamicEntries = [];
const dynamicMessages = [];
let dynamicLeafId = "u0000002";
let scriptedStreaming = false;

function allSessionEntries() {
  return [...staticEntries, ...dynamicEntries];
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : part?.type === "text" ? part.text || "" : "").filter(Boolean).join(" ");
}

function forkMessages() {
  return allSessionEntries()
    .filter((entry) => entry.type === "message" && entry.message?.role === "user")
    .map((entry) => ({ entryId: entry.id, text: messageText(entry.message.content) }));
}

function appendDynamicMessage(message) {
  const prefix = message.role === "assistant" ? "a" : "u";
  const entry = {
    type: "message",
    id: `${prefix}${randomUUID().replace(/-/g, "").slice(0, 7)}`,
    parentId: dynamicLeafId,
    timestamp: new Date().toISOString(),
    message,
  };
  dynamicEntries.push(entry);
  dynamicMessages.push(message);
  dynamicLeafId = entry.id;
  return entry;
}

function logJsonLine(entry) {
  if (!commandLogFile) return;
  try {
    appendFileSync(commandLogFile, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  } catch {
    // Logging must never break the fixture.
  }
}

function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitEvent(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitScriptedEvent(payload) {
  logJsonLine({ direction: "event", type: payload.type, ...(payload.toolName ? { toolName: payload.toolName } : {}) });
  emitEvent(payload);
}

const scriptedTimers = new Set();

function runScriptedSteps(steps) {
  let at = 0;
  for (const step of steps) {
    at += step.afterMs ?? 0;
    const timer = setTimeout(() => {
      scriptedTimers.delete(timer);
      step.run();
    }, at);
    scriptedTimers.add(timer);
  }
}

function cancelScriptedSteps() {
  for (const timer of scriptedTimers) clearTimeout(timer);
  scriptedTimers.clear();
}

// Emits a full scripted assistant turn: agent_start, optional tool phase,
// streamed assistant text, message_end, agent_end. The final assistant text is
// appended to the dynamic transcript so get_messages returns it afterwards.
function runVoiceScriptFlow({ text, chunks, chunkSpacingMs = 60, toolPhase = false, toolDurationMs = 1500 }) {
  scriptedStreaming = true;
  const steps = [{ afterMs: 30, run: () => emitScriptedEvent({ type: "agent_start" }) }];
  if (toolPhase) {
    const toolCallId = `voice-tool-${randomUUID()}`;
    steps.push({ afterMs: 50, run: () => emitScriptedEvent({ type: "tool_execution_start", toolCallId, toolName: "read", args: { path: "README.md" } }) });
    steps.push({ afterMs: toolDurationMs, run: () => emitScriptedEvent({ type: "tool_execution_end", toolCallId, toolName: "read", isError: false, result: { content: [{ type: "text", text: "fake tool output" }] } }) });
  }
  steps.push({ afterMs: toolPhase ? 120 : 50, run: () => emitScriptedEvent({ type: "message_start", message: { role: "assistant" } }) });
  for (const delta of chunks || [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))]) {
    steps.push({ afterMs: chunkSpacingMs, run: () => emitScriptedEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } }) });
  }
  steps.push({
    afterMs: chunkSpacingMs,
    run: () => {
      const message = { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() };
      appendDynamicMessage(message);
      emitScriptedEvent({ type: "message_end", message });
    },
  });
  steps.push({
    afterMs: 60,
    run: () => {
      scriptedStreaming = false;
      emitScriptedEvent({ type: "agent_end" });
    },
  });
  runScriptedSteps(steps);
}

function handleVoiceScriptPrompt(command, base) {
  if (!voiceScriptsEnabled) return false;
  const message = String(command.message || "");
  const marker = ["voice test say", "voice test question", "voice test tool", "voice test slow"].find((item) => message.includes(item));
  if (!marker) return false;
  appendDynamicMessage({ role: "user", content: message, timestamp: Date.now() });
  respond({ ...base, data: { output: "voice scripted prompt accepted" } });
  if (marker === "voice test say") {
    runVoiceScriptFlow({ text: "Okay, this is the spoken answer." });
  } else if (marker === "voice test question") {
    runVoiceScriptFlow({ text: "Should we proceed with the next step?" });
  } else if (marker === "voice test tool") {
    runVoiceScriptFlow({ text: "The tool has finished.", toolPhase: true });
  } else {
    runVoiceScriptFlow({
      text: "This is a long streaming answer that keeps going.",
      chunks: ["This is a long ", "streaming answer ", "that keeps ", "going", "."],
      chunkSpacingMs: 500,
    });
  }
  return true;
}

function conversationStatusText() {
  return conversationEnabled ? "Voice: listening" : "";
}

function emitConversationStatus() {
  emitEvent({
    type: "extension_ui_request",
    id: randomUUID(),
    method: "setStatus",
    statusKey: "natural-conversation",
    statusText: conversationStatusText(),
  });
}

function handleWebuiHelperPrompt(command, base) {
  const message = String(command.message || "").trim();
  const match = message.match(/^\/webui-helper\s+(\{[\s\S]*\})$/);
  if (!match) return false;
  let request = {};
  try {
    request = JSON.parse(match[1]);
  } catch {
    request = {};
  }
  const requestId = String(request.requestId || "");
  const respondHelper = (payload) => emitEvent({
    type: "extension_ui_request",
    id: randomUUID(),
    method: "notify",
    message: `__PI_WEBUI_HELPER_RESPONSE__:${JSON.stringify(payload)}`,
    notifyType: payload.ok === false ? "error" : "info",
  });
  respond({ ...base, data: { output: "webui-helper handled" } });
  switch (request.action) {
    case "tools-state":
      respondHelper({ requestId, ok: true, data: { tools: [], activeTools: [] } });
      return true;
    case "skills-state":
      respondHelper({ requestId, ok: true, data: { skills: [] } });
      return true;
    default:
      respondHelper({ requestId, ok: false, error: `Unknown webui-helper action: ${String(request.action || "")}` });
      return true;
  }
}

function handleTalkPrompt(command, base) {
  const message = String(command.message || "").trim();
  const match = message.match(/^\/(talk|voice|conversation)(?:\s+(\S+))?/i);
  if (!match) return false;
  const subcommand = String(match[2] || "").toLowerCase();
  if (!subcommand) conversationEnabled = !conversationEnabled;
  else if (["on", "enable", "start"].includes(subcommand)) conversationEnabled = true;
  else if (["off", "disable", "end", "stop"].includes(subcommand)) conversationEnabled = false;
  emitConversationStatus();
  respond({
    ...base,
    data: {
      output: conversationEnabled ? "Natural Conversation Mode on." : "Natural Conversation Mode off.",
      conversationMode: {
        enabled: conversationEnabled,
        uiState: conversationEnabled ? "listening" : "off",
        statusText: conversationStatusText(),
        allowedTools: ["read", "grep", "find", "ls"],
      },
    },
  });
  return true;
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return;
  }
  const { id, type } = command || {};
  if (!id || !type) return;
  logJsonLine({ direction: "command", type, ...(command.message !== undefined ? { message: String(command.message) } : {}) });
  const base = { type: "response", id, command: type, success: true };

  switch (type) {
    case "get_state":
      respond({
        ...base,
        data: {
          model: { provider: "fake", id: "fake-model" },
          thinkingLevel,
          isStreaming: scriptedStreaming,
          isCompacting: false,
          steeringMode: "one-at-a-time",
          followUpMode: "one-at-a-time",
          sessionFile,
          sessionId: "fake-session",
          sessionName: "fake",
          autoCompactionEnabled: false,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      });
      return;
    case "get_messages":
      respond({
        ...base,
        data: {
          messages: [
            { role: "user", content: "fake prompt", timestamp: 1000 },
            { role: "assistant", content: [{ type: "text", text: "fake answer" }], timestamp: 2000 },
            { role: "user", content: "fake follow-up", timestamp: 3000 },
            ...dynamicMessages,
          ],
        },
      });
      return;
    case "get_commands":
      respond({
        ...base,
        data: {
          commands: [
            { name: "talk", source: "extension", description: "Toggle Natural Conversation Mode" },
            { name: "voice", source: "extension", description: "Natural Conversation Mode alias" },
            { name: "conversation", source: "extension", description: "Natural Conversation Mode alias" },
          ],
        },
      });
      return;
    case "get_fork_messages":
      respond({ ...base, data: { messages: forkMessages() } });
      return;
    case "get_entries": {
      const entries = allSessionEntries();
      if (command.since !== undefined) {
        const sinceIndex = entries.findIndex((entry) => entry.id === command.since);
        if (sinceIndex === -1) {
          respond({ ...base, success: false, error: `Entry not found: ${command.since}` });
          return;
        }
        respond({ ...base, data: { entries: entries.slice(sinceIndex + 1), leafId: dynamicLeafId } });
        return;
      }
      respond({ ...base, data: { entries, leafId: dynamicLeafId } });
      return;
    }
    case "prompt":
      if (handleWebuiHelperPrompt(command, base)) return;
      if (handleTalkPrompt(command, base)) return;
      if (handleVoiceScriptPrompt(command, base)) return;
      respond({ ...base, data: { output: "fake prompt accepted" } });
      return;
    case "steer":
      respond({ ...base, data: { output: "fake steer accepted" } });
      return;
    case "set_thinking_level":
      thinkingLevel = String(command.level || "off");
      respond({ ...base, data: { level: thinkingLevel } });
      return;
    case "get_available_models":
      respond({ ...base, data: { models: [{ provider: "fake", id: "fake-model", name: "Fake Model" }] } });
      return;
    case "get_session_stats":
      respond({ ...base, data: { tokens: 0 } });
      return;
    case "get_last_assistant_text":
      respond({ ...base, data: { text: "fake last text" } });
      return;
    case "bash": {
      activeBash += 1;
      peakBash = Math.max(peakBash, activeBash);
      setTimeout(() => {
        activeBash -= 1;
        respond({ ...base, data: { output: `peak:${peakBash}`, exitCode: 0, cancelled: false } });
      }, 150);
      return;
    }
    default:
      respond({ ...base, data: {} });
  }
});

rl.on("close", () => {
  // The parent (pi-webui or a test driver) closed stdin or died; never let
  // pending scripted voice events outlive it and write into a broken pipe.
  cancelScriptedSteps();
});
