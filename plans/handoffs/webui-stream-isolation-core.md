# WebUI stream-output isolation — WS1 core handoff

- **Identity:** implementation worker 1, attempt 2, resumed integration-validation pass
- **Status:** integrated and validated
- **Baseline revision:** `6f96d29256c2362bee165469899b4007e1655f18`
- **Result state:** WS1 controller/routing plus the integration-owner static-serving/PWA compatibility changes are present in the shared working tree; the complete WebUI check passes; no files are staged or committed
- **Integration review:** the integration owner inspected and accepted the WS1 source diff before applying the approved mechanical compatibility edits
- **Classification:** complex remains valid; this handoff completes WS1 only, while WS2 browser/lifecycle work, central integration, and independent review remain separate plan gates

## Changed files

### WS1 implementation

- `pi-package-webui/public/stream-output-controller.mjs` — dependency-free classifier and one-frame ordered controller queue with synchronous barriers, cancellation, stale-owner rejection, unknown-event fail-closed behavior, and transcript-specific injected sinks.
- `pi-package-webui/public/app.js` — controller integration; tab-generation ownership; raw dispatch before global tab/activity/skill processing; transcript-only message/tool-update sinks; normal/compact routing; semantic flush barriers; reconnect/process cancellation.
- `pi-package-webui/tests/stream-output-controller.test.mjs` — classification, ordering, one-frame coalescing, barrier, cancellation, stale-owner, unknown-subtype, and mode-parity unit coverage.
- `pi-package-webui/tests/stream-output-isolation-static.test.mjs` — raw-routing order and forbidden-sink reachability coverage.

### Approved mechanical integration

- `pi-package-webui/bin/pi-webui.mjs` — serves `stream-output-controller.mjs` as a startup-critical static module.
- `pi-package-webui/public/service-worker.js` — adds the module to the app shell and advances the cache identity from `pi-webui-pwa-v72` to `pi-webui-pwa-v73`.
- `pi-package-webui/tests/mobile-static.test.mjs` — replaces obsolete token-driven widget/activity/scheduler assertions with the approved transcript-only controller contract and verifies static serving.
- `pi-package-webui/tests/codex-fast-mode-static.test.mjs`
- `pi-package-webui/tests/composer-action-grid-reorder-static.test.mjs`
- `pi-package-webui/tests/mobile-continuity-tablet-static.test.mjs`
- `pi-package-webui/tests/mobile-foundation-static.test.mjs`
- `pi-package-webui/tests/mobile-phone-experience-static.test.mjs`
- `pi-package-webui/tests/open-issue-wizard-static.test.mjs`
- `pi-package-webui/tests/persistent-ui-layout-static.test.mjs`
- `pi-package-webui/tests/questionnaire-dialog.test.mjs`
- `pi-package-webui/tests/side-panel-section-reorder-static.test.mjs`
  - These nine static tests were mechanically advanced from cache identity `v72` to `v73` after the first resumed full check exposed their stale exact-version assertions. No product behavior was changed.
- `plans/handoffs/webui-stream-isolation-core.md` — this final integrated/validated handoff.

### Preserved parent-owned evidence

- `plans/planned/webui-main-agent-stream-output-isolation.md` — parent-owned plan/progress edits were not modified by this worker.
- `plans/handoffs/webui-stream-isolation-baseline.md` — parent-owned baseline evidence was not modified by this worker.

`pi-package-webui/tests/run-all.mjs` was not changed because it already discovers every `*.test.mjs` file.

## Implementation summary

- Known `message_update` text/thinking/tool-call/error fragments and `tool_execution_update` are classified and consumed before global event processing. Unknown `message_update` subtypes also fail closed and cannot acquire chrome mutation authority.
- One retained frame handle drains one deterministic ordered pending queue. Raw end/error fragments and semantic lifecycle barriers flush synchronously. Reconnect and process-failure paths cancel retained work.
- Every queued entry carries active tab ID plus generation. Stale-at-dispatch and stale-before-frame events are consumed without invoking transcript sinks.
- Raw message sinks do not call `setRunIndicatorActivity`, live todo/widget synchronization, event logging, global tab/skill processing, network reconciliation, or the prior normal/compact output schedulers.
- Compact state flushes inside the controller frame. Normal text/thinking/tool-call updates continue through the established transcript renderer ownership mechanisms.
- Raw tool-execution updates use an immediate transcript-only live-card sink within the controller frame. Chat follow remains a transcript-local injected sink and runs once after an applied batch.
- The new module is now served by the WebUI and cached in the versioned offline app shell.

## Validation evidence

Commands ran from `/home/firstpick/npm-packages` unless prefixed with `cd pi-package-webui`.

### Initial WS1 implementation validation

1. `cd pi-package-webui && node --check public/stream-output-controller.mjs && node --check public/app.js && node tests/stream-output-controller.test.mjs && node tests/stream-output-isolation-static.test.mjs` — exit `0`; both syntax checks and both new tests passed.
2. `cd pi-package-webui && node tests/streaming-ui-coupling.test.mjs && node tests/interaction-state-stability-static.test.mjs && node tests/chat-scroll-intent-static.test.mjs && node tests/fast-output-live.test.mjs` — exit `0`; all four passed.
3. `cd pi-package-webui && node tests/fast-mode-client-static.test.mjs && node tests/webui-output-mode.test.mjs && node tests/fast-mode-output-work.test.mjs && node tests/completion-signal-contract.test.mjs` — exit `0`; all four passed. Fast-mode ledger remained `normalScanChars=8464384`, `compactScanChars=16384`, `scanRatio=516.625`, `normalFlushes=512`, `compactFlushes=103`, `normalDomWrites=512`, `compactDomWrites=103`; semantic hash remained `74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f`.
4. `cd pi-package-webui && node tests/sse-backpressure-harness.test.mjs && node tests/thinking-stream-recovery.test.mjs && node tests/compaction-resume-harness.test.mjs` — exit `0`; all three passed.
5. The pre-integration `cd pi-package-webui && npm run check` — exit `1`; 110/113 test files passed and correctly exposed the missing server allowlist, app-shell entry, and obsolete mobile assertions. The integration owner subsequently applied those approved mechanical changes.

