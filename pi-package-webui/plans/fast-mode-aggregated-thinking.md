# Fast Mode Aggregated Thinking

Status: Complete
Integration owner: Parent Pi session
Related report: [Fast Mode Aggregated Thinking report](../reports/fast-mode-aggregated-thinking.html)

## Goal and success criteria

In acknowledged fast mode, present all thinking segments from one user turn—including segments separated by tool calls—in one expandable/collapsible box.

Success criteria:

- One user turn produces at most one reconciled thinking box before its final assistant output.
- Tool calls and tool results do not split the thinking box.
- Stored thinking disclosures are collapsed by default, so historical thinking content is not initially visible.
- Live fast-mode thinking is expanded by default so current reasoning remains visible while streaming.
- A user can expand or collapse either disclosure, and an explicit override survives transcript reconciliation while more segments arrive.
- The existing thinking-visibility setting still hides thinking entirely when disabled.
- Normal output mode retains its existing transcript behavior.
- Final assistant output remains Markdown-rendered and compact tool-status behavior remains unchanged.

## Classification

**Lightweight feature.** The preliminary classification is confirmed by repository evidence: the implementation is one browser-rendering slice localized to fast-mode transcript projection, disclosure state, scoped CSS, copy/cache invalidation, and focused frontend contracts. It changes no server protocol, endpoint, dependency, persisted schema, security boundary, migration, or deployment contract.

## Approved design

- Project stored messages into a fast-mode-only transcript representation before DOM reconciliation.
- Collect direct and embedded assistant thinking segments until the next user message or final assistant output.
- Omit tool-only assistant records and stored tool/action rows from the compact projection while joining collected thinking with Markdown paragraph boundaries.
- Emit one synthetic thinking item with a turn-stable transcript/disclosure key.
- Render that item through native `<details>/<summary>` semantics and the existing Markdown thinking renderer.
- Apply role-specific defaults: stored aggregates are closed and the live aggregate is open.
- Store only explicit per-tab overrides from those defaults, restore overrides across reconciliation, clear the live override for each new stream, and discard all disclosure state when the tab closes.
- Route live thinking through the same aggregate disclosure marker while keeping final transcript aggregation authoritative.
- Keep every new projection and presentation branch behind `compactOutputActive()`.

## Scope and non-goals

In scope:

- `public/app.js` fast-mode thinking projection, disclosure rendering/state, and live thinking bubble
- `public/styles.css` scoped aggregate-disclosure presentation
- `public/index.html` fast-mode behavior copy and current shared app cache-bust version
- `public/service-worker.js` PWA cache identity
- `tests/fast-mode-client-static.test.mjs`
- This plan and the final report

Non-goals:

- Changing model inference, token generation, or the compact-v1 transport protocol
- Showing tool bodies or tool history in fast mode
- Changing normal-mode thinking cards
- Persisting disclosure state across page reloads
- Altering the global thinking-visibility preference
- Side-panel resize work concurrently present in shared WebUI files; those hunks are outside this feature's ownership and review scope

## Work items

1. [x] Inspect stored/live fast-mode rendering, transcript reconciliation, disclosure patterns, and tests.
2. [x] Implement per-turn thinking aggregation with collapsed stored disclosure rendering.
3. [x] Preserve explicit stored/live disclosure overrides with stable keys and per-tab cleanup.
4. [x] Add focused static contracts, copy updates, and cache invalidation.
5. [x] Run focused syntax, lifecycle, output-work, and diff checks.
6. [x] Complete provider-diverse independent review and disposition findings.
7. [x] Finalize and strictly validate `reports/fast-mode-aggregated-thinking.html`.
8. [x] Correct live thinking to default expanded while keeping stored thinking collapsed.
9. [x] Obtain a fresh provider-diverse review quorum for the correction.
10. [x] Refresh and strictly revalidate the final report.

## Acceptance checks

- `node --check public/app.js`
- `node tests/fast-mode-client-static.test.mjs`
- `node tests/fast-output-live.test.mjs`
- `node tests/streaming-ui-coupling.test.mjs`
- `node tests/runtime-error-visibility.test.mjs`
- `node tests/fast-mode-output-work.test.mjs`
- `npm run check`
- `git diff --check`
- Two fresh, read-only, provider-diverse reviews of the integrated feature hunks
- Strict HTML report validation

## Validation record

Focused checks pass:

- `node --check public/app.js`
- `node tests/fast-mode-client-static.test.mjs`
- `node tests/fast-output-live.test.mjs`
- `node tests/streaming-ui-coupling.test.mjs`
- `node tests/runtime-error-visibility.test.mjs`
- `node tests/fast-mode-output-work.test.mjs`
- `git diff --check`

The broad `npm run check` execution reached 45/46 test files and stopped in `tests/mobile-static.test.mjs` because the repository baseline already contains interface font declarations below that test's `0.75rem` floor. The same declarations and assertion are present at `HEAD`; an independent reviewer additionally reproduced the same failure after stashing the feature diff. Concurrent side-panel, chat-scroll, and file-tree work later modified shared WebUI files and tests; final reviewers excluded those unrelated hunks and reproduced every focused feature check as passing.

Strict report validation passed with no warnings:

- `python3 /home/firstpick/.pi/agent/skills/html-report/scripts/validate_report.py reports/fast-mode-aggregated-thinking.html --strict`

