# Development guide: Small Modal Reliability for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Model-facing tools

- `reliability_status` — inspect current task state and scratchpad path.
- `reliability_set_plan` — replace or extend the current plan.
- `reliability_record_progress` — persist facts, decisions, errors, files, next action, and step status.
- `reliability_verify_completion` — record Passed/Failed/Unknown evidence for success criteria.
- `reliability_suggest_verification` — suggest verification commands from manifests (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, etc.).
- `reliability_supervisor_decision` — inspect the deterministic supervisor-selected worker step.
- `reliability_submit_worker_result` — submit structured worker completion/block/fail output for the selected step.

## Workflow diagrams

These diagrams split the package into two views:

- **Frontend / user-facing flow** — what the Pi user sees and controls in the terminal UI. This package does not ship a separate browser frontend.
- **Backend / runtime flow** — how the extension stores state, intercepts Pi lifecycle events, supervises the assistant, and gates completion claims.

### Frontend / user-facing workflow

```mermaid
flowchart TD
  Start([You start Pi]) --> Enable{Reliability enabled?}
  Enable -->|CLI flag or /reliability on| Armed[Harness is armed]
  Enable -->|No| Normal[Normal Pi session]

  Armed --> Goal{Did you provide a goal?}
  Goal -->|Yes| Task[Task appears with goal,<br/>plan, progress, and scratchpad]
  Goal -->|No| Wait[Wait for your next prompt]
  Wait --> Task

  Task --> Work[Assistant works one focused step at a time]
  Work --> Screen[Pi screen stays updated:<br/>status badge + progress widget]
  Screen --> Control{Need to inspect or steer it?}

  Control -->|status / tasks / scratchpad| Inspect[Review task state,<br/>task list, or scratchpad path]
  Control -->|profile / context| Tune[Adjust strictness<br/>or context detail]
  Control -->|suggest / verify| Evidence[Get suggested checks<br/>or record verification evidence]
  Control -->|resume / archive| Manage[Resume or archive<br/>saved reliability tasks]
  Control -->|orchestrate| Roles[Preview or run<br/>supervisor, worker, verifier roles]

  Inspect --> Work
  Tune --> Work
  Manage --> Work
  Roles --> Work
  Evidence --> DoneCheck{Assistant claims the work is done?}
  Work --> DoneCheck

  DoneCheck -->|Missing or failed evidence| Warn[Pi warns that criteria<br/>are still unknown or failed]
  Warn --> Evidence
  DoneCheck -->|Evidence passed| Final[Final answer includes<br/>what changed, checks run,<br/>and remaining risks]

  classDef user fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20;
  classDef ui fill:#e3f2fd,stroke:#1565c0,color:#0d47a1;
  classDef control fill:#fff8e1,stroke:#f9a825,color:#5d4037;
  classDef warn fill:#ffebee,stroke:#c62828,color:#7f0000;
  classDef final fill:#ede7f6,stroke:#5e35b1,color:#311b92;

  class Start,Enable,Armed,Goal,Task,Wait,Work user;
  class Normal,Screen,Inspect ui;
  class Control,Tune,Evidence,Manage,Roles control;
  class Warn warn;
  class Final final;
```

### Backend / runtime workflow

