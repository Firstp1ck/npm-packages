# Pi Agent Harness Plan: Small-LLM Reliability Layer

## Goal

Implement a harness layer that helps smaller LLMs stay focused during long-running tasks by moving memory, planning, verification, and loop-control out of the model and into deterministic system components.

The LLM should act as a worker. The harness should be the source of truth.

---

## Implementation Review & Refinements (2026-06-18)

This plan should be implemented as a **TypeScript Pi extension package**, not as a Python module tree. Pi extensions can enforce the MVP with existing extension hooks:

- `before_agent_start`: initialize/restore task state and append reliability instructions.
- `context`: inject a compact goal/plan/verification header before every LLM call.
- `tool_call`: attach tool calls to the active task step and block exact repeat loops.
- `tool_result`: record tool outcomes, touched files, errors, and verification evidence.
- `message_end`: persist state after every assistant response.
- `agent_end`: update the scratchpad and user-facing progress status.

### MVP Scope for First Implementation

Implement the smallest useful reliability layer first:

- [x] Extension package `pi-extension-small-modal-reliability` with `package.json`, `index.ts`, `README.md`, and `LICENSE`.
- [x] Opt-in activation via `--reliability` or `/reliability on`; no surprise default behavior for existing sessions.
- [x] `TaskState` persisted as JSON under `.pi/tasks/{task_id}/state.json` plus session custom-entry pointers for resume.
- [x] Deterministic initial plan generation with a model-editable plan update tool.
- [x] Compact context header injected before every LLM call.
- [x] Deterministic scratchpad regenerated from state at `.pi/tasks/{task_id}/scratchpad.md`.
- [x] Exact tool-call repeat detection with blocking at a configurable threshold.
- [x] Verification checklist tool and final-answer guidance requiring evidence or explicit unknowns.
- [x] Commands/tools for status, plan updates, progress records, and verification.

### Important Design Adjustments

- Prefer local JSON for MVP persistence. SQLite can wait until tasks require querying across many sessions.
- Store raw tool logs only as an explicit opt-in because local logs can contain secrets; when enabled, logs are redacted, truncated, and linked from tool history.
- Do not mutate or remove normal conversation history in the first version. Context compression can be added later after validating state quality.
- Keep supervisor/worker split as a prompt/tool contract by default; separate supervisor/worker/verifier subprocess orchestration is available only when explicitly enabled.
- Treat verification as evidence-gated but not omniscient: the verifier should report `Unknown` rather than inventing success.
- Make all enforcement bounded and reversible: `/reliability off`, `/reliability reset`, and loop blocking only for identical repeated tool calls.

### Implemented MVP Files

```text
pi-extension-small-modal-reliability/
  package.json
  index.ts
  README.md
  LICENSE
  src/core.ts
  src/completion-gate.ts
  src/config.ts
  src/context-builder.ts
  src/evaluation.ts
  src/loop-detector.ts
  src/orchestration.ts
  src/paths.ts
  src/planner.ts
  src/progress-ui.ts
  src/redaction.ts
  src/scratchpad.ts
  src/supervisor.ts
  src/task-state.ts
  src/tool-normalizer.ts
  src/types.ts
  src/utils.ts
  src/verification-state.ts
  src/verification-suggestions.ts
  src/verifier.ts
  tests/reliability-harness.test.mjs
```

The remaining phases below are still useful as a roadmap, but the reliability harness now includes the MVP+, modularization pass, verification-parser pass, profile pass, completion-gating pass, context-compression pass, raw-log pass, granular domain modules, deterministic supervisor/worker contract, opt-in separate-model supervisor/worker/verifier orchestration, and offline reliability evaluation metrics. The next highest-impact improvement is live small-model evaluation on representative tasks.

### Phase Status Summary

