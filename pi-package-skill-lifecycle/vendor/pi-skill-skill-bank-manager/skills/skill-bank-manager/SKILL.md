---
name: skill-bank-manager
description: Audit and manage the local Pi skill bank. Use when inventorying enabled or installed skills, checking stale or duplicate skill scopes, producing read-only prune/merge/update plans, or validating skill lifecycle hygiene.
metadata:
  validation: "Use skillbank_audit and npm test before trusting recommendations. Prune and merge output is plan-only."
---

# Skill Bank Manager

Use this skill when the user asks to audit, inventory, improve, merge, prune, or evaluate the local Pi skill ecosystem.

## Lifecycle policy

For create/update/merge/prune/enable/publish decisions, read the bundled package policy at `../../../../references/SKILL-LIFECYCLE-POLICY.md` when available. Do not rely on a separate workspace-local copy.

## Tools

- `skillbank_audit` — read-only full audit; writes `/tmp/pi-skill-bank-audit.md` by default.
- `skillbank_find_overlap` — reports likely duplicate skill scopes from names/descriptions.
- `skillbank_prune_plan` — emits merge/update/prune recommendations as a plan only.
- `skillbank_run_tests` — defaults to a read-only test plan; only executes tests when `run=true` is explicit.

## Workflow

1. Run `skillbank_audit` first.
2. Read the generated report path before making claims about the local skill bank.
3. Treat missing `tests/`, `scripts/`, `references/`, and validation metadata as signals, not automatic failures.
4. Review overlap groups critically; token overlap can produce false positives for related but distinct skills.
5. Do not edit, remove, merge, or prune skills unless the user explicitly approves a follow-up implementation step.

## Verification

For package development from this skill directory:

```bash
(cd ../.. && npm test)
bun ../../scripts/skillbank-audit.ts /tmp/pi-skill-bank-audit.md
pi --version
```

Manual evidence checks should use the target environment's selected agent directory/settings file, not a maintainer-specific config. For isolated tests, set `PI_CODING_AGENT_DIR` to a temporary fixture directory before running the audit.

## Safety Boundaries

- The audit tools are read-only with respect to skill/package files.
- Writing Markdown reports to `/tmp` or a user-provided output path is allowed.
- Prune/merge recommendations are never permission to mutate files.
- `skillbank_run_tests` may execute package scripts only when `run=true`; keep it in plan mode by default.
