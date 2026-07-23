# Implementation Plan

**Canonical repository destination:** `pi-package-webui/plans/webui-fast-mode.md`
**Final integration report:** [WebUI Fast Mode final report](../reports/webui-fast-mode.html)
**Planning confidence:** 93/100

## Goal

Add a default-normal, optional WebUI compact output mode that reduces only post-RPC-parse transport/render work while preserving final semantics and rich transcript reconciliation.

## Classification

**Complex — validated.** This change spans persisted server configuration and startup precedence, a versioned per-client SSE protocol, server event transformation/history behavior, browser scheduling and rendering, deterministic production-tied measurement, compatibility harnesses, documentation, and post-review reporting. It has two sequential, independently testable implementation workstreams with a hard API handoff, plus reliability-sensitive mode changes during active streams. This supersedes the preliminary lightweight classification.

Discovery evidence: `fast-mode-output-pipeline.md` and `fast-mode-benchmark.md` were read along with the current server, client, settings, test, README, and plan conventions. The requested worktree `context.md` was not present (`ENOENT`); no consequential product decision remains unresolved because the task supplies the approved v1 contract. Re-read it in Wave 0 if it reappears, and stop only for a material contradiction.

## Approved Decisions

| ID | Decision | Disposition |
|---|---|---|
| D1 | Feature classification | Complex; accepted. |
| D2 | Default and scope | Built-in, optional WebUI output mode; default `normal`. It is not an optional package and does not alter Pi generation. |
| D3 | Server default precedence | `--output-mode` explicit CLI value > `PI_WEBUI_OUTPUT_MODE` > persisted WebUI setting > `normal`. This precedence resolves the **server default**, not an explicit client request. |
| D4 | Persistence | Add `outputModeDefault: "normal" | "compact-v1"` to the existing WebUI settings file resolved by `PI_WEBUI_SETTINGS_FILE`, with a schema migration/default. |
| D5 | Client protocol | Use explicit per-EventSource `compact-v1` capability negotiation. Missing, invalid, or old negotiation fails closed to normal. Mode is never stored on a tab or Pi process. |
| D6 | Mode changes | Changes to the server default affect only `auto` clients and take effect immediately when idle or after the next semantic barrier when active. |
| D7 | Live UX | Compact mode uses plain-text live output, first-flush liveness plus a maximum 100 ms sustained-output flush interval, lightweight tool shells, and rich final reconciliation. |
| D8 | Tool work | Omit intermediate `tool_execution_update` in compact mode; defer tool body construction until final reconciliation. Preserve start/end/error semantics. |
| D9 | Debug history | Coalesce adjacent canonical assistant-delta history entries into bounded summaries; never retain accumulated content in history. |
| D10 | Measurement | Require deterministic `Wnormal = R + 2*Snormal`, `Wfast = R + 2*Sfast`, ratio `>= 1.5`, and exact semantic/deep/hash parity. Do not make a wall-clock or token/s claim. |
| D11 | Optimization boundary | Begin only after `PiRpcProcess.handleStdoutLine()` has completed JSON parsing. Do not change Pi RPC input serialization, model/provider behavior, prompts, tools, inference, extension execution, or installed dependencies. |
| D12 | Prior-plan conflicts | Supersede the prior mirror's browser-local boolean, browser-setting precedence, 410-event fixture, and B-owned HTML report. V1 uses a persisted **server** default, the approved precedence chain, the fixed 512-delta trace, and an integration-owner-only final report. |

## Exact Architecture and Interfaces

### 1. Configuration and server-default resolution

Add a pure server-side output-mode module and use the existing atomic WebUI settings store.

- CLI: `pi-webui --output-mode <normal|compact-v1>`.
- Environment: `PI_WEBUI_OUTPUT_MODE=normal|compact-v1`.
- Persisted key: `outputModeDefault` in `~/.config/pi-webui/settings.json` or `PI_WEBUI_SETTINGS_FILE`.
- Accepted values are exactly `normal` and `compact-v1`; absent persisted data normalizes to `normal`.
- Invalid explicit CLI or environment values fail startup with an actionable error. Invalid persisted values normalize to `normal` and are surfaced in validation/logging rather than passed through.
- The resolved default is represented as `{ mode, source }`, where `source` is `cli`, `env`, `persisted`, or `normal`.

Expose an authenticated/local WebUI configuration API separate from Pi's `SettingsManager` payload:

```text
GET  /api/webui-output-mode
PUT  /api/webui-output-mode  { "outputModeDefault": "normal" | "compact-v1" }
```

The GET response must include `persistedDefault`, `effectiveDefault`, `source`, and `overridden` (true for CLI/env). PUT writes the persisted value even when CLI/env currently overrides it, then returns the same resolved metadata. It must not restart Pi or mutate session state.

`/settings` displays the control in **Browser workflow** with a `server` badge and copy that explains: it controls new/auto-negotiated WebUI connections; CLI/env may temporarily override it; compact mode simplifies only live display and restores rich final output. It is not added to `nativeSettingsPayload()` or `SettingsManager`.

### 2. Per-client compact-v1 negotiation

The public EventSource contract is:

```text
GET /api/events?tab=<id>&outputMode=auto|normal|compact-v1&outputModeProtocol=1
```

Rules:

1. The browser shipped by this feature uses `outputMode=auto&outputModeProtocol=1` for every connection.
2. `normal` explicitly requests normal.
3. `compact-v1` explicitly requests compact mode only with protocol `1`.
4. `auto` with protocol `1` uses the resolved server default. `auto` without protocol `1`, omitted/invalid parameters, unsupported protocol versions, and old clients use normal.
5. Explicit `normal`/`compact-v1` are per-client negotiation choices; the CLI/env/persisted precedence remains the resolver for `auto` only.
6. Each SSE descriptor contains at least `{ res, requestedMode, protocolVersion, activeMode, pendingMode, defaultSource }`. A tab's state and Pi RPC process never contain a client mode.

The first untransformed `webui_connected` event includes:

```json
{
  "outputMode": {
    "protocolVersion": 1,
    "requestedMode": "auto",
    "activeMode": "normal",
    "serverDefault": "normal",
    "serverDefaultSource": "normal"
  }
}
```

When an `auto` client changes mode after connecting, emit an untransformed control event before the first event in the new representation:

```json
{
  "type": "webui_output_mode",
  "protocolVersion": 1,
  "previousMode": "normal",
  "activeMode": "compact-v1",
  "reason": "server-default-change"
}
```

A client may activate compact handling only after a valid protocol-1 acknowledgement/control event. A new browser connected to an old server closes the unacknowledged connection and retries once with `outputMode=normal`; it does not loop or assume compact fields.

