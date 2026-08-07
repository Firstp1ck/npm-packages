# Development guide: Repo Explorer

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Benchmark

From this package directory, run:

```bash
python3 skills/repo-explorer/scripts/benchmark_bash_usage.py \
  --json-out /tmp/repo-explorer-benchmark.json \
  --markdown-out /tmp/repo-explorer-benchmark.md
```

The benchmark is a deterministic executed strategy replay and event ledger over the bundled fixture corpus. It is not live/stochastic LLM telemetry and does not measure prompt adherence. Legacy and native-first independently execute the real refresh/build/extract/validate helpers in isolated caches; validated handoff contents and bounded adapter observations determine which required facts were retrieved. The event ledger separately models agent-visible attribution: legacy helper stages count as model-issued Bash, the native call counts as one model-visible `repo_explorer_explore` event, and native helper subprocesses are recorded as `model_issued: false` internal events and excluded from Bash counts.

Read `reduction.baseline_bash_calls` and `improved_bash_calls` as those modeled model-visible counts. Native follow-up is limited to an evidence `read` when the handoff explicitly omitted evidence for an already discovered file; inspect each strategy's `fallback_categories` and `events` for the gap, adapter result, exit code, and model/internal visibility. The reduction passes only when both strategies have valid handoffs, 100% final required-fact coverage, and 100% direct non-evidence coverage. `corpus_config_id` identifies the corpus digest, reduction threshold, and strategy versions; `result_content_digest_sha256` hashes the normalized result content.

## Effectiveness tracking

Each native tool invocation writes `skills/repo-explorer/repo-explorer-effectiveness-<timestamp>-<repo-key>.md`. Reports include tracking metadata, improvement signals, candidates, omitted counts, and manual downstream-feedback placeholders. To create a rollup improvement file from all reports:

```bash
python3 skills/repo-explorer/scripts/summarize_effectiveness_reports.py \
  --reports-dir skills/repo-explorer \
  --output skills/repo-explorer/repo-explorer-effectiveness-summary.md
```

## Additional implementation details

- Adds the `repo-explorer` skill to Pi's skill library.
- Adds the `repo_explorer_explore` tool for cached, validated, compact repository exploration.
- Guides agents to invoke the skill/tool before modifying unfamiliar codebases, answering where/how something is implemented, tracing dependencies, mapping repo structure, or planning changes.
- Bundles `skills/repo-explorer/SKILL.md`, `extensions/repo-explorer.ts`, and supporting scripts/tests.

The bundled Python scripts implement the native tool's indexing, extraction, validation, benchmark, and effectiveness-report support. Run them directly only to diagnose a native-tool failure or to execute package development validation. Diagnostic scripts do not constitute a separate routine exploration workflow. The target repository can be any readable local directory; native index state is stored under Pi's agent state directory.

```text
extensions/repo-explorer.ts
skills/repo-explorer/
  SKILL.md
  scripts/
    build_repo_index.py
    benchmark_bash_usage.py
    extract_explorer_handoff.py
    refresh_repo_index.py
    summarize_effectiveness_reports.py
    validate_handoff.py
  tests/
    fixtures/bash-usage-corpus/
```
