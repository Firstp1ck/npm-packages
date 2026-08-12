import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [server, app] = await Promise.all([
  readFile(join(root, "bin", "pi-webui.mjs"), "utf8").then((value) => value.replace(/\r\n/g, "\n")),
  readFile(join(root, "public", "app.js"), "utf8").then((value) => value.replace(/\r\n/g, "\n")),
]);

function sourceBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `expected source boundaries: ${start} -> ${end}`);
  return text.slice(startIndex, endIndex);
}

const normalizationSource = sourceBetween(
  server,
  "function normalizeWebuiSubagentText(",
  "\nfunction rememberWebuiSubagentsStatusEvent(",
);
const normalizationContext = {
  WEBUI_SUBAGENT_RUN_LIMIT: 128,
  WEBUI_SUBAGENT_AGENT_LIMIT: 256,
  WEBUI_SUBAGENT_GATE_LIMIT: 32,
  WEBUI_SUBAGENT_GATE_ATTEMPT_LIMIT: 100,
};
vm.runInNewContext(`${normalizationSource}\nthis.normalizePayload = normalizeWebuiSubagentPayload;`, normalizationContext);
const normalized = normalizationContext.normalizePayload({
  version: 1,
  available: true,
  updatedAt: 100,
  fleet: {
    version: 1,
    totalActive: 4,
    omitted: 3,
    entries: [{ key: "private-key", prompt: "private prompt", cwd: "C:/private" }],
    privatePath: "C:/private",
  },
  privatePrompt: "do not expose",
  runs: [{
    id: "fleet:opaque",
    source: "recovered",
    provisional: true,
    controllable: false,
    status: "running",
    startedAt: 10,
    prompt: "private child prompt",
    agents: [{ id: "fleet:opaque:agent", name: "Recovery scout", status: "running", model: "provider/model", thinking: "high", currentPath: "C:/private" }],
  }],
});
assert.deepEqual(JSON.parse(JSON.stringify(normalized.fleet)), { version: 1, totalActive: 4, omitted: 3 }, "server should expose only bounded fleet aggregates");
const ordinary = normalizationContext.normalizePayload({
  version: 1,
  runs: [{ id: "run-ordinary", source: "async", status: "running", agents: [{ name: "worker", status: "running" }] }],
});
assert.equal(Object.hasOwn(ordinary.runs[0], "provisional"), false, "ordinary payload v1 rows should not gain recovery-only provisional metadata");
assert.equal(Object.hasOwn(ordinary.runs[0], "controllable"), false, "ordinary payload v1 rows should not gain recovery-only control metadata");
assert.deepEqual(JSON.parse(JSON.stringify(normalized.runs[0])), {
  id: "fleet:opaque",
  source: "recovered",
  provisional: true,
  controllable: false,
  mode: "single",
  status: "running",
  startedAt: 10,
  agents: [{
    id: "fleet:opaque:agent",
    name: "Recovery scout",
    status: "running",
    index: 0,
    model: "provider/model",
    thinking: "high",
    nested: false,
  }],
}, "server should preserve public recovery flags without leaking prompt, path, or raw fleet-entry fields");
assert.equal(normalizationContext.normalizePayload({ version: 1, fleet: { version: 1, totalActive: 1, omitted: 2 }, runs: [] }).fleet, null, "invalid aggregate counts should be discarded");

const interactionSource = sourceBetween(
  server,
  "function webuiSubagentRunSupportsInteraction(",
  "\nfunction restorableTabDescriptor(",
);
assert.match(interactionSource, /source !== "recovered"[\s\S]*provisional !== true[\s\S]*controllable !== false/, "server should treat every unsupported recovery signal as non-interactive");
assert.match(interactionSource, /requireInteractiveWebuiSubagentRun[\s\S]*!webuiSubagentRunSupportsInteraction\(run\)[\s\S]*webuiSubagentOutputData[\s\S]*requireInteractiveWebuiSubagentRun/, "output lookup should reject unsupported rows before helper dispatch");
assert.match(server, /\/api\/subagents\/cancel[\s\S]*rejectUnsupportedWebuiSubagentRun\(tab, body\.runId\)[\s\S]*\/api\/subagents\/dismiss[\s\S]*rejectUnsupportedWebuiSubagentRun\(tab, body\.runId\)/, "cancel and dismiss routes should reject unsupported recovered rows before helper dispatch");

