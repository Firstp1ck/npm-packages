#!/usr/bin/env node
// Minimal JSONL RPC stub standing in for the pi coding agent so HTTP endpoint
// tests can boot the real pi-webui server without a model provider.
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const sessionIndex = process.argv.indexOf("--session");
const sessionFile = sessionIndex !== -1 ? process.argv[sessionIndex + 1] : undefined;

let activeBash = 0;
let peakBash = 0;
let thinkingLevel = "off";
let conversationEnabled = false;

function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitEvent(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
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
  const base = { type: "response", id, command: type, success: true };

  switch (type) {
    case "get_state":
      respond({
        ...base,
        data: {
          model: { provider: "fake", id: "fake-model" },
          thinkingLevel,
          isStreaming: false,
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
    case "prompt":
      if (handleTalkPrompt(command, base)) return;
      respond({ ...base, data: { output: "fake prompt accepted" } });
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
