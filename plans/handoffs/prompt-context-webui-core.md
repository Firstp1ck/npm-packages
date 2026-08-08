# WS2A Native Prompt/context Web UI core handoff

## Identity and status

- Workstream: **WS2A native Prompt/context UI core**
- Role: implementation worker; single writer for this recovery slice
- Status: **implementation complete; ready for parent inspection and sequential WS2B test/fixture hardening**
- Feature-level status: **incomplete** until WS2B, central integration, two independent reviews, accepted-fix revalidation, final report, and archive gates complete
- Classification: **complex remains correct** because the feature spans the producer/consumer contract and has two independently necessary implementation outcomes (WS1 payload and WS2A UI core), followed by separate WS2B browser/test hardening.

### Replacement provenance

This is the authorized second/final WS2 recovery attempt. It replaces stopped WS2 run `a58575af-af8f-48c1-a2ff-567614a07bff/1` and failed revival `42252031`. Per the parent recovery record supplied to this worker, status/transcript/diff inspection confirmed that the stopped writer made no project/source edits and produced only an incomplete one-line handoff. This replacement was deliberately split into sequential non-duplicative outcomes: WS2A owns the UI core and CSS; WS2B owns tests/fixtures only.

## Changed files

Implementation changes:

- `pi-package-webui/public/app.js`
  - Replaces the Prompt/context tab's unconditional legacy text blocks with independently normalized native renderers for `promptContext.initialPrompt`, `.snapshot`, and `.currentContext`.
  - Adds strict prompt-specific number/text/object/array normalizers. Explicit `null` stays `n/a`, real numeric `0` remains valid, numeric strings/non-finite/negative metrics are rejected where invalid, strings are bounded, and arrays are capped at producer limits.
  - Adds the calibrated initial composition bar and ranked semantic table.
  - Adds actual context utilization `<progress>` and text, separately labeled heuristic current-source composition, estimate cards, and actual-minus-estimated comparison.
  - Adds five bounded native `<details>` inventory groups: metadata, active tool schemas, available-tool prompt entries, skills, and context files.
  - Adds independently labeled section-level fallback to the corresponding legacy lines only when that structured subsection is absent or malformed.
  - Leaves `renderStatsRaw()` and Command outputs unchanged, so raw prompt/detail text remains available there.
- `pi-package-webui/public/styles.css`
  - Adds Prompt/context-specific Catppuccin panels, producer-kind composition colors, cards, native details, progress, inventory, and semantic-table styling.
  - Extends the existing narrow-screen stats media block so inventory stacks and prompt tables become non-scrolling row cards at narrow widths.
  - Adds no fixed-height nested content scroller; the only new overflow is clipping inside composition/progress tracks.
- `plans/handoffs/prompt-context-webui-core.md`
  - This required operational handoff.

Not changed by WS2A:

- `pi-package-webui/public/index.html` (existing dialog semantics were sufficient; its current dirty hunk predates this workstream)
- Any test or fixture
- Any producer file
- Any plan/report/package/lock/version/component-update file or non-stats source

The shared tree was already dirty. WS2A did not reset, checkout, stage, or whole-file format any file and preserved unrelated current hunks.

## Exact UI/DOM contract for WS2B

### Root and dispatch

- Prompt tab root: `.stats-overlay-pane.stats-prompt-pane` from `renderStatsPrompt(payload)`.
- Structured root is optional `payload.promptContext`.
- Each subsection is normalized and dispatched independently; one malformed section does not force the other two to fall back.
- The existing calibration panel remains first and is outside the three subsection fallback decisions.

### Initial prompt (`promptContext.initialPrompt`)

Valid data renders:

- `section.stats-prompt-section.stats-prompt-initial`
- `.stats-prompt-section-heading` with eyebrow `Calibrated estimate`
- `figure.stats-prompt-composition`
- `.stats-prompt-composition-track[role="img"]`
- child `.stats-prompt-composition-segment[data-prompt-kind="<producer kind>"]`
- `.stats-overlay-table-wrap.stats-prompt-table-wrap`
- `table.stats-overlay-table.stats-prompt-table`
- caption text starts `Ranked initial-prompt token composition.`
- columns: Rank, Source, Kind, Chars, Uncalibrated, Tokens, Share

The normalizer requires nonnegative finite totals and component metrics, producer-defined known `kind`, bounded nonempty IDs/labels, nullable chars/percent, and exact equality between normalized component tokens and `totalTokens`. Components are capped at 24.

### Snapshot/inventory (`promptContext.snapshot`)

Valid data renders:

- `section.stats-prompt-section.stats-prompt-snapshot`
- `.stats-prompt-estimate-cards` containing Prompt text, Tool schemas, Framing, and Calibration cards
- `.stats-prompt-inventory` containing exactly five native `details.stats-prompt-inventory-details` groups:
  1. Prompt metadata
  2. Active tool schemas
  3. Available-tool prompt entries
  4. Skills
  5. Context files
- Each details summary includes `.stats-prompt-details-count` with shown/total/omitted information.
- Expanded content uses `.stats-prompt-details-body`; metadata uses `.stats-prompt-definition-list`; tool/skill cards use `.stats-prompt-card-list`; entry chips use `.stats-prompt-chip-list`; files use `.stats-prompt-file-list`.

Client caps match the producer contract: tools 12, tool prompt entries 24, skills 10, context files 8. Explicit omitted counts remain visible.

### Current context (`promptContext.currentContext`)

Valid data renders:

- `section.stats-prompt-section.stats-prompt-current`
- `.stats-prompt-utilization`
- native `progress.stats-prompt-progress[aria-label="Actual current context utilization"]`
- `.stats-prompt-utilization-text` with actual tokens, window, and percent (each independently `n/a` when null)
- `.stats-prompt-estimate-cards` with Actual usage, Context window, Heuristic estimate, and Actual − estimate
- visible disclosure: source composition is character-derived, and shares use the estimated total independently of provider utilization
- the same figure/track/segment contract as initial composition
- the same semantic table classes, with caption starting `Ranked heuristic current-context source composition.`
- columns: Rank, Source, Kind, Chars, Estimated tokens, Estimated share

Actual usage percent may exceed 100 in text; the native progress visual is clamped to its maximum while preserving the supplied numeric text/ARIA value. Estimated source rows are capped at 24.

### Legacy fallback mapping

Fallback wrapper for each invalid/missing subsection:

- `section.stats-prompt-section.stats-prompt-legacy-fallback`
- eyebrow `Legacy fallback`
- `.stats-prompt-badge.warning` text `Structured data unavailable`
- visible note `Showing the matching legacy command output for this section.`
- one `.stats-overlay-lines` produced by the pre-existing `statsLineBlock()`

Mapping:

- invalid/missing `initialPrompt` → `lines.promptInjection`
- invalid/missing `snapshot` → `lines.promptDetailed`
- invalid/missing `currentContext` → `lines.tokenBreakdown`

When all three current structured subsections are valid, the Prompt/context pane contains **zero** `.stats-overlay-lines`. The Command outputs tab continues to use raw line blocks and was not changed.

### Responsive/accessibility contract

- Composition uses native DOM with `role="img"` plus an accessible text summary and exact numeric table equivalent.
- Tables retain `<caption>`, `<th scope="col">`, and table semantics. At the existing mobile breakpoint, CSS presents each row as a labeled card via `td[data-label]` without a nested table scroller.
- Inventory uses keyboard-native `<details>/<summary>`; no custom disclosure event handling exists.
- Current utilization uses native `<progress>` with visible text, `aria-label`, and `aria-valuetext`.
- Long labels/descriptions/paths wrap; structured strings are also client-bounded before DOM creation.
- All payload strings enter through `make()`/`textContent` paths; no HTML injection, canvas, dependency, or remote asset was introduced.

## Validation evidence

Passed:

1. `node --check pi-package-webui/public/app.js` — exit 0, no output.
2. `node --test pi-package-webui/tests/stats-dashboard-static.test.mjs` — exit 0; 1 test passed, 0 failed. This was an existing dirty-tree test and was not edited by WS2A.
3. Focused source assertion script (inline Node) — exit 0; confirmed producer-aligned caps, no `statsLineBlock` in the three native renderers, independent fallback dispatch, required details/progress/table/CSS selectors, and no canvas/remote URL in the bounded feature source.
4. Focused normalizer execution script (inline Node/`vm`) — exit 0; confirmed explicit zero/null preservation, rejection of required null/non-finite/numeric-string/malformed values, independent subsection rejection, and caps of 24/12/24/10/8.
5. `git diff --check` — exit 0, no output.
6. `git diff --cached --quiet` — exit 0; no staged files.

Diagnostic/superseded validation issue:

- The first inline source-assertion command exited 1 because its helper attempted to find the `function statsCommandOutputSection` end marker inside a slice that intentionally ended immediately before that marker. This was a validation-script boundary mistake, not a source failure. The corrected assertion ran against the full app for that boundary and passed.

Omissions:

- No tests or fixtures were added/edited, by explicit WS2A boundary and sequential WS2B ownership.
- No populated structured-payload Playwright run or screenshot/interactive viewport review was performed; WS2B owns deterministic fixture/browser hardening at 1440×900, 390×844, and 320×568.
- No full Web UI/monorepo suite was run; the requested syntax, focused source/normalizer, diff, and staging checks passed.

## Deviations, risks, and integration notes

