import assert from "node:assert/strict";
import {
  ComponentUpdateState,
  sanitizeComponentUpdateError,
  validateComponentUpdateRequest,
} from "../lib/component-update-state.mjs";

const times = [
  new Date("2030-01-01T00:00:00.000Z"),
  new Date("2030-01-01T00:00:01.000Z"),
  new Date("2030-01-01T00:00:02.000Z"),
  new Date("2030-01-01T00:00:03.000Z"),
];
const updates = new ComponentUpdateState({ now: () => times.shift() });

assert.deepEqual(updates.get("pi"), {
  target: "pi",
  state: "idle",
  startedAt: null,
  finishedAt: null,
  message: "",
  error: "",
  restartRequired: false,
});
assert.equal(updates.get("webui").restartRequired, true);

const runningPi = updates.begin("pi");
assert.equal(runningPi.state, "running");
assert.equal(runningPi.startedAt, "2030-01-01T00:00:00.000Z");
assert.equal(updates.hasRunning(), true);
assert.throws(() => updates.begin("webui"), /already running/, "component jobs must be single-flight");

const busyStates = updates.publicStates({ localRequest: true, updateInProgress: true });
assert.equal(busyStates.pi.canStart, false);
assert.equal(busyStates.webui.canStart, false);
assert.match(busyStates.webui.unavailableReason, /privileged update/i);

const succeededPi = updates.succeed("pi", "Pi update completed.");
assert.equal(succeededPi.state, "succeeded");
assert.equal(succeededPi.finishedAt, "2030-01-01T00:00:01.000Z");
assert.equal(succeededPi.error, "");
assert.equal(updates.hasRunning(), false);

updates.begin("webui");
const secretFailure = new Error(`Authorization: Bearer top-secret-token\npassword=hunter2\nhttps://alice:private@example.test/path\n${"x".repeat(2000)}`);
const failedWebui = updates.fail("webui", secretFailure);
assert.equal(failedWebui.state, "failed");
assert.equal(failedWebui.finishedAt, "2030-01-01T00:00:03.000Z");
assert.ok(failedWebui.error.length <= 1200, "terminal error text must be bounded");
assert.doesNotMatch(failedWebui.error, /top-secret-token|hunter2|alice:private/);
assert.match(failedWebui.error, /\[redacted\]/);

const sourceStates = updates.publicStates({
  localRequest: true,
  updateInProgress: false,
  webuiAvailable: false,
  webuiUnavailableReason: "Source checkout updates are unavailable.",
});
assert.equal(sourceStates.pi.canStart, true);
assert.equal(sourceStates.webui.canStart, false);
assert.equal(sourceStates.webui.unavailableReason, "Source checkout updates are unavailable.");

const remoteStates = updates.publicStates({ localRequest: false, updateInProgress: false });
assert.equal(remoteStates.pi.canStart, false);
assert.equal(remoteStates.webui.canStart, false);
assert.match(remoteStates.pi.unavailableReason, /localhost/i);

for (const body of [null, [], {}, { target: "all" }, { target: "pi", extra: true }, { extra: "pi" }]) {
  assert.equal(validateComponentUpdateRequest(body).ok, false, `invalid request must be rejected: ${JSON.stringify(body)}`);
}
assert.deepEqual(validateComponentUpdateRequest({ target: "pi" }), { ok: true, target: "pi" });
assert.deepEqual(validateComponentUpdateRequest({ target: "webui" }), { ok: true, target: "webui" });

const ansiAndToken = sanitizeComponentUpdateError("\u001b[31mtoken=npm_abcdefghijklmnopqrstuvwxyz123456\u001b[0m");
assert.doesNotMatch(ansiAndToken, /\u001b|npm_abcdefghijklmnopqrstuvwxyz123456/);
const npmAuthToken = sanitizeComponentUpdateError("//registry.npmjs.org/:_authToken=opaque-registry-secret");
assert.doesNotMatch(npmAuthToken, /opaque-registry-secret/);
assert.match(npmAuthToken, /\[redacted\]/);

console.log("component update state tests passed");
