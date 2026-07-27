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
const sessionFile = sessionIndex !== -1
  ? process.argv[sessionIndex + 1]
  : process.env.FAKE_PI_CONTINUITY_MODE === "1" ? process.env.FAKE_PI_CONTINUITY_SESSION_FILE || undefined : undefined;

let activeBash = 0;
let peakBash = 0;
let thinkingLevel = "off";
let conversationEnabled = false;
const fakeTools = [
  { name: "read", description: "Read files", sourceInfo: { source: "builtin", scope: "temporary", origin: "top-level" } },
  { name: "bash", description: "Run shell commands", sourceInfo: { source: "builtin", scope: "temporary", origin: "top-level" } },
];
const fakeSkills = [
  { name: "repo-explorer", description: "Explore repositories" },
  { name: "code-security", description: "Review code security" },
];
let enabledToolNames = new Set(fakeTools.map((tool) => tool.name));
let enabledSkillNames = new Set(fakeSkills.map((skill) => skill.name));

const voiceScriptsEnabled = process.env.FAKE_PI_VOICE_SCRIPTS === "1";
// The continuity harness opts into this behavior explicitly so existing fixture
// consumers retain their current timing and log shapes.
const continuityModeEnabled = process.env.FAKE_PI_CONTINUITY_MODE === "1";
const largePayloadsEnabled = process.env.FAKE_PI_LARGE_PAYLOADS === "1";
const commandLogFile = process.env.FAKE_PI_LOG_FILE || "";
const largeRpcText = "large-rpc-payload:" + "λ".repeat(70_000);
const largeTokenSamples = Array.from({ length: 300 }, (_, index) => ({ index, input: index + 1, output: index + 2 }));
const staticEntries = [
  { type: "message", id: "u0000001", parentId: null, timestamp: new Date(1000).toISOString(), message: { role: "user", content: "fake prompt", timestamp: 1000 } },
  { type: "message", id: "a0000001", parentId: "u0000001", timestamp: new Date(2000).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "fake answer" }], timestamp: 2000 } },
  { type: "message", id: "u0000002", parentId: "a0000001", timestamp: new Date(3000).toISOString(), message: { role: "user", content: "fake follow-up", timestamp: 3000 } },
];
const dynamicEntries = [];
const dynamicMessages = [];
let dynamicLeafId = "u0000002";
let scriptedStreaming = false;
let continuityRun = 0;
let largeTranscriptEnabled = false;

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

logJsonLine({
  direction: "startup",
  cwd: process.cwd(),
  recoveryUrl: String(process.env.PI_WEBUI_RECOVERY_URL || ""),
  recoveryTokenConfigured: Boolean(process.env.PI_WEBUI_RECOVERY_TOKEN),
  ...(continuityModeEnabled ? { pid: process.pid, continuityMode: true } : {}),
});

function continuityExitMarker(signal) {
  if (continuityModeEnabled) logJsonLine({ direction: "exit", signal, pid: process.pid });
}

