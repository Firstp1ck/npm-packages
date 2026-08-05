# Pi WebUI Main-Agent Stream Output Isolation — Complex Refactor Plan

- **Status:** Planned; implementation not started
- **Classification:** Complex refactor / behavioral bug fix
- **Feature slug:** `webui-main-agent-stream-output-isolation`
- **Target package:** `pi-package-webui/`
- **Integration owner:** Parent Pi session
- **Final report:** `reports/webui-main-agent-stream-output-isolation.html` after implementation, validation, and review
- **Last updated:** 2026-08-05

## 1. Goal

Make main-agent streaming a strictly transcript-owned operation: raw text, thinking, tool-call, and tool-execution deltas may update only the active transcript and its local follow-scroll state. They must not rebuild, reparent, focus, scroll, refresh, or otherwise mutate unrelated WebUI surfaces such as widgets, tabs, footer/status, composer, side panels, file tree, event log, overlays, or document chrome.

## 2. Classification and rationale

**Complex.** The correction crosses event routing, transcript rendering, run-state/chrome ownership, live todo behavior, tool lifecycle handling, network reconciliation, and browser interaction tests. It has at least four meaningful implementation slices and touches heavily shared frontend code. Incorrect isolation could regress abort controls, auto-retry, compaction, tool cards, inactive-tab indicators, voice mode, completion notifications, or authoritative reconciliation.

This plan is documentation-only. Feature implementation workflow gates apply only when implementation is later authorized.

## 3. Problem statement and verified coupling

The transcript renderer itself already has a strong ownership boundary, but the browser event hot path leaks into unrelated UI:

1. `text_delta` calls `scheduleLiveTodoProgressWidgetSync()`.
2. That eventually calls `renderWidgets()`.
3. `renderWidgets()` executes `widgetArea.replaceChildren()`, rebuilding unrelated workflow, release, app-runner, subagent, and BTW controls.
4. Every normal text/thinking/tool delta calls `setRunIndicatorActivity()`.
5. Run-indicator activity schedules composer-mode updates, can reparent Steer/Follow-up controls, toggles Abort state and `body.pi-run-active`, and starts timers that may refresh global state.
6. Every decorated stream event enters the global tab-activity/skill-tracking preamble before transcript dispatch.
7. Tool stream boundaries also mutate skill tags and the separate event log.
8. Message/lifecycle reconciliation couples transcript refresh to footer, feedback, usage, workflow, and other chrome refreshes.

Primary local evidence:

- `pi-package-webui/public/app.js:23149-23179` — live todo extraction/scheduling.
- `pi-package-webui/public/app.js:26856-26905` — full widget-area rebuild.
- `pi-package-webui/public/app.js:32849-32900` — run-indicator rendering/activity.
- `pi-package-webui/public/app.js:5918-5966` — composer mode/control mutation.
- `pi-package-webui/public/app.js:32740-32801` — run-indicator ticker and state refresh.
- `pi-package-webui/public/app.js:38566-38617` — message-update hot path.
- `pi-package-webui/public/app.js:41136-41570` — global event preamble and lifecycle fan-out.
- `pi-package-webui/public/app.js:14090-14145` — tab render scheduling.
- `pi-package-webui/public/app.js:20343-20383` — footer/state refresh scheduling.
- `pi-package-webui/public/transcript-renderer.mjs:74-81,209-257,297-360` — existing transcript ownership, selection, and pointer protections.
- `pi-package-webui/public/fast-output-live.mjs:52-179` — existing pure compact reducer/scheduler precedent.

The current continuity guards—focus snapshots, tooltip restoration, pointer deferral, dropdown guards, and selection restoration—reduce damage after a rebuild. They are not a substitute for preventing unrelated rebuilds.

## 4. Success criteria

