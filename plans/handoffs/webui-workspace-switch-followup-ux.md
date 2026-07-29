# Follow-up review — WebUI workspace switch (UX / focus / picker a11y)

- Plan: `plans/planned/webui-workspace-switch.md`
- Prior review dispositioned here: `plans/handoffs/webui-workspace-switch-review-ux.md` (Findings 1 and 2, both medium)
- Scope of this pass: keyboard focus across picker → replacement dialog → Cancel / error / overwrite-decline; picker load+delete controls (mobile + a11y); the `loaded` / `cancelled` / `error` string contract vs. committed replacements; any new blocker in the surrounding switch flow.
- Mode: **read-only**. No source, test, plan, or style file was modified by this review. Only this handoff was written.

## Verdict

**PASS — no blocker.** Both previously reported medium findings are genuinely fixed in the working tree, not just papered over by tests. The string result contract is sound: `cancelled` is unreachable after any committed replacement. Three low-severity residual items remain (one new, introduced by the delete affordance itself).

Commands run (read-only, working tree):

| Command | Result |
| --- | --- |
| `node --check public/app.js` | passed |
| `node --check bin/pi-webui.mjs` | passed |
| `node tests/workspace-save-load-static.test.mjs` | passed |
| `node tests/mobile-static.test.mjs` | passed (`mobile static checks passed`) |
| `node tests/webui-workspaces-harness.test.mjs` | passed |
| `npm test` | passed — `all 80 test files passed` |
| `npm run check` | passed — `all 80 test files passed` |

## Correct — previously reported findings verified fixed

### Prior Finding 1 (missing delete affordance) — FIXED

- `public/app.js:2675-2681` now builds a per-row `Delete` button inside the picker dialog: `make("button", "workspace-load-dialog-item-delete", "Delete")`, `type = "button"`, `aria-label = "Delete workspace ${workspace.name}"`, handler `await deleteWebuiWorkspace(workspace); renderWorkspaceLoadDialog();`.
- Reachability with tabs open is real, not theoretical: the dialog reads the module-level `savedWorkspaces` directly (`app.js:2651`), so it is *not* subject to the `!tabs.length` gate that still limits the dashboard panel (`app.js:15267` — `const savedWorkspacePanel = !tabs.length ? renderSavedWorkspacePicker() : null;`). The dead end described in the prior review is gone.
- Row layout was restructured to hold two actions: `actions = make("div", "workspace-load-dialog-item-actions")` with `actions.append(load, remove)` (`app.js:2663`, `2682`), matching the new CSS `.workspace-load-dialog-item-actions` flex container (`styles.css:13427-13432`).
- Guarded by tests: `tests/workspace-save-load-static.test.mjs:50` now requires `workspace-load-dialog-item-delete[\s\S]*?deleteWebuiWorkspace` inside `renderWorkspaceLoadDialog`, and `:64` requires the touch rule. Criterion 2 (loading / empty / error+retry / load / **delete**) is now fully covered: loading `app.js:2633`, error+retry `2637-2643`, empty `2645-2649`, load `2664-2674`, delete `2675-2681`.

### Prior Finding 2 (focus dropped to `<body>` on Cancel / error) — FIXED

Verified path by path:

- **Anchor is preserved, not discarded.** `app.js:2669` captures `const focusReturn = workspaceLoadPickerFocusReturn;` *before* `closeWorkspaceLoadDialog({ restoreFocus: false })` (`app.js:2670`). `closeWorkspaceLoadDialog` nulls the module variable first (`app.js:2701`) so the `close` listener at `app.js:34753-34757` correctly restores nothing during the handoff, while the local `focusReturn` survives.
- **Cancel / Esc → picker is re-entered.** `chooseWorkspaceReplacement` resolves `null` via `finishWorkspaceReplacement(null)` from the Cancel button (`app.js:34758`), the `cancel` (Esc) listener (`app.js:34765-34768`), and the defensive `close` listener (`app.js:34769-34771`). `loadWebuiWorkspace` returns `"cancelled"` at `app.js:2796`, and the row handler responds `if (result === "cancelled") await openWorkspaceLoadPicker({ triggerButton: focusReturn })` (`app.js:2672`), which re-`showModal()`s and focuses the Close button (`app.js:2717-2718`). The keyboard user lands back in a focus-trapped dialog, exactly the remediation the prior review asked for.
- **Overwrite-declined → same recovery.** The declined `appConfirm` path returns `"cancelled"` (`app.js:2815`), so it reuses the reopen branch rather than dropping focus.
- **Error → explicit focus restore.** `app.js:2673`: `else if (result === "error" && focusReturn instanceof HTMLElement && focusReturn.isConnected) focusReturn.focus({ preventScroll: true })`. The `isConnected` guard is the right call — after a *committed* replacement the empty-start/dashboard trigger is re-rendered away, and focusing a detached node would be a no-op anyway.
- **Success path unchanged and still correct.** `"loaded"` (`app.js:2837`) triggers no focus action in the row handler; `hydrateLoadedWorkspaceActiveTab` ends in `focusPromptInput({ defer: true })`, so focus lands in the restored tab's composer.
- Native `<dialog>` semantics reinforce this rather than fight it: closing the picker modally restores focus to its opener before `showModal()` on the replacement dialog captures it, so the replacement dialog's own close-restore and the explicit reopen agree on the same anchor. No focus-steal race: the replacement dialog's focus restore happens synchronously inside `close()`, while the reopen happens later in the awaited continuation.
- Guarded by a test that actually asserts the branch shape: `tests/workspace-save-load-static.test.mjs:51` requires `const result = await loadWebuiWorkspace[\s\S]*?result === "cancelled"[\s\S]*?openWorkspaceLoadPicker[\s\S]*?result === "error"[\s\S]*?focusReturn\.focus`.