| Phase | MVP status | Notes |
|---|---|---|
| 1. Persistent Task State | Implemented | JSON `TaskState`, state-event diff log, session custom-entry pointer, `.pi/tasks/{task_id}` storage. |
| 2. Explicit Planning System | Implemented | Deterministic default plan plus `reliability_set_plan` for model-driven revisions. |
| 3. Goal Reminder Injection | Implemented | `context` hook appends a compact goal/plan/verification header before each model call. |
| 4. Scratchpad Memory File | Implemented | Scratchpad is regenerated from state; optional via `.pi/reliability.json`. |
| 5. Context Builder and Compression | Implemented MVP | Headers support `full`, `compact`, and `delta` modes; full conversation replacement/compression remains future work. |
| 6. Loop Detection | Implemented | Exact tool+argument repeat detection blocks loops at a configurable threshold. |
| 7. Verification Layer | Implemented MVP++ | `reliability_verify_completion` records Passed/Failed/Unknown evidence; `reliability_suggest_verification` detects common project checks; verification result parsers summarize common tool output; strict completion gating prevents silent unsupported completion claims. |
| 8. Supervisor / Worker Split | Implemented MVP+ | Deterministic supervisor decisions, worker contract prompt, `reliability_submit_worker_result`, and opt-in separate-model subprocess orchestration are implemented. |
| 9. Tool Result Normalization | Implemented MVP+ | Compact redacted summaries are stored; optional redacted/truncated raw-log archival is available. |
| 10. User-Facing Progress Updates | Implemented MVP+ | Footer/widget/status commands exist; `/reliability tasks`, `resume`, `archive`, and `orchestrate` improve task UX. Richer event emitter remains future work. |
| 11. Configuration | Implemented MVP+ | `.pi/reliability.json`, `/reliability`, `--reliability`, strict/balanced/relaxed profiles, context/raw-log settings, and orchestration settings are supported. |
| 12. Testing Strategy | Implemented MVP+ | `node:test` mocks cover task creation, context injection/modes, profile behavior, supervisor/worker contracts, orchestration dry-runs/parsers, offline evaluation metrics, completion gating, loop blocking, redacted raw logs, verification suggestions/parsers/failures, and task list/resume/archive UX. |

### Implementation Update — Iteration 2

Additional implementation completed after the initial MVP:

- [x] Added `npm test` using Node's built-in test runner with mocked Pi lifecycle events.
- [x] Added `reliability_suggest_verification` model-facing tool.
- [x] Added `/reliability suggest` command.
- [x] Added project manifest verification detection for `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, Maven, and Gradle.
- [x] Added failed verification-command recording so failed checks can surface as failed verification criteria.
- [x] Added `/reliability tasks`, `/reliability tasks --all`, `/reliability resume <task_id_prefix>`, and `/reliability archive <task_id_prefix>`.
- [x] Updated README usage and development documentation.
- [x] Verified with import smoke test, `npm test`, and `npm pack --dry-run --json`.

### Implementation Update — Iteration 3

- [x] Performed the first modularization pass.
- [x] Moved core task-state, planning, scratchpad, context, loop, verification, and task-list helpers into `src/core.ts`.
- [x] Kept `index.ts` focused on Pi extension registration, commands, tools, and event wiring.
- [x] Added `src` to package files so the published package includes the extracted module.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Implementation Update — Iteration 4

- [x] Added `parseVerificationResult()` for common verification tools.
- [x] Parses TypeScript, ESLint, Ruff, mypy, pytest, Cargo, Go test, JavaScript test scripts, Maven, and Gradle signals into structured summaries.
- [x] Verification command evidence now includes concise parsed output instead of only the command string.
- [x] Successful verification commands mark the verification step complete; failed verification commands block it and store failed evidence.
- [x] Added parser tests for representative TypeScript, pytest, Cargo, Go test, and Gradle outputs.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Implementation Update — Iteration 5

- [x] Added strict/balanced/relaxed reliability profiles.
- [x] Added `profile` support in `.pi/reliability.json`.
- [x] Added `/reliability profile strict|balanced|relaxed` for session-level switching.
- [x] Surfaced active profile and effective repeat limit in `/reliability status` and `reliability_status`.
- [x] Strict profile defaults to repeat limit 2 with plan/verification required.
- [x] Balanced profile preserves current repeat limit 3 behavior.
- [x] Relaxed profile disables non-failing repeat blocking while still blocking repeated failures.
- [x] Added tests for strict and relaxed profile behavior.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Implementation Update — Iteration 6

- [x] Added completion-claim detection for assistant messages.
- [x] Added `evaluateCompletionGate()` and `buildCompletionGatePrompt()`.
- [x] Completion claims with failed/unknown criteria now record an open question and notify the user.
- [x] Strict profile queues a follow-up user message that tells the agent not to claim completion yet and asks for evidence, verification, plan revision, or explicit partial-completion reporting.
- [x] Completion-gate follow-up is sent once per task to avoid spam.
- [x] Added tests for strict completion-gate behavior.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Implementation Update — Iteration 7

- [x] Added context header modes: `full`, `compact`, and `delta`.
- [x] Added profile defaults for context mode: strict → full, balanced → compact, relaxed → delta.
- [x] Added `contextMode` support in `.pi/reliability.json`.
- [x] Added `/reliability context full|compact|delta` for session-level switching.
- [x] Added context snapshots so delta headers only show material state changes after the first header.
- [x] Updated status output to include context mode.
- [x] Added tests for compact and delta headers.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Implementation Update — Iteration 8

- [x] Added optional raw tool log storage behind `storeRawToolLogs`.
- [x] Added `rawLogMaxChars` with bounded normalization.
- [x] Raw logs are written under `.pi/tasks/{task_id}/tool-logs/` only when explicitly enabled.
- [x] Added redaction for API keys, GitHub tokens, AWS access keys, bearer tokens, password/token assignments, private-key blocks, and URL credentials.
- [x] Added head/tail truncation for large redacted raw logs.
- [x] Stored raw log paths on `tool_history[].raw_log_path`.
- [x] Added tests for redacted raw-log storage and redaction/truncation helpers.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Implementation Update — Iteration 9

- [x] Added `src/redaction.ts` for secret redaction and raw-log truncation helpers.
- [x] Added `src/supervisor.ts` for deterministic supervisor decisions and worker-result application.
- [x] Added supervisor/worker contract prompt injection in `before_agent_start`.
- [x] Added `reliability_supervisor_decision` tool.
- [x] Added `reliability_submit_worker_result` tool implementing the worker contract: step id, action taken, result, changed files, errors, next recommendation, and complete/blocked/failed status.
- [x] Supervisor now owns worker-step acceptance and state transition for submitted worker results.
- [x] Added tests for supervisor/worker contract acceptance.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Implementation Update — Iteration 10

- [x] Added `src/types.ts` for shared task/config/result types, schemas, constants, and profile defaults.
- [x] Added `src/config.ts` for profile, context, raw-log, and orchestration config normalization.
- [x] Added `src/orchestration.ts` for role prompts, dry-run planning, JSON parsing, and separate `pi --mode json --no-session` subprocess role execution.
- [x] Added `orchestrationMode`, `orchestrationModels`, `orchestrationTools`, and `orchestrationMaxOutputChars` config fields.
- [x] Added `/reliability orchestrate [--run]`.
- [x] Separate-model execution remains explicitly opt-in: `orchestrationMode: "separate-model"` plus `--run` plus UI confirmation when available.
- [x] Orchestration runs supervisor, worker, and verifier roles separately; applies valid worker results through supervisor-owned state transitions; merges verifier evidence when present.
- [x] Added tests for orchestration dry-run prompts and JSON parsers.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Implementation Update — Iteration 11

- [x] Extracted shared JSON/text/hash/content helpers into `src/utils.ts`.
- [x] Extracted `.pi/tasks` path helpers into `src/paths.ts`.
- [x] Extracted goal/criteria/default-plan/step-transition logic into `src/planner.ts`.
- [x] Extracted repeated-action blocking into `src/loop-detector.ts`.
- [x] Extracted tool path tracking, tool summaries, and raw-log writes into `src/tool-normalizer.ts`.
- [x] Extracted verification command suggestions into `src/verification-suggestions.ts`.
- [x] Extracted verification output parsers into `src/verifier.ts`.
- [x] Kept `src/core.ts` as a compatibility facade plus remaining task-state/context/scratchpad/verification-state/UI glue.
- [x] Re-ran `npm test` and import smoke test successfully.

### Implementation Update — Iteration 12

- [x] Extracted remaining `src/core.ts` domains into focused modules:
  - `src/task-state.ts`
  - `src/context-builder.ts`
  - `src/scratchpad.ts`
  - `src/verification-state.ts`
  - `src/completion-gate.ts`
  - `src/progress-ui.ts`
- [x] Converted `src/core.ts` into a compatibility re-export facade.
- [x] Added `src/evaluation.ts` for deterministic offline reliability evaluation metrics.
- [x] Added `/reliability eval [--write]` to report repeated-action blocking, false-completion gating, verification failure capture, parser behavior, and context-size behavior.
- [x] `--write` stores Markdown and JSON reports under `.pi/reliability-evaluations/`.
- [x] Added tests for offline reliability evaluation metrics and command UX.
- [x] Re-ran `npm test`, import smoke test, and `npm pack --dry-run --json` successfully.

### Current Plan Status

The reliability harness now has a complete MVP++ implementation: persistent task state, planning, scratchpad, compact/delta context headers, loop detection, verification suggestions/parsers, strict completion gating, task UX, profiles, optional redacted raw logs, granular domain modules, deterministic supervisor/worker contract, opt-in separate-model supervisor/worker/verifier subprocess orchestration, offline reliability evaluation metrics, and a 15-test Node test suite.

### Next Implementation Backlog

Prioritize these next, in order:

1. [ ] **Live small-model reliability evaluation**.
   - Run the harness on representative coding/research/resume/verification tasks using strict/balanced/relaxed profiles and prompt-contract vs separate-model orchestration.
   - Acceptance: record task completion, repeated actions, false completions, verification coverage, context size metrics, model IDs, and cost/usage where available.
2. [ ] **Optional in-process role runner**.
   - Replace subprocess role orchestration with SDK-backed in-process role calls if a safe extension-local model-call abstraction is preferable.
   - Acceptance: preserves opt-in behavior, cancellation, and no-secret logging defaults.

---

## Core Problem

Smaller LLMs often fail on long or multi-step tasks because they:

- Lose the original objective.
- Forget completed work.
- Repeat the same tool calls.
- Drift into unrelated tasks.
- Misread or ignore previous tool output.
- Prematurely declare success.
- Fail to update their plan after errors.

The fix is not only a better prompt. The harness must continuously manage task state, context, memory, validation, and execution flow.

---

## Architecture Overview

```text
User Request
    ↓
