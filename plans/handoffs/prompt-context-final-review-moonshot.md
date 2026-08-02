# Final UX/accessibility acceptance review (Moonshot) — corrected native Prompt/context dashboard

## Identity

- Role: Wave 4 final acceptance reviewer B (UX usefulness, accessibility, responsive layout, maintainability, browser evidence) — fresh, read-only re-review of the corrected implementation.
- Run/model identity: Moonshot AI (Kimi) review subagent, read-only; no project/source files modified; only this artifact was written. No subagents launched; no dispositions decided.
- Base inspected: `ce2072e` plus current unstaged working tree.
- Inputs: `plans/planned/prompt-context-native-dashboard.md`, handoffs `prompt-context-payload.md`, `prompt-context-webui-core.md`, `prompt-context-tests.md`, prior reviews `prompt-context-review-anthropic.md` and `prompt-context-review-moonshot.md`, screenshot `/tmp/pi-webui-uploads/d35f16fa-a571-445c-b943-8cf59bbdab2d/01-image.png`, and the actual source/diff/tests. Requested root `plan.md`/`progress.md` do not exist; the canonical plan under `plans/planned/` was used instead.

## Disposition of prior findings (verified against current tree)

| Prior finding | Status | Evidence |
|---|---|---|
| F1 (fix-now, medium): raw `lines.tokenBreakdown` unreachable for valid payloads | **Fixed** | `renderStatsRaw` now emits `statsCommandOutputSection("Current context breakdown", "/stats tokens", …, payload?.lines?.tokenBreakdown)` (`pi-package-webui/public/app.js:24489`). Browser spec asserts the sentinel in Command outputs (`tests/browser/stats-overlay.spec.mjs:222`) and its absence from the native pane (line 240). |
| N3: no `:focus-visible` style for inventory summaries | **Fixed** | `.stats-prompt-inventory-details summary:focus-visible { outline: 2px solid var(--ctp-teal); outline-offset: 2px; border-radius: 0.7rem; }` (`styles.css:11380-11384`). |
| Anthropic note 2: unbounded composition `role="img"` aria-label | **Fixed** | Track aria-label now describes at most 6 rows plus `, and N more sources` (`app.js:24260-24264`); full data remains in the semantic table immediately below. |
| N7 / Anthropic note 1: no 1440×900 overflow assertion | **Fixed** | `expectNoPromptHorizontalOverflow(page)` now runs at the 1440×900 populated render (`stats-overlay.spec.mjs:179-189`). |
| N2: composition bar has no visual legend | **Open (polish)** | Segment→kind mapping still only discoverable via hover `title` (`app.js:24268`). Full text/table equivalents exist, so this is conformant but weak on touch/keyboard discoverability. |
| N5: indeterminate progress keeps numeric-looking `aria-valuetext` | **Open (polish)** | `aria-valuetext` is set unconditionally (`app.js:24426-24427`); when `usage.percent` is null the element is indeterminate but announces "n/a … · n/a". Harmless. |
| N4: fallback narrow-viewport scroller untested | **Open (note)** | Legacy fallback reuses `.stats-overlay-lines` (`max-height: 24rem; overflow: auto`, `styles.css:11058-11062`); the 390/320 no-nested-scroller checks run only with a fully valid payload. Acceptable — raw text must stay scrollable — but unverified at narrow widths. |
| N6: truncated `prompt-context-webui.md` fragment | **Open (process hygiene)** | File is still a 161-byte mid-sentence fragment; the real handoffs live in `prompt-context-webui-core.md` and `prompt-context-tests.md`. No implementation impact. |

## Review

### Correct (verified, with evidence)

