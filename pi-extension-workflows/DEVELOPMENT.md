# Development guide: Workflows for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Local live self-test

`/workflow-test` is intentionally **local-dev only** and is not published to npm. It lives in `dev/workflow-test-extension.ts`, which is excluded from the package `files` list.

For local TUI regression testing from this repository, load both the production extension and the dev self-test extension:

```bash
pi -e ./pi-extension-workflows/index.ts -e ./pi-extension-workflows/dev/workflow-test-extension.ts
```

Then run:

```text
/workflow-test                 # deterministic, no model-cost test runner
/workflow-test --keep          # keep the temp target for inspection
/workflow-test --real          # prompt, then use real Pi subprocess agents
/workflow-test --real --confirm-real
```

The command creates an isolated temporary target project, loads a project-local self-test workflow from that target, runs it through the same workflow runtime, and verifies the resulting summary markers. The default deterministic mode is intended for repeatable TUI regression checks while features evolve. Real mode is closer to a true agent fanout run, but may use model/tool budget.

NPM installs of this package expose `/workflow`, `/workflow-clear`, `workflow_run`, and `workflow_status`, but not `/workflow-test`.

Workflow Mode publishes human-readable native status plus a versioned RPC payload. It fails closed when another extension announces an active exclusive mode.
## Development

Run tests:

```bash
npm test
```

The tests use Node's TypeScript stripping support, QuickJS/WASM, fake task runners, and a deterministic local Node JSONL subprocess fixture. They do not launch Pi or make provider/network calls. The runtime suite is also validated with Bun when available.

## Preserved implementation and format details

Minimal modular workflow runtime extension for Pi.

This package implements a modular workflow foundation:

```text
Workflow Source → Validation/Policy → Run State → Phases → Agent Fanout → Final Result
```

It supports both the legacy JSON Workflow IR and capability-only JavaScript workflows. JavaScript runs inside a bounded QuickJS/WASM context and can orchestrate Pi subprocess agents without receiving Node.js, filesystem, shell, environment, or network globals.

## Commands

```text
/workflow list
/workflow status [run-id]
/workflow mode [once|on|off|toggle|status]
/workflow-setup
/workflow run <workflow-name> [json-args]
/workflow <workflow-name> [json-args]
/workflow pause|resume|abort <run-id>
/workflow retry <run-id> <call-id>
/workflow worktrees|apply|cleanup <run-id>
/workflow save <run-id> --project|--user
/workflow format <trusted-workflow-path>
/workflow import-claude <path>
/workflow bundle export|import ...
/workflow schedule list|add|remove|run-due
/workflows
/workflow-clear
```

Example:

```text
/workflow run deep-research-minimal {"topic":"Pi workflow extensions"}
```

## Tools

- `workflow_run` — asynchronously launch a workflow from `scriptPath`, inline `script`, or saved `name` (in that precedence order). Successful launches return `async_launched` and `terminate: true`.
- `workflow_status` — inspect a run by ID or the latest active/historical run.

Generated JavaScript requires an approval dialog even when `confirmRun` is true. The dialog supports Run once, remembered approval for the exact project/script/policy hashes, raw source inspection, and Cancel.

## Workflow files

Bundled workflows live in:

```text
workflows/*.js
```

The bundled `deep-research-minimal` workflow is JavaScript. Its former JSON definition is retained under `workflows/legacy/` for migration reference but is not discovered or executed.

User and trusted-project JavaScript workflows are discovered from:

```text
~/.pi/agent/workflows/*.js
.pi/workflows/*.js
```

`PI_CODING_AGENT_DIR` overrides `~/.pi/agent`. Project-local workflows are loaded only when `ctx.isProjectTrusted()` reports that the project is trusted. A saved filename must match `meta.name`.

Minimal JavaScript workflow:

```js
export const meta = {
  name: "audit-routes",
  description: "Audit route handlers",
  phases: ["discover", "verify"],
  pi: { maxConcurrency: 2, maxAgents: 20, maxNestingDepth: 16 }
}

const files = await phase("discover", () =>
  agent("Find route files", {
    label: "discover",
    tools: ["find", "read"],
    schema: {
      type: "object",
      required: ["files"],
      properties: { files: { type: "array", items: { type: "string" } } }
    }
  })
)

return phase("verify", () =>
  pipeline(files.files, file => agent(`Audit ${file}`, {
    label: `audit:${file}`,
    tools: ["read", "grep"]
  }), { concurrency: 2 })
)
```

Runtime globals are `args`, `agent()`, `phase()`, `parallel()`, and `pipeline()`. Editor declarations are shipped in `workflow-runtime.d.ts`; deterministic whitespace formatting is available through `/workflow format`. Tested starter scripts live under `workflows/templates/` for audit, research, migration planning, and bounded verify loops.

