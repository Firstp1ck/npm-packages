---
name: repo-explorer
description: Agents should invoke this skill before modifying unfamiliar codebases, answering where/how something is implemented, tracing dependencies, mapping repo structure, or planning changes. Explores a repository and returns a strict JSON handoff with key files, symbols, risks, and evidence.
---

# Repo Explorer

## When to Use

Activate this skill when:

- A caller agent needs to understand a repository before implementing, reviewing, or designing
- The task includes "explore", "map", "find where X is", "understand the codebase"
- The caller should NOT spend their own context window on raw file reads and searches

## Workflow

### Step 1: Parse the Request

The caller provides a request (natural language or structured). Extract:

- **goal**: What does the caller need to know? (e.g., "find the auth flow")
- **target_paths**: Which repo/directory to explore (absolute paths)
- **depth**: `shallow` (structure only), `standard` (structure + key symbols), `deep` (full dependency tracing)
- **constraints**: Any filters (language, directory scope, file patterns)

If the request is natural language, infer these fields before proceeding.

### Step 2: Use the Native Tool for Routine Exploration

Call `repo_explorer_explore` first with `budget: "compact"` and `includeEvidence: false` unless the request already requires exact snippets. The native tool is the routine path: it refreshes or builds the index, performs budget-aware extraction, validates the handoff, writes the effectiveness report, and returns compact results in one agent-visible call.

Do not use Bash to preflight tool availability, refresh/build an index, run the helper sequence, or duplicate a successful native result. Tool availability is determined from the registered tool set. Bash is diagnostic-only after `repo_explorer_explore` is unavailable or an invocation fails; it is not an alternate routine exploration path.

When diagnosing a native failure, these helpers may reproduce the failing index stage:

```bash
python3 ./scripts/refresh_repo_index.py --repo "<target_path>" --data-dir data/
python3 ./scripts/build_repo_index.py --repo "<target_path>" --output data/<repo-name>-index.json
```

After diagnostics, report the native limitation or failure. Do not continue with broad shell exploration.

### Step 3: Follow Up Only on Explicit Gaps

Treat a valid native handoff as the exploration result; do not repeat it with broad searches. If its `explorer_limitations`, `errors`, or `omitted` metadata identifies a gap that blocks the stated goal:

1. Prefer another `repo_explorer_explore` call with a narrower target, `budget: "normal"`/`"full"`, or `includeEvidence: true` as appropriate.
2. If a precise fact is still missing, call the specialized non-shell `read`, `grep`, `find`, or `ls` tool directly and scope it to that reported gap.
3. Preserve the validated handoff, redaction rules, evidence bounds, and hard limits when reporting follow-up facts.

Do not use Bash as a targeted search fallback. Do not run any follow-up when the compact native result already answers the goal.

Depth semantics:

| Depth | Budget and behavior |
|---|---|
| `shallow` | Structure-first scan, up to 10 key files, no evidence snippets, no dependency tracing. |
| `standard` | Goal-focused scan, up to 25 key files, relevant symbols, internal dependency imports, up to 5 decisive snippets. |
| `deep` | Lower relevance threshold, full dependency import reporting including externals, up to 10 decisive snippets. |

Do NOT read entire files. Read only the sections relevant to the goal.

### Step 4: Keep the Handoff Validated

`repo_explorer_explore` assembles and validates the handoff automatically. Do not invoke the extractor or validator after a successful native call.

Only while diagnosing a native failure, reproduce the extraction/validation stage with the same compact-first parameters:

```bash
python3 ./scripts/extract_explorer_handoff.py \
  --index data/<repo-name>-index.json \
  --goal "<goal>" \
  --depth standard \
  --budget compact \
  --include-evidence false \
  --target-paths "<target_path>" \
  > /tmp/repo-explorer-handoff.json
python3 ./scripts/validate_handoff.py --input /tmp/repo-explorer-handoff.json
```

### Step 5: Write Effectiveness Report

After every repo-explorer invocation, save a Markdown effectiveness report in this skill directory:

```text
skills/repo-explorer/repo-explorer-effectiveness-<timestamp>-<repo-key>.md
```

The native `repo_explorer_explore` tool writes this report automatically and returns the path as `effectiveness_report`; failed invocations include the failure report path in the error. Diagnostic helper commands only reproduce a failed stage and do not replace the native invocation or its report.

