---
name: skill-refinement-loop
description: Use when a Pi skill receives a user correction, fails a test, produces unsafe/low-quality output, or should be improved from runtime feedback. Creates structured per-skill memory plus PATCH.md-style refinement proposals via skill_refinement_plan without mutating production skill behavior.
---

# Skill Refinement Loop

## When to use

Use this skill when the issue is with a **Pi skill or skill routing/workflow**, for example:

- The user says a skill should have behaved differently.
- A skill-specific test, routing fixture, or evaluator check fails.
- A skill omits required evidence, safety checks, verification, or citations.
- Runtime feedback reveals a reusable failure pattern worth preserving.

Do **not** use this for ordinary application bugs unless the bug is caused by a skill's instructions, scripts, routing, or validation behavior.

## Lifecycle policy

Before proposing production skill edits, enablement, pruning, publishing, or risky lifecycle changes, read the bundled package policy at `../../../../references/SKILL-LIFECYCLE-POLICY.md` when available.

## Critical implementation notes

The original MUSE task recommends Task 2 (per-skill memory tools) and Task 3 (skill evaluator) as dependencies. Those may not exist yet. This package deliberately handles that inconsistency with safe fallbacks:

- Per-skill memory is appended directly to `~/.pi/agent/memory/skills/<skill>.md`.
- `skill_eval_run` is treated as optional; include it in verification when available, otherwise use package tests plus hand-inspected routing checks.
- Production skill files are never edited by the tool. The tool writes a proposal file and memory only.

## Workflow

1. Identify the affected skill and the exact correction/failure.
2. Collect evidence: user quote, failing command/test output, prompt, file path, or observed behavior.
3. Call `skill_refinement_plan` with the skill name, failure, evidence, root-cause hypothesis if known, and a regression test proposal.
4. Review the generated PATCH.md-style proposal.
5. Add/update regression coverage if possible; if not possible, document why.
6. Run the skill evaluator if installed; otherwise run the package's tests and inspect routing/contract behavior by hand.
7. Apply source changes only after validation and user approval for risky edits.

## Tool usage

Prefer the tool for repeatable, structured output:

```text
skill_refinement_plan(
  skill="repo-explorer",
  failure="The skill should have used includeEvidence=true because exact code citations were requested.",
  evidence=["User correction after repo-explorer compact output omitted exact snippets."],
  rootCauseHypothesis="The workflow does not explicitly escalate includeEvidence when exact citations are requested.",
  patchSummary="Update repo-explorer SKILL.md to require includeEvidence=true for exact code citation requests.",
  regressionTest="Add a routing/contract fixture asserting citation-heavy prompts require includeEvidence=true."
)
```

By default the tool:

- Appends memory to `~/.pi/agent/memory/skills/<skill>.md`.
- Writes the proposal to a unique `/tmp/skill-refinement-<skill>-<timestamp>.md` file.
- Refuses to overwrite an explicit `outputPath` unless `overwrite=true`.

Use `dryRun=true` to preview without writing files.

## Required proposal content

Every refinement plan should include:

- Evidence.
- Root cause hypothesis.
- Patch summary.
- Regression test proposal or explicit "not applicable" rationale.
- Verification steps.
- Safety note that production skill behavior is not changed automatically.

## Safety boundaries

- Do not edit `SKILL.md`, scripts, tests, or package metadata as part of refinement planning.
- Do not treat a generated proposal as approval to apply it.
- Ask before risky/destructive edits, publishing, package enablement, or changing global Pi runtime installs.
- Keep per-skill memory short and avoid secrets.

## Verification

After creating a plan, verify:

```bash
# Proposal exists and is reviewable
ls -l /tmp/skill-refinement-*.md

# Per-skill memory was appended
ls ~/.pi/agent/memory/skills

# If available
skill_eval_run <skill-package>/skills/<skill>/SKILL.md
```

If `skill_eval_run` is unavailable, run the package's own tests (for example `npm test`, `bun test`, or package-specific mock tests) and inspect the skill's routing/workflow language by hand.
