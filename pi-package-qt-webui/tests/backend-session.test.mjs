import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
  const unchangedThinking = await backend.send("thinking_cycle");
  assert.deepEqual({ changed: unchangedThinking.data.changed, level: unchangedThinking.data.level }, { changed: false, level: "off" });
  assert.equal(unchangedThinking.data.resources.model.id, "fixture-fast");
  const rejectedLevel = await backend.send("thinking_set", { level: "ultra" });
  assert.equal(rejectedLevel.error.code, "invalid_request");

  const cycled = await backend.send("model_cycle");
  assert.deepEqual({ changed: cycled.data.changed, id: cycled.data.model.id, thinkingLevel: cycled.data.thinkingLevel }, { changed: true, id: "other-model", thinkingLevel: "off" });
  assert.equal((await backend.send("thinking_set", { level: "low" })).data.level, "low");
  const cycledThinking = await backend.send("thinking_cycle");
  assert.deepEqual({ changed: cycledThinking.data.changed, level: cycledThinking.data.level }, { changed: true, level: "medium" });
  assert.equal(cycledThinking.data.resources.thinkingLevel, "medium");
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

test("resource profiles preserve inheritance and unsupported sampling while applying exact effective payloads", async (t) => {
  const backend = await readyBackend(t);
  const initial = await backend.send("resources_state");
  assert.equal(initial.data.available, true);
  assert.deepEqual(initial.data.profiles.session, { tools: null, skills: null, sampling: {} });
  assert.deepEqual(initial.data.effective, { tools: null, toolsSource: "inherit", skills: null, skillsSource: "inherit", sampling: {}, samplingSources: {} });
  assert.equal(initial.data.sampling.capabilities.temperature.supported, true);
  assert.equal(initial.data.sampling.capabilities.top_k.supported, false);

  const globalTools = await backend.send("tools_set", { scope: "global", enabledTools: ["read", "bash"] });
  assert.deepEqual(globalTools.data.profiles.global.tools, ["read", "bash"]);
  assert.equal(globalTools.data.effective.toolsSource, "global");
  const globalSkills = await backend.send("skills_set", { scope: "global", enabledSkills: ["brave-search"] });
  assert.deepEqual(globalSkills.data.effective.skills, ["brave-search"]);
  const sampled = await backend.send("sampling_set", { scope: "global", params: { temperature: 0.6, top_k: 77 } });
  assert.deepEqual(sampled.data.effective.sampling, { temperature: 0.6, top_k: 77 });
  assert.deepEqual(sampled.data.sampling.applied, { temperature: 0.6 }, "unsupported top_k remains stored but is not applied");

  const emptyTools = await backend.send("tools_set", { scope: "session", enabledTools: [] });
  assert.deepEqual(emptyTools.data.profiles.session.tools, []);
  assert.deepEqual(emptyTools.data.effective.tools, []);
  assert.equal(emptyTools.data.effective.toolsSource, "session");
  const emptySkills = await backend.send("skills_set", { scope: "session", enabledSkills: [] });
  assert.deepEqual(emptySkills.data.profiles.session.skills, []);
  assert.deepEqual(emptySkills.data.effective.skills, []);
  const inheritedAgain = await backend.send("tools_set", { scope: "session", enabledTools: null });
  assert.deepEqual(inheritedAgain.data.profiles.session.tools, null);
  assert.deepEqual(inheritedAgain.data.effective.tools, ["read", "bash"]);

  const modelSampling = await backend.send("sampling_set", { scope: "model", params: { temperature: 0.2, seed: 9 } });
  assert.deepEqual(modelSampling.data.effective.sampling, { temperature: 0.2, top_k: 77, seed: 9 });
  assert.deepEqual(modelSampling.data.effective.samplingSources, { temperature: "model", top_k: "global", seed: "model" });
  assert.deepEqual(modelSampling.data.sampling.applied, { temperature: 0.2, seed: 9 });
  const sessionSampling = await backend.send("sampling_set", { scope: "session", params: { temperature: 0, seed: null } });
  assert.deepEqual(sessionSampling.data.profiles.session.sampling, { temperature: 0 });
  assert.deepEqual(sessionSampling.data.effective.sampling, { temperature: 0, top_k: 77, seed: 9 });

  const invalidTool = await backend.send("tools_set", { scope: "session", enabledTools: ["not-a-tool"] });
  assert.equal(invalidTool.error.code, "invalid_request");
  const invalidSampling = await backend.send("sampling_set", { scope: "session", params: { temperature: 3 } });
  assert.equal(invalidSampling.error.code, "invalid_request");

  const stored = JSON.parse(await readFile(initial.data.path, "utf8"));
  assert.deepEqual(stored.global.sampling, { temperature: 0.6, top_k: 77 });
  assert.deepEqual(stored.models["fixture-provider/fixture-model"].sampling, { temperature: 0.2, seed: 9 });
  assert.equal(JSON.stringify(stored).includes("session"), false, "session overrides stay in Pi history, not resources.json");

  const helperPrompts = (await backend.readCapture()).filter((command) => command.type === "prompt" && command.message.startsWith("/qt-webui-helper "));
  const payloads = helperPrompts.map((command) => JSON.parse(command.message.slice("/qt-webui-helper ".length))).filter((entry) => entry.action === "apply").map((entry) => entry.payload);
  assert(payloads.some((payload) => payload.session && Array.isArray(payload.session.skills) && payload.session.skills.length === 0), "empty enabled skill selection reaches the helper unchanged");
  assert(payloads.some((payload) => payload.effective && payload.effective.sampling.temperature === 0 && payload.effective.sampling.seed === 9 && !Object.hasOwn(payload.effective.sampling, "top_k")), "only supported sampling values reach the helper");
});

