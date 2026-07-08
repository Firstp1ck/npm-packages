# Git Footer Status: Git Action Improvements

> **Status: implemented (2026-07-08).** Every section below has been implemented; see
> "Implementation status" at the end for the item-by-item mapping to code and tests.

## Scope

Improve the actions reachable from the `@firstpick/pi-extension-git-footer-status` footer payload and the Pi Web UI git surfaces it drives.

Current action surface observed (verified against `index.ts`, `pi-package-webui/bin/pi-webui.mjs`, `pi-package-webui/lib/git-worktrees.mjs`, and `pi-package-webui/public/app.js`):

- `git` chip: open branch/worktree picker (`setFooterBranchPickerOpen`), or start init workflow (`startGitInitWorkflow`) when the value is "no repo". The `worktree` chip opens the same picker.
- `sync` chip: push outgoing commits when ahead (`pushGitFooterSync` → `window.confirm` → `POST /api/git-workflow/push`).
- `changes` chip: open Git Changes dialog with staged/unstaged/untracked/incoming diff and fast-forward pull; hovering also shows a changed-files popover with @-reference buttons.
- `git+` (`git-extra`) and `git-state` chips: informational only for stash, submodule, worktree, tag, age, signing mismatch, and active operations — tooltip text, no click handler.
- Server endpoints already cover git diff/status (`/api/git-changes`), fast-forward pull, branch list/switch/create (`/api/git-branches`, `/api/git-branch`), worktree list/create/open/remove (`/api/git-worktrees`), and the guided workflow endpoints (`/api/git-workflow/*`): init, add, commit, push, and PR creation via `gh pr create`.

### Verification notes (facts confirmed in code)

- The extension payload **already** carries conflicted files: `GitChangedFile.kind` includes `"conflicted"` with the porcelain `u`-line status (`UU`, `AA`, …) preserved in `status` (`readGitSnapshot` in `index.ts`). No new payload type is needed for conflict listing — only UI and server actions are missing.
- The extension detects `MERGING`, `REBASING`, `CHERRY-PICK`, `REVERTING`, `BISECT` (`detectGitOperation`), detached HEAD, ahead/behind, stash count, dirty submodule count, worktree count, HEAD tag, last-commit age, and signing mismatch. It does **not** parse `# branch.upstream`, so "no upstream configured / upstream gone" is indistinguishable from "in sync".
- The extension runs a startup `git fetch` (no `--prune`, `credential.interactive=false`, 30s timeout) and exposes fetch state in the **changes**-chip tooltip (`gitFetchTitle`). The webui server itself never runs `git fetch`.
- `changedFiles` is silently capped at 80 entries (`GIT_CHANGED_FILES_LIMIT`); the Web UI cannot tell a complete list from a truncated one.
- `bin/pi-webui.mjs` is hand-written (no build step); there is **no source equivalent** — git helpers live in `lib/git-worktrees.mjs` and friends.
- `DELETE /api/git-worktrees` exists with good guards (localhost-only, `confirmed: true`, `WORKTREE_BUSY` when a tab is open, dirty check without `force`) but **no UI calls it** — only tests.
- Pull failure UX confirmed: `pullGitChanges` returns raw `stderr || stdout` and `pullGitChangesDialog` displays it verbatim.
- Command execution posture is solid: all git/gh calls use `spawn` with argv arrays (never shell strings), branch names pass `cleanGitBranchName`/`cleanBranchName` (reject leading `-`, leading `/`, `@{`, NUL) plus `git check-ref-format --branch`, paths are confined under the repo root, mutations run behind a single-flight lock, and worktree mutations retry on `index.lock`.
- Gap found (now **fixed**): the `/api/git-workflow/*` router applied its access guard only to non-GET requests, and `handleGitWorkflowRequest` did not check the HTTP method — a GET to a mutating workflow path (e.g. `commit`, `push`) still executed it. See P0 below.
- Extension tests covered only stale-context handling (`tests/stale-ctx.test.mjs`); the porcelain=2 parser and operation detection now have coverage in `tests/git-snapshot.test.mjs`.

