# Independent read-only review B (Moonshot) — native Prompt/context dashboard

## Identity

- Role: Wave 4 independent reviewer B (UX usefulness, accessibility, responsive layout, maintainability, browser evidence)
- Run/model identity: Moonshot (Kimi) review subagent, read-only; no project/source files modified; only this artifact written
- Base inspected: `ce2072e` plus current unstaged working tree
- Inputs: `plans/planned/prompt-context-native-dashboard.md`, handoffs `prompt-context-payload.md`, `prompt-context-webui-core.md`, `prompt-context-tests.md`, screenshot `/tmp/pi-webui-uploads/d35f16fa-a571-445c-b943-8cf59bbdab2d/01-image.png`, actual source/diff/tests

## Review

### Correct (verified, with evidence)

- **Native hierarchy is materially more useful than the plain text it replaces.** The screenshot shows the pre-feature state: monospaced `PI prompt estimate` text block with an ASCII box table and a fixed-height scrolling `Detailed prompt snapshot` `<pre>`. The integrated `renderStatsPrompt()` (`pi-package-webui/public/app.js:24453-24466`) now renders three independently normalized native sections (calibrated initial composition with stacked bar + ranked 7-column table, estimate cards + five collapsible inventory groups, actual utilization progress + heuristic composition) with no `.stats-overlay-lines` for valid payloads. Verified live: Chromium spec `stats-overlay.spec.mjs:178` asserts zero `.stats-overlay-lines` and all three native sections; 5/5 tests passed in my rerun.
- **Actual-vs-estimated labeling is rigorous.** `renderStatsPromptCurrent` (`app.js:24414-24451`) separates `usage` (provider/context-derived: tokens/window/percent, progress bar, "provider/context usage" cards) from `breakdown` (character-derived heuristic: eyebrow "Actual utilization + heuristic composition", visible note "Source composition below is a character-derived heuristic. Shares use the estimated total, independently of actual provider utilization.", card subtitle "comparison only; not source attribution", table caption "Percentages use the estimated total, not actual usage."). This matches the plan's central invariant.
- **Visualization integrity.** Composition segments are skipped when tokens ≤ 0 or percent null (`statsPromptCompositionTrack`, `app.js:24258-24274`); widths are clamped to 100; every value is repeated in an exact semantic table with `<caption>`, `th scope="col"`, and the figcaption explicitly says numeric values are repeated below. The track has `role="img"` with a full textual aria-label. Client normalizer requires `components.tokens` sum === `totalTokens` exactly (`app.js:24133-24134`), matching the producer's largest-remainder calibration (`pi-extension-stats/index.ts:294-306`).
- **Null/zero/malformed handling.** `statsPromptMetric`/`statsPromptNullableMetric` preserve real `0`, keep explicit `null` as `n/a`, and reject non-finite/negative/numeric-string values (`app.js:24075-24096`). Browser test verifies "0 chars" badge, "0 tok used / n/a window · 0.0%" aria-valuetext, and progress value 0. Malformed subsections fall back independently (`renderStatsPrompt` dispatch; spec test at line 224 proves snapshot-only fallback).
- **Hostile/long labels.** All payload strings go through `make()`/`textContent` (`app.js:3055-3060`) — no innerHTML anywhere in the feature. Strings are client-bounded (labels 240, names 120, descriptions 360 chars). Browser test injects `System <img src=x onerror="globalThis.fixturePwned=true"> & "quoted"` plus a ~200-char repeated label and asserts no `img`/`script` nodes are created and the marker never executes; `<script>fixture-tool</script>` tool name likewise inert. Long labels wrap via `overflow-wrap: anywhere` (styles.css:11334, 11422, 11446).
- **Accessibility/keyboard.** Inventory uses native `<details>/<summary>` (keyboard-operable with no custom JS); browser test focuses a summary and opens it with Enter. Tables keep caption/scope; the mobile card layout visually hides `thead` via clip (still in the accessibility tree) and exposes `td[data-label]` pseudo-labels. Progress has `aria-label` + `aria-valuetext`; >100% usage is clamped visually but preserved in text/ARIA. Existing roving-tab arrow/Home/End behavior still passes.
- **Responsive.** 1440×900 populated render, and horizontal-overflow assertions at 390×844 and 320×568 with all details expanded, plus zero nested vertical scrollers in the prompt pane, all pass in Chromium. The 720px media block (styles.css:13456-13526) stacks inventory to one column and converts tables to labeled row cards without a nested table scroller.
- **Section fallback and raw Command outputs.** Fallback sections carry a visible "Legacy fallback" eyebrow, warning badge "Structured data unavailable", explanatory note, and only the matching legacy line block (`app.js:24249-24255`, mapping at 24461-24463). Command outputs retains raw prompt injection + detailed text (spec asserts `RAW_PROMPT_INJECTION <keep>& exact` and `RAW_PROMPT_DETAILED </pre> exact` survive verbatim).
- **Unrelated dirty hunks preserved.** The pre-existing component-update work is intact: `index.html` webuiPackageDialog/component-update hunks, `app.js` componentUpdate* symbols (line 702+), `lib/component-update-state.mjs`, trust-boundaries and parity-harness hunks are all present and untouched by this feature. `git diff --check` clean; no staged files. Producer legacy fields (`promptEstimate`, all `lines.*`, `/stats-pi`, `/stats-tokens`) retained; `session_start` stale-options reset present (`index.ts:1436-1439`).
- **Test quality.** Static test executes the real normalizers/renderers in a `vm` harness (not regex-only); browser spec uses the real server + env-gated deterministic fixture (`FAKE_PI_STATS_PROMPT_CONTEXT=1`). Reruns by this reviewer: producer 10/10, static 1/1, Chromium spec 5/5.

