---
name: skill-creator
description: Use when drafting new reusable Pi/Agent Skills from repeated successful workflows, troubleshooting trajectories, notes, or PATCH.md files. Enforces reusability checks, writes disabled drafts, adds contract tests when possible, and asks before enablement.
---

# Skill Creator

Create Pi-native Agent Skills from successful repeated work without prematurely enabling unreviewed drafts.

## Critical Correction to the Original Plan

Do **not** write drafts under `~/.pi/agent/skills/drafts/` by default. Pi recursively discovers `SKILL.md` files under `~/.pi/agent/skills/`, so that path can accidentally expose drafts as available skills. Use this package's safe default instead:

```text
~/.pi/agent/drafts/skills/<skill-name>/SKILL.md
```

Only write under an auto-discovered skill root after explicit user approval and a review decision.

## Lifecycle policy

Before drafting, enabling, publishing, or moving skills, read the bundled package policy at `../../../../references/SKILL-LIFECYCLE-POLICY.md` when available. Use `references/SKILL-PORTABILITY.md` for portable skill authoring rules and `references/SKILL-QUALITY-GUIDE.md` for predictable, low-sprawl skill design. For the full upstream vocabulary and rationale, consult the vendored `references/writing-great-skills/SKILL.md` and `references/writing-great-skills/GLOSSARY.md` reference.

## When to Use

Use this skill when the user wants to create a new skill from:

- A repeated workflow that succeeded at least three times.
- An expensive or high-risk workflow worth standardizing after one strong success.
- Troubleshooting notes, LEARNINGS notes, or a `PATCH.md` that describe a reusable procedure.
- A Pi package maintenance workflow that should become a portable Agent Skill.

Do **not** create a skill when the task is one-off, vague, unverified, or better captured as a short memory note.

## Reusability Gate

Before drafting, confirm one of these is true:

1. The workflow has been reused successfully at least three times.
2. The workflow is expensive/risky enough that standardizing it prevents meaningful future cost.
3. The workflow is strategically likely to recur across packages/projects.

If none is true, recommend a note or LEARNINGS entry instead of a skill.

## Workflow

1. **Collect source evidence**
   - Read the successful trajectory, notes, `PATCH.md`, or relevant files.
   - Verify the source describes an outcome that actually worked.
2. **Confirm reusability**
   - Record the reusability class and concise evidence.
   - Stop if the workflow is not reusable enough.
   - For portable skills, follow `references/SKILL-PORTABILITY.md`.
3. **Design for predictability**
   - Decide whether the draft should be model-invoked or user-invoked.
   - Identify leading words, trigger branches, should-trigger examples, and should-not-trigger examples.
   - Keep ordered actions inline; disclose long or branch-specific reference through `references/*.md`.
   - Ensure each workflow step has a checkable completion criterion.
   - Prune no-ops, duplicated meanings, stale source sediment, and sprawl using `references/SKILL-QUALITY-GUIDE.md`; consult `references/writing-great-skills/` when the concise guide is insufficient.
4. **Draft the skill**
   - Prefer the `skill_create_draft` tool when available.
   - Otherwise run `node ./scripts/skill_create_draft.mjs` from this skill directory.
   - Default to `~/.pi/agent/drafts/skills/<skill-name>/`.
5. **Add fixtures/tests when possible**
   - Use `--with-tests` or tool parameter `withTests: true` for a basic contract test.
   - Include only sanitized, non-secret source snippets as fixtures.
6. **Validate**
   - Run the generated contract test.
   - Run `skill_eval_run <draft>/SKILL.md` if the skill evaluator is installed.
   - If the evaluator is absent, use the built-in draft validation output and clearly report that the external evaluator is unavailable.
7. **Review before enabling**
   - Do not symlink, install, or add the draft to settings automatically.
   - Ask the user before moving a draft into `~/.pi/agent/skills/` or enabling a package.

## Tool Usage

### Draft from notes

```bash
node ./scripts/skill_create_draft.mjs \
  --name example-repeatable-workflow \
  --source-notes /tmp/example-successful-trajectory.md \
  --reusability repeated-3-plus \
  --reusability-evidence "Used successfully for three similar tasks." \
  --invocation model \
  --leading-word repeatable \
  --branch "successful workflow reuse" \
  --with-tests
```

### Draft package skeleton

```bash
node ./scripts/skill_create_draft.mjs \
  --name example-repeatable-workflow \
  --source-notes /tmp/example-successful-trajectory.md \
  --reusability strategic-reuse \
  --reusability-evidence "Expected to recur across Pi package maintenance work." \
  --package-skeleton \
  --output /tmp/pi-skill-example-repeatable-workflow \
  --with-tests
```

## Draft Quality Contract

Every generated `SKILL.md` must include:

- Valid frontmatter with lowercase hyphenated `name` and a specific `description`.
- Deliberate invocation mode, including `disable-model-invocation: true` for user-invoked drafts.
- `## When to Use` with concrete trigger and non-trigger guidance.
- `## Invocation Design` with leading words, branches, and trigger examples.
- `## Workflow` with checkable completion criteria for each step.
- `## References` for progressive disclosure decisions.
- `## Verification`.
- `## Quality Review` covering no-ops, duplication, sediment, and sprawl.
- `## Safety and Failure Modes`.
- No hardcoded private home paths unless the draft is explicitly marked Pi-local.
- A clear note that the draft is not enabled automatically.

## Verification

For this package:

```bash
cd <package-root>
npm test
```

For a generated draft with tests:

```bash
python3 -m unittest discover -s <draft-dir>/tests -p 'test_*.py'
```

If the skill evaluator is installed:

```bash
skill_eval_run <draft-dir>/SKILL.md
```

## Safety and Failure Modes

- Never auto-enable a generated draft.
- Never write drafts into Pi's discovered skill roots without explicit approval.
- Do not store secrets in fixtures, generated skills, or source excerpts.
- Sanitize private paths such as `/home/<user>/...` to `~/...` for portable drafts.
- Stop and ask for clarification when the source artifact does not contain a clear, successful workflow.
- Prefer a memory note or LEARNINGS note when a workflow is not reusable enough.
