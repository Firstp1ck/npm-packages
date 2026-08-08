# Independent review A (Anthropic) — integrated native Prompt/context dashboard

## Identity and scope

- Reviewer: independent read-only reviewer A, Anthropic/Claude (child subagent of parent session `019fc3d6`; no subagents launched, no dispositions decided).
- Mode: read-only. No project/source files were modified; this handoff artifact is the only write.
- Basis inspected directly (not worker claims): `plans/planned/prompt-context-native-dashboard.md`, `plans/handoffs/prompt-context-payload.md`, `prompt-context-webui-core.md`, `prompt-context-tests.md` (`prompt-context-webui.md` is an empty stub from the stopped first WS2 attempt), the actual working-tree diff of `pi-extension-stats/index.ts`, `pi-extension-stats/tests/stats-payload.test.mjs`, `pi-package-webui/public/app.js` (Prompt/context region ~24043–24466 plus dispatch/raw), `public/styles.css` (11224–11501, 13456–13526), `public/index.html` diff, `tests/fixtures/fake-pi.mjs`, `tests/stats-dashboard-static.test.mjs`, `tests/browser/stats-overlay.spec.mjs`, and supporting `pi-utils/src/tokens.ts` / `initial-prompt-estimate-service.ts`.
- Baseline respected: pre-existing stats-dashboard and component-update hunks (including the `index.html` `webuiPackageDialog`/component-update hunks and the `mobile-static`/`native-parity-harness` edits) were treated as out of scope; they do not interact with the Prompt/context feature paths.

## Review

### Correct (verified with evidence)

- **Additive v1 contract intact.** `WEBUI_STATS_PAYLOAD_VERSION` remains `1` (`pi-extension-stats/index.ts:72`); `promptContext` is a purely additive root field (index.ts:1607–1611); legacy `promptEstimate` (1592–1606) and all `lines.*` including `promptInjection`/`promptDetailed`/`tokenBreakdown` (1637–1650) are retained and still built by the same formatters. `/stats-pi` and `/stats-tokens` command paths reuse the same builders with unchanged user-visible text (1480–1489, 1711–1716, 1786).
- **Exact totals/formulas.** `distributeCalibratedTokens` (index.ts:213–230) is a correct largest-remainder allocator; exactness is safe because `estimate.total` is always an integer (`pi-utils/src/tokens.ts:219` `Math.max(0, Math.round(...))`). Initial composition allocates prompt-text tokens by source character weight, adds tool-schema/framing components, and calibrates so component tokens sum exactly to `totalTokens` (index.ts:232–321). Producer test asserts exact sum and ~100% share sums (`stats-payload.test.mjs` "structured prompt context has exact calibrated totals…"). Current-context shares use `estimatedTotalTokens`, never actual usage (index.ts:862–874), and `actualMinusEstimatedTokens` is separate and nullable (879–884). Verified by my own run: 10/10 producer tests pass.
- **Lifecycle state.** `session_start` now clears `latestSystemPromptOptions` alongside the pending measurement (index.ts:1436–1439), closing the confirmed stale-options hole; the "session start clears stale system prompt options" test proves structured inventory cannot reuse stale context files/skills.
- **Privacy/redaction.** Tool `parameterSummary` is counts-only (index.ts:594–601); skill `location` is extracted but never emitted (snapshot builder maps only name/description, 631–635); context paths are cwd-relative inside cwd and basename-only otherwise with portable POSIX/Windows handling (446–474); `cwdDisplay` is basename-only (657). The producer privacy test scans the serialized `promptContext` for 9 forbidden sentinels (raw prompt/messages/tool results/schema field names/skill and external paths) and bounds it < 40 KB. Windows-path test covers `C:\…` relative/basename behavior.
- **Payload/DOM bounds.** Producer caps 24/12/24/10/8 with explicit `omittedCount` and `other-omitted` aggregate rows that preserve total accounting (index.ts:289–319, 640–678, 868–878). Client caps match exactly (`app.js:24043–24047`) and `statsPromptList` slices before normalizing (24093–24103). Strings are bounded on both sides.
- **Malformed/null/legacy behavior.** Client normalizers preserve explicit `null` and real `0`, reject numeric strings/non-finite/negatives where invalid (`app.js:24054–24115`), and fail only the affected subsection; `renderStatsPrompt` (24454–24466) maps each failure independently to its matching legacy lines with a visible "Legacy fallback" / "Structured data unavailable" label (`statsPromptLegacyFallback` 24249–24255). Verified executably: the static VM test proves all three independent fallbacks and zero `.stats-overlay-lines` on a valid payload; the browser spec proves the malformed-snapshot case end-to-end. My runs: static 1/1, Chromium 5/5.
- **Text injection/security.** All payload strings enter via `make()`/`textContent` (`app.js:3055–3060`); the static test asserts no `innerHTML`/`insertAdjacentHTML` in the Prompt/context region; the browser spec proves the hostile `<img onerror>`/`<script>` fixture labels render as literal text with zero `img`/`script` nodes and no executed marker. `title`/`aria-label` attributes are set via safe DOM APIs.
- **Heuristic disclosure.** Current-context composition is labeled heuristic in the heading eyebrow, the note ("character-derived heuristic… independently of actual provider utilization" 24439), the figure label, and the table caption; the "Actual − estimate" card says "comparison only; not source attribution" (24436).
- **Responsive/accessibility.** Composition track uses `role="img"` + aria-label + exact table equivalent; native `<progress>` with `aria-label`/`aria-valuetext` and visible text; inventory is native `<details>/<summary>`; narrow CSS converts tables to labeled row cards via `td::before { content: attr(data-label) }` with `overflow: visible` (no nested scroller). Browser spec asserts no horizontal overflow at 390×844 and 320×568 with all details expanded and no fixed nested vertical scrollers; keyboard details operation and roving-tab navigation pass.
- **Plan compliance.** All nine success criteria and the "Approved decisions and invariants" list are implemented as specified (version 1, three independent sections, producer-defined kinds/IDs, deterministic sorting — verified by the determinism test, caps, redaction, independent fallback, raw outputs preserved, stale-options fix). `index.html` was correctly left unchanged by the feature (existing dialog semantics sufficient).

