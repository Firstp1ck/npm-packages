---
name: subagent-governance
description: Delegation admissibility governance for a parent orchestrator. Use when deciding whether to launch, sequence, replace, or accept one or more delegated child runs while preserving role fit, plan-backed worker contracts, one-writer isolation, bounded retry safety, and reviewer finding disposition. Covers admissibility only; a harness keeps its own runtime mechanics documentation.
license: MIT
compatibility: Portable Agent Skills-style skill for a parent orchestrator. The portable core requires no harness-specific tool. Launch syntax, action names, context modes, and runtime behavior stay owned by the harness's own delegation documentation.
---

# Subagent Governance

Use this skill in the **parent orchestrator session** before delegating work to child agents, before replacing a child that did not deliver, and when accepting delegated results. It decides which delegation shapes are allowed and which evidence is required. It is guidance, not a runtime guard: loading it does not install a package, enable an integration, change settings, or block a tool call.

## Scope and Boundary

- **This skill controls admissibility.** Whether delegation is allowed at all, how many children of which kinds may be declared, who may write, what a worker must be told, what a handoff must return, when a replacement launch is legal, and how a reviewer finding is dispositioned.
- **The harness's delegation documentation controls runtime mechanics.** Tool schemas, action names, launch/monitor/wait syntax, context modes, agent and chain authoring, configuration, and error handling. In Pi, the installed `pi-subagents` skill remains canonical for those mechanics; this skill does not restate, replace, or override it, and it is not a second mechanics reference.
- **Parent-only.** Do not inject or follow this skill inside a spawned child. A child does not own delegation, fanout, integration, or completion decisions. The one exception is a child that the parent explicitly assigned bounded fanout; it stays inside that assignment.
- Admissibility and runtime success are independent. An admissible shape can still fail at runtime, and no runtime capability, convenience command, or saved workflow makes a noncompliant shape admissible.

## When to Use

Use when the parent is deciding whether to delegate, what to declare in a delegation request, how to keep concurrent work safe, how to react to a failed or partial delegated run, or what to do with reviewer output.

Do not use for:

- Launch syntax, tool arguments, action names, context modes, scheduling, or error messages — those belong to the harness's mechanics documentation.
- Creating, editing, disabling, or ejecting agents and saved workflows.
- Cost, usage, or status inspection with no pending delegation decision.
- Work the parent should simply do itself, such as a direct edit, a direct answer, or a single-file fix.
- Feature scope, plan structure, completion gates, or report obligations, which belong to the feature workflow policy in use.

### Should trigger

- "Split this migration across several agents before anyone starts writing."
- "One delegated run failed mid-call — decide what to relaunch without touching the runs still going."
- "Two implementation runs finished; decide how to integrate them and what review they need."
- "Reviewers disagree about this integrated change; decide what to accept before a fix pass."

### Should not trigger

- "What arguments does the delegation tool take for a scheduled run?"
- "Create a new custom agent file with a different model and thinking level."
- "Show the token cost of the last background runs."
- "Fix the null check in the auth module."
- "Write the final HTML report for the finished feature."

### Ambiguous requests

"Delegate this to an agent" mixes an admissibility question with a mechanics question. Resolve admissibility here first — including whether delegating at all is allowed — then use the harness's mechanics documentation to express the approved shape.

## Invocation Design

- Invocation mode: model-invoked after explicit package enablement.
- Leading concept: **delegation admissibility governance**.
- Deliberately named `subagent-governance` so it does not collide with, shadow, or substitute for a harness mechanics skill such as `pi-subagents`.
- Creation of this package is inert. Review it before any later installation or enablement, which requires explicit authorization.

## Reference Router

Read the matching reference before acting. Paths are relative to this `SKILL.md`.

| Situation | Read |
| --- | --- |
| Writing a worker task, checking a returned handoff, supervising integration, or dispositioning reviewer findings | [references/WORKER-AND-REVIEW-CONTRACTS.md](references/WORKER-AND-REVIEW-CONTRACTS.md) |
| A child failed, was interrupted, returned nothing, was rejected, or a whole call reported failure and replacement launches are being considered | [references/RETRY-AND-RECOVERY.md](references/RETRY-AND-RECOVERY.md) |
| Mapping this governance to Pi, including discovery, launch posture, local model defaults, retry helpers, and escalation | [references/PI-EXECUTION-ADAPTER.md](references/PI-EXECUTION-ADAPTER.md) |

The core admissibility invariants below stay in this file. References carry branch detail only; they never lower an invariant.

## Inputs and Assumptions

Establish before delegating:

- The necessary outcomes of the request, stated as outcomes rather than as agents.
- The executable, non-disabled roles the harness actually offers, from live discovery rather than memory.
- Repository state: clean or dirty, isolated working trees available or not, and which files each outcome must write.
- The approved plan, decisions, and non-goals, plus the named integration owner when one exists.
- Whether the parent is authorized to write, and whether external side effects are approved.

Assume nothing about a role's availability, a provider's health, or a child's success. Assume every child result is unverified until inspected.