Task Initializer
    ↓
Persistent Task State
    ↓
Planner
    ↓
Execution Loop
    ├─ Context Builder
    ├─ LLM Worker
    ├─ Tool Executor
    ├─ State Updater
    ├─ Loop Detector
    └─ Verifier
    ↓
Final Response
```

---

## Phase 1 — Persistent Task State

### Objective

Create a structured state object that survives across every model call and tool invocation.

The model may forget the task. The task state must not.

### Task State Schema

```json
{
  "task_id": "uuid",
  "created_at": "timestamp",
  "updated_at": "timestamp",
  "status": "planning | executing | blocked | verifying | complete | failed",
  "user_goal": "original user request",
  "normalized_goal": "clear restatement of the goal",
  "success_criteria": [],
  "constraints": [],
  "current_phase": "",
  "current_step_id": "",
  "plan": [],
  "completed_steps": [],
  "blocked_steps": [],
  "known_facts": [],
  "open_questions": [],
  "decisions": [],
  "tool_history": [],
  "files_touched": [],
  "errors": [],
  "next_action": "",
  "final_answer_requirements": []
}
```

### Implementation Tasks

- Create `TaskState` model.
- Store state in SQLite or local JSON.
- Add load/save/update helpers.
- Write state after every tool call.
- Write state after every model response.
- Include state diff logging for debugging.

### Acceptance Criteria

- A task can resume after interruption.
- The current goal is available before every LLM call.
- Completed steps are not lost.
- Errors and decisions remain visible throughout the task.

---

## Phase 2 — Explicit Planning System

### Objective

Force every non-trivial task through a structured plan before execution.

### Plan Schema

```json
{
  "step_id": "S1",
  "title": "Inspect repository structure",
  "description": "Find relevant files and project layout.",
  "status": "pending | in_progress | complete | blocked | skipped",
  "depends_on": [],
  "expected_output": "Repository summary",
  "verification": "Relevant files identified"
}
```

### Planning Rules

- Every task gets a plan unless it is trivial.
- Each action must map to a plan step.
- The model may propose plan changes, but the harness records them.
- The plan must include success criteria.
- The plan must include a verification step.

### Implementation Tasks

- Add `create_plan()` function.
- Add `update_plan_step()` function.
- Add `select_next_step()` function.
- Add prompt template for planning.
- Add prompt template for revising the plan after failures.

### Acceptance Criteria

- The agent can explain what step it is currently doing.
- No tool call happens without a related plan step.
- Failed steps are marked and handled instead of forgotten.

---

## Phase 3 — Goal Reminder Injection

### Objective

Before every LLM call, inject a compact reminder of the current task.

### Context Header Template

```text
PRIMARY GOAL:
{normalized_goal}

