# Pi Workflow Extension

Minimal modular workflow runtime extension for Pi.

This package implements a minimal modular workflow foundation:

```text
Workflow Definition → Run State → Phases → Task/Agent Fanout → Aggregation → Final Result
```

It intentionally uses a data-only Pi Workflow IR instead of cloning an undocumented JavaScript workflow DSL. Repository planning docs are not required at runtime or in the published npm package.

## Commands

```text
/workflow list
/workflow status
/workflow run <workflow-key> [json-input]
/workflow <workflow-key> [json-input]
/workflow abort
/workflow-clear
```

Example:

```text
/workflow run deep-research-minimal {"topic":"Pi workflow extensions"}
```

## Tools

- `workflow_run` — run a workflow when `confirmRun` is true.
- `workflow_status` — inspect the active/latest workflow run.

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

## Workflow files

Bundled workflow definitions live in `workflows/*.json`.

Trusted project workflow definitions may live in:

```text
.pi/workflows/*.json
```

Project-local workflows are only loaded when `ctx.isProjectTrusted()` reports that the current project is trusted.

## v0 safety model

- Workflow definitions are JSON data, not executable code.
- Only read-only tools are allowed by schema validation: `read`, `grep`, `find`, and `ls`.
- Total tasks and concurrency are hard-capped.
- The LLM-callable `workflow_run` tool requires explicit `confirmRun: true`.
- v0 persists run state to the Pi session for visibility, but does not resume interrupted runs.

## Development

Run tests:

```bash
npm test
```

The tests use Node's TypeScript stripping support and fake task runners; they do not spawn Pi subprocesses.
