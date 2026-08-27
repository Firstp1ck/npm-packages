# Qt WebUI tab activity status parity

**Status:** planned  
**Classification:** complex  
**Integration owner:** parent Pi session `01a04282-5b0b-78b4-8741-d585b9e9f916`  
**Related parity map:** [pi-webui-feature-parity.md](pi-webui-feature-parity.md)  
**Final report:** [../../reports/qt-webui-tab-activity-status.html](../../reports/qt-webui-tab-activity-status.html)

## Goal

Give every open Qt WebUI session and tab the same four user-facing activity states as Pi WebUI: `blocked`, `working`, `done`, and `idle`.

## Classification rationale

The preliminary lightweight classification is contradicted by repository evidence. The status is not a label-only change: Pi WebUI keeps completion state until output is seen, gives pending extension input priority over active work, and renders the result in both session and tab navigation. Qt WebUI currently exposes process state (`ready`, `running`, `error`) plus unread and pending-dialog counts, but has no durable per-tab completion state. Matching the behavior therefore crosses the backend tab-summary contract, QML session and tab components, tests, accessibility text, and user documentation. It has two meaningful implementation slices and qualifies as complex.

## Success criteria

1. Every open tab summary includes exactly one activity state: `blocked`, `working`, `done`, or `idle`.
2. Priority matches Pi WebUI: an active tab with pending extension input is `blocked`; any other active tab is `working`; a background run that completed and has not been selected is `done`; all other open tabs are `idle`.
3. Selecting a `done` tab acknowledges its completed output and changes it to `idle`. Starting another run clears stale completion state before reporting `working`.
4. Session rows and tab controls use the same state, lowercase labels, semantic theme colors, tooltips, and accessible descriptions. Existing process startup and error evidence remains available as an orthogonal condition rather than inventing a fifth activity state.
5. Saved sessions without an open tab retain their existing `saved` treatment. Settled-session behavior is unchanged.
6. Focused backend and QML contract tests cover state priority and lifecycle transitions. The full package gate, QML lint, package dry run, and diff checks pass without overwriting unrelated staged or unstaged work.

## Scope

- Add a bounded backend activity-state projection to open tab summaries.
- Track unacknowledged background completion per tab.
- Refresh summaries when extension input appears or clears.
- Render the shared state in `SessionList.qml` and `TabStrip.qml` using existing theme tokens.
- Update user and contributor documentation and focused tests.

## Non-goals

- Copy Pi WebUI's browser notification settings, tab grouping, mobile activity view, or polling implementation.
- Add a separate failed activity state. Qt WebUI keeps its existing `statusKind: "error"` process/error signal.
- Change saved-session settlement, unread-count semantics, transcript following, session synchronization, or Pi RPC.
- Modify the active shared tool/skill-state feature, its storage contract, or its tests beyond preserving the current tree.
- Publish, install, or deploy the package.

## Approved decisions and invariants

- **Canonical activity vocabulary:** `blocked`, `working`, `done`, and `idle` only.
- **Priority:** `blocked` overrides `working`; `working` overrides `done`; otherwise `idle`.
- **Completion acknowledgment:** only a run completed in a background tab becomes `done`. Selecting that tab acknowledges the completion. A run completed in the selected tab returns to `idle`, matching Pi WebUI's seen-output behavior without adding a new acknowledgement protocol.
- **Error separation:** `statusKind` and `statusText` continue to represent process readiness and failures. Activity state does not erase error evidence.
- **Single source of truth:** the backend computes `activityState`; QML consumes it rather than independently inferring state from `active`, `needsInput`, and `unread`.
- **Visual contract:** use existing `warning`, `runningForeground`, `readyForeground`, `muted`, and destructive tokens. Add no literal colors or new palette roles.
- **Dirty-tree safety:** workers run sequentially in the shared tree. They preserve all pre-existing changes and never stage, reset, clean, commit, or edit another plan.

## Rejected and deferred options

- **Infer `done` from unread count in QML:** rejected because unread can come from message fragments or external session synchronization and is not proof that a run completed.
- **Store activity state in user settings:** rejected because it is ephemeral process state and should not survive a backend restart.
- **Add a completion-acknowledgement request:** deferred because selected-vs-background completion gives the required desktop behavior without expanding the request protocol.
- **Replace existing runtime error status:** rejected because losing process failure information would be a regression.

## Execution DAG

