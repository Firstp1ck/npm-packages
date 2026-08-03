# WebUI performance and interaction smoothness

Status: planned and independently reviewed  
Scope: performance, responsiveness, drag-and-drop, and regression-safe architecture work  
Target package: `pi-package-webui`  
Integration owner: parent Pi session  
Created: 2026-08-03

## Goal

Make the whole WebUI feel smoother by reducing main-thread spikes and unnecessary work around user actions, especially terminal/tab/group switching, live output updates, resizing, and drag-and-drop, without weakening the existing state, focus, selection, scroll, accessibility, persistence, or event-ordering contracts.

## Success criteria

1. Terminal, subagent-terminal, and group activation paints the selected state promptly from cached data and does not wait for the full refresh fan-out.
2. A tab switch causes one coordinated render commit per response frame instead of multiple independent footer/dashboard/panel rebuilds.
3. Activity-only tab updates patch existing DOM; structural changes remain correct through a bounded full reconciliation fallback.
4. Pointer resize and drag handlers perform at most one visual update per animation frame and do not synchronously persist intermediate states.
5. A terminal drag remains stable for the complete gesture; polling or background activity does not detach the dragged node.
6. Streaming, tool, widget, and transcript settlement work scales with the changed tail where safe, with explicit full-reconcile fallbacks for compaction, fork/resume, divergence, and stale context.
7. Existing continuity, durable-layout, accessibility, and browser tests remain green. New behavioral performance tests make regressions measurable rather than relying only on static source assertions.
8. No optimization may drop authoritative final answers, reorder output, restore state into the wrong tab/session, or make keyboard/reduced-motion behavior worse.

## Classification and planning boundary

This is a **complex, multi-stage performance program**, not one implementation patch. It crosses the tab shell, transcript renderer, event/refresh orchestration, widgets, drag systems, persistence, CSS, browser tests, and memory behavior.

This document authorizes planning only. Each implementation stage should be separately approved and delivered in a small reviewable change. The plan intentionally avoids a framework migration, broad rewrite, transcript virtualization, or speculative CSS containment.

## Evidence basis

### Source and architecture inspected

- `public/app.js` — 41k+ line browser client and the main render/event/interaction surface.
- `public/transcript-renderer.mjs` — keyed transcript ownership, selection preservation, and incremental Markdown-tail reconciliation.
- `public/fast-output-live.mjs` — compact-output reducer and 100 ms sustained flush scheduler.
- `public/styles.css` — tab/group menus, drag feedback, layout tracks, animations, mobile shell, and responsive behavior.
- `bin/pi-webui.mjs` — tab activity decoration and SSE delivery.
- Existing implementation reports for interaction continuity, Git-panel render stability, and tab-group sizing.
- Static, harness, and Playwright tests listed in the validation contract below.

### Baseline verification performed during planning

| Check | Result |
|---|---|
| `npm test` | **Passed: all 105 test files** |
| `npx playwright test tests/browser/persistent-ui-layout.spec.mjs tests/browser/composer-action-grid-reorder.spec.mjs tests/browser/side-panel-section-reorder.spec.mjs --project=chromium` | **Passed: 11/11** |
| Full `interaction-continuity.spec.mjs` Chromium run | **21/22 passed**; one tool-details interaction timed out before the disclosure opened |
| Isolated failed interaction case with `--repeat-each=3` | **Passed: 3/3**, indicating a timing-sensitive/flaky baseline rather than a deterministic failure |
| Streaming, scroll, Git-panel, interaction-state, and transcript-cache focused tests | **Passed** |
| Runtime performance instrumentation search | No `PerformanceObserver`, `performance.mark`, or `performance.measure` coverage found |
| Existing cache characterization | 10 tabs × 30 long tool messages retained about **38 MiB serialized** and **75 MiB heap delta** |

The interaction-suite flake is part of the baseline and must not be hidden by performance work. Before implementation, rerun the complete browser suite enough times to determine its current failure rate.

## Performance model

The dominant risk is synchronous main-thread work, not one slow endpoint:

1. an interaction mutates state;
2. broad render functions replace roots and recreate listeners/tooltips;
3. independent refresh promises resolve and render overlapping surfaces again;
4. layout reads and writes can interleave during pointer movement;
5. streaming and settlement paths may rescan accumulated text or history;
6. correctness helpers then capture/restore focus, selection, tooltip, and scroll state around those mutations.

The correctness infrastructure is valuable. The plan reduces how often it is invoked and how much work each invocation performs; it does not bypass it.

## Findings and recommended treatment

### F1 — No runtime performance baseline or budget

**Priority:** P0 · **Confidence:** 98/100  
**Evidence:** no runtime marks/measures or long-task observer in the browser client; current performance checks are static contracts, algorithmic ledgers, or memory characterization.

**Risk:** an optimization can move cost, add visible delay, or regress another interaction while still passing all current tests.

**Treatment:** add opt-in, local-only instrumentation and a deterministic Playwright performance fixture before behavior changes. Record render counts, duration, long tasks, frame delay, storage/network commits, and DOM replacements. Do not send telemetry externally.

### F2 — Tab switching performs broad synchronous teardown before the full refresh fan-out

**Priority:** P1 · **Confidence:** 94/100  
**Evidence:** `switchTab()` around `public/app.js:14065` saves/caches state, resets the active UI, performs `renderTabs()`, reconnects SSE, and awaits `refreshAll()`. `resetActiveTabUi()` around `12782` clears/rebuilds several active surfaces. `refreshAll()` around `38231` launches 13 refresh operations.

**Mechanism:** click-to-paint includes tab-bar reconstruction, active-surface reset, cached transcript work, widgets/workflow/footer work, and then several response-driven renders.

**Treatment:** split activation into:

1. **Immediate cached commit:** update active identity/ARIA/classes, restore cached transcript/file-viewer/widget state, connect the event stream, and yield a paint.
2. **Coordinated refresh:** fetch tab-scoped data concurrently, stage results behind the active-tab generation, and commit affected surfaces once per frame.
3. **Deferred global refresh:** cache or independently refresh unscoped network/version data rather than requesting it on every tab switch.

Preserve the current generation and stale-response guards. Outgoing-tab draft, transcript, widget, and file-viewer capture plus subagent/split/voice teardown must remain strictly before `setActiveTabId`; the split must never cache outgoing state under the incoming identity.

### F3 — `renderTabs()` is structural reconciliation plus unrelated render fan-out

**Priority:** P1 · **Confidence:** 95/100  
**Evidence:** `renderTabs()` around `public/app.js:13980` replaces all tab-bar children, rebuilds tabs/groups/subagent tabs, restores controls/tooltips, then also renders workspace dashboard, context meter, Git panel, command palette, split state, polling, and mobile UI. The function is referenced roughly 40 times.

**Mechanism:** activity, blocker, workflow, app-runner, and subagent updates can pay structural tab reconstruction and downstream work even when only one badge/class/text value changed.

**Treatment:** extend the existing `scheduleTabsRender()` frame coalescer rather than adding a duplicate scheduler. Inventory and classify every direct `renderTabs()` call, add reason/dirty-state coalescing, and introduce three explicit paths:

- `patchTerminalTabState(tabId)` for activity/title/badge/ARIA changes;
- the existing `scheduleTabsRender(reason)` for latest-wins structural reconciliation;
- a separate `renderActiveWorkspaceSurfaces(reason)` transaction for dashboard/meter/Git/mobile dependencies.

Use keyed tab/group identity. Full rebuild remains the fallback when tab membership, order, group membership, virtual subagent views, or layout mode changes. Success requires eliminating unnecessary work inside the existing scheduler path, not merely routing already-coalesced activity calls through it.

### F4 — Refresh responses independently render overlapping surfaces

**Priority:** P1 · **Confidence:** 93/100  
**Evidence:** state, messages, stats, workspace, and model refreshes each call combinations of `renderStatus`, `renderFooter`, `renderContextMeter`, `renderWorkspaceDashboard`, `renderFeedbackTray`, and transcript rendering.

**Mechanism:** one tab switch or action completion can produce multiple same-frame DOM commits and repeated signature/focus/layout work.

