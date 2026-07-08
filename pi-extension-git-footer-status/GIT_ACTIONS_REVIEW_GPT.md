Verified staged implementation across:

- `pi-extension-git-footer-status/GIT_ACTIONS_IMPROVEMENTS.md`
- `pi-extension-git-footer-status/index.ts`
- `pi-extension-git-footer-status/tests/git-snapshot.test.mjs`
- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/lib/git-worktrees.mjs`
- `pi-package-webui/public/app.js`
- `pi-package-webui/public/index.html`
- `pi-package-webui/public/styles.css`
- `pi-package-webui/tests/http-endpoints-harness.test.mjs`

Checks run:

- `git diff --check --staged` ✅
- `node --test tests/git-snapshot.test.mjs tests/stale-ctx.test.mjs` ✅ 9 passed
- `node --check public/app.js bin/pi-webui.mjs lib/git-worktrees.mjs` ✅
- `node tests/http-endpoints-harness.test.mjs` ✅

## Summary

The staged implementation is broadly functional and covers the important P0 paths: method enforcement, conflict/operation endpoints, fetch, safer pull/push classification, and many UI actions are wired.

However, `GIT_ACTIONS_IMPROVEMENTS.md` currently says **“All sections above are implemented”**, and that is too strong. I found several implementation gaps against the document’s own requirements.

## Correctness gaps found

1. **File-level actions are incomplete**
   - Required: `Stage`, `Unstage`, `Open file`, `Copy path`.
   - Implemented in `public/app.js`: `Stage`, `Unstage`, `Discard`, `Delete`.
   - Missing: `Open file`, `Copy path`.

2. **Stash preview is not enforced**
   - Requirement says preview should always be shown before apply/pop/drop.
   - UI only loads preview when the stash item is expanded; Apply/Pop/Drop remain available without forcing preview first.

3. **Diff truncation transparency is incomplete**
   - Extension payload now has `changedFilesTotal` / `changedFilesTruncated`.
   - But `/api/git-changes` diff output can still be capped/sliced without a structured truncation flag.
   - I did not see the promised “Open full diff in file viewer” escape hatch.

4. **Unified lock retry is only partially implemented**
   - New git mutation endpoints use the retry/classification path.
   - Existing workflow mutations still call raw `runGitWorkflowCommand` in places like `add`, `commit`, `main-branch`, `remote`, `init-push`, `create-pr`.
   - So “all mutating endpoints retry index.lock contention” is not true yet.

5. **Submodule/tag UX is partial**
   - Submodules show status and update action, but I did not see `Open submodule path` / `Copy path`.
   - Tag actions exist in Git tools, but clicking a tag-bearing `git+` chip opens the default stash tools, not tag details directly.

6. **Fetch state in dialog is partial**
   - Fetch button and post-fetch message exist.
   - I did not see startup fetch state / last fetch time / prior fetch error surfaced inside the dialog as described.

7. **Undo recovery hint is not fully surfaced after action**
   - Server returns recovery data like `restoreCommand`.
   - UI confirmation mentions restore, but after the action the restore/reflog recovery hint is not clearly displayed.

## Recommendation

Do not treat the staged implementation as a complete implementation of `GIT_ACTIONS_IMPROVEMENTS.md` yet. Either:

- fix the gaps above, or
- update the document’s “Implementation status” to mark those items as partial.

The P0/security-critical parts look good from targeted verification.

Confidence: **86/100**. Main confidence reducers: I did not run the full Web UI suite or a browser/manual UI session; review was static plus targeted endpoint/unit tests.
