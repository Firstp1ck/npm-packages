import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonlReader } from "../lib/backend/jsonl.mjs";
import { blockPlainText, escapeStyledText, renderInline, renderMarkdown } from "../lib/backend/markdown.mjs";
import { terminateProcessTree } from "../lib/backend/process-tree.mjs";
import {
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  REQUEST_TYPES,
  THINKING_LEVELS,
  boundedString,
  makeErrorResponse,
  makeEvent,
  makeResponse,
  safeExternalLink,
  stripAnsi,
  validateRequest,
} from "../lib/backend/protocol.mjs";
import { normalizeModel, normalizeModels, normalizeThinkingLevels } from "../lib/backend/pi-session.mjs";
import { createResourceStore, resolveEffective, updateProfile, validateResources } from "../lib/backend/resources.mjs";
import { applySamplingToPayload, samplingCapabilities, validateSamplingParams } from "../lib/backend/sampling.mjs";
import { createSettingsStore, defaultSettings } from "../lib/backend/settings.mjs";
import qtWebUiHelper, { RESPONSE_PREFIX } from "../lib/pi-extension/qt-webui-helper.mjs";

const STYLED_TAG = /<\/?([a-z]+)(?:\s+href="[^"]*")?>/g;
const ALLOWED_TAGS = new Set(["b", "i", "s", "tt", "a", "br"]);

function assertWhitelistedMarkup(styled) {
  for (const match of styled.matchAll(STYLED_TAG)) assert(ALLOWED_TAGS.has(match[1]), `unexpected tag <${match[1]}> in ${styled}`);
  const stripped = styled.replace(STYLED_TAG, "");
  assert.doesNotMatch(stripped, /<|>/, `unescaped angle bracket in ${styled}`);
}

// ---- protocol ------------------------------------------------------------------------------

test("protocol frames carry the version and one kind", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.deepEqual(makeResponse("r1", { a: 1 }), { v: 1, kind: "response", id: "r1", ok: true, data: { a: 1 } });
  assert.deepEqual(makeErrorResponse("r1", "bad", "x".repeat(600)).error.message.length, LIMITS.maxErrorCharacters);
  assert.deepEqual(makeEvent("pi.status", { statusKind: "ready" }), { v: 1, kind: "event", type: "pi.status", statusKind: "ready" });
  for (const type of REQUEST_TYPES) assert.equal(typeof LIMITS.requestTimeoutMs[type], "number", `${type} needs a timeout`);
  for (const reserved of ["kind", "type", "v", "id"]) {
    assert.throws(() => makeEvent("x", { [reserved]: 1 }), /reserved frame key/, `${reserved} must be rejected`);
  }
});

test("validateRequest rejects wrong versions, ids, and unknown types", () => {
  const valid = { v: 1, id: "a", type: "hello" };
  assert.deepEqual(validateRequest(valid), { id: "a", type: "hello" });
  assert.throws(() => validateRequest({ ...valid, v: 2 }), (error) => error instanceof ProtocolError && error.code === "unsupported_version");
  assert.throws(() => validateRequest({ ...valid, id: "" }), /request id/);
  assert.throws(() => validateRequest({ ...valid, id: "x".repeat(LIMITS.maxRequestIdCharacters + 1) }), /too long/);
  assert.doesNotThrow(() => validateRequest({ ...valid, id: "x".repeat(LIMITS.maxRequestIdCharacters) }));
  assert.throws(() => validateRequest({ ...valid, type: "rm_rf" }), (error) => error.code === "unknown_request");
  assert.throws(() => validateRequest([]), /JSON object/);
  assert.throws(() => validateRequest(null), /JSON object/);
});

