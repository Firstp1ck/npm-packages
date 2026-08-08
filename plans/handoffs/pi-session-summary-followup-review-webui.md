# Follow-up Re-Review — Session Summary WebUI Accepted Fixes (B-1..B-5, RSSA-04/05 seams)

## Run identity and scope

- **Role:** Read-only, fresh-context re-review of the accepted FW2 WebUI fixes. No files edited, staged, or committed; no subagents spawned.
- **Inputs read first:** `plans/planned/pi-session-summary-extension.md` (E17 and failure-recovery sections), `plans/handoffs/pi-session-summary-review-ux.md` (original B-1..B-5 findings), `plans/handoffs/pi-session-summary-fix-webui.md` (FW2 fix handoff), then the live server/client/test sources.
- **Tree:** HEAD `9c3cf721385c8548f02b097c10b6f383f8112578` plus the intentionally dirty integrated working tree (session-summary feature + unrelated optional-feature migration). Staged set is empty.
- **Overall confidence:** 93/100. Every fix was verified against live code plus independently re-run static, HTTP, and Chromium suites, all green. Confidence is below 100 only because the server RPC-rejection path remains statically (not dynamically) proven and no live W1 custom-event fixture or WebKit run exists — both pre-documented omissions, not new gaps.

## Verified fixes (evidence per finding)

### B-1 — Typed `/summary` and `/summary refresh` native interception — CONFIRMED FIXED
- `public/app.js:37536` — `handleNativeSlashSelectorCommand` matches only exact forms via `/^\/summary(?:\s+(refresh))?$/i` after trimming; `"summary"` is in `NATIVE_SELECTOR_COMMANDS` (line 2831). Invalid forms such as `/summary foo` fall through: `summaryMatch` is null and `slashCommandName` (`^\/([^\s]+)$`) yields `""`, so routing returns `false` and normal prompt handling continues unchanged.
- Catalogue gating: `hasLoadedRpcCommand("summary")` guard at `public/app.js:37541` (warns + refreshes the catalog when the extension command is not loaded); `openSessionSummaryForTab` re-gates via `hasAvailableCommand("summary", { tabId })` at `public/app.js:35563`. Server-side defense in depth: `triggerSessionSummary` re-checks the child command catalogue (`bin/pi-webui.mjs:2898`).
- No prompt pollution: interception call sites are `public/app.js:40212` (inside `sendPrompt`, before `clearPromptInputForRouting`, optimistic transcript insertion, and run-state mutation) and `public/app.js:35414` (`runNativeCommandMenu`). The composer is cleared inside the handler (`public/app.js:37556-37559`) without a transcript card or `/api/prompt` call.
- Exact `/summary` opens the overlay and generates only when no successful Markdown exists (`public/app.js:35580-35582`); exact `/summary refresh` forces `{ refresh: true }`.
- Browser proof: typed-commands spec asserts 0 `generate` and 0 `prompt` requests for `/summary` with an existing summary, no `.message.user` card containing `/summary`, `{ refresh: true }` for `/summary refresh` — both specs pass in Chromium (2/2, 2.6s).

### B-2 / RSSA-04 seam — sessionId and same-session branch-state reset — CONFIRMED FIXED
- Client: `normalizeSessionSummaryClientState` (`public/app.js:35418`) computes `sessionChanged` from differing non-empty sessionIds and combines it with `resetProjection` (`inherited = resetProjection || sessionChanged ? null : previous`), so title/Markdown are not inherited across sessions while ordinary `generating`/`failure` updates in the same session still inherit the prior success.
- Branch-state reset: `handleSessionSummaryEvent` (`public/app.js:35584`) passes `resetProjection: event?.kind === "state"`; FW1 publishes `kind: "state"` on `session_tree` (`session-summary.ts:341`) and `session_start`, and the server `applySessionSummaryRpcDetails` (`bin/pi-webui.mjs:9395-9405`) explicitly resets title/Markdown for `state` events and nulls `previous` on sessionId mismatch (`bin/pi-webui.mjs:9384-9386`).
- Browser proof: the second Chromium spec drives a generate response carrying `sessionId: "session-b"` and asserts the overlay no longer shows session A's Markdown and renders the empty-state copy.

### B-3 / RSSA-05 seam — terminal dispatch failure broadcast/replay — CONFIRMED FIXED
- `triggerSessionSummary` (`bin/pi-webui.mjs:2894-2933`) wraps the RPC prompt dispatch: on rejection or `success === false` it spreads the existing `tab.sessionSummary` (preserving prior successful title/Markdown), sets `status: "failure"` with a single-line message bounded to `SESSION_SUMMARY_FAILURE_MAX_CHARS` (512), updates the timestamp, broadcasts `webui_session_summary` with `kind: "failure"`, then rethrows.
- Replay: SSE connections replay the current tab-scoped projection including the failure state (`bin/pi-webui.mjs:15089-15099`), so reconnecting clients no longer see a stuck `generating`.
- Static contract proof: `tests/native-parity.test.mjs:166` asserts the 105 s timeout, failure status, failure broadcast, and rethrow sequence. (Dynamic RPC rejection remains fixture-limited; see residual risks.)

