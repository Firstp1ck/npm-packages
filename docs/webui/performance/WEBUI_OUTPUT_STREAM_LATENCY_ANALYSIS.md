# Pi Web UI output-stream latency analysis

Date: 2026-06-16  
Scope: `pi-package-webui` output streaming versus native `pi` TUI streaming  
Package baseline inspected: `@firstpick/pi-package-webui` `0.4.5`  
Status: analysis only; no code changes proposed here are implemented in this file.

---

## Executive summary

The Web UI already contains important general performance work: incremental transcript reconciliation, static compression/caching, streaming-markdown stable-prefix rendering, and `/api/messages?since=` delta refreshes. Those improvements reduce whole-transcript and page-load cost, but the live output stream still has several streaming-specific latency sources that the native TUI does not have.

Most likely causes of the Web UI feeling slower than the native TUI:

1. **The first visible assistant text is intentionally delayed by `220ms`.** `STREAM_OUTPUT_TOOLCALL_GUARD_MS` guards initial text so pre-tool-call text can be suppressed. This creates a minimum first-token visual delay in common assistant-text turns.
2. **RPC + SSE sends large, repeatedly growing event payloads.** RPC `message_update` events include a partial/full message object plus a delta. Tool update events carry accumulated partial output. The Web UI currently forwards/parses these shapes in the browser, so serialized bytes and `JSON.parse` work can grow as output grows. Native TUI receives in-process objects and does not pay JSONL subprocess + SSE + browser parse costs.
3. **Text deltas are rendered too eagerly once the stream bubble exists.** After the first guarded render, each `text_delta` can trigger markdown rendering, footer rendering, and chat scroll/sticky prompt work immediately rather than coalescing to a TUI-like frame cadence.
4. **Live tool-output cards are throttled to `80ms` and then do full-card work.** Updates are intentionally less frequent than the TUI `16ms` render interval, then compute signatures, replace DOM, render full preview/details, and include raw tool JSON.
5. **Long open markdown blocks still create O(n²)-like work.** The streaming markdown stable-prefix optimization only becomes stable at blank lines outside code fences. A long paragraph or unclosed code fence is still a growing tail that is removed/reparsed per visual update.

Recommended strategy:

- **Measure first**, but keep instrumentation lightweight and behind `?streamPerf=1` or localStorage.
- **P0 quick wins:** replace the `220ms` first-text guard with a much shorter/stateful guard, batch stream paints with `requestAnimationFrame` or a 33ms cap, throttle footer/sticky work separately, and skip unchanged run-indicator/composer updates.
- **P1 high-impact fix:** slim browser SSE events and accumulate deltas client-side. Send full assistant/tool snapshots only on `message_end`, periodic reconciliation, or explicit fallback.
- **P1/P2 tool fix:** render live tool output incrementally and lazily render raw details/full output only when expanded or final.
- **Long-term parity option:** consider an SDK-backed Web UI backend instead of spawning `pi --mode rpc`, keeping RPC as a fallback. That would remove one major difference from native TUI.

---

## Current output pipeline

### Server-side stream path

1. Browser prompt submission eventually reaches a POST command handler and calls `tab.rpc.send(command)` for prompt-like commands (`pi-package-webui/bin/pi-webui.mjs:7640+`).
2. Each Web UI tab owns a spawned `pi --mode rpc` process. `PiRpcProcess.start()` attaches a strict JSONL stdout reader and stderr text reader (`pi-package-webui/bin/pi-webui.mjs:489`, `:519+`).
3. `handleStdoutLine()` parses each JSON line from RPC stdout and emits events or resolves pending command responses (`pi-package-webui/bin/pi-webui.mjs:553+`).
4. `attachRpcToTab()` annotates/scopes events, records them, then loops over `tab.sseClients` and calls `sendSse(client, scopedEvent)` (`pi-package-webui/bin/pi-webui.mjs:4810+`).
5. `sendSse()` writes one SSE message via `res.write("data: " + JSON.stringify(event) + "\n\n")` (`pi-package-webui/bin/pi-webui.mjs:818`).
6. `/api/events` exposes the browser EventSource endpoint with `text/event-stream`, `no-cache, no-transform`, and a 15s keepalive (`pi-package-webui/bin/pi-webui.mjs:7111+`).

### Browser-side assistant text path

