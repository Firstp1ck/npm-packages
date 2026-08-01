import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

function functionBody(name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`, "m");
  const match = signature.exec(app);
  assert.ok(match, `${name} should remain a standalone frontend helper`);
  let parenDepth = 0;
  let openBrace = -1;
  for (let index = match.index + match[0].length - 1; index < app.length; index += 1) {
    const char = app[index];
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === "{" && parenDepth === 0) {
      openBrace = index;
      break;
    }
  }
  assert.notEqual(openBrace, -1, `${name} body should open`);
  let depth = 0;
  for (let index = openBrace; index < app.length; index += 1) {
    const char = app[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return app.slice(openBrace + 1, index);
    }
  }
  assert.fail(`${name} body should close`);
}

const captureControl = functionBody("captureScopedControlContinuity");
const restoreControl = functionBody("restoreScopedControlContinuity");
const setScroll = functionBody("setScopedScrollContinuity");
const rememberScroll = functionBody("rememberScopedScrollContinuity");
const bindScroll = functionBody("bindScopedScrollContinuity");
const restoreScroll = functionBody("restoreScopedScrollContinuity");
const deferPointer = functionBody("deferUiRenderDuringPointerActivation");
const deferSurface = functionBody("deferUiRenderDuringInteractiveSurface");
const flushDeferred = functionBody("flushDeferredUiRenders");
const captureTooltip = functionBody("captureTooltipContinuity");
const restoreTooltip = functionBody("restoreTooltipContinuity");
const renderTabs = functionBody("renderTabs");
const renderFooter = functionBody("renderFooter");
const renderFileTree = functionBody("renderFileTree");
const renderWidgets = functionBody("renderWidgets");
const renderSubagents = functionBody("renderSubagents");
const renderGitWorkflow = functionBody("renderGitWorkflow");
const renderGitPanel = functionBody("renderGitPanel");
const renderQueue = functionBody("renderQueue");
const captureChatText = functionBody("captureChatTextSelection");
const matchChatText = functionBody("chatTextSelectionMatch");
const restoreChatText = functionBody("restoreChatTextSelection");
const renderAllMessages = functionBody("renderAllMessages");
const renderStreamingMarkdown = functionBody("renderStreamingMarkdown");
const refreshMessages = functionBody("refreshMessages");
const captureMobileSurface = functionBody("captureMobileSurfaceRenderFocus");
const restoreMobileSurface = functionBody("restoreMobileSurfaceRenderFocus");
const captureAppRunnerInput = functionBody("captureAppRunnerInputFocus");
const restoreAppRunnerInput = functionBody("restoreAppRunnerInputFocus");
const captureGitInput = functionBody("captureGitWorkflowInputFocus");
const restoreGitInput = functionBody("restoreGitWorkflowInputFocus");

assert.match(captureControl, /root\?\.contains\(source\)/, "control capture must be scoped to the renderer root");
assert.match(captureControl, /const targetKey = targetKeyFor\?\.\(source\);[\s\S]*if \(!targetKey\) return null;/, "control capture requires a semantic target key");
assert.match(captureControl, /contextKey,[\s\S]*selectionStart:[\s\S]*selectionEnd:[\s\S]*selectionDirection:[\s\S]*scrollTop:[\s\S]*scrollLeft:/, "control snapshots must retain context, selection direction, and both control scroll axes");
assert.match(restoreControl, /snapshot\.contextKey !== contextKey \|\| document\.activeElement === snapshot\.source/, "restore must reject mismatched contexts and leave an already-focused surviving source alone");
assert.match(restoreControl, /isMeaningfulConnectedFocus\(document\.activeElement\)/, "restore must not steal focus from a meaningful connected target");
assert.match(restoreControl, /snapshot\.source\.isConnected && root\?\.contains\(snapshot\.source\)[\s\S]*targetForKey\?\.\(snapshot\.targetKey\)[\s\S]*root\?\.contains\(target\)[\s\S]*target\.disabled/, "restore must prefer a surviving reattached control or resolve a valid replacement inside its root");
assert.match(restoreControl, /target\.focus\(\{ preventScroll: true \}\)[\s\S]*setSelectionRange\(start, end, snapshot\.selectionDirection \|\| "none"\)/, "restore must restore focus and directional selection without scrolling the page");
assert.match(restoreControl, /target\.scrollTop = Math\.min[\s\S]*target\.scrollLeft = Math\.min/, "restore must bound control scroll rather than applying stale offsets blindly");

assert.match(captureTooltip, /footerTooltipTarget \|\| footerTooltipPendingTarget[\s\S]*root\?\.contains\(target\)[\s\S]*tooltipTargetKey\(target\)[\s\S]*target\.matches\?\.\(":hover"\)[\s\S]*remainingDelay:/, "tooltip capture must use a root-local semantic target and retain any in-progress hover delay");
assert.match(restoreTooltip, /querySelectorAll\?\.\("\[data-tooltip-target-key\]"\)[\s\S]*tooltipTargetKey\(node\) === snapshot\.key/, "tooltip restore must find the semantic replacement rather than reusing detached DOM");
assert.match(restoreTooltip, /!target \|\| !target\.hasAttribute\("data-tooltip"\)[\s\S]*hideFooterTooltip\(snapshot\.target\)/, "removed or inapplicable tooltip targets must close the old tooltip");
assert.match(restoreTooltip, /snapshot\.pending\) scheduleFooterTooltip\(target, snapshot\.remainingDelay\)[\s\S]*showFooterTooltip\(target\)/, "surviving visible tooltips must rebind synchronously while pending tooltips retain only their remaining delay");

assert.match(setScroll, /scopedScrollContinuityByKey\.delete\(key\)[\s\S]*size > SCOPED_SCROLL_CONTINUITY_LIMIT[\s\S]*keys\(\)\.next\(\)\.value/, "scroll continuity must use bounded recency storage");
assert.match(rememberScroll, /!node\?\.isConnected \|\| !key[\s\S]*const previous = scopedScrollContinuityByKey\.get\(key\);[\s\S]*preserveMode && previous \? previous\.mode : maxScrollTop - node\.scrollTop <= 24 \? "follow-end" : "position"/, "scroll capture must ignore detached stale emitters and latch reader mode across programmatic renders");
assert.match(bindScroll, /dataset\.continuityScrollKey = key[\s\S]*_scopedScrollContinuityUserIntentUntil[\s\S]*rememberScopedScrollContinuity\(node, undefined, \{ allowPendingRestore: userInitiated, preserveMode: !userInitiated \}\)/, "scroll listeners must resolve the current semantic key and only change mode after user intent");
assert.match(restoreScroll, /requestAnimationFrame[\s\S]*state\.mode === "follow-end" \? maxScrollTop : Math\.min/, "scroll restore must apply its mode after layout and bound a retained position");
assert.match(app, /bindScopedScrollContinuity\(terminal, scrollKey\)[\s\S]*restoreScopedScrollContinuity\(terminal, scrollKey\)/, "app-runner output must participate in explicit scroll continuity");
assert.match(app, /bindScopedScrollContinuity\(transcript, scrollKey\)[\s\S]*restoreScopedScrollContinuity\(transcript, scrollKey\)/, "subagent transcript output must participate in explicit scroll continuity");

assert.match(deferPointer, /shouldDeferUiRenderForPointerActivation\(\)[\s\S]*deferredUiRenderCallbacks\.set\(key, callback\)/, "pointer-active updates must defer through a latest-wins keyed callback map");
assert.match(deferSurface, /isInteractiveDropdownOpen\(\)[\s\S]*deferredUiRenderCallbacks\.set\(key, callback\)[\s\S]*scheduleDeferredUiFlushAfterDropdownClose\(\)/, "open interactive surfaces must defer their invalidation until they close");
assert.match(flushDeferred, /\[\.\.\.deferredUiRenderCallbacks\.values\(\)\][\s\S]*deferredUiRenderCallbacks\.clear\(\)[\s\S]*for \(const callback of callbacks\)/, "deferred renders must coalesce and flush each retained callback once");

for (const [name, source, root] of [
  ["terminal tabs", renderTabs, "elements.tabBar"],
  ["footer", renderFooter, "elements.statusBar"],
  ["file tree", renderFileTree, "root"],
  ["widgets", renderWidgets, "elements.widgetArea"],
  ["subagent panel", renderSubagents, "box"],
]) {
  assert.match(source, /deferUiRenderDuringPointerActivation/, `${name} must participate in primary-pointer deferral`);
  assert.match(source, /captureScopedControlContinuity|captureScopedScrollContinuity/, `${name} must capture only its own continuity state`);
  if (name === "terminal tabs" || name === "footer" || name === "file tree" || name === "subagent panel") {
    assert.match(source, new RegExp(`restoreScopedControlContinuity\\(${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `${name} must restore through its own root`);
  }
}
assert.match(renderTabs, /captureTooltipContinuity\(elements\.tabBar\)[\s\S]*restoreTooltipContinuity\(elements\.tabBar, tooltipSnapshot\)/, "terminal-tab rerenders must retain semantic tooltip continuity");
assert.match(renderFooter, /captureTooltipContinuity\(elements\.statusBar\)[\s\S]*restoreTooltipContinuity\(elements\.statusBar, tooltipSnapshot\)/, "footer rerenders must retain semantic tooltip continuity");
assert.match(renderGitWorkflow, /captureGitWorkflowInputFocus\(\)[\s\S]*deferUiRenderDuringPointerActivation\("git-workflow", renderGitWorkflow\)[\s\S]*restoreGitWorkflowInputFocus\(inputFocus\)/, "guided Git renders must defer pointer teardown and restore only their captured input");

