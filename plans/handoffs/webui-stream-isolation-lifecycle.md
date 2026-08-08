# WebUI stream-output isolation — WS2a lifecycle/chrome/todo handoff

- **Workstream:** WS2a — lifecycle/chrome/todo separation
- **Identity:** implementation worker 2, sole writer after WS1 integration, single run
- **Status:** implemented and validated; not staged, not committed
- **Baseline revision:** `6f96d29256c2362bee165469899b4007e1655f18` (HEAD unchanged by this worker)
- **Baseline state:** WS1 controller/routing integrated in the working tree, all 113 WebUI test files passing
- **Result state:** WS2a lifecycle/chrome/todo separation added on top of WS1; `npm run check` still passes all 113 test files; working tree remains dirty and unstaged, HEAD unchanged
- **Classification:** complex remains valid. This handoff completes WS2a only. WS2b browser proof, central integration, independent review quorum, final report, and plan archival remain open plan gates.

## Changed files

- `pi-package-webui/public/app.js` — lifecycle/chrome/todo/message-reconciliation separation (the only product file changed).
- `pi-package-webui/tests/streaming-ui-coupling.test.mjs` — added a WS2a contract block (13 new hard invariants) enforcing the new ownership boundaries.
- `pi-package-webui/tests/mobile-static.test.mjs` — corrected two assertions that encoded the old lifecycle coupling and had become vacuous.
- `plans/handoffs/webui-stream-isolation-lifecycle.md` — this handoff.

No other file was modified. `public/index.html` and `public/styles.css` were **not** required and were not touched: the live activity root is created in `app.js`, so the stable transcript-owned marker was added there.

## Implementation summary

### 1. Transcript activity vs lifecycle/composer chrome

- `setRunIndicatorActivity()` no longer calls `scheduleComposerModeButtonsUpdate()` unconditionally. It now calls the new `syncLifecycleComposerState()`, which computes a lifecycle signature (`activeTabGeneration`, run-active, abort-available, abort-in-flight, busy-prompt behavior) and schedules composer/Stop reconciliation only when that signature actually changes.
- Activity wording changes therefore can no longer reparent Steer/Follow-up controls, toggle `body.pi-run-active`, or rebuild composer buttons.
- `agent_start` and `agent_settled` call `syncLifecycleComposerState({ force: true })` so Stop appears and clears exactly once per lifecycle transition. `clearRunIndicatorActivity()` and `syncRunIndicatorFromState()` resynchronize the cached signature before their existing direct `updateComposerModeButtons()` calls, so authoritative state remains the source of truth.
- The run-indicator bubble is now a stable transcript-owned root marked `data-stream-owned="run-indicator"`; activity updates continue to rewrite only its existing text nodes.

### 2. Transcript ticker vs lifecycle watchdog

- `startRunIndicatorTicker()` previously performed `maybeRefreshRunIndicatorState()` on every 1s tick, so a transcript-owned timer issued canonical-state network reconciliation.
- The ticker is now purely transcript-local (elapsed-time repaint of its own node). The bounded canonical state recheck moved to a new lifecycle-owned watchdog (`startLifecycleStateWatchdog`/`stopLifecycleStateWatchdog`) running at `RUN_INDICATOR_STATE_RECHECK_MS`, started/stopped with the run and stopped on `clearRunIndicatorActivity()`.
- The watchdog is deliberately retained: it is the existing safety net that prevents a stuck "running" indicator when a terminal lifecycle event is dropped. It is time-driven, never token-driven.

### 3. Todo progress derived from authoritative content

- `scheduleLiveTodoProgressWidgetSync()` and its three module-level pending/frame variables were deleted. No token-driven todo scheduler remains anywhere in `app.js`.
- New `authoritativeTodoProgressSourceText()` + `reconcileTodoProgressFromMessages()` derive the checklist once from the newest settled assistant message, called from `refreshMessages()` (authoritative reconciliation).
- The existing `todoProgressSignatureByTab` guard is preserved, so the widget record updates only when the parsed checklist value changes; `scheduleLiveWidgetRender()` remains the single frame-coalesced widget render for that changed record.

### 4. Semantic tool boundaries for skills and event log

