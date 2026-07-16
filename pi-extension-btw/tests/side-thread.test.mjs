import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSideQuestionMessages,
  commitSideQuestion,
  cancelSideThread,
  createSideThread,
  enqueueSideThreadRun,
} from "../side-thread.ts";

function textOf(message) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function assistantMessage(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

test("follow-up questions retain earlier /btw turns without duplicating the main transcript", () => {
  const sideThread = createSideThread();
  const firstRequest = buildSideQuestionMessages("main-session fact", "What is the fact?", sideThread.messages);
  assert.equal(firstRequest.length, 1);
  assert.match(textOf(firstRequest[0]), /main-session fact/);

  commitSideQuestion(sideThread, firstRequest, assistantMessage("The fact is retained."));
  const followUpRequest = buildSideQuestionMessages("must not be repeated", "What did you just say?", sideThread.messages);

  assert.equal(followUpRequest.length, 3);
  assert.equal(textOf(followUpRequest[0]), textOf(firstRequest[0]));
  assert.equal(textOf(followUpRequest[1]), "The fact is retained.");
  assert.match(textOf(followUpRequest[2]), /What did you just say\?/);
  assert.doesNotMatch(textOf(followUpRequest[2]), /must not be repeated/);
});

test("concurrent side-thread submissions run in order", async () => {
  const sideThread = createSideThread();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = enqueueSideThreadRun(sideThread, async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  await Promise.resolve();

  const second = enqueueSideThreadRun(sideThread, async () => {
    events.push("second:start");
    events.push("second:end");
  });
  await Promise.resolve();

  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("session shutdown aborts active work and prevents queued work from starting", async () => {
  const sideThread = createSideThread();
  const events = [];
  let release;
  const active = enqueueSideThreadRun(sideThread, async (signal) => {
    events.push("active:start");
    await new Promise((resolve) => { release = resolve; });
    if (signal.aborted) throw new Error("aborted");
    events.push("active:publish");
  });
  const queued = enqueueSideThreadRun(sideThread, async () => { events.push("queued:start"); });
  await Promise.resolve();
  cancelSideThread(sideThread);
  release();
  await assert.rejects(active, /abort/i);
  await assert.rejects(queued, /abort/i);
  assert.deepEqual(events, ["active:start"]);
});
