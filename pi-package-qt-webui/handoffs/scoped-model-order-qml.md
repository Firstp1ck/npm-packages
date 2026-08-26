# Scoped model ordering QML handoff

## Run identity and status

- Workstream: `scoped-model-ordering / qml-ordering`
- Run: implementation worker 2, sole active writer
- Status: implementation and required focused validation complete; independent review pending
- Timestamp: 2026-08-26T20:42:42+02:00 (final handoff checks followed this recorded implementation timestamp)

## Revisions

- Base revision: `dfaacf5b067a786b4540e830ecbcb983ead01a46`
- Resulting revision: unchanged (`dfaacf5b067a786b4540e830ecbcb983ead01a46`); this handoff describes uncommitted working-tree changes.
- The tree was intentionally dirty before this run. Existing visual-compliance changes in the owned files were preserved, and no unrelated file was edited.

## Changed files

- `qml/BackendBridge.qml`
  - Stores validated `settings.modelOrder` and uses the protocol's 256-model bound.
  - Ranks only explicit scoped-model results by exact `provider/id`; unranked models retain Pi's relative order.
  - Merges reordered current identities before saved absent identities, so absent identities are preserved when space remains and never crowd current identities out at the bound.
  - Saves through `settings_set` and reports save failures without undoing the picker's in-memory order.
- `qml/components/DropUpPicker.qml`
  - Adds opt-in reorder state, a visible accessible **≡** handle, targetless drag completion, and `Ctrl+Shift+Up` / `Ctrl+Shift+Down` parity.
  - Reassigns a copied item list, restores the highlighted/current identity, emits a reorder signal without picking or closing, and disables both reorder paths while filtering.
- `qml/shell.qml`
  - Enables ordering only for `scope.explicit === true` lists with at least two rendered entries.
  - Repeats active-tab, picker-generation, popup, and exact full-item-list guards before saving reordered identities.
  - Leaves model selection, thinking selection, stale-response invalidation, and focus return paths intact.
- `qml/SmokeDriver.qml`
  - Adds a focused ordering-only smoke route through the reusable picker key handler and shell persistence wiring.
  - Covers filter disablement, retained popup/current selection/focus, current-first bound behavior, preservation of an absent saved identity, persistence, and saved-order reapplication.
- `tests/qml-contract.test.mjs`
  - Adds static contracts for the explicit-scope gate, exact ranking, bounded merge order, save request, drag/key/filter behavior, non-selecting move, accessibility text, and guarded shell wiring.
- `tests/qml-smoke.test.mjs`
  - Adds the focused live Quickshell ordering route and persisted `modelOrder` assertion.
- `README.md`
  - Adds the user-visible reorder capability and first-use drag/keyboard guidance.
- `TECHNICAL.md`
  - Documents explicit-scope behavior, exact identity ordering, absent/new identity handling, filter and keyboard limits, the 256-entry bound, and storage.
- `DEVELOPMENT.md`
  - Documents the bridge/picker/shell contract, merge invariant, test coverage, and native pointer-input limitation.
- `handoffs/scoped-model-order-qml.md`
  - Adds this durable integration handoff.

## Commands and exit codes

All commands ran from `/home/firstpick/npm-packages/pi-package-qt-webui`.

