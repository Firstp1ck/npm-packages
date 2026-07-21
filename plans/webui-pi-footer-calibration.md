# WebUI PI Footer Calibration Plan

**Status:** Complete — implemented, verified, independently reviewed, and reported  
**Feature slug:** `webui-pi-footer-calibration`  
**Owner / integration owner:** Primary Pi agent (sole writer)  
**Packages:** `pi-package-webui`, integration with `pi-extension-git-footer-status` and `pi-extension-stats`  
**Report:** [`../reports/webui-pi-footer-calibration.html`](../reports/webui-pi-footer-calibration.html)

## Objective and success criteria

Make the extension-owned **PI** token metric in Pi Web UI an explicit calibration control. Clicking it must dispatch exactly `/calibrate` to the active tab without placing command text in the composer, keep the browser responsive while the isolated calibration turn runs, and refresh the footer until the updated PI token estimate is published.

Success means:

1. Every visible PI metric from the valid `git-footer-webui` payload is rendered as an accessible button when the WebUI PI-calibration visibility capability is enabled—not only while the estimate is uncalibrated.
2. One click dispatches exactly `/calibrate` through the active tab's RPC slash-command path.
3. Duplicate clicks are suppressed while that tab's request is in flight; the control exposes `aria-busy` and does not alter composer content.
4. Active streaming/compaction remains protected: calibration is refused with non-blocking feedback rather than interrupting active work.
5. After dispatch, bounded delayed footer refreshes request fresh extension payloads so the PI token count updates when the calibration sample is recorded.
6. Focused static tests and package checks pass.
7. Two qualifying independent cross-provider reviewers have assessed the final implementation, and all findings have explicit dispositions.
8. This plan and the linked HTML report are current and validated.

## Scope and non-goals

### In scope

- WebUI footer PI click wiring and busy/tooltip feedback.
- Exact `/calibrate` command dispatch through the existing RPC command resolver.
- Bounded post-dispatch refresh scheduling.
- Explicit git-footer refresh invalidation of the short-lived calibration-record cache so the refreshed PI value is actually observable.
- Focused static regression coverage and README documentation.

### Non-goals

- Changing `/calibrate` internals in `pi-extension-stats`.
- Changing the git-footer payload schema or version.
- Adding a second calibration endpoint or background worker process.
- Changing the Stats overlay's separate **Calibrate current** / **Start probe** controls.
- Allowing calibration to interrupt active streaming or compaction.

## Approved decisions and assumptions

| Decision | Resolution | Source / rationale |
|---|---|---|
| Trigger | Clicking the PI metric always invokes calibration | User explicitly requested pressing “PI” to run `/calibrate`; restricting the action to zero-sample estimates made already-calibrated PI cards inert. |
| Command | Dispatch exactly `/calibrate`, with no `current` argument | Explicit user requirement; `/calibrate` owns its isolated probe lifecycle in `pi-extension-stats`. |
| Browser behavior | Fire through the existing async RPC prompt path; do not populate the composer or block unrelated browser interaction | Reuses the established WebUI command transport while the extension performs the isolated calibration turn. |
| Confirmation | No extra confirmation dialog | The deliberate PI button click is the user action requesting calibration; duplicate clicks are suppressed. |
| Busy tab behavior | Refuse while streaming or compacting | `/calibrate` requires an idle agent and session replacement is unsafe during active work. |
| Refresh | Request bounded delayed git-footer payload refreshes after command dispatch and clear the git-footer calibration cache on explicit refresh | Calibration output is recorded asynchronously; delayed refreshes avoid tight polling, while cache invalidation prevents the 60-second cache from hiding a newly written sample. |
| Payload compatibility | Do not change `firstpick.git-footer-status.footer` v1 | PI is identified by the existing `key: "pi"`; WebUI can attach the requested action without extending the payload contract. |

## Architecture and interaction flow

```text
User clicks PI footer metric
  -> WebUI validates active tab, idle state, and per-tab single-flight guard
  -> resolve RPC-visible `calibrate` command
  -> dispatch exactly `/calibrate` via sendPrompt(..., targetTabId)
  -> pi-extension-stats starts its isolated calibration session/turn
  -> WebUI schedules bounded delayed `/git-footer-refresh --webui-silent` requests
  -> pi-extension-git-footer-status republishes `git-footer-webui`
  -> footer rerenders with the updated PI token count
```

The PI metric remains extension-owned for its value and visibility. The browser owns only the interaction because the structured payload's `key: "pi"` is stable and already allowlisted by payload validation.

## Files and ownership

