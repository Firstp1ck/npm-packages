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
  appendEntry() {},
};

const ctx = {
  mode: "rpc",
  hasUI: true,
  cwd: "/tmp/subagent-helper-test",
  sessionManager: {
    getBranch() { return []; },
  },
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
  const text = request.params?.id === "run-a"
    ? `Run: run-a\nState: running\nMode: parallel\nDir: ${asyncRunDir}`
    : statusText;
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

const helperCommand = registeredCommands.get("webui-helper");
assert.ok(helperCommand?.handler, "Web UI helper command should be registered");
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
assert.equal(payload.runs.some((run) => run.source === "foreground"), false, "foreground children should disappear when their tool finishes");

for (const handler of extensionHandlers.get("session_shutdown") || []) await handler({ reason: "quit" }, ctx);
unsubscribeRpc();
delete process.env.PI_WEBUI_SETTINGS_FILE;
await rm(asyncRunDir, { recursive: true, force: true });

console.log("subagents-helper.test.mjs passed");