### Fixed

- None (read-only review; no edits applied).

### Blocker

- None found.

### Note (optional polish / minor gaps; none block acceptance)

1. **1440×900 overflow not browser-verified** — `tests/browser/stats-overlay.spec.mjs:241–262` (`expectNoPromptHorizontalOverflow`) only runs at 390×844 and 320×568; the plan's Web UI acceptance list mentions 1440×900 alongside the narrow viewports. Risk is low (desktop dialog is width-capped and the narrow cases are the overflow-prone ones), and 1440 is exercised for semantics. Severity: minor test-sufficiency gap. Smallest remediation: add one `expectNoPromptHorizontalOverflow(page)` call at the 1440 viewport in the existing narrow-viewport test (or the structured-render test).
2. **Long composition `aria-label`** — `statsPromptCompositionTrack` (`app.js:24257–24271`) joins up to 24 labels (client-bounded at 240 chars each) into one `role="img"` aria-label, worst case ~3 KB of announcement text. Bounded and plan-compliant, but screen-reader unfriendly at the cap. Severity: polish. Smallest remediation: truncate the joined description (e.g., top N rows + "and N more") since the full table follows immediately.
3. **Indeterminate progress with numeric-looking aria-valuetext** — when `usage.percent` is null, `renderStatsPromptCurrent` (`app.js:24420–24428`) leaves `<progress>` without a value (indeterminate) while `aria-valuetext` reads "n/a used / n/a window · n/a". Acceptable; slightly cleaner would be hiding the progress or marking it aria-hidden when all usage metrics are null. Severity: polish.
4. **Fixture shape the producer never emits** — the fake-Pi fixture includes a zero-token initial component (`framing-1`, tokens 0) (`fake-pi.mjs:944`), while the real producer filters zero-token components (index.ts:283). The client handles it correctly (track skips zero rows), so this is harmless, but the fixture is mildly unrealistic. Severity: polish; no change required.
5. **Legacy text still renders real zero tokens as "?"** — `contextUsageLine`/`showCurrentContextTokens` use `usage.tokens ? formatTokens(...) : "?"` (index.ts:1579, 1487), so a real 0 shows "?" in legacy `lines.tokenBreakdown` and the notify text. This is pre-existing legacy-line behavior (unchanged by this feature, and the structured path handles 0 correctly), kept intentionally for compatibility. Severity: note only; out of scope to change here.
6. **Strict exact-equality gate on initial components** — `normalizeStatsPromptInitial` (`app.js:24132–24134`) falls back the whole section if component tokens do not sum exactly to `totalTokens`. Correct and fail-closed for the current integer producer; just note that any future fractional/approximate producer would silently drop to legacy for that section. Severity: note.
7. **Fail-closed per-entry normalization** — one malformed entry inside the first `limit` entries fails its whole subsection (entries beyond the cap are silently truncated). This is the documented design and matches the handoff; noted so the parent disposition is informed, not because it violates anything.

### Explicit no-finding angles

- No version/lockfile/dependency changes; no canvas/remote assets; no staged files (`git diff --cached --quiet` exit 0); `git diff --check` clean.
- No payload growth beyond bounds; `other-omitted` accounting preserves exact totals on both initial and current sections.
- No regression to Command outputs: `renderStatsRaw` unchanged and browser-verified to contain raw prompt/detail text byte-for-byte.
- No XSS/DOM-injection vector in any Prompt/context path; hostile fixture labels verified inert in a real Chromium run.
- No NaN/Infinity/fake-zero paths found in producer or consumer; zero-denominator and malformed-usage producer tests plus client normalizer tests cover this.
- No performance concern: all builders/normalizers are O(n) over strictly capped collections; DOM nodes per section are bounded (≤24 segments/rows, ≤5 details groups).
- Determinism: identical inputs produce identical `promptContext` (producer test), including stable `<kind>-<occurrence>` IDs and tie-broken sorts.

