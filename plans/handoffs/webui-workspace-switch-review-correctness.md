# Review — webui-workspace-switch (correctness / contract / race angle)

## Run identity

- **Review worker:** child review subagent (correctness angle) of parent Pi session `019faf8a-be9e-774c-9df5-d2a00edb9586` (resolved via `subagent-chat-019faf8a`).
- **Model/provider:** not exposed to this subagent's context; only the run identity above can be attested. Integration owner should record the actual model/provider from runtime metadata.
- **Base reviewed:** uncommitted working-tree diff on top of `1b9a31f4e5e2fca243198c646fbd43b912436ea7` (per worker handoffs; diff inspected directly, handoffs not used as proof).
- **Confidence:** 85/100. Static code and test evidence is strong; no live browser/manual UI verification was possible, which caps confidence on focus/dialog behavior.

## Verdict

**PASS — no blocker.** All success criteria are met except one partial deviation (picker delete state, finding F1, medium). The full package suite passes (80/80 test files).

## Review

### Correct (evidence-backed)

1. **Validate-before-close ordering is correct** — `pi-package-webui/bin/pi-webui.mjs:9883-9910` (`loadWebuiWorkspace`): target lookup (404) → replacement-intent validation (400) → optional save of current workspace (409 on name conflict) → `openTabsUnchanged` re-check (409) → `closeTabs(openTabIds, { allowEmpty: true })` → warning-tolerant restore. Matches plan invariants "Target lookup and optional current save happen before `closeTabs`" and "actual restore begins only after the current tab set has been closed".
2. **Intent contract is enforced exactly once** — `workspaceReplacementIntent` (`pi-webui.mjs:9837-9854`) rejects missing `replaceOpenTabs`, rejects `hasDiscard === hasSave` (both/neither), and rejects `discardCurrent !== true`. Verified by harness: `loadWithoutDecision` → 400, `ambiguousLoad` → 400, both leaving the original tab set intact (`tests/webui-workspaces-harness.test.mjs:113-122`).
3. **Save-and-load persists before replacement** — harness asserts `closedIds` equals the original tab set, `savedCurrent.workspace.name`, and reads the on-disk workspaces file to confirm groups/activeTabId persisted (`tests/webui-workspaces-harness.test.mjs:135-154`).
4. **Discard-and-load replaces only after explicit decision** — harness asserts `closedIds`, absence of `savedCurrent`, and that a tab created after the save is removed by the discard load (`tests/webui-workspaces-harness.test.mjs:156-170`).
5. **Zero-tab compatibility retained** — empty-body load with no tabs returns 200 with `closedIds: []` and the original restore fields (`tests/webui-workspaces-harness.test.mjs:172-178`); client sends no body when `tabs.length === 0` (`app.js` `chooseWorkspaceReplacement` returns `{}` → `Object.keys(decision).length` gate).
6. **Concurrency guard** — `workspaceLoadInProgress` set before any async work and released in `finally` (`pi-webui.mjs:9882-9947`); concurrent loads get 409.
7. **Client 409 handling is not over-broad** — the overwrite retry is gated on `error.statusCode === 409` *and* `/workspace with that name already exists/i` (`app.js:2785`), so the new 409s ("open tabs changed", "load already in progress") are not misread as name conflicts. `error.statusCode` is reliably set by `api()` (`app.js:4636`).
8. **Client state reconciliation is sound** — `retireClosedWorkspaceTabContexts` prunes closed tabs and clears `activeTabId` if closed; `savedCurrent.workspaces` refreshes the saved list; `refreshTabs()` still runs before `installLoadedWorkspaceGroups` / `hydrateLoadedWorkspaceActiveTab` (pre-existing ordering assertion at `tests/workspace-save-load-static.test.mjs:32` still passes).
9. **Cancel/close paths are non-destructive** — dialog `cancel`/`close` events resolve `null` and `loadWebuiWorkspace` returns before any fetch (`app.js:34720-34743`); overwrite-confirm decline returns without retry.
10. **Disclosure requirement met** — `index.html` `workspaceReplaceDialogDescription` states current Pi processes will be terminated; per-tab rows show title, active marker, `tabIndicator` activity state, and cwd (`app.js:2692-2703`).
11. **Pre-existing user edits preserved** — the zero-tab dropdown rule `.terminal-tabs > .terminal-new-tab-menu:only-child .composer-publish-menu-panel` is present in `styles.css` and untouched in shape, and the matching pre-existing assertion in `tests/mobile-static.test.mjs:554` is intact. Both were outside worker ownership and survive.
12. **All validation commands pass** (see Validation below).

### Findings

**F1 — Medium — picker is missing the required delete state.**
- Location: `pi-package-webui/public/app.js:2628-2675` (`renderWorkspaceLoadDialog`); `pi-package-webui/tests/workspace-save-load-static.test.mjs:53`.
- Violated requirement: plan success criterion 2 — "an accessible saved-workspace picker with loading, empty, error/retry, load, **and delete** states".
- Evidence: the picker row renders only `copy` + `load` (`row.append(copy, load)`); no delete control exists in the dialog. Delete is only available on the separate workspace dashboard (`app.js:15296`). The new static assertion was written as "loading, retry/error, empty, and load states" — it silently narrowed the criterion by dropping "delete".
- Failure mode: a user who opens the picker (empty-start card, dashboard action, or command palette) cannot remove a stale saved workspace without backing out to the dashboard.
- Smallest remediation: add a `Delete` button per picker row that calls the existing `deleteWebuiWorkspace(workspace)` then `refreshWorkspaceLoadDialog()`, plus a static assertion; or amend the plan's criterion with an explicit decision that dashboard-only delete is acceptable.

