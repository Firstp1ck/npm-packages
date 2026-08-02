# Prompt/context Native Dashboard — Complex Feature Plan

Status: planned  
Integration owner: parent Pi session `019fc3d6-8a9a-7aa3-96e9-7307a97fa1b5`  
Final report: [`../../reports/prompt-context-native-dashboard.html`](../../reports/prompt-context-native-dashboard.html) (created after integration and review)

## Goal

Replace the Prompt/context tab's three monospaced text blocks with an accessible, responsive native Web UI that visualizes initial-prompt composition, current-context utilization/composition, and prompt inventory while preserving legacy version-1 payload compatibility and raw command output.

## Classification

**Complex, reclassified from the preliminary lightweight result.** Repository evidence materially contradicts the preliminary classification: the feature crosses the stats producer contract (`pi-extension-stats/index.ts`) and the Web UI consumer/styles/browser fixture/tests (`pi-package-webui`), has two meaningful implementation slices, requires bounded privacy-aware structured data, and benefits from distinct producer and UI/test ownership. The shared repository is already dirty with the completed-but-uncommitted stats dashboard work and unrelated component-update work, so implementation workers must run sequentially in the shared tree.

## Success criteria

1. A current structured payload renders no plain-text `<pre>` blocks inside Prompt/context; native sections replace initial prompt, detailed snapshot, and current context output.
2. Initial-prompt composition presents calibrated source totals as a native stacked/ranked visualization plus an exact semantic table; component tokens sum to the prompt estimate total.
3. Current context separately shows actual utilization (tokens/window/percent) and estimated source composition. Estimated composition shares use their own estimated total and are labeled heuristic.
4. Prompt inventory exposes native estimate-component cards and bounded, collapsible tool, skill, available-tool-entry, metadata, and context-file sections.
5. Version remains `1`; existing `promptEstimate` and `lines.*` remain intact. Missing or malformed structured subsections fall back independently to their matching legacy text block.
6. Structured payload data is bounded and privacy-conscious: no raw system prompt, message content, tool-result content, parameter schemas, skill locations, or full external paths are added.
7. Zero/null/malformed values never become fake zeroes, `NaN`, `Infinity`, exceptions, or unbounded DOM/payload growth.
8. Desktop and 390×844/320×568 layouts have no page-level overflow or nested fixed-height content scrollers; keyboard and screen-reader semantics remain usable.
9. Producer, static, syntax, focused browser, package, and applicable broad checks pass, with unrelated dirty-tree failures explicitly separated.

## Scope

### In scope

- Additive structured `promptContext` version-1 payload data built from existing prompt/context helpers.
- Native prompt composition, utilization, breakdown, component, and inventory renderers.
- Section-level legacy fallback and raw Command outputs preservation.
- Prompt-specific responsive/accessibility styling and deterministic producer/static/browser coverage.
- Fixing stale `latestSystemPromptOptions` lifecycle state if confirmed while implementing this contract.

### Non-goals

- Parsing box-drawing text in the browser.
- Payload version 2, release/version/lockfile changes, new runtime dependencies, canvas, or remote assets.
- Raw prompt/message/tool-result contents, tool parameter schemas, skill file locations, telemetry, persistence, sorting controls, or configurable budgets.
- Refactoring the full stats overlay or completing unrelated component-update work.
- Changing `/stats-pi`, `/stats-tokens`, or Command outputs text except to share structured builder results without user-visible regression.

## Approved decisions and invariants

- Keep `WEBUI_STATS_PAYLOAD_VERSION = 1`; structured fields are optional additions.
- Add root `promptContext` with three independently valid sections: `initialPrompt`, `snapshot`, and `currentContext`.
- Build structured data from canonical producer helpers; do not infer semantic kinds from labels in the Web UI.
- Initial composition allocates prompt-text tokens by source character weight, adds tool-schema and framing components, then uses largest-remainder calibration so structured component tokens sum exactly to `promptEstimate.total`.
- Current-context utilization is actual provider/context data when available. Current source composition remains character-derived and its shares use `estimatedTotalTokens`, not actual usage, so composition sums meaningfully to 100%; the UI discloses the heuristic and shows actual-minus-estimated separately when available.
- Stable source kinds/IDs are producer-defined. Arrays are sorted deterministically and bounded; overflow is aggregated into an `other` row when needed.
- Wire limits: initial/current source rows ≤24; tool schemas ≤12; tool-prompt entries ≤24; skills ≤10; context files ≤8; descriptions/labels are truncated; omitted counts are explicit.
- Structured context paths are cwd-relative when inside cwd and basename-only otherwise; structured fields omit skill locations and cwd paths beyond a display basename. Existing legacy lines remain for compatibility and are not expanded.
- New Web UI normalizers preserve explicit `null`, preserve real `0`, reject non-finite/negative metrics where invalid, cap arrays, and render via `textContent`-based helpers.
- Valid structured subsections render native DOM. Missing/malformed subsections fall back only that subsection to `lines.promptInjection`, `lines.promptDetailed`, or `lines.tokenBreakdown`, labeled as legacy fallback.
- Raw text stays fully available in Command outputs.
- The parent session alone updates this plan, integrates results, disposition findings, and claims completion.