## Recommended improvements

### P0 — Enforce HTTP method on `/api/git-workflow/*` (security fix)

**Problem:** The route guard (`ensureNaturalConversationRouteAllowed`) is applied only when the request method is not GET, but `handleGitWorkflowRequest` dispatches on path alone. A `GET /api/git-workflow/commit` (or `push`, `add`, `init-push`, …) bypasses the guard and executes the mutation. GET requests are triggerable cross-origin (image/script tags), so a page open in the same browser as the Web UI can drive git mutations without any confirmation.

**Proposal:**

- Require `POST` for every mutating workflow action; return `405` otherwise. Keep GET only for the read-only actions (`message`, `default-commit-message`, `branch-name`, `pr-description`, `init-files-status`).
- Apply the access guard uniformly at the router level, before dispatch.
- Add harness tests asserting `GET` on each mutating workflow path returns 405 and performs no repo change.
- While in there: audit the other POST/DELETE git endpoints for the same pattern (they currently look correct) and add a shared `requireMethod(req, "POST")` helper so new endpoints can't regress.

### P0 — Better merge/conflict handling

**Problem:** The footer detects `MERGING` and conflicted file count, but the Web UI does not guide the user through the merge lifecycle.

**Proposal:** Add an operation-aware conflict panel when `snapshot.operation === "MERGING"` or `conflicted > 0`.

Actions:

- Open the Git Changes dialog directly in a `Conflicts` view from the state/conflict chip.
- List unmerged files from porcelain `u` entries with conflict status (`UU`, `AA`, `DU`, etc.).
- Render conflict-marker previews for text files and show binary/large-file placeholders.
- Add guarded workflow buttons:
  - `Refresh conflicts`
  - `Mark resolved` / `git add -- <file>` for selected files
  - `Continue merge` / `git commit` only when no unmerged paths remain
  - `Abort merge` / `git merge --abort` behind a strong confirmation showing the target root and changed-file summary
- Never auto-resolve conflicts. Optional per-file `checkout --ours/--theirs` should require explicit confirmation and preview.

Implementation notes:

- The extension payload already provides what the conflict list needs: `GitChangedFile` entries with `kind: "conflicted"` and the porcelain status (`UU`, `AA`, `DU`, …) — no payload extension required for listing. The webui server independently counts `u` lines in `summarizeGitPorcelainStatus`; add per-file conflict data there for dialog refreshes.
- Add server helpers near `readGitChanges()` in `pi-package-webui/bin/pi-webui.mjs` (hand-written; there is no source equivalent — shared helpers belong in `lib/`).
- Prefer a generic operation endpoint shape so rebase/cherry-pick/revert can reuse it:
  - `GET /api/git-operation`
  - `POST /api/git-operation/continue`
  - `POST /api/git-operation/abort`
  - `POST /api/git-operation/stage-file`
- Add harness tests with a temporary repo that intentionally creates a merge conflict.

### P0 — Safer pull strategy and failed fast-forward UX

**Problem:** Pull currently runs `git pull --ff-only`. That is safe, but when it fails the UI mostly shows command output instead of next-step choices.

**Proposal:** Keep fast-forward as the default, then classify failures and offer safe alternatives.

Actions:

- The dialog already shows ahead/behind overview chips and gates the pull button on `behind > 0 && canPull`; extend this to an explicit divergence callout when `ahead > 0 && behind > 0`.
- If behind only: keep `Pull ↓N` as fast-forward pull.
- If diverged (`ahead > 0 && behind > 0`): disable one-click pull and offer:
  - `Fetch only`
  - `Open incoming diff`
  - `Create integration worktree`
  - `Merge in current checkout` only with confirmation
  - `Rebase current branch` only with confirmation
- If `--ff-only` fails, parse common messages and show recommended next action instead of a raw error wall.

### P1 — Fetch / refresh remote state as first-class action

**Problem:** The extension fetches once on startup (no `--prune`), and the webui server never runs `git fetch` at all — the changes dialog can only pull, so behind counts go stale until the next session start.