## Portable Workflow

1. **Confirm parent-only scope and live capability**
   - Confirm this session is the parent orchestrator, that the delegation capability is active, and that the roles under consideration are executable and not disabled.
   - If the capability is unavailable, do the work directly or report the exact unavailable capability and the gate it blocks. Do not simulate delegation through shells, detached processes, or hand-managed session files.
   - Completion criterion: the parent scope, the live capability, and the executable role set are confirmed.

2. **Run the role-fit preflight and keep specialist routing balanced**
   - Apply this on ordinary turns whenever delegation is plausible. Convenience commands and saved workflows are shortcuts, not prerequisites.
   - Before choosing any execution shape — including direct parent work and default worker/reviewer pairs — identify each necessary outcome, map it to a discovered executable specialist, and select every role with a distinct, material contribution.
   - Balance means equal consideration and opportunity-appropriate selection. It is not a quota, an equal invocation count, or a correction for historical usage.
   - Consider these role kinds when they materially affect the request: local reconnaissance of code, configuration, conventions, or repository state; a bounded requirements/interface/validation/handoff context artifact; implementation design, sequencing, migration, or dependency planning; current external evidence or authoritative documentation; an advisory challenge to inherited direction, architecture, or drift; a bounded generic independent outcome that fits no more specific specialist; approved implementation within assigned ownership; and independent critique of an inspectable target.
   - Advisory challenge is **one** capability. Never launch two advisory aliases together merely to raise a child count.
   - Resolve material uncertainty about local context, external evidence, architecture, or planning before writes. Use reviewers only after an inspectable target exists.
   - Completion criterion: every selected role has a distinct necessary outcome, and every rejected role was rejected for lack of contribution rather than for convenience.

3. **Choose the smallest justified delegation shape**
   - Use zero, one, or multiple children according to the necessary outcomes. A single child is admissible when one bounded specialist outcome is useful.
   - Prefer direct parent work when delegation adds no material value, not merely because only one child would be launched.
   - Multiple children must each have a distinct, necessary outcome. Do not add duplicate, token, filler, or unrelated children to manufacture fanout.
   - Sequential child launches are allowed when dependencies, shared working-tree ownership, or integration order require them. Do not force unrelated work into one request merely to increase the declared count.
   - Workflow scripts, dynamic fanout, schedules, and direct launches have no governance-level cardinality minimum; their actual syntax and runtime behavior remain harness mechanics.
   - Completion criterion: every delegated child has a justified outcome, and the selected shape is no larger or more concurrent than the work requires.

4. **Plan and sequence implementation workers**
   - Launch an implementation worker only after the parent has established an approved plan or bounded workstream contract with prerequisites, ownership, deliverables, validation, and stop conditions.
   - One implementation worker is admissible for one bounded write outcome. Several workers are admissible only when their outcomes and ownership boundaries are distinct.
   - Sequential workers may share one working tree when each predecessor has settled and the parent has inspected its state before the next launch. Concurrent writers require isolated working trees and non-overlapping ownership.
   - Dynamic worker fanout is admissible only when its expansion source, ownership rule, concurrency bound, and integration path are explicit before expansion.
   - Replacements, fallbacks, and resumes preserve the original workstream identity and do not create permission to broaden scope.
   - Completion criterion: every worker is plan-backed, dependency-ready, safely sequenced or isolated, and necessary for its assigned write outcome.

5. **Preserve one-writer isolation**
   - Enforce one active writer per working tree. Never run concurrent writers in a shared tree; sequence them instead.
   - Parallel writers require clean, isolated working trees plus dependency-independent, non-overlapping ownership. Writers sharing a tree run sequentially.
   - A dirty repository must not use automatic isolated-tree fanout. Clean it only with user approval, or run sequentially in the shared tree.
   - The integration owner keeps control of shared-plan updates, decisions, integration, and completion claims. Workers must not edit the canonical plan, merge one another's branches, or spawn their own children unless explicitly assigned bounded fanout.
   - Completion criterion: every declared writer has an isolated or sequenced write path and a non-overlapping ownership boundary.

6. **Give every worker a complete task contract and require a complete handoff**
   - Every worker task must state its identity and prerequisites; approved context and non-goals; the exact write boundary and forbidden or shared paths; concrete deliverables; validation; a unique output path; and stop/escalation rules for unapproved product, scope, architecture, interface, security, migration, dependency, or ownership decisions.
   - Every worker handoff must report its workstream and run identity and status; base and resulting revision when applicable; changed files and a summary; validation results and omissions; deviations, assumptions, unresolved decisions, and residual risks; and integration notes with its unique artifact path.
   - Read [references/WORKER-AND-REVIEW-CONTRACTS.md](references/WORKER-AND-REVIEW-CONTRACTS.md) before writing the task or judging the handoff.
   - Completion criterion: each worker task carries all seven contract elements and each accepted handoff carries all six report elements.

