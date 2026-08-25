import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const qmlRoot = path.join(root, "qml");
const [shell, bridge, composer, message, theme, fixture] = await Promise.all([
  readFile(path.join(qmlRoot, "shell.qml"), "utf8"),
  readFile(path.join(qmlRoot, "PiBridge.qml"), "utf8"),
  readFile(path.join(qmlRoot, "components", "Composer.qml"), "utf8"),
  readFile(path.join(qmlRoot, "components", "ChatMessage.qml"), "utf8"),
  readFile(path.join(qmlRoot, "Theme.qml"), "utf8"),
  readFile(path.join(root, "tests", "fixtures", "fake-pi-rpc.mjs"), "utf8"),
]);

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

test("shell provides one standard Qt WebUI window with the version 1 controls", () => {
  assert.equal((shell.match(/\bFloatingWindow\s*\{/g) ?? []).length, 1);
  assert.match(shell, /title:\s*"Qt WebUI"/);
  assert.match(shell, /implicitWidth:\s*760/);
  assert.match(shell, /implicitHeight:\s*720/);
  assert.match(shell, /surfaceFormat\.opaque:\s*true/);
  assert.match(shell, /parent:\s*window\.contentItem/);
  assert.match(shell, /text:\s*bridge\.callerCwd/);
  assert.match(shell, /text:\s*bridge\.runtimeInfoText/);
  assert.match(shell, /appTheme\.statusBackground\(bridge\.statusKind\)/);
  assert.match(shell, /appTheme\.statusBorder\(bridge\.statusKind\)/);
  assert.match(shell, /appTheme\.statusForeground\(bridge\.statusKind\)/);
  for (const statusKind of ["ready", "running", "tool", "error"]) {
    assert.match(theme, new RegExp(`kind === "${statusKind}"`));
  }
  assert.match(shell, /Composer\s*\{/);
  assert.match(composer, /TextArea\s*\{/);
  assert.match(composer, /composer\.active \? "Abort"/);
  assert.match(composer, /composer\.ready \? "Send" : "Restart"/);
  assert.match(composer, /activeFocus/);
  assert.match(composer, /ColorAnimation \{ duration: 100 \}/);
});

test("shared semantic theme follows the system color scheme", () => {
  assert.match(theme, /Qt\.styleHints\.colorScheme\s*===\s*Qt\.Dark/);
  assert.match(theme, /requestedMode === "dark"/);
  assert.match(theme, /requestedMode !== "light"/);
  assert.match(theme, /portalMode === "dark"/);
  assert.match(theme, /portalMode !== "light"/);
  assert.match(theme, /readonly property color windowBackground/);
  assert.match(theme, /readonly property color foreground/);
  assert.match(theme, /readonly property color accent/);
  assert.match(shell, /\bTheme\s*\{/);
  assert.equal((shell.match(/theme:\s*appTheme/g) ?? []).length, 2);
  assert.match(shell, /QT_WEBUI_SMOKE_THEME_/);
  for (const [name, source] of [["shell", shell], ["Composer", composer], ["ChatMessage", message]]) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, `${name} should use semantic theme roles`);
  }
});

test("dynamic cwd, runtime metadata, markup-like status, and transcript content render as plain text", () => {
  const cwdLabel = objectBodyContaining(shell, "Label", "text: bridge.callerCwd");
  const runtimeInfoLabel = objectBodyContaining(shell, "Label", "text: bridge.runtimeInfoText");
  const statusLabel = objectBodyContaining(shell, "Label", "text: bridge.statusText");
  assert.match(cwdLabel, /textFormat:\s*Text\.PlainText/);
  assert.match(runtimeInfoLabel, /textFormat:\s*Text\.PlainText/);
  assert.match(runtimeInfoLabel, /elide:\s*Text\.ElideRight/);
  assert.match(statusLabel, /textFormat:\s*Text\.PlainText/);
  assert.match(fixture, /toolName: "<b>read<\/b>"/);
  assert.match(bridge, /maxTranscriptRows:\s*80/);
  assert.match(bridge, /maxMessageCharacters:\s*8192/);
  assert.match(functionBody(bridge, "appendMessage"), /transcript\.count >= maxTranscriptRows/);
  assert.match(functionBody(bridge, "boundedText"), /slice\(0, maxMessageCharacters - 1\)/);
  assert.match(functionBody(bridge, "boundedRuntimeInfoValue"), /maxRuntimeInfoCharacters/);
  assert.match(functionBody(bridge, "updateRuntimeInfo"), /model\.provider/);
  assert.match(functionBody(bridge, "updateRuntimeInfo"), /model\.id/);
  assert.match(functionBody(bridge, "updateRuntimeInfo"), /thinkingLevel/);
  assert.match(bridge, /currentProvider \+ "\/" \+ currentModelId \+ " · thinking " \+ currentThinkingLevel/);
  assert.match(fixture, /provider: "fixture-provider", id: "fixture-model"/);
  assert.match(fixture, /thinkingLevel: "high"/);
  assert.match(message, /required property string messageRole/);
  assert.match(message, /required property string messageText/);
  assert.match(message, /textFormat:\s*Text\.PlainText/);
  assert.doesNotMatch(message, /RichText|Markdown/);
});

test("Pi process uses the launcher environment contract and strict LF JSONL", () => {
  assert.match(bridge, /command:\s*\[\s*String\(Quickshell\.env\("QT_WEBUI_NODE_EXECUTABLE"\)/);
  assert.match(bridge, /String\(Quickshell\.env\("QT_WEBUI_PI_CLI_ENTRY"\)/);
  assert.match(bridge, /"--mode",\s*"rpc"/);
  assert.match(bridge, /workingDirectory:\s*bridge\.callerCwd/);
  assert.match(bridge, /stdinEnabled:\s*true/);
  assert.equal((bridge.match(/splitMarker:\s*"\\n"/g) ?? []).length, 2);

  const send = functionBody(bridge, "sendCommand");
  assert.match(send, /rpcProcess\.write\(JSON\.stringify\(value\) \+ "\\n"\)/);
  assert.doesNotMatch(bridge, /\beval\s*\(|new Function|Qt\.openUrlExternally|execDetached/);
});

test("RPC reducer strips one CR, parses defensively, ignores unknown records, and reconciles final text", () => {
  const line = functionBody(bridge, "handleLine");
  assert.match(line, /endsWith\("\\r"\)/);
  assert.match(line, /line = line\.slice\(0, -1\)/);
  assert.match(line, /try\s*\{/);
  assert.match(line, /JSON\.parse\(line\)/);
  assert.match(line, /catch \(error\)/);

  const record = functionBody(bridge, "handleRecord");
  for (const eventType of [
    "response", "agent_start", "agent_settled", "message_update", "message_end",
    "tool_execution_start", "tool_execution_end", "extension_error", "extension_ui_request",
  ]) assert.match(record, new RegExp(`case "${eventType}"`));
  assert.match(record, /default:\s*\n\s*break/);
  assert.match(functionBody(bridge, "handleMessageUpdate"), /update\.type !== "text_delta"/);
  assert.match(functionBody(bridge, "handleMessageEnd"), /replaceMessage\(streamingRow, finalText\)/);
});

test("blocking extension dialogs are cancelled without approval", () => {
  const body = functionBody(bridge, "handleExtensionRequest");
  for (const method of ["select", "confirm", "input", "editor"]) {
    assert.match(body, new RegExp(`event\\.method === "${method}"`));
  }
  assert.match(body, /"type": "extension_ui_response"/);
  assert.match(body, /"id": event\.id/);
  assert.match(body, /"cancelled": true/);
  assert.doesNotMatch(body, /confirmed:\s*true|cancelled:\s*false/);
});

test("prompt acceptance, provider errors, and settlement have bounded reconciliation paths", () => {
  const response = functionBody(bridge, "handleResponse");
  assert.match(response, /event\.id === pendingPromptId/);
  assert.match(response, /promptReconciliationTimer\.start\(\)/);
  assert.match(bridge, /id: promptReconciliationTimer/);
  assert.match(bridge, /interval: bridge\.promptReconciliationMilliseconds/);
  assert.match(functionBody(bridge, "handleMessageEnd"), /stopReason === "error"/);
  assert.match(functionBody(bridge, "handleMessageEnd"), /errorMessage \|\| "Pi provider request failed"/);
  assert.match(bridge, /statusKind = preserveRunError \? "error" : "ready"/);
});

test("prompt, abort, startup deadline, process exit, and restart have explicit guarded paths", () => {
  assert.match(functionBody(bridge, "sendPrompt"), /!ready \|\| active \|\| !rpcProcess\.running/);
  assert.match(functionBody(bridge, "sendPrompt"), /"type": "prompt", "message": message/);
  assert.match(functionBody(bridge, "abortRun"), /!active \|\| !rpcProcess\.running/);
  assert.match(functionBody(bridge, "abortRun"), /pendingPromptCancellation = true/);
  assert.match(functionBody(bridge, "abortRun"), /"type": "abort"/);
  assert.match(bridge, /case "agent_start":[\s\S]*if \(pendingPromptCancellation\)[\s\S]*pendingPromptCancellation = false[\s\S]*"type": "abort"/);
  assert.match(functionBody(bridge, "sendPrompt"), /pendingPromptCancellation = false/);
  assert.match(functionBody(bridge, "restartProcess"), /restartPending \|\| \(rpcProcess\.running && ready\)/);
  assert.match(functionBody(bridge, "restartProcess"), /restartPending = true[\s\S]*rpcProcess\.running = false/);
  assert.match(functionBody(bridge, "restartProcess"), /clearRuntimeInfo\(\)/);
  assert.match(functionBody(bridge, "handleResponse"), /event\.success !== true[\s\S]*clearRuntimeInfo\(\)/);
  assert.match(bridge, /onStarted:[\s\S]*clearRuntimeInfo\(\)[\s\S]*onExited:[\s\S]*clearRuntimeInfo\(\)/);
  assert.match(bridge, /id: startupReadinessTimer/);
  assert.match(bridge, /"Pi did not report readiness in time"/);
  assert.match(bridge, /if \(bridge\.restartPending\)[\s\S]*rpcProcess\.running = true/);
  assert.match(bridge, /onExited:\s*\(exitCode, exitStatus\)/);
  assert.match(bridge, /statusKind = exitCode === 0 \? "stopped" : "error"/);
});

test("fake RPC fixture declares every live protocol edge exercised by smoke", () => {
  assert.match(fixture, /\{malformed rpc record\}/);
  assert.match(fixture, /future_unknown_event/);
  assert.match(fixture, /"\\r\\n"/);
  assert.match(fixture, /deterministic prompt rejection/);
  assert.match(fixture, /__QT_WEBUI_IMMEDIATE__/);
  assert.match(fixture, /__QT_WEBUI_DELAYED_ABORT__/);
  assert.match(fixture, /setTimeout\(\(\) => \{[\s\S]*activeAbort = true;[\s\S]*type: "agent_start"/);
  assert.match(fixture, /QT_WEBUI_SMOKE_DELAYED_AGENT_ABORTED/);
  assert.match(fixture, /stopReason: "error"/);
  assert.match(fixture, /deterministic provider failure/);
  assert.match(fixture, /failed-state/);
  assert.match(fixture, /missing-state/);
  assert.match(fixture, /text: "authoritative final"/);
  assert.match(fixture, /for \(const method of \["select", "confirm", "input", "editor"\]\)/);
  assert.match(fixture, /"x"\.repeat\(10_000\)/);
  assert.match(fixture, /process\.exit\(23\)/);
});