| File | Responsibility |
|---|---|
| `pi-package-webui/public/app.js` | Always attach the PI calibration click action, dispatch exact `/calibrate`, single-flight/busy feedback, delayed refreshes |
| `pi-package-webui/tests/mobile-static.test.mjs` | Focused source-level regression assertions for exact command, always-clickable PI handling, and refresh scheduling |
| `pi-package-webui/tests/pi-footer-calibration-static.test.mjs` | Focused exact-command, busy-cache, tab-switch scheduling, and calibration-cache invalidation checks |
| `pi-extension-git-footer-status/index.ts` | Make explicit `/git-footer-refresh` observe newly written calibration records instead of its 60-second cache |
| `pi-package-webui/README.md` | Document the PI footer calibration interaction |
| `plans/webui-pi-footer-calibration.md` | Canonical decisions, execution evidence, reviews, and finding dispositions |
| `reports/webui-pi-footer-calibration.html` | Final audit report |

No concurrent writer may modify these files in the same worktree. Reviewers are read-only.

## Ordered work items

| # | Work item | Dependency | Status |
|---|---|---|---|
| 1 | Inspect footer payload rendering, slash-command dispatch, `/calibrate`, tests, and Pi extension lifecycle docs | — | Complete |
| 2 | Record exact-command, idle-state, confirmation, compatibility, and refresh decisions | 1 | Complete |
| 3 | Implement always-clickable PI metric and exact `/calibrate` background dispatch | 2 | Complete |
| 4 | Update focused tests and README | 3 | Complete |
| 5 | Run focused/package checks and inspect the diff | 4 | Complete with unrelated baseline failure documented below |
| 6 | Obtain two independent cross-provider reviews and disposition every finding | 5 | Complete — Moonshot/Kimi and Google/Gemini PASS |
| 7 | Apply only verified accepted fixes and rerun affected checks | 6 | Complete |
| 8 | Create and strictly validate the linked HTML report | 7 | Complete |

## Acceptance tests

- A valid PI footer chip becomes a `<button>` even when its payload has no calibration action marker.
- The click handler resolves the RPC-visible `calibrate` command and sends exactly `/${commandName}`.
- The footer path contains no `/${commandName} current` dispatch and no probe confirmation dialog.
- The composer value and attachments are not used because the command is supplied explicitly to `sendPrompt`.
- A per-tab in-flight set prevents duplicate requests and drives `aria-busy` feedback.
- Streaming/compacting tabs do not dispatch calibration.
- Missing `/calibrate` produces a warning rather than an invalid request.
- Post-command refresh scheduling requests fresh git-footer payloads at bounded delays appropriate for an isolated probe.
- `node --check public/app.js`, the focused static test, package checks, and `git diff --check` pass or any failure is documented.
- The final report passes the HTML-report strict validator.

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `/calibrate` starts an isolated session and may take provider time/tokens | Medium | The click is explicit; show busy feedback and document the behavior. |
| The active tab changes while calibration is running | Medium | Capture the target tab context and refresh/render only when it is still current; retain tab-scoped single-flight state. |
| Calibration result is not ready at the first refresh | Medium | Use multiple bounded delayed refresh attempts rather than one immediate read or unbounded polling. |
| Older/missing stats extension exposes no command | Low | Resolve the command from RPC-visible availability and show a warning if absent. |
| Duplicate clicks trigger concurrent probes | Medium | Guard with `gitFooterPiCalibrationInFlightByTab`. |
| Existing payload action metadata conflicts with the new always-clickable rule | Low | Treat `key: "pi"` plus WebUI visibility as authoritative for the browser interaction; keep action parsing for backward compatibility. |

## Verification record

| Check | Result | Evidence |
|---|---|---|
| `node --check public/app.js` | Pass | Exit 0 on 2026-07-21. |
| `node --test tests/pi-footer-calibration-static.test.mjs` | Pass | 6/6 tests passed: always-clickable PI control, exact `/calibrate`, bounded delayed refresh, busy-state render-cache invalidation, tab-switch-safe scheduling, and calibration-cache invalidation. |
| `node --test tests/mobile-static.test.mjs` | Feature assertions passed before unrelated failure | The test reached line 1758, after the new assertions at lines 888–890, then failed because `package-lock.json` already lists `@firstpick/pi-extension-bang-command-autocomplete` under root optional dependencies while the test expects it absent. This feature does not modify `package.json` or `package-lock.json`. |
| `npm run check` | Partial / baseline failure | Syntax checks and 30/31 test files passed, including the new focused file; only `mobile-static.test.mjs` failed on the same unrelated package-lock expectation. |
| Git-footer extension tests | Pass | 15/15 passed across `stale-ctx`, `git-snapshot`, and `visibility-persistence`; Node emitted only the existing module-type warning. |
| `git diff --check` | Pass | Exit 0 after implementation and accepted fixes. |
| HTML report strict validation | Pass | `validate_report.py --strict` returned zero errors/warnings; 1,261 words, one overview table, one accessible SVG diagram, and no local/remote dependencies. |
| Parent diff inspection | Pass | Feature-owned hunks are limited to PI footer interaction/cache key, focused/static tests, git-footer explicit-refresh cache invalidation, README, plan, and report. Concurrent git-live-watcher/danger-button/package changes were not attributed to this feature. |