if (continuityModeEnabled) {
  process.on("SIGTERM", () => {
    continuityExitMarker("SIGTERM");
    process.exit(143);
  });
  process.on("SIGINT", () => {
    continuityExitMarker("SIGINT");
    process.exit(130);
  });
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

function runContinuityDelayedStream() {
  scriptedStreaming = true;
  const text = "continuity stream complete";
  const run = ++continuityRun;
  const tagged = (payload) => ({ ...payload, continuityRun: run });
  const steps = [
    { afterMs: 80, run: () => emitScriptedEvent(tagged({ type: "agent_start", continuityStep: "start" })) },
    { afterMs: 80, run: () => emitScriptedEvent(tagged({ type: "message_start", continuityStep: "message-start", message: { role: "assistant" } })) },
    { afterMs: 300, run: () => emitScriptedEvent(tagged({ type: "message_update", continuityStep: "delta-1", assistantMessageEvent: { type: "text_delta", delta: "continuity " } })) },
    { afterMs: 300, run: () => emitScriptedEvent(tagged({ type: "message_update", continuityStep: "delta-2", assistantMessageEvent: { type: "text_delta", delta: "stream " } })) },
    { afterMs: 300, run: () => emitScriptedEvent(tagged({ type: "message_update", continuityStep: "delta-3", assistantMessageEvent: { type: "text_delta", delta: "complete" } })) },
    { afterMs: 100, run: () => {
      const message = { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() };
      appendDynamicMessage(message);
      emitScriptedEvent(tagged({ type: "message_end", continuityStep: "message-end", message }));
    } },
    { afterMs: 80, run: () => {
      scriptedStreaming = false;
      emitScriptedEvent(tagged({ type: "agent_end", continuityStep: "end" }));
    } },
  ];
  runScriptedSteps(steps);
}

function handleContinuityPrompt(command, base) {
  if (!continuityModeEnabled || String(command.message || "").trim() !== "fixture continuity delayed stream") return false;
  appendDynamicMessage({ role: "user", content: String(command.message), timestamp: Date.now() });
  respond({ ...base, data: { output: "fake continuity stream accepted", pid: process.pid } });
  runContinuityDelayedStream();
  return true;
}

function handleLargePayloadPrompt(command, base) {
  if (!largePayloadsEnabled || String(command.message || "").trim() !== "fixture large rpc payload") return false;
  largeTranscriptEnabled = true;
  respond({ ...base, data: { output: largeRpcText, tokens: { input: 123456, output: 654321 }, samples: largeTokenSamples } });
  return true;
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
      respondHelper({ requestId, ok: true, data: { tools: fakeTools.map((tool) => ({ ...tool, enabled: enabledToolNames.has(tool.name) })) } });
      return true;
    case "tools-set": {
      if (Array.isArray(request.payload?.enabledTools)) enabledToolNames = new Set(request.payload.enabledTools.map(String));
      else if (Array.isArray(request.payload?.disabledTools)) {
        const disabled = new Set(request.payload.disabledTools.map(String));
        enabledToolNames = new Set(fakeTools.map((tool) => tool.name).filter((name) => !disabled.has(name)));
      }
      respondHelper({ requestId, ok: true, data: { tools: fakeTools.map((tool) => ({ ...tool, enabled: enabledToolNames.has(tool.name) })) } });
      return true;
    }
    case "skills-state":
      respondHelper({ requestId, ok: true, data: { skills: fakeSkills.map((skill) => ({ ...skill, enabled: enabledSkillNames.has(skill.name) })) } });
      return true;
    case "skills-set": {
      if (Array.isArray(request.payload?.enabledSkills)) enabledSkillNames = new Set(request.payload.enabledSkills.map(String));
      else if (Array.isArray(request.payload?.disabledSkills)) {
        const disabled = new Set(request.payload.disabledSkills.map(String));
        enabledSkillNames = new Set(fakeSkills.map((skill) => skill.name).filter((name) => !disabled.has(name)));
      }
      respondHelper({ requestId, ok: true, data: { skills: fakeSkills.map((skill) => ({ ...skill, enabled: enabledSkillNames.has(skill.name) })) } });
      return true;
    }
    case "subagent-output":
      respondHelper({
        requestId,
        ok: true,
        data: {
          version: 1,
          runId: request.payload?.runId || "fixture-run",
          source: "async",
          mode: "parallel",
          startedAt: Date.now() - 3000,
          updatedAt: Date.now(),
          agent: {
            id: request.payload?.agentId || "fixture-run:0",
            name: String(request.payload?.agentId || "").endsWith(":1") ? "scout" : "reviewer",
            index: String(request.payload?.agentId || "").endsWith(":1") ? 1 : 0,
            status: "running",
            currentTool: "read",
            currentToolArgs: "README.md",
            model: "anthropic/claude-opus-4-8:high",
            thinking: "high",
            recentTools: [{ tool: "grep", args: "Subagents", endMs: Date.now() - 200 }],
            recentOutput: ["Inspecting current implementation", "Waiting for the next tool result"],
            transcript: [
              {
                role: "assistant",
                timestamp: "2026-07-19T12:00:00.000Z",
                content: [
                  { type: "thinking", thinking: "Checking the fixture transcript." },
                  { type: "text", text: "Inspecting current implementation" },
                  { type: "toolCall", id: "fixture-read", name: "read", arguments: { path: "README.md", offset: 1 } },
                  { type: "text", text: "Waiting for the next tool result" },
                ],
              },
              {
                role: "toolResult",
                timestamp: "2026-07-19T12:00:01.000Z",
                toolCallId: "fixture-read",
                toolName: "read",
                isError: false,
                content: [{ type: "text", text: "# Fixture README" }],
              },
            ],
            turnCount: 2,
            toolCount: 3,
            tokens: 420,
          },
        },
      });
      return true;
    default:
      respondHelper({ requestId, ok: false, error: `Unknown webui-helper action: ${String(request.action || "")}` });
      return true;
  }
}

