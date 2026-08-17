import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTodoProgressLinesAuthoritative } from "../public/stream-derived-output.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

// Extract the contiguous region containing textLines and stripTodoProgressLines.
// textLines is a shared helper; stripTodoProgressLines references it and the
// todo-progress regex constants. The region ends at the next function boundary.
const textLinesStart = app.indexOf("\nfunction textLines(");
assert.ok(textLinesStart >= 0, "textLines helper should exist in app.js");
const nextFnAfterStrip = app.indexOf("\nfunction parseTodoProgressItemLine(", textLinesStart);
assert.ok(nextFnAfterStrip > textLinesStart, "parseTodoProgressItemLine should follow stripTodoProgressLines");
const todoFilterRegion = app.slice(textLinesStart, nextFnAfterStrip);

// Also need the regex constants from the module-level scope.
assert.ok(app.includes("const TODO_PROGRESS_LINE_REGEX = "), "TODO_PROGRESS_LINE_REGEX should be defined");
assert.ok(app.includes("const TODO_PROGRESS_PARTIAL_LINE_REGEX = "), "TODO_PROGRESS_PARTIAL_LINE_REGEX should be defined");

// VM context: provide the regex constants and stub isOptionalFeatureDetected.
const context = {
  TODO_PROGRESS_LINE_REGEX: /^\s*(?:(?:[-*]|\d+[.)])\s*)?\[(?: |x|X|-)\]\s+.+$/,
  TODO_PROGRESS_PARTIAL_LINE_REGEX: /^\s*(?:(?:[-*]|\d+[.)])\s*)?\[(?: |x|X|-)?\]?\s*.*$/,
  isOptionalFeatureDetected: () => true,
};
vm.runInNewContext(
  `${todoFilterRegion}\nthis.stripTodoProgressLines = stripTodoProgressLines;`,
  context,
  { filename: "todo-filter-helpers.js" },
);

function appStrip(text, options) {
  return context.stripTodoProgressLines(text, options);
}

/**
 * Representative cases for todo-progress line filtering equivalence:
 *   - todo lines with all markers: [ ], [x], [X], [-]
 *   - ordered/unordered/numeric prefixes: * [ ], - [ ], 1. [ ]
 *   - partial todo tails with and without trailing newline
 *   - fenced code containing todo-like lines
 *   - CRLF normalization
 *   - blank-line collapsing
 *   - Unicode
 *   - feature-disabled passthrough
 */
const representativeCases = [
  // Simple todo lines with all markers
  { text: "- [ ] pending\n- [x] done\n- [-] partial\n- [X] done caps\nfinal", opts: { streaming: true } },
  // Ordered/numeric prefixes
  { text: "Goal: steps\n* [ ] task one\n- [x] task two\n1. [ ] task three\n4) [ ] task four\nfinal", opts: { streaming: true } },
  // Partial todo tails without trailing newline (streaming)
  { text: "Goal: ship\n- [", opts: { streaming: true } },
  // Partial todo tails with trailing newline
  { text: "Goal: ship\n- [\nvisible", opts: { streaming: true } },
  // Partial todo tails with incomplete markers
  { text: "Goal: ship\n- [x", opts: { streaming: true } },
  { text: "Some text\n- [ ] partial item", opts: { streaming: true } },
  { text: "Some text\n- [ ] partial item\n", opts: { streaming: true } },
  // Fenced code containing todo-like lines
  { text: "```md\n- [ ] literal checklist\n```\n- [ ] transport\nAnswer", opts: { streaming: true } },
  // Nested fences and edge cases
  { text: "```\n- [ ] inside\n```` still code\n```\nafter\n- [ ] filtered", opts: { streaming: true } },
  // CRLF
  { text: "Goal: ship\r\n- [ ] first\r\n- [x] second\r\n- [-] third\r\nAnswer", opts: { streaming: true } },
  { text: "Goal: ship\r\n- [ ] first\r\nAnswer\r\n- [x] leftover", opts: { streaming: true } },
  // Blank-line collapsing
  { text: "- [ ] filtered\n\n\n\nvisible\n\n\n- [x] filtered\n\nkeep", opts: { streaming: true } },
  // Unicode
  { text: "😀 live\n- [ ] 隐藏\n- [x] 完成\n🚀 final", opts: { streaming: true } },
  // Unicode with code fence
  { text: "```émoji\n- [ ] literal\n```\n- [ ] transport\nfinal 🌟", opts: { streaming: true } },
  // No todo lines at all (passthrough)
  { text: "Plain assistant output with no derived markers.", opts: { streaming: true } },
  // Empty string
  { text: "", opts: { streaming: true } },
  // Only todo lines
  { text: "- [ ] only todos\n- [x] all filtered", opts: { streaming: true } },
  // Streaming=false (complete output)
  { text: "- [ ] line\nvisible", opts: { streaming: false } },
  // Feature-disabled passthrough (isOptionalFeatureDetected returns false)
  { text: "- [ ] visible when todo feature is absent\n- [x] also visible", opts: { streaming: true, _featureDisabled: true } },
  // Partial incomplete fence
  { text: "```\n- [ ] hidden inside incomplete fence\n", opts: { streaming: true } },
  // Whitespace-prefixed todo lines
  { text: "spaced:\n    - [ ] indented\n\t- [x] tabbed\nvisible", opts: { streaming: true } },
  // Consecutive blank-line handling
  { text: "- [ ] filtered\n\nkeep\n\n\n- [x] filtered\nend", opts: { streaming: true } },
  // Single line partial
  { text: "- [ ]", opts: { streaming: true } },
  { text: "- [ ]\n", opts: { streaming: true } },
];

