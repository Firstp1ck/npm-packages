# Development guide: Deep Research

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `deep-research` skill to Pi's skill library.
- Guides agents to invoke the skill for high-stakes or complex research needing multi-source evidence, scientific/technical fact-checking, decision traces, or rigorous verification. The runner provides policy-driven classification and lightweight output checks.
- Bundles `skills/deep-research/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.

## Preserved implementation and format details

A Pi skill for high-stakes or complex research needing multi-source evidence, scientific/technical fact-checking, decision traces, or rigorous verification. Classification and ordering are stable for equivalent normalized evidence, while timestamps and run IDs vary.

## Expected usage structure

The skill bundles policy, JSON Schema, tests, fixtures, and a runner script. It does not ship initialized run state.

Bundled layout:

```text
skills/deep-research/
  SKILL.md
  policy.json
  output-schema.json
  scripts/run_deep_research.py
  tests/test_determinism.py
  tests/fixtures/
```

Create an initialized state file before manual use. The package tests define the current initial shape:

```json
{
  "last_run": null,
  "runs": [],
  "claim_canonicalization": {},
  "source_dedupe_fingerprints": [],
  "metadata": {
    "policy_version": "1.0.0",
    "schema_version": "1.0.0",
    "created_at": null,
    "updated_at": null
  }
}
```

Then invoke the actual parser interface:

```bash
cd /path/to/installed/package/skills/deep-research
python3 ./scripts/run_deep_research.py \
  --topic "Research topic" \
  --claims-file /path/to/claims.json \
  --evidence-file /path/to/evidence.json \
  --policy ./policy.json \
  --schema ./output-schema.json \
  --state /path/to/state.json \
  --output-json /path/to/output.json \
  --output-md /path/to/output.md
```

The runner’s `validate_output` function performs lightweight checks for selected required fields, ID syntax, verdict values, and key nested fields. It does not implement full JSON Schema Draft-07 validation. Reproducibility tests normalize time-varying IDs/timestamps before comparing semantic output.

## Verification

```bash
python3 skills/deep-research/tests/test_determinism.py
npm pack --dry-run --json
```

Normal skill use has no package-specific user configuration. Manual runner use requires the initialized external state file and input artifacts described above.