1. `message_update` raw stream events (`text_*`, `thinking_*`, `toolcall_*`) mutate only the active transcript-owned roots and transcript-local state.
2. `tool_execution_update` mutates only its live transcript tool card and transcript-local state.
3. No raw delta calls or schedules widget, footer, tab, status, workspace dashboard, feedback tray, file tree, side-panel, event-log, or composer renderers.
4. No raw delta triggers HTTP/RPC reconciliation, focus changes, global `body` class changes, control reparenting, or non-chat scroll writes.
5. Agent lifecycle chrome changes happen only at semantic boundaries such as `agent_start`, explicit abort-state change, retry transition, compaction transition, and `agent_settled`.
6. Tool skill tracking and event-log records occur at semantic tool boundaries, never from argument/output delta cadence.
7. Todo-progress widgets are derived only from authoritative/settled content or a dedicated structured semantic event; raw assistant text never rebuilds widgets.
8. Existing incremental Markdown, thinking display, live tool cards, compact mode, text selection, paused-reader behavior, abort, retry, compaction, voice, reconnect, and settlement semantics remain correct.
9. During a synthetic 1,000-delta stream, browser tests observe zero non-allowlisted UI mutations, zero focus changes, zero unrelated node replacements, and zero delta-triggered network requests.
10. Focused unit/static/browser tests, the full WebUI test suite, syntax checks, and `git diff --check` pass, with unrelated dirty-tree failures separated explicitly.

## 5. Scope

### In scope

- Browser-side classification of high-frequency stream events versus semantic lifecycle events.
- A transcript-only stream controller/router seam.
- Separation of transcript activity from global run lifecycle/chrome state.
- Removal of token-driven todo/widget rendering.
- Semantic-boundary skill tracking and event logging.
- Transcript-only message rendering APIs and explicit lifecycle reconciliation scheduling.
- Stable node identity and local follow-scroll behavior.
- Tests that prove non-transcript surfaces do not mutate during raw deltas.
- Narrow diagnostics/instrumentation for forbidden stream-path mutations.

### Non-goals

- Framework, bundler, or state-management-library migration.
- Replacing SSE with WebSocket.
- Rewriting the Pi RPC protocol or provider stream format.
- Shadow DOM migration.
- Redesigning widgets, footer, tabs, composer, tool cards, or transcript visuals.
- Removing authoritative refresh/reconciliation at semantic boundaries.
- Changing upstream Pi event ordering.
- Solving general page performance, transcript virtualization, or resumable SSE in this workstream.
- Refactoring unrelated dirty files or existing session-summary/native-parity work.

## 6. Approved design decisions and invariants

1. **Raw deltas are transcript-only.** A raw delta cannot publish to global chrome, widgets, overlays, or network schedulers.
2. **Semantic boundaries may update chrome.** Broad UI reconciliation remains allowed at explicit, low-frequency lifecycle boundaries.
3. **`transcriptRenderer` remains the DOM owner.** Do not replace its selection/pointer/Markdown reconciliation mechanisms.
4. **Compact mode remains supported.** Its pure reducer and bounded scheduler are retained and adapted behind the same isolation contract.
5. **SSE remains the transport.** This issue is subscription/render ownership, not transport choice.
6. **Todo progress is no longer token-derived live chrome.** The widget updates at `message_end`/authoritative reconciliation, or later from a dedicated semantic event if Pi exposes one.
7. **Global Stop state changes once per lifecycle transition.** Per-token activity wording belongs in the transcript, not in composer reconstruction.
8. **No focus restoration unless the affected control was actually replaced at a semantic boundary.** Raw delta paths never call `.focus()`.
9. **No global root replacement during streaming.** Stable transcript message/content-part IDs are mandatory.
10. **Fail open for transcript content, fail closed for chrome side effects.** Unknown `message_update` subtypes may be logged diagnostically after the turn, but must not gain global mutation authority.
11. **Dirty-tree safety is mandatory.** Existing uncommitted changes in `public/app.js`, `public/index.html`, `public/styles.css`, and tests are preserved. No checkout/reset/clean operation is allowed.

## 7. Event ownership contract

### 7.1 Transcript stream events

These enter `StreamOutputController` directly after EventSource source/context/supervisor validation:

- `message_update` with `thinking_start`, `thinking_delta`, `thinking_end`;
- `message_update` with `text_start`, `text_delta`, `text_end`;
- `message_update` with `toolcall_start`, `toolcall_delta`, `toolcall_end`;
- `tool_execution_update`;
- stream-local error fragments that belong in the active transcript.

Allowed effects:

- update per-tab/per-message stream accumulators;
- schedule one cancellable transcript render frame;
- mutate nodes owned by `transcriptRenderer`;
- create/update the active transcript thinking/text/tool surface;
- adjust only the active chat scroll container when follow mode was already active;
- update transcript-local activity text;
- flush or cancel the stream queue at a barrier.

Forbidden effects:

- `renderWidgets()`;
- `renderFooter()` / `scheduleRefreshFooter()`;
- `renderTabs()` / `scheduleTabsRender()`;
- `renderStatus()` / `scheduleRefreshState()` / `refreshState()`;
- `renderWorkspaceDashboard()` / `renderContextMeter()`;
- `renderFeedbackTray()`;
- composer mode/button reconstruction or control reparenting;
- skill-tag rendering;
- event-log insertion;
- file-tree, Git panel, side-panel, overlay, or modal rendering;
- document-title changes;
- network fetch/RPC calls;
- `.focus()`, `scrollIntoView()`, or non-chat `scrollTop` writes;
- global `body` class/attribute changes.

### 7.2 Semantic stream boundaries

These may update a bounded subset of transcript and chrome state:

| Event | Allowed behavior |
| --- | --- |
| `agent_start` | Set running lifecycle once, expose Stop once, mark active tab once, create transcript run indicator. |
| `message_start` | Initialize transcript message state only. |
| `tool_execution_start` | Create transcript tool card; record skill/event once if needed; no broad widget/footer refresh. |
| `tool_execution_end` | Finalize transcript tool card; record result once; schedule narrowly required reconciliation. |
| `message_end` | Flush transcript stream; reconcile authoritative message tail; derive todo progress once; no automatic broad chrome rebuild unless data changed. |
| `agent_end` | Preserve current low-level semantics; flush/reconcile only, without claiming idle. |
| retry/compaction transitions | Update explicit lifecycle/chrome state once per transition. |
| `agent_settled` | Mark idle/failed once, reconcile authoritative state, and perform coalesced post-turn chrome/network refresh. |
| process/RPC failure | Surface error and settle lifecycle through one explicit failure path. |

### 7.3 Non-stream events

Workspace files, Git watchers, app-runner state, extension widgets/status, subagent state, optional features, and user actions retain their existing owners. They must not subscribe to raw transcript delta topics.

## 8. Proposed architecture

```text
EventSource
   |
   v
validate source + tab generation + supervisor sequence
   |
   v
classifyWebuiEvent(event)
   |-------------------------------------------|
   |                                           |
   v                                           v
StreamOutputController                 SemanticLifecycleController
(raw high-frequency events)            (low-frequency boundaries)
   |                                           |
   |-- per-tab stream state                    |-- lifecycle/chrome state
   |-- one frame queue                         |-- bounded activity/tab updates
   |-- TranscriptRenderer                      |-- coalesced authoritative refresh
   `-- ChatFollowController                    `-- widgets/footer/usage/workflows
```

### 8.1 `StreamOutputController`

Recommended new module: `pi-package-webui/public/stream-output-controller.mjs`.

Responsibilities:

- classify and accept only transcript stream events;
- hold per-tab/per-active-message pending text/thinking/tool updates;
- provide one retained `requestAnimationFrame` handle per active stream;
- flush immediately at semantic barriers;
- cancel frames/timers on tab switch, abort, process exit, reconnect, or settlement;
- call only injected transcript and chat-scroll sinks;
- expose diagnostics counters without importing application chrome.

The module should remain testable without DOM. It should not import `app.js`, global `elements`, API helpers, widget code, tabs, footer, composer, or extension UI code.

Suggested injected interface:

```js
createStreamOutputController({
  scheduleFrame,
  cancelFrame,
  applyTextUpdate,
  applyThinkingUpdate,
  applyToolCallUpdate,
  applyToolExecutionUpdate,
  applyStreamError,
  applyFollowScroll,
  onUnknownStreamEvent,
});
```

