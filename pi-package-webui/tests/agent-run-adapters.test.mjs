import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveAttachSession,
  runAgentCli,
  startObservedPiProcess,
  trackPiAgentSession,
  trackPiAgentSessionEventBus,
} from "../lib/agent-run-adapters.mjs";
import { AgentRunRegistry } from "../lib/agent-run-registry.mjs";

class MemoryRegistry {
  constructor() { this.records = []; this.events = []; this.locators = []; }
  async init() { return this; }
  async writeRecord(producerId, instance, { recordId }) { this.records.push({ producerId, recordId, instance }); return { producerId, recordId, instance }; }
  async appendArtifactEvent(producerId, recordId, event) { this.events.push({ producerId, recordId, event }); return event; }
  async writeSessionLocator(producerId, recordId, sessionFile) { this.locators.push({ producerId, recordId, sessionFile }); }
}

let sdkListener;
const session = {
  sessionId: "sdk-session",
  sessionName: "SDK agent",
  isStreaming: false,
  model: { provider: "anthropic", id: "model" },
  thinkingLevel: "high",
  subscribe(listener) { sdkListener = listener; return () => { sdkListener = undefined; }; },
};
const memory = new MemoryRegistry();
let clock = 1_000;
const tracked = trackPiAgentSession({ session, registry: memory, producerId: "sdk-test", instanceId: "sdk-instance", runId: "sdk-run", recordId: "sdk-record", now: () => ++clock, heartbeatMs: 60_000 });
await tracked.ready;
sdkListener({ type: "agent_start" });
sdkListener({ type: "tool_execution_start", toolName: "read", args: { secret: "must-not-persist" } });
sdkListener({ type: "tool_execution_end", toolName: "read", result: { secret: "must-not-persist" }, isError: false });
sdkListener({ type: "message_end", message: { role: "assistant", content: "private prompt", usage: { input: 3, output: 4 } } });
sdkListener({ type: "agent_settled" });
await tracked.flush();
assert.equal(memory.records.at(-1).instance.status, "done");
assert.equal(memory.records.at(-1).instance.endedAt, memory.records.at(-1).instance.updatedAt);
assert.equal(memory.records.some((item) => item.instance.currentTool === "read"), true);
assert.equal(memory.events.some((item) => item.event.tool === "read"), true);
assert.equal(memory.events.some((item) => item.event.usage?.input === 3), true);
assert.doesNotMatch(JSON.stringify({ records: memory.records, events: memory.events }), /must-not-persist|private prompt/, "SDK overview/artifacts must omit args and message text");
await tracked.dispose();
assert.equal(sdkListener, undefined, "dispose must unsubscribe without disposing the caller-owned session");

{
  let listener;
  let attempts = 0;
  const recoveringRegistry = new MemoryRegistry();
  recoveringRegistry.writeRecord = async (...args) => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary registry failure");
    return MemoryRegistry.prototype.writeRecord.apply(recoveringRegistry, args);
  };
  const recoveringSession = { ...session, subscribe(value) { listener = value; return () => { listener = undefined; }; } };
  const recovering = trackPiAgentSession({ session: recoveringSession, registry: recoveringRegistry, instanceId: "recovering-sdk", runId: "recovering-run", recordId: "recovering-record", heartbeatMs: 60_000 });
  await recovering.ready;
  assert.match(recovering.observationError, /temporary registry failure/);
  listener({ type: "agent_start" });
  await recovering.flush();
  assert.ok(recoveringRegistry.records.length > 0, "a failed SDK write must not poison later registry writes");
  await recovering.dispose();
}

{
  let listener;
  const emitted = [];
  const eventSession = { ...session, subscribe(value) { listener = value; return () => { listener = undefined; }; } };
  const eventTracked = trackPiAgentSessionEventBus({ session: eventSession, producerId: "sdk-event-test", instanceId: "event-sdk", runId: "event-run", heartbeatMs: 60_000, emit: (name, payload) => emitted.push({ name, payload }) });
  listener({ type: "agent_start" });
  listener({ type: "agent_settled" });
  assert.equal(emitted.at(-1).name, "firstpick:webui-agent-runs:v1");
  assert.equal(emitted.at(-1).payload.instances[0].status, "done");
  eventTracked.dispose();
  assert.equal(listener, undefined);
}