The report must summarize:

- target path, goal, depth, budget, and whether evidence was requested
- tracking metadata: schema version, goal category, trace-goal flag, target repo key, and report purpose
- validation status and counts for indexed files, key files, symbols, dependencies, explorer limitations, target repository risks, errors, and evidence
- model-visible output counts, approximate output size, omitted item counts, and omission reasons
- improvement signals, improvement candidates, and downstream feedback placeholders for manual post-run notes
- an effectiveness assessment: `effective`, `partial`, `needs-follow-up`, or `failed`
- rationale plus split sections for explorer limitations, target repository risks, errors, validation failures, or invocation failure details

To roll up many per-invocation reports into an improvement Markdown summary, run:

```bash
python3 ./scripts/summarize_effectiveness_reports.py \
  --reports-dir . \
  --output repo-explorer-effectiveness-summary.md
```

### Step 6: Return

Return the validated handoff to the caller and include the effectiveness report path. Do not omit the report path.

---

## Input Schema

The caller provides (explicitly or inferred from natural language):

```json
{
  "goal": "string — what the caller needs to understand",
  "target_paths": ["string — absolute path(s) to explore"],
  "depth": "shallow | standard | deep",
  "budget": "optional — compact | normal | full",
  "includeEvidence": "optional boolean — collect snippet bodies only when needed",
  "constraints": {
    "languages": ["optional — filter by language"],
    "include_patterns": ["optional — glob patterns to include"],
    "exclude_patterns": ["optional — glob patterns to exclude"],
    "max_files": "optional — override default file limit"
  }
}
```

## Output Schema (Strict JSON Contract)

Return exactly this structure. All fields are required unless marked optional.

```json
{
  "schema_version": "1.0",
  "explorer": "pathfinder",
  "timestamp": "ISO-8601",
  "request": {
    "goal": "string — restated goal from caller",
    "target_paths": ["string"],
    "depth": "shallow | standard | deep"
  },
  "index_info": {
    "index_path": "string — path to persistent index used",
    "index_age_seconds": "number — seconds since last refresh",
    "files_indexed": "number — total files in index"
  },
  "task_understanding": "string — 1-3 sentences: what the caller needs and why, as understood by the explorer",
  "key_files": [
    {
      "path": "string — absolute path",
      "role": "string — why this file matters (entry point, config, core module, test, etc.)",
      "language": "string — file language/type",
      "lines": "number — total lines in file",
      "relevance": "high | medium",
      "confidence": "high | medium | low",
      "confidence_reason": "string — why this confidence level was assigned"
    }
  ],
  "relevant_symbols": [
    {
      "name": "string — function, class, type, or constant name",
      "kind": "function | class | type | constant | module | trait | interface",
      "file": "string — absolute path",
      "line_start": "number",
      "line_end": "number",
      "why": "string — why this symbol matters for the goal",
      "confidence": "high | medium | low",
      "confidence_reason": "string — why this confidence level was assigned"
    }
  ],
  "dependency_map": [
    {
      "source": "string — module or file that depends",
      "target": "string — module or file it depends on",
      "kind": "import | call | config | build"
    }
  ],
  "risks_and_unknowns": [
    {
      "description": "string — what is risky or unknown",
      "severity": "high | medium | low",
      "affected_files": ["string — paths"]
    }
  ],
  "next_actions_for_caller": [
    {
      "action": "string — concrete next step the caller should take",
      "target_agent": "string | null — which agent should handle it (null = caller themselves)",
      "priority": "high | medium | low"
    }
  ],
  "evidence": [
    {
      "file": "string — absolute path",
      "line_start": "number",
      "line_end": "number",
      "snippet": "string — relevant code (max 20 lines)",
      "context": "string — why this snippet is included",
      "confidence": "high | medium | low",
      "confidence_reason": "string — why this confidence level was assigned"
    }
  ],
  "errors": [
    {
      "code": "string — error code (insufficient_scope | index_stale | no_match | redacted_secret | budget_exceeded)",
      "message": "string — human-readable explanation"
    }
  ],
  "omitted": {
    "key_files": "optional number — ranked file candidates omitted by budget",
    "relevant_symbols": "optional number — ranked symbol candidates omitted by budget/diversity caps",
    "dependency_map": "optional number — dependency edges omitted by budget",
    "evidence": "optional number — evidence snippets omitted by budget or because evidence was not requested",
    "reasons": ["optional strings such as budget, symbol-diversity, user-did-not-request-evidence"]
  },
  "explorer_limitations": [
    {
      "code": "optional string — machine-readable limitation code, e.g. dependency_trace_empty",
      "message": "optional string — human-readable limitation",
      "severity": "optional high | medium | low"
    }
  ]
}
```