The controller emits no generic “state changed” notification. Every sink is transcript-specific.

### 8.2 `SemanticLifecycleController`

This may remain initially in `public/app.js` to minimize churn. Its responsibilities are:

- running/idle/failed/retrying/compacting state;
- stable Stop/Steer/Follow-up availability;
- inactive-tab and completion indicators;
- semantic skill/event records;
- coalesced state/messages/footer/usage/workflow reconciliation;
- authoritative todo-widget update after a completed message;
- notification/voice completion handling.

It must not consume raw token/tool-output deltas.

### 8.3 Transcript ownership

- `transcriptRenderer` continues to own text selection, stable Markdown prefixes, mutable tails, live tool cards, and pointer deferral.
- The active run indicator should be transcript-owned. Its activity label may change during streaming by updating one stable text node.
- Chat follow-scroll remains separate but receives requests only from transcript render flushes.
- Stable message and content-part IDs must not change when `streaming` becomes `done`.

### 8.4 Chrome ownership

- Composer Stop/Steer/Follow-up state changes only when lifecycle status changes.
- Controls are not moved between parents on each activity string change.
- Tabs update at start/settled/unread transitions, not per decorated delta.
- Footer, context meter, workspace dashboard, and feedback tray refresh only from semantic lifecycle or their own data events.
- Widgets update only from explicit extension widget events, app-runner/workflow events, or authoritative post-message todo derivation.

## 9. Recommended file changes

### New files

- `pi-package-webui/public/stream-output-controller.mjs`
- `pi-package-webui/tests/stream-output-controller.test.mjs`
- `pi-package-webui/tests/stream-output-isolation-static.test.mjs`
- `pi-package-webui/tests/browser/stream-output-isolation.spec.mjs`

### Existing files

- `pi-package-webui/public/app.js`
  - introduce event classification/router seam;
  - route raw stream events before global tab/skill activity preamble;
  - inject transcript-only controller sinks;
  - split transcript activity from lifecycle/composer state;
  - remove token-driven todo/widget updates;
  - make message refresh transcript-only;
  - coalesce semantic-boundary reconciliation;
  - add bounded test diagnostics if needed.
- `pi-package-webui/public/index.html`
  - load the new module only if not imported from existing module entry;
  - optionally mark transcript-owned roots with `data-stream-owned` for browser assertions.
- `pi-package-webui/public/styles.css`
  - only narrowly adjust transcript-local activity/Stop layout if required;
  - do not redesign unrelated surfaces.
- `pi-package-webui/tests/run-all.mjs`
  - register new focused tests if discovery is not automatic.
- `pi-package-webui/tests/fixtures/fake-pi.mjs`
  - add deterministic burst-stream scenarios only if existing fixtures cannot drive them.
- Existing interaction, compact-mode, mobile, transport, completion, and scroll tests
  - update only where their old expectation encoded cross-UI delta coupling.

## 10. Execution DAG and ownership

The repository is currently dirty, including target files. Writers must be sequential in the shared tree unless the user first authorizes and creates a clean isolated baseline. The parent remains integration owner and never resets unrelated changes.

### Wave 0 — baseline and seam validation

Owner: integration parent, read-only.

1. Capture `git status --short` and focused diffs for all intended target files.
2. Run current focused streaming/interaction tests.
3. Record current call counts and DOM mutations for a deterministic stream fixture.
4. Confirm active target-file hunks unrelated to this feature.
5. Freeze the event taxonomy and forbidden-sink list from this plan.

Exit gate: baseline and dirty-tree ownership are recorded; no blocking product decision remains.

### Wave 1 — WS1 controller and event-routing core

Implementation worker 1, sole writer.

Write boundary:

- `public/stream-output-controller.mjs`
- `public/app.js` event classification, delta routing, stream accumulation/render scheduling
- `tests/stream-output-controller.test.mjs`
- `tests/stream-output-isolation-static.test.mjs`
- `tests/run-all.mjs` only if required