### 3. Semantic-barrier mode switching

A settings update recalculates the desired mode for every `auto` SSE descriptor. Explicit client descriptors are not changed.

- If a tab is idle, emit `webui_output_mode` and switch the descriptor immediately.
- If the tab is active, set `pendingMode`; do not change the event shape mid-semantic unit.
- Forward the barrier event in the old representation, then emit `webui_output_mode`, then set `activeMode` for subsequent events.
- Valid barriers are `message_end`, `tool_execution_end`, `agent_end`, `agent_settled`, `compaction_end`, `pi_process_exit`, and `pi_process_error`.
- Connection close/reopen always starts a fresh negotiation; it never inherits a stale pending mode.

This allows the browser to flush plain live state before receiving a compact/non-compact successor and prevents half of one assistant update from using different contracts.

### 4. Server event path and compact-v1 transform

The boundary is strictly:

```text
Pi RPC JSONL → StringDecoder → JSON.parse → server bookkeeping/scoping → per-client transform → SSE JSON.stringify → browser JSON.parse → renderer
```

`PiRpcProcess.handleStdoutLine()` and all upstream Pi work remain unchanged. Preserve full parsed events for artifact rewriting, tab activity, extension status/widget/dialog caches, pending-dialog tracking, history, compaction queues, and final message APIs **before** producing a browser-bound copy.

Create `lib/webui-output-mode.mjs` as the single production seam, exported and directly tested:

```js
normalizeOutputMode(value, fallback)
resolveOutputModeDefault({ cliMode, envMode, persistedMode })
negotiateOutputMode({ requestedMode, protocolVersion, serverDefault })
browserOutputEvent(event, { outputMode })
encodeBrowserSseEvent(event, { outputMode })
isOutputModeSemanticBarrier(event)
```

`sendSse()` must call `encodeBrowserSseEvent()`; byte-work tests must import this same production function, never clone compaction logic.

Compact-v1 transformation rules:

- **Normal:** preserve today's browser event object/JSON framing behavior.
- **Recognized canonical assistant updates:** compact only `message_update` events for `text_delta`, `thinking_delta`, `toolcall_delta`, and directly self-contained end variants. Make a browser-only copy, retain type, scoped tab metadata/activity, `contentIndex`, exact `delta` (including an empty string), direct final `content`/`toolCall`, IDs/names, and direct error metadata. Remove the duplicate top-level accumulated `message` and nested accumulated `assistantMessageEvent.partial` only when the compact contract has all data the browser needs.
- **Fail open:** forward unchanged any delta-less update, unknown subtype, malformed/non-string delta, error shape without direct compact fields, unsupported end shape, lifecycle event, response, retry/queue/compaction event, diagnostic, extension UI request, replay, tab/server event, or status/widget/dialog event.
- **Tools:** omit only `tool_execution_update` for compact clients. Preserve complete `tool_execution_start` and `tool_execution_end`, including ID, name, final result, image/error metadata, and ordering.
- Never mutate the parsed/scoped input object. Normal and compact clients attached to one tab receive independently encoded events.

Replace every direct iteration over `tab.sseClients` with a centralized per-client send/broadcast helper. Migrate RPC forwarding, `broadcastTabEvent`, `broadcastServerEvent`, extension status/widget/pending-dialog replays, tab restart/cwd/reload/close, network-rebind, and remote-auth-close loops. This is required to avoid a fast client receiving an untransformed bypass event.

### 5. Coalesced debug-history summaries

Keep `eventHistory` as debugging metadata, not as a raw event archive. For adjacent canonical `message_update` delta events in the same tab/update type, update one summary record rather than append one per delta. Store only:

```text
firstTimestamp, lastTimestamp, tabId, updateType, contentIndex,
deltaCount, deltaChars, deltaUtf8Bytes
```

A non-delta event is a coalescing boundary. Do not record delta contents, `message`, or `partial`; retain the existing bounded history limit and existing non-delta summaries. Test that 512 deltas become bounded summary records while lifecycle/error entries remain visible.

### 6. Browser compact-mode behavior

Add a small pure browser helper module, `public/fast-output-live.mjs`, and import it from the module-based `public/app.js`. It owns compact-state reduction and an injectable sustained-flush scheduler so Node tests can use a fake clock.

Browser invariants:

1. The UI sends the negotiated `auto` request, keeps a connection-local `activeOutputMode`, and fails closed until `webui_connected.outputMode.protocolVersion === 1` confirms the active mode.
2. In compact mode, recognized assistant deltas append to separate text, thinking, and tool-call accumulators without reading `event.message` or `assistantMessageEvent.partial`.
3. Render the assistant/thinking live value with a stable plain-text node (`textContent`/pre-wrap). Do not run live Markdown, Mermaid, todo extraction, thinking-format parsing, or progressive rich tool rendering in this branch.
4. Flush the first pending output promptly for liveness; while output remains sustained, coalesce DOM writes/follow-scroll to at most one flush every 100 ms. `message_end`, `agent_end`, errors, mode-control events, and disconnect/reset flush or clear pending state synchronously as appropriate.
5. On compact `tool_execution_start`, render only a lightweight running shell using identity/status fields. Do not call `normalizeToolExecution`, `toolExecutionRenderSignature`, `renderToolExecution`, raw-details serialization, image construction, or `handleToolExecutionUpdate` work. On end, retain only completion/error state and request final reconciliation; build the rich tool body from reconciled final messages.
6. Existing `message_end`/`agent_end` reconciliation through `/api/messages?since=` and keyed `renderAllMessages()` remains the final authority. It removes temporary plain bubbles/tool shells and restores the existing Markdown/thinking/tool-card UI.
7. Normal mode follows the current handlers and fallback scans unchanged. The fast branch must not weaken runtime diagnostics, extension dialogs, inactive-tab handling, retry, compaction, queue, or final error behavior.

## Deterministic Primary Metric

The primary gate is deterministic serialized JSON byte-work per one connected browser, with no timers, browser, network, model, provider, or wall-clock data:

```text
R       = Σ UTF-8 bytes of JSON.stringify(each parsed inbound RPC event)
Smode   = Σ UTF-8 bytes of each production-encoded browser JSON payload
Wnormal = R + 2 × Snormal
Wfast   = R + 2 × Sfast
ratio   = Wnormal / Wfast
PASS    = ratio >= 1.5
```

`R` deliberately counts unavoidable shared Pi-RPC JSON parse input work. `2 × S` counts the downstream browser-bound JSON serialization and browser JSON parse visits. SSE framing bytes are excluded because they are neither JSON serialization nor browser JSON parsing.