SUCCESS CRITERIA:
{success_criteria}

CURRENT STEP:
{current_step}

COMPLETED STEPS:
{completed_steps}

CONSTRAINTS:
{constraints}

DO NOT:
- Work on unrelated tasks.
- Repeat completed work.
- Claim completion without verification.
```

### Implementation Tasks

- Add `build_context_header(task_state)`.
- Insert context header before every model call.
- Keep reminder compact enough for small context windows.
- Prefer task state over raw chat history.

### Acceptance Criteria

- The current goal appears in every execution prompt.
- The model is reminded of already completed work.
- The model is explicitly warned against false completion.

---

## Phase 4 — Scratchpad Memory File

### Objective

Maintain a human-readable task scratchpad that summarizes the task outside the model context.

### File

```text
.pi/tasks/{task_id}/scratchpad.md
```

### Scratchpad Template

```markdown
# Task Scratchpad

## Goal

## Success Criteria

## Current Status

## Completed

## Current Problem

## Decisions

## Important Facts

## Files Touched

## Next Action
```

### Implementation Tasks

- Create scratchpad on task start.
- Update scratchpad after each major step.
- Inject scratchpad summary into context.
- Allow the user to inspect it.
- Allow the model to propose updates, but validate them through the harness.

### Acceptance Criteria

- The scratchpad accurately reflects current task state.
- The task can be resumed from the scratchpad and state file.
- The scratchpad does not grow without compression.

---

## Phase 5 — Context Builder and Compression

### Objective

Replace long raw conversation history with a curated context package.

### Context Package

```text
1. Goal reminder
2. Current plan step
3. Scratchpad summary
4. Relevant tool outputs
5. Relevant file snippets
6. Recent errors
7. Required response format
```

### Implementation Tasks

- Add `ContextBuilder` module.
- Rank context items by relevance.
- Summarize old tool outputs.
- Keep optional redacted raw logs on disk only when explicitly enabled.
- Inject only relevant excerpts.
- Add token budget management.

### Acceptance Criteria

- Old irrelevant context is not blindly included.
- Important decisions remain available.
- Context stays small enough for local/smaller models.

---

## Phase 6 — Loop Detection

### Objective

Detect when the agent repeats itself and force a strategy change.

### Signals

Track repeated:

- Tool calls.
- File reads.
- Failed commands.
- Similar model outputs.
- Same plan step without progress.

### Example Rule

```text
If the same tool call with the same arguments occurs 3 times, interrupt and ask the model to choose a different strategy.
```

### Implementation Tasks

- Add `ActionHistory` tracker.
- Hash tool name + arguments.
- Detect repeated failed actions.
- Detect no-progress loops.
- Add loop warning prompt.
- Require the next action to be different after a loop warning.

### Acceptance Criteria

- The agent cannot endlessly read the same file.
- The agent cannot rerun the same failing command indefinitely.
- Loop warnings are stored in task state.

---

## Phase 7 — Verification Layer

### Objective

Prevent false completion by checking success criteria before final output.

### Verification Modes

- Checklist verification.
- Test command verification.
- File existence verification.
- Diff review.
- User-facing answer review.
- Optional second-model review.

### Verification Prompt

```text
Verify whether the task is complete.

Goal:
{goal}

Success Criteria:
{success_criteria}

Evidence:
{evidence}

For each criterion, answer:
- Passed / Failed / Unknown
- Evidence
- Remaining work
```

### Implementation Tasks

- Add `Verifier` module.
- Require evidence for each success criterion.
- Block final answer if critical criteria fail.
- Allow partial completion only if clearly disclosed.

### Acceptance Criteria

- The agent cannot mark a task complete without evidence.
- Missing criteria are reported clearly.
- Failed verification routes back to planning or execution.

---

## Phase 8 — Supervisor / Worker Split

### Objective

Improve small-model reliability by separating control from execution.

### Roles

```text
Supervisor
- Owns task state.
- Selects next step.
- Checks progress.
- Prevents drift.

Worker
- Performs one focused task.
- Uses tools.
- Returns structured result.

