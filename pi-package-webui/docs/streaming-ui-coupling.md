# Agent streaming → WebUI coupling: potential causes

Audit of places where the **agent output stream** drives **WebUI chrome / global UI**
work, instead of staying transcript-local. All references are to
`pi-package-webui/public/app.js` unless noted. Line numbers are approximate and
will drift with edits — search by function name.

Guiding invariant (already documented in the code, in `handleMessageUpdate`):

> Streaming output must stay transcript-local. Full footer/status reconciliation
> happens on message/state refreshes, not per token.

Anything that performs global chrome reconciliation, forces synchronous layout,
or runs O(n) work *per streaming token* violates that invariant and is a
candidate cause for "the UI interacts based on the agent output stream".

Severity legend: **High** = visible jank / global reconciliation per token ·
**Med** = per-token cost that scales with output length (O(n²) over a stream) ·
**Low** = per-event (not per-token) or already throttled, watch-list only.

---

## 0. FIXED — Live todo-progress widget rebuild per token

- **Where:** `syncLiveTodoProgressWidgetFromText()`, called from
  `handleMessageUpdate()` `text_delta`/`text_end`.
- **Was:** every token ran `updateOptionalFeatureAvailability()`
  (git-footer payload reconciliation + full optional-feature control rebuild)
  and `renderWidgets()` (`widgetArea.replaceChildren()`).
- **Now:** per-token `updateOptionalFeatureAvailability()` removed; widget
  rebuild coalesced to one render per animation frame via
  `scheduleLiveWidgetRender()`.
- **Status:** Fixed. Listed here as the reference pattern for the items below.

---

## 1. Per-token forced layout reflow via `scrollChatToBottom()` — **High**

- **Where:** `handleMessageUpdate()` calls `scrollChatToBottom()` on every
  `text_delta`, `thinking_start`, `thinking_delta`. `ensureStreamBubble()` and
  `showStreamingThinking()` also call it.
- **Why it couples:** `scrollChatToBottom()` →
  `setChatScrollTopInstant(elements.chat.scrollHeight)` reads `scrollHeight`
  (synchronous layout/reflow) and writes `scrollTop` *every token*. Even when
  `autoFollowChat` is false it still runs `updateJumpToLatestButton()` and
  `updateStickyUserPromptButton()`, which read layout (`isChatNearBottom()` →
  `scrollHeight`/`scrollTop`/`clientHeight`). So scroll-state work happens per
  token regardless of follow state.
- **Impact:** layout thrash during fast streams; competes with the user's own
  scrolling; worst on mobile.
- **Mitigation:** coalesce follow-scroll to one rAF per frame (the
  `scheduleChatFollowScroll()` machinery already exists — route per-token calls
  through it instead of calling `setChatScrollTopInstant` synchronously each
  token), and debounce the jump/sticky button layout reads.

## 2. O(n²) re-parse of accumulated text per token — **Med**

Each of these scans the **entire accumulated** assistant text on **every** token,
so total cost is quadratic in output length:

- `assistantTextFromMessage(assistantStreamingMessage(event), …)` in
  `handleMessageUpdate()` (iterates the whole content array each delta).
- `stripTodoProgressLines(streamRawText, { streaming: true })` in
  `renderStreamingAssistantText()` (regex split of full text each token).
- `syncStreamingThinkingFormat(assistantText)` /
  `splitThinkingFormatText(...)` (re-parses full thinking/final split each token).
