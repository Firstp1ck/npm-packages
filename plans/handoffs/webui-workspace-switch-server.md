# WS1 handoff — server workspace switch transaction

## Run

- **Workstream:** WS1 — server transaction
- **Run identity/status:** WS1 implementation worker; completed, uncommitted working-tree result
- **Base revision:** `1b9a31f4e5e2fca243198c646fbd43b912436ea7`
- **Result revision:** no commit created (working tree only)

## Changed files

- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/tests/webui-workspaces-harness.test.mjs`
- `plans/handoffs/webui-workspace-switch-server.md` (this handoff artifact)

Pre-existing, untouched unstaged files remain `pi-package-webui/public/styles.css` and `pi-package-webui/tests/mobile-static.test.mjs`. The canonical plan was not edited.

## Server contract implemented

`POST /api/workspaces/:id/load` now:

- continues to accept the existing empty request when no tabs are open;
- rejects an open-tab load unless its JSON body contains `replaceOpenTabs: true` and exactly one decision:
  - `{ replaceOpenTabs: true, discardCurrent: true }`, or
  - `{ replaceOpenTabs: true, saveCurrent: { name, groups, activeTabId, overwrite? } }`;
- resolves the target workspace before replacement work, derives save descriptors from live server tab state, persists an optional current workspace (including duplicate-name conflict handling), and only then closes tabs;
- checks that the original open-tab set is unchanged immediately before closing, avoiding closure of a tab introduced during the save phase;
- retains the existing warning-tolerant restore loop;
- returns existing restore fields plus `closedIds` (always present) and, for a save decision, `savedCurrent` containing the standard `{ workspace, workspaces, evicted }` save result.

Open-tab malformed/ambiguous requests return `400`; duplicate current-workspace names return `409` before any tab closes. A target that does not exist still returns `404` before any replacement work.

## Validation

| Command | Exit | Output |
| --- | ---: | --- |
| `node --check bin/pi-webui.mjs && node --check tests/webui-workspaces-harness.test.mjs` (initially run from repository root) | 1 | Incorrect relative path: `bin/pi-webui.mjs` was not found. |
| `node tests/webui-workspaces-harness.test.mjs` (initially run from repository root) | 1 | Incorrect relative path: harness was not found. |
| `cd pi-package-webui && node --check bin/pi-webui.mjs && node --check tests/webui-workspaces-harness.test.mjs` | 0 | No output. |
| `cd pi-package-webui && node tests/webui-workspaces-harness.test.mjs && node tests/workspace-save-load-static.test.mjs` | 0 | Both tests printed `passed`. |
| `git diff --check && git diff --cached --name-only && git status --short` | 0 | No whitespace errors; staged-file listing was empty. |

Focused harness coverage now proves:

1. an open-tab request with no replacement decision is rejected and leaves tab IDs intact;
2. an ambiguous save-plus-discard request is rejected and leaves tab IDs intact;
3. a duplicate `saveCurrent.name` returns `409` and leaves tab IDs intact;
4. save-and-load reports `closedIds`, persists groups and active tab to storage, returns `savedCurrent`, then restores the target;
5. discard-and-load reports every closed ID, does not report `savedCurrent`, and replaces an additional current-only tab with the target;
6. the existing zero-tab empty request restores successfully and returns `closedIds: []`.

## Omissions, deviations, and assumptions

- `context.md` and repository-root `plan.md` were requested but absent (`ENOENT`); the canonical feature plan and all specified source/test files were read.
- No storage schema/limit changes were made. Existing workspace-name normalization/defaulting remains the behavior for `saveCurrent.name`.
- Package-wide `npm test` and `npm run check` were not run by this workstream; the requested syntax checks and focused workspace/static tests were run.
- No unapproved API, storage, or security decision was needed.

## Residual risks

- Existing fail-soft restore can still partially restore after successful destructive closure; warnings remain returned as before.
- If tabs change after `saveCurrent` is persisted but before closure, the request returns `409` and leaves tabs intact, but the requested saved workspace remains persisted.
- Browser-level replacement UX, overwrite retry, and reconciliation of the new metadata remain WS2/integration responsibilities.

## WS2 integration notes

Replace the current client-side `tabs.length` rejection with an explicit decision UI. For open tabs, send one of the two bodies above. Do not send client tab descriptors; only UI-owned `groups`, `activeTabId`, name, and optional overwrite flag belong in `saveCurrent`.

On success, use `data.closedIds` to retire prior client tab contexts, use `data.savedCurrent.workspaces` to refresh the picker after save-and-load, then retain the existing `refreshTabs()` → group install → active-tab hydration restore sequence. Preserve empty-body POST behavior for zero tabs. Surface `400` as an explicit-decision error and retry `409` name conflicts only after an overwrite confirmation.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Only the approved server route and focused workspace harness changed; open-tab replacement now requires explicit replaceOpenTabs plus one save/discard decision, saves server-derived descriptors before closure, and preserves empty zero-tab loads."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused harness exercises rejected, ambiguous, duplicate-conflict, save-and-load, discard-and-load, and zero-tab paths; syntax, static contract, whitespace, and staged-file checks are recorded above."
    }
  ],
  "changedFiles": [
    "pi-package-webui/bin/pi-webui.mjs",
    "pi-package-webui/tests/webui-workspaces-harness.test.mjs",
    "plans/handoffs/webui-workspace-switch-server.md"
  ],
  "testsAddedOrUpdated": [
    "pi-package-webui/tests/webui-workspaces-harness.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "node --check bin/pi-webui.mjs && node --check tests/webui-workspaces-harness.test.mjs",
      "result": "failed",
      "summary": "Run from repository root; relative package paths were not found."
    },
    {
      "command": "node tests/webui-workspaces-harness.test.mjs",
      "result": "failed",
      "summary": "Run from repository root; relative package path was not found."
    },
    {
      "command": "cd pi-package-webui && node --check bin/pi-webui.mjs && node --check tests/webui-workspaces-harness.test.mjs",
      "result": "passed",
      "summary": "Both syntax checks exited 0."
    },
    {
      "command": "cd pi-package-webui && node tests/webui-workspaces-harness.test.mjs && node tests/workspace-save-load-static.test.mjs",
      "result": "passed",
      "summary": "Both focused tests printed passed."
    },
    {
      "command": "git diff --check && git diff --cached --name-only && git status --short",
      "result": "passed",
      "summary": "No whitespace errors and no staged files."
    }
  ],
  "validationOutput": [
    "webui-workspaces-harness.test.mjs passed",
    "workspace-save-load-static.test.mjs passed",
    "Corrected package-relative syntax checks exited 0."
  ],
  "residualRisks": [
    "Warning-tolerant restore can partially succeed after tabs are closed.",
    "A saveCurrent workspace persists if concurrent tab changes cause the pre-close consistency check to return 409.",
    "WS2 must consume the open-tab API contract and reconcile closedIds/savedCurrent."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds an explicit validated save/discard server transaction to workspace load and focused endpoint harness coverage.",
  "reviewFindings": [
    "no blockers found during worker self-inspection; independent review remains the integration owner's required gate"
  ],
  "manualNotes": "Pre-existing public/styles.css and tests/mobile-static.test.mjs modifications were preserved untouched."
}
```