## Structured payload contract

```text
promptContext.initialPrompt
  totalTokens, lowTokens, highTokens, confidence, source, warning
  estimateMethod, components[]
  component: id, kind, label, chars|null, uncalibratedTokens, tokens, percent|null

promptContext.snapshot
  source, settled, attempts, warning, systemPromptChars
  estimateComponents: promptText, toolSchemas, framing, calibration multiplier/samples
  metadata: currentDate|null, cwdDisplay|null, extraGuidelineCount
  tools: totalCount, omittedCount, items[]
  toolPromptEntries: totalCount, omittedCount, names[]
  skills: totalCount, omittedCount, items[]
  contextFiles: totalCount, omittedCount, items[]

promptContext.currentContext
  usage: tokens|null, contextWindow|null, percent|null
  breakdown: estimateMethod, reconstruction, estimatedTotalTokens,
             actualMinusEstimatedTokens|null, sources[]
  source: id, kind, label, chars, estimatedTokens, percent|null
```

## Execution DAG and ownership

### Wave 0 — inspection and design (complete)

- Parent inspected the screenshot, producer helpers, payload builder, current renderer/styles/tests, and dirty-tree baseline.
- `planner` run `d0948b71-9bf4-4cdd-aef9-4d823d62410a/0` defined native hierarchy and fallback behavior.
- `context-builder` run `d0948b71-9bf4-4cdd-aef9-4d823d62410a/1` defined formulas, privacy/size limits, lifecycle risks, and test requirements.

### Wave 1 — WS1 structured producer contract (implementation worker 1)

Prerequisite: this plan and current working-tree baseline.  
Write boundary:

- `pi-extension-stats/index.ts`
- `pi-extension-stats/tests/stats-payload.test.mjs`
- `pi-extension-stats/README.md` only if structured semantics need documentation

Deliverables:

- Shared typed builders for initial composition, native snapshot, and current-context breakdown.
- Additive bounded `promptContext` payload while retaining all legacy fields/lines.
- Exact composition invariants, semantic kinds/IDs, privacy truncation/redaction, reconstruction status, and stale-options lifecycle reset if confirmed.
- Producer tests for nonempty prompts/tools/skills/context/messages, caps, nulls, privacy, lifecycle reset, totals/shares, and retained legacy lines.

Forbidden/shared paths: all `pi-package-webui/**`, plans, reports, package/lock/version files, `node_modules`, and unrelated files.  
Handoff: `plans/handoffs/prompt-context-payload.md`.

### Wave 2 — WS2 native Web UI and browser coverage (implementation worker 2)

Prerequisites: inspect the integrated WS1 source and handoff; use exact field names rather than assumptions.  
Write boundary:

- Stats prompt/context section and narrowly shared stats helpers in `pi-package-webui/public/app.js`
- Stats prompt/context rules and existing responsive stats block in `public/styles.css`
- Stats dialog markup in `public/index.html` only if semantics require it
- `tests/stats-dashboard-static.test.mjs`
- `tests/browser/stats-overlay.spec.mjs`
- `tests/fixtures/fake-pi.mjs` only for deterministic structured/legacy stats fixtures

Deliverables:

- Native initial composition visualization/table, actual context utilization progress, estimated current-context composition, estimate components, and collapsible inventory.
- Defensive normalizers and independently labeled section fallbacks; no unconditional prompt-tab text blocks for current payloads.
- Responsive/accessibility styles with visible values and bounded long labels.
- Static and populated-payload browser tests for native sections, nulls, inventory, fallback, Command outputs retention, keyboard behavior, hostile text, and narrow overflow.

Forbidden/shared paths: producer files, plans, reports, package/lock/version files, component-update logic/tests, and all non-stats sections. Existing stats-dashboard and unrelated dirty hunks must be preserved exactly outside this feature's bounded edits.  
Handoff: `plans/handoffs/prompt-context-webui.md`.

Workers execute sequentially in one shared cwd. There is never more than one active writer.

### Wave 3 — central integration and validation

Parent inspects both actual diffs and handoffs, verifies boundaries and producer/consumer field parity, then runs:

- producer prompt-context tests and syntax/package checks;
- Web UI syntax and stats static tests;
- focused populated/legacy Chromium stats spec;
- applicable full Web UI tests, separating unrelated failures;
- `git diff --check`, no-staged-files, and worktree cleanup checks.