1. The browser creates an `EventSource` in `connectEvents()` and `JSON.parse`s each message before `handleEvent()` (`pi-package-webui/public/app.js:17717+`).
2. On `message_start` for an assistant, the stream bubble state is reset and `streamMessageActive = true` (`pi-package-webui/public/app.js:17303+`).
3. On `message_update`, `handleMessageUpdate()` inspects `assistantMessageEvent` (`pi-package-webui/public/app.js:17308+`, `:15435+`).
4. On `text_delta` / `text_end`:
   - It tries to derive the full assistant text from `event.message` or `assistantMessageEvent.partial` via `assistantTextFromMessage()`.
   - It updates `streamRawText`.
   - It updates the run indicator, footer, and scroll position.
   - If the stream bubble already exists, it renders immediately; otherwise it schedules the first visible render after `STREAM_OUTPUT_TOOLCALL_GUARD_MS` (`220ms`).
5. `renderStreamingAssistantText()` strips todo-progress lines, ensures the stream bubble, and calls `renderStreamingMarkdown()` (`pi-package-webui/public/app.js:15320+`).
6. `renderStreamingMarkdown()` keeps markdown before the last blank line outside a code fence and reparses only the open tail (`pi-package-webui/public/app.js:11717+`).

### Browser-side tool-output path

1. `tool_execution_start` creates or updates a live tool run and renders immediately (`pi-package-webui/public/app.js:17318+`, `:13051+`).
2. `tool_execution_update` stores the accumulated `partialResult`, then schedules a live tool card render after `TOOL_LIVE_UPDATE_THROTTLE_MS = 80` plus the next animation frame (`pi-package-webui/public/app.js:13056+`, `:13291+`).
3. `updateLiveToolCard()` computes a render signature, captures open `<details>` state, `replaceChildren()` on the body, re-renders the tool card, restores open state, and caches the signature (`pi-package-webui/public/app.js:13261+`).
4. `renderToolExecution()` always appends raw tool details (`appendToolRawDetails()`), which serializes arguments/result/details into hidden DOM even for live partials (`pi-package-webui/public/app.js:13046+`, `:13160+`).

### Native TUI comparison

Native interactive mode handles the same agent event concepts in-process:

- On assistant `message_start`, it creates an `AssistantMessageComponent`; on `message_update`, it updates that component and calls `ui.requestRender()` (`@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2272+`).
- On `tool_execution_update`, it updates the relevant `ToolExecutionComponent` and calls `ui.requestRender()` (`interactive-mode.js:2359+`).
- `pi-tui` coalesces render requests using `TUI.MIN_RENDER_INTERVAL_MS = 16` and performs differential line rendering, writing one synchronized terminal buffer for changed lines (`@earendil-works/pi-tui/dist/tui.js:123`, `:475+`, `:1037+`).

This means the native TUI has fewer transport layers and a tighter render cadence:

```text
native TUI: model/provider event -> component update -> requestRender(16ms min) -> terminal diff write
web UI: model/provider event -> RPC JSONL stringify -> child stdout -> server JSON.parse -> SSE JSON.stringify -> browser EventSource -> browser JSON.parse -> DOM/markdown/layout/scroll
```

---

## Ranked findings and recommended solutions

### P0-1 — First visible assistant text is intentionally delayed by 220ms

**Evidence**

- `STREAM_OUTPUT_TOOLCALL_GUARD_MS = 220` (`pi-package-webui/public/app.js:482-484`).
- `scheduleStreamingAssistantTextRender()` waits that duration before rendering the first text when `streamToolCallSeen` is false and no stream bubble exists (`public/app.js:15330+`).
- The existing static test asserts that exact guard value (`pi-package-webui/tests/mobile-static.test.mjs:738-740`).

**Why it matters**

This is a direct minimum delay before the first visible assistant token in ordinary text turns. Native TUI usually shows the streaming component on `message_start` / `message_update` and then render-coalesces at about 16ms, not 220ms.

The guard solves a real UX problem: avoiding a flash of text that is later suppressed when a tool call begins. But the current blanket delay makes normal prose feel laggy.

**Recommendation**

Replace the fixed 220ms guard with a stateful, shorter policy:

1. **Shorten first-paint guard to 40-60ms** as an immediate A/B test.
2. Prefer **tool-call-aware suppression** instead of time-only suppression:
   - Start buffering first text immediately.
   - If a `toolcall_start` arrives before first paint, suppress/clear the buffered text.
   - Otherwise paint on the next frame or after a very short guard.
