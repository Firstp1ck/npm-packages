# WebUI stream-output isolation — Wave 0 baseline

- **Captured:** 2026-08-05
- **Integration owner:** parent Pi session
- **Baseline revision:** `6f96d29256c2362bee165469899b4007e1655f18`
- **Working tree:** clean (`git status --short` produced no entries)
- **Classification:** complex. Repository evidence confirms multiple independently meaningful slices across `public/app.js` event routing, a new transcript-only controller, lifecycle/chrome/todo reconciliation, and browser interaction fixtures/tests. The preliminary complex classification remains valid.
- **Blocking decisions:** none. The event ownership contract and non-goals in the canonical plan are approved by the implementation request.

## Baseline coupling observed

- `handleEvent()` processes tab activity and skill tracking before event dispatch.
- `handleMessageUpdate()` updates run-indicator/composer activity for raw thinking/text/tool-call deltas and schedules live todo-widget sync from raw text.
- `tool_execution_update` updates the transcript card and run-indicator activity.
- `renderMessages()` also renders footer and feedback chrome; `refreshMessages()` renders footer again.
- Existing transcript DOM ownership and normal/compact rendering are already protected by `transcriptRenderer` and `fast-output-live.mjs`.

## Baseline validation

All commands exited `0`:

```text
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
git diff --check
```

Fast-mode baseline ledger:

```json
{"normalScanChars":8464384,"compactScanChars":16384,"scanRatio":516.625,"normalFlushes":512,"compactFlushes":103,"normalDomWrites":512,"compactDomWrites":103}
```

## Ownership note

The earlier planning-time dirty-tree warning no longer matches the implementation baseline. The repository is clean, but WS1 and WS2 remain sequential because both legitimately touch `public/app.js`; no reset, clean, checkout, staging, or commit operation is authorized.
