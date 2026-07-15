# Pi JavaScript Workflow Runtime Implementation Plan

## Document status

| Field | Value |
| --- | --- |
| Status | Complete — all 94 tracked tasks and acceptance gates implemented |
| Created | 2026-07-15 |
| Scope | `pi-extension-workflows`, native Pi TUI, and `pi-package-webui` |
| Current implementation | Capability-only JavaScript runtime, legacy JSON adapter, asynchronous multi-run manager, replay, inspectors, isolated writers, and ecosystem tooling |
| Target implementation | Claude-shaped reusable JavaScript workflows with capability-only execution |
| Primary package | `pi-extension-workflows/` |
| WebUI package | `pi-package-webui/` |
| Tracking convention | Stable task IDs, priorities, dependencies, checkboxes, acceptance criteria, and evidence links |

## 1. Objective

Replace the current JSON-first authoring model with a reusable JavaScript workflow model in which:

1. The main Pi agent can generate a workflow script for a task.
2. The user can inspect and approve the generated script before execution.
3. A capability-only JavaScript runtime executes the orchestration in the background.
4. The script controls phases, branching, loops, fanout, and intermediate values.
5. Agent work is performed by isolated Pi subprocesses rather than by the script directly.
6. Every run persists its script, state, events, usage, and consolidated result.
7. Successful scripts can be saved at project or user scope and rerun with structured arguments.
8. Native Pi TUI and WebUI use the same extension-owned runtime and state.

Target flow:

```text
User prompt
  → main Pi agent writes JavaScript workflow
  → workflow_run accepts script/name/scriptPath
  → syntax, policy, and scale validation
  → user approval
  → background workflow runtime
  → phase and agent fanout
  → consolidated result returned to session
  → optional save for reuse
```

## 2. Non-goals for the first release

- Exact byte-for-byte compatibility with Anthropic's private runtime.
- Arbitrary Node.js module execution.
- Direct filesystem, shell, environment, or network access from workflow JavaScript.
- Cross-host durable execution.
- Parallel writes against one shared working tree.
- Automatic execution of generated code without validation and approval.
- Raising current concurrency/task limits before budget controls are implemented.

## 3. Priority definitions

| Priority | Meaning | Release rule |
| --- | --- | --- |
| **P0** | Required foundation, security, and usable read-only release | All P0 tasks and acceptance checks must pass before enabling JS workflows by default |
| **P1** | Reuse, resume, and complete TUI/WebUI operability | Required before calling the feature complete |
| **P2** | Write workflows, advanced policy, and quality improvements | Implement only after the read-only runtime is stable |
| **P3** | Optional compatibility and ecosystem enhancements | May be deferred without blocking release |

## 4. Status definitions

Use exactly these states in the dashboard and task notes:

- `NOT STARTED`
- `IN PROGRESS`
- `BLOCKED`
- `DONE`
- `DEFERRED`

Checkbox mapping:

```text
- [ ] NOT STARTED or BLOCKED
- [-] IN PROGRESS
- [x] DONE
```

A task may be marked `DONE` only when its acceptance criteria are met and verification evidence is linked in this document.

## 5. Progress dashboard

| Milestone | Priority | Status | Progress | Blocking dependency |
| --- | --- | --- | --- | --- |
| M0 — Contracts and security boundary | P0 | DONE | 8/8 | None |
| M1 — JS discovery, parser, and sandbox | P0 | DONE | 10/10 | M0 |
| M2 — Agent primitives and scheduler | P0 | DONE | 10/10 | M1 |
| M3 — Background run manager and result delivery | P0 | DONE | 10/10 | M2 |
| M4 — `workflow_run` tool and Workflow Mode | P0 | DONE | 10/10 | M3 |
| M5 — Save, reuse, and migration | P1 | DONE | 9/9 | M4 |
| M6 — Native TUI and WebUI inspectors | P1 | DONE | 10/10 | M3, M4 |
| M7 — Replay-based pause/resume | P1 | DONE | 9/9 | M3, M5 |
| M8 — Write-capable isolated workflows | P2 | DONE | 10/10 | M7 |
| M9 — Compatibility and ecosystem polish | P2/P3 | DONE | 8/8 | M5, M6 |

Overall progress: **94/94 tasks complete**.

## 6. Key architecture decisions

### AD-001 — JavaScript is the reusable authoring artifact

**Decision:** Saved workflows use `.js` files. JSON remains temporarily as a legacy input adapter.

**Rationale:** The script must hold loops, branches, fanout, and intermediate variables. Static JSON phases cannot model this naturally.

### AD-002 — Scripts receive capabilities, not host access

**Decision:** Workflow JavaScript receives only:

- `args`
- `agent()`
- `phase()`
- `parallel()`
- `pipeline()`

The script does not receive `process`, `require`, `import`, filesystem APIs, shell APIs, network APIs, environment variables, `eval`, or `Function`.

### AD-003 — Do not use `import()` or Node `vm` as the security boundary

**Decision:** Prefer a capability-only isolated runtime such as QuickJS/WASM or an equivalent isolated interpreter. If a Node subprocess is used during development, it must be restricted to explicitly trusted scripts and documented as a transitional non-security boundary.

### AD-004 — Agents perform all external actions

**Decision:** The workflow script coordinates work. Pi subprocess agents perform reads, searches, edits, shell operations, and network calls according to a frozen run policy.

### AD-005 — Runs are asynchronous

**Decision:** `workflow_run` returns after validation, approval, persistence, and background launch. Progress and final results arrive through extension UI events and session messages.

### AD-006 — Resume uses replay and cached calls

**Decision:** Do not serialize JavaScript VM memory. Resume re-executes the script and returns cached results for completed, unchanged `agent()` invocations.

### AD-007 — Extension state is canonical

**Decision:** `pi-extension-workflows` owns definitions, mode state, runs, policies, and events. WebUI and native TUI are control and rendering surfaces only.

