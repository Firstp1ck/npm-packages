import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { AgentSession, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  AGENT_RUN_PROVIDER_EVENT,
  AgentRunIndex,
  canonicalAgentRunId,
  normalizeProviderSnapshot,
} from "./lib/agent-run-protocol.mjs";
import { readWebuiSettings } from "./lib/git-workflow-preferences.mjs";
import {
  branchResourceDirective,
  resolveResourceSelection,
} from "./lib/resource-selection.mjs";
import { mutatePiRuntimeFollowUpQueue } from "./lib/queue-mutation.mjs";
import { applySubagentLaunchSlotDefaults } from "./lib/subagent-launch-policy.mjs";
import {
  formatSubagentLaunchSlotGuidance,
  resolveSubagentLaunchSlotProjectKey,
  subagentLaunchSlotRevision,
  subagentLaunchSlotScopeEntry,
} from "./lib/subagent-launch-slots.mjs";
import { SUBAGENT_GATE_UPDATE_EVENT } from "./lib/subagent-gate.mjs";
import {
  applySupportedSamplingParameters,
  BUILTIN_SAMPLING_APIS,
  filterSupportedSamplingParameters,
  resolveSamplingParameterCapabilities,
} from "./lib/sampling-parameter-capabilities.mjs";
import {
  SamplingParameterValidationError,
  validateSamplingParameterObject,
} from "./public/sampling-parameter-controls.mjs";

const HELPER_COMMAND = "webui-helper";
const RESPONSE_PREFIX = "__PI_WEBUI_HELPER_RESPONSE__:";
const TOOLS_CONFIG_TYPE = "webui-tools-config";
const SKILLS_CONFIG_TYPE = "webui-skills-config";
const SAMPLING_CONFIG_TYPE = "webui-session-sampling-params-v1";
const SAMPLING_MAX_KEYS = 128;
const SAMPLING_MAX_BYTES = 16 * 1024;
const APP_RUNNER_CONTEXT_TYPE = "webui-app-runner-output";
const RETAINED_SUBAGENT_RUNS_TYPE = "webui-subagent-retained-runs-v1";
const WEBUI_SUBAGENTS_STATUS_KEY = "webui-subagents";
const WEBUI_SUBAGENTS_PAYLOAD_PREFIX = "PI_WEBUI_SUBAGENTS_V1 ";
// The helper and the HTTP server can be version-skewed across restarts, so the
// canonical payload travels on its own status key and never replaces the v1 key.
const WEBUI_SUBAGENTS_V2_STATUS_KEY = "webui-subagents-v2";
const WEBUI_SUBAGENTS_V2_PAYLOAD_PREFIX = "PI_WEBUI_SUBAGENTS_V2 ";
const WEBUI_SUBAGENTS_V2_VERSION = 2;
const AGENT_RUN_PRODUCER_LIMIT = 16;
const AGENT_RUN_INSTANCE_LIMIT = 512;
const AGENT_RUN_DIAGNOSTIC_LIMIT = 16;
const AGENT_RUN_GATE_REFERENCE_LIMIT = 128;
const SUBAGENT_RPC_VERSION = 1;
const SUBAGENT_RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const SUBAGENT_RPC_READY_EVENT = "subagents:rpc:v1:ready";
const SUBAGENT_RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";
const SUBAGENT_ASYNC_STATUS_SNAPSHOT_KIND = "pi-subagents.async-status-snapshot";
const SUBAGENT_ASYNC_STATUS_SNAPSHOT_VERSION = 1;
const SUBAGENT_ASYNC_STATUS_SNAPSHOT_RUN_LIMIT = 32;
const SUBAGENT_ASYNC_STARTED_EVENT = "subagent:async-started";
const SUBAGENT_ASYNC_COMPLETE_EVENT = "subagent:async-complete";
const WORKFLOW_SUBAGENTS_EVENT = "firstpick:workflow-subagents:v1";
const WORKFLOW_SUBAGENTS_VERSION = 1;
const WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS = {
  runs: 32,
  agentsPerRun: 32,
  runIdentifierLength: 160,
  agentIdentifierLength: 240,
  nameLength: 160,
  activityLength: 80,
  modelLength: 240,
  recentOutputLines: 8,
  recentOutputLineLength: 500,
};
const SUBAGENT_STATUS_POLL_MS = 1500;
const SUBAGENT_STATUS_RPC_TIMEOUT_MS = 900;
const SUBAGENT_STATUS_HEARTBEAT_MS = 15_000;
const SUBAGENT_AUTHORITATIVE_ABSENCE_LIMIT = 2;
const FINISHED_SUBAGENT_RUN_LIMIT = 16;
const SUBAGENT_OUTPUT_LINE_LIMIT = 120;
const SUBAGENT_OUTPUT_LINE_LENGTH = 1000;
const SUBAGENT_TRANSCRIPT_TAIL_BYTES = 512 * 1024;
const SUBAGENT_TELEMETRY_SCAN_BYTES = 2 * 1024 * 1024;
const SUBAGENT_TELEMETRY_ENTRY_LIMIT = 4096;
const SUBAGENT_TELEMETRY_TOKEN_LIMIT = 1_000_000_000;
const SUBAGENT_TELEMETRY_CONTEXT_WINDOW_LIMIT = 16_000_000;
const SUBAGENT_TELEMETRY_RESPONSE_DURATION_MS = 15 * 60 * 1000;
const SUBAGENT_TELEMETRY_SPEED_LIMIT = 1_000_000;
const STATS_INITIAL_PROMPT_ESTIMATE_TYPE = "stats_initial_prompt_estimate";
const SUBAGENT_DEVIATION_PERMIT_LIMIT = 8;
const SUBAGENT_DEVIATION_PERMIT_TTL_MS = 2 * 60 * 1000;
const SUBAGENT_DEVIATION_REQUESTED_MODEL_LIMIT = 280;
const SUBAGENT_DEVIATION_REASON_LIMIT = 500;

const SubagentModelDeviationParams = Type.Object({
  role: Type.Literal("reviewer"),
  occurrence: Type.Integer({ minimum: 1, maximum: SUBAGENT_DEVIATION_PERMIT_LIMIT }),
  requestedModel: Type.String({ minLength: 1, maxLength: SUBAGENT_DEVIATION_REQUESTED_MODEL_LIMIT }),
  reason: Type.String({ minLength: 1, maxLength: SUBAGENT_DEVIATION_REASON_LIMIT }),
}, { additionalProperties: false });

const ACTIVE_COMMAND_SESSION_KEY = Symbol.for("pi.webui.helper.activeCommandSession");

function activeCommandSession() {
  return globalThis[ACTIVE_COMMAND_SESSION_KEY];
}

function setActiveCommandSession(session) {
  if (session) globalThis[ACTIVE_COMMAND_SESSION_KEY] = session;
  else delete globalThis[ACTIVE_COMMAND_SESSION_KEY];
}

function installActiveCommandSessionCapture() {
  const proto = AgentSession?.prototype;
  if (!proto || proto.__webuiHelperCommandSessionCaptureInstalled) return;
  const original = proto._tryExecuteExtensionCommand;
  if (typeof original !== "function") return;
  Object.defineProperty(proto, "__webuiHelperCommandSessionCaptureInstalled", { value: true });
  proto._tryExecuteExtensionCommand = async function webuiHelperTryExecuteExtensionCommand(...args) {
    const previous = activeCommandSession();
    setActiveCommandSession(this);
    try {
      return await original.apply(this, args);
    } finally {
      setActiveCommandSession(previous);
    }
  };
}

installActiveCommandSessionCapture();

function installRpcUserBashSupport() {
  const proto = AgentSession?.prototype;
  if (!proto || proto.__webuiHelperUserBashSupportInstalled) return;
  const original = proto.executeBash;
  if (typeof original !== "function") return;
  Object.defineProperty(proto, "__webuiHelperUserBashSupportInstalled", { value: true });
  proto.executeBash = async function webuiHelperExecuteBash(command, onChunk, options = {}) {
    const runner = this.extensionRunner;
    const eventResult = runner?.hasHandlers?.("user_bash")
      ? await runner.emitUserBash({
        type: "user_bash",
        command,
        excludeFromContext: options?.excludeFromContext === true,
        cwd: this.sessionManager?.getCwd?.() || this._cwd || process.cwd(),
      })
      : undefined;

    if (eventResult?.result) {
      this.recordBashResult(command, eventResult.result, { excludeFromContext: options?.excludeFromContext === true });
      return eventResult.result;
    }

    const nextOptions = eventResult?.operations ? { ...options, operations: eventResult.operations } : options;
    return original.call(this, command, onChunk, nextOptions);
  };
}

installRpcUserBashSupport();

function responseMessage(payload) {
  return `${RESPONSE_PREFIX}${JSON.stringify(payload)}`;
}

function safeSourceInfo(sourceInfo) {
  if (!sourceInfo || typeof sourceInfo !== "object") return undefined;
  return {
    path: typeof sourceInfo.path === "string" ? sourceInfo.path : undefined,
    source: typeof sourceInfo.source === "string" ? sourceInfo.source : undefined,
    scope: typeof sourceInfo.scope === "string" ? sourceInfo.scope : undefined,
    origin: typeof sourceInfo.origin === "string" ? sourceInfo.origin : undefined,
    baseDir: typeof sourceInfo.baseDir === "string" ? sourceInfo.baseDir : undefined,
  };
}

function lastBranchConfig(ctx, customType) {
  let found;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry?.type === "custom" && entry.customType === customType && entry.data && typeof entry.data === "object") {
      found = entry.data;
    }
  }
  return found;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeSamplingParams(value) {
  if (!isPlainObject(value)) throw new Error("Sampling parameters must be a JSON object");
  const keys = Object.keys(value);
  if (keys.length > SAMPLING_MAX_KEYS) throw new Error(`Sampling parameters may contain at most ${SAMPLING_MAX_KEYS} top-level keys`);
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("Sampling parameters must contain only JSON-compatible values");
  }
  if (Buffer.byteLength(serialized, "utf8") > SAMPLING_MAX_BYTES) {
    throw new Error(`Sampling parameters must be at most ${SAMPLING_MAX_BYTES} bytes`);
  }
  const normalized = JSON.parse(serialized);
  if (!isPlainObject(normalized)) throw new Error("Sampling parameters must be a JSON object");
  return normalized;
}

function normalizeNameList(value) {
  if (!Array.isArray(value)) return [];
  const names = [];
  const seen = new Set();
  for (const item of value) {
    const name = String(item || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function queueMessageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text").map((part) => String(part.text || "")).join("\n");
}

function queuedMessagesSnapshot(session) {
  return {
    source: "pi-runtime",
    steering: Array.isArray(session?._steeringMessages) ? [...session._steeringMessages] : [],
    followUp: Array.isArray(session?._followUpMessages) ? [...session._followUpMessages] : [],
  };
}

function normalizeQueueKind(value) {
  const normalized = String(value || "").trim();
  if (normalized === "follow-up" || normalized.toLowerCase() === "followup") return "followUp";
  if (normalized === "steer") return "steering";
  if (normalized === "steering" || normalized === "followUp") return normalized;
  throw new Error("Queue removal requires kind 'followUp' or 'steering'");
}

function removeQueuedPrompt(payload = {}) {
  const session = activeCommandSession();
  if (!session) throw new Error("Web UI queue removal is unavailable in this Pi version; reload this tab and retry.");
  const kind = normalizeQueueKind(payload.kind || "followUp");
  const index = Number.parseInt(String(payload.index ?? ""), 10);
  if (!Number.isInteger(index) || index < 0) throw new Error("Queue removal requires a zero-based item index");
  const expectedText = String(payload.message ?? payload.text ?? "");
  const tracked = kind === "followUp" ? session._followUpMessages : session._steeringMessages;
  const agentQueue = kind === "followUp" ? session.agent?.followUpQueue : session.agent?.steeringQueue;
  if (!Array.isArray(tracked) || !Array.isArray(agentQueue?.messages)) {
    throw new Error("Web UI queue removal is not supported by this Pi runtime.");
  }
  const currentText = String(tracked[index] || "");
  const agentText = queueMessageText(agentQueue.messages[index]);
  if (!currentText || (expectedText && currentText !== expectedText) || (expectedText && agentText !== expectedText)) {
    return { removed: false, reason: "queue-changed", queue: queuedMessagesSnapshot(session) };
  }
  tracked.splice(index, 1);
  agentQueue.messages.splice(index, 1);
  session._emitQueueUpdate?.();
  return { removed: true, kind, index, message: currentText, queue: queuedMessagesSnapshot(session) };
}

function mutateQueuedFollowUp(payload = {}) {
  const session = activeCommandSession();
  if (!session) throw new Error("Web UI queue mutation is unavailable in this Pi version; reload this tab and retry.");
  return mutatePiRuntimeFollowUpQueue(session, payload);
}

function parseHelperArgs(args) {
  let parsed;
  try {
    parsed = JSON.parse(args || "{}");
  } catch (error) {
    throw new Error(`Invalid ${HELPER_COMMAND} payload: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`${HELPER_COMMAND} payload must be an object`);
  const requestId = String(parsed.requestId || "").trim();
  const action = String(parsed.action || "").trim();
  if (!requestId) throw new Error(`${HELPER_COMMAND} payload requires requestId`);
  if (!action) throw new Error(`${HELPER_COMMAND} payload requires action`);
  return { requestId, action, payload: parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {} };
}

function skillBlockPattern(name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\n?  <skill>\\n    <name>${escaped}<\\/name>[\\s\\S]*?  <\\/skill>`, "g");
}

function replaceAvailableSkillsSection(systemPrompt, skills) {
  const nextSection = formatSkillsForPrompt(skills);
  const replacement = nextSection ? `\n${nextSection}\n` : "\n";
  if (systemPrompt.includes("<available_skills>")) {
    return systemPrompt.replace(/\n?The following skills provide[\s\S]*?<\/available_skills>\n?/m, replacement);
  }
  return systemPrompt;
}

const CANONICAL_AGENT_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Opaque helper-owned output handle. The browser never sees run/agent internals or paths. */
function helperAgentRunOutputId(runId, agentId) {
  return `h-${createHash("sha256").update(`${runId}\u0000${agentId}`).digest("hex").slice(0, 32)}`;
}

function canonicalAgentRunStatus(runStatus, agentStatus) {
  for (const candidate of [agentStatus, runStatus]) {
    if (candidate === "cancelled" || candidate === "failed" || candidate === "done") return candidate;
  }
  return "running";
}

function subagentText(value, maxLength = 240) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function subagentModel(value) {
  return subagentText(value, 240);
}

function subagentThinking(value) {
  return subagentText(value, 40);
}

function subagentThinkingFromModel(value) {
  const match = subagentModel(value).match(/:(off|minimal|low|medium|high|xhigh|max)$/i);
  return subagentThinking(match?.[1]?.toLowerCase());
}

function subagentExecutionMetadata(step = {}, defaults = {}) {
  const stepModel = subagentModel(step?.model);
  const model = stepModel || subagentModel(defaults?.model) || undefined;
  return {
    model,
    thinking: subagentThinking(step?.thinking)
      || subagentThinkingFromModel(stepModel)
      || subagentThinking(defaults?.thinking)
      || subagentThinkingFromModel(model)
      || undefined,
  };
}

function subagentMode(value, fallback = "single") {
  return ["single", "parallel", "chain"].includes(value) ? value : fallback;
}

function subagentAgentName(value) {
  return subagentText(value, 160);
}

function subagentAgentFromDisplay(value) {
  const display = subagentText(value, 240)
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\s+\[(?:fork|fresh|mixed)\]$/i, "");
  const labeled = display.match(/\(([^()]*)\)$/);
  return subagentAgentName(labeled?.[1] || display);
}

function subagentCurrentTool(value) {
  const match = String(value || "").match(/(?:^|\|\s*)tool\s+([^\s|]+)/i);
  return subagentText(match?.[1], 120);
}

function subagentOutputLines(value) {
  return (Array.isArray(value) ? value : [])
    .slice(-SUBAGENT_OUTPUT_LINE_LIMIT)
    .map((line) => String(line ?? "").replace(/\r/g, "").slice(0, SUBAGENT_OUTPUT_LINE_LENGTH));
}

function workflowSubagentText(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength).replace(/\r/g, "") : "";
}

function workflowSubagentIdentifier(value, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) return "";
  return value;
}