### Resumed integration inspection and validation

6. `git status --short && printf '%s\n' '--- staged ---' && git diff --cached --name-only && printf '%s\n' '--- head ---' && git rev-parse HEAD && printf '%s\n' '--- diff check ---' && git diff --check` — exit `0`; HEAD remained the approved baseline, diff check passed, and staged output was empty.
7. `git diff -- pi-package-webui/bin/pi-webui.mjs pi-package-webui/public/service-worker.js pi-package-webui/tests/mobile-static.test.mjs pi-package-webui/public/app.js` — exit `0`; inspection confirmed the accepted WS1 diff plus only the approved static allowlist, app-shell/cache, and assertion changes.
8. First resumed `cd pi-package-webui && npm run check` — exit `1`; 104/113 test files passed. All nine failures were stale exact cache-version assertions expecting `pi-webui-pwa-v72` after the approved app-shell change advanced it to `v73`:
   - `codex-fast-mode-static.test.mjs`
   - `composer-action-grid-reorder-static.test.mjs`
   - `mobile-continuity-tablet-static.test.mjs`
   - `mobile-foundation-static.test.mjs`
   - `mobile-phone-experience-static.test.mjs`
   - `open-issue-wizard-static.test.mjs`
   - `persistent-ui-layout-static.test.mjs`
   - `questionnaire-dialog.test.mjs`
   - `side-panel-section-reorder-static.test.mjs`
9. `grep` inspection for `pi-webui-pwa-v72` across `pi-package-webui/tests/*.test.mjs` identified exactly those nine stale assertions. Each was mechanically advanced to `v73`; no product source was modified in this correction.
10. Second resumed `cd pi-package-webui && npm run check` — exit `0`; all syntax checks and all **113/113** test files passed. Notable included passes: `boot-failure-diagnostics.test.mjs`, `http-endpoints-harness.test.mjs`, `mobile-static.test.mjs`, `service-worker-lifecycle.test.mjs`, `stream-output-controller.test.mjs`, `stream-output-isolation-static.test.mjs`, `streaming-ui-coupling.test.mjs`, normal/compact output tests, SSE backpressure, thinking recovery, and compaction resume.
11. `git diff --check && printf '%s\\n' '--- status ---' && git status --short && printf '%s\\n' '--- staged ---' && git diff --cached --name-only && printf '%s\\n' '--- stale cache assertions ---' && grep -R "pi-webui-pwa-v72" pi-package-webui/tests --include='*.test.mjs' || true && printf '%s\\n' '--- handoff status ---' && grep -E '^(- \\*\\*Status:|## Omissions|## Integration notes)' plans/handoffs/webui-stream-isolation-core.md` — exit `0`; diff check passed, no files were staged, no stale `v72` test assertions remained, and the handoff reported `integrated and validated`.

## Omissions

- Browser fixtures/specs and the planned mutation/focus/node-identity/network proof were not run or edited; those remain assigned to WS2.
- No package version, package metadata, lockfile, index, style, browser fixture/spec, canonical plan, or report file was edited.
- No staging, commit, reset, checkout, or clean operation was performed.

## Deviations, assumptions, unresolved decisions, and residual risks

- **Deviation resolved:** the original WS1 boundary omitted startup static-serving and PWA app-shell compatibility files. The integration owner explicitly accepted and applied those mechanical changes.
- **Validation correction:** the resumed worker updated nine stale cache-version test literals from `v72` to `v73` after the full check demonstrated they were the only remaining failures. This stayed inside the already approved mechanical integration scope and changed no product behavior.
- **Assumption:** existing semantic lifecycle cases remain authoritative for Stop/retry/compaction/settlement chrome until WS2 performs its assigned lifecycle separation.
- **Residual risk:** transcript events are controller-frame batched, while established transcript renderer helpers may perform multiple transcript-local reconciliations inside a drained batch. WS2 browser/performance evidence remains the acceptance mechanism for mutation and interaction budgets.
- **Residual risk:** this handoff establishes an integrated WS1 outcome, not completion of the overall complex feature. Central integration, WS2, two independent reviews, final report, and plan archival remain pending.
- **Unresolved product/scope decisions:** none introduced by WS1 or its mechanical integration.

## Integration notes

1. WS1 is ready for the integration owner to record as the first qualifying implementation outcome.
2. Preserve `dispatchTranscriptStreamEvent(event)` at the top of `handleEvent()` before `ingestEventTabActivity()`, `trackSkillsFromEvent()`, inactive-tab chrome handling, and lifecycle switch dispatch.
3. Preserve the controller's transcript-specific interface, single queue, deterministic ordering, synchronous barriers, cancellation, and stale-owner fail-closed behavior.
4. WS2 may now proceed with lifecycle/chrome separation, authoritative todo reconciliation, semantic skill/event boundaries, and browser isolation proof.
5. The overall feature remains incomplete until the canonical complex-feature gates are satisfied.