**Treatment:** make refresh functions return normalized state deltas where practical. Add a per-generation render transaction that collects dirty surface flags and commits once on the next frame. Keep urgent optimistic model/thinking/run-state feedback immediate through narrow patch functions.

### F5 — Subagent terminal activation and polling rebuild the complete transcript and tabs

**Priority:** P1 · **Confidence:** 94/100  
**Evidence:** `activateSubagentTerminalView()` around `public/app.js:21501` renders the full child view, then all tabs, then refreshes. `renderSubagentTerminalView()` around `21384` clears and rebuilds the transcript. A meaningful poll change renders the child view and tabs again. The meaningful signature JSON-stringifies broad child data.

**Mechanism:** switching to or polling a child view can parse/rebuild the complete child transcript and then reconstruct the tab strip, even if only elapsed time, telemetry, status, or the tail changed.

**Treatment:**

- separate status/telemetry signatures from transcript content signatures;
- patch cards/status/elapsed values in place;
- reconcile child transcript entries by stable keys or append-only tail where available;
- render tabs only when the child/group summary actually changes;
- preserve the current retained-view, run identity, scroll-mode, and cancellation contracts;
- force the existing full child renderer on view/run identity change, transcript shrink, key mismatch, retroactive mutation, malformed payload, stale generation, or any append-contract ambiguity.

### F6 — Resize pointer loops interleave layout reads and grid writes per event

**Priority:** P1 · **Confidence:** 94/100  
**Evidence:** side-panel and file-viewer pointermove handlers calculate bounds from layout geometry, write grid-track CSS variables, and update handles on every event.

**Mechanism:** high-frequency pointer events can cause repeated style/layout work more than once per frame.

**Treatment:** cache bounds at pointerdown, retain the latest pointer coordinate, and apply the clamped width once per animation frame. Recompute bounds only on explicit viewport/shell transitions and at pointerup. Persist only the final width; preserve keyboard separator behavior.

### F7 — Side-panel and composer drags persist intermediate movement synchronously

**Priority:** P1 · **Confidence:** 96/100  
**Evidence:** `moveSidePanelSectionRelative()` persists on every crossed midpoint, then drag end persists again. Composer empty-cell movement applies layout/order and writes local persistence/journal state during pointer movement, then repeats persistence at drag end.

**Mechanism:** DOM/grid mutation is coupled to localStorage serialization, durable-journal updates, generation increments, and timer resets during the gesture. Server PUTs are already debounced, so the remaining spike is synchronous local work.

**Treatment:**

- add `{ persist: false }`/preview-only move modes for active pointer drags;
- rAF-coalesce hit testing and visual updates;
- stage the final target/slot and commit local/durable state once at pointerup;
- keep immediate persistence for keyboard moves;
- preserve current cancellation behavior: after activation, `pointercancel`, lost capture, or blur finalizes the last visible preview exactly once; before the drag threshold it commits nothing;
- cancel pending animation frames and clear drag markers/holds on every exit path.

### F8 — Terminal drag lifetime is not the render-deferral lifetime

**Priority:** P1 · **Confidence:** 93/100  
**Evidence:** terminal tabs use native HTML DnD around `public/app.js:4933`; generic pointer-render deferral has a 1200 ms safety ceiling, while a drag may last longer. Polling/activity can schedule tab reconstruction during the gesture.

**Mechanism:** the dragged node may detach, hover targets may reset, and the interaction can feel unstable during long drags.

**Treatment:** treat `terminalTabDragId` as an explicit render/poll hold. Coalesce structural updates while the drag is active and flush on drop, dragend, cancel, blur, or safety recovery. Bound the hold with an explicit timeout and continuously verify that the dragged tab still exists; recovery must clear the hold, pending durable-save deferral, classes, and queued structural work. Patch only non-destructive live indicators if necessary. Add a dedicated visual drag preview/handle that clearly identifies the actual tab.

### F9 — Existing terminal DnD semantics are incomplete and visually ambiguous

**Priority:** P1 UX decision / P2 implementation · **Confidence:** 96/100  
**Evidence:** tab-on-tab drop creates a group; it does not reorder. Intra-group reordering is unavailable. Dragging a group wrapper carries only the active tab. Native DnD has poor touch parity.

