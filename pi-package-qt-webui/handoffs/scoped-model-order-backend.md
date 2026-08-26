# Scoped model ordering backend handoff

## Run identity and status

- Workstream: `scoped-model-ordering / backend-settings`
- Run: implementation worker 1, sole writer
- Status: implementation and required focused validation complete; independent review pending
- Timestamp: 2026-08-26T20:32:16+02:00

## Revisions

- Base revision: `dfaacf5b067a786b4540e830ecbcb983ead01a46`
- Resulting revision: unchanged (`dfaacf5b067a786b4540e830ecbcb983ead01a46`); this handoff describes uncommitted working-tree changes
- The tree was intentionally dirty before this run. Existing visual-compliance changes in the permitted files were preserved.

## Changed files

- `lib/backend/protocol.mjs`
  - Added default-empty `modelOrder` schema entry.
  - Added shared validation for at most `LIMITS.maxModels` exact `provider/model-id` strings, using `maxProviderCharacters` and `maxModelIdCharacters`.
  - Preserved first occurrence while deduplicating and rejected malformed protocol writes.
- `lib/backend/settings.mjs`
  - Reused the protocol validator for persisted values.
  - Invalid persisted `modelOrder` values fall back to the empty default through the existing `problems` reporting path.
  - Array defaults are copied per settings result; existing owner-only directory/file permissions and atomic rename persistence are unchanged.
- `tests/backend-units.test.mjs`
  - Added focused default, valid round-trip, duplicate, malformed-shape, item-count, provider-length, model-id-length, persisted-value, permissions, and scalar-preservation coverage.
- `tests/backend-session.test.mjs`
  - Added backend `settings_get` default/round-trip and `settings_set` deduplication/rejection coverage.
- `handoffs/scoped-model-order-backend.md`
  - Added this durable integration handoff.

No Pi RPC model membership or ordering code was changed.

## Commands and exit codes

All commands ran from `/home/firstpick/npm-packages/pi-package-qt-webui`.

| Command | Exit | Result |
|---|---:|---|
| `git status --short && printf '\nHEAD ' && git rev-parse HEAD` | 0 | Recorded the intentionally dirty baseline and base revision. |
| `git diff -- lib/backend/protocol.mjs lib/backend/settings.mjs tests/backend-units.test.mjs tests/backend-session.test.mjs` | 0 | Inspected pre-existing changes in the permitted files. |
| `node --check lib/backend/protocol.mjs` | 0 | Syntax check passed. |
| `node --check lib/backend/settings.mjs` | 0 | Syntax check passed. |
| `node --test tests/backend-units.test.mjs tests/backend-session.test.mjs` | 0 | 51 tests passed; 0 failed, skipped, cancelled, or todo. |
| `git diff --check -- lib/backend/protocol.mjs lib/backend/settings.mjs tests/backend-units.test.mjs tests/backend-session.test.mjs` | 0 | No whitespace errors. |
| `git diff --stat -- lib/backend/protocol.mjs lib/backend/settings.mjs tests/backend-units.test.mjs tests/backend-session.test.mjs && git diff -- lib/backend/protocol.mjs lib/backend/settings.mjs tests/backend-units.test.mjs tests/backend-session.test.mjs` | 0 | Inspected final scoped source/test diff; HEAD-relative stat was 139 insertions and 9 deletions, including preserved pre-existing visual-compliance hunks. |
| `git diff --cached --name-only && printf '\nWorktree status for boundary:\n' && git status --short -- lib/backend/protocol.mjs lib/backend/settings.mjs tests/backend-units.test.mjs tests/backend-session.test.mjs handoffs/scoped-model-order-backend.md` | 0 | Confirmed no staged files; four permitted files were modified before handoff creation. |
| `printf 'Run timestamp: ' && date -Iseconds && printf 'Revision: ' && git rev-parse HEAD && printf 'Scoped unstaged summary:\n' && git diff --numstat -- lib/backend/protocol.mjs lib/backend/settings.mjs tests/backend-units.test.mjs tests/backend-session.test.mjs && printf 'Staged files:\n' && git diff --cached --name-only` | 0 | Confirmed timestamp, unchanged revision, scoped unstaged counts, and no staged files. |
| `git diff --cached --name-only && git status --short -- lib/backend/protocol.mjs lib/backend/settings.mjs tests/backend-units.test.mjs tests/backend-session.test.mjs handoffs/scoped-model-order-backend.md && git diff --check -- lib/backend/protocol.mjs lib/backend/settings.mjs tests/backend-units.test.mjs tests/backend-session.test.mjs` | 0 | Final check confirmed no staged files, exactly the five allowed workstream paths changed, and no source/test whitespace errors. |

Non-command file reads, searches, and exact edits were also limited to the approved plan and write boundary.

## Omitted checks

- Full `npm run check`, QML tests/lint, package dry run, documentation checks, and report validation were not run because this backend workstream requires only the two backend syntax checks and focused backend test command. The integration owner owns the broader gates.
- No live QML interaction was attempted.

## Deviations and assumptions

- Deviations: none.
- The first `/` separates provider from model id. Additional `/` characters remain part of the model id, supporting identities such as `openrouter/anthropic/claude-sonnet`.
- Deduplication is exact and stable: the first occurrence wins.
- The raw list is bounded to `LIMITS.maxModels` before deduplication, so oversized writes or persisted arrays are rejected/ignored even if duplicates could reduce the unique count.

## Unresolved decisions and residual risks

- No backend product or architecture decisions remain unresolved.
- Independent review and QML integration are still pending.
- The QML worker must preserve unknown or unavailable saved identities when merging reordered scoped models; this backend intentionally validates and stores identities without consulting Pi membership.

## Integration notes

- Settings shape: `modelOrder: string[]`.
- Default from `settings_get` and hello settings: `[]`.
- `settings_set` accepts valid identities, returns the stable deduplicated list, persists it atomically, and emits the existing `settings.changed` event.
- Malformed protocol values return `invalid_request` or `limit_exceeded` according to the failure. Malformed persisted values produce a settings warning through the existing `problems` path and use `[]` for `modelOrder` while retaining independently valid scalar settings.
- Maximum identity components are `LIMITS.maxProviderCharacters` and `LIMITS.maxModelIdCharacters`; maximum raw entries are `LIMITS.maxModels`.
