# Workflow Token-Budget Enforcement Implementation Plan

- **Plan ID:** `PLAN-WF-BUDGET`
- **Status:** Complete — provider-diversity gate explicitly waived by the user after repeated provider unavailability
- **Integration owner:** parent Pi session
- **Created:** 2026-07-26
- **Package:** `@firstpick/pi-extension-workflows`

## Goal

Prevent one or more workflow agent subprocesses from consuming an entire phase/run token budget before useful output is returned, while preserving bounded retries, replay, persistence, cancellation, and existing unbudgeted behavior.

## Classification

**Complex feature.** The change crosses the public JavaScript workflow contract, concurrent admission, subprocess lifecycle, accounting, replay, persistence evidence, and user-facing diagnostics. Independent planning and implementation workstreams are required.

## Observed failure and root cause

Two read-only WebUI planning workflows failed before returning a scout result:

1. A three-agent run exhausted `budgets.run.maxTokens = 90000` with no completed tasks.
2. A simplified single-scout phase exhausted `budgets.phase.maxTokens = 95000` with no completed task.

Source inspection confirms:

- `src/script-runner.ts` enforces token budgets before dispatch, when the active task has no usage, and only again after a task returns.
- Parallel calls can all pass admission with no reservation.
- `src/task-runner.ts` receives assistant usage incrementally at `message_end` but does not enforce a per-call cap.
- Failed and retried attempt usage is discarded before it reaches `TaskRun.usage`.
- The installed Pi CLI has no documented hard `--max-tokens` or `--max-turns` flag. The supported parent process can nevertheless stop the subprocess at assistant-message boundaries using streamed JSON usage and the existing process-group abort path.

## Approved scope

1. Add optional aggregate per-agent token/turn controls to the JavaScript `agent()` API and policy schema.
2. Derive a deterministic per-call token allowance from remaining run/phase capacity when aggregate token budgets exist.
3. Reserve allowance synchronously before worktree setup or scheduler dispatch so parallel calls cannot oversubscribe a scope.
4. Enforce the allowance inside the subprocess runner at assistant `message_end` boundaries and preserve partial output/usage.
5. Add a bounded finalization mechanism: a configurable/default turn cap and a concise injected instruction requiring the agent to stop tools and return its best result before the final allowed turn.
6. Charge every completed attempt, including failures and retries, exactly once.
7. Return actionable `budget_exhausted` diagnostics with partial-output evidence instead of only a late aggregate error.
8. Preserve persistence schema version 1 and store cumulative task usage in existing fields.
9. Document semantics, compatibility, and unavoidable single-response overshoot.

## Non-goals

- Exact mid-response provider token interruption; the Pi subprocess reports authoritative usage only after each assistant message.
- New shell/network authority.
- Unbounded retries or automatic retries for writes.
- Cost-budget admission; cost remains post-result because reliable prospective cost is provider/model dependent.
- Persistence schema migration or queryable per-attempt records.
- Changes to the upstream Pi CLI.

## Invariants

1. Workflows without token/turn budgets behave as before.
2. Equality with a configured token limit is allowed; exhaustion occurs when usage exceeds a limit or no positive capacity remains.
3. No task runner starts without a positive reservation when aggregate token budgets apply.
4. Active reservations plus measured usage never exceed admitted run/phase capacity.
5. A request may tighten but never loosen its derived/policy cap.
6. Failed/retried usage is cumulative and never double-counted.
7. Budget-limit termination is non-transient and is never retried.
8. Replay hits do not reserve or spawn; cached usage is charged once and can exhaust a logical budget.
9. Partial output and usage are assigned before budget failure classification or structured-output validation.
10. Cancellation still terminates the subprocess process group and late settlement cannot mutate finalized state.
11. Shell remains unavailable; tool/path/network policy is unchanged.

## Contract decisions

### Public workflow metadata

Extend `meta.pi.budgets` with optional `agent` controls:

```js
budgets: {
  run: { maxTokens: 90000 },
  phase: { maxTokens: 45000 },
  agent: { maxTokens: 24000, maxTurns: 8 }
}
```

- `agent.maxTokens`: aggregate reported usage for one attempt (`input + output + cacheRead + cacheWrite`).
- `agent.maxTurns`: maximum assistant messages/turns for one attempt.
- Both are positive integers and optional.