**Required product decisions before behavior changes:**

1. Does tab-on-tab mean grouping, insertion/reordering, or directional zones for both?
2. Does dragging a group move the group, move its active tab, or expose a dedicated child-tab handle?
3. Should mobile/coarse-pointer users receive pointer drag, explicit move/group controls, or both?

**Safe work before those decisions:** stabilize gesture lifetime, improve preview/feedback, remove unnecessary work, and preserve current grouping semantics.

### F10 — File-tree and queue drag hit testing updates broad DOM state on every dragover

**Priority:** P1/P2 · **Confidence:** 94/100  
**Evidence:** file-tree dragover queries and clears every target/blocked node before marking one target; handlers are bound per directory target plus root delegation. Queue dragover clears all row drag classes before marking one row.

**Mechanism:** cost scales with rendered tree/queue size and repeats at native dragover frequency.

**Treatment:** use one delegated root handler where possible, store previous target/state, update only old/new nodes, and rAF-coalesce target resolution. Do not alter authoritative file or queue mutation APIs.

### F11 — Streaming text/thinking can repeatedly scan accumulated content

**Priority:** P2 after measurement · **Confidence:** 89/100  
**Evidence:** normal streaming derives filtered/thinking/final output from accumulated text and computes stable Markdown boundaries. Thinking updates do not consistently share the same explicit sustained scheduler as compact output. The compact-output ledger already demonstrates much lower scan/write work.

**Mechanism:** long streams can approach quadratic text processing even though committed DOM blocks are preserved.

**Treatment:** first schedule thinking updates with latest-wins frame/sustained cadence. Then introduce incremental line/checklist/thinking-format state with explicit full-parse fallback on divergence. Keep `transcript-renderer.mjs` stable-block behavior and exact output ordering.

### F12 — Live tool updates deep-serialize and rebuild rich bodies

**Priority:** P2 · **Confidence:** 90/100  
**Evidence:** tool render signatures serialize arguments/results/details; changed live tools rebuild rich body/raw details at an 80 ms throttle.

**Mechanism:** large read/grep/bash/artifact payloads can cause action-completion spikes, especially with expanded details.

**Treatment:** use a trustworthy monotonic revision when available and cheap preview signatures only as a first-level filter; construct collapsed raw details lazily, bound preview serialization, and patch shell/status independently. Force the full renderer on missing/non-monotonic revision, signature ambiguity, settlement, expansion of lazily omitted details, or authoritative mismatch. Test equal-length/interior result changes so a bounded preview cannot hide authoritative updates. Preserve open/scroll/focus state and tool error/image/artifact semantics.

### F13 — Authoritative transcript settlement still projects and signs the full history

**Priority:** P2 · **Confidence:** 88/100  
**Evidence:** delta fetching and DOM-prefix reuse are implemented, but `orderedTranscriptItems()`/projections/maps/signatures still scan the history before discovering the reusable prefix.

**Mechanism:** long transcripts pay O(history) CPU on settlement/tab restore even when DOM mutation is tail-only.

**Treatment:** cache append-only projections and prefix state by tab/session/epoch. Invalidate and use the current full reconciliation on compaction, fork/resume, overlap mismatch, transient insertion, or equal-key signature divergence. Do not virtualize the transcript at this stage.

### F14 — Todo/live-widget updates rebuild the whole widget area

**Priority:** P2 · **Confidence:** 90/100  
**Evidence:** live todo extraction scans accumulated text; a changed signature enters `renderWidgets()`, which replaces the whole widget area and reconstructs unrelated widgets.

**Mechanism:** streaming progress can disturb app-runner/subagent/workflow widgets and add unnecessary DOM/layout work.

**Treatment:** give specialized live widgets stable hosts and patch only their content. Incrementally consume appended text with a full-parse fallback. Keep focus and scoped-scroll continuity.

### F15 — Scroll/sticky geometry work can compound live rendering

**Priority:** P2 measured only · **Confidence:** 82/100  
**Evidence:** follow-end reads/writes are frame scheduled, but sticky prompt targeting scans user prompts and reads geometry; some transcript paths update sticky state more than once per reconciliation.