### Fix-now (pre-completion, parent to disposition)

1. **Raw current-context breakdown text is unreachable for valid payloads.**
   - Location: `pi-package-webui/public/app.js:24476-24488` (`renderStatsRaw`); removed line visible in diff (`-statsLineBlock(payload?.lines?.tokenBreakdown)`, formerly HEAD app.js:23547).
   - Requirement/failure mode: plan invariant "Raw text stays fully available in Command outputs" and non-goal "no user-visible regression". Before this feature the raw token-breakdown text was visible in the Prompt/context tab; now, whenever structured `currentContext` is valid (the normal case), that raw text appears nowhere — Command outputs only embeds `promptInjection` + `promptDetailed`. The fixture even emits a `RAW_CONTEXT_BREAKDOWN <raw> exact` sentinel (`tests/fixtures/fake-pi.mjs:998`) that is asserted absent from the prompt pane but is never asserted present anywhere.
   - Evidence/reproduction: open Stats → Command outputs with a valid structured payload; `/stats-tokens` raw lines are missing (only six command sections render, none with tokenBreakdown).
   - Severity: **medium** (information remains available via terminal `/stats-tokens` and via fallback on malformed data, but the approved "raw stays fully available" invariant is not met for this section).
   - Smallest remediation: add one `statsCommandOutputSection("Current context breakdown", "/stats-tokens", "…", payload?.lines?.tokenBreakdown)` to `renderStatsRaw`, plus one assertion line in the existing raw-preservation browser test.

### Notes / optional polish (non-blocking)

2. **Composition bar has no visual legend.** Segment→kind color mapping is only discoverable via hover `title` (`app.js:24268`), which is unavailable to keyboard and touch users. The aria-label and ranked table provide full equivalents, so this is conformant but weak on discoverability. Optional: add a compact legend row or make segments focusable with the title text.
3. **No custom `:focus-visible` style for inventory summaries** (styles.css:11364; compare existing `…-summary:focus-visible` rules at 1459, 6650, 7108, 12460). UA default outline applies, but a matching Catppuccin focus ring would be consistent. Polish.
4. **Fallback narrow-viewport scroller untested.** Legacy fallback reuses `.stats-overlay-lines` with `max-height: 24rem; overflow: auto` (styles.css:11058-11062) — a fixed-height nested scroller that plan criterion 8 discourages. The 390/320 no-nested-scroller browser check runs only with a fully valid payload, so fallback layout at narrow widths has no automated evidence. Acceptable (raw text must stay scrollable), but a fallback-viewport assertion would close the gap.
5. **Indeterminate progress labeling.** When `usage.percent` is null, `<progress>` gets no value (indeterminate) while `aria-valuetext` reads the full "n/a … · n/a" string (`app.js:24422-24427`). Harmless; could set `aria-valuetext` only when a value exists.
6. **Truncated/misnamed WS2 handoff.** `plans/handoffs/prompt-context-webui.md` is a 161-byte fragment ending mid-sentence ("Inspection complete. Now implementing the app.js renderers…"), while the plan names that exact file as the WS2 handoff. The real handoffs landed in `prompt-context-webui-core.md` and `prompt-context-tests.md`. Process hygiene only; suggest the parent remove the fragment or fold a pointer into it.
7. **Browser evidence breadth.** Focused spec is Chromium-only (WebKit not run, per handoff) and overflow is asserted only at 390/320, not at the 1440×900 desktop viewport used in the render test. Risk is low (desktop layout is simple grid/flex), but a desktop overflow assertion would be cheap.
8. **Maintainability is good overall.** Normalizers are strict, subsection-isolating, and mirror producer caps via named constants (`app.js:24030-24047`); initial/current share `statsPromptCompositionTrack`/`statsPromptTable`; cards reuse `statsMetricCard`. The producer keeps stable kind/id ownership and legacy lines from the same builders. ~1,050 added app.js lines is proportionate; no new dependencies, canvas, or remote assets.

