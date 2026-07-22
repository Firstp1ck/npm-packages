# WebUI Git Side Panel Plan

**Status:** Complete — global repository deduplication independently reviewed and reported
**Owner / integration:** Primary Pi agent (sole writer)
**Package:** `pi-package-webui`
**Report:** [`../reports/webui-git-side-panel.html`](../reports/webui-git-side-panel.html)

## Objective and success criteria

Add a collapsible **Git** section to the WebUI side panel that represents every open terminal tab/group, discovers every unique Git repository represented by that group, and exposes an expandable changed-file tree plus recent history.

Success means:

1. The side panel contains a top-level Git section that follows the existing collapsed-section behavior.
2. Repository cards are rendered directly without a redundant terminal/session disclosure; all open tabs contribute Git roots, but each canonical repository root appears only once globally even when several tabs, terminals, or terminal groups use it. Each visible title is the repository-root or cwd basename rather than a session title.
3. Only one repository card can be expanded at a time across the Git section.
4. Expanding a repository loads current local Git status and recent history immediately; data older than five minutes is refreshed when that repository is expanded again.
5. Changes render as accessible folder/file trees split into staged, tracked/unstaged, untracked, and conflicted states, including additions/deletions where Git can report them.
6. Changes and History remain directly visible, while repository/path actions move to accessible right-click context menus (also available with Shift+F10 or the Context Menu key); destructive discard/delete actions remain explicitly confirmed.
7. Recent history shows bounded commit metadata and can open a selected commit in the existing Git diff dialog or an equivalent read-only detail view.
8. Non-Git directories and repository-loading errors remain visible without breaking other groups.
9. Focused endpoint/UI assertions and package checks pass, with any pre-existing failure documented.
10. An independent cross-provider review has no unresolved material findings, and the linked HTML report is current and strictly validated.

## Scope

### In scope

- New top-level side-panel Git section and nested terminal-group/repository disclosure cards.
- Local, read-only Git status/history snapshot endpoint designed for the compact panel (no full file contents).
- Folder-tree construction in the browser from repo-relative changed paths.
- Changes/History tab state, repository expansion state, and five-minute cache freshness.
- Existing diff-dialog reuse for working-tree review, plus read-only commit inspection.
- Safe staging and explicitly confirmed destructive file actions.
- Stage All and Unstage All repository actions.
- Static/UI, HTTP endpoint, and helper-level regression tests.
- README feature and endpoint documentation.

### Non-goals

- Automatic network `git fetch`; “fetch/refresh” means loading local repository state from the WebUI server.
- Background polling while a repository card is collapsed.
- Commit, push, pull, merge, rebase, branch switching, or worktree management from this compact panel.
- Deleting untracked directories recursively.
- Replacing the existing full Git Changes dialog or Guided Git workflow.
- Persisting repository expansion across browser reloads; the five-minute cache is page-local.

## Approved decisions and assumptions

- **Grouping:** terminal groups are discovery inputs only and are never rendered. Deduplicate candidate working directories globally before discovery, then render one card per canonical Git root across all open tabs/terminals/groups.
- **Changes scope:** include the hierarchical Changes tree, additions/deletions, View Diff, refresh, stage/unstage path, Stage All, and Unstage All.
- **History scope:** include a functional recent-commit list in this release.
- **Destructive actions:** expose discard and untracked-file delete in the tree, always through existing confirmation UX and server-side `confirmed: true` enforcement.
- **Expansion:** only one repository is expanded at a time across the Git section.
- **Freshness:** load immediately on first expansion; on later expansion refresh only when the cached snapshot is at least five minutes old. Manual Refresh always reloads.
- **Network behavior:** local status/history reads only; no implicit remote network operation.
- **History bound:** return the latest 30 first-parent-visible commits (normal `git log` ordering) with hash, abbreviated hash, author, authored timestamp, and subject.
- **Repository identity:** canonical Git root is the cache and disclosure identity; duplicate cwd candidates are deduplicated globally before discovery, and different cwd candidates resolving to the same canonical root collapse into one card.

## Architecture and interfaces

### Server snapshot

Add a compact `GET /api/git-panel?tab=<tabId>` endpoint returning:

```text
root, cwd, branch, generatedAt, summary
changes[]: path, oldPath, index/worktree status, category flags, additions, deletions, binary
history[]: hash, shortHash, author, authoredAt, subject
```

