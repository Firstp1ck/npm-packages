import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSessionSummaryPreferences } from "../lib/session-summary-preferences.mjs";
import {
  SESSION_SUMMARY_DISPLAY_TYPE,
  SESSION_SUMMARY_INJECTION_TYPE,
  SESSION_SUMMARY_INPUT_MAX_CHARS,
  SESSION_SUMMARY_MAX_OUTPUT_TOKENS,
  SESSION_SUMMARY_NAME_PROVENANCE_TYPE,
  SESSION_SUMMARY_OUTPUT_MAX_CHARS,
  SESSION_SUMMARY_RAW_OUTPUT_MAX_CHARS,
  SESSION_SUMMARY_RPC_TYPE,
  SESSION_SUMMARY_STATE_TYPE,
  boundedRpcPayload,
  captureSummarySource,
  createSummaryScheduler,
  filterAndInjectSummaryContext,
  isSummarySourceCurrent,
  latestSummaryNameProvenance,
  latestSummaryState,
  normalizeSummaryTitle,
  parseSummaryOutput,
  serializeSummarySource,
  shouldApplySummaryTitle,
} from "../lib/session-summary-core.mjs";

const entries = [
  { type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "Please fix auth" }, { type: "image", data: "SECRET_IMAGE" }] } },
  { type: "message", id: "a1", message: { role: "assistant", content: [
    { type: "thinking", thinking: "SECRET_THINKING" },
    { type: "text", text: "I inspected the flow." },
    { type: "toolCall", name: "read", arguments: { path: "/secret/path", token: "SECRET_ARG" } },
  ] } },
  { type: "message", id: "tool", message: { role: "toolResult", content: [{ type: "text", text: "SECRET_RESULT" }] } },
  { type: "custom_message", customType: SESSION_SUMMARY_DISPLAY_TYPE, content: "RECURSIVE_SUMMARY", display: true },
  { type: "custom", customType: SESSION_SUMMARY_STATE_TYPE, data: { raw: "RECURSIVE_STATE" } },
  { type: "message", id: "u2", message: { role: "user", content: "Ship it" } },
];
const serialized = serializeSummarySource(entries);
assert.match(serialized.text, /User:\nPlease fix auth/);
assert.match(serialized.text, /Assistant:\nI inspected the flow\./);
assert.match(serialized.text, /Tool used: read/);
assert.match(serialized.text, /User:\nShip it/);
for (const secret of ["SECRET_IMAGE", "SECRET_THINKING", "SECRET_ARG", "SECRET_RESULT", "RECURSIVE_SUMMARY", "RECURSIVE_STATE", "/secret/path"]) {
  assert.equal(serialized.text.includes(secret), false, `serializer excludes ${secret}`);
}
assert.equal(serialized.userTurns, 2);
assert.equal(serialized.entryCount, entries.length);
assert.equal(serialized.fingerprint.length, 64);
assert.equal(serializeSummarySource(entries).fingerprint, serialized.fingerprint, "fingerprint is deterministic");

