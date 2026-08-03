import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, css, app] = await Promise.all([
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
]);

assert.match(
  html,
  /id="followUpQueueTrigger"[^>]*aria-controls="followUpQueueOverlay"[^>]*aria-expanded="false"[\s\S]*id="followUpQueueTriggerCount"[\s\S]*id="followUpQueueOverlay"[^>]*aria-label="Queued follow-ups"[\s\S]*id="followUpQueueRows"[\s\S]*id="followUpQueueStatus"[^>]*role="status"[^>]*aria-live="polite"/,
  "the composer should expose a count trigger and accessible non-modal follow-up queue overlay",
);
assert.match(css, /\.follow-up-queue-overlay \{[\s\S]*position:\s*absolute;[\s\S]*bottom:\s*calc\(100% \+ 0\.42rem\);[\s\S]*max-height:\s*min\(32rem, calc\(var\(--visual-viewport-height, 100dvh\) - 2rem\)\)/, "the queue overlay should float upward without changing composer layout and be bounded by the visual viewport");
assert.match(css, /\.composer:has\(\.follow-up-queue-overlay:not\(\[hidden\]\)\) \{\s*z-index:\s*80;\s*\}/, "an open queue should raise the composer stacking context above transcript copy buttons and normal interface controls");
assert.match(css, /\.follow-up-queue-trigger \{[\s\S]*justify-content:\s*center;[\s\S]*min-width:\s*5\.25rem;/, "the queue trigger should reserve a predictable width for its label and three-digit count");
assert.match(css, /body:not\(\.mobile-keyboard-open\) \.composer-input-row:has\(\.composer-workflow-mode-dock:not\(\[hidden\]\)\) \.follow-up-queue-trigger \{\s*right:\s*calc\(3\.55rem \+ 2\.25rem \+ 0\.4rem\);\s*\}/, "the queue trigger should move left of the visible Workflow control instead of overlapping it");
assert.match(css, /\.composer-input-row:has\(\.follow-up-queue-trigger:not\(\[hidden\]\)\) \.composer-context-tags \{\s*max-width:\s*max\(0px, calc\(100% - 9\.7rem\)\);\s*\}/, "visible queues should reserve prompt-frame space so feature and context tags cannot overlap the queue trigger");
assert.match(css, /body:not\(\.mobile-keyboard-open\) \.composer-input-row:has\(\.composer-workflow-mode-dock:not\(\[hidden\]\)\):has\(\.follow-up-queue-trigger:not\(\[hidden\]\)\) \.composer-context-tags \{\s*max-width:\s*max\(0px, calc\(100% - 12\.6rem\)\);\s*\}/, "context tags should reserve the combined Workflow and queue dock width");
assert.match(css, /body\.mobile-keyboard-open \.follow-up-queue-trigger:not\(\[hidden\]\) \{ display: inline-flex; \}/, "the queue trigger should remain usable while the mobile keyboard is open");
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.follow-up-queue-overlay,[\s\S]*\.follow-up-queue-row \{ transition: none; \}/, "the queue overlay should suppress motion for reduced-motion users");

const normalizeStart = app.indexOf("function normalizeQueuedMessages(event) {");
const normalizeEnd = app.indexOf("\nfunction queuedSnapshotForTab", normalizeStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart, "queue normalization should remain independently testable");
const normalizeSource = app.slice(normalizeStart, normalizeEnd);
const compactionSnapshot = JSON.parse(vm.runInNewContext(`${normalizeSource}\nJSON.stringify(normalizeQueuedMessages({ source: "webui-compaction", revision: 7, draining: true, steering: ["steer"], followUp: ["first", "second"] }))`));
assert.deepEqual(compactionSnapshot, {
  source: "webui-compaction",
  revision: 7,
  draining: true,
  steering: ["steer"],
  followUp: ["first", "second"],
}, "frontend queue normalization should retain compaction source, revision, draining state, and both queue arrays");

const mutationBodyStart = app.indexOf("function queueMutationBody(snapshot, operation) {");
const mutationBodyEnd = app.indexOf("\nfunction applyAuthoritativeQueuedSnapshot", mutationBodyStart);
assert.ok(mutationBodyStart >= 0 && mutationBodyEnd > mutationBodyStart, "queue mutation request construction should remain independently testable");
const mutationBodySource = app.slice(mutationBodyStart, mutationBodyEnd);
const compactionMutation = JSON.parse(vm.runInNewContext(`${mutationBodySource}\nJSON.stringify(queueMutationBody({ source: "webui-compaction", revision: 3, steering: ["steer"], followUp: ["one", "two"] }, { type: "move", from: 1, to: 0, expectedText: "two" }))`));
assert.deepEqual(compactionMutation, {
  source: "webui-compaction",
  kind: "followUp",
  revision: 3,
  expected: { steering: ["steer"], followUp: ["one", "two"] },
  operation: { type: "move", from: 1, to: 0, expectedText: "two" },
}, "compaction moves should use the B1 source-aware, revisioned full-snapshot mutation contract");
const runtimeMutation = JSON.parse(vm.runInNewContext(`${mutationBodySource}\nJSON.stringify(queueMutationBody({ source: "pi-runtime", steering: [], followUp: ["old"] }, { type: "edit", index: 0, expectedText: "old", text: "new" }))`));
assert.equal(Object.hasOwn(runtimeMutation, "revision"), false, "Pi-runtime mutations must omit the compaction-only revision field");
assert.deepEqual(runtimeMutation.expected, { steering: [], followUp: ["old"] }, "Pi-runtime mutations should send the complete B1 expected snapshot");
const deleteMutation = JSON.parse(vm.runInNewContext(`${mutationBodySource}\nJSON.stringify(queueMutationBody({ source: "webui-compaction", revision: 4, steering: ["steer"], followUp: ["remove me"] }, { type: "delete", index: 0, expectedText: "remove me" }))`));
assert.deepEqual(deleteMutation.operation, { type: "delete", index: 0, expectedText: "remove me" }, "queue deletion should use the same source-aware full-snapshot mutation contract");

const draftHelperStart = app.indexOf("function preservedFocusedFollowUpQueueDraft(draft, followUps) {");
const draftHelperEnd = app.indexOf("\nfunction focusedFollowUpQueueDraft", draftHelperStart);
assert.ok(draftHelperStart >= 0 && draftHelperEnd > draftHelperStart, "queue draft preservation should remain independently testable");
const draftHelperSource = app.slice(draftHelperStart, draftHelperEnd);
const draftDecisions = JSON.parse(vm.runInNewContext(`${draftHelperSource}
JSON.stringify({
  preserve: preservedFocusedFollowUpQueueDraft({ index: 1, authoritativeText: "second", value: "unsaved second", selectionStart: 3, selectionEnd: 10 }, ["first", "second"]),
  targetChanged: preservedFocusedFollowUpQueueDraft({ index: 1, authoritativeText: "second", value: "unsaved second", selectionStart: 3, selectionEnd: 10 }, ["first", "server replacement"]),
  indexChanged: preservedFocusedFollowUpQueueDraft({ index: 1, authoritativeText: "second", value: "unsaved second" }, ["second", "first"]),
  clean: preservedFocusedFollowUpQueueDraft({ index: 1, authoritativeText: "second", value: "second" }, ["first", "second"]),
})`));
assert.deepEqual(draftDecisions.preserve, { index: 1, value: "unsaved second", selectionStart: 3, selectionEnd: 10 }, "an SSE queue update should preserve the focused dirty draft only when its same authoritative item remains at its index");
assert.equal(draftDecisions.targetChanged, null, "an authoritative replacement at the focused index must discard the old draft instead of carrying it across a conflict");
assert.equal(draftDecisions.indexChanged, null, "a reordered target must not retain a dirty draft at the old index");
assert.equal(draftDecisions.clean, null, "unchanged focused text should not be treated as a dirty draft");

const renderTargetStart = app.indexOf("function queuedSnapshotTargetsCurrentTab(tabContext, currentTabId = activeTabId, currentTabs = tabs) {");
const renderTargetEnd = app.indexOf("\nfunction setFollowUpQueueOpen", renderTargetStart);
assert.ok(renderTargetStart >= 0 && renderTargetEnd > renderTargetStart, "late queue response targeting should remain independently testable");
const renderTargetSource = app.slice(renderTargetStart, renderTargetEnd);
const renderTargets = JSON.parse(vm.runInNewContext(`${renderTargetSource}
JSON.stringify({
  returnedToOrigin: queuedSnapshotTargetsCurrentTab({ tabId: "A", generation: 4, sessionFile: "/sessions/a.jsonl", startedAt: "start-a" }, "A", [{ id: "A", sessionFile: "/sessions/a.jsonl", startedAt: "start-a" }]),
  anotherTabActive: queuedSnapshotTargetsCurrentTab({ tabId: "A", generation: 4, sessionFile: "/sessions/a.jsonl", startedAt: "start-a" }, "B", [{ id: "A", sessionFile: "/sessions/a.jsonl", startedAt: "start-a" }, { id: "B" }]),
  originClosed: queuedSnapshotTargetsCurrentTab({ tabId: "A", generation: 4 }, "A", []),
  sessionReplaced: queuedSnapshotTargetsCurrentTab({ tabId: "A", generation: 4, sessionFile: "/sessions/a.jsonl", startedAt: "start-a" }, "A", [{ id: "A", sessionFile: "/sessions/replacement.jsonl", startedAt: "start-replacement" }]),
})`));
assert.equal(renderTargets.returnedToOrigin, true, "a late A mutation response should render after A→B→A when A is active again");
assert.equal(renderTargets.anotherTabActive, false, "a late A mutation response must not repaint active tab B");
assert.equal(renderTargets.originClosed, false, "a late response must not render after its originating tab closes");
assert.equal(renderTargets.sessionReplaced, false, "a late response must not render after the authoritative tab session changes");

assert.match(app, /async function mutateQueuedFollowUp\([\s\S]*const tabContext = queueTabContext\(tabId\)[\s\S]*api\("\/api\/queue\/mutate", \{ method: "POST", body: queueMutationBody\(snapshot, operation\), tabId \}\)[\s\S]*if \(result\.queue\) applyAuthoritativeQueuedSnapshot\(tabContext, result\.queue\)[\s\S]*error\?\.statusCode === 409[\s\S]*refreshed the authoritative queue/, "queue mutations should use the single B1 endpoint and refresh the authoritative snapshot after conflicts");
assert.match(app, /function applyAuthoritativeQueuedSnapshot\([\s\S]*latestQueuedMessagesByTab\.set\(tabContext\.tabId, snapshot\)[\s\S]*if \(queuedSnapshotTargetsCurrentTab\(tabContext\)\) renderQueue/, "late mutation responses should render only their active originating tab while caching every authoritative result");
assert.match(app, /function renderQueue\(event\)[\s\S]*latestQueuedMessagesByTab\.set\(tabId, snapshot\)[\s\S]*if \(tabId && tabId !== activeTabId\) return;/, "deferred queue rendering must cache but never repaint an unrelated active tab");
assert.match(app, /const followUpQueueMutationsInFlightByTab = new Set\(\)[\s\S]*function syncFollowUpQueueMutationControls\([\s\S]*textarea\.disabled = locked \|\| draining[\s\S]*control\.disabled = locked \|\| draining[\s\S]*function setFollowUpQueueMutationInFlight/, "in-flight and draining states should lock editable queue controls per tab");

assert.match(app, /const textarea = make\("textarea", "follow-up-queue-textarea"\)[\s\S]*textarea\.dataset\.followUpQueueAuthoritativeText = item[\s\S]*textarea\.addEventListener\("blur", \(\) => \{[\s\S]*followUpQueueSuppressBlurFor[\s\S]*saveQueuedFollowUpText\(index, item, textarea\.value\)[\s\S]*\(event\.ctrlKey \|\| event\.metaKey\)[\s\S]*event\.key === "Enter"[\s\S]*event\.key !== "Escape"[\s\S]*textarea\.value = item/, "queue rows should be editable by default and avoid blur-saving the focused draft during an authoritative rerender");
assert.match(app, /row\.draggable = false;[\s\S]*dragHandle\.draggable = !unavailable;[\s\S]*row\.addEventListener\("dragstart", \(event\) => \{[\s\S]*event\.target\?\.closest\?\.\("\.follow-up-queue-drag-handle"\) !== dragHandle[\s\S]*application\/x-pi-webui-follow-up[\s\S]*row\.addEventListener\("dragover"[\s\S]*event\.stopPropagation\(\)[\s\S]*row\.addEventListener\("drop"[\s\S]*type: "move", from: drag\.index, to: index/, "native drag/drop should begin only from its visible handle, persist the final-index permutation, and isolate row drag events");
assert.match(app, /function handleComposerDragOver\(event\) \{\n\s*if \(event\.target\?\.closest\?\.\("#followUpQueueOverlay"\) \|\| !isFileDrag\(event\)\) return;[\s\S]*function handleComposerDrop\(event\) \{\n\s*if \(event\.target\?\.closest\?\.\("#followUpQueueOverlay"\) \|\| !isFileDrag\(event\)\) return;/, "composer attachment drops should ignore queue-row drag events");
assert.match(app, /Moved queued follow-up \$\{operation\.from \+ 1\} to position \$\{operation\.to \+ 1\}[\s\S]*Move queued follow-up \$\{index \+ 1\} up[\s\S]*Move queued follow-up \$\{index \+ 1\} down/, "move controls should provide labelled keyboard/touch parity and live reorder announcements");
assert.match(app, /const remove = make\("button", "follow-up-queue-remove-button", "Remove"\)[\s\S]*type: "delete", index, expectedText: message/, "every composer queue row should expose an accessible remove control backed by the unified mutation contract");
assert.match(css, /\.follow-up-queue-remove-button \{[\s\S]*color:\s*var\(--ctp-red\)/, "queue removal should have a distinct destructive visual treatment");
assert.match(app, /setFollowUpQueueOpen\(false, \{ restoreFocus: true \}\)/, "outside close and Escape should request queue-focus restoration");
assert.match(app, /function setFollowUpQueueOpen\([\s\S]*followUpQueueRestoreFocus[\s\S]*requestAnimationFrame\(\(\) => focusTarget\?\.focus\(\{ preventScroll: true \}\)\)/, "queue close should restore focus to the saved trigger context");
assert.match(app, /function setFollowUpQueueOpen[\s\S]*setComposerActionsOpen\(false\)[\s\S]*setPublishMenuOpen\(false\)[\s\S]*setNativeCommandMenuOpen\(false\)[\s\S]*setAppRunnerMenuOpen\(false\)[\s\S]*setOptionsMenuOpen\(false\)[\s\S]*setConversationVoiceMenuOpen\(false\)[\s\S]*setBusyPromptBehaviorMenuOpen\(false\)[\s\S]*setNewTabMenuOpen\(false\)/, "opening the queue should close competing dropdown surfaces");
assert.match(app, /function renderFollowUpQueueOverlay\(\) \{\n\s*if \(deferUiRenderDuringPointerActivation\("follow-up-queue", renderFollowUpQueueOverlay\)\) return;/, "queue rendering should defer during pointer activation");
assert.match(app, /function switchTab\(tabId\)[\s\S]*setFollowUpQueueOpen\(false\)[\s\S]*setFollowUpQueueStatus\(""\)/, "switching tabs should close queue UI and clear its tab-local status before the new context renders");
assert.match(app, /renderQueueGroup\("Follow-up", followUp, "follow-up", \{ removable: !snapshot\.draining, tabId \}\)/, "Control Deck removal should support every mutable queue source");
assert.doesNotMatch(app, /nextQueuedFollowUpPrompt|sticky-user-follow-up-prompt|Next follow-up prompt:/, "the sticky last/current prompt control must no longer expose queued follow-up preview content");

console.log("queue edit/reorder static tests passed");