### Per-call tightening

Extend `agent(prompt, options)` with optional `maxTokens` and `maxTurns`. These values participate in the call fingerprint and can only tighten policy/derived values.

### Derived allowance

When run or phase `maxTokens` exists, calculate:

```text
scopeQuantum = max(1, floor(scope.maxTokens / max(2, effective maxConcurrency)))
reservation = min(positive run remaining,
                  positive phase remaining,
                  applicable scope quanta,
                  policy agent maxTokens,
                  request maxTokens)
```

Measured usage includes every settled attempt. Remaining capacity subtracts active reservations. Unused reservation is released after settlement.

### Enforcement and finalization

- The subprocess runner accumulates usage at each assistant `message_end`.
- A token-bounded call without an explicit turn limit receives a default cap of 8 assistant turns.
- Each bounded attempt receives an internal instruction to use tools selectively and return its concise best answer before the final allowed turn.
- A model-authored final response at the turn limit completes normally; otherwise the runner sends SIGTERM/SIGKILL through the existing process-group path when cumulative usage exceeds the assigned hard allowance or the turn cap is reached without settlement.
- A hard-limit stop returns a structured internal termination reason, partial text, cumulative usage, and raw/recent events.
- Because authoritative usage arrives after a response, one response may overshoot the assigned aggregate cap. This is explicit and bounded by one model response rather than an unbounded agent loop.

## Workstreams

### WF-A — Public contract and deterministic admission

**Worker identity:** `worker` slot 1, OpenAI Codex Terra xhigh.

**Write boundary:**

- `src/types.ts`
- `src/script-schema.ts`
- `src/script-runtime.ts`
- `src/call-fingerprint.ts`
- new `src/token-budget.ts`
- `workflow-runtime.d.ts`
- `tests/script-schema.test.mjs`
- `tests/script-runtime.test.mjs`
- `tests/replay.test.mjs`
- new `tests/token-budget.test.mjs`

**Forbidden:**

- `src/task-runner.ts`
- `src/subprocess-policy-guard.ts`
- `src/run-manager.ts`
- persistence schema/version
- `README.md`
- this plan

**Deliverable:** validated optional fields, derived cap/reservation controller with direct parallel-admission unit tests, and replay fingerprint coverage. WF-B registers the new focused test in `package.json` and adds integration coverage in its owned runner tests.

### WF-B1 — Runner integration and subprocess enforcement

**Worker identity:** replacement `worker`, OpenAI Codex Terra xhigh.

**Prerequisite:** WF-A integrated in the shared worktree.

**Write boundary:**

- `src/script-runner.ts`
- `src/task-runner.ts`
- `src/subprocess-policy-guard.ts`
- `tests/script-runner.test.mjs`
- new local subprocess fixtures/tests as needed under `tests/fixtures/` and `tests/*budget*.test.mjs`, excluding `tests/token-budget.test.mjs`

**Forbidden:**

- WF-A source/type/schema files except importing their finalized APIs
- `src/run-manager.ts`
- persistence schema/version and persistence tests
- `package.json`
- `README.md`
- this plan
- unrelated package files

**Deliverable:** reservation integration, message-boundary token/turn enforcement, partial-output retention, cumulative attempt accounting, non-retryable budget diagnostics, and focused runner/subprocess tests.

### WF-B2 — Durable compatibility, test registration, and documentation

**Worker identity:** replacement `worker`, OpenAI Codex Sol high.

**Prerequisite:** WF-B1 integrated in the shared worktree.

**Write boundary:**

- `src/run-manager.ts` only if needed to expose existing diagnostic fields
- `tests/run-manager.test.mjs`
- `tests/persistence.test.mjs`
- `tests/scheduler.test.mjs`
- `package.json` only to register focused tests
- `README.md`

**Forbidden:**

- all WF-A and WF-B1 source files
- persistence schema/version
- this plan
- unrelated package files

**Deliverable:** durable schema-v1 accounting/diagnostic coverage, cancellation compatibility evidence, full-suite test registration, and documentation of defaults, overshoot, retry/replay, and security behavior.

## Dependency DAG and waves

```text
Scout + planner evidence
        |
        v
Canonical plan
        |
        v
WF-A contract/admission
        |
        v
WF-B1 runner/subprocess enforcement
        |
        v
WF-B2 durable compatibility/docs
        |
        v
Parent integration inspection + targeted/full tests
        |
        v
Provider-diverse correctness reviews + independent tests review
        |
        v
Finding dispositions/fixes -> rerun checks -> HTML report
```

