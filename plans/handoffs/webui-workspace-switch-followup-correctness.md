# Follow-up review — webui-workspace-switch (post-fix correctness)

- Plan: `plans/planned/webui-workspace-switch.md`
- Mode: read-only follow-up of the current working-tree diff after integration-owner fixes. No files modified.
- Prior reviews dispositioned here: `plans/handoffs/webui-workspace-switch-review-correctness.md` (F1–F8) and `plans/handoffs/webui-workspace-switch-review-ux.md` (Findings 1–9).
- Confidence: 90/100. All claims verified against source/tests directly and the full package suite re-run (80/80). Still no browser-level verification of `<dialog>` focus/stacking, which caps confidence on the focus-handoff path.

## Verdict

**PASS.** Every previously reported issue mapped to a required fix is resolved; no new blocker found in the surrounding workspace switch flow.

## Review

### Correct (evidence-backed)

1. **Picker Delete state is fully implemented (was correctness-F1 / ux-Finding-1).**
   - `pi-package-webui/public/app.js:2675-2681` (`renderWorkspaceLoadDialog`): each picker row now appends `load` and `remove` buttons in a `workspace-load-dialog-item-actions` container; the Delete button has `aria-label` `Delete workspace ${name}` and its handler awaits `deleteWebuiWorkspace(workspace)` then calls `renderWorkspaceLoadDialog()`.
   - Static assertion restored to full plan wording: `pi-package-webui/tests/workspace-save-load-static.test.mjs:50` now requires "loading, retry/error, empty, load, **and delete** states" including `workspace-load-dialog-item-delete` and `deleteWebuiWorkspace`.
   - Touch-target CSS asserted at `workspace-save-load-static.test.mjs:64` (`.workspace-load-dialog-item-actions button { flex: 1 1 7rem; min-height: 44px; }`); test passes.

2. **Deletion refreshes the open picker safely.**
   - `deleteWebuiWorkspace` (`app.js:2850-2870`) confirms via `appConfirm`, catches its own errors (no throw → no unhandled rejection in the fire-and-forget click handler), and calls `setSavedWorkspaces(response.data?.workspaces)` on success, so the subsequent `renderWorkspaceLoadDialog()` re-renders from the updated `savedWorkspaces` list while the dialog stays open. On confirm-decline the re-render is a harmless no-op.
   - `setSavedWorkspaces` (`app.js:2511-2515`) filters malformed entries; empty list renders the empty state (`app.js:2645-2649`).

3. **Replacement retires per-tab client state (was ux-Finding-5).**
   - `retireClosedWorkspaceTabContexts` (`app.js:2749-2763`) now mirrors `closeTerminalTabs` (`app.js:11086-11110`): deletes `tabDrafts`, `clearAttachments(id)`, `fileViewersByTab`, `fileViewerSelectionsByTab`, `btwWidgetDismissedIdsByTab`, `removeSubagentTerminalViewsForParent(id)` per closed id, then `syncTerminalCustomGroupsWithTabs(tabs)` and `clearOpenTerminalTabGroup(null, { force: true })` with the same call shapes as the reference path.
   - The remaining maps `closeTerminalTabs` deletes explicitly (`clearGitWorkflowForTab`, `featureCategoryByTab`, `commandCatalogsByTab`, `appRunnerDataByTab`, `tabMessagesCache`) are all pruned by `syncTabMetadata(tabs)` (`app.js:9169-9211`), which `retireClosedWorkspaceTabContexts` calls — cleanup is now complete.
   - Static assertion added: `workspace-save-load-static.test.mjs` (`function retireClosedWorkspaceTabContexts … tabDrafts.delete … clearAttachments … fileViewersByTab.delete … removeSubagentTerminalViewsForParent`); passes.

4. **Server race messaging is correct (was correctness-F3 / ux-note).**
   - `pi-package-webui/bin/pi-webui.mjs:9905-9908`: on a lost `openTabsUnchanged` race the 409 message is now `${savedNote}open tabs changed before the workspace could be replaced` where `savedNote = "The current workspace was saved, but "` when a save already succeeded — the save-only side effect is disclosed in the error itself.

5. **Cap messaging is correct and accurate (was correctness-F7 / ux-Finding-7).**
   - `pi-webui.mjs:9863-9865`: message changed to `Only ${RESTORE_TAB_LIMIT} open tabs can be saved; close some tabs or choose Load without saving`. Verified accurate: `restorableTabsForRestart` (`pi-webui.mjs:9807-9813`) produces one descriptor per live tab (`restorableTabDescriptor` always returns an object; `normalizeRestoreTabDescriptor` at `pi-webui.mjs:7989` never returns null for a valid object), live tab ids are unique UUIDs so `restorableTabKey` (`pi-webui.mjs:9779-9784`) never dedup-collapses, therefore `descriptors.length !== tabIds.length` can only trip via the `.slice(0, RESTORE_TAB_LIMIT)` cap (`pi-webui.mjs:9804`). The attribution to the cap is correct.

