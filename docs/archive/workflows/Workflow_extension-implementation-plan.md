# Minimal Modular Workflow Extension Implementation Plan

## Goal

Create a minimal, working Pi workflow extension foundation based on the research in [`docs/workflows/Workflow_deep-report.md`](../../workflows/Workflow_deep-report.md).

The extension should implement the stable workflow semantics from the research document:

```text
Workflow Definition → Run State → Phases → Task/Agent Fanout → Aggregation → Final Result
```

This plan intentionally avoids cloning Claude Code's undocumented JavaScript workflow DSL. Instead, it establishes a generic, deterministic Pi Workflow IR that can later support adapters, richer UI, durable persistence, and Claude-compatible import/export if needed.

---

## 1. Target Foundation Scope

### In scope for v0

The first implementation should support:

1. A `/workflow` command.
2. Loading data-only workflow definitions from local JSON files.
3. Running workflows with:
   - sequential phases;
   - sequential tasks;
   - bounded parallel task fanout;
   - final aggregation.
4. Basic progress feedback through Pi UI status/widgets.
5. Lightweight run-state persistence in the Pi session.
6. Structured run details for debugging and future extension growth.

### Out of scope for v0

Do **not** implement these initially:

- full JavaScript workflow execution;
- arbitrary executable workflow scripts;
- exact Claude Workflow DSL compatibility;
- global durable cross-session job restore;
- rich workflow inspector TUI;
- advanced retry/circuit-breaker policies;
- distributed scheduler or queue backend;
- marketplace-quality polish.

The research document shows that Claude Workflows are best treated as **semantics first**, not as a stable public DSL to clone.

---

## 2. Proposed Package Structure

Create a new package:

```text
pi-extension-workflows/
├── package.json
├── README.md
├── LICENSE
├── index.ts
├── src/
│   ├── types.ts
│   ├── schema.ts
│   ├── loader.ts
│   ├── runner.ts
│   ├── task-runner.ts
│   ├── state.ts
│   ├── ui.ts
│   ├── errors.ts
│   └── utils.ts
├── workflows/
│   └── deep-research-minimal.json
└── tests/
    ├── schema.test.ts
    ├── runner.test.ts
    └── fixtures/
        └── simple-workflow.json
```

Package manifest shape:

```json
{
  "name": "@firstpick/pi-extension-workflows",
  "version": "0.1.0",
  "description": "Minimal modular workflow runtime extension for Pi.",
  "license": "MIT",
  "keywords": ["pi-package", "pi", "pi-coding-agent", "extension", "workflow"],
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "files": ["index.ts", "src", "workflows", "README.md", "LICENSE"]
}
```

---

## 3. Core Architecture

### 3.1 Workflow IR

Define a small internal workflow representation in `src/types.ts`:

```ts
export type WorkflowDefinition = {
  schemaVersion: 1;
  key: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
  defaults?: {
    maxConcurrency?: number;
    maxTasks?: number;
  };
  phases: WorkflowPhase[];
};

export type WorkflowPhase = {
  id: string;
  name: string;
  description?: string;
  mode: "sequential" | "parallel";
  maxConcurrency?: number;
  tasks: WorkflowTask[];
};

export type WorkflowTask = {
  id: string;
  name: string;
  agent?: string;
  prompt: string;
  tools?: string[];
  model?: string;
  cwd?: string;
};

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowRun = {
  runId: string;
  workflowKey: string;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  phases: PhaseRun[];
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
};

export type PhaseRun = {
  phaseId: string;
  name: string;
  status: WorkflowRunStatus;
  tasks: TaskRun[];
  startedAt?: string;
  finishedAt?: string;
};

export type TaskRun = {
  taskId: string;
  name: string;
  status: TaskRunStatus;
  output?: string;
  error?: string;
  usage?: {
    input?: number;
    output?: number;
    cost?: number;
    turns?: number;
  };
  startedAt?: string;
  finishedAt?: string;
};
```

This keeps the foundation close to the research document's model:

```text
WorkflowDefinition → WorkflowRun → PhaseRun → TaskRun/AgentRun
```

---

## 4. Commands and Tools

### 4.1 Initial command surface

Register one command in `index.ts`:

```text
/workflow <action> [...args]
```

Supported v0 actions:

```text
/workflow list
/workflow status
/workflow run <workflow-key> [json-input]
/workflow abort
```

Examples:

```text
/workflow list
/workflow run deep-research-minimal {"topic":"Pi workflow extensions"}
/workflow status
/workflow abort
```

