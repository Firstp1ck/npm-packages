import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startBackend } from "./helpers/backend-client.mjs";
import { qmlFunctions } from "./helpers/qml-functions.mjs";

test("a committed replacement retains its owner when later history projection fails", async t => {
  const b = await startBackend({ t, env: { QT_WEBUI_FIXTURE_HISTORY_FAIL: "1" } });
  await b.waitForEvent("pi.status", event => event.ready);
  const tab = (await b.send("hello")).data.tabs.activeTab;
  const directory = path.join(b.temporary, "agent", "sessions", "workspace");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "target.jsonl");
  await writeFile(file, JSON.stringify({ type: "session", version: 3, id: "target", cwd: b.temporary }) + "\n");
  const result = await b.send("session_switch", { sessionPath: file });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /history projection failed/);
  const hello = await b.send("hello");
  assert.equal(hello.data.session.runtime.sessionFile, file);
  assert.equal(hello.data.tabs.tabs[0].sessionFile, file);
  assert.equal((await b.send("tab_open", { sessionPath: file })).data.tab.id, tab);
});

test("batched A-B-A selection responses and replays retain committed generations", async t => {
  const b = await startBackend({ t });
  await b.waitForEvent("pi.status", e => e.statusKind === "ready");
  const a = (await b.send("hello")).data.tabs.activeTab;
  const opened = await b.send("tab_open");
  const c = opened.data.tab.id;
  await b.waitForEvent("pi.status", e => e.tab === c && e.ready);
  const [first, second, last] = await Promise.all([b.send("tab_select", { tab: a }), b.send("tab_select", { tab: c }), b.send("tab_select", { tab: a })]);
  assert(first.data.selectionGeneration < second.data.selectionGeneration);
  assert(second.data.selectionGeneration < last.data.selectionGeneration);
  const resets = b.events.filter(e => e.type === "transcript.reset" && e.selectionGeneration >= first.data.selectionGeneration);
  assert.deepEqual(resets.map(e => [e.tab, e.selectionGeneration]), [first, second, last].map(r => [r.data.tab.id, r.data.selectionGeneration]));
  const sentinel = {};
  const q = await qmlFunctions("BackendBridge.qml", { activeTabId: a, selectionGeneration: last.data.selectionGeneration,
    attachments: sentinel, resourceState: sentinel, statusKind: "unchanged" });
  q.applySnapshot(first.data);
  q.applySnapshot(second.data);
  assert.equal(q.activeTabId, a);
  assert.equal(q.attachments, sentinel);
  assert.equal(q.resourceState, sentinel);
  assert.equal(q.statusKind, "unchanged");
  const closed = await b.send("tab_close", { tab: a });
  assert(closed.ok);
  const empty = b.events.filter(e => e.type === "tabs.update").at(-1);
  assert.equal(empty.activeTab, "");
  assert(empty.selectionGeneration > last.data.selectionGeneration);
});