- `liveTodoProgressWidgetLinesFromText(streamRawText)` (full re-scan each token;
  residual cost even after fix #0 throttled the *render*).
- `assistantThinkingTextFromMessage(...)` in
  `syncStreamingThinkingFromMessage()` for every `thinking_delta`.

- **Impact:** long responses (or long thinking blocks) get progressively slower
  to stream; CPU climbs as the message grows.
- **Mitigation:** keep incremental cursors (only process the new delta tail),
  cache the last parse result keyed by `streamRawText.length`, and skip
  re-parsing when the delta did not cross a structurally relevant boundary
  (fence, newline, tag).

## 3. Full markdown re-render fallback during streaming — **Med**

- **Where:** `renderStreamingMarkdown()` — the incremental path is good, but it
  falls back to `block.replaceChildren()` + full re-render whenever
  `!text.startsWith(state.stableText)` ("earlier content changed retroactively").
- **Why it triggers mid-stream:** todo-progress line stripping and
  `<think>`/channel thinking-format splitting can retroactively change earlier
  text as the stream advances, tripping the full-rebuild fallback repeatedly.
- **Impact:** entire rendered markdown block torn down and rebuilt on affected
  tokens; flicker and CPU.
- **Mitigation:** make stripping/splitting append-only relative to the stable
  prefix, or compute the stable boundary *before* stripping so retroactive
  rewrites land only in the unstable tail.

## 4. `setRunIndicatorActivity()` work on every token — **Low/Med**

- **Where:** called on every `text_delta`, `thinking_delta`, `toolcall_start`,
  tool events, etc.
- **Why it couples:** each call runs `updateComposerModeButtons()` (builds a
  signature string from `isRunActive()`/`isAbortAvailable()`/
  `isAbortLongPressActive()`/`busyPromptBehavior`) and may call
  `renderRunIndicator()` → `scrollChatToBottom()` again.
- **Mitigating factors:** `updateComposerModeButtons()` early-returns when its
  signature is unchanged; `setRunIndicatorActivity()` skips render when activity
  text and state are unchanged. So steady-state tokens are cheap.
- **Risk:** the activity string changes between phases ("Writing response…" vs
  "Thinking…" vs per-tool names), and tool names change per call, forcing
  renders. `renderRunIndicator({ scroll: true })` then reflows.
- **Mitigation:** pass `{ scroll: false }` consistently from per-token paths
  (mostly already done) and gate the run-indicator ticker/scroll behind rAF.

## 5. `ingestEventTabActivity()` → `renderTabs()` per streaming event — **Low/Med**

- **Where:** `handleEvent()` calls `ingestEventTabActivity(event)` for **every**
  server event (including every `message_update`/`tool_execution_update`).
- **Why it couples:** when `event.tabActivity` changes
  (`tabActivityStateChanged(...)`), it calls `renderTabs()`, which rebuilds the
  tab bar. Streaming flips working/idle and updates titles, so the tab strip can
  re-render off the stream.
- **Mitigation:** coalesce `renderTabs()` to one rAF; only rebuild affected tab
  nodes instead of the whole strip.

## 6. `markTabOutputSeen()` → `renderTabs()` — **Low**

- **Where:** invoked on `agent_end`, `compaction_end`, and refresh paths; reads
  layout (`isChatNearBottom()`), then `renderTabs()` on serial change.
- **Status:** event-driven (not per token); low risk. Watch-list only.

## 7. Skill / auto-retry tracking on every event — **Low**

- **Where:** `trackSkillsFromEvent(event)` and
  `trackAutoRetryStateFromEvent(event)` run for every event in `handleEvent()`.
- **Why it couples:** mostly Map/Set bookkeeping, but
  `trackSkillsFromToolInvocation(...)` and `markTabWorkingLocally(...)` can
  trigger persistence/renders. `trackSkillsFromEvent` also reads
  `event.assistantMessageEvent` on `message_update`.
- **Status:** low cost today; watch if skill tracking grows side effects.

## 8. `agent_end` injects a steer prompt into the agent — **Design note / Med**

- **Where:** `handleEvent()` `agent_end` →
  `requestGitFooterWebuiPayload(tabContext, { force: true })`.
- **Why it matters:** this posts `/git-footer-refresh --webui-silent` to
  `/api/prompt` with `streamingBehavior: "steer"` — i.e. the WebUI **writes back
  into the agent stream** to refresh footer data. It is correctly suppressed
  while `isStreaming`/`isCompacting` (guard at top of
  `requestGitFooterWebuiPayload`), but `agent_end` forces it.
- **Risk:** a chrome concern (git footer) drives an agent prompt. If the guard
  regresses or `force` is used mid-run, footer refresh could interleave with the
  agent's own turn. Keep the streaming guard; never `force` while a run is active.

## 9. Things already done right (reference patterns)

- **Tool execution updates** (`handleToolExecutionUpdate` →
  `scheduleLiveToolRunRender`) are throttled via `TOOL_LIVE_UPDATE_THROTTLE_MS`
  + rAF, and `tool_execution_end` deliberately skips a transcript refetch.
- **Footer/state/messages** reconcile through debounced
  `scheduleRefreshFooter/State/Messages(...)`, not per token.
- **Pointer/dropdown guards** (`deferUiRenderDuringPointerActivation`,
  `deferChatFollowScrollDuringPointerActivation`,
  `deferChatFollowScrollDuringInteractiveDropdown`) defer chrome churn while the
  user is interacting — but only during those windows, not during plain
  streaming.

---

## Ranked impact of mitigations

| Rank | Mitigation | Output stream impact | UI impact | Why |
|---:|---|---|---|---|
| 1 | Coalesce per-token scroll work via rAF for `scrollChatToBottom()` / jump-sticky button layout reads | Medium | Very high | Biggest visible win. Removes forced layout/reflow from the hot token path and stops stream tokens from fighting user scroll. |
| 2 | Prevent full markdown rebuild fallback during streaming by making stripping/splitting append-only or stable-boundary-aware | High | High | Reduces flicker and markdown block teardown. Protects perceived stream continuity because earlier rendered content stops being repeatedly replaced. |
| 3 | Avoid O(n²) accumulated-text reparsing with incremental cursors / cached parse results | High | Medium/high | Biggest long-response scalability fix. Stream latency should stay flatter as output grows and the UI becomes less CPU-bound. |
| 4 | Coalesce `renderTabs()` from `ingestEventTabActivity()` to rAF / update only affected tab nodes | Low | Medium | Mainly reduces global chrome churn during streaming events. Helps responsiveness, but is less directly tied to transcript rendering. |
| 5 | Gate `setRunIndicatorActivity()` rendering/scrolling behind rAF and avoid scroll from per-token paths | Low/medium | Medium | Mostly already guarded by unchanged-signature checks, but useful around phase/tool-name changes. |
| 6 | Keep `/git-footer-refresh --webui-silent` strictly out of active runs | Potentially high correctness impact | Low/medium | Not a per-token perf fix, but architecturally important: prevents WebUI chrome from writing back into the agent stream mid-run. |
| 7 | Keep skill / auto-retry tracking side effects minimal | Low | Low | Watch-list item unless tracking grows heavier or starts rendering/persisting more often. |
| 8 | Leave `markTabOutputSeen()` / event-end tab refreshes alone unless profiling proves otherwise | Low | Low | Event-driven, not per-token. |

## Online documentation verification

Reviewed browser-performance documentation supports the current impact ranking and
keeps **#1 scroll/layout work** as the highest-confidence, highest-impact fix.

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
  This directly supports treating `scrollChatToBottom()` / `isChatNearBottom()`
  as the top risk.
  - Source: [What forces layout/reflow](https://gist.github.com/paulirish/5d52fb081b3570c81e3a).
- **rAF coalescing is the right mitigation shape for visual work.** MDN documents
  `requestAnimationFrame()` callbacks as running before the next repaint, and
  web.dev's rendering-performance guide frames smooth UI around a per-frame
  budget. Coalescing token-driven scroll/chrome updates to at most one rAF keeps
  work aligned with the browser's paint cadence instead of the token cadence.
  - Sources: [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame),
    [web.dev rendering performance](https://web.dev/articles/rendering-performance).
- **Full DOM/markdown/chrome rebuilds are credible UI-jank sources.** web.dev
  documents that DOM insertions/deletions/content changes can trigger expensive
  style, layout, paint, and compositing work, with larger DOMs increasing the
  cost and affecting Interaction to Next Paint. Rebuilding markdown blocks,
  widgets, or tabs during streaming therefore has a documented path to UI jank.
  - Sources: [DOM size and interactivity](https://web.dev/articles/dom-size-and-interactivity),
    [style recalculation scope](https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations).
- **O(n²) accumulated-text parsing is mainly verified as a main-thread workload
  risk, not a browser-layout risk.** web.dev's long-task guidance says JavaScript
  tasks over 50 ms block the main thread and delay interactions. That supports
  reducing repeated full-message parsing and doing less work per token, but the
  exact impact needs local profiling because it depends on message size, token
  cadence, and device speed.
  - Source: [web.dev optimize long tasks](https://web.dev/articles/optimize-long-tasks).
- **Tab/run-indicator updates remain lower-ranked unless profiling shows frequent
  affected-node churn.** Online docs support the general cost of DOM/style/layout
  updates, but the current code has unchanged-signature and event-driven guards,
  so the expected impact is below the token-path scroll and markdown work.
- **The git-footer steer-prompt item is architectural, not browser-performance
  verified.** Browser docs do not validate that risk; it should be verified from
  WebUI/agent protocol behavior and guarded by code invariants/tests.

## Suggested priority order

1. **#1** per-token scroll reflow (most visible jank, hits every stream).
2. **#3** markdown full-rebuild fallback (flicker, triggered by the
   thinking/todo features that are on by default).
3. **#2** O(n²) re-parsing (degrades long responses and directly affects output
   stream smoothness).
4. **#5** tab-strip re-render per event.
5. **#4 / #7 / #8** low/medium watch-list and design guards.

## How to verify a fix

- Run the package checks: `cd pi-package-webui && npm run check` (runs
  `node --check` on `public/app.js` and the static/harness suites in `tests/`).
- Manual: open DevTools Performance, stream a long response, and confirm there is
  **at most one** layout/reflow and one chrome render per animation frame (not
  per token). Watch for `widgetArea`/`tabBar`/markdown-block teardown frequency.
