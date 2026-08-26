import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS } from "../lib/backend/protocol.mjs";
import { startBackend } from "./helpers/backend-client.mjs";

async function readyBackend(t, options = {}) {
  const backend = await startBackend({ startupTimeoutMs: 1_000, ...options });
  t.after(async () => {
    if (backend.exit) return;
    backend.child.kill("SIGKILL");
    await backend.exitPromise;
  });
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready");
  return backend;
}

test("startup translates Pi noise into bounded events and reports runtime metadata", async (t) => {
  const backend = await readyBackend(t);
  const ready = await backend.waitForEvent("backend.ready");
  assert.equal(ready.protocolVersion, 1);
  assert.equal(ready.limits.maxTranscriptRows, 80);
  assert.equal(ready.smokeMode, true);
  assert(backend.events.some((event) => event.type === "pi.error" && /Invalid Pi RPC record/.test(event.message)));
  assert(backend.events.some((event) => event.type === "notice" && /invalid Pi RPC record/i.test(event.message)));
  assert(!backend.events.some((event) => event.kind === "invalid"), "backend must emit valid JSON only");
  assert(backend.events.every((event) => event.kind === "event" && event.v === 1), "every event frame must carry kind=event and the version");
  const runtime = backend.events.filter((event) => event.type === "pi.runtime").at(-1);
  assert.equal(runtime.provider, "fixture-provider");
  assert.equal(runtime.modelId, "fixture-model");
  assert.equal(runtime.thinkingLevel, "high");
  assert.equal(runtime.sessionId, "fixture-session");
  const hello = await backend.send("hello");
  assert.equal(hello.ok, true);
  assert.equal(hello.data.session.ready, true);
  assert.deepEqual(hello.data.settings, { compactTranscript: false, showThinking: true, desktopNotifications: true, syntaxHighlighting: true });
  const commands = await backend.readCapture();
  assert.equal(commands.filter((command) => command.type === "get_state").length, 1, "the stale fixture response must not trigger a second state read");
});

test("stream scenario produces message parts, tool lifecycle, thinking, and reconciled final text", async (t) => {
  const backend = await readyBackend(t);
  const accepted = await backend.send("prompt", { message: "__QT_WEBUI_STREAM__" });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.mode, "send");
  const end = await backend.waitForEvent("run.end");
  assert.deepEqual({ ok: end.ok, aborted: end.aborted }, { ok: true, aborted: false });

  const types = backend.events.map((event) => event.type);
  assert(types.indexOf("message.user") < types.indexOf("run.start"));
  const user = backend.events.find((event) => event.type === "message.user");
  assert.equal(user.text, "__QT_WEBUI_STREAM__");
  const begins = backend.events.filter((event) => event.type === "part.begin");
  assert.deepEqual(begins.map((event) => event.partKind), ["thinking", "text"]);
  const finals = backend.events.filter((event) => event.type === "part.render" && event.final);
  assert.equal(finals.find((event) => event.partKind === "thinking").text, "thinking about it");
  const text = finals.find((event) => event.partKind === "text");
  assert.equal(text.text, "authoritative final");
  assert.deepEqual(text.blocks.map((block) => block.type), ["paragraph"]);
  const toolStart = backend.events.find((event) => event.type === "tool.start");
  assert.equal(toolStart.name, "<b>read</b>");
  assert.match(toolStart.summary, /path=\/tmp\/<b>file<\/b>\.txt {2}nested=\{…\}/);
  const toolEnd = backend.events.find((event) => event.type === "tool.end");
  assert.deepEqual({ ok: toolEnd.ok, output: toolEnd.output, error: toolEnd.error }, { ok: true, output: "final tool output", error: "" });
  assert(typeof toolEnd.durationMs === "number" && toolEnd.durationMs >= 0);
  const statuses = backend.events.filter((event) => event.type === "pi.status").map((event) => event.text);
  assert(statuses.includes("Tool · <b>read</b>"));
  assert.equal(statuses.at(-1), "Ready");
  const messageEnd = backend.events.find((event) => event.type === "message.end");
  assert.equal(messageEnd.stopReason, "stop");
  const extensionStatuses = backend.events.filter((event) => event.type === "extension.status");
  assert.deepEqual(extensionStatuses.find((event) => event.key === "plain-ext").text, "plain status <b>text</b> red raw");
  const controls = extensionStatuses.find((event) => event.key === "pi-remote-webui:controls");
  assert.deepEqual({ text: controls.text, hint: controls.hint }, { text: "Remote WebUI", hint: "Open, close, and protect LAN access." });
  assert.equal(extensionStatuses.find((event) => event.key === "cd-history").text, "cwd ~/project");
  const footer = extensionStatuses.find((event) => event.key === "git-footer-webui");
  assert.equal(footer.text, "");
  assert.deepEqual(footer.chips.map((chip) => [chip.group, chip.icon, chip.label, chip.value]), [
    ["main", "π", "pi", "45k tok"], ["main", "", "git", "main ↑1"], ["meta", "", "speed", "42 tok/s"],
  ], "cwd/model chips and duplicate label/value pairs are dropped");
  assert.equal(footer.chips[1].title, "Branch <b>main</b>");
});