- Deviations from approved WS2A direction: none.
- `public/index.html` required no change because the existing dialog tabpanel is sufficient for generated native sections.
- The normalizers intentionally fail a whole subsection on malformed required structured data, then use only that subsection's labeled legacy fallback. Oversized arrays/strings are bounded rather than allowed to grow the DOM.
- Current attribution remains heuristic and is labeled as such in headings, cards, notes, figure accessibility text, and the table caption.
- Residual risk: responsive behavior and hostile-text rendering are source-validated but not yet browser-validated with a populated structured payload. This is the primary WS2B obligation.
- Residual risk: the app/style files contain substantial pre-existing dirty stats-dashboard and unrelated component-update hunks. Parent integration must inspect the bounded Prompt/context symbols/classes rather than treating the whole file diff as WS2A-owned.
- Confidence: **93/100**. Syntax, existing stats static coverage, dynamic normalizer checks, source assertions, whitespace, and staging state are verified. Confidence is below 100 because populated browser/viewport evidence is intentionally deferred to WS2B.

## WS2B required next work

Without changing this renderer contract unless a verified defect requires parent disposition, add deterministic fixture/static/browser coverage for:

- all three native sections and absence of Prompt/context `.stats-overlay-lines` on a valid payload;
- each of the three independent malformed/missing fallback paths and visible fallback labeling;
- explicit null versus real zero, non-finite/malformed inputs, hostile text, and oversized arrays;
- exact initial component total and current estimated-share presentation;
- native details keyboard operation and visible omitted counts;
- progress accessible name/text and actual-versus-heuristic separation;
- Command outputs retaining raw prompt/detail lines;
- page-level overflow and lack of fixed nested content scrollers at 1440×900, 390×844, and 320×568.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Implemented only the approved Prompt/context renderer, narrowly scoped normalizers, and Prompt/context/responsive stats CSS in public/app.js and public/styles.css; no tests, fixtures, producer, package, index markup, component-update, or unrelated source was edited."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Syntax, existing stats static test, corrected focused source assertions, executable zero/null/malformed/cap normalizer checks, git diff --check, and no-staged-files checks all passed; exact DOM/fallback selectors and WS2B obligations are recorded above."
    }
  ],
  "changedFiles": [
    "pi-package-webui/public/app.js",
    "pi-package-webui/public/styles.css",
    "plans/handoffs/prompt-context-webui-core.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node --check pi-package-webui/public/app.js",
      "result": "passed",
      "summary": "Exit 0; no syntax errors or output."
    },
    {
      "command": "node --test pi-package-webui/tests/stats-dashboard-static.test.mjs",
      "result": "passed",
      "summary": "Exit 0; 1 test passed, 0 failed; test file was not edited by WS2A."
    },
    {
      "command": "inline Node focused Prompt/context source assertions (corrected boundary)",
      "result": "passed",
      "summary": "Verified caps, native renderer contracts, independent fallback dispatch, no native statsLineBlock, responsive selectors, and no canvas/remote asset."
    },
    {
      "command": "inline Node/vm Prompt/context normalizer execution checks",
      "result": "passed",
      "summary": "Verified explicit zero/null preservation, malformed/non-finite/numeric-string rejection, subsection failure isolation, and 24/12/24/10/8 caps."
    },
    {
      "command": "initial inline Node focused source assertions",
      "result": "failed",
      "summary": "Diagnostic script used an impossible nested slice boundary; source was unchanged and the corrected command passed."
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "Exit 0; no whitespace errors."
    },
    {
      "command": "git diff --cached --quiet",
      "result": "passed",
      "summary": "Exit 0; no staged files."
    }
  ],
  "validationOutput": [
    "node-check-exit=0",
    "TAP: tests 1, pass 1, fail 0",
    "prompt-context-source-assertions: all assertions passed",
    "prompt-context-normalizer-check: zero/null/malformed/caps passed",
    "git-diff-check=passed",
    "no-staged-files-exit=0"
  ],
  "residualRisks": [
    "Populated structured-payload browser, hostile-text, details-keyboard, and viewport overflow coverage is intentionally deferred to sequential WS2B.",
    "Shared app/style files contain pre-existing dirty hunks outside WS2A ownership; parent must inspect bounded Prompt/context symbols/classes during integration."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds defensive structured Prompt/context normalization, native initial/current composition and utilization UI, bounded details inventory, independent legacy fallback, and responsive Catppuccin Prompt/context styling.",
  "reviewFindings": [
    "no self-identified blocker; required independent acceptance review remains parent-owned"
  ],
  "manualNotes": "No test/fixture or index markup edits were made. One diagnostic source-assertion script failed only because of its own slice boundary and was superseded by a corrected passing run."
}
```
