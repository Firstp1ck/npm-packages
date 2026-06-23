# Agent streaming → WebUI coupling: fixed issues and guards

Audit/fix log for places where the **agent output stream** previously drove
**WebUI chrome / global UI** work, instead of staying transcript-local. All
references are to `pi-package-webui/public/app.js` unless noted. Line numbers
will drift with edits — search by function name.

Guiding invariant (also documented in `handleMessageUpdate`):

> Streaming output must stay transcript-local. Full footer/status reconciliation
> happens on message/state refreshes, not per token.

Anything that performs global chrome reconciliation, forces synchronous layout,
or runs O(n) work *per streaming token* violates that invariant.

Severity legend for the original audit: **High** = visible jank / global
reconciliation per token · **Med** = per-token cost that scales with output
length (O(n²) over a stream) · **Low** = per-event or already throttled.

---

## 0. FIXED — Live todo-progress widget rebuild per token

- **Where:** `syncLiveTodoProgressWidgetFromText()`, called from the
  `handleMessageUpdate()` text stream path.
- **Was:** every token ran `updateOptionalFeatureAvailability()` and
  `renderWidgets()` (`widgetArea.replaceChildren()`).
- **Now:** per-token optional-feature reconciliation is removed. Widget rendering
  is coalesced with `scheduleLiveWidgetRender()` and live todo-progress parsing
  is further coalesced with `scheduleLiveTodoProgressWidgetSync()`.
- **Guard:** `tests/streaming-ui-coupling.test.mjs` keeps this scheduler pattern
  from regressing.

---

## 1. FIXED — Per-token forced layout reflow via `scrollChatToBottom()` — **High**

- **Where:** `handleMessageUpdate()`, `scrollChatToBottom()`,
  `scheduleChatFollowScroll()`, `applyChatFollowScroll()`.
- **Was:** `handleMessageUpdate()` and live stream-card creation could call
  `scrollChatToBottom()` on stream events; `scrollChatToBottom()` synchronously
  read `elements.chat.scrollHeight`, wrote `scrollTop`, and updated jump/sticky
  chrome.
- **Now:** message updates call `scheduleChatFollowScroll()` and
  `scrollChatToBottom()` only schedules frame-coalesced follow work. The
  layout-sensitive `scrollHeight` read/write and jump/sticky updates happen in
  `applyChatFollowScroll()` at rAF/settle boundaries rather than in the token
  handler.
- **Remaining note:** manual scroll/force paths can still request a scheduled
  follow scroll; that is intentional user/action behavior, not token-path work.

## 2. FIXED — O(n²) re-parse of accumulated text per token — **Med**

- **Where:** `syncStreamRawTextFromUpdate()`, `streamDerivedText()`,
  `syncStreamingThinkingFromUpdate()`, `scheduleLiveTodoProgressWidgetSync()`.
- **Was:** text/thinking updates repeatedly re-read accumulated partial messages
  and re-ran todo/thinking parsers from the token path.
- **Now:**
  - text deltas append via `appendStreamRawText()`; accumulated partial-message
    reads are limited to fallback events that do not carry deltas;
  - visible assistant output is cached in `streamDerivedTextCache`, keyed by
    `streamRawText`;
  - thinking deltas append to `streamThinkingRawText`, with partial-message
    fallback reserved for non-delta/end cases;
  - live todo-progress widget sync is rAF-coalesced before it scans the stream;
  - full-text line splitting uses `textLines()` instead of repeated regex split
    allocation.
- **Remaining note:** cache recomputation is still full-text when a render frame
  needs it; the important fix is removing repeated full-message work from the
  token dispatch path and coalescing scans to render cadence.

## 3. FIXED — Full markdown re-render fallback during streaming — **Med**

- **Where:** `renderStreamingMarkdown()`.
- **Was:** retroactive derived-text changes fell back through
  `block.replaceChildren()` and a full markdown rebuild.
- **Now:** the fallback resets the streaming markdown block with
  `clearStreamingMarkdownBlock()` and no longer uses `replaceChildren()` in the
  streaming fallback. Derived text is also centralized through
  `streamDerivedText()` so the renderer sees cached output rather than doing
  separate todo/thinking transformations.
- **Remaining note:** the renderer still correctly resets when a provider sends a
  true retroactive rewrite, but the reset is scoped to the streaming markdown
  block and is guarded by static tests.

## 4. FIXED — `setRunIndicatorActivity()` work on every token — **Low/Med**

- **Where:** `setRunIndicatorActivity()`, `scheduleRunIndicatorRender()`,
  `scheduleComposerModeButtonsUpdate()`.
- **Was:** activity changes could call `renderRunIndicator()` and
  `updateComposerModeButtons()` synchronously from token/tool update paths.
- **Now:** run-indicator rendering and composer-mode button reconciliation are
  rAF/timeout coalesced. Per-token callers pass `{ scroll: false }`, and the
  renderer only scrolls when an explicit scroll request survives to the scheduled
  render.

## 5. FIXED — `ingestEventTabActivity()` → `renderTabs()` per streaming event — **Low/Med**

- **Where:** `handleEvent()`, `eventHasTabActivityPayload()`,
  `ingestEventTabActivity()`, `scheduleTabsRender()`.
- **Was:** `handleEvent()` ingested tab activity for every server event, and a
  changed tab activity synchronously rebuilt the tab bar.
- **Now:** tab activity ingestion is gated to events with tab payload fields, and
  changed tab activity schedules `renderTabs()` through `scheduleTabsRender()`.
  Local tab activity helpers (`markTabWorkingLocally()`, `markTabIdleLocally()`,
  `markTabDoneLocally()`) use the same scheduler.