function workflowSubagentTimestamp(value) {
  if (typeof value !== "string" || value.length > 128) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function workflowSubagentRun(value, updatedAt) {
  if (!value || typeof value !== "object" || value.source !== "workflow") return undefined;
  const id = workflowSubagentIdentifier(value.id, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.runIdentifierLength);
  const name = workflowSubagentText(value.name, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.nameLength).trim();
  const startedAt = workflowSubagentTimestamp(value.startedAt);
  if (!id || !name || startedAt === undefined || typeof value.status !== "string") return undefined;

  const agents = [];
  const agentIds = new Set();
  for (const [fallbackIndex, agent] of (Array.isArray(value.agents) ? value.agents : []).slice(0, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.agentsPerRun).entries()) {
    if (!agent || typeof agent !== "object" || agent.status !== "running") continue;
    const agentId = workflowSubagentIdentifier(agent.id, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.agentIdentifierLength);
    const agentName = workflowSubagentText(agent.name, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.nameLength).trim();
    if (!agentId || !agentName || agentIds.has(agentId)) continue;
    agentIds.add(agentId);
    const recentOutput = (Array.isArray(agent.recentOutput) ? agent.recentOutput : [])
      .slice(-WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.recentOutputLines)
      .flatMap((line) => typeof line === "string"
        ? [workflowSubagentText(line, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.recentOutputLineLength)]
        : []);
    agents.push({
      id: agentId,
      name: agentName,
      status: "running",
      index: Number.isInteger(agent.index) && agent.index >= 0 ? agent.index : fallbackIndex,
      activityState: workflowSubagentText(agent.activityState, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.activityLength).trim() || undefined,
      model: workflowSubagentText(agent.model, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.modelLength).trim() || undefined,
      recentOutput,
      nested: false,
    });
  }

  return {
    id,
    source: "workflow",
    name,
    mode: agents.length > 1 ? "parallel" : "single",
    status: "running",
    startedAt,
    updatedAt,
    agents,
  };
}

function workflowSubagentSnapshot(value) {
  if (!value || typeof value !== "object" || value.version !== WORKFLOW_SUBAGENTS_VERSION || !Array.isArray(value.runs)) return undefined;
  const updatedAt = workflowSubagentTimestamp(value.updatedAt) || Date.now();
  const runs = new Map();
  for (const candidate of value.runs.slice(0, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.runs)) {
    const run = workflowSubagentRun(candidate, updatedAt);
    if (run) runs.set(run.id, run);
  }
  return runs;
}

function subagentRecentTools(value) {
  return (Array.isArray(value) ? value : []).slice(-20).map((entry) => ({
    tool: subagentText(entry?.tool, 120),
    args: subagentText(entry?.args, 500),
    endMs: Number.isFinite(entry?.endMs) ? entry.endMs : undefined,
  })).filter((entry) => entry.tool);
}

function subagentTranscriptText(value) {
  return String(value ?? "").replace(/\r/g, "").slice(0, SUBAGENT_OUTPUT_LINE_LENGTH);
}

function subagentTranscriptTextLines(value) {
  return String(value ?? "").replace(/\r/g, "").split("\n").map((line) => line.slice(0, SUBAGENT_OUTPUT_LINE_LENGTH));
}

function subagentTranscriptToolArguments(part) {
  const value = part?.arguments ?? part?.args ?? part?.input ?? part?.toolCall?.arguments ?? {};
  try {
    return subagentTranscriptText(typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    return "{}";
  }
}

function subagentTranscriptMessageCandidates(message, timestamp, sourceId) {
  const candidates = [];
  const addText = (type, value, partIndex, output = type === "text") => {
    if (typeof value !== "string") return;
    for (const line of subagentTranscriptTextLines(value)) {
      if (line.trim().toLowerCase() === "(no output)") continue;
      candidates.push({
        sourceId,
        role: message.role,
        timestamp,
        toolCallId: subagentText(message.toolCallId || message.tool_call_id, 240),
        toolName: subagentText(message.toolName || message.name, 120),
        isError: message.isError === true,
        partIndex,
        part: type === "thinking" ? { type, thinking: line } : { type, text: line },
        output: output ? line : null,
      });
    }
  };
  const content = Array.isArray(message.content) ? message.content : [{ type: "text", text: message.content }];
  for (let partIndex = 0; partIndex < content.length; partIndex += 1) {
    const part = content[partIndex];
    if (message.role === "assistant" && part?.type === "thinking") {
      addText("thinking", part.thinking ?? part.text ?? part.content, partIndex, false);
    } else if (message.role === "assistant" && part?.type === "toolCall") {
      const name = subagentText(part.name || part.toolName || part.toolCall?.name, 120) || "tool";
      const argumentsText = subagentTranscriptToolArguments(part);
      candidates.push({
        sourceId,
        role: message.role,
        timestamp,
        partIndex,
        part: {
          type: "toolCall",
          name,
          arguments: argumentsText,
          ...(subagentText(part.id || part.toolCallId || part.tool_call_id, 240) ? { id: subagentText(part.id || part.toolCallId || part.tool_call_id, 240) } : {}),
        },
        output: `▶ ${name}${argumentsText && argumentsText !== "{}" ? ` ${argumentsText}` : ""}`,
      });
    } else if (part?.type === "text" || typeof part === "string") {
      addText("text", typeof part === "string" ? part : part.text ?? part.content, partIndex);
    }
  }
  return candidates;
}

function subagentTranscriptMessages(candidates) {
  const messages = [];
  let current = null;
  for (const candidate of candidates) {
    if (!current || current.sourceId !== candidate.sourceId) {
      current = {
        sourceId: candidate.sourceId,
        role: candidate.role,
        ...(candidate.timestamp ? { timestamp: candidate.timestamp } : {}),
        ...(candidate.role === "toolResult" ? {
          ...(candidate.toolCallId ? { toolCallId: candidate.toolCallId } : {}),
          ...(candidate.toolName ? { toolName: candidate.toolName } : {}),
          ...(candidate.isError ? { isError: true } : {}),
        } : {}),
        content: [],
      };
      messages.push(current);
    }
    const previous = current.content.at(-1);
    if (previous?._subagentPartIndex === candidate.partIndex && previous.type === candidate.part.type && (candidate.part.type === "text" || candidate.part.type === "thinking")) {
      const property = candidate.part.type === "thinking" ? "thinking" : "text";
      previous[property] += `\n${candidate.part[property]}`;
      continue;
    }
    current.content.push({ ...candidate.part, _subagentPartIndex: candidate.partIndex });
  }
  return messages.map(({ sourceId: _sourceId, content, ...message }) => ({
    ...message,
    content: content.map(({ _subagentPartIndex, ...part }) => part),
  }));
}

function subagentTranscriptOutput(sessionFile) {
  const empty = { recentOutput: [], transcript: [] };
  const file = String(sessionFile || "");
  if (!file || !path.isAbsolute(file) || path.extname(file) !== ".jsonl") return empty;
  let fd;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    if (size <= 0) return empty;
    const length = Math.min(size, SUBAGENT_TRANSCRIPT_TAIL_BYTES);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    const rawLines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/);
    if (start > 0) rawLines.shift();
    const candidates = [];
    for (let entryIndex = 0; entryIndex < rawLines.length; entryIndex += 1) {
      const rawLine = rawLines[entryIndex];
      if (!rawLine.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(rawLine);
      } catch {
        continue;
      }
      const message = entry?.type === "message" ? entry.message : entry?.message?.role ? entry.message : null;
      if (!message || !["assistant", "toolResult"].includes(message.role)) continue;
      candidates.push(...subagentTranscriptMessageCandidates(message, entry.timestamp, entryIndex));
    }
    const boundedCandidates = candidates.slice(-SUBAGENT_OUTPUT_LINE_LIMIT);
    return {
      recentOutput: subagentOutputLines(boundedCandidates.flatMap((candidate) => candidate.output === null ? [] : [candidate.output])),
      transcript: subagentTranscriptMessages(boundedCandidates),
    };
  } catch {
    return empty;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* Best-effort close for live session tails. */ }
    }
  }
}

function subagentTelemetryNumber(value, limit = SUBAGENT_TELEMETRY_TOKEN_LIMIT) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= limit ? value : null;
}

function subagentTelemetryTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string" || value.length > 128) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function subagentAssistantModel(message) {
  const model = subagentModel(message?.responseModel || message?.model);
  if (!model) return "";
  const provider = subagentText(message?.provider, 80);
  return provider && !model.startsWith(`${provider}/`) ? subagentModel(`${provider}/${model}`) : model;
}

function subagentContextWindow(model, context) {
  const effectiveModel = subagentModel(model);
  const match = effectiveModel.match(/^([^/]+)\/(.+)$/);
  if (!match || typeof context?.modelRegistry?.getAvailable !== "function") return null;
  const provider = match[1];
  const modelId = match[2].replace(/:(off|minimal|low|medium|high|xhigh|max)$/i, "");
  try {
    const available = context.modelRegistry.getAvailable();
    const entry = (Array.isArray(available) ? available : []).find((candidate) => candidate?.provider === provider && candidate?.id === modelId);
    return subagentTelemetryNumber(entry?.contextWindow, SUBAGENT_TELEMETRY_CONTEXT_WINDOW_LIMIT);
  } catch {
    return null;
  }
}

function subagentEmptyTelemetry({ model, effort, context } = {}) {
  const effectiveModel = subagentModel(model) || null;
  return {
    promptInjectionTokens: null,
    inputTokens: null,
    outputTokens: null,
    tokenSpeed: null,
    contextTokens: null,
    contextWindow: subagentContextWindow(effectiveModel, context),
    model: effectiveModel,
    effort: subagentThinking(effort) || subagentThinkingFromModel(effectiveModel) || null,
  };
}

function subagentSessionTelemetry(sessionFile, { model, effort, context } = {}) {
  const empty = subagentEmptyTelemetry({ model, effort, context });
  const file = String(sessionFile || "");
  if (!file || !path.isAbsolute(file) || path.extname(file) !== ".jsonl") return empty;

  let fd;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    if (size <= 0) return empty;
    const length = Math.min(size, SUBAGENT_TELEMETRY_SCAN_BYTES);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    const rawLines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/);
    if (start > 0) rawLines.shift();

    let promptInjectionTokens = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let inputSeen = false;
    let outputSeen = false;
    let inputOverflow = false;
    let outputOverflow = false;
    let speedOutputTokens = 0;
    let speedDurationMs = 0;
    let speedOverflow = false;
    let contextTokens = null;
    let latestAssistantModel = "";

    for (const rawLine of rawLines.slice(-SUBAGENT_TELEMETRY_ENTRY_LIMIT)) {
      if (!rawLine.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(rawLine);
      } catch {
        continue;
      }
      if (entry?.type === "custom" && entry?.customType === STATS_INITIAL_PROMPT_ESTIMATE_TYPE) {
        const value = subagentTelemetryNumber(entry?.data?.actualInjectedTokens);
        if (value !== null) promptInjectionTokens = value;
        continue;
      }

      const message = entry?.type === "message" ? entry.message : entry?.message?.role ? entry.message : null;
      if (message?.role !== "assistant") continue;
      latestAssistantModel = subagentAssistantModel(message) || latestAssistantModel;
      const usage = message.usage && typeof message.usage === "object" ? message.usage : null;
      if (!usage) continue;
      const input = subagentTelemetryNumber(usage.input);
      const output = subagentTelemetryNumber(usage.output);
      if (input !== null) {
        inputSeen = true;
        if (inputTokens > SUBAGENT_TELEMETRY_TOKEN_LIMIT - input) inputOverflow = true;
        else inputTokens += input;
        const cacheRead = subagentTelemetryNumber(usage.cacheRead);
        const cacheWrite = subagentTelemetryNumber(usage.cacheWrite);
        contextTokens = cacheRead !== null && cacheWrite !== null && input <= SUBAGENT_TELEMETRY_TOKEN_LIMIT - cacheRead - cacheWrite
          ? input + cacheRead + cacheWrite
          : input;
      } else {
        contextTokens = null;
      }
      if (output !== null) {
        outputSeen = true;
        if (outputTokens > SUBAGENT_TELEMETRY_TOKEN_LIMIT - output) outputOverflow = true;
        else outputTokens += output;
        const startedAt = subagentTelemetryTimestamp(message.timestamp);
        const completedAt = subagentTelemetryTimestamp(entry.timestamp);
        const durationMs = startedAt !== null && completedAt !== null ? completedAt - startedAt : 0;
        if (output > 0 && durationMs > 0 && durationMs <= SUBAGENT_TELEMETRY_RESPONSE_DURATION_MS) {
          if (speedOutputTokens > SUBAGENT_TELEMETRY_TOKEN_LIMIT - output || speedDurationMs > SUBAGENT_TELEMETRY_RESPONSE_DURATION_MS * SUBAGENT_TELEMETRY_ENTRY_LIMIT - durationMs) speedOverflow = true;
          else {
            speedOutputTokens += output;
            speedDurationMs += durationMs;
          }
        }
      }
    }

    const effectiveModel = subagentModel(model) || latestAssistantModel || null;
    const tokenSpeed = !speedOverflow && speedOutputTokens > 0 && speedDurationMs > 0
      ? subagentTelemetryNumber((speedOutputTokens * 1000) / speedDurationMs, SUBAGENT_TELEMETRY_SPEED_LIMIT)
      : null;
    return {
      promptInjectionTokens,
      inputTokens: inputSeen && !inputOverflow ? inputTokens : null,
      outputTokens: outputSeen && !outputOverflow ? outputTokens : null,
      tokenSpeed,
      contextTokens,
      contextWindow: subagentContextWindow(effectiveModel, context),
      model: effectiveModel,
      effort: subagentThinking(effort) || subagentThinkingFromModel(effectiveModel) || null,
    };
  } catch {
    return empty;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* Best-effort close for bounded session telemetry. */ }
    }
  }
}

function subagentInitialAgentsFromStep(step, defaults = {}) {
  if (!step || typeof step !== "object") return [];
  if (Array.isArray(step.parallel)) {
    return step.parallel.flatMap((task) => {
      const name = subagentAgentName(task?.agent);
      const count = Number.isInteger(task?.count) && task.count > 0 ? Math.min(task.count, 32) : 1;
      const metadata = subagentExecutionMetadata(task, defaults);
      return name ? Array.from({ length: count }, (_unused, index) => ({ name, index, ...metadata })) : [];
    });
  }
  const name = subagentAgentName(step.agent);
  return name ? [{ name, index: 0, ...subagentExecutionMetadata(step, defaults) }] : [];
}

function subagentInitialAgentsFromArgs(args = {}) {
  const defaults = subagentExecutionMetadata(args);
  if (Array.isArray(args.tasks) && args.tasks.length) {
    return args.tasks.flatMap((task) => subagentInitialAgentsFromStep(task, defaults));
  }
  if (Array.isArray(args.chain) && args.chain.length) return subagentInitialAgentsFromStep(args.chain[0], defaults);
  const name = subagentAgentName(args.agent);
  return name ? [{ name, index: 0, ...defaults }] : [];
}