Deliverables:

1. Pure controller with one cancellable frame queue.
2. `dispatchTranscriptStreamEvent(event)` seam before global activity/skill processing.
3. Raw deltas bypass tab activity, skill tracking, widget sync, composer activity, event log, and network scheduling.
4. Existing normal and compact transcript behavior works through the same isolation contract.
5. Unit/static tests reject forbidden sink reachability.

Forbidden/shared paths:

- widget/footer/tab visual redesign;
- `public/index.html` and `public/styles.css` except where explicitly reassigned later;
- browser fixtures/specs owned by WS2;
- plans, reports, package versions, lockfiles, unrelated tests.

Handoff: `plans/handoffs/webui-stream-isolation-core.md`.

### Wave 2 — WS2 lifecycle/chrome separation and browser proof

Implementation worker 2, sole writer after WS1 integration.

Prerequisite: integrated WS1 controller and exact source handoff.

Write boundary:

- `public/app.js` lifecycle/chrome/todo/reconciliation paths
- `public/index.html` and `public/styles.css` only if required for stable transcript-owned activity roots
- `tests/browser/stream-output-isolation.spec.mjs`
- focused existing interaction/mobile/completion tests
- fake-Pi fixture only if required

Deliverables:

1. Split transcript activity label from lifecycle/composer state.
2. Move todo-widget derivation to authoritative message reconciliation.
3. Record skills/events once at semantic tool boundaries.
4. Make message rendering transcript-only; broad post-turn refreshes go through a coalesced lifecycle scheduler.
5. Browser mutation/focus/selection/node-identity/network tests cover all major interactive surfaces.
6. Preserve Stop, retry, compaction, tool, voice, inactive-tab, and settlement behavior.

Forbidden/shared paths:

- controller internals except a parent-approved interface correction;
- unrelated widget/footer/tab features;
- plans, reports, package versions, lockfiles, unrelated dirty hunks.

Handoff: `plans/handoffs/webui-stream-isolation-lifecycle-and-browser.md`.

### Wave 3 — central integration and validation

Owner: integration parent.

1. Inspect actual diffs and both handoffs.
2. Verify every edit stayed inside its boundary.
3. Confirm normal/compact mode parity and lifecycle semantics.
4. Run focused tests, syntax checks, browser tests, then the full package suite.
5. Compare browser mutation/network metrics against Wave 0.
6. Confirm no staged files and preserve unrelated dirty hunks.

### Wave 4 — independent review

Two fresh read-only reviewers inspect the integrated result with distinct angles:

1. **Correctness/architecture:** event taxonomy, transcript-only guarantee, lifecycle semantics, compact/normal parity, abort/retry/compaction/reconnect.
2. **Interaction/accessibility/performance:** focus, selection, dropdown/modal continuity, scroll intent, DOM identity, mutation/network budgets, mobile behavior.

The parent assigns every finding exactly one disposition: accepted, rejected, deferred, or needs verification. Only accepted findings enter a bounded fix pass, followed by affected revalidation.

### Wave 5 — report and archive

1. Create `reports/webui-main-agent-stream-output-isolation.html` using the HTML report workflow.
2. Record changed files, event-ownership contract, before/after mutation counts, test output, reviewer dispositions, and residual risks.
3. Move this plan to `plans/archive/` only after implementation, review, and verification are complete.

## 11. Detailed implementation sequence

### Phase A — characterize and guard the boundary

1. Add an explicit event classifier with exhaustive recognized stream subtypes.
2. Define a frozen forbidden-sink list for tests.
3. Add a diagnostic counter surface accessible only to tests or `?streamIsolationDebug=1`.
4. Capture raw event, frame flush, transcript mutation, follow-scroll, semantic-boundary, and forbidden-sink counts.
5. Do not change visible behavior until the diagnostics reproduce current coupling.

### Phase B — route raw deltas directly to transcript ownership

