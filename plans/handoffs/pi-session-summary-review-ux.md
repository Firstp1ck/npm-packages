# Independent Review B — Session Summary Feature (UX / product-contract / tests / maintainability)

## Run identity

- **Role:** Reviewer B (read-only, fresh context). No files edited, staged, or committed; no subagents spawned.
- **Scope:** `/home/firstpick/npm-packages/pi-package-webui` working tree at HEAD `9c3cf721385c8548f02b097c10b6f383f8112578` plus the uncommitted W1/W2 diff.
- **Inputs read first:** `plans/planned/pi-session-summary-extension.md`, `plans/handoffs/pi-session-summary-core-attempt-2.md`, `plans/handoffs/pi-session-summary-webui.md`, then the actual source/diff/tests/docs.
- **Distinct angle:** product-contract compliance, TUI `/summary` Markdown, browser first-click setup/save/generate/open, header/common-options/mobile access, command routing, non-blocking overlay UX, focus/keyboard/a11y, Markdown sanitization, tab scoping/switch/reconnect, setup persistence/error states, authenticated remote behavior, docs/rollback, test quality/missing user-flow coverage, maintainability.
- **Overall confidence:** 86/100. All findings are evidence-based from source and passing tests; confidence is reduced because no real provider call or live RPC custom-event fixture exists (documented W2 omission), so B-1/B-2 are validated by code-path reading plus static tests rather than a live end-to-end run.

## Commands run and outcomes (read-only)

| Command | Exit | Outcome |
|---|---:|---|
| `node --check public/app.js && node --check bin/pi-webui.mjs && node --experimental-transform-types --check session-summary.ts && node --check lib/session-summary-core.mjs && node --check lib/session-summary-preferences.mjs` | 0 | All syntax checks passed. |
| `node tests/session-summary-preferences.test.mjs && node tests/session-summary-core.test.mjs` | 0 | Passed. |
| `node tests/native-parity.test.mjs && node tests/native-parity-harness.test.mjs && node tests/mobile-static.test.mjs && node tests/custom-message-markdown-static.test.mjs && node tests/completion-signal-contract.test.mjs` | 0 | All passed. |
| `node tests/http-endpoints-harness.test.mjs` | 0 | Passed, including summary route gating, strict-shape/CSRF rejection, `0600` persistence, unknown-key projection filtering, and tab-scoped SSE replay. |
| `npx playwright test tests/browser/session-summary.spec.mjs --project=chromium` | 0 | 1/1 passed: first-click setup, no-side-effect cancel, confirmation gate, save→generate→overlay, sanitized Markdown, mobile viewport fit. |
| `git diff --cached --name-only` | 0 | Empty; no staged files. |
| `git diff --stat`, targeted `git diff`/`grep`/`sed` inspections | 0 | Diff matches both handoffs' declared file sets; `package-lock.json` now also records the two direct Pi deps (post-W1 integration touch, consistent). |

Parent evidence (full `npm test`, `npm run check`, HTTP harness, Chromium) was spot-validated, not blindly trusted: every focused suite above was re-run independently in this review and passed. I did not re-run full `npm test`/`npm run check` (111 files); the parent-attested final runs plus my focused re-runs cover the feature surface.

## Verified correct (evidence)