**Mechanism:** many historical prompts plus live output can add forced-layout risk.

**Treatment:** profile first. If confirmed, cache prompt geometry per transcript epoch, rAF-coalesce scroll handling, update only the nearest target, and remove duplicate same-transaction sticky updates. Preserve the reader/follow-end intent state machine.

### F16 — Full per-tab transcript caches have a measured memory ceiling

**Priority:** P2/P3 · **Confidence:** 98/100 for existence, 75/100 for the right remedy  
**Evidence:** characterization observed about 38 MiB serialized and 75 MiB heap delta for 10 tabs × 30 long tool messages.

**Risk:** GC pauses and memory pressure can become interaction lag in long multi-tab sessions.

**Treatment:** design a byte-budgeted/LRU cache that never loses authoritative final answers. Prefer evicting reconstructable rich/tool render caches or inactive-tab derived state before raw authoritative transcript data. An evicted tab must reload transparently from the server. Do not ship a hard message-count cap without proving data safety.

### F17 — Ad-hoc schedulers and monolithic client increase recurrence risk

**Priority:** P3 · **Confidence:** 94/100  
**Evidence:** numerous independent rAF/timer guards and a large single client file; source-regex tests encode important performance invariants.

**Treatment:** after measured improvements, introduce small shared latest-wins scheduler/render-transaction helpers and migrate one subsystem at a time. Extract modules only along proven seams; do not combine behavior optimization, broad module extraction, asset splitting, and test rewrites in one change.

### F18 — CSS can amplify pointer/layout/paint cost

**Priority:** P3 measured only · **Confidence:** 80/100  
**Evidence:** broad relational `:has(...:hover/:focus-within)` tab-shell selectors, display toggles for group menus, grid-track transitions, multiple glow/box-shadow animations, and no targeted containment.

**Treatment:** profile style/paint tracks before changing CSS. Prefer explicit open-state classes, fine-pointer-only hover behavior, and composited transform/opacity feedback. Never add blanket `contain`/`content-visibility`; popovers, sticky headers, selection, accessibility, and find-in-page make that high risk. Ensure reduced-motion disables costly infinite effects rather than merely shortening them.

## Recommended implementation sequence

### Stage 0 — Measurement and reproducible baselines

**Files likely involved**

- new `public/performance-observer.mjs` or similarly isolated local module;
- `public/app.js` integration points;
- `public/service-worker.js` and asset revisions if the module is statically loaded; otherwise load it dynamically only behind the dev flag;
- `tests/fixtures/fake-pi.mjs` deterministic data/cadence fixtures;
- new `tests/browser/performance-smoothness.spec.mjs`;
- optional JSON baseline artifacts under `tests/fixtures/performance/` only if stable across CI.

**Work**

1. Add opt-in instrumentation behind a dev flag/query parameter; no external telemetry and negligible disabled-path overhead. If it is a new static module, add it to the service-worker app shell and advance coherent cache/asset revisions; otherwise use a guarded dynamic import.
2. Mark/measure tab activation, first selected-state paint, cached-content paint, settled refresh, tab reconciliation, widget render, transcript settlement, tool render, and drag/resize frame application.
3. Observe long tasks where supported; count DOM replacements, render commits, per-surface transaction commits, localStorage writes, layout PUTs, and relevant API calls.
4. Create deterministic scenarios for 1/20/50 tabs, grouped tabs, virtual subagent tabs, 100/1,000/10,000 messages, 10 KB/100 KB/1 MB tool output, expanded Git content, and active streaming.
5. For duration distributions, discard at least five warm-up runs and collect at least 30 measured samples per scenario in a fixed browser/headless mode, power profile, and CPU environment. Use one documented nearest-rank p95 calculation and interleave baseline/candidate batches on the same host. Repeat a batch when median coefficient of variation exceeds 10%. Do not gate on one wall-clock sample.

**Gate to leave Stage 0**

