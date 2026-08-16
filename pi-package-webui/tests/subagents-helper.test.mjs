import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import webuiRpcHelper from "../webui-rpc-helper.mjs";
import { defaultSubagentLaunchSlotRoles } from "../lib/subagent-launch-slots.mjs";

class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(name, handler) {
    const handlers = this.handlers.get(name) || new Set();
    handlers.add(handler);
    this.handlers.set(name, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.handlers.delete(name);
    };
  }

  emit(name, value) {
    for (const handler of [...(this.handlers.get(name) || [])]) handler(value);
  }
}

const bus = new EventBus();
const extensionHandlers = new Map();
const registeredCommands = new Map();
const statuses = [];
const notifications = [];
const sentMessages = [];
const subagentRpcRequests = [];
let branchEntries = [];
let idle = true;
let subagentStatusRequestCount = 0;
let subagentRpcReplyHook = null;
let setStatusFailures = 0;
const pi = {
  events: bus,
  on(name, handler) {
    const handlers = extensionHandlers.get(name) || [];
    handlers.push(handler);
    extensionHandlers.set(name, handlers);
  },
  registerCommand(name, command) { registeredCommands.set(name, command); },
  getAllTools() { return []; },
  getActiveTools() { return []; },
  setActiveTools() {},
  appendEntry(customType, data) { branchEntries.push({ type: "custom", customType, data }); },
  sendMessage(message, options) { sentMessages.push({ message, options }); },
};

const ctx = {
  mode: "rpc",
  hasUI: true,
  cwd: "/tmp/subagent-helper-test",
  modelRegistry: {
    getAvailable() {
      return [
        { provider: "anthropic", id: "claude-opus-4-8", contextWindow: 200_000 },
        { provider: "openai-codex", id: "gpt-5.6-terra", contextWindow: 128_000 },
      ];
    },
  },
  sessionManager: {
    getBranch() { return branchEntries; },
  },
  isIdle() { return idle; },
  getSystemPromptOptions() {
    return {
      skills: [
        { name: "repo-explorer", description: "Inspect repository context", filePath: "/tmp/repo-explorer/SKILL.md" },
        { name: "code-security", description: "Review code security", filePath: "/tmp/code-security/SKILL.md" },
      ],
    };
  },
  ui: {
    setStatus(key, text) {
      if (setStatusFailures > 0) {
        setStatusFailures -= 1;
        throw new Error("simulated status delivery failure");
      }
      statuses.push({ key, text });
    },
    notify(message, type) {
      notifications.push({ message, type });
    },
  },
};

const asyncRunDir = await mkdtemp(path.join(tmpdir(), "pi-webui-subagent-output-test-"));
const settingsFile = path.join(asyncRunDir, "webui-settings.json");
const initialLaunchRoles = defaultSubagentLaunchSlotRoles();
initialLaunchRoles.reviewer[0] = { id: "reviewer:base", model: "fake/reviewer", thinking: "high" };
await writeFile(settingsFile, `${JSON.stringify({
  version: 5,
  resourceDefaults: { tools: { enabledTools: null }, skills: { enabledSkills: ["repo-explorer"] } },
  subagentLaunchSlots: { version: 1, user: { roles: initialLaunchRoles }, projects: {} },
}, null, 2)}\n`);
process.env.PI_WEBUI_SETTINGS_FILE = settingsFile;
const asyncSessionFile = path.join(asyncRunDir, "reviewer-session.jsonl");
await writeFile(asyncSessionFile, [
  JSON.stringify({ type: "custom", customType: "stats_initial_prompt_estimate", timestamp: "2026-07-19T11:59:59.000Z", data: { actualInjectedTokens: 1234, privatePrompt: "must not leave the child session" } }),
  JSON.stringify({ type: "message", timestamp: "2026-07-19T12:00:00.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checking structured transcript extraction" }, { type: "text", text: "REVIEWER STREAM 1 OF 18" }, { type: "toolCall", id: "review-call", name: "bash", arguments: { command: "sleep 5" } }, { type: "text", text: "Review complete." }] } }),
  JSON.stringify({ type: "message", timestamp: "2026-07-19T12:00:01.000Z", message: { role: "toolResult", toolCallId: "review-call", toolName: "bash", isError: false, content: [{ type: "text", text: "(no output)\nreviewer tool output line" }] } }),
  JSON.stringify({ type: "message", timestamp: "2026-07-19T12:00:02.000Z", message: { role: "assistant", timestamp: "2026-07-19T12:00:00.000Z", provider: "anthropic", model: "claude-opus-4-8", usage: { input: 100, output: 40, cacheRead: 20, cacheWrite: 5 }, content: [] } }),
  JSON.stringify({ type: "message", timestamp: "2026-07-19T12:00:06.000Z", message: { role: "assistant", timestamp: "2026-07-19T12:00:03.000Z", provider: "anthropic", model: "claude-opus-4-8", usage: { input: 200, output: 60, cacheRead: 30, cacheWrite: 10 }, content: [] } }),
  "",
].join("\n"));
const asyncStatusFile = path.join(asyncRunDir, "status.json");
await writeFile(asyncStatusFile, JSON.stringify({
  runId: "run-a",
  mode: "parallel",
  state: "running",
  startedAt: Date.now() - 1000,
  lastUpdate: Date.now(),
  steps: [
    { agent: "reviewer", status: "running", sessionFile: asyncSessionFile, recentOutput: [], currentTool: "bash", currentToolArgs: "sleep 5", model: "anthropic/claude-opus-4-8:high", thinking: "high" },
    { agent: "reviewer", status: "running", model: "openai-codex/gpt-5.6-sol", thinking: "high" },
  ],
}));
const gateAsyncRunDir = await mkdtemp(path.join(asyncRunDir, "gate-"));
const gateSessionFile = path.join(gateAsyncRunDir, "scout-session.jsonl");
await writeFile(gateSessionFile, `${JSON.stringify({
  type: "message",
  timestamp: "2026-07-19T12:00:10.000Z",
  message: { role: "assistant", content: [{ type: "text", text: "Gate child output is live." }] },
})}\n`);
await writeFile(path.join(gateAsyncRunDir, "status.json"), JSON.stringify({
  runId: "recovered-gate-run",
  mode: "single",
  state: "running",
  startedAt: Date.now() - 500,
  lastUpdate: Date.now(),
  steps: [{ agent: "scout", status: "running", sessionFile: gateSessionFile, currentTool: "read", model: "openai-codex/gpt-5.6-terra:xhigh", thinking: "xhigh" }],
}));

const statusText = `Active async runs: 2

- run-a | running | active | parallel [fresh] | 2/2 running | ~/repo
  1. reviewer [fresh] | running | tool read
  2. reviewer [fresh] | running | tool grep

- run-b | running | active | chain [mixed] | step 2/2 | ~/repo
  1. planner [fresh] | completed
  2. [Implementation] Apply fixes (worker) [fork] | running | tool edit
    ↳ nested-oracle [nested-1] running | tool grep`;

webuiRpcHelper(pi);
const unsubscribeRpc = bus.on("subagents:rpc:v1:request", (request) => {
  subagentRpcRequests.push(request);
  subagentStatusRequestCount += 1;
  const text = request.params?.id === "run-a"
    ? `Run: run-a\nState: running\nMode: parallel\nDir: ${asyncRunDir}`
    : request.params?.id === "recovered-gate-run"
      ? `Run: recovered-gate-run\nState: running\nMode: single\nDir: ${gateAsyncRunDir}`
      : statusText;
  if (subagentRpcReplyHook?.(request) === true) return;
  bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
    version: 1,
    requestId: request.requestId,
    method: request.method,
    success: true,
    data: { text, details: { mode: "single", results: [] } },
  });
});

