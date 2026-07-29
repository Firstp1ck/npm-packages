# WS2 handoff — workspace picker and save/discard decision UI

## Run

- **Workstream:** WS2 — client picker and decision UI
- **Run identity/status:** WS2 implementation worker; completed, uncommitted working-tree result
- **Base revision:** `1b9a31f4e5e2fca243198c646fbd43b912436ea7`
- **Result revision:** no commit created (working tree only)

## Changed files

- `pi-package-webui/public/index.html`
- `pi-package-webui/public/app.js`
- `pi-package-webui/public/styles.css`
- `pi-package-webui/tests/workspace-save-load-static.test.mjs`
- `plans/handoffs/webui-workspace-switch-client.md` (this handoff artifact)

The pre-existing zero-tab dropdown rule in `public/styles.css` and the pre-existing `tests/mobile-static.test.mjs` edit were inspected and preserved. The canonical plan and server files were not edited by WS2.

## Delivered client behavior

- The empty-start card now has a labelled **Load workspace** action.
- A labelled saved-workspace modal picker is available from empty start, the open-tab dashboard, and the command palette. It renders loading, error/retry, empty, and saved-workspace load states.
- Selecting a workspace while tabs are open opens an accessible replacement dialog. It lists every current tab's title, cwd, activity state, and active-tab designation; warns that current Pi processes will be terminated; and provides **Cancel**, **Load without saving**, and **Save & load**.
- **Save & load** captures only client-owned metadata (`name`, `groups`, `activeTabId`) and sends it as WS1's `saveCurrent` body. It deliberately never sends tab descriptors.
- **Load without saving** sends WS1's explicit `{ replaceOpenTabs: true, discardCurrent: true }` body.
- An existing-name `409` is matched before retrying, prompts **Overwrite & load**, then retries with `saveCurrent.overwrite: true`; the original request has already been rejected by WS1 before any closure.
- The original zero-tab path keeps an empty POST body. On success, the client retires `closedIds` contexts, accepts optional `savedCurrent.workspaces`, refreshes tabs, then restores groups and the active tab in the existing order.
- New responsive dialog styles keep the current-tab disclosure bounded/scrollable and replacement controls touch-sized on narrow/coarse devices.

## WS1 contract used

`POST /api/workspaces/:id/load` is called unscoped with one of:

```js
// zero tabs
undefined // no request body

// discard current tabs
{ replaceOpenTabs: true, discardCurrent: true }

// save current tabs before replacement
{
  replaceOpenTabs: true,
  saveCurrent: { name, groups, activeTabId, overwrite?: true }
}
```

The client consumes `closedIds`, optional `savedCurrent.workspaces`, plus existing `tabs`, `groups`, `idMap`, `activeTabId`, and warning fields.

## Validation

| Command | Exit | Output |
| --- | ---: | --- |
| `cd pi-package-webui && node --check public/app.js && node --check bin/pi-webui.mjs` | 0 | No output. |
| `cd pi-package-webui && node tests/workspace-save-load-static.test.mjs && node tests/mobile-static.test.mjs` | 0 | `workspace-save-load-static.test.mjs passed`; `mobile static checks passed`. |
| `cd pi-package-webui && node tests/webui-workspaces-harness.test.mjs` | 0 | `webui-workspaces-harness.test.mjs passed`. |
| `git diff --check && git diff --cached --name-only && git status --short` | 0 | No whitespace errors; staged-file listing was empty. |

The updated static test verifies the empty-start action; dialog labels/controls; picker states; current-tab activity/cwd disclosure; explicit discard/save request shapes; duplicate overwrite retry; and response reconciliation. The mobile static test confirms the pre-existing zero-tab dropdown assertion remains valid. The WS1 harness still passes against the integrated server transaction.

## Findings and disposition