### Wave 4 — independent review quorum

Two distinct fresh/read-only reviewers inspect the integrated implementation:

- Anthropic reviewer: contract correctness, privacy/size bounds, lifecycle, formulas, malformed/legacy behavior, tests.
- Moonshot reviewer: UX usefulness vs screenshot, accessibility, responsive layout, maintainability, populated browser evidence.

Every finding receives one parent-verified disposition. Only accepted findings are fixed; fixes are revalidated.

### Wave 5 — report and archive

Create `reports/prompt-context-native-dashboard.html` using the HTML report workflow, link it with this plan, record evidence/risks, and move this plan to `plans/archive/` only after all completion gates pass.

## Acceptance checks

### Producer

- Initial component tokens equal `promptContext.initialPrompt.totalTokens` exactly when nonzero; finite shares sum approximately 100%.
- Current composition shares use estimated total and sum approximately 100% independently of actual context usage.
- Actual usage and estimated breakdown are separate and accurately labeled.
- Stable IDs/kinds and deterministic sorting survive identical input.
- Caps/omitted counts are correct and preserve total accounting.
- No raw prompt, message content, tool-result content, parameter schema, skill location, or full external path appears in structured data.
- `session_start` cannot reuse stale prompt options.
- Existing `promptEstimate`, all `lines.*`, `/stats-pi`, and `/stats-tokens` behavior remain available.

### Web UI

- Current payload Prompt/context contains native figures/tables/progress/details and no `.stats-overlay-lines`.
- Each missing/malformed structured subsection falls back independently with a visible legacy label.
- Command outputs still contains raw prompt/detail text.
- Explicit null renders `n/a`; real zero renders `0`; malformed/oversized arrays cannot crash or explode DOM size.
- Composition visual encoding has visible numeric/table equivalents; progress has a text equivalent and accessible name.
- Inventory details are native keyboard-operable `<details>/<summary>` groups with visible counts and omitted indicators.
- 1440×900, 390×844, and 320×568 checks show no page-level overflow or fixed nested content scroller.

## Integration and rollback

- Integration order is WS1 then WS2. Parent records focused diff stats and verifies the dirty baseline after each wave.
- If WS1 fails, WS2 does not start. Revert only bounded WS1 hunks/tests; never reset the repository.
- If WS2 fails, the additive producer fields remain harmless to old clients; revert only prompt-context Web UI/test hunks.
- Rollback uses exact bounded edits or a saved patch, never repository-wide checkout/reset, because unrelated work is present.

## Risks

- Shared target files already contain uncommitted stats-dashboard and unrelated component-update work; narrow edits and parent diff inspection are mandatory.
- Structured inventory can expose local metadata if not bounded/redacted; privacy checks are mandatory even though legacy text already carries some paths.
- Current-context attribution is heuristic; UI language must not imply provider-reported per-source accounting.
- Adding a fake-Pi browser fixture may overlap existing fixture behavior; it must be additive and deterministic.
- The installed Web UI optional dependency may still point to an older stats package during manual runtime use; browser fixtures must test the integrated contract without editing `node_modules`.
- Full Web UI suite may retain the known unrelated `mobile-static` failure; feature-specific evidence must remain separately inspectable.

## Decision record

- 2026-08-02: reclassified preliminary `lightweight` result to `complex` due producer/consumer contract, two workstreams, privacy bounds, and browser fixture scope.
- 2026-08-02: chose additive `promptContext` under payload v1; rejected payload v2 and browser parsing of legacy text.
- 2026-08-02: separated actual context utilization from estimated source composition; composition percentages use estimated totals.
- 2026-08-02: approved bounded/redacted structured inventory and independent section fallback.
- 2026-08-02: chose sequential shared-tree writers due current dirty repository state.
- Deferred: sorting/filter controls, persisted disclosure state, provider-reported source attribution, and release/version changes.

## Integration and validation record