| Command | Exit | Result |
|---|---:|---|
| `git status --short && git rev-parse HEAD` | 0 | Recorded the intentionally dirty baseline and base revision. |
| `git diff -- qml/BackendBridge.qml qml/components/DropUpPicker.qml qml/shell.qml qml/SmokeDriver.qml tests/qml-contract.test.mjs tests/qml-smoke.test.mjs README.md TECHNICAL.md DEVELOPMENT.md > /tmp/qml-order-owned-before.diff && wc -l /tmp/qml-order-owned-before.diff && git diff --numstat -- ...` | 0 | Preserved a pre-edit snapshot of all owned dirty hunks; 904 diff lines. |
| `node --test tests/qml-contract.test.mjs` (first run) | 0 | 19/19 tests passed after the initial implementation. |
| `command -v qmllint || true; command -v quickshell || true; printf ...` | 0 | Found `/usr/bin/qmllint`, `/usr/bin/quickshell`, and an available Wayland runtime. |
| `qmllint qml/*.qml qml/components/*.qml qml/dialogs/*.qml` (first run) | 0 | Clean, no output. |
| `node --test tests/qml-smoke.test.mjs` (first run) | 1 | All three tests failed before QML launch because two newly proposed test-only environment names were rejected by the existing launcher allowlist. No launcher edit was made; the harness was corrected to use an existing test seam. |
| `node --test tests/qml-contract.test.mjs` (second run) | 0 | 19/19 passed after adapting the smoke seam. |
| `qmllint qml/*.qml qml/components/*.qml qml/dialogs/*.qml` (second run) | 0 | Clean, no output. |
| `node --test tests/qml-smoke.test.mjs` (second run) | 1 | Normal/scaled routes failed before launch because the existing test seam rejects an empty value; the ordering route also checked the popup synchronously before shell presentation. Both harness issues were corrected. |
| `node --test tests/qml-smoke.test.mjs` (third run) | 0 | 3/3 live Quickshell tests passed, including the focused reorder route. |
| `node --test tests/qml-contract.test.mjs` (third run) | 0 | 19/19 passed after documentation and absent-identity smoke coverage. |
| `qmllint qml/*.qml qml/components/*.qml qml/dialogs/*.qml` (third run) | 0 | Clean, no output. |
| `git diff --check -- qml/BackendBridge.qml qml/components/DropUpPicker.qml qml/shell.qml qml/SmokeDriver.qml tests/qml-contract.test.mjs tests/qml-smoke.test.mjs README.md TECHNICAL.md DEVELOPMENT.md` (first run) | 0 | No whitespace errors in owned source, tests, or docs. |
| `node --test tests/docs-contract.test.mjs` | 0 | 4/4 documentation contract tests passed. |
| `node --test tests/qml-smoke.test.mjs` (fourth run) | 0 | 3/3 live tests passed after absent-identity persistence coverage. |
| `git diff --stat -- ... && git diff --numstat -- ... && git diff --cached --name-only && git rev-parse HEAD && date -Iseconds && git status --short -- ...` | 0 | Inspected the owned diff, unchanged revision, no staged files, and owned-path status. HEAD-relative stat included preserved visual-compliance hunks. |
| `git diff -- qml/BackendBridge.qml qml/components/DropUpPicker.qml qml/shell.qml qml/SmokeDriver.qml tests/qml-contract.test.mjs tests/qml-smoke.test.mjs \| sed -n '1,1200p'` | 0 | Inspected the complete source/test diff (full output was 1,179 lines). |
| `node --test tests/qml-contract.test.mjs` (final run) | 0 | 19/19 passed. |
| `qmllint qml/*.qml qml/components/*.qml qml/dialogs/*.qml` (final run) | 0 | Clean, no output. |
| `git diff --check -- qml/BackendBridge.qml qml/components/DropUpPicker.qml qml/shell.qml qml/SmokeDriver.qml tests/qml-contract.test.mjs tests/qml-smoke.test.mjs README.md TECHNICAL.md DEVELOPMENT.md` (final source/docs run) | 0 | No whitespace errors. |
| `node --test tests/qml-smoke.test.mjs` (final run) | 0 | 3/3 passed: full scenario, focused model-order persistence, and 200% scaling. |
| `git diff --check -- ... && awk ... handoffs/scoped-model-order-qml.md && git diff --cached --name-only && git status --short -- ... && git diff --stat -- ...` | 0 | Final acceptance check found no whitespace errors (including the untracked handoff), no staged files, and exactly the ten owned workstream paths modified/untracked. |

Non-command file reads, searches, and exact edits stayed within the approved plan, handoff, and write boundary.

## Omitted checks

- No native pointer-drag synthesis was attempted. The existing smoke harness does not expose reliable pointer injection, and coordinate-driven drag tests would be brittle. Live coverage invokes the real picker key handler and move function, traverses shell request wiring, observes the backend settings response, reads the persisted settings file, and exercises bridge reapplication. Drag arbitration is covered by QML lint and focused static contracts.
- The fixture's explicit-scope environment switch is not in the launcher's test-only allowlist, and both the fixture and launcher were outside this workstream's write boundary. Production explicit-scope gating is therefore covered by static shell contracts; the focused live route verifies that the ordinary unscoped result is not reorderable before enabling only the reusable picker test seam.
- Full `npm run check`, package dry run, backend suites, report validation, and plan/report edits belong to central integration and were not run in this QML workstream.

## Deviations and assumptions

- No product, architecture, interface, security, migration, dependency, or ownership deviation was made.
- The focused smoke route uses the existing test-only `QT_WEBUI_THEME_MODE` seam as an ordering-only scenario discriminator because adding a new allowlisted environment name would require an out-of-bound launcher edit. Production behavior never reads this value.
- Exact identity means the complete `provider/id` string; splitting is used only for model selection, not ordering comparisons.
- A completed move saves immediately. A failed save posts a notice while the reordered popup items remain usable until the picker closes.

## Unresolved decisions and residual risks

- Independent review is pending.
- Native pointer gesture arbitration is not live-tested; QML lint validates the handler shape, static tests require a targetless drag path ending in the non-selecting move function, and keyboard-equivalent live coverage passes.
- HEAD-relative diff counts include preserved visual-compliance changes that predated this workstream; integration should review only the scoped-model-ordering hunks against the saved baseline if attribution matters.

## Integration notes

- The backend contract consumed is exactly `settings.modelOrder: string[]`, default `[]`, deduplicated and bounded to `LIMITS.maxModels`.
- `BackendBridge.loadModels()` rewrites only successful explicit-scope response data before both `modelsLoaded` and the request callback see it. Unscoped available-catalogue results are returned unchanged.
- The save merge is current-scope-first, then saved absent identities. This ordering is what prevents stale identities from consuming the 256 slots needed by the just-reordered scope.
- `DropUpPicker.present()` resets `reorderable` for every use, so model ordering cannot leak into the thinking or more-options picker.
- The shell's reorder callback compares the emitted identities against the picker's complete post-move item list before saving and retains the existing tab/generation guards.