## Independent review record

Two qualifying final read-only reviews were obtained from distinct non-OpenAI provider families:

| Run / child | Verified model metadata | Provider family | Verdict | Artifact |
|---|---|---|---|---|
| `e81b9505-69a2-4f91-a269-2f7e6f9b7d78` / `reviewer_0` | `openrouter/moonshotai/kimi-k3:high` | Moonshot/Kimi | **PASS**, 92/100 | `.pi-subagents/artifacts/e81b9505-69a2-4f91-a269-2f7e6f9b7d78_reviewer_0_output.md` |
| `8cfe47c7-7ce3-474c-add1-14d12e3fd19a` / `reviewer` | `openrouter/google/gemini-3.1-pro-preview:high` | Google/Gemini | **PASS**, 95/100 | `.pi-subagents/artifacts/8cfe47c7-7ce3-474c-add1-14d12e3fd19a_reviewer_output.md` |

Model identity is taken from each run's `*_meta.json`, not the model's prose self-report. Earlier Anthropic attempts failed with account rate limits and direct-Google attempts failed with an invalid API key; their Kimi fallbacks were not double-counted toward the cross-provider gate.

## Finding dispositions

| Finding | Disposition | Evidence / rationale |
|---|---|---|
| Busy `aria-busy` state was skipped by the footer DOM fast path because the calibration in-flight bit was absent from `gitFooterPickerStateKey` | **Accepted and fixed** | Added `piCalibrationInFlight` to the picker state key, forcing a rebuild on enter/exit; focused test covers the key. |
| Switching tabs while `sendPrompt` resolves prevented delayed refresh scheduling | **Accepted and fixed** | Scheduling now occurs before the current-tab-only event guard; each timer still checks `isCurrentTabContext` before UI work. |
| The git-footer 60-second calibration cache could hide a newly recorded sample through all WebUI refreshes | **Accepted and fixed** | Explicit `git-footer-refresh` now clears `promptCalibrationCache` before recomputing; focused test and 15 extension tests pass. |
| Mid-probe delayed refreshes can be skipped by the normal streaming guard | **Accepted risk; proposed `allowDuringRun` change rejected** | Steering a slash command into the calibration turn is disproportionate. Three bounded attempts remain, and explicit refresh now reads fresh calibration records once idle. |
| Single-flight state ends when the dispatch request finishes rather than when the probe turn ends | **Deferred / low** | This matches the approved “request in flight” criterion; WebUI streaming guards and extension `ctx.isIdle()` prevent concurrent probes. |
| Busy control is not disabled and suppressed repeat clicks are silent | **Rejected as required fix** | Native button remains keyboard accessible; `aria-busy` and busy tooltip expose state, and duplicate dispatch is guarded. |
| “Background” wording understates that `/calibrate` creates/replaces with an isolated session | **Deferred / documented residual** | The exact bare command and no-confirmation behavior were user-approved; the extension emits “Starting isolated calibration session…”. |
| Payload calibration action metadata is now inert for the PI key | **Accepted compatibility state** | Parsing remains for v1 compatibility; stable `key: "pi"` plus visibility is the browser interaction authority. |
| `mobile-static.test.mjs` package-lock assertion failure | **Rejected as feature defect** | The failure occurs after all calibration assertions and concerns an existing optional companion dependency; this feature does not modify package manifests/lockfiles. |
| Concurrent git-live-watcher/danger-button changes | **Rejected as feature scope** | Independent reviewers verified no interference with calibration-owned paths; these files belong to another active writer. |

## Residual risks and rollout

- No live browser/provider calibration probe was run, so the user-flow evidence is source/static-test based rather than a billed external model call.
- If the user leaves the tab, timer callbacks intentionally avoid updating a non-current UI; the extension's own status publication and the next active-tab refresh provide convergence.
- `/calibrate` creates an isolated replacement session and may consume provider tokens; this is the command's existing behavior and the requested exact action.
- Reload/restart Pi Web UI so the updated `public/app.js` is served. The stats and git-footer optional companions must both be loaded for the click and refreshed PI estimate to work.