The fixed primary fixture is exactly a **512-delta × 32-byte cumulative-message trace**:

- 512 ordered canonical `message_update/text_delta` events;
- each delta is fixed 32-byte ASCII data;
- each full RPC-shaped event includes the growing assistant top-level `message` and matching `assistantMessageEvent.partial` snapshot;
- cumulative final text is 16,384 bytes;
- fixed lifecycle/start/end records surround the trace and are included in semantic parity, but do not replace or dilute the 512-delta primary sequence;
- fixture values are deterministic and fresh per mode; no random IDs, dates, filesystem, process, timer, network, or inference are used.

The benchmark test must:

1. run the parsed/scoped fixture through A's actual `browserOutputEvent`/`encodeBrowserSseEvent` seam for normal and compact modes;
2. measure `R`, `Snormal`, `Sfast`, `Wnormal`, `Wfast`, and ratio from production output;
3. parse each emitted SSE JSON payload and reduce ordered text, content indices, lifecycle, tool/error passthrough, and final-message semantics;
4. require deep semantic equality and equality of SHA-256 hashes of a stable canonical semantic payload before checking `ratio >= 1.5`;
5. verify inputs were not mutated and print all counts/ratio for diagnosis.

This proves less deterministic post-parse browser-bound work; it does **not** claim lower upstream RPC serialization, extension-handler CPU, network latency, DOM CPU, provider latency, or model token speed.

## Invariants and Non-goals

### Invariants

- Normal remains the default and preserves current browser event/renderer behavior.
- Only post-parse output transport/history/browser work changes.
- Final persisted transcript/session semantics, `/api/messages`, prompts, tools, models, providers, and inference are unchanged.
- Lifecycle, errors, diagnostics, extension UI/dialog/status/widget events, queue/retry/compaction events, start/end events, and full tool completion data are never filtered by compact mode.
- Compact and normal clients can coexist on one tab without cross-talk.
- Mode changes do not restart Pi, discard session state, or apply inside a semantic unit.
- The feature edits no installed `node_modules` and makes no git-footer change.

### Non-goals

- No general SSE backpressure redesign, WebSocket migration, Pi RPC protocol change, provider change, prompt change, tool change, inference change, session-schema migration, or `/api/messages` schema change.
- No blanket extension-UI suppression.
- No progressive rich Markdown/Mermaid/todo/thinking/tool-body behavior during compact live output.
- No actual token/s, wall-clock, or DOM-performance marketing claim.
- No implementation-worker write to `pi-package-webui/reports/webui-fast-mode.html`.

## Tasks

1. **Task 1: Record the canonical plan and freeze the v1 contract.**
   - File: `pi-package-webui/plans/webui-fast-mode.md`
   - Changes: Record this classification, API, precedence, mode/barrier rules, metric, workstream boundaries, risks, rollback, and report placeholder. Supersede the conflicting prior mirror decisions explicitly.
   - Acceptance: The canonical plan has the final report cross-link and matches the approved v1 contract without adding upstream or inference scope.

2. **Task 2: Workstream A — configuration, transport, debug history, and byte-work proof.**
   - Files: `pi-package-webui/index.ts`, `pi-package-webui/lib/git-workflow-preferences.mjs`, `pi-package-webui/lib/webui-output-mode.mjs` (new), `pi-package-webui/bin/pi-webui.mjs`, `pi-package-webui/tests/git-workflow-preferences.test.mjs`, `pi-package-webui/tests/webui-output-mode.test.mjs` (new), `pi-package-webui/tests/fixtures/fast-mode-output-events.mjs` (new), `pi-package-webui/tests/fast-mode-output-work.test.mjs` (new), `pi-package-webui/tests/fast-mode-sse-harness.test.mjs` (new), `pi-package-webui/tests/fixtures/fake-pi.mjs`, `pi-package-webui/plans/handoffs/webui-fast-mode-A-config-transport.md` (new).
   - Changes:
     - Add schema-normalized `outputModeDefault`, `/webui-start` plus standalone CLI/help parsing, environment validation, resolver precedence, and the independent server-default API.
     - Implement compact-v1 negotiation, per-client descriptors, acknowledgement/control events, semantic-barrier pending mode application, centralized SSE routing, production encoder/transform, and coalesced delta history summaries.
     - Extend the fake Pi only as needed to produce canonical cumulative snapshots, tool updates/start/end, lifecycle/error/dialog fixtures, and deterministic responses for a real server/SSE harness.
     - Add A-owned persistence/precedence/migration, transform/non-mutation/fail-open, history-coalescing, dual-client, negotiation/fallback, barrier, lifecycle/tool/error/dialog, and exact 512-delta byte-work tests.
     - Write A's unique handoff with exported API names, event allowlist, migrated send-site inventory, metric output, commands, and unresolved observations.
   - Primary ownership: **A exclusively owns server/config/transport/fixture/byte-work files listed above.**
   - Exclusions: no `public/app.js`, `public/fast-output-live.mjs`, browser tests, README, canonical plan edits after Wave 0, or report.
   - Acceptance: `sendSse()` uses the tested production encoder; all SSE sends route per client; normal is unchanged; compact mode is acknowledged/fail-open; the fixed trace passes ratio and semantic/hash parity; A handoff identifies the exact B dependency.

3. **Task 3: Workstream B — browser scheduling, rendering, browser tests, and documentation.**
   - Files: `pi-package-webui/public/fast-output-live.mjs` (new), `pi-package-webui/public/app.js`, `pi-package-webui/public/index.html`, `pi-package-webui/public/styles.css` (only if a new plain-live class needs styling), `pi-package-webui/public/service-worker.js`, `pi-package-webui/package.json`, `pi-package-webui/tests/fast-output-live.test.mjs` (new), `pi-package-webui/tests/fast-mode-client-static.test.mjs` (new), `pi-package-webui/tests/streaming-ui-coupling.test.mjs`, `pi-package-webui/tests/runtime-error-visibility.test.mjs`, `pi-package-webui/tests/mobile-static.test.mjs`, `pi-package-webui/README.md`, `pi-package-webui/plans/handoffs/webui-fast-mode-B-browser.md` (new).
   - Changes:
     - Import the pure live reducer/scheduler; add protocol acknowledgement, one-time normal fallback, control-event handling, compact accumulators, plain-text bubbles, exact 100 ms sustained flushing, and semantic-boundary cleanup/reconciliation.
     - Add the browser policy module to the PWA app shell/static contract, bump the cache identity, and include it in package syntax checks.
     - Keep compact tool starts/ends lightweight and defer rich body construction to final message reconciliation; retain runtime errors and all noncompact handlers.
     - Add fake-clock tests for first/sustained/terminal flush behavior; static/structural tests for negotiated-only activation, normal fallback, no live rich transforms in compact branch, lazy tool-body exclusions, and preservation of diagnostics/reconciliation; update existing guards only where their intended contract changes.
     - Document startup CLI/env/persisted precedence, server scope, compact-v1 trade-offs, final reconciliation, per-client behavior, and metric limits. Do not claim elapsed speed or token/s.
     - Write B's unique handoff with API version consumed, compact-mode behavior, test evidence, and any browser compatibility observations.
   - Primary ownership: **B exclusively owns browser source/browser tests/README/handoff files listed above.**
   - Exclusions: no A-owned server/config/fixture/benchmark files, no root package or lockfile, no `tests/run-all.mjs`, no optional-feature registry, no canonical plan mutation, and no report.
   - Acceptance: B imports A's settled contract, activates compact mode only after acknowledgement, limits sustained DOM flushes to 100 ms, does not build live rich tool bodies, reconciles final rich output, and documents scope accurately.