### AD-008 — Read-only first

**Decision:** The first production release allows only `read`, `grep`, `find`, and `ls` in workflow agents. Write/shell/network workflows require later policy and isolation milestones.

## 7. JavaScript workflow contract

### 7.1 Required source shape

```js
export const meta = {
  name: "audit-routes",
  description: "Audit route handlers for missing authentication",
  phases: ["discover", "audit", "verify"],
  pi: {
    maxConcurrency: 4,
    maxAgents: 50,
    permissions: {
      write: false,
      shell: false,
      network: false
    }
  }
}

const discovered = await phase("discover", () =>
  agent("List every TypeScript file under src/routes.", {
    label: "discover-routes",
    tools: ["find", "read"],
    schema: {
      type: "object",
      required: ["files"],
      properties: {
        files: {
          type: "array",
          items: { type: "string" }
        }
      }
    }
  })
)

const audits = await phase("audit", () =>
  pipeline(
    discovered.files,
    file => agent(`Audit ${file} for missing authentication checks.`, {
      label: `audit:${file}`,
      tools: ["read", "grep"]
    }),
    { concurrency: 4, key: file => file }
  )
)

return await phase("verify", () =>
  agent(`Verify and consolidate these findings:\n${JSON.stringify(audits)}`, {
    label: "verify-findings",
    tools: ["read", "grep"]
  })
)
```

### 7.2 `meta` contract

Required:

```ts
type WorkflowMeta = {
  name: string;
  description: string;
  phases?: string[];
  pi?: {
    version?: 1;
    inputSchema?: unknown;
    maxConcurrency?: number;
    maxAgents?: number;
    timeoutMs?: number;
    permissions?: {
      write?: boolean;
      shell?: boolean;
      network?: boolean;
    };
  };
};
```

Rules:

- `meta` must be the first exported declaration.
- `meta` must be a static object literal.
- `name` must be slug-like and must match the saved filename.
- Unknown `pi` policy keys fail validation.
- Limits are requests and are clamped by global hard limits.
- Effective permissions are the intersection of script requests, extension policy, project trust, and user approval.

### 7.3 Runtime primitive contracts

```ts
declare const args: unknown;

declare function agent<T = string>(
  prompt: string,
  options?: {
    label?: string;
    model?: string;
    tools?: string[];
    cwd?: string;
    schema?: unknown;
    timeoutMs?: number;
  }
): Promise<T>;

declare function phase<T>(name: string, run: () => Promise<T>): Promise<T>;

declare function parallel<T>(
  tasks: Array<() => Promise<T>>,
  options?: { concurrency?: number }
): Promise<T[]>;

declare function pipeline<TInput, TOutput>(
  items: TInput[],
  worker: (item: TInput, index: number) => Promise<TOutput>,
  options?: {
    concurrency?: number;
    key?: (item: TInput, index: number) => string;
  }
): Promise<TOutput[]>;
```

### 7.4 Execution semantics

- The script body is wrapped in an internal async function to support top-level `await` and `return`.
- Results preserve input order for `parallel()` and `pipeline()`.
- All `agent()` calls pass through one scheduler and global semaphore.
- An `agent()` call cannot bypass effective tool policy.
- Pipeline keys must be stable for reliable resume.
- Duplicate explicit labels within one phase are rejected.
- The top-level return value becomes the consolidated workflow result.
- An absent return value produces a structured no-result failure unless `meta.pi.allowEmptyResult` is added in a later schema version.

## 8. `workflow_run` tool contract

```ts
workflow_run({
  script?: string,
  name?: string,
  scriptPath?: string,
  args?: unknown,
  resumeFromRunId?: string,
  confirmRun: boolean
})
```

Rules:

- At least one of `script`, `name`, or `scriptPath` is required.
- Resolution precedence is `scriptPath`, then `script`, then `name`.
- `confirmRun` represents explicit user intent but does not replace launch approval when policy requires approval.
- Inline scripts are persisted before execution.
- Syntax or policy failure returns an error and does not create a running task.
- Successful launch returns immediately with `terminate: true`.

Expected result:

```json
{
  "status": "async_launched",
  "taskId": "workflow-task-...",
  "runId": "workflow-run-...",
  "summary": "Audit route handlers",
  "scriptPath": ".../workflow.js"
}
```

## 9. Storage layout

### 9.1 Generated run snapshots

```text
~/.pi/agent/workflow-runs/
└── <session-id>/
    └── <run-id>/
        ├── workflow.js
        ├── run.json
        ├── policy.json
        ├── events.jsonl
        ├── calls/
        │   └── <call-id>.json
        ├── artifacts/
        └── result.md
```

### 9.2 Saved workflows

```text
.pi/workflows/<name>.js
~/.pi/agent/workflows/<name>.js
```

Rules:

- Project scripts load only for trusted projects.
- Generated scripts are never saved into the project automatically.
- Saving to project or user scope requires an explicit command/action.
- Every run records the exact script hash and effective policy snapshot.

## 10. Implementation backlog

### M0 — Contracts and security boundary

