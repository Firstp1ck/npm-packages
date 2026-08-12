# Robust WebUI subagent synchronization

**Status:** In progress  
**Classification:** Complex reliability feature  
**Integration owner:** Parent Pi session  
**Target:** `pi-package-webui`  
**Created:** 2026-08-12

## Goal

Make the WebUI **Subagents** section consistently discover, retain, and display active and completed subagent runs across fast launches, async workflows, polling timeouts, session-tree changes, browser reconnects, and helper-status delivery races.

## Success criteria

1. A `workflowScript` launch is represented immediately, even before a child emits detailed progress.
2. Authoritative structured fleet data recovers active children that the legacy formatted status parser misses.
3. One failed/late poll cannot incorrectly finish or remove a still-running run.
4. Session-tree changes re-poll immediately and cannot let an older in-flight response overwrite the new branch.
5. A failed `setStatus` delivery is retried; unchanged snapshots are periodically republished so server restart/re-attachment can recover without requiring lifecycle mutation.
6. Browser refresh scheduling cannot stall when a refresh is requested while another refresh is in flight.
7. Completed ordinary runs remain branch-persisted under the existing bounded retention contract and explicit clear/dismiss behavior remains unchanged.
8. Focused helper, server, browser/static, syntax, and package tests pass.

## Scope

### In scope

- `webui-rpc-helper.mjs` lifecycle capture, structured fleet fallback, poll generation/sequence guards, status publication retry/heartbeat, and retained-run reconciliation.
- `bin/pi-webui.mjs` payload normalization only where needed for recovery metadata.
- `public/app.js` coalesced refresh behavior and prompt visibility of provisional/recovered rows.
- Regression tests for missed workflow starts, stale polls, timeout/delivery recovery, session-tree changes, and overlapping browser refresh requests.
- User-facing reliability/troubleshooting documentation where observable behavior changes.

### Non-goals

- Replacing or modifying the installed `pi-subagents` package.
- Changing subagent execution, provider selection, retry policy, cancellation semantics, or retention limits.
- Persisting workflow-only runs after their producer has declared them terminal.
- Exposing private child prompts, filesystem paths, raw status payloads, or unrestricted lifecycle artifacts to the browser.
- Redesigning the Subagents panel or its terminal-view UX.

## Approved decisions and invariants

- Treat structured RPC fleet data as the authoritative recovery signal for active children; keep text parsing as compatibility detail for run grouping and control/output locators.
- Publish provisional/recovered rows when exact run grouping is temporarily unavailable rather than hiding known-active children.
- Never mark a run finished from one absent snapshot. Require repeated successful authoritative observations, scoped to the same session/poll generation.
- Ignore responses from an older session/poll generation.
- Only record a publish signature after `ctx.ui.setStatus` succeeds.
- Republish an unchanged bounded snapshot periodically as a self-healing heartbeat.
- Keep one active writer in the shared worktree; implementation workstreams run serially.
- Existing explicit dismissal, cancellation, and 16-run terminal retention behavior remains authoritative.

## Execution DAG and ownership

### Wave 1 — Core helper synchronization (Worker A)

**Prerequisite:** this plan.  
**Write boundary:** `pi-package-webui/webui-rpc-helper.mjs`, `pi-package-webui/tests/subagents-helper.test.mjs`.  
**Deliverables:** structured fleet fallback, provisional workflow launch capture, generation/sequence-safe reconciliation, multi-observation completion, publish retry/heartbeat, focused helper regressions.  
**Handoff:** `pi-package-webui/plans/handoffs/subagent-reliability-worker-a.md`.

### Wave 2 — Server/browser integration and contract tests (Worker B)

**Prerequisite:** Worker A integrated and helper tests passing.  
**Write boundary:** `pi-package-webui/bin/pi-webui.mjs`, `pi-package-webui/public/app.js`, relevant `pi-package-webui/tests/**`, `pi-package-webui/README.md`, `pi-package-webui/TECHNICAL.md`, `pi-package-webui/DEVELOPMENT.md`. Worker B must not change Worker A files.  
**Deliverables:** normalize any recovery metadata needed by the UI, lossless/coalesced browser refresh scheduling, end-to-end/static regressions, correctly layered documentation.  
**Handoff:** `pi-package-webui/plans/handoffs/subagent-reliability-worker-b.md`.

### Wave 3 — Central integration and validation

The parent inspects both diffs and handoffs, runs affected and cross-workstream checks, resolves only evidence-backed issues, and updates this plan.

### Wave 4 — Independent review

Two fresh-context read-only reviewers from distinct available provider families inspect the integrated result. Every finding receives `accepted`, `rejected`, `deferred`, or `needs verification` disposition here. Accepted fixes are applied by one serial fix worker and revalidated.

### Wave 5 — Acceptance and report

Run the acceptance readiness gate and create `pi-package-webui/reports/subagent-section-reliability.html`. Link the report here and archive this plan only after all completion gates pass.

## Validation contract

Minimum checks:

```bash
cd pi-package-webui
node --check webui-rpc-helper.mjs
node --check bin/pi-webui.mjs
node --check public/app.js
node tests/subagents-helper.test.mjs
node tests/mobile-static.test.mjs
node tests/http-endpoints-harness.test.mjs
npm test
cd ..
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Behavioral evidence must demonstrate:

- direct `workflowScript` starts are visible before detailed progress;
- structured fleet fallback fills gaps without duplicating text-parsed children;
- transient omission does not terminalize a live run;
- stale pre-switch poll responses are ignored;
- failed status delivery and unchanged-snapshot heartbeat recover server state;
- a refresh requested during an in-flight browser request runs afterward;
- retained completion/dismiss/cancel behavior remains green.

## Rollback

Revert the helper synchronization and browser refresh changes together. The retained custom-entry schema remains version 1 and requires no migration rollback. Existing saved snapshots remain readable.

## Risks

- Structured fleet entries are intentionally bounded and may omit children above the upstream cap; the UI must report omissions rather than imply completeness.
- Fleet keys are opaque and may not map to a controllable run ID; provisional rows must not expose unsupported output/cancel actions.
- Heartbeat publication must stay bounded and must not create browser polling or transcript noise.
- Text status remains a compatibility seam; tests must avoid coupling new correctness solely to display prose.

## Decision and progress record

- 2026-08-12: Classified complex because the change crosses extension lifecycle, RPC synchronization, server cache, browser refresh, persistence, and tests.
- 2026-08-12: Chose structured fleet fallback plus compatibility text parsing instead of modifying the installed upstream package.
- 2026-08-12: Chose serial workers in one clean shared worktree to preserve one-writer isolation.

## Review findings and dispositions

Pending integrated review.

## Completion checklist

- [ ] Worker A qualifying implementation and handoff inspected
- [ ] Worker B qualifying implementation and handoff inspected
- [ ] Affected and cross-workstream validation passes
- [ ] Two qualifying independent reviews completed
- [ ] Every finding disposition recorded and accepted fixes revalidated
- [ ] Self-contained HTML report linked here
- [ ] Acceptance readiness gate passes
- [ ] Plan moved to `plans/archive/`