Policies can declare concurrency, total agents, nesting depth, run/phase token/cost/time budgets, per-agent token/turn limits, and bounded transient retry:

```js
pi: {
  maxConcurrency: 2,
  budgets: {
    run: { maxTokens: 100000, maxCostUsd: 2, maxTimeMs: 900000, maxAgents: 20 },
    phase: { maxTokens: 30000, maxCostUsd: 0.75, maxTimeMs: 300000, maxAgents: 8 },
    agent: { maxTokens: 12000, maxTurns: 6 }
  },
  retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000, jitter: 0.2 }
}
```

An individual call can tighten, but cannot increase, its effective limits:

```js
await agent("Summarize the audit", {
  label: "summary",
  maxTokens: 6000,
  maxTurns: 3
})
```

`maxTokens` counts reported input, output, cache-read, and cache-write tokens. `maxTurns` counts assistant messages, including assistant messages without usage metadata; this also makes recorded `usage.turns` reflect every assistant turn for unbudgeted calls. Both policy and call values must be positive integers, and call values participate in replay fingerprints. A token-bounded call without an explicit `maxTurns` receives a default cap of 8 assistant turns.

When a run or phase token budget is configured, each non-replay attempt reserves capacity synchronously before worktree setup or scheduler dispatch. For each applicable scope, the deterministic quantum is:

```text
max(1, floor(scope.maxTokens / max(2, effective maxConcurrency)))
```

The dispatched allowance is the minimum positive run/phase remaining capacity, applicable scope quanta, `budgets.agent.maxTokens`, and the call's `maxTokens`. Active reservations reduce remaining capacity, preventing concurrent calls from oversubscribing a scope; unused reservation is released when an attempt settles.

Enforcement occurs when the subprocess reports an assistant `message_end`. Token enforcement therefore can stop only after one response has exceeded its allowance; that response's partial text and complete reported usage are retained, but no later turn is allowed. Each bounded attempt receives an internal instruction to use tools selectively and return its concise best answer before the final allowed turn. A model-authored final response at the turn limit completes normally; if the model instead continues, turn enforcement hard-stops the subprocess at that boundary. The hint improves useful-result behavior but is not a provider-level output guarantee.

Every settled retry attempt is charged once to the task's cumulative usage, including transient failures. Agent budget stops are `budget_exhausted`, retain partial evidence, and are not retried. Write actions are never retried automatically. Replay hits neither reserve nor spawn a subprocess, but their cached usage is charged once to the current run and can exhaust its run or phase budget.

## Workflow Mode

Enable persistent Workflow Mode for the current Pi session:

```text
/workflow mode on
```

While enabled, the extension augments the main agent's system prompt so substantive requests are planned as reusable JavaScript workflows and sent through `workflow_run`. Disable it with `/workflow mode off`. Use `/workflow mode once` to arm only the next agent turn.

Generated workflows declare needed `write` or `shell` values in `meta.pi.permissions` as workflow-wide upper bounds. The effective user/project `workflow-policy.json` ceiling may narrow or deny them. A global permission does not give every call that authority: each mutation-capable `agent()` call must explicitly request `bash`, `write`, `edit`, or `apply_patch` in its own `tools` array, while planning and review calls remain read-only. Authority is never inferred from phase names.

```js
export const meta = {
  name: "implement-and-review",
  description: "Make an approved change, then review it read-only",
  phases: ["implementation", "review"],
  pi: { permissions: { write: true, shell: true } }
}

const implementation = await phase("implementation", () =>
  agent("Implement and test the approved change", {
    label: "implement",
    tools: ["read", "edit", "bash"]
  })
)

return phase("review", () => agent(`Review this result: ${implementation}`, {
  label: "review",
  tools: ["read", "grep"]
}))
```

Workflow Mode does not create, edit, or relax user or project `workflow-policy.json` files. Missing ceilings remain deny-by-default; configure them separately and deliberately when broader authority is intended.

The WebUI exposes the same extension-owned mode through its **Workflow** toggle. The browser sends canonical `/workflow mode on|off` commands and reflects the extension's `workflow-mode` status; it does not rewrite ordinary prompts itself.

## Current safety model