- [x] **WFJS-P0-001** — Freeze the v1 workflow script contract documented in section 7. **Priority:** P0. **Depends on:** none. **Acceptance:** exported TypeScript types and JSON schemas represent every public field.
- [x] **WFJS-P0-002** — Write a threat model covering generated code, trusted project code, prompt injection, environment leakage, filesystem escape, network escape, subprocess inheritance, and denial of service. **Priority:** P0. **Depends on:** none. **Acceptance:** threat model names mitigations and residual risks.
- [x] **WFJS-P0-003** — Select the production JavaScript isolation backend through a short proof of concept. **Priority:** P0. **Depends on:** WFJS-P0-002. **Acceptance:** capability injection, async promises, interruption, memory limits, and package portability are demonstrated.
- [x] **WFJS-P0-004** — Define global hard limits for runtime duration, JS memory, concurrent agents, total agents, output bytes, and nested pipeline depth. **Priority:** P0. **Depends on:** WFJS-P0-002. **Acceptance:** defaults and hard caps are documented and testable.
- [x] **WFJS-P0-005** — Define the frozen effective policy calculation. **Priority:** P0. **Depends on:** WFJS-P0-002. **Acceptance:** tests prove scripts cannot widen global/user/project policy.
- [x] **WFJS-P0-006** — Define script approval and remembered-consent records keyed by project identity, script hash, and policy hash. **Priority:** P0. **Depends on:** WFJS-P0-005. **Acceptance:** script or policy changes invalidate consent.
- [x] **WFJS-P0-007** — Define versioned run, call-ledger, event, usage, and result schemas. **Priority:** P0. **Depends on:** WFJS-P0-001. **Acceptance:** schemas support migration and reject invalid state.
- [x] **WFJS-P0-008** — Add architecture decision records for AD-001 through AD-008. **Priority:** P0. **Depends on:** WFJS-P0-001 through WFJS-P0-007. **Acceptance:** decisions are linked from this plan.

### M1 — JS discovery, parser, and sandbox

- [x] **WFJS-P0-009** — Add `.js` discovery for bundled, user, and trusted project workflows. **Priority:** P0. **Depends on:** M0. **Acceptance:** deterministic precedence and duplicate-name errors are tested.
- [x] **WFJS-P0-010** — Parse `export const meta` without executing source code. **Priority:** P0. **Depends on:** WFJS-P0-001. **Acceptance:** dynamic/computed metadata is rejected.
- [x] **WFJS-P0-011** — Validate workflow name, filename, phases, Pi policy fields, and requested limits. **Priority:** P0. **Depends on:** WFJS-P0-010. **Acceptance:** actionable file/line diagnostics are returned.
- [x] **WFJS-P0-012** — Reject imports, `require`, host globals, `eval`, `Function`, WebAssembly, and unsupported syntax. **Priority:** P0. **Depends on:** WFJS-P0-003. **Acceptance:** escape-attempt fixtures fail before execution.
- [x] **WFJS-P0-013** — Implement async body wrapping for top-level `await` and top-level `return`. **Priority:** P0. **Depends on:** WFJS-P0-010. **Acceptance:** representative scripts execute and return structured values.
- [x] **WFJS-P0-014** — Implement structured `args` injection without string re-parsing. **Priority:** P0. **Depends on:** WFJS-P0-013. **Acceptance:** nested objects, arrays, primitives, and `undefined` are tested.
- [x] **WFJS-P0-015** — Enforce JS runtime wall-clock, instruction, and memory limits. **Priority:** P0. **Depends on:** WFJS-P0-003. **Acceptance:** infinite loops and allocation bombs terminate predictably.
- [x] **WFJS-P0-016** — Strip environment variables and inherited handles from any runtime subprocess. **Priority:** P0. **Depends on:** WFJS-P0-003. **Acceptance:** security test confirms secrets and unrelated descriptors are unavailable.
- [x] **WFJS-P0-017** — Add source hashing and immutable run-script snapshots. **Priority:** P0. **Depends on:** WFJS-P0-010. **Acceptance:** each run references a byte-exact script and SHA-256 hash.
- [x] **WFJS-P0-018** — Add parser/sandbox unit tests and adversarial fixtures. **Priority:** P0. **Depends on:** WFJS-P0-009 through WFJS-P0-017. **Acceptance:** all fixtures pass offline.

### M2 — Agent primitives and scheduler

- [x] **WFJS-P0-019** — Refactor `src/task-runner.ts` into a reusable `agent()` backend. **Priority:** P0. **Depends on:** M1. **Acceptance:** existing subprocess execution and usage parsing remain covered.
- [x] **WFJS-P0-020** — Implement `agent(prompt, options)` with labels, model, tools, cwd, timeout, and schema fields. **Priority:** P0. **Depends on:** WFJS-P0-019. **Acceptance:** text and structured outputs are validated.
- [x] **WFJS-P0-021** — Implement `phase(name, callback)` and phase-scoped event emission. **Priority:** P0. **Depends on:** WFJS-P0-020. **Acceptance:** nested phase misuse and duplicate phase state are handled predictably.
- [x] **WFJS-P0-022** — Implement `parallel(tasks, options)` with stable output ordering. **Priority:** P0. **Depends on:** WFJS-P0-020. **Acceptance:** configured concurrency is never exceeded.
- [x] **WFJS-P0-023** — Implement `pipeline(items, worker, options)` with stable item keys. **Priority:** P0. **Depends on:** WFJS-P0-020. **Acceptance:** results preserve input order and keys are persisted.
- [x] **WFJS-P0-024** — Add one global scheduler shared by all runs. **Priority:** P0. **Depends on:** WFJS-P0-022, WFJS-P0-023. **Acceptance:** total concurrent subprocesses remain under the global cap.
- [x] **WFJS-P0-025** — Enforce per-run concurrency, total-agent, timeout, and output limits. **Priority:** P0. **Depends on:** WFJS-P0-024. **Acceptance:** runaway scripts terminate with categorized errors.
- [x] **WFJS-P0-026** — Freeze the effective agent tool policy at run start. **Priority:** P0. **Depends on:** WFJS-P0-005, WFJS-P0-020. **Acceptance:** script-requested tools cannot bypass the frozen policy.
- [x] **WFJS-P0-027** — Implement cancellation propagation from run to scheduler to active subprocesses. **Priority:** P0. **Depends on:** WFJS-P0-019, WFJS-P0-024. **Acceptance:** no child process remains after the bounded termination deadline.
- [x] **WFJS-P0-028** — Add primitive/scheduler integration tests with fake and real-offline task runners. **Priority:** P0. **Depends on:** WFJS-P0-019 through WFJS-P0-027. **Acceptance:** ordering, limits, errors, and cancellation pass.