test("resource commits avoid post-commit helper reads and report apply, persistence, and rollback failures honestly", async (t) => {
  const beforeApply = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_HELPER_FAIL_AT: "1" } });
  const stateFailure = await beforeApply.send("tools_set", { scope: "global", enabledTools: ["read"] });
  assert.equal(stateFailure.error.code, "pi_error");
  assert.match(stateFailure.error.message, /call 1/);

  const applyFailure = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_HELPER_FAIL_AT: "2" } });
  const failedApply = await applyFailure.send("tools_set", { scope: "global", enabledTools: ["read"] });
  assert.equal(failedApply.error.code, "pi_error");
  assert.match(failedApply.error.message, /call 2/);
  const failedApplyPayloads = (await applyFailure.readCapture())
    .filter((command) => command.type === "prompt" && command.message.startsWith("/qt-webui-helper "))
    .map((command) => JSON.parse(command.message.slice("/qt-webui-helper ".length)));
  assert.deepEqual(failedApplyPayloads.map((entry) => entry.action), ["state", "apply", "apply"], "a failed apply is followed by one explicit rollback");
  assert.deepEqual(failedApplyPayloads.at(-1).payload.effective.tools, null);

  const noPostCommitRead = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_HELPER_FAIL_AT: "3" } });
  const committed = await noPostCommitRead.send("tools_set", { scope: "global", enabledTools: ["read"] });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.deepEqual(committed.data.effective.tools, ["read"]);
  const committedCalls = (await noPostCommitRead.readCapture()).filter((command) => command.type === "prompt" && command.message.startsWith("/qt-webui-helper "));
  assert.equal(committedCalls.length, 2, "commit uses state plus validated apply result, with no post-commit helper round trip");

  const persistenceFailure = await readyBackend(t);
  const resourcesPath = path.join(persistenceFailure.temporary, "config", "qt-webui", "resources.json");
  await mkdir(resourcesPath, { recursive: true });
  const notSaved = await persistenceFailure.send("tools_set", { scope: "global", enabledTools: ["read"] });
  assert.equal(notSaved.error.code, "internal_error");
  const persistenceCalls = (await persistenceFailure.readCapture())
    .filter((command) => command.type === "prompt" && command.message.startsWith("/qt-webui-helper "))
    .map((command) => JSON.parse(command.message.slice("/qt-webui-helper ".length)));
  assert.deepEqual(persistenceCalls.map((entry) => entry.action), ["state", "apply", "apply"]);
  assert.deepEqual(persistenceCalls.at(-1).payload.effective.tools, null, "persistence failure rolls the helper back to the validated prior state");

  const rollbackFailure = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_HELPER_FAIL_AT: "3" } });
  const blockedPath = path.join(rollbackFailure.temporary, "config", "qt-webui", "resources.json");
  await mkdir(blockedPath, { recursive: true });
  const inconsistent = await rollbackFailure.send("tools_set", { scope: "global", enabledTools: ["read"] });
  assert.equal(inconsistent.error.code, "internal_error");
  assert.match(inconsistent.error.message, /rollback failed/i);
  assert.match(inconsistent.error.message, /state may be inconsistent/i);
});

