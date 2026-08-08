# Independent review B — stats dashboard visualizations

## Identity and scope

- Role/run: **Reviewer B (Moonshot, Kimi)** — read-only review subagent of parent session `019fc3d6` (Wave 4).
- Base/result revision: `ce2072e2948a0b2d9a946bb416904f411d8aa411` (working-tree integration; no commit).
- Inputs inspected: actual `git diff` of all 10 modified tracked files plus untracked new files; `plans/planned/stats-dashboard-visualizations.md`; WS1 handoffs (`stats-dashboard-payload.md` blocked attempt + `stats-dashboard-payload-attempt-2.md` successful retry); WS2 handoff (`stats-dashboard-webui.md`); supplied screenshot `01-image.png` (old Cost & cache view: 4 KPI cards incl. "CACHE HIT 92.3%" + two raw `<pre>` blocks).
- Focus per assignment: visual hierarchy/usefulness vs screenshot, accessibility semantics/keyboard/text alternatives, desktop/mobile responsiveness, DOM/CSS maintainability, visualization integrity, regression-test adequacy, unrelated-hunk preservation.
- No project/source files were modified. One temporary Playwright spec was created under `tests/browser/`, executed, and deleted in the same command (focus-behavior evidence); the tree is unchanged.
- Confidence: **88/100**. Everything below is verified from source/diff or empirical runs; below 100 because populated-payload runtime rendering and the 1440px visual pass could not be exercised (fixture limitation), and disposition decisions belong to the parent.

## Review

### Correct (verified, with evidence)

- **Payload formulas match the approved plan** (`pi-extension-stats/index.ts:586-607, 816-855, 1186-1260`): `nullableRatio` returns `null` on zero/non-finite denominators; cached-input share uses the prompt-side denominator `input + cacheRead + cacheWrite`; effective $/1M is `cost / total * 1_000_000`; spend comparison uses equal recent/prior windows with disclosed `windowDays`; `all` scope spans the inclusive first→last UTC day range (`buildInclusiveDayRange`). Producer test proves zero-denominator → `null` and no `NaN`/`Infinity` in serialization (4/4 pass).
- **Backward compatibility**: `WEBUI_STATS_PAYLOAD_VERSION` stays 1; all legacy fields (`sessionCount`, `summary.cacheHitRate`, `nonCacheTokens`, `calendarAvgCost`, etc.) are preserved additively (diff of `index.ts:1233-1260`). UI distinguishes absent (legacy → client-side recompute) from present-but-null (→ `n/a`) via `statsSummaryHas` (`app.js:23549-23551`).
- **Visualization integrity**: token and cost lanes use independent scales with a visible "token and cost bars use independent scales" legend note (`app.js:23765-23770`); every bar/segment dimension is clamped to 0–100% (`app.js:23755-23756, 23809, 23841, 23863`); 31-point cap with disclosure (`STATS_CHART_POINT_LIMIT`, `statsChartWindowNote`); zero/empty ranges short-circuit to empty-state text.
- **Accurate cache language**: no user-facing "Cache hit"/"estimated savings" remains; terminal lines now read "Cached-input share: … · prompt-side …" (`index.ts:972-985`); raw-tab description reworded (`app.js:24082`); README documents the token-share semantics and explicitly disclaims request-level hits/savings.
- **Accessibility structure**: stable tab ids, `aria-selected`, roving `tabIndex`, `aria-controls="statsOverlayBody"`, tabpanel `role`/`tabindex="0"` in markup, `aria-labelledby` synced on activation; arrow/Home/End navigation with wrap-around and focus follow — all verified live in chromium (3/3 pass). Tables gained `<caption>` and `th.scope = "col"` (`app.js:23701-23712`). Charts carry `role="img"` + aria-label summaries plus visible captions; dual-lane bars are `aria-hidden` with values in row text — nothing depends on color alone.
- **Responsive**: no page-level horizontal overflow at 390×844 and 320×568 verified live; narrow-screen rules stack driver sections, wrap driver bars full-width, shrink the spend chart (`styles.css:13170-13175`); tablist scrolls horizontally (`styles.css:10839-10845`).
- **Visual hierarchy vs screenshot**: the old Cost & cache tab (4 cards + 2 monospace `<pre>` blocks) is replaced by 6 KPI cards (Avg/day, Active avg, Effective $/1M, Cached-input share, Avg cost/session, Recent spend) + daily spend chart + token/cache composition + ranked model/session drivers — a clear improvement in scannability and actionability, faithful to the Catppuccin palette, no new dependencies/canvas/remote assets.
- **Unrelated component-update work preserved and out of scope**: marker counts in the integrated diff — `app.js` 66, `index.html` 12, `styles.css` 23 component-update matches; `bin/pi-webui.mjs` +107 lines with `/api/component-update` route; `lib/component-update-state.mjs` present; `trust-boundaries.mjs` localhost route; `mobile-static`/`native-parity-harness` test hunks all belong to that feature and are intact. Stats hunks are confined to the stats-overlay section of `app.js`, stats rules + the existing responsive stats block in `styles.css`, and the stats dialog div in `index.html`.
- **Write boundaries respected**: WS1 touched only `pi-extension-stats/**`; WS2 touched only the stats sections of the three Web UI public files plus two new test files.

