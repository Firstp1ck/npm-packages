# Independent Review A (Anthropic) — Stats Dashboard Visualizations

- Reviewer: read-only review subagent, Claude (Anthropic), Pi environment
- Scope reviewed: integrated working-tree diff at HEAD `ce2072e2948a0b2d9a946bb416904f411d8aa411` (uncommitted edits)
- Files inspected: `plans/planned/stats-dashboard-visualizations.md`; `plans/handoffs/stats-dashboard-payload.md`, `stats-dashboard-payload-attempt-2.md`, `stats-dashboard-webui.md`; `pi-extension-stats/index.ts` (diff + surrounding source), `pi-extension-stats/README.md` (diff), `pi-extension-stats/tests/stats-payload.test.mjs`; `pi-package-webui/public/app.js` stats-overlay section (~L634, L23478–24160, L38570–38596), `public/index.html` stats dialog, `public/styles.css` stats rules, `tests/stats-dashboard-static.test.mjs`, `tests/browser/stats-overlay.spec.mjs`
- Explicitly excluded: unrelated component-update edits (`bin/pi-webui.mjs`, `lib/trust-boundaries.mjs`, `lib/component-update-state.mjs`, component-update tests, non-stats hunks in `app.js`/`index.html`/`styles.css`, `mobile-static.test.mjs` change). None of these were attributed to this feature.
- Verification commands run by this reviewer (all read-only):
  - `node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs` → 4 pass / 0 fail
  - `node --check pi-package-webui/public/app.js` → OK
  - `node pi-package-webui/tests/stats-dashboard-static.test.mjs` → all assertions passed
  - `npx playwright test stats-overlay --project=chromium` → 3 passed (2.7s)
  - Two temporary repro scripts against the producer (temp fixtures only; no source modified) — see Finding 1

## Review

### Correct (verified, no finding)

- **Producer/consumer field contract**: Every field the UI reads (`scopedSessionCount`, `summary.promptSideTokens`, `cachedInputShare`, `effectiveCostPerMillionTokens`, `averageCostPerSession`, `averageTokensPerSession`, `spendComparison{windowDays,recentStartDay,recentEndDay,recentCost,priorCost,changeCost,changePercent}`, `models[]`, `expensiveSessions[]`, `totals`, `daily`) exists with the same name and shape in `buildWebuiStatsPayload` (`pi-extension-stats/index.ts` ~L1210–1265). The UI intentionally does not consume `summary.driverConcentration` / `topModelCostShare` / `topSessionCostShare` and rebuilds shares client-side from `models`/`expensiveSessions` (`app.js` L23608–23625) — a valid consumer-side simplification, not a contract break, though it makes three new producer summary fields UI-dead (see Note 3).
- **Formula semantics match the plan's approved decisions**: cached-input share is `cacheRead / (input + cacheRead + cacheWrite) * 100`, null on zero denominator, identically on producer (`nullableRatio`, index.ts L591–594; usage ~L1192) and legacy client fallback (`statsCachedInputShare`, app.js L23556–23562). Effective $/1M is `cost / total * 1e6` on both sides (index.ts ~L1198; app.js L23568–23573). Spend comparison uses equal up-to-7-day windows with `changePercent` null when `priorCost <= 0` (index.ts `buildSpendComparison` L820–855). Cost formulas are labeled "blended rate, not provider list pricing" in the UI.
- **Backward compatibility**: `WEBUI_STATS_PAYLOAD_VERSION` stays 1; all legacy top-level and summary fields (`sessionCount` file count, `cacheHitRate`, `nonCacheTokens`, `calendarAvgCost`, `activeAvgCost`, `projected30DayCost`, `highestDay`) are preserved. The client distinguishes absent (legacy payload → compute fallback) from present-but-null (`statsSummaryHas`, app.js L23547–23549) and never renders fake zeroes for nullable metrics (`formatStatsNullable*` render `n/a`). Legacy `sessionCount` is deliberately labeled "session files" vs "sessions in range" (app.js L23899–23901, L24118–24121).
- **Zero/empty/malformed handling**: `statsArray` coerces malformed collections; `finiteNumberOrZero`/`nullableRatio` on the producer keep serialized values finite or null (verified by the zero-denominator test asserting no `NaN|Infinity` in JSON); `renderStatsSpendChart`/`renderStatsComposition`/`renderStatsBarRows` short-circuit on empty/zero ranges; all chart widths/heights are clamped to 0–100%. `parseStatsWebuiPayloadRaw` guards JSON parse, type, and version.
- **Cache-language accuracy**: no user-facing "cache hit" or monetary savings remain. `buildCacheEfficiencyLines` (index.ts L972–984) now emits "Cached-input share: …"; the Raw-tab description reads "Cached-input token share…" (app.js ~L24072); README updated. The producer test asserts `doesNotMatch /cache hit|cache savings/i` on `lines.cache`, and the static test enforces terminology in the UI. The inaccurate name `summary.cacheHitRate` survives only as a non-user-facing legacy field, per the plan's compatibility decision.
- **Accessibility/no-color dependence**: chart bars are `aria-hidden` with visible per-row text values; purely visual charts use `role="img"` + descriptive `aria-label` + visible captions; legends have text labels next to swatches; tables gained `<caption>` and `th.scope="col"`; tabs have stable ids, `role="tab"`, `aria-selected`, `aria-controls`, roving tabindex, `aria-labelledby` sync, and an Arrow/Home/End keyboard handler with wrap (app.js L38585–38596) — all verified by the passing browser spec including narrow-viewport no-overflow checks.
- **No new dependencies / remote assets / canvas**: charts are DOM+CSS only; static test asserts absence.
- **Test evidence vs plan success criteria**: producer tests cover scoped sessions, sparse inclusive all-scope, equal spend windows, zero denominators, and README terminology; UI static test covers fallback formulas, absent-vs-null, `n/a` rendering, clamping, 31-point cap, independent scales, tab semantics, captions, CSS selectors, responsive rules; browser spec covers tab semantics, keyboard nav, and 390×844/320×568 overflow. This reviewer re-ran all of them successfully.
- **Security/privacy — no finding**: the stats section builds all DOM via `make()` which uses `textContent` only (app.js L3055–3060); no `innerHTML` in stats code (the 3 `innerHTML` uses in app.js are pre-existing, outside this feature); payload content is local session telemetry rendered as text; no data leaves the machine.