- **No blocker — `pi-package-webui/public/app.js`, `public/index.html`, `public/styles.css`:** self-inspection found the client request shapes match WS1's handoff contract and all destructive load actions route through an explicit decision.
- **No blocker — `pi-package-webui/tests/workspace-save-load-static.test.mjs`:** focused static coverage now exercises the added client contract and accessibility structure.
- **Info — `pi-package-webui/public/app.js`:** duplicate-conflict detection is message-based because the current WS1 response envelope does not expose a machine-readable conflict code. The exact server conflict text is covered by WS1; changing the API error envelope was outside WS2 scope.

## Omissions, assumptions, and residual risks

- Browser automation was not available; modal focus, keyboard traversal, and native-dialog behavior were statically verified but not exercised in a real browser.
- Package-wide `npm test` and `npm run check` remain integration-owner validation work; focused syntax/static/mobile/server-harness checks above passed.
- Existing warning-tolerant restore can partially succeed after replacement. The client preserves and reports all returned warnings.
- WS1 may persist `saveCurrent` but return `409` if concurrent tabs change before closure; that storage outcome is surfaced by the server contract and remains a residual transaction risk.

## Integration notes

- Preserve the WS1 server diff and handoff; do not change the load request body contract.
- When integrating, inspect `public/styles.css` around the pre-existing `.terminal-tabs > .terminal-new-tab-menu:only-child` rule: WS2 adds separate dialog styles later in the file and does not alter that rule.
- Run package-wide test/check suites and browser smoke test the empty-start picker, dialog Cancel, discard, save, duplicate overwrite, and warning feedback before final feature acceptance.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with path and severity are recorded in this handoff's Findings and disposition section; implementation and focused coverage paths are listed above."
    }
  ],
  "changedFiles": [
    "pi-package-webui/public/index.html",
    "pi-package-webui/public/app.js",
    "pi-package-webui/public/styles.css",
    "pi-package-webui/tests/workspace-save-load-static.test.mjs",
    "plans/handoffs/webui-workspace-switch-client.md"
  ],
  "testsAddedOrUpdated": [
    "pi-package-webui/tests/workspace-save-load-static.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "cd pi-package-webui && node --check public/app.js && node --check bin/pi-webui.mjs",
      "result": "passed",
      "summary": "Client and integrated server syntax checks exited 0."
    },
    {
      "command": "cd pi-package-webui && node tests/workspace-save-load-static.test.mjs && node tests/mobile-static.test.mjs",
      "result": "passed",
      "summary": "Focused workspace and preserved mobile static tests passed."
    },
    {
      "command": "cd pi-package-webui && node tests/webui-workspaces-harness.test.mjs",
      "result": "passed",
      "summary": "Integrated WS1 workspace harness passed."
    },
    {
      "command": "git diff --check && git diff --cached --name-only && git status --short",
      "result": "passed",
      "summary": "No whitespace errors and no staged files."
    }
  ],
  "validationOutput": [
    "workspace-save-load-static.test.mjs passed",
    "mobile static checks passed",
    "webui-workspaces-harness.test.mjs passed"
  ],
  "residualRisks": [
    "Native dialog focus and keyboard behavior were not browser-automated.",
    "Existing warning-tolerant restore can partially succeed after current tabs close.",
    "The client identifies duplicate-name 409 responses by the current server message because the response has no machine-readable conflict code."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds an accessible saved-workspace picker and explicit save/discard replacement dialog wired to the integrated WS1 transaction.",
  "reviewFindings": [
    "no blocker: pi-package-webui/public/app.js, public/index.html, public/styles.css - client request shapes match WS1 and destructive replacement requires an explicit decision.",
    "no blocker: pi-package-webui/tests/workspace-save-load-static.test.mjs - focused static coverage verifies picker, dialog, request, overwrite, and reconciliation contracts.",
    "info: pi-package-webui/public/app.js - duplicate-name handling relies on the current server error message; a response-code change was outside WS2 scope."
  ],
  "manualNotes": "Preserved the pre-existing zero-tab dropdown CSS rule and mobile-static test modification; canonical plan and server files were untouched by WS2."
}
```