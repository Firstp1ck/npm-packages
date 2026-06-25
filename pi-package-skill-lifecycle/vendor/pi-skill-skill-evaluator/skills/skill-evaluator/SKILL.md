---
name: skill-evaluator
description: Evaluate Pi and Agent Skills packages for frontmatter validity, routing description quality, required workflow/safety/verification sections, referenced scripts, destructive-command safeguards, optional routing fixtures, and runnable tests. Use when reviewing, enabling, publishing, or quality-gating skills.
---

# Skill Evaluator

## When to Use

Use this skill when a user asks to review, validate, publish, enable, or quality-gate Pi skills or Agent Skills-compatible `SKILL.md` directories.

Good triggers include:

- "Evaluate this skill before I enable it."
- "Run a quality gate on all enabled skills."
- "Check whether this skill has valid frontmatter, safety language, scripts, and tests."
- "Add or review routing fixtures for skills."

## Lifecycle policy

When evaluation informs skill enablement, publishing, pruning, or merge/update decisions, read the bundled package policy at `../../../../references/SKILL-LIFECYCLE-POLICY.md` when available.

## Workflow

1. Resolve the target skill path. For one skill, use a `SKILL.md` file or its parent directory.
2. Prefer the native Pi tools when available:

   - `skill_eval_run` for one skill.
   - `skill_eval_all` for discovered or enabled skills.

3. Otherwise run the CLI evaluator:

   ```bash
   skill_eval_run /path/to/skill/SKILL.md --json-output /tmp/skill-eval.json --markdown-output /tmp/skill-eval.md
   ```

4. For all skills in an explicit root without reading user Pi settings, run:

   ```bash
   skill_eval_all --no-settings --skill-root /path/to/skills --json-output /tmp/skill-eval-all.json --markdown-output /tmp/skill-eval-all.md
   ```

For active-environment coverage, pass the target Pi agent directory explicitly:

   ```bash
   skill_eval_all --enabled-only --agent-dir /path/to/pi-agent-dir --json-output /tmp/skill-eval-all.json --markdown-output /tmp/skill-eval-all.md
   ```

5. Treat JSON as the machine-readable source of truth and Markdown as the human review report.
6. Fix blocking failures before enabling, publishing, or depending on the skill. Warnings are not blocking but should be reviewed.
7. If the user asks for test conventions, read `references/TEST-CONVENTIONS.md`.

## Verification

Use the package test suite after modifying the evaluator:

```bash
cd <lifecycle-package-root>/vendor/pi-skill-skill-evaluator
npm test
```

Pilot checks against fixture or installed skills:

```bash
skill_eval_run /path/to/skills/repo-explorer/SKILL.md
skill_eval_run /path/to/skills/patch-md/SKILL.md
skill_eval_run /path/to/skills/learnings/SKILL.md
```

## Safety and Failure Modes

- The evaluator is read-only for skill source files.
- Running bundled skill tests can execute code from the target skill. Use `--skip-tests` for untrusted third-party skills or inspect tests first.
- Destructive command checks are heuristic. Treat failures as review gates, not proof of malicious intent.
- Pi allows skill names to differ from parent directories; the evaluator warns instead of failing on that Agent Skills portability issue.
- Git or remote package discovery may be incomplete if a package source cannot be resolved to a local install path.

## Output Expectations

A successful run returns:

- JSON with `summary`, per-skill `status`, `failures`, `warnings`, and `info`.
- Markdown with a summary table and per-skill issue details.
- Exit code `0` when there are no blocking failures.
- Exit code `1` when one or more blocking failures are present.
