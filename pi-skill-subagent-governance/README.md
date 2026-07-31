# @firstpick/pi-skill-subagent-governance

Portable Agent Skill package for a parent orchestrator that is about to delegate work, replace a failed delegated run, or accept delegated results. It decides which delegation shapes are admissible and which evidence is required, without duplicating any harness's delegation mechanics or claiming runtime enforcement.

## Governance versus mechanics

This skill controls **admissibility**: whether delegation is allowed at all, how many children of which kinds may be declared, who may write, what a worker must be told, what a handoff must return, when a replacement launch is legal, and how a reviewer finding is dispositioned.

The harness's own delegation documentation controls **runtime mechanics**. In Pi, the installed `pi-subagents` skill remains canonical for tool schemas, actions, execution and context modes, authoring, configuration, and error handling. The two are complementary; this package neither restates nor overrides that skill.

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

## Install or enable

This package is intentionally **not installed or enabled automatically**. Creation, review, and packaging change no runtime configuration, no settings file, and no active prompt policy. Model-invoked guidance is also not a runtime guard: it does not block a tool call, and any existing enforcement in the host environment remains separate and authoritative. If a later explicit authorization approves installation, use the selected harness's package-install procedure. In Pi, that procedure is described in `skills/subagent-governance/references/PI-EXECUTION-ADAPTER.md`.
