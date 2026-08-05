import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

function functionDeclaration(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} should be defined`);
  let parens = 0;
  let open = -1;
  for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
    if (source[index] === "(") parens += 1;
    else if (source[index] === ")") parens -= 1;
    else if (source[index] === "{" && parens === 0) {
      open = index;
      break;
    }
  }
  assert.notEqual(open, -1, `${name} should open`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(match.index, index + 1);
  }
  assert.fail(`${name} should close`);
}

const handleEventSource = functionDeclaration(app, "handleEvent");
const inactiveTabGuardIndex = handleEventSource.indexOf("if (!eventTargetsActiveTab(event))");
const runEpochAdvanceIndex = handleEventSource.indexOf('if (event?.type === "agent_start") beginToolBoundaryRun(event);');
assert.ok(runEpochAdvanceIndex >= 0 && runEpochAdvanceIndex < inactiveTabGuardIndex, "agent_start must advance tool-run identity before inactive-tab routing");
assert.equal((handleEventSource.match(/beginToolBoundaryRun\(event\)/g) || []).length, 1, "agent_start must advance the tool-run epoch exactly once");

// Execute the production partitioning helpers directly. An immediate switch to
// tab B must not merge or drop tab A's settlement/workflow flags.
{
  const declarations = [
    "semanticReconcileContextKey",
    "mergeSemanticReconcileRequest",
    "takeSemanticReconcileRequests",
  ].map((name) => functionDeclaration(app, name)).join("\n");
  const createHarness = new Function("SEMANTIC_RECONCILE_FLAGS", `${declarations}\nreturn { mergeSemanticReconcileRequest, takeSemanticReconcileRequests };`);
  const harness = createHarness(["messages", "state", "footer", "footerData", "feedback", "usage", "workflow"]);
  const pending = new Map();
  const tabA = { tabId: "tab-a", generation: 11 };
  const tabB = { tabId: "tab-b", generation: 12 };

  harness.mergeSemanticReconcileRequest(pending, { state: true, workflow: true }, tabA);
  harness.mergeSemanticReconcileRequest(pending, { footer: true }, tabB);
  harness.mergeSemanticReconcileRequest(pending, { messages: true }, tabA);
  const requests = harness.takeSemanticReconcileRequests(pending);
  assert.equal(pending.size, 0);
  assert.equal(requests.length, 2, "tab generations must retain independent reconciliation requests");
  const requestA = requests.find((request) => request.tabContext.tabId === "tab-a");
  const requestB = requests.find((request) => request.tabContext.tabId === "tab-b");
  assert.deepEqual(requestA, { tabContext: tabA, dirty: { state: true, workflow: true, messages: true } });
  assert.deepEqual(requestB, { tabContext: tabB, dirty: { footer: true } });

  const current = tabB;
  const workflowTabs = requests.filter(({ dirty }) => dirty.workflow).map(({ tabContext }) => tabContext.tabId);
  const activeDomRequests = requests.filter(({ tabContext }) => tabContext.tabId === current.tabId && tabContext.generation === current.generation);
  assert.deepEqual(workflowTabs, ["tab-a"], "originating-tab workflow settlement must survive the immediate switch");
  assert.deepEqual(activeDomRequests.map(({ dirty }) => dirty), [{ footer: true }], "stale tab A DOM work must not be reassigned to tab B");
}

// Execute the production run-key/dedupe path with a deterministic skill sink.
// Replays dedupe, a new run may reuse an ID, and unusable start args leave the
// completion fallback available.
{
  const declarations = [
    "beginToolBoundaryRun",
    "toolBoundaryRunIdentity",
    "toolBoundaryRecordKey",
    "rememberToolBoundaryRecordKey",
    "claimToolBoundaryRecord",
    "trackSkillsFromEvent",
  ].map((name) => functionDeclaration(app, name)).join("\n");
  const createHarness = new Function(`
    let activeTabId = "tab-a";
    const TOOL_BOUNDARY_RECORD_LIMIT = 400;
    const toolBoundaryRunEpochByTab = new Map();
    const recordedToolBoundaryKeys = new Set();
    const tracked = [];
    function trackSkillsFromToolInvocation(tabId, toolName, args, options) {
      const usable = String(toolName || "").toLowerCase() === "read" && typeof args?.path === "string" && args.path.endsWith("SKILL.md");
      if (usable) tracked.push({ tabId, path: args.path, source: options.sourcePrefix });
      return usable;
    }
    function clearSkillUsageForTab() {}
    ${declarations}
    return { beginToolBoundaryRun, claimToolBoundaryRecord, trackSkillsFromEvent, tracked, recordedToolBoundaryKeys, toolBoundaryRunEpochByTab };
  `);
  const harness = createHarness();
  const skillPath = "/tmp/example/SKILL.md";

  harness.beginToolBoundaryRun({ type: "agent_start", tabId: "tab-a" });
  const first = { type: "tool_execution_start", tabId: "tab-a", toolCallId: "same-id", toolName: "read", args: { path: skillPath } };
  harness.trackSkillsFromEvent(first);
  harness.trackSkillsFromEvent({ ...first, replayed: true });
  assert.equal(harness.tracked.length, 1, "replayed boundaries in one run must dedupe");

  harness.beginToolBoundaryRun({ type: "agent_start", tabId: "tab-a", replayed: true });
  harness.trackSkillsFromEvent(first);
  assert.equal(harness.tracked.length, 1, "a replayed agent_start must not create a new run epoch");

  harness.beginToolBoundaryRun({ type: "agent_start", tabId: "tab-a" });
  harness.trackSkillsFromEvent(first);
  assert.equal(harness.tracked.length, 2, "the same tool ID must be recordable in a new agent run");

  harness.beginToolBoundaryRun({ type: "agent_start", tabId: "tab-a" });
  const missingStart = { type: "tool_execution_start", tabId: "tab-a", toolCallId: "fallback-id", toolName: "read", args: {} };
  harness.trackSkillsFromEvent(missingStart);
  assert.equal(harness.tracked.length, 2, "unusable start args must not create a false skill record");
  const usableEnd = { ...missingStart, type: "tool_execution_end", args: { path: skillPath } };
  harness.trackSkillsFromEvent(usableEnd);
  harness.trackSkillsFromEvent({ ...usableEnd, replayed: true });
  assert.equal(harness.tracked.length, 3, "completion should fill missing start data once and still dedupe replay");

  const inactiveTool = { type: "tool_execution_start", tabId: "tab-b", toolCallId: "inactive-same-id", toolName: "read", args: { path: skillPath } };
  harness.beginToolBoundaryRun({ type: "agent_start", tabId: "tab-b" });
  harness.trackSkillsFromEvent(inactiveTool);
  harness.beginToolBoundaryRun({ type: "agent_start", tabId: "tab-b" });
  harness.trackSkillsFromEvent(inactiveTool);
  assert.equal(harness.tracked.length, 5, "an inactive tab must record a reused tool ID once in each new run");
  assert.equal(harness.toolBoundaryRunEpochByTab.get("tab-b"), 2, "inactive agent starts must advance their tab-local run epoch");
}

assert.match(packageJson.scripts.check, /node --check public\/stream-output-controller\.mjs/, "canonical npm check must syntax-check the startup stream controller");

console.log("stream-lifecycle-core.test.mjs passed");
