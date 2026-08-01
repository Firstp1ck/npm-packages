import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await readFile(join(root, "bin", "pi-webui.mjs"), "utf8");
const app = await readFile(join(root, "public", "app.js"), "utf8");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  const next = source.slice(start + 1).match(/\n(?:async )?function [A-Za-z0-9_$]+\(/);
  const end = next ? start + 1 + next.index : source.length;
  return source.slice(start, end);
}

const context = vm.createContext({ console });
vm.runInContext(`
  const TAB_ACTIVITY_IDLE_RECONCILE_GRACE_MS = 1200;
  // The production server imports randomUUID from node:crypto; keep the
  // extracted lifecycle contract deterministic while exercising run creation.
  function randomUUID() { return "run_12345678"; }
  function pendingExtensionUiRequests() { return []; }
  function patchTabState(tab, patch) { tab.lastState = { ...(tab.lastState || {}), ...patch }; }
  function rememberTabState(tab, state) { tab.lastState = state; }

  ${functionSource(server, "createTabActivity")}
  ${functionSource(server, "tabActivitySnapshot")}
  ${functionSource(server, "markTabWorking")}
  ${functionSource(server, "markTabDone")}
  ${functionSource(server, "markTabFailed")}
  ${functionSource(server, "markTabIdle")}
  ${functionSource(server, "stateHasVisibleWork")}
  ${functionSource(server, "activityRecentlyStarted")}
  ${functionSource(server, "reconcileTabActivityFromState")}
  ${functionSource(server, "updateTabActivityFromEvent")}

  globalThis.activityContract = {
    createTab() { return { activity: createTabActivity(), lastState: {} }; },
    event(tab, event) { return updateTabActivityFromEvent(tab, event); },
    submit(tab, timestamp) { markTabWorking(tab, timestamp); return tabActivitySnapshot(tab); },
    start(tab, timestamp) { markTabWorking(tab, timestamp, { runStarted: true }); return tabActivitySnapshot(tab); },
    reconcile(tab, state, timestamp) { return reconcileTabActivityFromState(tab, state, timestamp); },
  };
`, context);

const contract = context.activityContract;
const tab = contract.createTab();
assert.equal(tab.activity.completionSerial, 0);
assert.equal(tab.activity.runStarted, false);

contract.event(tab, { type: "agent_start" });
assert.equal(tab.activity.isWorking, true);
assert.equal(tab.activity.runStarted, true);
assert.equal(tab.lastState.isStreaming, true);

contract.event(tab, { type: "agent_end" });
assert.equal(tab.activity.isWorking, true, "agent_end is only a low-level run boundary");
assert.equal(tab.activity.completionSerial, 0, "agent_end must not create a completion");
assert.equal(tab.lastState.isStreaming, true, "agent_end must not expose an idle window before continuation");

contract.event(tab, { type: "agent_settled" });
assert.equal(tab.activity.isWorking, false);
assert.equal(tab.activity.status, "done");
assert.equal(tab.activity.completionSerial, 1, "settlement should create exactly one completion");
assert.equal(tab.lastState.isStreaming, false);

contract.event(tab, { type: "agent_settled" });
assert.equal(tab.activity.status, "done", "duplicate settlement should preserve the completed state");
assert.equal(tab.activity.completionSerial, 1, "duplicate settlement must be idempotent");

const handledPromptTab = contract.createTab();
contract.submit(handledPromptTab, "2020-01-01T00:00:00.000Z");
contract.reconcile(handledPromptTab, { isStreaming: false, isCompacting: false, pendingMessageCount: 0 }, "2020-01-01T00:00:02.000Z");
assert.equal(handledPromptTab.activity.status, "idle", "a handled prompt without agent_start should return to idle");
assert.equal(handledPromptTab.activity.completionSerial, 0, "a handled prompt must not look completed");

const missedSettlementTab = contract.createTab();
contract.start(missedSettlementTab, "2020-01-01T00:00:00.000Z");
contract.reconcile(missedSettlementTab, { isStreaming: false, isCompacting: false, pendingMessageCount: 0 }, "2020-01-01T00:00:02.000Z");
assert.equal(missedSettlementTab.activity.completionSerial, 1, "authoritative idle may recover a missed settlement only after a real start");

const compactionTab = contract.createTab();
contract.event(compactionTab, { type: "compaction_start" });
contract.event(compactionTab, { type: "compaction_end" });
assert.equal(compactionTab.activity.status, "idle");
assert.equal(compactionTab.activity.completionSerial, 0, "standalone compaction must not emit agent completion");

