# Repo Explorer Effectiveness Improvement Plan — 2026-06-20

## Scope

Evaluated `skills/repo-explorer/repo-explorer-effectiveness-*.md` reports in this package.

- Reports parsed: **88**
- Date range: **2026-06-09** to **2026-06-20**
- Report source: automatic `repo_explorer_explore` effectiveness reports
- Production behavior changed: **no**
- Native `repo_explorer_explore` intentionally not invoked for this evaluation, because it would create another effectiveness report and contaminate the dataset.

## Implementation status — completed in this change

Implemented the P0/P1 recommendations that were directly actionable in the package:

- budget-aware extraction via `--budget compact|normal|full`;
- evidence collection controlled by `--include-evidence true|false` and native `includeEvidence`;
- top-level `omitted` metadata for files, symbols, dependency edges, evidence, and reasons;
- ordinary symbol-budget omission no longer emits `budget_exceeded`;
- effectiveness reports now split explorer limitations from target repository risks;
- reports include model-visible counts, approximate output size, omitted counts, and omission reasons;
- trace-heavy goals with no dependency edges now record `dependency_trace_empty` as an explorer limitation;
- reports now include tracking metadata, improvement signals/candidates, and manual downstream feedback placeholders;
- `summarize_effectiveness_reports.py` can roll up per-run reports into a Markdown improvement summary;
- regression tests cover compact/no-evidence behavior, omitted symbol budgets, dependency-trace limitations, and effectiveness-summary generation.

Still not implemented: Tree-sitter/AST parsing, call-graph extraction, relative-path/path-ID schema compaction, and real-world TS/Python validation fixtures.

## Baseline checks

- `skill_eval_run` was not available on `PATH`.
- Current Python regression suite passes:

```text
python3 -m unittest discover -s pi-skill-repo-explorer/skills/repo-explorer/tests
..........
Ran 10 tests in 0.372s
OK
```

## Quantitative findings from the reports

### Outcome labels are dominated by non-blocking truncation

- Status: **88/88 completed**
- Handoff validation: **88/88 valid**
- Assessment labels:
  - **79 partial**
  - **8 effective**
  - **1 needs-follow-up**
- `budget_exceeded: relevant_symbols trimmed to 30`: **74/88** reports
- Reports with only `budget_exceeded` as the risk/error: **63/88**

This means the reports mostly say “partial” even when the handoff is valid and the only issue is expected bounded truncation.

### Output is frequently saturated

- `key_files == 25`: **58/88** reports
- `relevant_symbols == 30`: **74/88** reports
- both key files and symbols saturated: **57/88** reports
- median key files: **25**
- median symbols: **30**

The extractor often fills hard limits rather than returning a sharply ranked handoff. That weakens token efficiency and makes the report assessment less informative.

### Dependency mapping is usually absent

- `dependency edges == 0`: **47/88** reports
- `dependency edges == 0` for `standard`/`deep`: **41** reports
- median dependency edges: **0**

For many “flow”, “where is implemented”, and “trace” goals, zero dependency edges should either be explained or treated as an exploration limitation. Today the reports do not distinguish “no dependencies needed” from “dependency extraction missed the flow”.

### Evidence collection ignores model-visible evidence intent

- `Evidence requested in tool output: no`: **31** reports
- Evidence snippets still collected when output evidence was not requested: **24** reports
- Standard runs usually collect 5 snippets regardless of compact output.

`includeEvidence` currently affects model-visible formatting in `extensions/repo-explorer.ts`, not extraction work in `extract_explorer_handoff.py`. This can waste IO/time and makes report counts confusing: “Evidence snippets collected” can be nonzero even when no evidence was shown to the caller.

### Target repository risks are mixed with explorer effectiveness

- `[high] No test files found in repository`: **14** reports
- low test coverage warnings: **3** reports

These are useful caller risks, but they are not necessarily repo-explorer failures. Treating high target risks as `partial` makes the effectiveness label less about explorer quality.

## Root-cause hypotheses

1. **`budget_exceeded` is modeled as an error.**
   - `extract_explorer_handoff.py` appends an error when `relevant_symbols` reaches the 30-item hard limit.
   - `extensions/repo-explorer.ts::assessEffectiveness()` labels any non-empty `errors` set as `partial` unless it is `insufficient_scope`/`no_match`.