### Finding 1 — Blocker-adjacent (Severity: **Medium/High**, only realistic defect found)

- **Affected**: `pi-extension-stats/index.ts` — `getScopeDayKeys` (L788–795) + `buildInclusiveDayRange` (L604–608), reached from `getDayKey` (L609–613) via any record timestamp.
- **Violated requirement / failure mode**: plan acceptance "malformed/missing … metrics do not crash" and general performance bounds. The new inclusive `all`-scope span is **unbounded by wall-clock time**. `getDayKey` accepts any finite-parsing timestamp, including far-future ones, and the inclusive range then materializes one `daily` entry per calendar day from first to last recorded day. A single corrupted/clock-skewed JSONL line can blow up the payload. Before this change, `all` used only recorded keys, so this input was bounded by record count — this is a regression introduced by the feature.
- **Evidence / reproduction** (run by this reviewer against the actual working tree, temp fixture dir):
  - Two records dated `2026-01-01` and `2036-01-01`, scope `all` → `dayCount: 3653`, `daily.length: 3653`, payload ≈ 380 KB, 14 ms (tolerable, but already 3653 table rows in the UI).
  - Two records dated `2026-01-01` and `9999-01-01`, scope `all` → `dayCount: 2,912,079`, `daily.length: 2,912,079`, serialized payload ≈ **300 MB**, ~6.7 s producer CPU — then pushed through `ui.setStatus` into the Web UI status transport and rendered as a full daily table. Practically a hang/OOM of the dashboard from one bad line.
  - Note `buildDayRange` (range mode) is anchored to "today" and is not affected; only `all` mode is.
- **Smallest useful remediation**: in `getScopeDayKeys` (or `getDayKey`), clamp `lastDay` to today's UTC day key (usage cannot legitimately be in the future), e.g. `const today = new Date().toISOString().slice(0,10); const clampedLast = lastDay > today ? today : lastDay;` — optionally also cap the span length (e.g. 3650 days, matching `parseDaysArg`'s existing max) with a truncation marker. One-line-to-few-lines producer change plus one test case.
- **Disposition**: left to the parent (this review does not decide dispositions). I classify it as a **should-fix before completion** rather than an absolute blocker, because it requires corrupted/far-future local data; but the fix is tiny and the failure mode (300 MB status value) is severe when triggered.

### Notes / optional polish (no blockers)

