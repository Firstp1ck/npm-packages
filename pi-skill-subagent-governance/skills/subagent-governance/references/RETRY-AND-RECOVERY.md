# Retry And Recovery

Read this reference when a child failed, was interrupted, returned nothing, was rejected at acceptance, or when a whole delegation call reported failure and replacement launches are being considered. It carries branch detail for step 8 of the portable workflow in `../SKILL.md`. It never lowers an invariant stated there, and it does not describe any harness's recovery syntax, tool arguments, or status payload shapes.

## 1. Count qualifying successes, not attempts

Count successful qualifying outputs, not requested tasks, launch attempts, or occupied slots. A failed, interrupted, stopped, empty, ineligible, or acceptance-rejected result does not satisfy the requested outcome.

A slot stays open until a qualifying result exists for it. Filling a report with attempt counts does not close it.

## 2. Classify before deciding

After a foreground result or a background completion, inspect the structured result and status and classify each unsuccessful attempt before deciding whether to relaunch. Do not relaunch on the assumption that a repeat will behave differently.

## 3. Treat a call-level failure as potentially partial

A delegation call that reports failure may still have started children.

1. Before any replacement launch, inspect status, fleet, and transcript evidence, and classify every requested logical child identity — its role plus its assigned outcome or slot — as queued, running, paused, completed, failed, or unstarted.
2. **Never include a queued, running, paused, detached, or otherwise live child identity in a replacement payload, even when the original call reported failure.** Relaunch only failed or unstarted slots.
3. If filtering leaves fewer children than the static minimum, do not duplicate a live child to reach it. Instead:
   - wait and reconcile once the live children settle;
   - use a recovery operation for a failed persisted run; or
   - complete the missing outcome directly in the parent.
4. Attention signals are not lifecycle state. A child that has produced no recent output is not failed, and a paused child that is awaiting direction is not failed either.

## 4. Transient failures

Relaunch bounded transient failures with a fresh child run:

- provider or model unavailability;
- rate limits and overload;
- temporary network, startup, or protocol failures;
- empty model output.

Prefer an eligible fallback model or provider that has not already failed for that slot.

## 5. Diagnostic failures

Treat these as diagnostic failures rather than transient ones:

- invalid role, model, or configuration;
- model-scope or capability rejections;
- missing tools for the assigned work;
- deterministic task or tool failures;
- repository, build, or test failures;
- acceptance rejections.

Correct the cause or refine the task before relaunching. Do not repeat the same call blindly.

## 6. Stopped, interrupted, and write-capable children

- Never automatically relaunch a stopped or interrupted child. A stop is a decision, not a transient fault.
- A call that failed before any child run was created may be relaunched inside the attempt budget.
- After a child has started, automatic replacement is allowed only for explicitly read-only or idempotent work.
- For a writer, or for any child that may have caused external side effects, inspect its transcript, its diff, and the repository state, then obtain parent approval before launching a replacement. Two writers for one slot in a shared tree is an isolation violation, not a retry.

## 7. Attempt budget and provenance

- Default to at most two total attempts per slot unless the user or an approved workflow sets another bound.
- Preserve every attempt's run identity, model or provider, failure class, and relationship to the attempt it replaces.
- Do not reset the budget by rewording the same task, by splitting one slot into several requests, or by treating a replacement as a new workflow.

## 8. Quorum and gate exhaustion

For quorum or gate workflows, continue eligible replacements until the required number of qualifying successes exists or the attempt and provider budget is exhausted.

If the budget is exhausted, keep the gate incomplete and report the exact limitation: which slot is unfilled, which failure classes occurred, which providers were tried, and what remains possible. Do not silently lower the gate, do not count a partial result as qualifying, and do not present the parent's own inspection as an independent result.

## 9. Retry-safety declarations

When the harness offers a bounded read-only retry or success-quorum helper, prefer it over hand-rolled relaunch loops, and declare each task's retry safety honestly.

An omitted or unknown retry-safety declaration must be treated as write-capable, which disables automatic post-launch replacement. Never label a write-capable task read-only to unlock automatic retries.