## Correct — string result contract cannot reopen or focus stale UI after a committed replacement

- `"cancelled"` has exactly two producers, both strictly pre-destructive:
  1. `app.js:2796` — `decision === null`, i.e. no request was ever sent.
  2. `app.js:2815` — overwrite declined after a `409` whose message matched `/workspace with that name already exists/i` (`app.js:2808`). Server-side that message originates only from `saveWebuiWorkspace`'s conflict inside `mutateWorkspaces`, raised at `bin/pi-webui.mjs:9862-9864` (`saveCurrentWorkspaceForReplacement`) — i.e. before `closeTabs(openTabIds, { allowEmpty: true })` at `pi-webui.mjs:9895`. Verified behaviorally: `tests/webui-workspaces-harness.test.mjs:120-134` asserts `GET /api/tabs` still returns the original ids after the duplicate-name 409.
- The other two `409`s on this route cannot be mistaken for a conflict: `"A workspace load is already in progress"` (`pi-webui.mjs:9866`) and `` `${savedNote}open tabs changed before the workspace could be replaced` `` (`pi-webui.mjs:9889`) do not match the regex, so they fall through to `throw` → `"error"`. Therefore **the picker can never be reopened over a replaced tab set**.
- `"error"` after a committed-but-partially-failed replacement only ever calls `focusReturn.focus()` behind the `isConnected` guard; it never reopens the picker and never re-issues a load. Worst case is focus landing on a still-connected persistent trigger (e.g. `elements.commandPaletteButton`), which is harmless.
- Client-side reconciliation of a committed replacement is complete before any focus action: `retireClosedWorkspaceTabContexts(closedIds)` (`app.js:2776-2792`) now prunes `tabDrafts`, `clearAttachments`, `fileViewersByTab`, `fileViewerSelectionsByTab`, `btwWidgetDismissedIdsByTab`, `removeSubagentTerminalViewsForParent`, `syncTerminalCustomGroupsWithTabs`, `clearOpenTerminalTabGroup(null, { force: true })` and clears `activeTabId` when it was closed — this also closes prior Finding 5. Signatures verified: `setActiveTabId` normalizes `null` (`app.js:7259-7267`), `clearOpenTerminalTabGroup(null, { force: true })` is a safe no-op when nothing is open (`app.js:10731-10736`). Asserted at `workspace-save-load-static.test.mjs:55`.
- Prior Finding 8 (silent eviction) is also fixed: `app.js:2828` now emits `addEvent("Removed ${n} oldest saved workspace…", "warn")`, and prior Finding 7's opaque cap message is now actionable (`pi-webui.mjs:9862` — `Only ${RESTORE_TAB_LIMIT} open tabs can be saved; close some tabs or choose Load without saving`).

## Correct — picker load/delete controls, mobile, and a11y