1. **Note (Low)** — `pi-package-webui/public/app.js` `renderStatsBarRows` L23745–23749: rows are filtered to active days (`total > 0 || cost > 0`) before the 31-point cap, but `statsChartWindowNote`'s default noun is "days", so the disclosure reads "latest 31 of N days" when N counts **active** days only. The spend chart caps *calendar* days. Cosmetic wording inconsistency; smallest fix: pass `"active days"` as the noun for the bar rows.
2. **Note (Low)** — same function, L23746: `tokenRatio` has a 1.5% floor applied even when `row.total === 0` (row retained because `cost > 0`), so a zero-token day shows a sliver token bar. The visible text says `0 tok`, and bars are `aria-hidden`, so no information is wrong. Smallest fix: mirror the cost lane's `row.cost > 0 ? floor : 0` pattern.
3. **Note (Low)** — producer `summary.topModelCostShare`, `topSessionCostShare`, and `driverConcentration` (index.ts ~L1240–1252) are additive and tested but consumed by no client; the UI recomputes shares from the arrays. Not harmful (plan explicitly allows the fields), but they are contract surface without a consumer. Option: keep (other consumers may use them) or note in README; no code change required.
4. **Note (Low)** — `statsSpendComparison` (app.js L23593–23606) drops `priorStartDay`/`priorEndDay`; the card shows only the recent date range plus "(7d) vs prior 7d". The plan requires disclosing equal window *length*, which is satisfied; showing prior dates would be marginal polish, especially since in range mode the prior window can precede the selected scope (documented WS1 assumption).
5. **Note (Info)** — all `all`-scope payloads now include zero-filled days between first and last usage (by design per plan). For legitimately old workspaces (e.g. 3 years), `daily` grows to ~1100 entries and the Daily table renders them all; charts are capped at 31. This is acceptable and disclosed, but it compounds with Finding 1 — the clamp there also bounds the legitimate worst case.
6. **Note (Info)** — all tabs share one tabpanel (`aria-controls="statsOverlayBody"`); this is a valid, common single-tabpanel pattern and `aria-labelledby` is kept in sync.
7. **Attribution check**: the `mobile-static.test.mjs` and `native-parity-harness.test.mjs` modifications, `bin/pi-webui.mjs`, `lib/trust-boundaries.mjs`, and component-update hunks inside the three shared public files are unrelated component-update work and were not evaluated as part of this feature; the stats hunks in `app.js`/`styles.css`/`index.html` are cleanly confined to the stats-overlay sections as claimed.

### Explicit no-finding angles

- Backward compatibility: **no finding** (legacy fields preserved, version 1 kept, fallback + absent-vs-null verified).
- Security/privacy: **no finding** (textContent-only rendering, guarded JSON parse, local-only data, no remote assets).
- Formula semantics: **no finding** (producer and client fallbacks match the approved definitions exactly).
- Test sufficiency vs plan criteria 1–8: **no finding** beyond the known, honestly-recorded omissions (full `npm test` not rerun; chromium-only browser coverage; no populated-payload browser rendering test; 1440×900 layout verified statically only). These omissions are documented in the WS2 handoff and are acceptable residual gaps, not misrepresentations.

## Run/model identity

- Model: Claude (Anthropic), acting as review subagent "Reviewer A (Anthropic)" per Wave 4 of the plan; parent session `subagent-chat-019fc3d6`.
- Environment: NixOS host, repo `/home/firstpick/npm-packages`, HEAD `ce2072e2948a0b2d9a946bb416904f411d8aa411`, dirty working tree (feature + unrelated component-update work), no staged files at review time.

## Residual uncertainties

- Full `pi-package-webui` `npm test` was not run by this reviewer (known pre-existing `mobile-static` failure from unrelated work would pollute the signal); focused suites and all feature-specific tests were re-run and pass.
- Populated-payload browser rendering (charts with real data in a live browser) remains covered only by static DOM-contract assertions; no fixture advertises a stats command.
- 1440×900 balanced-layout quality was not visually verified by this reviewer.
- Finding 1 reproduction used the producer via its command handler with temp fixtures; the 300 MB payload's exact downstream behavior in the live Web UI transport was extrapolated, not end-to-end observed.

**Confidence: 90/100.** All feature tests re-run and passing; the single substantive finding is reproduced with measured numbers; deductions for the un-run full suite and non-visual layout verification.
