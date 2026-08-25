import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LIMITS, PROTOCOL_VERSION, REQUEST_TYPES } from "../lib/backend/protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const qmlRoot = path.join(root, "qml");

async function readQml(relative) {
  return readFile(path.join(qmlRoot, relative), "utf8");
}

const [shell, bridge, theme, smoke, composer, row, blocks, toolCard, searchBar, emptyState, appButton, statusBadge, noticeBar, appDialog, extensionDialog, linkDialog, fixture] = await Promise.all([
  readQml("shell.qml"),
  readQml("BackendBridge.qml"),
  readQml("Theme.qml"),
  readQml("SmokeDriver.qml"),
  readQml(path.join("components", "Composer.qml")),
  readQml(path.join("components", "TranscriptRow.qml")),
  readQml(path.join("components", "MarkdownBlocks.qml")),
  readQml(path.join("components", "ToolCard.qml")),
  readQml(path.join("components", "SearchBar.qml")),
  readQml(path.join("components", "EmptyState.qml")),
  readQml(path.join("components", "AppButton.qml")),
  readQml(path.join("components", "StatusBadge.qml")),
  readQml(path.join("components", "NoticeBar.qml")),
  readQml(path.join("dialogs", "AppDialog.qml")),
  readQml(path.join("dialogs", "ExtensionDialog.qml")),
  readQml(path.join("dialogs", "LinkDialog.qml")),
  readFile(path.join(root, "tests", "fixtures", "fake-pi-rpc.mjs"), "utf8"),
]);

const [workingIndicator, statusSegment, pickerDialog] = await Promise.all([readQml(path.join("components", "WorkingIndicator.qml")), readQml(path.join("components", "StatusSegment.qml")), readQml(path.join("dialogs", "PickerDialog.qml"))]);
const components = { shell, composer, row, blocks, toolCard, searchBar, emptyState, appButton, statusBadge, noticeBar, appDialog, extensionDialog, linkDialog, workingIndicator, statusSegment, pickerDialog };

function balancedBody(source, open, description) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`${description} should have a balanced body`);
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  return balancedBody(source, source.indexOf("{", start), name);
}

function objectBodyContaining(source, objectType, needle) {
  for (const match of source.matchAll(new RegExp(`\\b${objectType}\\s*\\{`, "g"))) {
    const body = balancedBody(source, source.indexOf("{", match.index), `${objectType} containing ${needle}`);
    if (body.includes(needle)) return body;
  }
  assert.fail(`${objectType} containing ${needle} should exist`);
}

