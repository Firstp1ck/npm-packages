# WS-B handoff — WebUI optional-feature migration frontend

## Identity and status

- Workstream: **WS-B — browser migration workflow, feedback surfaces, and documentation**
- Run role: sole WS-B implementation worker
- Status: **implementation complete; ready for integration-owner review**
- Base Git revision: `9c3cf721385c8548f02b097c10b6f383f8112578`
- WS-A prerequisite: backend handoff re-read, mandatory backend checks passed, and parent integration owner confirmed WS-A accepted/integrated.
- No commit was created.

## Changed files

- `pi-package-webui/public/app.js`
  - consumes the cached revisioned audit snapshot and SSE migration/restart events;
  - adds checking/ready/action-required/migrating/partial/complete/degraded state rendering, elapsed time, phase/package activity entries, and reconnect recovery;
  - adds the single combined migration confirmation with server defaults, optional Choose/details, and browser-local disabled-feature protection;
  - persists Later through the dismiss route, supports Recheck, sends the required batch revision and `migration: true`, and silently retries unchanged stale plans;
  - preserves per-feature terminal states, bounded localhost output tails, Retry failed, Copy commands, auto-restart notices, and deferred Restart tab;
  - keeps conflict copy path-free and exposes a recommended-fix copy action without inventing a backend mutation route.
- `pi-package-webui/public/index.html`
  - adds the persistent polite status mount and accessible combined migration dialog.
- `pi-package-webui/public/styles.css`
  - adds responsive status/dialog/progress/restart styling and visible completion focus treatment.
- `pi-package-webui/tests/optional-feature-migration-frontend.test.mjs` (new)
  - static contract coverage for cached-state-only behavior, surfaces/actions, revision/stale handling, accessibility, restart recovery, SSE reconnect, bounded output, responsive CSS, and README requirements.
- `pi-package-webui/README.md`
  - documents the read-only startup audit, migration interaction, persisted Later, progress/recovery, conflict/degraded troubleshooting, unattended flags, revisioned routes, and restart behavior.
- `plans/handoffs/webui-optional-feature-migration-frontend.md`
  - this handoff, replacing the earlier policy-blocked placeholder.
- `.pi-subagents/artifacts/progress/d76b5527-dc81-44cf-a413-84c1d648bb64/progress.md`
  - workstream progress record.

## Delivered behavior

- **Fresh/canonical:** persistent checking status includes elapsed time after one second; successful audit reports a truthful Core-ready count without a blocking prompt.
- **Migration:** action-required banner offers Migrate… and persisted Later. Migrate opens one combined confirmation; previously enabled/server-selected features are checked, previously disabled or browser-local-disabled features remain unchecked/disabled, and Choose/details is optional.
- **Revision safety:** every batch sends `tab`, selected IDs, cached `revision`, and migration intent. A stale `409` refetches cached GET state; unchanged candidate signatures retry silently, while materially changed candidates reopen the same combined confirmation.
- **Feedback/recovery:** server-owned progress renders `Installing N of M: <name>` plus elapsed time, never a fabricated percentage. Phase changes, package starts, and terminal results enter Activity. SSE and EventSource reconnect refresh the cached snapshot.
- **Partial failure:** successful rows remain terminal-successful; failed rows retain category/hint/command/bounded localhost output, with Retry failed and Copy commands actions.
- **Restart:** full-success idle restart is announced and dismissible. Busy-tab restart is deferred and exposes Restart tab without interrupting work.
- **Conflict/degraded:** conflicts identify `Pi package + top-level resource`, state that the top-level copy was safely excluded, and expose Copy recommended fix plus Recheck. Degraded startup remains core-safe and exposes Recheck.
- **Accessibility:** progress/status uses polite status semantics; conflict and terminal failure add alert semantics; actions are native keyboard controls; focus moves only to a new completion/partial summary.

## Commands and exit codes

All commands ran from `/home/firstpick/npm-packages/pi-package-webui` unless noted.

| Command | Exit | Result |
|---|---:|---|
| `node --check bin/pi-webui.mjs` | 0 | Mandatory WS-A preflight passed. |
| `node --check lib/optional-feature-migration.mjs` | 0 | Mandatory WS-A preflight passed. |
| `node tests/optional-feature-migration.test.mjs` | 0 | WS-A focused tests passed. |
| `node --check public/app.js` | 0 | Frontend syntax passed after final edits. |
| `node tests/mobile-static.test.mjs` | 0 | Existing mobile/static contract passed. |
| `node tests/optional-feature-migration-frontend.test.mjs` | 0 | New frontend migration static test passed. |
| `for test_file in tests/optional-feature-migration*.test.mjs; do node "$test_file"; done` | 0 | Frontend and backend migration tests passed. |
| `node tests/http-endpoints-harness.test.mjs` | 0 | HTTP harness passed. |
| `npm run check` | 0 | Final run: all 109 test files passed. |
| `cd /home/firstpick/npm-packages && git diff --check` | 0 | No whitespace errors. |
| `cd /home/firstpick/npm-packages && git diff --cached --name-only` | 0 | Empty; no staged files. |

No required validation was omitted. Tests use existing hermetic/temporary-root fixtures; the new test is read-only static analysis and never accesses real `~/.pi/agent` state.

## Deviations, assumptions, unresolved decisions, and residual risks

1. **Conflict resolution backend gap:** WS-A exposes conflict detection, safe RPC exclusion, source kinds, recheck, and install blocking, but no endpoint that removes/disables the duplicate top-level alias. WS-B therefore cannot implement D16's mutating one-click resolution without violating the no-new-endpoint/no-backend-edit boundary. It provides one recommended **Copy recommended fix** action plus **Recheck**, names no raw path, and documents the manual repair. Integration owner should disposition whether this is acceptable or requires a later approved backend contract.
2. **Shared progress privacy:** cached/SSE snapshots intentionally omit raw installer output (D13). Live shared progress shows package/count/elapsed/results; bounded output tails appear from the localhost batch response after settlement and remain in failed rows/activity. A browser that only reconnects remotely recovers sanitized results, not raw output.
3. **Inherited detached-supervisor edge:** WS-A's handoff notes that already-running detached tabs from a prior server are not forcibly reconciled. WS-B reflects server restart disposition and does not invent an interrupting browser workaround.
4. **No live visual browser fixture:** focused static frontend coverage, the HTTP harness, and the full 109-file check passed. A reviewer should still manually inspect the fixed global banner/dialog at narrow and desktop widths if visual polish is a release gate.
5. Requested root `context.md` and `plan.md` inputs remained absent; the canonical planned feature document and accepted WS-A handoff were used.

## Integration notes

- Review the conflict-resolution gap before claiming D16 fully closed.
- Preserve the `revision` field and candidate-signature stale handling if the UI is refactored.
- Do not replace cached GET/SSE recovery with browser-side host scanning.
- The new global status mount intentionally remains visible for checking, readiness, required action, terminal outcome, and restart notice; it has no fresh-install action.
- Re-run the listed focused commands and `npm run check` after any reviewer fix.