- Baseline is repeatable enough to distinguish a 20–30% change under the sampling contract.
- Existing interaction-suite flake rate is documented.
- Instrumentation itself changes measured disabled-path results by less than 2% or within measurement noise.
- Measured interaction delay, long-task contribution, render counts, and implementation risk produce a recorded hotspot ranking and explicit Stage 1 order. The provisional order below may be changed by that evidence.

### Stage 1 — Provisional low-risk/high-confidence interaction fixes

Implement as separate small PRs/patches. This is a risk-first provisional order, not a claim that resize work has more user impact than tab activation; Stage 0 may reorder it:

1. rAF-coalesced side-panel and file-viewer resizing;
2. preview-only section/composer drag movement with one persistence commit;
3. delegated old/new-target-only file/queue drag feedback;
4. full-lifetime terminal-drag render/poll hold;
5. tab active-state patch path and structural reconciliation scheduler;
6. split cached tab activation from coordinated refresh commit;
7. subagent-terminal status/transcript signature separation.

**Stage 1 targets**

- At most one visual resize/drag application per animation frame.
- Exactly one logical local/durable persistence commit per completed pointer drag.
- No structural tab DOM replacement during an active terminal drag.
- At least 30% lower p95 click-to-cached-paint time in the 20-tab/large-transcript fixture under the Stage 0 sampling contract.
- No more than 10% regression in small/default scenarios under the same local environment.
- No new >50 ms long task attributable to the changed interaction path.

Duration/long-task targets are local trace acceptance gates, not shared-CI wall-clock gates. Deterministic render, DOM-write, request, and persistence counts are the CI-blocking gates.

### Stage 2 — Streaming, tool, widget, and transcript CPU work

Deliver independently:

1. coalesced thinking rendering;
2. cheap/lazy live-tool signatures and collapsed detail construction;
3. stable per-widget hosts and todo tail parsing;
4. append-only cached transcript projections with full fallback;
5. measured sticky/scroll geometry reductions if Stage 0 confirms them.

**Stage 2 targets**

- Preserve exact event/output order and semantic transcript identity.
- Reduce scripting time by at least 30% in 100 KB and 1 MB stream/tool fixtures under the local sampling contract.
- Preserve or improve DOM-write counts from the existing fast-output ledgers.
- Zero increase in selection, disclosure, scroll, optimistic-prompt, or settlement failures across the required repeated browser runs.

Duration targets remain local trace gates; deterministic output hashes, event order, DOM-write counts, and behavioral invariants are CI-blocking.

### Stage 3 — Memory and architecture hardening

1. Define and test a reconstructable byte-budgeted inactive-tab cache.
2. Consolidate scheduler helpers one subsystem at a time.
3. Replace regex-only invariants with behavioral tests before restructuring their source.
4. Consider module extraction only after behavior and cache boundaries are stable.
5. Revisit CSS paint/style changes only with trace evidence.

## Validation contract

### Existing checks required after every stage

```bash
npm test
npm run test:browser
node tests/streaming-ui-coupling.test.mjs
node tests/chat-scroll-intent-static.test.mjs
node tests/git-panel-render-stability-static.test.mjs
node tests/interaction-state-stability-static.test.mjs
node tests/mobile-transcript-cache-characterization.test.mjs
```

`npm run test:browser` is required so all current Chromium specs—including mobile foundation, control-deck updates, stats overlay, and feature-decision UI—participate. Run affected timing-sensitive specs with `--repeat-each=5` in addition to the full suite. The isolated disclosure test passed 3/3 after one full-suite timeout; it needs recurrence tracking, not dismissal.

### New behavioral gates