### B-4 — bounded server/client timeout — CONFIRMED FIXED
- Server: `SESSION_SUMMARY_GENERATE_TIMEOUT_MS = 105 * 1000` (`bin/pi-webui.mjs:210`) is passed as the dedicated RPC timeout for the summary prompt dispatch (`bin/pi-webui.mjs:2912`), replacing the generic 2-hour prompt timeout.
- Client: `SESSION_SUMMARY_REQUEST_TIMEOUT_MS = 110 * 1000` (`public/app.js:2830`) with `globalThis.AbortSignal?.timeout?.(...)` forwarded through the existing `api()` signal option (`public/app.js:35543`), leaving a 5 s margin for the server's terminal failure response. Optional chaining keeps older runtimes functional (unbounded fallback, documented behavior).

### B-5 — focused regression coverage — CONFIRMED FIXED
- `tests/browser/session-summary.spec.mjs` (271 lines, 2 specs) covers: typed `/summary` opens overlay with no `/api/prompt`, no transcript card, and no generation when a summary exists; `/summary refresh` sends `{ refresh: true }`; dispatch failure (HTTP 503) preserves and renders the previous successful Markdown; a different incoming session ID clears old title/Markdown; Escape closes and restores composer focus; switching to a newly created tab closes the overlay.
- `tests/mobile-static.test.mjs:110-127` and `tests/native-parity.test.mjs:154-166` assert exact command matching, catalogue gating, `resetProjection || sessionChanged` projection clearing coexisting with failure preservation, the 105 s server timeout, terminal failure broadcast/rethrow, and SSE replay ordering.

## Commands run and outcomes (read-only)

| Command | Exit | Outcome |
|---|---:|---|
| `git status --porcelain` / `git rev-parse HEAD` | 0 | Dirty tree matches FW2 handoff declaration; HEAD `9c3cf72…`; no unexpected files. |
| `node --check public/app.js && node --check bin/pi-webui.mjs` | 0 | SYNTAX-OK. |
| `node tests/mobile-static.test.mjs && node tests/native-parity.test.mjs && node tests/native-parity-harness.test.mjs` | 0 | All three passed. |
| `node tests/http-endpoints-harness.test.mjs` | 0 | Passed (auth, CSRF/body, persistence, command gating, SSE summary coverage). |
| `npx playwright test tests/browser/session-summary.spec.mjs --project=chromium` | 0 | 2/2 passed in 2.6s (first-click flow + typed/reset/failure/focus/tab-switch flow). |
| `git diff --cached --name-only` | 0 | Empty; no staged files. |
| Targeted `grep`/`sed` inspections of `bin/pi-webui.mjs`, `public/app.js`, `session-summary.ts`, and the three test files | 0 | All fix seams located and read in full (line numbers cited above). |
| `npm test` / `npm run check` (full 111-file suite) | not-run | Parent-attested final runs plus this review's focused re-runs cover the touched surface; full suite was not re-run to keep the review focused and read-only-fast. |

## Findings

No regressions or blockers found. All five accepted findings (B-1..B-5) and both RSSA-04/05 WebUI seams are confirmed fixed in live code, with matching browser/static/HTTP evidence that passes independently in this review.

## Residual risks (carried forward, not new)

- Server RPC rejection is asserted via source contract (`tests/native-parity.test.mjs:166`) rather than a dynamically rejecting fake-Pi fixture; a transport-level failure was not exercised end-to-end. Low.
- No live W1 custom-event (`success`/`title`) smoke exists; the shared fake Pi fixture does not emit summary events. Static contracts, HTTP/SSE replay, and browser-mocked state provide the coverage. Low.
- WebKit not run; Chromium-only browser evidence. Low.
- Client abort uses optional chaining (`AbortSignal?.timeout?.`), so runtimes without `AbortSignal.timeout` fall back to an unbounded client wait (server remains bounded at 105 s). Very low; acceptable trade-off.
- The dirty tree intentionally mixes this feature with the unrelated optional-feature migration; both must be preserved together at integration.

## Verdict

