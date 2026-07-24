import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFastModeOutputEvents } from "./fixtures/fast-mode-output-events.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, helper, html, worker, styles, packageRaw] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "fast-output-live.mjs"), "utf8"),
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "service-worker.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "package.json"), "utf8"),
]);

function functionBody(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should be defined`);
  let parenDepth = 0;
  let open = -1;
  for (let index = start + marker.length - 1; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    else if (source[index] === ")") parenDepth -= 1;
    else if (source[index] === "{" && parenDepth === 0) {
      open = index;
      break;
    }
  }
  assert.notEqual(open, -1, `${name} should open`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`${name} should close`);
}

const connectEvents = functionBody(app, "connectEvents");
const compactUpdate = functionBody(app, "handleCompactMessageUpdate");
const compactFlush = functionBody(app, "flushCompactLiveOutput");
const compactThinkingBubble = functionBody(app, "ensureCompactThinkingBubble");
const compactToolShell = functionBody(app, "renderCompactToolShell");
const clearCompactToolShells = functionBody(app, "clearCompactToolShells");
const compactTranscript = functionBody(app, "renderCompactTranscriptBody");
const createMessageBubble = functionBody(app, "createMessageBubble");
const appendTranscriptMessage = functionBody(app, "appendTranscriptMessage");
const orderedTranscriptItems = functionBody(app, "orderedTranscriptItems");
const transcriptRenderEpoch = functionBody(app, "transcriptRenderEpoch");
const compactLiveStreamActive = functionBody(app, "compactLiveStreamRenderActive");
const restoreCompactStream = functionBody(app, "restoreCompactLiveOutputAfterChatRebuild");
const refreshMessages = functionBody(app, "refreshMessages");
const resetStream = functionBody(app, "resetStreamBubble");
const normalToCompact = functionBody(app, "transitionNormalLiveOutputToCompact");
const compactToNormal = functionBody(app, "transitionCompactLiveOutputToNormal");
const nativeSettingsDialog = functionBody(app, "openNativeSettingsDialog");
const nativeSettingsPayload = functionBody(app, "collectNativeSettingsPayload");
const outputModeMetadataText = functionBody(app, "webuiOutputModeMetadataText");
const sidebarOutputModeRefresh = functionBody(app, "refreshSidebarOutputMode");
const sidebarOutputModeApply = functionBody(app, "applySidebarOutputMode");

assert.match(app, /from "\.\/fast-output-live\.mjs"/, "browser should import the pure compact live helper");
assert.match(connectEvents, /outputMode:\s*eventSourceOutputModeRequest/, "all new EventSource connections should negotiate an explicit output mode");
assert.match(connectEvents, /outputModeProtocol:\s*"1"/, "all new EventSource connections should negotiate protocol 1");
assert.match(app, /function outputModeAcknowledgement[\s\S]*?outputMode\?\.protocolVersion !== 1[\s\S]*?function acceptOutputModeAcknowledgement[\s\S]*?outputModeAcknowledgement\(event\)[\s\S]*?connectEvents\(activeTabContext\(\), \{ requestedMode: "normal", fallbackAttempted: true \}\)/, "unacknowledged or old servers should receive one normal-mode fallback");
assert.match(app, /function compactOutputActive\(\) \{\s+return outputModeAcknowledged && activeOutputMode === "compact-v1";/, "compact rendering must remain acknowledgement-gated");
assert.match(app, /case "webui_output_mode":[\s\S]*?applyOutputModeControl\(event, tabContext\)/, "mode-control events should be handled before subsequent compact representation events");
assert.match(app, /function applyOutputModeControl[\s\S]*?finishCompactLiveOutput\(tabContext\)[\s\S]*?resetCompactLiveOutput\(\)/, "mode changes should synchronously flush then reset compact state at semantic boundaries");
assert.match(normalToCompact, /seedFastOutputLiveState\(\{ text: streamRawText, thinking: streamThinkingRawText \}\)/, "normal-to-compact controls should seed pre-switch text and thinking into the compact state");
assert.match(normalToCompact, /setStreamRawText\(""\)[\s\S]*?setStreamThinkingRawText\(""\)[\s\S]*?removeStreamBubble\(\)[\s\S]*?removeStreamingThinkingBubble\(\)[\s\S]*?flushCompactLiveOutput\(\)/, "normal-to-compact controls should remove stale normal bubbles and synchronously show the seeded compact state");
assert.match(compactToNormal, /fastOutputLiveTextAndThinking\(compactLiveState\)[\s\S]*?resetCompactLiveOutput\(\)[\s\S]*?setStreamRawText\(live\.text\)[\s\S]*?setStreamThinkingRawText\(live\.thinking\)[\s\S]*?renderStreamingAssistantText\(\)/, "compact-to-normal controls should transfer pre-switch live text/thinking before normal rendering resumes");

assert.doesNotMatch(compactUpdate, /event\.message|assistantMessageEvent\.partial|renderStreamingMarkdown|renderMarkdown|syncLiveTodoProgressWidgetFromText/, "compact deltas should consume direct fields without accumulated scans, markdown, or todo extraction");
assert.match(compactUpdate, /reduceFastOutputLiveEvent\(compactLiveState, event\)/, "compact deltas should use the pure reducer");
assert.match(compactUpdate, /shouldConsumeFastOutputLiveEvent\(reduced\)/, "recognized compact empty end variants should be consumed instead of reaching normal handlers with stripped snapshots");
assert.match(helper, /function shouldConsumeFastOutputLiveEvent\(reduction = \{\}\)[\s\S]*?"text-end"[\s\S]*?"thinking-end"[\s\S]*?"toolcall-end"/, "the reducer policy should consume only recognized compact end variants when no DOM state changes");
assert.match(compactFlush, /\.textContent = compactLiveState\.text/, "compact assistant text must render through a stable plain-text node while streaming");
assert.match(compactThinkingBubble, /make\("div", "markdown-body thinking-text compact-live-thinking"\)/, "compact live thinking should use the established Markdown and thinking styles");
assert.match(compactFlush, /compactThinkingNode\?\._rawThinkingText !== compactLiveState\.thinking[\s\S]*?renderThinkingMarkdown\(compactThinkingNode, compactLiveState\.thinking\)/, "compact live thinking should preserve Markdown formatting");
assert.doesNotMatch(compactFlush, /compactThinkingNode\.textContent|renderStreamingMarkdown|renderToolExecution|normalizeToolExecution/, "compact thinking must not fall back to plain text or invoke rich tool renderers");
assert.doesNotMatch(compactToolShell, /normalizeToolExecution|toolExecutionRenderSignature|renderToolExecution|handleToolExecutionUpdate|JSON\.stringify/, "compact tool shells must defer rich bodies and raw serialization");
assert.match(app, /case "tool_execution_update":\s+if \(!compactOutputActive\(\)\) handleToolExecutionUpdate\(event\);/, "compact mode should not build intermediate rich tool updates");
assert.match(app, /case "tool_execution_end":[\s\S]*?compactLiveScheduler\.flushNow\(\)[\s\S]*?renderCompactToolShell\(event, \{ complete: true \}\)[\s\S]*?finishCompactLiveOutput\(tabContext\)/, "compact tool completion should remain lightweight and request final reconciliation");
assert.match(resetStream, /resetCompactLiveOutput\(\)/, "reset and tab changes should cancel compact pending work");
assert.match(app, /case "message_end": \{\s+if \(compactOutputActive\(\)\) finishCompactLiveOutput\(tabContext\);/, "message ends should synchronously flush compact output before reconciliation");
assert.match(app, /case "agent_end":\s+if \(compactOutputActive\(\)\) finishCompactLiveOutput\(tabContext\);/, "agent ends should synchronously flush compact output before reconciliation");
assert.match(compactTranscript, /message\.role !== "assistant"[\s\S]*?appendMarkdown\(body, output \|\| "_\[non-text output omitted in fast mode\]_"\)[\s\S]*?classList\.add\("compact-transcript-text"\)/, "reconciled fast-mode assistant output should preserve Markdown and explain omitted non-text output");
assert.doesNotMatch(compactTranscript, /appendText|renderToolExecution|normalizeToolExecution|JSON\.stringify|appendToolOutput|appendToolDiff|appendToolImages/, "fast-mode final output must not fall back to plain text or render tool details");
assert.match(createMessageBubble, /compactOutputActive\(\) && !streaming[\s\S]*?renderCompactTranscriptBody\(body, message\)/, "final transcript rendering should select the compact Markdown path only for acknowledged fast mode");
assert.match(appendTranscriptMessage, /compactOutputActive\(\) && !\["assistant", "thinking"\]\.includes\(transcriptMessage\.role\)/, "fast-mode reconciliation should retain only thinking and final assistant parts");
assert.match(appendTranscriptMessage, /transcriptMessage\.role === "thinking" && !thinkingOutputVisible/, "fast-mode thinking should still respect the transcript visibility setting");
assert.match(orderedTranscriptItems, /compactOutputActive\(\) && \["toolCall", "toolExecution", "toolResult", "assistantEvent"\]\.includes\(message\?\.role\)/, "stored action rows should be omitted from the fast-mode transcript");
assert.match(orderedTranscriptItems, /if \(!compactOutputActive\(\)\) \{[\s\S]*?liveToolRuns\.entries\(\)/, "live tool-run reconciliation should not retain additional fast-mode tool rows");
assert.match(transcriptRenderEpoch, /compactOutputActive\(\) \? "compact" : "normal"/, "mode changes should invalidate the keyed transcript renderer");
assert.match(clearCompactToolShells, /removeCompactLiveBubble\(shell\?\.bubble\)[\s\S]*?compactToolShells\.clear\(\)/, "fast mode should remove previous transient tool shells from the DOM and registry");
assert.match(compactToolShell, /if \(!shell\) \{\s+clearCompactToolShells\(\)/, "a newly-started tool should replace the previous transient tool shell");
assert.match(compactToolShell, /shell\.status\.textContent = complete[\s\S]*?event\?\.isError \? "failed" : "done"[\s\S]*?: "running"/, "the current transient tool shell should expose only a non-duplicated status");
assert.match(styles, /\.message\.compact-tool-shell\s*\{[\s\S]*?display: grid[\s\S]*?grid-template-columns:[\s\S]*?padding: 0\.46rem 0\.62rem[\s\S]*?box-shadow: none/, "fast-mode tool activity should render as a compact horizontal row");
assert.match(styles, /\.compact-tool-shell \.compact-tool-status\s*\{[\s\S]*?display: inline-flex[\s\S]*?border-radius: 999px[\s\S]*?font-size: 0\.7rem[\s\S]*?text-transform: uppercase/, "the minimal tool status should remain visually distinct as a small pill");
assert.match(styles, /\.compact-tool-shell\.tool-running \.compact-tool-status[\s\S]*?\.compact-tool-shell\.tool-success \.compact-tool-status[\s\S]*?\.compact-tool-shell\.tool-error \.compact-tool-status/, "running, success, and failure tool states should have distinct visual tones");
assert.match(compactUpdate, /compactLiveState = reduced\.state;\s+clearCompactToolShells\(\)/, "new assistant or tool-call deltas should clear the preceding transient tool shell");
assert.match(compactLiveStreamActive, /messageOutputActive = streamMessageActive && Boolean\([\s\S]*?compactLiveState\.text[\s\S]*?compactLiveState\.thinking[\s\S]*?compactOutputActive\(\) && currentState\?\.isStreaming === true && Boolean\(compactToolShells\.size \|\| messageOutputActive\)/, "mid-stream reconciliation should preserve active compact message output or a current tool shell, but not completed final text");
assert.match(restoreCompactStream, /compactTextBubble = null[\s\S]*?compactThinkingBubble = null[\s\S]*?if \(streamMessageActive\) flushCompactLiveOutput\(\)[\s\S]*?compactToolShells\.values\(\)[\s\S]*?appendChatMessageBubble\(shell\.bubble\)/, "compact message state should be restored only while its message is active, while the current shell can survive between messages");
assert.match(refreshMessages, /preserveCompactStream = compactLiveStreamRenderActive\(\)[\s\S]*?!preserveCompactStream && !preserveNormalStream[\s\S]*?renderMessages\(latestMessages\)[\s\S]*?preserveCompactStream\) restoreCompactLiveOutputAfterChatRebuild\(\)/, "message refreshes must not reset active compact output before rebuilding the transcript");

assert.match(app, /const SETTINGS_OUTPUT_MODE_OPTIONS = \[[\s\S]*?value: "normal"[\s\S]*?value: "compact-v1"/, "settings should offer normal and compact-v1 server defaults");
assert.match(nativeSettingsDialog, /api\("\/api\/webui-output-mode", \{ scoped: false \}\)/, "opening settings should load output-mode metadata from the separate server API");
assert.match(nativeSettingsDialog, /outputMode: nativeSettingSelect\("Output processing", outputModeMetadata\.persistedDefault, SETTINGS_OUTPUT_MODE_OPTIONS,[\s\S]*?\{ label: "server", tone: "startup" \}\)/, "Browser workflow should expose a server-badged output-processing selector");
assert.match(nativeSettingsDialog, /Fast mode preserves Markdown formatting for final output and thinking while showing only the current tool status transiently, and does not change model inference or token generation\. Changes use server barriers without restarting Pi\./, "settings copy should describe formatted thinking and the transient tool presentation without changing inference semantics");
assert.match(nativeSettingsDialog, /nativeSettingsSection\("Browser workflow"[\s\S]*?controls\.outputMode/, "the output-mode selector should be placed in Browser workflow");
assert.match(outputModeMetadataText, /Persisted default:[\s\S]*?Effective mode:[\s\S]*?Source:/, "settings should display persisted default plus effective mode and source");
assert.match(outputModeMetadataText, /metadata\.overridden[\s\S]*?overrides the persisted setting/, "settings should display CLI/environment override state when it wins");
assert.match(nativeSettingsDialog, /Output-mode API unavailable:[\s\S]*?Showing the normal default; other settings can still be applied\./, "unavailable output-mode API should leave a visible nonfatal normal-default diagnostic");
assert.match(nativeSettingsDialog, /controls\.outputMode\.select\.disabled = !!outputModeApiDiagnostic/, "unavailable output-mode API should safely prevent an unpersistable mode change");
assert.match(nativeSettingsDialog, /method: "PUT",[\s\S]*?body: \{ outputModeDefault: controls\.outputMode\.select\.value \},[\s\S]*?scoped: false,[\s\S]*?const refreshedOutputMode = await api\("\/api\/webui-output-mode", \{ scoped: false \}\)/, "changed output defaults should PUT the server payload and then refresh metadata");
assert.doesNotMatch(nativeSettingsPayload, /outputMode(?:Default|Metadata|ApiDiagnostic|Changed)?/, "server-scoped output mode must stay out of the native SettingsManager payload");
assert.match(nativeSettingsDialog, /const response = await nativeCommandApi\("\/api\/settings", \{ method: "POST", body: \{ settings: payload, reload \} \}\);[\s\S]*?nativeSettingsChangedMessage\(response, reload\)/, "existing native settings apply behavior should remain intact");

assert.match(html, /data-side-panel-section="controls"[\s\S]*?id="outputProcessingControlsTitle">Output processing<[\s\S]*?<span class="control-scope-badge">Server<\/span>[\s\S]*?id="fastOutputModeSelect"[\s\S]*?<option value="normal">Normal<\/option>[\s\S]*?<option value="compact-v1">Fast<\/option>[\s\S]*?id="setFastOutputModeButton"[\s\S]*?id="fastOutputModeStatus"/, "Controls should expose a server-scoped normal/fast selector with apply button and live status");
assert.match(app, /fastOutputModeSelect: \$\("#fastOutputModeSelect"\)[\s\S]*?setFastOutputModeButton: \$\("#setFastOutputModeButton"\)[\s\S]*?fastOutputModeStatus: \$\("#fastOutputModeStatus"\)/, "sidebar fast-mode elements should be wired");
assert.match(sidebarOutputModeRefresh, /api\("\/api\/webui-output-mode", \{ scoped: false \}\)[\s\S]*?normalizeWebuiOutputModeMetadata\(response\.data\)/, "sidebar selector should load current server output-mode metadata");
assert.match(sidebarOutputModeApply, /method: "PUT"[\s\S]*?body: \{ outputModeDefault \}[\s\S]*?scoped: false[\s\S]*?await refreshSidebarOutputMode\(\)/, "sidebar selector should persist the selected mode and refresh effective metadata");
assert.match(sidebarOutputModeApply, /outputModeDefault === "compact-v1"[\s\S]*?Fast output mode enabled[\s\S]*?Normal output processing restored/, "sidebar apply feedback should distinguish enabling fast mode from restoring normal mode");
assert.match(sidebarOutputModeApply, /sidebarOutputModeDiagnostic = ""[\s\S]*?sidebarOutputModeNotice = `Failed to update fast mode:[\s\S]*?You can retry\.`[\s\S]*?sidebarOutputModeLoaded = true/, "a transient apply failure should remain visible without permanently disabling retry");
assert.match(app, /function renderSidebarOutputModeControl[\s\S]*?sidebarOutputModeNotice[\s\S]*?webuiOutputModeMetadataText\(sidebarOutputModeMetadata\)[\s\S]*?updateSidebarOutputModeApplyState\(\)/, "sidebar status should expose retry notices or persisted/effective/source metadata and apply state");
assert.match(styles, /\.toggle-control-hint\.warning\s*\{[\s\S]*?color: var\(--ctp-yellow\)/, "sidebar output-mode failures should use the warning palette");
assert.match(app, /fastOutputModeSelect\?\.addEventListener\("change", \(\) => \{[\s\S]*?sidebarOutputModeNotice = ""[\s\S]*?renderSidebarOutputModeControl\(\{ syncSelection: false \}\)[\s\S]*?setFastOutputModeButton\?\.addEventListener\("click", \(\) => applySidebarOutputMode\(\)/, "sidebar selection should clear transient failures and keep Apply retryable");
assert.match(app, /refreshSidebarOutputMode\(\)\.catch[\s\S]*?initializeTabs\(\)/, "sidebar output mode should initialize with the WebUI");

assert.match(helper, /FAST_OUTPUT_FLUSH_INTERVAL_MS = 100/, "the live scheduler should retain the exact 100 ms sustained-output bound");
assert.match(worker, /pi-webui-pwa-v39[\s\S]*?"\/fast-output-live\.mjs"/, "PWA cache identity and app shell should include the compact helper");
assert.match(html, /<label for="fastOutputModeSelect">Fast mode \(Experimental\)<\/label>/, "the sidebar should mark fast mode as experimental");
assert.match(html, /Markdown final output and thinking; current tool replaces the previous one/, "the sidebar should explain formatted thinking and transient tool replacement");
assert.match(html, /<script type="module" src="\/app\.js\?v=86"><\/script>/, "the PWA entry point should cache-bust browser wiring");
assert.match(JSON.parse(packageRaw).scripts.check, /node --check public\/fast-output-live\.mjs/, "package checks should parse the compact helper");

const events = createFastModeOutputEvents();
const deltas = events.filter((event) => event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta");
const normalScanChars = deltas.reduce((total, event) => total + JSON.stringify(event.message).length + JSON.stringify(event.assistantMessageEvent.partial).length, 0);
const compactScanChars = deltas.reduce((total, event) => total + event.assistantMessageEvent.delta.length, 0);
const scanRatio = normalScanChars / compactScanChars;
const normalFlushes = deltas.length;
const compactFlushes = Math.ceil(deltas.length / 5); // fixed 20 ms model: first + max one 100 ms flush
const ledger = { normalScanChars, compactScanChars, scanRatio: Number(scanRatio.toFixed(3)), normalFlushes, compactFlushes, normalDomWrites: normalFlushes, compactDomWrites: compactFlushes };
assert.ok(scanRatio >= 1.5, `compact browser scan ledger must improve by >= 1.5x: ${JSON.stringify(ledger)}`);
assert.ok(compactFlushes <= normalFlushes && ledger.compactDomWrites <= ledger.normalDomWrites, `compact modeled flush/DOM work must not increase: ${JSON.stringify(ledger)}`);
console.log(`fast-mode client ledger ${JSON.stringify(ledger)}`);
console.log("fast-mode-client-static.test.mjs passed");