4. **Task 4: Integration, review disposition, final report, and release validation.**
   - Files: `pi-package-webui/plans/webui-fast-mode.md`, `pi-package-webui/reports/webui-fast-mode.html` (new, integration owner only after review).
   - Changes:
     - Merge A before B. Reject a B result that clones the production transformer or uses a different protocol/version.
     - Audit every original `sendSse`/`sseClients` call site, normal-mode output, barrier/control ordering, browser fallback, tool finalization, and metric implementation against this plan.
     - Run the acceptance matrix; obtain the optional reviewer gate if invoked; record every finding as accepted/fixed, rejected with evidence, or deferred with owner/follow-up.
     - Only after review disposition, create the self-contained final HTML report. Include formula/results, hash parity, dual-client/barrier matrix, test output, review dispositions, metric limits, and rollback instructions. Update the canonical plan's progress/review tables to final facts.
   - Acceptance: Report is post-review only, linked by the plan placeholder, all findings are dispositioned, no source/test ownership is silently widened, and staged-file/diff validation is recorded.

## Files to Modify

- `pi-package-webui/plans/webui-fast-mode.md` — canonical complex-feature plan, progress, review, and final evidence record.
- `pi-package-webui/index.ts` — `/webui-start` output-mode option parsing and server launch forwarding.
- `pi-package-webui/lib/git-workflow-preferences.mjs` — persisted output-mode default/schema normalization.
- `pi-package-webui/bin/pi-webui.mjs` — standalone CLI/env resolution, output-mode API, negotiated SSE client descriptors, routing, barriers, history summaries, static allowlist, and production encoder use.
- `pi-package-webui/public/app.js` — negotiated connection, compact live state, 100 ms flush integration, lazy tool shells, and final reconciliation.
- `pi-package-webui/public/index.html` — browser settings control integration if required by the existing settings markup contract.
- `pi-package-webui/public/styles.css` — only if required for an accessible plain-text live class.
- `pi-package-webui/public/service-worker.js` — app-shell inclusion and cache-version update for the new browser policy module.
- `pi-package-webui/package.json` — syntax-check coverage for the new browser policy module.
- `pi-package-webui/README.md` — configuration and bounded-claim documentation.
- `pi-package-webui/tests/git-workflow-preferences.test.mjs` — settings migration/persistence assertions.
- `pi-package-webui/tests/streaming-ui-coupling.test.mjs` — normal-path and compact-branch coupling guard updates.
- `pi-package-webui/tests/runtime-error-visibility.test.mjs` — error visibility regression assertions.
- `pi-package-webui/tests/fixtures/fake-pi.mjs` — deterministic streaming scenarios required by A's server harness.

## New Files

- `pi-package-webui/lib/webui-output-mode.mjs` — pure configuration resolver, negotiation, event transform, encoder, and barrier helpers used by production and tests.
- `pi-package-webui/public/fast-output-live.mjs` — pure compact live accumulator and fake-clock-testable 100 ms scheduler.
- `pi-package-webui/tests/webui-output-mode.test.mjs` — unit coverage for precedence, negotiation, transform, fail-open, and debug-history behavior.
- `pi-package-webui/tests/fixtures/fast-mode-output-events.mjs` — fresh fixed 512×32 cumulative-message fixture plus semantic variants.
- `pi-package-webui/tests/fast-mode-output-work.test.mjs` — production-encoder byte-work/hash-parity gate.
- `pi-package-webui/tests/fast-mode-sse-harness.test.mjs` — real server/fake-Pi client negotiation, dual-client, barrier, lifecycle, and tool/error/dialog harness.
- `pi-package-webui/tests/fast-output-live.test.mjs` — pure fake-clock live reducer/scheduler test.
- `pi-package-webui/tests/fast-mode-client-static.test.mjs` — browser wiring and prohibited-live-work regression guard.
- `pi-package-webui/plans/handoffs/webui-fast-mode-A-config-transport.md` — unique A handoff.
- `pi-package-webui/plans/handoffs/webui-fast-mode-B-browser.md` — unique B handoff.
- `pi-package-webui/reports/webui-fast-mode.html` — integration-owner-only post-review report.

## Dependencies and DAG

```text
Wave 0: Freeze plan, recheck absent context only for material conflict
  -> Wave 1 / A: settings + server negotiation/transform/history + byte-work proof
       -> unique handoff A (exported API and production-seam proof)
         -> Wave 2 / B: browser scheduler/rendering/tests/docs against A API
              -> unique handoff B (browser behavior and checks)
                -> Wave 3 / integration: merge review, validations, dispositions, final report
```

- B cannot implement against an absent, renamed, or unused A production encoder. It may prepare notes but must stop rather than create a test-only compactor.
- A and B have non-overlapping primary write ownership. The integration owner resolves only minimal merge conflicts after both handoffs; material scope changes require a new approved decision.
- The final report has no implementation-worker owner and is created only in Wave 3 after review disposition.

## Acceptance Commands

Run from `/home/firstpick/npm-packages/pi-package-webui` after A and B merge:

```bash
node --check lib/webui-output-mode.mjs
node --check bin/pi-webui.mjs
node --check public/fast-output-live.mjs
node --check public/app.js
node tests/git-workflow-preferences.test.mjs
node tests/webui-output-mode.test.mjs
node tests/fast-mode-output-work.test.mjs
node tests/fast-mode-sse-harness.test.mjs
node tests/fast-output-live.test.mjs
node tests/fast-mode-client-static.test.mjs
node tests/streaming-ui-coupling.test.mjs
node tests/runtime-error-visibility.test.mjs
node tests/transport-hardening-harness.test.mjs
npm test
npm run check
git diff --check
test -z "$(git diff --cached --name-only)"
python3 /home/firstpick/.pi/agent/skills/html-report/scripts/validate_report.py reports/webui-fast-mode.html --strict
```

