# Ways to launch subagents in Pi

This reference lists ways to create, call, or coordinate another Pi agent. It is ordered with **Pi-core mechanisms first** and extension/package mechanisms afterward.

> **Important:** Pi core intentionally has no built-in subagent manager. Here, **Pi-native** means a mechanism supplied directly by Pi core—its SDK, RPC mode, JSON/print modes, or CLI. Tools such as `subagent`, `subagent_gate`, and `workflow_run` come from installed extensions or packages and are therefore listed separately, not described as native Pi subagents.

## Ranked summary

Ranking favors Pi-core integration and runtime efficiency first. Within the extension group, it favors managed lifecycle support and ease of use.

### Pi-core mechanisms — no extensions required

| Rank | Mechanism | Best caller | Why use it | WebUI observability |
| ---: | --- | --- | --- | --- |
| 1 | SDK `createAgentSession()` | Node.js/TypeScript application | Most efficient native programmatic option; no subprocess protocol | Tracking adapter required |
| 2 | RPC subprocess: `pi --mode rpc` | Any language/application | Persistent, controllable, process-isolated Pi agent | `pi-webui agent run` wrapper |
| 3 | JSON subprocess: `pi --mode json -p` | Scripts and simple orchestrators | Structured one-shot event stream | `pi-webui agent run` wrapper |
| 4 | Print subprocess: `pi -p` | Shell scripts | Simplest one-shot child invocation | `pi-webui agent run` wrapper |
| 5 | Separate interactive Pi/tmux process | Human/operator | Fully visible independent Pi session | Reporter or explicit attach |

### Extension/package mechanisms — not Pi-core subagents

| Rank | Mechanism | Supplied by | Best use | WebUI observability |
| ---: | --- | --- | --- | --- |
| 6 | `subagent` tool with `workflowScript` | `pi-subagents` extension/package | Managed one-child, parallel, or scripted delegation | Automatic while helper is connected |
| 7 | `/run` and packaged subagent commands | `pi-subagents` extension/package | Human-facing managed delegation | Same canonical child; no extra count |
| 8 | Scheduled `workflowScript` runs | `pi-subagents` extension/package | Deferred or recurring managed delegation | Automatic after the job launches |
| 9 | `subagent_gate` | This repository's WebUI package | Success quorum and bounded safe retries | Gate references child; no extra count |
| 10 | `pi-subagents` event-bus RPC `spawn` | `pi-subagents` extension/package | Extension-to-extension managed launch | Same canonical child; no extra count |
| 11 | `workflow_run` | `pi-extension-workflows` | Reusable, approved, policy-controlled agent workflows | Automatic provider snapshot |
| 12 | Bespoke subagent extension/tool | Pi extension API plus custom code | Custom orchestration, UX, or policy | Provider event or registry adapter |

## WebUI registration note

