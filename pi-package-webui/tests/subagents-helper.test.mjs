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
  JSON.stringify({ type: "message", timestamp: "2026-07-19T12:00:00.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checking structured transcript extraction" }, { type: "text", text: "REVIEWER STREAM 1 OF 18" }, { type: "toolCall", id: "review-call", name: "bash", arguments: { command: "sleep 5" } }, { type: "text", text: "Review complete." }] } }),
  JSON.stringify({ type: "message", timestamp: "2026-07-19T12:00:01.000Z", message: { role: "toolResult", toolCallId: "review-call", toolName: "bash", isError: false, content: [{ type: "text", text: "(no output)\nreviewer tool output line" }] } }),
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
    : statusText;
  subagentRpcReplyHook?.(request);
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
assert.equal(payload.gates.length, 1, "helper should publish retry gate lifecycle alongside running children");
assert.equal(payload.gates[0].qualifyingSuccesses, 1);
assert.deepEqual(payload.gates[0].attempts.map((attempt) => [attempt.status, attempt.failureKind]), [["succeeded", undefined], ["failed", "transient-provider"]]);

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

for (const handler of extensionHandlers.get("session_shutdown") || []) await handler({ reason: "quit" }, ctx);
unsubscribeRpc();
delete process.env.PI_WEBUI_SETTINGS_FILE;
await rm(asyncRunDir, { recursive: true, force: true });

console.log("subagents-helper.test.mjs passed");