## Hard Limits

These limits are non-negotiable and enforced by the handoff validator:

| Field | Max Items | Notes |
|---|---|---|
| `key_files` | 25 | Prioritize by relevance to goal |
| `relevant_symbols` | 30 | Include only symbols the caller will need |
| `dependency_map` | 20 | Focus on goal-relevant dependency chains |
| `evidence` | 15 | Each snippet max 20 lines |
| `risks_and_unknowns` | 10 | Only substantive risks, not trivial warnings |
| `next_actions_for_caller` | 8 | Actionable and specific |

If raw exploration yields more items than the active budget or hard limit, rank by relevance to the stated goal, keep only the top items, and record counts/reasons in top-level `omitted` metadata. Use `budget_exceeded` only for legacy compatibility or when truncation itself prevents a useful handoff; ordinary bounded omission is not an explorer error.

## Redaction Rules

Before returning the handoff, scan all string fields for:
- API keys, tokens, passwords (patterns: `sk-`, `ghp_`, `AKIA`, `Bearer`, `token=`, password-like strings)
- Connection strings with credentials
- Private key material

Replace any matches with `[REDACTED]` and add a `redacted_secret` error entry.

## Error Codes

| Code | When |
|---|---|
| `insufficient_scope` | Target path doesn't exist or is inaccessible |
| `index_stale` | Index is older than 24 hours; results may be outdated |
| `no_match` | No files or symbols match the exploration goal |
| `redacted_secret` | Sensitive values were found and redacted |
| `budget_exceeded` | Legacy/blocking truncation case; ordinary bounded omission should be recorded in `omitted` instead |

## Safety

- Do not read entire repositories into context; use the index, targeted reads, and bounded evidence snippets.
- Redact secrets before returning handoffs or writing effectiveness reports.
- Effectiveness reports are local Markdown artifacts written under `skills/repo-explorer/`; they must not include raw secret values.
- Do not run destructive commands while exploring; use read-only indexing, search, and validation commands.
- Do not use routine Bash exploration. Bash is limited to diagnosing native-tool unavailability or failure; explicit handoff gaps use targeted non-shell tools.

## Benchmark Contract

From the package directory, run the bundled deterministic benchmark with:

```bash
python3 skills/repo-explorer/scripts/benchmark_bash_usage.py \
  --json-out /tmp/repo-explorer-benchmark.json \
  --markdown-out /tmp/repo-explorer-benchmark.md
```

This is an executed strategy replay and event-ledger measurement over the bundled fixtures, not live or stochastic LLM telemetry. Each strategy independently runs the real refresh/build/extract/validate helper stages in an isolated cache, and required facts are credited only from validated handoffs or bounded adapter observations. The ledger then applies modeled agent-visible attribution: legacy helper stages are model-issued `bash` events; native helper processes are `model_issued: false` internal events; and an allowed evidence-only follow-up is a model-issued `read` after an explicit evidence omission for an already discovered file.

Interpret `reduction.baseline_bash_calls` and `improved_bash_calls` as those modeled model-visible event counts. `scenarios[].strategies.*.fallback_categories` exposes initial gaps, while `events` records the executed follow-up result and whether it is model-visible or internal. The percentage passes only when both strategies have valid handoffs, complete final required-fact coverage, and complete direct non-evidence coverage. `corpus_config_id` identifies the corpus digest, threshold, and strategy versions; `result_content_digest_sha256` identifies the normalized result content. Neither field turns this fixture replay into a claim about model behavior.

## Verification

After changing this skill or its helper scripts, run:

```bash
python -m unittest discover -s pi-skill-repo-explorer/skills/repo-explorer/tests
```

Before enabling or publishing changes, also run the Pi skill evaluator when available:

```bash
skill_eval_run pi-skill-repo-explorer/skills/repo-explorer/SKILL.md
```
