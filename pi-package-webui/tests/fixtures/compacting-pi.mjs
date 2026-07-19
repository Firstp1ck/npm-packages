#!/usr/bin/env node
// JSONL RPC fixture that simulates a Pi session compacting while the Web UI
// queues a prompt for automatic resume after compaction_end.
import { createInterface } from "node:readline";

const COMPACTION_TRIGGER = "__pi_webui_test_start_compaction__";
const ABORTED_COMPACTION_TRIGGER = "__pi_webui_test_start_aborted_compaction__";

let isCompacting = false;
let compactionTimer = null;
let compactionWillAbort = false;
const received = [];

function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function statePayload() {
  return {
    model: { provider: "fake", id: "fake-model" },
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    sessionFile: undefined,
    sessionId: "fake-compaction-session",
    sessionName: "fake-compaction",
    autoCompactionEnabled: true,
    messageCount: received.length,
    pendingMessageCount: 0,
  };
}

function finishCompaction() {
  compactionTimer = null;
  isCompacting = false;
  const aborted = compactionWillAbort;
  compactionWillAbort = false;
  emit({
    type: "compaction_end",
    reason: "test",
    result: aborted ? null : { summary: "fake compaction summary", tokensBefore: 1000, estimatedTokensAfter: 100 },
    aborted,
    willRetry: false,
  });
}

function startCompaction({ aborted = false } = {}) {
  if (compactionTimer) clearTimeout(compactionTimer);
  isCompacting = true;
  compactionWillAbort = aborted;
  emit({ type: "compaction_start", reason: "test" });
  compactionTimer = setTimeout(finishCompaction, 1500);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return;
  }

  const { id, type } = command || {};
  if (!id || !type) return;
  const base = { type: "response", id, command: type, success: true };

  switch (type) {
    case "get_state":
      respond({ ...base, data: statePayload() });
      return;
    case "get_messages":
      respond({
        ...base,
        data: {
          messages: received.map((entry, index) => ({
            role: "user",
            content: `${entry.type}:${entry.message}`,
            timestamp: 1000 + index,
          })),
        },
      });
      return;
    case "get_available_models":
      respond({ ...base, data: { models: [{ provider: "fake", id: "fake-model", name: "Fake Model" }] } });
      return;
    case "get_session_stats":
      respond({ ...base, data: { tokens: 0 } });
      return;
    case "prompt": {
      const message = String(command.message || "");
      if (message === COMPACTION_TRIGGER || message === ABORTED_COMPACTION_TRIGGER) {
        startCompaction({ aborted: message === ABORTED_COMPACTION_TRIGGER });
        respond({ ...base, data: { compacting: true } });
        return;
      }
      received.push({ type: "prompt", message, streamingBehavior: command.streamingBehavior || "" });
      respond({ ...base, data: { received: received.length } });
      return;
    }
    case "steer":
    case "follow_up":
      received.push({ type, message: String(command.message || "") });
      respond({ ...base, data: { received: received.length } });
      return;
    default:
      respond({ ...base, data: {} });
  }
});

process.on("exit", () => {
  if (compactionTimer) clearTimeout(compactionTimer);
});