### M3 — Background run manager and result delivery

- [x] **WFJS-P0-029** — Replace the single `activeRun` assumption with `WorkflowRunManager`. **Priority:** P0. **Depends on:** M2. **Acceptance:** run controllers are keyed by run ID.
- [x] **WFJS-P0-030** — Define run statuses: `queued`, `validating`, `awaiting_approval`, `running`, `paused`, `completed`, `failed`, and `cancelled`. **Priority:** P0. **Depends on:** WFJS-P0-007. **Acceptance:** every transition is validated.
- [x] **WFJS-P0-031** — Persist run metadata, script, policy, calls, events, usage, and result artifacts. **Priority:** P0. **Depends on:** WFJS-P0-017, WFJS-P0-029. **Acceptance:** abrupt process termination leaves inspectable state.
- [x] **WFJS-P0-032** — Make background launch return after acceptance rather than after workflow completion. **Priority:** P0. **Depends on:** WFJS-P0-029. **Acceptance:** RPC response completes while the workflow continues.
- [x] **WFJS-P0-033** — Aggregate usage and cost per agent, phase, and run. **Priority:** P0. **Depends on:** WFJS-P0-020, WFJS-P0-031. **Acceptance:** totals reconcile with task records.
- [x] **WFJS-P0-034** — Produce a consolidated result from the script's top-level return value. **Priority:** P0. **Depends on:** WFJS-P0-013, WFJS-P0-031. **Acceptance:** text, Markdown, JSON, and failure results render consistently.
- [x] **WFJS-P0-035** — Insert visible `workflow-request` and `workflow-result` session messages. **Priority:** P0. **Depends on:** WFJS-P0-034. **Acceptance:** TUI and WebUI transcripts show request and final result without all intermediate agent outputs.
- [x] **WFJS-P0-036** — Add commands to list, inspect, and abort runs by ID. **Priority:** P0. **Depends on:** WFJS-P0-029. **Acceptance:** `/workflows`, `/workflow status <id>`, and `/workflow abort <id>` work.
- [x] **WFJS-P0-037** — Define shutdown behavior for running workflows. **Priority:** P0. **Depends on:** WFJS-P0-027, WFJS-P0-031. **Acceptance:** shutdown cancels or safely marks runs according to policy.
- [x] **WFJS-P0-038** — Add run-manager lifecycle and persistence tests. **Priority:** P0. **Depends on:** WFJS-P0-029 through WFJS-P0-037. **Acceptance:** multi-run, cancellation, failure, and restart fixtures pass.

### M4 — `workflow_run` tool and Workflow Mode

- [x] **WFJS-P0-039** — Evolve `workflow_run` to accept `script`, `name`, `scriptPath`, `args`, and `resumeFromRunId`. **Priority:** P0. **Depends on:** M3. **Acceptance:** legacy key-based calls have a documented migration path.
- [x] **WFJS-P0-040** — Return `async_launched`, task ID, run ID, summary, and persisted script path. **Priority:** P0. **Depends on:** WFJS-P0-032, WFJS-P0-039. **Acceptance:** result shape is schema-tested.
- [x] **WFJS-P0-041** — Return `terminate: true` after a successful launch. **Priority:** P0. **Depends on:** WFJS-P0-040. **Acceptance:** the planning model does not continue pretending to execute the workflow.
- [x] **WFJS-P0-042** — Implement launch approval with Run once, remembered exact-script approval, raw script view, and Cancel. **Priority:** P0. **Depends on:** WFJS-P0-006, WFJS-P0-039. **Acceptance:** TUI and RPC dialog paths are tested.
- [x] **WFJS-P0-043** — Add `/workflow mode once`, `on`, `off`, and `status`. **Priority:** P0. **Depends on:** WFJS-P0-039. **Acceptance:** mode state persists within the session and remains visibly indicated.
- [x] **WFJS-P0-044** — Inject Workflow Mode planner instructions in `before_agent_start`. **Priority:** P0. **Depends on:** WFJS-P0-043. **Acceptance:** the main model is instructed to design a script and call `workflow_run`, not execute the task directly.
- [x] **WFJS-P0-045** — Add tool prompt metadata for explicit requests such as "use a workflow". **Priority:** P0. **Depends on:** WFJS-P0-039. **Acceptance:** the tool is not recommended for routine one-agent tasks.
- [x] **WFJS-P0-046** — Publish structured mode/run status for RPC clients while keeping native TUI status human-readable. **Priority:** P0. **Depends on:** WFJS-P0-043. **Acceptance:** payload is versioned and replayable.
- [x] **WFJS-P0-047** — Reject or arbitrate conflicting exclusive modes. **Priority:** P0. **Depends on:** WFJS-P0-043. **Acceptance:** Natural Conversation and other exclusive modes cannot silently trigger workflow fanout.
- [x] **WFJS-P0-048** — Add tool, approval, and mode integration tests. **Priority:** P0. **Depends on:** WFJS-P0-039 through WFJS-P0-047. **Acceptance:** direct, one-shot, persistent, cancelled, and policy-denied paths pass.

### M5 — Save, reuse, and migration

