# W1 handoff: Qt tab activity backend

## Run and status

- **Run:** W1 backend activity lifecycle (`18554e0a-6ff8-420e-a71b-722713c39bba`)
- **Status:** Implementation and required W1 validation complete; awaiting integration-owner inspection and approval.
- **Base revision:** `59ec96a8e253c12f326eb8b75118846a8bf63519`
- **Result revision:** Uncommitted working-tree changes on `59ec96a8e253c12f326eb8b75118846a8bf63519`; no commit or index operation was performed.

## Changed files

- `lib/backend/tabs.mjs`
  - Adds backend-owned `activityState` to each open-tab summary.
  - Tracks ephemeral, unacknowledged background completion per tab.
  - Clears completion on `run.start` and tab selection.
  - Refreshes tab summaries for extension request, answer, and cancellation events in selected and background tabs.
- `tests/tab-activity-state.test.mjs` (new)
  - Covers initial `idle`, active `working`, blocked priority, answer/cancel clearing, background `done`, selection acknowledgement, selected-tab completion, stale completion clearing, and preservation of `statusKind`/`statusText` error evidence.
- `plans/handoffs/qt-tab-status-backend.md` (new)
  - Records this integration handoff.

No files outside the approved W1 boundary were edited.

## Lifecycle contract delivered

The summary projection has exactly four values and this priority:

1. Active with one or more pending extension dialogs: `blocked`.
2. Any other active tab: `working`.
3. Inactive with an unacknowledged run completed while the tab was in the background: `done`.
4. Otherwise: `idle`.

Only background completion sets `done`. Selecting the tab acknowledges it, and a subsequent `run.start` clears stale completion. Existing `statusKind` and `statusText` remain independent and unchanged.

## Validation and exit codes

- `node --test pi-package-qt-webui/tests/tab-activity-state.test.mjs` — exit `0`; 8 tests passed, 0 failed.
- `node --check pi-package-qt-webui/lib/backend/tabs.mjs` — exit `0`.
- `git diff --check -- pi-package-qt-webui/lib/backend/tabs.mjs pi-package-qt-webui/tests/tab-activity-state.test.mjs pi-package-qt-webui/plans/handoffs/qt-tab-status-backend.md` — exit `0`.
- `node --test pi-package-qt-webui/tests/backend-tabs.test.mjs` — exit `1`; 14 tests passed and 2 unrelated resource-profile tests failed in pre-existing shared tool/skill-state work:
  - `broader resource profiles reconcile every idle matching tab before commit and the next turn sees them` failed at its first `tools_set` assertion (`false !== true`).
  - `broader profile transactions fence compaction and session lifecycle through commit and rollback` failed with `Cannot read properties of undefined (reading 'models')`.
  - Both failures occur in resource-profile setup/transactions and do not exercise the additive activity field or completion lifecycle.

The required W1 commands are rerun after this handoff is written so the final scoped diff check includes this file.

## Dirty-tree and index safety

The repository was intentionally dirty before W1. In particular, `lib/backend/tabs.mjs` already had a staged change (227 insertions, 17 deletions) before this work. W1 added only unstaged changes on top of that staged version and did not stage, reset, clean, or commit anything.

The baseline staged diff fingerprint was SHA-256 `7503b82b2a708c75b5606d3299edbe4b13838106b80aab0420f0dcd9d73c4fab` across 87 staged paths. Integration should confirm that fingerprint and count remain unchanged.

## Omissions

- No Pi RPC, persistence, unread semantics, session-sync, QML, UI, accessibility, palette, or user-documentation changes were made.
- No fifth activity state was introduced.
- Full package, QML, documentation, and packaging gates were not run; they belong to parent integration/W2 according to the canonical plan.
- No live Qt visual verification was attempted because this slice is backend-only.

## Assumptions and deviations

- Assumed the existing session event contract remains authoritative: `pi-session.mjs` updates its snapshot before emitting `run.start`, `run.end`, and extension dialog lifecycle events.
- Completion is intentionally ephemeral and registry-local; restored tabs begin `idle`.
- The focused tests use an isolated registry/session harness rather than changing the Pi RPC fixture.
- No deviations from the approved W1 direction or write boundary were made.

## Unresolved decisions

None. W2 can consume the additive `activityState` field without independently deriving activity from `active`, `needsInput`, or `unread`.

## Risks

- The two broader backend test failures prevent claiming a green package-wide backend suite, although their failing resource-profile paths are unrelated to W1 and are already under separate staged work.
- The lifecycle relies on the existing ordering in which session snapshot state is updated before registry event delivery. Focused tests model that contract directly.
- UI parity, accessibility presentation, and live visual behavior remain for W2 and parent integration.

## Integration notes

- Inspect the unstaged delta to `lib/backend/tabs.mjs` separately from its large pre-existing staged delta.
- Keep `activityState` as the QML single source of truth; retain `statusKind`/`statusText` as orthogonal readiness/error evidence.
- Do not infer `done` from `unread`; unread behavior was intentionally left unchanged.
- Run W2 and final package gates only after accepting this backend contract.