```mermaid
flowchart TD
  subgraph Startup[Startup and resume]
    S1[session_start event] --> S2[Read trusted .pi/reliability.json<br/>and normalize profile]
    S2 --> S3[Restore saved task pointer<br/>or load latest open task]
    S3 --> S4[Update Pi status badge<br/>and progress widget]
  end

  subgraph Turn[Each user prompt]
    T1[before_agent_start event] --> T2{Active task exists?}
    T2 -->|No| T3[Create TaskState:<br/>goal, criteria, constraints,<br/>default plan, counters]
    T2 -->|Yes| T4[Record user update<br/>as bounded known fact]
    T3 --> T5[Select next plan step]
    T4 --> T5
    T5 --> T6[Build supervisor decision<br/>and worker contract]
    T6 --> T7[(Save state.json,<br/>scratchpad.md,<br/>state-events.jsonl)]
    T7 --> T8[Inject harness instructions<br/>into the system prompt]
  end

  subgraph Context[Context injection before each model call]
    C1[context event] --> C2[Build full, compact,<br/>or delta reliability header]
    C2 --> C3[Append header as a user message]
    C3 --> C4[Model receives current goal,<br/>step, warnings, next action,<br/>and verification snapshot]
  end

  subgraph Tools[Tool loop and state updates]
    L1[tool_call event] --> L2{Repeat limit exceeded<br/>or same failure repeated?}
    L2 -->|Yes| L3[Block the tool call,<br/>mark task/step blocked,<br/>notify user]
    L2 -->|No| L4[Record tool hash,<br/>arguments preview,<br/>current step]
    L4 --> L5[tool_result event]
    L5 --> L6[Summarize result,<br/>track read/modified files,<br/>redact optional raw logs]
    L6 --> L7{Was it a verification command?}
    L7 -->|Yes| L8[Parse test/check output<br/>and update verification records]
    L7 -->|No| L9[Advance plan state<br/>from observed work]
    L8 --> L10[(Save state and refresh UI)]
    L9 --> L10
    L3 --> L10
  end

  subgraph ReliabilityTools[Registered reliability tools]
    R1[reliability_set_plan] --> RPlan[Replace or extend plan]
    R2[reliability_record_progress] --> RProgress[Record facts, decisions,<br/>errors, files, next action]
    R3[reliability_verify_completion] --> RVerify[Merge explicit evidence<br/>and optionally mark complete]
    R4[reliability_supervisor_decision] --> RDecision[Expose current worker contract]
    R5[reliability_submit_worker_result] --> RWorker[Apply worker status,<br/>files, errors, recommendation]
    RPlan --> RSave[(Save state and refresh UI)]
    RProgress --> RSave
    RVerify --> RSave
    RWorker --> RSave
  end

  subgraph Completion[Assistant response and completion gate]
    M1[message_end event] --> M2[Record assistant summary<br/>as a bounded known fact]
    M2 --> M3{Completion claim detected?}
    M3 -->|No| M4[(Save state)]
    M3 -->|Yes| M5[Compute criteria status:<br/>passed, failed, unknown]
    M5 --> M6{Failed or unknown criteria remain?}
    M6 -->|Yes| M7[Notify user and, in strict profile,<br/>send a follow-up gate prompt]
    M6 -->|No| M8[agent_end marks task complete<br/>when all criteria pass]
    M7 --> M4
    M8 --> M4
    M4 --> M9[session_shutdown saves<br/>last active state]
  end

  subgraph Orchestration[Optional separate-model orchestration]
    O1["/reliability orchestrate"] --> O2{Mode is separate-model<br/>and --run was confirmed?}
    O2 -->|No| O3[Show dry-run prompts<br/>for supervisor, worker, verifier]
    O2 -->|Yes| O4[Run supervisor subprocess]
    O4 --> O5[Run worker subprocess<br/>with allowed tools]
    O5 --> O6[Run verifier subprocess]
    O6 --> O7[Apply worker result<br/>and merge verifier evidence]
    O7 --> RSave
  end

  S4 --> T1
  T8 --> C1
  C4 --> L1
  L10 --> M1
  RSave --> C1

  classDef event fill:#e3f2fd,stroke:#1565c0,color:#0d47a1;
  classDef state fill:#f1f8e9,stroke:#558b2f,color:#1b5e20;
  classDef decision fill:#fff8e1,stroke:#f9a825,color:#5d4037;
  classDef blocked fill:#ffebee,stroke:#c62828,color:#7f0000;
  classDef optional fill:#ede7f6,stroke:#5e35b1,color:#311b92;

  class S1,T1,C1,L1,L5,M1 event;
  class S3,S4,T3,T4,T7,L4,L6,L8,L9,L10,RPlan,RProgress,RVerify,RWorker,RSave,M2,M4,M8,M9 state;
  class T2,T5,T6,L2,L7,M3,M5,M6,O2 decision;
  class L3,M7 blocked;
  class RDecision,O1,O3,O4,O5,O6,O7 optional;
```