3. Add a dev override, e.g. `localStorage.piWebuiStreamGuardMs`, to tune without rebuilding.
4. Update `mobile-static.test.mjs` to assert the presence of a guard policy, not a hard-coded 220ms value.

**Target**

- First visible text after browser receives first `text_delta`: median `< 80ms`, p95 `< 120ms` on local desktop.
- No visible pre-tool-call flicker in tool-heavy turns.

---

### P0-2 — Browser stream rendering is not frame-coalesced after the stream bubble exists

**Evidence**

- Once `streamBubble` exists, every `text_delta` path calls `renderStreamingAssistantText()` immediately (`public/app.js:15480-15485`).
- The same branch also calls `setRunIndicatorActivity()`, `renderFooter()`, and `scrollChatToBottom()` per text update (`public/app.js:15482+`).
- `scrollChatToBottom()` immediately sets `scrollTop`, schedules a follow scroll, updates the jump button, and updates sticky prompt UI (`public/app.js:14073+`).
- Sticky prompt updates query user-prompt nodes and compute layout via `chatScrollTopForNode()` / `getBoundingClientRect()` (`public/app.js:12725+`).

**Why it matters**

Fast providers can deliver many small deltas per second. Rendering on each delta can saturate the browser main thread. When the main thread falls behind, output appears slower even if transport is delivering events quickly.

The native TUI avoids this by turning many `requestRender()` calls into a bounded render cadence (`16ms` minimum) and writing only changed terminal lines.

**Recommendation**

Introduce a dedicated stream paint scheduler:

- Update `streamRawText` synchronously on every event.
- Schedule a single visual paint with `requestAnimationFrame`.
- Add a maximum wait cap, e.g. 33ms, for cases where RAF cadence is delayed.
- During that paint, run `renderStreamingAssistantText()` and one coalesced scroll update.
- Move footer refresh to a separate low-rate scheduler, e.g. 250ms during streaming and immediate on `message_end`.
- Update sticky prompt/jump controls once per frame or only on user scroll / transcript changes, not every auto-follow scroll call.
- Make `setRunIndicatorActivity()` cheap when the activity text and active state did not change; avoid `updateComposerModeButtons()` on every token.

Pseudo-shape:

```js
let streamPaintFrame = null;
let streamPaintTimer = null;
let streamFooterTimer = null;

function scheduleStreamPaint({ force = false } = {}) {
  if (force) {
    flushStreamPaint();
    return;
  }
  if (streamPaintFrame !== null || streamPaintTimer !== null) return;
  streamPaintFrame = requestAnimationFrame(flushStreamPaint);
  streamPaintTimer = setTimeout(flushStreamPaint, 33);
}

function flushStreamPaint() {
  if (streamPaintFrame !== null) cancelAnimationFrame(streamPaintFrame);
  if (streamPaintTimer !== null) clearTimeout(streamPaintTimer);
  streamPaintFrame = null;
  streamPaintTimer = null;
  renderStreamingAssistantText();
  scrollChatToBottom();
  scheduleStreamingFooterPaint();
}
```

**Target**

- Browser handles high-frequency deltas without long tasks over 50ms.
- Visual update cadence around 30-60 FPS for small text, adaptive downshift for heavy markdown.

---

### P0-3 — RPC/SSE event payloads likely grow with accumulated output

**Evidence**

- Pi RPC docs define `message_update` as containing both `message` and `assistantMessageEvent`, where the event can include `partial` data.
- The Web UI forwards the scoped event with `JSON.stringify(event)` in `sendSse()` (`bin/pi-webui.mjs:818`).
- The browser uses `event.message` / `assistantMessageEvent.partial` to derive full assistant text on each delta (`public/app.js:15478+`, `assistantStreamingMessage()` / `assistantTextFromMessage()`).
- RPC docs define `tool_execution_update.partialResult` as the accumulated output so far, not only the new delta.

**Why it matters**

If every token event carries the full partial assistant message, bytes over time become approximately O(n²) for a long response. The server has already paid RPC JSONL parse cost, then the browser pays another SSE parse cost. For tool output, accumulated partial output can produce the same pattern.

Native TUI does not serialize these events to JSONL/SSE and does not parse them in a browser main thread.

**Recommendation**

Short-term: slim Web UI browser events while keeping RPC unchanged.

