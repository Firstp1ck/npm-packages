# W2 recovery handoff: Qt tab activity QML

## Workstream, run, and status

- **Workstream:** W2 QML activity-state presentation recovery
- **Failed workflow being recovered:** `18554e0a-6ff8-420e-a71b-722713c39bba`
- **Recovery run:** W2 slot; no prior W2 child existed
- **Status:** Activity-state QML and focused static contracts implemented. QML lint and scoped diff checks pass. The required QML contract suite is 24/25 because concurrent StatusOverlay work left one obsolete, unrelated shell assertion; the integration owner directed this recovery not to edit that conflicting assertion.
- **Base revision:** `c5532528eb99321edf20de2c26b29d20924da429`
- **Result revision:** Uncommitted working-tree changes on `c5532528eb99321edf20de2c26b29d20924da429`; no commit or index operation was performed.

## Changed files

- `qml/components/SessionList.qml`
  - Copies backend `activityState`, `statusText`, and `needsInput` into both catalog-backed open rows and temporary open-only rows.
  - Shows the backend-owned lowercase state while leaving closed saved and settled rows unchanged.
  - Maps `blocked`, `working`, `done`, and `idle` to `warning`, `runningForeground`, `readyForeground`, and `muted`; process errors retain destructive precedence.
  - Adds activity and orthogonal process-error/needs-input details to open-row accessibility and hover text.
- `qml/components/TabStrip.qml`
  - Shows the same backend-owned lowercase activity label in each tab control.
  - Applies the same semantic color mapping while preserving destructive process-error precedence.
  - Adds activity and orthogonal process-error/needs-input details to tab accessibility and tooltips.
- `tests/qml-contract.test.mjs`
  - Adds a focused static contract proving both components consume `activityState`, expose all four labels, do not derive activity from `active`, `unread`, or `needsInput`, use the approved semantic tokens, preserve rectangular session punctuation, and expose orthogonal conditions through accessibility and tooltips.
  - This file also contains concurrent StatusOverlay imports/contracts owned by another session. They were preserved and are not part of this W2 implementation.
- `plans/handoffs/qt-tab-status-qml.md` (new)
  - Records this recovery handoff.

No documentation, backend, canonical plan, shell, bridge, theme, smoke, package metadata, or other forbidden path was edited by this recovery.

## Commands and exit codes

- `node --test pi-package-qt-webui/tests/qml-contract.test.mjs` — exit `1`; 25 tests ran, 24 passed, 1 failed.
  - The new activity-state contract passed.
  - The unrelated failure is `shell composes one window from the shared bridge, theme, transcript, composer, search, and dialogs`: its obsolete `/Repeater\s*\{[\s\S]*model:\s*root\.statusGroups[\s\S]*StatusSegment/` assertion no longer matches the concurrently introduced StatusOverlay shell design.
- `qmllint pi-package-qt-webui/qml/components/SessionList.qml pi-package-qt-webui/qml/components/TabStrip.qml` — exit `0`; no output.
- `git diff --check -- pi-package-qt-webui/qml/components/SessionList.qml pi-package-qt-webui/qml/components/TabStrip.qml pi-package-qt-webui/tests/qml-contract.test.mjs pi-package-qt-webui/plans/handoffs/qt-tab-status-qml.md` — exit `0` before this handoff was written; rerun after writing it for final evidence.
- `git diff --cached --name-only` — exit `0`; no staged paths.

## Omissions

- README, TECHNICAL, and DEVELOPMENT changes were intentionally omitted because those files are owned by another live session and forbidden in this recovery slice.
- The concurrent obsolete StatusSegment assertion was not changed because the integration owner directed this recovery to preserve StatusOverlay work and stop editing the conflicting test file.
- No backend, API, theme-token, geometry, unread, saved-session, or settled-session behavior was changed.
- No live visual Qt check, full package gate, documentation contract, packaging check, or smoke test was run; they remain integration work.

## Assumptions and deviations

- Assumed W1's additive `activityState` field is authoritative and always uses `blocked`, `working`, `done`, or `idle`. QML only validates that vocabulary for display and falls back to `idle`; it never infers `done` from unread or other client state.
- `statusKind`/`statusText` and pending input remain orthogonal descriptive conditions. Error state keeps destructive visual precedence even when activity has one of the four canonical values.
- Closed saved-row `saved · path` presentation and settled-row presentation remain unchanged.
- Deviation from a fully green required test command: the suite has one unrelated concurrent StatusOverlay assertion failure. This ownership conflict was escalated; the integration owner directed W2 to preserve it and report it rather than edit further.

## Unresolved decisions

None within W2's approved behavior. The concurrent StatusOverlay owner/integration owner must reconcile the obsolete shell assertion before claiming a green full QML contract suite.

## Risks

- Static QML contracts and `qmllint` do not replace live visual/accessibility inspection; horizontal tabs now include a compact activity label and should be visually checked at narrow rail widths.
- The complete test file remains red until the unrelated StatusOverlay assertion is updated by its owner.
- The working tree is intentionally dirty and includes concurrent changes. Integration must isolate the activity contract from the preserved StatusOverlay test changes.

## Integration notes

- Preserve every concurrent StatusOverlay change in `tests/qml-contract.test.mjs`; the W2 addition is the test named `open session rows and tab controls present backend-owned activity states with orthogonal conditions`.
- Keep backend `activityState` as the only activity source. Do not restore UI inference from `active`, `needsInput`, or `unread`, and especially do not infer `done` from unread.
- Retain the color mapping: `blocked` → `warning`, `working` → `runningForeground`, `done` → `readyForeground`, `idle` → `muted`; `statusKind === "error"` → `destructive` takes visual precedence.
- After the StatusOverlay owner resolves its obsolete assertion, rerun the QML contract test, both `qmllint` targets, exact-boundary diff check, and final package gates.