for (const handler of extensionHandlers.get("session_start") || []) await handler({ reason: "startup" }, ctx);
const beforeAgentStart = (extensionHandlers.get("before_agent_start") || [])[0];
assert.ok(beforeAgentStart, "helper should register before_agent_start guidance");
const promptWithSkills = [
  "Base system prompt.",
  "The following skills provide specialized capabilities:",
  "<available_skills>",
  "  <skill>",
  "    <name>repo-explorer</name>",
  "  </skill>",
  "  <skill>",
  "    <name>code-security</name>",
  "  </skill>",
  "</available_skills>",
].join("\n");
const initialGuidance = await beforeAgentStart({ systemPrompt: promptWithSkills, systemPromptOptions: ctx.getSystemPromptOptions() });
assert.match(initialGuidance?.systemPrompt || "", /reviewer slot 1: agent=reviewer model=fake\/reviewer:high/, "session_start should cache effective launch-slot guidance");
assert.doesNotMatch(initialGuidance?.systemPrompt || "", /code-security/, "launch-slot guidance must compose with disabled-skill filtering");
const changedLaunchRoles = defaultSubagentLaunchSlotRoles();
changedLaunchRoles.reviewer[0] = { id: "reviewer:base", model: "fake/changed", thinking: "high" };
await writeFile(settingsFile, `${JSON.stringify({
  version: 5,
  resourceDefaults: { tools: { enabledTools: null }, skills: { enabledSkills: ["repo-explorer"] } },
  subagentLaunchSlots: { version: 1, user: { roles: changedLaunchRoles }, projects: {} },
}, null, 2)}\n`);
const cachedGuidance = await beforeAgentStart({ systemPrompt: "Base system prompt.", systemPromptOptions: ctx.getSystemPromptOptions() });
assert.match(cachedGuidance?.systemPrompt || "", /fake\/reviewer:high/, "a settings save must not mutate the active helper snapshot");
assert.doesNotMatch(cachedGuidance?.systemPrompt || "", /fake\/changed:high/);
for (let attempt = 0; attempt < 20 && !statuses.some((entry) => entry.text?.startsWith("PI_WEBUI_SUBAGENTS_V1 ") && entry.text.includes("run-a")); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function latestPayload() {
  const entry = statuses.filter((item) => item.key === "webui-subagents").at(-1);
  assert.ok(entry, "helper should publish the internal WebUI subagent status");
  assert.match(entry.text, /^PI_WEBUI_SUBAGENTS_V1 /);
  return JSON.parse(entry.text.slice("PI_WEBUI_SUBAGENTS_V1 ".length));
}

/** v1 delivery accounting must stay independent of the separate canonical v2 status key. */
function legacyStatusCount() {
  return statuses.filter((item) => item.key === "webui-subagents").length;
}

function latestCanonicalPayload() {
  const entry = statuses.filter((item) => item.key === "webui-subagents-v2").at(-1);
  assert.ok(entry, "helper should publish the canonical WebUI agent-run status");
  assert.match(entry.text, /^PI_WEBUI_SUBAGENTS_V2 /);
  return JSON.parse(entry.text.slice("PI_WEBUI_SUBAGENTS_V2 ".length));
}

function helperResponse(requestId) {
  const notice = notifications.findLast((entry) => entry.message.startsWith("__PI_WEBUI_HELPER_RESPONSE__:")
    && JSON.parse(entry.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length)).requestId === requestId);
  assert.ok(notice, `helper action ${requestId} should return a response notification`);
  return JSON.parse(notice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
}

let payload = latestPayload();
assert.equal(payload.available, true, "successful pi-subagents RPC should mark status available");
assert.deepEqual(payload.runs.map((run) => run.id), ["run-a", "run-b"]);
assert.deepEqual(payload.runs.map((run) => run.mode), ["parallel", "chain"], "async overview should ignore fleet context badges when parsing run modes");
assert.deepEqual(payload.runs[0].agents.map((agent) => [agent.name, agent.currentTool]), [["reviewer", "read"], ["reviewer", "grep"]], "async overview should ignore fleet context badges while preserving same-role child indexes");
assert.deepEqual(payload.runs[0].agents.map((agent) => [agent.model, agent.thinking]), [["anthropic/claude-opus-4-8:high", "high"], ["openai-codex/gpt-5.6-sol", "high"]], "async overview should publish effective lifecycle model and reasoning metadata");
assert.deepEqual(payload.runs[1].agents.map((agent) => [agent.name, agent.nested]), [["worker", false], ["nested-oracle", true]]);

const fleetStartedAt = Date.now() - 500;
subagentRpcReplyHook = (request) => {
  if (request.method !== "status" || Object.keys(request.params || {}).length) return false;
  subagentRpcReplyHook = null;
  bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
    version: 1,
    requestId: request.requestId,
    method: request.method,
    success: true,
    data: {
      text: statusText,
      details: { mode: "single", results: [] },
      fleet: {
        version: 1,
        entries: [
          { key: "fleet-reviewer-1", agent: "reviewer", startedAt: fleetStartedAt, tokens: { input: 0, output: 0, total: 0 } },
          { key: "fleet-reviewer-2", agent: "reviewer", startedAt: fleetStartedAt + 1, tokens: { input: 0, output: 0, total: 0 } },
          { key: "fleet-worker", agent: "worker", startedAt: fleetStartedAt + 2, tokens: { input: 0, output: 0, total: 0 } },
          { key: "fleet-nested", agent: "nested-oracle", startedAt: fleetStartedAt + 3, tokens: { input: 0, output: 0, total: 0 } },
          { key: "fleet-recovered", agent: "scout", role: "Recovery scout", model: "openai-codex/gpt-5.6-terra:xhigh", effort: "xhigh", startedAt: fleetStartedAt + 4, tokens: { input: 0, output: 0, total: 0 } },
        ],
        totalActive: 5,
        omitted: 0,
      },
    },
  });
  return true;
};
bus.emit("subagents:rpc:v1:ready", { version: 1 });
await new Promise((resolve) => setTimeout(resolve, 0));
payload = latestPayload();
assert.equal(payload.runs.filter((run) => run.id === "run-a").length, 1, "fleet recovery must not duplicate a text-parsed run");
assert.equal(payload.runs.find((run) => run.id === "run-a")?.agents.length, 2, "fleet recovery must match repeated same-role children one-to-one");
const recoveredFleetRun = payload.runs.find((run) => run.id === "fleet:fleet-recovered");
assert.deepEqual(recoveredFleetRun && {
  source: recoveredFleetRun.source,
  provisional: recoveredFleetRun.provisional,
  controllable: recoveredFleetRun.controllable,
  agents: recoveredFleetRun.agents.map((agent) => [agent.name, agent.model, agent.thinking]),
}, {
  source: "recovered",
  provisional: true,
  controllable: false,
  agents: [["Recovery scout", "openai-codex/gpt-5.6-terra:xhigh", "xhigh"]],
}, "unmatched authoritative fleet children should publish a bounded non-controllable provisional row");
const recoveredCanonical = latestCanonicalPayload().instances.find((instance) => instance.runId === "fleet:fleet-recovered");
assert.deepEqual(recoveredCanonical && {
  open: recoveredCanonical.capabilities.open,
  refresh: recoveredCanonical.capabilities.refresh,
  cancel: recoveredCanonical.capabilities.cancel,
  outputKind: recoveredCanonical.outputRef.kind,
}, { open: true, refresh: true, cancel: false, outputKind: "helper" }, "recovered pi-subagents rows should expose a read-only helper-owned output view without lifecycle controls");
assert.deepEqual(payload.fleet, { version: 1, totalActive: 5, omitted: 0 }, "fleet recovery should publish only bounded aggregate recovery metadata");

subagentRpcReplyHook = (request) => {
  if (request.method !== "status" || Object.keys(request.params || {}).length) return false;
  subagentRpcReplyHook = null;
  bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
    version: 1,
    requestId: request.requestId,
    method: request.method,
    success: true,
    data: {
      text: statusText,
      details: { mode: "single", results: [] },
      fleet: { version: 1, entries: "malformed", totalActive: 99, omitted: 99 },
    },
  });
  return true;
};
bus.emit("subagents:rpc:v1:ready", { version: 1 });
await new Promise((resolve) => setTimeout(resolve, 0));
payload = latestPayload();
assert.equal("fleet" in payload, false, "a successful poll with malformed fleet data should clear stale aggregate metadata");
assert.ok(payload.runs.some((run) => run.id === "fleet:fleet-recovered" && run.status === "running"), "malformed fleet data must not prune or finish a previously recovered live row");

const retryGate = {
  version: 1,
  id: "gate-delivery-retry",
  status: "running",
  requiredSuccesses: 1,
  qualifyingSuccesses: 0,
  requireDistinctProviders: false,
  startedAt: Date.now(),
  updatedAt: Date.now(),
  attempts: [],
};
const statusesBeforeFailedDelivery = legacyStatusCount();
setStatusFailures = 1;
bus.emit("webui:subagent-gate:v1:update", retryGate);
assert.equal(legacyStatusCount(), statusesBeforeFailedDelivery, "a failed setStatus delivery should not appear successful");
bus.emit("webui:subagent-gate:v1:update", retryGate);
assert.equal(legacyStatusCount(), statusesBeforeFailedDelivery + 1, "an unchanged snapshot should retry after setStatus throws");
const statusesBeforeHeartbeat = legacyStatusCount();
const realDateNow = Date.now;
Date.now = () => realDateNow() + 16_000;
try {
  bus.emit("webui:subagent-gate:v1:update", retryGate);
} finally {
  Date.now = realDateNow;
}
assert.equal(legacyStatusCount(), statusesBeforeHeartbeat + 1, "an unchanged snapshot should republish after the bounded heartbeat interval");