2. **Budget is only a display concern.**
   - The native tool accepts `budget: compact|normal|full`, but the extractor receives only `--depth`, not `--budget`.
   - `limitsFor()` trims the text returned to the model, while the handoff/report still reflect a fuller extraction.

3. **Evidence generation is only depth-driven.**
   - `extract_explorer_handoff.py` sets evidence limits from depth: shallow 0, standard 5, deep 10.
   - It does not know whether the caller requested evidence.

4. **Symbol ranking is still too permissive.**
   - Saturating symbols in 74/88 reports suggests weak thresholds, duplicate semantic hits, or insufficient per-file/type diversity constraints.

5. **Dependency extraction is too narrow for flow tracing.**
   - It is import-only, scans the first 200 lines, skips external dependencies except in `deep`, and only considers top files.
   - It does not report when dependency tracing was requested but produced no edges.

6. **The effectiveness report lacks downstream quality signals.**
   - Reports have counts, validation, risks, and errors, but no “did the caller use this?”, “which key file was edited?”, “false positive/negative?”, or “manual follow-up required?” fields.

## Recommended changes

### P0 — Make effectiveness labels meaningful

1. Move normal truncation out of `errors`.
   - Add top-level `omitted` metadata or an `info`/`warnings` section for bounded truncation:
     - `omitted.relevant_symbols`
     - `omitted.key_files`
     - `omitted.dependency_edges`
     - `omitted.reason`
   - Keep `budget_exceeded` as a blocking error only when truncation prevents a useful answer, e.g. no key files after trimming or validation cannot prove priority order.

2. Split report sections:
   - **Explorer health:** validation, no-match, stale index, redaction, saturation, dependency trace completeness.
   - **Target repo risks:** no tests, low test coverage, missing manifests, risky files.

3. Update `assessEffectiveness()` so:
   - `failed`: invocation failed or validation invalid.
   - `needs-follow-up`: no match, insufficient scope, stale index beyond threshold, or requested dependency/evidence mode produced none.
   - `partial`: valid handoff with meaningful explorer limitations.
   - `effective`: valid handoff with key files/symbols and no blocking explorer limitations, even if target repo has risks.

Acceptance target: budget-only reports should no longer become `partial` by default. Re-running the historical dataset should reduce “budget-only partial” from **63/88** to near zero.

### P0 — Propagate budget and evidence intent into extraction

Add extractor flags and pass them from the native tool:

```text
extract_explorer_handoff.py \
  --index <path> \
  --goal <goal> \
  --depth <depth> \
  --budget compact|normal|full \
  --include-evidence true|false \
  --target-paths <repo>
```

Behavior:

- `compact`: fewer symbols/deps by default, strong relevance thresholds, snippets disabled unless requested.
- `normal`: moderate limits, snippets only if requested.
- `full`: current hard-limit behavior, but with explicit omitted accounting.
- `includeEvidence=false`: do not read snippet bodies; line references are enough.

Acceptance target: reports with `Evidence requested in tool output: no` should show `Model-visible evidence: 0` and avoid collecting snippets unless the report explicitly records hidden handoff evidence as intentional.

### P1 — Stop filling hard limits with weak symbols

Improve `extract_explorer_handoff.py` symbol selection:

- Add per-file and per-kind diversity caps, e.g. max 5 symbols per file in compact/normal.
- Require stronger symbol score thresholds when many candidate files match.
- Deduplicate symbols with similar names from generated/compiled or nearby files.
- Prefer symbols in high-confidence key files.
- Penalize constants and generic modules unless goal terms match exactly.

Acceptance target: median `relevant_symbols` should drop materially below 30 while preserving expected key symbols in fixture tests.

### P1 — Report dependency tracing confidence

Enhance dependency extraction and reporting:

- Detect trace-heavy goals from words like `flow`, `trace`, `calls`, `implementation path`, `where is wired`, `imports`, `dependency`.
- For trace-heavy goals, if dependency edges are zero in `standard`/`deep`, add an explorer limitation:
  - `dependency_trace_empty: true`
  - short reason: no imports found, no internal imports resolved, files skipped, etc.
- Resolve more TS/JS cases:
  - side-effect imports: `import './x'`
  - dynamic imports: `import('./x')`
  - re-exports: `export * from './x'`
