# Final acceptance review (Anthropic) — native Prompt/context dashboard, post-integration-fix state

## Identity and scope

- Role: fresh read-only final acceptance reviewer (Wave 4 follow-up after the latest integration fixes).
- Run/model identity: Anthropic Claude review subagent, child of parent session `019fc3d6-8a9a-7aa3-96e9-7307a97fa1b5`; exact deployed model version is not introspectable from this runtime (residual uncertainty noted below). Read-only; no project/source files modified; this handoff artifact is the only write. No subagents launched; no dispositions decided.
- Basis inspected directly (not worker/reviewer claims): `plans/planned/prompt-context-native-dashboard.md`, handoffs `prompt-context-payload.md`, `prompt-context-webui-core.md`, `prompt-context-tests.md`, `prompt-context-review-anthropic.md`, `prompt-context-review-moonshot.md` (`prompt-context-webui.md` remains a truncated 1-line stub from the stopped first WS2 attempt), the current working-tree diff and source of `pi-extension-stats/index.ts`, `pi-extension-stats/tests/stats-payload.test.mjs`, `pi-package-webui/public/app.js` (Prompt/context region ~24043–24505), `public/styles.css` (11224–11505, 13456–13526), `tests/stats-dashboard-static.test.mjs`, `tests/browser/stats-overlay.spec.mjs`, `tests/fixtures/fake-pi.mjs`, and supporting `pi-utils/src/tokens.ts` / `initial-prompt-estimate-service.ts`.
- Requested root `plan.md`/`progress.md` do not exist (ENOENT); the plan file and handoffs were the authoritative inputs.
- Out-of-scope baseline respected: pre-existing dirty stats-dashboard hunks (spend comparison, cached-input share, scopedSessionCount, driverConcentration in `index.ts`) and unrelated component-update hunks were treated as prior work, not this feature; they do not intersect the Prompt/context paths.

## Review

### Correct (verified with evidence)