The endpoint uses bounded local Git commands (`status --porcelain=v1 -z`, staged/unstaged `diff --numstat`, and bounded `log`) and does not return full diffs or untracked file contents.

Add `GET /api/git-commit?tab=<tabId>&hash=<full-hash>` for a bounded, read-only commit patch used by the existing diff renderer. Validate hashes and resolve them within the selected tab repository.

Add an Unstage All mutation route. Existing guarded path mutation routes remain the authority for stage, unstage, discard, and delete; Stage All reuses the existing guarded add-all implementation.

### Browser state

Maintain page-local Git panel state:

- repository discovery per globally unique working directory represented by an open tab;
- one global expanded repository key;
- snapshot/error/loading cache keyed by canonical root, with `loadedAt`;
- active `changes | history` tab per repository;
- busy action keys so duplicate mutations cannot race;
- repository request serials to reject stale responses.

Repository discovery uses one representative tab for each distinct cwd across all open tabs and terminal groups. Successful responses deduplicate globally by canonical root. Non-Git cwd results render one compact unavailable state per distinct cwd.

### UI flow

```text
Open Git side-panel section
  -> render current terminal groups
  -> expand one repository candidate
     -> collapse previously expanded repository
     -> load local snapshot if missing or >= 5 minutes old
     -> Changes: categorized folder/file trees and actions
     -> History: bounded commit list and commit inspection
```

### Mutation flow

```text
safe action (stage/unstage)
  -> guarded existing endpoint
  -> force-refresh expanded repository snapshot

destructive action (discard/delete)
  -> browser confirmation with repository/path/command impact
  -> server requires confirmed: true and validates repo-relative path/type
  -> force-refresh snapshot and existing footer Git payload
```

### Files and ownership

| File | Responsibility |
|---|---|
| `pi-package-webui/bin/pi-webui.mjs` | Compact status/history/commit readers and endpoint wiring; unstage-all action |
| `pi-package-webui/public/index.html` | Top-level Git section container and accessible labels |
| `pi-package-webui/public/app.js` | Group/repository discovery, cache/expansion state, tree/history rendering, actions |
| `pi-package-webui/public/styles.css` | Compact tree, tabs, disclosure cards, responsive/action states |
| `pi-package-webui/tests/http-endpoints-harness.test.mjs` | Snapshot/history/commit/mutation endpoint behavior and safety |
| `pi-package-webui/tests/mobile-static.test.mjs` | Side-panel structure, state model, action/refresh source assertions |
| `pi-package-webui/README.md` | User-visible feature and endpoint behavior |
| `plans/webui-git-side-panel.md` | Canonical decisions, execution, verification, and review record |
| `reports/webui-git-side-panel.html` | Final audit report |

No concurrent writer is permitted in the package worktree. The primary Pi agent integrates all implementation and review fixes.

## Ordered work items

| # | Work item | Dependency | Status |
|---|---|---|---|
| 1 | Record approved grouping, action, history, and freshness decisions | User approval | Complete |
| 2 | Implement compact Git panel/history/commit server readers and routes | 1 | Complete |
| 3 | Implement side-panel markup, state, grouping, tree/history rendering, and actions | 2 | Complete |
| 4 | Add responsive/accessibility styles and README documentation | 3 | Complete |
| 5 | Add focused server/static tests and run package verification | 2–4 | Complete with pre-existing baseline failure noted below |
| 6 | Run independent cross-provider review and resolve material findings | 5 | Complete — final PASS |
| 7 | Produce, link, and strictly validate the HTML report | 6 | Complete |
| 8 | Record and implement user-requested hierarchy/action simplification | User feedback | Complete |
| 9 | Add focused static interaction assertions and rerun package checks | 8 | Complete with unrelated concurrent baseline failure noted below |
| 10 | Obtain two fresh independent cross-provider reviews and resolve findings | 9 | Complete — Anthropic and Moonshot/Kimi PASS |
| 11 | Refresh and strictly validate the linked HTML report | 10 | Complete |
| 12 | Add explicit collapsed/expanded arrows to Git directories | User feedback | Complete |
| 13 | Verify and independently review folder-disclosure refinement | 12 | Complete — Anthropic and Moonshot/Kimi PASS |
| 14 | Refresh and strictly validate final artifacts | 13 | Complete |
| 15 | Deduplicate repository candidates and cards globally across tabs/terminals/groups | User feedback | Complete |
| 16 | Add regression coverage and run focused/package verification | 15 | Complete with unrelated concurrent baseline failure noted below |
| 17 | Obtain two fresh cross-provider reviews and refresh final artifacts | 16 | Complete — Anthropic and Moonshot/Kimi PASS; strict report validation PASS |