for (const [stopReason, expectedStatus] of [["aborted", "cancelled"], ["error", "failed"]]) {
  let listener;
  const terminalRegistry = new MemoryRegistry();
  const terminalSession = { ...session, sessionId: `sdk-${stopReason}`, subscribe(value) { listener = value; return () => { listener = undefined; }; } };
  const terminal = trackPiAgentSession({ terminalSession, session: terminalSession, registry: terminalRegistry, producerId: "sdk-test", instanceId: `sdk-${stopReason}`, runId: `run-${stopReason}`, recordId: `record-${stopReason}`, heartbeatMs: 60_000 });
  await terminal.ready;
  listener({ type: "agent_start" });
  listener({ type: "agent_end", messages: [{ role: "assistant", stopReason }], willRetry: false });
  listener({ type: "agent_settled" });
  await terminal.flush();
  assert.equal(terminalRegistry.records.at(-1).instance.status, expectedStatus, `SDK ${stopReason} lifecycle must remain terminal after settlement`);
  await terminal.dispose();
}

const temp = await mkdtemp(path.join(tmpdir(), "pi-webui-agent-adapters-"));
try {
  const registry = new AgentRunRegistry({ agentDir: path.join(temp, "agent"), port: 31415, stateHome: path.join(temp, "state"), eventMaxBytes: 4_096 });
  await registry.init();
  const jsonScript = [
    "process.stdout.write(JSON.stringify({type:'agent_start'}) + '\\r\\n');",
    "process.stdout.write(JSON.stringify({type:'tool_execution_start',toolName:'bash',args:{token:'secret'}}) + '\\n');",
    "process.stdout.write(JSON.stringify({type:'message_update',message:{content:'a\\u2028b'}}) + '\\n');",
    "process.stdout.write('{bad}\\n');",
  ].join("");
  const jsonRun = startObservedPiProcess({ registry, launcher: "pi-json", producerId: "json", command: process.execPath, argv: ["-e", jsonScript], recordId: "json-record", instanceId: "json-instance", runId: "json-run" });
  assert.equal((await jsonRun.completion).status, "done");
  const jsonArtifact = await registry.readArtifact("json-record");
  assert.ok(jsonArtifact.events.some((event) => event.type === "agent_start"), "CRLF framed event must parse");
  assert.ok(jsonArtifact.events.some((event) => event.type === "tool_execution_start" && event.tool === "bash"));
  assert.ok(jsonArtifact.events.some((event) => event.type === "message_update"), "Unicode line separators inside JSON must not split framing");
  assert.ok(jsonArtifact.events.some((event) => event.type === "invalid_frame" && event.status === "malformed"));
  assert.doesNotMatch(JSON.stringify(jsonArtifact), /secret|a\\u2028b/, "structured captures must omit args and message content");

  const rpcScript = "process.stdout.write(JSON.stringify({type:'event',event:{type:'tool_execution_start',toolName:'read'}})+'\\n');process.stdout.write(JSON.stringify({type:'response',success:true})+'\\n');";
  const rpcRun = startObservedPiProcess({ registry, launcher: "pi-rpc", producerId: "rpc", command: process.execPath, argv: ["-e", rpcScript], recordId: "rpc-record", instanceId: "rpc-instance", runId: "rpc-run" });
  assert.equal((await rpcRun.completion).status, "done");
  const rpcArtifact = await registry.readArtifact("rpc-record");
  assert.ok(rpcArtifact.events.some((event) => event.type === "tool_execution_start"));
  assert.ok(rpcArtifact.events.some((event) => event.type === "rpc_response" && event.status === "ok"));

  const printScript = "process.stdout.write('x'.repeat(4000));process.stderr.write('print-error');process.exitCode=7";
  const printRun = startObservedPiProcess({ registry, launcher: "pi-print", producerId: "print", command: process.execPath, argv: ["-e", printScript], outputBytes: 1_024, recordId: "print-record", instanceId: "print-instance", runId: "print-run" });
  const printResult = await printRun.completion;
  assert.equal(printResult.status, "failed");
  assert.equal(printResult.code, 7);
  assert.ok(Buffer.byteLength(printResult.stdout) <= 1_024, "print stdout tail must be bounded");
  assert.match(printResult.stderr, /print-error/);
  assert.equal((await registry.readRecords()).records.find((item) => item.recordId === "print-record").instance.status, "failed");

  const quietRun = startObservedPiProcess({ registry, launcher: "pi-print", producerId: "quiet", command: process.execPath, argv: ["-e", "setTimeout(() => {}, 1400)"], heartbeatMs: 1_000, recordId: "quiet-record", instanceId: "quiet-instance", runId: "quiet-run" });
  await quietRun.ready;
  await delay(1_100);
  const quietSnapshot = await registry.readRecords({ now: Date.now(), maxRecords: 100 });
  assert.equal(quietSnapshot.records.find((item) => item.recordId === "quiet-record")?.instance.status, "running", "owned quiet subprocess heartbeat must prevent registry aging");
  assert.equal((await quietRun.completion).status, "done");

  const cancelRun = startObservedPiProcess({ registry, launcher: "pi-print", producerId: "cancel", command: process.execPath, argv: ["-e", "setInterval(() => {}, 1000)"], recordId: "cancel-record", instanceId: "cancel-instance", runId: "cancel-run" });
  await cancelRun.ready;
  assert.equal(cancelRun.cancel(), true, "adapter may cancel the child it spawned");
  assert.equal((await cancelRun.completion).status, "cancelled");

  let spawnEvidence;
  let forwardedOutput = "";
  let forwardedError = "";
  const fakeChild = new EventEmitter();
  fakeChild.stdout = new PassThrough();
  fakeChild.stderr = new PassThrough();
  fakeChild.pid = 999999;
  fakeChild.exitCode = null;
  fakeChild.signalCode = null;
  fakeChild.kill = () => true;
  const declared = startObservedPiProcess({
    registry: new MemoryRegistry(), launcher: "pi-print", command: "pi", argv: ["-p", "literal ; not shell"],
    recordId: "declared-record", instanceId: "declared-instance", runId: "declared-run",
    stdoutSink: { write(chunk) { forwardedOutput += String(chunk); } }, stderrSink: { write(chunk) { forwardedError += String(chunk); } },
    spawnImpl(command, argv, options) {
      spawnEvidence = { command, argv, options };
      queueMicrotask(() => { fakeChild.stdout.write("visible"); fakeChild.stderr.write("diagnostic"); fakeChild.exitCode = 0; fakeChild.emit("close", 0, null); });
      return fakeChild;
    },
  });
  await declared.completion;
  assert.deepEqual(spawnEvidence.argv, ["-p", "literal ; not shell"]);
  assert.equal(spawnEvidence.options.shell, false, "declared argv must never use a shell");
  assert.equal(forwardedOutput, "visible", "CLI/library callers may tee observed stdout without changing framing");
  assert.equal(forwardedError, "diagnostic", "CLI/library callers may tee observed stderr");

  const failingChild = new EventEmitter();
  failingChild.stdout = new PassThrough();
  failingChild.stderr = new PassThrough();
  failingChild.pid = 999998;
  failingChild.exitCode = null;
  failingChild.signalCode = null;
  failingChild.kill = () => true;
  const failingRegistry = { writeRecord: async () => { throw new Error("registry unavailable"); }, appendArtifactEvent: async () => { throw new Error("registry unavailable"); } };
  const observationFailure = startObservedPiProcess({
    registry: failingRegistry, launcher: "pi-print", command: "pi", argv: [], recordId: "failure-record", instanceId: "failure-instance", runId: "failure-run",
    spawnImpl() { queueMicrotask(() => { failingChild.exitCode = 0; failingChild.emit("close", 0, null); }); return failingChild; },
  });
  assert.match((await observationFailure.completion).observationError, /registry unavailable/, "registry failures must settle rather than hanging the owned process observer");

  const sessionsRoot = path.join(temp, "agent", "sessions");
  await mkdir(sessionsRoot, { recursive: true });
  const sessionFile = path.join(sessionsRoot, "attached.jsonl");
  await writeFile(sessionFile, '{"type":"session","id":"attach-id"}\n');
  const FakeSessionManager = {
    async listAll() { return [{ id: "attach-id", path: sessionFile }]; },
    open(file) {
      assert.equal(file, sessionFile);
      return { getSessionId: () => "attach-id", getSessionName: () => "Attached", buildSessionContext: () => ({ model: { provider: "p", modelId: "m" }, thinkingLevel: "medium" }) };
    },
  };
  assert.equal((await resolveAttachSession({ session: "attach-id", sessionRoots: [sessionsRoot], SessionManagerImpl: FakeSessionManager })).sessionFile, sessionFile);
  await assert.rejects(() => resolveAttachSession({ session: path.join(temp, "outside.jsonl"), sessionRoots: [sessionsRoot], SessionManagerImpl: FakeSessionManager }), /inside a configured Pi session root/);

  const attachRegistry = new MemoryRegistry();
  let cliOutput = "";
  const exitCode = await runAgentCli(["attach", "--session", "attach-id", "--name", "Mirror", "--port", "4567"], {
    agentDir: path.join(temp, "agent"), registry: attachRegistry, SessionManagerImpl: FakeSessionManager,
    output: { write(value) { cliOutput += value; } }, errorOutput: { write() {} },
  });
  assert.equal(exitCode, 0);
  assert.equal(attachRegistry.records[0].instance.launcher, "interactive");
  assert.equal(attachRegistry.records[0].instance.status, "stale", "attach without a reporter must not claim running");
  assert.equal(attachRegistry.records[0].instance.capabilities.cancel, false, "PID/session evidence must not grant cancellation");
  assert.equal(attachRegistry.locators[0].sessionFile, sessionFile);
  assert.match(cliOutput, /^WebUI registration: port=4567 scope=custom-registry\nattach-id:/, "CLI must print its explicit non-default registration scope");

  await delay(10);
  console.log("agent-run-adapters.test.mjs passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
