import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildSideQuestionMessages,
  commitSideQuestion,
  createSideThread,
} from "../side-thread.ts";

const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");

function commandRegistration(name) {
  const startMarker = `pi.registerCommand("${name}", {`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `expected ${name} to be registered`);

  const nextRegistration = source.indexOf("pi.registerCommand(", start + startMarker.length);
  return source.slice(start, nextRegistration === -1 ? source.length : nextRegistration);
}

test("/btw-status has a fixed evidence-bounded status request", () => {
  const match = source.match(/const STATUS_REQUEST = `([\s\S]*?)`;/);
  assert.ok(match, "expected a fixed STATUS_REQUEST template literal");

  const request = match[1];
  assert.match(request, /current goal/i);
  assert.match(request, /completed work/i);
  assert.match(request, /active work/i);
  assert.match(request, /remaining todos and the next step/i);
  assert.match(request, /blockers and uncertainty/i);
  assert.match(request, /only evidence in the transcript/i);
  assert.match(request, /do not invent/i);
  assert.match(request, /missing or uncertain/i);
});

test("/btw-status registration preserves the fixed prompt and fresh-thread contracts", () => {
  const registration = commandRegistration("btw-status");
  assert.match(registration, /createSideThread\(\)/);
  assert.match(registration, /handleBtw\(\s*STATUS_REQUEST\s*,\s*ctx\s*,\s*statusThread/);
  assert.match(registration, /STATUS_PRESENTATION/);
});

test("fresh status threads embed their current transcript without cross-thread pollution", () => {
  const request = source.match(/const STATUS_REQUEST = `([\s\S]*?)`;/)?.[1];
  assert.ok(request, "expected the status request to be available for behavioral coverage");

  const firstThread = createSideThread();
  const secondThread = createSideThread();
  const firstMessages = buildSideQuestionMessages("transcript from first invocation", request, firstThread.messages);
  commitSideQuestion(firstThread, firstMessages, {
    role: "assistant",
    content: [{ type: "text", text: "first status answer" }],
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
  });
  const secondMessages = buildSideQuestionMessages("updated transcript from second invocation", request, secondThread.messages);

  const firstText = firstMessages[0].content[0].text;
  const secondText = secondMessages[0].content[0].text;
  assert.match(firstText, /transcript from first invocation/);
  assert.match(firstText, /Summarize the current main session status/);
  assert.match(secondText, /updated transcript from second invocation/);
  assert.match(secondText, /Summarize the current main session status/);
  assert.doesNotMatch(secondText, /first status answer|transcript from first invocation/);
  assert.equal(secondThread.messages.length, 0);
  assert.equal(firstThread.messages.length, 2);
});

test("/btw-status tracks fresh threads until settlement and cancels them on shutdown", () => {
  assert.match(source, /const statusThreads = new Set<SideThread>\(\)/);
  assert.match(source, /statusThreads\.add\(statusThread\)/);
  assert.match(source, /for \(const statusThread of statusThreads\) cancelSideThread\(statusThread\)/);
  assert.match(source, /onSettled:\s*\(\)\s*=>\s*statusThreads\.delete\(statusThread\)/);
});

test("/btw-status uses status-specific display and error presentation", () => {
  assert.match(source, /displayQuestion:\s*"Current session, goal, and todo status"/);
  assert.match(source, /overlayTitle:\s*"\/btw session status"/);
  assert.match(source, /footerText:\s*"Fresh session snapshot/);
  assert.match(source, /commandName:\s*"\/btw-status"/);
  assert.match(source, /errorPrefix:\s*"\/btw-status failed"/);
  assert.match(source, /createWebuiPublisher\(ctx, id, displayQuestion, footerText\)/);
});

test("/btw keeps the persistent session side thread", () => {
  const registration = commandRegistration("btw");
  assert.match(registration, /handler:\s*\(args,\s*ctx\)\s*=>\s*handleBtw\(args,\s*ctx,\s*sideThread\)/);
  assert.doesNotMatch(registration, /handleBtw\(args,\s*ctx,\s*createSideThread\(\)\)/);
});