- **Additive v1 producer/consumer parity is exact.** `WEBUI_STATS_PAYLOAD_VERSION = 1` unchanged (`pi-extension-stats/index.ts:72`); `promptContext` is a purely additive root field (payload assembly at the `promptContext:` block, ~index.ts:1607); legacy `promptEstimate` and all `lines.*` (including `promptInjection`, `promptDetailed`, `tokenBreakdown`) are retained and built by the same formatters. Consumer kind set `STATS_PROMPT_SOURCE_KINDS` (app.js:24049–24053) matches the producer's 13 `PromptContextSourceKind` values (index.ts:404–417) exactly. Consumer caps 24/12/24/10/8 (app.js:24043–24047) match producer `PROMPT_SOURCE_LIMIT`/`TOOL_SCHEMA_LIMIT`/`TOOL_PROMPT_ENTRY_LIMIT`/`SKILL_LIMIT`/`CONTEXT_FILE_LIMIT` (index.ts:73–77). Type parity spot-verified: `confidence` is a `TokenEstimateConfidence` string ("calibrated"/"estimated", pi-utils/src/tokens.ts:234), `source` is a string union, `settled` boolean, `attempts` integer — all matching the consumer's required normalizer shapes (app.js:24117–24211).
- **Formulas.** `distributeCalibratedTokens` (index.ts:213–230) is a correct largest-remainder allocator over an always-integer total (`Math.max(0, Math.round(...))`, pi-utils/src/tokens.ts:219), so component tokens sum exactly to `totalTokens`; the consumer enforces this fail-closed (app.js:24132–24134). Current-context shares use `estimatedTotalTokens`, never actual usage (index.ts:868–884); `actualMinusEstimatedTokens` is separate, nullable, and labeled "comparison only; not source attribution" (app.js:24433–24438). Producer test at stats-payload.test.mjs:174 asserts exact totals and ~100% shares; zero-denominator test (line 147) plus `assert.doesNotMatch(JSON.stringify(payload), /NaN|Infinity/)` (158, 290) prove no NaN/Infinity paths.
- **Lifecycle reset.** `session_start` clears `latestSystemPromptOptions` alongside the pending measurement (index.ts:1436–1439); the dedicated test "session start clears stale system prompt options before building structured inventory" (stats-payload.test.mjs:313) asserts no `stale-context`/`stale-skill`/`STALE_CONTEXT_CONTENT` leakage.
- **Privacy/redaction.** `getToolParameterSummary` emits counts only ("N params, M required", index.ts:594–601); skill `location` is extracted (index.ts:554) but the structured snapshot maps only name/description; context paths are cwd-relative inside cwd and basename-only otherwise with portable POSIX/Windows handling (index.ts:446–474, test at 293); `cwdDisplay` is basename-only. The producer privacy test scans serialized `promptContext` for forbidden sentinels (stats-payload.test.mjs:257–269) including private user paths and Windows `D:\private` forms (310).
- **Bounds.** Producer caps with `other-omitted` aggregate rows preserve exact total accounting (index.ts:289–319 for initial, 868–878 for current; omitted counts explicit in `buildInitialPromptSnapshot`). Strings bounded via `boundedText` (120/160/240-char limits, index.ts:78–80). Client `statsPromptList` slices before normalizing (app.js:24094–24103) and fails closed on malformed entries within the cap.
- **Malformed/null/legacy behavior.** Normalizers preserve explicit `null` and real `0`, reject numeric strings/non-finite/negatives where invalid (app.js:24056–24096); `statsPromptPercent` additionally rejects >100 (24084–24087). Each subsection normalizes independently and falls back only to its matching legacy lines with visible "Legacy fallback"/"Structured data unavailable" labeling (app.js:24249–24255, dispatch 24461–24465). Verified executably: static VM test proves all three independent fallbacks and zero `.stats-overlay-lines` on valid payloads; Chromium spec test 4 proves the malformed-snapshot isolation end-to-end.
- **Raw Command outputs, including current-context breakdown — Moonshot fix-now F1 verified FIXED.** `renderStatsRaw` now includes `statsCommandOutputSection("Current context breakdown", "/stats tokens", …, payload?.lines?.tokenBreakdown)` (app.js:24489). Static test asserts `RAW_CONTEXT_BREAKDOWN <raw> exact` survives in raw output (stats-dashboard-static.test.mjs:176, 214); Chromium spec asserts exactly one raw block containing it (stats-overlay.spec.mjs:222) while the prompt pane excludes it for valid payloads (spec:241).
- **Other prior-review integration fixes verified FIXED in current source:**
  - 1440×900 overflow check (prior Anthropic note 1 / Moonshot note 7): spec:189 runs `expectNoPromptHorizontalOverflow(page)` at the 1440×900 viewport in the structured-render test.
  - Over-long composition aria-label (prior Anthropic note 2): `statsPromptCompositionTrack` (app.js:24257–24274) now describes only the top 6 rows plus ", and N more sources", bounding announcements.
  - Missing `:focus-visible` style (Moonshot note 3): styles.css:11380 adds `.stats-prompt-inventory-details summary:focus-visible`.
- **Security.** All payload strings enter via `make()`/`textContent`; the static test asserts no HTML-insertion API in the region; the Chromium run proves hostile `<img onerror>`/`<script>` labels render inert (spec:191–194, 216–218) with zero created `img`/`script` nodes and no executed marker. No new dependencies, canvas, or remote assets.
- **Performance.** All builders/normalizers are O(n) over strictly capped collections; DOM per section is bounded (≤24 segments/rows, ≤5 details groups, ≤24 chips). No finding.
- **Tests.** Producer 10/10, static 1/1, Chromium 5/5 all rerun by this reviewer and pass. Coverage includes exact totals, caps/omitted counts, privacy sentinels, determinism, lifecycle reset, null/zero/malformed, hostile text, keyboard details operation, progress ARIA, actual-vs-heuristic disclosure, fallback isolation, raw preservation, and 1440/390/320 overflow.

### Fixed (by this reviewer)

- None (read-only review; no edits applied).

### Blocker

- **None found.** No fix-now remains: the single prior fix-now (Moonshot F1, medium) is verified fixed with producer-side data unchanged and two levels of test assertions (static + browser).

### Notes (optional polish / residual gaps; none block acceptance)

