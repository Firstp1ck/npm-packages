# Review — WebUI workspace switch (UX / flow / a11y / architecture)

- Plan: `plans/planned/webui-workspace-switch.md`
- Review angle: user flow from a newly opened tab, saved-workspace picker, current-tab disclosure, save/discard/cancel semantics, dialog focus/keyboard/accessibility, responsive CSS, error/overwrite UX, tests, simplicity, maintainability; plus independent architecture/correctness/security/edge-case and success-criteria compliance assessment.
- Mode: read-only. No project, source, plan, or test file was modified by this review.
- Run identity: `PI_SUBAGENT_RUN_ID=8a5f6480-515f-4c8e-8049-ff52141b65d3`, child `reviewer` index 1, depth 1, session `019fafac-9a49-7087-a363-837e778596ec`, orchestrator `019faf8a-be9e-774c-9df5-d2a00edb9586`.
- Model / provider: `PI_MODEL=claude-opus-5`, `PI_PROVIDER=anthropic`, `PI_REASONING_LEVEL=high`.

## Verdict

**PASS — no blocker.** The integrated change is coherent, the destructive ordering invariant is correct, and all 80 package test files pass. Two medium-severity UX/compliance gaps and several low-severity notes are listed below.

## What was inspected

- `git diff` (unstaged working tree, nothing staged) across all 7 modified files.
- Surrounding non-diff code needed to judge correctness: `api()` (`app.js:4610`), `readJsonBody` (`pi-webui.mjs:1099`), `saveWebuiWorkspace` (`lib/webui-workspaces.mjs:213`), `normalizeWorkspaceGroups` (`lib/webui-workspaces.mjs:57`), `restorableTabsForRestart`/`restorableTabKey`/`mergeRestorableTabDescriptors` (`pi-webui.mjs:9767-9813`), `closeTerminalTabs` (`app.js:11058`), `syncTabMetadata` (`app.js:9169`), `refreshTabs` (`app.js:10808`), `hydrateLoadedWorkspaceActiveTab` (`app.js:2568`), `renderSavedWorkspacePicker` (`app.js:15243`), `renderEmptyStartState`/`emptyStartAction` (`app.js:26234+`), `make()` (`app.js:1883`).

Commands run (read-only):

| Command | Result |
| --- | --- |
| `node --check public/app.js` | passed |
| `node --check bin/pi-webui.mjs` | passed |
| `node tests/workspace-save-load-static.test.mjs` | passed |
| `node tests/mobile-static.test.mjs` | passed (`mobile static checks passed`) |
| `node tests/webui-workspaces-harness.test.mjs` | passed |
| `npm test` (pi-package-webui) | passed — `all 80 test files passed` |

## Correct (evidence-backed)

