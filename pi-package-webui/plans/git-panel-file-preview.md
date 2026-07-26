# Git Panel File Preview

Related report: [Git Panel File Preview report](../reports/git-panel-file-preview.html)

## Goal and classification

Make a file row in the side-panel Git section open the same WebUI file previewer used by the File section.

**Classification: lightweight.** Repository evidence confirmed one cohesive frontend interaction change with one shared path-resolution helper, one renderer update, one cursor rule, and one focused test file. It does not add a server route, dependency, migration, deployment step, persistence contract, or material security boundary. The preliminary lightweight classification is retained; the main agent is the implementation and integration owner.

## Success criteria

- Clicking a Git file row invokes the existing `openFileInViewer` flow.
- Enter and Space provide the same primary activation without repeat-triggered request bursts.
- Right-click, Context Menu, and Shift+F10 Git actions remain available.
- Repo-root-relative Git paths are translated to a containing tab's cwd-relative viewer path.
- The active tab is preferred when it contains the file; otherwise an eligible repository tab is selected and activated first.
- Path resolution fails closed when no open tab contains the file, and stale tab switches produce visible feedback.
- Server-side workspace and symlink containment remain authoritative and unchanged.
- Focused checks pass; unrelated baseline failures are identified separately.
- Two fresh, provider-diverse independent reviews assess the integrated change and every finding receives a disposition.

## Scope and non-goals

In scope:

- Git side-panel file-row click and keyboard activation.
- Shared Git-root-to-viewer-path translation for side-panel and existing Git Changes dialog opens.
- Multi-tab selection, Windows separator/case handling, stale-tab feedback, accessibility labeling, cursor affordance, and focused static/unit coverage.

Non-goals:

- Previewing a deleted worktree file from Git object data.
- Changing the file-content API, server trust boundary, editor/save behavior, Git context-menu actions, or mobile overlay layout.
- Introducing a DOM/browser harness solely for this localized change.
- Fixing the pre-existing `mobile-static.test.mjs` typography-floor failure.

## Design and implementation

### Shared viewer target

`gitFileViewerTarget(repoRelPath, root, candidates)` converts the Git path into an absolute normalized comparison path, then selects the first open tab whose cwd contains it. The active tab is evaluated first. Windows drive paths compare case-insensitively; returned viewer paths retain their original spelling. Prefixes include a trailing slash so sibling paths cannot match accidentally. No match returns `null`.

### Open flow

`openGitFileInViewer(...)`:

1. Resolves a safe target with `gitFileViewerTarget`.
2. Optionally closes the Git Changes dialog.
3. Switches to the owning tab when needed and verifies the switch succeeded.
4. Keeps the side panel available and invokes the existing `openFileInViewer(target.path)` function.

The existing `/api/files/content` endpoint remains the actual read path, and the server's workspace/symlink containment remains unchanged.

### Git row interaction

`renderGitPanelFile` keeps its context-menu binding and adds:

- `role="button"` and a preview-oriented accessible label;
- click activation;
- Enter/Space activation with `event.repeat` suppression;
- a pointer cursor and tooltip text that explains both preview and Git actions.

## Implementation map

- `public/app.js` — row activation, shared target resolver/open helper, Git Changes dialog reuse, Windows drive comparison, and stale-tab feedback.
- `public/styles.css` — Git file rows use the pointer cursor for their primary open action.
- `tests/git-panel-file-preview-static.test.mjs` — executes the production path normalizer/resolver source for active/fallback/Windows/root/fail-closed cases and asserts preview wiring, keyboard hardening, stale-tab feedback, and bounded CSS matching.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `node --check public/app.js` | Pass | Exit 0 after implementation and accepted fixes. |
| `node tests/git-panel-file-preview-static.test.mjs` | Pass | Active/fallback tab resolution, Windows drive case, filesystem root, fail-closed behavior, UI wiring, repeat suppression, and cursor rule passed. |
| `node tests/git-panel-render-stability-static.test.mjs` | Pass | Existing Git render stability contracts remain intact. |
| `node tests/side-panel-context-menu-static.test.mjs` | Pass | Existing side-panel context-menu behavior remains intact. |
| `git diff --check` | Pass | No whitespace errors. |
| `npm test` | Baseline-limited | 53 of 54 test files pass. `mobile-static.test.mjs:298` rejects `public/styles.css:7343` (`font-size: 0.72rem`), which is present in `HEAD` and untouched by this feature. |
| Live browser interaction | Not run | The repository has no DOM/browser behavioral harness for this monolithic side-panel surface; source contracts and independent reviews are the available evidence. |

