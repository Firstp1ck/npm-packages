# @firstpick/pi-skill-repo-explorer

A Pi skill for use before modifying unfamiliar codebases, answering where/how something is implemented, tracing dependencies, mapping repo structure, or planning changes. Explores a repository and returns a strict JSON handoff with key files, symbols, risks, and evidence.

## What it does

- Adds the `repo-explorer` skill to Pi's skill library.
- Adds the `repo_explorer_explore` tool for cached, validated, compact repository exploration.
- Guides agents to invoke the skill/tool before modifying unfamiliar codebases, answering where/how something is implemented, tracing dependencies, mapping repo structure, or planning changes.
- Bundles `skills/repo-explorer/SKILL.md`, `extensions/repo-explorer.ts`, and supporting scripts/tests.

## Install

```bash
pi install npm:@firstpick/pi-skill-repo-explorer
```

## Configuration

No required configuration.

## Native-first usage

`repo_explorer_explore` is the routine exploration path. Agents should invoke it directly with the compact defaults instead of issuing Bash calls to refresh/build the index or run the extraction/validation helper sequence. A valid native result should not be duplicated with broad shell searches.

If a validated handoff explicitly reports a blocking limitation, error, or omission, first narrow or expand another native call. For a still-missing precise fact, use the specialized non-shell `read`, `grep`, `find`, or `ls` tool directly. Bash is diagnostic-only when the native tool is unavailable or an invocation fails; it is not a routine or targeted-search fallback.

The bundled Python scripts implement the native tool's indexing, extraction, validation, benchmark, and effectiveness-report support. Run them directly only to diagnose a native-tool failure or to execute package development validation. Diagnostic scripts do not constitute a separate routine exploration workflow. The target repository can be any readable local directory; native index state is stored under Pi's agent state directory.

Bundled layout:

```text
extensions/repo-explorer.ts
skills/repo-explorer/
  SKILL.md
  scripts/
    build_repo_index.py
    benchmark_bash_usage.py
    extract_explorer_handoff.py
    refresh_repo_index.py
    validate_handoff.py
  tests/
    fixtures/bash-usage-corpus/
```

## Commands

None.

## Tools

- `repo_explorer_explore`: the routine native path to build/refresh a local repo index, extract a budget-aware goal-focused handoff, validate it, write an effectiveness report with omitted counts, improvement signals, downstream feedback placeholders, and limitations, then return compact model-visible results. Defaults to `budget: "compact"` and no evidence snippets.

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

## Example view

```text
User: Review this change for the concerns covered by `repo-explorer`.
Agent: Invokes the `repo-explorer` skill, follows its workflow, and reports the result.
```