- **Destructive ordering invariant holds.** `loadWebuiWorkspace` (`bin/pi-webui.mjs:9856-9908`) resolves the target (`getWebuiWorkspace`) → validates intent (`workspaceReplacementIntent`) → optionally saves (`saveCurrentWorkspaceForReplacement`) → re-verifies the tab set (`openTabsUnchanged`) → only then `closeTabs(openTabIds, { allowEmpty: true })`. Every rejection path throws before any close. Verified behaviorally: `tests/webui-workspaces-harness.test.mjs:113-133` asserts `GET /api/tabs` still returns the original ids after no-decision (400), ambiguous (400), and duplicate-name (409) requests.
- **Explicit-intent contract is strict and matches the plan's API seam.** `workspaceReplacementIntent` (`pi-webui.mjs:9837-9853`) requires `replaceOpenTabs === true`, rejects non-objects/arrays, and uses `Object.hasOwn` XOR so `{discardCurrent, saveCurrent}` together and `discardCurrent: false` both 400. Criterion 6 satisfied.
- **`workspaceLoadInProgress` no longer leaks.** The old guard threw after the flag would have been set in some orderings; the new form checks and throws *before* `workspaceLoadInProgress = true` (`pi-webui.mjs:9856-9858`), so the `finally` always pairs with the assignment.
- **Server owns tab descriptors; client supplies only UI metadata.** `workspaceSaveCurrentDecision` (`app.js:2712-2722`) sends only `name`, `groups: workspaceGroupsForSave()`, `activeTabId`; the server derives descriptors from `restorableTabsForRestart()` (`pi-webui.mjs:9861`). Matches the approved invariant and is statically asserted (`workspace-save-load-static.test.mjs:51`).
- **Save-and-load persistence is verified at the file level, not just the response.** `webui-workspaces-harness.test.mjs:150-155` reads `workspaces.json` and asserts the current groups and active tab were persisted before replacement — this is real evidence for criterion 4, not a self-report.
- **Zero-tab compatibility preserved.** `chooseWorkspaceReplacement` returns `{}` when `!tabs.length` and the client omits the body entirely (`app.js:2765-2769`, `Object.keys(decision).length` guard); `readJsonBody` returns `{}` for an empty body (`pi-webui.mjs:1107`); the server skips the intent branch when `openTabIds.length === 0`. Asserted at `webui-workspaces-harness.test.mjs:180-182` (200 + `closedIds: []`). Criterion 7 satisfied.
- **Overwrite is resolved before anything closes.** Client detects 409 + name-conflict, runs `appConfirm` with `confirmLabel: "Overwrite & load"`, then retries with `saveCurrent.overwrite: true` (`app.js:2777-2797`). Server-side conflict is raised by `lib/webui-workspaces.mjs:218-222` inside `mutateWorkspaces` before `closeTabs` is reached. Criterion 4 satisfied.
- **Current-tab disclosure is exact and honest.** `workspaceReplacementTabRow` (`app.js:2700-2710`) renders title, `Active` marker, `tabIndicator(tab).label` (working/blocked/done), and `normalizeDisplayPath(tab.cwd)` per tab, with `workspaceReplaceCurrentTabsCount` showing the total. The dialog copy explicitly states "will terminate the current Pi processes" (`index.html:1054`). Criterion 3 and the mandatory-disclosure risk item are satisfied.
- **Three explicit outcomes, no implicit destructive default.** All three menu buttons are `type="button"` (`index.html:1068-1070`), so `<form method="dialog">` cannot implicitly submit-and-close; `cancel` (Esc) is `preventDefault`-ed and routed to `finishWorkspaceReplacement(null)`; the `close` listener resolves `null` if a resolve is still pending, so no promise can hang. Enter in the name field maps to Save & load via the explicit `submit` handler. Keyboard semantics are safe: Esc = Cancel, never discard.
- **Initial focus is placed on the least destructive control.** `queueMicrotask(() => elements.workspaceReplaceCancelButton?.focus())` (`app.js:2745`), and the picker focuses its Close button (`app.js:2887`). Both dialogs use `showModal()` so focus is trapped natively; `aria-labelledby`/`aria-describedby` are present on both dialogs and `role="status" aria-live="polite"` on both status paragraphs.
- **XSS-safe rendering.** All picker/dialog text goes through `make(tag, class, text)` which uses `textContent` (`app.js:1883-1888`); the only user-controlled strings (workspace name, cwd, tab title) never touch `innerHTML`.
- **Input bounds line up across layers.** `maxlength="160"` on `#workspaceReplaceSaveName` matches `boundedString(name, 160)` in `normalizedNewWorkspace`; group titles/tab ids are re-normalized and length-capped server-side (`lib/webui-workspaces.mjs:57-77`); `readJsonBody` enforces `BODY_LIMIT_BYTES`. No new unbounded input surface.
- **Non-modal fallback exists.** When `dialog.showModal` is unavailable, the picker falls back to expanding the dashboard (`app.js:2884-2888`) and the switch decision falls back to `confirm`/`prompt` while still requiring an explicit choice (`app.js:2726-2734`). Cancel on the prompt returns `null` and aborts.
- **Pre-existing user edits preserved intact.** `public/styles.css:3966-3968` still contains the zero-tab dropdown rule and `tests/mobile-static.test.mjs:554` still contains its matching assertion; the diff shows exactly those two lines as the only pre-existing-edit hunks, unmodified, and the new CSS is appended in a separate block at `styles.css:13369+`. `git log` confirms neither line is in `HEAD`.
- **Responsive/touch CSS is scoped and reuses the established breakpoint.** `styles.css:13496-13504` uses the same `@media (max-width: 720px), (max-device-width: 720px), (pointer: coarse) and (hover: none)` predicate as the existing saved-workspace rules, collapses items to one column, and gives 44px touch targets. The tab list is bounded and scrollable (`max-height: min(16rem, 34vh); overflow: auto`), and the dialogs respect `--visual-viewport-height`. Criterion 8's mobile half is satisfied and statically guarded (`workspace-save-load-static.test.mjs:60-62`).
- **Discoverability from a newly opened tab is real.** `renderEmptyStartState` only renders inside an existing tab with no messages, so the empty-start "Load workspace" action (`app.js:26277-26282`) always routes through the replacement dialog — exactly the flow the plan describes. It is also reachable from the dashboard action row when tabs are open (`app.js:15186`) and from the command palette in both states (`app.js:32677`). Criterion 1 satisfied and statically asserted (`workspace-save-load-static.test.mjs:47`).
- **Client tab-id reuse hazard does not exist.** Server tab ids are `randomUUID()` (`pi-webui.mjs:9472`), so restored tabs can never inherit a closed tab's id, and leftover per-tab client state cannot bleed into a restored tab.

