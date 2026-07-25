import assert from "node:assert/strict";
import {
  addLaunchSlot,
  cloneLaunchSlotRoles,
  launchSlotRolesEqual,
  removeLaunchSlot,
  updateLaunchSlot,
} from "../public/subagent-launch-slot-state.mjs";

const initial = {
  reviewer: [{ id: "reviewer:base", model: "anthropic/reviewer", thinking: "high" }],
  worker: [{ id: "worker:base", model: null, thinking: null }],
};
const snapshot = cloneLaunchSlotRoles(initial);

const added = addLaunchSlot(initial, "reviewer", "reviewer:base", {
  slotsPerRole: 8,
  totalSlots: 32,
  createId: () => "reviewer:slot-1",
});
assert.ok(added, "an available role capacity should create a slot");
assert.deepEqual(added.slot, { id: "reviewer:slot-1", model: "anthropic/reviewer", thinking: "high" }, "added slots should copy the source draft");
assert.equal(initial.reviewer.length, 1, "adding should not mutate the saved draft");
assert.equal(launchSlotRolesEqual(initial, added.roles), false, "a new slot should mark the draft dirty");

const changedModel = updateLaunchSlot(added.roles, "reviewer", "reviewer:slot-1", { model: null });
assert.deepEqual(changedModel.reviewer[1], { id: "reviewer:slot-1", model: null, thinking: null }, "inheriting a model should reset thinking inheritance");

const removed = removeLaunchSlot(added.roles, "reviewer", "reviewer:slot-1");
assert.ok(removed, "added slots should be removable");
assert.equal(removed.focusSlotId, "reviewer:base", "removal should return a sensible preceding focus target");
assert.equal(launchSlotRolesEqual(snapshot, removed.roles), true, "removing the added slot should restore a clean draft");
assert.equal(removeLaunchSlot(initial, "reviewer", "reviewer:base"), null, "base slots must remain non-removable");
assert.equal(addLaunchSlot(initial, "reviewer", "reviewer:base", { totalSlots: 2, createId: () => "reviewer:slot-2" }), null, "the total cap should prevent extra slots");

console.log("subagent-launch-slot-state.test.mjs passed");