6. **Dead branch removed (was correctness-F6 / ux-Finding-6).**
   - The unreachable `else if (tabs.size)` guard is gone; the new structure wraps all replacement logic in `if (openTabIds.length) { … }` (`pi-webui.mjs:9890-9911`) with the live re-check via `openTabsUnchanged(openTabIds)` placed after the save awaits, where it can actually fire.

7. **Focus handoff on cancel/error fixed (was ux-Finding-2).**
   - Picker load handler (`app.js:2669-2673`) captures `focusReturn` before `closeWorkspaceLoadDialog({ restoreFocus: false })`; `loadWebuiWorkspace` now returns `"cancelled" | "loaded" | "error"`; `"cancelled"` (Esc/Cancel/declined overwrite) re-opens the picker via `openWorkspaceLoadPicker({ triggerButton: focusReturn })`, and `"error"` focuses the still-connected invoker. Static assertion at `workspace-save-load-static.test.mjs:51`; passes.
   - `closeWorkspaceLoadDialog` (`app.js:2696-2702`) has no double-focus bug: the synchronous `close` listener nulls `workspaceLoadPickerFocusReturn` before the function body re-reads it.

8. **Eviction surfaced (was ux-Finding-8).**
   - `app.js:2803-2804`: client reads `data.savedCurrent?.evicted` and emits a warn event. Shape verified against `lib/webui-workspaces.mjs:213-247` which returns `{ workspace, workspaces, evicted }`.

9. **Empty-state copy branches on tab count (was ux-Finding-9a).**
   - `app.js:2645-2649`: with tabs open the copy reads "Use Save workspace to capture the current tabs"; zero-tab copy unchanged.

10. **No regression in server contract or tests.**
    - Intent validation, validate-before-close ordering, concurrency guard, and zero-tab compatibility are unchanged from the previously reviewed-correct versions; harness coverage expanded to assert `closedIds`, file-level persistence of groups/activeTabId, discard semantics, `closedIds: []` on zero-tab load, and delete flows (`tests/webui-workspaces-harness.test.mjs:111-218`). Full suite: **all 80 test files passed**.

### Findings

None at blocker or medium severity. All previously reported medium findings (picker delete, focus-on-cancel) are resolved. The following lows from the prior reviews remain intentionally unaddressed and are unchanged in severity:

- **Note (low, pre-existing, unchanged): malformed JSON body returns 500 not 400** (correctness-F2) — `readJsonBody` (`pi-webui.mjs:1099-1111`) untouched; shared pattern across JSON routes. Smallest remediation if ever taken: catch `SyntaxError` and rethrow `makeHttpError(400, "Invalid JSON body")`.
- **Note (low, unchanged): overwrite detection still couples to the English message regex** (correctness-F5 / ux-Finding-4) — `app.js:2779` regex; `makeHttpError(409, error.message)` still drops `WORKSPACE_NAME_CONFLICT` from the payload. Correct today; latent rename hazard.
- **Note (low, unchanged): no busy indicator during the save→close→restore window** (ux-Finding-3) — the replace dialog still closes immediately on decision; the server-side `workspaceLoadInProgress` 409 prevents any double-destruction, so this is UX-only.
- **Note (low, unchanged): picker does not live-refresh on `webui_workspace_saved`/`webui_workspace_deleted` broadcasts from other clients** (ux-Finding-9b); a concurrent delete yields a 404 toast. Rare multi-client race.
- **Note (trivial, new): focus after picker Delete** — the clicked Delete button is removed by the re-render, so keyboard focus falls to `<body>` while the modal picker remains open; Tab re-enters the dialog. Cosmetic a11y nit, not a regression (previously there was no Delete at all).

### New blockers in the surrounding flow

None found. Specifically re-checked: `retireClosedWorkspaceTabContexts` symbol existence and call shapes against `closeTerminalTabs`; stacked `appConfirm` modal over the open picker (allowed by top-layer semantics); the `"cancelled"` return re-open path not looping (picker re-render does not auto-trigger load); the zero-tab dashboard caller (`app.js:15320`) ignoring the new return value safely (decision is always `{}` there); old-client empty-body load with zero tabs still 200 (`readJsonBody` returns `{}`, intent branch skipped when `openTabIds.length === 0`).

### Fixed

None by this review (read-only).

## Validation performed (this review)

| Command | Result |
| --- | --- |
| `node --check public/app.js && node --check bin/pi-webui.mjs` | passed |
| `node tests/workspace-save-load-static.test.mjs` | passed |
| `node tests/mobile-static.test.mjs` | passed |
| `node tests/webui-workspaces-harness.test.mjs` | passed |
| `node tests/http-endpoints-harness.test.mjs` | passed |
| `node tests/webui-workspaces.test.mjs` | passed (expected stderr warning for deliberately corrupt fixture) |
| `npm test` (pi-package-webui, `tests/run-all.mjs`) | **all 80 test files passed** |

## Residual risks

- Browser-level behavior (stacked `appConfirm` over the modal picker, focus return after picker Delete, `showModal` trapping) remains statically verified only; no Playwright/Puppeteer harness exists in this package.
- Partial-restore-after-close failure mode is unchanged and must still be disclosed in the final report per the plan's Integration section.
- Message-regex overwrite coupling (above) remains the main latent maintainability debt.
