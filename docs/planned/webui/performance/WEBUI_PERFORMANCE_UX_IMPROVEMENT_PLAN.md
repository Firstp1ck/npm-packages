# Pi Web UI Performance & UX Improvement Plan

Date: 2026-06-11 · Baseline version: 0.3.9
Status update 2026-06-11: P0-1, P0-2, P0-3, P1-1, and P2-1 are **implemented** (see markers below). Verified via `npm run check` (6/6 test files) plus live HTTP checks: app.js 656 KB → 125 KB brotli, ETag/304 revalidation working, `/api/messages?since=` delta endpoint live-tested against the fake-pi harness.
Scope: `pi-package-webui` (server `bin/pi-webui.mjs` ~7k lines, frontend `public/app.js` ~15.2k lines / 644 KB, `public/styles.css` 190 KB, `public/index.html` 42 KB).

All findings are evidence-based with `file:line` references against the current tree.
Confidence per item: H = verified in code, M = verified pattern but impact estimated.

---

## Priority overview

| # | Item | Area | Impact | Effort | Conf. |
|---|------|------|--------|--------|-------|
| P0-1 ✅ | Incremental transcript rendering instead of full rebuild | Perf | High | M–L | H |
| P0-2 ✅ | Static asset compression + ETag caching | Perf | High | S | H |
| P0-3 ✅ | Streaming markdown: stop re-parsing the full message per delta | Perf | High | M | H |
| P1-1 ✅ | Delta endpoint for `/api/messages` (or apply SSE payloads directly) | Perf | High | M | H |
| P1-2 | Coalesce post-event refresh storms into one snapshot call | Perf | Med | S–M | H |
| P1-3 | Minify `app.js`/`styles.css` at publish time | Perf | Med | S | H |
| P1-4 | DOM cost caps for long sessions (windowing, `content-visibility`) | Perf | Med | S–M | H |
| P1-5 | Remove 419 KB matrix background from SW precache | Perf | Low–Med | S | H |
| P2-1 ✅ | Transcript search / filter | UX | High | M | H |
| P2-2 | Loading skeletons for initial tab load and tab switch | UX | Med | S | M |
| P2-3 | Broader `prefers-reduced-motion` coverage | UX | Med | S | H |
| P2-4 | Image attachments by reference instead of inline base64 | Perf/UX | Med | M | M |
| P2-5 | Perf instrumentation (`performance.mark`) + budget test | Infra | Med | S | H |

S = hours, M = 1–2 days, L = multi-day.

---

## Performance

### P0-1 — Incremental transcript rendering (stop full DOM rebuild) — ✅ implemented

> Implemented as keyed prefix reconciliation: `transcriptItemKey`/`transcriptItemSignature` per item, longest-common-prefix reuse in `renderAllMessages`, `removeChatBubblesAfterPrefix` for tail teardown, `pruneDisconnectedLiveToolCards` for map hygiene. Global display toggles force rebuild via epoch (`transcriptRenderEpoch`) or `forceRebuild: true`.

**Problem.** Every message refresh tears down and rebuilds the whole chat DOM:

- `renderAllMessages()` calls `resetChatOutput()` then re-appends *every* transcript item (`public/app.js:10967`).
- It runs after each `message_end`, `tool_execution_end`, `compaction_end`, etc. via `scheduleRefreshMessages(120ms)` (`public/app.js:14218–14242`, `public/app.js:6533`).
- Only tool-execution cards are reused (`captureReusableToolCards`, `public/app.js` near `reuseToolExecutionBubble`); all other bubbles (user, assistant, thinking, native, markdown bodies, ANSI spans) are re-created.
- A rebuild mid-stream needs the `restoreStreamRenderAfterChatRebuild()` workaround (`public/app.js:12605+`) — a symptom of the rebuild design.

Cost grows linearly with session length: a 300-message session with large tool outputs re-creates thousands of nodes (markdown parse, ANSI parse, diff line nodes) on *every* tool completion. This is the single biggest perf lever.

**Fix.**
1. Key each rendered bubble by a stable identity: `data-message-index` already exists; add `data-render-hash` (cheap hash of role + content length + timestamp).
2. In `renderAllMessages`, reconcile instead of reset:
   - walk existing children vs. `orderedTranscriptItems()`;
   - keep nodes whose identity+hash match (covers the common append-only case in O(1) per old message);
   - only create/replace changed or new tail items.
3. Extend the existing tool-card reuse map approach to all roles (the mechanism is already proven in `reuseToolExecutionBubble`).
4. The mid-stream restore hack can then be deleted because the streaming bubbles are never detached.

**Verify.** `performance.mark` around `renderAllMessages`; on a 200+ message session, a tool completion should re-create ≤ 3 bubbles instead of all. No visual diff in `tests/` snapshots; manual scroll-position check while streaming.