The workers run sequentially in the shared checkout because the containing repository is dirty from an unrelated untracked sibling file; no automatic worktree fanout is permitted. Their ownership boundaries do not overlap. The original WF-B Anthropic attempt failed before edits with a provider `429 rate_limit_error`; the bounded replacement is split into WF-B1 and WF-B2 so the required worker outcomes remain distinct and statically declared.

## Acceptance criteria

### Contract

- Valid policy/per-call token and turn controls parse; zero, fractional, and unknown values fail closed.
- Old scripts parse unchanged.
- Request options only tighten effective caps and alter fingerprints deterministically.

### Admission

- A consumed budget prevents the next task runner invocation.
- Held parallel calls cannot reserve beyond run or phase capacity.
- Cheap settled tasks release unused capacity for later calls.
- Replay spawns/reserves nothing and charges cached usage once.

### Enforcement

- A local fixture emitting repeated assistant `message_end` records is terminated at the assigned token/turn boundary.
- Partial output and cumulative usage survive termination.
- Limit termination is classified as `budget_exhausted` and is never retried.
- The final allowed turn receives a concise no-more-tools/final-answer instruction.

### Accounting and persistence

- Failed attempt followed by success aggregates both usages exactly once.
- Agent/phase/run usage artifacts agree under persistence schema version 1.
- Structured-output validation cannot mask a known budget stop.

### Compatibility/security

- Scheduler timeout still kills the process group.
- Abort-ignoring/never-settling runners cannot mutate the final snapshot.
- No shell or network permission expansion.
- Full `npm test` passes.

## Automated verification

Focused commands are selected from existing package scripts/tests, followed by:

```bash
npm test
```

No live network/provider call is required for regression tests; subprocess enforcement uses deterministic local JSONL fixtures.

## Manual verification

After automated tests, rerun a bounded read-only workflow similar to the failed scout scenario and verify either:

1. the agent returns a concise result under its derived allowance; or
2. the run terminates with a useful per-agent budget diagnostic and retained partial output before the phase/run envelope is monopolized.

A live-provider smoke is evidence, not a release gate when subscription/runtime availability is absent.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| One assistant response can exceed a cap | Enforce at every `message_end`; document one-response overshoot; use conservative quantum/finalization threshold. |
| Finalization hint is ignored | Retain hard parent enforcement and partial-output evidence; tests prove a model-authored final response at the boundary succeeds. |
| Conservative caps underutilize cheap calls | Release unused reservation immediately; allow explicit tighter per-call values, never looser ones. |
| Earlier failures change behavior | Limit new admission behavior to token-budgeted workflows and document it as the intended safety correction. |
| Retry accounting exhausts sooner | This corrects previous underreporting; expose attempt diagnostics. |
| Dirty containing repository | Use sequential shared-worktree writers with disjoint ownership; parent inspects every diff. |

## Rollback

- Keep persistence schema v1 so old readers remain compatible.
- Revert WF-B enforcement independently from WF-A contract only before release; if enforcement is removed, token-budgeted calls must fail closed rather than silently return to retrospective-only behavior.
- Revert WF-A fields/controller and documentation together if the public contract is withdrawn.
- No data migration or destructive cleanup is required.

## Execution record

### Discovery/planning

- Repo explorer report: `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-07-26T17-26-32-339Z-pi-extension-workflows-5591b1ab97.md`
- Scout/planner chain: `cf51536a-53e7-412d-b2b3-04d47d787aea`
- Scout artifact: `.pi-subagents/artifacts/cf51536a-53e7-412d-b2b3-04d47d787aea_scout_0_output.md`
- Planner artifact: `.pi-subagents/artifacts/cf51536a-53e7-412d-b2b3-04d47d787aea_planner_1_output.md`

### Worker results