7. **Supervise integration centrally**
   - Launch only dependency-ready work whose prerequisites are verified complete.
   - Count work complete only after the integration owner inspects the actual changes, the write boundary, the validation evidence, and the unresolved items. A completion claim is not evidence.
   - Treat edits outside the assigned write set, silent interface changes, missing required tests, or invented decisions as integration blockers. Revert, reassign, or request a corrected bounded change instead of normalizing scope drift.
   - Integrate isolated results in recorded order, run affected checks after each wave, and run the cross-workstream checks before review. Reviewers assess the integrated result, not isolated branches.
   - Completion criterion: every integrated result was inspected directly and every blocker was resolved or explicitly recorded.

8. **Replace failed children with bounded, deduplicated retries**
   - Count successful qualifying outputs, not requested tasks, launch attempts, or occupied slots.
   - Treat a call-level failure as potentially partial. Before any replacement launch, classify every requested logical child identity. **Never include a queued, running, paused, detached, or otherwise live child identity in a replacement payload, even when the original call reported failure.**
   - If filtering leaves one failed or unstarted child identity, recover or relaunch only that identity when retry safety permits. Never duplicate a live child or bundle unrelated work into the replacement.
   - Never automatically replace a stopped or interrupted child, and never automatically replace a writer without inspecting its actual state and obtaining parent approval.
   - Read [references/RETRY-AND-RECOVERY.md](references/RETRY-AND-RECOVERY.md) for failure classification, attempt budgets, and quorum exhaustion.
   - Completion criterion: every replacement targets only failed or unstarted slots, stays inside the attempt budget, and preserves each attempt's identity and failure class.

9. **Disposition every reviewer finding**
   - Reviewer output is advisory. The integration owner independently checks every finding against the repository, the approved plan, the acceptance criteria, test results, and authoritative documentation.
   - Record exactly one disposition per finding: `accepted`, `rejected`, `deferred`, or `needs verification`, with concise evidence and rationale. Reviewer confidence, severity labels, and agreement are signals, not proof.
   - Give a fix pass only explicitly accepted findings and their verification checks. Never let a fix worker decide disposition, and never apply reviewer feedback automatically.
   - Read [references/WORKER-AND-REVIEW-CONTRACTS.md](references/WORKER-AND-REVIEW-CONTRACTS.md) for the request contract, acceptance and rejection criteria, and disagreement handling.
   - Completion criterion: every finding carries one verified disposition, and every accepted fix was revalidated.

## Safety and Side Effects

This skill is read-and-decide guidance. It performs no launch, no write, and no configuration change by itself. Delegated children can write, so treat every governance decision as a safety decision.

Avoid:

1. Spawning children through shells, nested command-line agent invocations, detached processes, or hand-managed session files.
2. Using long blocking shell timeouts as a substitute for the harness's own lifecycle tracking.
3. Running concurrent writers against the same working tree.
4. Treating a worker's completion claim as reviewed, or as a substitute for required independent review.
5. Applying reviewer feedback automatically, or letting a fix worker decide review disposition.
6. Abandoning active background runs by ending a non-interactive turn before required results arrive.
7. Presenting this guidance as hard enforcement. Any runtime guard the harness provides remains separate and authoritative.

## Scripts, References, and Dependencies

- `references/WORKER-AND-REVIEW-CONTRACTS.md` — worker task and handoff contracts, integration supervision, reviewer request contract, and finding disposition rules.
- `references/RETRY-AND-RECOVERY.md` — failure classification, live-child deduplication, attempt budgets, write-safety rules, and quorum exhaustion.
- `references/PI-EXECUTION-ADAPTER.md` — Pi mapping, including discovery, launch posture, local model defaults, retry helpers, escalation, and package lifecycle.
- `tests/test_skill_contract.py` — contract test using the Python 3.10+ standard library only.
- `../../tests/routing/subagent-governance.json` — repository routing examples relative to this skill directory.

No runtime package dependency is required. This package implements no delegation tool, no fanout guard, no provider registry, and no runtime enforcement.

## Verification

From the package root, run:

```bash
npm test
npm pack --dry-run --json
```

A governance decision is verified when the selected roles and outcomes, worker sequencing or isolation, worker contracts, retry provenance, and finding dispositions are all inspectable in the record rather than asserted from memory.

## Pi Adapter

- In Pi, the installed `pi-subagents` skill stays canonical for delegation mechanics: tool schemas, actions, discovery, execution modes, context modes, authoring, configuration, and error handling. This skill adds admissibility governance on top of it and never restates its API.
- Read [references/PI-EXECUTION-ADAPTER.md](references/PI-EXECUTION-ADAPTER.md) for the Pi mapping of discovery, launch posture, isolation, retry helpers, escalation, and the local model defaults. Those exact model choices are Pi-local defaults only; they are not part of the portable policy.
- When Pi feature policy is active, it owns feature outcomes, review quorum size, report obligations, and completion gates. This skill owns whether the delegation shape used to reach them is admissible.
- Do not install this package or modify Pi settings without explicit user confirmation. A later approved local installation may use `pi install <absolute-path-to-package>`.
