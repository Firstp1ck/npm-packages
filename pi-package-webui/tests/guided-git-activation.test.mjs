import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDED_GIT_START_PAYLOAD_MAX_BYTES,
  GUIDED_GIT_START_PAYLOAD_TYPE,
  GUIDED_GIT_START_PAYLOAD_VERSION,
  GUIDED_GIT_START_STATUS_KEY,
  createGuidedGitActivationController,
  createGuidedGitLaunchPermitController,
  guidedGitLaunchBlockedReason,
  guidedGitLaunchModeForTabCatalog,
  guidedGitWorkflowCommandForTabCatalog,
  parseGuidedGitStartPayload,
  resolveCommandForTabCatalog,
} from "../public/guided-git-command-state.mjs";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

function payload(requestId = ids[0], patch = {}) {
  return JSON.stringify({
    type: GUIDED_GIT_START_PAYLOAD_TYPE,
    version: GUIDED_GIT_START_PAYLOAD_VERSION,
    action: "start",
    requestId,
    ...patch,
  });
}

function request(tabId, requestId = ids[0], patch = {}) {
  return {
    method: "setStatus",
    statusKey: GUIDED_GIT_START_STATUS_KEY,
    statusText: payload(requestId),
    tabId,
    ...patch,
  };
}

test("Guided Git activation parser accepts only the exact bounded v1 payload", () => {
  assert.deepEqual(parseGuidedGitStartPayload(payload()), {
    type: GUIDED_GIT_START_PAYLOAD_TYPE,
    version: 1,
    action: "start",
    requestId: ids[0],
  });

  for (const invalid of [
    "",
    "not json",
    "[]",
    JSON.stringify(null),
    payload(ids[0], { type: "other" }),
    payload(ids[0], { version: 2 }),
    payload(ids[0], { action: "restart" }),
    payload("not-a-uuid"),
    payload(ids[0], { extra: true }),
    "x".repeat(GUIDED_GIT_START_PAYLOAD_MAX_BYTES + 1),
  ]) assert.equal(parseGuidedGitStartPayload(invalid), null, `rejected: ${invalid.slice(0, 80)}`);
});

test("browser-local launch permits correlate one exact envelope and remain bounded", async () => {
  const originPermits = createGuidedGitLaunchPermitController({ maxTrackedTabs: 2, permitTtlMs: 50 });
  const otherClientPermits = createGuidedGitLaunchPermitController({ maxTrackedTabs: 2, permitTtlMs: 50 });
  const origin = createGuidedGitActivationController({ claimStart: (tabId, _payload, event, now) => originPermits.consume(tabId, event?.guidedGitLaunchId, now) });
  const otherClient = createGuidedGitActivationController({ claimStart: (tabId, _payload, event, now) => otherClientPermits.consume(tabId, event?.guidedGitLaunchId, now) });
  const starts = [];

  assert.equal(originPermits.grant("tab-a", ids[1], 100), true);
  assert.equal(otherClientPermits.grant("tab-a", ids[2], 100), true, "two browser clients may independently await server arbitration");
  assert.equal(originPermits.grant("tab-a", ids[3], 101), false, "one browser cannot queue multiple permits for one tab");
  const correlated = request("tab-a", ids[0], { guidedGitLaunchId: ids[1] });
  assert.equal(otherClient.consume(correlated, async () => starts.push("other"), 102).status, "unclaimed", "a concurrent client cannot cross-claim another launch");
  assert.equal(otherClientPermits.inspect().launchIdForTab("tab-a"), ids[2], "wrong envelopes do not consume orphan permits");
  const claimed = origin.consume(correlated, async () => starts.push("origin"), 102);
  assert.equal(claimed.status, "started");
  await claimed.promise;
  assert.deepEqual(starts, ["origin"]);
  assert.equal(originPermits.inspect().hasPermit("tab-a"), false);
  assert.equal(otherClient.consume(request("tab-a", ids[1]), async () => starts.push("missing"), 103).status, "unclaimed", "a missing launch envelope fails closed");
  assert.equal(otherClient.consume(request("tab-a", ids[2], { guidedGitLaunchId: ids[3] }), async () => starts.push("wrong"), 104).status, "unclaimed", "a wrong launch envelope fails closed");

  assert.equal(otherClientPermits.consume("tab-a", ids[2], 151), false, "expired permits fail closed");
  assert.equal(originPermits.grant("tab-a", ids[0], 300), true);
  assert.equal(originPermits.grant("tab-b", ids[1], 301), true);
  assert.equal(originPermits.grant("tab-c", ids[2], 302), true);
  assert.equal(originPermits.inspect().trackedTabs, 2);
  assert.equal(originPermits.inspect().hasPermit("tab-a"), false, "oldest tab permit is evicted at the count bound");
  originPermits.clearTab("tab-b");
  assert.equal(originPermits.inspect().hasPermit("tab-b"), false);
});