- **Product contract / plan compliance.** All 16 success criteria and decisions D1–D9/E1–E20 I could check statically are honored: separate extension resource (`package.json` `pi.extensions: ["./index.ts","./session-summary.ts"]`), explicit child forwarding with duplicate avoidance (`bin/pi-webui.mjs:8910`), `agent_settled`-only fire-and-forget scheduling (`session-summary.ts` + `lib/session-summary-core.mjs` scheduler with single-flight/coalesce/5-min cooldown/abort), privacy-limited serializer (user/final-assistant text + tool names only; 200k bound with omission marker), strict JSON-only parser (16 KiB summary, 44-char one-line title), branch-aware append-only state, cadence + explicit-name title protection (`shouldApplySummaryTitle` treats any name mismatch after an applied title as explicit — verified by reading the logic), context injection default-off with exactly-one ephemeral injection, and fixed 90 s timeout / no fallback / no auto-retry.
- **TUI `/summary` basic Markdown.** `registerMessageRenderer(SESSION_SUMMARY_DISPLAY_TYPE)` returns a Pi `Markdown` component (`session-summary.ts:262`); display messages are non-turn-triggering and always filtered from context. Core tests cover registration and non-blocking settled behavior.
- **Browser first-click → setup → save → generate → open.** `openSessionSummaryForTab` (public/app.js:35557) reads preferences without writing, opens the native dialog when unconfigured; save requires the second `appConfirm` disclosure, PUTs `confirmed:true`, closes the dialog, opens the overlay in loading state, and POSTs generate with `refresh:true`. The Chromium spec proves the full sequence including zero PUT/generate on cancel.
- **Header / common-options / mobile access.** `summaryHeaderButton` (index.html:212, inside the header/sidebar action row), `summaryActionButton` in the composer sheet (index.html:388), and `optionsSummarySetupButton` in Common Pi options (index.html:479) are all catalog-gated via `hasAvailableCommand` in `renderSessionSummaryControls` (app.js:35449). Left-sidebar grid updated to five equal 44 px targets (styles.css `repeat(5, ...)`), mobile overlay is a safe-area-aware bottom sheet. Static tests cover all of this and pass.
- **Command routing.** `/summary-setup` is in `NATIVE_SELECTOR_COMMANDS`, gated on `hasLoadedRpcCommand`, and routed to the browser-native dialog (app.js:37562); the common-options entry reuses `runNativeCommandMenu("/summary-setup")`. Parity JSON entries and both parity tests pass.
- **Non-blocking overlay, focus/keyboard/a11y.** `role="dialog" aria-modal="false"`, labelled/status-wired, Escape closes (with `dialog[open]` guard so it doesn't fight modal dialogs), close restores focus to the pre-open element, opening does not steal focus, controls use real buttons with aria-labels/tooltips and `aria-busy`. Asserted by static tests and the Chromium spec.
- **Markdown sanitization.** Overlay renders through the existing DOM-only renderer (`renderMarkdown` → text nodes, `safeMarkdownLinkHref` allowlist of `https?:`/`mailto:`/anchor/workspace paths, `rel="noopener noreferrer"`). The Chromium spec injects `<script>globalThis.summaryPwned = true</script>` and proves it stays inert text. Server- and client-side state both enforce version/kind/field allowlists and bounds.
- **Tab scoping / switches / reconnect.** State is per-tab server-side (`tab.sessionSummary`) and client-side (`sessionSummaryByTab`); SSE replay is scoped to the requested tab (harness-verified); tab switches close the overlay (`setActiveTabId`, app.js:9771); tab close purges cache and closes a stale overlay (app.js:12504); server resets projection on `sessionId` mismatch (`applySessionSummaryRpcDetails`, bin/pi-webui.mjs:9365).
- **Setup persistence / error states.** Private `0700`/`0600` atomic temp+rename writes, cross-process lock with stale-owner recovery, unknown-key preservation, fail-closed malformed/future versions; HTTP layer enforces JSON content-type, `sec-fetch-site` same-origin, 32 KiB body, strict shapes, registry-validated model/thinking, `confirmed:true`, and fail-closed generation before setup — all harness-verified, including that rejected saves create no file.
- **Authenticated remote behavior.** Summary routes are deliberately not in `LOCALHOST_ONLY_POST_ROUTES` (parity-harness asserts this) and sit after the global remote-auth challenge; disclosure/confirmation is required; responses are bounded allowlisted projections with `private, no-store`.
- **Docs / rollback.** README documents setup, commands, privacy/cost scope, failure behavior, context injection, remote use, `PI_SESSION_SUMMARY_CONFIG_FILE`, in-memory `--no-session` honesty, operational rollback ("turn off Generate automatically"), and endpoint reference. Matches plan §11 operational guidance.
- **Maintainability/simplicity.** W2 follows existing WebUI patterns (native settings panel, `appConfirm`, catalog gating, SSE replay). The RPC seam is a small allowlisted version-1 contract. The dirty-tree overlap with optional-feature migration was preserved (migration tests green inside the harness run).

## Findings

### B-1 — Typed `/summary` in the WebUI composer produces no visible output
- **File/symbol:** `bin/pi-webui.mjs` `consumeSessionSummaryRpcEvent` (line 9410, suppresses `SESSION_SUMMARY_DISPLAY_TYPE`) + `public/app.js` `handleSessionSummaryEvent` (line 35584, updates state only) and `NATIVE_SELECTOR_COMMANDS` (line 2830, contains `summary-setup` but not `summary`).
- **Violated requirement / failure mode:** Plan criterion 9 and E17: "`/summary` shows basic Markdown output … and opens an on-demand non-blocking Markdown overlay in WebUI"; parity JSON declares `/summary` "implemented". A user who types `/summary` (or picks it from the side-panel command list, which sends `/${name}` as a prompt — app.js:15230/35394) has the command executed in the child; the extension emits its display custom message, which the server deliberately swallows, and the resulting `success`/`state` RPC events only update hidden tab state. No overlay opens, no transcript entry appears, no event-log notice fires. From the user's perspective the command did nothing.
- **Reasoning/reproduction:** Type `/summary` in the WebUI composer of a configured tab with an existing summary. The display message is filtered at `consumeSessionSummaryRpcEvent` (returns `true`) and from `/api/messages` (`filterSessionSummaryTranscriptMessages`); no code path calls `openSessionSummaryOverlay` in response to summary RPC events. Only the header/composer buttons open the overlay.
- **Severity:** Medium. The feature's primary WebUI surface works, but a documented, catalog-listed command is a silent no-op in one of its two invocation styles — exactly the class of UX gap Reviewer B is chartered to catch.
- **Minimal remediation:** Treat an explicit `/summary` prompt as on-demand: e.g., add `summary` to the native-selector handling so it calls `openSessionSummaryForTab()` (mirroring the header button), or have the server mark manual `/summary` triggers and have `handleSessionSummaryEvent` open the overlay for the matching tab when kind is `success`/`state` following a manual trigger. Add one browser or harness test for the typed-command path.
- **Confidence:** 82/100. Code-path certainty is high; residual uncertainty is whether the parent deliberately scoped "on-demand" to button-only (the plan text and E17 suggest typed `/summary` should display).

### B-2 — Client summary state can leak across in-tab session switches
- **File/symbol:** `public/app.js` `normalizeSessionSummaryClientState` (line ~35519: `title: title || previous?.title || ""`, `summaryMarkdown: summaryMarkdown || previous?.summaryMarkdown || ""`) and `handleSessionSummaryEvent` (drops `event.kind`).
- **Violated requirement / failure mode:** Plan criterion: "Browser state diverges from session state" mitigation — "Session custom entry is canonical; browser state is tab-scoped projection refreshed from RPC/session evidence"; E9 branch-local state. After a session switch/resume inside the same tab, the server correctly resets its projection on `sessionId` mismatch and broadcasts a `state` event whose `summary` has the new `sessionId` and empty title/Markdown. The client normalizer, however, merges with the cached previous entry and *preserves* the old session's `title`/`summaryMarkdown` because the incoming strings are empty. The overlay (if reopened for that tab) and any cached state show the previous session's summary under the new session until a fresh `success` arrives.
- **Reasoning/reproduction:** Configure and generate a summary in tab T (session A). Resume/fork to session B in the same tab (no summary yet). Server emits `webui_session_summary` with `sessionId=B`, empty summary. Client cache for T still returns A's Markdown. The merge-by-previous behavior is correct for `failure` events (preserve last success) but is not gated on `sessionId` equality.
- **Severity:** Low–medium. Privacy/content-integrity impact is bounded (same user, same tab, both sessions local), but showing a stale summary under a different session contradicts the branch/session-scoping invariant.
- **Minimal remediation:** In `normalizeSessionSummaryClientState` (or at the call site), when both previous and incoming carry a `sessionId` and they differ, do not inherit `title`/`summaryMarkdown`; alternatively pass `event.kind` through `handleSessionSummaryEvent` and only preserve-previous for `failure`/`generating`. Add a static assertion that session switches clear the cached projection.
- **Confidence:** 75/100. Verified by reading the merge logic and server reset logic; not exercised by any test (no live fixture emits a session-switch state event), so the exact trigger sequence is inferred.

### B-3 — Server tab state can stick at `generating` when the RPC prompt dispatch itself fails
- **File/symbol:** `bin/pi-webui.mjs` `triggerSessionSummary` (line ~2898).
- **Violated requirement / failure mode:** Plan criterion: "Provider/auth/timeout/parse/stale failures … expose bounded actionable feedback." The function sets `tab.sessionSummary.status = "generating"` and broadcasts, then awaits `tab.rpc.send({type:"prompt", message:"/summary"})`. If the send rejects (tab died, RPC timeout — note `PROMPT_REQUEST_TIMEOUT_MS` defaults to 2 hours) or returns `success === false`, it throws `makeHttpError` *without* resetting `tab.sessionSummary` or broadcasting a failure. The HTTP caller's client-side catch marks its local state failed, but the server projection stays `generating` and is replayed as such to any reconnecting SSE client indefinitely (the extension never started, so no `failure` RPC will arrive to clear it).
- **Reasoning/reproduction:** Kill the tab's child process (or force an RPC error) after setup, then POST `/api/session-summary/generate`. Response is an error, but `GET` state / SSE replay still report `status:"generating"`.
- **Severity:** Low. Requires a transport-level failure; UI recovers on next real event or tab reload in most paths.
- **Minimal remediation:** Wrap the dispatch in try/catch; on failure set `status:"failure"` with a bounded sanitized message and `broadcastSessionSummaryState(tab, "failure")` before rethrowing.
- **Confidence:** 85/100. Direct from control-flow reading; the missing reset is unambiguous, only the likelihood is low.

### B-4 — POST `/api/session-summary/generate` can block for the full generation window with no client-side timeout
- **File/symbol:** `bin/pi-webui.mjs` route at 14777 → `triggerSessionSummary` awaits the RPC prompt (up to `PROMPT_REQUEST_TIMEOUT_MS`, default 7 200 000 ms); `public/app.js` `api()` has no default timeout.
- **Violated requirement / failure mode:** Not a hard violation — the UX is saved by the client opening the overlay in `loading` state before awaiting — but a hung child wedges the fetch and the `Save and generate` busy state far beyond the extension's own 90 s bound. The HTTP harness's fail-closed cases return fast, so this is untested.
- **Severity:** Low (resilience note).
- **Minimal remediation:** Give the generate POST a bounded client timeout (e.g., `AbortSignal.timeout(SESSION_SUMMARY_TIMEOUT_MS + margin)`) or make the server return `202`-style immediately and rely on SSE `success`/`failure` events it already broadcasts.
- **Confidence:** 80/100.

### B-5 — Missing user-flow test coverage (test-quality angle)
- **File/symbol:** `tests/browser/session-summary.spec.mjs` (single 180-line spec), `tests/http-endpoints-harness.test.mjs`.
- **Violated requirement / failure mode:** Plan §8 WebUI tests ask for tab-scoping, failure-preservation, and keyboard behavior coverage. Current browser coverage proves the happy path and sanitization only. Missing: (a) typed `/summary` routing (would have caught B-1); (b) session-switch state reset (B-2); (c) failure overlay preserving the previous summary in the browser (only a static regex asserts the preservation text); (d) Escape/focus-restore behavior; (e) tab-switch closing the overlay; (f) a live RPC `success`/`title` custom-event smoke (already documented as a W2 omission due to fixture ownership).
- **Severity:** Low (the riskiest gaps are captured as B-1/B-2 findings; the rest is defense-in-depth).
- **Minimal remediation:** Add one browser test for typed `/summary`, one for overlay failure-preservation using route-mocked `failure` SSE/state, and — if fixture ownership allows — a fake-Pi custom-event smoke for the title bridge.
- **Confidence:** 88/100.

## Angles with no finding

- TUI `/summary` Markdown rendering, command discovery, usage guard (`/summary [refresh]`): correct, tested.
- Markdown sanitization (renderer is DOM/text-only; link href allowlist; hostile-HTML browser test passes).
- Common-options/header/left-sidebar/mobile access and 44 px targets: implemented and statically asserted.
- `/summary-setup` command routing and catalog gating (browser + parity harness).
- Non-blocking overlay semantics, focus handling, Escape, aria wiring.
- Setup persistence, atomicity, permissions, unknown-key survival, error/fail-closed states.
- Authenticated remote posture (not localhost-only by approved D8; auth challenge + same-origin JSON + bounded allowlisted responses; no credentials/payloads cross the boundary — harness-proven).
- Docs and rollback guidance: README is accurate against the code I inspected.
- Maintainability: no style-only objections worth recording; the integration follows established WebUI idioms.

## Residual risks

- No real provider call and no live RPC custom-event fixture anywhere in validation (documented by both workers); title-bridge and success-event handling rest on static contracts plus mocked HTTP/browser paths.
- B-1/B-2/B-3 are code-read findings not exercised by a failing test; reproductions are described but not executed against a live child.
- WebKit not run (Chromium-only browser evidence).
- The dirty tree intentionally mixes this feature with optional-feature migration edits; disposition of findings must keep both intact.

## Verdict (review only — no acceptance decision)

Implementation is faithful to the approved plan across product contract, privacy, persistence, remote policy, docs, and the tested UX paths; all focused suites I re-ran pass. One medium UX gap (typed `/summary` is silent in WebUI, B-1), one low–medium state-scoping leak (B-2), and three low findings (B-3 stuck `generating`, B-4 unbounded generate wait, B-5 coverage gaps) are recorded for parent disposition. No blockers found.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Five concrete findings with file paths, symbols, severities, reproductions, remediations, and confidence: B-1 (medium, bin/pi-webui.mjs consumeSessionSummaryRpcEvent + public/app.js handleSessionSummaryEvent — typed /summary silent in WebUI), B-2 (low-medium, public/app.js normalizeSessionSummaryClientState — cross-session summary leak), B-3 (low, bin/pi-webui.mjs triggerSessionSummary — stuck generating state), B-4 (low, generate POST unbounded wait), B-5 (low, tests/browser/session-summary.spec.mjs coverage gaps). Eight angles explicitly recorded as having no finding."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node --check public/app.js && node --check bin/pi-webui.mjs && node --experimental-transform-types --check session-summary.ts && node --check lib/session-summary-core.mjs && node --check lib/session-summary-preferences.mjs",
      "result": "passed",
      "summary": "All syntax checks passed."
    },
    {
      "command": "node tests/session-summary-preferences.test.mjs && node tests/session-summary-core.test.mjs",
      "result": "passed",
      "summary": "Core and preferences suites passed."
    },
    {
      "command": "node tests/native-parity.test.mjs && node tests/native-parity-harness.test.mjs && node tests/mobile-static.test.mjs && node tests/custom-message-markdown-static.test.mjs && node tests/completion-signal-contract.test.mjs",
      "result": "passed",
      "summary": "Parity, static, Markdown, and settlement contracts passed."
    },
    {
      "command": "node tests/http-endpoints-harness.test.mjs",
      "result": "passed",
      "summary": "Full HTTP/SSE harness passed including all session-summary route, persistence, projection, and replay cases."
    },
    {
      "command": "npx playwright test tests/browser/session-summary.spec.mjs --project=chromium",
      "result": "passed",
      "summary": "1/1 Chromium spec passed: first-click setup, cancel purity, confirmation gate, save-generate-open, sanitized Markdown, mobile fit."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "Empty output; no staged files."
    },
    {
      "command": "npm test / npm run check (full suite)",
      "result": "not-run",
      "summary": "Not re-run by this reviewer; parent-attested final runs plus independent re-runs of every feature-focused suite above were used instead."
    }
  ],
  "validationOutput": [
    "SYNTAX-OK for app.js, pi-webui.mjs, session-summary.ts, both core modules",
    "session-summary preferences tests passed",
    "session-summary core tests passed",
    "native-parity.test.mjs passed / native-parity-harness.test.mjs passed",
    "mobile static checks passed",
    "custom message Markdown static check passed / completion signal contract checks passed",
    "http-endpoints-harness.test.mjs passed",
    "Playwright Chromium: 1 passed (1.7s)",
    "git diff --cached --name-only: empty"
  ],
  "residualRisks": [
    "medium: typed /summary in the WebUI composer produces no visible output (B-1) pending parent disposition.",
    "low-medium: client summary projection can persist across in-tab session switches (B-2); server tab state can stick at generating on RPC dispatch failure (B-3).",
    "low: generate POST can block up to the 2h RPC timeout with no client timeout (B-4); browser coverage lacks typed-command, failure-preservation, Escape/focus, and tab-switch flows (B-5).",
    "low: no real provider call, no live RPC custom-event fixture, no WebKit run anywhere in validation (documented worker omissions).",
    "low: dirty tree mixes this feature with optional-feature migration edits; fixes must preserve both."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review-only run; zero files changed, staged, or committed. Inspected the uncommitted W1+W2 diff (session-summary extension, core/preferences modules, WebUI server/client/styles/markup, parity matrix, focused tests, README) against the approved plan.",
  "reviewFindings": [
    "medium: bin/pi-webui.mjs:9410 consumeSessionSummaryRpcEvent + public/app.js:35584 handleSessionSummaryEvent - typed /summary in the WebUI composer is suppressed from the transcript and never opens the overlay, making a documented command a silent no-op (B-1).",
    "low-medium: public/app.js normalizeSessionSummaryClientState - merge-with-previous preserves title/summaryMarkdown across sessionId changes, leaking a prior session's summary into a new session's projection (B-2).",
    "low: bin/pi-webui.mjs triggerSessionSummary - RPC dispatch failure leaves server tab state stuck at generating with no failure broadcast, replayed indefinitely to SSE clients (B-3).",
    "low: bin/pi-webui.mjs POST /api/session-summary/generate - awaits the RPC prompt with up to the 2h default timeout and no client-side timeout (B-4).",
    "low: tests/browser/session-summary.spec.mjs - no coverage for typed /summary, session-switch reset, overlay failure-preservation, Escape/focus-restore, or tab-switch close (B-5).",
    "no blockers"
  ],
  "manualNotes": "Read-only review; no edits, staging, commits, or subagents. All findings are evidence-based from source plus independently re-run focused tests (all green). Typed-/summary silence (B-1) is the finding most likely to need a product decision: if button-only on-demand display was intended, the parity matrix and E17 wording should be reconciled instead. Confidence: 86/100 overall; per-finding confidences recorded inline."
}
```