test("extension dialogs are typed, answered exactly once, validated, and reach Pi with exact values", async (t) => {
  const backend = await readyBackend(t);
  await backend.send("prompt", { message: "__QT_WEBUI_STREAM__" });
  const requests = [];
  for (const method of ["select", "confirm", "input", "editor", "input"]) requests.push(await backend.waitForEvent("extension.request", (event) => event.method === method && !requests.includes(event)));
  const select = requests.find((event) => event.requestId === "dialog-select");
  assert.deepEqual(select.options, ["Allow", "Block"]);
  assert.equal(select.timeoutMs, 60_000);
  assert.equal(select.message, "Pick one");
  assert.equal(requests.find((event) => event.requestId === "dialog-editor").prefill, "Line 1\nLine 2");
  assert.equal(requests.find((event) => event.requestId === "dialog-input").placeholder, "type something");

  const badOption = await backend.send("extension_response", { requestId: "dialog-select", value: "Nope" });
  assert.equal(badOption.error.code, "invalid_request");
  const wrongShape = await backend.send("extension_response", { requestId: "dialog-confirm", value: "yes" });
  assert.equal(wrongShape.error.code, "invalid_request");
  assert.equal((await backend.send("extension_response", { requestId: "dialog-select", value: "Block" })).ok, true);
  const twice = await backend.send("extension_response", { requestId: "dialog-select", value: "Allow" });
  assert.equal(twice.error.code, "stale_request");
  assert.equal((await backend.send("extension_response", { requestId: "dialog-confirm", confirmed: true })).ok, true);
  assert.equal((await backend.send("extension_response", { requestId: "dialog-input", value: "typed value" })).ok, true);
  assert.equal((await backend.send("extension_response", { requestId: "dialog-editor", value: "Line 1\nLine 2\nLine 3" })).ok, true);
  assert.equal((await backend.send("extension_response", { requestId: "dialog-cancel", cancelled: true })).ok, true);
  const unknown = await backend.send("extension_response", { requestId: "never-existed", cancelled: true });
  assert.equal(unknown.error.code, "stale_request");
  await backend.waitForEvent("extension.notify", (event) => event.message === "QT_WEBUI_SMOKE_DIALOG_ANSWER_RECEIPT");
  await backend.waitForEvent("extension.notify", (event) => event.message === "QT_WEBUI_SMOKE_DIALOG_CANCEL_RECEIPT");
  const answers = (await backend.readCapture()).filter((command) => command.type === "extension_ui_response");
  assert.deepEqual(answers, [
    { type: "extension_ui_response", id: "dialog-select", value: "Block" },
    { type: "extension_ui_response", id: "dialog-confirm", confirmed: true },
    { type: "extension_ui_response", id: "dialog-input", value: "typed value" },
    { type: "extension_ui_response", id: "dialog-editor", value: "Line 1\nLine 2\nLine 3" },
    { type: "extension_ui_response", id: "dialog-cancel", cancelled: true },
  ]);
});