test("Guided Git launch admission recognizes tab-local aliases and refuses every non-idle state", () => {
  const catalog = {
    raw: [{ name: "git-guided-workflow:2", source: "extension", invokeName: "git-guided-workflow:2", duplicateCount: 2 }],
    available: [{ name: "git-guided-workflow", source: "extension", invokeName: "git-guided-workflow:2", duplicateNames: ["git-guided-workflow:2"], duplicateCount: 2 }],
  };
  assert.equal(guidedGitWorkflowCommandForTabCatalog(catalog, "/git-guided-workflow"), true);
  assert.equal(guidedGitWorkflowCommandForTabCatalog(catalog, "/git-guided-workflow:2"), true);
  assert.equal(guidedGitWorkflowCommandForTabCatalog(catalog, "/git-guided-workflow extra"), false);
  assert.equal(guidedGitWorkflowCommandForTabCatalog(catalog, "/other"), false);
  assert.equal(guidedGitLaunchBlockedReason(null, 0), "state-unavailable");
  assert.equal(guidedGitLaunchBlockedReason({ isStreaming: true, isCompacting: false, pendingMessageCount: 0 }, 0), "streaming");
  assert.equal(guidedGitLaunchBlockedReason({ isStreaming: false, isCompacting: true, pendingMessageCount: 0 }, 0), "compacting");
  assert.equal(guidedGitLaunchBlockedReason({ isStreaming: false, isCompacting: false, pendingMessageCount: 1 }, 0), "pending");
  assert.equal(guidedGitLaunchBlockedReason({ isStreaming: false, isCompacting: false, pendingMessageCount: 0 }, 1), "pending");
  assert.equal(guidedGitLaunchBlockedReason({ isStreaming: false, isCompacting: false, pendingMessageCount: 0 }, 0), "");
});

test("activation controller ignores clear and replay, deduplicates per tab, and clears tab state", async () => {
  const controller = createGuidedGitActivationController();
  const starts = [];
  const start = async (tabId) => { starts.push(tabId); };

  assert.equal(controller.consume({ tabId: "tab-a", statusText: undefined }, start).status, "ignored");
  assert.equal(controller.consume(request("tab-a", ids[0], { replayed: true }), start).status, "ignored");
  const first = controller.consume(request("tab-a"), start, 100);
  assert.equal(first.status, "started");
  await first.promise;
  assert.equal(controller.consume(request("tab-a"), start, 101).status, "duplicate");
  const otherTab = controller.consume(request("tab-b"), start, 102);
  assert.equal(otherTab.status, "started");
  await otherTab.promise;
  assert.deepEqual(starts, ["tab-a", "tab-b"]);

  controller.clearTab("tab-a");
  const afterClear = controller.consume(request("tab-a"), start, 103);
  assert.equal(afterClear.status, "started");
  await afterClear.promise;
  assert.equal(controller.inspect().seenForTab("tab-a"), 1);
});

test("clearing a tab invalidates ownership held by an asynchronous start", async () => {
  const controller = createGuidedGitActivationController();
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let activationIsCurrent;
  const promise = controller.run("tab-a", async (_tabId, isCurrent) => {
    activationIsCurrent = isCurrent;
    await blocked;
  });
  await Promise.resolve();
  assert.equal(activationIsCurrent(), true);
  controller.clearTab("tab-a");
  assert.equal(activationIsCurrent(), false);
  release();
  await promise;
  assert.equal(controller.inspect().inFlightTabs, 0);
});

test("activation controller folds rapid distinct starts and keeps dedupe storage bounded", async () => {
  const controller = createGuidedGitActivationController({ maxSeenPerTab: 2, maxTrackedTabs: 2, seenTtlMs: 50 });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let starts = 0;
  const start = async () => { starts += 1; await blocked; };

  const first = controller.consume(request("tab-a", ids[0]), start, 100);
  const folded = controller.consume(request("tab-a", ids[1]), start, 101);
  assert.equal(first.status, "started");
  assert.equal(folded.status, "folded");
  assert.equal(first.promise, folded.promise);
  await Promise.resolve();
  assert.equal(starts, 1);
  release();
  await first.promise;

  const third = controller.consume(request("tab-a", ids[2]), async () => {}, 102);
  await third.promise;
  assert.equal(controller.inspect().seenForTab("tab-a"), 2);
  const evicted = controller.consume(request("tab-a", ids[0]), async () => {}, 103);
  assert.equal(evicted.status, "started", "oldest per-tab request is evicted at the bound");
  await evicted.promise;

  await controller.consume(request("tab-b", ids[0]), async () => {}, 104).promise;
  await controller.consume(request("tab-c", ids[0]), async () => {}, 105).promise;
  assert.equal(controller.inspect().trackedTabs, 2);

  const expired = controller.consume(request("tab-c", ids[0]), async () => {}, 200);
  assert.equal(expired.status, "started", "expired request IDs may be accepted again");
  await expired.promise;
});

test("originating tab stays authoritative across an active-tab switch", async () => {
  const controller = createGuidedGitActivationController();
  let activeTabId = "tab-a";
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let startedTabId = "";
  const start = controller.consume(request("tab-a"), async (tabId) => {
    await blocked;
    startedTabId = tabId;
  });
  activeTabId = "tab-b";
  release();
  await start.promise;
  assert.equal(activeTabId, "tab-b");
  assert.equal(startedTabId, "tab-a", "the transport envelope tab, not the active browser tab, owns activation");
});

test("tab catalog resolves the duplicate-suffixed command and the exact fallback eligibility", () => {
  const catalog = {
    raw: [
      { name: "git-guided-workflow:2", source: "extension", invokeName: "git-guided-workflow:2", duplicateCount: 2 },
      { name: "git-staged-msg", source: "prompt" },
    ],
    available: [
      { name: "git-guided-workflow", source: "extension", invokeName: "git-guided-workflow:2", duplicateNames: ["git-guided-workflow:2"], duplicateCount: 2 },
      { name: "git-staged-msg", source: "prompt" },
    ],
  };
  assert.equal(resolveCommandForTabCatalog(catalog, "git-guided-workflow", { rpcOnly: true })?.name, "git-guided-workflow:2");
  assert.equal(guidedGitLaunchModeForTabCatalog(catalog), "extension");
  assert.equal(guidedGitLaunchModeForTabCatalog({ raw: [{ name: "git-staged-msg", source: "prompt" }] }), "fallback");
  assert.equal(guidedGitLaunchModeForTabCatalog({ raw: [] }), "unavailable");
  assert.equal(guidedGitLaunchModeForTabCatalog(catalog, { disabled: true }), "disabled");
});
