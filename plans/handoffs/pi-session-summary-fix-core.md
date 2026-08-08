# FW1 Core Session Summary Fix Handoff

## Run identity and status

- **Role/workstream:** FW1, first sequential accepted-finding implementation writer for the session-summary core.
- **Parent session:** `019fcea9`.
- **Base/result revision:** `9c3cf721385c8548f02b097c10b6f383f8112578`; working-tree changes only, with no commit or staging.
- **Status:** All eight assigned accepted findings implemented within the three implementation/test paths; focused and full package validation passed.
- **Provenance:** Read the approved plan, both independent review artifacts, W1 attempt/core and W2 handoffs, the active feature workflow plus complex-feature contract, current source/tests, and installed `@earendil-works/pi-ai` / `pi-coding-agent` 0.83.0 public docs/types/adapter source before editing.
- **Confidence:** 97/100. Core behavior, representative fake provider options, installed adapter contracts, and all 111 package tests are verified. Remaining uncertainty is limited to intentionally omitted real-provider/network execution and the absence of a full TypeScript compiler in this package.

## Exact implementation files

1. `pi-package-webui/session-summary.ts`
2. `pi-package-webui/lib/session-summary-core.mjs`
3. `pi-package-webui/tests/session-summary-core.test.mjs`

The runtime-required handoff artifact is `plans/handoffs/pi-session-summary-fix-core.md`. No preference, package/lock, WebUI server/browser/public, optional-feature migration, plan, report, or other implementation file was edited.

## Fixes mapped to accepted findings

- **RSSA-01:** Scheduler cleanup no longer assigns cooldown/disposed bare promises to `inFlight`. Failure plus pending automatic work clears both `inFlight` and `pending`; a later manual refresh still bypasses cooldown. Added the exact interaction regression.
- **RSSA-02:** Replaced raw `complete()` with installed public `completeSimple()`. Requests now use provider-neutral `reasoning`, no raw `reasoningEffort`, and no unconditional `onPayload` mutation. The installed simple adapters own provider-specific reasoning and add `store:false` only on supported OpenAI/Codex/OpenAI-compatible paths. Retained one request, no tools, no fallback/retry, fresh UUID, `cacheRetention:"none"`, 90-second timeout/abort, and added an 8,192-token output cap. Representative OpenAI Responses, Anthropic, Google, and Bedrock fake option tests make no network calls.
- **RSSA-03:** `auth.ok` is authoritative. Optional `apiKey`, `headers`, and `env` are forwarded without rejecting header/env/ambient-only auth; representative header-only and env-only fakes pass.
- **RSSA-04:** Added `session_tree` projection publishing from `latestSummaryState(ctx.sessionManager.getBranch())`. Tests navigate between a summarized and unsummarized branch and verify the current branch projection. Existing source/leaf/fingerprint/entry-count checks continue discarding stale results.
- **RSSA-05:** A stale completion now emits a bounded terminal `state` projection for the current branch, restoring the previous/empty state rather than leaving WebUI generating. A delayed fake completion plus tree navigation verifies no stale append and terminal state emission.
- **RSSA-06:** Added branch-local `firstpick:session-summary-name-provenance` custom entries and `session_info_changed` tracking. A session-ID/name-matched one-event self-generated-name guard prevents generated renames being marked explicit. Same-text explicit renames are authoritative across subsequent generations/reloads/tree restoration; an explicit clear records `explicit:false` and may re-enable title generation. Tests cover self rename, same-text explicit protection after cadence, clear, and regeneration.
- **RSSA-07:** Added a fixed 20-KiB raw response bound before `JSON.parse`, exact allowed-key/type validation, unknown-key/type rejection, and the provider-neutral 8,192 max-token cap. Tests reject unknown keys, invalid title types, and oversized unknown fields. Persisted-state normalization validates decoded Markdown independently so escaped historical state within the 16-KiB decoded bound remains restorable.
- **RSSA-08:** TUI display now uses non-contextual `appendEntry()` plus `registerEntryRenderer()` while canonical summary state remains separate. Tests verify no contextual display custom message is appended and the display entry contains rendered Markdown. WebUI control/state RPC behavior is unchanged and custom entries add no WebUI transcript messages.