bus.emit("webui:subagent-gate:v1:update", {
  version: 1,
  id: "gate-a",
  status: "running",
  requiredSuccesses: 2,
  qualifyingSuccesses: 1,
  requireDistinctProviders: true,
  startedAt: Date.now() - 2000,
  updatedAt: Date.now(),
  attempts: [
    { id: "gate-a:0:1", taskIndex: 0, attempt: 1, maxAttempts: 2, agent: "reviewer", retrySafety: "read-only", runId: "review-1", model: "anthropic/claude-opus-4-8", provider: "anthropic", status: "succeeded" },
    { id: "gate-a:1:1", taskIndex: 1, attempt: 1, maxAttempts: 2, agent: "reviewer", retrySafety: "read-only", runId: "review-2", model: "openrouter/moonshotai/kimi-k3", provider: "openrouter", status: "failed", failureKind: "transient-provider", error: "provider overloaded" },
  ],
});
payload = latestPayload();
assert.equal(payload.gates.length, 2, "helper should publish retry gate lifecycle alongside running children");
const publishedGate = payload.gates.find((gate) => gate.id === "gate-a");
assert.equal(publishedGate?.qualifyingSuccesses, 1);
assert.deepEqual(publishedGate?.attempts.map((attempt) => [attempt.status, attempt.failureKind]), [["succeeded", undefined], ["failed", "transient-provider"]]);

const workflowRunId = "workflow:run-42";
const workflowAgentId = "workflow:run-42:phase:implement:call:call-0123456789abcdef";
const workflowSnapshot = {
  version: 1,
  updatedAt: "2026-07-26T12:00:05.000Z",
  runs: [{
    id: workflowRunId,
    source: "workflow",
    name: "Workflow build",
    status: "running",
    startedAt: "2026-07-26T12:00:00.000Z",
    agents: [{
      id: workflowAgentId,
      name: "Implementation worker",
      status: "running",
      index: 0,
      activityState: "stdout",
      model: "openai-codex/gpt-5.6-terra:xhigh",
      recentOutput: ["Inspecting helper contract", "Implementing local output route"],
    }],
  }],
};
bus.emit("firstpick:workflow-subagents:v1", workflowSnapshot);
const canonicalPublishesAfterWorkflow = statuses.filter((item) => item.key === "webui-subagents-v2").length;
bus.emit("firstpick:workflow-subagents:v1", workflowSnapshot);
assert.equal(statuses.filter((item) => item.key === "webui-subagents-v2").length, canonicalPublishesAfterWorkflow, "unchanged active snapshots must respect the bounded canonical publish heartbeat");
payload = latestPayload();
const workflowRun = payload.runs.find((run) => run.id === workflowRunId);
assert.deepEqual(workflowRun && {
  id: workflowRun.id,
  source: workflowRun.source,
  name: workflowRun.name,
  agents: workflowRun.agents.map((agent) => [agent.id, agent.name, agent.activityState, agent.model, agent.thinking]),
}, {
  id: workflowRunId,
  source: "workflow",
  name: "Workflow build",
  agents: [[workflowAgentId, "Implementation worker", "stdout", "openai-codex/gpt-5.6-terra:xhigh", undefined]],
}, "workflow snapshots should preserve stable IDs, source, name, activity, model, and unknown thinking alongside ordinary rows");
assert.ok(payload.runs.some((run) => run.id === "run-a") && payload.runs.some((run) => run.id === "run-b"), "workflow rows should coexist with ordinary async rows");

const requestsBeforeWorkflowPoll = subagentStatusRequestCount;
bus.emit("subagents:rpc:v1:ready", { version: 1 });
await new Promise((resolve) => setTimeout(resolve, 0));
payload = latestPayload();
assert.ok(subagentStatusRequestCount > requestsBeforeWorkflowPoll, "ordinary pi-subagents polling should still run after workflow snapshots arrive");
assert.ok(payload.runs.some((run) => run.id === workflowRunId), "pi-subagents polling must not reconcile away workflow rows");

const helperCommand = registeredCommands.get("webui-helper");
assert.ok(helperCommand?.handler, "Web UI helper command should be registered");
await helperCommand.handler(JSON.stringify({
  requestId: "recovered-subagent-output-test",
  action: "subagent-output",
  payload: { outputId: recoveredCanonical.outputRef.id },
}), ctx);
const recoveredOutputResponse = helperResponse("recovered-subagent-output-test");
assert.equal(recoveredOutputResponse.ok, true, "a recovered fleet row should open through its opaque helper handle");
assert.equal(recoveredOutputResponse.data.source, "recovered");
assert.equal(recoveredOutputResponse.data.agent.unavailable, true);
assert.match(recoveredOutputResponse.data.agent.unavailableReason, /recovered from aggregate fleet metadata/, "the read-only recovered view should explain why detailed output is not yet available");

for (const handler of extensionHandlers.get("tool_execution_update") || []) {
  handler({
    type: "tool_execution_update",
    toolCallId: "recovered-foreground-call",
    toolName: "subagent",
    partialResult: {
      details: {
        runId: "recovered-foreground-run",
        mode: "single",
        progress: [{
          index: 0,
          agent: "scout",
          status: "running",
          currentTool: "read",
          recentOutput: ["Recovered child output is live again"],
        }],
      },
    },
  }, ctx);
}
payload = latestPayload();
assert.equal(payload.runs.some((run) => run.id === "fleet:fleet-recovered"), false, "a recovered fleet placeholder should be replaced when its live tool update arrives");
const recoveredForegroundRun = payload.runs.find((run) => run.id === "recovered-foreground-run");
assert.deepEqual(recoveredForegroundRun && {
  source: recoveredForegroundRun.source,
  controllable: recoveredForegroundRun.controllable,
  agents: recoveredForegroundRun.agents.map((agent) => [agent.name, agent.model, agent.thinking]),
}, {
  source: "foreground",
  controllable: undefined,
  agents: [["scout", "openai-codex/gpt-5.6-terra:xhigh", "xhigh"]],
}, "a live update without a preceding start event should promote recovered metadata into a normal foreground run even when the fleet display role differs from the agent identity");
const recoveredForegroundCanonical = latestCanonicalPayload().instances.find((instance) => instance.runId === "recovered-foreground-run");
await helperCommand.handler(JSON.stringify({
  requestId: "recovered-foreground-live-output-test",
  action: "subagent-output",
  payload: { outputId: recoveredForegroundCanonical.outputRef.id },
}), ctx);
const recoveredForegroundOutput = helperResponse("recovered-foreground-live-output-test");
assert.equal(recoveredForegroundOutput.ok, true);
assert.equal(recoveredForegroundOutput.data.source, "foreground");
assert.equal(recoveredForegroundOutput.data.agent.unavailable, undefined);
assert.deepEqual(recoveredForegroundOutput.data.agent.recentOutput, ["Recovered child output is live again"], "promoted recovered runs should expose subsequent live output");
for (const handler of extensionHandlers.get("tool_execution_end") || []) {
  handler({ type: "tool_execution_end", toolCallId: "recovered-foreground-call", toolName: "subagent" }, ctx);
}
await helperCommand.handler(JSON.stringify({
  requestId: "dismiss-recovered-foreground-run",
  action: "subagent-dismiss",
  payload: { runId: "recovered-foreground-run" },
}), ctx);
assert.equal(helperResponse("dismiss-recovered-foreground-run").ok, true, "a promoted recovered run should follow the normal foreground completion lifecycle");

const gateRecoveredStartedAt = Date.now() - 500;
subagentRpcReplyHook = (request) => {
  if (request.method !== "status" || Object.keys(request.params || {}).length) return false;
  subagentRpcReplyHook = null;
  bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
    version: 1,
    requestId: request.requestId,
    method: request.method,
    success: true,
    data: {
      text: statusText,
      details: { mode: "single", results: [] },
      fleet: {
        version: 1,
        entries: [{
          key: "fleet-gate-recovered",
          agent: "scout",
          role: "Gate recovery scout",
          model: "openai-codex/gpt-5.6-terra:xhigh",
          effort: "xhigh",
          startedAt: gateRecoveredStartedAt,
          tokens: { input: 0, output: 0, total: 0 },
        }],
        totalActive: 1,
        omitted: 0,
      },
    },
  });
  return true;
};
bus.emit("subagents:rpc:v1:ready", { version: 1 });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(latestPayload().runs.some((run) => run.id === "fleet:fleet-gate-recovered"), "an unmatched gate child should begin as an aggregate fleet placeholder");
bus.emit("webui:subagent-gate:v1:update", {
  version: 1,
  id: "gate-live-output",
  status: "running",
  requiredSuccesses: 1,
  qualifyingSuccesses: 0,
  requireDistinctProviders: false,
  startedAt: gateRecoveredStartedAt,
  updatedAt: Date.now(),
  attempts: [{
    id: "gate-live-output:0:1",
    taskIndex: 0,
    attempt: 1,
    maxAttempts: 1,
    agent: "scout",
    label: "Gate recovery scout",
    retrySafety: "read-only",
    runId: "recovered-gate-run",
    model: "openai-codex/gpt-5.6-terra:xhigh",
    provider: "openai-codex",
    status: "running",
    startedAt: gateRecoveredStartedAt,
  }],
});
assert.equal(latestPayload().runs.some((run) => run.id === "fleet:fleet-gate-recovered"), false, "a running gate attempt with a real run id should replace its aggregate fleet placeholder");
const gateTrackedRun = latestPayload().runs.find((run) => run.id === "recovered-gate-run");
assert.equal(gateTrackedRun?.source, "async", "gate-owned children should become normal output-capable async runs");
const gateTrackedCanonical = latestCanonicalPayload().instances.find((instance) => instance.runId === "recovered-gate-run");
await helperCommand.handler(JSON.stringify({
  requestId: "recovered-gate-live-output-test",
  action: "subagent-output",
  payload: { outputId: gateTrackedCanonical.outputRef.id },
}), ctx);
const recoveredGateOutput = helperResponse("recovered-gate-live-output-test");
assert.equal(recoveredGateOutput.ok, true);
assert.equal(recoveredGateOutput.data.source, "async");
assert.equal(recoveredGateOutput.data.agent.unavailable, undefined, "a gate child with a run locator must not retain the aggregate-fleet warning");
assert.deepEqual(recoveredGateOutput.data.agent.recentOutput, ["Gate child output is live."], "a recovered gate child should resolve its session transcript through the real run locator");