- [x] **WFJS-P1-001** — Implement `/workflow save <run-id> --project|--user`. **Priority:** P1. **Depends on:** M4. **Acceptance:** save is explicit and never overwrites without confirmation.
- [x] **WFJS-P1-002** — Validate and normalize saved workflow filenames and metadata names. **Priority:** P1. **Depends on:** WFJS-P1-001. **Acceptance:** traversal and collision attempts are rejected.
- [x] **WFJS-P1-003** — Load global workflows from `~/.pi/agent/workflows/*.js`. **Priority:** P1. **Depends on:** M1. **Acceptance:** global scripts are available across projects.
- [x] **WFJS-P1-004** — Load trusted project workflows from `.pi/workflows/*.js`. **Priority:** P1. **Depends on:** M1. **Acceptance:** untrusted project scripts are never parsed beyond safe discovery metadata or executed.
- [x] **WFJS-P1-005** — Implement `/workflow run <name> [json-args]`. **Priority:** P1. **Depends on:** WFJS-P1-003, WFJS-P1-004. **Acceptance:** arrays and objects reach `args` as structured values.
- [x] **WFJS-P1-006** — Add command argument completion for workflow names and run IDs. **Priority:** P1. **Depends on:** WFJS-P1-005. **Acceptance:** native TUI suggestions are current after reload.
- [x] **WFJS-P1-007** — Decide and implement direct saved-workflow aliases such as `/<name>` with collision handling. **Priority:** P1. **Depends on:** WFJS-P1-005. **Acceptance:** canonical `/workflow run` remains available for every workflow.
- [x] **WFJS-P1-008** — Convert `deep-research-minimal.json` into the first bundled JS workflow. **Priority:** P1. **Depends on:** M4. **Acceptance:** behavior and test markers remain equivalent or improve.
- [x] **WFJS-P1-009** — Keep a temporary JSON adapter and document its removal criteria. **Priority:** P1. **Depends on:** WFJS-P1-008. **Acceptance:** existing JSON users receive warnings and a migration command or guide.

### M6 — Native TUI and WebUI inspectors

- [x] **WFJS-P1-010** — Implement native `/workflows` run selector. **Priority:** P1. **Depends on:** M3. **Acceptance:** running and completed workflows can be selected.
- [x] **WFJS-P1-011** — Add native run → phase → agent drilldown. **Priority:** P1. **Depends on:** WFJS-P1-010. **Acceptance:** prompt, recent tool activity, result, usage, and error are inspectable.
- [x] **WFJS-P1-012** — Add native controls for pause/resume, abort, retry agent, and save. **Priority:** P1. **Depends on:** M7, WFJS-P1-010. **Acceptance:** keyboard actions display confirmation where required.
- [x] **WFJS-P1-013** — Extend the RPC workflow payload to represent multiple runs, phases, agents, usage, and mode state. **Priority:** P1. **Depends on:** WFJS-P0-046. **Acceptance:** payload has schema/version tests.
- [x] **WFJS-P1-014** — Add WebUI Workflow Mode controls and active composer chip. **Priority:** P1. **Depends on:** WFJS-P0-043, WFJS-P1-013. **Acceptance:** controls are per tab and use canonical extension commands.
- [x] **WFJS-P1-015** — Add WebUI run list and run detail panel. **Priority:** P1. **Depends on:** WFJS-P1-013. **Acceptance:** active and historical runs render without blocking the transcript.
- [x] **WFJS-P1-016** — Add WebUI phase and agent drilldown. **Priority:** P1. **Depends on:** WFJS-P1-015. **Acceptance:** agent status, prompt, recent events, result, and usage render.
- [x] **WFJS-P1-017** — Add WebUI pause/resume, abort, retry, raw-script, and save actions. **Priority:** P1. **Depends on:** M7, WFJS-P1-015. **Acceptance:** destructive actions require confirmation.
- [x] **WFJS-P1-018** — Add inactive-tab workflow mode and running-run badges. **Priority:** P1. **Depends on:** WFJS-P1-013. **Acceptance:** server replay restores badges after browser reconnect.
- [x] **WFJS-P1-019** — Add WebUI static, HTTP harness, and real-RPC validation. **Priority:** P1. **Depends on:** WFJS-P1-014 through WFJS-P1-018. **Acceptance:** mode and run lifecycle pass in browser and RPC tests.

### M7 — Replay-based pause/resume

- [x] **WFJS-P1-020** — Define stable call fingerprints from phase path, label, prompt, normalized options, and pipeline item key. **Priority:** P1. **Depends on:** M2. **Acceptance:** semantically unchanged calls produce the same fingerprint.
- [x] **WFJS-P1-021** — Persist completed agent results and fingerprints in the call ledger. **Priority:** P1. **Depends on:** WFJS-P1-020, WFJS-P0-031. **Acceptance:** result data survives session reload.
- [x] **WFJS-P1-022** — Replay scripts from the beginning and return cached completed results. **Priority:** P1. **Depends on:** WFJS-P1-021. **Acceptance:** completed calls do not spawn subprocesses on resume.
- [x] **WFJS-P1-023** — Rerun changed, new, failed, or previously running calls. **Priority:** P1. **Depends on:** WFJS-P1-022. **Acceptance:** edited scripts reuse only valid unchanged results.
- [x] **WFJS-P1-024** — Implement scheduler pause without launching new work. **Priority:** P1. **Depends on:** WFJS-P0-024. **Acceptance:** active-task behavior is explicitly defined and tested.
- [x] **WFJS-P1-025** — Implement `/workflow pause <run-id>` and `/workflow resume <run-id>`. **Priority:** P1. **Depends on:** WFJS-P1-022, WFJS-P1-024. **Acceptance:** same-session resume works from TUI and RPC.
- [x] **WFJS-P1-026** — Implement individual agent retry using its persisted call specification. **Priority:** P1. **Depends on:** WFJS-P1-021. **Acceptance:** retry does not rerun unrelated calls.
- [x] **WFJS-P1-027** — Detect unstable unlabeled calls and emit actionable resume warnings. **Priority:** P1. **Depends on:** WFJS-P1-020. **Acceptance:** pipeline and loop scripts receive deterministic diagnostics.
- [x] **WFJS-P1-028** — Add replay, edit-and-resume, pause, and retry tests. **Priority:** P1. **Depends on:** WFJS-P1-020 through WFJS-P1-027. **Acceptance:** subprocess spawn counts prove cache reuse.