- Consider scanning complete small files instead of first 200 lines.

Acceptance target: zero dependency reports for trace-heavy goals should either contain useful edges or a clear limitation.

### P1 — Improve report schema for trend analysis

Add fields to each effectiveness report:

```markdown
## Model-Visible Output
- Key files shown: n/m
- Symbols shown: n/m
- Dependency edges shown: n/m
- Evidence snippets shown: n/m
- Approx output chars: n

## Omitted Items
- Key files omitted: n
- Symbols omitted: n
- Dependency edges omitted: n
- Evidence omitted: n
- Omission reason: budget | relevance-threshold | user-did-not-request-evidence

## Explorer Limitations
- None | list

## Target Repository Risks
- None | list
```

This makes future `repo-explorer-effectiveness-*` files easier to evaluate without parsing raw handoffs.

### P2 — Add feedback-loop fields

When the caller later edits files or reports a miss, capture optional feedback:

- `downstream_files_touched`: files edited/read after exploration
- `top_file_used`: yes/no/unknown
- `manual_search_needed`: yes/no/unknown
- `missed_files`: optional list
- `false_positive_files`: optional list

This can start as a manual section in reports or a separate local ledger. It is the missing signal for measuring true effectiveness rather than just schema validity.

## Proposed implementation sequence

1. **Report semantics first**
   - Change assessment logic and report sections in `extensions/repo-explorer.ts`.
   - Add extension-level tests or Python report-rendering fixtures if report generation is factored out.

2. **Budget-aware extraction**
   - Add `--budget` and `--include-evidence` to `extract_explorer_handoff.py`.
   - Pass both from `extensions/repo-explorer.ts`.
   - Update tests for compact/no-evidence behavior.

3. **Symbol ranking and omission metadata**
   - Add diversity caps and omitted accounting.
   - Update `test_extraction_reports_symbol_budget_trimming` so bounded omission is not treated as an error unless the contract says it is.

4. **Dependency trace limitations**
   - Add trace-goal detection and explicit limitation reporting for zero-edge traces.
   - Add TS fixture coverage for side-effect imports, dynamic imports, and re-exports.

5. **Historical report comparison script**
   - Add a small script under `skills/repo-explorer/scripts/` to summarize effectiveness reports.
   - Use it to compare before/after rates for partial labels, saturation, evidence collection, and zero dependencies.

## Regression tests to add or update

- Compact/no-evidence run does not collect snippet bodies.
- `budget_exceeded`/omitted symbols does not force `partial` when key files and validation are good.
- Target repo `No test files found` appears under target risks and does not alone make explorer effectiveness partial.
- Symbol output stays below compact thresholds for a fixture with many weakly related symbols.
- Trace-heavy goal with no dependency edges records an explicit explorer limitation.
- Effectiveness report includes model-visible counts and omitted counts.

## Success metrics

After implementation, a historical-report re-evaluation should show:

- budget-only partial reports: **63/88 → <10/88**
- median `relevant_symbols`: **30 → ideally <=12** for compact/standard
- evidence collected when `includeEvidence=false`: **24 reports → 0** unless explicitly recorded as hidden handoff evidence
- zero dependency trace reports: either fewer zero-edge traces or all zero-edge trace goals explain the limitation
- effective labels should correlate with explorer usefulness, not just absence of target repo test risks

## Files likely to change

- `pi-skill-repo-explorer/extensions/repo-explorer.ts`
  - `assessEffectiveness()`
  - `formatEffectivenessReport()`
  - extractor invocation in `execute()`
- `pi-skill-repo-explorer/skills/repo-explorer/scripts/extract_explorer_handoff.py`
  - CLI flags
  - `build_handoff()` budget/evidence behavior
  - symbol filtering and omitted metadata
  - dependency trace limitations
- `pi-skill-repo-explorer/skills/repo-explorer/tests/test_repo_explorer.py`
  - fixture tests for budget/evidence/report semantics
- Optional: `pi-skill-repo-explorer/skills/repo-explorer/SKILL.md`
  - document new report semantics and budget behavior after implementation

## Confidence

**86/100.** The quantitative findings are based on parsing all 88 local reports and inspecting the current implementation paths. Confidence is limited because the reports contain aggregate counts, not the full historical handoffs or downstream success/failure outcomes, so true relevance could not be fully measured.