**Confirmed fixed.** B-1..B-5 and the RSSA-04/05 WebUI seams are implemented as described in `plans/handoffs/pi-session-summary-fix-webui.md`, verified against live code with line-level citations, and all focused static/HTTP/Chromium checks re-run in this review pass. No blockers, no regressions, no staged files.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete per-fix confirmations with file paths and line numbers: B-1 (public/app.js:37536 exact-match interception, :40212/:35414 pre-routing call sites, :37541/:35563 catalogue gating), B-2/RSSA-04 (public/app.js:35418 sessionChanged+resetProjection, :35584 kind===\"state\" reset; bin/pi-webui.mjs:9384-9405 server reset; session-summary.ts:341 session_tree publication), B-3/RSSA-05 (bin/pi-webui.mjs:2914-2931 failure preservation+broadcast+rethrow, :15089-15099 SSE replay), B-4 (bin/pi-webui.mjs:210 105s server timeout; public/app.js:2830/:35543 110s client abort), B-5 (tests/browser/session-summary.spec.mjs 2 specs; tests/mobile-static.test.mjs:110-127; tests/native-parity.test.mjs:154-166). No blockers or regressions found; severity column is empty because no findings remain."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node --check public/app.js && node --check bin/pi-webui.mjs",
      "result": "passed",
      "summary": "Client and server syntax passed (SYNTAX-OK)."
    },
    {
      "command": "node tests/mobile-static.test.mjs && node tests/native-parity.test.mjs && node tests/native-parity-harness.test.mjs",
      "result": "passed",
      "summary": "Mobile static, native parity, and parity-harness suites passed including all new /summary fix assertions."
    },
    {
      "command": "node tests/http-endpoints-harness.test.mjs",
      "result": "passed",
      "summary": "Auth, CSRF/body, persistence, command-gating, and SSE summary endpoint coverage passed."
    },
    {
      "command": "npx playwright test tests/browser/session-summary.spec.mjs --project=chromium",
      "result": "passed",
      "summary": "2/2 passed in 2.6s: first-click setup/save/generate/sanitization and typed-command/failure-preservation/session-reset/Escape-focus/tab-switch flow."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "Empty output; no staged files."
    },
    {
      "command": "targeted grep/sed reads of bin/pi-webui.mjs, public/app.js, session-summary.ts, and fix test files",
      "result": "passed",
      "summary": "All fix seams located and read in full with line-level citations."
    },
    {
      "command": "npm test / npm run check (full 111-file suite)",
      "result": "not-run",
      "summary": "Parent-attested final runs plus this review's independent focused re-runs cover the touched surface; full suite intentionally not re-run for a focused read-only review."
    }
  ],
  "validationOutput": [
    "SYNTAX-OK for public/app.js and bin/pi-webui.mjs",
    "mobile static checks passed",
    "native-parity.test.mjs passed",
    "native-parity-harness.test.mjs passed",
    "http-endpoints-harness.test.mjs passed",
    "Playwright Chromium session-summary spec: 2 passed (2.6s)",
    "git diff --cached --name-only: empty (no staged files)"
  ],
  "residualRisks": [
    "low: server RPC rejection is source-contract asserted rather than dynamically injected (shared fake Pi fixture outside fix scope).",
    "low: no live W1 custom-event success/title fixture; coverage rests on static contracts, HTTP/SSE replay, and browser-mocked state.",
    "low: WebKit not run; Chromium-only browser evidence.",
    "very low: client AbortSignal.timeout is optional-chained, so runtimes lacking it fall back to an unbounded client wait (server stays bounded at 105s).",
    "low: dirty tree mixes this feature with unrelated optional-feature migration edits; integration must preserve both."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review-only run; zero files changed, staged, or committed. Verified the uncommitted FW2 WebUI fix delta (bin/pi-webui.mjs, public/app.js, browser/static/parity tests) against the approved plan and original UX findings B-1..B-5 plus RSSA-04/05 seams.",
  "reviewFindings": [
    "no blockers",
    "confirmed-fixed B-1: exact typed /summary and /summary refresh are natively intercepted, catalogue-gated, and produce no prompt pollution (public/app.js:37536, :40212, :35414).",
    "confirmed-fixed B-2/RSSA-04: sessionId changes and same-session branch state events reset the projection without losing prior success on generating/failure (public/app.js:35418, :35584; bin/pi-webui.mjs:9384-9405).",
    "confirmed-fixed B-3/RSSA-05: terminal dispatch failure preserves prior success, broadcasts bounded failure, and replays on reconnect (bin/pi-webui.mjs:2914-2931, :15089-15099).",
    "confirmed-fixed B-4: 105s server dispatch timeout and optional 110s client abort (bin/pi-webui.mjs:210; public/app.js:2830, :35543).",
    "confirmed-fixed B-5: browser tests cover failure preservation, focus/Escape, tab switch, typed commands, and session reset; static/parity contracts cover gating, timeouts, and failure broadcast (tests/browser/session-summary.spec.mjs; tests/mobile-static.test.mjs:110-127; tests/native-parity.test.mjs:154-166)."
  ],
  "manualNotes": "Read-only re-review; no edits, staging, commits, or subagents. All focused checks re-run independently and green. Verdict: confirmed fixed; parent may proceed to integration gates. Confidence: 93/100."
}
```
