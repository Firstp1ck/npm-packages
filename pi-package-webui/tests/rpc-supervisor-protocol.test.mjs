import assert from "node:assert/strict";
import {
  PI_RPC_JSONL_LINE_MAX_BYTES,
  RPC_SUPERVISOR_MAX_FRAME_BYTES,
  RPC_SUPERVISOR_PROTOCOL,
  RpcSupervisorProtocolError,
  constantTimeTokenEqual,
  encodeFrame,
  frameReader,
  sanitizeSupervisorData,
  validateClientFrame,
} from "../lib/rpc-supervisor-protocol.mjs";

const attach = validateClientFrame({
  type: "attach", version: RPC_SUPERVISOR_PROTOCOL, scopeId: "a".repeat(64), token: "private-token", controllerId: "controller-1",
});
assert.equal(attach.token, "private-token", "attach validation must retain the private token for authentication");
assert.equal(constantTimeTokenEqual("same", "same"), true);
assert.equal(constantTimeTokenEqual("same", "different"), false);

const rawPiCommand = {
  type: "prompt",
  message: "x".repeat(64 * 1024 + 1),
  apiToken: "must-round-trip-over-local-pi-transport",
  tokens: { input: 123, output: 456 },
  entries: Array.from({ length: 257 }, (_, index) => ({ index, token: `token-${index}` })),
};
const command = validateClientFrame({ type: "command", requestId: "request-1", tabId: "tab-1", command: rawPiCommand, timeoutMs: 500 });
assert.strictEqual(command.command, rawPiCommand, "live command validation must retain the original Pi RPC object");
assert.equal(command.command.apiToken, "must-round-trip-over-local-pi-transport");
assert.equal(command.command.message.length, 64 * 1024 + 1);
assert.equal(command.command.entries.length, 257);
assert.deepEqual(command.command.tokens, { input: 123, output: 456 });
const write = validateClientFrame({ type: "write", requestId: "write-1", tabId: "tab-1", command: { type: "extension_ui_response", id: "ui-1", tokens: { keep: true } } });
assert.equal(write.command.tokens.keep, true, "raw write validation must not strip token-named data");
assert.throws(
  () => validateClientFrame({ type: "write", requestId: "write-timeout", tabId: "tab-1", command: { type: "extension_ui_response" }, timeoutMs: 1 }),
  RpcSupervisorProtocolError,
  "fire-and-forget writes must not accept response timeouts",
);
assert.throws(
  () => validateClientFrame({ type: "command", requestId: "oversized-pi-line", tabId: "tab-1", command: { type: "prompt", message: "x".repeat(PI_RPC_JSONL_LINE_MAX_BYTES) } }),
  RpcSupervisorProtocolError,
  "a Pi command at the bounded JSONL limit plus its envelope must be rejected rather than truncated",
);
for (const timeoutMs of [7_200_000, 86_400_000]) {
  const accepted = validateClientFrame({ type: "command", requestId: `timeout-${timeoutMs}`, tabId: "tab-1", command: { type: "prompt", message: "bounded" }, timeoutMs });
  assert.equal(accepted.timeoutMs, timeoutMs, `${timeoutMs}ms command timeout should be accepted`);
}
assert.throws(
  () => validateClientFrame({ type: "command", requestId: "timeout-too-large", tabId: "tab-1", command: { type: "prompt", message: "unbounded" }, timeoutMs: 86_400_001 }),
  RpcSupervisorProtocolError,
  "command timeouts above 24 hours must be rejected",
);
assert.deepEqual(sanitizeSupervisorData({ password: "no", nested: { Authorization: "no", safe: true } }), { nested: { safe: true } });
assert.throws(() => validateClientFrame({ type: "command", requestId: "x", tabId: "t", command: { type: "prompt" }, unexpected: true }), RpcSupervisorProtocolError);
assert.throws(() => validateClientFrame({ type: "create", requestId: "x", tabId: "t", metadata: {}, child: { command: "pi", args: [], cwd: "/tmp", env: {} } }), RpcSupervisorProtocolError);
assert.throws(() => encodeFrame({ value: "x".repeat(RPC_SUPERVISOR_MAX_FRAME_BYTES) }), RpcSupervisorProtocolError);

const frames = [];
const errors = [];
const consume = frameReader((frame) => frames.push(frame), (error) => errors.push(error));
consume('{"type":"event"}\n{"type":"result"');
consume(',"requestId":"r"}\n');
assert.deepEqual(frames, [{ type: "event" }, { type: "result", requestId: "r" }]);
assert.equal(errors.length, 0);
console.log("rpc-supervisor-protocol.test.mjs passed");