Manual acceptance matrix, captured in the final report:

1. Start with no flag/env/persisted value; verify `normal` acknowledgement and unchanged full updates.
2. Verify CLI wins over env/persisted; env wins over persisted; persisted compact wins only with no CLI/env; invalid persisted falls back normal.
3. Connect normal and compact-v1 clients to one tab; trigger text/thinking/tool/error/dialog flow; verify independent shapes and no cross-talk.
4. Change the persisted default during text streaming; verify the current representation remains through the next barrier, then the control event precedes the new representation without Pi restart/session loss.
5. Verify 512 compact deltas flush live DOM no more than once per sustained 100 ms interval, then `message_end`/`agent_end` reconstruct rich Markdown/thinking/tool output exactly.
6. Verify compact tool update omission, retained start/end/error ordering, deferred body rendering, diagnostics, extension dialogs, retry, queue, compaction, abort, and old-server normal fallback.

## Rollback

- **User/server default rollback:** set persisted `outputModeDefault` to `normal` through `/settings` or restart without a compact CLI/env override. Idle auto clients switch immediately; active auto clients switch at the next barrier. Explicit compact clients remain explicit until they reconnect/request normal.
- **Browser fallback:** a missing/mismatched acknowledgement causes one normal reconnect; no data migration or Pi restart occurs.
- **Code rollback:** revert A and B together, or first force server default normal and remove the Browser workflow control. The persisted unknown key is harmless because older normalizers ignore it; current normalizer defaults missing/invalid values to normal.
- **Data/session rollback:** none required. No session, transcript, prompt, model, tool, or provider data changed.
- **Out of scope:** do not roll back by editing Pi core, installed packages, or git-footer. Upstream extension delta work remains separately owned.

## Risks

| Severity | Risk | Mitigation / stop rule |
|---|---|---|
| High | A missed direct SSE send bypasses per-client transform. | Inventory/migrate every `sendSse` and `sseClients` loop; require dual-client/replay/restart harness coverage. |
| High | Over-pruning loses end/error/tool-call fields. | Compact only allowlisted canonical shapes; fail open all other shapes; require parsed semantic deep/hash parity. |
| High | Mode change cuts through a semantic unit. | Descriptor `pendingMode`, explicit barriers, old-event/control/new-event ordering test. |
| High | Compact mode hides safety/workflow UI. | Preserve all extension UI/replays unchanged; stop any broad filtering proposal. |
| Medium | The shared `R` term makes the ratio fail if compaction is too weak. | Use the exact 512 cumulative snapshots and production encoder; optimize only the approved duplicate fields, never game fixture composition. |
| Medium | Final messages may lag a tool end. | Show only a lightweight shell, schedule reconciliation, and keep rich body construction final-authoritative; test message/agent end. |
| Medium | Old-server fallback reconnects repeatedly. | One guarded normal retry per connection context; record diagnostic if normal also fails. |
| Medium | Global settings can be changed while an active client is streaming. | Persist normally, recompute only auto descriptors, use semantic barriers, and expose effective-source metadata. |
| Medium | Existing git-footer extension still processes Pi deltas upstream. | Explicitly limit claim to post-parse WebUI work; no installed-package edit. |
| Process | Requested `context.md` was unavailable. | Recheck in Wave 0 and stop only for a material contract conflict. |
| Process | Current plan-only environment has no command runner for Git status/staging verification. | Integration owner must capture pre/post `git status --short`, `git diff --name-only`, and staged-file command output before accepting implementation. |

## Final Integration Record

**Disposition:** Complete and validated in the uncommitted feature worktree. The final evidence report is [WebUI Fast Mode final report](../reports/webui-fast-mode.html). The requested worktree-root `context.md` and `plan.md` remain absent; this canonical plan, the four handoffs, reviewer artifacts, authoritative subagent run metadata, and post-fix validation are the evidence source.

### Final progress

| Stage | Status | Final evidence |
|---|---|---|
| Discovery and approved v1 contract | Complete | Decisions D1–D12 above remain the governing scope. |
| Wave 1 / A: config, transport, history, proof | Complete | `webui-fast-mode-A-config-transport.md`; production encoder, negotiated SSE harness, schema migration, and deterministic parity gate passed. |
| Wave 2 / B: browser live output | Complete | `webui-fast-mode-B-browser.md`; acknowledged client protocol, 100 ms scheduler, PWA wiring, static guards, and documentation passed. |
| Review remediation | Complete | `webui-fast-mode-post-review-fixes.md`; F1/F2/F3 regression coverage added without widening server/config scope. |
| Integration schema test | Complete | `tests/remote-auth-settings-harness.test.mjs` expects settings schema v4, matching the approved `outputModeDefault` migration. |
| Post-fix validation | PASS | Run `f3dec8fb-38c7-4e0d-8bf9-79582bbe8029`; fresh validation reported all 46 test files passed and no staged files. |
| Final-acceptance settings blocker | **Accepted and fixed** | Prior final-acceptance artifact run `cbda3c74-a08b-451c-be42-b36a8a810aa6` found the missing Browser workflow selector. Completion-fix worker run `2aff7a57-6650-40ed-ac50-b78fac97c9f5` (worker 0) added the bounded control, static regression coverage, and `webui-fast-mode-settings-ui-fix.md`; its focused/API-SSE/metric/full-suite/hygiene commands passed. |
| Final plan and report correction | Complete | This plan and [final report](../reports/webui-fast-mode.html) now record the completion fix without replacing the prior review evidence. |

### Implemented contract