- **Native hierarchy usefulness.** The screenshot shows the pre-feature state (monospaced estimate block, ASCII box table, fixed-height scrolling `<pre>` snapshot). The integrated `renderStatsPrompt()` (`app.js:24454-24468`) renders a calibration panel plus three independently normalized native sections — stacked/ranked initial composition, estimate cards + five collapsible inventory groups, actual utilization progress + heuristic composition — with zero `.stats-overlay-lines` for valid payloads (browser-verified, spec lines 178-189).
- **Actual-vs-estimated clarity.** `renderStatsPromptCurrent` (`app.js:24416-24452`) separates provider/context `usage` (tokens/window/percent, `<progress>`, "provider/context usage"/"provider/context limit" cards) from the character-derived heuristic `breakdown` ("character-derived heuristic … independently of actual provider utilization" note, "comparison only; not source attribution" card, "Percentages use the estimated total, not actual usage" caption). Matches the plan's central invariant.
- **Table/progress/details semantics.** Semantic tables keep `<caption>`, `th scope="col"`, `td[data-label]` (`statsPromptTable`, `app.js:24277-24300`); native `<progress>` has `aria-label` + `aria-valuetext` with a visible text twin; inventory is keyboard-native `<details>/<summary>` with shown/total/omitted counts. Composition tracks use `role="img"` + bounded aria-label + figcaption pointing to the numeric table; segments with tokens ≤ 0 or null percent are skipped and widths clamped to 100 (`app.js:24258-24274`).
- **Responsiveness.** Browser spec passes at 1440×900, 390×844, and 320×568 with all details expanded: no page/dialog/pane horizontal overflow (spec lines 189, 243-251) and no fixed nested vertical scrollers in the prompt pane. The 720px media block stacks inventory and converts tables to labeled row cards with `overflow: visible` (`styles.css:13456-13530`).
- **Hostile labels.** All payload strings flow through `make()`/`textContent`; browser test proves `<img onerror>`/`<script>` fixture labels render as literal text with zero `img`/`script` nodes and no executed marker (spec lines 190-194, 215-216). Long labels wrap via `overflow-wrap: anywhere`.
- **Independent fallback.** Each malformed subsection falls back alone with a visible "Legacy fallback" eyebrow, "Structured data unavailable" badge, and only its matching legacy lines (`app.js:24249-24255`, dispatch 24463-24467); browser spec proves snapshot-only fallback leaves initial/current native (spec lines 226-241).
- **Raw Command outputs, including token breakdown.** All three raw sentinels (`RAW_PROMPT_INJECTION`, `RAW_PROMPT_DETAILED`, `RAW_CONTEXT_BREAKDOWN`) are asserted present in Command outputs and absent from the native pane (spec lines 219-223, 240). F1 is fully closed with test evidence.
- **Latest focus/font/aria-label fixes.** Focus and aria-label fixes verified above. Current font presentation is legible and bounded (section notes 0.76rem, card values 1.12rem, summary 0.8rem/800, `line-height: 1.4`; `styles.css:11279-11284, 11348-11350, 11364-11376`) with no fixed-width or clipping defects observable in source or the passing viewport tests; I could not isolate a discrete post-review font hunk from the diff, but no font-related defect remains observable.
- **Test evidence (rerun by this reviewer).** Producer `stats-payload.test.mjs` 10/10; static `stats-dashboard-static.test.mjs` 1/1 (executes real normalizers/renderers in a `vm` harness, including the `tokenBreakdown` fixture line at 176); Chromium `stats-overlay.spec.mjs` 5/5 (4.9s); previously flagged unrelated `mobile-static.test.mjs` now passes 1/1. `git diff --check` clean; `git diff --cached --quiet` exit 0.
- **Maintainability.** Strict subsection-isolating normalizers mirror producer caps via named constants; initial/current share `statsPromptCompositionTrack`/`statsPromptTable`; no new dependencies, canvas, or remote assets. ~1,050 added app.js lines is proportionate to the contract.
- **Preservation of unrelated dirty hunks.** Component-update work intact: `lib/component-update-state.mjs` + test present, 37 `componentUpdate*` references in `app.js`, `webuiPackageDialog` hunks in `index.html` (lines 611, 1120). The only other `index.html` change is an a11y improvement (`role="tabpanel" tabindex="0"` on `#statsOverlayBody`). No staged files; whitespace clean.

### Blocker

- **None found.** All plan success criteria and the prior review's only fix-now item are resolved with test evidence.

### Note (polish / follow-up; none block acceptance)

1. Composition bar legend (N2 above) — optional discoverability improvement.
2. Indeterminate-progress `aria-valuetext` (N5 above) — optional cleanup.
3. Fallback narrow-viewport scroll behavior (N4 above) — optional test addition.
4. Truncated `prompt-context-webui.md` fragment (N6 above) — parent may remove or replace with a pointer.
5. WebKit/Firefox rendering unverified (Chromium-only evidence, per handoffs); real non-fixture runtime payload path (installed stats extension version skew) not exercised — both already flagged by the plan.

## Completion criteria verdict

**Met.** Success criteria 1-9 are implemented and verified: native sections replace all three text blocks; calibrated composition sums exactly with an exact semantic table; actual utilization and heuristic composition are separate and clearly labeled; bounded collapsible inventory; payload v1 with legacy fields/lines intact; independent labeled fallbacks; bounded privacy-conscious data; no fake zeroes/NaN/unbounded growth; no overflow or nested content scrollers at 1440/390/320; producer, static, syntax, focused browser, and the previously unrelated mobile-static checks all pass. Remaining items are polish/notes only, with dispositions parent-owned.