test("helper transport handles adverse ordering, both timeout legs, and Pi exit without killing the backend", async (t) => {
  const early = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_HELPER_ERROR_BEFORE_RESPONSE_AT: "1" } });
  const earlyError = await early.send("resources_state");
  assert.equal(earlyError.data.available, false);
  assert.match(earlyError.data.error.message, /early helper error/);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal((await early.send("hello")).ok, true);
  assert.equal(early.exit, null, "an observed early rejection does not trigger fatal backend shutdown");

  const commandTimeout = await readyBackend(t, { env: {
    QT_WEBUI_FIXTURE_HELPER_COMMAND_SILENT_AT: "1",
    QT_WEBUI_FIXTURE_HELPER_NOTIFY_DELAY_MS: "200",
    QT_WEBUI_PI_REQUEST_TIMEOUT_MS: "50",
    QT_WEBUI_HELPER_TIMEOUT_MS: "500",
  } });
  const commandTimedOut = await commandTimeout.send("resources_state");
  assert.equal(commandTimedOut.data.available, false);
  assert.match(commandTimedOut.data.error.message, /Pi did not answer prompt within 50 ms/);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal((await commandTimeout.send("hello")).ok, true);
  assert.equal(commandTimeout.exit, null);

  const helperTimeout = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_HELPER_SILENT_AT: "1", QT_WEBUI_HELPER_TIMEOUT_MS: "60" } });
  const helperTimedOut = await helperTimeout.send("resources_state");
  assert.equal(helperTimedOut.data.available, false);
  assert.match(helperTimedOut.data.error.message, /helper did not answer state within 60 ms/i);
  assert.equal((await helperTimeout.send("hello")).ok, true);
  assert.equal(helperTimeout.exit, null);

  const exitedPi = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_HELPER_EXIT_AT: "1" } });
  const exited = await exitedPi.send("resources_state");
  assert.equal(exited.data.available, false);
  assert.match(exited.data.error.message, /Pi exited/);
  await exitedPi.waitForEvent("pi.exit", (event) => event.code === 24);
  assert.equal((await exitedPi.send("hello")).ok, true);
  assert.equal(exitedPi.exit, null, "Pi exit leaves the backend alive for restart");
});

test("session resource results distinguish durable and ephemeral overrides", async (t) => {
  const durable = await readyBackend(t);
  assert.deepEqual((await durable.send("resources_state")).data.sessionDurability, { durable: true, reason: "" });

  const ephemeral = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_EPHEMERAL: "1" } });
  const initial = await ephemeral.send("resources_state");
  assert.equal(initial.data.sessionDurability.durable, false);
  assert.match(initial.data.sessionDurability.reason, /ephemeral/);
  const applied = await ephemeral.send("skills_set", { scope: "session", enabledSkills: [] });
  assert.equal(applied.ok, true);
  assert.equal(applied.data.sessionDurability.durable, false);
  assert.deepEqual(applied.data.profiles.session.skills, []);
});

test("resource changes are idle-only and helper loss, timeout, and invalid profile data fail closed without blocking chat", async (t) => {
  const busyBackend = await readyBackend(t);
  await busyBackend.send("prompt", { message: "__QT_WEBUI_DELAYED_ABORT__" });
  assert.equal((await busyBackend.send("tools_set", { scope: "session", enabledTools: ["read"] })).error.code, "busy");
  await busyBackend.send("abort");
  await busyBackend.waitForEvent("run.end");

  const missing = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_NO_HELPER: "1" } });
  assert.deepEqual((await missing.send("resources_state")).data.available, false);
  assert.equal((await missing.send("skills_set", { scope: "session", enabledSkills: [] })).error.code, "unavailable");
  assert.equal((await missing.send("model_set", { provider: "fixture-provider", modelId: "fixture-fast" })).ok, true, "core model changes survive helper loss");
  assert.equal((await missing.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" })).ok, true, "core chat survives helper loss");

  const silent = await readyBackend(t, { env: { QT_WEBUI_FIXTURE_HELPER_SILENT: "1", QT_WEBUI_HELPER_TIMEOUT_MS: "80" } });
  const timeout = await silent.send("sampling_set", { scope: "session", params: { temperature: 0.3 } });
  assert.equal(timeout.error.code, "timeout");

  const invalid = await readyBackend(t);
  const state = await invalid.send("resources_state");
  await mkdir(path.dirname(state.data.path), { recursive: true });
  await writeFile(state.data.path, "{not json\n");
  const fallback = await invalid.send("resources_state");
  assert.equal(fallback.data.available, true);
  assert.match(fallback.data.problems[0], /not valid JSON/);
  assert.equal((await invalid.send("prompt", { message: "__QT_WEBUI_IMMEDIATE__" })).ok, true);
});

test("model and thinking changes return refreshed resource capabilities without stale stored values", async (t) => {
  const backend = await readyBackend(t);
  await backend.send("sampling_set", { scope: "global", params: { temperature: 0.4, top_k: 55 } });
  const changed = await backend.send("model_set", { provider: "fixture-provider", modelId: "fixture-fast" });
  assert.equal(changed.data.resources.model.id, "fixture-fast");
  assert.equal(changed.data.resources.sampling.api, "fixture-unknown");
  assert(Object.values(changed.data.resources.sampling.capabilities).every((entry) => entry.supported === false));
  assert.deepEqual(changed.data.resources.effective.sampling, { temperature: 0.4, top_k: 55 }, "stored values survive capability loss");
  assert.deepEqual(changed.data.resources.sampling.applied, {}, "unknown APIs apply no values");
  const cycled = await backend.send("model_cycle");
  assert.equal(cycled.data.resources.model.id, "other-model");
  assert.equal(cycled.data.resources.sampling.api, "google-generative-ai");
  assert.deepEqual(cycled.data.resources.sampling.applied, { temperature: 0.4, top_k: 55 });
  const thinking = await backend.send("thinking_set", { level: "low" });
  assert.equal(thinking.data.resources.thinkingLevel, "low");
  assert.equal(thinking.data.resources.sampling.thinkingActive, true);
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
