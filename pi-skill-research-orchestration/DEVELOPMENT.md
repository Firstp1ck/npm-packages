# Development guide: Research Orchestration

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `research-orchestration` skill to Pi's skill library.
- Guides agents to invoke the skill for broad multi-claim research projects needing planning, parallel investigation, source merging, gap closure, citation audit, and final synthesis when narrower research skills are insufficient.
- Bundles `skills/research-orchestration/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.

## Preserved package internals

A Pi skill for broad multi-claim research projects needing planning, parallel investigation, source merging, gap closure, citation audit, and final synthesis when narrower research skills are insufficient.

## Install

```bash
pi install npm:@firstpick/pi-skill-research-orchestration
```

## Configuration

No required configuration.

## Bundled helper scripts

This package ships the `research-orchestration` skill plus its scout helper scripts:

```text
skills/research-orchestration/
  SKILL.md
  scripts/
    README.md
    policy.json
    scout_query_plan.py
    scout_normalize_sources.py
    scout_evidence_bundle.py
    scout_citation_audit.py
    _lib/
      normalize.py
```

Run helpers from `skills/research-orchestration/` or use absolute paths. By default, scripts read `./scripts/policy.json`; pass `--policy /path/to/policy.json` to override.

Examples:

```bash
python3 ./scripts/scout_query_plan.py --topic "local-first AI notes" --task-class standard -o query-plan.json
python3 ./scripts/scout_normalize_sources.py --input sources.json -o normalized-sources.json
python3 ./scripts/scout_evidence_bundle.py --input fetch-records.jsonl -o evidence_bundle.json
python3 ./scripts/scout_citation_audit.py --report final-report.json
```

## Helper interfaces

The package exposes no top-level CLI or model tool. The four Python helper CLIs documented above are contributor/integration entry points.

## Example view

```text
User: Research a platform decision across security, cost, developer experience, and operations. Merge the evidence and audit the final citations.
Agent: Splits the investigation into bounded facets, closes material gaps, and produces one cited synthesis.
```
