import assert from "node:assert/strict";
import {
  AGENT_RUN_LAUNCHERS,
  AGENT_RUN_OUTPUT_KINDS,
  AGENT_RUN_STATUSES,
  AgentRunIndex,
  mergeAgentInstances,
  normalizeAgentInstance,
  normalizeProviderSnapshot,
} from "../lib/agent-run-protocol.mjs";

const base = (overrides = {}) => ({
  version: 1,
  instanceId: "instance-1",
  runId: "run-1",
  parentInstanceId: null,
  parentSessionId: "parent-1",
  launcher: "sdk",
  provider: "webui-registry",
  origin: "test",
  name: "reviewer",
  status: "running",
  startedAt: 100,
  updatedAt: 110,
  endedAt: null,
  model: "provider/model",
  thinking: "high",
  activityState: "tool",
  currentTool: "read",
  capabilities: { open: true, refresh: true, cancel: false, steer: false },
  outputRef: { kind: "registry-artifact", id: "artifact-1" },
  ...overrides,
});

for (const launcher of AGENT_RUN_LAUNCHERS) assert.equal(normalizeAgentInstance(base({ launcher })).launcher, launcher);
for (const status of AGENT_RUN_STATUSES) {
  const terminal = ["done", "failed", "cancelled"].includes(status);
  assert.equal(normalizeAgentInstance(base({ status, endedAt: terminal ? 120 : null })).status, status);
}
for (const kind of AGENT_RUN_OUTPUT_KINDS) {
  const outputRef = kind === "none" ? { kind } : { kind, id: "artifact-1" };
  assert.equal(normalizeAgentInstance(base({ outputRef })).outputRef.kind, kind);
}

assert.throws(() => normalizeAgentInstance(base({ version: 2 })), /version/);
assert.throws(() => normalizeAgentInstance(base({ launcher: "future" })), /unsupported/);
assert.throws(() => normalizeAgentInstance(base({ status: "unknown" })), /unsupported/);
assert.throws(() => normalizeAgentInstance(base({ instanceId: "../escape" })), /opaque safe identifier/);
assert.throws(() => normalizeAgentInstance(base({ provider: "bad/provider" })), /opaque safe identifier/);
assert.throws(() => normalizeAgentInstance(base({ name: "x".repeat(241) })), /exceeds 240 bytes/);
assert.throws(() => normalizeAgentInstance(base({ capabilities: { open: "yes" } })), /must be boolean/);
assert.throws(() => normalizeAgentInstance(base({ outputRef: { kind: "plain-log", id: "../../x" } })), /opaque safe identifier/);
assert.throws(() => normalizeAgentInstance(base({ status: "done", endedAt: null })), /endedAt is required/);
assert.throws(() => normalizeProviderSnapshot({ version: 1, producerId: "p", complete: true, instances: [base(), base()] }), /duplicate/);

const merged = mergeAgentInstances(
  base({ updatedAt: 110, outputRef: { kind: "plain-log", id: "plain" }, currentTool: "read" }),
  base({ updatedAt: 120, outputRef: { kind: "session-jsonl", id: "session" }, currentTool: "bash" }),
);
assert.equal(merged.currentTool, "bash");
assert.equal(merged.outputRef.kind, "session-jsonl", "stronger output evidence must win");

const index = new AgentRunIndex();
index.upsert(base(), { producerId: "one" });
index.upsert(base({ updatedAt: 120, currentTool: "bash" }), { producerId: "two" });
assert.equal(index.size, 1, "exact parent-scoped identity must deduplicate");
index.upsert(base({ instanceId: "instance-2", runId: "run-2", updatedAt: 121 }), { producerId: "one" });
assert.equal(index.size, 2, "same name/model/time must not deduplicate distinct IDs");

const upgrades = new AgentRunIndex();
upgrades.upsert(base({ instanceId: "provisional-1" }), { producerId: "p" });
upgrades.upsert(base({ instanceId: "session-strong", updatedAt: 130 }), { producerId: "p", previousInstanceId: "provisional-1" });
assert.equal(upgrades.size, 1, "explicit stronger identity must migrate without adding a row");
assert.equal(upgrades.values()[0].instanceId, "session-strong");

const snapshots = new AgentRunIndex();
snapshots.ingestSnapshot({ version: 1, producerId: "alpha", complete: true, instances: [base()] });
snapshots.ingestSnapshot({ version: 1, producerId: "beta", complete: true, instances: [base({ instanceId: "beta-1" })] });
snapshots.ingestSnapshot({ version: 1, producerId: "alpha", complete: true, instances: [] });
assert.deepEqual(snapshots.values().map((item) => item.instanceId), ["beta-1"], "complete snapshots clear only their producer");

console.log("agent-run-protocol.test.mjs passed");
