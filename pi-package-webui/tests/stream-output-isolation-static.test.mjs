import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
const controller = await readFile(join(root, "public", "stream-output-controller.mjs"), "utf8");

function functionBody(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `${name} should be defined`);
  let parens = 0;
  let open = -1;
  for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
    if (source[index] === "(") parens += 1;
    else if (source[index] === ")") parens -= 1;
    else if (source[index] === "{" && parens === 0) {
      open = index;
      break;
    }
  }
  assert.notEqual(open, -1, `${name} should open`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`${name} should close`);
}

const forbiddenSinks = [
  "renderWidgets", "renderFooter", "renderTabs", "renderStatus",
  "renderWorkspaceDashboard", "renderContextMeter", "renderFeedbackTray",
  "scheduleRefreshState", "scheduleRefreshFooter", "requestGitFooterWebuiPayload",
  "trackSkillsFromEvent", "addEvent", "scheduleComposerModeButtons",
  ".focus(", "scrollIntoView", "fetch(", "api(",
];

assert.match(app, /import \{[^}]*classifyTranscriptStreamEvent[^}]*createStreamOutputController[^}]*\} from "\.\/stream-output-controller\.mjs";/);
assert.match(controller, /export function classifyTranscriptStreamEvent/);
assert.match(controller, /export function createStreamOutputController/);
assert.match(controller, /let frameHandle = null;[\s\S]*?let pending = \[\];[\s\S]*?let pendingBytes = 0;/, "controller should retain one cancellable bounded queue");
assert.match(controller, /if \(classification\.barrier\) \{[\s\S]*?flush\(\);/, "recognized raw end/error barriers should flush synchronously");
assert.match(controller, /COALESCIBLE_DELTA_TYPES[\s\S]*?function mergedAdjacentEntry[\s\S]*?previousKey !== entryCoalesceKey\(incoming\)/, "adjacent compatible stream deltas should coalesce before rendering");
assert.match(controller, /pending\.length >= entryLimit|pendingBytes \+ entry\.bytes > byteLimit/, "pending count and bytes should have explicit bounds");
assert.match(controller, /reason: "oversize-event"[\s\S]*?applyOversize\(entry\)/, "single oversize events should be applied directly rather than dropped");
assert.match(controller, /if \(!ownerIsCurrent\(owner\)\)[\s\S]*?reportStale/, "stale owners should fail closed");

for (const sink of forbiddenSinks) {
  assert.equal(controller.includes(sink), false, `dependency-free controller must not reference forbidden sink ${sink}`);
}

const dispatch = functionBody(app, "dispatchTranscriptStreamEvent");
const rawMessageHandler = functionBody(app, "handleMessageUpdate");
const handleEvent = functionBody(app, "handleEvent");
const toolUpdate = functionBody(app, "applyTranscriptToolExecutionUpdate");
const dispatchIndex = handleEvent.indexOf("dispatchTranscriptStreamEvent(event)");
const tabActivityIndex = handleEvent.indexOf("ingestEventTabActivity(event)");
const skillTrackingIndex = handleEvent.indexOf("trackSkillsFromEvent(event)");
assert.ok(dispatchIndex >= 0 && dispatchIndex < tabActivityIndex && dispatchIndex < skillTrackingIndex, "raw dispatch must run before global tab/activity/skill processing");
assert.match(handleEvent, /if \(dispatchTranscriptStreamEvent\(event\)\) return;/, "consumed raw events must bypass the lifecycle switch");
assert.match(dispatch, /streamOutputController\.dispatch\(event,[\s\S]*?owner: transcriptStreamOwner/, "dispatch should bind updates to the current tab generation owner");

for (const sink of forbiddenSinks) {
  assert.equal(dispatch.includes(sink), false, `raw dispatch seam must not reach forbidden sink ${sink}`);
  assert.equal(rawMessageHandler.includes(sink), false, `message-update transcript sink must not reach forbidden sink ${sink}`);
}
assert.doesNotMatch(rawMessageHandler, /setRunIndicatorActivity|scheduleLiveTodoProgressWidgetSync|scheduleStreamingAssistantTextRender|scheduleChatFollowScroll/, "raw message deltas must bypass composer activity, widgets, and parallel schedulers");
assert.match(rawMessageHandler, /compactOutputActive\(\) && handleCompactMessageUpdate\(event\)/, "normal and compact modes should share the isolated controller sink");
assert.match(toolUpdate, /renderLiveToolRun\(run, \{ scroll: false \}\)/, "isolated tool updates should render in the controller frame rather than queue another tool frame");
assert.doesNotMatch(toolUpdate, /scheduleLiveToolRunRender/, "isolated tool updates must not create a parallel render queue");
assert.match(app, /applyToolExecutionUpdate: \(event\) => \{\s+if \(!compactOutputActive\(\) && !isIntercomTransportToolName\(event\?\.toolName\)\) applyTranscriptToolExecutionUpdate\(event\);/, "raw non-Intercom tool execution updates should use only the transcript sink");
assert.doesNotMatch(app.slice(app.indexOf("const streamOutputController"), app.indexOf("let assistantErrorSurfacedThisRun")), /renderWidgets|renderFooter|renderTabs|renderStatus|renderFeedbackTray|setRunIndicatorActivity|scheduleLiveTodoProgressWidgetSync|addEvent|fetch\(|api\(/, "controller integration must inject transcript-only sinks");
const connectEvents = functionBody(app, "connectEvents");
assert.match(connectEvents, /streamOutputController\.cancel\(\);[\s\S]*?resetCompactLiveOutput\(\);/, "reconnect and tab switches should cancel retained raw frames before resetting live output");
assert.match(connectEvents, /source\.onerror = \(\) => \{[\s\S]*?streamOutputController\.flush\(\);[\s\S]*?streamOutputController\.cancel\(\);/, "an actual EventSource disconnect must flush and cancel retained transcript work before browser retry");
const barrier = functionBody(app, "flushTranscriptStreamBarrier");
const abort = functionBody(app, "abortActiveRun");
assert.match(barrier, /streamOutputController\.barrier\(event\.type\)/, "semantic lifecycle boundaries should flush raw output first");
assert.match(app, /"auto_retry_start",\s+"auto_retry_end",/, "retry start/end should be explicit stream barriers");
assert.ok(abort.indexOf('streamOutputController.barrier("user-abort")') < abort.indexOf("abortRequestInFlight = true"), "accepted user abort must flush transcript output before chrome/RPC transitions");
assert.doesNotMatch(handleEvent, /case "message_update"|case "tool_execution_update"/, "raw event switch cases consumed by the controller must be removed");
assert.doesNotMatch(app, /function scheduleStreamingAssistantTextRender|function handleToolExecutionUpdate|scheduleLiveToolRunRender/, "superseded raw render schedulers must be removed");
assert.match(app, /onUnknownStreamEvent: preserveUnknownTranscriptEvidence/, "unknown transcript-shaped events should retain transcript-only evidence");
assert.match(app, /reconcileUnknownTranscriptEvidenceAtBarrier\(event\)/, "unknown evidence should request authoritative reconciliation only at a semantic barrier");
assert.match(app, /streamIsolationDebug[\s\S]*?__piStreamIsolationDebug/, "the opt-in test diagnostic ledger should be exposed only behind the explicit debug flag");

console.log("stream-output-isolation-static.test.mjs passed");
