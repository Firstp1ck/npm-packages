# WebUI Fast Mode — Workstream B Handoff

## Identity and revisions

- **Workstream / run:** B / implementation worker B (run B)
- **Base revision:** `a70550f9717a5483ec0f1f28d54e351e4d8679f3`
- **Result revision:** `a70550f9717a5483ec0f1f28d54e351e4d8679f3` with Workstream A and B changes uncommitted in the assigned worktree.
- **Scope:** Task 3 browser negotiation, compact live reducer/scheduling/rendering, PWA wiring, browser/static tests, bounded documentation, and this handoff only.

## Changed files

- `pi-package-webui/public/fast-output-live.mjs` (new)
- `pi-package-webui/public/app.js`
- `pi-package-webui/public/index.html`
- `pi-package-webui/public/styles.css`
- `pi-package-webui/public/service-worker.js`
- `pi-package-webui/package.json`
- `pi-package-webui/tests/fast-output-live.test.mjs` (new)
- `pi-package-webui/tests/fast-mode-client-static.test.mjs` (new)
- `pi-package-webui/tests/mobile-static.test.mjs`
- `pi-package-webui/README.md`
- this handoff

The mobile static assertions were minimally updated to consume A's centralized SSE-client replay parameter and the output-mode schema-4 startup settings read; no server behavior was changed by B.

## A interfaces consumed

B consumed A's settled compact-v1 wire contract without importing or duplicating the server transformer:

- Browser EventSource requests use `/api/events?tab=<id>&outputMode=auto&outputModeProtocol=1`.
- Compact rendering is activated only after `webui_connected.outputMode.protocolVersion === 1` and acknowledged `activeMode === "compact-v1"`.
- Missing/old/invalid acknowledgement stays normal and schedules exactly one reconnect with `outputMode=normal`; it never assumes compact fields or loops.
- `webui_output_mode` protocol-1 controls are handled as representation boundaries.
- Compact `message_update` direct fields are reduced only from `assistantMessageEvent` (`text_delta`, `thinking_delta`, `toolcall_delta`, and direct end variants). B never reads `event.message` or `assistantMessageEvent.partial` in that branch.
- A's intentional compact omission of `tool_execution_update` is honored. Start/end remain lightweight shell transitions, while `/api/messages` reconciliation remains final authority.
- A's untransformed lifecycle, errors, diagnostics, dialogs, status/widgets, retries, compaction, and final `/api/messages` behavior stays on existing normal handlers.

## Browser behavior delivered

- `public/fast-output-live.mjs` supplies a pure immutable compact reducer plus an injectable fake-clock scheduler. The first pending output flushes immediately; sustained writes coalesce to no more than once per **100 ms**; terminal `flushNow()` and cancel are deterministic.
- Raw text, thinking, and tool-call deltas are separately retained exactly, including Unicode. Compact text/thinking writes use stable `textContent`/`pre-wrap` nodes and do not invoke live Markdown, Mermaid, todo extraction, thinking parsing, or progressive rich tool rendering.
- Compact tool starts and ends create/update only a lightweight status shell. They never invoke `normalizeToolExecution`, `toolExecutionRenderSignature`, `renderToolExecution`, raw JSON serialization, image creation, or live tool-update rendering. Completion triggers final reconciliation.
- `message_end`, `agent_end`, `tool_execution_end`, `compaction_end`, `agent_settled`, output-mode controls, process exit/error, and disconnected compact streams synchronously flush or clear pending compact output as appropriate. Reset/tab reconnect/mode changes cancel timers and remove temporary compact state.
- Normal rendering, runtime diagnostics, inactive-tab routing, extension UI, retries, queue/compaction behavior, abort behavior, and final rich transcript rendering are preserved.
- The PWA app shell includes the new module, cache identity is `pi-webui-pwa-v34`, the module entry cache-buster is updated, and `npm run check` parses it.

## Test evidence and deterministic ledgers

| Command | Result |
| --- | --- |
| `cd pi-package-webui && node --check public/fast-output-live.mjs && node --check public/app.js && node --check public/service-worker.js` | Passed |
| `cd pi-package-webui && node tests/fast-output-live.test.mjs` | Passed |
| `cd pi-package-webui && node tests/fast-mode-client-static.test.mjs` | Passed |
| `cd pi-package-webui && node tests/runtime-error-visibility.test.mjs` | Passed |
| `cd pi-package-webui && node tests/streaming-ui-coupling.test.mjs` | Passed |
| `cd pi-package-webui && node tests/mobile-static.test.mjs` | Passed |
| `cd pi-package-webui && node tests/webui-output-mode.test.mjs && node tests/fast-mode-output-work.test.mjs` | Passed |
| `cd pi-package-webui && NODE_OPTIONS='--experimental-loader=/tmp/pi-webui-worktree-deps-loader.mjs' node tests/fast-mode-sse-harness.test.mjs` | Passed |
| `cd pi-package-webui && NODE_OPTIONS='--experimental-loader=/tmp/pi-webui-worktree-deps-loader.mjs' node tests/transport-hardening-harness.test.mjs` | Passed |
| `git diff --check` | Passed |
| `git diff --cached --name-only` | Passed; no staged files |

