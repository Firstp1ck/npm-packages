# JavaScript Workflow Runtime Architecture Decisions

**Status:** Accepted baseline  
**Date:** 2026-07-15  
**Plan:** `docs/workflows/Workflow_js-runtime-implementation-plan.md`

## ADR-001 — JavaScript is the author-facing source of truth

**Decision:** New generated and saved workflows are `.js` scripts. Existing JSON workflows remain available through a temporary legacy adapter.

**Reason:** JavaScript naturally represents loops, branches, fanout, and intermediate variables while remaining inspectable and reusable.

**Consequence:** Loader and registry entries become a JSON/JavaScript discriminated union. The static JSON runner remains isolated from the new script runtime.

## ADR-002 — Use a capability-only JavaScript interpreter

**Decision:** Use exact-version `quickjs-emscripten` as the initial production isolation backend, subject to adversarial and packaging tests.

**Reason:** It provides a separate JavaScript heap, host-function injection, memory/stack limits, and interrupt handling without exposing Node globals. It works in Node and Bun packaging targets.

**Consequence:** Runtime handles require explicit disposal. No module loader is installed. `acorn` parses metadata and rejects unsupported syntax before QuickJS evaluation.

**Fallback:** A Node subprocess may be used only as an explicitly documented trusted-script development fallback. Node `vm` is not an accepted production security boundary.

## ADR-003 — Expose only orchestration primitives

**Decision:** Scripts receive structured `args` plus `agent`, `phase`, `parallel`, and `pipeline`.

**Reason:** External side effects remain auditable and policy-controlled through Pi agents.

**Consequence:** The capability bridge accepts and returns only JSON-compatible values. Workflow scripts cannot directly open files, spawn processes, read environment variables, or use network APIs.

## ADR-004 — Make run launch asynchronous

**Decision:** `workflow_run` persists and launches a run, then immediately returns an `async_launched` receipt with `terminate: true`.

**Reason:** The main session must stay responsive while scripts coordinate potentially long-running fanout.

**Consequence:** A run manager owns controllers by run ID. Progress uses extension UI events; completion injects one consolidated result message.

## ADR-005 — Freeze effective policy at acceptance

**Decision:** Effective policy is the intersection of script requests and hard/user/project ceilings, persisted before execution.

**Reason:** A script must not widen capabilities during execution, and approval must describe the exact authority granted.

**Consequence:** Policy changes invalidate remembered approval. Defaults deny write, shell, and network; explicit user/project ceilings may grant bounded authority and project policy can only narrow it.

## ADR-006 — Resume through deterministic replay

**Decision:** Re-execute the script and return cached results for completed unchanged agent calls instead of serializing the interpreter heap.

**Reason:** Arbitrary JavaScript state is not reliably serializable. Replay reconstructs variables while retaining completed expensive work.

**Consequence:** Calls need stable labels or pipeline keys. The ledger fingerprints phase path, label, prompt, normalized options, and item key.

## ADR-007 — Keep the extension authoritative

**Decision:** `pi-extension-workflows` owns mode state, source discovery, approval, policy, scheduling, run state, and event payloads.

**Reason:** Native TUI and WebUI must behave consistently and cannot implement divergent prompt routing or permission logic.

**Consequence:** WebUI remains a thin client sending canonical commands and rendering versioned extension state.

## ADR-008 — Read-only defaults with isolated optional writers

**Decision:** Default tools remain `read`, `grep`, `find`, and `ls`. Explicitly authorized write agents execute in one git worktree per call; shell and network tools pass through a frozen child-process policy guard.

**Reason:** Parallel writers require repository isolation, auditable patches, verification, confirmed serial apply, allowlists, and crash recovery.

**Consequence:** The target checkout is never modified by agent execution itself. Apply requires a clean target and confirmation; cleanup preserves unmerged worktrees; write retries are disabled.

## ADR-009 — Preserve existing JSON behavior during migration

**Decision:** Existing JSON commands, bundled definitions, state rendering, and tests remain supported while JS capability is introduced.

**Reason:** The new runtime should be additive until the bundled workflow and UI paths reach parity.

**Consequence:** `WorkflowSource` is discriminated by `sourceType`; the existing runner accepts JSON sources only; the new script runner accepts JavaScript sources only.

## ADR-010 — Initial hard limits remain conservative

**Decision:** Retain hard caps of 8 concurrent agents and 100 total agents per run. Default limits remain 3 concurrent and 50 total. Default wall-clock timeout is 30 minutes; hard timeout is 2 hours. Initial interpreter memory is 64 MiB with a 128 MiB hard ceiling.

**Reason:** Existing limits are already understood by the package and are safer than immediately mirroring larger external limits.

**Consequence:** Raising limits requires usage/cost budget controls and evidence from stress tests. Run/phase token, cost, time, and agent budgets plus bounded read-only retries are now part of the policy snapshot.