test("shell composes one window from the shared bridge, theme, transcript, composer, search, and dialogs", () => {
  assert.equal((shell.match(/\bFloatingWindow\s*\{/g) ?? []).length, 1);
  assert.match(shell, /title:\s*bridge\.windowTitle/);
  assert.match(shell, /surfaceFormat\.opaque:\s*true/);
  assert.match(shell, /parent:\s*window\.contentItem/);
  assert.match(shell, /text:\s*bridge\.displayCwd\n/);
  assert.match(bridge, /readonly property string displayCwd/);
  assert.match(shell, /text:\s*bridge\.currentProvider \+ "\/" \+ bridge\.currentModelId/);
  assert.match(shell, /text:\s*"thinking " \+ bridge\.currentThinkingLevel/);
  assert.match(shell, /text:\s*bridge\.compacting \? "Compacting…" : "Compact context"/);
  assert.match(shell, /StatusBadge\s*\{[\s\S]*kind:\s*bridge\.statusKind[\s\S]*text:\s*bridge\.statusText/);
  for (const component of ["BackendBridge", "Theme", "Composer", "SearchBar", "EmptyState", "NoticeBar", "TranscriptRow", "ExtensionDialog", "LinkDialog", "PickerDialog"]) {
    assert.match(shell, new RegExp(`\\b${component}\\s*\\{`), `shell should use ${component}`);
  }
  for (const sequence of ["Ctrl+F", "Ctrl+T", "Ctrl+Shift+M", "Ctrl+Shift+X", "Ctrl+L", "Ctrl+M", "Ctrl+Shift+P", "Ctrl+E", "Ctrl+Shift+E"]) {
    assert.match(shell, new RegExp(`sequence:\\s*"${sequence.replace(/\+/g, "\\+")}"`), `shortcut ${sequence}`);
  }
  assert.match(shell, /onLinkActivated:\s*link\s*=>\s*root\.confirmLink\(link\)/);
  assert.match(shell, /onCopyRequested:\s*text\s*=>\s*bridge\.copyToClipboard\(text\)/);
  assert.match(shell, /followOutput/);
  assert.match(shell, /positionViewAtIndex\(searchCurrentRow, ListView\.Center\)/);
  assert.match(shell, /Loader\s*\{[\s\S]*active:\s*root\.smokeMode[\s\S]*SmokeDriver/);
  assert.match(shell, /footer:\s*WorkingIndicator\s*\{[\s\S]*running:\s*bridge\.active/);
  assert.match(shell, /Repeater\s*\{[\s\S]*model:\s*root\.statusGroups[\s\S]*StatusSegment/);
  assert.match(functionBody(shell, "groupStatusChips"), /chip\.group === "meta"/);
  assert.match(shell, /text:\s*bridge\.restarting \? "Restarting…"/);
});

test("theme owns every palette color and follows the desktop color scheme", () => {
  assert.match(theme, /Qt\.styleHints\.colorScheme\s*===\s*Qt\.Dark/);
  assert.match(theme, /requestedMode === "dark"/);
  assert.match(theme, /portalMode === "dark"/);
  for (const token of ["windowBackground", "foreground", "accent", "link", "focusRing", "codeBackground", "codeForeground", "quoteBorder", "tableBorder", "thinkingForeground", "dialogOverlay", "searchHighlight", "selection"]) {
    assert.match(theme, new RegExp(`readonly property color ${token}\\b`), `theme token ${token}`);
  }
  for (const statusKind of ["ready", "running", "tool", "error"]) assert.match(theme, new RegExp(`kind === "${statusKind}"`));
  for (const [name, source] of Object.entries(components)) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, `${name} should use semantic theme roles`);
  }
});

test("QML limits match the backend protocol budget", () => {
  assert.match(bridge, new RegExp(`readonly property int protocolVersion:\\s*${PROTOCOL_VERSION}\\b`));
  assert.match(bridge, new RegExp(`readonly property int maxTranscriptRows:\\s*${LIMITS.maxTranscriptRows}\\b`));
  assert.match(bridge, new RegExp(`readonly property int maxMessageCharacters:\\s*${LIMITS.maxMessageCharacters}\\b`));
  assert.match(bridge, new RegExp(`readonly property int maxErrorCharacters:\\s*${LIMITS.maxErrorCharacters}\\b`));
  assert.match(bridge, new RegExp(`readonly property int maxRuntimeInfoCharacters:\\s*${LIMITS.maxRuntimeInfoCharacters}\\b`));
  assert.match(bridge, new RegExp(`readonly property int maxPendingRequests:\\s*${LIMITS.maxPendingRequests}\\b`));
  assert.match(functionBody(bridge, "appendRow"), /transcript\.count >= maxTranscriptRows/);
  assert.match(functionBody(bridge, "boundedText"), /slice\(0, max - 1\)/);
  assert.match(bridge, /"toolOutput": boundedText\(event\.output \|\| "", 4096\)/);
  assert.equal(LIMITS.maxToolOutputCharacters, 4096);
});

test("bridge talks only to the backend over strict LF JSONL with correlated, bounded requests", () => {
  assert.match(bridge, /command:\s*\[\s*String\(Quickshell\.env\("QT_WEBUI_NODE_EXECUTABLE"\)[\s\S]*String\(Quickshell\.env\("QT_WEBUI_BACKEND_ENTRY"\)/);
  assert.doesNotMatch(bridge, /--mode|QT_WEBUI_PI_CLI_ENTRY/, "QML must not start Pi directly");
  assert.match(bridge, /workingDirectory:\s*bridge\.callerCwd/);
  assert.match(bridge, /stdinEnabled:\s*true/);
  assert.equal((bridge.match(/splitMarker:\s*"\\n"/g) ?? []).length, 2);
  const request = functionBody(bridge, "request");
  assert.match(request, /"v": protocolVersion/);
  assert.match(request, /backendProcess\.write\(JSON\.stringify\(frame\) \+ "\\n"\)/);
  assert.match(request, /pendingRequestCount >= maxPendingRequests/);
  assert.match(request, /deadline: Date\.now\(\) \+ timeoutFor\(type\)/);
  assert.match(functionBody(bridge, "sweepPending"), /code: "timeout"/);
  assert.match(functionBody(bridge, "handleFrame"), /frame\.v !== protocolVersion/);
  assert.match(functionBody(bridge, "handleFrame"), /staleResponses\+\+/);
  const line = functionBody(bridge, "handleLine");
  assert.match(line, /endsWith\("\\r"\)/);
  assert.match(line, /JSON\.parse\(line\)/);
  assert.match(line, /catch \(error\)/);
  assert.doesNotMatch(bridge, /\beval\s*\(|new Function|Qt\.openUrlExternally|execDetached/);
  for (const type of REQUEST_TYPES) {
    if (type === "hello" || type === "debug_crash" || type === "settings_get") continue; // hello returns settings; settings_get exists for tooling
    assert.match(bridge, new RegExp(`request\\("${type}"`), `bridge should issue ${type} requests`);
  }
});

test("bridge handles every backend event type and keeps failure paths explicit", () => {
  const handler = functionBody(bridge, "handleEvent");
  for (const eventType of [
    "backend.ready", "backend.fatal", "pi.status", "pi.error", "pi.runtime", "pi.exit", "message.user", "part.begin",
    "part.render", "part.remove", "message.end", "tool.start", "tool.update", "tool.end", "run.start", "run.end",
    "extension.request", "extension.cancelled", "extension.notify", "extension.status", "composer.setText",
    "window.title", "queue.update", "notice", "events.dropped", "settings.changed",
  ]) assert.match(handler, new RegExp(`case "${eventType.replace(".", "\\.")}"`), `event ${eventType}`);
  assert.match(handler, /default:\s*\n\s*break/);
  assert.match(bridge, /event\.partKind/);
  assert.match(bridge, /onExited:\s*\(exitCode, exitStatus\)/);
  assert.match(bridge, /failAllPending\("not_running", "Backend exited"\)/);
  assert.match(bridge, /The Qt WebUI backend exited with code/);
  assert.match(functionBody(bridge, "restartProcess"), /startBackend\(\)/);
  assert.match(functionBody(bridge, "restartProcess"), /restarting = true/);
  assert.match(functionBody(bridge, "handleExtensionStatus"), /event\.chips/);
  assert.match(functionBody(bridge, "restartProcess"), /request\("restart"/);
  assert.match(functionBody(bridge, "shutdown"), /request\("shutdown"/);
  assert.match(functionBody(bridge, "copyToClipboard"), /Quickshell\.clipboardText = text/);
  assert.match(functionBody(bridge, "notifyDesktop"), /!desktopNotifications \|\| windowActive/);
});

test("extension dialogs answer exactly once with typed values and cancel on close or session loss", () => {
  const answer = functionBody(bridge, "answerDialog");
  assert.match(answer, /activeDialog\.answered/);
  assert.match(answer, /dialog\.answered = true/);
  assert.match(answer, /request\("extension_response"/);
  assert.match(functionBody(bridge, "clearDialogs"), /dialogQueue = \[\]/);
  assert.match(bridge, /case "pi\.exit":[\s\S]*clearDialogs\(/);
  assert.match(bridge, /onExited:[\s\S]*clearDialogs\(/);
  for (const method of ["select", "confirm", "input", "editor"]) assert.match(extensionDialog, new RegExp(`method === "${method}"`));
  assert.match(functionBody(extensionDialog, "submit"), /if \(answered \|\| !request\) return false/);
  assert.match(extensionDialog, /onClosed:\s*\{[\s\S]*if \(!answered && request\)[\s\S]*"cancelled": true/);
  assert.match(functionBody(extensionDialog, "selectOption"), /options\.indexOf\(value\) === -1\) return false/);
  assert.match(extensionDialog, /initialFocusItem:/);
  assert.match(extensionDialog, /keyNavigationEnabled:\s*true/);
  assert.match(extensionDialog, /Keys\.onReturnPressed:\s*dialog\.selectCurrent\(\)/);
  assert.match(appDialog, /modal:\s*true/);
  assert.match(appDialog, /focus:\s*true/);
  assert.match(appDialog, /closePolicy:\s*Popup\.CloseOnEscape/);
  assert.match(appDialog, /parent:\s*Overlay\.overlay/);
  assert.match(appDialog, /onClosed:\s*if \(returnFocusItem\) returnFocusItem\.forceActiveFocus\(\)/);
  assert.match(appDialog, /Accessible\.role:\s*Accessible\.Dialog/);
});

test("model and thinking pickers choose only through explicit activation and refuse changes while Pi is busy", () => {
  for (const name of ["loadModels", "selectModel", "cycleModel", "loadThinkingLevels", "setThinkingLevel", "cycleThinkingLevel", "compactContext"]) {
    assert.match(bridge, new RegExp(`function ${name}\\(`), `bridge should implement ${name}`);
  }
  for (const name of ["selectModel", "cycleModel", "setThinkingLevel", "cycleThinkingLevel"]) {
    assert.match(functionBody(bridge, name), /if \(!ready \|\| active \|\| modelActionPending\) return false/, `${name} must refuse while a run or another change is active`);
  }
  assert.match(functionBody(bridge, "selectModel"), /provider === currentProvider && modelId === currentModelId\) return false/);
  assert.match(functionBody(bridge, "compactContext"), /if \(!ready \|\| active \|\| compacting\) return false/);
  assert.match(functionBody(bridge, "compactContext"), /boundedText\(instructions\.trim\(\), 1024\)/);
  assert.equal(LIMITS.maxCompactionInstructionCharacters, 1024);
  assert.match(bridge, /case "pi\.exit":[\s\S]*modelActionPending = false[\s\S]*compacting = false/);
  assert.match(functionBody(shell, "openModelPicker"), /if \(!bridge\.ready \|\| bridge\.active \|\| bridge\.modelActionPending \|\| pickerDialogItem\.opened\) return false/);
  assert.match(functionBody(shell, "openThinkingPicker"), /searchable: false/);
  assert.match(functionBody(shell, "pickerPicked"), /bridge\.selectModel\(value\.slice\(0, slash\), value\.slice\(slash \+ 1\)\)/);
  assert.match(functionBody(shell, "pickerPicked"), /bridge\.setThinkingLevel\(value\)/);
  assert.match(pickerDialog, /^AppDialog \{/m);
  assert.match(pickerDialog, /signal picked\(string value\)/);
  assert.match(pickerDialog, /initialFocusItem:\s*searchable \? filterField : optionList/);
  assert.match(pickerDialog, /keyNavigationEnabled:\s*true/);
  assert.match(pickerDialog, /Keys\.onReturnPressed:\s*dialog\.pickCurrent\(\)/);
  assert.match(pickerDialog, /event\.key === Qt\.Key_Down[\s\S]*dialog\.moveSelection\(1\)/);
  assert.match(functionBody(pickerDialog, "pickIndex"), /close\(\)[\s\S]*picked\(value\)/);
  assert.doesNotMatch(functionBody(pickerDialog, "filterItems"), /picked\(/, "filtering must never pick");
  assert.doesNotMatch(functionBody(pickerDialog, "moveSelection"), /picked\(/, "navigation must never pick");
  assert.match(pickerDialog, /Accessible\.role:\s*Accessible\.ListItem/);
  assert.match(pickerDialog, /Accessible\.selected:\s*ListView\.isCurrentItem/);
  assert.match(pickerDialog, /\(current \? ", current" : ""\)/);
  assert.match(pickerDialog, /HoverHandler\s*\{[\s\S]*Qt\.PointingHandCursor/);
  assert.match(shell, /PickerDialog\s*\{[\s\S]*returnFocusItem:\s*composer[\s\S]*onPicked:\s*value => root\.pickerPicked\(value\)/);
  assert.match(shell, /enabled:\s*bridge\.ready && !bridge\.active && !bridge\.modelActionPending/);
  assert.match(fixture, /"get_available_models"/);
  assert.match(fixture, /"cycle_thinking_level"/);
  assert.match(fixture, /__QT_WEBUI_COMPACT_FAIL__/);
});

test("untrusted content renders as plain or whitelisted styled text and links open only after confirmation", () => {
  for (const [name, source] of Object.entries(components)) {
    assert.doesNotMatch(source, /Text\.RichText|TextEdit\.RichText|Text\.MarkdownText|TextEdit\.MarkdownText|Text\.AutoText/, `${name} must not use rich text formats`);
  }
  assert.match(blocks, /textFormat:\s*Text\.StyledText/);
  assert.match(blocks, /TextEdit\s*\{[\s\S]*textFormat:\s*TextEdit\.PlainText[\s\S]*readOnly:\s*true/);
  assert.match(blocks, /onLinkActivated:\s*link\s*=>\s*root\.linkActivated\(link\)/);
  assert.doesNotMatch(blocks, /Qt\.openUrlExternally/);
  assert.match(functionBody(blocks, "parseBlocks"), /JSON\.parse\(json\)/);
  assert.match(functionBody(blocks, "parseBlocks"), /catch \(error\)/);
  assert.match(linkDialog, /function accept\(\)[\s\S]*bridge\.openLink\(target/);
  assert.match(linkDialog, /initialFocusItem:\s*cancelButton/);
  const userLabel = objectBodyContaining(row, "Label", "visible: row.kind === \"user\" || row.kind === \"thinking\"");
  assert.match(userLabel, /textFormat:\s*Text\.PlainText/);
  for (const roleName of ["rowId", "messageId", "role", "kind", "text", "blocksJson", "truncated", "streaming", "modeLabel", "toolName", "toolSummary", "toolStatus", "toolDurationMs", "toolOutput", "toolError"]) {
    assert.match(row, new RegExp(`required property \\w+ ${roleName}\\b`), `TranscriptRow should require ${roleName}`);
  }
  const contextLabel = objectBodyContaining(shell, "Label", "text: bridge.displayCwd");
  assert.match(contextLabel, /textFormat:\s*Text\.PlainText/);
  assert.match(functionBody(bridge, "handleExtensionStatus"), /indexOf\("cwd "\) === 0\) continue/, "the cd status repeats the header");
  assert.match(functionBody(bridge, "handleExtensionStatus"), /name\.indexOf\("git-footer"\) === 0 && name !== "git-footer-webui"\) continue/);
  assert.match(functionBody(bridge, "handleExtensionStatus"), /shownLabel/);
  assert.match(functionBody(shell, "groupStatusChips"), /add\("Extensions", entry\)/);
  assert.match(toolCard, /TextEdit\s*\{[\s\S]*textFormat:\s*TextEdit\.PlainText/);
  assert.match(fixture, /toolName: "<b>read<\/b>"/);
  assert.match(fixture, /<script>alert\(1\)<\/script>/);
});

test("composer exposes send, steer, follow-up, abort, and restart with keyboard paths", () => {
  assert.match(composer, /signal sendRequested\(string text, string mode\)/);
  assert.match(composer, /composer\.trySend\(composer\.active \? "steer" : "send"\)/);
  assert.match(composer, /composer\.trySend\(composer\.active \? "followUp" : "send"\)/);
  assert.match(composer, /event\.modifiers & Qt\.ShiftModifier\) return/, "Shift+Enter must insert a new line");
  assert.match(composer, /Enter to send · Shift\+Enter for a new line/);
  assert.match(composer, /text:\s*composer\.active \? "Abort" : \(composer\.ready \? "Send" : "Restart"\)/);
  assert.match(composer, /enabled:\s*composer\.ready\b/);
  assert.match(composer, /overLimit/);
  assert.match(functionBody(composer, "trySend"), /if \(mode === "send" && active\) return/);
  assert.match(functionBody(bridge, "sendPrompt"), /promptMode === "send" && active/);
  assert.match(functionBody(bridge, "sendPrompt"), /message\.length > maxMessageCharacters/);
});

test("controls carry accessible names, roles, and focus behavior", () => {
  assert.match(appButton, /Accessible\.role:\s*Accessible\.Button/);
  assert.match(appButton, /Accessible\.name:\s*accessibleName/);
  assert.match(appButton, /focusPolicy:\s*Qt\.StrongFocus/);
  assert.match(appButton, /border\.width:\s*control\.activeFocus \? 2 : 1/, "buttons are always framed");
  assert.match(appButton, /HoverHandler\s*\{[\s\S]*Qt\.PointingHandCursor/);
  assert.match(appButton, /hoverEnabled:\s*true/);
  assert.match(appButton, /Accessible\.checked:\s*active/);
  assert.match(shell, /active:\s*bridge\.showThinking/);
  assert.match(shell, /active:\s*bridge\.compactTranscript/);
  for (const [name, source] of [["composer", composer], ["searchBar", searchBar], ["toolCard", toolCard], ["row", row], ["statusBadge", statusBadge], ["noticeBar", noticeBar], ["emptyState", emptyState], ["blocks", blocks]]) {
    assert.match(source, /Accessible\.(role|name)/, `${name} should describe itself to assistive technology`);
  }
  assert.match(searchBar, /Keys\.onPressed[\s\S]*Qt\.Key_Escape[\s\S]*bar\.closeRequested\(\)/);
  assert.match(searchBar, /event\.modifiers & Qt\.ShiftModifier\) bar\.previousRequested\(\)/);
  assert.match(row, /Accessible\.name:\s*roleLabel/);
});

test("smoke driver and fixture cover every recorded protocol edge", () => {
  for (const marker of [
    "QT_WEBUI_SMOKE_BACKEND_READY", "QT_WEBUI_SMOKE_READY", "QT_WEBUI_SMOKE_STREAM_RECONCILED", "QT_WEBUI_SMOKE_THINKING_RENDERED",
    "QT_WEBUI_SMOKE_TOOL_CARD", "QT_WEBUI_SMOKE_MARKDOWN_RENDERED", "QT_WEBUI_SMOKE_LINK_CONFIRMED", "QT_WEBUI_SMOKE_SEARCH_MATCHED",
    "QT_WEBUI_SMOKE_PROVIDER_ERROR_PRESERVED", "QT_WEBUI_SMOKE_FAILED_RESPONSE_RECOVERED", "QT_WEBUI_SMOKE_DELAYED_ABORT_RECEIPT",
    "QT_WEBUI_SMOKE_TRANSCRIPT_BOUNDED", "QT_WEBUI_SMOKE_SETTINGS_PERSISTED", "QT_WEBUI_SMOKE_MODEL_PICKER", "QT_WEBUI_SMOKE_MODEL_SELECTED",
    "QT_WEBUI_SMOKE_THINKING_PICKER", "QT_WEBUI_SMOKE_MODEL_CYCLED", "QT_WEBUI_SMOKE_THINKING_CYCLED", "QT_WEBUI_SMOKE_CONTEXT_COMPACTED",
    "QT_WEBUI_SMOKE_FAILED_STATE_RECOVERABLE",
    "QT_WEBUI_SMOKE_MISSING_STATE_RECOVERABLE", "QT_WEBUI_SMOKE_RESTART_RECEIPT", "QT_WEBUI_SMOKE_BACKEND_CRASH_OBSERVED",
    "QT_WEBUI_SMOKE_BACKEND_CRASH_RECOVERED", "QT_WEBUI_SMOKE_COMPLETE",
  ]) assert.match(smoke, new RegExp(marker), `driver should log ${marker}`);
  assert.match(smoke, /dialog\.submit\(\{ "cancelled": true \}\)\) fail\(/, "driver proves a second answer is rejected");
  assert.match(fixture, /\{malformed rpc record\}/);
  assert.match(fixture, /future_unknown_event/);
  assert.match(fixture, /qt-webui-stale-0/);
  assert.match(fixture, /"\\r\\n"/);
  assert.match(fixture, /deterministic prompt rejection/);
  assert.match(fixture, /options: \["Allow", "Block"\]/);
  assert.match(fixture, /prefill: "Line 1\\nLine 2"/);
  assert.match(fixture, /setTimeout\(\(\) => \{[\s\S]*activeAbort = true;[\s\S]*type: "agent_start"/);
  assert.match(fixture, /stopReason: "error"/);
  assert.match(fixture, /failed-state/);
  assert.match(fixture, /missing-state/);
  assert.match(fixture, /text: "authoritative final"/);
  assert.match(fixture, /"x"\.repeat\(10_000\)/);
  assert.match(fixture, /process\.exit\(23\)/);
  assert.match(fixture, /grandchild\.kill\("SIGTERM"\)/);
});

test("no QML file is left over from the direct-Pi design", async () => {
  const names = await readdir(qmlRoot);
  assert(!names.includes("PiBridge.qml"));
  const componentNames = await readdir(path.join(qmlRoot, "components"));
  assert(!componentNames.includes("ChatMessage.qml"));
});