- WS1 producer outcome: run `a58575af-af8f-48c1-a2ff-567614a07bff/0`, OpenAI Codex `gpt-5.6-sol:high`; handoff [`../handoffs/prompt-context-payload.md`](../handoffs/prompt-context-payload.md).
- Original WS2 Moonshot run `a58575af-af8f-48c1-a2ff-567614a07bff/1` and revival `42252031` were stopped after status/transcript/diff inspection confirmed no project/source edits; their incomplete artifact is retained for provenance.
- Redesigned WS2A UI core and WS2B test/fixture outcomes: run `5bb4f909-063a-43b5-9fdb-62d6ef74eab8`, OpenAI Codex `gpt-5.6-sol:high`, sequential shared-tree writers; handoffs [`../handoffs/prompt-context-webui-core.md`](../handoffs/prompt-context-webui-core.md) and [`../handoffs/prompt-context-tests.md`](../handoffs/prompt-context-tests.md).
- Parent inspected actual producer/consumer/test diffs and field parity. Existing stats-dashboard and component-update hunks remain present; no files are staged; only the main worktree remains.
- Producer suite: **10 passed, 0 failed**. Stats static VM contract: **1 passed, 0 failed**. Focused Chromium stats overlay: **5 passed, 0 failed**. Full Web UI suite: **100/100 test files passed**.
- Stats package dry run, producer/consumer syntax, `git diff --check`, no-staged-files, and worktree checks all passed. Standalone `tsc` remains unavailable without adding a dependency; type-stripped execution/tests pass.

## Progress and evidence

- [x] Repository and screenshot inspected.
- [x] Complex classification and design decisions recorded.
- [x] WS1 structured producer worker accepted.
- [x] WS2A native Web UI worker accepted.
- [x] WS2B browser/static hardening worker accepted.
- [x] Central integration checks pass.
- [ ] Two qualifying provider-diverse reviews completed.
- [x] Current reviewer findings dispositioned and accepted fixes revalidated.
- [ ] Final HTML report linked and current.

## Review capability gate

The required provider-diverse review quorum is **incomplete**. Multiple requests for Anthropic reviewers resolved at runtime to Moonshot Kimi instead:

- Gate attempts produced Kimi runs `2a28c053-48db-49ea-ac59-55926de12785`, `cdc08684-64a5-46de-a0dc-f9c2e41b69c2`, and stopped `b046674d-8d66-49ee-aefe-6fc41b5c4aa7`.
- Final explicit request `d692b245-3ae8-4d8a-b161-8d0298968a38` asked for `anthropic/claude-opus-4-8:high` plus Moonshot; runtime status confirms **both children resolved to `kimi-k3:high`**.

The available outputs are independent fresh-context read-only reviews, but they do not satisfy the complex contract's distinct-provider-family requirement. Completion and final report/archive remain blocked pending an explicit user-approved alternative or waiver.

## Reviewer findings and dispositions

| Source / severity | File or symbol | Finding | Disposition | Parent verification |
|---|---|---|---|---|
| Moonshot — Medium | `renderStatsRaw` | Raw `lines.tokenBreakdown` was not reachable from Command outputs for a valid structured payload. | **accepted** | Added native Command outputs section for `/stats tokens`; static and Chromium assertions pass. |
| Moonshot/other reviews — Low | `statsPromptCompositionTrack` | `role=img` aria-label could announce all 24 long labels. | **accepted** | Announcement is capped to six rows plus remainder count; full exact table remains. |
| Moonshot — Low | Inventory summaries | No scoped `:focus-visible` treatment. | **accepted** | Added Catppuccin focus outline; keyboard details test passes. |
| Review note — Low | Browser overflow | Populated desktop 1440×900 overflow was not explicitly asserted. | **accepted** | Added `expectNoPromptHorizontalOverflow` at 1440; 1440/390/320 checks pass. |
| Parent integration — Medium | Stats CSS typography | Four stats declarations were below the repository's 0.75rem interface floor. | **accepted** | Replaced with `var(--text-xs)`; full Web UI suite now passes 100/100, including `mobile-static`. |
| Review polish — Low | Composition bar legend | Colors have no separate visual legend, though aria-label, captions, and exact table carry all information. | **deferred** | Table is the primary exact legend and color is not the sole carrier; avoid duplicate density. |
| Review polish — Low | Null utilization progress | Null usage leaves an indeterminate native progress element with `n/a` text. | **deferred** | Semantically valid and explicit; no false numeric value is exposed. |
| Review note — Low | Legacy fallback scroll | Raw fallback retains the existing bounded `<pre>` scroller and lacks a narrow fallback-specific browser case. | **deferred** | Legacy compatibility path is intentionally raw; current native path has no nested scroller and is fully tested. |
| Review note — Info | Fake fixture zero component | Fixture includes a zero-token component filtered by the real producer. | **rejected** | Intentional consumer stress case proving real zero handling; no production contract claim. |
| Review note — Info | Exact total gate | Consumer falls back if initial component tokens do not exactly equal total. | **rejected** | Current producer guarantees exact integer allocation; fail-closed fallback is intentional. |
| Review note — Info | Legacy zero text | Legacy command line may display zero usage as `?`. | **deferred (out of scope)** | Pre-existing command-text behavior; structured native path correctly preserves zero. |

Accepted fixes were revalidated with producer 10/10, static 1/1, Chromium 5/5, full Web UI 100/100, syntax, whitespace, staging, and worktree checks.