const requestsBeforeWorkflowOutput = subagentStatusRequestCount;
await helperCommand.handler(JSON.stringify({
  requestId: "workflow-subagent-output-test",
  action: "subagent-output",
  payload: { runId: workflowRunId, agentId: workflowAgentId },
}), ctx);
const workflowOutputNotice = notifications.find((entry) => entry.message.startsWith("__PI_WEBUI_HELPER_RESPONSE__:")
  && JSON.parse(entry.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length)).requestId === "workflow-subagent-output-test");
assert.ok(workflowOutputNotice, "workflow output should return a local helper response");
const workflowOutputResponse = JSON.parse(workflowOutputNotice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
assert.equal(workflowOutputResponse.ok, true);
assert.equal("thinking" in workflowOutputResponse.data.agent, false, "workflow output must leave unknown thinking metadata absent rather than infer it from the model");
assert.deepEqual(workflowOutputResponse.data, {
  version: 1,
  runId: workflowRunId,
  source: "workflow",
  mode: "single",
  startedAt: Date.parse("2026-07-26T12:00:00.000Z"),
  updatedAt: Date.parse("2026-07-26T12:00:05.000Z"),
  agent: {
    id: workflowAgentId,
    name: "Implementation worker",
    index: 0,
    nested: false,
    status: "running",
    activityState: "stdout",
    model: "openai-codex/gpt-5.6-terra:xhigh",
    telemetry: {
      promptInjectionTokens: null,
      inputTokens: null,
      outputTokens: null,
      tokenSpeed: null,
      contextTokens: null,
      contextWindow: null,
      model: null,
      effort: null,
    },
    recentTools: [],
    recentOutput: ["Inspecting helper contract", "Implementing local output route"],
    transcript: [],
  },
}, "workflow output should use only cached bounded workflow fields");
assert.equal(subagentStatusRequestCount, requestsBeforeWorkflowOutput, "workflow output must not request pi-subagents status or filesystem data");

assert.doesNotThrow(() => bus.emit("firstpick:workflow-subagents:v1", { version: 1, runs: "not-an-array" }), "malformed workflow payloads must not crash the helper");
payload = latestPayload();
assert.ok(payload.runs.some((run) => run.id === workflowRunId), "malformed workflow payloads must not clear the prior valid snapshot");
await helperCommand.handler(JSON.stringify({
  requestId: "async-subagent-output-test",
  action: "subagent-output",
  payload: { runId: "run-a", agentId: "run-a:step:0:reviewer" },
}), ctx);
const asyncOutputNotice = notifications.find((entry) => entry.message.includes("async-subagent-output-test"));
assert.ok(asyncOutputNotice, "async subagent output helper action should return a response notification");
const asyncOutputResponse = JSON.parse(asyncOutputNotice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
assert.equal(asyncOutputResponse.ok, true);
assert.equal(asyncOutputResponse.data.agent.model, "anthropic/claude-opus-4-8:high");
assert.equal(asyncOutputResponse.data.agent.thinking, "high");
assert.deepEqual(asyncOutputResponse.data.agent.telemetry, {
  promptInjectionTokens: 1234,
  inputTokens: 300,
  outputTokens: 100,
  tokenSpeed: 20,
  contextTokens: 240,
  contextWindow: 200_000,
  model: "anthropic/claude-opus-4-8:high",
  effort: "high",
}, "ordinary live output should expose only derived bounded child-session telemetry");
assert.doesNotMatch(JSON.stringify(asyncOutputResponse.data.agent.telemetry), /must not leave the child session/, "selected telemetry must not leak custom-entry payloads");
assert.deepEqual(asyncOutputResponse.data.agent.recentOutput, [
  "REVIEWER STREAM 1 OF 18",
  "▶ bash {\"command\":\"sleep 5\"}",
  "Review complete.",
  "reviewer tool output line",
], "async output should remain available as a bounded text fallback when status recentOutput is empty");
assert.deepEqual(asyncOutputResponse.data.agent.transcript, [
  {
    role: "assistant",
    timestamp: "2026-07-19T12:00:00.000Z",
    content: [
      { type: "thinking", thinking: "Checking structured transcript extraction" },
      { type: "text", text: "REVIEWER STREAM 1 OF 18" },
      { type: "toolCall", id: "review-call", name: "bash", arguments: "{\"command\":\"sleep 5\"}" },
      { type: "text", text: "Review complete." },
    ],
  },
  {
    role: "toolResult",
    timestamp: "2026-07-19T12:00:01.000Z",
    toolCallId: "review-call",
    toolName: "bash",
    content: [{ type: "text", text: "reviewer tool output line" }],
  },
], "async output should preserve assistant thinking, tool calls, final text, and tool results for the main transcript renderer");

const boundedSessionFile = path.join(asyncRunDir, "bounded-reviewer-session.jsonl");
await writeFile(boundedSessionFile, Array.from({ length: 122 }, (_unused, index) => JSON.stringify({
  type: "message",
  timestamp: `2026-07-19T12:01:${String(index).padStart(2, "0")}.000Z`,
  message: { role: "assistant", content: [{ type: "text", text: `bounded transcript line ${index}` }] },
})).join("\n"));
await writeFile(asyncStatusFile, JSON.stringify({
  runId: "run-a",
  mode: "parallel",
  state: "running",
  startedAt: Date.now() - 1000,
  lastUpdate: Date.now(),
  steps: [{ agent: "reviewer", status: "running", sessionFile: boundedSessionFile }],
}));
await helperCommand.handler(JSON.stringify({
  requestId: "bounded-subagent-output-test",
  action: "subagent-output",
  payload: { runId: "run-a", agentId: "run-a:step:0:reviewer" },
}), ctx);
const boundedOutputNotice = notifications.find((entry) => entry.message.startsWith("__PI_WEBUI_HELPER_RESPONSE__:")
  && JSON.parse(entry.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length)).requestId === "bounded-subagent-output-test");
assert.ok(boundedOutputNotice, "bounded async output helper action should return a response notification");
const boundedOutputResponse = JSON.parse(boundedOutputNotice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
assert.equal(boundedOutputResponse.data.agent.recentOutput.length, 120, "structured child extraction should retain the existing 120-line output bound");
assert.equal(boundedOutputResponse.data.agent.recentOutput[0], "bounded transcript line 2");
assert.equal(boundedOutputResponse.data.agent.recentOutput.at(-1), "bounded transcript line 121");
assert.equal(boundedOutputResponse.data.agent.transcript.length, 120, "structured child extraction should apply the same tail bound to rendered entries");

const incompleteToolSessionFile = path.join(asyncRunDir, "incomplete-tool-session.jsonl");
await writeFile(incompleteToolSessionFile, JSON.stringify({
  type: "message",
  timestamp: "2026-07-19T12:02:00.000Z",
  message: { role: "assistant", content: [{ type: "toolCall", id: "tail-call", name: "read", arguments: { path: "README.md" } }] },
}));
await writeFile(asyncStatusFile, JSON.stringify({
  runId: "run-a",
  mode: "parallel",
  state: "running",
  startedAt: Date.now() - 1000,
  lastUpdate: Date.now(),
  steps: [{ agent: "reviewer", status: "running", sessionFile: incompleteToolSessionFile }],
}));
await helperCommand.handler(JSON.stringify({
  requestId: "incomplete-tool-subagent-output-test",
  action: "subagent-output",
  payload: { runId: "run-a", agentId: "run-a:step:0:reviewer" },
}), ctx);
const incompleteToolNotice = notifications.find((entry) => entry.message.startsWith("__PI_WEBUI_HELPER_RESPONSE__:")
  && JSON.parse(entry.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length)).requestId === "incomplete-tool-subagent-output-test");
assert.ok(incompleteToolNotice, "incomplete tool output helper action should return a response notification");
const incompleteToolResponse = JSON.parse(incompleteToolNotice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
assert.deepEqual(incompleteToolResponse.data.agent.transcript, [{
  role: "assistant",
  timestamp: "2026-07-19T12:02:00.000Z",
  content: [{ type: "toolCall", id: "tail-call", name: "read", arguments: "{\"path\":\"README.md\"}" }],
}], "a live or truncated session tail should retain an unpaired tool call for a pending tool card");

const malformedTelemetrySessionFile = path.join(asyncRunDir, "malformed-telemetry-session.jsonl");
await writeFile(malformedTelemetrySessionFile, [
  "{not json}",
  JSON.stringify({ type: "custom", customType: "stats_initial_prompt_estimate", data: { actualInjectedTokens: "invalid", privatePrompt: "malformed custom payload" } }),
  JSON.stringify({ type: "message", timestamp: "2026-07-19T12:03:01.000Z", message: { role: "assistant", timestamp: "2026-07-19T12:03:00.000Z", usage: { input: -1, output: Number.MAX_VALUE }, content: [] } }),
].join("\n"));
await writeFile(asyncStatusFile, JSON.stringify({
  runId: "run-a",
  mode: "parallel",
  state: "running",
  startedAt: Date.now() - 1000,
  lastUpdate: Date.now(),
  steps: [{ agent: "reviewer", status: "running", sessionFile: malformedTelemetrySessionFile, model: "anthropic/claude-opus-4-8:high", thinking: "high" }],
}));
await helperCommand.handler(JSON.stringify({
  requestId: "malformed-telemetry-subagent-output-test",
  action: "subagent-output",
  payload: { runId: "run-a", agentId: "run-a:step:0:reviewer" },
}), ctx);
const malformedTelemetryResponse = helperResponse("malformed-telemetry-subagent-output-test");
assert.deepEqual(malformedTelemetryResponse.data.agent.telemetry, {
  promptInjectionTokens: null,
  inputTokens: null,
  outputTokens: null,
  tokenSpeed: null,
  contextTokens: null,
  contextWindow: 200_000,
  model: "anthropic/claude-opus-4-8:high",
  effort: "high",
}, "malformed child-session telemetry should fail closed while preserving authoritative model metadata");
assert.doesNotMatch(JSON.stringify(malformedTelemetryResponse.data.agent.telemetry), /malformed custom payload/, "malformed custom-entry payloads must not reach selected output");

await writeFile(asyncStatusFile, JSON.stringify({
  runId: "run-a",
  mode: "parallel",
  state: "running",
  startedAt: Date.now() - 1000,
  lastUpdate: Date.now(),
  steps: [{ agent: "reviewer", status: "running", sessionFile: asyncSessionFile, recentOutput: [], currentTool: "bash", currentToolArgs: "sleep 5", model: "anthropic/claude-opus-4-8:high", thinking: "high" }],
}));
await helperCommand.handler(JSON.stringify({
  requestId: "restored-telemetry-subagent-output-test",
  action: "subagent-output",
  payload: { runId: "run-a", agentId: "run-a:step:0:reviewer" },
}), ctx);
assert.equal(helperResponse("restored-telemetry-subagent-output-test").data.agent.telemetry.inputTokens, 300, "a valid retained locator should replace an earlier malformed live locator");

for (const handler of extensionHandlers.get("tool_execution_start") || []) {
  handler({
    type: "tool_execution_start",
    toolCallId: "foreground-call",
    toolName: "subagent",
    args: {
      model: "openai-codex/gpt-5.6-terra:xhigh",
      tasks: [
        { agent: "tester", task: "Run tests" },
        { agent: "reviewer", task: "Review diff", model: "anthropic/claude-opus-4-8:high" },
      ],
    },
  }, ctx);
}
payload = latestPayload();
let foreground = payload.runs.find((run) => run.source === "foreground");
assert.deepEqual(foreground?.agents.map((agent) => agent.name), ["tester", "reviewer"], "foreground parallel children should appear while the tool runs");
assert.deepEqual(foreground?.agents.map((agent) => [agent.model, agent.thinking]), [["openai-codex/gpt-5.6-terra:xhigh", "xhigh"], ["anthropic/claude-opus-4-8:high", "high"]], "foreground overview should preserve run-level defaults and per-child model/reasoning overrides");

for (const handler of extensionHandlers.get("tool_execution_start") || []) {
  handler({
    type: "tool_execution_start",
    toolCallId: "workflow-script-provisional",
    toolName: "subagent",
    args: { workflowScript: "return runs.run('implementation', { agent: 'worker', task: 'Implement it' })", async: false },
  }, ctx);
}
payload = latestPayload();
const provisionalWorkflow = payload.runs.find((run) => run.id === "workflow-script-provisional");
assert.deepEqual(provisionalWorkflow && {
  source: provisionalWorkflow.source,
  status: provisionalWorkflow.status,
  agents: provisionalWorkflow.agents.map((agent) => agent.name),
}, {
  source: "foreground",
  status: "running",
  agents: ["workflow"],
}, "a direct workflowScript lifecycle start should publish a provisional row before child details arrive");
for (const handler of extensionHandlers.get("tool_execution_end") || []) {
  handler({ type: "tool_execution_end", toolCallId: "workflow-script-provisional", toolName: "subagent" }, ctx);
}
payload = latestPayload();
assert.equal(payload.runs.some((run) => run.id === "workflow-script-provisional"), false, "a workflow-only provisional row should not enter retained terminal history");

for (const handler of extensionHandlers.get("tool_execution_update") || []) {
  handler({
    type: "tool_execution_update",
    toolCallId: "foreground-call",
    toolName: "subagent",
    partialResult: {
      details: {
        mode: "parallel",
        progress: [{
          index: 0,
          agent: "tester",
          status: "running",
          currentTool: "bash",
          currentToolArgs: "npm test",
          currentPath: "/tmp/subagent-helper-test",
          recentTools: [{ tool: "read", args: "package.json", endMs: 1000 }],
          recentOutput: ["Running focused tests", "12 assertions passed"],
          turnCount: 2,
          toolCount: 3,
          tokens: 420,
        }],
      },
    },
  }, ctx);
}
payload = latestPayload();
foreground = payload.runs.find((run) => run.source === "foreground");
assert.deepEqual(foreground?.agents.map((agent) => agent.name), ["tester"], "foreground live updates should expose currently running children");

await helperCommand.handler(JSON.stringify({
  requestId: "subagent-output-test",
  action: "subagent-output",
  payload: { runId: "foreground-call", agentId: "foreground-call:0:tester" },
}), ctx);
const outputNotice = notifications.find((entry) => {
  if (!entry.message.startsWith("__PI_WEBUI_HELPER_RESPONSE__:")) return false;
  return JSON.parse(entry.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length)).requestId === "subagent-output-test";
});
assert.ok(outputNotice, "subagent output helper action should return a response notification");
const outputResponse = JSON.parse(outputNotice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
assert.equal(outputResponse.ok, true);
assert.equal(outputResponse.data.agent.currentTool, "bash");
assert.equal(outputResponse.data.agent.currentToolArgs, "npm test");
assert.equal(outputResponse.data.agent.model, "openai-codex/gpt-5.6-terra:xhigh");
assert.equal(outputResponse.data.agent.thinking, "xhigh");
assert.deepEqual(outputResponse.data.agent.telemetry, {
  promptInjectionTokens: null,
  inputTokens: null,
  outputTokens: null,
  tokenSpeed: null,
  contextTokens: null,
  contextWindow: 128_000,
  model: "openai-codex/gpt-5.6-terra:xhigh",
  effort: "xhigh",
}, "foreground snapshots without child-session locators should retain explicit unknown measurements");
assert.deepEqual(outputResponse.data.agent.recentOutput, ["Running focused tests", "12 assertions passed"]);
assert.deepEqual(outputResponse.data.agent.transcript, [], "foreground snapshots without a child session transcript should retain the recentOutput-only fallback");
assert.deepEqual(outputResponse.data.agent.recentTools, [{ tool: "read", args: "package.json", endMs: 1000 }]);

for (const handler of extensionHandlers.get("tool_execution_end") || []) {
  handler({ type: "tool_execution_end", toolCallId: "foreground-call", toolName: "subagent" }, ctx);
}
payload = latestPayload();
foreground = payload.runs.find((run) => run.id === "foreground-call");
assert.deepEqual(foreground && {
  status: foreground.status,
  endedAt: typeof foreground.endedAt,
  agents: foreground.agents.map((agent) => [agent.name, agent.status]),
}, {
  status: "done",
  endedAt: "number",
  agents: [["reviewer", "done"], ["tester", "done"]],
}, "foreground children should remain viewable with final statuses when their tool finishes");
assert.equal(branchEntries.at(-1)?.customType, "webui-subagent-retained-runs-v1", "terminal runs should persist as parent-session custom snapshots");

const boundedWorkflowSnapshot = {
  version: 1,
  updatedAt: "2026-07-26T12:01:00.000Z",
  runs: Array.from({ length: 33 }, (_unused, runIndex) => ({
    id: `workflow:bounded-run-${runIndex}`,
    source: "workflow",
    name: `Bounded workflow ${runIndex}`,
    status: "running",
    startedAt: "2026-07-26T12:00:00.000Z",
    agents: Array.from({ length: 33 }, (_agentUnused, agentIndex) => ({
      id: `workflow:bounded-run-${runIndex}:phase:phase-${agentIndex}:call:call-${agentIndex}`,
      name: `Bounded worker ${agentIndex}`,
      status: "running",
      index: agentIndex,
      activityState: "x".repeat(200),
      model: "m".repeat(300),
      recentOutput: Array.from({ length: 9 }, (_lineUnused, lineIndex) => `line-${lineIndex}:${"o".repeat(700)}`),
    })),
  })),
};
assert.doesNotThrow(() => bus.emit("firstpick:workflow-subagents:v1", boundedWorkflowSnapshot), "oversized workflow snapshots should be bounded safely at ingress");
payload = latestPayload();
const boundedWorkflowRuns = payload.runs.filter((run) => run.source === "workflow");
assert.equal(boundedWorkflowRuns.length, 32, "workflow ingress should cap the number of cached runs");
assert.equal(boundedWorkflowRuns[0].agents.length, 32, "workflow ingress should cap agents per run");
assert.equal(boundedWorkflowRuns[0].agents[0].activityState.length, 80, "workflow ingress should bound activity text");
assert.equal(boundedWorkflowRuns[0].agents[0].model.length, 240, "workflow ingress should bound model text");

const boundedWorkflowRun = boundedWorkflowRuns[0];
const boundedWorkflowAgent = boundedWorkflowRun.agents[0];
await helperCommand.handler(JSON.stringify({
  requestId: "bounded-workflow-subagent-output-test",
  action: "subagent-output",
  payload: { runId: boundedWorkflowRun.id, agentId: boundedWorkflowAgent.id },
}), ctx);
const boundedWorkflowOutputNotice = notifications.find((entry) => entry.message.startsWith("__PI_WEBUI_HELPER_RESPONSE__:")
  && JSON.parse(entry.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length)).requestId === "bounded-workflow-subagent-output-test");
assert.ok(boundedWorkflowOutputNotice, "bounded workflow output should return a local helper response");
const boundedWorkflowOutput = JSON.parse(boundedWorkflowOutputNotice.message.slice("__PI_WEBUI_HELPER_RESPONSE__:".length));
assert.equal(boundedWorkflowOutput.data.agent.recentOutput.length, 8, "workflow ingress should cap cached output lines");
assert.equal(boundedWorkflowOutput.data.agent.recentOutput[0].length, 500, "workflow ingress should cap cached output line length");
assert.match(boundedWorkflowOutput.data.agent.recentOutput[0], /^line-1:/, "workflow ingress should retain the bounded output tail");

bus.emit("firstpick:workflow-subagents:v1", {
  version: 1,
  updatedAt: "2026-07-26T12:02:00.000Z",
  runs: [],
});
payload = latestPayload();
assert.equal(payload.runs.some((run) => run.source === "workflow"), false, "an empty workflow snapshot should clear only workflow rows");
assert.ok(payload.runs.some((run) => run.id === "run-a") && payload.runs.some((run) => run.id === "run-b"), "workflow cleanup must preserve ordinary async rows");

await helperCommand.handler(JSON.stringify({
  requestId: "dismiss-finished-foreground",
  action: "subagent-dismiss",
  payload: { runId: "foreground-call" },
}), ctx);
assert.deepEqual(helperResponse("dismiss-finished-foreground"), {
  requestId: "dismiss-finished-foreground",
  ok: true,
  data: { runId: "foreground-call", dismissed: true },
}, "dismiss should remove only a retained finished run");
payload = latestPayload();
assert.equal(payload.runs.some((run) => run.id === "foreground-call"), false, "a dismissed finished run should disappear from the published snapshot");

await helperCommand.handler(JSON.stringify({
  requestId: "dismiss-running-async",
  action: "subagent-dismiss",
  payload: { runId: "run-a" },
}), ctx);
assert.equal(helperResponse("dismiss-running-async").ok, false, "dismiss should reject a still-running run");

for (const handler of extensionHandlers.get("tool_execution_start") || []) {
  handler({
    type: "tool_execution_start",
    toolCallId: "foreground-cancel",
    toolName: "subagent",
    args: { agent: "tester", model: "openai-codex/gpt-5.6-terra:xhigh" },
  }, ctx);
}
await helperCommand.handler(JSON.stringify({
  requestId: "cancel-foreground-not-ready",
  action: "subagent-cancel",
  payload: { runId: "foreground-cancel" },
}), ctx);
assert.equal(helperResponse("cancel-foreground-not-ready").ok, false, "foreground cancellation should wait until pi-subagents publishes its control run id");
for (const handler of extensionHandlers.get("tool_execution_update") || []) {
  handler({
    type: "tool_execution_update",
    toolCallId: "foreground-cancel",
    toolName: "subagent",
    partialResult: { details: { runId: "foreground-control", mode: "single", progress: [{ agent: "tester", status: "running", index: 0 }] } },
  }, ctx);
}
const interruptRequestsBefore = subagentRpcRequests.length;
idle = true;
await helperCommand.handler(JSON.stringify({
  requestId: "cancel-foreground",
  action: "subagent-cancel",
  payload: { runId: "foreground-control" },
}), ctx);
assert.deepEqual(helperResponse("cancel-foreground"), {
  requestId: "cancel-foreground",
  ok: true,
  data: { runId: "foreground-control", state: "cancelled", delivery: "context", rpcMethod: "interrupt" },
}, "foreground cancellation should report a context delivery after an interrupt RPC");
assert.deepEqual(subagentRpcRequests.slice(interruptRequestsBefore).find((request) => request.method === "interrupt")?.params, { id: "foreground-control" }, "foreground cancellation should target pi-subagents' published control run id");
assert.equal(sentMessages.at(-1)?.message?.customType, "webui-subagent-cancelled");
assert.equal(sentMessages.at(-1)?.options, undefined, "idle parent sessions should receive cancellation notices as context");

const longReason = "R".repeat(125);
const longNote = "N".repeat(2_010);
const stopRequestsBefore = subagentRpcRequests.length;
idle = false;
await helperCommand.handler(JSON.stringify({
  requestId: "cancel-async",
  action: "subagent-cancel",
  payload: { runId: "run-a", agentId: "run-a:step:0:reviewer", reason: longReason, note: longNote },
}), ctx);
const asyncCancel = helperResponse("cancel-async");
assert.deepEqual(asyncCancel, {
  requestId: "cancel-async",
  ok: true,
  data: { runId: "run-a", state: "cancelled", delivery: "steer", rpcMethod: "stop" },
}, "async cancellation should report a steer delivery after a stop RPC");
assert.deepEqual(subagentRpcRequests.slice(stopRequestsBefore).find((request) => request.method === "stop")?.params, { id: "run-a" }, "async cancellation should target the tracked run with stop");
const asyncCancelMessage = sentMessages.at(-1);
assert.equal(asyncCancelMessage?.message?.customType, "webui-subagent-cancelled");
assert.deepEqual(asyncCancelMessage?.options, { deliverAs: "steer" }, "busy parent sessions should receive cancellation notices as steer messages");
assert.equal(asyncCancelMessage?.message?.display, true);
assert.equal(asyncCancelMessage?.message?.details?.runId, "run-a");
assert.deepEqual(asyncCancelMessage?.message?.details?.agentNames, ["reviewer", "reviewer"]);
assert.equal(asyncCancelMessage?.message?.details?.reason.length, 120, "cancel reasons should retain the documented 120-character bound");
assert.equal(asyncCancelMessage?.message?.details?.note.length, 2000, "cancel notes should retain the documented 2000-character bound");
assert.match(asyncCancelMessage?.message?.content || "", /should not be automatically retried without asking/, "parent cancellation notices should prevent silent retries");
payload = latestPayload();
const cancelledAsync = payload.runs.find((run) => run.id === "run-a");
assert.deepEqual(cancelledAsync && {
  status: cancelledAsync.status,
  cancelledBy: cancelledAsync.cancelledBy,
  cancelReasonLength: cancelledAsync.cancelReason?.length,
  cancelNoteLength: cancelledAsync.cancelNote?.length,
  agentStatuses: cancelledAsync.agents.map((agent) => agent.status),
}, {
  status: "cancelled",
  cancelledBy: "user",
  cancelReasonLength: 120,
  cancelNoteLength: 2000,
  agentStatuses: ["cancelled", "cancelled"],
}, "cancelled runs should remain published with bounded user cancellation metadata");

await helperCommand.handler(JSON.stringify({
  requestId: "cancel-finished-async",
  action: "subagent-cancel",
  payload: { runId: "run-a" },
}), ctx);
assert.equal(helperResponse("cancel-finished-async").ok, false, "cancel should reject a retained terminal run");

bus.emit("subagent:async-started", { id: "run-race", mode: "single", agent: "tester" });
subagentRpcReplyHook = (request) => {
  if (request.method !== "stop" || request.params?.id !== "run-race") return;
  subagentRpcReplyHook = null;
  bus.emit("subagent:async-complete", { id: "run-race" });
};
await helperCommand.handler(JSON.stringify({
  requestId: "cancel-complete-race",
  action: "subagent-cancel",
  payload: { runId: "run-race", reason: "Stopped by the user" },
}), ctx);
assert.equal(helperResponse("cancel-complete-race").ok, true);
const racedCancel = latestPayload().runs.find((run) => run.id === "run-race");
assert.equal(racedCancel?.status, "cancelled", "a successful user cancel should remain authoritative when completion races the RPC reply");
assert.equal(racedCancel?.cancelledBy, "user");
assert.equal(racedCancel?.cancelReason, "Stopped by the user");

bus.emit("subagent:async-complete", { id: "run-b" });
payload = latestPayload();
const completedAsync = payload.runs.find((run) => run.id === "run-b");
assert.deepEqual(completedAsync && {
  status: completedAsync.status,
  endedAt: typeof completedAsync.endedAt,
  agentStatuses: completedAsync.agents.map((agent) => agent.status),
}, {
  status: "done",
  endedAt: "number",
  agentStatuses: ["done", "done"],
}, "async completion should retain a final run rather than deleting it");

bus.emit("subagent:async-started", { id: "run-authoritative-absence", mode: "single", agent: "absence-tester" });
const replyWithEmptyAuthoritativeFleet = () => {
  subagentRpcReplyHook = (request) => {
    if (request.method !== "status" || Object.keys(request.params || {}).length) return false;
    subagentRpcReplyHook = null;
    bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      method: request.method,
      success: true,
      data: { text: "No active async runs.", details: { mode: "management", results: [] }, fleet: { version: 1, entries: [], totalActive: 0, omitted: 0 } },
    });
    return true;
  };
  bus.emit("subagents:rpc:v1:ready", { version: 1 });
};
replyWithEmptyAuthoritativeFleet();
await new Promise((resolve) => setTimeout(resolve, 0));
payload = latestPayload();
assert.equal(payload.runs.find((run) => run.id === "run-authoritative-absence")?.status, "running", "one authoritative omission must not finish a tracked run");
replyWithEmptyAuthoritativeFleet();
await new Promise((resolve) => setTimeout(resolve, 0));
payload = latestPayload();
assert.equal(payload.runs.find((run) => run.id === "run-authoritative-absence")?.status, "done", "repeated authoritative absence in one generation should finish a tracked run");