test("pending dialogs are cancelled when Pi exits and cannot be answered afterwards", async (t) => {
  const backend = await readyBackend(t);
  await backend.send("prompt", { message: "__QT_WEBUI_STREAM__" });
  await backend.waitForEvent("run.end");
  assert.equal(backend.events.filter((event) => event.type === "extension.request").length, 5);
  await backend.send("prompt", { message: "__QT_WEBUI_EXIT__" });
  await backend.waitForEvent("pi.exit", (event) => event.code === 23);
  const cancelled = backend.events.filter((event) => event.type === "extension.cancelled");
  assert.deepEqual(cancelled.map((event) => event.requestId).sort(), ["dialog-cancel", "dialog-confirm", "dialog-editor", "dialog-input", "dialog-select"]);
  const late = await backend.send("extension_response", { requestId: "dialog-select", value: "Allow" });
  assert.equal(late.error.code, "stale_request");
  const status = backend.events.filter((event) => event.type === "pi.status").at(-1);
  assert.equal(status.text, "Pi exited (23)");
  assert.equal(status.statusKind, "error");
});

test("markdown streaming renders at a bounded cadence and the final render is authoritative", async (t) => {
  const backend = await readyBackend(t);
  await backend.send("prompt", { message: "__QT_WEBUI_MARKDOWN__" });
  await backend.waitForEvent("run.end");
  const renders = backend.events.filter((event) => event.type === "part.render" && event.partKind === "text");
  const partial = renders.filter((event) => !event.final);
  assert(partial.length >= 1 && partial.length <= 4, `expected coalesced partial renders, got ${partial.length}`);
  const final = renders.at(-1);
  assert.equal(final.final, true);
  assert.deepEqual(final.blocks.map((block) => block.type), ["heading", "paragraph", "code", "listItem", "listItem", "listItem", "paragraph", "table"]);
  const serialized = JSON.stringify(final.blocks);
  assert.doesNotMatch(serialized, /<img|<script>|javascript:alert\(1\)\)"|href=\\"file/);
  assert.match(serialized, /&lt;script&gt;/);
  assert.match(serialized, /<a href=\\"https:\/\/example.com\/docs\\">safe link<\/a>/);
  assert.equal(final.blocks[2].text, "const answer = 1 < 2 && \"<b>not bold</b>\";");
  assert.match(final.text, /^# Heading one/);
});

test("provider errors are preserved through settlement and bounded", async (t) => {
  const backend = await readyBackend(t);
  await backend.send("prompt", { message: "__QT_WEBUI_PROVIDER_ERROR__" });
  const end = await backend.waitForEvent("run.end");
  assert.equal(end.ok, false);
  const error = backend.events.filter((event) => event.type === "pi.error" && event.message.length > 0).at(-1);
  assert.match(error.message, /^deterministic provider failure/);
  assert.equal(error.message.length, LIMITS.maxErrorCharacters);
  const status = backend.events.filter((event) => event.type === "pi.status").at(-1);
  assert.deepEqual({ kind: status.statusKind, text: status.text }, { kind: "error", text: "Error" });
  // The next prompt clears the preserved error.
  await backend.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" });
  await backend.waitForEvent("pi.status", (event) => event.seq > status.seq && event.statusKind === "ready");
});