- **Configuration:** accepted values are `normal` and `compact-v1`; server-default precedence is explicit `--output-mode`, then `PI_WEBUI_OUTPUT_MODE`, then persisted `outputModeDefault`, then `normal`. Settings schema is v4; missing or invalid persisted values normalize to `normal`, while invalid CLI/environment values fail startup.
- **Configuration API and Browser workflow control:** authenticated `GET`/`PUT /api/webui-output-mode` returns or writes `{ persistedDefault, effectiveDefault, source, overridden }`. PUT is remote-auth-gated consistently with existing authenticated settings APIs, persists even under CLI/environment override, and neither restarts Pi nor changes a session. `/settings` now exposes **Output processing** in **Browser workflow** with a server badge: it loads the unscoped metadata, selects the persisted default, displays persisted/effective/source/override state, writes only `{ outputModeDefault }` to the separate API, refreshes metadata, and never puts the server setting in the Pi `SettingsManager` payload. API failure visibly falls back to normal and disables this unpersistable control while ordinary settings remain usable.
- **SSE protocol:** new browsers request `GET /api/events?tab=<id>&outputMode=auto&outputModeProtocol=1`. Per-client descriptors hold `res`, requested/protocol/active/pending mode, and default source. Invalid, missing, or old negotiation fails closed to normal; a new browser gets one normal reconnect when acknowledgement is absent.
- **Representation:** `webui_connected.outputMode` acknowledges protocol 1. `webui_output_mode` controls precede the first event in a new representation. Auto clients change immediately when idle or after `message_end`, `tool_execution_end`, `agent_end`, `agent_settled`, `compaction_end`, `pi_process_exit`, or `pi_process_error`; explicit clients do not follow the default.
- **Compact transform and history:** only allowlisted direct canonical assistant updates lose duplicate accumulated `message`/`partial`; unknown, malformed, lifecycle, diagnostic, dialog, status/widget, error, and replay shapes fail open. Compact omits only `tool_execution_update`. Adjacent delta history becomes bounded scalar summaries with no retained delta content.
- **Browser:** plain stable text nodes accumulate acknowledged direct deltas; the first flush is immediate and sustained output is limited to one flush per 100 ms. Compact tool shells defer rich bodies until existing `/api/messages` reconciliation. The post-review transitions transfer normal-to-compact and compact-to-normal text/thinking state, and recognized empty end variants are consumed safely.

### Exact changed-file ownership

| Owner | Files | Result |
|---|---|---|
| A — configuration/transport | `index.ts`; `lib/git-workflow-preferences.mjs`; new `lib/webui-output-mode.mjs`; `bin/pi-webui.mjs`; `tests/git-workflow-preferences.test.mjs`; new `tests/webui-output-mode.test.mjs`, `tests/fixtures/fast-mode-output-events.mjs`, `tests/fast-mode-output-work.test.mjs`, `tests/fast-mode-sse-harness.test.mjs`; `tests/fixtures/fake-pi.mjs`; `plans/handoffs/webui-fast-mode-A-config-transport.md` | Server default, v4 persistence/API, per-client transform/barrier routing, debug history, and production metric proof. |
| B — browser/documentation | new `public/fast-output-live.mjs`; `public/app.js`, `public/index.html`, `public/styles.css`, `public/service-worker.js`, `package.json`, `README.md`; new `tests/fast-output-live.test.mjs`, `tests/fast-mode-client-static.test.mjs`; `tests/mobile-static.test.mjs`; `plans/handoffs/webui-fast-mode-B-browser.md` | Negotiated browser behavior, live scheduling, PWA contract, static/unit checks, and bounded documentation. |
| B — accepted review remediation | `public/app.js`, `public/fast-output-live.mjs`, `tests/fast-output-live.test.mjs`, `tests/fast-mode-client-static.test.mjs`, `plans/handoffs/webui-fast-mode-post-review-fixes.md` | F1/F2 transition continuity and F3 empty-end consume-policy fixes with regressions. |
| Completion-fix worker — run `2aff7a57-6650-40ed-ac50-b78fac97c9f5` | `public/app.js`; `tests/fast-mode-client-static.test.mjs`; `plans/handoffs/webui-fast-mode-settings-ui-fix.md` | The prior final-acceptance blocker: Browser workflow server-scoped **Output processing** selector, metadata/fallback behavior, and static regression proof. |
| Integration owner | `tests/remote-auth-settings-harness.test.mjs`; this `plans/webui-fast-mode.md`; new `reports/webui-fast-mode.html` | Schema-v4 expectation alignment, final record, and post-review report correction. |

The aggregate final-correction inspection has 13 tracked modified files and 14 untracked feature artifacts. The completion-fix run changed only its three owned files; the reporting correction changes only this plan and report. No dependency, lockfile, generated file, or commit was added.

### Deterministic evidence ledger

The fixed fixture is 512 ordered 32-byte cumulative assistant deltas (16,384 final assistant bytes) with surrounding lifecycle/tool/error records. It calls production `encodeBrowserSseEvent()` for both modes, reparses the output, checks input non-mutation, requires deep semantic equality and a stable SHA-256 before testing the threshold.

```text
R       = 8,581,802
Snormal = 8,581,802
Sfast   =   106,154
Wnormal = 25,745,406
Wfast   =  8,794,110
ratio   = 2.927574  PASS (threshold >= 1.5)
semantic SHA-256 = 74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f
```

Formula: `Wmode = R + 2 × Smode`, where `R` is UTF-8 bytes of parsed inbound RPC JSON and `S` is UTF-8 bytes of production-encoded browser JSON. It measures bounded post-parse serialization/parse visits only; it does not claim inference, token/s, network, wall-clock, or general DOM CPU improvement.

The browser static ledger uses the same trace and a fixed 20 ms arrival model: `normalScanChars = 8,464,384`, `compactScanChars = 16,384`, scan ratio `= 516.625` (PASS), normal flushes/modeled DOM writes `= 512`, compact `= 103`.

### Compatibility and acceptance matrix

| Case | Expected contract | Evidence / result |
|---|---|---|
| Default, persisted migration, precedence | Normal remains default; CLI > env > persisted > normal; invalid persisted is normal | Unit/persistence tests and real SSE harness PASS. |
| Old or invalid client negotiation | Fail closed to normal with protocol 0 | Unit test and legacy SSE client assertion PASS. |
| New browser with old server | One acknowledged-normal fallback; no compact assumption or loop | Browser static guard PASS. |
| One normal and one compact client | Independent normal snapshots vs compact direct deltas; no cross-talk | Real server/fake Pi dual-client harness PASS. |
| Auto default switch during activity | Old barrier representation, then control, then new representation | Real SSE barrier ordering PASS. |
| Tools, errors, extension UI | Omit only compact intermediate tool update; preserve start/end, diagnostics, dialog/status/widget/replay | SSE harness and runtime visibility PASS. |
| Compact browser live path | Raw direct accumulators, immediate first flush, max 100 ms sustained flush, final rich reconciliation | Fake-clock/static tests PASS. |
| Post-review transition/empty ends | One continuous bubble/state through F1/F2; consume F3 without normal fallback | Focused pure/static regressions and post-fix validator PASS. |
| Browser workflow output default | `/settings` shows server-badged **Output processing** with `normal`/`compact-v1`; persisted/effective/source/override metadata; unscoped GET, changed-value PUT, and refreshed metadata. It is outside the Pi settings payload and fails safely to disabled normal/default with a visible diagnostic. | Completion-fix run `2aff7a57-6650-40ed-ac50-b78fac97c9f5` static UI regression plus API/SSE harness PASS; all-46 suite PASS. |
| Schema coexistence | Remote-auth setting writes preserve settings at schema v4 | `remote-auth-settings-harness.test.mjs` in all-46 suite PASS. |

