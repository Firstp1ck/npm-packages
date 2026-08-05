# FW2 WebUI Session Summary Fix Handoff

## Run identity and status

- **Role/workstream:** FW2, second sequential accepted-finding implementation writer for the session-summary WebUI.
- **Parent session:** `019fcea9`.
- **Base/result revision:** `9c3cf721385c8548f02b097c10b6f383f8112578`; working-tree changes only, with no commit or staging.
- **Status:** All accepted FW2 findings were implemented within the approved WebUI boundary. Focused browser, static/parity, HTTP, W1 core, and full package validation passed.
- **Confidence:** 97/100. Exact command interception, browser state transitions, timeout/failure code, and all 111 package tests are verified. Confidence is below 100 because no real provider call or live W1 custom-event/title fixture was allowed, and server RPC rejection is protected by focused source-contract coverage rather than a dynamically rejecting fake Pi fixture.

## Exact FW2-touched files

1. `pi-package-webui/bin/pi-webui.mjs`
2. `pi-package-webui/public/app.js`
3. `pi-package-webui/tests/browser/session-summary.spec.mjs`
4. `pi-package-webui/tests/mobile-static.test.mjs`
5. `pi-package-webui/tests/native-parity.test.mjs`

The runtime-required handoff artifact is `plans/handoffs/pi-session-summary-fix-webui.md`. FW2 did not edit `tests/http-endpoints-harness.test.mjs`, `tests/native-parity-harness.test.mjs`, core/preferences/extension/package files, public markup/styles, optional-feature files, README, the plan, or reports.

## Fixes mapped to accepted findings

### B-1 — typed `/summary` and `/summary refresh`

- Added exact browser-native matching for only `/summary` and `/summary refresh` (case-insensitive after trimming).
- Both forms remain gated by the active tab's loaded `/summary` command catalogue.
- Exact `/summary` opens the existing non-modal overlay, loading preferences/setup first when required and generating only when no successful Markdown exists.
- Exact `/summary refresh` opens the overlay and forces `POST /api/session-summary/generate` with `{ refresh: true }`.
- Interception occurs before normal prompt routing, optimistic transcript insertion, run-state mutation, or `/api/prompt`; the composer is cleared without creating a transcript prompt card or ordinary agent turn.
- Other slash commands and invalid `/summary` argument forms continue through existing routing unchanged.

### B-2 / RSSA-04 seam — session and branch projection reset

- Client normalization detects a changed non-empty `sessionId` and refuses to inherit the previous title or Markdown.
- Versioned `kind: "state"` events now explicitly reset the cached projection even when branch navigation keeps the same session ID. This consumes FW1's new `session_tree` state publication and immediately refreshes an open overlay to the active branch's successful or empty state.
- Ordinary `generating` and `failure` updates still inherit the previous successful Markdown/title when the session has not changed.

### B-3 / RSSA-05 seam — terminal server dispatch failure

- `triggerSessionSummary()` now wraps RPC prompt dispatch and unsuccessful responses.
- Before rethrowing, it preserves the prior successful title/Markdown, sets a bounded single-line failure message, records `status: "failure"`, updates the timestamp, and broadcasts `webui_session_summary` with `kind: "failure"`.
- Reconnecting clients therefore do not replay `generating` indefinitely when dispatch itself fails or times out.

### B-4 — bounded generation dispatch

- Server summary dispatch now uses a dedicated 105-second RPC timeout instead of the generic two-hour prompt timeout.
- The client generate request uses the existing safely forwarded `signal` option with an optional 110-second `AbortSignal.timeout`, leaving a small margin for the server's terminal response.

### B-5 — focused regression coverage

- Browser coverage now proves:
  - typed `/summary` opens the overlay without `/api/prompt`, a transcript card, or generation when a summary exists;
  - typed `/summary refresh` sends `{ refresh: true }`;
  - dispatch failure preserves and renders previous successful Markdown;
  - a different incoming session ID clears old title/Markdown;
  - Escape closes and restores composer focus;
  - switching to a newly created tab closes the overlay.
- Static/parity coverage proves:
  - exact command matching and catalogue gating;
  - active-branch `state` events reset the projection;
  - failure preservation and session-change clearing coexist;
  - 105-second server dispatch, terminal failure state/broadcast, and rethrow behavior.
- A live custom-event success/title smoke was not added because the existing fake Pi fixture does not advertise or emit W1 summary events and was outside FW2's exact write boundary.

### W1 non-contextual display compatibility

- Existing server suppression of `firstpick:session-summary-display` and `firstpick:session-summary-rpc` transcript/control artifacts remains unchanged.
- The browser overlay relies on bounded versioned state events and native HTTP actions; it does not depend on contextual display messages or add transcript-only control artifacts.

