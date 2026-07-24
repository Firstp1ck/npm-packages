# WebUI Fast Mode — Workstream A Handoff

## Identity and revisions

- **Workstream / run:** A / implementation worker A (run A)
- **Base revision:** `a70550f9717a5483ec0f1f28d54e351e4d8679f3`
- **Result revision:** `a70550f9717a5483ec0f1f28d54e351e4d8679f3` with the Workstream A changes below uncommitted in the assigned worktree.
- **Scope:** persisted/server output-mode configuration, per-client SSE transport, compact production seam, event-history coalescing, deterministic proof, and A-owned fixtures/harnesses only.

## Changed files

- `pi-package-webui/index.ts`
- `pi-package-webui/lib/git-workflow-preferences.mjs`
- `pi-package-webui/lib/webui-output-mode.mjs` (new)
- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/tests/git-workflow-preferences.test.mjs`
- `pi-package-webui/tests/webui-output-mode.test.mjs` (new)
- `pi-package-webui/tests/fixtures/fast-mode-output-events.mjs` (new)
- `pi-package-webui/tests/fast-mode-output-work.test.mjs` (new)
- `pi-package-webui/tests/fast-mode-sse-harness.test.mjs` (new)
- `pi-package-webui/tests/fixtures/fake-pi.mjs`
- this handoff

The pre-existing untracked `pi-package-webui/plans/webui-fast-mode.md` was not modified by A.

## B-facing production contract

`lib/webui-output-mode.mjs` is the sole server compaction seam. B must not clone it. It exports:

```js
normalizeOutputMode(value, fallback)
resolveOutputModeDefault({ cliMode, envMode, persistedMode })
negotiateOutputMode({ requestedMode, protocolVersion, serverDefault })
browserOutputEvent(event, { outputMode })
encodeBrowserSseEvent(event, { outputMode })
isOutputModeSemanticBarrier(event)
```

Also exported constants: `OUTPUT_MODE_NORMAL === "normal"`, `OUTPUT_MODE_COMPACT_V1 === "compact-v1"`, and `OUTPUT_MODE_PROTOCOL_VERSION === 1`.

Browser connection contract:

```text
GET /api/events?tab=<id>&outputMode=auto|normal|compact-v1&outputModeProtocol=1
```

- B must use `outputMode=auto&outputModeProtocol=1` on every normal browser EventSource connection.
- A client activates compact handling only when `webui_connected.outputMode.protocolVersion === 1`; an absent/invalid/old request receives `{ protocolVersion: 0, requestedMode: "normal", activeMode: "normal" }` and must stay normal.
- `webui_connected.outputMode` contains `protocolVersion`, `requestedMode`, `activeMode`, `serverDefault`, and `serverDefaultSource`.
- Auto-client changes emit untransformed `webui_output_mode` before the first event in the new representation:

```json
{
  "type": "webui_output_mode",
  "protocolVersion": 1,
  "previousMode": "normal",
  "activeMode": "compact-v1",
  "reason": "server-default-change"
}
```

- Compact output copies only canonical `message_update` `text_delta`, `thinking_delta`, `toolcall_delta`, and directly self-contained end variants. It retains direct fields, IDs/names, metadata, `contentIndex`, and exact `delta` including `""`; it removes only top-level accumulated `message` and nested `assistantMessageEvent.partial` in those allowlisted copies. Unknown/malformed/delta-less/error/other lifecycle shapes fail open unchanged.
- Compact drops only `tool_execution_update`; tool start/end, errors, extension UI/status/widget/dialog/replay, responses, diagnostics, and lifecycle events remain intact.
- Final transcript APIs remain unchanged and are authoritative for B reconciliation. A does not modify browser source.

## Server configuration behavior

- Persisted `outputModeDefault` is schema-normalized in the existing settings file; current schema version is 4. Missing/invalid persisted values normalize to `normal`. Startup logs an invalid persisted value when detected.
- Precedence is CLI `--output-mode` > `PI_WEBUI_OUTPUT_MODE` > persisted setting > `normal`. Invalid CLI/environment values fail startup.
- `/webui-start --output-mode normal|compact-v1` forwards the standalone CLI argument.
- `GET /api/webui-output-mode` and `PUT /api/webui-output-mode {"outputModeDefault":"normal"|"compact-v1"}` expose/persist `{ persistedDefault, effectiveDefault, source, overridden }`; PUT does not restart Pi or mutate session state. Health and detailed WebUI status include the same `outputMode` metadata.
- Each SSE entry is a descriptor containing `{ res, requestedMode, protocolVersion, activeMode, pendingMode, defaultSource }`. Auto descriptors change immediately when idle, or after the next semantic barrier when active. Explicit descriptors do not follow the server default.

## Send-site inventory

All original browser SSE paths now flow through `sendSseToClient()` and production `sendSse()`/`encodeBrowserSseEvent()`:

1. RPC forwarding (`attachRpcToTab`)
2. `broadcastTabEvent`
3. `broadcastServerEvent`
4. extension status replay
5. extension widget replay
6. pending extension-dialog replay
7. tab CWD restart and CWD-changed events
8. tab reload/reloaded events
9. tab close event and close
10. network-rebind event and close
11. remote-auth-change event and close
12. initial `webui_connected` negotiation acknowledgement
13. output-mode control events

`grep` inspection after implementation found no bypass direct sender; the only direct `sendSse()` calls are its wrapper, `sendSseToClient()`, and the internal mode-control write. Normal output still uses `JSON.stringify` through the same production encoder.

## Deterministic production-seam gate

Fixture: fresh fixed **512 × 32-byte** cumulative assistant trace (16,384 final bytes), with lifecycle/start/end plus tool start/end and an error passthrough record. It invokes `encodeBrowserSseEvent()` directly for both modes, reparses every emitted payload, reduces text/content-index/lifecycle/tool/error/final-message semantics, requires deep parity plus SHA-256 equality, and asserts source-event non-mutation.

Latest output:

```text
R       = 8,581,802
Snormal = 8,581,802
Sfast   =   106,154
Wnormal = 25,745,406
Wfast   =  8,794,110
ratio   = 2.927574  (PASS; >= 1.5)
semantic SHA-256 = 74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f
```

This is deterministic serialized JSON byte-work only. It makes no inference, token/s, network, timer, or DOM-speed claim.

## Commands and results

| Command | Result |
| --- | --- |
| `cd pi-package-webui && node --check lib/webui-output-mode.mjs && node --check bin/pi-webui.mjs && node --check tests/fixtures/fake-pi.mjs` | Passed |
| `cd pi-package-webui && node tests/git-workflow-preferences.test.mjs` | Passed |
| `cd pi-package-webui && node tests/webui-output-mode.test.mjs` | Passed |
| `cd pi-package-webui && node tests/fast-mode-output-work.test.mjs` | Passed; counts/hash above |
| `cd pi-package-webui && NODE_OPTIONS='--experimental-loader=/tmp/pi-webui-worktree-deps-loader.mjs' node tests/fast-mode-sse-harness.test.mjs` | Passed |
| `cd pi-package-webui && NODE_OPTIONS='--experimental-loader=/tmp/pi-webui-worktree-deps-loader.mjs' node tests/transport-hardening-harness.test.mjs` | Passed |
| `cd pi-package-webui && PI_WEBUI_OUTPUT_MODE=invalid NODE_OPTIONS='--experimental-loader=/tmp/pi-webui-worktree-deps-loader.mjs' node bin/pi-webui.mjs --help` | Passed expected failure (exit 2 and actionable environment validation) |
| `cd pi-package-webui && NODE_OPTIONS='--experimental-loader=/tmp/pi-webui-worktree-deps-loader.mjs' node bin/pi-webui.mjs --help --output-mode compact-v1` | Passed; help includes `--output-mode <mode>` |
| `git diff --check` | Passed |
| `git diff --cached --name-only` | Passed; no staged files |

The worktree has no local `pi-package-webui/node_modules`; the two real-server harnesses were run against the existing checkout dependency tree with a temporary `/tmp` ESM loader. No repository dependency, package, lockfile, generated, or vendor file was modified.

## Coverage supplied by A

- settings migration, normal default, invalid persisted fail-closed, persistence
- pure precedence and protocol negotiation
- compact transform, exact empty delta, non-mutation, fail-open behavior, tool update omission, semantic barriers
- fixed production encoder byte-work / semantic deep-hash parity
- real server dual-client routing, legacy fallback, acknowledged compact negotiation, tool/error/dialog preservation, idle switching, active barrier ordering, health/API metadata, invalid API input, and 512-delta history coalescing
- existing transport-hardening regression harness

## Omissions and boundary compliance

- No browser implementation, settings UI markup, browser tests, service worker, README, package/lockfile, canonical-plan, or final HTML report was edited. Those are B/integration ownership.
- No Pi RPC JSON parse/input serialization, model/provider/prompt/tool/inference behavior, final `/api/messages` schema, extension bookkeeping, or lifecycle semantics was altered.
- No persistent transcript/session migration is needed.

## Deviations, assumptions, and residual risks

- The Workstream B browser integration is intentionally absent; current `public/app.js` still connects without v1 parameters and therefore safely receives normal mode until B adopts the contract.
- `toolcall_delta` and end-variant field names are allowlisted as approved; unknown or malformed shapes deliberately fail open. B should consume only acknowledged v1 compact deltas and retain normal handlers for all other events.
- Existing real-server validation required a temporary loader solely because this isolated worktree lacks installed dependencies. A packaged/dependency-installed checkout does not require that loader.
- No blocking product, architecture, security, migration, dependency, or ownership decision was introduced. No unresolved decision remains for A.

## Integration notes

1. Merge/retain A before B. B must import no server compactor; it consumes the protocol/fields above.
2. B must add the negotiated EventSource query, acknowledgement gate, one-time normal fallback, compact state/scheduler/tool shells, and final reconciliation without changing A's protocol version or encoder.
3. Integration should rerun the plan acceptance matrix after B, including browser static/runtime tests and the full package suite in an installed dependency environment.
4. Recheck `git diff --cached --name-only` after all integration work; A's final Workstream A inspection found no staged files.