Confidence: **93/100** — every load-bearing claim was verified against source and by rerunning the producer (10/10), static (1/1), Chromium (5/5), and mobile-static (1/1) suites. Below 100 only because WebKit/Firefox rendering, byte-identity of every pre-existing dirty hunk, and the real-producer manual runtime path remain unexercised.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with file paths, ranges, severity, and evidence: verified-fixed F1 (app.js:24489 raw tokenBreakdown in Command outputs + spec:222 assertion), focus fix (styles.css:11380), aria-label bound (app.js:24260-24264), 1440 overflow check (spec:179-189); residual polish notes with exact locations (app.js:24268 legend, app.js:24426 aria-valuetext, styles.css:11058 fallback scroller, prompt-context-webui.md fragment). No blockers."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs",
      "result": "passed",
      "summary": "10 tests passed, 0 failed"
    },
    {
      "command": "node --test pi-package-webui/tests/stats-dashboard-static.test.mjs",
      "result": "passed",
      "summary": "1 test passed, 0 failed"
    },
    {
      "command": "cd pi-package-webui && ./node_modules/.bin/playwright test tests/browser/stats-overlay.spec.mjs --project=chromium",
      "result": "passed",
      "summary": "5 tests passed (4.9s), including native sections, raw tokenBreakdown retention, fallback isolation, keyboard, and 1440/390/320 overflow"
    },
    {
      "command": "node --test pi-package-webui/tests/mobile-static.test.mjs",
      "result": "passed",
      "summary": "1 test passed, 0 failed; previously flagged unrelated failure no longer reproduces"
    },
    {
      "command": "git diff --check && git diff --cached --quiet && git status/diff inspections",
      "result": "passed",
      "summary": "Whitespace clean; no staged files; unrelated component-update and stats-dashboard hunks intact"
    }
  ],
  "validationOutput": [
    "TAP producer: tests 10, pass 10, fail 0",
    "TAP static: tests 1, pass 1, fail 0",
    "Chromium stats-overlay.spec.mjs: 5 passed (4.9s)",
    "TAP mobile-static: pass 1, fail 0",
    "git-diff-check clean; no staged files"
  ],
  "residualRisks": [
    "WebKit/Firefox rendering unverified (Chromium-only evidence)",
    "Dirty-hunk preservation verified by diff shape and symbol presence, not byte-identity",
    "Real non-fixture runtime payload path (installed stats extension version skew) not exercised",
    "Optional polish: no composition-bar legend; indeterminate progress keeps n/a aria-valuetext; fallback narrow-viewport scroll untested; truncated prompt-context-webui.md fragment remains"
  ],
  "noStagedFiles": true,
  "diffSummary": "Review-only; no project/source changes. Reviewed the corrected integrated diff: raw tokenBreakdown restored to Command outputs, focus-visible and bounded aria-label fixes, 1440 overflow coverage, native Prompt/context sections, and preserved unrelated dirty hunks.",
  "reviewFindings": [
    "no blockers; completion criteria met",
    "verified-fixed: app.js:24489 renderStatsRaw - raw lines.tokenBreakdown now in Command outputs with browser assertion (spec:222)",
    "verified-fixed: styles.css:11380 - :focus-visible outline for inventory summaries",
    "verified-fixed: app.js:24260-24264 - composition role=img aria-label bounded to 6 rows plus remainder count",
    "verified-fixed: stats-overlay.spec.mjs:179-189 - 1440x900 horizontal-overflow assertion added",
    "polish: app.js:24268 - composition bar has no legend; segment colors only via hover title",
    "polish: app.js:24426-24427 - indeterminate progress keeps n/a aria-valuetext",
    "note: styles.css:11058 - legacy fallback keeps 24rem nested scroller; fallback narrow-viewport behavior untested",
    "note: plans/handoffs/prompt-context-webui.md remains a 161-byte truncated fragment"
  ],
  "manualNotes": "Read-only final review; only this artifact was written. Screenshot confirmed as the pre-feature legacy text state. Requested root plan.md/progress.md do not exist; canonical plan under plans/planned/ was used. Prior fix-now F1 and the focus/aria-label/desktop-overflow items are all resolved with test evidence; remaining items are polish only. Dispositions remain parent-owned. Confidence 93/100."
}
```