---

### P0-2 — Compression + caching for static assets — ✅ implemented

> Implemented in `serveStatic`: in-memory asset cache keyed by mtime/size, sha1 ETag + If-None-Match → 304, brotli (quality 6) with gzip fallback for text assets ≥ 1 KB, `cache-control: no-cache`, `vary: Accept-Encoding`. Live-verified: app.js 656 KB → 125 KB br; covered by tests in `http-endpoints-harness.test.mjs`.

**Problem.** `serveStatic()` reads the file and sends it uncompressed with `cache-control: no-store` (`bin/pi-webui.mjs:3309–3323`). There is no `Content-Encoding`, no `ETag` anywhere in the server (grep for `gzip|ETag` → no hits). The service worker is network-first by design (`public/service-worker.js`, "Network-first keeps the app shell fresh"), so **every page load re-downloads ~880 KB** (644 KB app.js + 190 KB styles.css + 42 KB index.html) even though `?v=43` cache-busters exist in `index.html:15,619`.

**Fix.** In `serveStatic`:
1. **Compression:** `node:zlib` brotli (fallback gzip) when `accept-encoding` allows it. Cache the compressed buffer in-memory keyed by `path + mtime` (the public dir is small and immutable at runtime). Expected: app.js 644 KB → ~110–140 KB br.
2. **Conditional requests:** compute a content hash per file at first read, send `etag`, answer `if-none-match` with `304`. This keeps the "always fresh after deploys" property the `no-store` policy was protecting, while making repeat loads near-free.
3. Optionally switch `cache-control` to `no-cache` (revalidate, don't forbid storage) so the 304 path actually works in browsers.

**Verify.** `curl -H 'Accept-Encoding: br' -sI localhost:PORT/app.js` shows `content-encoding: br` + `etag`; second request with `If-None-Match` returns 304. Reload network tab total < 50 KB warm.

---

### P0-3 — Streaming markdown: incremental parse instead of full re-parse — ✅ implemented

> Implemented via `streamingMarkdownStableBoundary` (last blank line outside a code fence, final partial line never stable) + `renderStreamingMarkdown`: the stable prefix is parsed once and kept; only the open tail is re-parsed per tick. Retroactive text changes (todo-strip) trigger a full-re-render fallback via prefix check.

**Problem.** During assistant streaming, every render tick re-parses the **entire accumulated message**:

- `renderStreamingAssistantText()` → `renderMarkdown(streamText, assistantText)` (`public/app.js:12535–12543`)
- `renderMarkdown` does `block.replaceChildren()` + full `renderMarkdownInto` re-parse (`public/app.js:9283–9286`).
- Throttled only by `STREAM_OUTPUT_TOOLCALL_GUARD_MS = 220` (`public/app.js:397`).

For a long answer this is O(n²) total work, plus full DOM churn of the streaming bubble (image/code/table nodes recreated, which can also cause flicker and lost text selection).

**Fix.** The renderer is line/block based (`renderMarkdownInto` walks lines, `public/app.js:9185+`), so a stable-prefix strategy is cheap:
1. Track the index of the last *closed* block boundary (blank line outside a code fence) already rendered.
2. Per tick, only re-render from that boundary: remove DOM nodes after the boundary marker, parse just the tail.
3. Keep full re-parse as fallback on the final `message_end` render for correctness.

**Verify.** Stream a 500-line answer; CPU profile shows per-tick parse time staying flat instead of growing. Text selection inside already-rendered parts survives streaming.

---

### P1-1 — Stop re-fetching the full transcript per event — ✅ implemented

> Implemented in three parts. **Server:** `applyMessagesSinceParam` slices `get_messages` results for `GET /api/messages?since=N`, returning `{ messages: tail, totalCount, since }` (legacy shape preserved without the param). **Client:** `refreshMessages` requests deltas with a one-message overlap; `mergeMessagesDelta` validates counts and overlap signature and falls back to a full fetch on compaction/fork/session change (tracked via `latestMessagesSessionKey`). Merges preserve message object identity, feeding a `WeakMap` static-signature cache so reconciliation no longer re-signs unchanged history. **Events:** `tool_execution_end` no longer schedules a transcript refresh — live tool cards cover the gap and `message_end`/`agent_end` reconcile — cutting per-turn fetches from O(tool calls) to O(assistant messages), each transferring only the tail.

**Problem.** `refreshMessages()` always GETs the complete `/api/messages` payload (`public/app.js:12842–12853`; server maps it 1:1 to RPC `get_messages`, `bin/pi-webui.mjs:3487`). It is scheduled after `message_end` and *every* `tool_execution_end` (`public/app.js:14221,14242`). Long sessions with inline base64 image parts (rendered via `appendImage`, `public/app.js:9289+`) make this payload large; it is re-transferred and re-JSON-parsed dozens of times per agent turn.

**Fix (either, ideally both):**
1. **Apply SSE payloads directly.** `message_update` / `tool_execution_*` events already carry the data needed to update the tail; use the full refresh only as periodic reconciliation (e.g. on `agent_end`, tab switch, reconnect) instead of per tool call.
2. **Delta endpoint.** Add `/api/messages?since=<index>` on the server (slice the RPC result before serializing) and have the client merge the tail into `latestMessages`.

Combined with P0-1, an agent turn with 10 tool calls goes from ~10 full-transcript fetch+rebuild cycles to incremental tail updates.

**Verify.** Network tab during a multi-tool turn: `/api/messages` calls drop from O(tool calls) to ≤ 2; transferred bytes drop proportionally to session length.

---

### P1-2 — Coalesce post-event refresh storms

**Problem.** Single events fan out into several independent debounced fetches: `scheduleRefreshMessages` (120 ms), `scheduleRefreshState` (120 ms), `scheduleRefreshFooter` (300 ms) (`public/app.js:6533–6561`), plus `refreshTabs`, `refreshStats`, git-footer payload requests (`refreshState` → `requestGitFooterWebuiPayload`, `public/app.js:12725–12736`). During a busy stream this produces continuous request bursts of 3–6 round-trips against a Node server that proxies each to the RPC helper.

**Fix.**
1. Add one `/api/snapshot?include=state,stats,footer` endpoint that performs the RPC calls server-side in parallel and returns one JSON body; or
2. Keep endpoints but funnel client scheduling through a single coalescing scheduler (one timer, a set of dirty flags, one batch executed per ~150 ms window).

**Verify.** Count requests during a 30 s streaming run (DevTools): expect ≥ 50 % fewer round-trips with identical UI state.

---

### P1-3 — Minify shipped JS/CSS

**Problem.** `public/app.js` ships as 644 KB of unminified source; `styles.css` 190 KB. Beyond transfer (mitigated by P0-2), parse/compile of 15k-line JS costs real time on mid-range phones — this is a PWA explicitly targeting mobile (`manifest.webmanifest`, mobile tests in `tests/mobile-static.test.mjs`).

**Fix.** A `prepublishOnly` esbuild step (`esbuild public/app.js --minify --sourcemap`) emitting `public/app.min.js` + referencing it from `index.html`, or minify-in-place in the publish pipeline. No bundler/module migration needed — keep the no-build dev workflow, minify only the published artifact. Expected ~60 % size cut pre-compression and noticeably faster parse.

**Verify.** `ls -la` of published tarball; Lighthouse "Script evaluation" time before/after on a throttled mobile profile.

---

### P1-4 — Cap DOM cost of long sessions

**Problem.** All messages stay in the DOM forever; collapsed tool outputs still insert the **full text** into the DOM alongside a duplicate preview (`appendToolOutput`, `public/app.js:10141–10166`: full `clean` goes into `<details>` plus a preview block). `content-visibility` is unused in `styles.css` (grep → 0 hits). Memory and style/layout recalc costs grow without bound.

**Fix.**
1. Cheap win first: `content-visibility: auto; contain-intrinsic-size: …` on `.message` bubbles outside the viewport — one CSS rule, large layout savings on long transcripts.
2. Lazy-fill `<details>` tool output: store full text in a JS map, render only the preview, inject the full text on first `toggle` event. Removes the duplicated text and keeps collapsed DOM small.
3. Optional: transcript windowing — render the last ~150 messages with a "Show earlier messages" button on top (plays well with P0-1 reconciliation; jump-to-latest logic already exists at `public/app.js:11123+`).

**Verify.** `document.querySelectorAll('*').length` and memory snapshot on a long session before/after; scroll jank profile (no long "Recalculate style" entries while streaming).

---

### P1-5 — Trim service worker precache

**Problem.** `matrix-background.webp` (419 KB) and `catppuccin-mocha-background.png` are in `APP_SHELL` (`public/service-worker.js:2–14`), so every client downloads and caches both backgrounds at install even if never used. That's ~45 % of the precache weight.

**Fix.** Remove backgrounds from `APP_SHELL`; cache them at first use via the existing `fetchThenCache` runtime path (extend the fetch handler's allow-list to background assets instead of precaching them).

**Verify.** SW install network trace: no background downloads on first visit; offline mode still shows the chosen background after it was used once online.

---

## User experience

### P2-1 — Transcript search — ✅ implemented

> Implemented as a Ctrl/Cmd+F search bar above the chat (`#chatSearchBar`): live match count, Enter/Shift+Enter + buttons for next/prev, current-match highlight, auto-expansion of collapsed tool output containing hits, auto-follow suppression while navigating, Escape to close.

**Problem.** No way to search within a session transcript (grep for `chatSearch|messageSearch` → 0 hits). Long agent sessions make "where did it say X" a real pain point; the side panel already has a command search input (`elements.commandSearchInput`) as a UI precedent.

**Fix.** A `Ctrl/Cmd+F`-style in-app search bar over `latestMessages` (data, not DOM), with hit count, next/prev, and scroll-to + highlight of the matched bubble (`data-message-index` lookup already exists). Respect the tool-output collapse state by auto-expanding a hit's `<details>`.

**Verify.** Manual: search hits inside collapsed tool output and old messages scroll into view and highlight; keyboard cycle works.

### P2-2 — Loading skeletons / perceived speed

**Problem.** Initial load and tab switches render an empty chat until `/api/messages` + state + footer return; only the offline/restart panels have spinners (`styles.css:405`). On slow links the app appears frozen.

**Fix.** Lightweight skeleton bubbles (3 shimmering placeholder rows) shown while the first `refreshAll` for a tab is in flight; reuse for tab switch. Add a subtle progress state to the tab strip while `refreshTabs` runs.

**Verify.** Throttled "Slow 3G" load shows skeletons within first paint; no layout shift when real messages arrive.

### P2-3 — Reduced-motion coverage

**Problem.** Only 2 `prefers-reduced-motion` rules exist in 6.6k lines of CSS, while the UI has entry animations (`action-enter`), spinners, and smooth scrolling. Accessibility gap and battery cost on mobile.

**Fix.** One global block: under `@media (prefers-reduced-motion: reduce)` disable `.action-enter` animations, shimmer effects, and switch programmatic smooth scrolls (`setChatScrollTopInstant` already exists — make it the only mode) to instant.

**Verify.** Emulate reduced motion in DevTools; no transcript animations remain.

### P2-4 — Image attachments by reference, not inline base64

**Problem.** Images render from `data:` URLs built out of base64 parts in the message payload (`appendImage`, `public/app.js:9293+`). Large screenshots inflate every `/api/messages` response (see P1-1), the in-memory `latestMessages`, and DOM attribute size; `loading="lazy"` doesn't help because data URLs are already in memory.

**Fix.** Server: serve image parts via `GET /api/attachments/:messageIndex/:partIndex` (stream from RPC data, set immutable cache headers since session content is append-only). Client: `img.src = that URL`. Message JSON then carries only metadata. Combine with a click-to-zoom lightbox (currently images are max-width-constrained with no full-size view).

**Verify.** `/api/messages` payload size with an image-heavy session drops dramatically; images still render, browser caches them across refreshes.

### P2-5 — Performance instrumentation + regression guard

**Problem.** No `performance.mark/measure` instrumentation exists, so none of the above can be tracked over time; perf regressions land silently (this plan's baseline had to be reconstructed by reading code).

**Fix.**
1. Wrap the hot paths (`renderAllMessages`, `renderStreamingAssistantText`, `refreshMessages`) with `performance.mark`/`measure` guarded by a `?perf=1` query or localStorage flag, logged to console table on demand.
2. Add a budget test to `tests/run-all.mjs`: assert published asset byte budgets (e.g. app.js minified < 300 KB, styles.css < 120 KB) so size creep fails CI.

**Verify.** `node tests/run-all.mjs` includes the budget check; `?perf=1` prints measure stats.

---

## Suggested order of work

1. **Phase 1 (quick wins, ~1 day):** P0-2 compression/ETag → P1-5 SW precache trim → P1-4.1 `content-visibility` rule → P2-3 reduced motion. All low-risk, immediately measurable.
2. **Phase 2 (rendering core, ~2–4 days):** P0-1 incremental transcript reconciliation, then P0-3 incremental streaming markdown (both touch the same code paths — do P0-1 first since it deletes the rebuild-restore hack).
3. **Phase 3 (data flow, ~2 days):** P1-1 delta/SSE-first messages + P1-2 snapshot coalescing.
4. **Phase 4 (UX features):** P2-1 search → P2-2 skeletons → P2-4 attachment refs.
5. **Continuous:** P1-3 minification in the publish pipeline and P2-5 instrumentation/budgets early in Phase 1 so all later phases are measurable.

## Non-goals / explicitly kept

- No framework/bundler migration: the vanilla-JS, no-build architecture is a deliberate strength (zero dev tooling, easy auditing). Everything above works within it.
- SSE stays (no WebSocket migration needed — one EventSource per tab with 15 s keepalive at `bin/pi-webui.mjs:6354–6380` is adequate once refresh storms are gone).
- The network-first SW philosophy stays; P0-2's ETag/304 path makes it cheap instead of replacing it.