### Commands and final results

The post-fix validator ran the following from `pi-package-webui` in run `f3dec8fb-38c7-4e0d-8bf9-79582bbe8029`; this earlier evidence remains part of the record:

| Command | Result |
|---|---|
| `node --check public/app.js && node --check public/fast-output-live.mjs && node tests/fast-output-live.test.mjs && node tests/fast-mode-client-static.test.mjs && node tests/streaming-ui-coupling.test.mjs && node tests/runtime-error-visibility.test.mjs` | PASS |
| `node tests/fast-mode-output-work.test.mjs` | PASS; exact ledger/hash above. |
| inline production compact-end/barrier/diagnostic reproduction | PASS; empty compact ends consumed; barriers and `pi_stderr` preserved. |
| `npm run check` | PASS; **all 46 test files passed**, including the schema-v4 remote-auth harness; re-run by the integration owner after report creation. |
| `node tests/webui-output-mode.test.mjs && node tests/fast-mode-sse-harness.test.mjs && node tests/transport-hardening-harness.test.mjs` | PASS |
| `git diff --check` | PASS; re-run by the integration owner after final plan/report edits. |
| `test -z "$(git diff --cached --name-only)"` | PASS; no staged files, re-run by the integration owner. |
| `grep -nE '\{\{[^}]+\}\}|\b(TODO|FIXME)\b|https?://|file://' reports/webui-fast-mode.html` | PASS; no output and expected no-match status. |
| `python3 …/validate_report.py reports/webui-fast-mode.html --strict` | PASS; 2,548 words, 5 tab panels, 2 accessible SVG visuals, no external or local dependencies, errors, or warnings. |

The final-completion settings fix ran in `2aff7a57-6650-40ed-ac50-b78fac97c9f5` (worker 0):

| Command | Result |
|---|---|
| `node --check public/app.js && node tests/fast-mode-client-static.test.mjs && node tests/streaming-ui-coupling.test.mjs` | PASS; browser settings static contract and existing coupling behavior passed; browser ledger remains `516.625` scan ratio with 512 normal versus 103 compact modeled writes. |
| `node tests/fast-mode-sse-harness.test.mjs && node tests/fast-mode-output-work.test.mjs` | PASS; API/SSE behavior passed and the production gate retained ratio `2.927574` with semantic SHA-256 `74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f`. |
| `npm run check` | PASS; all 46 test files passed. |
| `git diff --check && test -z "$(git diff --cached --name-only)"` | PASS; whitespace-clean diff and no staged files. |

### Review-disposition record

| Review source | Finding | Disposition and regression evidence |
|---|---|---|
| Reviewer 1, run `ad664cf2-3385-4820-986d-5d1252b1d48a`; authoritative subagent status: runtime `kimi-k3`, thinking high. The prose artifact identifies only its Pi review session and does not override runtime metadata. | F1 normal → compact could show a stale/split normal bubble. | **Accepted and fixed.** `transitionNormalLiveOutputToCompact()` seeds text/thinking, removes normal bubbles, and flushes the compact state; focused pure/static tests PASS. |
| Same | F2 compact → normal could show only post-switch deltas before reconciliation. | **Accepted and fixed.** `transitionCompactLiveOutputToNormal()` snapshots compact text/thinking, restores normal accumulators, and renders them; focused pure/static tests PASS. |
| Same | F3 stripped empty compact end variants could fall through into normal handlers. | **Accepted and fixed.** `shouldConsumeFastOutputLiveEvent()` consumes recognized no-write end variants; pure/static regressions and direct production reproduction PASS. |
| Same | N1 output-mode PUT is remote-auth-gated but not localhost-only. | **Rejected.** Server-wide authenticated configuration matches the existing authenticated `/api/settings` policy; remote-auth is the approved boundary. |
| Same | N2 raw-response compatibility branch in `sendSse()`. | **Deferred optional cleanup.** No behavior issue; descriptor-only tightening can be considered later. |
| Same | N3 id-less compact tool-shell fallback can duplicate a shell. | **Deferred optional cleanup.** Cosmetic fallback only; real Pi tool events carry IDs. |
| Reviewer 2, same review run; authoritative subagent status: runtime `gemini-3-flash-preview`, thinking high. Its prose artifact self-reports `claude-3-7-sonnet-20250219`; that model-generated label conflicts with execution metadata and is retained here only as a disclosed artifact error. | Browser/performance review. | **PASS.** No material finding; it confirmed the production seam, bounded metric, negotiation, scheduling, barriers, and parity. |
| Integration | Remote-auth harness still expected schema 3 after the approved settings migration. | **Accepted integration fix.** Expectation is schema 4; included in the full 46-file PASS. |
| Post-fix validator, run `f3dec8fb-38c7-4e0d-8bf9-79582bbe8029` | Fresh validation of A1/A2/A3 and aggregate scope/hygiene. | **PASS.** No blocker, material regression, scope drift, or staged file; confidence recorded as 97/100. |
| Prior final acceptance, run `cbda3c74-a08b-451c-be42-b36a8a810aa6` | **Blocker:** approved Browser workflow persisted output-mode selector was absent; the former API-or-UI rollback statement was consequently stale. | **Accepted and fixed.** Completion-fix worker run `2aff7a57-6650-40ed-ac50-b78fac97c9f5` added the server-badged selector, persisted/effective/source/override metadata, safe unavailable-API fallback, separated PUT/refresh flow, and static proof without changing server policy or the Pi payload. |
| Completion-fix worker, run `2aff7a57-6650-40ed-ac50-b78fac97c9f5` (worker 0) | Bounded remediation and regression verification for the accepted final-acceptance blocker. | **PASS.** Focused static/coupling, API/SSE, deterministic production gate, all-46 suite, diff, and no-staged checks passed; see `plans/handoffs/webui-fast-mode-settings-ui-fix.md`. |
| Final re-verifier, run `2aff7a57-6650-40ed-ac50-b78fac97c9f5` (reviewer 2) | Claimed the reviewer model identities contradicted their prose artifacts and noted a stale handoff count. | **Partially rejected/corrected.** The runtime-identity claim is rejected because authoritative `subagent status` records `kimi-k3` and `gemini-3-flash-preview`; prose self-labels are model output, not execution metadata. This record now discloses the Reviewer 2 self-label mismatch. The valid handoff-count note was accepted and corrected from three to four. |
| Final record audit and feature gate, run `bb042cb4-8a2b-407e-bfe0-409db7c6886c`; runtime reviewers `gpt-5.6-sol` high and `gemini-3-flash-preview` high | Rechecked authoritative identity disclosure, four-handoff record, settings UI blocker fix, full implementation, report, tests, and hygiene. | **PASS / COMPLETE.** Record audit confidence 99/100; complete feature gate confidence 97/100. All 46 test files, ratio/hash, SSE harness, strict HTML, links, diff, and no-staged checks passed with no blocker. |

