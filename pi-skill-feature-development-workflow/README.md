# @firstpick/pi-skill-feature-development-workflow

Portable Agent Skill package for new feature implementation work. It helps an agent classify a requested feature as lightweight or complex, preserve blocking decision and completion gates, and use a proportionate workflow without treating model-invoked guidance as runtime enforcement.

## Package contents

- `skills/feature-development-workflow/SKILL.md` — routing, portable workflow, lightweight path, safety rules, and Pi mapping.
- `skills/feature-development-workflow/references/COMPLEX-FEATURE-CONTRACT.md` — canonical-plan, implementation, integration, review, report, waiver, and complex-completion requirements.
- `skills/feature-development-workflow/tests/test_skill_contract.py` — standard-library contract test.
- `tests/routing/feature-development-workflow.json` — positive, negative, and ambiguous routing cases.

## Intended routing

Use for a user-authorized request to add a new product or system capability where implementation workflow governance is needed. Do not route bug fixes, refactors, documentation-only or test-only work, planning/research/review alone, troubleshooting, operations, or questions that do not request feature delivery.

## Verification

```bash
cd <package-root>
npm test
node -e "JSON.parse(require('node:fs').readFileSync('tests/routing/feature-development-workflow.json', 'utf8')); console.log('routing JSON: PASS')"
npm pack --dry-run --json
```

Tests require Python 3.10+ and use only the standard library. The package has no npm runtime dependencies.

## Install or enable

This package is intentionally **not installed or enabled automatically**. Creation, review, and packaging do not change any runtime configuration. If a later explicit authorization from the user approves installation, use the selected harness's package-install procedure. In Pi, that procedure is described in `SKILL.md` under **Pi Adapter**.