1. Add a server-side `eventForBrowserStream(event)` transform before `sendSse()`.
2. For `message_update`, send a compact form:
   - `type`, tab metadata, event sequence.
   - `assistantMessageEvent.type`, `contentIndex`, `delta`, final `content` on `text_end`, and minimal tool-call info.
   - Do **not** include full `event.message` or nested `partial` except on `message_start`, `message_end`, explicit reconciliation, or debug mode.
3. In the browser, maintain stream accumulators by `contentIndex`:
   - `text_delta`: append delta.
   - `text_end`: replace with final content if provided.
   - `thinking_delta`: append visible thinking delta.
   - `toolcall_*`: update tool-call metadata.
4. For `tool_execution_update`, compute deltas server-side per `toolCallId` and send only appended text plus summary counts. Periodically send a full snapshot, and always send full result on `tool_execution_end`.

Long-term: consider using `AgentSession`/SDK directly in the Web UI server so the Web UI no longer needs a child RPC process for local tabs. Keep `pi --mode rpc` as a compatibility fallback.

**Target**

- For a long streaming response, total SSE bytes should scale close to O(n), not O(n²).
- Browser `JSON.parse` should not appear as a significant long-task contributor during streaming.

---

### P0-4 — Live tool cards do full-card work and render raw JSON on partial updates

**Evidence**

- Tool updates are throttled by `TOOL_LIVE_UPDATE_THROTTLE_MS = 80` (`public/app.js:482-484`).
- `scheduleLiveToolRunRender()` waits 80ms and then a `requestAnimationFrame()` (`public/app.js:13291+`).
- `updateLiveToolCard()` computes `toolExecutionRenderSignature(message)`, captures details state, replaces all children, renders the full tool card, restores details state, and stores the signature (`public/app.js:13261+`).
- `toolExecutionRenderSignature()` serializes normalized tool fields including result/details (`public/app.js:13067+`).
- `renderToolExecution()` always appends `appendToolRawDetails()`, which `JSON.stringify`s arguments/result/details into DOM (`public/app.js:13046+`, `:13160+`).
- `appendToolOutput()` inserts the full output into a collapsed `<details>` plus a preview for long output (`public/app.js:12629+`).

**Why it matters**

The tool stream has a built-in visual update floor of roughly 80-96ms. The native TUI can request renders every ~16ms. More importantly, each Web UI tool update may process the entire accumulated output and rebuild the card. For large bash/read/grep output, that cost can dominate.

**Recommendation**

1. **Lower or adapt the throttle.** Start with 33ms for small outputs. If a measured render exceeds 12-16ms, back off to 80-120ms.
2. **Incremental DOM for common tools.** For bash/read/grep/find output:
   - Keep a stable `<pre>`/text node for visible output.
   - Track previous text length and append only the new suffix when possible.
   - Update summary/line count without rebuilding the full body.
3. **Lazy raw details.** Do not render `raw tool data` for `isPartial` live cards. Add a placeholder `<details>` and fill it only on first expand or final result.
4. **Avoid full JSON signatures for live partials.** Use a cheap signature: `toolCallId`, `isPartial`, `isError`, output length, details flags, argument length/hash, update sequence. Use full signature only for final reconciliation.
5. **Avoid duplicate full text in collapsed DOM.** For collapsed long outputs, keep only the preview in DOM and store full text in JS until expanded.

**Target**

- Small live tool outputs paint at p95 `<= 50ms` after browser receives update.
- Large outputs do not create long tasks over 50ms while collapsed.

---

### P1-1 — Streaming markdown still has expensive tails for long open blocks

**Evidence**

- `renderStreamingMarkdown()` only treats content before the last blank line outside a code fence as stable (`public/app.js:11717+`).
- It removes/recreates tail nodes each streaming render (`public/app.js:11760+`).

**Why it matters**

For normal prose with blank lines, the stable-prefix strategy is effective. But several common outputs keep the tail open for a long time:

- one very long paragraph;
- a long list without blank lines;
- an unclosed fenced code block;
- markdown table being streamed row by row.

In those cases, the "tail" is effectively the whole output so far, and per-frame parsing/replacement grows with message length.

**Recommendation**

Use a cheaper streaming representation for open tails:

1. Render stable markdown blocks as today.
2. Render the current open tail as plain escaped text or a minimal line renderer during streaming.
3. Parse the tail as markdown only when a stable boundary appears or on `message_end`.
4. For fenced code blocks, append to a text node inside the current code block instead of reparsing the entire fence.
5. For tables/lists, update at a lower markdown cadence (e.g. 100ms) while appending plain text every frame.

