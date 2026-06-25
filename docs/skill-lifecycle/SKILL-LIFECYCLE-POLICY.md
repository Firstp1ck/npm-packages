# Skill Lifecycle Policy

Canonical rulebook for creating, updating, evaluating, merging, pruning, enabling, and publishing Pi skills in Firstpick's workspace.

## Principles

- Prefer improving an existing skill over creating a near-duplicate.
- Keep `AGENTS.md` lean; put detailed lifecycle rules in package-bundled docs and skill references.
- Keep personal/runtime observations out of reusable package repos.
- Generated, migrated, or edited skills are not trusted until evaluated.
- Destructive lifecycle actions are plans first, never automatic.

## Before Changing Skills

1. Check whether an existing enabled or installed skill already covers the task.
2. Read the matching `SKILL.md` before relying on or editing it.
3. Check personal per-skill memory if relevant:
   - `~/.pi/agent/memory/skills/<skill-name>.md`
4. Decide whether the durable knowledge belongs in:
   - a skill package (`SKILL.md`, `references/`, `scripts/`, `tests/`) for reusable workflow guidance;
   - per-skill memory for personal observations and failure modes;
   - `LEARNINGS` for troubleshooting outcomes;
   - `AGENTS.md` only for high-level operational rules.

## Create a Skill When

Create a new skill only when at least one is true:

- The same workflow has been repeated 3+ times.
- The task is expensive in tokens/time and likely to recur.
- A user correction reveals a reusable failure mode.
- A successful trajectory captures non-obvious procedural knowledge.
- Existing skills do not cover the scope without becoming vague or overloaded.

Do **not** create a skill when:

- The task is one-off.
- A current skill already covers it and can be updated instead.
- The solution depends on private one-time context.
- There is no realistic verification path and risk is high.
- The content belongs better in `AGENTS.md`, `MEMORY.md`, `LEARNINGS`, or package docs.

## Update or Refine a Skill When

Update an existing skill when:

- It matched the task but its instructions were incomplete, stale, ambiguous, or unsafe.
- A user correction exposes a reusable failure mode.
- New verification steps, scripts, references, or safety constraints are discovered.
- Routing is too broad/vague or fails to trigger for intended prompts.
- Referenced scripts, paths, or docs changed.

Prefer small, targeted edits. Preserve the skill's scope; split only when the workflow has become genuinely distinct.

## Merge Skills When

Propose a merge when:

- Two skills have overlapping triggers and compete during routing.
- One skill is a narrower or stale duplicate of another.
- Their workflows are usually invoked together and separation adds friction.

Merges require a written plan covering source skill, target skill, retained behavior, discarded behavior, verification, and rollback. Do not delete or disable the source skill without user confirmation.

## Prune or Retire Skills When

Propose pruning/retirement when a skill is:

- Obsolete, unsafe, unmaintained, or consistently unused.
- Duplicated by a better maintained skill.
- Too vague to route reliably after attempted refinement.
- Missing any practical verification path while carrying meaningful risk.

Pruning is non-destructive by default: recommend disable/archive steps first. Ask before deleting files, removing symlinks, changing settings, or publishing removals.

## Evaluation Gate Before Enabling

Before enabling any generated, migrated, or substantially changed skill, evaluate it.

Minimum manual gate when no automated evaluator exists:

- Frontmatter has valid `name` and specific `description` per Pi skill docs.
- The description clearly says when to use the skill and avoids broad catch-alls.
- `SKILL.md` includes workflow, safety/failure guidance, and verification where relevant.
- Referenced `scripts/`, `references/`, and assets exist and use paths relative to the skill directory.
- Commands are read-only or safe by default; destructive actions require explicit user confirmation.
- Any included tests/scripts are run, or skipped with a documented reason.
- At least one should-trigger and one should-not-trigger prompt are considered for routing quality.

Generated or migrated skills remain disabled until this gate passes, or the user explicitly accepts the risk.

## Confirmation Requirements

Ask the user before:

- Enabling or disabling skills in global/project Pi settings.
- Auto-enabling generated or migrated skills.
- Publishing skills or packages.
- Deleting, archiving, pruning, or removing skill symlinks.
- Running package install/link commands that affect the active Pi runtime/global npm prefix.

## Per-Skill Memory

Use append-only personal notes for observations that should improve future invocations without dirtying reusable package repos:

```text
~/.pi/agent/memory/skills/<skill-name>.md
```

Recommended entry format:

```md
## 2026-05-29 HH:MM UTC
- Observation: ...
- Failure mode: ...
- Next invocation hint: ...
- Verification: ...
```

Do not store secrets. Redact private context. Promote generally useful, verified workflow improvements from memory into the skill package later.

## Decision Record

For lifecycle changes, record at least:

- Action: create / update / merge / prune / evaluate / enable / publish.
- Reason and trigger.
- Evidence inspected.
- Verification run or intentionally deferred.
- Risks, rollback, and confidence.