const persistedSnapshot = branchEntries.at(-1);
assert.equal(persistedSnapshot?.customType, "webui-subagent-retained-runs-v1", "the latest parent-session custom entry should own retained run state");
assert.equal(persistedSnapshot?.data?.version, 1);
assert.equal(persistedSnapshot?.data?.runs?.find((run) => run.id === "run-a")?.agents?.[0]?.transcript, undefined, "retained snapshots should store output locators rather than redundant transcripts");

for (const handler of extensionHandlers.get("session_start") || []) await handler({ reason: "resume" }, ctx);
payload = latestPayload();
assert.equal(payload.runs.find((run) => run.id === "run-a")?.status, "cancelled", "resuming the same parent session should restore retained cancellation state");
assert.equal(payload.runs.find((run) => run.id === "run-b")?.status, "done", "resuming the same parent session should restore completed runs");
await helperCommand.handler(JSON.stringify({
  requestId: "restored-async-output",
  action: "subagent-output",
  payload: { runId: "run-a", agentId: "run-a:step:0:reviewer" },
}), ctx);
const restoredOutput = helperResponse("restored-async-output");
assert.equal(restoredOutput.ok, true, "retained async output should remain accessible after a parent-session resume");
assert.equal(restoredOutput.data.agent.status, "cancelled");
assert.equal(restoredOutput.data.agent.telemetry.inputTokens, 300, "retained runs should re-read bounded telemetry from a still-available child session locator");

