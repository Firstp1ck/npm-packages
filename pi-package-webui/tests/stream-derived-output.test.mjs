import assert from "node:assert/strict";
import {
  createStreamDerivedOutputState,
  deriveStreamOutputAuthoritative,
  splitThinkingFormatTextAuthoritative,
  stripTodoProgressLinesAuthoritative,
} from "../public/stream-derived-output.mjs";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertCurrent(state, rawText, options, label) {
  assert.deepEqual(
    plain(state.value()),
    plain(deriveStreamOutputAuthoritative(rawText, options)),
    label,
  );
}

function verifyEverySplit(rawText, options = {}) {
  for (let split = 0; split <= rawText.length; split += 1) {
    const state = createStreamDerivedOutputState({ ...options, shadow: true });
    const first = rawText.slice(0, split);
    const second = rawText.slice(split);
    state.append(first);
    assertCurrent(state, first, options, `prefix at code-unit split ${split}: ${JSON.stringify(rawText)}`);
    state.append(second);
    assertCurrent(state, rawText, options, `complete at code-unit split ${split}: ${JSON.stringify(rawText)}`);
    assert.equal(state.takeDiagnostics().shadowMismatch, false, `shadow parse should agree at split ${split}`);
  }

  const state = createStreamDerivedOutputState({ ...options, shadow: true });
  for (let index = 0; index < rawText.length; index += 1) {
    state.append(rawText.slice(index, index + 1));
    assertCurrent(state, rawText.slice(0, index + 1), options, `single-code-unit chunk ${index}: ${JSON.stringify(rawText)}`);
    assert.equal(state.takeDiagnostics().shadowMismatch, false, `shadow parse should agree after code unit ${index}`);
  }
}

assert.equal(
  stripTodoProgressLinesAuthoritative("Goal: ship\r\n- [ ] first\r\n- [x] second\r\nAnswer", { streaming: true }),
  "Goal: ship\nAnswer",
  "authoritative todo filtering should retain current CRLF normalization",
);
assert.equal(
  stripTodoProgressLinesAuthoritative("```md\n- [ ] literal\n```\n- [ ] transport\nAnswer", { streaming: true }),
  "```md\n- [ ] literal\n```\nAnswer",
  "todo-looking lines inside fences must stay visible",
);
assert.deepEqual(plain(splitThinkingFormatTextAuthoritative("<think>first</think><think>second</think>\nanswer", { streaming: true })), {
  hasThinkingFormat: true,
  thinkingText: "first\n\nsecond",
  finalText: "answer",
  complete: true,
});

const representativeCases = [
  "Plain assistant output with no derived markers.",
  "Goal: preserve semantics\r\n- [ ] pending\r\n1. [x] complete\r\nFinal answer 😀",
  "Before\n\n\n```md\r\n- [ ] literal checklist\r\n```\n\n\nAfter",
  "- [",
  "- [not a todo after all",
  "<th",
  "<think>reasoning</thi",
  "<think>reasoning</think>\r\nfinal answer",
  "<think data-kind=\"analysis\">reasoning</think   >\nfinal",
  "<think>The user mentioned `<think>example</think>` inside the reasoning.</think>\nfinal answer",
  "<think>first</think><think>second</think>\nanswer",
  "<think>first</think>  \r\n<think>second</think>\r\nanswer",
  "<think>first</think><th",
  "<|analysis>channel reasoning<analysis|>\nanswer",
  "<|analysis>one<analysis|><|reflection>two<reflection|>answer",
  "<|Analysis>Unicode 😀 e\u0301 漢字<ANALYSIS|>\r\nfinal 🚀",
  "<think>nested <think>inner</think> tail</think>\nanswer",
  "<think>partial close with spaces</thi   ",
  "<think>todo in thought\n- [ ] hidden</think>\n- [x] transport\nvisible",
];

for (const rawText of representativeCases) verifyEverySplit(rawText, { todoProgressDetected: true });
for (const rawText of representativeCases.slice(0, 6)) verifyEverySplit(rawText, { todoProgressDetected: false });

const suffixState = createStreamDerivedOutputState({ todoProgressDetected: true, shadow: false });
const longPrefix = "x".repeat(100_000);
suffixState.append(longPrefix);
assert.deepEqual(suffixState.takeDiagnostics(), {
  scannedCodeUnits: longPrefix.length,
  fallbackReason: "",
  shadowMismatch: false,
});
suffixState.append("y");
assert.deepEqual(suffixState.takeDiagnostics(), {
  scannedCodeUnits: 1,
  fallbackReason: "",
  shadowMismatch: false,
}, "a normal append should report only the newly scanned suffix");

suffixState.replace(`${longPrefix}snapshot`, { reason: "authoritative-snapshot" });
assert.deepEqual(suffixState.takeDiagnostics(), {
  scannedCodeUnits: longPrefix.length + "snapshot".length,
  fallbackReason: "authoritative-snapshot",
  shadowMismatch: false,
}, "snapshot replacement should expose its full authoritative fallback scan");

const divergenceState = createStreamDerivedOutputState({ shadow: true });
divergenceState.append("- ");
divergenceState.takeDiagnostics();
divergenceState.append("[");
const divergenceDiagnostic = divergenceState.takeDiagnostics();
assert.equal(divergenceDiagnostic.fallbackReason, "assistant-divergence", "retroactive partial-todo hiding should use an observable conservative fallback");
assert.equal(divergenceDiagnostic.shadowMismatch, false);
assertCurrent(divergenceState, "- [", {}, "fallback output should remain authoritative");

const modeState = createStreamDerivedOutputState({ todoProgressDetected: false });
modeState.append("- [ ] visible while todo transport is absent");
modeState.takeDiagnostics();
modeState.setTodoProgressDetected(true);
assert.equal(modeState.value().finalText, "");
assert.equal(modeState.takeDiagnostics().fallbackReason, "todo-mode-change", "todo capability changes should force an observable rebuild");

console.log("stream-derived-output.test.mjs passed");