function subagentRunningAgentsFromDetails(details, runId) {
  if (!details || typeof details !== "object") return [];
  const candidates = [];
  if (Array.isArray(details.progress)) candidates.push(...details.progress);
  if (Array.isArray(details.results)) {
    for (const result of details.results) {
      if (result?.progress && typeof result.progress === "object") {
        candidates.push({ agent: result.agent, model: result.model, thinking: result.thinking, ...result.progress });
      }
    }
  }
  return candidates.flatMap((entry, index) => {
    if (String(entry?.status || "").toLowerCase() !== "running") return [];
    const name = subagentAgentName(entry.agent);
    if (!name) return [];
    return [{
      id: `${runId}:${entry.index ?? index}:${name}`,
      name,
      status: "running",
      index: Number.isInteger(entry.index) ? entry.index : index,
      currentTool: subagentText(entry.currentTool, 120) || undefined,
      currentToolArgs: subagentText(entry.currentToolArgs, 500) || undefined,
      currentPath: subagentText(entry.currentPath, 1000) || undefined,
      activityState: subagentText(entry.activityState, 80) || undefined,
      recentTools: subagentRecentTools(entry.recentTools),
      recentOutput: subagentOutputLines(entry.recentOutput),
      turnCount: Number.isFinite(entry.turnCount) ? entry.turnCount : undefined,
      toolCount: Number.isFinite(entry.toolCount) ? entry.toolCount : undefined,
      tokens: Number.isFinite(entry.tokens) ? entry.tokens : undefined,
      model: subagentModel(entry.model) || undefined,
      thinking: subagentThinking(entry.thinking) || subagentThinkingFromModel(entry.model) || undefined,
      nested: false,
    }];
  });
}

function subagentRunningGraphAgents(workflowGraph, runId) {
  const agents = [];
  const seenNodes = new Set();
  const visit = (nodes) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const nodeId = subagentText(node?.id, 160);
      if (nodeId && seenNodes.has(nodeId)) continue;
      if (nodeId) seenNodes.add(nodeId);
      if (node?.kind === "agent" && node.status === "running" && subagentAgentName(node.agent)) {
        const name = subagentAgentName(node.agent);
        const index = Number.isInteger(node.flatIndex) ? node.flatIndex : agents.length;
        agents.push({ id: `${runId}:graph:${nodeId || index}:${name}`, name, status: "running", index, nested: false });
      }
      visit(node?.children);
    }
  };
  visit(workflowGraph?.nodes);
  return agents;
}

function normalizeSubagentFleet(value) {
  if (!value || typeof value !== "object" || value.version !== 1 || !Array.isArray(value.entries)) return undefined;
  const totalActive = Number.isSafeInteger(value.totalActive) && value.totalActive >= 0 ? value.totalActive : -1;
  const omitted = Number.isSafeInteger(value.omitted) && value.omitted >= 0 ? value.omitted : -1;
  if (totalActive < value.entries.length || omitted !== totalActive - value.entries.length) return undefined;
  const entries = [];
  const keys = new Set();
  for (const candidate of value.entries.slice(0, 32)) {
    const key = subagentText(candidate?.key, 160);
    const agent = subagentAgentName(candidate?.agent);
    const startedAt = candidate?.startedAt;
    if (!key || !agent || keys.has(key) || !Number.isSafeInteger(startedAt) || startedAt < 0) return undefined;
    keys.add(key);
    entries.push({
      key,
      agent,
      name: subagentAgentName(candidate?.role) || agent,
      model: subagentModel(candidate?.model) || undefined,
      thinking: subagentThinking(candidate?.effort) || subagentThinkingFromModel(candidate?.model) || undefined,
      startedAt,
    });
  }
  if (entries.length !== value.entries.length) return undefined;
  return { version: 1, entries, totalActive, omitted };
}

function parseSubagentStatusText(text, previousRuns = new Map()) {
  const runs = [];
  let current = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const runMatch = rawLine.match(/^-\s+([^|]+?)\s+\|\s+(queued|running)\b(.*)$/i);
    if (runMatch) {
      const id = subagentText(runMatch[1], 160);
      const segments = rawLine.split(" | ").map((part) => part.trim());
      const mode = segments.map((part) => part.match(/^(single|parallel|chain|workflow)\b/)?.[1]).find(Boolean);
      const previous = previousRuns.get(id);
      current = {
        id,
        source: "async",
        mode: subagentMode(mode, previous?.mode),
        workflow: mode === "workflow" || previous?.workflow === true,
        status: runMatch[2].toLowerCase(),
        startedAt: previous?.startedAt || Date.now(),
        agents: [],
      };
      runs.push(current);
      continue;
    }
    if (!current) continue;

    const nestedMatch = rawLine.match(/^\s*↳\s+(.+?)\s+\[([^\]]+)\]\s+(queued|running|complete|completed|failed|paused)\b(.*)$/i);
    if (nestedMatch) {
      if (nestedMatch[3].toLowerCase() !== "running") continue;
      const name = subagentAgentFromDisplay(nestedMatch[1]);
      if (!name) continue;
      const targetRunId = subagentText(nestedMatch[2], 160);
      current.agents.push({
        id: `${current.id}:nested:${targetRunId}`,
        targetRunId,
        name,
        status: "running",
        index: current.agents.length,
        currentTool: subagentCurrentTool(nestedMatch[4]) || undefined,
        nested: true,
      });
      continue;
    }

    const stepMatch = rawLine.match(/^\s+(\d+)\.\s+(.+?)\s+\|\s+(pending|queued|running|complete|completed|failed|paused)\b(.*)$/i)
      || rawLine.match(/^\s+(\d+)\.\s+(.+?)\s+(pending|queued|running|complete|completed|failed|paused)\b(.*)$/i);
    if (!stepMatch || stepMatch[3].toLowerCase() !== "running") continue;
    const name = subagentAgentFromDisplay(stepMatch[2]);
    if (!name) continue;
    const index = Math.max(0, Number.parseInt(stepMatch[1], 10) - 1);
    current.agents.push({
      id: `${current.id}:step:${index}:${name}`,
      name,
      status: "running",
      index,
      currentTool: subagentCurrentTool(stepMatch[4]) || undefined,
      nested: /^\s{4,}\d+\./.test(rawLine),
    });
  }
  // Keep active headers even before their first child step is persisted. Dynamic
  // workflow runs can report a running header for several polls while their
  // worker locator is still being written. Dropping that header makes absence
  // reconciliation falsely finish the run, after which later worker details are
  // deliberately ignored as stale and the UI is left with a fleet placeholder.
  return runs.filter((run) => run.status === "running");
}

function parseAsyncSubagentSnapshot(value, previousRuns = new Map()) {
  if (!value || typeof value !== "object"
    || value.kind !== SUBAGENT_ASYNC_STATUS_SNAPSHOT_KIND
    || value.version !== SUBAGENT_ASYNC_STATUS_SNAPSHOT_VERSION
    || !Array.isArray(value.runs)) return [];
  const runs = [];
  const seen = new Set();
  for (const candidate of value.runs.slice(0, SUBAGENT_ASYNC_STATUS_SNAPSHOT_RUN_LIMIT)) {
    const id = subagentText(candidate?.id, 160);
    if (!id || seen.has(id) || candidate?.state !== "running") continue;
    seen.add(id);
    const previous = previousRuns.get(id);
    const workflow = candidate?.kind === "workflow" || previous?.workflow === true;
    runs.push({
      id,
      source: "async",
      mode: subagentMode(undefined, previous?.mode),
      workflow,
      status: "running",
      startedAt: Number.isSafeInteger(candidate?.startedAt) && candidate.startedAt >= 0
        ? candidate.startedAt
        : Number.isFinite(previous?.startedAt) ? previous.startedAt : Date.now(),
      agents: [],
    });
  }
  return runs;
}