`fast-output-live.test.mjs` covers first/sustained/terminal/cancel scheduler behavior; raw Unicode retention; text, thinking, tool-call, end, and compatibility/error reducer behavior using a fake clock.

`fast-mode-client-static.test.mjs` checks acknowledgement-only activation, one-time normal fallback, mode controls, cancellation, plain nodes, no compact live rich/todo transforms, lazy tool bodies, terminal reconciliation, PWA/syntax wiring, and the deterministic browser-work ledger:

```text
normalScanChars = 8,464,384
compactScanChars = 16,384
scan ratio = 516.625 (PASS; >= 1.5)
normalFlushes / modeled DOM writes = 512
compactFlushes / modeled DOM writes = 103
```

The ledger uses A's fixed 512×32 trace and models cumulative normal-message scans versus direct compact deltas with 20 ms arrival intervals. It proves the stated scan/flush/DOM model only; it does not claim elapsed-time, model-token, network, or general DOM-performance improvements.

A's production transport parity gate was rerun and passed:

```text
R       = 8,581,802
Snormal = 8,581,802
Sfast   =   106,154
Wnormal = 25,745,406
Wfast   =  8,794,110
ratio   = 2.927574 (PASS; >= 1.5)
semantic SHA-256 = 74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f
```

This retains A's deep/hash semantic parity proof for the source production encoder; B's final-authoritative `/api/messages` reconciliation restores normal rich transcript semantics after temporary compact output.

## Full package check disposition

`NODE_OPTIONS='--experimental-loader=/tmp/pi-webui-worktree-deps-loader.mjs' npm run check` ran the suite and B's tests passed, but exited non-zero on five isolated-worktree dependency/baseline issues outside B's write boundary:

1. `http-endpoints-harness.test.mjs`: vendored Mermaid module returned 500 because the temporary loader lacks the package's vendored Mermaid tree.
2. `remote-auth-settings-harness.test.mjs`: stale schema expectation (`3`) conflicts with A's approved schema version `4`.
3. `resource-defaults-helper.test.mjs`, `subagent-gate.test.mjs`, and `subagents-helper.test.mjs`: temporary dependency loader cannot resolve `typebox` from this isolated worktree.

No B-focused browser/static test failed after the fixes above. Integration should rerun `npm run check` in the normal installed dependency checkout and update A-owned/non-B baseline tests only under their owners' approval.

## Semantic parity, omissions, and boundary compliance

- Compact state is browser-local and connection-local; it is not persisted by tab or sent to Pi.
- The browser does not clone A's output transformer and does not alter A-owned server/config/history/fixture/benchmark files, the canonical plan, root package/lockfile, optional-feature registry, test runner, or final report.
- Compact end/error shapes that are not directly reduced intentionally fall through to existing normal diagnostic handlers. Final transcript reconciliation is the authority for Markdown, thinking formatting, tool bodies/images, and complete error metadata.
- README claims are bounded to server-default precedence, per-client negotiation, live-display trade-offs, final reconciliation, and deterministic JSON byte-work. It makes no token/s or wall-clock claim.

## Assumptions, unresolved decisions, and residual risks

- Assumes A's protocol-1 acknowledgment/control and direct compact field allowlist remain unchanged during integration.
- Browser live tool shells intentionally do not render intermediate tool results; this is the approved trade-off until final reconciliation.
- The reducer supports direct string/self-contained end fields shipped by A. Unknown/malformed/error shapes remain fail-open normal paths rather than being guessed as compact content.
- Browser runtime behavior was structurally and harness validated, but no full interactive real-browser visual run was performed in this worker environment.
- There are no new product, API, security, migration, or ownership decisions requiring resolution.

## Integration notes

1. Keep A's `lib/webui-output-mode.mjs` seam and protocol exactly as implemented; B must be integrated after A.
2. Re-run the complete suite in an installed checkout (without the temporary loader limitations), plus the plan's manual normal/compact dual-client, barrier, Unicode/thinking/todo/tool/abort/end matrix.
3. Verify the temporary shell disappears on the next `renderAllMessages()` reconciliation and rich tool cards are built solely from final messages.
4. Keep the current cache version/module inclusion together; removing either risks an offline PWA serving an `app.js` that imports a missing helper.
5. Re-run `git diff --check` and `git diff --cached --name-only` after integration; B's final inspection found no staged files.