**Target**

- Per-paint markdown work remains roughly flat for a 500-line code block or 5,000-token paragraph.

---

### P1-2 — Run indicator, footer, and sticky-scroll UI are coupled to token cadence

**Evidence**

- `handleMessageUpdate()` calls `setRunIndicatorActivity()`, `renderFooter()`, and `scrollChatToBottom()` for text/thinking deltas (`public/app.js:15465+`, `:15482+`).
- `setRunIndicatorActivity()` renders the run indicator and updates composer mode buttons every call (`public/app.js:13631+`).
- `scrollChatToBottom()` updates jump and sticky prompt UI immediately and schedules another follow-scroll update (`public/app.js:14073+`).
- Sticky prompt targeting scans DOM and uses layout measurements (`public/app.js:12725+`).

**Why it matters**

Even if markdown rendering is optimized, these side updates can force layout or mutate DOM at token cadence.

**Recommendation**

- Deduplicate run indicator updates when the activity string does not change.
- Split "agent active state changed" from "activity text changed" so composer buttons are not updated on every token.
- Move footer rendering to a stream-footer scheduler with a low rate during streaming and immediate refresh on state/model changes.
- Cache sticky prompt targets and only recompute on transcript changes or user scroll, not every auto-follow scroll.
- Make `scrollChatToBottom()` schedule-only during streaming; avoid immediate layout work per token.

---

### P1-3 — Server SSE path does not expose backpressure or latency diagnostics

**Evidence**

- `sendSse()` ignores the boolean return of `res.write()` (`bin/pi-webui.mjs:818`).
- `/api/events` does not currently stamp stream events with sequence/timing metadata (`bin/pi-webui.mjs:7111+`).

**Why it matters**

On localhost this is usually minor. On remote/mobile clients or busy browser tabs, a slow client can fall behind. Without sequence/timing metadata, it is hard to distinguish model/provider latency from RPC parsing, server forwarding, browser parsing, or rendering.

**Recommendation**

- On SSE connection, call `req.socket.setNoDelay(true)` and `res.flushHeaders?.()`.
- Track a per-tab stream sequence number.
- In debug mode only, attach timestamps:
  - server received RPC event;
  - server sent SSE event;
  - browser received EventSource message;
  - browser completed DOM render;
  - next paint after render.
- If `res.write()` returns false for a streaming client, coalesce future `message_update` / `tool_execution_update` events to "latest only" until drain, while preserving lifecycle events.

---

### P1-4 — Post-event refreshes can still affect final perceived speed

**Evidence**

- `scheduleRefreshMessages()` and `scheduleRefreshState()` use 120ms timers, while footer uses 300ms (`public/app.js:7359+`).
- `message_end` schedules messages/state/footer refreshes; `agent_end` schedules state/messages/footer/Codex usage and git-footer refresh (`public/app.js:17275+`, `:17312+`).
- The existing performance plan already lists coalescing post-event refresh storms as remaining work.

**Why it matters**

This is less about live token cadence and more about the stream "settling" after the last token/tool. If the browser does multiple fetches and DOM reconciliations immediately after the final delta, the final answer can feel late or jumpy.

**Recommendation**

- Implement a single coalescing snapshot scheduler with dirty flags for `messages`, `state`, `footer`, `stats`.
- Prefer one `/api/snapshot?include=...` endpoint that performs server-side RPC calls in parallel.
- During active streaming, avoid transcript refreshes except for lifecycle/fallback cases; rely on SSE deltas and reconcile at `message_end` / `agent_end`.

---

### P2-1 — Long-session DOM/layout costs still matter while streaming

**Evidence**

- The transcript stays in the DOM, and no `content-visibility` rules were found for messages.
- `appendToolOutput()` stores full long output in collapsed `<details>` and also creates a preview (`public/app.js:12629+`).

**Why it matters**

Even if current streaming bubble work is optimized, style/layout calculation cost grows with transcript size. This makes later turns feel slower than early turns.

**Recommendation**

- Add `content-visibility: auto` and `contain-intrinsic-size` to message bubbles where safe.
- Lazy-fill collapsed tool-output details on expand.
- Consider transcript windowing for very long sessions: keep recent messages mounted and provide "Show earlier messages" for history.

---

## Measurement plan