1. In `connectEvents`, retain current stale-source/tab-generation/supervisor checks.
2. In `handleEvent`, classify transcript stream events before `ingestEventTabActivity()` and `trackSkillsFromEvent()`.
3. Call `dispatchTranscriptStreamEvent(event)` and return when consumed.
4. Keep inactive-tab stream output data out of the active DOM; unread/running state is established at lifecycle boundaries.
5. Preserve unknown event diagnostics without granting unknown events global mutation authority.

### Phase C — unify normal and compact scheduling policy

1. Reuse or compose the existing compact scheduler design rather than creating parallel timer systems.
2. Retain at most one animation-frame handle and one bounded pending accumulator per active stream.
3. Flush text/thinking/tool updates in deterministic event order.
4. Flush synchronously on `message_end`, tool boundary, abort, tab switch, reconnect, or settlement.
5. Cancel pending frames/timers when the stream owner becomes stale.
6. Ensure hidden-tab throttling cannot lose the final tail.

### Phase D — split transcript activity from global lifecycle

1. Replace per-delta `setRunIndicatorActivity()` with a transcript-local stable-node update.
2. Introduce a lifecycle setter that updates composer/Stop state only when the lifecycle enum changes.
3. Keep activity wording changes from reparenting or reconstructing composer controls.
4. Remove delta-created state-refresh timers; state reconciliation is owned by semantic boundaries.
5. Preserve user-visible Stop immediately after `agent_start` and until settlement/confirmed failure.

### Phase E — remove token-driven widget and skill coupling

1. Delete `scheduleLiveTodoProgressWidgetSync()` from raw `text_delta` handling.
2. Derive todo progress once from authoritative assistant content after `message_end` or `refreshMessages()`.
3. Update only the `todo-progress` widget record when its semantic value changes.
4. Prefer in-place dedicated widget updates over `renderWidgets()` if post-message todo updates still occur while another widget is interactive.
5. Move skill tracking from `toolcall_start`/tool updates to one `tool_execution_start` or completion record.
6. Move event-log insertion to semantic start/end boundaries and deduplicate by tool/run ID.

### Phase F — decouple transcript refresh from chrome refresh

1. Make `renderMessages()` and `refreshMessages()` transcript-only.
2. Remove implicit `renderFooter()` and `renderFeedbackTray()` calls from transcript rendering helpers.
3. Add one semantic reconciliation scheduler with explicit dirty flags such as `messages`, `state`, `footer`, `usage`, `workflow`, and `widgets`.
4. At `agent_settled`, execute the minimum changed set once.
5. At `message_end`/`agent_end`, reconcile messages without reconstructing unrelated chrome.
6. Preserve existing special cases only when their data source actually changed.

### Phase G — interaction and lifecycle hardening

1. Verify dropdowns, menus, modals, widget inputs, file viewer, side panels, and tab interactions survive continuous output.
2. Verify selection in settled transcript content survives mutable-tail updates.
3. Verify paused-reader scroll position is unchanged.
4. Verify auto-follow changes only the chat pane.
5. Verify tab switch and reconnect cancel stale stream frames.
6. Verify abort flushes/preserves partial output and does not restore focus unexpectedly.
7. Verify tool and compact barriers do not reorder text/thinking/tool surfaces.

## 12. Validation contract

### 12.1 Unit and static checks

Add assertions that raw delta handlers contain or reach no forbidden sinks:

```text
renderWidgets
renderFooter
renderTabs
renderStatus
renderWorkspaceDashboard
renderContextMeter
renderFeedbackTray
scheduleRefreshState
scheduleRefreshFooter
requestGitFooterWebuiPayload
trackSkillsFromEvent
addEvent
scheduleComposerModeButtons
focus
scrollIntoView
```

Test controller behavior for:

- text/thinking/tool ordering;
- one-frame coalescing;
- first-frame behavior;
- barrier flush;
- abort/finish flush;
- stale-owner cancellation;
- hidden-tab/fallback scheduler behavior;
- unknown stream subtype handling;
- normal and compact mode parity.

### 12.2 Browser mutation-isolation harness

During a scripted 1,000-delta stream:

1. Attach `MutationObserver`s to all non-transcript roots.
2. Count attribute, text, and child-list mutations.
3. Spy on `fetch`, `EventSource` reconnects, focus calls, and forbidden renderer functions where feasible.
4. Capture `document.activeElement`, selection/caret, open state, scroll positions, and object identity of unrelated root/control nodes.
5. Allow only:
   - mutations under transcript-owned roots;
   - chat-pane `scrollTop` changes while auto-follow was already active;
   - elapsed-time rendering inside a transcript-owned activity node.

Scenarios:

- focused composer with a nonempty selection;
- model picker open;
- thinking picker open;
- branch picker open;
- widget text input focused;
- workflow/subagent/release details expanded;
- side panel and file viewer open with preserved scroll;
- transcript text selected;
- reader scrolled away from bottom;
- tool call and tool execution streaming;
- compact and normal output modes;
- mobile 390×844 and 320×568;
- abort during text, thinking, and tool output;
- retry, compaction, reconnect, and settlement.

### 12.3 Acceptance metrics

| Metric | Required result |
| --- | --- |
| Non-transcript DOM mutations during raw deltas | 0 outside explicit allowlist |
| Forbidden renderer calls during raw deltas | 0 |
| Delta-triggered HTTP/RPC requests | 0 |
| Focus changes during raw deltas | 0 |
| Unrelated root/control node replacements | 0 |
| Open dropdown/modal closure during raw deltas | 0 |
| Paused-reader non-chat scroll changes | 0 |
| Lost final text/thinking/tool tail | 0 |
| Lifecycle Stop visibility regressions | 0 |
| Normal/compact semantic mismatches | 0 |

### 12.4 Existing focused tests

At minimum rerun:

```bash
cd pi-package-webui
node tests/streaming-ui-coupling.test.mjs
node tests/interaction-state-stability-static.test.mjs
node tests/chat-scroll-intent-static.test.mjs
node tests/fast-output-live.test.mjs
node tests/fast-mode-client-static.test.mjs
node tests/webui-output-mode.test.mjs
node tests/fast-mode-output-work.test.mjs
node tests/completion-signal-contract.test.mjs
node tests/sse-backpressure-harness.test.mjs
node tests/thinking-stream-recovery.test.mjs
node tests/compaction-resume-harness.test.mjs
```

Then run:

```bash
npm run check
npm run test:browser -- --grep "stream output isolation"
git diff --check
```

Record every skipped check and every failure, including whether it predates this work.

## 13. Rollout strategy

1. Implement behind an internal compatibility constant only if a staged migration is needed; do not expose a user preference for incorrect coupling.
2. Keep the old path available for one development iteration only if required for A/B diagnostics.
3. Default isolation on once focused browser and full-suite checks pass.
4. Remove temporary diagnostics and legacy routing after evidence confirms parity.
5. Do not retain dual behavior indefinitely.

Recommended temporary flag if needed:

```js
const STRICT_STREAM_OUTPUT_ISOLATION = true;
```

The final implementation should make strict isolation unconditional.

## 14. Rollback and dirty-tree safety

- Before each implementation wave, save the focused target-file diff and record its hash/path.
- Revert only bounded feature hunks; never use repository-wide `git checkout`, `git restore`, `git reset`, or `git clean`.
- New controller/test files can be removed independently if the seam fails.
- If lifecycle separation regresses Stop/retry/compaction, retain the transcript-only router while reverting only the lifecycle/chrome split.
- Preserve all pre-existing hunks in:
  - `pi-package-webui/public/app.js`;
  - `pi-package-webui/public/index.html`;
  - `pi-package-webui/public/styles.css`;
  - `pi-package-webui/tests/browser/session-summary.spec.mjs`;
  - `pi-package-webui/tests/mobile-static.test.mjs`;
  - `pi-package-webui/tests/native-parity.test.mjs`.
- No staging, commit, push, release, or package-version change is authorized by this plan.

