# Git Panel File Preview and Changes View

Related report: [Git Panel File Preview report](../reports/git-panel-file-preview.html)

## Goal and current classification

Make a file row in the side-panel Git section open the standard WebUI file viewer and default that viewer to the relevant Git changes for the selected category.

**Classification: complex follow-up.** The initial click-to-open feature was lightweight and is already integrated. The requested changes view adds a read-only server contract plus file-specific Git commands, a third file-viewer mode, category-aware rendering, missing-file behavior, frontend/backend tests, and responsive styling. This crosses the browser/server contract and has two independently verifiable implementation slices, so repository evidence overrides the preliminary lightweight classification for this follow-up.

**Integration owner:** main Pi agent. Only the integration owner updates this plan, dispositions, and the final report.

## Success criteria

- Activating an existing Git file row still opens the standard WebUI file viewer.
- Git-originated opens default to a visible **Changes** mode while retaining Source and Markdown Preview where applicable.
- Staged rows show only index-vs-HEAD changes for that file.
- Changes rows show only worktree-vs-index changes for that file.
- Conflicted rows show the bounded conflict diff returned by Git, with a readable raw fallback for combined diff syntax.
- Untracked rows show their entire verified text content as added lines; binary/unreadable files show an explicit notice.
- A deleted tracked file can still open a read-only changes view even when live file content no longer exists.
- File-specific diff requests are bounded, read-only, path-confined, textconv/external-diff disabled, and category allowlisted.
- A missing/empty diff or request failure is shown inside the viewer without silently replacing the source view.
- Existing Git context-menu actions, tab selection, stale-context checks, editing, saving, Markdown preview, and normal File-section opens remain unchanged.
- Focused backend and frontend checks pass; unrelated working-tree changes and baseline failures are preserved and reported separately.
- Two fresh provider-diverse reviewers assess the integrated implementation and all findings receive dispositions.

## Scope and non-goals

In scope:

- Read-only `GET /api/git-file-diff` for one repository-relative path and one Git category.
- Category-specific diff commands with three lines of context and bounded output.
- A file-viewer Changes mode using the existing split Git diff renderer and styles.
- Untracked whole-file added-line rendering, deleted-file diff-only opening, loading/error/empty/truncated states, and focused tests.
- Updating the existing feature plan/report and review trace.

Non-goals:

- Editing a diff, staging/unstaging from the file viewer, or changing destructive Git actions.
- Historical/base file restoration or a three-way merge editor.
- Replacing the existing Git Changes dialog.
- Persisting a changes snapshot after save; reopening from Git refreshes it.
- Fixing the shared mobile overlay behavior or unrelated typography baseline failure.
- Modifying the unrelated numpad-decimal work currently present in `public/app.js` and `tests/numpad-decimal-input-static.test.mjs`.

## Approved decisions and invariants

1. **Default mode:** Git-originated opens select Changes by default. Source remains available when live content exists; Markdown Preview remains available for Markdown source.
2. **Category mapping:** side-panel `staged` maps to API `staged`; `changes` maps to `unstaged`; `conflicted` maps to `conflicted`; `untracked` maps to `untracked`.
3. **Endpoint shape:** `GET /api/git-file-diff?path=<repo-relative>&category=<allowlisted>` returns `{ root, path, category, label, command, diff, truncated, capBytes }`; untracked responses additionally carry verified file metadata/content instead of invoking Git diff.
4. **Tracked commands:** use file-scoped `git diff` with `--no-ext-diff`, `--no-textconv`, `--no-color`, `--unified=3`, explicit source/destination prefixes, and `-- <normalized path>`. Staged adds `--cached`; conflicted adds `--cc` and may render raw if the two-column parser cannot represent combined hunks.
5. **Trust boundary:** `getGitRoot` plus `normalizeGitRelativePath` remain authoritative before Git receives a path. Server workspace/realpath checks remain authoritative for live source content.
6. **Bounded output:** reuse the existing Git diff timeout/output cap and surface truncation in the viewer.
7. **Missing live file:** if source loading fails but a tracked diff exists, open Changes mode read-only. If both source and changes fail, report the failure and do not create a misleading viewer state.
8. **Snapshot semantics:** the displayed diff is the bounded snapshot loaded at open time. Unsaved source edits may make it stale; reopening the Git row refreshes it.
9. **Dirty-worktree safety:** preserve the existing numpad-decimal hunks in `public/app.js` byte-for-byte and do not modify `tests/numpad-decimal-input-static.test.mjs`.