**F2 — Low — malformed JSON body on the load route returns 500, not 400.**
- Location: `pi-package-webui/bin/pi-webui.mjs:1099-1111` (`readJsonBody`) + route at `13485-13489`.
- Failure mode: `JSON.parse` `SyntaxError` has no `statusCode`, so the top-level catch (`14675`) maps it to `sendError(res, 500, ...)`. A garbage body on `POST /api/workspaces/:id/load` is a client error reported as a server fault. Pre-existing pattern shared by other JSON routes, but this route newly depends on body parsing for a destructive operation.
- Smallest remediation: catch `SyntaxError` in `readJsonBody` and rethrow `makeHttpError(400, "Invalid JSON body")`.

**F3 — Low — save persists when the tab set changes mid-transaction.**
- Location: `pi-package-webui/bin/pi-webui.mjs:9901-9907`.
- Failure mode: descriptors are derived and saved, then `openTabsUnchanged` fails (tab opened/closed during the save's awaits) → 409, but the saved workspace already exists. The user asked for save & load; they get save-only plus an error, with no explicit notice that the save succeeded (the `webui_workspace_saved` broadcast does update the list, but the error toast doesn't say "saved").
- Assessment: defensible (save was explicitly requested and is non-destructive; tabs stay open), but should be disclosed. 
- Smallest remediation: include a hint in the 409 message, e.g. "The current workspace was saved; open tabs changed before replacement".

**F4 — Low — contract regression: open-tab load without body now returns 400 (was 409).**
- Location: `pi-package-webui/bin/pi-webui.mjs:9839` vs prior `409 "A workspace can only be loaded when no tabs are open"`.
- Evidence: harness intentionally asserts 400 (`tests/webui-workspaces-harness.test.mjs:114`), and the plan sanctions "400/409" for invalid intent, so this is plan-compliant — but any external consumer keying on the old 409 would break. In-repo client is updated.
- Smallest remediation: none required; record as an intentional contract change in the final report.

**F5 — Low — client detects name conflicts by message regex because the server drops the error code.**
- Location: `pi-package-webui/bin/pi-webui.mjs:9876` (`makeHttpError(409, error.message)` loses `WORKSPACE_NAME_CONFLICT`); `app.js:2785` regex; `sendError` (`pi-webui.mjs:1080-1085`) emits no `code` field.
- Failure mode: if `lib/webui-workspaces.mjs:220` ever rewords "A workspace with that name already exists", the overwrite-confirm flow silently degrades to a raw error.
- Smallest remediation: have `sendError` include `error.code` in the payload and match on `error.data?.code === "WORKSPACE_NAME_CONFLICT"` client-side (keeping the regex as fallback).

**F6 — Note — unreachable defensive branch.**
- Location: `pi-package-webui/bin/pi-webui.mjs:9908-9909` (`else if (tabs.size)` after the zero-await snapshot). No `await` exists between `[...tabs.keys()]` and this check on the zero-tab path, so it cannot fire. Harmless defense-in-depth; no action needed.

**F7 — Note — save-and-load can permanently fail for tab sets exceeding restore limits.**
- Location: `saveCurrentWorkspaceForReplacement` (`pi-webui.mjs:9857-9873`) requires `descriptors.length === tabIds.length`; `mergeRestorableTabDescriptors` slices at `RESTORE_TAB_LIMIT = 30` (`pi-webui.mjs:9763`). With >30 open tabs (or an unnormalizable tab) save-and-load always 400s; discard remains available. By design ("Every open tab must be saved"), disclosed here as a known limit.

**F8 — Note — test gap: concurrency and failure-injection paths untested.**
- The harness covers rejection/save/discard/conflict/zero-tab, but not: (a) the `workspaceLoadInProgress` 409 (concurrent load), (b) the `openTabsUnchanged` 409 (tab churn mid-transaction), (c) restore-partial-failure after closure. These are the plan's acknowledged residual failure modes; coverage would require harness tab-churn injection.

### Fixed

- None. Review was read-only per hard constraints; no files modified.

## Validation performed (this review)

| Command | Result |
| --- | --- |
| `node --check public/app.js && node --check bin/pi-webui.mjs` | passed |
| `node tests/workspace-save-load-static.test.mjs` | passed |
| `node tests/mobile-static.test.mjs` | passed |
| `node tests/webui-workspaces-harness.test.mjs` | passed |
| `node tests/webui-workspaces.test.mjs` | passed (expected stderr warning about a deliberately corrupt fixture) |
| `node tests/http-endpoints-harness.test.mjs` | passed |
| `npm test` (`tests/run-all.mjs`) | **all 80 test files passed** |

## Residual risks / missing validation

- **No browser-level verification**: focus return, `showModal` behavior, mobile layout, and the `window.confirm/prompt` fallback were verified statically only. The plan already discloses this gap.
- **Restore-after-close partial failure** remains possible (missing sessions/cwds tolerated as warnings; tab-creation failures). Plan requires this be disclosed in the final report — restated here. The client does surface warnings via toast/events.
- **Race window inside `closeTabs`**: a tab created by another client *during* closure survives and coexists with the restored workspace (not closed, not part of the target). Benign but worth noting.
- F3's save-without-load side effect and F5's message-regex coupling are the main maintainability debts.
- Model/provider identity for this review run is not visible inside the subagent context; the integration owner must source it from runtime metadata for the plan record.