1. **Indeterminate progress with numeric-looking `aria-valuetext`** — when `usage.percent` is null, `<progress>` gets no value (indeterminate) while `aria-valuetext` still reads "n/a used / n/a window · n/a" (app.js:24420–24428). Previously flagged as optional polish by both prior reviewers; intentionally or incidentally left as-is. Severity: polish. Smallest remediation: set `aria-valuetext` only when a value exists, or hide the progress when all usage metrics are null.
2. **No visual legend for the composition bar** — segment→kind color mapping is only discoverable via hover `title` (app.js:24268–24270); keyboard/touch users rely on the aria-label and the ranked table that immediately follows. Conformant but weak discoverability. Severity: polish. Smallest remediation: compact legend row reusing `data-prompt-kind` colors.
3. **Fixture shape the producer never emits** — fake-Pi emits a zero-token initial component "Zero-token framing" (fake-pi.mjs:944) while the real producer filters zero-token components (index.ts:283). Client handles it correctly (track skips, table shows 0). Harmless; mildly unrealistic. Severity: polish; no change required.
4. **Legacy text renders real 0 tokens as "?"** — `contextUsageLine`/`showCurrentContextTokens` use `usage.tokens ? formatTokens(...) : "?"` (index.ts:1487, ~1579 contextUsageLine). Pre-existing legacy behavior, unchanged by this feature; the structured path handles 0 correctly. Severity: note; out of scope.
5. **Fail-closed exact-equality gate** — `normalizeStatsPromptInitial` (app.js:24132–24134) drops the whole section to legacy if component tokens do not sum exactly to `totalTokens`. Correct for the current integer producer; a future fractional/approximate producer would silently lose the native section. Severity: note.
6. **Legacy fallback keeps a 24rem nested scroller, untested at narrow widths** — fallback reuses `.stats-overlay-lines` (`max-height: 24rem; overflow: auto`); the no-nested-scroller browser check runs only with a fully valid payload (spec:243–262). Acceptable since raw text must stay scrollable; a fallback-viewport assertion would close the gap. Severity: note.
7. **Truncated WS2 handoff stub** — `plans/handoffs/prompt-context-webui.md` remains a 1-line fragment from the stopped first WS2 attempt; the authoritative handoffs are `prompt-context-webui-core.md` and `prompt-context-tests.md`. Process hygiene only; parent may fold a pointer into the stub at archive time.

### Explicit no-finding angles

- **Plan acceptance criteria 1–9:** all verified satisfied in current source — native sections replace the three `<pre>` blocks; calibrated composition sums exactly with a semantic table; actual utilization and heuristic composition are separate and labeled; inventory has five bounded collapsible groups; version 1 with legacy fields intact and independent subsection fallback; bounded/redacted structured data; no fake zeroes/NaN/Infinity/unbounded growth; no page-level overflow or new fixed nested content scrollers at all three viewports; focused producer/static/browser checks pass with unrelated dirty-tree work preserved.
- **Producer/consumer parity:** kinds, IDs, caps, nullability, and required-field strictness match exactly; no drift found.
- **Security:** no injection vector, no new dependency/remote asset/canvas, no staged files (`git diff --cached --quiet` exit 0), `git diff --check` clean.
- **Performance:** no finding; all work is O(n) over capped collections with bounded DOM.
- **Regression surface:** `/stats-pi`, `/stats-tokens`, Command outputs, and the calibration panel are preserved; `renderStatsRaw` change is purely additive.
- **Determinism:** stable `<kind>-<occurrence>` IDs and tie-broken sorts; producer determinism test passes.

### Residual uncertainty

