import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { AgentSession, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { readWebuiSettings } from "./lib/git-workflow-preferences.mjs";
import {
  formatSubagentLaunchSlotGuidance,
  resolveSubagentLaunchSlotProjectKey,
  subagentLaunchSlotScopeEntry,
} from "./lib/subagent-launch-slots.mjs";
import { SUBAGENT_GATE_UPDATE_EVENT } from "./lib/subagent-gate.mjs";

const HELPER_COMMAND = "webui-helper";
const RESPONSE_PREFIX = "__PI_WEBUI_HELPER_RESPONSE__:";
const TOOLS_CONFIG_TYPE = "webui-tools-config";
const SKILLS_CONFIG_TYPE = "webui-skills-config";
const APP_RUNNER_CONTEXT_TYPE = "webui-app-runner-output";
const WEBUI_SUBAGENTS_STATUS_KEY = "webui-subagents";
const WEBUI_SUBAGENTS_PAYLOAD_PREFIX = "PI_WEBUI_SUBAGENTS_V1 ";
const SUBAGENT_RPC_VERSION = 1;
const SUBAGENT_RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const SUBAGENT_RPC_READY_EVENT = "subagents:rpc:v1:ready";
const SUBAGENT_RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";
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
const SUBAGENT_OUTPUT_LINE_LIMIT = 120;
const SUBAGENT_OUTPUT_LINE_LENGTH = 1000;
const SUBAGENT_TRANSCRIPT_TAIL_BYTES = 512 * 1024;

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
    steering: Array.from(session?.getSteeringMessages?.() || []).map((item) => String(item || "")).filter((item) => item.trim()),
    followUp: Array.from(session?.getFollowUpMessages?.() || []).map((item) => String(item || "")).filter((item) => item.trim()),
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

function parseSubagentStatusText(text, previousRuns = new Map()) {
  const runs = [];
  let current = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const runMatch = rawLine.match(/^-\s+([^|]+?)\s+\|\s+(queued|running)\b(.*)$/i);
    if (runMatch) {
      const id = subagentText(runMatch[1], 160);
      const segments = rawLine.split(" | ").map((part) => part.trim());
      const mode = segments.map((part) => part.match(/^(single|parallel|chain)\b/)?.[1]).find(Boolean);
      const previous = previousRuns.get(id);
      current = {
        id,
        source: "async",
        mode: subagentMode(mode, previous?.mode),
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
  return runs.filter((run) => run.status === "running" && run.agents.length > 0);
}

export default function webuiRpcHelper(pi) {
  let enabledTools = new Set();
  let disabledSkills = new Set();
  let inheritedEnabledSkills = null;
  let subagentLaunchSlotGuidance = "";
  let subagentContext = null;
  let subagentBridgeAvailable = false;
  let subagentPollTimer = null;
  let subagentPollGeneration = 0;
  let subagentStatusRequestInFlight = false;
  let lastPublishedSubagentSignature = "";
  const asyncSubagentRuns = new Map();
  const foregroundSubagentRuns = new Map();
  const workflowSubagentRuns = new Map();
  const subagentGates = new Map();

  function publicSubagentRuns() {
    const ordinaryRuns = [...foregroundSubagentRuns.values(), ...asyncSubagentRuns.values()]
      .map((run) => ({
        id: subagentText(run.id, 160),
        source: run.source === "foreground" ? "foreground" : "async",
        mode: subagentMode(run.mode),
        status: "running",
        startedAt: Number.isFinite(run.startedAt) ? run.startedAt : Date.now(),
        agents: (Array.isArray(run.agents) ? run.agents : [])
          .filter((agent) => agent?.status === "running" && subagentAgentName(agent.name))
          .slice(0, 128)
          .map((agent, index) => ({
            id: subagentText(agent.id || `${run.id}:${index}`, 240),
            name: subagentAgentName(agent.name),
            status: "running",
            index: Number.isInteger(agent.index) ? agent.index : index,
            currentTool: subagentText(agent.currentTool, 120) || undefined,
            activityState: subagentText(agent.activityState, 80) || undefined,
            model: subagentModel(agent.model) || undefined,
            thinking: subagentThinking(agent.thinking) || subagentThinkingFromModel(agent.model) || undefined,
            nested: agent.nested === true,
          })),
      }));
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
    return [...ordinaryRuns, ...workflowRuns]
      .filter((run) => run.id && run.agents.length > 0)
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

  function publishSubagentStatus() {
    if (!subagentContext?.hasUI) return;
    const runs = publicSubagentRuns();
    const gates = publicSubagentGates();
    const snapshot = { version: 1, available: subagentBridgeAvailable, runs, gates };
    const signature = JSON.stringify(snapshot);
    if (signature === lastPublishedSubagentSignature) return;
    lastPublishedSubagentSignature = signature;
    try {
      subagentContext.ui.setStatus(WEBUI_SUBAGENTS_STATUS_KEY, `${WEBUI_SUBAGENTS_PAYLOAD_PREFIX}${JSON.stringify({ ...snapshot, updatedAt: Date.now() })}`);
    } catch {
      // The old context may become stale while Pi replaces a session.
    }
  }

  function requestSubagentStatus(params = {}) {
    const requestId = `webui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      let unsubscribe;
      const timeout = setTimeout(() => {
        if (typeof unsubscribe === "function") unsubscribe();
        reject(new Error("Timed out waiting for pi-subagents status RPC"));
      }, SUBAGENT_STATUS_RPC_TIMEOUT_MS);
      unsubscribe = pi.events.on(`${SUBAGENT_RPC_REPLY_PREFIX}${requestId}`, (reply) => {
        clearTimeout(timeout);
        if (typeof unsubscribe === "function") unsubscribe();
        if (reply?.success === false) reject(new Error(reply.error?.message || "pi-subagents status RPC failed"));
        else resolve(reply?.data || {});
      });
      pi.events.emit(SUBAGENT_RPC_REQUEST_EVENT, {
        version: SUBAGENT_RPC_VERSION,
        requestId,
        method: "status",
        params,
        source: { extension: "pi-package-webui" },
      });
    });
  }

  function findTrackedSubagent(runId, agentId) {
    const run = [...foregroundSubagentRuns.values(), ...asyncSubagentRuns.values()].find((candidate) => candidate?.id === runId);
    if (!run) throw new Error(`Running subagent run not found: ${runId}`);
    const agent = (Array.isArray(run.agents) ? run.agents : []).find((candidate) => candidate?.id === agentId);
    if (!agent) throw new Error(`Running subagent not found: ${agentId}`);
    return { run, agent };
  }

  function findWorkflowSubagent(runId, agentId) {
    const run = workflowSubagentRuns.get(runId);
    if (!run) return undefined;
    const agent = run.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Running subagent not found: ${agentId}`);
    return { run, agent };
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
        // Workflow snapshots do not carry reasoning data.
        thinking: undefined,
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
  }

  async function enrichAsyncSubagentRun(run) {
    const statusByDir = new Map();
    for (const agent of Array.isArray(run?.agents) ? run.agents : []) {
      await enrichAsyncSubagentAgent(run, agent, statusByDir);
    }
  }

  function subagentOutputSnapshotFromAgent(run, agent, patch = {}) {
    return {
      version: 1,
      runId: run.id,
      source: run.source === "foreground" ? "foreground" : "async",
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
        model: subagentModel(patch.model || agent.model) || undefined,
        thinking: subagentThinking(patch.thinking || agent.thinking) || undefined,
        recentTools: subagentRecentTools(patch.recentTools || agent.recentTools),
        recentOutput: subagentOutputLines(patch.recentOutput || agent.recentOutput),
        transcript: Array.isArray(patch.transcript) ? patch.transcript : [],
        error: subagentText(patch.error, 1000) || undefined,
      },
    };
  }

  async function subagentOutputSnapshot(payload = {}) {
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
    if (run.source === "foreground") return subagentOutputSnapshotFromAgent(run, agent);

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
      const transcriptOutput = subagentTranscriptOutput(step.sessionFile || (steps.length === 1 ? status.sessionFile : undefined));
      return subagentOutputSnapshotFromAgent(run, agent, {
        ...step,
        recentOutput: transcriptOutput.recentOutput.length ? transcriptOutput.recentOutput : step.recentOutput,
        transcript: transcriptOutput.transcript,
        status: step.status || status.state,
        updatedAt: step.lastActivityAt || status.lastUpdate,
        tokens: Number.isFinite(step.tokens?.total) ? step.tokens.total : step.tokens,
      });
    } catch (error) {
      return subagentOutputSnapshotFromAgent(run, agent, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function refreshSubagentStatus() {
    if (subagentStatusRequestInFlight) return;
    subagentStatusRequestInFlight = true;
    try {
      const data = await requestSubagentStatus();
      subagentBridgeAvailable = true;
      const parsedRuns = parseSubagentStatusText(data?.text, asyncSubagentRuns);
      const nextIds = new Set(parsedRuns.map((run) => run.id));
      for (const id of asyncSubagentRuns.keys()) {
        const run = asyncSubagentRuns.get(id);
        if (!nextIds.has(id) && Date.now() - Number(run?.eventSeenAt || 0) > SUBAGENT_STATUS_POLL_MS * 2) asyncSubagentRuns.delete(id);
      }
      for (const run of parsedRuns) {
        const previous = asyncSubagentRuns.get(run.id);
        const previousAgents = Array.isArray(previous?.agents) ? previous.agents : [];
        const merged = {
          ...previous,
          ...run,
          eventSeenAt: previous?.eventSeenAt || Date.now(),
          agents: run.agents.map((agent) => ({
            ...previousAgents.find((candidate) => candidate.index === agent.index && candidate.name === agent.name),
            ...agent,
          })),
        };
        await enrichAsyncSubagentRun(merged);
        asyncSubagentRuns.set(run.id, merged);
      }
      publishSubagentStatus();
    } catch {
      // The optional pi-subagents extension may not be loaded in this tab.
    } finally {
      subagentStatusRequestInFlight = false;
    }
  }

  function scheduleSubagentStatusPoll(generation = subagentPollGeneration, delay = SUBAGENT_STATUS_POLL_MS) {
    clearTimeout(subagentPollTimer);
    subagentPollTimer = setTimeout(async () => {
      if (generation !== subagentPollGeneration || !subagentContext) return;
      await refreshSubagentStatus();
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
    pi.events.on(SUBAGENT_RPC_READY_EVENT, () => {
      subagentBridgeAvailable = true;
      publishSubagentStatus();
      void refreshSubagentStatus();
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
      foregroundSubagentRuns.clear();
      asyncSubagentRuns.set(id, {
        id,
        source: "async",
        mode: subagentMode(info.mode, Array.isArray(info.chain) ? "chain" : "single"),
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
      if (id) asyncSubagentRuns.delete(id);
      publishSubagentStatus();
    }),
    pi.events.on(SUBAGENT_GATE_UPDATE_EVENT, (value) => {
      const id = subagentText(value?.id, 160);
      if (!id) return;
      subagentGates.set(id, { ...value, id });
      while (subagentGates.size > 32) subagentGates.delete(subagentGates.keys().next().value);
      publishSubagentStatus();
    }),
  ].filter((unsubscribe) => typeof unsubscribe === "function");

  function allToolNames() {
    return pi.getAllTools().map((tool) => tool.name);
  }

  async function readGlobalResourceDefaults() {
    try {
      return (await readWebuiSettings()).resourceDefaults;
    } catch (error) {
      console.warn(`Web UI resource defaults could not be read: ${error instanceof Error ? error.message : String(error)}`);
      return { tools: { enabledTools: null }, skills: { enabledSkills: null } };
    }
  }

  async function loadSubagentLaunchSlotGuidance(ctx) {
    try {
      const settings = await readWebuiSettings();
      const projectKey = await resolveSubagentLaunchSlotProjectKey(ctx?.cwd);
      const effective = subagentLaunchSlotScopeEntry(settings.subagentLaunchSlots, "project", projectKey);
      subagentLaunchSlotGuidance = formatSubagentLaunchSlotGuidance(effective.entry.roles);
    } catch (error) {
      subagentLaunchSlotGuidance = "";
      console.warn(`Web UI subagent launch slots could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function persistToolsState() {
    pi.appendEntry(TOOLS_CONFIG_TYPE, { enabledTools: [...enabledTools] });
  }

  function applyTools() {
    const existing = new Set(allToolNames());
    pi.setActiveTools([...enabledTools].filter((name) => existing.has(name)));
  }

  function restoreToolsFromBranch(ctx, globalDefaults) {
    const saved = lastBranchConfig(ctx, TOOLS_CONFIG_TYPE)?.enabledTools;
    const inherited = globalDefaults?.tools?.enabledTools;
    const selected = Array.isArray(saved) ? saved : inherited;
    if (Array.isArray(selected)) {
      const existing = new Set(allToolNames());
      enabledTools = new Set(normalizeNameList(selected).filter((name) => existing.has(name)));
      applyTools();
      return;
    }
    enabledTools = new Set(pi.getActiveTools());
  }

  function toolState() {
    const active = new Set(pi.getActiveTools());
    enabledTools = new Set([...active]);
    return {
      tools: pi.getAllTools().map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        enabled: active.has(tool.name),
        sourceInfo: safeSourceInfo(tool.sourceInfo),
      })),
    };
  }

  function setToolState(payload) {
    const existing = new Set(allToolNames());
    if (Array.isArray(payload.enabledTools)) {
      enabledTools = new Set(normalizeNameList(payload.enabledTools).filter((name) => existing.has(name)));
    } else if (Array.isArray(payload.disabledTools)) {
      const disabled = new Set(normalizeNameList(payload.disabledTools));
      enabledTools = new Set([...existing].filter((name) => !disabled.has(name)));
    } else {
      throw new Error("Tool update requires enabledTools or disabledTools");
    }
    applyTools();
    persistToolsState();
    return toolState();
  }

  function persistSkillsState() {
    pi.appendEntry(SKILLS_CONFIG_TYPE, { disabledSkills: [...disabledSkills] });
  }

  function isSkillEnabled(name) {
    return inheritedEnabledSkills instanceof Set ? inheritedEnabledSkills.has(name) : !disabledSkills.has(name);
  }

  function restoreSkillsFromBranch(ctx, globalDefaults) {
    const saved = lastBranchConfig(ctx, SKILLS_CONFIG_TYPE)?.disabledSkills;
    if (Array.isArray(saved)) {
      inheritedEnabledSkills = null;
      disabledSkills = new Set(normalizeNameList(saved));
      return;
    }
    const inherited = globalDefaults?.skills?.enabledSkills;
    inheritedEnabledSkills = Array.isArray(inherited) ? new Set(normalizeNameList(inherited)) : null;
    disabledSkills = new Set();
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
    return { skills: skillsFromContext(ctx) };
  }

  function setSkillState(ctx, payload) {
    const allNames = new Set(skillsFromContext(ctx).map((skill) => skill.name));
    inheritedEnabledSkills = null;
    if (Array.isArray(payload.enabledSkills)) {
      const enabled = new Set(normalizeNameList(payload.enabledSkills));
      disabledSkills = new Set([...allNames].filter((name) => !enabled.has(name)));
    } else if (Array.isArray(payload.disabledSkills)) {
      disabledSkills = new Set(normalizeNameList(payload.disabledSkills).filter((name) => allNames.has(name)));
    } else {
      throw new Error("Skill update requires enabledSkills or disabledSkills");
    }
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

  async function executeAction(action, payload, ctx) {
    switch (action) {
      case "tools-state":
        return toolState();
      case "tools-set":
        return setToolState(payload);
      case "skills-state":
        return skillState(ctx);
      case "skills-set":
        return setSkillState(ctx, payload);
      case "app-runner-context":
        return transferAppRunnerContext(ctx, payload);
      case "subagent-output":
        return subagentOutputSnapshot(payload);
      case "queue-remove":
        return removeQueuedPrompt(payload);
      default:
        throw new Error(`Unknown ${HELPER_COMMAND} action: ${action}`);
    }
  }

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
    const globalDefaults = await readGlobalResourceDefaults();
    restoreToolsFromBranch(ctx, globalDefaults);
    restoreSkillsFromBranch(ctx, globalDefaults);
    await loadSubagentLaunchSlotGuidance(ctx);
    subagentContext = ctx;
    subagentPollGeneration += 1;
    foregroundSubagentRuns.clear();
    asyncSubagentRuns.clear();
    workflowSubagentRuns.clear();
    subagentGates.clear();
    lastPublishedSubagentSignature = "";
    publishSubagentStatus();
    scheduleSubagentStatusPoll(subagentPollGeneration, 0);
  });

  pi.on("session_tree", async (_event, ctx) => {
    const globalDefaults = await readGlobalResourceDefaults();
    restoreToolsFromBranch(ctx, globalDefaults);
    restoreSkillsFromBranch(ctx, globalDefaults);
    subagentContext = ctx;
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "subagent" || event.args?.action) return;
    const id = subagentText(event.toolCallId, 160);
    if (!id) return;
    subagentContext = ctx;
    const initialAgents = subagentInitialAgentsFromArgs(event.args).map((agent, index) => ({
      id: `${id}:${index}:${agent.name}`,
      name: agent.name,
      status: "running",
      index,
      model: agent.model,
      thinking: agent.thinking,
      nested: false,
    }));
    if (!initialAgents.length) return;
    foregroundSubagentRuns.set(id, {
      id,
      source: "foreground",
      mode: Array.isArray(event.args?.chain) ? "chain" : Array.isArray(event.args?.tasks) ? "parallel" : "single",
      status: "running",
      startedAt: Date.now(),
      agents: initialAgents,
    });
    publishSubagentStatus();
  });

  pi.on("tool_execution_update", (event, ctx) => {
    if (event.toolName !== "subagent") return;
    const id = subagentText(event.toolCallId, 160);
    const run = foregroundSubagentRuns.get(id);
    if (!run) return;
    subagentContext = ctx;
    const details = event.partialResult?.details || event.result?.details;
    const agents = subagentRunningAgentsFromDetails(details, details?.runId || id);
    if (agents.length) {
      run.agents = agents.map((agent) => {
        const previous = run.agents.find((candidate) => candidate.index === agent.index && candidate.name === agent.name);
        return {
          ...previous,
          ...agent,
          model: agent.model || previous?.model,
          thinking: agent.thinking || previous?.thinking,
        };
      });
    }
    if (details?.runId) run.id = subagentText(details.runId, 160);
    run.mode = subagentMode(details?.mode, run.mode);
    publishSubagentStatus();
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "subagent") return;
    foregroundSubagentRuns.delete(subagentText(event.toolCallId, 160));
    publishSubagentStatus();
  });

  pi.on("session_shutdown", () => {
    subagentContext = null;
    subagentLaunchSlotGuidance = "";
    subagentPollGeneration += 1;
    clearTimeout(subagentPollTimer);
    subagentPollTimer = null;
    foregroundSubagentRuns.clear();
    asyncSubagentRuns.clear();
    workflowSubagentRuns.clear();
    subagentGates.clear();
    for (const unsubscribe of subagentEventUnsubscribers) unsubscribe();
  });

  pi.on("input", async (event, ctx) => {
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
    if (disabledSkills.size !== 0 || inheritedEnabledSkills !== null) {
      const allSkills = Array.isArray(event.systemPromptOptions?.skills) ? event.systemPromptOptions.skills : [];
      const disabledNames = allSkills.filter((skill) => !isSkillEnabled(skill.name)).map((skill) => skill.name);
      if (disabledNames.length) {
        const filteredSkills = allSkills.filter((skill) => isSkillEnabled(skill.name));
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
