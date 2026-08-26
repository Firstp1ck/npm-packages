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

const [workingIndicator, statusSegment, dropUpPicker, pickerDialog, completionPopup, sequencesDialog, textEditDialog, tabStrip, confirmDialog, inputDialog, worktreeDialog, directoryDialog] = await Promise.all([
  readQml(path.join("components", "WorkingIndicator.qml")), readQml(path.join("components", "StatusSegment.qml")), readQml(path.join("components", "DropUpPicker.qml")), readQml(path.join("dialogs", "PickerDialog.qml")),
  readQml(path.join("components", "CompletionPopup.qml")), readQml(path.join("dialogs", "SequencesDialog.qml")), readQml(path.join("dialogs", "TextEditDialog.qml")),
  readQml(path.join("components", "TabStrip.qml")), readQml(path.join("dialogs", "ConfirmDialog.qml")), readQml(path.join("dialogs", "InputDialog.qml")), readQml(path.join("dialogs", "WorktreeDialog.qml")), readQml(path.join("dialogs", "DirectoryDialog.qml")),
]);
const [eventsDialog, diagnosticsDialog, resourceProfilesDialog] = await Promise.all([
  readQml(path.join("dialogs", "EventsDialog.qml")),
  readQml(path.join("dialogs", "DiagnosticsDialog.qml")),
  readQml(path.join("dialogs", "ResourceProfilesDialog.qml")),
]);
const components = { shell, composer, row, blocks, toolCard, searchBar, emptyState, appButton, statusBadge, noticeBar, appDialog, extensionDialog, linkDialog, workingIndicator, statusSegment, dropUpPicker, pickerDialog, completionPopup, sequencesDialog, textEditDialog, tabStrip, confirmDialog, inputDialog, worktreeDialog, directoryDialog, eventsDialog, diagnosticsDialog, resourceProfilesDialog };

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
  for (const component of ["BackendBridge", "Theme", "Composer", "SearchBar", "EmptyState", "NoticeBar", "TranscriptRow", "ExtensionDialog", "LinkDialog", "PickerDialog", "ResourceProfilesDialog"]) {
    assert.match(shell, new RegExp(`\\b${component}\\s*\\{`), `shell should use ${component}`);
  }
  for (const sequence of ["Ctrl+F", "Ctrl+T", "Ctrl+Shift+M", "Ctrl+Shift+X", "Ctrl+L", "Ctrl+M", "Ctrl+Shift+P", "Ctrl+E", "Ctrl+Shift+E", "Ctrl+Shift+R", "Ctrl+Shift+S", "Ctrl+Shift+A", "Ctrl+N", "Ctrl+O", "Ctrl+W", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+Shift+O", "Ctrl+Shift+N", "Ctrl+Shift+B", "F2", "Ctrl+K", "Ctrl+Shift+L", "Ctrl+Shift+D"]) {
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

test("workspace shell keeps the approved rail, centered conversation, and small-window structure", () => {
  const rail = objectBodyContaining(shell, "Rectangle", "id: workspaceRail");
  const reloadPiButton = objectBodyContaining(shell, "AppButton", "id: reloadPiButton");
  assert.match(shell, /minimumSize:\s*Qt\.size\(560, 520\)/);
  assert.match(rail, /Layout\.minimumWidth:\s*148/);
  assert.match(rail, /Layout\.maximumWidth:\s*208/);
  assert.match(rail, /Accessible\.name:\s*"Workspace navigation"/);
  assert.match(rail, /TabStrip\s*\{[\s\S]*orientation:\s*"vertical"/);
  assert.match(reloadPiButton, /visible:\s*bridge\.ready/);
  assert.match(reloadPiButton, /text:\s*"Reload Pi"/);
  assert.match(reloadPiButton, /enabled:\s*!bridge\.active/);
  assert.match(reloadPiButton, /onClicked:\s*bridge\.sendPrompt\("\/reload", "send"\)/);
  assert.match(shell, /width:\s*Math\.min\(parent\.width, 820\)/);
  assert.match(shell, /Accessible\.name:\s*"Conversation transcript"/);
  assert.match(emptyState, /Flickable\s*\{[\s\S]*boundsBehavior:\s*Flickable\.StopAtBounds/);
  assert.match(emptyState, /accessibleName:\s*"Focus the prompt"/);
  assert.equal((shell.match(/\bComposer\s*\{/g) ?? []).length, 1);
  const composerIndex = shell.indexOf("id: composer");
  const responseControlsIndex = shell.indexOf("id: responseControls");
  assert(responseControlsIndex > composerIndex, "response controls should sit beneath the composer instead of beneath the workspace title");
  assert.match(shell, /id:\s*responseControls[\s\S]*Accessible\.name:\s*"Response and transcript controls for workspace "/);
});

test("composer burger menu exposes secondary actions without duplicating visible controls", () => {
  const responseControls = objectBodyContaining(shell, "RowLayout", "id: responseControls");
  const composerMenuButton = objectBodyContaining(responseControls, "AppButton", "id: composerMenuButton");
  const menuItems = functionBody(shell, "composerMenuItems");
  assert.match(responseControls, /Flow\s*\{[\s\S]*id:\s*primaryResponseControls[\s\S]*Layout\.fillWidth:\s*true/);
  assert.match(composerMenuButton, /text:\s*"☰"[\s\S]*accessibleName:\s*"More options"/);
  assert.match(composerMenuButton, /Layout\.alignment:\s*Qt\.AlignRight \| Qt\.AlignTop/);
  assert.doesNotMatch(responseControls, /Layout\.rightMargin/, "the burger button should align with the prompt's full right edge");
  assert(responseControls.indexOf("id: composerMenuButton") > responseControls.indexOf('text: bridge.compactTranscript ? "Compact" : "Detailed"'), "the burger menu should be the rightmost response control");
  assert.doesNotMatch(responseControls, /id:\s*resourceProfilesButton|text:\s*bridge\.resourceLoading \? "Resources…" : "Resources"/, "Resources should live in the menu instead of a standalone control");
  for (const action of ["resource-profiles", "toggle-thinking", "toggle-highlighting", "toggle-notifications", "cycle-appearance", "toggle-reduced-motion", "events", "diagnostics"]) {
    assert.match(menuItems, new RegExp(`value: "${action}"`), `secondary action ${action}`);
  }
  for (const duplicate of ["compact-context", "toggle-compact", "choose-model", "choose-thinking", "search", "resume-session", "worktree", "restart"]) {
    assert.doesNotMatch(menuItems, new RegExp(`value: "${duplicate}"`), `visible action ${duplicate} should not be duplicated`);
  }
  assert.match(shell, /DropUpPicker\s*\{[\s\S]*id:\s*composerMenuDropUpItem[\s\S]*anchorItem:\s*composerMenuButton[\s\S]*returnFocusItem:\s*composerMenuButton/);
  assert.match(functionBody(shell, "composerPickerOpen"), /composerMenuDropUpItem\.opened/);
  assert.match(functionBody(shell, "invalidateComposerPickers"), /composerMenuDropUpItem\.opened[\s\S]*composerMenuDropUpItem\.close\(\)/);
  assert.match(functionBody(shell, "openComposerMenu"), /!bridge\.ready \|\| bridge\.active[\s\S]*composerMenuDropUpItem\.present/);
  assert.match(functionBody(shell, "composerMenuPicked"), /Qt\.callLater[\s\S]*runPaletteAction\(value\)[\s\S]*recordAction\("action:" \+ value\)/);
});

test("theme owns every palette color and follows the portal-first desktop color scheme", () => {
  assert.match(theme, /Qt\.styleHints\.colorScheme\s*===\s*Qt\.Dark/);
  assert.match(theme, /requestedMode === "dark"/);
  assert.match(theme, /portalMode === "dark"/);
  assert.match(shell, /requestedMode:\s*bridge\.appearanceMode/);
  assert.match(shell, /portalMode:\s*bridge\.portalColorScheme/);
  assert.match(shell, /reducedMotion:\s*bridge\.reducedMotion/);
  assert.match(shell, /desktopCornerRadius:\s*bridge\.desktopCornerRadius/);
  assert.match(shell, /desktopEdgeGap:\s*bridge\.desktopEdgeGap/);
  for (const token of ["mainSurface", "sidebarSurface", "sidebarBorder", "panelSurface", "windowBackground", "foreground", "accent", "link", "focusRing", "controlSurface", "controlHover", "controlPressed", "controlActive", "controlSelected", "composerSurface", "composerBorder", "composerShadow", "codeBackground", "codeForeground", "quoteBorder", "tableBorder", "thinkingForeground", "dialogOverlay", "searchHighlight", "selection", "selectionForeground", "urgentBackground", "urgentBorder", "urgentForeground", "primaryButtonForeground", "destructiveButtonForeground", "warningButtonForeground"]) {
    assert.match(theme, new RegExp(`readonly property color ${token}\\b`), `theme token ${token}`);
  }
  for (const token of ["spaceXxs", "spaceXs", "spaceSm", "spaceMd", "spaceLg", "spaceXl", "space2Xl", "space3Xl", "space4Xl", "typeCaption", "typeSmall", "typeBody", "typeSubtitle", "typeTitle", "typeDisplay", "radiusSmall", "radiusMedium", "radiusLarge", "radiusPill", "borderWidth", "focusBorderWidth", "controlHeight", "motionFast", "motionNormal", "motionSlow", "animationDuration"]) {
    assert.match(theme, new RegExp(`readonly property int ${token}\\b`), `theme scale token ${token}`);
  }
  assert.match(theme, /motionNormal:\s*reducedMotion \? 0 : 120/);
  assert.match(theme, /function filledButtonBackground\(variant, state\)/);
  assert.match(theme, /function filledButtonForeground\(variant, state\)/);
  for (const stateToken of ["primaryButtonBackground", "primaryButtonHover", "primaryButtonPressed", "primaryButtonHoverForeground", "primaryButtonPressedForeground", "destructiveButtonBackground", "destructiveButtonHover", "destructiveButtonPressed", "destructiveButtonHoverForeground", "destructiveButtonPressedForeground", "warningButtonBackground", "warningButtonHover", "warningButtonPressed"]) {
    assert.match(theme, new RegExp(`readonly property color ${stateToken}\\b`), `filled button state token ${stateToken}`);
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
  assert.match(bridge, new RegExp(`readonly property int maxModels:\\s*${LIMITS.maxModels}\\b`));
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
  assert.match(request, /originTab: activeTabId/);
  assert.match(request, /sessionScoped: sessionScopedRequestTypes\[type\] === true/);
  const settle = functionBody(bridge, "settlePending");
  assert.match(settle, /entry\.sessionScoped && entry\.originTab\.length > 0 && entry\.originTab !== activeTabId/);
  assert.match(settle, /staleResponses\+\+[\s\S]*return true/);
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
    "window.title", "queue.update", "notice", "events.dropped", "settings.changed", "appearance.changed", "tabs.update", "transcript.reset", "transcript.row",
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
  assert.match(functionBody(bridge, "applyAppearance"), /mode === "unknown"\) return false/);
  assert.match(bridge, /property string appearanceMode: "automatic"/);
  assert.match(bridge, /property bool reducedMotion: false/);
  assert.match(bridge, /QT_WEBUI_DESKTOP_CORNER_RADIUS/);
  assert.match(bridge, /QT_WEBUI_DESKTOP_EDGE_GAP/);
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

test("model and thinking drop-ups are bounded, keyboard accessible, explicit, and busy guarded", () => {
  for (const name of ["loadModels", "selectModel", "cycleModel", "loadThinkingLevels", "setThinkingLevel", "cycleThinkingLevel", "compactContext"]) {
    assert.match(bridge, new RegExp(`function ${name}\\(`), `bridge should implement ${name}`);
  }
  for (const name of ["selectModel", "cycleModel", "setThinkingLevel", "cycleThinkingLevel"]) {
    assert.match(functionBody(bridge, name), /if \(!ready \|\| active \|\| modelActionPending \|\| resourceActionPending\) return false/, `${name} must refuse while a run or another change is active`);
  }
  assert.match(functionBody(bridge, "selectModel"), /provider === currentProvider && modelId === currentModelId\) return false/);
  assert.match(functionBody(bridge, "compactContext"), /if \(!ready \|\| active \|\| compacting\) return false/);
  assert.match(functionBody(bridge, "compactContext"), /boundedText\(instructions\.trim\(\), 1024\)/);
  assert.equal(LIMITS.maxCompactionInstructionCharacters, 1024);
  assert.match(bridge, /case "pi\.exit":[\s\S]*modelActionPending = false[\s\S]*compacting = false/);

  assert.match(functionBody(shell, "composerPickerOpen"), /pickerDialogItem\.opened \|\| composerMenuDropUpItem\.opened \|\| modelDropUpItem\.opened \|\| thinkingDropUpItem\.opened/);
  assert.match(functionBody(shell, "openModelPicker"), /if \(!bridge\.ready \|\| bridge\.active \|\| bridge\.modelActionPending \|\| bridge\.resourceActionPending \|\| composerPickerOpen\(\)\) return false/);
  assert.match(functionBody(shell, "invalidateComposerPickers"), /composerPickerGeneration\+\+[\s\S]*modelPickerLoading = false[\s\S]*thinkingPickerLoading = false[\s\S]*modelDropUpItem\.close\(\)[\s\S]*thinkingDropUpItem\.close\(\)/);
  assert.match(functionBody(shell, "openModelPicker"), /const originTab = bridge\.activeTabId[\s\S]*const generation = \+\+composerPickerGeneration[\s\S]*bridge\.loadModels\(response => root\.modelPickerResult\(originTab, generation, response\)\)/);
  assert.match(functionBody(shell, "openThinkingPicker"), /const originTab = bridge\.activeTabId[\s\S]*const generation = \+\+composerPickerGeneration[\s\S]*bridge\.loadThinkingLevels\(response => root\.thinkingPickerResult\(originTab, generation, response\)\)/);
  for (const name of ["modelPickerResult", "thinkingPickerResult"]) {
    const result = functionBody(shell, name);
    assert.match(result, /generation !== composerPickerGeneration/);
    assert.match(result, /!bridge\.ready \|\| bridge\.active \|\| bridge\.activeTabId !== originTab/);
    assert.match(result, /\.present\(/);
  }
  assert.match(shell, /function onReadyChanged\(\)[\s\S]*if \(!bridge\.ready\)[\s\S]*root\.invalidateComposerPickers\(\)/);
  assert.match(shell, /function onActiveChanged\(\)[\s\S]*if \(bridge\.active\) root\.invalidateComposerPickers\(\)/);
  assert.match(shell, /function onTabSwitched\(tabId\)[\s\S]*root\.invalidateComposerPickers\(\)/);
  assert.match(functionBody(shell, "modelPicked"), /bridge\.activeTabId !== modelPickerTabId[\s\S]*modelPickerGeneration !== composerPickerGeneration[\s\S]*bridge\.selectModel\(value\.slice\(0, slash\), value\.slice\(slash \+ 1\)\)/);
  assert.match(functionBody(shell, "thinkingPicked"), /bridge\.activeTabId !== thinkingPickerTabId[\s\S]*thinkingPickerGeneration !== composerPickerGeneration[\s\S]*bridge\.setThinkingLevel\(value\)/);

  assert.match(dropUpPicker, /^Popup \{/m);
  assert.match(dropUpPicker, /modal:\s*false/);
  assert.match(dropUpPicker, /closePolicy:\s*Popup\.CloseOnEscape \| Popup\.CloseOnPressOutside/);
  assert.match(dropUpPicker, /readonly property real dropUpAvailableHeight:\s*Math\.max\(0, anchorPosition\.y - edgeMargin - anchorGap\)/);
  assert.match(dropUpPicker, /height:\s*Math\.min\(implicitHeight, maximumHeight, dropUpAvailableHeight\)/);
  assert.match(dropUpPicker, /x:\s*Math\.max\(edgeMargin, Math\.min\(anchorPosition\.x, boundsItem\.width - width - edgeMargin\)\)/);
  assert.match(dropUpPicker, /y:\s*Math\.max\(edgeMargin, anchorPosition\.y - height - anchorGap\)/);
  assert.match(dropUpPicker, /onClosed:[\s\S]*returnFocusItem\.forceActiveFocus\(\)/);
  assert.match(dropUpPicker, /keyNavigationEnabled:\s*true/);
  const listKeys = functionBody(dropUpPicker, "handleOptionListKey");
  assert.match(listKeys, /Qt\.Key_Down[\s\S]*moveSelection\(1\)/);
  assert.match(listKeys, /Qt\.Key_Up[\s\S]*moveSelection\(-1\)/);
  assert.match(listKeys, /Qt\.Key_Return \|\| key === Qt\.Key_Enter \|\| key === Qt\.Key_Space[\s\S]*pickCurrent\(\)/);
  assert.match(dropUpPicker, /Keys\.onPressed:\s*event => \{[\s\S]*popup\.handleOptionListKey\(event\.key, event\.modifiers\)[\s\S]*event\.accepted = true/);
  assert.match(dropUpPicker, /currentIndex:\s*popup\.currentIndex/);
  assert.doesNotMatch(functionBody(dropUpPicker, "filterItems"), /picked\(/, "filtering must never pick");
  assert.doesNotMatch(functionBody(dropUpPicker, "moveSelection"), /picked\(/, "navigation must never pick");
  assert.match(functionBody(dropUpPicker, "pickIndex"), /picked\(value\)[\s\S]*close\(\)/);
  assert.match(dropUpPicker, /Accessible\.role:\s*Accessible\.ListItem/);
  assert.match(dropUpPicker, /Accessible\.selected:\s*index === popup\.currentIndex/);
  assert.match(dropUpPicker, /\(current \? ", current" : ""\)/);
  assert.match(statusBadge, /property real horizontalPadding:\s*theme\.spaceLg/);
  assert.match(statusBadge, /property real verticalPadding:\s*theme\.spaceLg \/ 2/);
  assert.match(statusBadge, /implicitWidth:\s*label\.implicitWidth \+ 2 \* horizontalPadding/);
  assert.match(statusBadge, /implicitHeight:\s*label\.implicitHeight \+ 2 \* verticalPadding/);
  const currentBadge = objectBodyContaining(dropUpPicker, "StatusBadge", 'text: "current"');
  assert.match(currentBadge, /horizontalPadding:\s*popup\.theme\.spaceMd/);
  assert.match(currentBadge, /verticalPadding:\s*popup\.theme\.spaceXxs/);
  assert.match(currentBadge, /Layout\.alignment:\s*Qt\.AlignVCenter/);
  assert.doesNotMatch(pickerDialog, /horizontalPadding:\s*dialog\.theme\.|verticalPadding:\s*dialog\.theme\./, "generic picker badges keep the shared defaults");
  assert.match(dropUpPicker, /HoverHandler\s*\{[\s\S]*Qt\.PointingHandCursor/);
  assert.match(shell, /DropUpPicker\s*\{[\s\S]*id:\s*modelDropUpItem[\s\S]*anchorItem:\s*modelButton[\s\S]*returnFocusItem:\s*modelButton/);
  assert.match(shell, /DropUpPicker\s*\{[\s\S]*id:\s*thinkingDropUpItem[\s\S]*anchorItem:\s*thinkingButton[\s\S]*returnFocusItem:\s*thinkingButton/);
  assert.match(shell, /enabled:\s*bridge\.ready && !bridge\.active && !bridge\.modelActionPending/);
  assert.match(fixture, /"get_available_models"/);
  assert.match(fixture, /"cycle_thinking_level"/);
  assert.match(fixture, /__QT_WEBUI_COMPACT_FAIL__/);
});

test("explicit scoped-model ordering is exact, bounded, filter-safe, persistent, and wired without selecting", () => {
  assert.match(bridge, /property var modelOrder:\s*\[\]/);
  assert.match(functionBody(bridge, "applySettings"), /Array\.isArray\(settings\.modelOrder\)[\s\S]*settings\.modelOrder\.slice\(0, maxModels\)/);
  const applyOrder = functionBody(bridge, "orderedModelData");
  assert.match(applyOrder, /data\.scope\.explicit !== true/);
  assert.match(applyOrder, /String\(model\.provider\) \+ "\/" \+ String\(model\.id\)/);
  assert.match(applyOrder, /for \(const identity of modelOrder\)[\s\S]*ordered\.push\(byIdentity\[identity\]\)[\s\S]*for \(const model of data\.models\)/);
  const merge = functionBody(bridge, "mergedModelOrder");
  assert.match(merge, /for \(const value of Array\.isArray\(currentIdentities\)/);
  assert.match(merge, /merged\.length >= maxModels/);
  assert.match(merge, /for \(const value of modelOrder\)/);
  assert(merge.indexOf("for (const value of modelOrder)") > merge.indexOf("for (const value of Array.isArray(currentIdentities)"), "current scope identities must be merged before absent saved identities");
  assert.match(functionBody(bridge, "saveModelOrder"), /request\("settings_set", \{ "values": \{ "modelOrder": merged \} \}/);
  assert.match(functionBody(bridge, "loadModels"), /response\.data = orderedModelData\(response\.data\)[\s\S]*modelsLoaded\(response\.data\)/);

  assert.match(dropUpPicker, /property bool reorderable:\s*false/);
  assert.match(dropUpPicker, /readonly property bool reorderEnabled:\s*reorderable && items\.length >= 2 && String\(filter \|\| ""\)\.trim\(\)\.length === 0/);
  assert.match(dropUpPicker, /signal reordered\(var values\)/);
  const moveItem = functionBody(dropUpPicker, "moveItem");
  assert.match(moveItem, /const selectedValue =/);
  assert.match(moveItem, /reorderedItems\.splice\(fromIndex, 1\)/);
  assert.match(moveItem, /items = reorderedItems[\s\S]*currentIndex = index[\s\S]*reordered\(reorderedItems\.map/);
  assert.doesNotMatch(moveItem, /picked\(|close\(\)/, "reordering must not select or close");
  const reorderKey = functionBody(dropUpPicker, "handleReorderKey");
  assert.match(reorderKey, /Qt\.ControlModifier[\s\S]*Qt\.ShiftModifier/);
  assert.match(reorderKey, /Qt\.Key_Up[\s\S]*Qt\.Key_Down/);
  assert.match(dropUpPicker, /DragHandler\s*\{[\s\S]*id:\s*reorderDrag[\s\S]*target:\s*null[\s\S]*popup\.finishDrag\(\)/);
  assert.match(dropUpPicker, /onTranslationChanged:[^\n]*optionRow\.y \+ optionRow\.height \/ 2 \+ translation\.y/);
  const dragTarget = functionBody(dropUpPicker, "updateDragTarget");
  assert.match(dragTarget, /centerY <= optionList\.contentY/);
  assert.match(dragTarget, /centerY >= optionList\.contentY \+ optionList\.height/);
  assert.match(dropUpPicker, /text:\s*"≡"/);
  assert.match(dropUpPicker, /Accessible\.description:[^\n]*Ctrl\+Shift\+Up or Ctrl\+Shift\+Down/);

  const modelResult = functionBody(shell, "modelPickerResult");
  assert.match(modelResult, /response\.data\.scope && response\.data\.scope\.explicit === true && items\.length >= 2/);
  assert.match(modelResult, /reorderable: reorderable/);
  const reorderWiring = functionBody(shell, "modelsReordered");
  assert.match(reorderWiring, /bridge\.activeTabId !== modelPickerTabId[\s\S]*modelPickerGeneration !== composerPickerGeneration/);
  assert.match(reorderWiring, /identities\.length !== modelDropUpItem\.items\.length/);
  assert.match(reorderWiring, /bridge\.saveModelOrder\(identities\)/);
  assert.match(shell, /onReordered:\s*values => root\.modelsReordered\(values\)/);
  for (const marker of ["QT_WEBUI_SMOKE_MODEL_REORDER_COMPLETED", "QT_WEBUI_SMOKE_MODEL_REORDER_SAVED", "QT_WEBUI_SMOKE_MODEL_REORDER_REAPPLIED"]) assert.match(smoke, new RegExp(marker));
});

test("resource profiles expose explicit scopes, inheritance, enabled names, supported sampling, and fail-closed controls", () => {
  for (const name of ["refreshResources", "setEnabledTools", "setEnabledSkills", "setSampling", "setResourceProfile", "applyResourceState"]) {
    assert.match(bridge, new RegExp(`function ${name}\\(`), `bridge should implement ${name}`);
  }
  assert.match(functionBody(bridge, "refreshResources"), /if \(!ready \|\| active \|\| resourceLoading \|\| resourceActionPending \|\| modelActionPending\)/);
  assert.match(functionBody(bridge, "refreshResources"), /request\("resources_state"/);
  for (const type of ["resources_state", "tools_set", "skills_set", "sampling_set", "model_set", "thinking_set"]) {
    assert.match(bridge, new RegExp(`"${type}": true`), `${type} callbacks must remain bound to their originating tab`);
  }
  const mutation = functionBody(bridge, "setResourceProfile");
  assert.match(mutation, /!resourcesAvailable/);
  assert.match(mutation, /if \(type === "tools_set"\) request\("tools_set"/);
  assert.match(mutation, /type === "skills_set"\) request\("skills_set"/);
  assert.match(mutation, /request\("sampling_set"/);
  assert.match(mutation, /sessionDurability\.durable === false/);
  assert.match(mutation, /postNotice\("warning"/);
  assert.match(functionBody(bridge, "setEnabledTools"), /"enabledTools"/);
  assert.match(functionBody(bridge, "setEnabledSkills"), /"enabledSkills"/);
  assert.doesNotMatch(bridge, /disabledSkills/, "the public bridge sends enabled skills only");
  for (const name of ["selectModel", "cycleModel", "setThinkingLevel", "cycleThinkingLevel"]) {
    assert.match(functionBody(bridge, name), /applyResourceState\(response\.data\.resources\)/, `${name} applies the backend's freshly resolved resources`);
  }
  assert.match(functionBody(bridge, "applySnapshot"), /resourceState = null[\s\S]*Qt\.callLater\(bridge\.refreshResources\)/, "tab snapshots clear then refresh resources");
  assert.match(functionBody(bridge, "resetTabState"), /resourceState = null/);
  assert.match(functionBody(bridge, "handleEvent"), /case "resources\.changed":[\s\S]*applyResourceState\(event\.state\)/);
  assert.match(bridge, new RegExp(`readonly property int maxResourceNames:\\s*${LIMITS.maxResourceNames}\\b`));

  assert.match(resourceProfilesDialog, /^AppDialog \{/m);
  assert.match(resourceProfilesDialog, /property string scope: "session"/);
  assert.match(resourceProfilesDialog, /property string section: "tools"/);
  assert.match(resourceProfilesDialog, /\["session", "model", "global"\]/);
  assert.match(resourceProfilesDialog, /\["tools", "skills", "sampling"\]/);
  assert.match(functionBody(resourceProfilesDialog, "saveCurrent"), /setEnabledTools\(scope, listMode === "inherit" \? null : listDraft\.slice\(\)/);
  assert.match(functionBody(resourceProfilesDialog, "saveCurrent"), /setEnabledSkills\(scope, listMode === "inherit" \? null : listDraft\.slice\(\)/);
  assert.match(functionBody(resourceProfilesDialog, "chooseNone"), /listMode = "custom"[\s\S]*listDraft = \[\]/, "none is distinct from inherit");
  assert.match(functionBody(resourceProfilesDialog, "chooseInherit"), /listMode = "inherit"/);
  assert.match(functionBody(resourceProfilesDialog, "effectiveSource"), /field \+ "Source"/);
  assert.match(functionBody(resourceProfilesDialog, "listSummary"), /"Pi defaults"[\s\S]*"Intentionally none"/);
  assert.match(resourceProfilesDialog, /Effective " \+ dialog\.section[\s\S]*source:/);
  assert.match(resourceProfilesDialog, /Stored here: intentionally none/);
  assert.match(resourceProfilesDialog, /visibleInventory: inventoryForSection\(\)\.slice\(0, bridge\.maxResourceNames\)/);
  assert.match(resourceProfilesDialog, /Accessible\.role: Accessible\.CheckBox/);
  assert.match(resourceProfilesDialog, /Accessible\.checked: checked/);
  assert.match(resourceProfilesDialog, /Accessible\.role: Accessible\.PageTab/);
  assert.match(resourceProfilesDialog, /Accessible\.selected: active/);
  assert.match(resourceProfilesDialog, /enabled: dialog\.controlsEnabled/);
  assert.match(resourceProfilesDialog, /available && bridge\.ready && !bridge\.active/);
  assert.match(resourceProfilesDialog, /Pi is working\. Resource controls stay disabled/);
  assert.match(resourceProfilesDialog, /sessionDurability\.durable === false/);
  assert.match(resourceProfilesDialog, /not saved durably/);
  assert.match(resourceProfilesDialog, /Unsupported stored values remain saved but are not sent to the provider|Unsupported stored values remain saved/i);
  assert.match(resourceProfilesDialog, /enabled: dialog\.controlsEnabled && samplingRow\.supported/);
  assert.match(resourceProfilesDialog, /dialog\.samplingReason\(samplingRow\.modelData\)/);
  assert.match(resourceProfilesDialog, /stored here: " \+ stored \+ " \(preserved\)"/);
  for (const key of ["temperature", "top_p", "frequency_penalty", "presence_penalty", "seed", "top_k", "min_p"]) assert(resourceProfilesDialog.includes(key), `sampling control ${key}`);
  assert.match(shell, /ResourceProfilesDialog\s*\{[\s\S]*returnFocusItem:\s*composer/);
  assert.match(functionBody(shell, "openResourceProfiles"), /!bridge\.ready \|\| bridge\.active \|\| bridge\.modelActionPending \|\| bridge\.resourceActionPending/);
  assert.match(functionBody(shell, "runPaletteAction"), /case "resource-profiles": return root\.openResourceProfiles\(\)/);
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
  for (const roleName of ["rowId", "messageId", "role", "kind", "text", "blocksJson", "truncated", "streaming", "modeLabel", "attachments", "toolName", "toolSummary", "toolStatus", "toolDurationMs", "toolOutput", "toolError"]) {
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

test("composer exposes send, a steer/follow-up toggle, abort, and restart with keyboard paths", () => {
  assert.match(composer, /color:\s*theme\.composerSurface/);
  assert.match(composer, /border\.color:\s*prompt\.activeFocus \? theme\.focusRing : theme\.composerBorder/);
  assert.match(composer, /layer\.effect:\s*MultiEffect\s*\{[\s\S]*shadowColor:\s*composer\.theme\.composerShadow/);
  assert.match(composer, /id:\s*chip[\s\S]*width:\s*Math\.min\(implicitWidth, parent \? parent\.width : implicitWidth\)/);
  assert.match(composer, /id:\s*chipRow[\s\S]*anchors\.left:\s*parent\.left[\s\S]*anchors\.right:\s*parent\.right/);
  assert.match(composer, /Layout\.fillWidth:\s*true[\s\S]*Layout\.minimumWidth:\s*48[\s\S]*Layout\.maximumWidth:\s*240/);
  assert.match(composer, /signal sendRequested\(string text, string mode\)/);
  assert.match(composer, /property string busyPromptMode:\s*"steer"/);
  assert.match(functionBody(composer, "toggleBusyPromptMode"), /busyPromptMode = busyPromptMode === "steer" \? "followUp" : "steer"/);
  assert.match(composer, /composer\.trySend\(composer\.active \? composer\.busyPromptMode : "send"\)/);
  assert.match(composer, /composer\.trySend\(composer\.active \? "followUp" : "send"\)/);
  const modeButton = objectBodyContaining(composer, "AppButton", "id: busyPromptModeButton");
  assert.match(modeButton, /visible:\s*composer\.ready/);
  assert.match(modeButton, /text:\s*composer\.busyPromptMode === "steer" \? "Steer mode" : "Follow-up mode"/);
  assert.match(modeButton, /Accessible\.checked:\s*composer\.busyPromptMode === "followUp"/);
  assert.match(modeButton, /onClicked:\s*composer\.toggleBusyPromptMode\(\)/);
  const modeAction = objectBodyContaining(composer, "AppButton", "id: busyPromptActionButton");
  assert.match(modeAction, /visible:\s*composer\.active && composer\.ready/);
  assert.match(modeAction, /text:\s*composer\.busyPromptMode === "steer" \? "Steer" : "Queue"/);
  assert.match(modeAction, /onClicked:\s*composer\.trySend\(composer\.busyPromptMode\)/);
  assert.match(composer, /event\.modifiers & Qt\.ShiftModifier\) return/, "Shift+Enter must insert a new line");
  assert.match(composer, /Enter to send · Shift\+Enter for a new line/);
  assert.match(composer, /text:\s*composer\.active \? "Abort" : \(composer\.ready \? "Send" : "Restart"\)/);
  assert.match(composer, /enabled:\s*composer\.ready\b/);
  assert.match(composer, /overLimit/);
  assert.match(functionBody(composer, "trySend"), /if \(mode === "send" && active\) return/);
  assert.match(functionBody(bridge, "sendPrompt"), /promptMode === "send" && active/);
  assert.match(functionBody(bridge, "sendPrompt"), /message\.length > maxMessageCharacters/);
});

test("composer completion, attachments, drafts, and sequences never send by accident and stay bounded", () => {
  // Highlighted code: theme-owned colors, <pre> for whitespace, plain editor for selection, copy of the original text.
  assert.match(blocks, /property bool highlight:\s*true/);
  assert.match(functionBody(blocks, "styledCode"), /"<pre>"/);
  assert.match(functionBody(blocks, "styledCode"), /theme\.syntaxColor\(kind\)/);
  assert.doesNotMatch(functionBody(blocks, "styledCode"), /#[0-9a-fA-F]{3,8}\b/);
  assert.match(blocks, /readonly property bool highlighted:\s*root\.highlight && hasTokens && !selectable/);
  assert.match(blocks, /text:\s*codeBlock\.selectable \? "Highlight" : "Select text"/);
  assert.match(blocks, /onClicked:\s*root\.copyRequested\(block\.text \|\| ""\)/);
  assert.match(theme, /function syntaxColor\(kind\)/);
  for (const token of ["syntaxKeyword", "syntaxString", "syntaxComment", "syntaxNumber", "syntaxType", "syntaxFunction", "diffAdded", "diffRemoved"]) {
    assert.match(theme, new RegExp(`readonly property color ${token}\\b`), `theme token ${token}`);
  }
  assert.match(bridge, /property bool syntaxHighlighting:\s*true/);
  assert.match(shell, /highlightCode:\s*bridge\.syntaxHighlighting/);

  // Completion: accepting edits the text and never calls trySend or sendRequested.
  const accept = functionBody(composer, "acceptCompletion");
  assert.doesNotMatch(accept, /trySend|sendRequested/);
  assert.match(accept, /"\/" \+ String\(item\.value\) \+ " "/);
  assert.match(accept, /"@" \+ String\(item\.value\) \+ \(item\.directory === true \? "\/" : " "\)/);
  assert.match(composer, /if \(composer\.completionOpen\) \{[\s\S]*Qt\.Key_Down[\s\S]*Qt\.Key_Up[\s\S]*Qt\.Key_Escape[\s\S]*Qt\.Key_Tab \|\| event\.key === Qt\.Key_Return[\s\S]*acceptCurrentCompletion\(\)[\s\S]*event\.accepted = true[\s\S]*return/);
  assert.match(functionBody(composer, "completionContext"), /kind: "command"/);
  assert.match(functionBody(composer, "completionContext"), /token\.startsWith\("@"\)/);
  assert.match(completionPopup, /Accessible\.role:\s*Accessible\.List/);
  assert.match(completionPopup, /Accessible\.selected:\s*index === popup\.currentIndex/);
  assert.doesNotMatch(completionPopup, /sendRequested|trySend/);
  assert.match(functionBody(shell, "commandSuggestions"), /if \(items\.length >= 50\) break/);
  assert.match(shell, /Timer\s*\{[\s\S]*id:\s*pathCompletionTimer[\s\S]*interval:\s*120/);

  // Attachments: ids travel with the prompt, chips expose names and removal, the picker grants outside paths.
  assert.match(functionBody(bridge, "sendPrompt"), /"attachments": attachmentIds/);
  assert.match(functionBody(bridge, "sendPrompt"), /\["busy", "not_ready", "not_running"\]\.indexOf\(response\.error\.code\)/);
  assert.match(shell, /FileDialog\s*\{[\s\S]*fileMode:\s*FileDialog\.OpenFiles[\s\S]*bridge\.addAttachment\(root\.urlToPath\(url\), true\)/);
  assert.match(composer, /accessibleName:\s*"Remove attachment " \+ String\(chip\.modelData\.name\)/);
  assert.match(composer, /enabled:\s*composer\.attachments\.length < composer\.maxAttachments/);
  assert.equal(LIMITS.maxAttachments, 8);
  assert.match(row, /text:\s*"Attached: " \+ row\.attachments/);
  assert.match(textEditDialog, /function save\(\)[\s\S]*if \(answered \|\| overLimit\) return false/);

  // Drafts: saved after typing stops, restored only into an empty editor for the same key.
  assert.match(bridge, /readonly property string draftKey:\s*sessionFile\.length > 0 \? sessionFile : workspaceCwd/);
  assert.match(shell, /Timer\s*\{[\s\S]*id:\s*draftTimer[\s\S]*interval:\s*600[\s\S]*bridge\.saveDraft\(composer\.text\)/);
  assert.match(functionBody(shell, "restoreDraft"), /key !== bridge\.draftKey \|\| text\.length === 0 \|\| composer\.text\.trim\(\)\.length > 0\) return/);
  assert.match(functionBody(bridge, "saveDraftFor"), /boundedText\(String\(text \|\| ""\), 8192\)/);
  assert.equal(LIMITS.maxDraftCharacters, 8192);

  // Sequences: run only from the explicit action, delete needs confirmation, list actions never run.
  assert.match(functionBody(sequencesDialog, "deleteCurrent"), /if \(!confirmingDelete\) \{[\s\S]*confirmingDelete = true[\s\S]*return true/);
  assert.doesNotMatch(functionBody(sequencesDialog, "deleteCurrent"), /runSequence|runCurrent/);
  assert.doesNotMatch(functionBody(sequencesDialog, "moveCurrent"), /runSequence|runCurrent/);
  assert.doesNotMatch(functionBody(sequencesDialog, "saveEdit"), /runSequence|runCurrent/);
  assert.match(functionBody(sequencesDialog, "runCurrent"), /if \(!sequence \|\| busy \|\| !bridge\.ready \|\| bridge\.active\) return false/);
  assert.match(sequencesDialog, /text:\s*dialog\.confirmingDelete \? "Confirm delete" : "Delete"/);
  assert.match(sequencesDialog, /readonly property int maxEntries:\s*16/);
  assert.equal(LIMITS.maxSequenceEntries, 16);
  assert.match(functionBody(bridge, "runSequence"), /if \(!ready \|\| active\)/);
  assert.match(shell, /SequencesDialog\s*\{[\s\S]*returnFocusItem:\s*composer/);
});

test("tabs isolate session state, replay from the backend, confirm busy closes, and worktrees confirm their path", () => {
  const handler = functionBody(bridge, "handleEvent");
  assert.match(handler, /if \(typeof event\.tab === "string" && event\.tab !== activeTabId\) \{[\s\S]*handleInactiveTabEvent\(event\)[\s\S]*return/, "events from other tabs never touch the view");
  assert.match(functionBody(bridge, "request"), /if \(activeTabId\.length > 0 && frame\.tab === undefined\) frame\.tab = activeTabId/);
  const reset = functionBody(bridge, "resetTabState");
  for (const cleared of ["transcript.clear()", "visibleError = \"\"", "attachments = []", "steeringQueue = []", "dialogQueue = []", "activeDialog = null", "statusChips = []", "commandsLoaded = false"]) {
    assert(reset.includes(cleared), `resetTabState must include ${cleared}`);
  }
  assert.doesNotMatch(reset, /answerDialog|extension_response/, "switching tabs never answers another tab's dialogs");
  const applySnapshot = functionBody(bridge, "applySnapshot");
  assert.match(applySnapshot, /enqueueDialog\(dialog, false\)/);
  assert.match(applySnapshot, /typeof snapshot\.error === "string" && snapshot\.error\.trim\(\)\.length > 0 \? boundedError\(snapshot\.error\) : ""/, "empty snapshot errors stay empty");
  assert.match(functionBody(bridge, "enqueueDialog"), /dialogQueue\.some\(entry => entry\.requestId === requestId\)\) return false/, "snapshots never duplicate queued dialogs");
  assert.match(functionBody(bridge, "closeTab"), /"force": force === true/);
  assert.match(functionBody(bridge, "createWorktree"), /"confirmed": true/);
  assert.match(bridge, /readonly property string draftKey:\s*sessionFile\.length > 0 \? sessionFile : workspaceCwd/);
  assert.match(bridge, /case "tabs\.update":[\s\S]*beginTabSwitch\(event\.activeTab\)/);
  assert.match(bridge, /onExited:[\s\S]*bridge\.tabs = \[\][\s\S]*bridge\.activeTabId = ""/);
  assert.equal(LIMITS.maxTabs, 8);
  assert.match(bridge, /readonly property int maxTabs:\s*8/);

  // Shell: busy tabs confirm before closing, worktrees are planned then confirmed, sessions resume through the picker.
  assert.match(functionBody(shell, "closeTab"), /if \(tab\.active\) \{[\s\S]*destructive: true[\s\S]*action: "close-tab"/);
  assert.match(functionBody(shell, "closeTab"), /return bridge\.closeTab\(tabId, false\)/);
  assert.match(functionBody(shell, "confirmAccepted"), /bridge\.closeTab\(String\(context\.tabId\), true\)/);
  assert.match(functionBody(shell, "planWorktree"), /bridge\.planWorktree\(branch, response => \{[\s\S]*plan\.problems\.length > 0[\s\S]*confirmDialogItem\.present\(\{[\s\S]*detail: plan\.path/);
  assert.doesNotMatch(functionBody(shell, "planWorktree"), /createWorktree/, "planning never creates");
  assert.match(functionBody(shell, "confirmAccepted"), /bridge\.createWorktree\(context\.plan\.branch, context\.plan\.base, context\.plan\.path\)/);
  assert.match(functionBody(shell, "planWorktree"), /typeof branch !== "string"[\s\S]*worktreeDialogItem\.validate = root\.branchProblem[\s\S]*worktreeDialogItem\.present\(\)/, "the worktree action opens the split branch dialog");
  assert.match(worktreeDialog, /property var typeSuggestions:\s*\["feat", "fix", "change", "perf", "test", "chore", "refactor", "docs", "style", "build", "ci", "revert"\]/, "the editable type field shares pi-package-webui's conventional suggestions");
  assert.match(worktreeDialog, /ComboBox\s*\{[\s\S]*editable:\s*true[\s\S]*Accessible\.description:\s*"Choose a suggested type or enter a custom type"/, "branch type suggestions never restrict custom input");
  assert.match(worktreeDialog, /visible:\s*typeField\.editText\.length === 0[\s\S]*text:\s*"type"/, "the empty editable dropdown shows the type placeholder");
  assert.match(worktreeDialog, /readonly property string branch:\s*branchType\.length > 0 && branchName\.length > 0 \? branchType \+ "\/" \+ branchName : ""/, "type and name are visibly collected as one slash-separated branch");
  assert.match(functionBody(worktreeDialog, "present"), /currentIndex = -1[\s\S]*editText = ""[\s\S]*nameField\.text = ""/, "the type starts empty instead of defaulting to feat");
  assert.match(functionBody(worktreeDialog, "submit"), /if \(answered \|\| !valid\) return false[\s\S]*submitted\(branch\)/, "the split dialog only submits a valid combined branch");
  assert.match(shell, /WorktreeDialog\s*\{[\s\S]*onSubmitted:\s*branch => root\.planWorktree\(branch\)/);
  assert.match(functionBody(shell, "pickerPicked"), /kind === "session"[\s\S]*bridge\.switchSession\(value\)/);
  assert.match(functionBody(shell, "openSessionsPicker"), /if \(!bridge\.ready \|\| bridge\.active \|\| pickerDialogItem\.opened\) return false/);
  assert.match(functionBody(shell, "handleDraftKeyChanged"), /bridge\.saveDraftFor\(draftKeyInUse, composer\.text\)/, "the previous tab's draft is saved before switching");
  assert.match(shell, /TabStrip\s*\{[\s\S]*onSelectRequested:\s*tabId => bridge\.selectTab\(tabId\)[\s\S]*onCloseRequested:\s*tabId => root\.closeTab\(tabId\)/);
  assert.match(shell, /DirectoryDialog\s*\{[\s\S]*onChosen:\s*path => bridge\.openTab\(path, ""\)/);
  assert.match(shell, /Instantiator\s*\{[\s\S]*model:\s*8[\s\S]*sequence:\s*"Ctrl\+" \+ \(index \+ 1\)/);
  assert.match(emptyState, /signal resumeRequested\(\)/);

  // Dialogs: destructive confirmations focus Cancel first; input never submits invalid text;
  // the directory picker only leaves through Choose.
  assert.match(confirmDialog, /initialFocusItem:\s*destructive \? cancelButton : confirmButton/);
  assert.match(functionBody(confirmDialog, "confirm"), /if \(answered\) return false[\s\S]*answered = true[\s\S]*confirmed\(context\)/);
  assert.match(functionBody(inputDialog, "submit"), /if \(answered \|\| !valid\) return false/);
  assert.equal((directoryDialog.match(/chosen\(/g) ?? []).length, 3, "signal declaration plus the two explicit choose paths");
  assert.doesNotMatch(functionBody(directoryDialog, "navigateTo"), /chosen\(/);
  assert.doesNotMatch(functionBody(directoryDialog, "enterCurrent"), /chosen\(/);
  assert.match(directoryDialog, /Keys\.onPressed[\s\S]*Qt\.Key_Backspace && text\.length === 0[\s\S]*dialog\.up\(\)/);
  assert.match(tabStrip, /Accessible\.role:\s*Accessible\.PageTabList/);
  assert.match(tabStrip, /Accessible\.role:\s*Accessible\.PageTab\b/);
  assert.match(tabStrip, /Accessible\.selected:\s*current/);
  assert.match(tabStrip, /accessibleName:\s*"Close tab " \+ tabItem\.label/);
  assert.match(fixture, /"switch_session"/);
  assert.match(fixture, /"get_messages"/);
});

test("the palette, usage, events, and diagnostics stay keyboard-first, bounded, and never send", () => {
  assert.match(functionBody(shell, "paletteItems"), /push\("Recent"|recents\.indexOf\("action:" \+ action\[0\]\) !== -1 \? "Recent" : "Action"/);
  for (const group of ["Tab", "Model", "Session", "Pi command", "Skill"]) assert(functionBody(shell, "paletteItems").includes(`"${group}"`), `palette group ${group}`);
  assert.match(functionBody(shell, "openPalette"), /bridge\.loadModels[\s\S]*bridge\.listSessions[\s\S]*loadCommands/, "capability groups reload when the palette opens");
  const picked = functionBody(shell, "palettePicked");
  assert.match(picked, /kind === "command"[\s\S]*composer\.setText\("\/" \+ payload \+ " "\)/);
  assert.doesNotMatch(picked, /sendPrompt|trySend/, "the palette never sends a prompt");
  assert.match(picked, /kind === "skill"[\s\S]*confirmDialogItem\.present\(\{[\s\S]*action: "open-path"/, "skill files open only after confirmation");
  assert.match(functionBody(shell, "confirmAccepted"), /context\.action === "open-path"\) bridge\.openPath\(String\(context\.path\)\)/);
  assert.match(functionBody(shell, "runPaletteAction"), /case "toggle-compact": bridge\.updateSetting\("compactTranscript"/);
  assert.match(functionBody(shell, "runPaletteAction"), /case "cycle-appearance": return root\.cycleAppearanceMode\(\)/);
  assert.match(functionBody(shell, "runPaletteAction"), /case "toggle-reduced-motion": bridge\.updateSetting\("reducedMotion"/);
  assert.match(functionBody(shell, "cycleAppearanceMode"), /\["automatic", "light", "dark"\]/);
  assert.match(functionBody(shell, "palettePicked"), /bridge\.recordAction\(value\)/);
  assert.match(pickerDialog, /String\(item\.group \|\| ""\)/, "filtering also matches the group label");
  assert.match(functionBody(shell, "groupStatusChips"), /add\("Usage", \{ key: "context"/);
  assert.match(functionBody(shell, "groupStatusChips"), /tone: usage\.context\.percent >= 90 \? "error" : usage\.context\.percent >= 75 \? "warning" : ""/);
  assert.match(bridge, /readonly property int maxNotices:\s*200/);
  assert.equal(LIMITS.maxEventHistory, 200);
  assert.match(functionBody(bridge, "postNotice"), /noticeRevision\+\+/);
  assert.match(functionBody(bridge, "clearNotices"), /notices\.clear\(\)/);
  assert.match(bridge, /case "run\.end":[\s\S]*usageTimer\.restart\(\)/);
  assert.match(functionBody(eventsDialog, "collectEntries"), /previous\.count \+= 1/, "repeated events collapse");
  assert.match(eventsDialog, /model:\s*\["all", "info", "warning", "error"\]/);
  assert.match(functionBody(eventsDialog, "copyAll"), /bridge\.copyToClipboard/);
  assert.match(diagnosticsDialog, /TextEdit\s*\{[\s\S]*textFormat:\s*TextEdit\.PlainText[\s\S]*readOnly:\s*true/);
  assert.match(functionBody(diagnosticsDialog, "buildReport"), /Recent errors/);
  assert.match(shell, /EventsDialog\s*\{[\s\S]*returnFocusItem:\s*composer/);
  assert.match(shell, /DiagnosticsDialog\s*\{[\s\S]*returnFocusItem:\s*composer/);
  assert.match(fixture, /"get_session_stats"/);
});

test("controls carry accessible names, roles, and focus behavior", () => {
  assert.match(appButton, /Accessible\.role:\s*Accessible\.Button/);
  assert.match(appButton, /Accessible\.name:\s*accessibleName/);
  assert.match(appButton, /focusPolicy:\s*Qt\.StrongFocus/);
  assert.match(appButton, /border\.width:\s*control\.activeFocus \? control\.theme\.focusBorderWidth : control\.theme\.borderWidth/, "buttons reserve a stable semantic frame");
  assert.match(appButton, /HoverHandler\s*\{[\s\S]*Qt\.PointingHandCursor/);
  assert.match(appButton, /hoverEnabled:\s*true/);
  assert.match(appButton, /Accessible\.checked:\s*active/);
  assert.match(appButton, /interactionState:\s*down \? "pressed" : hovered \? "hovered" : "idle"/);
  assert.match(appButton, /filled \? theme\.filledButtonBackground\(variant, interactionState\)/);
  assert.match(appButton, /filled \? theme\.filledButtonForeground\(variant, interactionState\)/);
  assert.doesNotMatch(appButton, /Qt\.(lighter|darker)/, "component state colors stay theme-owned");
  assert.match(appButton, /active \? theme\.controlActive/);
  assert.match(appButton, /implicitHeight:\s*control\.theme\.controlHeight/);
  assert.match(statusSegment, /width:\s*Math\.min\(implicitWidth, availableWidth\)/);
  assert.match(statusSegment, /Flow\s*\{[\s\S]*id:\s*statusFlow/);
  assert.match(statusSegment, /width:\s*Math\.min\(implicitWidth, statusFlow\.width\)/);
  assert.match(statusSegment, /Layout\.fillWidth:\s*true[\s\S]*Layout\.minimumWidth:\s*48[\s\S]*elide:\s*Text\.ElideRight/);
  const responseControls = objectBodyContaining(shell, "RowLayout", "id: responseControls");
  assert.doesNotMatch(responseControls, /active:\s*bridge\.showThinking|updateSetting\("showThinking"/, "the visible thinking-section toggle leaves the response controls");
  assert.match(shell, /sequence:\s*"Ctrl\+T"[\s\S]*updateSetting\("showThinking"/, "the thinking visibility shortcut remains");
  assert.match(functionBody(shell, "runPaletteAction"), /case "toggle-thinking": bridge\.updateSetting\("showThinking"/, "the palette thinking visibility action remains");
  assert.match(shell, /showThinking:\s*bridge\.showThinking/, "transcript filtering remains wired");
  assert.match(responseControls, /active:\s*bridge\.compactTranscript/);
  assert.match(responseControls, /text:\s*bridge\.compactTranscript \? "Compact" : "Detailed"/);
  for (const [name, source] of [["composer", composer], ["searchBar", searchBar], ["toolCard", toolCard], ["row", row], ["statusBadge", statusBadge], ["noticeBar", noticeBar], ["emptyState", emptyState], ["blocks", blocks]]) {
    assert.match(source, /Accessible\.(role|name)/, `${name} should describe itself to assistive technology`);
  }
  assert.match(searchBar, /Keys\.onPressed[\s\S]*Qt\.Key_Escape[\s\S]*bar\.closeRequested\(\)/);
  assert.match(searchBar, /event\.modifiers & Qt\.ShiftModifier\) bar\.previousRequested\(\)/);
  assert.match(row, /Accessible\.name:\s*roleLabel/);
  assert.match(row, /!row\.fromUser && row\.kind !== "thinking" && !row\.searchCurrent\) \? row\.theme\.transparent/);
  assert.match(row, /row\.fromUser \|\| row\.kind === "thinking" \? 1 : 0/);
  for (const [name, source] of [["drop-up", dropUpPicker], ["completion", completionPopup], ["tabs", tabStrip], ["picker", pickerDialog], ["extension", extensionDialog], ["directory", directoryDialog], ["sequences", sequencesDialog], ["events", eventsDialog]]) {
    assert.match(source, /interactiveFill\(/, `${name} rows should expose semantic hover, pressed, and selected fills`);
    assert.match(source, /interactiveBorder\(/, `${name} rows should expose a semantic keyboard focus border`);
  }
  assert.match(tabStrip, /activeFocusOnTab:\s*true/);
  assert.match(tabStrip, /Keys\.onSpacePressed:/);
  assert.match(workingIndicator, /running:\s*indicator\.running && !indicator\.theme\.reducedMotion/);
  assert.match(workingIndicator, /opacity:\s*indicator\.theme\.reducedMotion \? 1\.0 : 0\.3/);
});

test("smoke driver and fixture cover every recorded protocol edge", () => {
  for (const marker of [
    "QT_WEBUI_SMOKE_BACKEND_READY", "QT_WEBUI_SMOKE_READY", "QT_WEBUI_SMOKE_THEME_LIGHT_OVERRIDE", "QT_WEBUI_SMOKE_THEME_DARK_OVERRIDE", "QT_WEBUI_SMOKE_THEME_AUTOMATIC", "QT_WEBUI_SMOKE_REDUCED_MOTION", "QT_WEBUI_SMOKE_STREAM_RECONCILED", "QT_WEBUI_SMOKE_THINKING_RENDERED",
    "QT_WEBUI_SMOKE_TOOL_CARD", "QT_WEBUI_SMOKE_MARKDOWN_RENDERED", "QT_WEBUI_SMOKE_LINK_CONFIRMED", "QT_WEBUI_SMOKE_SEARCH_MATCHED",
    "QT_WEBUI_SMOKE_PROVIDER_ERROR_PRESERVED", "QT_WEBUI_SMOKE_FAILED_RESPONSE_RECOVERED", "QT_WEBUI_SMOKE_DELAYED_ABORT_RECEIPT",
    "QT_WEBUI_SMOKE_TRANSCRIPT_BOUNDED", "QT_WEBUI_SMOKE_SETTINGS_PERSISTED", "QT_WEBUI_SMOKE_CODE_HIGHLIGHTED", "QT_WEBUI_SMOKE_COMMANDS_LOADED",
    "QT_WEBUI_SMOKE_COMMAND_COMPLETED", "QT_WEBUI_SMOKE_PATH_COMPLETED", "QT_WEBUI_SMOKE_ATTACHMENT_ADDED", "QT_WEBUI_SMOKE_ATTACHMENT_SENT",
    "QT_WEBUI_SMOKE_DRAFT_PERSISTED", "QT_WEBUI_SMOKE_SEQUENCE_RUN", "QT_WEBUI_SMOKE_SEQUENCE_DELETED", "QT_WEBUI_SMOKE_ACTIVE_PICKER_INVALIDATED", "QT_WEBUI_SMOKE_STALE_PICKER_RESULT_REFUSED", "QT_WEBUI_SMOKE_PICKER_LOADING_RECOVERED", "QT_WEBUI_SMOKE_REAL_LIST_ARROW_SELECTION", "QT_WEBUI_SMOKE_MODEL_DROPUP_BOUNDED", "QT_WEBUI_SMOKE_MODEL_DROPUP_FOCUS_RETURNED", "QT_WEBUI_SMOKE_MODEL_PICKER", "QT_WEBUI_SMOKE_MODEL_SELECTED",
    "QT_WEBUI_SMOKE_TAB_OPENED", "QT_WEBUI_SMOKE_TAB_PICKER_INVALIDATED", "QT_WEBUI_SMOKE_TAB_PICKER_LOADING_RECOVERED", "QT_WEBUI_SMOKE_STALE_RESOURCE_READ_IGNORED", "QT_WEBUI_SMOKE_STALE_RESOURCE_MUTATION_IGNORED", "QT_WEBUI_SMOKE_TAB_SWITCHED", "QT_WEBUI_SMOKE_SESSION_RESUMED", "QT_WEBUI_SMOKE_SESSION_NEW", "QT_WEBUI_SMOKE_DIRECTORY_PICKED",
    "QT_WEBUI_SMOKE_WORKTREE_CREATED", "QT_WEBUI_SMOKE_TAB_CLOSED", "QT_WEBUI_SMOKE_USAGE_LOADED", "QT_WEBUI_SMOKE_PALETTE_ACTION",
    "QT_WEBUI_SMOKE_EVENTS_LISTED", "QT_WEBUI_SMOKE_DIAGNOSTICS_SHOWN",
    "QT_WEBUI_SMOKE_THINKING_DROPUP_BOUNDED", "QT_WEBUI_SMOKE_THINKING_DROPUP_FOCUS_RETURNED", "QT_WEBUI_SMOKE_THINKING_PICKER", "QT_WEBUI_SMOKE_MODEL_CYCLED", "QT_WEBUI_SMOKE_THINKING_CYCLED", "QT_WEBUI_SMOKE_CONTEXT_COMPACTED",
    "QT_WEBUI_SMOKE_RESOURCES_LOADED", "QT_WEBUI_SMOKE_RESOURCE_TOOLS_NONE", "QT_WEBUI_SMOKE_RESOURCE_SKILLS_ENABLED", "QT_WEBUI_SMOKE_RESOURCE_SAMPLING_SAVED", "QT_WEBUI_SMOKE_RESOURCE_UNSUPPORTED_PRESERVED",
    "QT_WEBUI_SMOKE_FAILED_STATE_RECOVERABLE",
    "QT_WEBUI_SMOKE_MISSING_STATE_RECOVERABLE", "QT_WEBUI_SMOKE_RESTART_RECEIPT", "QT_WEBUI_SMOKE_BACKEND_CRASH_OBSERVED",
    "QT_WEBUI_SMOKE_BACKEND_CRASH_RECOVERED", "QT_WEBUI_SMOKE_COMPLETE",
  ]) assert.match(smoke, new RegExp(marker), `driver should log ${marker}`);
  assert.match(functionBody(smoke, "startAppearanceChecks"), /updateSetting\("appearanceMode", "light"\)/);
  assert.match(smoke, /appearance-dark[\s\S]*updateSetting\("appearanceMode", "dark"\)/);
  assert.match(smoke, /appearance-reduced[\s\S]*updateSetting\("reducedMotion", true\)/);
  assert.match(smoke, /appearance-automatic[\s\S]*updateSetting\("appearanceMode", "automatic"\)/);
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