test("tool failures surface as failed cards and visible errors", async (t) => {
  const backend = await readyBackend(t);
  await backend.send("prompt", { message: "__QT_WEBUI_TOOL_ERROR__" });
  await backend.waitForEvent("run.end");
  const toolEnd = backend.events.find((event) => event.type === "tool.end");
  assert.deepEqual({ ok: toolEnd.ok, error: toolEnd.error, output: toolEnd.output }, { ok: false, error: "boom", output: "boom" });
  assert(backend.events.some((event) => event.type === "pi.error" && event.message === "Tool failed: bash"));
});

test("rejected prompts, immediate prompts, and reconciliation restore a ready state", async (t) => {
  const backend = await readyBackend(t);
  const rejected = await backend.send("prompt", { message: "__QT_WEBUI_FAIL__" });
  assert.equal(rejected.error.code, "pi_error");
  assert.equal(rejected.error.message, "deterministic prompt rejection");
  await backend.waitForEvent("pi.error", (event) => event.message === "deterministic prompt rejection");
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready" && event.seq > 5);
  const before = (await backend.readCapture()).filter((command) => command.type === "get_state").length;
  const lastSeq = backend.events.at(-1).seq;
  const immediate = await backend.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" });
  assert.equal(immediate.ok, true);
  const lastStatus = () => backend.events.filter((event) => event.type === "pi.status").at(-1);
  await backend.waitFor((event) => event.type === "pi.status" && event.statusKind === "ready" && event.seq > lastSeq + 1, "reconciled ready");
  assert.equal(lastStatus().active, false);
  const after = (await backend.readCapture()).filter((command) => command.type === "get_state").length;
  assert.equal(after, before + 1, "one reconciliation state read");
});

test("abort before agent_start is honored once the run starts, and steer/follow-up queue while active", async (t) => {
  const backend = await readyBackend(t);
  const idle = await backend.send("abort");
  assert.equal(idle.error.code, "not_running");
  await backend.send("prompt", { message: "__QT_WEBUI_DELAYED_ABORT__" });
  const busy = await backend.send("prompt", { message: "second" });
  assert.equal(busy.error.code, "busy");
  const steer = await backend.send("prompt", { message: "steer this", mode: "steer" });
  assert.equal(steer.ok, true);
  const queue = await backend.waitForEvent("queue.update");
  assert.deepEqual(queue.steering, ["steer this"]);
  assert.equal((await backend.send("abort")).ok, true);
  const end = await backend.waitForEvent("run.end");
  assert.equal(end.aborted, true);
  await backend.waitForEvent("extension.notify", (event) => event.message === "QT_WEBUI_SMOKE_DELAYED_AGENT_ABORTED");
  const commands = await backend.readCapture();
  assert.equal(commands.filter((command) => command.type === "abort").length, 2);
  assert.equal(commands.filter((command) => command.type === "steer").length, 1);
  assert(!backend.events.some((event) => event.type === "part.render" && /continued after abort/.test(event.text)));
});

test("transcript limits keep every part within the message budget", async (t) => {
  const backend = await readyBackend(t);
  await backend.send("prompt", { message: "__QT_WEBUI_LIMITS__" });
  await backend.waitForEvent("run.end");
  const finals = backend.events.filter((event) => event.type === "part.render" && event.final);
  assert.equal(finals.length, 95);
  assert(finals.every((event) => event.text.length <= LIMITS.maxMessageCharacters));
  assert.equal(finals.at(-1).truncated, true);
  assert.equal(finals.at(-1).text.length, LIMITS.maxMessageCharacters);
  assert.equal(finals[0].truncated, false);
});