function handleDocumentArtifactFixturePrompt(command, base) {
  const message = String(command.message || "").trim();
  if (message === "fixture document artifact clear") { for (let index = dynamicMessages.length - 1; index >= 0; index--) if (dynamicMessages[index]?.toolName === "docx_render") { dynamicMessages.splice(index, 1); dynamicEntries.splice(index, 1); } dynamicLeafId = dynamicEntries.at(-1)?.id || "u0000002"; respond({ ...base, data: { output: "fake document artifacts cleared" } }); return true; }
  if (message !== "fixture document artifact" || !process.env.FAKE_PI_ARTIFACT_MANIFEST) return false;
  const toolCallId = `artifact-${randomUUID()}`, artifact = { schema: "pi.artifact/v1", kind: "document", id: "fixture-document-artifact", revisionId: "fixture-revision", title: "fixture.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pageCount: 1, manifestPath: process.env.FAKE_PI_ARTIFACT_MANIFEST, downloadPath: process.env.FAKE_PI_ARTIFACT_DOWNLOAD, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, result = { content: [{ type: "text", text: "Rendered fixture document" }], details: { artifact } };
  appendDynamicMessage({ role: "toolResult", toolCallId, toolName: "docx_render", content: result.content, details: result.details, isError: false, timestamp: Date.now() });
  respond({ ...base, data: { output: "fake document artifact emitted" } });
  emitEvent({ type: "tool_execution_end", toolCallId, toolName: "docx_render", isError: false, result });
  return true;
}

function fastModeMessageUpdate(delta, accumulated) {
  const partial = { role: "assistant", content: [{ type: "text", text: accumulated }] };
  return {
    type: "message_update",
    message: partial,
    assistantMessageEvent: { type: "text_delta", delta, contentIndex: 0, partial },
  };
}

function runFastModeFixtureFlow({ barrierOnly = false } = {}) {
  const toolCallId = "fast-mode-tool";
  const firstText = "fast mode first delta ";
  const finalText = `${firstText}and final delta`;
  const finish = () => {
    emitEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: finalText }] } });
    emitEvent({ type: "agent_end" });
  };
  emitEvent({ type: "agent_start" });
  emitEvent({ type: "message_start", message: { role: "assistant" } });
  emitEvent(fastModeMessageUpdate(firstText, firstText));
  if (barrierOnly) {
    setTimeout(finish, 180);
    return;
  }
  setTimeout(() => {
    emitEvent({ type: "tool_execution_start", toolCallId, toolName: "read", args: { path: "fast-mode.txt" } });
    emitEvent({ type: "tool_execution_update", toolCallId, toolName: "read", partialResult: { content: [{ type: "text", text: "intermediate tool work" }] } });
    emitEvent({ type: "tool_execution_end", toolCallId, toolName: "read", isError: false, result: { content: [{ type: "text", text: "final tool result" }] } });
    emitEvent({ type: "pi_stderr", text: "fast mode fixture diagnostic" });
    emitEvent({ type: "extension_ui_request", id: "fast-mode-dialog", method: "confirm", title: "Fast mode dialog", message: "Preserve this dialog" });
    emitEvent(fastModeMessageUpdate("and final delta", finalText));
    finish();
  }, 20);
}