### Fixed

- None (read-only review; no edits applied).

### Blocker

- None found.

### Fix-now (recommended before sign-off; non-blocking)

1. **Keyboard focus is lost when a stats tab is activated with Space/Enter.**
   - Location: `pi-package-webui/public/app.js:24133` (`button.addEventListener("click", () => activateStatsOverlayTab(tab.id));`) together with `activateStatsOverlayTab` (`app.js:24101-24106`), which re-renders the tablist via `renderStatsOverlay()` → `elements.statsOverlayTabs.replaceChildren()`.
   - Violated requirement/failure mode: plan success criterion 6 / acceptance "tabs have stable relationships and keyboard navigation"; WCAG 2.1 focus management (2.4.3). Arrow-key navigation works because it passes `{ focus: true }`, but Space/Enter on a focused tab fires `click`, the focused button is destroyed by `replaceChildren()`, and focus falls back to `<body>`.
   - Evidence/reproduction: empirical Playwright run (temporary spec, since removed): focus tab 1 → ArrowRight (focus on tab 2, verified) → Enter → `document.activeElement` = `BODY` while `aria-selected` moved to `statsOverlayTab-daily`. Output: `AFTER_ENTER {"tag":"BODY","id":"","selected":"statsOverlayTab-daily"}`.
   - Severity: **moderate** (keyboard-only users lose their place; recoverable by tabbing back, and arrow keys — the primary tablist interaction — are unaffected).
   - Smallest useful remediation: in the click handler, forward whether the activation was keyboard-originated, e.g. `button.addEventListener("click", (event) => activateStatsOverlayTab(tab.id, { focus: event.detail === 0 }));` (`event.detail === 0` is true for keyboard-activated clicks), or unconditionally focus the active tab after click activation.

### Note (observations, risks, optional polish)