## Architecture and interfaces

### Backend read contract

`readGitFileDiff(cwd, requestedPath, requestedCategory)`:

- resolves the canonical Git root;
- allowlists the category;
- normalizes and confines the repo-relative path;
- for untracked, verifies membership through `git ls-files --others --exclude-standard -- <path>` and reads bounded file metadata/content through the existing helper;
- for tracked categories, executes one bounded file-scoped Git diff and returns raw unified output plus truncation metadata.

The router exposes it only as read-only GET. No mutation or new localhost-only exception is introduced.

### Browser viewer state

`activeFileViewer.gitChanges` holds the Git source category, repo path, label, command, diff/content metadata, truncation state, and any visible error. Normal File-section opens omit this state and therefore never show the Changes toggle.

The file viewer adds:

- a `Changes` mode button shown only for Git-originated opens;
- a dedicated changes surface in the existing content area;
- category/command metadata and loading, empty, error, binary, raw, split-grid, and truncation states;
- source/preview mode behavior unchanged for live files.

### Opening sequence

```text
Git row activation
  -> resolve eligible tab/cwd
  -> switch tab if required
  -> request live source + file-specific Git changes
  -> build activeFileViewer with gitChanges snapshot
  -> default mode = changes
  -> render split diff or category-specific fallback
```

## Execution DAG and workstreams

### Wave 1 — WS-BE: file-specific read API

- **Worker:** backend worker, sequential shared worktree.
- **Prerequisites:** this plan approved; current unrelated dirty state recorded.
- **Write boundary:** `bin/pi-webui.mjs`, `tests/http-endpoints-harness.test.mjs` only.
- **Forbidden/shared paths:** all `public/` files, plans, reports, package metadata, and `tests/numpad-decimal-input-static.test.mjs`.
- **Deliverables:** safe category/path normalization, `readGitFileDiff`, GET route, tracked/untracked/missing/escape/invalid-category endpoint coverage.
- **Validation:** `node --check bin/pi-webui.mjs`; `node tests/http-endpoints-harness.test.mjs`.
- **Handoff:** `/tmp/git-file-viewer-changes-backend.md`.
- **Stop/escalate:** any new mutation route, dependency, category semantics change, output-cap change, or interface incompatible with this plan.

### Wave 2 — WS-FE: file-viewer Changes mode

- **Worker:** frontend worker, sequential after WS-BE.
- **Prerequisites:** WS-BE implementation and handoff inspected; endpoint contract available.
- **Write boundary:** `public/index.html`, `public/app.js`, `public/styles.css`, `tests/git-panel-file-preview-static.test.mjs` only.
- **Forbidden/shared paths:** backend files, plans/reports, package metadata, and `tests/numpad-decimal-input-static.test.mjs`.
- **Special preservation rule:** do not alter or remove the pre-existing numpad-decimal hunks in `public/app.js`.
- **Deliverables:** Changes mode controls/surface, category-aware Git open context, endpoint loading, split/raw/untracked/error/deleted/truncated rendering, and focused static/unit contracts.
- **Validation:** `node --check public/app.js`; `node tests/git-panel-file-preview-static.test.mjs`; `node tests/mobile-static.test.mjs` with baseline disposition if unchanged.
- **Handoff:** `/tmp/git-file-viewer-changes-frontend.md`.
- **Stop/escalate:** changes to save semantics, staging actions, normal File-section default modes, mobile panel behavior, or unrelated app.js regions.

### Wave 3 — integration and acceptance

