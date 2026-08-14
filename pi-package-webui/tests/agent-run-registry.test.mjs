import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENT_RUN_REGISTRY_LIMITS,
  AgentRunRegistry,
  ageAgentRun,
  agentRunRegistryPaths,
  agentRunScopeId,
} from "../lib/agent-run-registry.mjs";

const base = (overrides = {}) => ({
  version: 1, instanceId: "instance-1", runId: "run-1", parentInstanceId: null, parentSessionId: null,
  launcher: "sdk", provider: "webui-registry", origin: "test", name: "agent", status: "running",
  startedAt: 1_000, updatedAt: 2_000, endedAt: null, model: "p/m", thinking: "high", activityState: "thinking",
  capabilities: { open: true, refresh: true, cancel: false, steer: false }, outputRef: { kind: "registry-artifact", id: "record-1" },
  ...overrides,
});

assert.match(agentRunScopeId("/tmp/agent", 31415), /^[a-f0-9]{64}$/);
assert.equal(agentRunScopeId("/tmp/agent", 31415), agentRunScopeId("/tmp/agent", 31415));
assert.throws(() => agentRunScopeId("/tmp/agent", 0), /between 1 and 65535/);
assert.equal(ageAgentRun(base(), 31_999, { staleAfterMs: 30_000, lostAfterMs: 120_000 }).status, "running");
assert.equal(ageAgentRun(base(), 32_000, { staleAfterMs: 30_000, lostAfterMs: 120_000 }).status, "stale");
assert.equal(ageAgentRun(base(), 122_000, { staleAfterMs: 30_000, lostAfterMs: 120_000 }).status, "lost");
assert.equal(ageAgentRun(base({ status: "done", endedAt: 2_000 }), 999_999).status, "done", "terminal evidence must win over aging");

const temp = await mkdtemp(path.join(tmpdir(), "pi-webui-agent-registry-"));
try {
  let now = 10_000;
  const registry = new AgentRunRegistry({ agentDir: path.join(temp, "agent"), port: 31415, stateHome: path.join(temp, "state"), now: () => now, eventMaxBytes: 16_384, staleAfterMs: 100, lostAfterMs: 200, finishedRetentionMs: 500 });
  await registry.init();
  if (process.platform !== "win32") {
    assert.equal((await stat(registry.paths.root)).mode & 0o777, 0o700, "registry directories must be owner-private");
  }

  await Promise.all([
    registry.writeRecord("producer-a", base({ startedAt: 9_000, updatedAt: 10_000 }), { recordId: "record-1" }),
    registry.writeRecord("producer-b", base({ instanceId: "instance-2", runId: "run-2", startedAt: 9_000, updatedAt: 10_000, outputRef: { kind: "none" } }), { recordId: "record-2" }),
  ]);
  const recordFile = path.join(registry.paths.root, "producer-a", "record-1.json");
  assert.equal(JSON.parse(await readFile(recordFile, "utf8")).instanceId, "instance-1");
  if (process.platform !== "win32") assert.equal((await stat(recordFile)).mode & 0o777, 0o600, "record files must be owner-private");
  assert.equal((await registry.readRecords()).records.length, 2, "separate producer records must coexist atomically");

  await writeFile(path.join(registry.paths.root, "producer-a", "partial.json"), "{", { mode: 0o600 });
  const withCorruption = await registry.readRecords();
  assert.equal(withCorruption.records.length, 2);
  assert.ok(withCorruption.diagnostics.some((item) => item.code === "invalid-record"), "corrupt records must be isolated");

  now = 10_150;
  assert.equal((await registry.readRecords()).records.find((item) => item.recordId === "record-1").instance.status, "stale");
  now = 10_250;
  assert.equal((await registry.readRecords()).records.find((item) => item.recordId === "record-1").instance.status, "lost");

  for (let index = 0; index < 400; index += 1) {
    await registry.appendArtifactEvent("producer-a", "record-1", { type: "output", stream: "stdout", message: `${index}:${"x".repeat(100)}` });
  }
  const artifact = await registry.readArtifact("record-1");
  assert.ok(artifact.bytes <= 16_384, "artifact rotation must enforce the configured byte cap");
  assert.ok(artifact.events.length < 400, "artifact rotation must retain only a bounded tail");
  await registry.appendArtifactEvent("producer-a", "record-1", { type: "output", message: "🙂".repeat(AGENT_RUN_REGISTRY_LIMITS.eventLineBytes) });
  const cappedMessage = (await registry.readArtifact("record-1")).events.at(-1).message;
  assert.ok(Buffer.byteLength(cappedMessage) <= 8_192, "individual UTF-8 event text must be byte-capped before serialization");
  await assert.rejects(() => registry.readArtifact("../record-1"), /opaque safe identifier/);

  const sessions = path.join(temp, "agent", "sessions");
  await mkdir(sessions, { recursive: true });
  const sessionFile = path.join(sessions, "session.jsonl");
  await writeFile(sessionFile, '{"type":"session","id":"s"}\n');
  await registry.writeRecord("attach", base({ instanceId: "attached", launcher: "interactive", status: "stale", outputRef: { kind: "session-jsonl", id: "attach-1" } }), { recordId: "attach-1" });
  await registry.writeSessionLocator("attach", "attach-1", sessionFile, { allowedRoots: [sessions] });
  assert.equal((await registry.resolveSessionLocator("attach-1", { allowedRoots: [sessions] })).sessionFile, sessionFile);
  await assert.rejects(() => registry.writeSessionLocator("attach", "attach-1", path.join(temp, "outside.jsonl"), { allowedRoots: [sessions] }), /inside a configured Pi session root/);

  if (process.platform !== "win32") {
    const outside = path.join(temp, "outside.json");
    await writeFile(outside, `${JSON.stringify(base({ outputRef: { kind: "none" } }))}\n`);
    await symlink(outside, path.join(registry.paths.root, "producer-a", "linked.json"));
    const symlinkScan = await registry.readRecords();
    assert.ok(symlinkScan.diagnostics.some((item) => item.code === "unsafe-record"), "record symlinks must be rejected");

    const symlinkHome = path.join(temp, "symlink-state");
    await symlink(path.join(temp, "state"), symlinkHome);
    const unsafe = new AgentRunRegistry({ agentDir: path.join(temp, "agent"), port: 31416, stateHome: symlinkHome });
    await assert.rejects(() => unsafe.init(), /must not be a symlink/);
  }

  now = 20_000;
  await registry.writeRecord("producer-a", base({ status: "done", updatedAt: 19_000, endedAt: 19_000 }), { recordId: "record-1" });
  assert.equal(await registry.prune({ now, retentionMs: 500 }), 1);
  assert.equal((await registry.readRecords({ now })).records.some((item) => item.recordId === "record-1"), false);
  assert.equal((await registry.readRecords({ now })).records.some((item) => item.recordId === "record-2"), true, "pruning must retain non-terminal records");

  const expected = agentRunRegistryPaths({ agentDir: path.join(temp, "agent"), port: 31415, stateHome: path.join(temp, "state") });
  assert.equal(registry.paths.root, expected.root);
  assert.equal((await lstat(registry.paths.root)).isSymbolicLink(), false);
  console.log("agent-run-registry.test.mjs passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