- I reran the three focused suites (producer 10/10, static 1/1, Chromium 5/5) plus syntax and diff/staging checks, but not the full monorepo/Web UI suite and not WebKit; the known unrelated `mobile-static` failure was not re-characterized (parent-owned per plan).
- Browser evidence uses the env-gated deterministic fixture by design; a manual runtime smoke against the installed (possibly older) stats extension was not performed — the plan itself flags this installed-dependency skew risk.
- Formula verification relied on reading `pi-utils/src/tokens.ts` and the estimate service plus the producer invariant tests rather than re-deriving every estimator.
- Exact deployed model version for this reviewer is not introspectable; identity stated as Anthropic Claude subagent.
- Confidence: **93/100**. Everything load-bearing was inspected directly and re-executed; confidence is reduced only by the unrun full suite/WebKit, the fixture-only browser path, and non-exhaustive byte-identity checking of pre-existing dirty hunks.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete evidence-backed findings with file/symbol/range, severity, and smallest remediation: zero blockers; prior fix-now F1 verified fixed (app.js:24489 renderStatsRaw 'Current context breakdown' plus static test:214 and browser spec:222 assertions); notes N1-N7 with exact locations (e.g., app.js:24420-24428 indeterminate progress aria-valuetext, app.js:24268 missing legend); extensive verified-correct list citing index.ts:72,213-230,289-319,446-474,594-601,868-884,1436-1439 and app.js:24043-24505."
    }
  ],
  "changedFiles": [
    "plans/handoffs/prompt-context-final-review-anthropic.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs",
      "result": "passed",
      "summary": "10 passed, 0 failed (~425ms)"
    },
    {
      "command": "node --test pi-package-webui/tests/stats-dashboard-static.test.mjs",
      "result": "passed",
      "summary": "1 passed, 0 failed; 'stats-dashboard-static: all assertions passed'"
    },
    {
      "command": "cd pi-package-webui && ./node_modules/.bin/playwright test tests/browser/stats-overlay.spec.mjs --project=chromium",
      "result": "passed",
      "summary": "5 passed (4.9s) including structured render, raw tokenBreakdown retention, malformed-snapshot fallback isolation, and 1440/390/320 overflow"
    },
    {
      "command": "git diff --check && git diff --cached --quiet && node --experimental-strip-types --check pi-extension-stats/index.ts && node --check pi-package-webui/public/app.js",
      "result": "passed",
      "summary": "No whitespace errors; no staged files; producer and consumer syntax checks clean"
    }
  ],
  "validationOutput": [
    "producer TAP: tests 10, pass 10, fail 0",
    "static TAP: tests 1, pass 1, fail 0",
    "Chromium stats-overlay.spec.mjs: 5 passed (4.9s)",
    "git diff --check exit 0; git diff --cached --quiet exit 0; node syntax checks exit 0"
  ],
  "residualRisks": [
    "Full monorepo/Web UI suite and WebKit not run by this reviewer; known unrelated mobile-static failure not re-characterized",
    "Browser evidence uses the env-gated fixture; no manual runtime smoke against the installed stats extension (plan-flagged dependency skew)",
    "Pre-existing dirty hunks verified by diff shape and symbol presence, not byte-identity",
    "Exact deployed reviewer model version not introspectable from this runtime"
  ],
  "noStagedFiles": true,
  "diffSummary": "Review-only: added this handoff artifact; no project/source files modified. Reviewed integrated diff adds additive v1 promptContext producer data, native Prompt/context renderers/styles, env-gated fixture, static/browser coverage, and the post-review integration fixes (raw tokenBreakdown section, 1440 overflow check, bounded aria-label, summary focus-visible).",
  "reviewFindings": [
    "no blockers; no fix-now remains",
    "verified fixed: pi-package-webui/public/app.js:24489 renderStatsRaw - raw lines.tokenBreakdown now reachable in Command outputs (prior Moonshot fix-now F1), asserted by stats-dashboard-static.test.mjs:214 and stats-overlay.spec.mjs:222",
    "verified fixed: stats-overlay.spec.mjs:189 - 1440x900 horizontal overflow now asserted (prior Anthropic note 1 / Moonshot note 7)",
    "verified fixed: app.js:24257-24274 statsPromptCompositionTrack - aria-label bounded to top 6 rows + 'and N more sources' (prior Anthropic note 2)",
    "verified fixed: styles.css:11380 - summary :focus-visible style added (prior Moonshot note 3)",
    "polish: app.js:24420-24428 renderStatsPromptCurrent - null usage leaves indeterminate progress with 'n/a' aria-valuetext",
    "polish: app.js:24268 - composition bar has no visual legend; colors discoverable only via hover title",
    "polish: tests/fixtures/fake-pi.mjs:944 - fixture emits zero-token initial component the real producer filters; harmless",
    "note: pi-extension-stats/index.ts:1487 - legacy text renders real 0 tokens as '?' (pre-existing, out of scope)",
    "note: app.js:24132-24134 - exact component-total equality gate is fail-closed for any future fractional producer",
    "note: legacy fallback keeps 24rem nested scroller; fallback narrow-viewport layout untested",
    "note: plans/handoffs/prompt-context-webui.md remains a truncated stub; authoritative handoffs are -webui-core.md and -tests.md"
  ],
  "manualNotes": "Requested root plan.md/progress.md are absent (ENOENT); plan file and handoffs were authoritative. All prior review fix-now/medium findings are verified fixed in the current tree; only optional polish and residual-risk notes remain. Dispositions and plan acceptance decisions remain parent-owned. Confidence 93/100."
}
```
