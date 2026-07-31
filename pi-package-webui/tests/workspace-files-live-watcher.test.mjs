import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createWorkspaceFilesLiveWatcher } from "../lib/workspace-files-live-watcher.mjs";

const created = [];
const changes = [];
const errors = [];

function fakeWatch(root, options, listener) {
  const watcher = new EventEmitter();
  watcher.root = root;
  watcher.options = options;
  watcher.listener = listener;
  watcher.closed = false;
  watcher.close = () => {
    watcher.closed = true;
  };
  created.push(watcher);
  return watcher;
}

const manager = createWorkspaceFilesLiveWatcher({
  watch: fakeWatch,
  debounceMs: 20,
  onChange: (event) => changes.push(event),
  onError: (event) => errors.push(event),
});

const firstRoot = path.resolve("/tmp/pi-webui-workspace-live-one");
const secondRoot = path.resolve("/tmp/pi-webui-workspace-live-two");

assert.equal(manager.subscribe("tab-a", firstRoot), true);
assert.equal(manager.subscribe("tab-b", firstRoot), true);
assert.equal(created.length, 1, "tabs in one workspace should share one recursive watcher");
assert.deepEqual(created[0].options, { recursive: true, persistent: false });
assert.equal(manager.watchedRootCount(), 1);

created[0].listener("change", "file.txt");
created[0].listener("rename", "created.txt");
created[0].listener("change", "file.txt");
await delay(50);
assert.equal(changes.length, 1, "one filesystem burst should emit one debounced invalidation");
assert.equal(changes[0].root, firstRoot);
assert.deepEqual(changes[0].tabIds, ["tab-a", "tab-b"], "invalidations should snapshot the affected tab ids");
assert.match(changes[0].changedAt, /^\d{4}-\d{2}-\d{2}T/);

const maxWaitChanges = [];
const maxWaitManager = createWorkspaceFilesLiveWatcher({
  watch: fakeWatch,
  debounceMs: 80,
  maxWaitMs: 40,
  onChange: (event) => maxWaitChanges.push(event),
});
assert.equal(maxWaitManager.subscribe("tab-max-wait", firstRoot), true);
const maxWaitWatcher = created.at(-1);
maxWaitWatcher.listener("change", "continuous.txt");
await delay(25);
maxWaitWatcher.listener("change", "continuous.txt");
await delay(30);
assert.equal(maxWaitChanges.length, 1, "sustained writes should emit by the bounded maximum wait");
assert.deepEqual(maxWaitChanges[0].tabIds, ["tab-max-wait"]);
maxWaitManager.closeAll();

assert.equal(manager.unsubscribe("tab-a"), true);
assert.equal(created[0].closed, false, "the shared watcher should remain while another tab subscribes");
assert.equal(manager.subscribe("tab-b", secondRoot), true, "moving a tab should subscribe its new workspace");
assert.equal(created[0].closed, true, "moving the last subscriber should close the old watcher");
assert.equal(created.length, 3);
assert.equal(manager.subscribedRootForTab("tab-b"), secondRoot);

created.at(-1).emit("error", new Error("fixture watcher failed"));
assert.equal(errors.length, 1, "runtime watcher failures should be reported once");
assert.equal(errors[0].root, secondRoot);
assert.equal(manager.watchedRootCount(), 0, "a failed watcher should be removed");
assert.equal(manager.subscribedRootForTab("tab-b"), "", "failed roots should release tab subscriptions for later retry");

const throwingManager = createWorkspaceFilesLiveWatcher({
  watch: () => {
    throw new Error("watch unsupported");
  },
  onError: (event) => errors.push(event),
});
assert.equal(throwingManager.subscribe("tab-c", firstRoot), false, "synchronous watcher startup errors should be non-fatal");
assert.match(errors.at(-1)?.error?.message || "", /watch unsupported/);

assert.equal(manager.subscribe("tab-d", firstRoot), true);
assert.equal(manager.subscribe("tab-e", secondRoot), true);
const latestWatchers = created.slice(-2);
manager.closeAll();
assert.equal(manager.watchedRootCount(), 0);
assert.equal(latestWatchers.every((watcher) => watcher.closed), true, "closeAll should release every watcher");

console.log("workspace-files-live-watcher.test.mjs passed");
