# Development guide: Subagent Governance

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Package contents

- `skills/subagent-governance/SKILL.md` — routing, scope boundary, reference router, and the portable workflow with the launch-blocking invariants inline.
- `skills/subagent-governance/references/WORKER-AND-REVIEW-CONTRACTS.md` — worker task and handoff contracts, integration supervision, reviewer request contract, and finding dispositions.
- `skills/subagent-governance/references/RETRY-AND-RECOVERY.md` — failure classification, live-child deduplication, attempt budgets, write safety, and quorum exhaustion.
- `skills/subagent-governance/references/PI-EXECUTION-ADAPTER.md` — the only Pi-specific file, including discovery, launch posture, local model defaults, retry helpers, and escalation.
- `skills/subagent-governance/tests/test_skill_contract.py` — standard-library contract test.
- `tests/routing/subagent-governance.json` — positive, negative, and ambiguous routing cases.

## Intended routing

Use when the parent is deciding whether to delegate, what to declare in a delegation request, how to keep concurrent writers safe, how to react to a failed or partial delegated run, or what to do with reviewer output. Do not route launch syntax and tool arguments, agent or workflow authoring, cost and status inspection without a pending decision, direct implementation work, or feature completion gates.

## Verification

```bash
cd <package-root>
npm test
node -e "JSON.parse(require('node:fs').readFileSync('tests/routing/subagent-governance.json', 'utf8')); console.log('routing JSON: PASS')"
npm pack --dry-run --json
```

Tests require Python 3.10+ and use only the standard library. The package has no npm runtime dependencies.