Do not optimize blind. Add a temporary, low-overhead stream performance mode and collect the same prompt/tool scenarios in native TUI and Web UI.

### Metrics to capture

| Metric | What it answers |
|---|---|
| `rpc_event_received_at` | Is the server receiving events promptly from `pi --mode rpc`? |
| `sse_sent_at` | Is server processing or serialization slow? |
| `browser_event_received_at` | Is SSE transport or browser delivery slow? |
| `json_parse_ms` | Is browser parsing large events? |
| `handle_message_update_ms` | Is event handling doing too much? |
| `stream_markdown_ms` | Is markdown tail parsing the bottleneck? |
| `tool_live_render_ms` | Are live tool cards too expensive? |
| `footer_render_ms` | Is footer/status rendering coupled to tokens? |
| `scroll_follow_ms` | Is scroll/sticky prompt layout expensive? |
| `first_visible_token_ms` | The user-facing first-token metric. |
| `visual_update_interval_p50/p95` | Steady stream smoothness. |
| `long_task_count` | Browser main thread health. |
| `sse_bytes_per_turn` | Detects O(n²) event payload behavior. |

### Web UI instrumentation

Add behind `?streamPerf=1` or `localStorage.piWebuiStreamPerf = "1"`:

- `performance.mark()` / `performance.measure()` around:
  - `source.onmessage` start/end;
  - `handleMessageUpdate()`;
  - `renderStreamingAssistantText()`;
  - `renderStreamingMarkdown()`;
  - `renderLiveToolRun()` / `updateLiveToolCard()`;
  - `renderFooter()`;
  - `scrollChatToBottom()`.
- `PerformanceObserver` for `longtask` entries.
- A small in-memory counter table printed on `agent_end`.
- Count raw SSE `message.data.length` before `JSON.parse`.

### Server instrumentation

In debug mode:

- Add per-tab event sequence numbers.
- Record event JSON byte length before SSE write.
- Measure `JSON.stringify(event)` time for large events.
- Track `res.write()` false/drain counts per client.

### Native TUI comparison

Use existing TUI diagnostics:

- `PI_TUI_WRITE_LOG=/tmp/tui-ansi.log` to capture raw ANSI stream.
- `PI_DEBUG_REDRAW=1` and/or `PI_TUI_DEBUG=1` for redraw behavior where useful.
- Compare first visible output and update intervals against Web UI instrumentation.

### Synthetic scenarios

Use or extend the fake-pi harness to emit deterministic streams:

1. **Plain prose:** 1,000 small `text_delta` events.
2. **Long paragraph:** no blank lines, to stress markdown tail parsing.
3. **Long fenced code block:** unclosed fence until the end.
4. **Tool output small/fast:** 200 short `tool_execution_update`s.
5. **Tool output large:** accumulated output growing to 10k+ lines.
6. **Tool-call turn:** assistant begins with text then switches to tool call, validating the anti-flicker guard.
7. **Long session:** repeat above after 300 mounted messages.
8. **Remote/mobile:** same stream over LAN/mobile browser if that is part of the user complaint.

---

## Recommended implementation phases

### Phase 0 — Observability first (0.5-1 day)

- Add `?streamPerf=1` browser instrumentation.
- Add debug event byte/timing counters server-side.
- Add fake-pi scenarios for text and tool streams.
- Record current baseline before changing behavior.

Exit criteria:

- Can report first-token latency, p95 visual interval, stream render cost, SSE bytes, and browser long tasks for a single run.

### Phase 1 — Quick perceived-speed wins (1 day)

- Replace/reduce the 220ms first-text guard.
- Add frame-coalesced `scheduleStreamPaint()`.
- Move footer/sticky prompt/run-indicator side work off token cadence.
- Deduplicate run indicator/composer updates.

Exit criteria:

- First visible text improves substantially without pre-tool-call flicker.
- No stream text loss across `message_end`, reconnect, or transcript refresh.
- Existing mobile/static tests updated for new guard semantics.

### Phase 2 — Slim event payloads and accumulate deltas (1-2 days)

- Add server-side compact browser event shape for `message_update`.
- Implement client-side text/thinking accumulators by content index.
- Add tool-output delta events or server-side diffing for `tool_execution_update`.
- Keep full `message_end` and periodic reconciliation for correctness.

Exit criteria:

- SSE bytes for long responses scale linearly.
- Browser `JSON.parse` is no longer a notable long task.
- Compaction/fork/reconnect fallback still does a full safe refresh.