## Independent review and dispositions

Initial run: `94b72fd4-1588-4472-859a-728988cc138f`.

- **Anthropic Claude Sonnet 5, high thinking — qualifying success, confidence 80/100.** No blocker. The reviewer verified aggregation boundaries, no duplicate thinking rendering, collapsed default, live-path reuse, normal-mode isolation, cache invalidation, and focused tests. **Accepted:** a growing aggregate was recreated by keyed reconciliation and would re-collapse after a user expanded it. The implementation now uses a turn-stable key plus per-tab explicit expansion state and cleanup. **Deferred:** a low-likelihood ordering edge case involving an interleaved stored `compactionSummary`; compaction is not a tool-call separator and broadening boundary policy is outside this localized requirement.
- **Google Gemini 3.6 Flash — non-qualifying failure.** The child returned no review and failed checked acceptance because its structured acceptance report was absent. It does not count toward quorum.

Replacement/fix validation run: `42f10245-e444-47b5-b3b2-58ae373f3b91`.

- **Moonshot Kimi K3, high thinking — qualifying success, confidence 88/100.** No blocker. **Accepted:** preserve explicit expansion when a live compact bubble is recreated. The live disclosure now uses a stable `live` key, and `resetCompactLiveOutput()` clears that key so every new stream still starts collapsed. **Deferred:** index-key fragility, rare non-tool stored-row ordering, and a browser-level toggle harness are low-risk limitations outside this localized slice.
- **Google Gemini 3.6 Flash — non-qualifying failure.** The replacement failed before producing a review because it treated an absent repository-root `progress.md` as fatal. It does not count toward quorum.

Final integrated review run: `97d11015-0d25-4043-bbd1-f0da2fd26b1e`.

| Reviewer | Result | Findings and integration-owner disposition |
|---|---|---|
| Anthropic Claude Sonnet 5, high thinking | Qualifying success; confidence 83/100 | No blocker. **Deferred by design:** explicit live expansion does not transfer to the new authoritative stored disclosure at turn completion; the stored box correctly honors the required collapsed default and loses no content. **Deferred:** the acknowledged rare `compactionSummary` boundary and lack of browser click-through coverage. |
| Moonshot Kimi K3, high thinking | Qualifying success; confidence 92/100 | No blocker. Confirmed the accepted stable live key/reset fix, stored turn-stable key, per-tab cleanup, aggregation, visibility hiding, normal-mode isolation, native disclosure semantics, cache identity, and focused tests. **Deferred:** future history prepending could change index-derived keys and fail safely to collapsed; no current code path prepends history. |

The final quorum is fresh, read-only, and provider-distinct from both reviewers and the OpenAI implementation provider.

Correction review run: `7057dfd0-a44d-4ca8-872c-73178964d71b`.

| Reviewer | Result | Findings and integration-owner disposition |
|---|---|---|
| Anthropic Claude Sonnet 5, high thinking | Qualifying success; confidence 88/100 | No blocker. Verified the tri-state override map, expanded live default, collapsed stored default, explicit collapse/expansion persistence, reset behavior, visibility/mode isolation, cache/copy updates, and focused checks. **Deferred:** the pre-existing index-derived stored key and absent browser click-through harness. **Accepted as cosmetic:** the short sidebar hint omits transient-tool wording, which remains in the full settings description. |
| Moonshot Kimi K3, high thinking | Qualifying success; confidence 92/100 | No blocker. Traced all eight absent/override/rebuild/reset state transitions and confirmed native disclosure semantics, per-tab cleanup, cache identities, plan/report consistency, and passing focused checks. **Deferred by design:** live expansion does not transfer to the new stored aggregate because stored thinking must return to its collapsed default. |

The correction quorum is fresh, read-only, and provider-distinct from both reviewers and the OpenAI implementation provider.

Review artifacts:

- `/tmp/pi-webui-fast-thinking-review-anthropic.md`
- `/tmp/pi-webui-fast-thinking-review-moonshot.md`
- `/tmp/pi-webui-fast-thinking-final-review-anthropic.md`
- `/tmp/pi-webui-fast-thinking-final-review-moonshot.md`
- `/tmp/pi-webui-live-thinking-expanded-review-anthropic.md`
- `/tmp/pi-webui-live-thinking-expanded-review-moonshot.md`

## Risks and rollback

- Static source-contract tests do not click a real browser disclosure; independent review and direct lifecycle tracing supplement them.
- Live and stored disclosures intentionally have different defaults; explicit toggle state is represented as a tri-state per-tab override so a collapsed live box and an expanded stored box both survive reconciliation correctly.
- The aggregate synthetic item depends on existing assistant-message normalization; future new stored message roles may require an explicit boundary decision.
- Expansion state is browser-tab-local and intentionally non-persistent.
- Rollback is a direct revert of the localized fast-mode JavaScript, CSS, copy/cache assertions, plan, and report changes. No data migration or cleanup is required.

## Concurrent worktree note

During implementation, other Pi sessions added side-panel resize, chat-scroll, file-tree, and related test/report work in shared WebUI files. The live-default correction advances the current integrated cache identities to `app.js?v=89` and `pi-webui-pwa-v42`. Unrelated concurrent hunks were not authored, reviewed, or claimed by this feature; focused tests acknowledge the current integrated cache versions.