## Acceptance tests

- Top-level Git section is collapsed by default and participates in the existing one-expanded-section behavior.
- Discovery inputs are derived from `tabCwdGroups()` and remain synchronized after tab/group changes.
- Repeated tabs/terminals with the same cwd produce one discovery candidate and one visible row.
- Different cwd candidates resolving to the same canonical Git root produce one visible repository card globally.
- A custom mixed-cwd group still contributes every unique repository without duplicate canonical roots.
- Expanding repository B collapses repository A.
- First expansion loads immediately; re-expansion before five minutes uses cache; re-expansion at/after five minutes reloads.
- Collapsed repositories do not poll or schedule background refreshes.
- Status parser handles spaces and rename records from NUL-delimited porcelain output.
- Changes tree preserves full repo-relative paths and renders folder hierarchy without unsafe HTML interpolation.
- Staged, unstaged, untracked, and conflicted states are distinguishable; additions/deletions are shown when available.
- View Diff opens the existing working-tree dialog for the repository’s representative tab.
- Stage/unstage path and all operations mutate only the selected repository and refresh its snapshot.
- Discard/delete require client confirmation and server confirmation; delete refuses tracked files and directories.
- History is bounded and commit inspection rejects malformed/unresolvable hashes.
- Non-Git cwd and unborn repositories render a useful state.
- `node --check`, focused tests, `npm run check`, and `git diff --check` results are recorded.
- HTML report strict validation passes.

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Custom groups combine unrelated repositories | High | Discover per distinct cwd and deduplicate only after canonical-root resolution |
| Full diff endpoint is too heavy for the side panel | High | Add compact bounded status/numstat/history endpoint without contents |
| Mixed staged/unstaged state is misrepresented | High | Preserve index and worktree status independently; a path may appear in both relevant categories |
| Destructive tree actions are triggered accidentally | High | Explicit confirmation text plus existing server-side confirmation/type/path checks |
| Stale async response overwrites a newer repo snapshot | Medium | Per-repository request serial and busy state |
| Five-minute refresh becomes background polling | Medium | Refresh only on expansion or manual action; no timers while open/collapsed |
| Duplicate cwd/root entries cause redundant requests/cards | Medium | Deduplicate cwd candidates globally before discovery, cache by canonical root, and collapse all resolved candidates globally after discovery |
| Commit patch or history output becomes unbounded | Medium | Fixed commit count and existing diff output caps/truncation metadata |
| Static tests miss browser interaction regressions | Medium | Add helper/VM tests where practical and require independent source review; report remaining browser-automation gap |

## Verification record

- `node --check pi-package-webui/public/app.js` — **passed**.
- `node --check pi-package-webui/bin/pi-webui.mjs` — **passed**.
- `node pi-package-webui/tests/http-endpoints-harness.test.mjs` — **passed**, including compact root/status/history snapshots, additions/deletions, no-content payload contract, full-hash commit inspection, malformed-hash rejection, Stage All, and Unstage All.
- `node pi-package-webui/tests/mobile-static.test.mjs` — all new Git side-panel assertions and the interface font-size floor passed; the run then failed at the tracked optional-dependency version invariant (`@firstpick/pi-extension-git-footer-status` expected `^0.4.0`, actual `^0.4.1`).
- `npm run check` from `pi-package-webui/` — syntax and 27/28 test files passed. `mobile-static.test.mjs` failed only on the same tracked dependency-version mismatch after reaching all feature assertions.
- Baseline confirmation: `HEAD:pi-package-webui/package.json` already contains `^0.4.1` while `HEAD:pi-package-webui/tests/mobile-static.test.mjs` expects `^0.4.0`; this feature changes neither manifest nor lockfile.
- `git diff --check -- pi-package-webui plans/webui-git-side-panel.md` — **passed**.
- Two initial focused/full commands were invoked from the monorepo root with package-local paths/scripts and failed with `MODULE_NOT_FOUND` / missing script; rerunning with `pi-package-webui/` paths produced the results above.

## Independent review

