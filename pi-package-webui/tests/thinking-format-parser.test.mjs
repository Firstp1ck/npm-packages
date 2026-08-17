import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitThinkingFormatTextAuthoritative } from "../public/stream-derived-output.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
const helperStart = app.indexOf("function escapeRegExp(");
const helperEnd = app.indexOf("\nfunction appendThinkingFormatDisplayMessages(", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "thinking-format helpers should remain independently testable");

const context = {
  THINKING_FORMAT_OPEN_TAG_REGEX: /^<think\b[^>]*>/i,
  THINKING_FORMAT_CLOSE_TAG_REGEX: /<\/think\s*>/i,
  CHANNEL_THINKING_FORMAT_OPEN_TAG_REGEX: /^<\|([a-z][\w-]*)>/i,
};
vm.runInNewContext(
  `${app.slice(helperStart, helperEnd)}\nthis.splitThinkingFormatText = splitThinkingFormatText;`,
  context,
  { filename: "thinking-format-helpers.js" },
);

function parse(text, options) {
  return JSON.parse(JSON.stringify(context.splitThinkingFormatText(text, options)));
}

assert.deepEqual(parse("<think>reasoning</think>\nfinal answer"), {
  hasThinkingFormat: true,
  thinkingText: "reasoning",
  finalText: "final answer",
  complete: true,
});

const nestedLiteral = "The user mentioned `<think>example</think>` inside the reasoning; keep the rest here.";
assert.deepEqual(parse(`<think>${nestedLiteral}</think>\nfinal answer`), {
  hasThinkingFormat: true,
  thinkingText: nestedLiteral,
  finalText: "final answer",
  complete: true,
}, "a balanced literal tag pair must not close the outer thinking block");

assert.deepEqual(parse(`<think>${nestedLiteral}`, { streaming: true }), {
  hasThinkingFormat: true,
  thinkingText: nestedLiteral,
  finalText: "",
  complete: false,
}, "streaming must not expose text after an inner literal close as final output");

assert.deepEqual(parse("<think>first</think><think>second</think>\nanswer"), {
  hasThinkingFormat: true,
  thinkingText: "first\n\nsecond",
  finalText: "answer",
  complete: true,
}, "consecutive outer thinking blocks should remain supported");

assert.deepEqual(parse("<|analysis>channel reasoning<analysis|>\nanswer"), {
  hasThinkingFormat: true,
  thinkingText: "channel reasoning",
  finalText: "answer",
  complete: true,
}, "channel-style thinking delimiters should remain unchanged");

for (const [text, options] of [
  ["<th", { streaming: true }],
  ["<think>reasoning</thi", { streaming: true }],
  ["<think>first</think><th", { streaming: true }],
  ["<think>first</think><think>second</think>\r\nanswer", { streaming: true }],
  ["<|Analysis>Unicode 😀<ANALYSIS|>\nanswer", { streaming: true }],
]) {
  assert.deepEqual(
    parse(text, options),
    JSON.parse(JSON.stringify(splitThinkingFormatTextAuthoritative(text, options))),
    `stream-derived authoritative parsing should stay aligned for ${JSON.stringify(text)}`,
  );
}

console.log("thinking-format-parser.test.mjs passed");