Verifier
- Checks whether the result satisfies the step.
```

### Worker Contract

```json
{
  "step_id": "S3",
  "action_taken": "",
  "result": "",
  "files_changed": [],
  "errors": [],
  "next_recommendation": "",
  "status": "complete | blocked | failed"
}
```

### Implementation Status

- [x] Added role-specific supervisor/worker contract prompt in `src/supervisor.ts`.
- [x] Injected the worker contract during `before_agent_start`.
- [x] Added `reliability_supervisor_decision` for inspecting the current supervisor-selected step.
- [x] Added `reliability_submit_worker_result` for structured worker output.
- [x] Supervisor validates the submitted `step_id` and owns task-state transitions.
- [x] Worker result contract supports changed files, errors, next recommendation, and complete/blocked/failed status.
- [x] Added supervisor/worker contract tests.
- [x] Added `src/orchestration.ts` for separate supervisor, worker, and verifier role prompts.
- [x] Added opt-in `/reliability orchestrate --run` subprocess orchestration using `pi --mode json --no-session`.
- [x] Added orchestration dry-run/parser tests.
- [ ] Optional future: replace subprocess orchestration with an in-process SDK role runner if Pi exposes a safe extension-local model-call abstraction.

### Acceptance Criteria

- [x] Workers receive a narrow current-step contract.
- [x] Supervisor remains aware of the whole task through persistent task state.
- [x] Step results are structured and task-state updates are supervisor-owned.
- [x] Separate-model orchestration is available as explicit opt-in subprocess execution.
- [ ] In-process separate-role execution remains future work.

---

## Phase 9 — Tool Result Normalization

### Objective

Make tool output easier for small models to use correctly.

### Strategy

Raw tool output should be converted into compact summaries before reinjection.

### Normalized Tool Result

```json
{
  "tool": "read_file",
  "arguments": {},
  "status": "success | error",
  "summary": "",
  "important_details": [],
  "artifacts": [],
  "next_relevance": "",
  "raw_log_path": ""
}
```

### Implementation Tasks

- Wrap all tool calls.
- Store raw output separately.
- Summarize long outputs.
- Extract errors and warnings.
- Attach tool result to current plan step.

### Acceptance Criteria

- Long logs do not flood the model context.
- Important errors remain visible.
- Tool output is traceable to plan steps.

---

## Phase 10 — User-Facing Progress Updates

### Objective

Keep the user informed without exposing low-level noise.

### Rules

Send updates when:

- A plan is created.
- A major phase completes.
- The task is blocked.
- Verification fails.
- The task is partially complete.

### Update Template

```text
Current focus: {current_step}
Completed: {recent_completion}
Next: {next_action}
```

### Implementation Tasks

- Add progress event emitter.
- Generate concise summaries from task state.
- Avoid repeating the same update.
- Do not expose internal scratchpad unless requested.

### Acceptance Criteria

- Users can understand what the agent is doing.
- Progress updates do not spam the user.
- Blockers are surfaced early.

---

## Phase 11 — Configuration

### MVP Config

Save optional project configuration at `.pi/reliability.json` in a trusted project:

```json
{
  "enabled": false,
  "profile": "balanced",
  "requirePlan": true,
  "requireVerification": true,
  "maxRepeatedAction": 3,
  "scratchpadEnabled": true,
  "contextBudgetChars": 6000,
  "contextMode": "compact",
  "progressWidget": true,
  "storeRawToolLogs": false,
  "rawLogMaxChars": 50000,
  "orchestrationMode": "prompt",
  "orchestrationModels": {
    "supervisor": "provider/model-id",
    "worker": "provider/model-id",
    "verifier": "provider/model-id"
  },
  "orchestrationTools": ["read", "grep", "find", "ls"],
  "orchestrationMaxOutputChars": 50000
}
```

Role-specific model overrides are supported via `orchestrationModels`; subprocess execution remains opt-in via `orchestrationMode: "separate-model"` plus `/reliability orchestrate --run`.

### Implementation Tasks

- [x] Add config section.
- [x] Allow reliability mode to be enabled per task/session with `/reliability on` and `--reliability`.
- [x] Allow stricter mode for small models.
- [x] Allow relaxed mode for large models.

---

## Phase 12 — Testing Strategy

### Test Scenarios

1. Long coding task with many files.
2. Research task with many sources.
3. Task with repeated tool failure.
4. Task where the model tries to declare success early.
5. Task interrupted and resumed later.
6. Task with changed user requirements mid-run.
7. Task with irrelevant tempting context.

### Implemented Test Coverage

- [x] Task creation writes `state.json` and `scratchpad.md`.
- [x] Context hook injects the reliability header.
- [x] Context headers support full, compact, and delta modes.
- [x] Redacted raw-log storage is disabled by default and covered by tests.
- [x] Exact repeated tool calls are blocked at the threshold.
- [x] Verification command suggestions are detected from `package.json`.
- [x] Strict and relaxed profiles are loaded from config and affect repeat blocking.
- [x] Strict completion-gate follow-up is queued on unsupported completion claims.
- [x] Failed verification commands are reflected in verification criteria.
- [x] Common verification outputs are parsed into concise pass/fail evidence.
- [x] Task list/resume/archive/orchestrate/eval commands work against `.pi/tasks`.
- [x] Supervisor/worker contract tool accepts current step results and updates task state.
- [x] Orchestration dry-run prompts and JSON parsers are covered.
- [x] Offline reliability evaluation metrics are covered.
- [x] Current suite: 15 Node tests pass with `npm test`.

### Metrics

Track:

- Task completion rate.
- Number of repeated actions.
- Number of false completions.
- Number of successful resumptions.
- Average context size.
- Number of plan revisions.
- Tool calls per completed step.

### Acceptance Criteria

- Fewer repeated tool calls.
- Fewer false completions.
- Better resume behavior.
- Smaller effective context.
- More reliable small-model performance.

---

## Minimal MVP

Completed and extended in `pi-extension-small-modal-reliability`:

1. [x] `TaskState`
2. [x] Plan creation
3. [x] Goal reminder injection
4. [x] Scratchpad file
5. [x] Loop detection
6. [x] Verification checklist
7. [x] Verification command suggestions and parsers
8. [x] Strict/balanced/relaxed profiles
9. [x] Compact/delta context modes
10. [x] Optional redacted raw-log storage
11. [x] Deterministic supervisor/worker contract
12. [x] Opt-in separate-model supervisor/worker/verifier subprocess orchestration
13. [x] Offline deterministic reliability evaluation metrics
14. [x] Task list/resume/archive/orchestrate/eval UX
15. [x] Node test suite for core extension lifecycle behavior

This MVP already solves the most common small-model failures.

---

## Suggested File Structure

```text
pi-extension-small-modal-reliability/
  package.json
  index.ts
  README.md
  LICENSE
  src/
    core.ts
    completion-gate.ts
    config.ts
    context-builder.ts
    evaluation.ts
    loop-detector.ts
    orchestration.ts
    paths.ts
    planner.ts
    progress-ui.ts
    redaction.ts
    scratchpad.ts
    supervisor.ts
    task-state.ts
    tool-normalizer.ts
    types.ts
    utils.ts
    verification-state.ts
    verification-suggestions.ts
    verifier.ts
  tests/
    reliability-harness.test.mjs