**Proposal:** Add `Fetch` next to `Refresh` and `Pull`.

Actions:

- Add a `POST /api/git-fetch` endpoint running `git fetch --prune` with `credential.interactive=false`/`GIT_TERMINAL_PROMPT=0`, a timeout, and the existing single-flight workflow lock; display the remote update summary.
- Refresh git-footer payload and Git Changes dialog after fetch.
- Consider adding `--prune` to the extension's startup fetch for consistency.
- The **changes**-chip tooltip already includes fetch state/message (`gitFetchTitle` in `index.ts`); surface the same state inside the dialog (last fetch time, error details) instead of only in the tooltip.

### P1 — Stash actions for dirty worktree workflows

**Problem:** The footer shows stash count but provides no action.

**Proposal:** Make `git+` stash indicator actionable.

Actions:

- Open stash panel listing `git stash list --format` entries.
- Buttons:
  - `Stash tracked changes`
  - `Stash including untracked`
  - `Apply stash`
  - `Pop stash`
  - `Drop stash` behind confirmation
- Always show preview (`git stash show --stat` and optional patch) before apply/pop/drop.

### P1 — Operation lifecycle for rebase/cherry-pick/revert/bisect

**Problem:** The extension detects these states, but only displays them.

**Proposal:** Reuse the operation panel from merge handling.

Actions:

- For `REBASING`: `Continue`, `Skip`, `Abort`, conflict list.
- For `CHERRY-PICK`: `Continue`, `Skip`, `Abort`, conflict list.
- For `REVERTING`: `Continue`, `Abort`, conflict list.
- For `BISECT`: show current state and buttons for `good`, `bad`, `skip`, `reset` with confirmation.

### P1 — Branch/worktree safety upgrades

**Problem:** Branch switching exists, and worktrees are the safe default, but the UI can do more to avoid disrupting active agent work.

**Proposal:** Add preflight warnings and safer default routes.

Actions:

- Before switch/create, show dirty summary and active-agent warning in one confirmation dialog (`confirmFooterGitBranchAction` already confirms on create/agent-busy; extend it with the dirty-file summary).
- Offer `Create worktree instead` whenever switching would affect dirty or active tabs.
- Show worktree health: prunable, locked, branch checked out elsewhere, detached state.
- Add `Prune stale worktrees` with dry-run preview before execution.
- Expose worktree removal in the branch picker: `DELETE /api/git-worktrees` already exists with strong guards (localhost-only, `confirmed: true`, `WORKTREE_BUSY`, dirty check) but has no UI caller — this is a finished backend waiting for a button.

### P2 — File-level staging and discard actions in Git Changes

**Problem:** Guided workflow stages everything with `git add .`; Git Changes is mostly read-only plus pull.

**Proposal:** Add file-level staging controls with destructive actions guarded.

Actions:

- Per file: `Stage`, `Unstage`, `Open file`, `Copy path`.
- Optional hunk-level staging later.
- Destructive buttons only behind confirmation:
  - `Discard file changes` / `git restore -- <file>`
  - `Delete untracked file`
- Ensure path normalization stays under repo root.

### P2 — Signing mismatch action

**Problem:** Footer shows signing mismatch but does not help fix it.

**Proposal:** Make signing warning open diagnostics.

Actions:

- Show `commit.gpgsign`, `gpg.format`, `user.signingkey`, and latest commit signature state.
- Offer copyable suggested commands, not automatic config writes by default.
- Optional confirmed actions for local repo config only.

### P2 — Submodule actions

**Problem:** Dirty submodules are visible as a count only.

**Proposal:** Add submodule status drilldown.

Actions:

- List dirty/out-of-sync submodules from `git submodule status --recursive`.
- Actions: `Update/init recursively`, `Open submodule path`, `Copy path`.
- Show warning before recursive update.

### P2 — Tag/release convenience

**Problem:** Tag-at-HEAD is shown, but tags are read-only.

**Proposal:** Add tag details and safe tag creation.