export default function webuiRpcHelper(pi) {
  let runtimeToolBaseline;
  let enabledTools = new Set();
  let disabledSkills = new Set();
  let inheritedEnabledSkills = null;
  let toolsPinned = false;
  let skillsPinned = false;
  let toolSelectionSource = "runtime";
  let skillSelectionSource = "runtime";
  let resourceGeneration = 0;
  let resourceRpcActive = false;
  let sessionSamplingParams = {};
  let subagentLaunchSlotGuidance = "";
  let subagentLaunchSlotRoles = null;
  let subagentLaunchSlotSnapshotLoadFailed = false;
  let activeSubagentLaunchSlotRevision = null;
  let subagentLaunchSlotGeneration = 0;
  let subagentModelDeviationPermits = [];
  let subagentContext = null;
  let subagentBridgeAvailable = false;
  let subagentPollTimer = null;
  let subagentPollGeneration = 0;
  let subagentPollSequence = 0;
  let subagentAppliedPollSequence = 0;
  let subagentFleetSummary = null;
  let lastPublishedSubagentSignature = "";
  let lastPublishedSubagentAt = 0;
  let lastPublishedAgentRunSignature = "";
  let lastPublishedAgentRunAt = 0;
  let lastPersistedRetainedSubagentSignature = "";
  // producerId -> Map<instanceId, canonical instance>. One producer never owns another's rows.
  const agentRunProviderSnapshots = new Map();
  const agentRunProviderDiagnostics = [];
  const helperAgentRunOutputSelections = new Map();
  // Canonical projection key -> dismissed lifecycle end. Keeps duplicate providers from recreating cleared rows.
  const dismissedHelperAgentRunProjections = new Map();
  const subagentStatusRequestsInFlight = new Set();
  const asyncSubagentRuns = new Map();
  const foregroundSubagentRuns = new Map();
  const workflowSubagentRuns = new Map();
  const recoveredSubagentRuns = new Map();
  const subagentGates = new Map();

  function ordinarySubagentRunEntries() {
    return [
      ...[...foregroundSubagentRuns.entries()].map(([key, run]) => ({ runs: foregroundSubagentRuns, key, run })),
      ...[...asyncSubagentRuns.entries()].map(([key, run]) => ({ runs: asyncSubagentRuns, key, run })),
    ];
  }

  function helperAgentRunProjectionKey(instance) {
    return `${instance?.parentSessionId || "external"}\0${instance?.instanceId || ""}`;
  }

  function rememberDismissedHelperAgentRunProjections(instances) {
    for (const instance of instances) {
      const key = helperAgentRunProjectionKey(instance);
      if (!instance?.instanceId || dismissedHelperAgentRunProjections.has(key)) continue;
      dismissedHelperAgentRunProjections.set(key, Number.isFinite(instance.endedAt) ? instance.endedAt : Number.isFinite(instance.startedAt) ? instance.startedAt : 0);
    }
    while (dismissedHelperAgentRunProjections.size > AGENT_RUN_INSTANCE_LIMIT) {
      const oldest = dismissedHelperAgentRunProjections.keys().next().value;
      if (oldest === undefined) break;
      dismissedHelperAgentRunProjections.delete(oldest);
    }
  }

  function helperAgentRunProjectionIsDismissed(instance) {
    const key = helperAgentRunProjectionKey(instance);
    if (!dismissedHelperAgentRunProjections.has(key)) return false;
    const dismissedLifecycleEnd = dismissedHelperAgentRunProjections.get(key);
    if (instance?.status === "running" && Number.isFinite(instance.startedAt) && instance.startedAt > dismissedLifecycleEnd) {
      dismissedHelperAgentRunProjections.delete(key);
      return false;
    }
    return true;
  }

  function trimFinishedSubagentRuns() {
    const finished = ordinarySubagentRunEntries()
      .filter(({ run }) => run?.status && run.status !== "running")
      .sort((left, right) => Number(left.run.endedAt || 0) - Number(right.run.endedAt || 0) || String(left.run.id).localeCompare(String(right.run.id)));
    while (finished.length > FINISHED_SUBAGENT_RUN_LIMIT) {
      const oldest = finished.shift();
      oldest.runs.delete(oldest.key);
    }
  }

  function retainedSubagentAgent(agent, run, index) {
    const asyncDir = subagentText(agent?.asyncDir, 4096);
    const sessionFile = subagentText(agent?.sessionFile, 4096);
    const hasOutputLocator = (asyncDir && path.isAbsolute(asyncDir))
      || (sessionFile && path.isAbsolute(sessionFile) && path.extname(sessionFile) === ".jsonl");
    return {
      id: subagentText(agent?.id || `${run.id}:${index}`, 240),
      name: subagentAgentName(agent?.name),
      status: run.status === "cancelled" ? "cancelled" : "done",
      index: Number.isInteger(agent?.index) ? agent.index : index,
      currentTool: subagentText(agent?.currentTool, 120) || undefined,
      currentToolArgs: subagentText(agent?.currentToolArgs, 500) || undefined,
      currentPath: subagentText(agent?.currentPath, 1000) || undefined,
      activityState: subagentText(agent?.activityState, 80) || undefined,
      model: subagentModel(agent?.model) || undefined,
      thinking: subagentThinking(agent?.thinking) || subagentThinkingFromModel(agent?.model) || undefined,
      nested: agent?.nested === true,
      targetRunId: subagentText(agent?.targetRunId, 160) || undefined,
      asyncDir: asyncDir && path.isAbsolute(asyncDir) ? path.normalize(asyncDir) : undefined,
      sessionFile: sessionFile && path.isAbsolute(sessionFile) && path.extname(sessionFile) === ".jsonl" ? path.normalize(sessionFile) : undefined,
      recentTools: hasOutputLocator ? [] : subagentRecentTools(agent?.recentTools),
      recentOutput: hasOutputLocator ? [] : subagentOutputLines(agent?.recentOutput),
      turnCount: Number.isFinite(agent?.turnCount) ? agent.turnCount : undefined,
      toolCount: Number.isFinite(agent?.toolCount) ? agent.toolCount : undefined,
      tokens: Number.isFinite(agent?.tokens) ? agent.tokens : undefined,
    };
  }

  function retainedSubagentRunsSnapshot() {
    return ordinarySubagentRunEntries()
      .map(({ run }) => run)
      .filter((run) => run?.status && run.status !== "running")
      .sort((left, right) => Number(left.endedAt || 0) - Number(right.endedAt || 0) || String(left.id).localeCompare(String(right.id)))
      .slice(-FINISHED_SUBAGENT_RUN_LIMIT)
      .map((run) => ({
        id: subagentText(run.id, 160),
        source: run.source === "foreground" ? "foreground" : "async",
        mode: subagentMode(run.mode),
        status: run.status,
        startedAt: Number.isFinite(run.startedAt) ? run.startedAt : Date.now(),
        endedAt: Number.isFinite(run.endedAt) ? run.endedAt : Date.now(),
        cancelReason: run.status === "cancelled" ? subagentText(run.cancelReason, 120) || undefined : undefined,
        cancelNote: run.status === "cancelled" ? subagentText(run.cancelNote, 2000) || undefined : undefined,
        cancelledBy: run.status === "cancelled" && run.cancelledBy === "user" ? "user" : undefined,
        agents: (Array.isArray(run.agents) ? run.agents : [])
          .slice(0, 128)
          .map((agent, index) => retainedSubagentAgent(agent, run, index))
          .filter((agent) => agent.name),
      }));
  }

  function persistRetainedSubagentRuns() {
    const runs = retainedSubagentRunsSnapshot();
    const snapshot = { version: 1, runs };
    const signature = JSON.stringify(snapshot);
    if (signature === lastPersistedRetainedSubagentSignature) return;
    lastPersistedRetainedSubagentSignature = signature;
    pi.appendEntry(RETAINED_SUBAGENT_RUNS_TYPE, snapshot);
  }

  function restoreRetainedSubagentRuns(ctx) {
    const saved = lastBranchConfig(ctx, RETAINED_SUBAGENT_RUNS_TYPE);
    const rawRuns = saved?.version === 1 && Array.isArray(saved.runs) ? saved.runs.slice(-FINISHED_SUBAGENT_RUN_LIMIT) : [];
    for (const rawRun of rawRuns) {
      if (!rawRun || typeof rawRun !== "object") continue;
      const id = subagentText(rawRun.id, 160);
      const status = ["done", "failed", "cancelled"].includes(rawRun.status) ? rawRun.status : "";
      if (!id || !status) continue;
      const source = rawRun.source === "foreground" ? "foreground" : "async";
      const agents = (Array.isArray(rawRun.agents) ? rawRun.agents : []).slice(0, 128)
        .map((agent, index) => retainedSubagentAgent(agent, { id, status }, index))
        .filter((agent) => agent.name);
      const run = {
        id,
        source,
        mode: subagentMode(rawRun.mode),
        status,
        startedAt: Number.isFinite(rawRun.startedAt) ? rawRun.startedAt : Date.now(),
        endedAt: Number.isFinite(rawRun.endedAt) ? rawRun.endedAt : Date.now(),
        cancelReason: status === "cancelled" ? subagentText(rawRun.cancelReason, 120) || undefined : undefined,
        cancelNote: status === "cancelled" ? subagentText(rawRun.cancelNote, 2000) || undefined : undefined,
        cancelledBy: status === "cancelled" && rawRun.cancelledBy === "user" ? "user" : undefined,
        agents,
      };
      (source === "foreground" ? foregroundSubagentRuns : asyncSubagentRuns).set(id, run);
    }
    trimFinishedSubagentRuns();
    lastPersistedRetainedSubagentSignature = JSON.stringify({ version: 1, runs: retainedSubagentRunsSnapshot() });
  }

  function finishSubagentRun(run, status = "done", fields = {}) {
    if (!run || (run.status !== "running" && fields.force !== true)) return false;
    const finalStatus = ["done", "failed", "cancelled"].includes(status) ? status : "done";
    run.status = finalStatus;
    run.endedAt = Date.now();
    if (finalStatus === "cancelled") {
      run.cancelledBy = "user";
      run.cancelReason = fields.reason || undefined;
      run.cancelNote = fields.note || undefined;
    }
    run.agents = (Array.isArray(run.agents) ? run.agents : []).map((agent) => ({
      ...agent,
      status: finalStatus === "cancelled" ? "cancelled" : "done",
    }));
    trimFinishedSubagentRuns();
    persistRetainedSubagentRuns();
    return true;
  }

  function publicSubagentRuns() {
    const ordinaryRuns = ordinarySubagentRunEntries()
      .map(({ run }) => {
        const status = ["running", "done", "failed", "cancelled"].includes(run.status) ? run.status : "running";
        const finalAgentStatus = status === "cancelled" ? "cancelled" : "done";
        return {
          id: subagentText(run.id, 160),
          source: run.source === "foreground" ? "foreground" : "async",
          mode: subagentMode(run.mode),
          status,
          startedAt: Number.isFinite(run.startedAt) ? run.startedAt : Date.now(),
          endedAt: status === "running" ? undefined : Number.isFinite(run.endedAt) ? run.endedAt : undefined,
          cancelReason: status === "cancelled" ? subagentText(run.cancelReason, 120) || undefined : undefined,
          cancelNote: status === "cancelled" ? subagentText(run.cancelNote, 2000) || undefined : undefined,
          cancelledBy: status === "cancelled" && run.cancelledBy === "user" ? "user" : undefined,
          agents: (Array.isArray(run.agents) ? run.agents : [])
            .filter((agent) => (status === "running" ? agent?.status === "running" : true) && subagentAgentName(agent?.name))
            .slice(0, 128)
            .map((agent, index) => ({
              id: subagentText(agent.id || `${run.id}:${index}`, 240),
              name: subagentAgentName(agent.name),
              status: status === "running" ? "running" : finalAgentStatus,
              index: Number.isInteger(agent.index) ? agent.index : index,
              currentTool: subagentText(agent.currentTool, 120) || undefined,
              activityState: subagentText(agent.activityState, 80) || undefined,
              model: subagentModel(agent.model) || undefined,
              thinking: subagentThinking(agent.thinking) || subagentThinkingFromModel(agent.model) || undefined,
              nested: agent.nested === true,
            })),
        };
      });
    const workflowRuns = [...workflowSubagentRuns.values()]
      .map((run) => ({
        id: run.id,
        source: "workflow",
        name: run.name,
        mode: subagentMode(run.mode),
        status: "running",
        startedAt: run.startedAt,
        agents: run.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          status: "running",
          index: agent.index,
          activityState: agent.activityState,
          model: agent.model,
          // Workflow snapshots do not publish thinking metadata, so unknown must remain unknown.
          thinking: undefined,
          nested: false,
        })),
      }));
    const recoveredRuns = [...recoveredSubagentRuns.values()].map((run) => ({
      id: run.id,
      source: "recovered",
      mode: "single",
      status: "running",
      startedAt: run.startedAt,
      provisional: true,
      controllable: false,
      agents: [{
        id: run.agent.id,
        name: run.agent.name,
        status: "running",
        index: 0,
        model: run.agent.model,
        thinking: run.agent.thinking,
        nested: false,
      }],
    }));
    return [...ordinaryRuns, ...workflowRuns, ...recoveredRuns]
      .filter((run) => run.id && (run.status !== "running" || run.agents.length > 0))
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }

  function publicSubagentGates() {
    return [...subagentGates.values()]
      .slice(-32)
      .map((gate) => ({
        version: 1,
        id: subagentText(gate.id, 160),
        status: ["running", "satisfied", "failed", "cancelled"].includes(gate.status) ? gate.status : "failed",
        requiredSuccesses: Number.isInteger(gate.requiredSuccesses) ? gate.requiredSuccesses : 1,
        qualifyingSuccesses: Number.isInteger(gate.qualifyingSuccesses) ? gate.qualifyingSuccesses : 0,
        requireDistinctProviders: gate.requireDistinctProviders === true,
        startedAt: Number.isFinite(gate.startedAt) ? gate.startedAt : Date.now(),
        updatedAt: Number.isFinite(gate.updatedAt) ? gate.updatedAt : Date.now(),
        endedAt: Number.isFinite(gate.endedAt) ? gate.endedAt : undefined,
        attempts: (Array.isArray(gate.attempts) ? gate.attempts : []).slice(-100).map((attempt, index) => ({
          id: subagentText(attempt?.id || `${gate.id}:${index}`, 240),
          taskIndex: Number.isInteger(attempt?.taskIndex) ? attempt.taskIndex : index,
          attempt: Number.isInteger(attempt?.attempt) ? attempt.attempt : 1,
          maxAttempts: Number.isInteger(attempt?.maxAttempts) ? attempt.maxAttempts : 1,
          agent: subagentAgentName(attempt?.agent) || "subagent",
          label: subagentText(attempt?.label, 200) || undefined,
          phase: subagentText(attempt?.phase, 120) || undefined,
          retrySafety: attempt?.retrySafety === "read-only" ? "read-only" : "may-write",
          runId: subagentText(attempt?.runId, 160) || undefined,
          retryOf: subagentText(attempt?.retryOf, 160) || undefined,
          model: subagentModel(attempt?.model) || undefined,
          provider: subagentText(attempt?.provider, 80) || undefined,
          status: ["launching", "running", "succeeded", "failed", "not-qualifying", "cancelled"].includes(attempt?.status) ? attempt.status : "failed",
          failureKind: subagentText(attempt?.failureKind, 80) || undefined,
          error: subagentText(attempt?.error, 1000) || undefined,
          startedAt: Number.isFinite(attempt?.startedAt) ? attempt.startedAt : undefined,
          endedAt: Number.isFinite(attempt?.endedAt) ? attempt.endedAt : undefined,
        })),
      }))
      .filter((gate) => gate.id)
      .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
  }

  function resetCanonicalAgentRunState() {
    agentRunProviderSnapshots.clear();
    agentRunProviderDiagnostics.length = 0;
    helperAgentRunOutputSelections.clear();
    lastPublishedAgentRunSignature = "";
    lastPublishedAgentRunAt = 0;
  }

  function recordAgentRunDiagnostic(code, producerId) {
    const entry = { code, ...(producerId ? { producerId: canonicalAgentRunId(producerId, "producer") } : {}) };
    const signature = JSON.stringify(entry);
    if (agentRunProviderDiagnostics.some((item) => JSON.stringify(item) === signature)) return;
    agentRunProviderDiagnostics.push(entry);
    while (agentRunProviderDiagnostics.length > AGENT_RUN_DIAGNOSTIC_LIMIT) agentRunProviderDiagnostics.shift();
  }

  /**
   * Ingest one bounded process-local provider snapshot. A malformed or oversized
   * snapshot is dropped with a diagnostic and can never clear another producer's rows.
   */
  function ingestAgentRunProviderSnapshot(value) {
    let snapshot;
    try {
      snapshot = normalizeProviderSnapshot(value);
    } catch {
      recordAgentRunDiagnostic("invalid-provider-snapshot", value?.producerId);
      return false;
    }
    const existing = agentRunProviderSnapshots.get(snapshot.producerId);
    if (!existing && agentRunProviderSnapshots.size >= AGENT_RUN_PRODUCER_LIMIT) {
      recordAgentRunDiagnostic("producer-limit-reached", snapshot.producerId);
      return false;
    }
    const rows = snapshot.complete ? new Map() : new Map(existing || []);
    for (const instance of snapshot.instances) rows.set(instance.instanceId, instance);
    for (const removed of snapshot.removals) rows.delete(removed);
    if (rows.size) agentRunProviderSnapshots.set(snapshot.producerId, rows);
    else agentRunProviderSnapshots.delete(snapshot.producerId);
    return true;
  }

  function canonicalInstancesFromPublicRun(run, gateRunIds) {
    const workflow = run.source === "workflow";
    const rawParentSessionId = subagentContext?.sessionManager?.getSessionId?.();
    const parentSessionId = rawParentSessionId ? canonicalAgentRunId(rawParentSessionId, "session") : null;
    const recovered = run.source === "recovered";
    const terminal = run.status !== "running";
    const startedAt = Number.isFinite(run.startedAt) ? run.startedAt : Date.now();
    // Unknown terminal time stays anchored to the stable start time instead of inventing
    // a fresh timestamp on every projection and defeating status deduplication.
    const endedAt = terminal ? Math.max(startedAt, Number.isFinite(run.endedAt) ? run.endedAt : startedAt) : null;
    // Projection signatures must stay stable between source changes; publication adds its own heartbeat timestamp.
    const updatedAt = terminal ? endedAt : startedAt;
    const canonicalRunId = canonicalAgentRunId(run.id, "run");
    // Gate launches stay one canonical child: the launch family changes, the count does not.
    const launcher = gateRunIds.has(run.id) ? "gate" : workflow ? "workflow" : "pi-subagents";
    return (Array.isArray(run.agents) ? run.agents : []).map((agent) => {
      const status = canonicalAgentRunStatus(run.status, agent.status);
      return {
        version: 1,
        instanceId: canonicalAgentRunId(agent.id, `${canonicalRunId}-agent`),
        runId: canonicalRunId,
        parentSessionId,
        launcher,
        provider: workflow ? "workflow-run" : "pi-subagents",
        origin: run.source,
        name: agent.name,
        status,
        startedAt,
        updatedAt,
        endedAt: ["done", "failed", "cancelled"].includes(status) ? endedAt : null,
        model: agent.model,
        thinking: agent.thinking,
        activityState: agent.activityState && CANONICAL_AGENT_RUN_ID_PATTERN.test(agent.activityState) ? agent.activityState : undefined,
        currentTool: agent.currentTool,
        capabilities: {
          open: true,
          refresh: true,
          // Aggregate fleet recovery grants a read-only metadata view, never lifecycle control.
          cancel: status === "running" && !workflow && !recovered && run.controllable !== false,
          steer: false,
        },
        outputRef: { kind: "helper", id: helperAgentRunOutputId(run.id, agent.id) },
        _selection: { runId: run.id, agentId: agent.id },
      };
    });
  }

  /**
   * Canonical, deduplicated projection of every provider this helper observes.
   * Counts derive from canonical instance IDs only; gates and workflow containers
   * are references, never additional agents.
   */
  function canonicalAgentRunSnapshot(runs, gates) {
    const index = new AgentRunIndex();
    const selections = new Map();
    const gateRunIds = new Set();
    for (const gate of gates) {
      for (const attempt of gate.attempts) if (attempt.runId) gateRunIds.add(attempt.runId);
    }

    const instanceIdByPublicRun = new Map();
    for (const run of runs) {
      for (const candidate of canonicalInstancesFromPublicRun(run, gateRunIds)) {
        const { _selection: selection, ...instance } = candidate;
        if (instance.status === "running") dismissedHelperAgentRunProjections.delete(helperAgentRunProjectionKey(instance));
        try {
          // The helper owns lifecycle and capabilities for the rows it observes directly.
          index.upsert(instance, { producerId: instance.provider, lifecycleOwner: true, capabilityOwner: true });
        } catch {
          recordAgentRunDiagnostic("invalid-helper-instance", instance.provider);
          continue;
        }
        if (selection) selections.set(instance.outputRef.id, selection);
        const known = instanceIdByPublicRun.get(run.id) || [];
        known.push(instance.instanceId);
        instanceIdByPublicRun.set(run.id, known);
      }
    }

    for (const [producerId, rows] of agentRunProviderSnapshots) {
      for (const instance of rows.values()) {
        if (helperAgentRunProjectionIsDismissed(instance)) continue;
        try {
          // Foreign producers may enrich an existing instance but never seize ownership.
          index.upsert(instance, { producerId, lifecycleOwner: false, capabilityOwner: false });
        } catch {
          recordAgentRunDiagnostic("invalid-provider-instance", producerId);
        }
      }
    }

    const gateReferences = [];
    for (const gate of gates) {
      for (const attempt of gate.attempts) {
        if (!attempt.runId || gateReferences.length >= AGENT_RUN_GATE_REFERENCE_LIMIT) continue;
        const instanceIds = instanceIdByPublicRun.get(attempt.runId) || [];
        gateReferences.push({
          gateId: gate.id,
          attemptId: attempt.id,
          runId: canonicalAgentRunId(attempt.runId, "run"),
          instanceIds,
          resolved: instanceIds.length > 0,
        });
      }
    }

    helperAgentRunOutputSelections.clear();
    for (const [outputId, selection] of selections) helperAgentRunOutputSelections.set(outputId, selection);

    return {
      instances: index.values().slice(0, AGENT_RUN_INSTANCE_LIMIT),
      gateReferences,
      producers: [...agentRunProviderSnapshots.keys()].slice(0, AGENT_RUN_PRODUCER_LIMIT),
      diagnostics: agentRunProviderDiagnostics.slice(-AGENT_RUN_DIAGNOSTIC_LIMIT),
    };
  }

  function publishCanonicalAgentRunStatus(runs, gates, now) {
    const snapshot = { version: WEBUI_SUBAGENTS_V2_VERSION, available: subagentBridgeAvailable, ...canonicalAgentRunSnapshot(runs, gates) };
    const signature = JSON.stringify(snapshot);
    if (signature === lastPublishedAgentRunSignature && now - lastPublishedAgentRunAt < SUBAGENT_STATUS_HEARTBEAT_MS) return;
    try {
      subagentContext.ui.setStatus(WEBUI_SUBAGENTS_V2_STATUS_KEY, `${WEBUI_SUBAGENTS_V2_PAYLOAD_PREFIX}${JSON.stringify({ ...snapshot, updatedAt: now })}`);
      lastPublishedAgentRunSignature = signature;
      lastPublishedAgentRunAt = now;
    } catch {
      // Leave the signature uncommitted so a later poll or lifecycle event retries delivery.
    }
  }

  function publishLegacySubagentStatus(snapshot, now) {
    const signature = JSON.stringify(snapshot);
    if (signature === lastPublishedSubagentSignature && now - lastPublishedSubagentAt < SUBAGENT_STATUS_HEARTBEAT_MS) return;
    try {
      subagentContext.ui.setStatus(WEBUI_SUBAGENTS_STATUS_KEY, `${WEBUI_SUBAGENTS_PAYLOAD_PREFIX}${JSON.stringify({ ...snapshot, updatedAt: now })}`);
      lastPublishedSubagentSignature = signature;
      lastPublishedSubagentAt = now;
    } catch {
      // Leave the signature uncommitted so a later poll or lifecycle event retries delivery.
    }
  }

  function publishSubagentStatus() {
    if (!subagentContext?.hasUI) return;
    const runs = publicSubagentRuns();
    const gates = publicSubagentGates();
    const now = Date.now();
    // Both keys are published independently: an old server keeps consuming v1,
    // a new server prefers v2, and a failure on one key never suppresses the other.
    publishLegacySubagentStatus({
      version: 1,
      available: subagentBridgeAvailable,
      runs,
      gates,
      ...(subagentFleetSummary ? { fleet: subagentFleetSummary } : {}),
    }, now);
    publishCanonicalAgentRunStatus(runs, gates, now);
  }

  function requestSubagentRpc(method, params = {}) {
    const requestId = `webui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      let unsubscribe;
      const timeout = setTimeout(() => {
        if (typeof unsubscribe === "function") unsubscribe();
        reject(new Error(`Timed out waiting for pi-subagents ${method} RPC`));
      }, SUBAGENT_STATUS_RPC_TIMEOUT_MS);
      unsubscribe = pi.events.on(`${SUBAGENT_RPC_REPLY_PREFIX}${requestId}`, (reply) => {
        clearTimeout(timeout);
        if (typeof unsubscribe === "function") unsubscribe();
        if (reply?.success === false) reject(new Error(reply.error?.message || `pi-subagents ${method} RPC failed`));
        else resolve(reply?.data || {});
      });
      pi.events.emit(SUBAGENT_RPC_REQUEST_EVENT, {
        version: SUBAGENT_RPC_VERSION,
        requestId,
        method,
        params,
        source: { extension: "pi-package-webui" },
      });
    });
  }

  function requestSubagentStatus(params = {}) {
    return requestSubagentRpc("status", params);
  }

  function findTrackedSubagentRun(runId) {
    const entry = ordinarySubagentRunEntries().find((candidate) => candidate.run?.id === runId);
    if (!entry) throw new Error(`Subagent run not found: ${runId}`);
    return entry;
  }

  function findTrackedSubagent(runId, agentId) {
    const entry = ordinarySubagentRunEntries().find((candidate) => candidate.run?.id === runId);
    if (entry) {
      const agent = (Array.isArray(entry.run.agents) ? entry.run.agents : []).find((candidate) => candidate?.id === agentId);
      if (!agent) throw new Error(`Subagent not found: ${agentId}`);
      return { run: entry.run, agent };
    }
    const recovered = [...recoveredSubagentRuns.values()].find((candidate) => candidate?.id === runId);
    if (recovered?.agent?.id !== agentId) throw new Error(`Subagent run not found: ${runId}`);
    return {
      run: { id: recovered.id, source: "recovered", mode: "single", status: "running", startedAt: recovered.startedAt, provisional: true, controllable: false },
      agent: { ...recovered.agent, status: "running", index: 0, nested: false },
    };
  }

  function findWorkflowSubagent(runId, agentId) {
    const run = workflowSubagentRuns.get(runId);
    if (!run) return undefined;
    const agent = run.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Running subagent not found: ${agentId}`);
    return { run, agent };
  }

  function claimRecoveredSubagentMatches(agents) {
    const available = [...recoveredSubagentRuns.entries()]
      .sort((left, right) => Number(left[1]?.startedAt || 0) - Number(right[1]?.startedAt || 0));
    return agents.map((agent) => {
      const name = subagentAgentName(agent?.name);
      const matchesName = (run) => run?.agent?.identity === name || run?.agent?.name === name;
      const exactModelIndex = available.findIndex(([, run]) => matchesName(run)
        && agent?.model && run.agent.model && agent.model === run.agent.model);
      const matchIndex = exactModelIndex >= 0
        ? exactModelIndex
        : available.findIndex(([, run]) => matchesName(run));
      if (matchIndex < 0) return undefined;
      const [[key, run]] = available.splice(matchIndex, 1);
      recoveredSubagentRuns.delete(key);
      return run;
    });
  }

  function workflowSubagentOutputSnapshot(run, agent) {
    return {
      version: 1,
      runId: run.id,
      source: "workflow",
      mode: subagentMode(run.mode),
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      agent: {
        id: agent.id,
        name: agent.name,
        index: agent.index,
        nested: false,
        status: "running",
        activityState: agent.activityState,
        model: agent.model,
        // Workflow snapshots do not carry child-session telemetry or reasoning data.
        thinking: undefined,
        telemetry: subagentEmptyTelemetry(),
        recentTools: [],
        recentOutput: agent.recentOutput,
        transcript: [],
      },
    };
  }

  function subagentAsyncDirFromStatusText(text) {
    const match = String(text || "").match(/^Dir:\s+(.+)$/m);
    const value = String(match?.[1] || "").trim();
    return value && path.isAbsolute(value) ? path.normalize(value) : "";
  }

  function subagentStatusStepForAgent(status, agent) {
    const steps = Array.isArray(status?.steps) ? status.steps : [];
    const indexed = steps[agent.index];
    if (indexed?.agent === agent.name) return indexed;
    return steps.find((step) => step?.agent === agent.name && ["running", "queued", "pending"].includes(step?.status))
      || steps.find((step) => step?.agent === agent.name)
      || (steps.length === 1 ? steps[0] : undefined);
  }

  async function enrichAsyncSubagentAgent(run, agent, statusByDir) {
    const targetRunId = subagentText(agent.targetRunId || run.id, 160);
    let asyncDir = subagentText(agent.asyncDir || (targetRunId === run.id ? run.asyncDir : ""), 4096);
    if (!asyncDir) {
      try {
        const data = await requestSubagentStatus({ id: targetRunId });
        asyncDir = subagentAsyncDirFromStatusText(data?.text);
      } catch {
        return;
      }
    }
    if (!asyncDir) return;
    agent.asyncDir = asyncDir;
    if (targetRunId === run.id) run.asyncDir = asyncDir;
    if (!statusByDir.has(asyncDir)) {
      try {
        statusByDir.set(asyncDir, JSON.parse(readFileSync(path.join(asyncDir, "status.json"), "utf8")));
      } catch {
        statusByDir.set(asyncDir, null);
      }
    }
    const status = statusByDir.get(asyncDir);
    if (!status || (status.runId && status.runId !== targetRunId)) return;
    const step = subagentStatusStepForAgent(status, agent);
    if (!step) return;
    agent.model = subagentModel(step.model) || agent.model;
    agent.thinking = subagentThinking(step.thinking) || subagentThinkingFromModel(step.model) || agent.thinking;
    const steps = Array.isArray(status.steps) ? status.steps : [];
    const sessionFile = subagentText(step.sessionFile || (steps.length === 1 ? status.sessionFile : ""), 4096);
    if (sessionFile && path.isAbsolute(sessionFile) && path.extname(sessionFile) === ".jsonl") agent.sessionFile = path.normalize(sessionFile);
  }

  function subagentRunningAgentsFromStatus(run, status) {
    return (Array.isArray(status?.steps) ? status.steps : [])
      .slice(0, 128)
      .map((step, offset) => {
        if (step?.status !== "running") return undefined;
        const name = subagentAgentName(step.agent);
        if (!name) return undefined;
        const index = Number.isInteger(step.index) && step.index >= 0 ? step.index : offset;
        const sessionFile = subagentText(step.sessionFile, 4096);
        return {
          id: `${run.id}:step:${index}:${name}`,
          name,
          status: "running",
          index,
          currentTool: subagentText(step.currentTool, 120) || undefined,
          activityState: subagentText(step.activityState, 80) || undefined,
          currentPath: subagentText(step.currentPath, 1000) || undefined,
          turnCount: Number.isFinite(step.turnCount) ? step.turnCount : undefined,
          toolCount: Number.isFinite(step.toolCount) ? step.toolCount : undefined,
          tokens: Number.isFinite(step.tokens?.total) ? step.tokens.total : Number.isFinite(step.tokens) ? step.tokens : undefined,
          model: subagentModel(step.model) || undefined,
          thinking: subagentThinking(step.thinking) || subagentThinkingFromModel(step.model) || undefined,
          recentTools: subagentRecentTools(step.recentTools),
          recentOutput: subagentOutputLines(step.recentOutput),
          sessionFile: sessionFile && path.isAbsolute(sessionFile) && path.extname(sessionFile) === ".jsonl" ? path.normalize(sessionFile) : undefined,
          nested: false,
        };
      })
      .filter(Boolean);
  }

  async function enrichAsyncSubagentRun(run) {
    const statusByDir = new Map();
    const agents = Array.isArray(run?.agents) ? run.agents : [];
    if (!agents.some((agent) => agent?.status === "running")) {
      const targetRunId = subagentText(run?.id, 160);
      let asyncDir = subagentText(run?.asyncDir, 4096);
      if (!asyncDir && targetRunId) {
        try {
          const data = await requestSubagentStatus({ id: targetRunId });
          asyncDir = subagentAsyncDirFromStatusText(data?.text);
        } catch {
          // The aggregate snapshot still keeps the run alive until a locator resolves.
        }
      }
      if (asyncDir) {
        run.asyncDir = asyncDir;
        let status = null;
        try {
          status = JSON.parse(readFileSync(path.join(asyncDir, "status.json"), "utf8"));
        } catch {
          // A status write can be briefly between atomic replacements.
        }
        if (status && (!status.runId || status.runId === targetRunId)) {
          statusByDir.set(asyncDir, status);
          run.workflow = status.mode === "workflow" || run.workflow === true;
          run.mode = subagentMode(status.mode, run.mode);
          if (!Number.isFinite(run.startedAt) && Number.isFinite(status.startedAt)) run.startedAt = status.startedAt;
          const discovered = subagentRunningAgentsFromStatus(run, status);
          if (discovered.length) {
            run.agents = [
              ...agents.filter((agent) => !discovered.some((candidate) => candidate.index === agent.index && candidate.name === agent.name)),
              ...discovered.map((agent) => ({
                ...agents.find((candidate) => candidate.index === agent.index && candidate.name === agent.name),
                ...agent,
              })),
            ];
          }
        }
      }
    }
    for (const agent of Array.isArray(run?.agents) ? run.agents : []) {
      if (agent?.status !== "running") continue;
      await enrichAsyncSubagentAgent(run, agent, statusByDir);
    }
  }

  function trackSubagentGateAttempts(gate) {
    for (const attempt of Array.isArray(gate?.attempts) ? gate.attempts : []) {
      const runId = subagentText(attempt?.runId, 160);
      const agentName = subagentAgentName(attempt?.agent);
      if (!runId || !agentName || attempt?.status !== "running") continue;

      const [recovered] = claimRecoveredSubagentMatches([{ name: agentName, model: subagentModel(attempt?.model) || undefined }]);
      const existing = ordinarySubagentRunEntries().find((entry) => entry.run?.id === runId)?.run;
      if (existing) {
        if (recovered && Array.isArray(existing.agents) && existing.agents.length === 1) {
          const [agent] = existing.agents;
          Object.assign(agent, {
            model: agent.model || recovered.agent?.model,
            thinking: agent.thinking || recovered.agent?.thinking,
          });
        }
        continue;
      }

      const startedAt = Number.isFinite(attempt?.startedAt)
        ? attempt.startedAt
        : Number.isFinite(recovered?.startedAt)
          ? recovered.startedAt
          : Date.now();
      const run = {
        id: runId,
        source: "async",
        mode: "single",
        status: "running",
        startedAt,
        eventSeenAt: Date.now(),
        agents: [{
          ...recovered?.agent,
          id: `${runId}:0:${agentName}`,
          name: agentName,
          status: "running",
          index: 0,
          model: subagentModel(attempt?.model) || recovered?.agent?.model,
          thinking: subagentThinkingFromModel(attempt?.model) || recovered?.agent?.thinking,
          nested: false,
        }],
      };
      asyncSubagentRuns.set(runId, run);
      void enrichAsyncSubagentRun(run).finally(() => {
        if (asyncSubagentRuns.get(runId) === run) publishSubagentStatus();
      });
    }
  }

  function subagentOutputSnapshotFromAgent(run, agent, patch = {}) {
    const model = subagentModel(patch.model || agent.model) || undefined;
    const thinking = subagentThinking(patch.thinking || agent.thinking) || undefined;
    const telemetry = patch.telemetry && typeof patch.telemetry === "object"
      ? patch.telemetry
      : subagentEmptyTelemetry({ model, effort: thinking, context: subagentContext });
    return {
      version: 1,
      runId: run.id,
      source: ["foreground", "recovered"].includes(run.source) ? run.source : "async",
      mode: subagentMode(run.mode),
      startedAt: Number.isFinite(run.startedAt) ? run.startedAt : Date.now(),
      updatedAt: Number.isFinite(patch.updatedAt) ? patch.updatedAt : Date.now(),
      agent: {
        id: agent.id,
        name: subagentAgentName(patch.name || agent.name),
        index: Number.isInteger(agent.index) ? agent.index : 0,
        nested: agent.nested === true,
        status: subagentText(patch.status || agent.status, 40) || "running",
        activityState: subagentText(patch.activityState || agent.activityState, 80) || undefined,
        currentTool: subagentText(patch.currentTool || agent.currentTool, 120) || undefined,
        currentToolArgs: subagentText(patch.currentToolArgs || agent.currentToolArgs, 500) || undefined,
        currentPath: subagentText(patch.currentPath || agent.currentPath, 1000) || undefined,
        turnCount: Number.isFinite(patch.turnCount) ? patch.turnCount : Number.isFinite(agent.turnCount) ? agent.turnCount : undefined,
        toolCount: Number.isFinite(patch.toolCount) ? patch.toolCount : Number.isFinite(agent.toolCount) ? agent.toolCount : undefined,
        tokens: Number.isFinite(patch.tokens) ? patch.tokens : Number.isFinite(agent.tokens) ? agent.tokens : undefined,
        model,
        thinking,
        telemetry,
        recentTools: subagentRecentTools(patch.recentTools || agent.recentTools),
        recentOutput: subagentOutputLines(patch.recentOutput || agent.recentOutput),
        transcript: Array.isArray(patch.transcript) ? patch.transcript : [],
        unavailable: patch.unavailable === true || undefined,
        unavailableReason: patch.unavailable === true ? subagentText(patch.unavailableReason, 1000) || "Live output is unavailable for this recovered agent." : undefined,
        error: subagentText(patch.error, 1000) || undefined,
      },
    };
  }

  async function subagentOutputSnapshot(payload = {}) {
    // Opaque helper-owned handles resolve to an internal selection here; the browser
    // never supplies a run/agent path or an arbitrary locator.
    const outputId = subagentText(payload.outputId, 160);
    if (outputId) {
      const selection = helperAgentRunOutputSelections.get(outputId);
      if (!selection) throw new Error("Subagent output handle is no longer tracked");
      return subagentOutputSnapshot({ runId: selection.runId, agentId: selection.agentId });
    }

    const workflowRunId = workflowSubagentIdentifier(payload.runId, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.runIdentifierLength);
    const workflowAgentId = workflowSubagentIdentifier(payload.agentId, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.agentIdentifierLength);
    if (workflowRunId && workflowAgentId) {
      const workflow = findWorkflowSubagent(workflowRunId, workflowAgentId);
      if (workflow) return workflowSubagentOutputSnapshot(workflow.run, workflow.agent);
    }

    const runId = subagentText(payload.runId, 160);
    const agentId = subagentText(payload.agentId, 240);
    if (!runId || !agentId) throw new Error("Subagent output requires runId and agentId");
    const { run, agent } = findTrackedSubagent(runId, agentId);
    if (run.source === "recovered") {
      return subagentOutputSnapshotFromAgent(run, agent, {
        unavailable: true,
        unavailableReason: "This active pi-subagents child was recovered from aggregate fleet metadata; detailed live output is unavailable until its run locator is observed.",
      });
    }
    if (run.source === "foreground") return subagentOutputSnapshotFromAgent(run, agent, { updatedAt: run.endedAt });
    if (run.status !== "running") {
      if (!agent.sessionFile && agent.asyncDir) {
        try {
          const status = JSON.parse(readFileSync(path.join(agent.asyncDir, "status.json"), "utf8"));
          const targetRunId = subagentText(agent.targetRunId || run.id, 160);
          if (!status?.runId || status.runId === targetRunId) {
            const step = subagentStatusStepForAgent(status, agent);
            const steps = Array.isArray(status?.steps) ? status.steps : [];
            const sessionFile = subagentText(step?.sessionFile || (steps.length === 1 ? status.sessionFile : ""), 4096);
            if (sessionFile && path.isAbsolute(sessionFile) && path.extname(sessionFile) === ".jsonl") agent.sessionFile = path.normalize(sessionFile);
          }
        } catch {
          // Retained metadata remains viewable even when its async status locator is stale.
        }
      }
      const transcriptOutput = subagentTranscriptOutput(agent.sessionFile);
      const telemetry = subagentSessionTelemetry(agent.sessionFile, { model: agent.model, effort: agent.thinking, context: subagentContext });
      const hasLocator = !!(agent.sessionFile && existsSync(agent.sessionFile));
      return subagentOutputSnapshotFromAgent(run, agent, {
        recentOutput: transcriptOutput.recentOutput.length ? transcriptOutput.recentOutput : agent.recentOutput,
        transcript: transcriptOutput.transcript,
        telemetry,
        updatedAt: run.endedAt,
        error: !hasLocator && !(Array.isArray(agent.recentOutput) && agent.recentOutput.length)
          ? "Retained subagent output is unavailable because its child output locator is missing."
          : undefined,
      });
    }

    const targetRunId = subagentText(agent.targetRunId || run.id, 160);
    let asyncDir = subagentText(agent.asyncDir || (targetRunId === run.id ? run.asyncDir : ""), 4096);
    if (!asyncDir) {
      const data = await requestSubagentStatus({ id: targetRunId });
      asyncDir = subagentAsyncDirFromStatusText(data?.text);
      if (asyncDir) agent.asyncDir = asyncDir;
      if (asyncDir && targetRunId === run.id) run.asyncDir = asyncDir;
    }
    if (!asyncDir) return subagentOutputSnapshotFromAgent(run, agent);

    try {
      const status = JSON.parse(readFileSync(path.join(asyncDir, "status.json"), "utf8"));
      if (status?.runId && status.runId !== targetRunId) throw new Error(`Subagent status run mismatch for ${targetRunId}`);
      const steps = Array.isArray(status?.steps) ? status.steps : [];
      const step = agent.nested
        ? steps.find((candidate) => candidate?.agent === agent.name && ["running", "queued", "pending"].includes(candidate?.status)) || steps[status.currentStep] || steps[0]
        : steps[agent.index] || steps.find((candidate) => candidate?.agent === agent.name && ["running", "queued", "pending"].includes(candidate?.status));
      if (!step) return subagentOutputSnapshotFromAgent(run, agent, { status: status?.state, updatedAt: status?.lastUpdate });
      const sessionFile = subagentText(step.sessionFile || (steps.length === 1 ? status.sessionFile : ""), 4096);
      if (sessionFile && path.isAbsolute(sessionFile) && path.extname(sessionFile) === ".jsonl") agent.sessionFile = path.normalize(sessionFile);
      const transcriptOutput = subagentTranscriptOutput(agent.sessionFile);
      const telemetry = subagentSessionTelemetry(agent.sessionFile, {
        model: subagentModel(step.model) || agent.model,
        effort: subagentThinking(step.thinking) || subagentThinkingFromModel(step.model) || agent.thinking,
        context: subagentContext,
      });
      return subagentOutputSnapshotFromAgent(run, agent, {
        ...step,
        recentOutput: transcriptOutput.recentOutput.length ? transcriptOutput.recentOutput : step.recentOutput,
        transcript: transcriptOutput.transcript,
        telemetry,
        status: step.status || status.state,
        updatedAt: step.lastActivityAt || status.lastUpdate,
        tokens: Number.isFinite(step.tokens?.total) ? step.tokens.total : step.tokens,
      });
    } catch (error) {
      return subagentOutputSnapshotFromAgent(run, agent, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  function reconcileSubagentFleet(fleet, parsedIds) {
    subagentFleetSummary = fleet ? { version: 1, totalActive: fleet.totalActive, omitted: fleet.omitted } : null;
    if (!fleet) return new Set();
    const slots = [];
    const addSlots = (runs, priority) => {
      for (const run of runs) {
        if (run?.status !== "running") continue;
        const slotPriority = parsedIds.has(run.id) ? 0 : priority;
        // pi-subagents publishes one aggregate fleet entry named "workflow" for
        // each orchestration run. It is a controller, not a model-powered agent.
        // Claim it against the known workflow container so it cannot become an
        // empty recovered Workflow row beside the real child agent.
        if (run.workflow === true) slots.push({ run, identity: "workflow", priority: slotPriority, claimed: false });
        for (const agent of Array.isArray(run.agents) ? run.agents : []) {
          const identity = subagentAgentName(agent?.name);
          if (agent?.status !== "running" || !identity) continue;
          slots.push({ run, agent, identity, priority: slotPriority, claimed: false });
        }
      }
    };
    addSlots(asyncSubagentRuns.values(), 1);
    addSlots(foregroundSubagentRuns.values(), 2);
    slots.sort((left, right) => left.priority - right.priority);

    const matchedRunIds = new Set();
    const unmatched = [];
    for (const entry of fleet.entries) {
      const slot = slots.find((candidate) => !candidate.claimed && candidate.identity === entry.agent);
      if (!slot) {
        unmatched.push(entry);
        continue;
      }
      slot.claimed = true;
      matchedRunIds.add(slot.run.id);
      recoveredSubagentRuns.delete(entry.key);
    }

    const unmatchedKeys = new Set(unmatched.map((entry) => entry.key));
    for (const entry of unmatched) {
      const previous = recoveredSubagentRuns.get(entry.key);
      recoveredSubagentRuns.set(entry.key, {
        ...previous,
        id: `fleet:${entry.key}`,
        startedAt: entry.startedAt,
        absenceGeneration: subagentPollGeneration,
        absenceCount: 0,
        agent: {
          id: `fleet:${entry.key}:agent`,
          name: entry.name,
          identity: entry.agent,
          model: entry.model,
          thinking: entry.thinking,
        },
      });
    }
    if (fleet.omitted === 0) {
      for (const [key, run] of recoveredSubagentRuns) {
        if (unmatchedKeys.has(key)) continue;
        const count = run.absenceGeneration === subagentPollGeneration ? Number(run.absenceCount || 0) + 1 : 1;
        if (count >= SUBAGENT_AUTHORITATIVE_ABSENCE_LIMIT) recoveredSubagentRuns.delete(key);
        else Object.assign(run, { absenceGeneration: subagentPollGeneration, absenceCount: count });
      }
    }
    return matchedRunIds;
  }

  async function refreshSubagentStatus(generation = subagentPollGeneration) {
    if (generation !== subagentPollGeneration || subagentStatusRequestsInFlight.has(generation)) return;
    const sequence = ++subagentPollSequence;
    subagentStatusRequestsInFlight.add(generation);
    try {
      const data = await requestSubagentStatus();
      if (generation !== subagentPollGeneration || sequence <= subagentAppliedPollSequence) return;
      const parsedRuns = parseSubagentStatusText(data?.text, asyncSubagentRuns);
      const parsedRunIds = new Set(parsedRuns.map((run) => run.id));
      for (const run of parseAsyncSubagentSnapshot(data?.asyncSnapshot, asyncSubagentRuns)) {
        if (parsedRunIds.has(run.id)) continue;
        parsedRunIds.add(run.id);
        parsedRuns.push(run);
      }
      const nextRuns = [];
      for (const run of parsedRuns) {
        const previous = asyncSubagentRuns.get(run.id);
        if (previous?.status && previous.status !== "running") continue;
        const previousAgents = Array.isArray(previous?.agents) ? previous.agents : [];
        const runningAgents = run.agents.map((agent) => ({
          ...previousAgents.find((candidate) => candidate.index === agent.index && candidate.name === agent.name),
          ...agent,
          status: "running",
        }));
        const completedAgents = previousAgents
          .filter((candidate) => !runningAgents.some((agent) => agent.index === candidate.index && agent.name === candidate.name))
          .map((agent) => ({ ...agent, status: agent.status === "running" ? "done" : agent.status }));
        const merged = {
          ...previous,
          ...run,
          eventSeenAt: previous?.eventSeenAt || Date.now(),
          authoritativeAbsenceGeneration: generation,
          authoritativeAbsenceCount: 0,
          agents: [...completedAgents, ...runningAgents],
        };
        await enrichAsyncSubagentRun(merged);
        if (generation !== subagentPollGeneration || sequence <= subagentAppliedPollSequence) return;
        nextRuns.push(merged);
      }
      if (generation !== subagentPollGeneration || sequence <= subagentAppliedPollSequence) return;
      subagentAppliedPollSequence = sequence;
      subagentBridgeAvailable = true;
      for (const run of nextRuns) asyncSubagentRuns.set(run.id, run);
      const nextIds = new Set(nextRuns.map((run) => run.id));
      const fleet = normalizeSubagentFleet(data?.fleet);
      const fleetRunIds = reconcileSubagentFleet(fleet, nextIds);
      for (const run of asyncSubagentRuns.values()) {
        if (run?.status !== "running") continue;
        if (nextIds.has(run.id) || fleetRunIds.has(run.id)) {
          run.authoritativeAbsenceGeneration = generation;
          run.authoritativeAbsenceCount = 0;
          continue;
        }
        if (!fleet || fleet.omitted !== 0) continue;
        const count = run.authoritativeAbsenceGeneration === generation ? Number(run.authoritativeAbsenceCount || 0) + 1 : 1;
        run.authoritativeAbsenceGeneration = generation;
        run.authoritativeAbsenceCount = count;
        if (count >= SUBAGENT_AUTHORITATIVE_ABSENCE_LIMIT) finishSubagentRun(run, "done");
      }
    } catch {
      // The optional pi-subagents extension may not be loaded in this tab.
    } finally {
      subagentStatusRequestsInFlight.delete(generation);
      if (generation === subagentPollGeneration) publishSubagentStatus();
    }
  }

  function scheduleSubagentStatusPoll(generation = subagentPollGeneration, delay = SUBAGENT_STATUS_POLL_MS) {
    clearTimeout(subagentPollTimer);
    subagentPollTimer = setTimeout(async () => {
      if (generation !== subagentPollGeneration || !subagentContext) return;
      await refreshSubagentStatus(generation);
      scheduleSubagentStatusPoll(generation);
    }, delay);
    subagentPollTimer.unref?.();
  }

  const subagentEventUnsubscribers = [
    pi.events.on(WORKFLOW_SUBAGENTS_EVENT, (value) => {
      try {
        const nextRuns = workflowSubagentSnapshot(value);
        if (!nextRuns) return;
        workflowSubagentRuns.clear();
        for (const [id, run] of nextRuns) workflowSubagentRuns.set(id, run);
        publishSubagentStatus();
      } catch {
        // Ignore malformed cross-extension events without disrupting current live rows.
      }
    }),
    pi.events.on(AGENT_RUN_PROVIDER_EVENT, (value) => {
      // Generic process-local producers: bounded, validated, and producer-scoped.
      // Rejected snapshots still publish so their bounded diagnostic becomes visible;
      // repeated identical failures collapse into one deduplicated entry.
      ingestAgentRunProviderSnapshot(value);
      publishSubagentStatus();
    }),
    pi.events.on(SUBAGENT_RPC_READY_EVENT, () => {
      subagentBridgeAvailable = true;
      publishSubagentStatus();
      void refreshSubagentStatus(subagentPollGeneration);
    }),
    pi.events.on(SUBAGENT_ASYNC_STARTED_EVENT, (value) => {
      const info = value && typeof value === "object" ? value : {};
      const id = subagentText(info.id, 160);
      if (!id) return;
      let agents = subagentRunningGraphAgents(info.workflowGraph, id);
      if (!agents.length) {
        const names = info.mode === "parallel" && Array.isArray(info.agents) && info.agents.length
          ? info.agents
          : info.agent
            ? [info.agent]
            : Array.isArray(info.agents) && info.agents.length
              ? [info.agents[0]]
              : [];
        agents = names.map((name, index) => ({ id: `${id}:${index}:${subagentAgentName(name)}`, name: subagentAgentName(name), status: "running", index, nested: false })).filter((agent) => agent.name);
      }
      asyncSubagentRuns.set(id, {
        id,
        source: "async",
        mode: subagentMode(info.mode, Array.isArray(info.chain) ? "chain" : "single"),
        workflow: info.mode === "workflow" || undefined,
        status: "running",
        startedAt: Date.now(),
        eventSeenAt: Date.now(),
        asyncDir: subagentText(info.asyncDir, 4096) || undefined,
        agents,
      });
      subagentBridgeAvailable = true;
      publishSubagentStatus();
    }),
    pi.events.on(SUBAGENT_ASYNC_COMPLETE_EVENT, (value) => {
      const id = subagentText(value?.id || value?.runId, 160);
      const run = id ? [...asyncSubagentRuns.values()].find((candidate) => candidate?.id === id) : undefined;
      if (run) finishSubagentRun(run, value?.status === "failed" || value?.state === "failed" || value?.error ? "failed" : "done");
      publishSubagentStatus();
    }),
    pi.events.on(SUBAGENT_GATE_UPDATE_EVENT, (value) => {
      const id = subagentText(value?.id, 160);
      if (!id) return;
      const gate = { ...value, id };
      subagentGates.set(id, gate);
      trackSubagentGateAttempts(gate);
      while (subagentGates.size > 32) subagentGates.delete(subagentGates.keys().next().value);
      publishSubagentStatus();
    }),
  ].filter((unsubscribe) => typeof unsubscribe === "function");

  function runtimeTools() {
    return runtimeToolBaseline ??= normalizeNameList(pi.getActiveTools());
  }

  function allToolNames() {
    return pi.getAllTools().map((tool) => tool.name);
  }

  function restoreSamplingParamsFromBranch(ctx) {
    const saved = lastBranchConfig(ctx, SAMPLING_CONFIG_TYPE);
    try {
      sessionSamplingParams = saved?.version === 1 ? normalizeSamplingParams(saved.samplingParams) : {};
    } catch {
      sessionSamplingParams = {};
    }
  }

  function persistSamplingParams() {
    pi.appendEntry(SAMPLING_CONFIG_TYPE, { version: 1, samplingParams: sessionSamplingParams });
  }

  function samplingState(ctx) {
    const model = ctx.model;
    const api = typeof model?.api === "string" ? model.api : null;
    const parameters = resolveSamplingParameterCapabilities(model, { thinkingLevel: ctx.thinkingLevel });
    const supported = Object.values(parameters).some((capability) => capability.supported);
    const defaults = isPlainObject(model?.samplingParams) ? { ...model.samplingParams } : {};
    const session = { ...sessionSamplingParams };
    return {
      session,
      defaults,
      effective: {
        ...filterSupportedSamplingParameters(defaults, parameters),
        ...filterSupportedSamplingParameters(session, parameters),
      },
      support: {
        supported,
        api,
        model: model ? {
          provider: typeof model.provider === "string" ? model.provider : null,
          id: typeof model.id === "string" ? model.id : null,
          name: typeof model.name === "string" ? model.name : null,
        } : null,
        parameters,
        compatibleApis: [...BUILTIN_SAMPLING_APIS],
        message: supported
          ? "Session sampling parameters apply to subsequent provider requests."
          : api
            ? `Session sampling parameters are stored but not applied to ${api}.`
            : "Session sampling parameters are stored but no active model is available.",
      },
    };
  }

  function setSamplingParams(ctx, payload) {
    const normalized = normalizeSamplingParams(payload?.samplingParams);
    const validation = validateSamplingParameterObject(normalized);
    if (!validation.valid) {
      throw new SamplingParameterValidationError(
        `Invalid sampling parameters: ${Object.values(validation.errors).join(" ")}`,
        validation.errors,
      );
    }
    sessionSamplingParams = normalized;
    persistSamplingParams();
    return samplingState(ctx);
  }

  function resetSamplingParams(ctx) {
    sessionSamplingParams = {};
    persistSamplingParams();
    return samplingState(ctx);
  }

  async function readGlobalResourceDefaults() {
    return (await readWebuiSettings()).resourceDefaults;
  }

  function clearSubagentModelDeviationPermits() {
    subagentModelDeviationPermits = [];
  }

  function pruneSubagentModelDeviationPermits(now = Date.now()) {
    subagentModelDeviationPermits = subagentModelDeviationPermits.filter((permit) => permit.expiresAt > now
      && permit.slotRevision === activeSubagentLaunchSlotRevision
      && permit.helperGeneration === subagentLaunchSlotGeneration);
    return subagentModelDeviationPermits;
  }

  function subagentModelDeviationDescriptors() {
    return pruneSubagentModelDeviationPermits().map((permit) => ({
      id: permit.id,
      role: permit.role,
      occurrence: permit.occurrence,
      requestedModel: permit.requestedModel,
      expiresAt: permit.expiresAt,
    }));
  }

  function removeSubagentModelDeviationPermits(ids) {
    const consumed = new Set(ids);
    if (!consumed.size) return;
    subagentModelDeviationPermits = subagentModelDeviationPermits.filter((permit) => !consumed.has(permit.id));
  }

  async function approveSubagentModelDeviation(params = {}) {
    pruneSubagentModelDeviationPermits();
    if (!subagentLaunchSlotRoles || !activeSubagentLaunchSlotRevision) {
      throw new Error("Reviewer model deviation approval is unavailable until the active WebUI launch-slot snapshot loads.");
    }
    if (params.role !== "reviewer" || !Number.isInteger(params.occurrence)
      || params.occurrence < 1 || params.occurrence > SUBAGENT_DEVIATION_PERMIT_LIMIT) {
      throw new Error("Reviewer model deviation approval requires reviewer occurrence 1 through 8.");
    }
    if (typeof params.requestedModel !== "string" || params.requestedModel.length > SUBAGENT_DEVIATION_REQUESTED_MODEL_LIMIT) {
      throw new Error(`Requested model must be at most ${SUBAGENT_DEVIATION_REQUESTED_MODEL_LIMIT} characters.`);
    }
    const requestedModel = params.requestedModel.trim();
    if (!requestedModel) throw new Error("Requested model must not be blank.");
    if (typeof params.reason !== "string" || params.reason.length > SUBAGENT_DEVIATION_REASON_LIMIT) {
      throw new Error(`Deviation reason must be at most ${SUBAGENT_DEVIATION_REASON_LIMIT} characters.`);
    }
    const reason = params.reason.trim();
    if (!reason) throw new Error("Deviation reason must not be blank.");
    if (subagentModelDeviationPermits.length >= SUBAGENT_DEVIATION_PERMIT_LIMIT) {
      throw new Error("The active WebUI tab already has 8 unused reviewer model deviation permits.");
    }

    const approvalSlotRevision = activeSubagentLaunchSlotRevision;
    const approvalGeneration = subagentLaunchSlotGeneration;
    const context = subagentContext;
    if (context?.hasUI !== true || typeof context.ui?.confirm !== "function") {
      throw new Error("Reviewer model deviation approval requires an interactive WebUI confirmation.");
    }
    const confirmed = await context.ui.confirm(
      "Authorize reviewer model deviation?",
      `Allow reviewer occurrence ${params.occurrence} to use ${requestedModel} once within 2 minutes?\n\nReason: ${reason}`,
    );
    if (confirmed !== true) throw new Error("Reviewer model deviation approval was not confirmed by the user.");

    pruneSubagentModelDeviationPermits();
    if (!subagentLaunchSlotRoles || !activeSubagentLaunchSlotRevision) {
      throw new Error("Reviewer model deviation approval is unavailable until the active WebUI launch-slot snapshot loads.");
    }
    if (activeSubagentLaunchSlotRevision !== approvalSlotRevision || subagentLaunchSlotGeneration !== approvalGeneration) {
      throw new Error("Reviewer model deviation approval expired because the active WebUI launch-slot snapshot changed during confirmation.");
    }
    if (subagentModelDeviationPermits.length >= SUBAGENT_DEVIATION_PERMIT_LIMIT) {
      throw new Error("The active WebUI tab already has 8 unused reviewer model deviation permits.");
    }
    const createdAt = Date.now();
    const permit = {
      id: randomUUID(),
      role: "reviewer",
      occurrence: params.occurrence,
      requestedModel,
      reason,
      slotRevision: activeSubagentLaunchSlotRevision,
      helperGeneration: subagentLaunchSlotGeneration,
      createdAt,
      expiresAt: createdAt + SUBAGENT_DEVIATION_PERMIT_TTL_MS,
    };
    subagentModelDeviationPermits.push(permit);
    return {
      content: [{
        type: "text",
        text: `Approved one reviewer occurrence ${permit.occurrence} launch with ${permit.requestedModel}. The local permit expires in 2 minutes and is consumed by one admitted launch or leased workflow.`,
      }],
      details: {
        permitId: permit.id,
        role: permit.role,
        occurrence: permit.occurrence,
        requestedModel: permit.requestedModel,
        createdAt: permit.createdAt,
        expiresAt: permit.expiresAt,
      },
    };
  }

  function reviewerModelPolicyBlockReason(decisions) {
    const decision = decisions[0];
    const more = decisions.length > 1 ? ` (${decisions.length - 1} more mismatch${decisions.length === 2 ? "" : "es"} also blocked.)` : "";
    return `Reviewer occurrence ${decision.occurrence} model mismatch: expected ${decision.expectedModel}, requested ${decision.requestedModel}. Retry with ${decision.correctionModel} or omit model to use the configured slot; use approve_subagent_model_deviation only after explicit user authorization.${more}`;
  }

  function inputRequestsReviewer(input) {
    const role = (value) => typeof value === "string" ? value.trim() : "";
    if (!isPlainObject(input)) return false;
    if (role(input.agent) === "reviewer") return true;
    if (Array.isArray(input.tasks) && input.tasks.some((task) => role(task?.agent) === "reviewer")) return true;
    return Array.isArray(input.chain) && input.chain.some((step) => role(step?.agent) === "reviewer"
      || (Array.isArray(step?.parallel) && step.parallel.some((task) => role(task?.agent) === "reviewer"))
      || role(step?.parallel?.agent) === "reviewer");
  }

  function launchNeedsLoadedSlotSnapshot(toolName, input) {
    if (!isPlainObject(input) || input.action !== undefined || input.resume !== undefined) return false;
    if (toolName === "subagent" && typeof input.workflowScript === "string" && input.workflowScript.trim()) return true;
    return inputRequestsReviewer(input);
  }

  async function loadSubagentLaunchSlotGuidance(ctx) {
    const generation = ++subagentLaunchSlotGeneration;
    clearSubagentModelDeviationPermits();
    activeSubagentLaunchSlotRevision = null;
    try {
      const settings = await readWebuiSettings();
      const projectKey = await resolveSubagentLaunchSlotProjectKey(ctx?.cwd);
      const effective = subagentLaunchSlotScopeEntry(settings.subagentLaunchSlots, "project", projectKey);
      const revision = subagentLaunchSlotRevision(settings.subagentLaunchSlots, "project", projectKey);
      if (generation !== subagentLaunchSlotGeneration) return;
      subagentLaunchSlotRoles = effective.entry.roles;
      subagentLaunchSlotSnapshotLoadFailed = false;
      activeSubagentLaunchSlotRevision = revision;
      const assignments = formatSubagentLaunchSlotGuidance(subagentLaunchSlotRoles);
      subagentLaunchSlotGuidance = assignments
        ? `${assignments}\nExplicit reviewer model or thinking mismatches are blocked before launch. The approve_subagent_model_deviation tool is valid only after the user explicitly authorizes that exact reviewer occurrence and requested model, and it always requires interactive confirmation.`
        : "";
    } catch (error) {
      if (generation !== subagentLaunchSlotGeneration) return;
      subagentLaunchSlotRoles = null;
      subagentLaunchSlotSnapshotLoadFailed = true;
      subagentLaunchSlotGuidance = "";
      activeSubagentLaunchSlotRevision = null;
      clearSubagentModelDeviationPermits();
      console.warn(`Web UI subagent launch slots could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function persistToolsState(mode = "explicit") {
    pi.appendEntry(TOOLS_CONFIG_TYPE, mode === "inherit"
      ? { version: 2, mode: "inherit" }
      : { version: 2, mode: "explicit", enabledTools: [...enabledTools] });
  }

  function applyTools() {
    const existing = new Set(allToolNames());
    pi.setActiveTools([...enabledTools].filter((name) => existing.has(name)));
  }

  function restoreToolsFromBranch(ctx, resourceDefaults, model = ctx.model) {
    const directive = branchResourceDirective(lastBranchConfig(ctx, TOOLS_CONFIG_TYPE), "tools");
    toolsPinned = directive.pinned;
    const baseline = runtimeTools();
    const resolved = directive.pinned
      ? { names: directive.names || [], source: "session" }
      : resolveResourceSelection(resourceDefaults, "tools", model?.provider, model?.id, baseline);
    enabledTools = new Set(resolved.names || baseline);
    toolSelectionSource = resolved.source;
    applyTools();
  }

  function toolState() {
    const active = new Set(pi.getActiveTools());
    return {
      pinned: toolsPinned,
      source: toolSelectionSource,
      enabledTools: [...enabledTools],
      tools: pi.getAllTools().map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        enabled: active.has(tool.name),
        sourceInfo: safeSourceInfo(tool.sourceInfo),
      })),
    };
  }

  async function setToolState(ctx, payload) {
    if (payload?.mode === "inherit") {
      persistToolsState("inherit");
      await recomputeResourceState(ctx);
      return toolState();
    }
    const existing = new Set(allToolNames());
    if (Array.isArray(payload.enabledTools)) {
      enabledTools = new Set(normalizeNameList(payload.enabledTools));
    } else if (Array.isArray(payload.disabledTools)) {
      const disabled = new Set(normalizeNameList(payload.disabledTools));
      enabledTools = new Set([...existing].filter((name) => !disabled.has(name)));
    } else {
      throw new Error("Tool update requires enabledTools, disabledTools, or inherit mode");
    }
    toolsPinned = true;
    toolSelectionSource = "session";
    applyTools();
    persistToolsState();
    return toolState();
  }

  function persistSkillsState(mode = "explicit") {
    pi.appendEntry(SKILLS_CONFIG_TYPE, mode === "inherit"
      ? { version: 2, mode: "inherit" }
      : { version: 2, mode: "explicit", enabledSkills: [...(inheritedEnabledSkills || [])] });
  }

  function isSkillEnabled(name) {
    return inheritedEnabledSkills instanceof Set ? inheritedEnabledSkills.has(name) : !disabledSkills.has(name);
  }

  function restoreSkillsFromBranch(ctx, resourceDefaults, model = ctx.model) {
    const directive = branchResourceDirective(lastBranchConfig(ctx, SKILLS_CONFIG_TYPE), "skills");
    skillsPinned = directive.pinned;
    disabledSkills = new Set();
    if (directive.pinned && directive.legacyDisabledNames !== null) {
      inheritedEnabledSkills = null;
      disabledSkills = new Set(directive.legacyDisabledNames);
      skillSelectionSource = "session";
      return;
    }
    const resolved = directive.pinned
      ? { names: directive.names || [], source: "session" }
      : resolveResourceSelection(resourceDefaults, "skills", model?.provider, model?.id, null);
    inheritedEnabledSkills = resolved.names === null ? null : new Set(resolved.names);
    skillSelectionSource = resolved.source;
  }

  function activeModelKey(model) {
    return model?.provider && model?.id ? `${model.provider}\0${model.id}` : "";
  }

  async function recomputeResourceState(ctx, requestedModel = ctx.model) {
    if (ctx?.mode !== "rpc") return false;
    const generation = ++resourceGeneration;
    const requestedKey = activeModelKey(requestedModel);
    let resourceDefaults;
    try {
      resourceDefaults = await readGlobalResourceDefaults();
    } catch (error) {
      console.warn(`Web UI resource defaults could not be read; retaining the last safe resource state: ${error instanceof Error ? error.message : String(error)}`);
      ctx.ui?.notify?.("Resource defaults could not be read; tools and skills remain unchanged.", "error");
      return false;
    }
    if (generation !== resourceGeneration || activeModelKey(ctx.model) !== requestedKey) return false;
    restoreToolsFromBranch(ctx, resourceDefaults, requestedModel);
    restoreSkillsFromBranch(ctx, resourceDefaults, requestedModel);
    return true;
  }

  function skillsFromContext(ctx) {
    const options = ctx.getSystemPromptOptions?.();
    const skills = Array.isArray(options?.skills) ? options.skills : [];
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description || "",
      enabled: isSkillEnabled(skill.name),
      disableModelInvocation: skill.disableModelInvocation === true,
      filePath: skill.filePath,
      sourceInfo: safeSourceInfo(skill.sourceInfo),
    }));
  }

  function skillState(ctx) {
    if (inheritedEnabledSkills === null) {
      const known = new Set(skillsFromContext(ctx).map((skill) => skill.name));
      disabledSkills = new Set([...disabledSkills].filter((name) => known.has(name)));
    }
    return {
      pinned: skillsPinned,
      source: skillSelectionSource,
      enabledSkills: inheritedEnabledSkills instanceof Set
        ? [...inheritedEnabledSkills]
        : skillsFromContext(ctx).filter((skill) => !disabledSkills.has(skill.name)).map((skill) => skill.name),
      skills: skillsFromContext(ctx),
    };
  }

  async function setSkillState(ctx, payload) {
    if (payload?.mode === "inherit") {
      persistSkillsState("inherit");
      await recomputeResourceState(ctx);
      return skillState(ctx);
    }
    const allNames = new Set(skillsFromContext(ctx).map((skill) => skill.name));
    if (Array.isArray(payload.enabledSkills)) {
      inheritedEnabledSkills = new Set(normalizeNameList(payload.enabledSkills));
    } else if (Array.isArray(payload.disabledSkills)) {
      const disabled = new Set(normalizeNameList(payload.disabledSkills));
      inheritedEnabledSkills = new Set([...allNames].filter((name) => !disabled.has(name)));
    } else {
      throw new Error("Skill update requires enabledSkills, disabledSkills, or inherit mode");
    }
    disabledSkills = new Set();
    skillsPinned = true;
    skillSelectionSource = "session";
    persistSkillsState();
    return skillState(ctx);
  }

  function transferAppRunnerContext(ctx, payload) {
    const content = String(payload?.content || "").trimEnd();
    if (!content.trim()) throw new Error("App runner context content is empty");
    const details = payload?.details && typeof payload.details === "object" ? payload.details : {};
    const isIdle = ctx.isIdle();
    pi.sendMessage({
      customType: APP_RUNNER_CONTEXT_TYPE,
      content,
      display: true,
      details,
    }, isIdle ? undefined : { deliverAs: "steer" });
    return {
      customType: APP_RUNNER_CONTEXT_TYPE,
      delivery: isIdle ? "context" : "steer",
      lineCount: Number(details.lineCount || 0) || undefined,
    };
  }

  function dismissSubagentRun(payload = {}) {
    const runId = subagentText(payload.runId, 160);
    if (!runId) throw new Error("Subagent dismiss requires runId");
    const entry = ordinarySubagentRunEntries().find((candidate) => candidate.run?.id === runId);
    if (!entry) {
      const canonicalRunId = canonicalAgentRunId(runId, "run");
      const staleProviderInstances = [...agentRunProviderSnapshots.values()]
        .flatMap((rows) => [...rows.values()])
        .filter((instance) => instance.runId === canonicalRunId && ["done", "failed", "cancelled"].includes(instance.status));
      rememberDismissedHelperAgentRunProjections(staleProviderInstances);
      // Dismiss is idempotent. Force a fresh empty projection so a server that
      // still has the previous terminal snapshot can clear it immediately.
      lastPublishedSubagentSignature = "";
      lastPublishedSubagentAt = 0;
      lastPublishedAgentRunSignature = "";
      lastPublishedAgentRunAt = 0;
      publishSubagentStatus();
      return { runId, dismissed: true, alreadyMissing: true };
    }
    if (entry.run.status === "running") throw new Error(`Cannot dismiss running subagent run: ${runId}`);
    rememberDismissedHelperAgentRunProjections(canonicalInstancesFromPublicRun(entry.run, new Set()));
    entry.runs.delete(entry.key);
    persistRetainedSubagentRuns();
    publishSubagentStatus();
    return { runId, dismissed: true };
  }

  async function cancelSubagentRun(ctx, payload = {}) {
    const runId = subagentText(payload.runId, 160);
    if (!runId) throw new Error("Subagent cancel requires runId");
    const { run } = findTrackedSubagentRun(runId);
    if (run.status !== "running") throw new Error(`Subagent run is already finished: ${runId}`);
    const reason = subagentText(payload.reason, 120) || undefined;
    const note = subagentText(payload.note, 2000) || undefined;
    const rpcMethod = run.source === "foreground" ? "interrupt" : "stop";
    const controlRunId = run.source === "foreground" ? subagentText(run.controlRunId, 160) : run.id;
    if (!controlRunId) throw new Error(`Subagent run is not ready to be cancelled yet: ${runId}`);
    await requestSubagentRpc(rpcMethod, { id: controlRunId });
    finishSubagentRun(run, "cancelled", { reason, note, force: true });
    const agentNames = (Array.isArray(run.agents) ? run.agents : [])
      .map((agent) => subagentAgentName(agent?.name))
      .filter(Boolean)
      .slice(0, 128);
    const content = [
      `The user cancelled subagent run ${run.id} (${agentNames.join(", ") || "subagent"}) from the Web UI.`,
      ...(reason ? [`Reason: ${reason}`] : []),
      ...(note ? [`Note: ${note}`] : []),
      "The run was stopped or interrupted at the user's request and should not be automatically retried without asking.",
    ].join("\n");
    const isIdle = ctx.isIdle();
    pi.sendMessage({
      customType: "webui-subagent-cancelled",
      content,
      display: true,
      details: { runId: run.id, agentNames, reason, note },
    }, isIdle ? undefined : { deliverAs: "steer" });
    publishSubagentStatus();
    return { runId: run.id, state: "cancelled", delivery: isIdle ? "context" : "steer", rpcMethod };
  }

  async function executeAction(action, payload, ctx) {
    switch (action) {
      case "tools-state":
        if (ctx.mode !== "rpc") throw new Error("Web UI resource controls require RPC mode");
        return toolState();
      case "tools-set":
        if (ctx.mode !== "rpc") throw new Error("Web UI resource controls require RPC mode");
        return setToolState(ctx, payload);
      case "skills-state":
        if (ctx.mode !== "rpc") throw new Error("Web UI resource controls require RPC mode");
        return skillState(ctx);
      case "skills-set":
        if (ctx.mode !== "rpc") throw new Error("Web UI resource controls require RPC mode");
        return setSkillState(ctx, payload);
      case "resources-recompute":
        if (ctx.mode !== "rpc") throw new Error("Web UI resource controls require RPC mode");
        if (!(await recomputeResourceState(ctx))) throw new Error("Resource defaults could not be applied; current resources remain unchanged");
        return { tools: toolState(), skills: skillState(ctx) };
      case "sampling-state":
        return samplingState(ctx);
      case "sampling-set":
        return setSamplingParams(ctx, payload);
      case "sampling-reset":
        return resetSamplingParams(ctx);
      case "app-runner-context":
        return transferAppRunnerContext(ctx, payload);
      case "subagent-output":
        return subagentOutputSnapshot(payload);
      case "subagent-dismiss":
        return dismissSubagentRun(payload);
      case "subagent-cancel":
        return cancelSubagentRun(ctx, payload);
      case "queue-remove":
        return removeQueuedPrompt(payload);
      case "queue-mutate":
        return mutateQueuedFollowUp(payload);
      default:
        throw new Error(`Unknown ${HELPER_COMMAND} action: ${action}`);
    }
  }

  pi.registerTool({
    name: "approve_subagent_model_deviation",
    label: "Approve reviewer model deviation",
    description: "Request interactive user confirmation for one short-lived, one-use local permit covering an explicit reviewer model mismatch. The confirmation identifies the exact reviewer occurrence and requested model.",
    promptSnippet: "Request confirmation for one reviewer model deviation",
    promptGuidelines: [
      "Call approve_subagent_model_deviation only after the user explicitly authorizes that exact reviewer occurrence and requested model; never infer authorization from task text or use it merely to bypass a mismatch block. The tool still displays an interactive confirmation and fails closed without UI or on rejection.",
      "The permit is local, expires after 2 minutes, and is consumed by one admitted structured launch or leased into one workflow wrapper.",
    ],
    parameters: SubagentModelDeviationParams,
    async execute(_toolCallId, params) {
      return approveSubagentModelDeviation(params);
    },
  });

  pi.registerCommand(HELPER_COMMAND, {
    description: "Internal Web UI helper for browser-native tools and skills configuration",
    handler: async (args, ctx) => {
      let requestId = "";
      try {
        const request = parseHelperArgs(args);
        requestId = request.requestId;
        const data = await executeAction(request.action, request.payload, ctx);
        ctx.ui.notify(responseMessage({ requestId, ok: true, data }), "info");
      } catch (error) {
        ctx.ui.notify(responseMessage({ requestId, ok: false, error: error instanceof Error ? error.message : String(error) }), "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    resourceRpcActive = ctx.mode === "rpc";
    if (resourceRpcActive) {
      if (runtimeToolBaseline === undefined) enabledTools = new Set(runtimeTools());
      await recomputeResourceState(ctx);
    }
    restoreSamplingParamsFromBranch(ctx);
    await loadSubagentLaunchSlotGuidance(ctx);
    subagentContext = ctx;
    subagentPollGeneration += 1;
    foregroundSubagentRuns.clear();
    asyncSubagentRuns.clear();
    workflowSubagentRuns.clear();
    recoveredSubagentRuns.clear();
    subagentGates.clear();
    resetCanonicalAgentRunState();
    subagentFleetSummary = null;
    restoreRetainedSubagentRuns(ctx);
    lastPublishedSubagentSignature = "";
    lastPublishedSubagentAt = 0;
    publishSubagentStatus();
    scheduleSubagentStatusPoll(subagentPollGeneration, 0);
  });

  pi.on("session_tree", async (_event, ctx) => {
    resourceRpcActive = ctx.mode === "rpc";
    if (resourceRpcActive) await recomputeResourceState(ctx);
    restoreSamplingParamsFromBranch(ctx);
    await loadSubagentLaunchSlotGuidance(ctx);
    subagentContext = ctx;
    subagentPollGeneration += 1;
    foregroundSubagentRuns.clear();
    asyncSubagentRuns.clear();
    workflowSubagentRuns.clear();
    recoveredSubagentRuns.clear();
    subagentGates.clear();
    resetCanonicalAgentRunState();
    subagentFleetSummary = null;
    restoreRetainedSubagentRuns(ctx);
    lastPublishedSubagentSignature = "";
    lastPublishedSubagentAt = 0;
    publishSubagentStatus();
    scheduleSubagentStatusPoll(subagentPollGeneration, 0);
  });

  pi.on("model_select", async (event, ctx) => {
    if (ctx.mode !== "rpc") return;
    resourceRpcActive = true;
    await recomputeResourceState(ctx, event.model);
  });

  pi.on("tool_call", (event) => {
    if (!["subagent", "subagent_gate"].includes(event.toolName)) return;
    const deviations = subagentModelDeviationDescriptors();
    if (!subagentLaunchSlotRoles) {
      if (subagentLaunchSlotSnapshotLoadFailed && launchNeedsLoadedSlotSnapshot(event.toolName, event.input)) {
        return {
          block: true,
          reason: "Reviewer launch policy is unavailable because the WebUI launch-slot snapshot could not be loaded. Reload the active tab after fixing settings before launching reviewers or workflows.",
        };
      }
      return;
    }
    const report = applySubagentLaunchSlotDefaults(event.toolName, event.input, subagentLaunchSlotRoles, { deviations });
    if (report.blocked.length) {
      return { block: true, reason: reviewerModelPolicyBlockReason(report.blocked) };
    }
    const workflowWrapped = report.applied.some((item) => item.location === "workflowScript" && item.reason === "runtime-role-defaults");
    removeSubagentModelDeviationPermits(workflowWrapped
      ? deviations.map((deviation) => deviation.id)
      : report.consumedDeviationIds);
    return undefined;
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "subagent" || event.args?.action) return;
    const id = subagentText(event.toolCallId, 160);
    if (!id) return;
    subagentContext = ctx;
    const workflowProvisional = typeof event.args?.workflowScript === "string" && event.args.workflowScript.trim().length > 0;
    const initialAgents = subagentInitialAgentsFromArgs(event.args).map((agent, index) => ({
      id: `${id}:${index}:${agent.name}`,
      name: agent.name,
      status: "running",
      index,
      model: agent.model,
      thinking: agent.thinking,
      nested: false,
    }));
    if (!initialAgents.length && workflowProvisional) {
      initialAgents.push({ id: `${id}:0:workflow`, name: "workflow", status: "running", index: 0, nested: false });
    }
    if (!initialAgents.length) return;
    foregroundSubagentRuns.set(id, {
      id,
      source: "foreground",
      mode: Array.isArray(event.args?.chain) ? "chain" : Array.isArray(event.args?.tasks) ? "parallel" : "single",
      status: "running",
      startedAt: Date.now(),
      controlRunId: undefined,
      workflowProvisional,
      agents: initialAgents,
    });
    publishSubagentStatus();
  });

  pi.on("tool_execution_update", (event, ctx) => {
    if (event.toolName !== "subagent") return;
    const id = subagentText(event.toolCallId, 160);
    if (!id) return;
    const details = event.partialResult?.details || event.result?.details;
    const controlRunId = subagentText(details?.runId, 160);
    const agents = subagentRunningAgentsFromDetails(details, controlRunId || id);
    let run = foregroundSubagentRuns.get(id);
    if (!run && controlRunId && agents.length) {
      const recoveredMatches = claimRecoveredSubagentMatches(agents);
      const startedAt = recoveredMatches
        .map((match) => match?.startedAt)
        .filter(Number.isFinite)
        .sort((left, right) => left - right)[0];
      run = {
        id: controlRunId,
        source: "foreground",
        mode: subagentMode(details?.mode),
        status: "running",
        startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
        controlRunId,
        workflowProvisional: false,
        agents: agents.map((agent, index) => ({
          ...recoveredMatches[index]?.agent,
          ...agent,
          model: agent.model || recoveredMatches[index]?.agent?.model,
          thinking: agent.thinking || recoveredMatches[index]?.agent?.thinking,
        })),
      };
      foregroundSubagentRuns.set(id, run);
    }
    if (!run || run.status !== "running") return;
    subagentContext = ctx;
    if (agents.length) {
      run.workflowProvisional = false;
      const runningAgents = agents.map((agent) => {
        const previous = run.agents.find((candidate) => candidate.index === agent.index && candidate.name === agent.name);
        return {
          ...previous,
          ...agent,
          status: "running",
          model: agent.model || previous?.model,
          thinking: agent.thinking || previous?.thinking,
        };
      });
      const completedAgents = run.agents
        .filter((candidate) => !runningAgents.some((agent) => agent.index === candidate.index && agent.name === candidate.name))
        .map((agent) => ({ ...agent, status: agent.status === "running" ? "done" : agent.status }));
      run.agents = [...completedAgents, ...runningAgents];
    }
    if (controlRunId) {
      run.controlRunId = controlRunId;
      run.id = controlRunId;
    }
    run.mode = subagentMode(details?.mode, run.mode);
    publishSubagentStatus();
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "subagent") return;
    const toolCallId = subagentText(event.toolCallId, 160);
    const entry = [...foregroundSubagentRuns.entries()].find(([key, candidate]) => candidate?.id === toolCallId || key === toolCallId);
    const run = entry?.[1];
    if (run?.workflowProvisional) foregroundSubagentRuns.delete(entry[0]);
    else if (run) finishSubagentRun(run, event.isError === true || event.result?.isError === true ? "failed" : "done");
    publishSubagentStatus();
  });

  pi.on("session_shutdown", () => {
    resourceRpcActive = false;
    resourceGeneration += 1;
    subagentContext = null;
    subagentLaunchSlotGuidance = "";
    subagentLaunchSlotRoles = null;
    subagentLaunchSlotSnapshotLoadFailed = false;
    activeSubagentLaunchSlotRevision = null;
    subagentLaunchSlotGeneration += 1;
    clearSubagentModelDeviationPermits();
    subagentPollGeneration += 1;
    clearTimeout(subagentPollTimer);
    subagentPollTimer = null;
    foregroundSubagentRuns.clear();
    asyncSubagentRuns.clear();
    workflowSubagentRuns.clear();
    recoveredSubagentRuns.clear();
    subagentGates.clear();
    resetCanonicalAgentRunState();
    subagentFleetSummary = null;
    for (const unsubscribe of subagentEventUnsubscribers) unsubscribe();
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (Object.keys(sessionSamplingParams).length === 0) return undefined;
    return applySupportedSamplingParameters(event.payload, ctx.model, sessionSamplingParams, {
      thinkingLevel: ctx.thinkingLevel,
    });
  });

  pi.on("input", async (event, ctx) => {
    if (!resourceRpcActive || ctx.mode !== "rpc") return { action: "continue" };
    const match = String(event.text || "").trim().match(/^\/skill:([^\s]+)/i);
    if (!match) return { action: "continue" };
    const skillName = match[1];
    if (isSkillEnabled(skillName)) return { action: "continue" };
    ctx.ui.notify(`Skill /skill:${skillName} is disabled in the Web UI /skills selector.`, "warning");
    return { action: "handled" };
  });

  pi.on("before_agent_start", async (event) => {
    let nextPrompt = event.systemPrompt;
    let changed = false;
    if (resourceRpcActive && (disabledSkills.size !== 0 || inheritedEnabledSkills !== null)) {
      const allSkills = Array.isArray(event.systemPromptOptions?.skills) ? event.systemPromptOptions.skills : [];
      const disabledNames = allSkills.filter((skill) => !isSkillEnabled(skill.name)).map((skill) => skill.name);
      const filteredSkills = allSkills.filter((skill) => isSkillEnabled(skill.name) && skill.disableModelInvocation !== true);
      if (disabledNames.length || filteredSkills.length !== allSkills.length) {
        nextPrompt = replaceAvailableSkillsSection(nextPrompt, filteredSkills);
        for (const name of disabledNames) nextPrompt = nextPrompt.replace(skillBlockPattern(name), "");
        changed = true;
      }
    }
    if (subagentLaunchSlotGuidance) {
      nextPrompt = `${String(nextPrompt || "").trimEnd()}\n\n${subagentLaunchSlotGuidance}\n`;
      changed = true;
    }
    return changed ? { systemPrompt: nextPrompt } : undefined;
  });
}
