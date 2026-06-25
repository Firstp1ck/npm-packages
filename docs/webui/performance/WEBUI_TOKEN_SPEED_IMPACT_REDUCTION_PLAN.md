# Pi Web UI token-speed impact reduction plan

Date: 2026-06-16  
Scope: reduce Web UI / extension overhead that can depress the footer `Speed tok/s` value or actual streaming throughput.  
Related analysis: `docs/webui/performance/WEBUI_OUTPUT_STREAM_LATENCY_ANALYSIS.md`  
Status: plan only.

---

## Goal

Make the Web UI path as close as possible to native TUI throughput for assistant streaming, especially for the footer `Speed tok/s` chip.

This plan focuses on things that can affect **actual measured token speed**, not just perceived UI smoothness.

Key distinction:

- Browser DOM/markdown/scroll jank can make output *look* slow, but usually should not reduce the `Speed tok/s` metric.
- Work inside the Pi RPC process, RPC stdout/SSE serialization, extension `message_update` handlers, and backpressure can reduce actual or measured speed because they run on the stream/event path.

---

## Current token-speed measurement path

The `Speed tok/s` chip is produced by `pi-extension-git-footer-status`, not by the browser renderer.

Relevant current behavior in `pi-extension-git-footer-status/index.ts`:

- `LIVE_TOKEN_SPEED_ROLLING_WINDOW_MS = 2000`.
- `message_start` for assistant initializes live token-speed state and immediately publishes Web UI footer status.
- `message_update` for `text_delta`, `thinking_delta`, and `toolcall_delta`:
  - increments `currentAssistantOutputChars` by `streamEvent.delta.length`;
  - estimates output tokens with `estimateTokensFromCharCount()`;
  - pushes token samples;
  - computes rolling live speed;
  - schedules Web UI footer publish via `scheduleWebuiFooterPublish(ctx)`.
- `scheduleWebuiFooterPublish()` throttles to roughly `250ms` and calls `publishWebuiFooter()`.
- `publishWebuiFooter()` builds a full footer payload and calls `ctx.ui.setStatus(WEBUI_FOOTER_STATUS_KEY, JSON.stringify(payload))`.

Why this matters:

- The measurement and footer publishing run inside the Pi RPC process.
- `ctx.ui.setStatus()` in RPC mode emits extension UI/status events over the same RPC stdout stream used for assistant updates.
- If the extension does too much work or emits too many status events during streaming, it can contend with assistant streaming and reduce measured/actual throughput.

---

## Primary hypotheses

### H1 — Live footer publishing from the extension adds stream-path overhead

Publishing a full JSON footer payload up to 4 times per second during streaming adds:

- payload construction inside Pi;
- JSON serialization for `setStatus` payload;
- extra RPC stdout events;
- extra Web UI server parse/forward work;
- browser parse/status render work.

This is the most direct Web UI-specific path that can affect `Speed tok/s`.

### H2 — Full RPC/SSE event payloads and status events increase stdout/SSE pressure

Assistant `message_update` events already include large/possibly growing objects. Adding footer status events increases traffic on the same pipe.

If stdout/SSE backpressure appears, the Pi process and Web UI server can spend more time moving JSON and less time processing model stream events.

### H3 — Token-speed calculation itself is cheap, but sample/publish cadence can still matter

The character-count/token-estimate math is likely cheap. The risky part is repeated publishing and full footer-payload construction from the stream event handler.

### H4 — Counting `thinking_delta` and `toolcall_delta` may distort the visible speed

The footer currently treats text, thinking, and tool-call argument deltas as output chars. That may be intentional, but it can make `Speed tok/s` less comparable to visible assistant text. This does not necessarily reduce throughput, but it can confuse interpretation.

---

## P0: Measure and create a no-footer baseline

### 1. Add an explicit live-speed overhead switch

Add env/config switches to `pi-extension-git-footer-status`:

```text
PI_GIT_FOOTER_DISABLE_LIVE_SPEED=1
PI_GIT_FOOTER_DISABLE_WEBUI_LIVE_PUBLISH=1
PI_GIT_FOOTER_WEBUI_PUBLISH_INTERVAL_MS=1000
```

Expected behavior:

- `DISABLE_LIVE_SPEED=1`: do not run live token-speed calculation on `message_update`; still compute final/historical speed from final assistant usage on `message_end`.
- `DISABLE_WEBUI_LIVE_PUBLISH=1`: compute live speed internally, but do not call `ctx.ui.setStatus()` during streaming.
- `WEBUI_PUBLISH_INTERVAL_MS`: tune current `250ms` throttle without code edits.

### 2. Run A/B measurements

Run the same deterministic prompt with:

1. Native TUI.
2. Web UI normal.
3. Web UI with live footer publish disabled.
4. Web UI with git-footer extension disabled entirely.
5. Web UI with compact/no optional companion packages if possible.

Capture:

- final assistant usage output tokens;
- elapsed `message_start -> message_end`;
- final computed tok/s;
- RPC stdout bytes/sec;
- number of `extension_ui_request` status events;
- Web UI SSE bytes/sec;
- server `res.write()` backpressure counts.

Acceptance criterion:

- If disabling live footer publish materially increases `tok/s`, prioritize P1.
- If disabling the whole extension materially increases `tok/s`, inspect all extension handlers and git/prompt-estimate work.
- If no difference appears, focus on provider/model/context rather than Web UI token-speed overhead.

---

## P1: Decouple live speed display from Pi extension status events

### Recommended architecture

Move **live Web UI speed display** out of the Pi RPC process and into the browser or Web UI server.

The browser already receives the same `message_update` deltas. It can compute a local live speed display without sending extra `setStatus` events through RPC.

Suggested split:

- `pi-extension-git-footer-status` remains responsible for:
  - final usage totals;
  - historical/final tok/s from real assistant usage;
  - git state;
  - prompt/context/cost metadata.
- Web UI browser owns:
  - current live visible-speed overlay while the assistant is streaming;
  - rolling char/token estimates from received deltas;
  - temporary override of the footer speed chip until `message_end`.

### Implementation sketch

1. Add Web UI client state:

```js
let clientLiveSpeed = null;
let clientLiveSpeedSamples = [];
let clientLiveOutputChars = 0;
let clientLiveEstimatedTokens = 0;
```

2. In browser `handleMessageUpdate()` for `text_delta` / optionally thinking/toolcall deltas:

```js
recordClientLiveSpeedDelta(update.delta || "");
scheduleFooterSpeedRender();
```

3. In `footerPayloadWithLiveModel(payload)` or immediately before rendering payload chips:

- If `currentState?.isStreaming` and `clientLiveSpeed !== null`, override the speed chip value.
- Do not require a fresh extension status event for every speed update.

4. On `message_end` / `agent_end`:

- Clear client live speed after final reconciliation.
- Let extension-provided final speed take over.

### Why this helps

- Removes repeated live speed `ctx.ui.setStatus()` calls from the Pi RPC stream path.
- Keeps the visible footer responsive without adding Pi-process overhead.
- Makes Web UI speed display based on browser-received deltas, so it reflects the user-visible stream arrival rate.

### Risk

The browser-estimated speed may differ slightly from extension-estimated speed. Label can stay the same because it is still an estimate; final speed remains extension/session based.

---

## P1 alternative: Keep extension-owned live speed but make it cheaper

If moving live speed to the browser is too invasive, reduce extension overhead first.

### 1. Raise publish interval during streaming

Change default Web UI publish interval from `250ms` to `1000ms`, with env override.

Recommended constant:

```ts
const WEBUI_FOOTER_LIVE_PUBLISH_INTERVAL_MS = readEnvInt("PI_GIT_FOOTER_WEBUI_PUBLISH_INTERVAL_MS", 1000);
```

### 2. Publish only when displayed speed changes meaningfully

Before `ctx.ui.setStatus()` during streaming, compare a compact fingerprint:

```text
speed-rounded | liveOutputTokens-rounded | contextPercent-rounded | model | thinking | gitFingerprint
```

Skip publish if unchanged.

### 3. Send a minimal live-speed status payload

During active assistant streaming, emit a small speed-only status event, not the full git/footer payload.

Example:

```json
{
  "type": "firstpick.git-footer-status.live-speed",
  "version": 1,
  "generatedAt": 123,
  "liveOutputTokens": 120,
  "latestTokenSpeed": 48.2
}
```

The Web UI can merge this with the cached full footer payload.

### 4. Do not call prompt/context estimate work from live publish

Ensure the live publish path cannot trigger prompt estimate refresh or context-heavy work. It should only read cached values.

---

## P2: Slim stream events and handle backpressure

This addresses the broader Web UI/RPC transport overhead that can reduce tok/s under load.

### 1. Compact browser `message_update` SSE events

In `pi-package-webui/bin/pi-webui.mjs`, transform browser-bound stream events:

- Keep lifecycle events full enough for correctness.
- For `message_update`, send only:
  - `type`, `tabId`, sequence number;
  - `assistantMessageEvent.type`;
  - `contentIndex`;
  - `delta` or final content;
  - minimal tool-call metadata.
- Drop full `event.message` / nested `partial` for browser SSE unless debug mode is enabled.

### 2. Add backpressure-aware coalescing

Currently `sendSse()` writes and ignores the return value.

Plan:

- Track if `res.write()` returns `false`.
- For slow clients, coalesce `message_update` and `tool_execution_update` to latest state until `drain`.
- Never drop lifecycle events (`message_start`, `message_end`, `tool_execution_end`, `agent_end`).

### 3. Add stream byte counters

Add debug counters:

- bytes per event type;
- status events per turn;
- dropped/coalesced update counts;
- average `JSON.stringify()` time.

---

## P3: Avoid extra extension work during streaming

### 1. Audit installed Web UI companion extensions

For each loaded companion, check whether it handles:

- `message_update`;
- `tool_execution_update`;
- `setStatus` / `setWidget` during streaming;
- `pi.exec()` during active agent runs.

Move non-essential work to:

- `message_end`;
- `turn_end`;
- `agent_end`;
- debounced background timers with streaming guard.

### 2. Add a generic extension guidance rule

Document or enforce:

> Do not perform synchronous heavy work or emit frequent UI status/widget updates from `message_update`; use throttled/lazy publish or browser-local rendering.

### 3. Add optional stream-safe mode

A Web UI startup flag or env var could disable live extension UI publishing while preserving final outputs:

```text
PI_WEBUI_STREAM_SAFE_MODE=1
```

Potential effects:

- disable live git footer publishing;
- disable live optional widget repaints unless explicitly marked stream-safe;
- keep safety/confirmation dialogs intact.

---

## P4: Make the speed metric clearer and more stable

### 1. Separate live visible text speed from all-output speed

Current live speed includes `text_delta`, `thinking_delta`, and `toolcall_delta`.

Consider separate modes:

- `visibleTextTok/s`: only `text_delta`.
- `assistantOutputTok/s`: text + thinking + toolcall deltas.
- `finalTok/s`: final usage output tokens divided by assistant message elapsed time.

Default Web UI chip should likely show visible text speed during normal text streaming, then final usage-based speed after `message_end`.

### 2. Avoid measuring delayed display as model speed

If the browser computes live speed from received deltas, do not include artificial first-paint guard time. Measure from first received delta, not from first visual paint.

### 3. Use final model usage when available

Live speed is an estimate. Final speed should prefer `message.usage.output / elapsedSeconds` when usage exists.

---

## Implementation order

### Phase 0 — Baseline and switches

1. Add env switches for disabling live speed and live Web UI publish.
2. Add debug counters for extension status events and stream bytes.
3. Run A/B benchmarks.

Deliverable: evidence whether git-footer live publishing affects `tok/s`.

### Phase 1 — Low-risk mitigation

1. Raise live Web UI footer publish interval from `250ms` to `1000ms` or make it adaptive.
2. Skip unchanged footer publishes.
3. Ensure live publish path uses cached prompt/context/git values only.

Deliverable: less RPC status traffic during streaming.

### Phase 2 — Decouple live speed display

1. Add browser-local live speed state.
2. Override speed chip while streaming.
3. Disable extension live Web UI publish by default or reduce it to final-only.

Deliverable: live speed UI without RPC status-event overhead.

### Phase 3 — Transport compaction

1. Compact `message_update` SSE payloads for browser clients.
2. Add backpressure coalescing.
3. Validate no correctness regressions on reconnect/final reconciliation.

Deliverable: reduced JSON/SSE overhead for all streaming, not just speed footer.

### Phase 4 — Extension stream hygiene

1. Audit all companion extensions for streaming event handlers.
2. Move non-critical work away from `message_update`.
3. Add stream-safe mode and documentation.

Deliverable: Web UI package remains throughput-safe as optional features grow.

---

## Validation scenarios

Use the same model/settings/session for each run.

### Prompts

1. Long plain text answer with no tools.
2. Long answer with reasoning/thinking enabled.
3. Tool-heavy turn with many tool calls.
4. Large bash/tool output.
5. Long-context session after many previous messages.

### Variants

1. Native TUI.
2. Web UI baseline.
3. Web UI with live Web UI footer publish disabled.
4. Web UI with git footer disabled.
5. Web UI after each implementation phase.

### Metrics

| Metric | Target |
|---|---:|
| Final `message.usage.output / elapsed` tok/s | Web UI within 5-10% of native for no-tool runs |
| Extension status events during assistant streaming | near zero after Phase 2 |
| SSE bytes during text stream | lower after compact events |
| `res.write()` backpressure count | zero on localhost; bounded/coalesced remotely |
| Browser live speed update interval | 250-1000ms; no RPC status event required |
| User-visible speed chip | still updates during streaming |

---

## Acceptance criteria

- Disabling git-footer live publishing no longer changes final tok/s materially.
- Normal Web UI streaming final tok/s is close to native TUI under the same model/context.
- During assistant streaming, `pi-extension-git-footer-status` does not emit frequent full footer `setStatus` events.
- The browser still shows a live speed chip.
- Final speed after `message_end` is based on real assistant usage when available.
- Backpressure and stream byte counters show no uncontrolled growth.

---

## Recommended first code change

Start with the smallest safe mitigation:

1. Add `PI_GIT_FOOTER_DISABLE_WEBUI_LIVE_PUBLISH` and `PI_GIT_FOOTER_WEBUI_PUBLISH_INTERVAL_MS` to `pi-extension-git-footer-status`.
2. Run benchmarks with live publish disabled.
3. If tok/s improves, implement browser-local live speed and make extension live publish final-only by default.

This directly tests the most plausible Web UI-specific cause of reduced `Speed tok/s` without committing to a larger transport refactor first.