- **Touch targets.** `styles.css:13503-13504`: inside the shared `@media (max-width: 720px), (max-device-width: 720px), (pointer: coarse) and (hover: none)` predicate, `.workspace-load-dialog-item-actions { justify-content: stretch; }` and `.workspace-load-dialog-item-actions button { flex: 1 1 7rem; min-height: 44px; }` — both Load *and* Delete get 44px. `.workspace-load-dialog-item { grid-template-columns: minmax(0, 1fr); }` (`styles.css:13502`) collapses the row so the two-button actions row does not squeeze the name. Replacement decisions get `flex: 1 1 9rem; min-height: 44px` (`styles.css:13507`). Both rules are asserted (`workspace-save-load-static.test.mjs:64-65`).
- **Desktop alignment is fine despite Delete missing from the `min-height: 2.35rem` rule** (`styles.css:13445-13448` lists only `-item-load` and `-retry`): `.workspace-load-dialog-item-actions` is `display: flex` with default `align-items: stretch`, so Delete matches Load's height.
- **A11y wiring.** Both dialogs carry `aria-labelledby` + `aria-describedby` (`index.html:1032`, `1046`); both status paragraphs are `role="status" aria-live="polite"` (`index.html:1041`, `1063`); the list container has `aria-label="Saved workspaces"` (`index.html:1042`); every row control is `type="button"` with a name-qualified `aria-label` (`app.js:2666`, `2677`), so `<form method="dialog">` cannot implicitly submit. Esc maps to Cancel, never to a destructive default.
- **Delete is confirmed and non-destructive to open tabs.** `deleteWebuiWorkspace` (`app.js:2850-2870`) gates on `appConfirm` with `confirmLabel: "Delete"` and copy that states open tabs are unchanged; nesting `confirmationDialog.showModal()` over the modal picker is valid top-layer behavior.
- **Text is XSS-safe.** All row content flows through `make(tag, class, text)` (`textContent`); no `innerHTML` on workspace names, cwds, or tab titles.
- **Copy inconsistency from prior Finding 9a is fixed**: the empty state now branches on `tabs.length` (`app.js:2646-2648`).
- **Pre-existing user edits still intact**: `styles.css:3966-3968` (zero-tab dropdown `inset: 100% auto auto 0`) and its assertion at `tests/mobile-static.test.mjs:554` are unchanged, and the new CSS is appended as a separate block at `styles.css:13369+`.

## Findings (all low; none blocking)

### Low — A (new, introduced by the delete fix). Deleting or *cancelling* a delete drops focus to `<body>` inside the still-open picker