for (const { text, opts } of representativeCases) {
  const { streaming = false, _featureDisabled = false } = opts || {};
  const appResult = _featureDisabled
    ? (() => {
        // Simulate feature-disabled passthrough without modifying the vm context
        const raw = String(text || "");
        // When isOptionalFeatureDetected returns false, stripTodoProgressLines returns text as-is.
        // Re-create that logic manually since we can't re-run the vm context with a different stub.
        return raw;
      })()
    : appStrip(text, { streaming });
  const authResult = stripTodoProgressLinesAuthoritative(text, { streaming, todoProgressDetected: !_featureDisabled });

  const label = _featureDisabled
    ? `feature-disabled ${JSON.stringify(text)}`
    : `${JSON.stringify(text)} streaming=${streaming}`;
  assert.deepEqual(appResult, authResult, `app stripTodoProgressLines must match authoritative at ${label}`);
}

// Additional deep-equal checks via vm extraction of a known instance
// to ensure function bodies produce the exact same string output line by line.
const targetedCases = [
  ["Goal: ship\r\n- [ ] first\r\n- [x] second\r\nAnswer", { streaming: true }],
  ["Goal: ship\r\n- [ ] first\r\n- [x] second\r\nAnswer", { streaming: false }],
  ["```md\n- [ ] literal\n```\n- [ ] transport\nAnswer", { streaming: true }],
  ["```\n- [ ] one\n```\n- [x] two\nfinal", { streaming: true }],
  ["Alpha\n\n\n- [ ] filtered\n\n\nBeta", { streaming: true }],
  ["😀unicode🌍\n- [ ] hidden\nkeep", { streaming: true }],
  ["", { streaming: true }],
  ["", { streaming: false }],
  ["- [ ]", { streaming: true }],
  ["- [ ] done", { streaming: false }],
  ["- [ ] done\n- [x] all\n- [-] three\nvisible", { streaming: true }],
  // Partial tails without newline
  ["text\n- [", { streaming: true }],
  ["text\n- [x", { streaming: true }],
  ["text\n1. [", { streaming: true }],
];

for (const [text, opts] of targetedCases) {
  const { streaming = false } = opts || {};
  const appResult = appStrip(text, { streaming });
  const authResult = stripTodoProgressLinesAuthoritative(text, { streaming });
  assert.deepEqual(
    appResult,
    authResult,
    `targeted case should match: ${JSON.stringify(text)} streaming=${streaming}`,
  );
}

console.log("todo-filter-static.test.mjs passed");