1. **Tab switch:** selected ARIA/class updates on the first eligible frame; cached content belongs to the target tab; stale responses never paint.
2. **Render count:** one structural tab render for one structural mutation; activity-only updates use the patch path; every direct `renderTabs()` caller is classified in the test fixture.
3. **Refresh transaction:** rapid tab switches commit only the final generation, do not repeat unscoped global requests, and produce one immediate cached-paint commit plus at most one coordinated commit per dirty surface for that generation.
4. **Terminal drag:** a >2 s drag during active polling keeps source/target nodes connected and flushes one structural reconciliation after completion. Lost `dragend`, window blur, source-tab removal, and timeout recovery clear the hold and pending durable-save deferral; no hold can remain unbounded.
5. **Section/composer drag:** one localStorage/durable-journal commit per activated pointer gesture; keyboard moves remain immediately persisted. `pointercancel`, lost capture, and blur finalize the last preview exactly once, while pre-threshold cancellation commits nothing and every exit cancels pending frames/markers.
6. **Resize:** one applied width per frame; final width and ARIA value are correct after viewport/split changes; cancellation/blur clears pending frames and follows the documented finalization behavior.
7. **File/queue drag:** stable target feedback over large lists; no broad class sweep per dragover; one authoritative mutation on drop.
8. **Subagent terminal:** telemetry-only updates do not rebuild transcript or tabs; tail updates preserve scroll mode; identity change, shrink, retroactive mutation, key mismatch, malformed payload, and stale generation execute the full fallback.
9. **Streaming/tool:** long payloads meet measured scripting/long-task budgets and keep exact output/tool semantics; equal-length/interior mutations, missing revisions, settlement, lazy-detail expansion, and authoritative mismatch execute the full renderer.
10. **Transcript:** append path reuses projections; compaction/fork/resume/divergence executes and verifies the full fallback.
11. **Memory:** cache eviction cannot lose final answers; revisiting an evicted tab reconstructs the same transcript.
12. **Accessibility:** keyboard reorder, focus continuity, ARIA live regions, reduced motion, and coarse-pointer alternatives remain usable.

### Browser matrix

- The complete Chromium suite is required for every stage; affected timing-sensitive specs also run with `--repeat-each=5`.
- WebKit is required before claiming cross-engine drag/scroll parity.
- Test desktop fine pointer, coarse pointer/tablet emulation, narrow legacy mobile shell, and mobile-v2 flows.
- CI blocks on deterministic counts and behavioral invariants, not absolute duration. Duration/p95/long-task targets are verified in the controlled local trace environment.
- Manually inspect one Chrome Performance trace per changed hot path; automated durations alone are not sufficient.

## Regression invariants

Do not weaken these existing guarantees:

- active-tab generation and stale-response rejection;
- authoritative server state over DOM snapshots;
- ordered SSE/tool/message delivery;
- cached transcript/session identity isolation;
- exact selection and pointer-session continuity;
- reader versus follow-end scroll intent;
- open disclosure, text-control draft/range, tooltip, and focus continuity;
- optimistic prompt reconciliation;
- durable-layout conflict handling, offline journal, cross-tab adoption, and bounded retries;
- keyboard alternatives and accessible labels/live regions;
- retained subagent views do not control child lifecycle;
- service-worker and asset revision coherence.

## Anti-recommendations

1. Do not rewrite `renderAllMessages()` or `transcript-renderer.mjs` as the first optimization.
2. Do not virtualize or paginate the transcript before measured cache/projection work; selection, find-in-page, accessibility, and cross-message continuity make it high risk.
3. Do not add blanket debounces that make output or actions visibly stale.
4. Do not add blanket CSS containment or `content-visibility` to chat/panel roots.
5. Do not code-split the client until service-worker/boot-loader revision coupling is made atomic.
6. Do not change tab/group drop meaning while implementing render suppression.
7. Do not remove static regression contracts until equivalent behavioral coverage is green.
8. Do not optimize away authoritative file/queue mutation requests; optimize gesture feedback and reconciliation around them.
9. Do not cap transcript messages by count or discard final answers to reduce memory.
10. Do not mix measurement, broad refactoring, behavior changes, and asset-cache changes in one patch.

## Decisions needed before extended DnD work

These do not block Stage 0 or the performance-only parts of Stage 1:

- tab-on-tab drop semantics: group, reorder, or directional zones;
- group drag semantics: whole group versus active child;
- preferred mobile/coarse-pointer alternative;
- whether an opt-in shipped dev-performance flag is acceptable or instrumentation should exist only in test builds.

Recommended default: keep current grouping semantics initially, add full-gesture stability and clear tab-specific previews, and make ordering/mobile behavior a separately approved UX feature.

## Rollout and rollback