**Status:** Complete — final PASS.
**Reviewer:** `anthropic/claude-opus-4-8:high`, fresh read-only subagent contexts.
**Initial artifact:** `.pi-subagents/artifacts/outputs/544988a1-1407-45d8-9959-d94fd280e67e/.pi-subagents/reviews/webui-git-side-panel.md`
**Initial verdict:** Approve with minor follow-ups; no blocker/high findings; confidence 88/100.
**Final artifact:** `.pi-subagents/artifacts/outputs/a50eb970-a917-4cdf-b8b5-a6430977f745/.pi-subagents/reviews/webui-git-side-panel-final.md`
**Final verdict:** **PASS**; no blocker, high, or medium findings; confidence 90/100.

### Initial finding dispositions

| Severity | Finding | Disposition |
|---|---|---|
| Medium | `renderTabs()` rebuilt the complete Git panel during polling, risking focus/select/scroll disruption. | **Fixed.** `renderGitPanel()` now returns before DOM replacement while the top-level Git section is collapsed; expansion remains the render/load trigger. |
| Medium | A cwd first discovered as non-Git remained unavailable for the entire page session after a later `git init`. | **Fixed.** Reopening the top-level Git section explicitly retries unavailable discoveries without adding polling. |
| Low | `role="tree"` lacked `treeitem` children. | **Fixed.** Removed the incomplete ARIA role and retained native details/summary disclosure semantics. |
| Low | Mixed staged/unstaged files showed combined numstats in both categories. | **Fixed.** The server returns separate staged/unstaged additions, deletions, and binary flags; the browser renders category-specific values. |
| Low | Folder Stage from the Changes category also included untracked descendants without stating that scope. | **Fixed.** Folder action labels/tooltips now explicitly say they stage every changed and untracked path under the folder. |
| Low | Page-local discovery/view/group maps accumulated stale keys. | **Fixed.** Expanded-section rendering prunes candidate, group, root-cache, and active-view entries no longer represented by open tabs. |
| Low | Idle file actions used very low opacity. | **Fixed.** Resting opacity increased from `0.28` to `0.72`; hover/focus/touch remain fully visible. |

### Post-fix verification

- Syntax checks — **passed**.
- `node pi-package-webui/tests/http-endpoints-harness.test.mjs` — **passed**, now including mixed staged/unstaged category-specific numstats.
- `node pi-package-webui/tests/mobile-static.test.mjs` — all feature and review-fix assertions passed before the same confirmed pre-existing dependency-version mismatch at line 1729.
- `git diff --check -- pi-package-webui plans/webui-git-side-panel.md` — **passed**.
- Resuming the initial async reviewer failed because the generated recovery descriptor contained runtime-unsupported acceptance fields; a new fresh read-only Opus reviewer was launched instead.
- Final fresh Opus review — **PASS**, no blocker/high/medium findings; low notes limited to richer tab/tabpanel linkage and safe-by-refusal deletion of unusually quoted filenames.
- `python3 /home/firstpick/.pi/agent/skills/html-report/scripts/validate_report.py reports/webui-git-side-panel.html --strict` — **PASS**, zero warnings/errors (1,399 words, one overview table, four accessible tabs/panels, one accessible architecture diagram, no remote dependencies).
- Final report: [`../reports/webui-git-side-panel.html`](../reports/webui-git-side-panel.html).

## User-feedback refinement decisions

The screenshots showed two separate hierarchy levels with the same repository name and inline controls consuming most of each narrow file row. The first level was the terminal/session group disclosure from the original design; it is useful for data discovery but not useful as a visible parent when repository cards already provide the actionable identity.

Approved refinement behavior:

- Flatten visible output to repository cards. Terminal groups remain discovery inputs only; duplicate cwd candidates are removed globally before discovery and canonical roots are deduplicated globally before rendering. No terminal/session title or grouping is rendered.
- Use `basename(canonical Git root)` as every discovered repository title and `basename(cwd)` for unresolved/non-Git candidates; keep the full path as secondary text and tooltip.
- Keep one globally expanded repository.
- Remove the repository toolbar, folder action buttons, and file action buttons.
- Right-clicking a repository header opens View Diff, Refresh, Stage All, and Unstage All.
- Right-clicking a folder or file opens only actions valid for its category. Discard/delete remain file-only and retain the existing confirmation and server guards.
- Provide keyboard-equivalent menus through Shift+F10 and the Context Menu key, with Escape and arrow-key navigation.
- Keep the Changes/History tabs, but compact repository metadata to branch and refresh time; do not repeat the root path inside expanded content.
- Give file names the flexible width previously consumed by inline buttons. Preserve full paths in tooltips and start top-level folders expanded while nested folders start collapsed to reduce density.