```text
W1 backend activity contract + focused lifecycle tests
                         |
                         v
W2 QML presentation + accessibility + docs + contract tests
                         |
                         v
Parent integration and package validation
                         |
                         v
R1 correctness/reliability review + R2 UI/accessibility review
                         |
                         v
Accepted fixes, revalidation, HTML report, plan archive
```

## Workstreams and ownership

### W1 — Backend activity lifecycle

**Prerequisite:** this plan is approved and no other live writer owns the paths below.  
**Write boundary:**

- `pi-package-qt-webui/lib/backend/tabs.mjs`
- `pi-package-qt-webui/tests/tab-activity-state.test.mjs` (new)
- `pi-package-qt-webui/plans/handoffs/qt-tab-status-backend.md` (new)

**Deliverables:** one backend-owned `activityState` projection; background-completion acknowledgement; extension-request refresh behavior; isolated lifecycle tests with exact transitions.  
**Validation:** `node --test tests/tab-activity-state.test.mjs`, syntax check, and scoped diff check.  
**Stop rules:** stop for any Pi RPC, persisted-state, unread-count, session-sync, or public request-protocol change not stated above.

### W2 — QML status presentation and documentation

Starts only after W1 is integrated and after the active shared tool/skill-state owner releases overlapping documentation paths.

**Write boundary:**

- `pi-package-qt-webui/qml/components/SessionList.qml`
- `pi-package-qt-webui/qml/components/TabStrip.qml`
- `pi-package-qt-webui/tests/qml-contract.test.mjs`
- `pi-package-qt-webui/README.md`
- `pi-package-qt-webui/TECHNICAL.md`
- `pi-package-qt-webui/DEVELOPMENT.md`
- `pi-package-qt-webui/plans/handoffs/qt-tab-status-qml-docs.md` (new)

**Deliverables:** identical activity-state labels in both navigation components; semantic state colors; accessible names/tooltips; user and contributor documentation; focused static contracts.  
**Validation:** `node --test tests/qml-contract.test.mjs`, `qmllint` for the two components, documentation contracts, and scoped diff checks.  
**Stop rules:** stop for new palette tokens, geometry changes, session-list regrouping, backend-contract changes, or edits outside the boundary.

## Acceptance checks

- `node --test tests/tab-activity-state.test.mjs`
- `node --test tests/qml-contract.test.mjs`
- `node --test tests/docs-contract.test.mjs`
- `qmllint qml/components/SessionList.qml qml/components/TabStrip.qml`
- `npm run check`
- `npm pack --dry-run --json`
- `git diff --check -- pi-package-qt-webui`
- Inspect staged and unstaged diffs for every owned file before and after integration.
- Validate the final report with the HTML report skill's strict validator.

## Integration and rollback

The parent integration owner inspects each worker's actual file changes, boundary, commands, omissions, assumptions, and handoff before starting the next worker. W2 consumes only the `activityState` field delivered by W1. Cross-workstream validation runs after both slices land.

Rollback is code-only: remove the ephemeral completion flag and `activityState` summary field, restore the prior QML status helpers and color expressions, remove focused tests, and restore the affected documentation paragraphs. No persisted user data or migration rollback is involved.

## Risks

- Event ordering can briefly publish `idle` between Pi's terminal status event and `run.end`; focused tests must require the final `done` summary and reject stale completion after a new run.
- Pending extension requests can appear or clear without a process-state change; the registry must publish a fresh tab summary for both transitions.
- Existing process errors must remain visible even though activity vocabulary has only four states.
- The repository has extensive pre-existing staged and unstaged work. Overlapping documentation paths are temporarily blocked by the active shared tool/skill-state plan.
- Static QML contracts do not replace live visual inspection; existing smoke coverage remains the cross-check.

## Decision and progress record

- 2026-08-27: traced Pi WebUI's `tabIndicator` priority and completion-serial acknowledgement behavior.
- 2026-08-27: confirmed Qt WebUI currently projects `statusKind`, `active`, `unread`, and `needsInput`, but not completion acknowledgement.
- 2026-08-27: reclassified the preliminary lightweight result as complex because the feature crosses the backend tab contract and two QML navigation components.
- 2026-08-27: selected backend-owned activity state and background-only `done` acknowledgement as the smallest faithful desktop implementation.
- 2026-08-27: reserved sequential workers because the shared repository is dirty; W2 remains blocked until the overlapping active plan releases documentation ownership.

## Review record

Pending two fresh-context, read-only reviewers from provider families distinct from each other and the primary implementation provider. Each finding will record the run/model, affected file or symbol, requirement or failure mode, evidence, severity, and one disposition: `accepted`, `rejected`, `deferred`, or `needs verification`.