test("protocol violations are answered without disturbing the session", async (t) => {
  const backend = await readyBackend(t);
  backend.raw(`${JSON.stringify({ v: 2, id: "v2", type: "hello" })}\n`);
  backend.raw("{malformed\n");
  backend.raw(`${JSON.stringify({ v: 1, id: "oversized", type: "prompt", message: "x".repeat(LIMITS.maxInboundFrameBytes) })}\n`);
  backend.raw(`${JSON.stringify({ v: 1, id: "unknown", type: "format_disk" })}\n`);
  backend.raw(`${JSON.stringify({ v: 1, type: "hello" })}\n`);
  await backend.waitForEvent("notice", (event) => /malformed request/.test(event.message));
  await backend.waitForEvent("notice", (event) => /larger than/.test(event.message));
  await backend.waitForEvent("notice", (event) => /Rejected request: request id/.test(event.message));
  const hello = await backend.send("hello");
  assert.equal(hello.ok, true);
  const wrongVersion = await backend.send("hello", { v: 2 }, { id: "wrong-version" }).catch(() => null);
  assert.equal(wrongVersion.error.code, "unsupported_version");
  const unknown = await backend.send("format_disk", {}, { id: "unknown-2" });
  assert.equal(unknown.error.code, "unknown_request");
});

test("duplicate in-flight ids and silent Pi answers are rejected with explicit codes", async (t) => {
  const backend = await readyBackend(t, { env: { QT_WEBUI_PI_REQUEST_TIMEOUT_MS: "300" } });
  const first = backend.send("prompt", { message: "__QT_WEBUI_SILENT__" }, { id: "same" });
  backend.raw(`${JSON.stringify({ v: 1, id: "same", type: "hello" })}\n`);
  const duplicate = await first;
  assert.equal(duplicate.error.code, "duplicate_request");
  const timedOut = await backend.waitFor((record) => record.kind === "response" && record.id === "same" && record.ok === false && record.error.code === "timeout", "timeout response");
  assert.match(timedOut.error.message, /did not answer prompt within 300 ms/);
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready" && event.seq > 8);
  const hello = await backend.send("hello");
  assert.equal(hello.data.session.active, false);
});

test("a slow consumer pauses Pi instead of growing the outbound queue, and no essential record is lost", async (t) => {
  const backend = await readyBackend(t);
  const accepted = await backend.send("prompt", { message: "__QT_WEBUI_FLOOD__" });
  assert.equal(accepted.ok, true);
  backend.pause();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  backend.resume();
  await backend.waitForEvent("run.end", () => true, 30_000);
  const toolEnds = backend.events.filter((event) => event.type === "tool.end").length;
  assert.equal(toolEnds, 2500, "every essential tool record must arrive");
  assert(backend.events.some((event) => event.type === "backend.backpressure" && event.paused === true), "backpressure must engage");
  assert(backend.events.some((event) => event.type === "backend.backpressure" && event.paused === false), "backpressure must release");
  const hello = await backend.send("hello");
  assert.equal(hello.ok, true);
  assert(hello.data.stats.backpressurePauses >= 1);
  assert(hello.data.stats.maxWritableLength <= LIMITS.maxQueuedBytes + LIMITS.maxOutboundFrameBytes,
    `outbound queue peaked at ${hello.data.stats.maxWritableLength} bytes`);
  const lastStatus = backend.events.filter((event) => event.type === "pi.status").at(-1);
  assert.equal(lastStatus.statusKind, "ready");
});

test("settings, notifications, and links go through the backend with smoke-mode suppression", async (t) => {
  const backend = await readyBackend(t);
  const initial = await backend.send("settings_get");
  assert.equal(initial.data.settings.compactTranscript, false);
  const changed = await backend.send("settings_set", { values: { compactTranscript: true, showThinking: false } });
  assert.deepEqual(changed.data.settings, { compactTranscript: true, showThinking: false, desktopNotifications: true, syntaxHighlighting: true });
  await backend.waitForEvent("settings.changed", (event) => event.settings.compactTranscript === true);
  const rejected = await backend.send("settings_set", { values: { compactTranscript: "yes" } });
  assert.equal(rejected.error.code, "invalid_request");
  const notify = await backend.send("notify", { title: "Run finished", body: "done" });
  assert.deepEqual(notify.data, { delivered: false, suppressed: "smoke-mode" });
  const link = await backend.send("open_link", { url: "https://example.com/" });
  assert.equal(link.data.suppressed, "smoke-mode");
  const badLink = await backend.send("open_link", { url: "javascript:alert(1)" });
  assert.equal(badLink.data.suppressed, "smoke-mode", "smoke mode reports without opening; scheme policy is enforced in desktop.mjs and covered by unit tests");
});