### 4.2 Optional LLM tool after the command works

Add this only after command-based execution is stable:

```ts
workflow_run({
  key: string,
  input?: object,
  confirmRun: boolean
})
```

Safety rule:

- `confirmRun` must be `true`.
- The tool should refuse to run unless the user explicitly requested workflow execution.

---

## 5. Workflow File Format

Use data-only JSON for v0.

Example file: `workflows/deep-research-minimal.json`

```json
{
  "schemaVersion": 1,
  "key": "deep-research-minimal",
  "name": "Minimal Deep Research",
  "description": "Research, verify, and summarize a topic using staged tasks.",
  "defaults": {
    "maxConcurrency": 3,
    "maxTasks": 12
  },
  "phases": [
    {
      "id": "scout",
      "name": "Source discovery",
      "mode": "parallel",
      "maxConcurrency": 3,
      "tasks": [
        {
          "id": "official-docs",
          "name": "Find official docs",
          "agent": "scout",
          "tools": ["read", "grep", "find", "ls"],
          "prompt": "Find official documentation and primary sources for: {{topic}}"
        },
        {
          "id": "implementation-evidence",
          "name": "Find implementation evidence",
          "agent": "scout",
          "tools": ["read", "grep", "find", "ls"],
          "prompt": "Find concrete implementation examples for: {{topic}}"
        }
      ]
    },
    {
      "id": "synthesis",
      "name": "Synthesis",
      "mode": "sequential",
      "tasks": [
        {
          "id": "summarize",
          "name": "Summarize findings",
          "agent": "planner",
          "prompt": "Synthesize prior phase outputs into an implementation-ready report."
        }
      ]
    }
  ]
}
```

Use simple `{{key}}` interpolation in v0. Avoid arbitrary code evaluation.

---

## 6. Loader Design

Implement `src/loader.ts`.

Responsibilities:

1. Load bundled workflows from package `workflows/*.json`.
2. Optionally load project workflows from `.pi/workflows/*.json` only when the project is trusted.
3. Validate every workflow definition.
4. Return clear load errors with file paths.

Suggested lookup order:

1. bundled workflows;
2. trusted project workflows;
3. project workflows override bundled workflows with the same key only if explicitly allowed later.

For the minimal version, avoid override behavior and report duplicate keys as an error.

---

## 7. Schema Validation

Implement `src/schema.ts` using `typebox` or a small manual validator.

Validation requirements:

- `schemaVersion` must be `1`.
- `key` must be non-empty and slug-like.
- `phases` must contain at least one phase.
- each phase must contain at least one task.
- phase/task IDs must be unique within their scope.
- `mode` must be `sequential` or `parallel`.
- `maxConcurrency` must be bounded.
- total task count must not exceed the hard cap.

Initial caps:

```ts
const DEFAULT_MAX_CONCURRENCY = 3;
const HARD_MAX_CONCURRENCY = 8;
const DEFAULT_MAX_TASKS = 50;
const HARD_MAX_TASKS = 100;
```

---

## 8. Runner Design

Implement `src/runner.ts`.

Responsibilities:

1. Create `runId`.
2. Initialize `WorkflowRun`.
3. Execute phases in order.
4. Execute tasks according to phase mode.
5. Update UI after every phase/task transition.
6. Persist state at meaningful points.
7. Return final run details.

Pseudo-flow:

```ts
export async function runWorkflow(def, input, ctx, deps) {
  const run = createRun(def, input);
  deps.state.setActiveRun(run);
  deps.ui.renderRun(run);

  try {
    for (const phase of def.phases) {
      await runPhase(run, phase, input, ctx, deps);
    }

    run.status = "completed";
    run.finishedAt = new Date().toISOString();
    run.summary = summarizeRun(run);
    return run;
  } catch (error) {
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.error = error instanceof Error ? error.message : String(error);
    return run;
  } finally {
    deps.state.persistRun(run);
    deps.ui.renderRun(run);
  }
}
```

---

## 9. Task Backend

Implement `src/task-runner.ts` behind an interface:

```ts
export type TaskRunner = {
  runTask(task: WorkflowTask, context: TaskContext): Promise<TaskResult>;
};
```

### v0 backend options

#### Option A: simple current-session backend

Send task prompts into the current Pi session.

Pros:

- easier to implement;
- fewer subprocess concerns.

Cons:

- not isolated;
- weaker match to workflow/subagent semantics.