const failedTurnTab = contract.createTab();
contract.event(failedTurnTab, { type: "agent_start" });
contract.event(failedTurnTab, { type: "message_end", message: { role: "assistant", stopReason: "error" } });
contract.event(failedTurnTab, { type: "agent_settled" });
assert.equal(failedTurnTab.activity.status, "failed", "a terminal assistant error must remain distinct from successful completion");
assert.equal(failedTurnTab.activity.completionSerial, 1);

const failedProcessTab = contract.createTab();
contract.event(failedProcessTab, { type: "agent_start" });
contract.event(failedProcessTab, { type: "pi_process_error" });
assert.equal(failedProcessTab.activity.status, "failed");
assert.equal(failedProcessTab.activity.completionSerial, 1, "a failed process must create one failed completion, not a successful one");

assert.match(app, /case "agent_settled":[\s\S]*?notifyAgentDone\(/, "the browser should notify only from settlement");
assert.doesNotMatch(functionSource(app, "handleInactiveTabEvent"), /event\.type === "agent_end"[\s\S]*?notifyAgentDone/, "background low-level run ends must not notify");
assert.doesNotMatch(app.match(/case "agent_end":[\s\S]*?case "message_start":/)?.[0] || "", /notifyAgentDone|isStreaming: false/, "active low-level run ends must not notify or look idle");
assert.match(functionSource(app, "markTabWorkingLocally"), /suppressPendingAgentDoneNotificationsForTab\(tabId\)/, "starting new work should cancel a delayed stale completion notification");
assert.match(functionSource(app, "queueAgentDoneBrowserNotification"), /activityForTab\(tab\)\.isWorking/, "the delayed notification should re-check that the tab is still idle");

const notificationContext = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(`
  const AGENT_DONE_NOTIFICATION_RETRY_GRACE_MS = 5;
  let tabs = [{ id: "tab-1", working: false }];
  let promptRoutingTabs = new Set();
  let autoRetryingTabs = new Set();
  let pendingAgentDoneNotificationTimers = new Map();
  let agentDoneNotificationKeys = new Set();
  let shown = [];
  function activityForTab(tab) { return { isWorking: tab?.working === true }; }
  function isAutoRetryingTab(tabId) { return autoRetryingTabs.has(tabId); }
  function showAgentDoneBrowserNotification(payload) { shown.push(payload); }

  ${functionSource(app, "clearPendingAgentDoneNotification")}
  ${functionSource(app, "queueAgentDoneBrowserNotification")}

  globalThis.notificationContract = {
    queue(key) { queueAgentDoneBrowserNotification({ key, tabId: "tab-1", title: "done", body: "done" }); },
    setWorking(value) { tabs[0].working = value; },
    setRouting(value) { if (value) promptRoutingTabs.add("tab-1"); else promptRoutingTabs.delete("tab-1"); },
    setRetrying(value) { if (value) autoRetryingTabs.add("tab-1"); else autoRetryingTabs.delete("tab-1"); },
    shown() { return shown.length; },
    reset() {
      for (const pending of pendingAgentDoneNotificationTimers.values()) clearTimeout(pending.timer);
      pendingAgentDoneNotificationTimers.clear();
      promptRoutingTabs.clear();
      autoRetryingTabs.clear();
      tabs[0].working = false;
      shown = [];
    },
  };
`, notificationContext);

const notifications = notificationContext.notificationContract;
const waitForNotificationTimer = () => new Promise((resolve) => setTimeout(resolve, 20));
notifications.queue("idle");
await waitForNotificationTimer();
assert.equal(notifications.shown(), 1, "an idle settled tab should notify once");

notifications.reset();
notifications.queue("new-work");
notifications.setWorking(true);
await waitForNotificationTimer();
assert.equal(notifications.shown(), 0, "new work during the grace window should suppress the stale done notification");

notifications.reset();
notifications.queue("routing");
notifications.setRouting(true);
await waitForNotificationTimer();
assert.equal(notifications.shown(), 0, "prompt routing during the grace window should suppress the stale done notification");

notifications.reset();
notifications.queue("retry");
notifications.setRetrying(true);
await waitForNotificationTimer();
assert.equal(notifications.shown(), 0, "an automatic retry should suppress an intermediate done notification");

console.log("completion signal contract checks passed");
