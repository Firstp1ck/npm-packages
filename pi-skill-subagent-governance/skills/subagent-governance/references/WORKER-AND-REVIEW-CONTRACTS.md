# Worker And Review Contracts

Read this reference when writing a worker task, judging a returned handoff, supervising integration, or dispositioning reviewer findings. It carries branch detail for steps 6, 7, and 9 of the portable workflow in `../SKILL.md`. It never lowers an invariant stated there, and it does not describe any harness's launch syntax, tool arguments, or runtime behavior.

## 1. Worker task contract

Every worker task must state all seven elements. A task missing any of them is not ready to launch.

| Element | Requirement |
| --- | --- |
| Identity and prerequisites | The worker's workstream identity, what it may assume is already complete, and which earlier results it must read. |
| Approved context and non-goals | The approved decisions, plan path or summary, and the explicitly excluded work. |
| Write boundary | The exact paths the worker may create or modify, plus the forbidden and shared paths it must not touch. |
| Deliverables | Concrete, independently verifiable outputs rather than a general mandate. |
| Validation | The checks to run, or the next-best check when the intended validation is impossible. |
| Unique output path | A handoff artifact path that no concurrent child shares. |
| Stop and escalation rules | The triggers for pausing instead of deciding: unapproved product, scope, architecture, interface, security, migration, dependency, or ownership decisions. |

Write the task as a compact contract, not a procedural script. Name the destination, the evidence, and the boundaries; let the role choose the path. Use absolute language only for real invariants, and give decision rules for judgment calls.

Additional rules:

- Give the worker the approved direction as the contract, and ask it to validate that direction against the actual code rather than silently redesigning it.
- Do not ask a worker to continue the parent conversation, to plan further delegation, or to decide the review outcome.
- A worker may not spawn children unless the parent explicitly assigned bounded fanout, and that assignment is limited to the assigned work.
- When several workers run against one repository, the parent states the ownership split explicitly and confirms that no two boundaries overlap before any launch.

## 2. Worker handoff contract

Every accepted handoff must report all six elements:

1. workstream identity, run identity, and status;
2. base and resulting revision when applicable;
3. changed files and a summary of what was implemented;
4. validation results, the commands run with their exit codes, and every omitted check;
5. deviations, assumptions, unresolved decisions, and residual risks;
6. integration notes and the unique artifact path.

A handoff is a report, not an acceptance. It never establishes that the work is reviewed, that the plan is satisfied, or that the workstream is complete.

Reject a handoff that claims success while the delegated task expected changes that were not made, that summarizes intent instead of actual changes, or that reports validation without the commands and outcomes behind it. Request a corrected bounded report rather than reconstructing the missing evidence from assumption.

## 3. Integration supervision

1. Launch only dependency-ready work. Verify the prerequisite outcomes exist rather than trusting the schedule.
2. Inspect the actual changes, the write boundary, the validation evidence, and the unresolved items before counting any workstream complete.
3. Treat these as integration blockers:
   - edits outside the assigned write set;
   - silent interface, schema, contract, or dependency changes;
   - missing required tests or missing validation evidence;
   - decisions the worker invented instead of escalating;
   - overlapping ownership that was resolved locally by the worker.
4. Resolve a blocker by reverting, reassigning, or requesting a corrected bounded change. Do not normalize scope drift by accepting it once and documenting it afterward.
5. Integrate isolated results in recorded order. The integration owner alone resolves conflicts and shared-file changes.
6. After each integration wave, run the affected checks against the combined state. Before review, run the cross-workstream checks and verify that interfaces, migrations, generated files, documentation, and rollback or rollout notes agree.
7. Reviewers assess the integrated implementation, not isolated worker branches. Worker self-checks and handoffs never replace a required review quorum.

## 4. Reviewer request contract

Ask each reviewer for:

- the affected files or symbols;
- the violated requirement or the failure mode;
- the reasoning or a reproduction;
- a proposed severity;
- a minimal remediation when one is useful.

Give reviewers an inspectable target and a distinct angle. Keep review passes read-only unless a fix pass was explicitly authorized. Reviewers report findings; they do not decide scope, and they do not own the outcome.

## 5. Finding disposition

1. Reviewer output is advisory. The integration owner independently checks every finding against the repository, the approved plan, the acceptance criteria, the test results, and authoritative documentation.
2. Record exactly one disposition per finding: `accepted`, `rejected`, `deferred`, or `needs verification`. Include concise evidence and rationale for each.
3. Reviewer confidence, severity labels, and agreement between reviewers are signals, not proof. Two reviewers repeating an unverified claim do not make it valid.
4. Accept a finding only when it is demonstrably valid and materially relevant.
5. Reject or defer false positives, unsupported speculation, preference-only refactors, duplicate findings, unapproved scope expansion, unnecessary complexity, and changes whose benefit does not justify their risk.
6. Use `needs verification` when a finding is plausible but the evidence is not yet decisive, and resolve it before completion rather than leaving it open.
7. Resolve disagreement through evidence and reproduction, never through a vote or a tally.
8. Give a fix pass only the explicitly accepted findings and their verification checks. A fix worker never decides disposition and never expands scope from a rejected or deferred finding.
9. After fixes, rerun the targeted checks and update each disposition with the verification result.

## 6. Relationship to feature review quorums

The number of required reviewers, the required provider diversity, and the completion gate belong to the feature or project policy in use. This reference defines only what a review request must contain and how each finding is dispositioned.

When a required quorum cannot be obtained, keep the gate incomplete and report the exact limitation. Do not substitute a worker self-check, a parent self-review, several roles inside one run, or two outputs from one run for independent review.