- Location: `public/app.js:2678-2681`.
- Reasoning: the handler is `await deleteWebuiWorkspace(workspace); renderWorkspaceLoadDialog();` — unconditional. `renderWorkspaceLoadDialog` starts with `list.replaceChildren()` (`app.js:2632`), which removes the very `Delete` button that currently holds focus (native `confirmationDialog` close restores focus to it at `app.js:3898`'s counterpart close path). Once that node is detached, `document.activeElement` falls back to `<body>`. This happens on **all three** outcomes — successful delete, failed delete, and *declined* confirmation — so a keyboard user who changes their mind still loses their place. It is the same class of defect as prior Finding 2, just relocated into the new affordance. Recovery is possible (the modal traps sequential navigation, so Tab re-enters the dialog) but position and screen-reader context are lost.
- Severity: low — degraded, recoverable, and only on the delete control; the prior Cancel-path regression that mattered most is fixed.
- Smallest remediation: skip the re-render when nothing changed and re-anchor focus otherwise, e.g. make `deleteWebuiWorkspace` return a boolean and change the handler to `if (await deleteWebuiWorkspace(workspace)) { renderWorkspaceLoadDialog(); queueMicrotask(() => elements.workspaceLoadDialogCloseButton?.focus()); }`. Cheapest variant without touching `deleteWebuiWorkspace`: keep the unconditional re-render but append `queueMicrotask(() => elements.workspaceLoadDialogCloseButton?.focus())`.

### Low — B. Delete in the dialog lacks the destructive affordance used by the dashboard picker

- Location: `public/app.js:2675` (class `workspace-load-dialog-item-delete`) versus `public/styles.css:13349-13358` (`.workspace-saved-workspace-delete` — red text, red border, red/peach hover+`:focus-visible` gradient).
- Reasoning: `grep -n "workspace-load-dialog-item-delete" public/styles.css` returns **no match** (exit 1), so the new Delete renders with the generic dialog-button style while `Load` carries `primary`. The established convention in this file is that workspace deletion is visually destructive. Consequence: on a two-button row the destructive action is the *less* visually distinct one. Not a correctness or safety issue (`appConfirm` still gates it).
- Severity: low (visual/affordance consistency).
- Smallest remediation: add `.workspace-load-dialog-item-delete` to the existing `.workspace-saved-workspace-delete` selector groups at `styles.css:13349` and `13353`, or reuse the shared `danger` class on the button.

### Low — C. New modal dialogs are absent from the global-shortcut suppression list

- Location: `public/app.js:35356` (`shouldHandleNativeAppShortcut`) — it checks `elements.dialog`, `pathPickerDialog`, `gitChangesDialog`, `commandPaletteDialog`, `editRetryDialog`, `nativeCommandDialog`, `appRunnerInfoDialog`, but not `workspaceLoadDialog` / `workspaceReplaceDialog` (nor the pre-existing `confirmationDialog` / `gitWorktreeBaseDialog`).
- Reasoning: with focus on the picker's Close button or the replacement dialog's Cancel button, `event.target` is not a text-entry target, so `Ctrl/Cmd+K` still reaches `openCommandPalette()` (`app.js:35367-35369`) and stacks a third modal. From there, `Workspace: Load…` (`app.js:32706`) can re-open the picker over a live replacement dialog; a subsequent Load click hits `if (activeWorkspaceReplacementResolve) finishWorkspaceReplacement(null)` (`app.js:2755`), which resolves the *first* flow as `"cancelled"` and makes it reopen the picker on top of the second replacement dialog. Nothing destructive can result — the server's single-flight guard returns `409 A workspace load is already in progress` (`pi-webui.mjs:9866`) — but the UI can visibly stack.
- Severity: low; and it follows the file's existing (imperfect) convention rather than regressing it, since `confirmationDialog` and `gitWorktreeBaseDialog` are omitted too. Not attributable to this change.
- Smallest remediation: append `|| elements.workspaceLoadDialog?.open || elements.workspaceReplaceDialog?.open` to the guard at `app.js:35356`, or (broader, out of scope here) switch the guard to `document.querySelector("dialog[open]")`.

## Still-open items from the prior review, deliberately not re-raised as defects

- Prior Finding 3 (no busy state during the destructive save→close→restore window) is unaddressed: `#workspaceReplaceDialogStatus` is still only ever set to the static Cancel copy (`app.js:2767`) and the only busy signal is `control.disabled` on a trigger that is inside an already-closed dialog (`app.js:2797-2798`). A re-trigger is blocked safely by the server (`409`), so this stays cosmetic. Optional polish.
- Prior Finding 4 (overwrite retry keyed to an English message regex, `app.js:2808`) and Finding 9b (picker not re-rendered on `webui_workspace_saved` / `webui_workspace_deleted`; `grep` confirms no client listener exists for those types) are unchanged latent maintainability/staleness risks, not user-visible defects today.
- Prior Finding 6 (dead `else if (tabs.size)` branch) no longer exists: the current server code at `pi-webui.mjs:9871-9890` keeps the re-check inside the `openTabIds.length` branch, where `openTabsUnchanged` is a meaningful post-`await` guard, and its 409 message now discloses `"The current workspace was saved, but "` when a save already landed.

## Residual risks

1. **No browser-level verification.** All focus reasoning is derived from the code plus HTML `<dialog>` / focus-removal semantics; nothing here was observed in a real browser. Findings A and C, and the "reopen wins the focus race" conclusion for the Cancel path, are the items a real session could confirm or partially refute. No Playwright/Puppeteer harness exists in this package.
2. **Static tests cannot see focus.** `workspace-save-load-static.test.mjs:51` asserts the *shape* of the recovery branches (string literals and call names), not observable focus. A refactor that keeps the strings but breaks the anchor would still pass.
3. **Partial-restore failure mode remains by design** (plan's Integration section): a restore that partly fails after tabs close yields warn-toned toasts plus per-warning events; unsaved in-process context is unrecoverable.
4. **`saved-then-409` race** still leaves an extra saved workspace with tabs intact and a stale client list until the next refresh — safe direction, worth one line in the final report.
5. **Working tree is unstaged.** All 7 files are modified, nothing staged; `plans/planned/webui-workspace-switch.md` and the handoffs are untracked. All test evidence above reflects the working tree, not a commit.

## Recommended disposition

Accept. Both blocking-priority prior findings (criteria 2 and 8) are properly fixed with real code changes and matching assertions, and the `loaded`/`cancelled`/`error` contract is provably non-reentrant after a committed replacement. Findings A and B are two- to three-line polish edits in the code the fix just touched and are the only ones I would bundle before closing the plan; C is pre-existing convention debt.

Confidence: 90/100. High on the result-contract analysis, the server ordering, delete reachability, the touch/a11y attributes, and the full 80/80 suite (executed twice via `npm test` and `npm run check`). Held below 95 only by the absence of any real-browser focus observation: Finding A and the exact focus outcome of the reopen path are semantics-derived, not observed.
