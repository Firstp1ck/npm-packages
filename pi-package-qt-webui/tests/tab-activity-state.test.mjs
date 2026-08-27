import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTabRegistry } from "../lib/backend/tabs.mjs";

function createHarness(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "qt-webui-tab-activity-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const events = [];
  const sessions = [];
  const registry = createTabRegistry({
    callerCwd: cwd,
    emit: (type, payload) => events.push({ type, payload }),
    state: {
      saveTabs() {},
      read: () => ({ value: { tabs: [], activeTab: -1 }, problems: [] }),
    },
    createSession: ({ emit }) => {
      const snapshot = {
        active: false,
        ready: true,
        statusKind: "ready",
        statusText: "Ready",
        pendingDialogs: 0,
        pid: 1,
      };
      const control = {
        snapshot,
        emit(type, payload = {}, changes = {}) {
          Object.assign(snapshot, changes);
          emit(type, payload);
        },
      };
      sessions.push(control);
      return {
        child: null,
        start() {},
        stop: async () => {},
        restart: async () => ({}),
        newSession: async () => ({}),
        switchSession: async () => ({}),
        snapshot: () => snapshot,
      };
    },
  });

  function open(options = {}) {
    const sessionIndex = sessions.length;
    const tab = registry.open({ cwd, ...options });
    return { tab, session: sessions[sessionIndex] };
  }

  function summary(tab) {
    return registry.list().tabs.find((candidate) => candidate.id === tab.id);
  }

  function latestUpdate(tab) {
    const update = events.findLast((event) => event.type === "tabs.update");
    return update?.payload.tabs.find((candidate) => candidate.id === tab.id);
  }

  return { events, registry, open, summary, latestUpdate };
}

test("a newly opened tab is idle", (t) => {
  const harness = createHarness(t);
  const { tab } = harness.open();

  assert.equal(harness.summary(tab).activityState, "idle");
});

test("an active tab is working", (t) => {
  const harness = createHarness(t);
  const { tab, session } = harness.open();

  session.emit("run.start", {}, { active: true });

  assert.equal(harness.summary(tab).activityState, "working");
});

test("pending extension input takes blocked priority over working", (t) => {
  const harness = createHarness(t);
  const { tab, session } = harness.open();
  session.emit("run.start", {}, { active: true });

  session.emit("extension.request", { requestId: "request-1" }, { pendingDialogs: 1 });

  assert.equal(harness.summary(tab).activityState, "blocked");
  assert.equal(harness.latestUpdate(tab).activityState, "blocked");
});

test("answering or cancelling the last extension request publishes working again", (t) => {
  const harness = createHarness(t);
  const { tab, session } = harness.open();
  session.emit("run.start", {}, { active: true });

  session.emit("extension.request", { requestId: "answered" }, { pendingDialogs: 1 });
  assert.equal(harness.latestUpdate(tab).activityState, "blocked");
  session.emit("extension.answered", { requestId: "answered" }, { pendingDialogs: 0 });
  assert.equal(harness.latestUpdate(tab).activityState, "working");

  session.emit("extension.request", { requestId: "cancelled" }, { pendingDialogs: 1 });
  assert.equal(harness.latestUpdate(tab).activityState, "blocked");
  session.emit("extension.cancelled", { requestId: "cancelled" }, { pendingDialogs: 0 });
  assert.equal(harness.latestUpdate(tab).activityState, "working");
});

test("a run completed in a background tab is done without hiding error evidence", (t) => {
  const harness = createHarness(t);
  harness.open();
  const { tab, session } = harness.open({ select: false });
  session.emit("run.start", {}, { active: true });

  session.emit("run.end", { ok: false }, {
    active: false,
    statusKind: "error",
    statusText: "Run failed",
  });

  assert.deepEqual(
    {
      activityState: harness.summary(tab).activityState,
      statusKind: harness.summary(tab).statusKind,
      statusText: harness.summary(tab).statusText,
    },
    { activityState: "done", statusKind: "error", statusText: "Run failed" },
  );
});

test("selecting a done background tab acknowledges its completion", (t) => {
  const harness = createHarness(t);
  harness.open();
  const { tab, session } = harness.open({ select: false });
  session.emit("run.start", {}, { active: true });
  session.emit("run.end", {}, { active: false });
  assert.equal(harness.summary(tab).activityState, "done");

  harness.registry.select(tab.id);

  assert.equal(harness.summary(tab).activityState, "idle");
});

test("a background run blocked on extension input reports blocked, not working", (t) => {
  const harness = createHarness(t);
  harness.open();
  const { tab, session } = harness.open({ select: false });
  session.emit("run.start", {}, { active: true });

  session.emit("extension.request", { requestId: "background" }, { pendingDialogs: 1 });

  assert.equal(harness.summary(tab).activityState, "blocked");
  assert.equal(harness.latestUpdate(tab).activityState, "blocked");
});

// Pi publishes the idle status before run.end, so only the terminal event may settle the state.
test("the idle status published before run.end still settles as done", (t) => {
  const harness = createHarness(t);
  harness.open();
  const { tab, session } = harness.open({ select: false });
  session.emit("run.start", {}, { active: true });

  session.emit("pi.status", { ready: true, active: false }, { active: false });
  session.emit("run.end", { ok: true }, { active: false });

  assert.equal(harness.summary(tab).activityState, "done");
  assert.equal(harness.latestUpdate(tab).activityState, "done");
});

test("restarting Pi discards an unseen background completion", async (t) => {
  const harness = createHarness(t);
  harness.open();
  const { tab, session } = harness.open({ select: false });
  session.emit("run.start", {}, { active: true });
  session.emit("run.end", {}, { active: false });
  assert.equal(harness.summary(tab).activityState, "done");

  await harness.registry.restart(tab.id);

  assert.equal(harness.summary(tab).activityState, "idle");
});

test("a run completed in the selected tab returns to idle", (t) => {
  const harness = createHarness(t);
  const { tab, session } = harness.open();
  session.emit("run.start", {}, { active: true });

  session.emit("run.end", {}, { active: false });

  assert.equal(harness.summary(tab).activityState, "idle");
});

test("starting new work clears a stale background completion", (t) => {
  const harness = createHarness(t);
  harness.open();
  const { tab, session } = harness.open({ select: false });
  session.emit("run.start", {}, { active: true });
  session.emit("run.end", {}, { active: false });
  assert.equal(harness.summary(tab).activityState, "done");

  session.emit("run.start", {}, { active: true });
  assert.equal(harness.summary(tab).activityState, "working");
  session.emit("pi.status", { ready: true, active: false }, { active: false });

  assert.equal(harness.summary(tab).activityState, "idle");
});