### Residual uncertainties

- I verified pre-existing dirty hunks are *present* (component-update, stats-dashboard sections) but did not byte-compare every pre-feature hunk against a pristine snapshot; preservation is attested by diff shape and symbol presence, not exhaustive diff identity.
- WebKit/Firefox rendering of `<details>` marker styling, `::-moz-progress-bar`, and clipped `thead` is unverified (Chromium-only evidence).
- Real-world (non-fixture) payloads from the installed stats extension version during manual runtime were not exercised; the plan itself flags the installed-dependency skew risk.
- Producer standalone `tsc` type-check remains unrun (no compiler available); type-stripped execution and tests passed.
- The full monorepo suite was not run by me; the known unrelated `mobile-static` failure risk remains parent-owned per the plan.

Confidence: **90/100** — all load-bearing claims are verified against source and by rerunning the producer, static, and focused Chromium suites. Confidence is reduced only by the unverified non-Chromium rendering, non-exhaustive dirty-hunk identity check, and unexercised real-runtime payload path.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with file/symbol/range, severity, evidence, and minimal remediation: fix-now F1 (app.js:24476 renderStatsRaw missing raw tokenBreakdown, medium) and polish notes N2-N8 with exact locations; verified against plan, handoffs, screenshot, source, diff, and reruns of producer (10/10), static (1/1), and Chromium (5/5) suites."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node --test pi-package-webui/tests/stats-dashboard-static.test.mjs",
      "result": "passed",
      "summary": "1 test passed, 0 failed"
    },
    {
      "command": "node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs",
      "result": "passed",
      "summary": "10 tests passed, 0 failed"
    },
    {
      "command": "cd pi-package-webui && ./node_modules/.bin/playwright test tests/browser/stats-overlay.spec.mjs --project=chromium",
      "result": "passed",
      "summary": "5 tests passed (4.9s), including native sections, fallback isolation, raw retention, keyboard, and 390/320 overflow"
    },
    {
      "command": "git status --short / git diff --stat / git diff inspections",
      "result": "passed",
      "summary": "Read-only diff review; unrelated component-update and stats-dashboard hunks intact; no staged files"
    }
  ],
  "validationOutput": [
    "TAP producer: tests 10, pass 10, fail 0",
    "TAP static: tests 1, pass 1, fail 0",
    "Chromium stats-overlay.spec.mjs: 5 passed",
    "Screenshot confirmed as pre-feature legacy text state; integrated tree renders native sections per browser assertions"
  ],
  "residualRisks": [
    "WebKit/Firefox rendering unverified (Chromium-only evidence)",
    "Dirty-hunk preservation verified by diff shape and symbol presence, not byte-identity",
    "Real non-fixture runtime payload path (installed stats extension version skew) not exercised",
    "Producer standalone tsc type-check unavailable; full monorepo suite not run by reviewer"
  ],
  "noStagedFiles": true,
  "diffSummary": "Review-only; no project/source changes. Reviewed diff adds structured promptContext producer data, native Prompt/context renderers/styles, env-gated fixture, and static/browser coverage while preserving unrelated dirty hunks.",
  "reviewFindings": [
    "fix-now (medium): pi-package-webui/public/app.js:24476 renderStatsRaw - raw lines.tokenBreakdown unreachable for valid payloads; add a Command outputs section for /stats-tokens (previously visible at HEAD app.js:23547)",
    "polish: app.js:24268 - composition bar has no legend; segment colors only discoverable via hover title",
    "polish: styles.css:11364 - no custom :focus-visible style for stats-prompt inventory summaries",
    "note: styles.css:11058 - legacy fallback keeps 24rem nested scroller; fallback narrow-viewport behavior untested",
    "note: plans/handoffs/prompt-context-webui.md is a 161-byte truncated fragment; real handoffs are -webui-core.md and -tests.md",
    "note: no blockers found; native hierarchy, labeling, accessibility, responsive behavior, hostile-input handling, and dirty-hunk preservation verified"
  ],
  "manualNotes": "Read-only review; only this handoff artifact was written. Screenshot (01-image.png) depicts the pre-feature monospaced text blocks; the integrated implementation replaces them with verified native sections. One medium fix-now (raw tokenBreakdown availability) plus six non-blocking notes; dispositions remain parent-owned. Confidence 90/100."
}
```