let staleGenerationRequest = null;
let replacementGenerationRequest = null;
subagentRpcReplyHook = (request) => {
  if (request.method !== "status" || Object.keys(request.params || {}).length) return false;
  if (!staleGenerationRequest) {
    staleGenerationRequest = request;
    return true;
  }
  replacementGenerationRequest = request;
  subagentRpcReplyHook = null;
  bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
    version: 1,
    requestId: request.requestId,
    method: request.method,
    success: true,
    data: { text: "No active async runs.", details: { mode: "management", results: [] }, fleet: { version: 1, entries: [], totalActive: 0, omitted: 0 } },
  });
  return true;
};
bus.emit("subagents:rpc:v1:ready", { version: 1 });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(staleGenerationRequest, "the stale-generation regression should hold an old poll response");
for (const handler of extensionHandlers.get("session_tree") || []) await handler({ reason: "stale-poll-switch" }, ctx);
for (let attempt = 0; attempt < 20 && !replacementGenerationRequest; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
assert.ok(replacementGenerationRequest, "session_tree should immediately poll the replacement generation");
bus.emit(`subagents:rpc:v1:reply:${staleGenerationRequest.requestId}`, {
  version: 1,
  requestId: staleGenerationRequest.requestId,
  method: staleGenerationRequest.method,
  success: true,
  data: {
    text: "No active async runs.",
    details: { mode: "management", results: [] },
    fleet: {
      version: 1,
      entries: [{ key: "fleet-stale", agent: "stale-agent", startedAt: Date.now(), tokens: { input: 0, output: 0, total: 0 } }],
      totalActive: 1,
      omitted: 0,
    },
  },
});
await new Promise((resolve) => setTimeout(resolve, 0));
payload = latestPayload();
assert.equal(payload.runs.some((run) => run.id === "fleet:fleet-stale"), false, "a pre-session_tree response must not overwrite the replacement generation");

const retainedParentBranch = branchEntries;
branchEntries = [];
for (const handler of extensionHandlers.get("session_tree") || []) await handler({ reason: "different-branch" }, ctx);
payload = latestPayload();
assert.equal(payload.runs.some((run) => ["run-a", "run-b", "foreground-cancel"].includes(run.id)), false, "a different parent branch must not inherit retained runs");
branchEntries = retainedParentBranch;
for (const handler of extensionHandlers.get("session_tree") || []) await handler({ reason: "return-to-parent-branch" }, ctx);
payload = latestPayload();
assert.equal(payload.runs.find((run) => run.id === "run-a")?.status, "cancelled", "returning to the parent branch should restore its retained runs");

await helperCommand.handler(JSON.stringify({
  requestId: "dismiss-cancelled-async",
  action: "subagent-dismiss",
  payload: { runId: "run-a" },
}), ctx);
assert.equal(helperResponse("dismiss-cancelled-async").ok, true, "dismiss should accept a retained cancelled run");
assert.equal(branchEntries.at(-1)?.data?.runs?.some((run) => run.id === "run-a"), false, "dismiss should persist a tombstone snapshot without the removed run");
for (const handler of extensionHandlers.get("session_start") || []) await handler({ reason: "resume" }, ctx);
payload = latestPayload();
assert.equal(payload.runs.some((run) => run.id === "run-a"), false, "a dismissed run must remain absent after resume");

for (let index = 0; index < 17; index += 1) {
  const runId = `retention-cap-${index}`;
  for (const handler of extensionHandlers.get("tool_execution_start") || []) {
    handler({ type: "tool_execution_start", toolCallId: runId, toolName: "subagent", args: { agent: "tester" } }, ctx);
  }
  for (const handler of extensionHandlers.get("tool_execution_end") || []) {
    handler({ type: "tool_execution_end", toolCallId: runId, toolName: "subagent" }, ctx);
  }
}
payload = latestPayload();
assert.ok(payload.runs.filter((run) => run.source !== "workflow" && run.status !== "running").length <= 16, "ordinary retained runs should enforce the 16-run finished retention cap");

// --- canonical agent-run protocol (v2) ---------------------------------------

for (const handler of extensionHandlers.get("tool_execution_start") || []) {
  handler({ type: "tool_execution_start", toolCallId: "canon-run", toolName: "subagent", args: { agent: "reviewer" } }, ctx);
}
let canonical = latestCanonicalPayload();
assert.equal(canonical.version, 2, "the canonical status key should carry the v2 envelope");
const canonicalAgent = canonical.instances.find((instance) => instance.runId === "canon-run");
assert.ok(canonicalAgent, "a live pi-subagents run should project a canonical instance");
assert.equal(canonicalAgent.version, 1, "canonical instances stay on protocol version 1");
assert.equal(canonicalAgent.launcher, "pi-subagents");
assert.equal(canonicalAgent.provider, "pi-subagents");
assert.equal(canonicalAgent.status, "running");
assert.equal(canonicalAgent.capabilities.cancel, true, "the owning pi-subagents lifecycle keeps cancel authority");
assert.equal(canonicalAgent.capabilities.steer, false, "v1 never advertises steer");
assert.equal(canonicalAgent.outputRef.kind, "helper");
assert.match(canonicalAgent.outputRef.id, /^h-[0-9a-f]{32}$/, "helper output handles must be opaque");
assert.equal(JSON.stringify(canonical).includes(asyncRunDir), false, "canonical snapshots must not disclose host paths");

await helperCommand.handler(JSON.stringify({
  requestId: "canon-output",
  action: "subagent-output",
  payload: { outputId: canonicalAgent.outputRef.id },
}), ctx);
const canonicalOutput = helperResponse("canon-output");
assert.equal(canonicalOutput.ok, true, "an opaque helper handle should resolve output");
assert.equal(canonicalOutput.data.runId, "canon-run");

await helperCommand.handler(JSON.stringify({
  requestId: "canon-output-unknown",
  action: "subagent-output",
  payload: { outputId: "h-00000000000000000000000000000000" },
}), ctx);
assert.equal(helperResponse("canon-output-unknown").ok, false, "an unknown output handle must be rejected, not guessed");

const providerInstance = (overrides = {}) => ({
  version: 1,
  instanceId: "sdk-instance-1",
  runId: "sdk-run-1",
  launcher: "sdk",
  provider: "webui-registry",
  name: "sdk worker",
  status: "running",
  startedAt: Date.now() - 1000,
  updatedAt: Date.now(),
  endedAt: null,
  ...overrides,
});

bus.emit("firstpick:webui-agent-runs:v1", {
  version: 1,
  producerId: "custom-alpha",
  complete: true,
  instances: [providerInstance()],
});
canonical = latestCanonicalPayload();
assert.ok(canonical.instances.some((instance) => instance.instanceId === "sdk-instance-1"), "a valid provider snapshot should be ingested");
assert.ok(canonical.producers.includes("custom-alpha"));

bus.emit("firstpick:webui-agent-runs:v1", {
  version: 1,
  producerId: "custom-beta",
  complete: true,
  instances: [providerInstance({ instanceId: "beta-instance-1", runId: "beta-run-1", launcher: "pi-print" })],
});
canonical = latestCanonicalPayload();
assert.ok(canonical.instances.some((instance) => instance.instanceId === "sdk-instance-1"), "a complete snapshot must only clear its own producer's rows");
assert.ok(canonical.instances.some((instance) => instance.instanceId === "beta-instance-1"));

const instancesBeforeMalformed = canonical.instances.length;
bus.emit("firstpick:webui-agent-runs:v1", { version: 1, producerId: "custom-alpha", complete: true, instances: [{ version: 1, instanceId: "../escape" }] });
bus.emit("firstpick:webui-agent-runs:v1", { version: 9, producerId: "custom-alpha", complete: true, instances: [] });
canonical = latestCanonicalPayload();
assert.equal(canonical.instances.length, instancesBeforeMalformed, "a malformed snapshot must not clear valid rows");
assert.ok(canonical.diagnostics.some((entry) => entry.code === "invalid-provider-snapshot"), "malformed snapshots should surface a bounded diagnostic");

const countBeforeDuplicate = canonical.instances.length;
bus.emit("firstpick:webui-agent-runs:v1", {
  version: 1,
  producerId: "custom-duplicate",
  complete: true,
  instances: [providerInstance({
    instanceId: canonicalAgent.instanceId,
    runId: canonicalAgent.runId,
    launcher: "custom",
    provider: "custom-duplicate",
    capabilities: { open: true, refresh: true, cancel: true, steer: true },
  })],
});
canonical = latestCanonicalPayload();
assert.equal(canonical.instances.length, countBeforeDuplicate, "a second observer of the same instance must not add a count");
const deduplicated = canonical.instances.find((instance) => instance.instanceId === canonicalAgent.instanceId);
assert.equal(deduplicated.provider, "pi-subagents", "the owning provider keeps the row");
assert.equal(deduplicated.capabilities.steer, false, "a foreign producer must not seize capabilities");

const instancesBeforeGate = canonical.instances.length;
bus.emit("webui:subagent-gate:v1:update", {
  version: 1,
  id: "canon-gate",
  status: "running",
  requiredSuccesses: 1,
  qualifyingSuccesses: 0,
  requireDistinctProviders: false,
  startedAt: Date.now() - 500,
  updatedAt: Date.now(),
  attempts: [
    { id: "canon-gate:0:1", taskIndex: 0, attempt: 1, maxAttempts: 1, agent: "reviewer", retrySafety: "read-only", runId: "canon-run", status: "running" },
    { id: "canon-gate:1:1", taskIndex: 1, attempt: 1, maxAttempts: 1, agent: "reviewer", retrySafety: "read-only", runId: "never-launched", status: "failed", failureKind: "pre-launch" },
  ],
});
canonical = latestCanonicalPayload();
assert.equal(canonical.instances.length, instancesBeforeGate, "gate attempts must never add canonical agent counts");
const resolvedReference = canonical.gateReferences.find((reference) => reference.attemptId === "canon-gate:0:1");
assert.ok(resolvedReference?.resolved, "a gate attempt should reference its canonical child");
assert.deepEqual(resolvedReference.instanceIds, [canonicalAgent.instanceId]);
assert.equal(canonical.gateReferences.find((reference) => reference.attemptId === "canon-gate:1:1")?.resolved, false, "a pre-launch failure stays gate history only");
assert.equal(canonical.instances.find((instance) => instance.instanceId === canonicalAgent.instanceId)?.launcher, "gate", "a gate-launched child reports the gate launch family");

for (const handler of extensionHandlers.get("tool_execution_end") || []) {
  handler({ type: "tool_execution_end", toolCallId: "canon-run", toolName: "subagent" }, ctx);
}
canonical = latestCanonicalPayload();
const retainedCanonical = canonical.instances.find((instance) => instance.instanceId === canonicalAgent.instanceId);
assert.equal(retainedCanonical.status, "done", "a terminal run keeps an explicit terminal status");
assert.ok(Number.isSafeInteger(retainedCanonical.endedAt), "terminal instances carry endedAt");
assert.equal(retainedCanonical.capabilities.cancel, false, "a finished run stops advertising cancel");
assert.equal(retainedCanonical.capabilities.open, true, "retained rows stay openable");

bus.emit("firstpick:webui-agent-runs:v1", {
  version: 1,
  producerId: "custom-duplicate",
  complete: true,
  instances: [providerInstance({
    instanceId: canonicalAgent.instanceId,
    runId: canonicalAgent.runId,
    launcher: "custom",
    provider: "custom-duplicate",
    status: "done",
    updatedAt: retainedCanonical.endedAt,
    endedAt: retainedCanonical.endedAt,
    capabilities: { open: true, refresh: true, cancel: false, steer: false },
  })],
});
await helperCommand.handler(JSON.stringify({
  requestId: "dismiss-terminal-duplicate-projection",
  action: "subagent-dismiss",
  payload: { runId: "canon-run" },
}), ctx);
assert.equal(helperResponse("dismiss-terminal-duplicate-projection").ok, true, "the terminal owning run should accept dismissal");
canonical = latestCanonicalPayload();
assert.equal(canonical.instances.some((instance) => instance.instanceId === canonicalAgent.instanceId), false, "dismissal should suppress a terminal run still present in a duplicate provider snapshot");

bus.emit("firstpick:webui-agent-runs:v1", {
  version: 1,
  producerId: "custom-duplicate",
  complete: true,
  instances: [providerInstance({
    instanceId: canonicalAgent.instanceId,
    runId: canonicalAgent.runId,
    launcher: "custom",
    provider: "custom-duplicate",
    status: "running",
    startedAt: retainedCanonical.endedAt + 1,
    updatedAt: retainedCanonical.endedAt + 1,
    endedAt: null,
  })],
});
canonical = latestCanonicalPayload();
assert.equal(canonical.instances.find((instance) => instance.instanceId === canonicalAgent.instanceId)?.status, "running", "a newer provider lifecycle should release the local dismissal tombstone");
bus.emit("firstpick:webui-agent-runs:v1", { version: 1, producerId: "custom-duplicate", complete: true, instances: [] });

for (const handler of extensionHandlers.get("session_shutdown") || []) await handler({ reason: "quit" }, ctx);
unsubscribeRpc();
delete process.env.PI_WEBUI_SETTINGS_FILE;
await rm(asyncRunDir, { recursive: true, force: true });

console.log("subagents-helper.test.mjs passed");