test("models and thinking levels can be listed, selected, and cycled with bounded, validated results", async (t) => {
  const backend = await readyBackend(t);
  const listed = await backend.send("models_list");
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data.models.map((model) => [model.provider, model.id, model.name, model.reasoning, model.acceptsImages]), [
    ["fixture-provider", "fixture-model", "Fixture Model", true, true],
    ["fixture-provider", "fixture-fast", "Fixture Fast red", false, false],
    ["other-provider", "other-model", "Other Model", true, false],
  ], "malformed and duplicate models are dropped and names are ANSI-stripped");
  assert.deepEqual(listed.data.current, { provider: "fixture-provider", modelId: "fixture-model" });
  assert.equal(listed.data.omitted, 0);

  const levels = await backend.send("thinking_levels");
  assert.deepEqual(levels.data, { levels: ["off", "minimal", "low", "medium", "high"], current: "high" });

  const unknown = await backend.send("model_set", { provider: "fixture-provider", modelId: "missing" });
  assert.equal(unknown.error.code, "pi_error");
  assert.match(unknown.error.message, /unknown model/);
  const invalid = await backend.send("model_set", { provider: "fixture-provider" });
  assert.equal(invalid.error.code, "invalid_request");

  const changed = await backend.send("model_set", { provider: "fixture-provider", modelId: "fixture-fast" });
  assert.equal(changed.ok, true);
  assert.deepEqual({ id: changed.data.model.id, thinkingLevel: changed.data.thinkingLevel }, { id: "fixture-fast", thinkingLevel: "off" }, "the thinking level follows the model's capabilities");
  const runtime = backend.events.filter((event) => event.type === "pi.runtime").at(-1);
  assert.deepEqual({ modelId: runtime.modelId, modelName: runtime.modelName, reasoning: runtime.modelReasoning, thinkingLevel: runtime.thinkingLevel, sessionId: runtime.sessionId },
    { modelId: "fixture-fast", modelName: "Fixture Fast red", reasoning: false, thinkingLevel: "off", sessionId: "fixture-session" });
  assert.deepEqual((await backend.send("thinking_levels")).data.levels, ["off"]);
  const unsupported = await backend.send("thinking_set", { level: "high" });
  assert.equal(unsupported.error.code, "pi_error");
  assert.deepEqual((await backend.send("thinking_cycle")).data, { changed: false, level: "off" });
  const rejectedLevel = await backend.send("thinking_set", { level: "ultra" });
  assert.equal(rejectedLevel.error.code, "invalid_request");

  const cycled = await backend.send("model_cycle");
  assert.deepEqual({ changed: cycled.data.changed, id: cycled.data.model.id, thinkingLevel: cycled.data.thinkingLevel }, { changed: true, id: "other-model", thinkingLevel: "off" });
  assert.equal((await backend.send("thinking_set", { level: "low" })).data.level, "low");
  assert.deepEqual((await backend.send("thinking_cycle")).data, { changed: true, level: "medium" });
  const after = backend.events.filter((event) => event.type === "pi.runtime").at(-1);
  assert.deepEqual({ provider: after.provider, modelId: after.modelId, thinkingLevel: after.thinkingLevel }, { provider: "other-provider", modelId: "other-model", thinkingLevel: "medium" });

  await backend.send("prompt", { message: "__QT_WEBUI_DELAYED_ABORT__" });
  const busy = await backend.send("model_set", { provider: "fixture-provider", modelId: "fixture-model" });
  assert.equal(busy.error.code, "busy");
  assert.equal((await backend.send("thinking_cycle")).error.code, "busy");
  assert.equal((await backend.send("models_list")).ok, true, "listing stays available during a run");
  await backend.send("abort");
  await backend.waitForEvent("run.end");
  const commands = await backend.readCapture();
  assert.deepEqual(commands.filter((command) => command.type === "set_model").map((command) => [command.provider, command.modelId]),
    [["fixture-provider", "missing"], ["fixture-provider", "fixture-fast"]]);
  assert.deepEqual(commands.filter((command) => command.type === "set_thinking_level").map((command) => command.level), ["high", "low"]);
});