### Phase 3 — Incremental live tool DOM (1-2 days)

- Avoid full-card rebuild for common tool partial output.
- Lazy raw details and full collapsed output.
- Replace full JSON signatures with cheap live signatures.
- Make tool update throttle adaptive.

Exit criteria:

- Live bash/read output feels close to native TUI.
- Large tool output does not create repeated long tasks while collapsed.

### Phase 4 — Refresh and long-session cleanup (1-2 days)

- Coalesce state/messages/footer/stats refreshes.
- Add `content-visibility` / lazy tool details / optional transcript windowing.
- Add regression budget tests.

Exit criteria:

- Final answer settles without visible post-stream jank.
- Long sessions do not degrade streaming smoothness disproportionately.

### Phase 5 — Optional architecture parity

Evaluate a direct SDK/`AgentSession` Web UI backend:

- Pros: removes child process JSONL, stdout parsing, and one serialization boundary; closest to native TUI event path.
- Cons: larger refactor, risk to session/resource isolation, needs compatibility fallback.

EventSource itself does not need to be replaced first. SSE is adequate if payloads are slim and rendering is coalesced. WebSocket would not fix DOM/JSON payload growth by itself.

---

## Validation checklist

### Automated/static

- `npm run check` in `pi-package-webui`.
- Update tests that hard-code `STREAM_OUTPUT_TOOLCALL_GUARD_MS = 220`.
- Add static tests that:
  - text deltas schedule a coalesced stream paint instead of rendering directly;
  - partial live tool cards do not render raw tool JSON by default;
  - compact SSE event transform drops full partial message from browser `message_update`.
- Add fake-pi integration tests for `/api/events` stream byte counts and event ordering.

### Manual

- Prompt: "write a long explanation in one paragraph".
- Prompt: "write a 500-line code block".
- Tool: command that emits many small lines quickly.
- Tool: command that emits a very large output while collapsed.
- Tool-call scenario where initial assistant text should be suppressed before a tool call.
- Long existing session with many messages.
- Local desktop, mobile browser, and remote LAN if applicable.

### Acceptance targets

| Target | Suggested threshold |
|---|---:|
| First visible assistant text after browser receives first text event | median `< 80ms`, p95 `< 120ms` |
| Steady text visual interval | p95 `< 50ms` for normal prose |
| Small tool-output visual interval | p95 `< 50ms` |
| Browser long tasks during normal text stream | `0` over 50ms after warmup |
| SSE bytes for long text stream | O(n), not O(n²) |
| Final settle after `message_end` | no visible full transcript rebuild/jump |

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Shorter guard flashes text before tool call | Use a tiny first-paint buffer and suppress only if `toolcall_start` arrives before paint; add scenario test. |
| Coalescing stream paints drops final text | Force flush on `text_end`, `message_end`, tab switch, and reconnect. |
| Slim SSE shape breaks code expecting `event.message` on every update | Gate behind versioned browser event shape and keep full event in debug/fallback mode. |
| Tool-output delta misses truncation/full-output metadata | Send metadata snapshots periodically and full data on `tool_execution_end`. |
| More frequent paints raise CPU | Adaptive cadence: 33ms for cheap renders, back off when render cost is high. |
| Direct SDK backend changes trust/resource behavior | Treat as later architecture work; keep existing RPC backend until parity is proven. |

---

## Open questions

1. Is the user-perceived slowness mostly **first token**, **steady assistant text**, **tool output**, or **final settle**? Instrumentation should separate these.
2. Is the complaint from localhost desktop, remote LAN, mobile, or all clients?
3. How large are real `message_update` and `tool_execution_update` SSE payloads in current sessions?
4. Does every provider/RPC mode include full partial message content on every delta, or only some?
5. Should Web UI prefer immediate text display even if that occasionally flashes pre-tool-call text, or preserve the current no-flicker behavior?

---

## Most actionable next step

Start with Phase 0 plus two low-risk Phase 1 changes:

1. Add `?streamPerf=1` counters around EventSource receipt, `handleMessageUpdate`, stream markdown, tool live render, footer, and scroll.
2. Replace immediate per-delta text rendering with a frame-coalesced `scheduleStreamPaint()` and reduce the first-text guard from 220ms to a tunable 50ms.

Those two changes should quickly reveal whether the main issue is fixed by browser-side scheduling, or whether the larger payload-slimming work is required next.