### M8 — Write-capable isolated workflows

- [x] **WFJS-P2-001** — Define explicit write, shell, and network policy schema. **Priority:** P2. **Depends on:** M0. **Acceptance:** default remains deny and policy cannot be widened by scripts.
- [x] **WFJS-P2-002** — Add launch-plan display of requested write/shell/network capabilities. **Priority:** P2. **Depends on:** WFJS-P2-001, WFJS-P0-042. **Acceptance:** approval names affected repository and isolation mode.
- [x] **WFJS-P2-003** — Implement isolated git worktree creation per parallel write unit. **Priority:** P2. **Depends on:** M7. **Acceptance:** concurrent agents never write to the same worktree.
- [x] **WFJS-P2-004** — Track worktree branch, base commit, dirty state, and changed files per agent call. **Priority:** P2. **Depends on:** WFJS-P2-003. **Acceptance:** every write result has an auditable diff.
- [x] **WFJS-P2-005** — Add patch/result artifacts for write agents. **Priority:** P2. **Depends on:** WFJS-P2-004. **Acceptance:** changes can be reviewed without applying them.
- [x] **WFJS-P2-006** — Implement serial merge/apply phase with explicit user confirmation. **Priority:** P2. **Depends on:** WFJS-P2-005. **Acceptance:** conflicts stop safely and preserve worktrees.
- [x] **WFJS-P2-007** — Add verification policy before merge/apply. **Priority:** P2. **Depends on:** WFJS-P2-006. **Acceptance:** configured checks must pass or be explicitly waived.
- [x] **WFJS-P2-008** — Add cleanup and recovery for worktrees after cancellation or crash. **Priority:** P2. **Depends on:** WFJS-P2-003. **Acceptance:** no work is deleted automatically when unmerged changes exist.
- [x] **WFJS-P2-009** — Add network and shell allowlist enforcement to agent subprocesses. **Priority:** P2. **Depends on:** WFJS-P2-001. **Acceptance:** denied operations fail closed.
- [x] **WFJS-P2-010** — Add parallel-write, conflict, cancellation, and recovery integration tests. **Priority:** P2. **Depends on:** WFJS-P2-003 through WFJS-P2-009. **Acceptance:** all safety scenarios pass in disposable repositories.

### M9 — Compatibility and ecosystem polish

- [x] **WFJS-P2-011** — Add token, cost, time, and agent-count budgets at run and phase scope. **Priority:** P2. **Depends on:** M3. **Acceptance:** budget exhaustion produces a categorized result.
- [x] **WFJS-P2-012** — Add transient model/tool retry policy with exponential backoff and jitter. **Priority:** P2. **Depends on:** M3. **Acceptance:** retries are bounded and never duplicate non-idempotent write actions.
- [x] **WFJS-P2-013** — Add large-workflow warnings based on configurable projected agent/token thresholds. **Priority:** P2. **Depends on:** WFJS-P2-011. **Acceptance:** warning is visible before and during large runs.
- [x] **WFJS-P3-001** — Investigate best-effort import of Claude-shaped saved workflow scripts. **Priority:** P3. **Depends on:** M5. **Acceptance:** unsupported syntax is reported rather than silently changed.
- [x] **WFJS-P3-002** — Add script formatter and generated TypeScript declaration file for runtime globals. **Priority:** P3. **Depends on:** M1. **Acceptance:** editors provide useful completion and diagnostics.
- [x] **WFJS-P3-003** — Add workflow templates and starter examples. **Priority:** P3. **Depends on:** M5. **Acceptance:** audit, research, migration, and verify-loop examples are tested.
- [x] **WFJS-P3-004** — Add workflow export/import bundles containing source, metadata, policy requirements, and tests. **Priority:** P3. **Depends on:** M5. **Acceptance:** imports require trust and conflict review.
- [x] **WFJS-P3-005** — Add optional scheduling integration outside the workflow script contract. **Priority:** P3. **Depends on:** M3. **Acceptance:** scheduling metadata does not affect deterministic workflow semantics.

## 11. Dependency path

```text
M0 contracts/security
  → M1 parser/sandbox
    → M2 primitives/scheduler
      → M3 background run manager
        → M4 workflow_run + Workflow Mode
          → M5 save/reuse
          → M6 inspectors
          → M7 replay/resume
            → M8 isolated writes
              → M9 advanced polish
```

## 12. Verification matrix

| Area | Required verification | Target command or evidence |
| --- | --- | --- |
| Existing runtime regression | Current package tests remain green during migration | `npm test --prefix pi-extension-workflows` |
| Parser | Valid and invalid script fixtures | New parser test suite |
| Sandbox | Escape attempts, infinite loops, memory pressure | Offline adversarial fixtures |
| Scheduler | Stable ordering and hard concurrency bounds | Fake-runner deterministic tests |
| Process cleanup | No orphan Pi subprocesses | PID/process-group integration test |
| Policy | Requested tools cannot widen effective policy | Policy intersection tests |
| Approval | Hash/policy changes invalidate remembered approval | Approval state tests |
| Background launch | Tool returns before run completes | RPC integration timing assertion |
| Result delivery | One consolidated result appears in session | TUI and RPC transcript tests |
| Persistence | Run remains inspectable after restart | Session restart fixture |
| Resume | Completed calls are reused | Spawn-count replay test |
| Native TUI | Selection, drilldown, controls, theme invalidation | TUI extension tests/manual checklist |
| WebUI | Mode, run list, drilldown, actions, reconnect replay | Static tests + HTTP harness + real RPC validation |
| Write isolation | Parallel agents cannot share worktree | Disposable git repository integration tests |
| Package security | Dependency and unsafe-execution review | `npm audit` plus targeted security review |

## 13. Migration strategy

### Stage A — Dual runtime behind a feature flag