## Findings

### Medium — 1. Saved-workspace picker dialog has no delete affordance, and delete becomes unreachable while tabs are open

- Location: `pi-package-webui/public/index.html:1032-1044` (dialog markup), `public/app.js:2628-2671` (`renderWorkspaceLoadDialog`), contrast with `public/app.js:15286-15294` (`renderSavedWorkspacePicker`, which does build a Delete button).
- Violated requirement: success criterion 2 — "The action opens an accessible saved-workspace picker with loading, empty, error/retry, load, **and delete** states."
- Reasoning: the new dialog renders only a `Load` button per row. The only Delete affordance lives in `renderSavedWorkspacePicker`, and `renderWorkspaceDashboard` gates that panel behind `!tabs.length` (`app.js:15239` — `const savedWorkspacePanel = !tabs.length ? renderSavedWorkspacePicker() : null;`, plus `savedWorkspaces: !tabs.length ? … : []` in the signature at `app.js:15142`). Reproduction: with at least one tab open, open the picker from the empty-start card, the dashboard action, or the command palette — there is no way to delete a stale saved workspace without first closing every tab. `deleteWebuiWorkspace` (`app.js:2821`) is fully implemented and unused by the new dialog.
- Severity: medium — requirement gap and a genuine dead end for list hygiene; not a data-loss or correctness failure.
- Smallest remediation: in the row builder at `app.js:2661-2669`, add a sibling button mirroring `app.js:15290-15293` and refresh the dialog afterwards, e.g. wrap `load` in a small actions container and append `const remove = make("button", "workspace-load-dialog-item-delete", "Delete"); remove.type = "button"; remove.setAttribute("aria-label", \`Delete workspace ${workspace.name}\`); remove.addEventListener("click", async () => { await deleteWebuiWorkspace(workspace); renderWorkspaceLoadDialog(); });`. The existing `.workspace-load-dialog-item` grid already has an `auto` second column, and the mobile rule already collapses it, so no new CSS is strictly required.

### Medium — 2. Cancel (and any load error) drops keyboard focus to `<body>` and abandons the picker