- `eventMayAffectSkillUsage()` no longer matches `tool_execution_update` or `message_update`/`toolcall_start`; skill tracking is reachable only from `tool_execution_start`, `tool_execution_end`, and `response`/`new_session`.
- `trackSkillsFromEvent()` dropped its `toolcall_start` branch and now records once per boundary via the new bounded `claimToolBoundaryRecord()` dedupe (start preferred, completion as fallback).
- `tool_execution_start`/`tool_execution_end` event-log insertion is deduplicated by the same tool-boundary claim, so replayed/redelivered boundaries cannot duplicate log lines. The dedupe set is bounded (`TOOL_BOUNDARY_RECORD_LIMIT = 400`, FIFO trim) and cleared on `new_session`.

### 5. Transcript-only message rendering + coalesced semantic reconciliation

- `renderMessages()` is now transcript-only: its `renderFooter()` and `renderFeedbackTray()` calls were removed.
- New `scheduleSemanticReconcile(dirty, tabContext)` / `flushSemanticReconcile()` coalesce dirty flags `messages`, `state`, `footer`, `footerData`, `feedback`, `usage`, `workflow` into one frame and apply the minimum changed set once, skipping stale tab contexts.
- Lifecycle cases converted from ad-hoc fan-out to one coalesced request each: `agent_start` (state/footer/feedback), `agent_end`, `message_end`, `compaction_end` (messages/state/footerData), `tool_execution_end` (footerData), and `agent_settled` (messages/state/footerData/feedback/usage/workflow).
- The `agent_settled` git-workflow continuation block moved verbatim into the new `reconcileGitWorkflowContinuation()` helper driven by the `workflow` flag.
- `refreshMessages()` derives todo progress and requests `{ footer: true }` instead of calling `renderFooter()` inline. `resetActiveTabUi()` now renders footer/feedback explicitly, since `renderMessages()` no longer does.
- Preserved deliberately and verified: `requestGitFooterWebuiPayload(tabContext, { force: true })` still runs inline at settlement after `isStreaming: false` (theory #8), `markTabOutputSeen()` at settlement/compaction end, `notifyAgentDone` only at settlement, `agent_end` not exposing an idle window, compact-output flushes, voice turn-end handling, and abort/retry/compaction wording.

## Validation evidence

All commands run from `/home/firstpick/npm-packages/pi-package-webui` unless noted.

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `node --check public/app.js && node --check public/stream-output-controller.mjs` | `0` | both syntax checks pass |
| 2 | `node tests/stream-output-controller.test.mjs && node tests/stream-output-isolation-static.test.mjs` | `0` | WS1 controller + isolation static tests still pass unmodified |
| 3 | `node tests/streaming-ui-coupling.test.mjs` | `0` | passes including the 13 new WS2a invariants |
| 4 | Focused loop over `streaming-ui-coupling`, `interaction-state-stability-static`, `chat-scroll-intent-static`, `fast-output-live`, `fast-mode-client-static`, `webui-output-mode`, `fast-mode-output-work`, `completion-signal-contract`, `sse-backpressure-harness`, `thinking-stream-recovery`, `compaction-resume-harness`, `mobile-static` | `0` each | 12/12 PASS |
| 5 | `npm run check` | `0` | **all 113 test files passed** |
| 6 | `git diff --check` (from repo root) | `0` | clean |
| 7 | `git diff --cached --name-only` (from repo root) | `0` | empty — nothing staged |

Fast-mode ledger unchanged from baseline: `normalScanChars=8464384`, `compactScanChars=16384`, `scanRatio=516.625`, `normalFlushes=512`, `compactFlushes=103`, `normalDomWrites=512`, `compactDomWrites=103`; semantic hash `74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f`.

### Negative control on the new assertions

To prove the new invariants are not vacuous, two regressions were temporarily injected into a backup copy of `app.js` (restoring `renderFooter()` inside `renderMessages()`, and restoring unconditional `scheduleComposerModeButtonsUpdate()` in `setRunIndicatorActivity()`). `node tests/streaming-ui-coupling.test.mjs` then failed with `WS2a: renderMessages must be transcript-only …` (exit `1`). The original file was restored from the backup and re-verified passing before continuing.

### Vacuous-assertion correction

Two `mobile-static.test.mjs` assertions used unbounded `[\s\S]*?` spans and would have kept passing by matching `scheduleRefreshMessages()` text from an unrelated later block. They were rewritten with case-bounded patterns asserting the coalesced scheduler (`scheduleSemanticReconcile`) at `agent_settled` and `message_end`. This tightens the contract rather than restoring old coupling.

## Omissions

- **No browser proof.** No browser test, MutationObserver harness, focus/selection/node-identity check, or network-budget measurement was run or written. `npm run test:browser` was not executed. All isolation evidence here is static/unit only. Nothing in this handoff should be read as browser-verified runtime behavior; that remains WS2b's assigned gate.
- No runtime/manual verification of Stop, retry, compaction, voice, reconnect, inactive-tab, or settlement behavior in a real browser; those were preserved by construction and covered only by the existing static/harness suites.
- `public/index.html`, `public/styles.css`, `public/stream-output-controller.mjs`, its WS1 tests, browser fixtures/specs, the canonical plan, reports, package metadata/locks, and the static server/service worker were not modified.
- No staging, commit, push, reset, checkout, or clean operation was performed.

## Deviations, assumptions, unresolved decisions, and risks

- **Deviation (bounded, within contract):** the plan's illustrative dirty-flag list mentions a `widgets` flag. It was intentionally not added, because `syncLiveTodoProgressWidgetFromText()` already owns a frame-coalesced, changed-only widget render; adding a second path would have produced two `renderWidgets()` calls in the same frame. This follows Phase E step 4's "prefer in-place dedicated widget updates". No dead flag was left behind.
- **Deviation:** the lifecycle state watchdog was retained rather than removed under Phase D step 4. Removing the only stuck-run safety net would have been an unapproved reliability change. It was moved out of transcript ownership instead, which satisfies the separation intent. Flagging explicitly for integration review.
- **Assumption:** the newest settled assistant message is the correct authoritative todo-progress source. This matches the previous token-derived behavior, which also tracked the latest assistant text block.
- **Assumption:** deferring `renderFooter()` from synchronous to one coalesced frame after message reconciliation is acceptable; no test or documented contract required synchronous footer painting.
- **Risk (low, static-only):** todo progress is now post-message rather than live. This is the explicitly approved plan trade-off (decision record 2026-08-05), but it is a visible behavior change for users who watched the checklist update mid-stream.
- **Risk (medium, unverified):** the lifecycle-signature gate is the main behavioral risk surface. If any composer-relevant input is mutated without either a direct `updateComposerModeButtons()` call or a lifecycle-signature change, Stop/Steer/Follow-up could go stale. Existing direct call sites were left intact to bound this, and abort-hold/abort-in-flight paths still call the updater directly. Browser verification of Stop across abort/retry/compaction is recommended in WS2b.
- **Risk (low):** the tool-boundary dedupe changes replayed-event behavior. Duplicate suppression is the intended fix, but a legitimate second execution reusing an identical `toolCallId` within the same tab would now log once.
- **Unresolved product/scope/architecture/interface/security/migration/dependency decisions:** none. No controller interface change was needed; `stream-output-controller.mjs` was not touched.

## Integration notes

1. WS2a is ready to be recorded as the second qualifying implementation outcome, pending the integration owner's own diff inspection.
2. Preserve `syncLifecycleComposerState()` as the only composer reconciliation path inside `setRunIndicatorActivity()`, and keep the forced sync at `agent_start`/`agent_settled`.
3. Preserve the transcript-ticker/lifecycle-watchdog split; do not move `maybeRefreshRunIndicatorState()` back into `startRunIndicatorTicker()`.
4. Preserve `renderMessages()` as transcript-only; new chrome work belongs in `scheduleSemanticReconcile()` dirty flags.
5. Preserve `claimToolBoundaryRecord()` around skill tracking and tool event-log insertion.
6. WS2b may now proceed with the deterministic browser isolation proof and hardening, and should treat the Stop/lifecycle-signature risk above and the absence of any browser evidence as its primary targets.
7. The overall complex feature remains **incomplete** until WS2b, central integration, the two independent reviews with dispositions, accepted-fix revalidation, the final HTML report, and plan archival are recorded.