## What this MVP enforces

- Persistent JSON `TaskState` survives reload/resume.
- A deterministic initial plan exists for every active task.
- A compact reliability header is appended to every LLM context.
- Scratchpad is regenerated from state instead of letting the model grow it freely.
- Identical tool calls are blocked at the repeat threshold.
- Verification reports unknowns instead of inventing success.
- Verification suggestions detect common project test/check commands.
- Verification output parsers summarize common TypeScript, ESLint, Ruff, mypy, pytest, Cargo, Go test, JavaScript, Maven, and Gradle results.
- Strict/balanced/relaxed profiles tune repeat blocking, verification pressure, and default context mode.
- Context headers support `full`, `compact`, and `delta` modes to reduce repeated state injection.
- Optional raw tool log storage writes redacted/truncated logs under `.pi/tasks/{task_id}/tool-logs/` only when `storeRawToolLogs` is enabled.
- Strict profile queues a completion-gate follow-up if the assistant claims completion with failed/unknown criteria.
- Supervisor/worker split uses deterministic supervisor decisions plus `reliability_submit_worker_result` for structured worker completion/block/fail results.
- Optional separate-model orchestration can run supervisor, worker, and verifier roles as separate `pi --mode json --no-session` subprocesses.
- Offline reliability evaluation reports deterministic harness metrics with `/reliability eval [--write]`.
- Task list/resume/archive/eval UX is available from `/reliability` commands.
- Plan mode can split exploration, planning, one-step implementation, summary, verification, failure remediation, and final reporting across fresh sessions using durable Markdown artifacts.

## Development

Source layout:

```text
index.ts                        # Pi extension registration, commands, tools, event wiring
src/core.ts                     # Compatibility re-export facade
src/completion-gate.ts          # Completion-claim detection and strict follow-up prompt
src/config.ts                   # Config/profile/context/orchestration normalization
src/context-builder.ts          # Full/compact/delta reliability context headers
src/evaluation.ts               # Offline deterministic reliability evaluation metrics
src/loop-detector.ts            # Repeated-tool-call loop detection
src/orchestration.ts            # Separate-model role prompts, subprocess runner, and result parsing
src/paths.ts                    # Task-local path helpers
src/plan-mode.ts                # Fresh-session Markdown plan workflow orchestration
src/planner.ts                  # Goal extraction, default plan, and step transitions
src/progress-ui.ts              # Status text and widget updates
src/redaction.ts                # Secret redaction and raw-log truncation helpers
src/scratchpad.ts               # Scratchpad rendering
src/supervisor.ts               # Deterministic supervisor decision and worker-result contract
src/task-state.ts               # Persistent task state and task list/resume/archive helpers
src/tool-normalizer.ts          # Tool path extraction, summaries, and optional raw-log writes
src/types.ts                    # Shared task/config/result types and constants
src/utils.ts                    # Shared JSON, time, text, hashing, and content helpers
src/verification-state.ts       # Verification records and completion marking
src/verifier.ts                 # Verification command output parsers
src/verification-suggestions.ts # Project manifest verification command suggestions
tests/                          # Node test runner mocks for Pi lifecycle events
```

```bash
npm test
npm pack --dry-run --json
```

The test suite mocks Pi extension lifecycle events and covers task creation, context injection, context modes, profile behavior, supervisor/worker contracts, orchestration dry-runs/parsers, offline evaluation metrics, completion gating, loop blocking, redacted raw-log storage, verification suggestions, parsed verification results/failures, and task list/resume/archive commands.

## Additional implementation details

```bash
pi -e ./pi-extension-small-modal-reliability/index.ts --reliability
```