## Tests added or updated

`pi-package-webui/tests/session-summary-core.test.mjs` now covers:

- failure + pending automatic cooldown cleanup + later manual bypass;
- strict total-output/schema-key/schema-type bounds;
- branch-local explicit-name provenance, same-text protection, clear/re-enable, and the self-rename guard;
- active-branch `session_tree` projection and stale terminal restoration;
- non-contextual TUI display entries;
- representative OpenAI Responses, Anthropic, Google, and Bedrock provider-neutral completion options, including header/env-only auth, fixed output cap, unique routing IDs, no raw payload mutation, no tools, and exactly one fake request per refresh.

## Commands and validation evidence

All commands ran from `/home/firstpick/npm-packages/pi-package-webui` unless noted.

| Command | Exit | Evidence |
|---|---:|---|
| `node tests/session-summary-core.test.mjs` | 0 | All new and existing core/parser/scheduler/title/tree/stale/TUI/provider-fake tests passed. |
| `node tests/session-summary-preferences.test.mjs` | 0 | Preferences contracts passed without modifying preference code/tests. |
| `node --check lib/session-summary-core.mjs && node --experimental-transform-types --check session-summary.ts && node --experimental-transform-types -e "import('./session-summary.ts')..."` | 0 | Core syntax, TS transform syntax, and public extension module load passed; Node emitted only its expected experimental transform warning. |
| `node tests/custom-message-markdown-static.test.mjs && node tests/completion-signal-contract.test.mjs` | 0 | Markdown and true settlement contracts passed. |
| Offline installed-adapter assertion over `pi-ai/dist/compat.js` and OpenAI adapter source | 0 | Verified public `completeSimple` dispatch, simple reasoning mapping, unconditional native `store:false` for Codex/Responses, and compatibility-gated `store:false` for OpenAI Completions. No network call. |
| `npm test` | 0 | All 111 package test files passed, including optional-feature migration preservation tests. |
| `npm run check` | 0 | Package syntax chain and all 111 test files passed. |
| `git diff --check -- <owned paths>` plus no-index checks for the three untracked owned files | 0 | No whitespace errors in owned paths. |
| `git diff --cached --name-only` | 0 | Empty output; no staged files. |

## Deviations, omissions, and residual risks

- No real provider call was made, as required. Provider behavior is covered by installed 0.83.0 public adapter-source assertions and injected representative fakes.
- No browser test was rerun because FW1 owns only core files and the assigned contract requested core/preferences, transform/load, completion/Markdown, and fake-provider checks. The full 111-file package suite and check suite passed, including existing HTTP/static integration tests.
- No standalone TypeScript compiler/typecheck was available or invoked; Node transform syntax/module load and the package check suite passed.
- The three owned implementation/test files remain untracked as part of the pre-existing combined feature worktree, so ordinary tracked `git diff --stat` cannot isolate them. Their final sizes are 403, 320, and 452 lines respectively; explicit no-index whitespace checks passed.
- Unrelated optional-feature migration and shared WebUI dirty files remained untouched; their dedicated tests passed inside both full-suite runs.
- No staged files, commit, stash, checkout, reset, clean, dependency install, lockfile edit, or network/provider call occurred.

## Recommended next step