test("validateRequest bounds prompt, dialog answers, settings, links, and notifications", () => {
  const prompt = (fields) => validateRequest({ v: 1, id: "p", type: "prompt", ...fields });
  assert.equal(prompt({ message: "x".repeat(LIMITS.maxMessageCharacters) }).mode, "send");
  assert.throws(() => prompt({ message: "x".repeat(LIMITS.maxMessageCharacters + 1) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => prompt({ message: "   " }), /empty/);
  assert.throws(() => prompt({ message: "hi", mode: "yolo" }), /mode/);
  assert.equal(prompt({ message: "hi", mode: "steer" }).mode, "steer");

  const answer = (fields) => validateRequest({ v: 1, id: "e", type: "extension_response", requestId: "d1", ...fields });
  assert.deepEqual(answer({ value: "Allow" }), { id: "e", type: "extension_response", requestId: "d1", value: "Allow" });
  assert.deepEqual(answer({ confirmed: false }).confirmed, false);
  assert.equal(answer({ cancelled: true }).cancelled, true);
  assert.throws(() => answer({}), /exactly one/);
  assert.throws(() => answer({ value: "a", confirmed: true }), /exactly one/);
  assert.throws(() => answer({ cancelled: false }), /cancelled must be true/);
  assert.throws(() => answer({ confirmed: "yes" }), /boolean/);
  assert.throws(() => answer({ value: "x".repeat(LIMITS.maxDialogValueCharacters + 1) }), /exceeds/);

  const settings = (values) => validateRequest({ v: 1, id: "s", type: "settings_set", values });
  assert.deepEqual(settings({ compactTranscript: true }).values, { compactTranscript: true });
  assert.throws(() => settings({ unknown: true }), /unknown setting/);
  assert.throws(() => settings({ compactTranscript: "yes" }), /must be boolean/);
  assert.throws(() => settings([]), /values object/);

  assert.throws(() => validateRequest({ v: 1, id: "l", type: "open_link", url: "x".repeat(LIMITS.maxLinkUrlCharacters + 1) }), /exceeds/);
  assert.throws(() => validateRequest({ v: 1, id: "n", type: "notify", title: "x".repeat(LIMITS.maxNotificationCharacters + 1) }), /exceeds/);
  assert.equal(validateRequest({ v: 1, id: "n", type: "notify", title: "done" }).body, "");
});

test("validateRequest bounds model, thinking, and compaction requests", () => {
  const model = (fields) => validateRequest({ v: 1, id: "m", type: "model_set", ...fields });
  assert.deepEqual(model({ provider: "anthropic", modelId: "claude" }), { id: "m", type: "model_set", provider: "anthropic", modelId: "claude" });
  assert.doesNotThrow(() => model({ provider: "p".repeat(LIMITS.maxProviderCharacters), modelId: "m".repeat(LIMITS.maxModelIdCharacters) }));
  assert.throws(() => model({ provider: "p".repeat(LIMITS.maxProviderCharacters + 1), modelId: "m" }), (error) => error.code === "limit_exceeded");
  assert.throws(() => model({ provider: "p", modelId: "m".repeat(LIMITS.maxModelIdCharacters + 1) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => model({ provider: " ", modelId: "m" }), /requires a provider/);
  assert.throws(() => model({ provider: "p" }), /string modelId/);

  const thinking = (level) => validateRequest({ v: 1, id: "t", type: "thinking_set", level });
  for (const level of THINKING_LEVELS) assert.equal(thinking(level).level, level);
  assert.throws(() => thinking("ultra"), /thinking level must be one of/);
  assert.throws(() => thinking(3), /thinking level must be one of/);

  const compact = (fields) => validateRequest({ v: 1, id: "c", type: "compact", ...fields });
  assert.equal(compact({}).instructions, "");
  assert.equal(compact({ instructions: "x".repeat(LIMITS.maxCompactionInstructionCharacters) }).instructions.length, LIMITS.maxCompactionInstructionCharacters);
  assert.throws(() => compact({ instructions: "x".repeat(LIMITS.maxCompactionInstructionCharacters + 1) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => compact({ instructions: 7 }), /string instructions/);
  assert.equal(validateRequest({ v: 1, id: "l", type: "models_list" }).type, "models_list");
  for (const type of ["models_list", "model_set", "model_cycle", "thinking_levels", "thinking_set", "thinking_cycle", "compact"]) {
    assert(REQUEST_TYPES.includes(type), `${type} must be a request type`);
  }
});

test("resource requests preserve null inheritance, intentional empty lists, and numeric bounds", () => {
  const valid = (type, fields) => validateRequest({ v: 1, id: "r", type, ...fields });
  assert.deepEqual(valid("tools_set", { scope: "session", enabledTools: null }).names, null);
  assert.deepEqual(valid("tools_set", { scope: "global", enabledTools: [] }).names, []);
  assert.deepEqual(valid("skills_set", { scope: "model", enabledSkills: ["review"] }).names, ["review"]);
  assert.throws(() => valid("skills_set", { scope: "model", disabledSkills: [] }), /requires enabledSkills/);
  assert.throws(() => valid("tools_set", { scope: "other", enabledTools: [] }), /scope must be/);
  assert.doesNotThrow(() => valid("tools_set", { scope: "session", enabledTools: Array.from({ length: LIMITS.maxResourceNames }, (_, index) => `t${index}`) }));
  assert.throws(() => valid("tools_set", { scope: "session", enabledTools: Array.from({ length: LIMITS.maxResourceNames + 1 }, (_, index) => `t${index}`) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => valid("skills_set", { scope: "session", enabledSkills: ["same", "same"] }), /unique/);
  assert.deepEqual(valid("sampling_set", { scope: "global", params: null }).params, null);
  assert.deepEqual(valid("sampling_set", { scope: "model", params: { temperature: 0, seed: Number.MAX_SAFE_INTEGER } }).params, { temperature: 0, seed: Number.MAX_SAFE_INTEGER });
  assert.throws(() => valid("sampling_set", { scope: "session", params: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`p${index}`, 1])) }), (error) => error.code === "limit_exceeded");
  for (const type of ["resources_state", "tools_set", "skills_set", "sampling_set"]) assert(REQUEST_TYPES.includes(type));
});

test("resource profiles resolve session then exact model then global without collapsing empty selections", async (t) => {
  const global = { tools: ["read"], skills: [], sampling: { temperature: 0.4, top_p: 0.9 } };
  const model = { tools: [], skills: null, sampling: { temperature: 0.2 } };
  const session = { tools: null, skills: ["review"], sampling: { seed: 7 } };
  assert.deepEqual(resolveEffective({ session, model, global }), {
    tools: [], toolsSource: "model", skills: ["review"], skillsSource: "session",
    sampling: { temperature: 0.2, top_p: 0.9, seed: 7 },
    samplingSources: { temperature: "model", top_p: "global", seed: "session" },
  });
  assert.deepEqual(resolveEffective({ session: { tools: [], skills: [], sampling: {} }, model: null, global: null }).tools, []);
  assert.equal(resolveEffective({ session: null, model: null, global: null }).tools, null);

  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resources-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createResourceStore({ directory });
  store.update("global", {}, "sampling", { temperature: 0.7, top_k: 99 });
  store.update("model", { provider: "p", modelId: "m" }, "tools", []);
  assert.deepEqual(store.profileFor("global").sampling, { temperature: 0.7, top_k: 99 }, "unsupported values stay persisted");
  assert.deepEqual(store.profileFor("model", "p", "m").tools, []);
  store.update("model", { provider: "p", modelId: "m" }, "tools", null);
  assert.equal(Object.hasOwn(store.read().value.models, "p/m"), false, "an all-inherit model profile is removed");
  const mode = (await stat(store.path)).mode & 0o777;
  assert.equal(mode, 0o600);
  const invalid = validateResources({ global: { tools: "bad", sampling: { temperature: 3, top_k: 50 } }, models: {} });
  assert.deepEqual(invalid.value.global.sampling, { top_k: 50 });
  assert(invalid.problems.length >= 2);
  assert.deepEqual(updateProfile(global, "sampling", { temperature: null, seed: 4 }).sampling, { top_p: 0.9, seed: 4 });
});

test("sampling capabilities validate every parameter and serialize exact provider payload shapes", () => {
  assert.deepEqual(validateSamplingParams({ temperature: 0, top_p: 1, frequency_penalty: -2, presence_penalty: 2, seed: Number.MAX_SAFE_INTEGER, top_k: 1, min_p: 0 }).problems, {});
  for (const [key, value] of Object.entries({ temperature: 2.01, top_p: -0.01, frequency_penalty: -2.01, presence_penalty: 2.01, seed: 1.5, top_k: 0, min_p: 1.01 })) {
    assert(Object.hasOwn(validateSamplingParams({ [key]: value }).problems, key), `${key} rejects one over its range or integer contract`);
  }
  assert(Object.values(samplingCapabilities("unknown-api")).every((entry) => entry.supported === false));
  assert.equal(samplingCapabilities("anthropic-messages", { thinkingActive: true }).temperature.supported, false);
  const all = { temperature: 0.3, top_p: 0.8, frequency_penalty: -0.2, presence_penalty: 0.4, seed: 42, top_k: 30, min_p: 0.1 };
  assert.deepEqual(applySamplingToPayload({ model: "x" }, "openai-completions", all), { model: "x", temperature: 0.3, top_p: 0.8, frequency_penalty: -0.2, presence_penalty: 0.4, seed: 42 });
  assert.deepEqual(applySamplingToPayload({ config: { keep: true } }, "google-generative-ai", all), { config: { keep: true, temperature: 0.3, topP: 0.8, topK: 30, frequencyPenalty: -0.2, presencePenalty: 0.4, seed: 42 } });
  assert.deepEqual(applySamplingToPayload({}, "bedrock-converse-stream", all), { inferenceConfig: { temperature: 0.3, topP: 0.8 } });
  assert.deepEqual(applySamplingToPayload({}, "pi-messages", all), { options: { temperature: 0.3 } });
  assert.equal(applySamplingToPayload({}, "unknown-api", all), undefined, "unknown provider APIs apply no sampling values");
});

test("Pi helper persists enabled-name session overrides and translates effective skills and sampling internally", async () => {
  const handlers = new Map();
  const commands = new Map();
  const entries = [];
  const notifications = [];
  let activeTools = ["read", "bash"];
  let appendFailure = false;
  let persisted = true;
  const allTools = [{ name: "read", description: "Read" }, { name: "bash", description: "Shell" }];
  const allSkills = [
    { name: "review", description: "Review", filePath: "/skills/review/SKILL.md" },
    { name: "search", description: "Search", filePath: "/skills/search/SKILL.md" },
  ];
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    getActiveTools() { return [...activeTools]; },
    getAllTools() { return allTools; },
    setActiveTools(names) { activeTools = [...names]; },
    appendEntry(type, data) {
      if (appendFailure) throw new Error("deterministic append failure");
      entries.push({ type, data: structuredClone(data) });
    },
  };
  qtWebUiHelper(pi);
  const ctx = {
    model: { provider: "p", id: "m", api: "openai-completions", reasoning: false },
    thinkingLevel: "off",
    sessionManager: { getBranch: () => [], isPersisted: () => persisted },
    getSystemPromptOptions: () => ({ skills: allSkills }),
    ui: { notify: (message) => notifications.push(message) },
  };
  await handlers.get("session_start")({}, ctx);
  const apply = commands.get("qt-webui-helper").handler;
  await apply(JSON.stringify({ requestId: "a", action: "apply", payload: {
    session: { tools: [], skills: [], sampling: { temperature: 0.3, top_k: 20 } },
    effective: { tools: [], skills: ["review"], sampling: { temperature: 0.3, top_k: 20 } },
  } }), ctx);
  assert.deepEqual(entries.at(-1).data, { version: 1, tools: [], skills: [], sampling: { temperature: 0.3, top_k: 20 } }, "stored session values remain distinct from effective values");
  assert.deepEqual(activeTools, []);
  const answer = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.deepEqual(answer.data.session, { tools: [], skills: [], sampling: { temperature: 0.3, top_k: 20 }, durability: { durable: true, reason: "" } });
  assert.deepEqual(answer.data.skills.enabled, ["review"], "the enabled list is translated to the helper's disabled set");
  assert.deepEqual(handlers.get("before_provider_request")({ payload: { model: "m" } }, ctx), { model: "m", temperature: 0.3 }, "unsupported stored values are not serialized");

  await apply(JSON.stringify({ requestId: "b", action: "apply", payload: {
    session: { tools: null, skills: null, sampling: {} },
    effective: { tools: null, skills: [], sampling: {} },
  } }), ctx);
  const reset = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.equal(reset.data.session.tools, null);
  assert.equal(reset.data.session.skills, null);
  assert.deepEqual(reset.data.skills.enabled, [], "an intentional empty effective selection is not treated as inherit");
  assert.deepEqual(activeTools, ["read", "bash"], "null effective tools restore Pi defaults");

  appendFailure = true;
  await apply(JSON.stringify({ requestId: "c", action: "apply", payload: {
    session: { tools: [] }, effective: { tools: [] },
  } }), ctx);
  const failed = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.equal(failed.ok, false);
  assert.match(failed.error, /deterministic append failure/);
  assert.equal(reset.data.session.tools, null, "the last confirmed session state remains unchanged");
  assert.deepEqual(activeTools, ["read", "bash"], "effective tools do not change after a durability failure");

  persisted = false;
  await apply(JSON.stringify({ requestId: "d", action: "apply", payload: {
    session: { tools: [] }, effective: { tools: [] },
  } }), ctx);
  const ephemeral = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.equal(ephemeral.ok, true);
  assert.deepEqual(ephemeral.data.session.durability, {
    durable: false,
    reason: "This Pi session is ephemeral; resource overrides apply only until it ends.",
  });
  assert.deepEqual(activeTools, [], "an explicitly non-durable override still applies in memory");
});

test("model inventories and thinking levels are normalized, deduplicated, and bounded", () => {
  const full = normalizeModel({ id: "m\u001b[31m1\u001b[0m", name: "Name", provider: "prov", reasoning: true, input: ["text", "image", "audio"], contextWindow: 1000.9, maxTokens: -5, baseUrl: "https://x", cost: {} });
  assert.deepEqual(full, { provider: "prov", id: "m1", name: "Name", reasoning: true, acceptsImages: true, contextWindow: 1000, maxTokens: 0 });
  assert.equal(normalizeModel({ id: "", provider: "p" }), null);
  assert.equal(normalizeModel({ id: "x" }), null);
  assert.equal(normalizeModel("text"), null);
  assert.equal(normalizeModel({ id: "x".repeat(LIMITS.maxModelIdCharacters + 5), provider: "p" }).id.length, LIMITS.maxModelIdCharacters);
  assert.equal(normalizeModel({ id: "x", provider: "p", name: "n".repeat(LIMITS.maxModelNameCharacters + 1) }).name.length, LIMITS.maxModelNameCharacters);

  const many = Array.from({ length: LIMITS.maxModels + 1 }, (_, index) => ({ id: `m${index}`, provider: "p" }));
  assert.deepEqual(normalizeModels(many.slice(0, LIMITS.maxModels)).omitted, 0);
  const over = normalizeModels(many.concat([{ id: "m0", provider: "p" }, null]));
  assert.equal(over.models.length, LIMITS.maxModels);
  assert.equal(over.omitted, 1, "duplicates and malformed entries do not count as omitted");
  assert.deepEqual(normalizeModels(undefined), { models: [], omitted: 0 });

  assert.deepEqual(normalizeThinkingLevels(["high", "bogus", "off", "low", "off"]), ["off", "low", "high"]);
  assert.deepEqual(normalizeThinkingLevels([]), ["off"]);
  assert.deepEqual(normalizeThinkingLevels("high"), ["off"]);
  assert.equal(normalizeThinkingLevels(THINKING_LEVELS).length, Math.min(THINKING_LEVELS.length, LIMITS.maxThinkingLevels));
});

test("safeExternalLink allows only http, https, and mailto without credentials or control characters", () => {
  assert.equal(safeExternalLink("https://example.com/path?q=1#x"), "https://example.com/path?q=1#x");
  assert.equal(safeExternalLink("http://example.com"), "http://example.com/");
  assert.equal(safeExternalLink("mailto:someone@example.com"), "mailto:someone@example.com");
  for (const bad of [
    "javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x</b>", "ftp://example.com/x",
    "https://user:pw@example.com", "https://exa mple.com", "https://example.com/\u0000", "not a url", "", "https://",
    `https://example.com/${"a".repeat(LIMITS.maxLinkUrlCharacters)}`,
  ]) assert.equal(safeExternalLink(bad), null, `should reject ${bad}`);
});

test("stripAnsi removes SGR, CSI, OSC, bare bracket sequences, and control characters", () => {
  assert.equal(stripAnsi("\u001b[38;2;249;22;22mred\u001b[0m"), "red");
  assert.equal(stripAnsi("a\u001b[2Kb\u001b]0;title\u0007c"), "abc");
  assert.equal(stripAnsi("plain [38;2;1;2;3m leaked"), "plain  leaked");
  assert.equal(stripAnsi("tab\tkept\nnewline\u0000nul"), "tab\tkept\nnewlinenul");
  assert.equal(stripAnsi(undefined), "");
});

test("boundedString truncates at the limit with one marker character", () => {
  assert.equal(boundedString("abc", 3), "abc");
  assert.equal(boundedString("abcd", 3), "ab…");
  assert.equal(boundedString(undefined, 3, "fallback"), "fa…");
  assert.equal(boundedString(42, 5), "42");
});

// ---- jsonl ---------------------------------------------------------------------------------

test("JSONL reader splits on LF only, strips one CR, and keeps U+2028 inside strings", () => {
  const records = [];
  const reader = createJsonlReader({ maxFrameBytes: 1024, onRecord: (record) => records.push(record) });
  reader.write('{"a":1}\r\n{"b":"x\u2028y"}\n{"c":');
  reader.write("2}\n");
  reader.write('{"tail":true}');
  reader.end();
  assert.deepEqual(records, [{ a: 1 }, { b: "x\u2028y" }, { c: 2 }, { tail: true }]);
});

test("JSONL reader rejects oversized frames without buffering them and keeps delivering later frames", () => {
  const records = [];
  const oversized = [];
  const invalid = [];
  const reader = createJsonlReader({
    maxFrameBytes: 64,
    onRecord: (record) => records.push(record),
    onOversized: (bytes) => oversized.push(bytes),
    onInvalid: (error) => invalid.push(error.message),
  });
  reader.write(`{"ok":1}\n{"big":"${"x".repeat(200)}"}\n`);
  reader.write(`{"big2":"${"y".repeat(100)}`);
  reader.write(`${"y".repeat(100)}"}\n{"ok":2}\n{"ok":"exactly-64-bytes-long-frame-padding-xxxxxxxxxxxxxxxx"}\n`);
  reader.write("not json\n");
  reader.end();
  assert.deepEqual(records.filter((record) => record.ok !== undefined).map((record) => record.ok), [1, 2, "exactly-64-bytes-long-frame-padding-xxxxxxxxxxxxxxxx"]);
  assert.equal(oversized.length, 2);
  assert(oversized[0] > 64 && oversized[1] > 200);
  assert.equal(invalid.length, 1);
});

// ---- markdown ------------------------------------------------------------------------------

test("markdown rendering escapes raw HTML and keeps every inline element inside the whitelist", () => {
  const source = [
    "# Title <script>alert(1)</script>",
    "Plain <img src=\"file:///etc/passwd\" onerror=\"x()\"> and <a href=\"javascript:alert(1)\">x</a>.",
    "**bold** *em* ~~gone~~ `co<de>` [ok](https://example.com) [bad](javascript:alert(1)) <https://auto.example> ![pic](https://example.com/a.png)",
    "- item <b>x</b>",
    "> quote <i>y</i>",
    "| h<1> | h2 |", "|---|---|", "| c<1> | c2 |",
    "```html", "<script>alert('inside code')</script>", "```",
  ].join("\n");
  const { blocks, truncated } = renderMarkdown(source);
  assert.equal(truncated, false);
  for (const block of blocks) {
    if (block.styled !== undefined) assertWhitelistedMarkup(block.styled);
    if (block.type === "table") for (const cell of [...block.header, ...block.rows.flat()]) assertWhitelistedMarkup(cell);
  }
  const styledOnly = JSON.stringify(blocks.map((block) => (block.type === "code" ? { type: "code" } : block)));
  assert.doesNotMatch(styledOnly, /<script>|<img|href=\\"javascript|href=\\"file/);
  assert.match(styledOnly, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const inline = blocks.find((block) => block.type === "paragraph" && block.styled.includes("<b>bold</b>")).styled;
  assert.match(inline, /<i>em<\/i>/);
  assert.match(inline, /<s>gone<\/s>/);
  assert.match(inline, /<tt>co&lt;de&gt;<\/tt>/);
  assert.match(inline, /<a href="https:\/\/example.com\/">ok<\/a>/);
  assert.match(inline, /\[bad\]\(javascript:alert\(1\)\)/);
  assert.match(inline, /<a href="https:\/\/auto.example\/">/);
  assert.match(inline, /\[image: pic\]/);
  assert.doesNotMatch(inline, /a\.png/);
  const code = blocks.find((block) => block.type === "code");
  assert.equal(code.language, "html");
  assert.equal(code.text, "<script>alert('inside code')</script>");
  assert.equal(code.closed, true);
});

test("markdown input, block, depth, table, and list limits hold at the limit and one over", () => {
  const atLimit = renderMarkdown("a".repeat(LIMITS.maxMarkdownInputCharacters));
  assert.equal(atLimit.truncated, false);
  const overLimit = renderMarkdown("a".repeat(LIMITS.maxMarkdownInputCharacters + 1));
  assert.equal(overLimit.truncated, true);
  assert.equal(overLimit.blocks.at(-1).type, "notice");

  const headings = (count) => Array.from({ length: count }, (_, index) => `# h${index}`).join("\n\n");
  assert.equal(renderMarkdown(headings(LIMITS.maxMarkdownBlocks)).blocks.length, LIMITS.maxMarkdownBlocks);
  assert.equal(renderMarkdown(headings(LIMITS.maxMarkdownBlocks)).truncated, false);
  const tooMany = renderMarkdown(headings(LIMITS.maxMarkdownBlocks + 1));
  assert.equal(tooMany.truncated, true);
  assert.equal(tooMany.blocks.length, LIMITS.maxMarkdownBlocks);
  assert.equal(tooMany.blocks.at(-1).type, "notice");

  const deepQuote = renderMarkdown(`${"> ".repeat(LIMITS.maxMarkdownDepth + 3)}deep **bold**`);
  assert(deepQuote.blocks.every((block) => block.depth < LIMITS.maxMarkdownDepth), JSON.stringify(deepQuote.blocks));
  assert(deepQuote.blocks.every((block) => block.quote === true));

  const table = (rows) => ["| a | b |", "|---|---|", ...Array.from({ length: rows }, (_, index) => `| ${index} | x |`)].join("\n");
  assert.equal(renderMarkdown(table(LIMITS.maxTableRows)).blocks[0].droppedRows, 0);
  assert.equal(renderMarkdown(table(LIMITS.maxTableRows + 1)).blocks[0].droppedRows, 1);
  assert.equal(renderMarkdown(table(LIMITS.maxTableRows + 1)).blocks[0].rows.length, LIMITS.maxTableRows);
  const wide = renderMarkdown(`|${" c |".repeat(LIMITS.maxTableColumns + 4)}\n|${"---|".repeat(LIMITS.maxTableColumns + 4)}\n|${" d |".repeat(LIMITS.maxTableColumns + 4)}`);
  assert.equal(wide.blocks[0].header.length, LIMITS.maxTableColumns);

  const list = (count) => Array.from({ length: count }, (_, index) => `- item ${index}`).join("\n");
  assert.equal(renderMarkdown(list(LIMITS.maxListItems)).blocks.filter((block) => block.type === "listItem").length, LIMITS.maxListItems);
  const longList = renderMarkdown(list(LIMITS.maxListItems + 1));
  assert(longList.blocks.filter((block) => block.type === "listItem").length <= LIMITS.maxListItems);
  assert(longList.blocks.length <= LIMITS.maxMarkdownBlocks);
  assert.match(longList.blocks.at(-1).styled, /omitted|shortened/);
  const nested = renderMarkdown("- a\n  - b\n    - c\n      - d\n        - e\n          - f");
  assert(nested.blocks.every((block) => block.depth < LIMITS.maxMarkdownDepth));
});

test("markdown list numbering, tasks, rules, and unclosed fences render predictably", () => {
  const { blocks } = renderMarkdown("1. one\n2. two\n- [x] done\n- [ ] todo\n\n---\n\n```\nunclosed");
  assert.deepEqual(blocks.slice(0, 2).map((block) => [block.ordered, block.index]), [[true, 1], [true, 2]]);
  assert.deepEqual(blocks.slice(2, 4).map((block) => [block.task, block.checked]), [[true, true], [true, false]]);
  assert.equal(blocks[4].type, "rule");
  assert.equal(blocks[5].type, "code");
  assert.equal(blocks[5].closed, false);
  assert.equal(blocks[5].text, "unclosed");
});

test("plain text of rendered blocks matches the original text for copy and search", () => {
  const original = "Use <T> & \"quotes\" with **bold** and [x](https://example.com)";
  const { blocks } = renderMarkdown(original);
  assert.equal(blockPlainText(blocks[0]), 'Use <T> & "quotes" with bold and x');
  assert.equal(escapeStyledText("<&>\""), "&lt;&amp;&gt;&quot;");
  assert.equal(renderInline("plain"), "plain");
  assert.equal(renderInline("a \\* b"), "a * b");
});

test("markdown rendering stays fast and bounded for adversarial input", () => {
  const nasty = `${"[".repeat(3000)}${"*".repeat(3000)}${"`".repeat(2000)}`;
  const started = process.hrtime.bigint();
  const { blocks } = renderMarkdown(nasty);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert(elapsedMs < 2000, `adversarial render took ${elapsedMs}ms`);
  assert(blocks.length <= LIMITS.maxMarkdownBlocks);
});

// ---- settings ------------------------------------------------------------------------------

test("settings store uses XDG config, private permissions, atomic writes, and validated reads", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "qt-webui-settings-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = createSettingsStore({ env: { XDG_CONFIG_HOME: home } });
  assert.equal(store.path, path.join(home, "qt-webui", "settings.json"));
  assert.deepEqual(store.read(), { settings: defaultSettings(), problems: [], path: store.path });

  const written = store.write({ compactTranscript: true });
  assert.equal(written.settings.compactTranscript, true);
  assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(store.path, "utf8")), { ...defaultSettings(), compactTranscript: true });
  assert.throws(() => store.write({ unknown: 1 }), /unknown setting/);
  assert.throws(() => store.write({ showThinking: "no" }), /expected boolean/);

  await writeFile(store.path, "{not json");
  assert.match(store.read().problems[0], /not valid JSON/);
  assert.deepEqual(store.read().settings, defaultSettings());
  await writeFile(store.path, JSON.stringify({ compactTranscript: true, extra: 1, showThinking: 3 }));
  const partial = store.read();
  assert.equal(partial.settings.compactTranscript, true);
  assert.equal(partial.settings.showThinking, true);
  assert.equal(partial.problems.length, 2);
  await writeFile(store.path, `{"compactTranscript":true,"pad":"${"x".repeat(LIMITS.maxSettingsFileBytes)}"}`);
  assert.match(store.read().problems[0], /exceeds/);
  assert.equal(store.read().settings.compactTranscript, false);
});

test("settings directory falls back to ~/.config when XDG_CONFIG_HOME is relative or unset", async () => {
  const { settingsDirectory } = await import("../lib/backend/settings.mjs");
  assert.equal(settingsDirectory({ XDG_CONFIG_HOME: "relative/path" }), path.join(os.homedir(), ".config", "qt-webui"));
  assert.equal(settingsDirectory({}), path.join(os.homedir(), ".config", "qt-webui"));
});

// ---- process tree --------------------------------------------------------------------------

test("terminateProcessTree escalates from SIGTERM to SIGKILL after the grace period", async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  const result = terminateProcessTree(child, {
    graceMs: 20,
    signalImpl: (target, signal) => {
      signals.push(signal);
      if (signal === "SIGKILL" && child.exitCode === null) {
        child.exitCode = null;
        child.signalCode = "SIGKILL";
        queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
      }
      return true;
    },
  });
  assert.deepEqual(await result, { escalated: true, alreadyExited: false });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL", "SIGKILL"]);
});

test("terminateProcessTree resolves immediately for an exited child and still sweeps the group", async () => {
  const child = new EventEmitter();
  child.pid = 1;
  child.exitCode = 0;
  child.signalCode = null;
  const signals = [];
  const result = await terminateProcessTree(child, { graceMs: 5, signalImpl: (_target, signal) => signals.push(signal) });
  assert.deepEqual(result, { escalated: false, alreadyExited: true });
  assert.deepEqual(signals, ["SIGKILL"]);
});