const bounded = serializeSummarySource([
  { type: "message", message: { role: "user", content: "a".repeat(SESSION_SUMMARY_INPUT_MAX_CHARS + 100) } },
], { maxChars: 128 });
assert.equal(bounded.text.length, 128);
assert.match(bounded.text, /^\[Earlier conversation omitted/);
assert.equal(bounded.omitted, true);

assert.deepEqual(parseSummaryOutput(JSON.stringify({ version: 1, title: "  Auth\nflow  ", summaryMarkdown: "# Done\n\nSafe" })), {
  version: 1,
  title: "Auth flow",
  summaryMarkdown: "# Done\n\nSafe",
});
assert.equal(normalizeSummaryTitle("a".repeat(100)).length, 44);
assert.equal(parseSummaryOutput(JSON.stringify({ version: 1, title: "\u0000\n", summaryMarkdown: "ok" })).title, undefined, "invalid title does not corrupt a valid summary");
await assert.rejects(async () => parseSummaryOutput("```json\n{}\n```"), /invalid JSON/);
await assert.rejects(async () => parseSummaryOutput('{"version":2,"summaryMarkdown":"ok"}'), /unsupported schema/);
await assert.rejects(async () => parseSummaryOutput('{"version":1,"summaryMarkdown":""}'), /empty/);
await assert.rejects(async () => parseSummaryOutput(JSON.stringify({ version: 1, title: 42, summaryMarkdown: "ok" })), /title has an invalid type/);
await assert.rejects(async () => parseSummaryOutput(JSON.stringify({ version: 1, summaryMarkdown: "ok", extra: true })), /unknown schema fields/);
await assert.rejects(async () => parseSummaryOutput(JSON.stringify({
  version: 1,
  summaryMarkdown: "ok",
  unknown: "x".repeat(SESSION_SUMMARY_RAW_OUTPUT_MAX_CHARS),
})), /total response bound/);
await assert.rejects(async () => parseSummaryOutput(JSON.stringify({ version: 1, summaryMarkdown: "x".repeat(SESSION_SUMMARY_OUTPUT_MAX_CHARS + 1) })), /exceeds/);

const baseState = {
  version: 1,
  source: { sessionId: "s1", leafId: "u2", fingerprint: serialized.fingerprint, entryCount: entries.length },
  result: { title: "Auth flow", summaryMarkdown: "# Current" },
  generation: { provider: "fake", modelId: "fake", thinkingLevel: "low", promptRevision: "v1" },
  generatedAt: "2026-08-04T00:00:00.000Z",
  settledTurnOrdinal: 2,
  titleAppliedAtOrdinal: 2,
};
assert.deepEqual(latestSummaryState([
  { type: "custom", customType: SESSION_SUMMARY_STATE_TYPE, data: { ...baseState, result: { ...baseState.result, summaryMarkdown: "# Older" } } },
  { type: "custom", customType: "other", data: baseState },
  { type: "custom", customType: SESSION_SUMMARY_STATE_TYPE, data: baseState },
]), baseState);
const escapedPersistedSummary = "\\".repeat(12_000);
assert.equal(latestSummaryState([{
  type: "custom",
  customType: SESSION_SUMMARY_STATE_TYPE,
  data: { ...baseState, result: { ...baseState.result, summaryMarkdown: escapedPersistedSummary } },
}]).result.summaryMarkdown, escapedPersistedSummary, "persisted state validation uses the decoded Markdown bound");
assert.equal(latestSummaryState([{ type: "custom", customType: SESSION_SUMMARY_STATE_TYPE, data: { version: 99 } }]), undefined);
const titlelessState = { ...baseState, result: { summaryMarkdown: "# Valid titleless summary" }, titleAppliedAtOrdinal: undefined };
assert.equal(latestSummaryState([{ type: "custom", customType: SESSION_SUMMARY_STATE_TYPE, data: titlelessState }]).result.summaryMarkdown, "# Valid titleless summary", "valid titleless generated states remain discoverable");
assert.deepEqual(latestSummaryNameProvenance([
  { type: "custom", customType: SESSION_SUMMARY_NAME_PROVENANCE_TYPE, data: { version: 1, explicit: true } },
  { type: "custom", customType: SESSION_SUMMARY_NAME_PROVENANCE_TYPE, data: { version: 99, explicit: false } },
  { type: "custom", customType: SESSION_SUMMARY_NAME_PROVENANCE_TYPE, data: { version: 1, explicit: false } },
]), { version: 1, explicit: false });

const originalMessages = [
  { role: "user", content: "direct", timestamp: 1 },
  { role: "custom", customType: SESSION_SUMMARY_DISPLAY_TYPE, content: "old display", display: true, timestamp: 2 },
  { role: "custom", customType: SESSION_SUMMARY_RPC_TYPE, content: "old rpc", display: false, timestamp: 3 },
  { role: "custom", customType: SESSION_SUMMARY_INJECTION_TYPE, content: "old injection", display: false, timestamp: 4 },
];
assert.deepEqual(filterAndInjectSummaryContext(originalMessages), [originalMessages[0]]);
const injected = filterAndInjectSummaryContext(originalMessages, { injectLatest: true, state: baseState });
assert.equal(injected.length, 2);
assert.equal(injected[1].customType, SESSION_SUMMARY_INJECTION_TYPE);
assert.match(injected[1].content, /Reference-only generated session summary/);
assert.match(injected[1].content, /# Current/);
assert.equal(injected.filter((message) => message.customType === SESSION_SUMMARY_INJECTION_TYPE).length, 1);

assert.equal(shouldApplySummaryTitle({ candidate: "First", settledTurnOrdinal: 1 }), true, "first generated title applies immediately");
assert.equal(shouldApplySummaryTitle({ candidate: "Changed", currentSessionName: "Manual name", settledTurnOrdinal: 10 }), false, "explicit name wins");
assert.equal(shouldApplySummaryTitle({ candidate: "Changed", currentSessionName: "Auth flow", previousState: baseState, settledTurnOrdinal: 4, minSettledTurns: 3 }), false);
assert.equal(shouldApplySummaryTitle({ candidate: "Changed", currentSessionName: "Auth flow", previousState: baseState, settledTurnOrdinal: 5, minSettledTurns: 3 }), true);
assert.equal(shouldApplySummaryTitle({ candidate: "Auth flow", currentSessionName: "Auth flow", previousState: baseState, settledTurnOrdinal: 9 }), false, "unchanged candidate never reapplies");
assert.equal(shouldApplySummaryTitle({ candidate: "Changed", currentSessionName: "Explicit", previousState: baseState, settledTurnOrdinal: 9 }), false, "manual rename after generated title wins");
assert.equal(shouldApplySummaryTitle({ candidate: "Changed", currentSessionName: "Auth flow", previousState: baseState, explicitName: true, settledTurnOrdinal: 9 }), false, "same-text explicit rename wins");
assert.equal(shouldApplySummaryTitle({ candidate: "Changed", currentSessionName: undefined, previousState: baseState, explicitName: false, settledTurnOrdinal: 9 }), true, "clearing an explicit name re-enables generated titles");

const branch = [...entries];
const session = {
  getBranch: () => branch,
  getSessionId: () => "s1",
  getSessionFile: () => "/tmp/s1.jsonl",
  getLeafId: () => "u2",
};
const captured = captureSummarySource(session);
assert.equal(isSummarySourceCurrent(session, captured), true);
branch.push({ type: "message", id: "u3", message: { role: "user", content: "new work" } });
assert.equal(isSummarySourceCurrent({ ...session, getLeafId: () => "u3" }, captured), false, "new leaf makes result stale");

assert.deepEqual(boundedRpcPayload("setup", { configured: true, enabled: false, credentials: "secret" }), {
  version: 1, kind: "setup", configured: true, enabled: false,
});
assert.equal(boundedRpcPayload("success", { title: "t".repeat(100), summaryMarkdown: "s".repeat(20_000) }).title.length, 44);
assert.equal(boundedRpcPayload("success", { summaryMarkdown: "s".repeat(20_000) }).summaryMarkdown.length, SESSION_SUMMARY_OUTPUT_MAX_CHARS);
assert.equal(boundedRpcPayload("failure", { message: "x".repeat(1000) }).message.length, 512);
assert.throws(() => boundedRpcPayload("unknown"), /Unsupported/);

let releaseFirst;
const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
const calls = [];
const statuses = [];
const scheduler = createSummaryScheduler({
  run: async (input) => {
    calls.push(input);
    if (input === "first") await firstBlocked;
    return input;
  },
  onState: (status) => statuses.push(status),
});
const firstPromise = scheduler.schedule("first");
assert.equal(calls.length, 0, "schedule defers generation so lifecycle handlers can return immediately");
await Promise.resolve();
assert.deepEqual(calls, ["first"]);
assert.equal(scheduler.getState().inFlight, true);
const joined = scheduler.schedule("second");
scheduler.schedule("newest");
assert.equal(joined, firstPromise, "one in-flight promise is reused");
releaseFirst();
assert.equal((await firstPromise).status, "success");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(calls, ["first", "newest"], "automatic work coalesces to the newest pending input");
assert.equal(statuses.filter((status) => status === "generating").length, 2);

let now = 100;
let attempts = 0;
const cooldownScheduler = createSummaryScheduler({
  now: () => now,
  cooldownMs: 300,
  run: async () => { attempts += 1; throw new Error("provider failed"); },
});
assert.equal((await cooldownScheduler.schedule("a")).status, "failure");
assert.equal((await cooldownScheduler.schedule("b")).status, "cooldown");
assert.equal(attempts, 1);
assert.equal((await cooldownScheduler.schedule("manual", { manual: true })).status, "failure", "manual refresh bypasses cooldown");
assert.equal(attempts, 2);
now = 401;
assert.equal((await cooldownScheduler.schedule("c")).status, "failure");
assert.equal(attempts, 3);

let rejectBlockedFailure;
let interactionAttempts = 0;
const blockedFailure = new Promise((_resolve, reject) => { rejectBlockedFailure = reject; });
const interactionScheduler = createSummaryScheduler({
  now: () => 1_000,
  cooldownMs: 300,
  run: async (input) => {
    interactionAttempts += 1;
    if (input === "first") return blockedFailure;
    throw new Error(`failed ${input}`);
  },
});
const interactionFirst = interactionScheduler.schedule("first");
await Promise.resolve();
interactionScheduler.schedule("pending");
rejectBlockedFailure(new Error("automatic failed"));
assert.equal((await interactionFirst).status, "failure");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(interactionScheduler.getState().inFlight, false, "cooldown-skipped pending work does not wedge inFlight");
assert.equal(interactionScheduler.getState().pending, false);
assert.equal(interactionAttempts, 1);
assert.equal((await interactionScheduler.schedule("manual", { manual: true })).status, "failure", "manual refresh still bypasses cooldown after a coalesced failure");
assert.equal(interactionAttempts, 2);

let observedAbort = false;
const abortScheduler = createSummaryScheduler({ run: (_input, signal) => new Promise((_resolve, reject) => {
  signal.addEventListener("abort", () => { observedAbort = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
}) });
const aborted = abortScheduler.schedule("work");
await Promise.resolve();
abortScheduler.abort();
assert.equal((await aborted).status, "aborted");
assert.equal(observedAbort, true);
assert.equal(abortScheduler.getState().disposed, true);

// Load the public TypeScript extension with an injected fake completion. No provider is contacted.
const extensionTemp = await mkdtemp(join(tmpdir(), "session-summary-extension-"));
const previousConfigFile = process.env.PI_SESSION_SUMMARY_CONFIG_FILE;
try {
  const configFile = join(extensionTemp, "summary.json");
  process.env.PI_SESSION_SUMMARY_CONFIG_FILE = configFile;
  await writeSessionSummaryPreferences({
    configured: true,
    enabled: true,
    model: { provider: "openai-codex", modelId: "gpt-5.6-luna", thinkingLevel: "low" },
  }, configFile);
  const { createSessionSummaryExtension } = await import("../session-summary.ts");
  const branchEntries = [
    { type: "message", id: "u1", parentId: null, message: { role: "user", content: "Implement summaries" } },
    { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: [{ type: "text", text: "Core is ready" }] } },
  ];
  let activeBranch = branchEntries;
  let leafId = "a1";
  let sessionName;
  let releaseComplete;
  let completeGate = new Promise((resolve) => { releaseComplete = resolve; });
  let nextCompletionError;
  let fakeOutput = { version: 1, title: "Summary core", summaryMarkdown: "# Summary\n\nCore is ready." };
  const completionCalls = [];
  const handlers = new Map();
  const commands = new Map();
  const renderers = new Map();
  const api = {
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, options) { commands.set(name, options); },
    registerTool() {},
    registerEntryRenderer(name, renderer) { renderers.set(name, renderer); },
    sendMessage(message) {
      const id = `e${activeBranch.length + 1}`;
      activeBranch.push({ type: "custom_message", id, parentId: leafId, ...message });
      leafId = id;
    },
    appendEntry(customType, data) {
      const id = `e${activeBranch.length + 1}`;
      activeBranch.push({ type: "custom", id, parentId: leafId, customType, data });
      leafId = id;
    },
    setSessionName(name) {
      sessionName = name.trim() || undefined;
      const id = `e${activeBranch.length + 1}`;
      activeBranch.push({ type: "session_info", id, parentId: leafId, name: sessionName });
      leafId = id;
      handlers.get("session_info_changed")?.({ type: "session_info_changed", name: sessionName }, ctx);
    },
    getSessionName() { return sessionName; },
  };
  let fakeModel = { provider: "openai-codex", id: "gpt-5.6-luna", api: "openai-codex-responses", reasoning: true };
  let fakeAuth = { ok: true, apiKey: "fake-key", headers: { "x-fake": "yes" }, env: {} };
  const ctx = {
    mode: "rpc",
    hasUI: true,
    ui: { notify() {} },
    sessionManager: {
      getBranch: () => activeBranch.slice(),
      getSessionId: () => "fake-session",
      getSessionFile: () => "/tmp/fake-session.jsonl",
      getLeafId: () => leafId,
    },
    modelRegistry: {
      find: (provider, modelId) => provider === fakeModel.provider && modelId === fakeModel.id ? fakeModel : undefined,
      getApiKeyAndHeaders: async () => fakeAuth,
    },
  };
  const fakeComplete = async (...args) => {
    completionCalls.push(args);
    const gate = completeGate;
    const error = nextCompletionError;
    nextCompletionError = undefined;
    await gate;
    if (error) throw error;
    return {
      stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify(fakeOutput) }],
    };
  };
  createSessionSummaryExtension({ completeFn: fakeComplete })(api);

  assert.deepEqual([...commands.keys()].sort(), ["summary", "summary-setup"]);
  assert.equal(renderers.has(SESSION_SUMMARY_DISPLAY_TYPE), true, "non-contextual TUI Markdown entry renderer is registered");
  assert.equal(handlers.has("agent_settled"), true);
  assert.equal(handlers.has("agent_end"), false, "generation is never registered on agent_end");
  const settledReturn = handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
  assert.equal(settledReturn, undefined, "settled handler returns synchronously");
  assert.equal(completionCalls.length, 0, "provider work does not delay outward settlement");
  for (let i = 0; i < 20 && completionCalls.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completionCalls.length, 1);
  const [, completionContext, completionOptions] = completionCalls[0];
  assert.equal(completionContext.tools, undefined);
  assert.match(completionContext.systemPrompt, /untrusted data/);
  assert.equal(completionOptions.cacheRetention, "none");
  assert.equal(completionOptions.reasoning, "low");
  assert.equal(completionOptions.reasoningEffort, undefined, "provider-specific raw reasoning options are not used");
  assert.equal(completionOptions.onPayload, undefined, "provider payloads are not unconditionally mutated");
  assert.equal(completionOptions.maxRetries, 0);
  assert.equal(completionOptions.maxTokens, SESSION_SUMMARY_MAX_OUTPUT_TOKENS);
  assert.equal(completionOptions.timeoutMs, 90_000);
  assert.equal(typeof completionOptions.sessionId, "string");
  assert.notEqual(completionOptions.sessionId, "fake-session", "completion uses a fresh routing ID");
  releaseComplete();
  for (let i = 0; i < 20 && !branchEntries.some((entry) => entry.customType === SESSION_SUMMARY_STATE_TYPE); i += 1) await new Promise((resolve) => setImmediate(resolve));
  const persistedState = latestSummaryState(branchEntries);
  assert.equal(persistedState.result.summaryMarkdown, "# Summary\n\nCore is ready.");
  assert.equal(sessionName, "Summary core", "first generated title applies immediately");
  assert.equal(branchEntries.filter((entry) => entry.customType === SESSION_SUMMARY_STATE_TYPE).length, 1);
  assert.equal(branchEntries.filter((entry) => entry.customType === SESSION_SUMMARY_RPC_TYPE).every((entry) => entry.content === ""), true, "RPC control messages carry no context text");

  const contextResult = await handlers.get("context")({ type: "context", messages: [
    { role: "user", content: "latest", timestamp: 1 },
    { role: "custom", customType: SESSION_SUMMARY_RPC_TYPE, content: "", display: false, timestamp: 2 },
  ] }, ctx);
  assert.equal(contextResult.messages.some((message) => message.customType === SESSION_SUMMARY_RPC_TYPE), false);
  assert.equal(contextResult.messages.some((message) => message.customType === SESSION_SUMMARY_INJECTION_TYPE), false, "context injection remains off by default");

  completeGate = new Promise((resolve) => { releaseComplete = resolve; });
  nextCompletionError = new Error("overlap failed");
  const overlapCallIndex = completionCalls.length;
  handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
  for (let i = 0; i < 20 && completionCalls.length === overlapCallIndex; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completionCalls.length, overlapCallIndex + 1);
  const overlapRefresh = commands.get("summary").handler("refresh", ctx);
  releaseComplete();
  await overlapRefresh;
  const overlapFailures = branchEntries.filter((entry) => entry.details?.kind === "failure" && entry.details?.message === "overlap failed");
  assert.equal(overlapFailures.length, 1, "manual refresh joining an automatic failure emits one terminal RPC event");
  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  createSessionSummaryExtension({ completeFn: fakeComplete })(api);

  completeGate = new Promise((resolve) => { releaseComplete = resolve; });
  nextCompletionError = undefined;
  fakeOutput = { version: 1, summaryMarkdown: "# First automatic refresh" };
  const coalescedFailureCountBefore = branchEntries.filter((entry) => entry.details?.kind === "failure" && entry.details?.message === "pending automatic failed").length;
  const coalescedCallIndex = completionCalls.length;
  handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
  for (let i = 0; i < 20 && completionCalls.length === coalescedCallIndex; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completionCalls.length, coalescedCallIndex + 1);
  handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
  nextCompletionError = new Error("pending automatic failed");
  completeGate = Promise.resolve();
  releaseComplete();
  for (let i = 0; i < 40 && !branchEntries.some((entry) => entry.details?.kind === "failure" && entry.details?.message === "pending automatic failed"); i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(completionCalls.length, coalescedCallIndex + 2, "pending automatic refresh launches after the first succeeds");
  const coalescedFailures = branchEntries.filter((entry) => entry.details?.kind === "failure" && entry.details?.message === "pending automatic failed");
  assert.equal(coalescedFailures.length - coalescedFailureCountBefore, 1, "an internally launched pending failure emits exactly one terminal RPC event");

  for (let i = 0; i < 20 && !branchEntries.some((entry) => entry.details?.kind === "success"); i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(latestSummaryNameProvenance(branchEntries), undefined, "self-generated rename does not record explicit provenance");

  api.setSessionName("Summary core");
  assert.equal(latestSummaryNameProvenance(branchEntries)?.explicit, true, "same-text explicit rename is recorded");
  for (let index = 0; index < 3; index += 1) {
    const id = `manual-u${index}`;
    activeBranch.push({ type: "message", id, parentId: leafId, message: { role: "user", content: `Follow-up ${index}` } });
    leafId = id;
  }
  fakeOutput = { version: 1, title: "Must not replace explicit", summaryMarkdown: "# Explicit protected" };
  await commands.get("summary").handler("refresh", ctx);
  assert.equal(sessionName, "Summary core", "same-text explicit rename is not overwritten after cadence");
  assert.equal(latestSummaryState(branchEntries).result.title, "Summary core");
  assert.equal(branchEntries.some((entry) => entry.type === "custom_message" && entry.customType === SESSION_SUMMARY_DISPLAY_TYPE), false, "TUI display does not append contextual custom messages");
  const displayEntry = branchEntries.findLast((entry) => entry.type === "custom" && entry.customType === SESSION_SUMMARY_DISPLAY_TYPE);
  assert.equal(displayEntry.data.summaryMarkdown, "# Explicit protected", "manual display appends a non-contextual rendered entry");

  api.setSessionName("");
  assert.equal(latestSummaryNameProvenance(branchEntries)?.explicit, false, "clearing an explicit name records branch-local cleared provenance");
  fakeOutput = { version: 1, title: "Generated after clear", summaryMarkdown: "# Name cleared" };
  await commands.get("summary").handler("refresh", ctx);
  assert.equal(sessionName, "Generated after clear", "clearing an explicit name re-enables generated titles");
  assert.equal(latestSummaryNameProvenance(branchEntries)?.explicit, false, "self rename preserves the preceding cleared provenance");

  const branchA = activeBranch;
  const branchB = [
    { type: "message", id: "b-u1", parentId: null, message: { role: "user", content: "Alternate branch" } },
    { type: "message", id: "b-a1", parentId: "b-u1", message: { role: "assistant", content: "No summary here yet" } },
  ];
  activeBranch = branchB;
  leafId = "b-a1";
  sessionName = undefined;
  await handlers.get("session_tree")({ type: "session_tree", oldLeafId: branchA.at(-1).id, newLeafId: leafId }, ctx);
  const branchBProjection = branchB.findLast((entry) => entry.details?.kind === "state")?.details;
  assert.equal(branchBProjection?.summaryMarkdown, undefined, "tree navigation publishes the active branch's empty projection");
  activeBranch = branchA;
  leafId = branchA.at(-1).id;
  sessionName = "Generated after clear";
  await handlers.get("session_tree")({ type: "session_tree", oldLeafId: "b-a1", newLeafId: leafId }, ctx);
  const branchAProjection = branchA.findLast((entry) => entry.details?.kind === "state")?.details;
  assert.equal(branchAProjection?.summaryMarkdown, "# Name cleared", "tree navigation restores the latest active-branch summary");

  completeGate = new Promise((resolve) => { releaseComplete = resolve; });
  fakeOutput = { version: 1, title: "Stale title", summaryMarkdown: "# Stale result" };
  const staleCallIndex = completionCalls.length;
  const staleRefresh = commands.get("summary").handler("refresh", ctx);
  for (let i = 0; i < 20 && completionCalls.length === staleCallIndex; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completionCalls.length, staleCallIndex + 1);
  activeBranch = branchB;
  leafId = branchB.at(-1).id;
  sessionName = undefined;
  await handlers.get("session_tree")({ type: "session_tree", oldLeafId: branchA.at(-1).id, newLeafId: leafId }, ctx);
  releaseComplete();
  await staleRefresh;
  assert.equal(latestSummaryState(branchB), undefined, "stale in-flight output is discarded after tree navigation");
  const terminalProjection = branchB.findLast((entry) => entry.details?.kind === "state")?.details;
  assert.equal(terminalProjection?.summaryMarkdown, undefined, "stale generation emits a terminal restored state");
  assert.equal(branchB.findLast((entry) => entry.details?.kind)?.details.kind, "state", "stale generation does not leave the projection generating");

  completeGate = Promise.resolve();
  fakeOutput = { version: 1, summaryMarkdown: "# Provider-neutral" };
  const representativeCases = [
    {
      model: { provider: "openai", id: "gpt-fake", api: "openai-responses", reasoning: true },
      auth: { ok: true, apiKey: "openai-key", headers: { "x-openai": "yes" }, env: {} },
    },
    {
      model: { provider: "anthropic", id: "claude-fake", api: "anthropic-messages", reasoning: true },
      auth: { ok: true, headers: { "x-api-key": "header-only" }, env: {} },
    },
    {
      model: { provider: "google", id: "gemini-fake", api: "google-generative-ai", reasoning: true },
      auth: { ok: true, apiKey: "google-key", headers: {}, env: { GOOGLE_CLOUD_PROJECT: "fake" } },
    },
    {
      model: { provider: "amazon-bedrock", id: "bedrock-fake", api: "bedrock-converse-stream", reasoning: true },
      auth: { ok: true, headers: { "x-trace": "ambient" }, env: { AWS_PROFILE: "fake" } },
    },
  ];
  const routingIds = new Set();
  for (const representative of representativeCases) {
    fakeModel = representative.model;
    fakeAuth = representative.auth;
    await writeSessionSummaryPreferences({
      configured: true,
      enabled: true,
      model: { provider: fakeModel.provider, modelId: fakeModel.id, thinkingLevel: "low" },
      title: { enabled: false, minSettledTurns: 3 },
    }, configFile);
    const callIndex = completionCalls.length;
    await commands.get("summary").handler("refresh", ctx);
    assert.equal(completionCalls.length, callIndex + 1, `${fakeModel.api} uses exactly one request`);
    const [calledModel, calledContext, calledOptions] = completionCalls.at(-1);
    assert.equal(calledModel, fakeModel);
    assert.equal(calledContext.tools, undefined, `${fakeModel.api} receives no tools`);
    assert.equal(calledOptions.reasoning, "low", `${fakeModel.api} receives provider-neutral reasoning`);
    assert.equal(calledOptions.reasoningEffort, undefined);
    assert.equal(calledOptions.onPayload, undefined, `${fakeModel.api} payload is left to the installed adapter`);
    assert.equal(calledOptions.maxTokens, SESSION_SUMMARY_MAX_OUTPUT_TOKENS);
    assert.equal(calledOptions.cacheRetention, "none");
    assert.equal(calledOptions.maxRetries, 0);
    assert.equal(calledOptions.apiKey, representative.auth.apiKey);
    assert.deepEqual(calledOptions.headers, representative.auth.headers);
    assert.deepEqual(calledOptions.env, representative.auth.env);
    routingIds.add(calledOptions.sessionId);
  }
  assert.equal(routingIds.size, representativeCases.length, "each representative provider call gets a fresh routing ID");

  // W2 integration: use pi-intercom's documented extension-channel contract.
  class FakeChannel {
    connected = true;
    supported = true;
    published = [];
    peers = new Map();
    snapshot() { return { connected: this.connected, supported: this.supported }; }
    publish(payload, options) { this.published.push({ payload, options }); }
    async listSessions() {
      return [...this.peers.entries()].map(([id, value]) => ({ id, cwd: value.cwd, pid: value.pid }));
    }
  }

  const testCwd = "/tmp/test-workspace-a";
  const crossCwd = "/tmp/test-workspace-b";
  const fakeChannel = new FakeChannel();
  fakeChannel.peers.set("self-sender-1", { cwd: testCwd, pid: process.pid });
  const w2Tools = new Map();
  const w2Commands = new Map();
  const w2Branch = [
    { type: "message", id: "m1", message: { role: "user", content: "Work on feature" } },
    { type: "custom", customType: SESSION_SUMMARY_STATE_TYPE, data: {
      version: 1,
      source: { sessionId: "s-self", leafId: "m1", fingerprint: "fp-self", entryCount: 1 },
      result: { title: "Self Title", summaryMarkdown: "# Self Summary\n\nWorking on feature" },
      generation: { provider: "fake", modelId: "fake", thinkingLevel: "low", promptRevision: "v1" },
      generatedAt: "2026-08-05T00:00:00.000Z",
      settledTurnOrdinal: 1,
    } },
  ];
  let intercomRegistration;
  const w2Api = {
    events: {
      emit(event, registration) {
        if (event !== "intercom:extension-register") return;
        intercomRegistration = registration;
        registration.onReady(fakeChannel);
      },
    },
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, options) { w2Commands.set(name, options); },
    registerTool(tool) { w2Tools.set(tool.name, tool); },
    registerEntryRenderer() {},
    sendMessage() {},
    appendEntry(customType, data) { w2Branch.push({ type: "custom", customType, data }); },
    getSessionName() { return "Self Title"; },
  };

  createSessionSummaryExtension({ completeFn: fakeComplete })(w2Api);
  assert.equal(w2Tools.has("workspace_session_summaries"), true, "workspace_session_summaries tool registered");
  const workspaceTool = w2Tools.get("workspace_session_summaries");
  assert.match(workspaceTool.promptSnippet, /same-CWD session summaries/);
  assert.equal(Array.isArray(workspaceTool.promptGuidelines), true, "tool guidelines use the Pi array contract");
  assert.match(workspaceTool.promptGuidelines.join("\n"), /intercom/);

  const w2Ctx = {
    cwd: testCwd,
    sessionManager: {
      getBranch: () => w2Branch.slice(),
      getSessionId: () => "s-self",
      getSessionFile: () => join(extensionTemp, "s-self.jsonl"),
    },
  };
  await handlers.get("session_start")({ type: "session_start", reason: "startup" }, w2Ctx);
  assert.equal(intercomRegistration.namespace, "firstpick/session-summary/v1");
  assert.equal(intercomRegistration.ownerEligible, false);
  assert.equal(typeof intercomRegistration.onEvent, "function");
  assert.equal(fakeChannel.published.at(-1)?.options?.audience, "capable");
  const initialPublicationCount = fakeChannel.published.length;
  intercomRegistration.onEvent({ type: "session_joined", session: { id: "new-peer", cwd: testCwd } });
  assert.equal(fakeChannel.published.length, initialPublicationCount + 1, "a joining capable peer triggers summary republication");
  fakeChannel.connected = false;
  intercomRegistration.onEvent({ type: "connection", connected: false, supported: false });
  fakeChannel.connected = true;
  intercomRegistration.onEvent({ type: "connection", connected: true, supported: true });
  assert.equal(fakeChannel.published.length, initialPublicationCount + 2, "a supported reconnect republishes the current summary");

  fakeChannel.peers.set("peer-same", { cwd: testCwd, pid: process.pid + 1 });
  fakeChannel.peers.set("peer-cross", { cwd: crossCwd, pid: process.pid + 2 });
  intercomRegistration.onEvent({ type: "message", fromSessionId: "peer-same", payload: {
    version: 1,
    sessionId: "s-peer-same",
    cwd: testCwd,
    title: "Peer Same Title",
    summaryMarkdown: "Working on same CWD with secret sk-proj-123456789012345 and path /.pi/agent/sessions/secret.jsonl",
    generatedAt: "2026-08-05T01:00:00.000Z",
  } });
  intercomRegistration.onEvent({ type: "message", fromSessionId: "peer-cross", payload: {
    version: 1,
    sessionId: "s-peer-cross",
    cwd: crossCwd,
    title: "Peer Cross Title",
    summaryMarkdown: "Working on cross CWD",
    generatedAt: "2026-08-05T01:00:00.000Z",
  } });
  intercomRegistration.onEvent({ type: "message", fromSessionId: "self-sender-1", payload: {
    version: 1,
    sessionId: "s-self",
    cwd: testCwd,
    title: "Self Payload",
    summaryMarkdown: "Self payload should be excluded",
    generatedAt: "2026-08-05T01:00:00.000Z",
  } });

  let toolResult = await workspaceTool.execute("call-1", {}, undefined, undefined, w2Ctx);
  let toolText = toolResult.content[0].text;
  assert.match(toolText, /Peer Same Title/);
  assert.equal(toolText.includes("Peer Cross Title"), false, "cross-CWD live peer excluded");
  assert.equal(toolText.includes("Self Payload"), false, "self live payload excluded");
  assert.equal(toolText.includes("sk-proj-123456789012345"), false, "raw API secret redacted from tool output");
  assert.match(toolText, /\[redacted secret\]/);
  assert.equal(toolText.includes("/.pi/agent/sessions/secret.jsonl"), false, "private session path redacted from tool output");
  assert.match(toolText, /\[private session path\]/);
  intercomRegistration.onEvent({ type: "session_joined", session: { id: "peer-same", cwd: testCwd } });
  toolResult = await workspaceTool.execute("call-replaced", {}, undefined, undefined, w2Ctx);
  assert.equal(toolResult.content[0].text.includes("Peer Same Title"), false, "a stable sender-ID replacement invalidates the prior live summary until the replacement publishes");
  intercomRegistration.onEvent({ type: "message", fromSessionId: "peer-same", payload: {
    version: 1,
    sessionId: "s-peer-same",
    cwd: testCwd,
    title: "Peer Same Title",
    summaryMarkdown: "Replacement summary",
    generatedAt: "2026-08-05T01:10:00.000Z",
  } });

  fakeChannel.peers.set("peer-malformed", { cwd: testCwd, pid: process.pid + 3 });
  intercomRegistration.onEvent({ type: "message", fromSessionId: "peer-malformed", payload: { version: 99, sessionId: "s-bad" } });
  toolResult = await workspaceTool.execute("call-2", {}, undefined, undefined, w2Ctx);
  assert.equal(toolResult.content[0].text.includes("s-bad"), false, "malformed payload ignored");

  fakeChannel.peers.delete("peer-same");
  intercomRegistration.onEvent({ type: "session_left", sessionId: "peer-same" });
  toolResult = await workspaceTool.execute("call-3", {}, undefined, undefined, w2Ctx);
  assert.equal(toolResult.content[0].text.includes("Peer Same Title"), false, "disconnected peer removed");

  const summaryCmd = w2Commands.get("summary");
  await summaryCmd.handler("workspace", w2Ctx);
  const workspaceDisplayEntry = w2Branch.findLast((entry) => entry.type === "custom" && entry.customType === SESSION_SUMMARY_DISPLAY_TYPE);
  assert.equal(workspaceDisplayEntry.data.title, "Workspace session summaries");
  assert.match(workspaceDisplayEntry.data.summaryMarkdown, /Workspace session summaries/);

  fakeChannel.connected = false;
  intercomRegistration.onEvent({ type: "connection", connected: false, supported: false });
  toolResult = await workspaceTool.execute("call-4", {}, undefined, undefined, w2Ctx);
  assert.match(toolResult.content[0].text, /Live peer status is unavailable/);

  let fallbackRegisteredTool;
  const noEventsApi = {
    on() {},
    registerCommand() {},
    registerTool(tool) { fallbackRegisteredTool = tool; },
    registerEntryRenderer() {},
    getSessionName() { return "Self Title"; },
  };
  createSessionSummaryExtension({ completeFn: fakeComplete })(noEventsApi);
  const customSessionDir = join(extensionTemp, "configured-session-dir");
  await mkdir(customSessionDir);
  const persistedPeerState = {
    ...baseState,
    source: { ...baseState.source, sessionId: "configured-peer" },
    result: { title: "Configured session dir peer", summaryMarkdown: "# Persisted peer" },
  };
  await writeFile(join(customSessionDir, "configured-peer.jsonl"), [
    JSON.stringify({ type: "session", version: 3, id: "configured-peer", timestamp: "2026-08-05T00:00:00.000Z", cwd: testCwd }),
    JSON.stringify({ type: "custom", id: "peer0001", parentId: null, timestamp: "2026-08-05T00:01:00.000Z", customType: SESSION_SUMMARY_STATE_TYPE, data: persistedPeerState }),
  ].join("\n") + "\n");
  const fallbackCtx = {
    ...w2Ctx,
    sessionManager: {
      ...w2Ctx.sessionManager,
      getSessionFile: () => join(extensionTemp, "external", "s-self.jsonl"),
      getSessionDir: () => customSessionDir,
    },
  };
  const fallbackResult = await fallbackRegisteredTool.execute("call-5", {}, undefined, undefined, fallbackCtx);
  assert.match(fallbackResult.content[0].text, /Live peer status is unavailable/);
  assert.match(fallbackResult.content[0].text, /Configured session dir peer/, "configured session directory is preferred over the current session file parent");

} finally {
  if (previousConfigFile === undefined) delete process.env.PI_SESSION_SUMMARY_CONFIG_FILE;
  else process.env.PI_SESSION_SUMMARY_CONFIG_FILE = previousConfigFile;
  await rm(extensionTemp, { recursive: true, force: true });
}

console.log("session-summary core tests passed");