- Location: `pi-package-webui/public/app.js:2665-2668` (row click handler), `2736-2746` (`chooseWorkspaceReplacement`), `2771-2776` / `2814-2819` (early `return` on cancelled overwrite and on `catch`).
- Violated requirement: success criterion 8 — "Focus … remain usable"; plan deliverable "Client handling for overwrite, loading, focus, error, and restored state."
- Reasoning: the row handler deliberately calls `closeWorkspaceLoadDialog({ restoreFocus: false })`, which nulls `workspaceLoadPickerFocusReturn` so the `close` listener at `app.js:34723-34727` restores nothing. The replacement dialog then opens. If the user presses Esc or Cancel, `finishWorkspaceReplacement(null)` closes it and `loadWebuiWorkspace` returns at `app.js:2767`. The element that had focus before the replacement dialog (the picker's `Load` button) is still in the DOM but inside a now-closed `<dialog>`, so it is not focusable; focus falls to `document.body`. The success path is masked because `hydrateLoadedWorkspaceActiveTab` ends with `focusPromptInput({ defer: true })` (`app.js:2579`), but the cancel path, the "declined overwrite" path (`app.js:2792`), and the `catch` path (`app.js:2813-2817`) all leave the keyboard user with no focus and no visible dialog — and the picker they came from is gone, so recovering requires re-navigating from scratch.
- Severity: medium — degraded keyboard/screen-reader recovery on the explicitly required Cancel path; mouse users are unaffected.
- Smallest remediation: keep the invoking element as the focus anchor instead of discarding it. Preserve `workspaceLoadPickerFocusReturn` across the handoff (drop `{ restoreFocus: false }` and instead capture the anchor before closing), then focus it in the non-success exits — or simply re-open the picker on cancel, e.g. change the handler to `const decision = await loadWebuiWorkspace(...); if (decision === undefined) openWorkspaceLoadPicker(...)`. A minimal version: in `chooseWorkspaceReplacement`'s cancel path and in `loadWebuiWorkspace`'s `catch`/early returns, call `openWorkspaceLoadPicker({ triggerButton: null })` so the user lands back in a focus-trapped dialog.

### Low — 3. No in-progress feedback during the destructive save→close→restore window

- Location: `pi-package-webui/public/app.js:2765-2776` (`controls` derived solely from `triggerButton`), `index.html:1063` (`#workspaceReplaceDialogStatus` only ever set to the static Cancel copy at `app.js:2743`).
- Failure mode: the only busy indicator is `control.disabled = true` on the trigger button. On the primary flow the trigger is the picker's `Load` button, which is inside an already-closed dialog and therefore invisible; the replacement dialog closes immediately on decision. Between clicking **Save & load** and the final `settleUndoToast`, the UI shows nothing while the server writes `workspaces.json`, terminates every Pi process, and restores up to 30 tabs. A user can plausibly re-trigger the flow; the second request is rejected with `409 A workspace load is already in progress` (`pi-webui.mjs:9856`), which is safe but surfaces as a confusing "Could not load workspace" error.
- Severity: low (UX only; the server guard prevents any double-destruction).
- Smallest remediation: keep `#workspaceReplaceDialog` open in a busy state instead of closing it on Save/Discard — set `workspaceReplaceDialogStatus.textContent = "Saving current workspace and replacing tabs…"`, disable the three menu buttons, and close it in the `finally` block of `loadWebuiWorkspace`. Cheaper alternative: emit a pending toast before the `api()` call.

### Low — 4. Overwrite retry is coupled to an English error-message regex

- Location: `pi-package-webui/public/app.js:2779` — `if (!saveCurrent || error.statusCode !== 409 || !/workspace with that name already exists/i.test(error.message || "")) throw error;`
- Failure mode: the server maps the conflict via `if (error?.code === "WORKSPACE_NAME_CONFLICT") throw makeHttpError(409, error.message)` (`pi-webui.mjs:9875`), but `makeHttpError`/`sendError` (`pi-webui.mjs:1074-1082`) emit only `{ ok: false, error: message }` — the machine-readable code is dropped. `POST /api/workspaces/:id/load` legitimately returns 409 for two other reasons ("A workspace load is already in progress", "Open tabs changed before the workspace could be replaced"), so the client must discriminate on prose. Renaming the string in `lib/webui-workspaces.mjs:219` would silently break the overwrite prompt; the static test at `workspace-save-load-static.test.mjs:56` asserts the regex text but cannot catch a server-side rename.
- Severity: low (currently correct; latent maintainability trap).
- Smallest remediation: include the code in the JSON payload (e.g. attach `error.code` in `makeHttpError` and echo it from `sendError`) and switch the client to `error.data?.code === "WORKSPACE_NAME_CONFLICT"` with the regex kept only as a fallback.

### Low — 5. `retireClosedWorkspaceTabContexts` performs a narrower cleanup than `closeTerminalTabs`

- Location: `pi-package-webui/public/app.js:2749-2755`, versus the reference cleanup at `app.js:11072-11086`.
- Failure mode: the replacement path clears only the `tabs` array, `syncTabMetadata`, and `activeTabId`. `syncTabMetadata` (`app.js:9169-9211`) prunes a large set of per-tab maps, but the following are pruned by `closeTerminalTabs` and *not* here: `tabDrafts`, `clearAttachments(id)`, `fileViewersByTab`, `fileViewerSelectionsByTab`, `btwWidgetDismissedIdsByTab`, and `clearOpenTerminalTabGroup`. Because tab ids are UUIDs, none of this can leak into a restored tab; the impact is retained memory (including any staged attachment references) for the lifetime of the page. `syncTerminalCustomGroupsWithTabs` is effectively covered because `installLoadedWorkspaceGroups` rebuilds `terminalCustomGroups` from scratch immediately afterwards.
- Severity: low.
- Smallest remediation: inside `retireClosedWorkspaceTabContexts`, loop the closed ids and call the same `tabDrafts.delete(id)`, `clearAttachments(id)`, `fileViewersByTab.delete(id)`, `fileViewerSelectionsByTab.delete(id)`, `btwWidgetDismissedIdsByTab.delete(id)` cleanup used at `app.js:11072-11083`.

### Low — 6. Dead branch in the server load path

- Location: `pi-package-webui/bin/pi-webui.mjs:9887-9889` — `} else if (tabs.size) { throw makeHttpError(409, "Open tabs changed before the workspace could be loaded"); }`
- Failure mode: `openTabIds` is derived synchronously from `tabs.keys()` at `pi-webui.mjs:9862` and the `else` branch is entered only when `openTabIds.length === 0`, with no intervening `await`. `tabs.size` is therefore always `0` there, so the branch is unreachable. It reads as a real guard and invites future readers to trust a check that cannot fire.
- Severity: low (dead code / misleading intent; zero runtime impact).
- Smallest remediation: delete the `else if` branch, or move the re-check after the first `await` if a genuine re-validation was intended.

### Low — 7. `Save & load` is unavailable above 30 open tabs, with an opaque message

- Location: `pi-package-webui/bin/pi-webui.mjs:9861-9864` (`saveCurrentWorkspaceForReplacement` guard) with `RESTORE_TAB_LIMIT = 30` (`pi-webui.mjs:239`) and `WEBUI_WORKSPACE_TAB_LIMIT = 30` (`lib/webui-workspaces.mjs:8`).
- Failure mode: `restorableTabsForRestart()` slices to 30 descriptors (`pi-webui.mjs:9804`). With 31+ open tabs, `descriptors.length !== tabIds.length` and the request 400s with "Every open tab must be saved before replacing the current workspace" while leaving tabs intact. Fail-safe direction is right (the alternative — silently dropping the 31st tab in `saveWebuiWorkspace`'s own `slice(0, 30)` and then closing everything — would be data loss), but the user sees only `Could not load workspace: Every open tab must be saved…` and has no way to understand that the cap is the cause. Note that descriptor de-duplication is *not* an additional hazard: `restorableTabKey` returns `id:${tab.id}` for live tabs (`pi-webui.mjs:9779-9783`) and ids are UUIDs, so two tabs sharing a cwd/session never collapse.
- Severity: low (bounded, non-destructive, rare).
- Smallest remediation: make the message actionable, e.g. `` `Only ${RESTORE_TAB_LIMIT} tabs can be saved; close some tabs or choose "Load without saving"` ``.

### Low — 8. Saving the current workspace can silently evict the target workspace

- Location: `pi-package-webui/bin/pi-webui.mjs:9866-9885` combined with `lib/webui-workspaces.mjs:229-233` (`while (document.workspaces.length > WEBUI_WORKSPACE_LIMIT) document.workspaces.shift()`), `WEBUI_WORKSPACE_LIMIT = 20`.
- Failure mode: with 20 saved workspaces, **Save & load** pushes a 21st and evicts the oldest. If the oldest *is* the workspace being loaded, the load still succeeds because `workspace` was read at `pi-webui.mjs:9859` before the save — but the workspace silently disappears from the saved list afterwards. The `savedCurrent.evicted` metadata is returned and broadcast, yet the client's replacement path only reads `data.savedCurrent.workspaces` (`app.js:2802`) and never surfaces eviction, unlike the plain save flow which does warn (`app.js:2618`).
- Severity: low (pre-existing limit semantics; no crash, no failed restore).
- Smallest remediation: mirror the plain-save warning in the replacement path — after `setSavedWorkspaces(...)`, if `data.savedCurrent.evicted?.length`, `addEvent("Removed the oldest saved workspace to keep the saved-workspace limit.", "warn")`.

### Low — 9. Two small copy/state inconsistencies in the picker

- Location: `pi-package-webui/public/app.js:2646` and `app.js:2628-2671`.
- Failure mode: (a) the empty state reads "No saved workspaces yet. Open tabs, then use Save workspace." — correct when reached from the zero-tab dashboard, but the dialog is now most often opened *with* tabs already open, where "Open tabs, then…" is confusing. (b) The dialog does not re-render on `webui_workspace_saved` / `webui_workspace_deleted` server events (no client listener for those types exists), so a workspace deleted by another client stays clickable and produces a `404 Workspace not found` toast.
- Severity: low (cosmetic / rare multi-client race).
- Smallest remediation: (a) branch the empty-state copy on `tabs.length`; (b) optional — call `renderWorkspaceLoadDialog()` from the existing server-event handler when `elements.workspaceLoadDialog?.open`.

### Note — server-side side effect on a lost race (accepted, not a defect)

If `openTabsUnchanged` fails *after* a successful `saveCurrent` (`pi-webui.mjs:9884-9886`), the request 409s with tabs intact but the current workspace has already been persisted. This is the safe direction (the user's state is saved, nothing was destroyed), and the client's error path leaves the saved list stale until the next refresh. Worth one line in the final report rather than a code change.

## Success-criteria compliance

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Empty-start card has a labelled **Load workspace** action | PASS | `app.js:26277-26282`; `workspace-save-load-static.test.mjs:47` |
| 2 | Accessible picker with loading / empty / error+retry / load / **delete** states | PARTIAL | loading `app.js:2632`, error+retry `2637-2643`, empty `2645-2648`, load `2661-2669`; **delete absent** — Finding 1 |
| 3 | Current tab title, cwd, activity + Cancel / Load without saving / Save & load | PASS | `app.js:2700-2710`; `index.html:1055-1070`; `workspace-save-load-static.test.mjs:49-52` |
| 4 | **Save & load** takes a name, resolves duplicates before closing anything, saves the constellation, then replaces | PASS | `app.js:2712-2722`, `2777-2797`; `pi-webui.mjs:9861-9890`; `webui-workspaces-harness.test.mjs:125-155` |
| 5 | **Load without saving** requires its own explicit decision, then replaces | PASS | `app.js:34733` (dedicated button → `{replaceOpenTabs:true,discardCurrent:true}`); `webui-workspaces-harness.test.mjs:157-169` |
| 6 | Server validates target and save before closing; undecided replacements rejected | PASS | `pi-webui.mjs:9837-9891`; harness asserts tabs intact after 400/400/409 |
| 7 | Zero-tab load and existing save behavior remain compatible | PASS | `webui-workspaces-harness.test.mjs:171-183`; `npm test` 80/80 |
| 8 | Focus, mobile layout, status/error feedback remain usable | PARTIAL | mobile + status PASS (`styles.css:13496-13504`, `role="status"` on both dialogs); focus regresses on Cancel/error — Finding 2; no busy state — Finding 3 |

## Tests

- Coverage matches the plan's behavioral-evidence list, and the harness assertions are outcome-based (`GET /api/tabs` after each rejection, `workspaces.json` re-read after save) rather than response-echo-based — this is the right shape for a destructive transaction.
- The static test's use of `app.slice(...)` window extraction (`workspace-save-load-static.test.mjs:28`, and the new `emptyStart` window) is consistent with the file's existing style and keeps assertions scoped, but it remains structural string matching: it cannot detect the focus regression in Finding 2, the missing Delete in Finding 1, or the absent busy state in Finding 3.
- The harness edit at `webui-workspaces-harness.test.mjs:174` re-queries live tab ids instead of reusing `[firstTab.id, secondTab.id]` — correct, since those ids no longer exist after the replacement steps.
- Gap: no test asserts the picker's Delete affordance (because it does not exist) and none asserts focus behavior after Cancel. If Finding 1 is fixed, add a matching static assertion beside `workspace-save-load-static.test.mjs:50`.

## Simplicity / maintainability

- The split is clean and each function is small and single-purpose: `workspaceReplacementIntent` (validation), `saveCurrentWorkspaceForReplacement` (save), `openTabsUnchanged` (re-check) on the server; `renderWorkspaceLoadDialog` / `chooseWorkspaceReplacement` / `workspaceSaveCurrentDecision` / `retireClosedWorkspaceTabContexts` on the client. Naming, `make()` usage, `dashboardAction`/`emptyStartAction` reuse, `appConfirm` for the overwrite prompt, and the `finish*Choice` promise-resolve dialog pattern all match established conventions in the file (mirrors `finishGitWorktreeBaseChoice`).
- CSS is appended as one scoped block reusing existing custom properties and the existing breakpoint predicate; no existing selector was altered.
- Real duplication introduced: `renderWorkspaceLoadDialog` (`app.js:2628-2671`) and `renderSavedWorkspacePicker` (`app.js:15243-15300`) now build near-identical rows (same detail string composition, same `Load workspace ${name}` aria-label). Not worth refactoring in this change, but it is the seam where Finding 1 will diverge further; extracting a shared `savedWorkspaceRowDetail(workspace)` helper would be the cheapest consolidation.
- The command-palette simplification (`app.js:32674-32678`) correctly collapses two conditional items into one always-present item with state-dependent description — a genuine reduction.

## Residual risks

1. **No browser-level validation.** Every check here is static inspection plus Node-level HTTP harness testing. Not verified in a real browser: `showModal()` focus trapping in practice, focus-return behavior across the picker→replacement dialog handoff (Finding 2 is derived from the code path and DOM/`<dialog>` focusability semantics, not observed), `aria-live` announcement timing, actual rendering at ≤720px and with `pointer: coarse`, `--visual-viewport-height` behavior with a mobile keyboard open over `#workspaceReplaceSaveName`, and the `window.confirm`/`window.prompt` fallback path (unreachable in any modern browser). No Playwright/Puppeteer harness exists in this package.
2. **Partial-restore failure mode remains, as the plan anticipated.** If restore partially fails after tabs close, `workspaceLoadDescriptor` degrades to the default cwd / a fresh session and pushes warnings; the user sees a warn-toned toast plus per-warning events. Unsaved in-process context is unrecoverable by design. This must be disclosed in the final report per the plan's Integration section.
3. **Multi-client staleness.** The picker snapshot is not invalidated by server workspace events (Finding 9b); a concurrent delete or save from another browser yields a 404/stale-list toast.
4. **Message-coupled overwrite detection** (Finding 4) will break silently if the conflict string in `lib/webui-workspaces.mjs:219` is ever reworded; only a runtime path, not `npm test`, would catch it.
5. **`saved-then-409` side effect** (Note above): a lost `openTabsUnchanged` race leaves an extra saved workspace and a stale client list.
6. **Eviction of the load target** at the 20-workspace limit is silent in the replacement path (Finding 8).
7. **Working tree is unstaged and un-reviewed by CI.** All 7 files are modified but nothing is staged; `plans/planned/webui-workspace-switch.md` and both worker handoffs are untracked. Test evidence above reflects the working tree, not a commit.
8. **Worker handoffs were deliberately not used as proof.** Every claim in this review is anchored to a file path/line range I read directly or to a command I ran; I did not read the other reviewer's output in `plans/handoffs/webui-workspace-switch-review-correctness.md` before forming these findings.

## Recommended disposition

- Accept the change. Fix Findings 1 and 2 before closing the plan, since they map directly onto success criteria 2 and 8; both are small, localized edits.
- Findings 3–9 are optional polish; Findings 4 and 6 are cheap and reduce future risk.
- No modification to `public/styles.css:3966-3968` or `tests/mobile-static.test.mjs:554` is needed or advisable — the pre-existing user edits are intact.

Confidence: 88/100. High on the server transaction, contract validation, criteria mapping, and test evidence (directly executed, 80/80 passing, plus file-level persistence assertions). Reduced by the absence of any browser-level verification: Findings 2 and 3 are code-path derivations about `<dialog>` focus and perceived progress that a real browser session could confirm or partially refute, and the responsive/`aria-live` behavior is asserted only by CSS/attribute presence.