## 6. FIXED / WATCH — `markTabOutputSeen()` → `renderTabs()` — **Low**

- **Where:** `markTabOutputSeen()` and event-end cases.
- **Was:** event-end output-seen serial updates synchronously called
  `renderTabs()`.
- **Now:** output-seen serial changes call `scheduleTabsRender()` instead.
  Marking still happens on `agent_end` and `compaction_end`, so completion state
  is preserved without rebuilding the tab strip synchronously.
- **Status:** event-driven, not per-token; keep as a guard/watch item.

## 7. FIXED / WATCH — Skill / auto-retry tracking on every event — **Low**

- **Where:** `handleEvent()`, `eventMayAffectSkillUsage()`,
  `trackSkillsFromEvent()`, `trackAutoRetryStateFromEvent()`.
- **Was:** auto-retry and skill tracking ran before dispatch for every event;
  skill tracking also inspected all `message_update` events.
- **Now:** auto-retry tracking is limited to retry events, and skill tracking is
  gated to tool execution events, `message_update` `toolcall_start`, and
  `new_session` cleanup. Plain text/thinking deltas no longer enter skill
  tracking.
- **Status:** still keep side effects minimal if tracking grows.

## 8. GUARDED — `agent_end` injects a steer prompt into the agent — **Design note / Med**

- **Where:** `handleEvent()` `agent_end` →
  `requestGitFooterWebuiPayload(tabContext, { force: true })`.
- **Why it matters:** this posts `/git-footer-refresh --webui-silent` to
  `/api/prompt` with `streamingBehavior: "steer"`, meaning chrome refresh can
  write back into the agent stream.
- **Guard:** `requestGitFooterWebuiPayload()` returns while
  `currentState?.isStreaming || currentState?.isCompacting`, and `agent_end`
  clears `isStreaming` before forcing the refresh. Static tests pin both pieces.
- **Status:** guarded by design; do not use `force` while a run is active.

## 9. Reference patterns kept in place

- **Tool execution updates** (`handleToolExecutionUpdate()` →
  `scheduleLiveToolRunRender()`) remain throttled via
  `TOOL_LIVE_UPDATE_THROTTLE_MS` + rAF, and `tool_execution_end` deliberately
  skips a transcript refetch.
- **Footer/state/messages** reconcile through debounced
  `scheduleRefreshFooter/State/Messages(...)`, not per token.
- **Pointer/dropdown guards** (`deferUiRenderDuringPointerActivation()`,
  `deferChatFollowScrollDuringPointerActivation()`,
  `deferChatFollowScrollDuringInteractiveDropdown()`) continue to defer chrome
  churn while the user is interacting.

---

## Verification

Automated guards:

```bash
cd pi-package-webui
node --check public/app.js
node tests/streaming-ui-coupling.test.mjs
node tests/mobile-static.test.mjs
npm run check
```

Expected result after these fixes: all static/harness tests pass, including the
streaming/UI coupling invariants.

Manual profiling check: open DevTools Performance, stream a long response, and
confirm scroll/layout and chrome renders are coalesced to animation-frame cadence
rather than token cadence. Watch for unexpected `widgetArea`/`tabBar`/streaming
markdown teardown frequency.

## Online documentation verification

Reviewed browser-performance documentation supports the impact ranking used by
the original audit and the mitigation shape used here.

- **Forced layout / reflow is a verified hot-path risk.** Chrome's Forced Reflow
  insight defines forced reflow as JavaScript querying geometric properties after
  DOM/style invalidation, causing immediate layout and poor performance; multiple
  forced reflows in quick succession are layout thrashing. web.dev likewise says
  layout directly affects interaction latency and recommends avoiding forced
  synchronous layout by batching style/layout reads before writes.
  - Sources: [Chrome Forced Reflow insight](https://developer.chrome.com/docs/performance/insights/forced-reflow),
    [web.dev layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing).
- **The specific scroll metrics used here are layout-sensitive.** A
  Chromium-source-derived trigger list identifies `scrollHeight`, `scrollTop`,
  `clientHeight`, box metrics, `getBoundingClientRect()`, and scroll setters as
  APIs that can synchronously calculate style/layout when layout is invalidated.
  - Source: [What forces layout/reflow](https://gist.github.com/paulirish/5d52fb081b3570c81e3a).
- **rAF coalescing is the right mitigation shape for visual work.** MDN documents
  `requestAnimationFrame()` callbacks as running before the next repaint, and
  web.dev's rendering-performance guide frames smooth UI around a per-frame
  budget.
  - Sources: [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame),
    [web.dev rendering performance](https://web.dev/articles/rendering-performance).
- **Full DOM/markdown/chrome rebuilds are credible UI-jank sources.** web.dev
  documents that DOM insertions/deletions/content changes can trigger expensive
  style, layout, paint, and compositing work, with larger DOMs increasing the
  cost and affecting Interaction to Next Paint.
  - Sources: [DOM size and interactivity](https://web.dev/articles/dom-size-and-interactivity),
    [style recalculation scope](https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations).
- **O(n²) accumulated-text parsing is mainly a main-thread workload risk.**
  web.dev's long-task guidance says JavaScript tasks over 50 ms block the main
  thread and delay interactions. The exact impact still depends on message size,
  token cadence, and device speed.
  - Source: [web.dev optimize long tasks](https://web.dev/articles/optimize-long-tasks).