function runFastModeHistoryFlow() {
  let accumulated = "";
  emitEvent({ type: "agent_start" });
  emitEvent({ type: "message_start", message: { role: "assistant" } });
  for (let index = 0; index < 512; index += 1) {
    const delta = `h${String(index).padStart(3, "0")}`;
    accumulated += delta;
    emitEvent(fastModeMessageUpdate(delta, accumulated));
  }
  emitEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: accumulated }] } });
  emitEvent({ type: "agent_end" });
}

function handleFastModeFixturePrompt(command, base) {
  const message = String(command.message || "").trim();
  if (!["fixture fast mode flow", "fixture fast mode barrier", "fixture fast mode history"].includes(message)) return false;
  respond({ ...base, data: { output: "fast mode fixture accepted" } });
  if (message.endsWith("history")) runFastModeHistoryFlow();
  else runFastModeFixtureFlow({ barrierOnly: message.endsWith("barrier") });
  return true;
}

function handleTransportFixturePrompt(command, base) {
  const message = String(command.message || "").trim();
  if (message === "fixture stderr diagnostic") {
    process.stderr.write("fixture Pi RPC stderr diagnostic\n");
    respond({ ...base, data: { output: "fake stderr diagnostic emitted" } });
    return true;
  }
  if (message === "fixture oversized jsonl") {
    const bytes = Math.max(0, Math.min(64 * 1024 * 1024, Number.parseInt(process.env.FAKE_PI_OVERSIZED_JSONL_BYTES || "0", 10) || 0));
    if (bytes === 0) {
      respond({ ...base, success: false, error: "FAKE_PI_OVERSIZED_JSONL_BYTES must be configured" });
      return true;
    }
    // Intentionally leave this physical JSONL line unterminated long enough
    // for the server to switch into discard mode before sending a valid reply.
    process.stdout.write("x".repeat(bytes));
    setTimeout(() => {
      process.stdout.write("\n");
      respond({ ...base, data: { output: "fake oversized JSONL line discarded" } });
    }, 50);
    return true;
  }
  return false;
}

function handleSubagentFixturePrompt(command, base) {
  const message = String(command.message || "").trim();
  if (message !== "fixture subagents running" && message !== "fixture subagents clear") return false;
  const clearing = message.endsWith("clear");
  const runs = clearing ? [] : [{
    id: "fixture-run",
    source: "async",
    mode: "parallel",
    status: "running",
    startedAt: Date.now() - 2500,
    agents: [
      { id: "fixture-run:0", name: "reviewer", status: "running", index: 0, currentTool: "read", model: "anthropic/claude-opus-4-8:high", thinking: "high", nested: false },
      { id: "fixture-run:1", name: "scout", status: "running", index: 1, model: "openai-codex/gpt-5.6-sol", thinking: "high", nested: false },
    ],
  }];
  const gates = clearing ? [] : [{
    version: 1,
    id: "fixture-gate",
    status: "running",
    requiredSuccesses: 2,
    qualifyingSuccesses: 1,
    requireDistinctProviders: true,
    startedAt: Date.now() - 3000,
    updatedAt: Date.now(),
    attempts: [
      { id: "fixture-gate:0:1", taskIndex: 0, attempt: 1, maxAttempts: 2, agent: "reviewer", retrySafety: "read-only", runId: "fixture-review-1", model: "anthropic/claude-opus-4-8", provider: "anthropic", status: "succeeded" },
      { id: "fixture-gate:1:1", taskIndex: 1, attempt: 1, maxAttempts: 2, agent: "reviewer", retrySafety: "read-only", runId: "fixture-review-2", model: "openrouter/moonshotai/kimi-k3", provider: "openrouter", status: "failed", failureKind: "transient-provider", error: "provider overloaded" },
    ],
  }];
  respond({ ...base, data: { output: "fake subagent status emitted" } });
  emitEvent({
    type: "extension_ui_request",
    id: randomUUID(),
    method: "setStatus",
    statusKey: "webui-subagents",
    statusText: `PI_WEBUI_SUBAGENTS_V1 ${JSON.stringify({ version: 1, available: true, updatedAt: Date.now(), runs, gates })}`,
  });
  return true;
}

