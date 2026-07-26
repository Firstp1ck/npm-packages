import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

const SELF_CONTAINED_THEORY_TITLES = new Map([
  [0, "Live todo-progress widget rebuild"],
  [1, "scrollChatToBottom"],
  [2, "O(n²) re-parse"],
  [3, "markdown re-render fallback"],
  [4, "setRunIndicatorActivity"],
  [5, "ingestEventTabActivity"],
  [6, "markTabOutputSeen"],
  [7, "Skill / auto-retry tracking"],
  [8, "steer prompt"],
]);

function findFunctionBody(source, name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`, "m");
  const match = signature.exec(source);
  assert.ok(match, `${name} should be defined`);
  let parenDepth = 0;
  let openBrace = -1;
  for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === "{" && parenDepth === 0) {
      openBrace = index;
      break;
    }
  }
  assert.notEqual(openBrace, -1, `${name} body should open`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }
  assert.fail(`${name} body should close`);
}

function findCaseBody(source, caseLabel) {
  const caseStart = source.indexOf(`case "${caseLabel}":`);
  assert.notEqual(caseStart, -1, `case ${caseLabel} should exist`);
  const nextCase = source.indexOf("\n    case ", caseStart + 1);
  const defaultCase = source.indexOf("\n    default:", caseStart + 1);
  const candidates = [nextCase, defaultCase].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(caseStart, end);
}

function assertDocTheory(id, titleFragment) {
  const title = SELF_CONTAINED_THEORY_TITLES.get(id);
  assert.ok(title, `self-contained theory ${id} should be listed`);
  assert.match(title, new RegExp(titleFragment), `self-contained theory ${id} should include: ${titleFragment}`);
}

const futureFailures = [];
function futureInvariant(name, assertion) {
  try {
    assertion();
  } catch (error) {
    futureFailures.push(`${name}\n  ${error.message}`);
  }
}

// Keep the test suite explicitly tied to the audit theories it enforces.
assertDocTheory(0, "Live todo-progress widget rebuild");
assertDocTheory(1, "scrollChatToBottom");
assertDocTheory(2, "O\\(n²\\) re-parse");
assertDocTheory(3, "markdown re-render fallback");
assertDocTheory(4, "setRunIndicatorActivity");
assertDocTheory(5, "ingestEventTabActivity");
assertDocTheory(6, "markTabOutputSeen");
assertDocTheory(7, "Skill / auto-retry tracking");
assertDocTheory(8, "steer prompt");

const syncLiveTodoProgressWidgetFromText = findFunctionBody(app, "syncLiveTodoProgressWidgetFromText");
const scheduleLiveWidgetRender = findFunctionBody(app, "scheduleLiveWidgetRender");
const handleMessageUpdate = findFunctionBody(app, "handleMessageUpdate");
const scrollChatToBottom = findFunctionBody(app, "scrollChatToBottom");
const stripTodoProgressLines = findFunctionBody(app, "stripTodoProgressLines");
const liveTodoProgressWidgetLinesFromText = findFunctionBody(app, "liveTodoProgressWidgetLinesFromText");
const syncStreamingThinkingFormat = findFunctionBody(app, "syncStreamingThinkingFormat");
const renderStreamingAssistantText = findFunctionBody(app, "renderStreamingAssistantText");
const renderStreamingMarkdown = findFunctionBody(app, "renderStreamingMarkdown");
const setRunIndicatorActivity = findFunctionBody(app, "setRunIndicatorActivity");
const ingestEventTabActivity = findFunctionBody(app, "ingestEventTabActivity");
const handleEvent = findFunctionBody(app, "handleEvent");
const markTabOutputSeen = findFunctionBody(app, "markTabOutputSeen");
const trackSkillsFromEvent = findFunctionBody(app, "trackSkillsFromEvent");
const trackAutoRetryStateFromEvent = findFunctionBody(app, "trackAutoRetryStateFromEvent");
const requestGitFooterWebuiPayload = findFunctionBody(app, "requestGitFooterWebuiPayload");

// Fixed theory #0 should stay fixed while the remaining tests fail until their
// corresponding stream/UI coupling issues are removed.
assert.doesNotMatch(
  syncLiveTodoProgressWidgetFromText,
  /(^|\n)\s*updateOptionalFeatureAvailability\s*\(/,
  "fixed theory #0: live todo-progress sync must not reconcile optional-feature chrome per token",
);
assert.match(syncLiveTodoProgressWidgetFromText, /scheduleLiveWidgetRender\s*\(/, "fixed theory #0: live todo-progress widget rendering should remain scheduler-based");
assert.match(scheduleLiveWidgetRender, /requestAnimationFrame\s*\(/, "fixed theory #0: live widget rebuilds should remain coalesced to animation frames");
assert.match(scheduleLiveWidgetRender, /liveWidgetRenderFrame !== null/, "fixed theory #0: repeated tokens in one frame should not queue duplicate widget rebuilds");
assert.match(
  stripTodoProgressLines,
  /isOptionalFeatureDetected\("todoProgressWidget"\)/,
  "todo-progress transport lines should remain hidden when only the optional widget renderer is disabled",
);
assert.doesNotMatch(
  stripTodoProgressLines,
  /isOptionalFeatureEnabled\("todoProgressWidget"\)/,
  "todo-progress output filtering must not depend on the widget renderer toggle",
);
assert.match(
  liveTodoProgressWidgetLinesFromText,
  /isOptionalFeatureEnabled\("todoProgressWidget"\)/,
  "disabling todo-progress should still suppress the optional widget renderer itself",
);

futureInvariant("theory #1: message_update streaming hot path must not call immediate scroll/layout work", () => {
  assert.doesNotMatch(handleMessageUpdate, /scrollChatToBottom\s*\(/, "handleMessageUpdate should schedule/coalesce follow-scroll instead of calling scrollChatToBottom() directly");
});
futureInvariant("theory #1: scrollChatToBottom must not synchronously read scrollHeight and write scrollTop", () => {
  assert.doesNotMatch(scrollChatToBottom, /setChatScrollTopInstant\(elements\.chat\.scrollHeight\)/, "scrollChatToBottom should route layout-sensitive scroll work through a frame-coalesced flusher");
});
futureInvariant("theory #1: disabled auto-follow must not refresh jump/sticky layout from the token path", () => {
  assert.doesNotMatch(scrollChatToBottom, /!autoFollowChat[\s\S]*?updateJumpToLatestButton\(\)[\s\S]*?updateStickyUserPromptButton\(\)/, "jump/sticky button layout reads should be debounced or frame-coalesced, not run per token");
});

futureInvariant("theory #2: text deltas must not re-read the full accumulated assistant message", () => {
  assert.doesNotMatch(handleMessageUpdate, /assistantTextFromMessage\(assistantStreamingMessage\(event\), \{ streaming: true \}\)/, "text_delta should process only the new delta tail or a cached parse state");
});
futureInvariant("theory #2: thinking deltas must not re-read the full accumulated assistant message", () => {
  assert.doesNotMatch(handleMessageUpdate, /assistantThinkingTextFromMessage\(assistantStreamingMessage\(event\), \{ streaming: true \}\)/, "thinking_delta should process only the new delta tail or a cached parse state");
});
futureInvariant("theory #2: streaming todo stripping must not split the full accumulated stream each render", () => {
  assert.doesNotMatch(stripTodoProgressLines, /raw\.split\(\/\\r\?\\n\//, "stripTodoProgressLines should be incremental/cached for streaming input");
});
futureInvariant("theory #2: live todo widget extraction must not split the full accumulated stream each token", () => {
  assert.doesNotMatch(liveTodoProgressWidgetLinesFromText, /raw\.split\(\/\\r\?\\n\//, "liveTodoProgressWidgetLinesFromText should process the new tail or cached block state");
});
futureInvariant("theory #2: thinking-format parsing must not reparse the full accumulated assistant text", () => {
  assert.doesNotMatch(syncStreamingThinkingFormat, /splitThinkingFormatText\(assistantText, \{ streaming: true \}\)/, "syncStreamingThinkingFormat should use incremental/cached parsing while streaming");
});
futureInvariant("theory #2: streaming assistant render must not derive all views from streamRawText on every render", () => {
  assert.doesNotMatch(renderStreamingAssistantText, /stripTodoProgressLines\(streamRawText, \{ streaming: true \}\)/, "renderStreamingAssistantText should consume cached/incremental visible-text state instead of rescanning streamRawText");
});

futureInvariant("theory #3: streaming markdown must not full-rebuild when earlier derived text changes", () => {
  assert.doesNotMatch(renderStreamingMarkdown, /!text\.startsWith\(state\.stableText\)[\s\S]*?block\.replaceChildren\(\)/, "retroactive todo/thinking rewrites should be confined to an unstable tail, not block.replaceChildren()");
});

futureInvariant("theory #4: run-indicator activity changes must not render/scroll synchronously from token paths", () => {
  assert.doesNotMatch(setRunIndicatorActivity, /if \(needsRender\) renderRunIndicator\(\{ scroll \}\)/, "setRunIndicatorActivity should schedule/coalesce indicator rendering instead of rendering immediately");
});
futureInvariant("theory #4: run-indicator token updates must not touch composer chrome unconditionally", () => {
  assert.doesNotMatch(setRunIndicatorActivity, /updateComposerModeButtons\(\)/, "composer mode button reconciliation should be gated/coalesced outside steady-state token updates");
});

futureInvariant("theory #5: tab activity ingestion must not rebuild tabs synchronously per event", () => {
  assert.doesNotMatch(ingestEventTabActivity, /if \(changed\) renderTabs\(\)/, "tab chrome should be updated via a frame-coalesced affected-tab render, not renderTabs() directly");
});
futureInvariant("theory #5: handleEvent must not run tab chrome ingestion for every raw server event", () => {
  assert.doesNotMatch(handleEvent, /^\s*ingestEventTabActivity\(event\);/m, "tab activity ingestion should be filtered/coalesced before global event dispatch touches chrome");
});

futureInvariant("theory #6: output-seen tab refresh should remain out of the message_update token path", () => {
  assert.doesNotMatch(handleMessageUpdate, /markTabOutputSeen\s*\(/, "markTabOutputSeen should stay event-end driven, not token driven");
});
futureInvariant("theory #6: event-end output-seen refresh should not synchronously rebuild all tabs", () => {
  assert.doesNotMatch(markTabOutputSeen, /renderTabs\(\)/, "output-seen serial changes should schedule/coalesce tab chrome updates");
});
assert.match(findCaseBody(handleEvent, "agent_end"), /markTabOutputSeen\(\)/, "theory #6: output-seen marking should still happen when a run ends");
assert.match(findCaseBody(handleEvent, "compaction_end"), /markTabOutputSeen\(\)/, "theory #6: output-seen marking should still happen when compaction ends");

futureInvariant("theory #7: skill tracking must not inspect every message_update event", () => {
  assert.doesNotMatch(trackSkillsFromEvent, /event\.type === "message_update"/, "skill tracking should be event-filtered so plain text/thinking deltas do not enter tracking code");
});
futureInvariant("theory #7: auto-retry and skill tracking must not run before every event dispatch", () => {
  assert.doesNotMatch(handleEvent, /^\s*trackAutoRetryStateFromEvent\(event\);\n\s*trackSkillsFromEvent\(event\);/m, "tracking hooks should be case-specific or pre-filtered, not invoked for every server event");
});
assert.match(trackAutoRetryStateFromEvent, /event\.type === "auto_retry_start"/, "theory #7: auto-retry bookkeeping should remain scoped to retry events");

// Theory #8 is a correctness guard: the current design still uses a steer prompt,
// but it must never run while the agent is active.
assert.match(requestGitFooterWebuiPayload, /currentState\?\.isStreaming \|\| currentState\?\.isCompacting/, "theory #8: git-footer steer refresh must remain guarded during active streaming/compaction");
assert.match(findCaseBody(handleEvent, "agent_end"), /currentState\) currentState = \{ \.\.\.currentState, isStreaming: false \};[\s\S]*?requestGitFooterWebuiPayload\(tabContext, \{ force: true \}\)/, "theory #8: forced git-footer refresh should only happen after agent_end clears streaming state");

if (futureFailures.length) {
  assert.fail(`streaming/UI coupling invariants still failing (${futureFailures.length}):\n\n${futureFailures.map((failure, index) => `${index + 1}. ${failure}`).join("\n\n")}`);
}

console.log("streaming-ui-coupling.test.mjs passed");
