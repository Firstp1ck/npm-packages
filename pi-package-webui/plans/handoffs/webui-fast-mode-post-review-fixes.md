# WebUI Fast Mode — Post-review fixes handoff

## Scope

Applied only the three accepted findings from independent reviewer 1 to the browser compact-live transition path. Reviewer 2 reported PASS with no material finding. Server/configuration production code, the canonical plan, README/PWA/package files, worker handoffs, and the remote-auth settings policy were not changed.

## Accepted findings fixed

### A1 — normal → compact semantic-barrier transition

**Finding:** A normal live text/thinking bubble could remain visible when a barrier control changed the representation to compact, while later compact deltas created a second live bubble.

**Fix:** `public/app.js` now seeds `compactLiveState` from `streamRawText` and `streamThinkingRawText` in `transitionNormalLiveOutputToCompact()`, clears the normal accumulators, cancels/removes normal text and thinking bubbles, and synchronously flushes the seeded compact state. The live DOM therefore has one compact representation until the existing authoritative reconciliation.

**Regression evidence:**

- `tests/fast-output-live.test.mjs` deterministically seeds normal text/thinking then appends a compact delta, asserting one combined compact state.
- `tests/fast-mode-client-static.test.mjs` verifies the production transition seeds both accumulators, clears/removes normal bubbles, and flushes the compact state.

### A2 — compact → normal semantic-barrier transition

**Finding:** After compact mode changed back to normal, normal text rendering could begin with only post-switch deltas because compact mode does not populate normal stream accumulators.

**Fix:** `transitionCompactLiveOutputToNormal()` now flushes compact output, snapshots its text/thinking state before reset, restores `streamRawText` and `streamThinkingRawText`, and immediately renders the restored normal text/thinking state. Subsequent normal deltas append to the transferred state.

**Regression evidence:**

- `tests/fast-output-live.test.mjs` deterministically snapshots the accumulated compact text/thinking state used for normal restoration.
- `tests/fast-mode-client-static.test.mjs` verifies the production control path snapshots before reset, restores both normal accumulators, and renders restored normal text.

### A3 — compact empty self-contained end variants

**Finding:** A recognized compact `text_end` or `thinking_end` with empty direct fields can reduce with `changed:false`; its server-stripped snapshot could then fall through to normal handlers.

**Fix:** `public/fast-output-live.mjs` now exposes `shouldConsumeFastOutputLiveEvent()`. `handleCompactMessageUpdate()` uses it so recognized `text-end`, `thinking-end`, and `toolcall-end` reductions are consumed even when no DOM write is needed. Unknown/malformed/error shapes still return `false` and retain normal diagnostic/fail-open handling.

**Regression evidence:**

- `tests/fast-output-live.test.mjs` verifies empty `text_end` and `thinking_end` reductions remain no-write but are consumed, while an ignored shape is not consumed.
- `tests/fast-mode-client-static.test.mjs` verifies the application handler uses the consume policy and the helper allowlist is limited to recognized compact end kinds.

## Unchanged review dispositions

- **N1 rejected:** no localhost-only restriction was added to `PUT /api/webui-output-mode`. The server-wide setting remains remote-auth-gated and remotely configurable consistently with existing authenticated settings APIs.
- **N2 deferred:** the `sendSse()` raw-response compatibility branch remains unchanged.
- **N3 deferred:** the id-less compact tool-shell fallback remains unchanged.
- **Reviewer 2:** PASS/no material finding; no action required.
- **Schema-v4 integration fix:** the pre-existing `tests/remote-auth-settings-harness.test.mjs` schema-v4 expectation is preserved unchanged.

## Changed files

- `pi-package-webui/public/app.js`
- `pi-package-webui/public/fast-output-live.mjs`
- `pi-package-webui/tests/fast-output-live.test.mjs`
- `pi-package-webui/tests/fast-mode-client-static.test.mjs`
- `pi-package-webui/plans/handoffs/webui-fast-mode-post-review-fixes.md`

## Commands and results

| Command | Result |
| --- | --- |
| `cd pi-package-webui && node --check public/fast-output-live.mjs && node --check public/app.js && node tests/fast-output-live.test.mjs && node tests/fast-mode-client-static.test.mjs && node tests/streaming-ui-coupling.test.mjs` | Passed |
| `cd pi-package-webui && node tests/fast-mode-output-work.test.mjs` | Passed: `R=8581802`, `Snormal=8581802`, `Sfast=106154`, `Wnormal=25745406`, `Wfast=8794110`, ratio `2.927574`, semantic SHA-256 `74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f` |
| `cd pi-package-webui && npm run check` | Passed: all 46 test files passed, including `remote-auth-settings-harness.test.mjs` |
| `git diff --check` | Passed |
| `test -z "$(git diff --cached --name-only)"` | Passed: no staged files |
| `grep -n 'savedAfterDisable.version, 4' pi-package-webui/tests/remote-auth-settings-harness.test.mjs` | Passed: preserved schema-v4 expectation at line 139 |

## Residual risks

- The transition behavior is deterministically covered by pure state and static integration tests, but was not visually exercised in an interactive browser session.
- Existing `/api/messages` reconciliation remains the final authority and may still replace temporary live DOM after a semantic barrier; the fixes ensure the transitional state itself is coherent.

## Confidence

**96/100.** The accepted browser-only findings have direct implementation and deterministic regression coverage, the production byte-work/hash gate is unchanged and passing, and the full package check passes. Remaining uncertainty is limited to visual timing nuances only observable in an interactive browser.