- Integration owner inspects both actual diffs, validates write boundaries and unrelated-hunk preservation, and runs focused/cross-workstream checks.
- Two fresh provider-diverse reviewers inspect the integrated implementation.
- Integration owner dispositions every finding, applies only accepted fixes, reruns affected checks, and updates this plan/report.

## Acceptance checks

Planned checks:

```sh
node --check bin/pi-webui.mjs
node --check public/app.js
node tests/http-endpoints-harness.test.mjs
node tests/git-panel-file-preview-static.test.mjs
node tests/git-panel-render-stability-static.test.mjs
node tests/side-panel-context-menu-static.test.mjs
node tests/mobile-static.test.mjs
npm test
git diff --check
python3 /home/firstpick/.pi/agent/skills/html-report/scripts/validate_report.py reports/git-panel-file-preview.html --strict
```

The known `mobile-static.test.mjs` typography-floor assertion at `public/styles.css:7343` existed before this follow-up. It remains an unrelated baseline failure unless current evidence shows otherwise.

## Rollback and residual-risk plan

Rollback order:

1. Remove the Changes mode DOM/CSS and viewer-state/rendering branches.
2. Restore Git opens to `openFileInViewer(target.path)` without Git context.
3. Remove `GET /api/git-file-diff` and its helper/tests.
4. Restore this report to the prior click-to-open-only state.

Expected residual risks:

- Combined conflict diffs may use raw text rather than the two-column renderer.
- No live browser/DOM harness currently executes this monolithic viewer interaction.
- Large single-file diffs remain bounded and may be truncated.
- A saved source can make the open-time changes snapshot stale until reopened.

## Worker and integration trace

### WS-BE — file-specific read API

- Parent chain: `d870b3a3-b943-47ca-88c5-60246c51d1c2`, step 1.
- Runtime: `openai-codex/gpt-5.6-terra:xhigh`.
- Handoff: `/tmp/git-file-viewer-changes-backend.md`.
- Result: complete; write boundary respected (`bin/pi-webui.mjs`, `tests/http-endpoints-harness.test.mjs`).
- Integration inspection confirmed category/path confinement, bounded file-scoped commands, GET routing, structured untracked content, and real endpoint coverage.

### WS-FE — file-viewer Changes mode

- Parent chain: `d870b3a3-b943-47ca-88c5-60246c51d1c2`, step 2.
- Runtime: `anthropic/claude-opus-5:xhigh`.
- Handoff: `/tmp/git-file-viewer-changes-frontend.md`.
- Result: complete; write boundary respected (`public/index.html`, `public/app.js`, `public/styles.css`, `tests/git-panel-file-preview-static.test.mjs`).
- Integration inspection confirmed mode isolation, category mapping, split/raw/untracked/deleted rendering, request identity guards, and preservation of the unrelated numpad-decimal hunks.

The main OpenAI Codex integration owner inspected both actual diffs, applied bounded fixes, reran affected checks, and retained ownership of this plan/report.

## Acceptance results

| Check | Result | Evidence |
|---|---|---|
| `node --check bin/pi-webui.mjs` | Pass | Current integrated server syntax exits 0. |
| `node --check public/app.js` | Pass | Current integrated frontend syntax exits 0. |
| `node tests/http-endpoints-harness.test.mjs` | Pass | Real staged, unstaged, conflicted, untracked, oversized, empty, deleted, invalid-category, and path-escape requests pass. |
| `node tests/git-panel-file-preview-static.test.mjs` | Pass | Viewer DOM/modes, category mapping, API use, rendering states, stale request guards, normal-open isolation, and CSS contracts pass. |
| Git render/context-menu/numpad regression checks | Pass | `git-panel-render-stability-static`, `side-panel-context-menu-static`, and unrelated `numpad-decimal-input-static` pass. |
| `npm test` | Baseline-limited | 54 of 55 test files pass. Only `mobile-static.test.mjs:298` fails on the pre-existing `font-size: 0.72rem` rule present in `HEAD`. |
| `git diff --check` | Pass | No whitespace errors. |
| Live browser/DOM run | Not run | No behavioral browser harness exists for this monolithic viewer surface. |
| Strict HTML validator | Pass | `validate_report.py reports/git-panel-file-preview.html --strict` reports PASS with no warnings. |