- JavaScript metadata is parsed statically before execution.
- Imports, Node host identifiers, `eval`, `Function`, and WebAssembly are rejected or removed.
- Script execution uses a QuickJS/WASM heap with memory, stack, time, concurrency, and agent-count limits.
- The script receives JSON-compatible values and orchestration capabilities only.
- Read-only tools (`read`, `grep`, `find`, and `ls`) remain the default.
- Write, shell, and network permissions default to deny. Explicit user/project ceilings are loaded from `workflow-policy.json`; project ceilings can only narrow user authority.
- Every write agent receives a separate git worktree. Binary patches, base commit, branch, dirty state, and changed files are persisted; the target checkout changes only after `/workflow apply` confirmation and configured verification.
- A subprocess policy-guard extension blocks tools outside each call's frozen allowlist and lexical or symlink filesystem escapes. `bash` additionally requires the call's shell permission and accepts only one simple command whose executable is in the effective shell allowlist; shell operators, substitutions, unquoted expansions/comments, redirections, newlines, ambiguous quoting, and executable-path bypasses are rejected.
- A shell allowlist is not an OS sandbox: an admitted executable retains its full behavior, including subcommands, file arguments, child processes, and possible access outside the worktree. The network allowlist governs Web/network tools only; it cannot constrain network access performed by an allowlisted shell executable. Allowlist script-running or network-capable programs only for repositories you trust.
- The LLM-callable `workflow_run` tool requires explicit `confirmRun: true` and separate launch approval when no exact remembered consent exists.
- Every accepted run persists immutable source and policy snapshots plus versioned run, event, call, usage, and result artifacts under `~/.pi/agent/workflow-runs/<session-id>/<run-id>/`.
- Runs execute asynchronously through a global scheduler; cancellation terminates subprocess process groups.
- Replay resume caches unchanged completed calls; changed, failed, running, and explicitly retried calls run again. Pause lets active calls finish but starts no new work.
- Run/phase admission and per-agent token/turn stops produce `budget_exhausted`; transient read-only failures use bounded exponential backoff with jitter.
- Token/turn limits do not grant new tools or authority. Shell, write, filesystem, and network authority still require the exact call tool request and applicable permission ceiling.
- Large agent/token policies are shown before launch and while running.

## Saving and JSON migration

Save a successful generated JavaScript run explicitly:

```text
/workflow save <run-id> --user
/workflow save <run-id> --project
```

Existing files are never overwritten without confirmation. Project saves require a trusted project. Saved scripts are revalidated and their filename must match `meta.name`.

Legacy JSON discovery/execution remains temporarily available for user and project workflows and emits a deprecation warning. Migrate JSON manually by expressing its phases and tasks with `phase()`, `parallel()`, `pipeline()`, and `agent()`, then save the resulting `.js` file in one of the directories above. JSON execution will be removed only after no bundled workflow uses it, a released version has emitted warnings, migration documentation exists, and TUI/WebUI JavaScript lifecycle tests pass.

### Permission ceilings

User ceiling: `~/.pi/agent/workflow-policy.json` (or `$PI_CODING_AGENT_DIR/workflow-policy.json`). Optional trusted-project ceiling: `.pi/workflow-policy.json`. Both use:

```json
{
  "schemaVersion": 1,
  "permissions": { "write": true, "shell": false, "network": false },
  "shellAllowlist": [],
  "networkAllowlist": [],
  "verificationCommands": [["npm", "test"]]
}
```

If both files exist, permissions and allowlists are intersected. If the user file is missing, broader permissions default to deny; a project file can only narrow user authority. These files are never automatically created or relaxed.

Use `/workflow-setup` in Pi's native TUI to explicitly review and save the **global user** ceiling. It starts from the current policy (or all-deny when missing), accepts newline-delimited shell and network allowlists plus one JSON argv verification command per line, and shows the normalized JSON and target path before Save. Cancel or a declined review never creates a file. The setup flow is never invoked automatically by generated workflows or model tool calls. An empty verification command list is supported, but applying worktrees then requires an explicit waiver.

A workflow's `meta.pi.permissions` request is also only an upper bound, and each `agent()` call receives only the tools explicitly listed on that call. Shell commands are limited to one simple allowlisted command without shell operators, substitutions, unquoted expansions/comments, redirections, newlines, ambiguous quoting, or executable-path bypasses. Allowlisting a command grants that executable's full argv-level capability and is not OS-level containment. Network tools require explicit URLs whose hosts match the effective allowlist; shell executables are outside that host filter. Unmerged mutation-capable worktrees are preserved during cleanup or recovery.

### Bundles, compatibility, and schedules

`/workflow bundle export` writes a versioned bundle containing exact source bytes/hash, metadata, effective policy requirements, and test vectors. Import requires project trust where applicable and explicit conflict review. `/workflow import-claude` performs conservative best-effort inspection: code fences may be removed, but unsupported imports, default exports, host globals, or syntax are reported rather than rewritten.

Schedules are versioned metadata stored outside workflow scripts in `workflow-schedules.json`. `/workflow schedule run-due` requires interactive confirmation and ordinary workflow approval, preserving deterministic script semantics.

Direct `/<workflow-name>` aliases are intentionally not registered in v1 because they can collide with Pi and extension commands. `/workflow run <name>` and `/workflow <name>` remain canonical and completion-aware.

See:

- `docs/planned/workflows/Workflow_js-runtime-implementation-plan.md`
- `docs/workflows/Workflow_js-runtime-threat-model.md`
- `docs/workflows/Workflow_js-runtime-architecture-decisions.md`