### Residual uncertainty

- I ran the three focused suites (producer 10/10, static 1/1, Chromium 5/5) but not the full monorepo/Web UI suite and not WebKit; the known unrelated `mobile-static` failure was not re-characterized.
- Formula verification relied on reading `pi-utils/src/tokens.ts` and the estimate service rather than re-deriving every estimator; key invariants (integer total, char/4 estimate, calibration multipliers) were spot-verified.
- The installed Web UI `node_modules` stats package may be older than the working tree (plan risk); the browser spec correctly bypasses this via the env-gated fixture, so integrated-contract evidence is valid, but a manual runtime smoke against the real producer was not performed.
- Confidence: 90/100 (per confidence rule). Driven down only by the unrun full suite/WebKit and the lack of a real-producer end-to-end smoke; everything I inspected directly checked out.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with file/symbol/range, evidence, severity, and smallest remediation are listed under Note items 1-7 (e.g., app.js:24257-24271 long aria-label; stats-overlay.spec.mjs:241-262 missing 1440 overflow check); zero blockers; extensive verified-correct list with line citations."
    }
  ],
  "changedFiles": [
    "plans/handoffs/prompt-context-review-anthropic.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs",
      "result": "passed",
      "summary": "10 passed, 0 failed (402ms)"
    },
    {
      "command": "node --test pi-package-webui/tests/stats-dashboard-static.test.mjs",
      "result": "passed",
      "summary": "1 passed, 0 failed; 'stats-dashboard-static: all assertions passed'"
    },
    {
      "command": "cd pi-package-webui && ./node_modules/.bin/playwright test tests/browser/stats-overlay.spec.mjs --project=chromium",
      "result": "passed",
      "summary": "5 passed (4.8s), including structured render, malformed-snapshot fallback, and 390/320 overflow"
    },
    {
      "command": "git diff --check && git diff --cached --quiet",
      "result": "passed",
      "summary": "No whitespace errors; no staged files"
    }
  ],
  "validationOutput": [
    "producer TAP: tests 10, pass 10, fail 0",
    "static TAP: tests 1, pass 1, fail 0",
    "Chromium stats-overlay.spec.mjs: 5 passed (4.8s)",
    "git diff --check exit 0; git diff --cached --quiet exit 0"
  ],
  "residualRisks": [
    "Full monorepo/Web UI suite and WebKit not run by this reviewer; known unrelated mobile-static failure not re-characterized",
    "No manual runtime smoke against the real installed producer; browser evidence uses the env-gated fixture by design",
    "1440x900 horizontal overflow not asserted in the browser spec (390/320 are); low risk"
  ],
  "noStagedFiles": true,
  "diffSummary": "Review-only: added this handoff artifact; no project/source files modified. Reviewed diff adds additive v1 promptContext producer data plus native Web UI Prompt/context rendering, styles, fixture, and tests.",
  "reviewFindings": [
    "no blockers",
    "minor: pi-package-webui/tests/browser/stats-overlay.spec.mjs:241-262 - plan acceptance mentions 1440x900 overflow but browser overflow checks only run at 390/320; add one 1440 assertion",
    "polish: pi-package-webui/public/app.js:24257-24271 statsPromptCompositionTrack - role=img aria-label can reach ~3KB with 24 capped labels; consider truncating the joined description",
    "polish: pi-package-webui/public/app.js:24420-24428 renderStatsPromptCurrent - null usage leaves indeterminate progress with 'n/a' aria-valuetext; consider hiding/aria-hidden when all usage metrics are null",
    "polish: pi-package-webui/tests/fixtures/fake-pi.mjs:944 - fixture emits a zero-token initial component the real producer filters out; harmless but mildly unrealistic",
    "note: pi-extension-stats/index.ts:1579,1487 - legacy tokenBreakdown/notify text renders real 0 tokens as '?' (pre-existing, unchanged, structured path handles 0 correctly)",
    "note: pi-package-webui/public/app.js:24132-24134 - exact component-total equality gate is fail-closed; any future fractional producer would silently drop the section to legacy"
  ],
  "manualNotes": "Implementation matches the plan's contract, formulas, privacy bounds, lifecycle fix, fallback mapping, and test requirements. prompt-context-webui.md is an empty stub from the stopped first WS2 attempt; the authoritative UI handoffs are prompt-context-webui-core.md and prompt-context-tests.md. Dispositions remain parent-owned."
}
```