Actions:

- Clicking tag shows current tags, target SHA, annotated/lightweight metadata.
- Optional `Create annotated tag` action with confirmation.
- Push tags remains explicit and separate.

## Additional essential improvements (added after code verification)

### P0 — Push failure classification and upstream handling

**Problem:** Push runs with `GIT_TERMINAL_PROMPT=0` / `GH_PROMPT_DISABLED=1`, so auth prompts fail silently and the user sees raw stderr. Non-fast-forward rejections, missing upstreams, and credential failures all look the same. The extension also never parses `# branch.upstream`, so the footer cannot distinguish "no upstream configured" or "upstream gone" from "in sync" — the sync chip simply disappears.

**Proposal:** Classify push outcomes and make upstream state first-class.

Actions:

- Parse `# branch.upstream` in `readGitSnapshot` and add `upstream?: string` / `upstreamGone: boolean` to `GitSnapshot`. Show a `no upstream` hint on the sync chip.
- When push fails, classify into: no upstream (offer `Push and set upstream` — the `push -u <remote> <branch>` variant already exists), non-fast-forward (offer `Fetch`/`Open incoming diff`; `Force push (--force-with-lease)` only behind a strong confirmation naming the remote branch — never plain `--force`), auth/credential failure (explain that prompts are disabled and show the remote URL scheme), and network/timeout.
- Detect the push target being a likely-protected branch (`main`/`master` or remote HEAD) and add a warning line to the confirmation.

### P1 — Undo and recovery actions

**Problem:** The workflow can commit and push, but there is no recovery path when a guided commit goes wrong — users must drop to the terminal.

**Proposal:** Add narrowly-scoped, guarded undo actions.

Actions:

- `Undo last commit (keep changes)` / `git reset --soft HEAD~1` — enabled only when HEAD has a parent, the commit is not pushed (`ahead > 0`), and no operation is in progress; confirmation shows the commit subject and hash.
- `Amend last commit message` — same not-pushed guard.
- Read-only `Recent HEAD history` panel from `git reflog -n 20` so users can see what a guided action did and recover a lost SHA. No reset-to-reflog-entry action by default; copyable commands instead.
- After any destructive-adjacent action, show the reflog entry that would restore the previous state.

### P1 — Truncation transparency and large-repo performance

**Problem:** `changedFiles` is capped at 80 entries with no indicator (`GIT_CHANGED_FILES_LIMIT`), and `/api/git-changes` caps diffs at 500KB — the UI presents truncated data as complete. Separately, every 10s auto-refresh runs `git submodule status --recursive`, `stash list`, `worktree list`, `tag --points-at`, and `log -1` even when nothing changed, which is expensive in large repos.

**Proposal:** Surface truncation and cut steady-state cost.

Actions:

- Add `changedFilesTruncated: boolean` (and total count) to the payload; render "showing 80 of N" in the changes popover and dialog.
- Mark truncated diffs in the Git Changes dialog with the cap size and a `Open full diff in file viewer` escape hatch.
- Skip the auxiliary commands (submodule/stash/worktree/tag) when `git status` output and HEAD are unchanged since the last poll; they cannot have changed user-visibly in most ticks. Alternatively gate `submodule status --recursive` behind detection that `.gitmodules` exists.
- Make the auto-refresh interval back off when the window/tab is not focused (webui already knows visibility).

### P2 — Unify mutation locking and lock-failure UX

**Problem:** Worktree mutations retry on `index.lock` contention (`lib/git-worktrees.mjs`), but workflow commands (`add`, `commit`, `switch`, `pull`) do not — a background `git` process (e.g. an agent running git in the same repo) makes them fail with a raw lock error.

**Proposal:**

- Move the index.lock retry helper into shared lib code and use it for all mutating endpoints.
- When the lock persists, return a structured `REPO_BUSY` error and render "another git process is using this repository" with a retry button, instead of raw stderr.

### P2 — Extension parser and detection test coverage