## Validation evidence

All corrected commands ran from `/home/firstpick/npm-packages/pi-package-webui` unless noted.

| Command | Exit | Evidence |
|---|---:|---|
| Initial syntax/static/core/diff commands from repository root without `cd pi-package-webui` | 1 | Operator working-directory error only (`MODULE_NOT_FOUND` / missing relative paths); immediately corrected below. No code failure was inferred from these invocations. |
| `node --check public/app.js && node --check bin/pi-webui.mjs` | 0 | Client and server syntax passed. |
| `node tests/session-summary-preferences.test.mjs && node tests/session-summary-core.test.mjs` | 0 | W1 preferences/core suite passed after FW2 integration, including FW1 tree/stale/provider/scheduler regressions. |
| `node tests/mobile-static.test.mjs && node tests/native-parity.test.mjs && node tests/native-parity-harness.test.mjs` (first corrected run) | 1 | Two pre-existing exact-source assertions needed updating for the newly approved native `/summary` member; assertions were narrowed and corrected. |
| Same static/parity command after assertion updates | 0 | Mobile static, native parity, and trust-guard harness passed. |
| `node tests/http-endpoints-harness.test.mjs` | 0 | Auth, CSRF/body, persistence, command-unavailable, and SSE summary endpoint coverage passed. |
| `npx playwright test tests/browser/session-summary.spec.mjs --project=chromium` (first run) | 1 | Implementation path passed through typed overlay; test-only strict-locator assertion failed on two baseline user cards and was corrected with aggregate text inspection. |
| Same Playwright command (second run) | 1 | All feature assertions reached tab-switch setup; optional-feature migration surface intercepted a physical test click. Test used the established programmatic-click pattern instead. |
| Same Playwright command (final run) | 0 | Chromium: 2/2 passed in 2.6 seconds, covering first-click setup/save/generate/sanitization and the new typed/reset/failure/focus/tab-switch flow. |
| `npm test` | 0 | All 111 package test files passed, including optional-feature migration preservation tests. |
| `npm run check` | 0 | Full syntax chain and all 111 package test files passed. |
| `git diff --check -- bin/pi-webui.mjs public/app.js tests/http-endpoints-harness.test.mjs tests/mobile-static.test.mjs tests/native-parity.test.mjs tests/native-parity-harness.test.mjs` plus `git diff --no-index -- /dev/null tests/browser/session-summary.spec.mjs` with expected untracked-file exit normalization | 0 | No whitespace errors in any approved owned path. |
| `git diff --cached --name-only` | 0 | Empty output; no staged files. |

## Diff and preservation evidence

- The combined tracked owned-file diff currently reports 1,857 insertions and 107 deletions across six already-dirty tracked WebUI files; this includes the earlier W2 feature implementation and is not an FW2-only statistic.
- `tests/browser/session-summary.spec.mjs` remains an untracked integrated feature file and is now 271 lines.
- FW2's narrow delta is confined to the five files listed above: dedicated timeouts/failure handling, exact native command routing, projection normalization, two browser flows, and corresponding static/parity assertions.
- `tests/http-endpoints-harness.test.mjs` and `tests/native-parity-harness.test.mjs` were inspected and validated but not modified by FW2.
- Unrelated optional-feature migration hunks/files were not edited, reset, staged, stashed, checked out, or cleaned. Their dedicated tests passed in both full-suite runs.
- No core/preferences/extension/package/lock, public index/styles, README, plan, report, or other forbidden implementation file was touched by FW2.

## Deviations, omissions, and residual risks

- No real provider/network call was made, as required.
- No live fake-Pi W1 success/title custom-event smoke was added: the shared fake fixture does not advertise/emit summary events and was outside FW2 ownership. Existing static contract checks, HTTP/SSE replay coverage, FW1 fake completion tests, and browser-mocked success/state coverage remain the evidence.
- Server unsuccessful/rejected prompt handling is asserted directly against the bounded implementation contract, but a dynamic reject response was not added because doing so required editing the forbidden shared fake fixture or broad harness ownership.
- WebKit was not run; the required focused Chromium flow passed.
- The shared worktree remains intentionally dirty with the integrated feature and unrelated optional-feature migration work. No staged files exist.

## Recommended next step