#### Option B: subprocess Pi backend

Spawn isolated Pi processes using JSON mode:

```text
pi --mode json -p --no-session --tools read,grep,find,ls "Task: ..."
```

Pros:

- isolated context window per task;
- matches workflow fanout better;
- easier to parallelize safely;
- closer to the existing Pi subagent example pattern.

Cons:

- more code;
- needs child process lifecycle management.

Recommendation: implement **Option B** for the real foundation, but keep it hidden behind `TaskRunner` so it can be swapped.

---

## 10. Parallel Execution

Implement `mapWithConcurrencyLimit()` in `src/utils.ts`:

```ts
export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}
```

Parallel execution rules:

- keep result ordering stable;
- fail individual tasks as data where possible;
- fail the phase only if the phase policy says failures are fatal;
- v0 default: any task failure fails the phase.

---

## 11. State Persistence

Implement `src/state.ts`.

### In-memory state

```ts
let activeRun: WorkflowRun | undefined;
let lastRun: WorkflowRun | undefined;
```

### Session persistence

Use `pi.appendEntry()` at key transitions:

```ts
pi.appendEntry("workflow-run", {
  runId: run.runId,
  workflowKey: run.workflowKey,
  status: run.status,
  phases: run.phases,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  summary: run.summary,
  error: run.error
});
```

On `session_start`, reconstruct the latest known run from custom session entries.

Important v0 limitation:

- restored state is for visibility/debugging;
- do not promise durable resume yet.

---

## 12. UI Foundation

Implement `src/ui.ts`.

Use basic Pi UI primitives:

- `ctx.ui.setStatus("workflow", value)`;
- `ctx.ui.setWidget("workflow", lines)`;
- `ctx.ui.notify(message, level)`.

Widget example:

```text
Workflow: deep-research-minimal
Phase 1/2: Source discovery
Tasks: 2/3 done, 1 running
```

Final widget can show:

```text
Workflow complete: deep-research-minimal
Phases: 2/2
Tasks: 3/3
```

Clear widget on:

- abort;
- session shutdown;
- new run start;
- explicit `/workflow status --clear` later, if useful.

---

## 13. Safety Model

Initial safeguards:

1. Workflow definitions are data-only JSON.
2. No arbitrary JavaScript workflow execution.
3. Project-local workflows load only in trusted projects.
4. Hard caps for concurrency and total tasks.
5. Explicit command or tool confirmation before starting a run.
6. Default tools should be read-only:
   - `read`;
   - `grep`;
   - `find`;
   - `ls`;
   - optionally safe `bash` later.
7. Surface workflow source path before running project-local workflows.
8. Abort should attempt to stop child processes.

Future permission field:

```json
{
  "permissions": {
    "allowWriteTools": false,
    "allowNetwork": false,
    "requiresConfirmation": true
  }
}
```

Do not implement write-capable workflows in v0.

---

## 14. Aggregation

For v0, use deterministic aggregation instead of an LLM aggregator.

`src/runner.ts` should build a final summary like:

```md
# Workflow Run Summary

Workflow: deep-research-minimal
Status: completed
Duration: 42s

## Phases

### Source discovery
- official-docs: completed
- implementation-evidence: completed

### Synthesis
- summarize: completed

## Outputs

...
```

Later, support an explicit aggregator task:

```json
{
  "aggregation": {
    "mode": "task",
    "task": {
      "id": "final-report",
      "agent": "planner",
      "prompt": "Create the final report from all phase outputs."
    }
  }
}
```

---

## 15. Error Semantics

Implement `src/errors.ts`.

Suggested error categories:

```ts
export type WorkflowErrorKind =
  | "validation_error"
  | "load_error"
  | "task_error"
  | "phase_error"
  | "cancelled"
  | "timeout"
  | "budget_exhausted"
  | "internal_error";
```

For v0:

- schema/load errors block the run;
- task failures are recorded in `TaskRun.error`;
- a failed task fails the phase;
- a failed phase fails the run;
- cancellation sets run status to `cancelled`.

Do not implement automatic retry yet. Add retry fields later.

---

## 16. Testing Plan

Add tests once the structure exists.

### Schema tests

Validate:

- valid minimal workflow;
- missing `key`;
- empty phases;
- duplicate phase IDs;
- duplicate task IDs;
- invalid concurrency;
- too many tasks.

### Runner tests

Use a fake `TaskRunner`.

Validate:

- sequential phase ordering;
- parallel result ordering;
- failure propagation;
- cancellation behavior;
- state persistence calls;
- UI update calls.