.pi/tasks/
  latest.json
  {task_id}/
    state.json
    scratchpad.md
    state-events.jsonl
```

Future larger versions may add optional live-evaluation and SDK-runner modules:

```text
src/
  live-evaluation.ts
  role-runner-sdk.ts
```

---

## Example Event-Driven Extension Loop

```typescript
pi.on("before_agent_start", (event, ctx) => {
  state = ensureTask(ctx, event.prompt);
  selectNextStep(state);
  saveTaskState(state, "before_agent_start");
  return { systemPrompt: event.systemPrompt + reliabilityInstructions };
});

pi.on("context", (event) => {
  return { messages: [...event.messages, buildContextHeaderMessage(state)] };
});

pi.on("tool_call", (event, ctx) => {
  if (detectRepeatedToolCall(state, event)) {
    recordLoopWarning(state, event);
    return { block: true, reason: "Choose a different strategy." };
  }
  recordToolCall(state, event);
  saveTaskState(state, "tool_call_recorded");
});

pi.on("tool_result", (event) => {
  normalizeAndRecordToolResult(state, event);
  updateScratchpad(state);
  saveTaskState(state, "tool_result_recorded");
});

pi.on("message_end", (event) => {
  recordAssistantResponse(state, event.message);
  saveTaskState(state, "assistant_message_recorded");
});

pi.on("agent_end", () => {
  const verification = computeVerification(state);
  if (allCriteriaPassed(verification)) markTaskComplete(state);
  updateScratchpad(state);
  saveTaskState(state, "agent_end");
});
```

---

## Final Design Principle

Do not make the smaller model remember the task.

Make the harness remember, constrain, verify, summarize, and recover.

The model should only decide the next focused action inside a controlled loop.