test("oversized model inventories are bounded and reported", async (t) => {
  const backend = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_MANY_MODELS: "1" } });
  const listed = await backend.send("models_list");
  assert.equal(listed.data.models.length, LIMITS.maxModels);
  assert.equal(listed.data.omitted, 303 - LIMITS.maxModels);
  await backend.waitForEvent("notice", (event) => /configured models are not listed/.test(event.message));
});

test("manual compaction blocks the session until Pi answers and reports bounded results or failures", async (t) => {
  const backend = await readyBackend(t);
  const pending = backend.send("compact", { instructions: "Focus on code" });
  await backend.waitForEvent("pi.status", (event) => event.text === "Compacting…" && event.active === true);
  assert.equal((await backend.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" })).error.code, "busy");
  assert.equal((await backend.send("compact")).error.code, "busy");
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { tokensBefore: 150_000, estimatedTokensAfter: 32_000, summary: "Summary (Focus on code) ok" });
  await backend.waitForEvent("notice", (event) => event.message === "Context compacted: about 150,000 → 32,000 tokens");
  await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready" && event.active === false && event.seq > backend.events.find((entry) => entry.text === "Compacting…").seq);
  const hello = await backend.send("hello");
  assert.equal(hello.data.session.active, false);
  const failed = await backend.send("compact", { instructions: "__QT_WEBUI_COMPACT_FAIL__" });
  assert.equal(failed.error.code, "pi_error");
  assert.equal(failed.error.message, "deterministic compaction failure");
  await backend.waitForEvent("notice", (event) => event.message === "Compaction failed: deterministic compaction failure");
  assert.equal((await backend.send("hello")).data.session.active, false);
  assert.equal((await backend.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" })).ok, true);
  const commands = await backend.readCapture();
  assert.deepEqual(commands.filter((command) => command.type === "compact").map((command) => command.customInstructions), ["Focus on code", "__QT_WEBUI_COMPACT_FAIL__"]);
});

test("Pi exit, failed startup state, missing startup state, and recovery follow the restart path", async (t) => {
  const backend = await readyBackend(t);
  await backend.send("prompt", { message: "__QT_WEBUI_EXIT__" });
  const exit = await backend.waitForEvent("pi.exit");
  assert.equal(exit.code, 23);
  await backend.waitForEvent("pi.error", (event) => event.message === "Pi process exited with code 23");
  const runtimeAfterExit = backend.events.filter((event) => event.type === "pi.runtime").at(-1);
  assert.equal(runtimeAfterExit.provider, "");

  assert.equal((await backend.send("restart")).ok, true);
  await backend.waitForEvent("pi.error", (event) => event.message === "deterministic startup state failure");
  assert.equal((await backend.send("restart")).ok, true);
  await backend.waitForEvent("pi.error", (event) => event.message === "Pi did not report readiness in time", 5_000);
  assert.equal((await backend.send("restart")).ok, true);
  const ready = await backend.waitForEvent("pi.status", (event) => event.statusKind === "ready" && event.seq > exit.seq);
  assert.equal(ready.ready, true);
  const runtime = backend.events.filter((event) => event.type === "pi.runtime").at(-1);
  assert.equal(runtime.provider, "fixture-provider");
  const closing = await backend.send("shutdown");
  assert.equal(closing.data.closing, true);
  assert.deepEqual(await backend.exitPromise, { code: 0, signal: null });
});
