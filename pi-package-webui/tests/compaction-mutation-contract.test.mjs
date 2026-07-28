import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await readFile(join(root, "bin", "pi-webui.mjs"), "utf8");

function sourceForFunction(name) {
  const start = server.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should remain a server helper`);
  const openingBrace = server.indexOf(") {", start) + 2;
  assert.ok(openingBrace > start, `${name} should have a function body`);
  let depth = 0;
  let quote = "";
  for (let index = openingBrace; index < server.length; index += 1) {
    const character = server[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return server.slice(start, index + 1);
  }
  assert.fail(`${name} should have a balanced function body`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const events = [];
const context = {
  broadcastTabEvent(tab, event) {
    events.push({ tab, event });
  },
  tabActivitySnapshot(tab) {
    return { tabId: tab.id };
  },
};
vm.createContext(context);
const functions = [
  "compactionQueueForTab",
  "compactionQueueRevision",
  "advanceCompactionQueueRevision",
  "compactionQueueSnapshot",
  "compactionQueueEvent",
  "sameQueueSnapshot",
  "compactionFollowUpSlots",
  "mutateCompactionFollowUpQueue",
].map(sourceForFunction).join("\n\n");
vm.runInContext(`${functions}\nglobalThis.mutate = mutateCompactionFollowUpQueue;`, context);

const firstImage = { type: "image", mimeType: "image/png", data: "first-image" };
const secondImage = { type: "image", mimeType: "image/png", data: "second-image" };
const editedCommand = {
  type: "follow_up",
  mode: "followUp",
  message: "first follow-up",
  images: [firstImage],
  metadata: { origin: "fixture", sequence: 1 },
};
const movedCommand = {
  type: "prompt",
  mode: "followUp",
  message: "second follow-up",
  images: [secondImage],
  metadata: { origin: "fixture", sequence: 2 },
};
const tab = {
  id: "compaction-contract-tab",
  title: "Compaction contract",
  compactionQueue: [
    { id: "steer", command: { type: "steer", mode: "steer", message: "fixed steering", metadata: { origin: "fixture" } } },
    { id: "edit", command: editedCommand },
    { id: "move", command: movedCommand },
  ],
};

const edit = context.mutate(tab, {
  source: "webui-compaction",
  kind: "followUp",
  revision: 0,
  expected: { steering: ["fixed steering"], followUp: ["first follow-up", "second follow-up"] },
  operation: { type: "edit", index: 0, expectedText: "first follow-up", text: "edited follow-up" },
});
assert.deepEqual(plain(edit), {
  mutated: true,
  source: "webui-compaction",
  queue: {
    source: "webui-compaction",
    revision: 1,
    steering: ["fixed steering"],
    followUp: ["edited follow-up", "second follow-up"],
    draining: false,
  },
}, "a successful edit returns the authoritative advanced snapshot");
assert.strictEqual(tab.compactionQueue[1].command, editedCommand, "edit must retain the original queued command object");
assert.strictEqual(editedCommand.images[0], firstImage, "edit must retain the original image object");
assert.deepEqual(editedCommand.metadata, { origin: "fixture", sequence: 1 }, "edit must retain command metadata");
assert.equal(editedCommand.type, "follow_up", "edit must retain the command type");
assert.equal(editedCommand.mode, "followUp", "edit must retain the command mode");
assert.equal(events.length, 1, "a successful compaction edit emits exactly one queue update");
assert.deepEqual(plain(events[0].event), {
  type: "webui_compaction_queue_update",
  tabId: "compaction-contract-tab",
  tabTitle: "Compaction contract",
  queueLength: 3,
  pendingMessageCount: 3,
  source: "webui-compaction",
  revision: 1,
  steering: ["fixed steering"],
  followUp: ["edited follow-up", "second follow-up"],
  draining: false,
  tabActivity: { tabId: "compaction-contract-tab" },
}, "the successful edit emits its one authoritative snapshot");

const stale = context.mutate(tab, {
  source: "webui-compaction",
  kind: "followUp",
  revision: 0,
  expected: { steering: ["fixed steering"], followUp: ["first follow-up", "second follow-up"] },
  operation: { type: "move", from: 1, to: 0, expectedText: "second follow-up" },
});
assert.equal(stale.mutated, false, "a stale compaction request is rejected");
assert.equal(stale.reason, "queue-changed");
assert.equal(events.length, 1, "a rejected stale mutation emits no queue update");
assert.strictEqual(tab.compactionQueue[1].command, editedCommand, "a rejected stale mutation leaves command identity intact");

const move = context.mutate(tab, {
  source: "webui-compaction",
  kind: "followUp",
  revision: 1,
  expected: { steering: ["fixed steering"], followUp: ["edited follow-up", "second follow-up"] },
  operation: { type: "move", from: 1, to: 0, expectedText: "second follow-up" },
});
assert.equal(move.mutated, true, "a current move is accepted");
assert.deepEqual([...move.queue.followUp], ["second follow-up", "edited follow-up"], "move uses the final follow-up index while steering remains fixed");
assert.strictEqual(tab.compactionQueue[1].command, movedCommand, "move keeps the full command object paired with its queue slot");
assert.strictEqual(movedCommand.images[0], secondImage, "move retains the moved command image object");
assert.deepEqual(movedCommand.metadata, { origin: "fixture", sequence: 2 }, "move retains moved command metadata");
assert.equal(events.length, 2, "a successful compaction move emits exactly one additional queue update");

tab.compactionQueueDraining = true;
const draining = context.mutate(tab, {
  source: "webui-compaction",
  kind: "followUp",
  revision: 2,
  expected: { steering: ["fixed steering"], followUp: ["second follow-up", "edited follow-up"] },
  operation: { type: "edit", index: 0, expectedText: "second follow-up", text: "must not apply" },
});
assert.equal(draining.mutated, false, "a draining compaction queue rejects mutation");
assert.equal(draining.reason, "queue-draining");
assert.equal(events.length, 2, "a rejected draining mutation emits no queue update");
assert.strictEqual(tab.compactionQueue[1].command, movedCommand, "a rejected draining mutation leaves the moved command untouched");

console.log("compaction-mutation-contract.test.mjs passed");