## Independent review trace

Parent review run: `dc645da5-2074-4adc-b51b-107ba69ff7b8` (fresh-context parallel, read-only, acceptance not required).

### Reviewer A — Moonshot Kimi

- Runtime: `openrouter/moonshotai/kimi-k3:high`, child 0.
- Focus: backend/security/contract correctness, bounds, Git semantics, races, and plan compliance.
- Verdict: approve; no blocker; confidence 88/100.
- Independently reran syntax, focused tests, full package suite, diff check, and a live `git diff --cc` semantics probe.

### Reviewer B — Anthropic Opus

- Requested Google route fell back at runtime; authoritative status reports `anthropic/claude-opus-4-8:high`, child 1.
- Focus: viewer UX/accessibility, mode state, rendering states, async races, isolation, tests, and maintainability.
- Verdict: no blockers; confidence 88/100.
- Independently reran syntax and focused frontend/backend checks.

The primary implementation/integration provider is OpenAI Codex. The qualifying reviewers are provider-diverse from the primary and from each other (Moonshot via OpenRouter + Anthropic). The Anthropic reviewer shares a provider family with the secondary WS-FE implementation worker; this is disclosed, while the required primary-provider distinction remains satisfied.

## Finding dispositions

| Finding | Disposition | Evidence and rationale |
|---|---|---|
| Untracked whole-file content was not bounded in the new endpoint path. | **Accepted · fixed before review** | New endpoint passes the 500 KB diff cap into the reusable reader; cap+1 harness case proves no content read/return. |
| Deleted Markdown could expose an enabled Preview button without source. | **Accepted · fixed before review** | Preview is disabled whenever live source is unavailable. |
| Same-path staged/unstaged requests could race. | **Accepted · fixed before review** | Per-changes-request identity is stored in the loading snapshot and checked before apply. |
| Slow source/deleted fallback could overwrite a newer same-tab viewer. | **Accepted · fixed after review** | A per-open identity guards source success and deleted fallback; close invalidates pending opens. |
| Source/Preview selection bar survived entry into Changes mode. | **Accepted · fixed after review** | Entering Changes clears the previous source selection. |
| No real conflicted-category endpoint assertion. | **Accepted · fixed after review** | Existing merge-conflict fixture now asserts `git diff --cc` command/output and combined hunk syntax. |
| Deleted viewer stored unused `sourceError`. | **Accepted · fixed after review** | Dead field removed. |
| Non-ASCII untracked filename lookup can fail because of pre-existing Git quote-path output. | **Deferred** | Fails closed with an in-viewer error; fixing the shared helper is separate scope. |
| Oversized/binary untracked content returns `ok:true` with `data.error`. | **Accepted design** | Separates a valid verified path from unavailable preview content; frontend and harness pin the envelope. |
| Changes snapshot becomes stale after source save. | **Accepted design** | Open-time snapshot semantics are explicit; reopen the Git row to refresh. |
| No live DOM/browser interaction test. | **Deferred limitation** | Static/vm contracts, real HTTP/Git fixtures, and two independent reviews are the available repository-standard evidence. |
| Mobile typography-floor failure. | **Rejected as feature regression** | The same `0.72rem` declaration is present in `HEAD`; this feature adds no sub-floor font literal. |

## Progress and evidence record

- [x] Initial lightweight click-to-open feature integrated and reviewed in commit `0b5f219`.
- [x] Follow-up repository investigation completed; frontend/backend contract crossing confirmed.
- [x] Follow-up reclassified as complex and decomposed into backend and frontend workstreams.
- [x] WS-BE implementation and handoff integrated.
- [x] WS-FE implementation and handoff integrated.
- [x] Cross-workstream acceptance checks completed.
- [x] Independent review quorum and finding dispositions completed.
- [x] Final report updated and strictly validated.