### Rollout, rollback, and remaining risks

- **Rollout:** default remains `normal`. Enable compact for a server with `--output-mode compact-v1`, `PI_WEBUI_OUTPUT_MODE=compact-v1`, or the **Output processing** selector in `/settings` → **Browser workflow**, which persists `outputModeDefault`; auto connections negotiate independently. The selector displays the persisted setting separately from the effective CLI/environment-overridden mode. Observe the deterministic ledger and ordinary diagnostics, rather than claiming elapsed-time improvement.
- **Rollback:** choose `normal` in `/settings` → **Browser workflow** → **Output processing**, or use `PUT /api/webui-output-mode` with `{"outputModeDefault":"normal"}`, or remove a compact CLI/environment override. Idle auto clients change immediately; active auto clients change at a semantic barrier. Explicit compact clients remain explicit until reconnect/requesting normal. Code rollback reverts A and B together; no session/transcript/model/tool/provider data migration is required.
- **Residual risk:** no interactive visual-browser paint/timing run was performed, including a real settings-dialog interaction. The selector's placement, wiring, metadata, and fallback are structurally covered; final reconciliation may still create a transient visual swap that deterministic state/static tests cannot paint-test.
- **Residual risk:** old/new interoperability is structurally covered but was not run against a released historical server binary.
- **Limit:** compact live tools deliberately defer rich intermediate bodies, Markdown, thinking formatting, and final cards to `/api/messages` reconciliation.

## Blockers

No approved-decision blocker remains. The sole prior final-acceptance blocker is accepted and fixed by completion-fix run `2aff7a57-6650-40ed-ac50-b78fac97c9f5`; its handoff is [the Browser settings UI completion fix](handoffs/webui-fast-mode-settings-ui-fix.md). The absent root `context.md`/`plan.md` are documented evidence-path omissions, not a contract conflict. Confidence: **97/100** for the implementation evidence; the remaining 3 points cover the unrun interactive visual-browser check, including paint-level settings interaction.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The final diff is confined to the approved post-RPC-parse WebUI output/configuration/browser/test/documentation scope. The explicit ownership ledger records all source/test/docs/handoff changes and the single schema-v4 integration test alignment."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "The plan links the final report and records the production-seam formula, exact ledgers/hash, 46-file suite result, dual-client/barrier coverage, reviewer dispositions, rollback, risks, and no-staged-files proof."
    }
  ],
  "changedFiles": [
    "pi-package-webui/plans/webui-fast-mode.md",
    "pi-package-webui/reports/webui-fast-mode.html"
  ],
  "testsAddedOrUpdated": [
    "pi-package-webui/tests/fast-mode-client-static.test.mjs",
    "pi-package-webui/tests/fast-mode-output-work.test.mjs",
    "pi-package-webui/tests/fast-mode-sse-harness.test.mjs",
    "pi-package-webui/tests/fast-output-live.test.mjs",
    "pi-package-webui/tests/fixtures/fast-mode-output-events.mjs",
    "pi-package-webui/tests/remote-auth-settings-harness.test.mjs",
    "pi-package-webui/tests/webui-output-mode.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "cd pi-package-webui && npm run check",
      "result": "passed",
      "summary": "Post-fix validation run f3dec8fb-38c7-4e0d-8bf9-79582bbe8029 and completion-fix run 2aff7a57-6650-40ed-ac50-b78fac97c9f5 each reported all 46 test files passed."
    },
    {
      "command": "cd pi-package-webui && node tests/fast-mode-output-work.test.mjs",
      "result": "passed",
      "summary": "Production encoder parity gate: ratio 2.927574 and semantic SHA-256 74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f."
    },
    {
      "command": "git diff --check && test -z \"$(git diff --cached --name-only)\"",
      "result": "passed",
      "summary": "Post-fix validation and the completion-fix run found a whitespace-clean diff and no staged files."
    }
  ],
  "validationOutput": [
    "Post-fix validator PASS: accepted F1/F2/F3 fixes, normal/default/diagnostic behavior, exact deterministic ledger/hash, all 46 test files, and no staged files.",
    "Completion-fix run PASS: Browser workflow Output processing control, unscoped GET, separate changed-value PUT/refresh, persisted/effective/source/override display, API-unavailable normal fallback, and Pi-payload exclusion are statically covered; API/SSE harness and all 46 test files passed.",
    "Final report strict validator PASS before this correction: 2,548 words, five accessible tab panels, two accessible SVG visuals, no dependencies, errors, or warnings.",
    "Final placeholder/link/remote-path grep had no output; final diff check passed and staged-file check confirmed no staged files."
  ],
  "residualRisks": [
    "No interactive visual-browser paint/timing run was performed, including the new settings-dialog interaction.",
    "Historical released-server interoperability was structurally, not binary-to-binary, tested.",
    "The deterministic metric makes no inference, token/s, network, wall-clock, or general DOM-performance claim."
  ],
  "noStagedFiles": true,
  "diffSummary": "Approved fast-mode implementation plus schema-v4 harness alignment, accepted Browser workflow settings completion fix, canonical plan, and self-contained integration report; no commits or out-of-scope changes by either reporting step.",
  "reviewFindings": [
    "accepted/fixed: F1 normal-to-compact transition continuity",
    "accepted/fixed: F2 compact-to-normal transition continuity",
    "accepted/fixed: F3 empty recognized compact end consumption",
    "rejected: N1 localhost-only hardening; remote-auth gate matches authenticated settings policy",
    "deferred: N2 sendSse raw-response cleanup",
    "deferred: N3 id-less compact tool-shell cleanup",
    "reviewer 2 PASS; post-fix validator PASS",
    "accepted/fixed: prior final-acceptance Browser workflow output-mode selector blocker in completion-fix run 2aff7a57-6650-40ed-ac50-b78fac97c9f5"
  ],
  "manualNotes": "The prior final-acceptance settings blocker is accepted/fixed by completion-fix run 2aff7a57-6650-40ed-ac50-b78fac97c9f5 (worker 0), whose focused/API-SSE/metric/full-suite/hygiene checks passed. This plan/report correction preserves earlier review evidence; reporting-step validation is recorded in the final acceptance response. Confidence: 97/100."
}
```