The WebUI **Subagents** panel uses cooperative registration rather than process or tmux scanning. Managed extension runs appear automatically; native SDK/subprocess/interactive launches need the adapter, wrapper, reporter, or explicit attach named above. Registered runs that cannot be matched exactly to an open parent session appear under **External agents**. See [`pi-package-webui/TECHNICAL.md`](../pi-package-webui/TECHNICAL.md#subagent-observability) for commands, lifecycle meanings, output limitations, and troubleshooting.

# Part I: Pi-core mechanisms

These mechanisms use only Pi's own SDK, executable, or process protocols. They do not require a subagent extension.

## 1. Pi SDK: `createAgentSession()`

This is the most efficient Pi-native option for a Node.js or TypeScript orchestrator. It creates independent Pi agent sessions in-process, avoiding subprocess startup and JSONL protocol overhead.

```typescript
import {
  createAgentSession,
  ModelRuntime,
  SessionManager
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();

const { session: reviewer } = await createAgentSession({
  cwd: process.cwd(),
  tools: ["read", "grep", "find", "ls"],
  sessionManager: SessionManager.inMemory(),
  modelRuntime
});

await reviewer.prompt("Review the authentication implementation.");
```

### Parallel SDK agents

Create separate sessions, then coordinate them with application code:

```typescript
const makeReviewer = async () => {
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    tools: ["read", "grep", "find", "ls"],
    sessionManager: SessionManager.inMemory(),
    modelRuntime
  });
  return session;
};

const [correctness, tests] = await Promise.all([
  makeReviewer(),
  makeReviewer()
]);

await Promise.all([
  correctness.prompt("Review correctness and regressions."),
  tests.prompt("Review tests and missing edge cases.")
]);
```

Use `createAgentSessionRuntime()` when an application needs persisted session replacement, switching, importing, or forking.

The SDK supplies agent sessions, but not a complete multi-agent supervisor. The application owns:

- concurrency and fanout limits;
- cancellation and timeouts;
- result collection and synthesis;
- writer isolation;
- retry and deduplication policy;
- lifecycle artifacts and status UI.

## 2. Pi RPC subprocess

Start a persistent, process-isolated Pi agent using the native RPC mode:

```bash
pi --mode rpc --no-session
```

Send strict LF-delimited JSONL commands over stdin:

```json
{"id":"child-1","type":"prompt","message":"Review the authentication code"}
```

Read streamed events from stdout until `agent_settled`. The same child can receive later `prompt`, `steer`, `follow_up`, and `abort` commands.

Use RPC when:

- the orchestrator is not written in Node.js;
- process isolation is required;
- a persistent controllable child is needed;
- a custom UI or service needs structured lifecycle events.

Launch multiple RPC processes for parallel agents. The client must manage process creation, JSONL correlation, trust flags, deadlines, cancellation, concurrency, and cleanup.

For Node.js applications, prefer the SDK unless process isolation is a requirement.

## 3. Pi JSON-mode subprocess

Use JSON mode for a structured one-shot agent:

```bash
pi --mode json -p --no-session "Review the authentication code"
```

The child emits JSON-line lifecycle and message events. An orchestrator can parse final assistant output, usage, tool activity, and failure state without maintaining a persistent RPC session.

This is the subprocess pattern used by Pi's official example subagent extension.

Use JSON mode when:

- one task should produce structured events and then exit;
- RPC's persistent command channel is unnecessary;
- a lightweight script still needs more than plain text output.

## 4. Pi print-mode subprocess

Use print mode for the simplest native one-shot agent:

```bash
pi -p --no-session "Review the authentication code"
```

It is easy to call from shell scripts and process runners, but exposes less lifecycle structure than JSON or RPC mode.

Typical uses:

- a simple independent answer;
- shell pipelines;
- low-complexity automation where only final text matters.

Avoid using print mode for orchestration that needs reliable status, retries, steering, or multiple correlated children.

## 5. Separate interactive Pi or tmux process

A human can open another terminal or tmux pane/window and start a separate Pi session:

```bash
pi --name "independent-review"
```

Pi core explicitly identifies separate Pi processes—such as tmux panes—as one possible way to build a multi-agent workflow.

Use this for:

- visible independent reviews;
- interactive trust or authentication prompts;
- alternate models or experiments;
- recovery work;
- long-lived ownership of another project.

This is manual coordination, not a managed parent-child relationship. The operator must transfer context/results and prevent conflicting writes.

# Part II: Extension and package mechanisms

The following options can be more convenient and feature-rich, but they are **not native Pi-core subagent facilities**. They exist only when their supplying extension or package is installed and enabled.

## 6. `pi-subagents`: `subagent` tool with `workflowScript`

In an environment with `pi-subagents` installed, this is the preferred managed extension mechanism. It adds agent discovery, child lifecycle tracking, artifacts, cancellation, costs, status views, context modes, and worktree isolation.

Discover available agents before execution:

```typescript
subagent({ action: "list" })
```

Only launch agents reported as executable and non-disabled.

### One child

```typescript
subagent({
  workflowScript: `return runs.run("review", {
    agent: "reviewer",
    task: "Review the current diff. Do not modify files."
  })`,
  async: true,
  context: "fresh"
})
```

### Parallel children

```typescript
subagent({
  workflowScript: `
    return runs.all([
      { key: "correctness", agent: "reviewer", task: "Review correctness. Do not edit." },
      { key: "tests", agent: "reviewer", task: "Review test coverage. Do not edit." }
    ]);
  `,
  async: true,
  context: "fresh"
})
```

### Sequential or conditional workflow

```typescript
subagent({
  workflowScript: `
    const scan = await runs.run("scan", {
      agent: "scout",
      task: "Locate the authentication implementation."
    });

    if (!scan.output) return { status: "not-found" };

    return runs.run("plan", {
      agent: "planner",
      task: "Propose a change using this reconnaissance: " + scan.output
    });
  `,
  async: true
})
```

`workflowScript` supports `runs.run()` for one child, `runs.all()` for parallel children, and ordinary restricted JavaScript for sequencing, branching, filtering, and aggregation.

### Launch variants

- `async: true` — preferred background execution.
- `async: false` — small foreground/blocking run.
- `context: "fresh"` — clean context, preferred for independent review.
- `context: "fork"` — branched context inheriting a persisted parent session.
- `worktree: true` — managed isolated Git worktree for a writer; requires a clean repository.
- `cwd` — explicit target for cross-repository work.
- `missionId`, `mission`, or `mission: false` — durable mission attachment controls.
- `acceptance` or `gate` — evidence/verification controls.
- `model`, `skill`, tools, and output options — per-child configuration.
- `runner.type: external-cli` agent profile — launch a configured one-shot external CLI through the same extension lifecycle.

### Continue or control a child

```typescript
subagent({ action: "children.list" })

subagent({
  workflowScript: `return runs.run("follow-up", {
    resume: "<child-run-id>",
    task: "Now inspect the failing edge case."
  })`
})
```

```typescript
subagent({ action: "status", id: "<run-id>" })
subagent({ action: "status", view: "fleet" })
subagent({ action: "steer", id: "<run-id>", message: "Focus on the failing test." })
subagent({ action: "interrupt", id: "<run-id>" })
subagent({ action: "stop", id: "<run-id>" })
```

Ordinary children should not spawn additional children. Nested fanout is allowed only when the parent explicitly assigns it, the child receives the `subagent` tool, and configured depth/capability limits permit it.

## 7. `pi-subagents`: `/run` and packaged commands

For a human in the TUI, `/run` is the shortest managed extension path:

```text
/run reviewer "Review the current diff for correctness"
```

Optional one-run override:

```text
/run reviewer[model=anthropic/claude-sonnet-4] "Review this diff"
```

Prompt-template adapters:

- `/prompt-workflow` — run a prompt template through managed `workflowScript` execution.
- `/chain-prompts` — turn prompt templates into sequential managed subagent steps.

Packaged recipes include:

- `/parallel-review`;
- `/review-loop`;
- `/parallel-research`;
- `/gather-context-and-clarify`;
- `/parallel-cleanup`.

Commands such as `/subagents`, `/subagents-fleet`, `/subagents-stop`, and `/subagents-detach` administer runs; they are not separate spawn engines.

## 8. `pi-subagents`: scheduled runs

The extension can persist one-shot or recurring `workflowScript` schedules:

```typescript
subagent({
  action: "schedule.create",
  id: "evening-review",
  name: "Evening review",
  at: "+30m",
  workflowScript: `return runs.run("review", {
    agent: "reviewer",
    task: "Review the current diff."
  })`
})
```

Recurring example:

```typescript
subagent({
  action: "schedule.create",
  id: "backlog-scan",
  name: "Backlog scan",
  every: "6h",
  catchUp: "latest",
  workflowScript: `return runs.run("scan", {
    agent: "scout",
    task: "Scan for newly introduced TODO debt."
  })`
})
```

Schedules launch asynchronously with fresh context. Use them only for work the user explicitly requested.

## 9. `subagent_gate`

`subagent_gate` is supplied by this repository's WebUI package. It calls the `pi-subagents` v1 RPC, tracks completion, requires a success quorum, and performs bounded failure-aware retries.

```typescript
subagent_gate({
  tasks: [
    {
      agent: "reviewer",
      task: "Review authentication correctness. Do not edit.",
      retrySafety: "read-only"
    },
    {
      agent: "reviewer",
      task: "Review authentication tests. Do not edit.",
      retrySafety: "read-only"
    }
  ],
  requiredSuccesses: 2,
  maxAttemptsPerTask: 2,
  concurrency: 2
})
```

Use it when a result must satisfy a success count, provider-diversity rule, or bounded retry policy.

Never label a task `read-only` if rerunning it could duplicate file mutations or external side effects. Mutation-capable tasks default to `may-write`, preventing automatic post-launch retries.

## 10. `pi-subagents` in-process event-bus RPC

Another Pi extension can request a managed child through `pi.events`:

```typescript
const requestId = crypto.randomUUID();

pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (reply) => {
  // Handle launch receipt.
});

pi.events.emit("subagents:rpc:v1:request", {
  version: 1,
  requestId,
  method: "spawn",
  params: {
    workflowScript: `return runs.run("review", {
      agent: "reviewer",
      task: "Review the current diff."
    })`
  }
});
```

Properties:

- `spawn` is async-only.
- It reuses the extension's executor, discovery, ceilings, artifacts, depth controls, and status model.
- Related methods include `ping`, `status`, `steer`, `interrupt`, `resume`, and `stop`.
- `pi.events` is process-local and does not cross into another Pi process.

This is an extension integration seam, not a Pi-core RPC protocol. Do not confuse it with `pi --mode rpc`.

## 11. `workflow_run` JavaScript workflows

`pi-extension-workflows` supplies a separate reusable workflow runtime.

Human launch:

```text
/workflow run my-workflow
```

Tool launch:

```typescript
workflow_run({
  name: "my-workflow",
  args: { target: "src/auth" },
  confirmRun: true
})
```

A current workflow can coordinate children with stable-key `runs.run()` and `runs.all()` calls:

```javascript
export const meta = {
  name: "review-auth",
  description: "Run independent authentication reviews"
};

const reviews = await runs.all([
  {
    key: "correctness",
    agent: "reviewer",
    task: "Review auth correctness. Do not modify files."
  },
  {
    key: "tests",
    agent: "reviewer",
    task: "Review auth tests. Do not modify files."
  }
]);

return reviews.map(result => result.output);
```

Use this when orchestration should be saved, approved, resumed, replayed, and governed by workflow policy. Direct `subagent` execution has less overhead for ordinary one-off extension-based delegation.

Older saved-workflow versions used globals named `agent()`, `phase()`, `parallel()`, and `pipeline()`. Follow the currently installed `workflow_run` tool schema for new scripts.

## 12. Custom Pi extension or model-callable tool

Pi's extension API can be used to build a bespoke subagent implementation. The extension can:

1. create child sessions through the Pi SDK; or
2. spawn Pi JSON/RPC/print subprocesses.

Skeleton:

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_subagent",
    description: "Delegate one bounded task",
    parameters: MySchema,
    async execute(_id, params, signal, onUpdate, ctx) {
      // Create an SDK session or Pi subprocess.
      return {
        content: [{ type: "text", text: "child result" }],
        details: {}
      };
    }
  });
}
```

Pi's official `examples/extensions/subagent/` example spawns `pi --mode json -p --no-session` processes and implements single, parallel, and sequential-chain execution.

The extension API is native to Pi, but the resulting **subagent implementation is custom extension behavior**, not a native Pi subagent facility.

Only build this when existing packages cannot satisfy the required policy, UX, or trust boundary. Extension code runs with full host permissions and must correctly implement cancellation, process-tree cleanup, truncation, trust handling, limits, and writer isolation.

# Compatibility and non-launch surfaces

## Legacy extension payloads

Older subagent extensions exposed payloads such as:

- single: `{ agent, task }`;
- parallel: `{ tasks: [...] }`;
- chain: `{ chain: [...] }`.

The current `pi-subagents` execution surface uses `workflowScript`, `runs.run()`, and `runs.all()`. Treat older payloads as package/version-specific compatibility behavior.

## Not subagent launch mechanisms

These are often confused with launching a child:

- `/fork`, `/clone`, `AgentSessionRuntime.fork()`, and core RPC `fork`/`clone` branch or replace the active session.
- `steer` and `follow_up` send more input to an existing session.
- `resume` continues or revives an existing persisted child.
- `subagent_wait()` waits for extension-managed work.
- `subagent_supervisor` and `intercom` communicate with running children.
- Skills and prompt templates can instruct an agent to launch children, but do not launch a process by themselves.
- Watchdog review is automatic extension behavior, not a general-purpose launch API.

# Selection guide

1. **Node.js application needing the most efficient Pi-native child?** Use the SDK.
2. **Other language or process isolation required?** Use Pi RPC mode.
3. **Structured one-shot native child?** Use JSON mode.
4. **Simplest native shell invocation?** Use print mode.
5. **Visible manually controlled independent agent?** Use another Pi/tmux process.
6. **Installed `pi-subagents` and need managed delegation?** Use `subagent` + `workflowScript`.
7. **Human using installed `pi-subagents` interactively?** Use `/run`.
8. **Deferred managed extension work?** Use its schedule support.
9. **Quorum or bounded safe retries?** Use `subagent_gate`.
10. **Extension integrating with `pi-subagents`?** Use its event-bus RPC.
11. **Reusable approved orchestration?** Use `workflow_run`.
12. **Unmet custom requirement?** Build and review a bespoke extension.

# Safety rules for every method

- Keep one final orchestrator and decision-maker.
- Use one active writer per working tree; isolate parallel writers in clean, non-overlapping worktrees.
- Give each child a bounded task, authority boundary, success criteria, validation, output contract, and stop rules.
- Prefer clean context for independent review and inherited context only when history is required.
- Treat child output as unverified until evidence is inspected.
- Do not duplicate a child whose lifecycle is still live or ambiguous.
- Bound recursive delegation and concurrency.
- Require explicit authorization for destructive actions, credentials, publishing, merging, deployment, or external side effects.

# Sources checked

- Pi core `README.md` — core philosophy, SDK, CLI, JSON/print modes, RPC, and tmux guidance.
- Pi core `docs/sdk.md` — `createAgentSession()` and `createAgentSessionRuntime()`.
- Pi core `docs/rpc.md` — subprocess JSONL protocol.
- Pi core `docs/extensions.md` and `examples/extensions/subagent/` — extension API and official custom subagent example.
- Installed `pi-subagents` skill and references — extension tool, commands, schedules, event-bus RPC, worktrees, and lifecycle controls.
- `pi-package-webui/lib/subagent-gate.mjs` — `subagent_gate` implementation.
- [`pi-extension-workflows/README.md`](../pi-extension-workflows/README.md), [`TECHNICAL.md`](../pi-extension-workflows/TECHNICAL.md), and [`DEVELOPMENT.md`](../pi-extension-workflows/DEVELOPMENT.md) — reusable workflow behavior and legacy dialect context.
- `pi-skill-subagent-governance` — role fit, one-writer isolation, retry safety, and integration rules.