Refinement acceptance checks:

- No visible Git card title is derived from `tab.title`, custom session title, or `terminalDisplayGroupTitle()`.
- A one-repository terminal group produces one disclosure, not a terminal parent plus repository child.
- Mixed-repository custom groups still render every unique canonical root.
- No `.git-side-panel-file-actions`, folder Stage button, staging select, Run, View Diff, or Refresh toolbar is rendered.
- Repository, folder, and file context menus expose the same safe actions as before, with keyboard access and destructive confirmation unchanged.
- File rows reserve flexible space for the filename and remain usable at narrow side-panel widths.
- Every directory summary renders an explicit blue disclosure arrow: right-facing while collapsed and rotated downward while expanded; the decorative glyph is hidden from assistive technology because native <code>details</code>/<code>summary</code> already communicates state.

## Refinement verification and independent reviews

Verification after the interaction refinement:

- `node --check pi-package-webui/public/app.js` — **passed**.
- `node --check pi-package-webui/bin/pi-webui.mjs` — **passed**.
- `node pi-package-webui/tests/http-endpoints-harness.test.mjs` — **passed**.
- `node pi-package-webui/tests/mobile-static.test.mjs` — all Git-panel refinement assertions passed before the suite reached an unrelated concurrent package/lock invariant at line 1738.
- `npm run check` — syntax and 27/28 test files passed; the same unrelated `mobile-static.test.mjs` assertion failed because the current concurrent `package-lock.json` places optional companion packages in root `dependencies` as well as `optionalDependencies`.
- `git diff --check` over the Git-panel source, tests, README, plan, and report — **passed**.
- Strict HTML report validation — **passed** with zero errors/warnings (1,711 words, one overview table, four accessible tabs/panels, one accessible SVG diagram, and no local/remote dependencies).

Two qualifying fresh read-only reviewers completed independently in run `2a3dd688-caef-452c-a9ca-e8ede236d703`:

| Provider / model | Artifact | Verdict |
|---|---|---|
| Anthropic — `claude-opus-4-8:high` | `.pi-subagents/artifacts/outputs/2a3dd688-caef-452c-a9ca-e8ede236d703/.pi-subagents/reviews/webui-git-side-panel-refinement-anthropic-final.md` | **PASS**, confidence 84/100 |
| Moonshot via OpenRouter — `moonshotai/kimi-k3:high` | `.pi-subagents/artifacts/outputs/2a3dd688-caef-452c-a9ca-e8ede236d703/.pi-subagents/reviews/webui-git-side-panel-refinement-kimi-final.md` | **PASS**, confidence 90/100 |

Finding disposition:

- A first failed review attempt identified polling-driven context-menu dismissal, dropped keyboard focus, and incomplete tab semantics. These were fixed before the qualifying final reviews by suppressing panel rebuilds while the menu is open, restoring trigger focus, and adding complete tab/tabpanel linkage plus arrow/Home/End navigation.
- Both final reviewers found no blocker, high, or medium implementation defects. Accepted low notes: one defensive menu-close call is redundant, file rows use a focusable generic element rather than a list/tree role, and fixed tab IDs depend on the intentional one-expanded-repository invariant.
- The Anthropic reviewer correctly flagged unrelated concurrent changes in `package.json`, `package-lock.json`, subagent helpers/tests, and shared files. They are explicitly outside this feature, were not edited for this refinement, and must not be attributed to or committed as part of the Git-panel change.
- Residual test risk remains the absence of live browser automation for actual right-click/Shift+F10 positioning and focus behavior; focused static assertions and two source reviews cover the implemented contract.

## Folder-disclosure arrow verification and review

- Every recursively rendered folder summary now includes an explicit `span.git-side-panel-folder-chevron` marked `aria-hidden="true"`.
- CSS keeps the glyph right-facing while collapsed and rotates only the current open folder's direct-child chevron by 90°, without replacing native `details`/`summary` semantics.
- `node --check public/app.js` and `node tests/http-endpoints-harness.test.mjs` — **passed**.
- New static arrow assertions passed before the unrelated concurrent package-lock invariant at `mobile-static.test.mjs:1739`.
- Two fresh independent read-only reviews in run `df7f60b8-8907-4b77-816e-38d64655328e` returned **PASS** with no blocker/high/medium findings:
  - Anthropic `claude-opus-4-8:high`, confidence 88/100: `.pi-subagents/artifacts/outputs/df7f60b8-8907-4b77-816e-38d64655328e/.pi-subagents/reviews/webui-git-folder-arrow-anthropic.md`
  - Moonshot/Kimi `moonshotai/kimi-k3:high`, confidence 92/100: `.pi-subagents/artifacts/outputs/df7f60b8-8907-4b77-816e-38d64655328e/.pi-subagents/reviews/webui-git-folder-arrow-kimi.md`