- Keep current JSON discovery and execution.
- Add JS discovery and runtime behind an opt-in setting.
- Keep existing `/workflow run <key> [json-input]` behavior.
- Add clear source type to list/status output.

### Stage B — JS bundled workflow

- Convert `deep-research-minimal` to JavaScript.
- Run JSON and JS contract tests side by side.
- Make the JS version the default bundled implementation after parity passes.

### Stage C — JS default

- New generated and saved workflows use JavaScript only.
- JSON workflows emit a deprecation warning.
- Provide documentation or a conversion helper.

### Stage D — Remove legacy JSON execution

Remove only when:

- No bundled workflow depends on JSON.
- At least one released version has emitted deprecation warnings.
- Migration documentation exists.
- WebUI and native TUI tests cover JS workflows fully.

## 14. Risk register

| ID | Risk | Severity | Mitigation | Status |
| --- | --- | --- | --- | --- |
| R-001 | Generated JS escapes into host Node process | Critical | Capability-only isolated interpreter; no `import()`; adversarial tests | OPEN |
| R-002 | Prompt injection creates over-privileged agents | Critical | Frozen policy intersection, approval, read-only default | OPEN |
| R-003 | Parallel agents create runaway cost | High | Hard caps, budgets, warnings, visible usage | OPEN |
| R-004 | Cancellation leaves child processes running | High | Process-group termination and orphan tests | OPEN |
| R-005 | Resume returns stale results after script changes | High | Stable fingerprints and changed-input invalidation | OPEN |
| R-006 | Parallel writes conflict or corrupt working tree | High | Per-unit worktrees and serial apply | OPEN |
| R-007 | RPC/WebUI duplicates runtime state | Medium | Extension-owned canonical state and versioned payloads | OPEN |
| R-008 | Direct slash aliases collide with existing commands | Medium | Canonical `/workflow run`; explicit collision policy | OPEN |
| R-009 | Structured agent output is malformed | Medium | Schema validation, bounded repair, categorized failure | OPEN |
| R-010 | Isolation dependency complicates npm packaging | Medium | P0 portability proof across supported Node/Bun environments | OPEN |
| R-011 | Mode conflicts with Natural Conversation or plan modes | Medium | Exclusive-mode arbitration and visible mode state | OPEN |
| R-012 | JSON migration breaks existing project workflows | Medium | Dual runtime, warnings, fixtures, conversion documentation | OPEN |

## 15. Open decisions

- [x] **DEC-001** — Selected QuickJS/WASM as the capability-only interpreter boundary; Node subprocesses are used only for separately policy-guarded Pi agents.
- [x] **DEC-002** — Retained hard limits of `8 concurrent / 100 total`, with 3/50 defaults, bounded interpreter resources, and optional stricter run/phase budgets.
- [x] **DEC-003** — Nested `phase()` is allowed; phase paths are stacked deterministically and remain bounded by runtime stack, agent, and time limits.
- [x] **DEC-004** — Structured-output validation fails closed without hidden model repair; workflows may encode an explicit bounded repair call if desired.
- [x] **DEC-005** — Replay is limited to the current Pi session storage namespace; cross-session artifacts remain inspectable but are not implicitly executable.
- [x] **DEC-006** — Direct aliases are not registered because of command collisions; `/workflow run <name>` and `/workflow <name>` remain canonical.
- [x] **DEC-007** — Pause lets active agent calls finish while preventing queued/new calls from starting; abort remains the explicit termination action.
- [x] **DEC-008** — Extensions arbitrate through the versioned `firstpick:exclusive-mode:v1` event; conflicts fail visibly instead of silently combining modes.

## 16. Progress update procedure

When implementation work changes status:

1. Update the matching checkbox.
2. Update the milestone numerator in the Progress dashboard.
3. Update overall completed task count.
4. Add verification evidence under the task or in section 17.
5. Record blockers in the risk register or open decisions.
6. Add a dated entry to the change log.

Do not renumber task IDs after implementation starts. New work receives a new ID under the appropriate priority.

## 17. Verification evidence log