**Problem:** The extension's only test is `tests/stale-ctx.test.mjs`. The porcelain=2 parser (`readGitSnapshot`), rename handling (`2` lines with tab-separated paths), conflict (`u`) lines, detached-HEAD resolution, and `detectGitOperation` have no tests — regressions in the payload would surface only as silently wrong footer chips.

**Proposal:**

- Add unit tests feeding recorded porcelain=2 output (statuses, renames, conflicts, detached, initial commit) into the parser.
- Add fixture-repo tests for `detectGitOperation` covering merge, rebase, cherry-pick, revert, and bisect states — these same fixtures serve the P0 conflict-panel harness tests.
- Test the 80-file cap and the new `changedFilesTruncated` flag together.

## UX principles

- Default to read-only inspect actions.
- Keep destructive or history-rewriting actions behind explicit confirmation.
- Prefer worktree-based integration for risky branch/merge work.
- Show exact command, cwd/root, and expected effect before executing.
- Refresh footer and dialog state after every successful action.
- Classify git errors into actionable states instead of dumping raw stderr first.

## Suggested implementation order

1. **Fix the `/api/git-workflow/*` GET-bypass** (method enforcement + guard at router level) with regression tests — small, standalone, security-relevant.
2. Add generic git operation snapshot endpoint and merge-conflict fixture tests (fixtures shared with extension parser tests).
3. Wire state/conflict chips to open Git Changes in conflict mode.
4. Add merge `continue`/`abort` guarded actions.
5. Add fetch action, diverged-branch pull UX, and push failure classification (incl. upstream parsing in the extension payload).
6. Expose worktree removal in the branch picker (backend already done).
7. Add stash panel.
8. Add file-level stage/unstage actions and truncation indicators.
9. Add undo/recovery actions and shared index.lock retry.

## Files likely involved

- `pi-extension-git-footer-status/index.ts` — enrich payload: upstream state, `changedFilesTruncated`, operation/conflict/stash action hints; conflict file entries already exist.
- `pi-extension-git-footer-status/tests/` — new porcelain parser and operation-detection tests (currently only `stale-ctx.test.mjs`).
- `pi-package-webui/public/app.js` — footer click actions, Git Changes dialog modes, operation panels, worktree-remove UI.
- `pi-package-webui/public/index.html` — dialog buttons/containers if static markup is needed.
- `pi-package-webui/public/styles.css` — conflict/operation/stash UI styling.
- `pi-package-webui/bin/pi-webui.mjs` — hand-written server (no build step, no source equivalent): method enforcement, git operation/fetch/stash endpoints, push classification.
- `pi-package-webui/lib/git-worktrees.mjs` and new `lib/` modules — shared mutation-lock/index.lock-retry helpers, prune support.
- `pi-package-webui/tests/http-endpoints-harness.test.mjs` — integration tests for the GET-bypass fix, merge conflict, abort/continue guards, fetch, stash, and push classification.

## Implementation status (2026-07-08)

All sections above are implemented. Mapping of each item to code and tests:

| Item | Where implemented | Tests |
|---|---|---|
| P0 method enforcement on `/api/git-workflow/*` | `GIT_WORKFLOW_READONLY_PATHS` / `GIT_WORKFLOW_MUTATING_PATHS` + router check in `bin/pi-webui.mjs` (405 + `Allow` header, guard before dispatch) | harness: GET on `initial-commit`/`push`/`add` → 405 with no repo change; POST on read-only path → 405 |
| P0 merge/conflict handling | `GET /api/git-operation` (snapshot with per-file conflict status + marker-hunk previews, binary/large/missing placeholders), `POST /api/git-operation/{stage-file,continue,skip,abort}`; operation panel in `app.js` (`renderGitOperationPanel`) opened from the `git-state`/`changes` chips; continue refused on unmerged paths (`UNMERGED_PATHS`), abort behind confirm showing root + working-tree summary; no auto-resolution anywhere | harness: merge-conflict fixture → snapshot, blocked continue, mark-resolved, continue commits; unconfirmed abort → 409; confirmed abort restores pre-merge content |
| P0 pull strategy / diverged UX | `remote.ahead/diverged` + `canPull` only when strictly behind (`readGitIncomingChanges`); `classifyGitSyncFailure` maps failures to `DIVERGED`/`NO_UPSTREAM`/`AUTH`/`NETWORK`/`DIRTY_WORKTREE`/`CONFLICTS`/`REPO_BUSY` with hints (git output forced to `LC_ALL=C` for stable classification); diverged bar in the dialog offers fetch / incoming diff / merge / rebase (confirmed via `POST /api/git-changes/integrate`) / integration worktree | harness: diverged fixture → `canPull:false`, pull → `DIVERGED` + hint, unconfirmed integrate → 409, confirmed merge integrate succeeds |
| P0 push classification + upstream state | push case classifies failures (`NON_FAST_FORWARD`, `NO_UPSTREAM` → one-click `push -u`, `AUTH`, `PROTECTED_BRANCH`), returns `branch`/`protectedBranch`; `--force-with-lease` only behind `confirmed: true`, plain `--force` never offered; extension parses `# branch.upstream` → `upstream`/`upstreamGone`/`hasRemotes` payload fields + "no upstream"/"upstream gone" sync hints | harness: push after integration returns `branch: main`, `protectedBranch: true`; extension unit tests for upstream/upstream-gone parsing |
| P1 fetch as first-class action | `POST /api/git-fetch` (`git fetch --prune`, prompts disabled, 2-min timeout, single-flight); Fetch button in the Git Changes dialog; extension startup fetch now `--prune` | harness: fetch on bare-origin fixture reveals behind/diverged state |
| P1 stash actions | `GET /api/git-stash`, `GET /api/git-stash/show` (stat + capped patch preview), `POST /api/git-stash/{save,apply,pop,drop}` (drop confirmed-only, ref format validated); stash panel in dialog "Git tools" (also opened from the `git+` chip) with expandable previews | harness: save incl. untracked → list/show → bad ref 400 → apply → unconfirmed drop 409 → confirmed drop |
| P1 rebase/cherry-pick/revert/bisect lifecycle | same operation endpoints; skip supported where valid; `POST /api/git-operation/bisect` with `good/bad/old/new/skip/reset` (reset confirmed-only) + bisect log in snapshot | harness: rebase fixture (canSkip, confirmed abort), bisect fixture (invalid verdict 400, unconfirmed reset 409, confirmed reset) |
| P1 branch/worktree safety | dirty-summary lines (from footer payload) added to switch/create confirmation; worktree health (locked/prunable/detached + reasons) shown in picker and tools; worktree **Remove** button wired to the existing guarded `DELETE /api/git-worktrees`; `GET/POST /api/git-worktrees/prune` with dry-run preview before confirmed prune (`pruneGitWorktrees` in `lib/git-worktrees.mjs`) | harness: prune dry-run, unconfirmed 409, confirmed prune; existing DELETE guards still covered |
| P2 file-level staging/discard | `POST /api/git-changes/{stage-file,unstage-file,discard-file,delete-untracked}` (path-confined, destructive ones confirmed-only, unborn-HEAD unstage fallback); per-file Stage/Unstage/Discard/Delete buttons in dialog sections | harness: stage → unstage → unconfirmed discard 409 → confirmed discard restores content; escape path rejected; delete-untracked refuses tracked files |
| P2 signing mismatch action | `GET /api/git-signing` (config + last-commit signature state + copyable suggestions, no automatic config writes); Signing block in "Git tools" | harness: signing diagnostics load, no mismatch on fixture |
| P2 submodule actions | `GET /api/git-submodules` (state per submodule), `POST /api/git-submodules/update` (confirmed-only `update --init --recursive`); Submodules block in "Git tools" | harness: `hasSubmodules:false` fixture |
| P2 tag convenience | `GET /api/git-tags` (annotated/lightweight, target, at-HEAD), `POST /api/git-tags/create` (validated name, annotated, confirmed-only, push stays separate); Tags block in "Git tools" | harness: invalid name 400, unconfirmed 409, confirmed create → annotated tag at HEAD in list |
| Undo & recovery | `GET /api/git-undo` (guards), `POST /api/git-undo/last-commit` (`reset --soft HEAD~1`, refused when pushed/no-parent/operation), `POST /api/git-undo/amend-message` (refused with staged changes), read-only `GET /api/git-reflog`; Undo block in "Git tools" with restore hint (`git reset --soft ORIG_HEAD`) | harness: full undo/amend/guard matrix incl. pushed-commit refusal |
| Truncation transparency | extension payload `changedFilesTotal`/`changedFilesTruncated`; footer changes popover shows "showing 80 of N" | extension unit test: 85-file repo → 80 shown, truncated flag |
| Large-repo perf | aux probes (stash/worktree/tag/log/signing/remotes) cached while `git status` output is unchanged (60s TTL); `submodule status --recursive` gated on `.gitmodules` existing; webui background polling already gates on document visibility | extension tests still pass against real repos |
| Unified locking | `isGitLockFailure` shared from `lib/git-worktrees.mjs`; all new mutations retry index.lock contention and report structured `REPO_BUSY` with a hint | covered indirectly by mutation harness tests |
| Extension parser tests | `parseGitPorcelainStatus`, `detectGitOperation`, `readGitSnapshot` exported; `tests/git-snapshot.test.mjs` covers statuses, renames, conflicts, detached, initial commit, upstream states, operation fixtures, cap/truncation | 9 tests green (`node --test tests/git-snapshot.test.mjs tests/stale-ctx.test.mjs`) |