function handleWorkflowFixturePrompt(command, base) {
  const message = String(command.message || "").trim();
  if (!/^fixture workflow inspector (running|completed|clear)$/.test(message)) return false;
  const status = message.split(" ").at(-1);
  const now = new Date().toISOString();
  const runs = status === "clear" ? [] : [{
    runId: "fixture-workflow-run",
    workflowKey: "fixture-workflow",
    workflowName: "Fixture Workflow",
    status,
    sourceType: "javascript",
    input: { topic: "rpc" },
    script: "export const meta = { name: 'fixture-workflow', description: 'Fixture Workflow' }\nreturn 1",
    startedAt: now,
    updatedAt: now,
    ...(status === "completed" ? { finishedAt: now, result: "fixture complete" } : {}),
    phases: [{
      phaseId: "audit", name: "Audit", status,
      agents: [{ callId: "fixture-call", callIndex: 1, taskId: "inspect", label: "inspect", name: "Inspect", status, prompt: "Inspect fixture", options: { tools: ["read"] }, recentEvents: [{ type: "stdout", timestamp: now, line: "read fixture" }], ...(status === "completed" ? { result: "inspected", usage: { input: 2, output: 1 } } : {}) }],
    }],
    controls: { canPause: status === "running", canResume: status === "completed", canAbort: status === "running", canRetry: status === "completed", canSave: status === "completed" },
  }];
  const payload = { type: "firstpick.pi-extension-workflows.inspector", version: 1, updatedAt: now, mode: { enabled: true, behavior: "persistent", phase: "armed" }, runs };
  respond({ ...base, data: { output: `fake workflow inspector ${status} emitted` } });
  emitEvent({ type: "extension_ui_request", id: randomUUID(), method: "setWidget", widgetKey: "workflow:rpc", widgetLines: [`WORKFLOW_RPC_PAYLOAD ${JSON.stringify(payload)}`] });
  return true;
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
  logJsonLine({
    direction: "command",
    type,
    ...(command.message !== undefined ? { message: String(command.message) } : {}),
    ...(Array.isArray(command.images) ? { images: command.images } : {}),
    ...(command.provider !== undefined ? { provider: String(command.provider) } : {}),
    ...(command.modelId !== undefined ? { modelId: String(command.modelId) } : {}),
    ...(type === "extension_ui_response" ? { id: String(command.id), value: command.value, cancelled: command.cancelled === true } : {}),
  });
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
            ...(largeTranscriptEnabled ? [{ role: "assistant", content: [{ type: "text", text: largeRpcText }], timestamp: 4000 }] : []),
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
            { name: "workflow", source: "extension", description: "Run and inspect JavaScript workflows" },
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
      if (handleFastModeFixturePrompt(command, base)) return;
      if (handleTransportFixturePrompt(command, base)) return;
      if (handleSubagentFixturePrompt(command, base)) return;
      if (handleDocumentArtifactFixturePrompt(command, base)) return;
      if (handleWorkflowFixturePrompt(command, base)) return;
      if (handleTalkPrompt(command, base)) return;
      if (handleContinuityPrompt(command, base)) return;
      if (handleLargePayloadPrompt(command, base)) return;
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
    case "set_model":
      if (command.modelId === "missing-model") respond({ ...base, success: false, error: "Model not found: fake/missing-model" });
      else respond({ ...base, data: { provider: command.provider, id: command.modelId } });
      return;
    case "get_available_models":
      respond({ ...base, data: { models: [{ provider: "fake", id: "fake-model", name: "Fake Model" }] } });
      return;
    case "get_session_stats":
      respond({
        ...base,
        data: largePayloadsEnabled
          ? { tokens: { input: 123456, output: 654321, total: 777777 }, samples: largeTokenSamples }
          : { tokens: 0 },
      });
      return;
    case "get_last_assistant_text":
      respond({ ...base, data: { text: "fake last text" } });
      return;
    case "extension_ui_response":
      // Pi's extension UI response is a one-way RPC write. Deliberately emit
      // no response so supervised HTTP coverage catches accidental waits.
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
