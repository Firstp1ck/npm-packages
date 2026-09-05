import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridge = await readFile(new URL("../qml/BackendBridge.qml", import.meta.url), "utf8");
const shell = await readFile(new URL("../qml/shell.qml", import.meta.url), "utf8");

function harness() {
  const pending = [], notices = [];
  const context = vm.createContext({
    backendReady: true, quitting: false, sessionCatalogGeneration: 0,
    sessionCatalogLoading: false, sessionCatalogError: "", sessionCatalogWarning: "",
    sessionCatalog: [], maxCatalogRows: 2000,
    sessionCatalogRefreshTimer: { stop() {} },
    boundedError: String,
    sessionCatalogLoaded() {},
    postNotice: (level, message) => notices.push({ level, message }),
    request: (type, fields, callback, scoped) => {
      assert.equal(type, "sessions_list");
      assert.equal(fields.scope, "all");
      assert.equal(scoped, false);
      pending.push(callback);
    },
  });
  for (const name of ["refreshSessionCatalog", "loadSessionCatalogPage"]) {
    const source = bridge.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
    assert.ok(source, `Missing production function ${name}`);
    vm.runInContext(source[0], context);
  }
  const reply = (truncated, extra = {}) => {
    assert.ok(pending.length, "Expected a pending catalog request");
    pending.shift()({ ok: true, data: { sessions: [], nextOffset: null, truncated, ...extra } });
  };
  return { context, pending, notices, reply };
}

test("incomplete catalogs update workspace warning without posting session notices", () => {
  const { context, notices, reply } = harness();
  for (let i = 0; i < 3; i++) {
    context.refreshSessionCatalog();
    reply(true);
    assert.equal(context.sessionCatalogWarning, "Session discovery reached its scan or retention limit; this catalog is incomplete");
  }
  assert.equal(notices.length, 0);
  context.refreshSessionCatalog();
  assert.notEqual(context.sessionCatalogWarning, "", "retain warning while the incomplete catalog is still displayed");
  reply(false);
  assert.equal(context.sessionCatalogWarning, "");
  assert.equal(notices.length, 0);
  assert.match(shell, /warningText: bridge\.sessionCatalogWarning/);
});

test("only a completed current refresh replaces the warning, including paged catalogs", () => {
  const { context, notices, reply } = harness();
  context.sessionCatalogWarning = "Previous incomplete catalog";
  context.refreshSessionCatalog();
  reply(false, { sessions: [{ path: "/fixture/one.jsonl" }], nextOffset: 1, cursor: "next" });
  assert.equal(context.sessionCatalogWarning, "Previous incomplete catalog");
  reply(false, { sessions: [{ path: "/fixture/two.jsonl" }] });
  assert.equal(context.sessionCatalog.length, 2);
  assert.equal(context.sessionCatalogWarning, "");
  context.refreshSessionCatalog();
  context.refreshSessionCatalog();
  reply(true);
  assert.equal(context.sessionCatalogWarning, "", "stale responses must not show a warning");
  reply(false);
  assert.equal(notices.length, 0);
});

test("a failed refresh retains the warning attached to the displayed catalog", () => {
  const { context, pending, notices } = harness();
  context.sessionCatalogWarning = "Previous incomplete catalog";
  context.refreshSessionCatalog();
  pending.shift()({ ok: false, error: { code: "unavailable", message: "Test refresh failure" } });
  assert.equal(context.sessionCatalogWarning, "Previous incomplete catalog");
  assert.equal(context.sessionCatalogLoading, false);
  assert.equal(notices.length, 1, "unrelated refresh errors retain their existing behavior");
  assert.equal(notices[0].level, "error");
});