const renderAgentSource = sourceBetween(app, "function renderSubagentAgent(", "\nfunction renderSubagentRun(");
assert.match(renderAgentSource, /make\(interactive \? "button" : "div"[\s\S]*recovered active[\s\S]*if \(interactive\)[\s\S]*openSubagentOutput/, "recovered rows should use truthful non-button rendering with no output affordance");
const materializationSource = sourceBetween(app, "function materializeRetainedSubagentTerminalViews(", "\nfunction subagentTerminalViewGroups(");
assert.match(materializationSource, /!subagentRunSupportsInteraction\(run\)/, "unsupported rows should never materialize retained terminal views");
assert.match(app, /function subagentRunCanCancel[\s\S]*subagentRunSupportsInteraction\(run\)/, "unsupported rows should never expose cancellation");
assert.match(app, /function finishedSubagentRunSelections[\s\S]*subagentRunSupportsInteraction\(run\)/, "unsupported rows should never enter clear-finished dismissal selection");
const viewSyncSource = sourceBetween(app, "function syncSubagentTerminalViewsFromOverview(", "\nfunction materializeRetainedSubagentTerminalViews(");
assert.match(viewSyncSource, /run && !subagentRunSupportsInteraction\(run\)[\s\S]*subagentTerminalViews\.delete/, "a row that becomes provisional should close an existing terminal output view");
assert.match(viewSyncSource, /run && !subagentRunSupportsInteraction\(run\)[\s\S]*subagentOverlaySelection = null/, "a row that becomes provisional should close an existing output overlay");
assert.match(app, /async function openSubagentOverlay\(tab, run, agent\)[\s\S]*!subagentRunSupportsInteraction\(run\)/, "direct overlay entry should reject unsupported rows");
assert.match(app, /function subagentGateAttemptTarget\(tab, attempt\)[\s\S]*!subagentRunSupportsInteraction\(run\)/, "retry-gate output entry should reject unsupported rows");

const refreshSource = sourceBetween(app, "async function refreshSubagents(", "\nfunction scheduleRefreshSubagents(");
let resolveFirst;
let resolveSecond;
let apiCalls = 0;
const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
const secondResponse = new Promise((resolve) => { resolveSecond = resolve; });
const refreshContext = {
  subagentsRefreshPromise: null,
  subagentsRefreshQueued: false,
  subagentsLoading: false,
  latestSubagents: null,
  subagentsError: null,
  dismissedSubagentGateKeys: new Set(),
  subagentOverlaySelection: null,
  activeTabId: "tab-a",
  activeSubagentTerminalId: null,
  subagentAutoClearEnabled: false,
  renderSubagents() {},
  pruneDismissedSubagentGateKeys() {},
  syncSubagentTerminalViewsFromOverview() { return false; },
  materializeRetainedSubagentTerminalViews() { return false; },
  renderWidgets() {},
  renderSubagentTerminalView() {},
  scheduleSubagentTerminalRefresh() {},
  renderTabs() {},
  finishedSubagentRunSelections() { return []; },
  async clearFinishedSubagentRuns() {},
  api() {
    apiCalls += 1;
    return apiCalls === 1 ? firstResponse : secondResponse;
  },
};
vm.runInNewContext(`${refreshSource}\nthis.runRefreshSubagents = refreshSubagents;`, refreshContext);
const initialRefresh = refreshContext.runRefreshSubagents();
const overlappingRefresh = refreshContext.runRefreshSubagents();
assert.equal(apiCalls, 1, "an overlapping refresh should coalesce while the first request is in flight");
resolveFirst({ data: { revision: "stale" } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(apiCalls, 2, "an overlapping request should guarantee one trailing authoritative refresh");
resolveSecond({ data: { revision: "authoritative" } });
await Promise.all([initialRefresh, overlappingRefresh]);
assert.equal(refreshContext.latestSubagents?.revision, "authoritative", "the trailing refresh should own final browser state");
assert.equal(refreshContext.subagentsLoading, false, "coalesced refresh should release its loading guard");
assert.equal(refreshContext.subagentsRefreshPromise, null, "coalesced refresh should clear its shared promise");

console.log("subagent-reliability-integration.test.mjs passed");