Parent integration should inspect this three-file result, run the required focused fresh-context re-review for the accepted material fixes, then disposition any follow-up before final report/plan completion.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "All eight accepted FW1 findings are implemented only in session-summary.ts, lib/session-summary-core.mjs, and tests/session-summary-core.test.mjs; no shared WebUI, preferences, package, migration, plan, or report implementation file was edited."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused regressions, four representative fake provider cases, installed-adapter source assertions, syntax/module-load checks, full npm test/check runs, whitespace checks, and no-staged-file evidence are recorded with exact outcomes."
    }
  ],
  "changedFiles": [
    "pi-package-webui/session-summary.ts",
    "pi-package-webui/lib/session-summary-core.mjs",
    "pi-package-webui/tests/session-summary-core.test.mjs"
  ],
  "testsAddedOrUpdated": [
    "pi-package-webui/tests/session-summary-core.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "node tests/session-summary-core.test.mjs",
      "result": "passed",
      "summary": "Core suite passed with scheduler interaction, provider-neutral auth/options, tree/stale state, provenance, strict parser, and non-contextual display regressions."
    },
    {
      "command": "node tests/session-summary-preferences.test.mjs",
      "result": "passed",
      "summary": "Unmodified preferences contracts passed."
    },
    {
      "command": "node --check lib/session-summary-core.mjs && node --experimental-transform-types --check session-summary.ts && node --experimental-transform-types module-load import",
      "result": "passed",
      "summary": "Core syntax, TypeScript transform syntax, and extension module load passed."
    },
    {
      "command": "node tests/custom-message-markdown-static.test.mjs && node tests/completion-signal-contract.test.mjs",
      "result": "passed",
      "summary": "Markdown rendering and settlement contracts passed."
    },
    {
      "command": "offline installed completeSimple reasoning/no-storage adapter assertions",
      "result": "passed",
      "summary": "Verified installed public simple dispatch/reasoning mapping and provider-supported store:false behavior without network access."
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "All 111 package test files passed."
    },
    {
      "command": "npm run check",
      "result": "passed",
      "summary": "Package syntax chain and all 111 test files passed."
    },
    {
      "command": "git diff --check -- <owned paths> plus no-index untracked-file whitespace checks",
      "result": "passed",
      "summary": "No owned-path whitespace errors."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "Empty output; no staged files."
    }
  ],
  "validationOutput": [
    "session-summary core tests passed",
    "session-summary preferences tests passed",
    "session-summary module load passed",
    "custom message Markdown static check passed",
    "completion signal contract checks passed",
    "installed completeSimple reasoning/no-storage adapter contracts passed",
    "npm test: all 111 test files passed",
    "npm run check: all 111 test files passed",
    "owned-path whitespace checks passed",
    "zero real provider calls and zero staged files"
  ],
  "residualRisks": [
    "No real provider/network call was made; installed adapter source and fake representative option tests provide the required offline evidence.",
    "No standalone TypeScript compiler was available; Node transform syntax/module load and the full package check suite passed.",
    "Focused browser execution was omitted as outside FW1 ownership; full package HTTP/static integration tests passed."
  ],
  "noStagedFiles": true,
  "diffSummary": "Core-only fix: repairs scheduler cleanup; adopts completeSimple provider-neutral calls/auth/output cap; publishes tree/stale terminal state; persists explicit-name provenance; hardens raw/schema parsing; and converts TUI display to non-contextual custom entries, with focused regressions.",
  "reviewFindings": [
    "fixed-high RSSA-01: scheduler no longer wedges after failure plus pending cooldown work.",
    "fixed-high RSSA-02: provider-neutral completeSimple/reasoning path replaces raw provider-specific options.",
    "fixed-medium RSSA-03: auth.ok supports key/header/env/ambient auth material.",
    "fixed-high RSSA-04: session_tree publishes latest active-branch state.",
    "fixed-medium RSSA-05: stale generation emits terminal restored state.",
    "fixed-medium RSSA-06: same-text explicit rename provenance is branch-local and clearable.",
    "fixed-medium RSSA-07: total output/schema bounds and max-token cap are enforced.",
    "fixed-low RSSA-08: TUI display uses non-contextual entry rendering.",
    "no blockers found"
  ],
  "manualNotes": "Artifact: plans/handoffs/pi-session-summary-fix-core.md. Confidence: 97/100. No staged files or real provider calls."
}
```