2. **Spend-chart per-day values are hover-only.** `app.js:23812` puts each day's value solely in `col.title` on a non-focusable `<span>`; the chart's `role="img"` aria-label and visible caption carry only total/peak. The Cost & cache tab contains no daily table, so keyboard/touch/screen-reader users cannot enumerate per-day spend there (the Daily tab's table does have every value). The plan's "accessible summaries" criterion is technically met; adding a visually-hidden per-day list or focusable columns with aria-labels would close the gap. Severity: low; optional polish.
3. **Truncation note references a table that does not exist in Overview.** `statsChartWindowNote` (`app.js:23733-23736`) says "the full table lists every recorded entry", but `renderStatsBarRows` is also used by the Overview view (`app.js:~23917`), which has no table. In the Daily view the wording is accurate. Smallest fix: reword to "the Daily tab lists every recorded entry" or parameterize the note. Severity: low.
4. **Asymmetric minimum-width clamping.** Token lane clamps to a 1.5% minimum (`app.js:23755`), so a zero-token day with nonzero cost still renders a visible token sliver; the cost lane clamps to 0 minimum (`app.js:23756`), so tiny nonzero costs are invisible. Bars are `aria-hidden` and row text carries exact values, so this is cosmetic; aligning the two lanes' minimums (e.g. `value > 0 ? 1.5 : 0` for both) would be tidier. Severity: low.
5. **Populated-payload rendering is verified only statically.** The browser spec runs against the empty-payload state (fixture does not advertise a stats command; `app.js` is an ES module). Chart clamping/caps/fallbacks are covered by `stats-dashboard-static.test.mjs` source assertions and the producer test covers payload shape, but no runtime DOM render of populated charts, and no narrow-viewport overflow check with populated driver rows (long session names, `$1,234.56 · 100.0%` values) exists. Residual risk of a populated-state layout/overflow surprise is low (driver rows use `minmax` + ellipsis + nowrap value columns inside an `overflow: auto` body) but unverified. Severity: low; candidate follow-up test.
6. **Pre-existing suite red from unrelated work.** `node tests/mobile-static.test.mjs` exits 1 on `interface font declarations should not fall below the 0.75rem floor` (`.topbar` rule) — owned by the in-progress component-update work, not WS2 (WS2's handoff documented this and the test passes at baseline HEAD). Not attributable to this feature, but `npm test` is currently red in the dirty tree; parent should confirm it clears when the component-update work lands. Severity: out-of-scope informational.
7. **1440×900 "balanced layout" verified statically only.** Dialog is `min(92rem, 100vw-1.5rem)` (`styles.css:10768-10769`); KPI cards use `auto-fit minmax(11-12.5rem, 1fr)` and drivers `auto-fit minmax(17rem, 1fr)`, so a balanced multi-column layout at 1440px follows from the CSS, but no screenshot/visual pass was performed (also flagged by WS2). Severity: low.
8. **Single shared tabpanel for 7 tabs.** All tabs point `aria-controls` at the one `statsOverlayBody` panel with `aria-labelledby` re-synced on activation. This is a workable single-panel switcher and is browser-verified, but it is not the canonical one-panel-per-tab APG pattern; future per-tab panels would need id/controls rework. Severity: informational.
9. **Producer semantics choices to keep visible** (documented in WS1 attempt-2 handoff, verified in source): `all`-scope spend comparison anchors to the last *recorded* day, not today; `scopedSessionCount` (unique files with records in range) deliberately differs from legacy `sessionCount` (all workspace files) — the UI labels these "sessions in range" vs "session files" correctly (`app.js:23899-23900, 24116-24119`). No action; flagged so the parent consciously accepts the semantics.

## Commands run (all read-only)

| Command | Result |
|---|---|
| `git status --short`, `git diff --stat`, focused `git diff` of all 10 modified files | passed — diff inspected in full |
| `node --check pi-package-webui/public/app.js` | passed (`APP_OK`) |
| `node --check pi-extension-stats/index.ts` | passed |
| `node pi-package-webui/tests/stats-dashboard-static.test.mjs` | passed — "all assertions passed" |
| `node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs` | passed — 4/4 |
| `npx playwright test stats-overlay --project=chromium` (in `pi-package-webui`) | passed — 3/3 (tab semantics, keyboard nav, 390/320 overflow) |
| Temporary focus-behavior Playwright spec (created, run, deleted) | passed — evidenced focus loss to `BODY` on Enter activation (finding 1) |
| `node tests/mobile-static.test.mjs` | failed — pre-existing unrelated `.topbar` font-floor assertion (note 6) |
| Component-update marker greps across `app.js`/`index.html`/`styles.css`/`bin` diffs | passed — unrelated hunks intact (66/12/23 matches; +107 bin lines) |

## Residual uncertainties

- Populated-payload runtime rendering (chart DOM, narrow-viewport overflow with real driver data) is statically but not empirically verified (note 5).
- The 1440×900 visual balance is inferred from CSS, not a rendered screenshot (note 7).
- Full `npm test` / `tests/run-all.mjs` was not run end-to-end by this reviewer; focused suites above were run directly, and the one known failure is pre-existing and unrelated (note 6).
- I did not evaluate the unrelated component-update implementation itself; I only verified its hunks are preserved.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with file paths, line numbers, evidence, severity, and minimal remediations: fix-now finding 1 (app.js:24133 keyboard focus loss, empirically reproduced) and notes 2-9 with exact locations (app.js:23812, 23733-23736, 23755-23756; styles.css:10768-10769, 13170-13175; mobile-static.test.mjs pre-existing failure). Verified-correct items cite evidence across index.ts, app.js, styles.css, index.html, and the three test files."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git diff / git status inspection of all 10 modified tracked files plus untracked additions",
      "result": "passed",
      "summary": "Full integrated diff inspected; stats hunks confined to approved boundaries; unrelated component-update hunks intact (66/12/23 marker matches in app.js/index.html/styles.css; +107 lines in bin/pi-webui.mjs)."
    },
    {
      "command": "node --check pi-package-webui/public/app.js && node --check pi-extension-stats/index.ts",
      "result": "passed",
      "summary": "Both files pass syntax checks."
    },
    {
      "command": "node pi-package-webui/tests/stats-dashboard-static.test.mjs",
      "result": "passed",
      "summary": "All static dashboard assertions passed."
    },
    {
      "command": "node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs",
      "result": "passed",
      "summary": "4/4 producer payload tests passed, including zero-denominator null safety."
    },
    {
      "command": "npx playwright test stats-overlay --project=chromium",
      "result": "passed",
      "summary": "3/3: tab/tabpanel semantics, arrow/Home/End keyboard navigation, no page-level horizontal overflow at 390x844 and 320x568."
    },
    {
      "command": "temporary Playwright focus-behavior spec (created, executed, deleted)",
      "result": "passed",
      "summary": "Reproduced finding 1: after Enter activation of a stats tab, document.activeElement is BODY (focus lost) while aria-selected moved correctly."
    },
    {
      "command": "node tests/mobile-static.test.mjs",
      "result": "failed",
      "summary": "Pre-existing failure on unrelated .topbar font-floor assertion owned by in-progress component-update work; passes at baseline HEAD per WS2; not attributable to this feature."
    }
  ],
  "validationOutput": [
    "stats-dashboard-static: all assertions passed",
    "producer payload tests: 4 passed, 0 failed",
    "Playwright stats-overlay: 3 passed (2.8s)",
    "Focus evidence: AFTER_ENTER {\"tag\":\"BODY\",\"id\":\"\",\"selected\":\"statsOverlayTab-daily\"}",
    "mobile-static: exit 1 on .topbar 0.75rem font-floor assertion (pre-existing, unrelated)",
    "Component-update markers in diffs: app.js 66, index.html 12, styles.css 23; lib/component-update-state.mjs present"
  ],
  "residualRisks": [
    "Populated-payload chart rendering and narrow-viewport overflow with real data are statically verified only; no runtime DOM evidence (fixture does not advertise a stats command).",
    "1440x900 balanced-layout quality is inferred from CSS, not a rendered screenshot pass.",
    "Full npm test was not run end-to-end; the one known suite failure (mobile-static .topbar) is pre-existing and owned by unrelated in-progress work.",
    "Keyboard Space/Enter tab activation drops focus to <body> until finding 1 is remediated."
  ],
  "noStagedFiles": true,
  "diffSummary": "Read-only review; no changes made. Reviewed diff: additive v1 stats payload analytics (index.ts +131/-18, README, new 150-line producer test) and stats-overlay-only Web UI dashboard rewrite (app.js, styles.css, index.html stats sections; new static test and chromium spec), with unrelated component-update hunks preserved intact.",
  "reviewFindings": [
    "no blockers",
    "fix-now: pi-package-webui/public/app.js:24133 - keyboard Space/Enter tab activation loses focus to <body> because activateStatsOverlayTab re-renders the tablist without focus restore; empirically reproduced; pass focus flag for keyboard-originated clicks",
    "note: app.js:23812 - spend-chart per-day values are hover-only title attributes on non-focusable spans; Cost & cache tab has no daily table fallback",
    "note: app.js:23733-23736 - truncation note cites 'the full table' but Overview (which also uses renderStatsBarRows) has no table",
    "note: app.js:23755-23756 - asymmetric lane minimums: zero-token days show a 1.5% token sliver while tiny nonzero costs render invisible",
    "note: populated-payload rendering and 1440px layout are statically verified only; mobile-static.test.mjs failure is pre-existing and unrelated"
  ],
  "manualNotes": "Reviewer B (Moonshot/Kimi), read-only. Dispositions are the parent's call. The single fix-now item (focus loss on keyboard click activation) is small: forward event.detail === 0 as the focus flag in the tab click handler. Everything else is optional polish or pre-existing/unrelated state."
}
```
