# Technical reference: Research Orchestration

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-skill-research-orchestration
```

The workflow expects host-provided web search/fetch tools plus `workspace-researcher/AGENTS.md` and the applicable host policy. When those files or tools are absent, provide sources directly and treat the affected steps as blocked rather than assuming they ran.

## When to use it

Use this skill for broad research that contains several important questions, requires multiple evidence passes, or needs a final citation audit. Narrow questions are usually better served by a smaller research workflow.

## What to provide

- The decision or final report the research should support
- The major questions that must be answered
- Required source quality and date range
- Geographic, legal, scientific, or product boundaries
- The acceptable level of remaining uncertainty

## What the result includes

- A research plan split into distinct claims
- Combined evidence without duplicate source work
- Follow-up work for missing or weak evidence
- A final source and citation check
- A synthesis that keeps disagreements and uncertainty visible

## Storage and limitations

When available, the workflow appends a research-history row to `workspace-researcher/MEMORY.md`. Ask for report-only output when you do not want that persistent write.

A broad workflow can still be limited by missing host files/tools or inaccessible and weak sources. Citation checks confirm that a source supports a claim; they do not guarantee that the source itself is correct.

The packaged helper scripts and their file formats are contributor information documented in `DEVELOPMENT.md`.