- WF-A: completed in run `5305119e-f2bd-406e-b1bc-e02f19fbee59`, artifact `/tmp/pi-extension-workflows-PLAN-WF-BUDGET-WF-A-handoff.md`; parent inspected the actual diff and focused tests passed.
- Original WF-B: failed before edits in run `5305119e-f2bd-406e-b1bc-e02f19fbee59` with Anthropic `429 rate_limit_error`; no replacement retry uses that provider.
- WF-B1: completed in replacement run `870ffc33-f52f-4dee-8af8-75ffce046b57`, artifact `/tmp/pi-extension-workflows-PLAN-WF-BUDGET-WF-B1-handoff.md`; parent inspected the actual diff and retained its bounded message-boundary enforcement.
- WF-B2: completed in replacement run `870ffc33-f52f-4dee-8af8-75ffce046b57`, artifact `/tmp/pi-extension-workflows-PLAN-WF-BUDGET-WF-B2-handoff.md`; parent inspected durable schema-v1 changes and documentation.
- Parent integration fixes: restored legacy-compatible run/phase budget wording, retained maximum retry context usage, added the default 8-turn cap for token-bounded calls, injected a deterministic concise-final-answer instruction, and allowed a normal model-authored final response exactly at the turn boundary.

### Review findings and dispositions

- Initial OpenRouter correctness review: **PASS**, no material issue. Artifact: `/tmp/pi-extension-workflows-PLAN-WF-BUDGET-review-openrouter.md`.
- Initial tests/acceptance review: **PASS**. Artifact: `/tmp/pi-extension-workflows-PLAN-WF-BUDGET-tests-acceptance.md`.
- Low-findings verification accepted four hardening items. Artifact: `/tmp/pi-extension-workflows-PLAN-WF-BUDGET-low-findings-verifier.md`.
  1. **Accepted and fixed:** trailing unterminated stdout could arm a force-kill timer after close cleanup. Trailing records now flush before final timer cleanup; the no-newline budget fixture covers the path.
  2. **Accepted and fixed:** a provider error exactly at `maxTurns` could be masked as `budget_exhausted`. Provider errors now retain precedence; an exact-turn fixture asserts no synthetic budget marker.
  3. **Accepted and fixed:** `diagnostics(phaseId)` created phase state. It now performs a non-mutating lookup; the controller test covers an unseen phase.
  4. **Accepted and fixed:** scheduler timeout and process-tree termination lacked a direct composition test. The scheduler suite now times out the real process-tree fixture and verifies the grandchild exits.
- Post-fix OpenRouter correctness review: **PASS**, no material findings. Artifact: `/tmp/pi-extension-workflows-PLAN-WF-BUDGET-postfix-openrouter.md`.
- Post-fix tests/acceptance review: **PASS**, confidence 98/100. Artifact: `/tmp/pi-extension-workflows-PLAN-WF-BUDGET-postfix-acceptance.md`.
- The required distinct-provider correctness slot could not produce a qualifying result: Anthropic repeatedly returned account `429 rate_limit_error`, and the LM Studio replacement failed to connect. A later Anthropic attempt again returned `429` and fell back to OpenRouter before exceeding its child turn budget; that fallback is not counted as provider diversity.
- **Waiver:** on 2026-07-26 the user explicitly replied, “Waive distinct-provider review.” The provider-diversity gate is therefore closed by informed waiver rather than by a second qualifying provider result. No failed or fallback result is represented as a successful Anthropic review.
- OpenRouter's broadened assistant-turn-counting note was **accepted as intentional and documented** in `README.md`: every assistant message counts, including messages without usage metadata.
- The documented one-response token overshoot remains **accepted by design** because authoritative usage arrives only at `message_end`; admission fails closed afterward.

### Completion evidence

- Focused `token-budget`, `task-runner-budget`, `script-runner-budget`, `scheduler`, and compatibility tests pass after the finding fixes.
- Full `npm test` passes after the final fixes: all 23 registered suites report success.
- `git diff --check` passes with no whitespace errors.
- Persistence remains schema version 1; deterministic tests prove cumulative failed/retried usage, replay one-charge/no-spawn behavior, retained partial output, and agent/phase/run accounting.
- Scheduler-timeout composition now directly proves Linux process-group cleanup against a real child/grandchild fixture.
- No shell/network authority was added; `src/subprocess-policy-guard.ts` remains unchanged and policy/worktree tests pass.
- No files are staged. Feature changes remain uncommitted in the working tree; sibling `pi-package-webui` changes are out of scope and were not modified for this feature.
- Live-provider smoke was not run. It remains explicitly non-gating because deterministic local fixtures are the release gate and provider availability was absent.