assert.match(captureAppRunnerInput, /activeTabContext\(\)[\s\S]*selectionDirection:[\s\S]*scrollTop:[\s\S]*scrollLeft:/, "app-runner input capture must include its tab context and complete text-control state");
assert.match(restoreAppRunnerInput, /isCurrentTabContext\(state\.context\) \|\| state\.source\?\.isConnected/, "app-runner input restore must reject stale tab contexts and connected sources");
assert.match(restoreAppRunnerInput, /isMeaningfulConnectedFocus\(document\.activeElement\)[\s\S]*elements\.widgetArea\.querySelectorAll\("\.app-runner-stdin-input"\)[\s\S]*candidate\.dataset\.runId === state\.runId/, "app-runner input restore must stay inside the widget root and match runner identity");
assert.match(captureGitInput, /activeTabContext\(\)[\s\S]*selectionDirection:[\s\S]*scrollTop:[\s\S]*scrollLeft:/, "Guided Git input capture must include its context and complete text-control state");
assert.match(restoreGitInput, /state\.tabId !== activeTabId \|\| state\.runId !== gitWorkflow\?\.runId \|\| !isCurrentTabContext\(state\.context\) \|\| state\.source\?\.isConnected/, "Guided Git input restore must require the exact tab, run, and current context");

assert.match(renderGitPanel, /captureScopedControlContinuity\(elements\.gitPanelGroups[\s\S]*data-git-panel-continuity-key[\s\S]*scrollTop = scrollTop/, "Git-panel rebuilds must preserve semantic focus and panel scroll");
assert.match(renderQueue, /captureScopedControlContinuity\(elements\.queueBox[\s\S]*data-queue-continuity-key[\s\S]*restoreContinuity\(\)/, "queue rebuilds must preserve semantic action focus and panel scroll");
assert.match(app, /dataset\.mobileContinuityKey = "context:paste-text"[\s\S]*dataset\.mobileDraftAuthority = "dom"/, "mobile paste text must have a stable DOM-authoritative continuity identity");
assert.match(captureMobileSurface, /mobileDraftAuthority === "dom"[\s\S]*selectionDirection:[\s\S]*scrollTop:[\s\S]*scrollLeft:/, "mobile DOM drafts must capture selection and scroll state");
assert.match(restoreMobileSurface, /target\.dataset\.mobileDraftAuthority === "dom"[\s\S]*target\.value = snapshot\.value[\s\S]*setSelectionRange[\s\S]*target\.focus\(\{ preventScroll: true \}\)/, "mobile DOM drafts must restore value, selection, scroll, and focus");

assert.match(captureChatText, /selection\.isCollapsed[\s\S]*anchorSurface !== focusSurface[\s\S]*chatTextSelectionContextKey\(\)[\s\S]*itemKey:[\s\S]*streaming:[\s\S]*anchorOffset,[\s\S]*focusOffset,[\s\S]*text,/, "main-output selection capture must require one semantic text surface and retain context, identity, direction, and exact text");
assert.match(matchChatText, /range\.toString\(\) === snapshot\.text/, "main-output selection restoration must reject offsets whose rendered text changed");
assert.match(restoreChatText, /snapshot\.contextKey !== chatTextSelectionContextKey\(\)[\s\S]*chatTextSelectionCandidates\(snapshot\)[\s\S]*candidates\.includes\(currentAnchorSurface\)[\s\S]*currentText && currentAnchorSurface && currentFocusSurface[\s\S]*setBaseAndExtent/, "main-output selection restoration must reject stale contexts and meaningful newer selections while preserving anchor direction");
assert.match(renderStreamingMarkdown, /captureChatTextSelection\(block\)[\s\S]*restoreChatTextSelection\(selectionSnapshot\)/, "streaming Markdown tail replacement must preserve a still-valid browser Range");
assert.match(renderAllMessages, /captureChatTextSelection\(\)[\s\S]*restoreChatTextSelection\(selectionSnapshot\)/, "authoritative transcript rerenders must preserve a still-valid main-output Range");
assert.match(refreshMessages, /const selectionSnapshot = captureChatTextSelection\(\);[\s\S]*resetStreamBubble\(\)[\s\S]*restoreStreamRenderAfterChatRebuild\(\)[\s\S]*restoreChatTextSelection\(selectionSnapshot\)/, "stream settlement must carry selection from the live output into the matching authoritative message");

console.log("interaction-state-stability-static.test.mjs passed");