### Loader tests

Validate:

- bundled workflow discovery;
- project workflow discovery only when trusted;
- duplicate key handling;
- invalid JSON handling.

---

## 17. Implementation Phases

### Phase 1 — Package skeleton

Deliverables:

- create `pi-extension-workflows/`;
- add `package.json`;
- add `index.ts`;
- register `/workflow`;
- implement `/workflow list` with bundled workflow discovery.

Verification:

```bash
pi -e ./pi-extension-workflows
```

Expected:

```text
/workflow list
```

shows available workflows.

---

### Phase 2 — Schema and loader

Deliverables:

- `src/types.ts`;
- `src/schema.ts`;
- `src/loader.ts`;
- bundled workflow loading;
- trusted project workflow loading.

Verification:

- valid workflow loads;
- invalid workflow reports clear errors;
- duplicate keys fail safely.

---

### Phase 3 — Sequential runner

Deliverables:

- `src/runner.ts`;
- sequential phase execution;
- sequential task execution through fake/simple backend;
- run summary;
- state persistence.

Verification:

```text
/workflow run deep-research-minimal {"topic":"test"}
```

creates a run, updates status, and completes.

---

### Phase 4 — Parallel fanout

Deliverables:

- bounded parallel phase execution;
- stable result ordering;
- partial progress updates;
- hard concurrency cap.

Verification:

- fixture with 3 parallel tasks;
- configured concurrency is respected;
- failed task is represented in run result.

---

### Phase 5 — Subprocess task backend

Deliverables:

- Pi JSON-mode subprocess backend;
- output capture;
- usage/cost capture where available;
- abort signal propagation;
- safe temp prompt handling if system prompts are needed later.

Verification:

- one task runs in isolated subprocess;
- parallel tasks run with bounded concurrency;
- abort stops active children.

---

### Phase 6 — Aggregation

Deliverables:

- deterministic final summary;
- command output or displayed custom message;
- final details stored in session state.

Verification:

- completed run returns readable summary;
- failed run lists failed phase/task and error.

---

### Phase 7 — Documentation and tests

Deliverables:

- `README.md` with usage examples;
- known limitations;
- test fixtures;
- schema/runner/loader tests.

---

## 18. Recommended First Working Target

The first meaningful milestone should be:

```text
pi-extension-workflows
├── /workflow list
├── /workflow run deep-research-minimal {"topic":"..."}
├── data-only JSON workflow loading
├── sequential + bounded parallel phases
├── subprocess task backend
├── simple status/widget progress
└── session-persisted run summary
```

This creates a modular foundation aligned with the research document while avoiding overcommitment to undocumented Claude Workflow internals.

---

## 19. Key Design Decisions

| Area | Decision |
|---|---|
| Workflow representation | JSON IR first |
| JS workflow support | Later adapter only |
| Task isolation | Pi subprocess backend behind an interface |
| Persistence | Session entries first |
| Resume | Visibility only in v0, no durable resume promise |
| UI | Status/widget first |
| Concurrency | Configurable with hard caps |
| Safety | Data-only definitions and explicit run confirmation |
| Extensibility | Schema versioning plus backend interface |

---

## 20. Known Risks

### Subprocess complexity

Mitigation:

- isolate subprocess logic in `task-runner.ts`;
- start with fake runner tests;
- add real Pi subprocess backend after runner logic is stable.

### Resume expectations

Mitigation:

- document v0 as non-resumable;
- persist state only for visibility/debugging.

### Prompt injection through project workflow files

Mitigation:

- load project workflows only from trusted projects;
- show source path before running;
- keep default tool set read-only.

### Runaway fanout or cost

Mitigation:

- hard task and concurrency caps;
- explicit confirmation;
- status visibility during execution.

### DSL ambiguity

Mitigation:

- name the internal model Pi Workflow IR;
- avoid promising Claude JS compatibility until a stable external spec exists.

---

## 21. Future Extensions After v0

Possible future work:

1. Rich `/workflows` inspector UI.
2. Durable run store outside session JSONL.
3. Retry policies with exponential backoff.
4. Per-phase failure policies.
5. Budget controls for tokens/cost/time.
6. LLM-based final aggregator task.
7. Workflow templates and autocomplete.
8. Import adapter for Claude-style workflow files if the public DSL stabilizes.
9. Project-local workflow registry with trust metadata.
10. Scheduler integration separate from workflow definitions.