| Date | Task IDs | Evidence | Result |
| --- | --- | --- | --- |
| 2026-07-15 | WFJS-P0-001–005, 008–014, 016, 019, 021–022, 025–026 | `npm test --prefix pi-extension-workflows`; Node 22.23.1 and Bun 1.3.14 runtime tests; `npm audit --omit=dev`; `git diff --check` | PASS — 0 audit vulnerabilities |
| 2026-07-15 | WFJS-P0-044, WFJS-P1-014 | Extension mode/unit tests; inline `workflow_run` integration test; WebUI 19-file suite; mobile static checks; Bun mode/runtime tests | PASS |
| 2026-07-15 | WFJS-P0-006–007, WFJS-P0-017 | Approval exact-match/invalidation tests; strict versioned record validation; immutable snapshot, tamper, traversal, Node/Bun tests; full extension and WebUI suites; `npm audit --omit=dev`; secret-pattern and diff checks | PASS — 0 audit vulnerabilities |
| 2026-07-15 | WFJS-P0-015, 018, 020, 023–024, 027–028 | Deterministic instruction/memory/wall-clock fixtures; agent-option and per-call timeout tests; persisted pipeline keys; shared two-run FIFO scheduler tests; queued/active cancellation; real process-group orphan test; full Node/Bun and WebUI suites | PASS |
| 2026-07-15 | WFJS-P0-029–038 | Multi-run manager, transition rejection, async-return timing, atomic run/policy/call/event/usage/result artifacts, agent/phase/run usage reconciliation, request/result messages, abort/shutdown/restart/failure tests; full Node/Bun and WebUI suites | PASS — 0 audit vulnerabilities |
| 2026-07-15 | WFJS-P0-040–047 except P0-044 previously logged | Async receipt and termination contract; TUI/RPC approval branches; exact-hash consent invalidation; mode once/persistent tests; versioned replayable RPC payload; exclusive-mode arbitration; scriptPath precedence and policy-denied fixtures; full Node/Bun and WebUI suites | PASS — 0 audit vulnerabilities |
| 2026-07-15 | WFJS-P1-001–009 | Explicit user/project save and overwrite-confirmation tests; name/path/hash/symlink validation; global/trusted-project discovery; name/run-ID completions; canonical no-direct-alias decision; bundled JS parity test; legacy JSON warning/removal guide; full Node/Bun and WebUI suites | PASS — 0 audit vulnerabilities |
| 2026-07-15 | WFJS-P0-039, P0-048, P1-020–028 | Full `resumeFromRunId` contract; normalized fingerprints with pipeline keys; persisted prompts/results/call order; unchanged-call replay; edit/failure invalidation; scheduler/manager pause semantics; targeted retry; unstable-call diagnostics; Node/Bun spawn-count and extension integration tests | PASS |
| 2026-07-15 | WFJS-P1-010–019 | Native run selector/drilldown/action tests; versioned multi-run RPC schema; WebUI run/phase/agent rendering; confirmed lifecycle controls and raw scripts; per-tab reconnect badges; static, HTTP SSE replay, real fake-Pi RPC, Node/Bun, and full 19-file WebUI suites | PASS |
| 2026-07-15 | WFJS-P2-001–010 | Strict user/project permission ceilings; approval capability/isolation plan; child `tool_call` path/shell/network guard; per-writer disposable git worktrees; base/branch/dirty/file/patch artifacts; verified confirmed atomic apply; conflict/cancellation/cleanup recovery fixtures | PASS |
| 2026-07-15 | WFJS-P2-011–013, WFJS-P3-001–005 | Categorized run/phase budget fixtures; bounded jittered retries and no write retry; pre/during large-run warnings; conservative Claude import report; formatter and packaged declarations; four executable templates; trusted conflict-reviewed bundles; external schedule metadata tests | PASS |
| 2026-07-15 | All 94 tasks | Full Node extension suite; Bun advanced/worktree/inspector/replay/scheduler/runtime/extension suites; full 19-file WebUI suite including HTTP SSE reconnect and fake-Pi RPC; both production `npm audit --omit=dev`; package manifest check; syntax, secret-pattern, and `git diff --check` gates | PASS — 0 audit vulnerabilities |

## 18. Change log

| Date | Change |
| --- | --- |
| 2026-07-15 | Created trackable implementation plan for Claude-shaped reusable JavaScript workflows. |
| 2026-07-15 | Implemented and verified the first P0 slice: contracts, threat model, ADRs, JS discovery/parser, QuickJS capability sandbox, primitives, policy limits, and Pi task-runner integration. |
| 2026-07-15 | Added extension-owned persistent Workflow Mode, inline generated-script tool execution, and a synchronized per-tab WebUI toggle with active composer chip. |
| 2026-07-15 | Added exact-script/policy approval records, strict v1 run/call/event/usage/result schemas, canonical policy/project hashes, and immutable per-session run-script snapshots. |
| 2026-07-15 | Completed the JS sandbox and scheduler milestones with deterministic interrupt budgets, stable persisted pipeline keys, complete agent options, a global FIFO scheduler, per-agent timeouts, and process-group cancellation. |
| 2026-07-15 | Completed the background run-manager milestone with multi-run controllers, validated transitions, durable artifacts, asynchronous launch, consolidated session messages, run commands, usage aggregation, and restart/shutdown handling. |
| 2026-07-15 | Added async `workflow_run` receipts, terminating tool results, launch approval, one-shot mode, versioned RPC mode state, trusted script-path precedence, read-only policy denial, and exclusive-mode arbitration. |
| 2026-07-15 | Completed save/reuse/migration: explicit scoped saves, overwrite confirmation, completion, canonical command policy, bundled JavaScript deep research, and legacy JSON warnings/removal criteria. |
| 2026-07-15 | Completed replay/resume: persisted call specifications/results, stable fingerprints, cached re-execution, edit invalidation, scheduler pause, same-session resume, individual retry, and deterministic warnings. |
| 2026-07-15 | Completed native/WebUI inspectors with multi-run RPC state, run/phase/agent drilldown, lifecycle controls, per-tab badges, reconnect replay, and static/HTTP/real-RPC tests. |
| 2026-07-15 | Completed isolated write workflows with intersected permission ceilings, policy-guarded child agents, per-call worktrees, patch artifacts, verified confirmed apply, and non-destructive recovery. |
| 2026-07-15 | Completed advanced polish with categorized budgets, bounded retries, large-run warnings, conservative import/format tooling, packaged declarations, templates, bundles, and external schedule metadata. |
| 2026-07-15 | Closed all architecture decisions and verified 94/94 tracked tasks across Node, Bun, WebUI HTTP/RPC, dependency audit, packaging, secret, syntax, and diff gates. |

## 19. References

Official behavior references:

- [Claude Code dynamic workflows](https://code.claude.com/docs/en/workflows)
- [Claude Agent SDK TypeScript Workflow tool](https://platform.claude.com/docs/en/agent-sdk/typescript#workflow)

Local design and implementation references:

- `docs/workflows/Workflow_deep-report.md`
- `docs/workflows/Workflow_extension-implementation-plan.md`
- `docs/workflows/Workflow_js-runtime-threat-model.md`
- `docs/workflows/Workflow_js-runtime-architecture-decisions.md`
- `pi-extension-workflows/index.ts`
- `pi-extension-workflows/src/types.ts`
- `pi-extension-workflows/src/schema.ts`
- `pi-extension-workflows/src/loader.ts`
- `pi-extension-workflows/src/runner.ts`
- `pi-extension-workflows/src/task-runner.ts`
- `pi-extension-workflows/src/state.ts`
- `pi-extension-workflows/src/ui.ts`
- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/public/app.js`