- Ship one stage and one hot path at a time.
- Before stacking the next optimization, enable the previous stage by default for a defined soak period or repeated real-workload session and record that its flags, fallback counters, and browser gates are stable.
- Keep the prior full-reconcile path callable as a fallback until the optimized path has repeated browser evidence.
- Prefer local feature/dev flags for Stage 0 and for high-risk append-only/cache paths.
- On stale UI, ordering, focus, selection, scroll, or accessibility failure, disable the narrow optimized path rather than reverting unrelated stages.
- Record baseline and post-change traces, commands, browser versions, fixture sizes, and residual risks in each implementation report.

## Completion checklist for the overall program

- [ ] Stage 0 instrumentation and deterministic baseline are reviewed.
- [ ] Tab/terminal/group activation meets the measured latency targets.
- [ ] Resize and drag paths are frame-coalesced and commit persistence once.
- [ ] Terminal DnD remains stable throughout polling and long gestures.
- [ ] Subagent-terminal polling patches narrow surfaces.
- [ ] Streaming/tool/widget improvements meet measured CPU targets.
- [ ] Transcript append fast path proves all invalidation fallbacks.
- [ ] Memory policy preserves authoritative final answers and reloads transparently.
- [ ] Existing and new browser/accessibility contracts pass repeatedly.
- [ ] Every reviewer finding is dispositioned with evidence.
- [ ] Completed plan is moved from `plans/planned/` to `plans/archive/` only after all approved stages are implemented and verified.

## Independent plan review dispositions

Two fresh read-only reviewers verified the source anchors and found no blocking omission. Their findings were independently checked and dispositioned as follows:

| Finding | Disposition | Plan change |
|---|---|---|
| Existing `scheduleTabsRender()` was described as if new | **Accepted** | F3 now extends the existing scheduler, inventories direct callers, and defines narrow versus structural paths. |
| Stage 1 order preceded measurement | **Accepted** | Stage 0 now ranks hotspots; Stage 1 is explicitly provisional and risk-first. |
| Child/tool fast paths lacked exact fallbacks | **Accepted** | F5/F12 and behavioral gates now enumerate divergence, revision, settlement, and authoritative fallback triggers. |
| Five samples were insufficient for p95 | **Accepted** | Sampling now requires warm-up exclusion, at least 30 measured samples, controlled environment, documented quantile, and variance bounds. |
| Coordinated per-surface commits were not asserted | **Accepted** | Refresh gate now counts the cached commit and at most one coordinated commit per dirty surface/generation. |
| Cancellation, blur, lost capture, and pending-frame cleanup were under-tested | **Accepted** | F7 and gates 4–6 define and test deterministic finalization and cleanup. |
| Browser validation omitted four current specs | **Accepted** | Every stage now runs the complete Chromium suite; affected timing-sensitive specs repeat five times. |
| Outgoing-tab capture ordering was implicit | **Accepted** | F2 now keeps draft/cache/teardown operations strictly before identity mutation. |
| Terminal-drag hold could become unbounded | **Accepted** | F8 now requires timeout, tab-existence liveness, and complete hold/save/render cleanup. |
| New instrumentation module could drift from the PWA shell | **Accepted** | Stage 0 requires guarded dynamic import or coherent app-shell/cache revision updates. |
| Duration gates could be flaky in shared CI | **Accepted** | Local trace timing gates are separated from deterministic CI-blocking count/behavior gates. |
| Stage stacking lacked a stabilization entry gate | **Accepted** | Rollout now requires soak/repeated-workload evidence before the next optimization. |

No reviewer finding was rejected or deferred. Reviewer artifacts are stored under `.pi-subagents/artifacts/` for runs `5fc17f56-5069-45c1-9a22-8f2ebd4c6353`.

## Confidence and residual uncertainty

**Overall plan confidence: 94/100.** Source-level mechanisms are directly verified, all 105 non-browser test files passed, drag/layout browser tests passed 11/11, and the one full interaction-suite timeout passed 3/3 in isolation. Confidence is below 100 because there is no production/runtime performance trace yet, user workloads vary by transcript/tool/tab size, and terminal DnD product semantics remain undecided. Stage 0 exists specifically to replace severity assumptions with measured evidence before higher-risk optimization.