## Independent review trace

Parent run: `98ef99a0-1658-4931-8b41-b76c0a880605` (fresh-context parallel review, both acceptance-not-required).

### Reviewer A — Moonshot Kimi

- Runtime: `openrouter/moonshotai/kimi-k3:high`, child 0.
- Focus: correctness, path safety, async/tab behavior, security, and regression coverage.
- Verdict: no blocker; architecture and acceptance compliant; confidence 88/100.
- Confirmed server confinement, target ordering, stale-context protection, changes-dialog reuse, related test passes, and the baseline nature of the mobile typography failure.

### Reviewer B — Anthropic Claude Opus

- Runtime: `anthropic/claude-opus-5:high`, child 1.
- Focus: interaction, accessibility, multi-tab behavior, error handling, maintainability, and test adequacy.
- Verdict: no blocker; recommended two medium fixes plus low-severity hardening; confidence 88/100.
- Confirmed path-prefix safety, context-menu preservation, server trust boundary, test discovery, and 53/54 package test files passing.

The implementation provider was `openai-codex/gpt-5.6-sol`, so the two reviewers are provider-diverse from each other and from implementation.

## Finding dispositions

| Finding | Disposition | Evidence and rationale |
|---|---|---|
| CSS cursor assertion could span into later rules. | **Accepted · fixed** | Regex is bounded to the `.git-side-panel-file` rule body with `[^}]*`. |
| A stale/failed tab switch returned silently. | **Accepted · fixed** | The post-switch guard now emits a visible error event before returning. |
| Windows drive-letter case mismatch could fail closed unnecessarily. | **Accepted · fixed** | Drive-path comparisons are case-insensitive while returned paths preserve original spelling; focused coverage uses `C:\\Repo` vs `c:\\repo`. |
| Enter/Space key repeat could issue duplicate opens. | **Accepted · fixed** | Keyboard activation ignores `event.repeat`; the contract test asserts it. |
| Test stub did not exactly match production path normalization. | **Accepted · fixed** | The test now evaluates the real `normalizeFileTreePath` source. |
| Deleted rows advertise a worktree preview that cannot exist. | **Deferred** | This is pre-existing in the Git Changes dialog and needs a separate decision about disabling open or previewing Git object/base content. Current failure is contained and visibly reported. |
| Missing/unknown repo root now fails closed with a generic containment message. | **Deferred** | Successful Git panel/change payloads provide a root; fail-closed is safer than guessing. Message refinement is optional and outside the requested interaction. |
| `aria-haspopup="menu"` coexists with primary preview activation. | **Deferred** | It preserves discoverability of keyboard/right-click Git actions. A broader context-menu semantics pass should address this consistently rather than hiding the menu affordance here. |
| Git row is a `div[role=button]` rather than a native button. | **Deferred** | Current Enter/Space/focus behavior is explicit and verified structurally. Converting the grid row to a native button would broaden CSS/interaction scope; repeat risk was fixed. |
| Mobile overlay can cover the viewer after opening. | **Deferred · pre-existing** | The File section has the same overlay behavior; changing both entry points is a separate responsive UX fix. |
| No DOM-level click/focus test. | **Deferred limitation** | The repository uses static frontend contracts for this surface; resolver logic is executed directly and reviewers independently inspected the wiring. |

## Residual risks and rollback

- No live browser run verifies pointer, focus, or mobile stacking behavior.
- Deleted worktree paths produce the existing visible file-open error rather than a historical preview.
- Git rows retain a context-menu popup hint alongside their primary preview action.
- The unrelated typography-floor assertion prevents a green full-suite status.

Rollback is localized: remove the Git row activation/role changes, restore `cursor: context-menu`, restore the former inline `openGitFileFromChanges` translation, and remove the focused test file.

## Usage

Open the Git section, expand a repository, and click a changed, staged, conflicted, or untracked file that exists in the worktree. The standard WebUI viewer opens it, switching to an eligible terminal tab first when the current tab's cwd does not contain the path. Right-click or use Context Menu / Shift+F10 for Git actions.