## 15. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Stop button no longer appears promptly | Set lifecycle state once at `agent_start`; test before first token and through settlement. |
| Inactive tabs lose running/unread indicators | Update once at lifecycle start/settled, not per delta. |
| Tool skills are not detected until execution | Track at `tool_execution_start`; fall back to completion record if start is absent. |
| Todo widget feels less live | Accept post-message consistency; later add a dedicated structured semantic event instead of parsing token text. |
| Final queued tail is lost | Mandatory synchronous barrier flush plus unit tests for abort/end/reconnect. |
| Normal and compact modes diverge | One controller contract with mode-specific transcript sinks; parity tests. |
| Voice mode depended on per-delta global state | Keep transcript/audio consumption as a dedicated sink; forbid it from rendering global chrome. |
| Lifecycle refresh still interrupts controls | Coalesce and render only changed semantic roots; browser-test active controls at settlement separately. |
| New module creates circular dependencies | Pure injected-sink module with no imports from `app.js` or chrome modules. |
| Existing dirty hunks are overwritten | Sequential single-writer work, focused diff snapshots, parent integration inspection. |
| Static checks pass but browser still interferes | MutationObserver/focus/node-identity browser contract is mandatory. |

## 16. External implementation evidence

The design adopts the strongest transferable patterns rather than copying an entire project:

- **LobeHub:** structural reference stabilization, narrow block/tool selectors, memoized content/tool boundaries.
  - `https://github.com/lobehub/lobehub/blob/5e1a35f259c3fa33925ac76732452499cd46759/src/features/Conversation/store/slices/data/stabilizeReferences.ts`
  - `https://github.com/lobehub/lobehub/blob/5e1a35f259c3fa33925ac76732452499cd46759/src/features/Conversation/store/slices/data/selectors.ts`
- **Vercel AI SDK:** stable chat object, independent message/status/error subscriptions, optional message callback throttling.
  - `https://github.com/vercel/ai/blob/258c0933/packages/react/src/use-chat.ts`
- **LibreChat:** per-tool-call atom-family progress and memoized message-content boundaries.
  - `https://github.com/danny-avila/LibreChat/blob/9efe4878e7251d3b66d0ece7135706fdacf5a334/client/src/hooks/SSE/useStepHandler.ts`
- **Open WebUI:** keyed message identity, animation-frame rebuild scheduling, and `content-visibility` for old content.
  - `https://github.com/open-webui/open-webui/blob/8dae237a/src/lib/components/chat/Messages.svelte`
- **NextChat and Chatbot UI:** retained as negative evidence against whole-store/context subscriptions, mutable broad state, and streaming-dependent keys.

Public ChatGPT, Claude, and Gemini sources do not expose their private component/subscription architecture and therefore are not implementation evidence for this plan.

## 17. Decision record

- 2026-08-05: classified as complex due event-router, transcript, lifecycle/chrome, widgets, and browser-interaction scope.
- 2026-08-05: selected strict transcript-only raw-delta ownership; rejected “more throttling” as insufficient.
- 2026-08-05: selected LobeHub-style narrow ownership and structural identity as the strongest external pattern.
- 2026-08-05: retained `transcriptRenderer`, SSE, compact mode, authoritative semantic reconciliation, and existing visual design.
- 2026-08-05: accepted that todo progress becomes authoritative/post-message unless a dedicated structured event is introduced.
- 2026-08-05: selected sequential shared-tree writers because target files already contain unrelated uncommitted changes.
- 2026-08-05: made browser mutation/focus/node-identity evidence a completion gate, not optional polish.

## 18. Progress and completion checklist

- [x] Local stream-to-UI coupling audited.
- [x] External TypeScript implementations compared.
- [x] Event ownership contract defined.
- [x] Implementation workstreams and validation contract planned.
- [ ] Wave 0 baseline captured immediately before implementation.
- [ ] WS1 controller/router implemented and integrated.
- [ ] WS2 lifecycle/chrome separation and browser proof implemented and integrated.
- [ ] Focused and full validation pass.
- [ ] Independent review findings dispositioned.
- [ ] Accepted fixes revalidated.
- [ ] Final HTML report created.
- [ ] Plan moved to `plans/archive/`.
