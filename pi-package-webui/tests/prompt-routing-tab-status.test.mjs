import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  const next = app.slice(start + 1).match(/\nfunction [A-Za-z0-9_$]+\(/);
  const end = next ? start + 1 + next.index : app.length;
  return app.slice(start, end);
}

const context = vm.createContext({ console });
vm.runInContext(`
  let activeTabId = "tab-1";
  let tabs = [{
    id: "tab-1",
    activity: {
      status: "done",
      isWorking: false,
      completionSerial: 2,
      lastStartedAt: "2020-01-01T00:00:00.000Z",
      lastChangedAt: "2020-01-01T00:00:01.000Z",
    },
  }];
  let tabActivities = new Map();
  const promptRoutingTabs = new Set();
  let tabSeenCompletionSerials = new Map();
  function scheduleTabsRender() {}
  function suppressPendingAgentDoneNotificationsForTab() {}

  ${functionSource("normalizeTabActivity")}
  ${functionSource("tabActivityStateChanged")}
  ${functionSource("setTabActivity")}
  ${functionSource("activityForTab")}
  ${functionSource("markTabWorkingLocally")}
  ${functionSource("markTabIdleLocally")}
  ${functionSource("markTabDoneLocally")}

  globalThis.activityApi = {
    startRouting() {
      promptRoutingTabs.add("tab-1");
      return markTabWorkingLocally("tab-1");
    },
    finishRouting() {
      promptRoutingTabs.delete("tab-1");
    },
    ingest(activity) {
      return setTabActivity("tab-1", activity);
    },
    markDone() {
      return markTabDoneLocally("tab-1");
    },
    current() {
      return tabActivities.get("tab-1");
    },
  };
`, context);

const api = context.activityApi;
api.ingest(context.tabs?.[0]?.activity || {
  status: "done",
  isWorking: false,
  completionSerial: 2,
  lastStartedAt: "2020-01-01T00:00:00.000Z",
  lastChangedAt: "2020-01-01T00:00:01.000Z",
});
assert.equal(api.startRouting(), true);
const routingActivity = api.current();
assert.equal(routingActivity.status, "working");
assert.equal(routingActivity.isWorking, true);
assert.notEqual(routingActivity.lastStartedAt, "2020-01-01T00:00:00.000Z", "optimistic routing should start a fresh reconciliation grace period");
assert.equal(routingActivity.lastChangedAt, routingActivity.lastStartedAt);

const staleDone = {
  status: "done",
  isWorking: false,
  completionSerial: 3,
  lastCompletedAt: new Date().toISOString(),
};
assert.equal(api.ingest(staleDone).isWorking, true, "an idle/done snapshot must not replace active routing");
assert.equal(api.markDone(), false, "idle state reconciliation must not synthesize completion during routing");
assert.equal(api.current().completionSerial, 2, "routing must not create a false completion serial");

api.finishRouting();
assert.equal(api.markDone(), true, "idle reconciliation should leave a submitted-but-never-started prompt idle");
assert.equal(api.current().status, "idle");
assert.equal(api.current().completionSerial, 2, "a prompt that never emitted agent_start must not synthesize completion");
assert.equal(api.ingest(staleDone).status, "done", "authoritative completion remains accepted after routing finishes");

const sendSource = functionSource("sendPrompt");
const routingAdd = sendSource.indexOf("promptRoutingTabs.add(targetTabId);");
const workingMark = sendSource.indexOf("markTabWorkingLocally(targetTabId);");
const responseApply = sendSource.indexOf("applyResponseTab(response);");
const successDelete = sendSource.indexOf("promptRoutingTabs.delete(targetTabId);", responseApply);
const catchStart = sendSource.indexOf("} catch (error)", successDelete);
const failureDelete = sendSource.indexOf("promptRoutingTabs.delete(targetTabId);", catchStart);
const idleMark = sendSource.indexOf("markTabIdleLocally(targetTabId);", catchStart);
assert.ok(routingAdd >= 0 && routingAdd < workingMark, "fresh prompts should enter routing protection before rendering working state");
assert.ok(responseApply >= 0 && successDelete > responseApply && successDelete < catchStart, "successful routing protection should end only after applying the server handoff response");
assert.ok(failureDelete > catchStart && failureDelete < idleMark, "failed routing should clear protection before restoring idle state");

console.log("prompt routing tab-status checks passed");