- Final HTML report strict validation — **passed** with zero errors/warnings (1,780 words, four accessible tabs/panels, one accessible SVG diagram, and no local/remote dependencies).
- Residual limitation: the disclosure behavior is source/static-test reviewed rather than exercised by a live browser automation harness.

## Global repository deduplication verification and reviews

Verification after the cross-tab/cross-terminal deduplication change:

- `node --check pi-package-webui/public/app.js` — **passed**.
- The executable VM regression in `mobile-static.test.mjs` proves repeated cwd tabs across groups produce one candidate and distinct cwd candidates resolving to `/repo` produce one `root:/repo` card.
- `node pi-package-webui/tests/mobile-static.test.mjs` — all Git-panel and new deduplication assertions passed before the same unrelated concurrent package-lock invariant at line 1751.
- `npm run check` — syntax and 27/28 test files passed; only the same unrelated `mobile-static.test.mjs` package-lock invariant failed.
- `git diff --check` over the affected browser source, markup, tests, plan, and report — **passed**.
- Strict HTML report validation — **passed** with zero errors/warnings (1,938 words, one overview table, four accessible tabs/panels, one accessible SVG diagram, and no local/remote dependencies).

Two qualifying fresh read-only reviewers completed independently in run `0d0c74cc-586f-48eb-8316-bb9cd01e4310`:

| Provider / configured model | Artifact | Verdict |
|---|---|---|
| Anthropic — `claude-opus-4-8`, high thinking | `.pi-subagents/artifacts/outputs/0d0c74cc-586f-48eb-8316-bb9cd01e4310/.pi-subagents/reviews/webui-git-global-dedup-anthropic-final.md` | **PASS**, confidence 92/100 |
| Moonshot via OpenRouter — `moonshotai/kimi-k3`, high thinking | `.pi-subagents/artifacts/outputs/0d0c74cc-586f-48eb-8316-bb9cd01e4310/.pi-subagents/reviews/webui-git-global-dedup-kimi-final.md` | **PASS**, confidence 87/100 |

Finding dispositions:

- **Accepted and fixed:** obsolete `groupKey` metadata on globally merged candidates/cards was removed; focused syntax/static checks reran successfully up to the unrelated lockfile invariant.
- **Accepted and fixed:** `#gitPanelGroups` still announced “by terminal group” despite the flattened list. Its accessible label is now “Git repositories,” with a regression assertion.
- **Rejected as unnecessary complexity:** suppressing unresolved subdirectory rows by path-prefix inference. Different cwd candidates cannot be proven to share a canonical root until discovery resolves, and prefix inference would be incorrect for symlinks/worktrees; the brief self-correcting discovery state is preferable.
- **Deferred, pre-existing/non-material:** validating `response.data.root === card.root` during snapshot loads and adding live-browser coverage for representative-tab closure. Existing request serials, live candidate reconstruction, server-side tab-to-root resolution, VM coverage, and both reviews support the current behavior.
- **No action:** duplicate candidate calculation per render and the unavailable-card fallback argument are cosmetic/micro-performance notes with no material user impact.
- Both final reviewers found no blocker, high, or medium defects. Residual risk remains the lack of live browser automation and the unrelated package-lock invariant in the shared worktree.

## Completion checklist

- [x] Original decisions, implementation, verification, review, and report completed.
- [x] User-feedback refinement decisions recorded.
- [x] Simplified implementation and focused verification complete.
- [x] Two fresh independent reviews completed and findings resolved.
- [x] Plan and validated HTML report refreshed for the final interaction model.
- [x] Explicit directory disclosure arrows implemented and focused assertions passed.
- [x] Folder-arrow refinement independently reviewed and final artifacts refreshed.
- [x] Global cross-tab/cross-terminal repository deduplication implemented.
- [x] Global deduplication regression checks pass up to the unrelated shared-worktree invariant.
- [x] Two fresh qualifying reviews complete; final HTML artifact refreshed and strictly validated.