Verification: `pi-package-webui` full suite passes except `mobile-static.test.mjs` and
`theme-scheme-mode.test.mjs`, which fail identically on the unmodified baseline
(pre-existing, unrelated to this work). The HTTP harness — including all new git
scenarios — passes end to end.

## Review follow-up (GIT_ACTIONS_REVIEW_GPT.md, 2026-07-08)

An external review found seven gaps against this document's own requirements. All were
verified as valid and fixed:

1. **File-level actions** — `Open file` (WebUI file viewer, tab-cwd-aware path translation)
   and `Copy path` buttons added to staged/unstaged/untracked entries; incoming entries get
   `Copy path`.
2. **Stash preview enforcement** — Apply/Pop/Drop now always fetch `git stash show --stat`
   and embed it in the confirmation (`confirmGitStashActionWithPreview`); no stash is
   modified sight-unseen.
3. **Diff truncation transparency** — `runCommand` now reports `stdoutTruncated`;
   `/api/git-changes` sections carry structured `truncated`/`capBytes`; the dialog renders a
   truncation notice with the full-diff command (copyable) and per-file Open-in-viewer escape
   hatches. Harness test: oversized-diff fixture asserts the flag.
4. **Unified lock retry** — the remaining raw `runGitWorkflowCommand` mutations (readme add,
   branch switch, init, initial-commit, main-branch, remote add, init-push, add, all commit
   variants) now go through the index.lock-retrying `runGitMutationCommand` path with
   `REPO_BUSY` classification; `init-push` additionally gets push failure classification.
5. **Submodule/tag UX** — submodule rows gained `Open tab` (Web UI tab rooted at the
   submodule) and `Copy path`; the `git+` chip now routes to the tools section matching its
   leading indicator (📦 stash, 🧩 submodules, 🔓 signing, 🏷 tags, 🌳 worktrees) instead of
   always opening stash.
6. **Fetch state in dialog** — the dialog shows the extension's tab fetch state (from the
   payload tooltip) plus the dialog's own last fetch time/summary/error
   (`gitChangesFetchStateLines`).
7. **Undo recovery hint** — after undo/amend, the success message (dialog status + event log)
   names the rewritten commit and the restore command (`git reset --soft ORIG_HEAD`) returned
   by the server.

Verification after fixes: HTTP harness passes end-to-end (including the new truncation
scenario); full suite otherwise unchanged (`mobile-static` / `theme-scheme-mode` still fail
identically on the unmodified baseline).