The parent integration owner should inspect this five-file FW2 delta, run the required focused fresh-context re-review of the accepted WebUI fixes, and then update the plan/report only after reviewer disposition and final integration gates pass.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "All accepted FW2 findings were implemented only in bin/pi-webui.mjs, public/app.js, browser/session-summary.spec.mjs, mobile-static.test.mjs, and native-parity.test.mjs; unrelated optional-feature and forbidden core/package/public files were preserved."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Evidence includes exact focused and full commands, 2/2 Chromium flows, HTTP and W1 core suites, static/parity contracts, two complete 111-file package runs, whitespace checks, diff/status inspection, residual omissions, and empty staged state."
    }
  ],
  "changedFiles": [
    "pi-package-webui/bin/pi-webui.mjs",
    "pi-package-webui/public/app.js",
    "pi-package-webui/tests/browser/session-summary.spec.mjs",
    "pi-package-webui/tests/mobile-static.test.mjs",
    "pi-package-webui/tests/native-parity.test.mjs"
  ],
  "testsAddedOrUpdated": [
    "pi-package-webui/tests/browser/session-summary.spec.mjs",
    "pi-package-webui/tests/mobile-static.test.mjs",
    "pi-package-webui/tests/native-parity.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "initial relative-path validation commands from /home/firstpick/npm-packages",
      "result": "failed",
      "summary": "Operator cwd error only; relative paths were not found and every command was immediately rerun from pi-package-webui."
    },
    {
      "command": "node --check public/app.js && node --check bin/pi-webui.mjs",
      "result": "passed",
      "summary": "Client and server syntax passed."
    },
    {
      "command": "node tests/session-summary-preferences.test.mjs && node tests/session-summary-core.test.mjs",
      "result": "passed",
      "summary": "W1 preferences and core/tree/stale/provider/scheduler regressions passed after FW2 integration."
    },
    {
      "command": "node tests/mobile-static.test.mjs && node tests/native-parity.test.mjs && node tests/native-parity-harness.test.mjs",
      "result": "passed",
      "summary": "Final rerun passed after updating exact-source assertions for native /summary."
    },
    {
      "command": "node tests/http-endpoints-harness.test.mjs",
      "result": "passed",
      "summary": "Summary auth, mutation shape, persistence, command gating, and SSE endpoint coverage passed."
    },
    {
      "command": "npx playwright test tests/browser/session-summary.spec.mjs --project=chromium",
      "result": "passed",
      "summary": "Final run: 2/2 passed; earlier test-only locator and pointer-interception failures were corrected."
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "All 111 package test files passed."
    },
    {
      "command": "npm run check",
      "result": "passed",
      "summary": "Full syntax chain and all 111 package test files passed."
    },
    {
      "command": "git diff --check on approved tracked paths plus no-index browser-spec whitespace check",
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
    "Chromium session-summary spec: 2 passed (2.6s)",
    "http-endpoints-harness.test.mjs passed",
    "session-summary preferences tests passed",
    "session-summary core tests passed",
    "mobile static checks passed",
    "native-parity.test.mjs passed",
    "native-parity-harness.test.mjs passed",
    "npm test: all 111 test files passed",
    "npm run check: all 111 test files passed",
    "owned diff whitespace checks passed",
    "zero real provider calls and zero staged files"
  ],
  "residualRisks": [
    "No real provider call or live W1 custom-event/title fixture was run; offline core fakes, static event contracts, HTTP/SSE replay, and mocked browser state provide coverage.",
    "Server RPC rejection is source-contract tested rather than dynamically injected because the shared fake Pi fixture was outside FW2 ownership.",
    "WebKit was not run; focused Chromium passed.",
    "The combined dirty worktree includes unrelated optional-feature migration changes, preserved and covered by the full suite."
  ],
  "noStagedFiles": true,
  "diffSummary": "WebUI-only fix: intercepts exact typed summary commands into the non-modal overlay, clears stale cross-session/branch projections, broadcasts bounded server dispatch failures, applies 105s/110s server-client bounds, and adds browser/static parity regressions while preserving transcript-artifact suppression.",
  "reviewFindings": [
    "fixed-medium B-1: exact typed /summary now opens the native overlay and exact /summary refresh forces refresh without a transcript card or normal prompt turn.",
    "fixed-low-medium B-2 / RSSA-04 seam: changed session IDs and active-branch state events clear stale title/Markdown projections.",
    "fixed-low B-3 / RSSA-05 seam: rejected/failed RPC dispatch broadcasts bounded terminal failure before rethrowing.",
    "fixed-low B-4: summary dispatch uses a 105-second server timeout and optional 110-second client abort.",
    "fixed-low B-5: browser coverage now includes typed commands, failure preservation, session reset, Escape/focus restore, and tab-switch closure; static contracts cover branch state and dispatch failure.",
    "no blockers found"
  ],
  "manualNotes": "Artifact: plans/handoffs/pi-session-summary-fix-webui.md. Confidence: 97/100. No staged files, commits, dependency changes, or real provider calls."
}
```
