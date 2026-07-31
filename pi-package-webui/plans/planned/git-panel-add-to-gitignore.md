# Git Panel “Add to .gitignore” Action

Related report: [Git Panel Add to .gitignore report](../../reports/git-panel-add-to-gitignore.html)

## Goal and classification

Add a right-click/keyboard context-menu action to every file and directory row in the side-panel **Git** tree that safely appends the selected repository-relative target to the repository-root `.gitignore` and refreshes the Git panel.

**Classification: complex.** Repository evidence confirms two meaningful implementation slices (browser context-menu/action state and server filesystem mutation), a new browser/server contract, path-confinement and special-pattern safety, and distinct frontend/backend verification. These satisfy the complex-feature criteria despite the small visible UI surface.

**Integration owner:** main Pi agent. Only the integration owner updates this plan, integrates worker results, dispositions reviewer findings, and publishes the report.

## Success criteria

- Every non-repository Git-tree file and directory row offers **Add to .gitignore** through right-click and the existing keyboard context-menu equivalent.
- The browser sends the selected repository-relative `path` and `kind` to one dedicated mutation endpoint, shows accurate added/already-present feedback, and refreshes Git-panel/footer state after success.
- File entries are root-anchored literal patterns such as `/build/output.log`; directory entries are root-anchored and end in `/`, such as `/build/`.
- Path separators are normalized to `/`; Git pattern metacharacters and spaces are escaped so a literal selected path cannot become a broader wildcard pattern.
- Empty paths, NUL/CR/LF content, absolute paths, traversal outside the repository, unsupported kinds, and the repository root are rejected.
- The repository-root `.gitignore` is created when absent, appended without rewriting existing logical content, preserves the existing newline convention, and receives at most one copy of the normalized entry under repeated requests.
- Existing `.gitignore` symlinks and non-regular files are rejected so the endpoint cannot write through an unsafe target.
- The endpoint does not stage `.gitignore`, untrack already tracked files, or write outside the selected repository.
- Existing Stage, Unstage, Discard, Delete Untracked, Git row rendering, queue changes already present in the dirty tree, and unrelated package behavior remain intact.
- Focused frontend/backend tests, syntax checks, cross-workstream checks, and `git diff --check` pass or any unrelated environmental failure is recorded precisely.
- Two fresh provider-diverse reviewers assess the integrated implementation and every finding receives a recorded disposition.

## Scope and non-goals

In scope:

- One file/directory Git context-menu item and action configuration in `public/app.js`.
- One POST route under `/api/git-changes/` in `bin/pi-webui.mjs`.
- Safe target normalization, literal gitignore-pattern generation, duplicate detection, newline-preserving append/create behavior, and root `.gitignore` target validation.
- Focused static frontend coverage and real HTTP/Git fixture coverage for files, directories, duplicates, escaping, traversal, invalid kinds, creation, and unsafe `.gitignore` targets.
- Integration evidence, two independent reviews, finding dispositions, and a self-contained report.

Non-goals:

- Removing a pattern from `.gitignore` or editing arbitrary ignore files.
- Automatically staging `.gitignore`, calling `git rm --cached`, or changing tracked-file state.
- Determining whether an existing broader pattern already semantically ignores the target; idempotence is against the exact normalized entry.
- Adding a repository-root context action.
- Replacing the Git context menu, adding confirmation UI, or changing its keyboard/focus behavior.
- Refactoring shared Git path helpers or unrelated queue/compaction work already present in the dirty tree.

## Approved decisions and invariants

1. **Action visibility:** add the action to every `kind === "file"` or `kind === "folder"` menu, including staged, changed, conflicted, and untracked categories. Repository menus remain unchanged.
2. **Endpoint:** `POST /api/git-changes/add-to-gitignore` accepts `{ path, kind }`, where `kind` is exactly `file` or `folder`.
3. **Entry format:** root-anchor the normalized literal path with `/`; append `/` only for a folder. Escape backslash, `*`, `?`, `[`, `]`, and spaces within path content so a selected literal path cannot widen into a glob.
4. **Path trust boundary:** derive the canonical repository root from the selected tab, reject control characters and empty/root targets, and confine the normalized target to that root before generating an entry.
5. **Write target:** mutate only `<root>/.gitignore`. Reject an existing symbolic link or non-regular file. Temporary files, if used for atomic replacement, must remain inside the root and be cleaned on failure.
6. **Idempotence:** serialize `.gitignore` mutations per repository within the server process and compare exact logical lines. A repeated normalized entry returns `added: false` without changing bytes.
7. **Content preservation:** preserve existing bytes/text and detect its newline convention (`CRLF` when present, otherwise `LF`). Add a separator newline only when required and terminate the newly appended entry with the chosen newline.
8. **Response:** return `{ root, path, kind, entry, added, changes }`. `changes` is the refreshed authoritative Git snapshot; no staging command runs.
9. **Feedback:** the browser distinguishes newly added from already present using response data, then uses the existing Git-panel refresh/footer invalidation flow.
10. **Dirty-tree preservation:** workers must preserve all pre-existing queue/compaction edits in `bin/pi-webui.mjs`, `public/app.js`, and `tests/http-endpoints-harness.test.mjs`; they must not normalize, revert, or claim those hunks.

## Architecture and interface

### Browser flow

```text
Git file/folder row
  -> existing right-click or Shift+F10 menu
  -> Add to .gitignore
  -> POST /api/git-changes/add-to-gitignore { path, kind }
  -> added/already-present event
  -> force Git repository refresh + footer refresh
```

`gitPanelContextMenuItems(context)` owns visibility and maps the selected row kind to `ignore-file` or `ignore-folder`. The existing three-argument `runGitPanelAction(card, action, path)` signature maps those internal action IDs to the approved `{ path, kind }` request and response-derived success feedback while preserving the shared busy-state and error flow.

### Server flow

```text
selected tab cwd
  -> canonical Git root
  -> validate kind + confined repo-relative path
  -> generate root-anchored literal pattern
  -> per-root serialized read/validate/append
  -> refresh readGitChanges(root)
  -> structured response
```

The filesystem mutation never invokes Git, never stages `.gitignore`, and fails closed for an unsafe root `.gitignore` object.

## Execution DAG and workstreams

The repository is already dirty, so workers run **sequentially in the shared worktree**. Their source write boundaries do not overlap. The main agent remains the integration owner and sole plan/report writer.

### Wave 1 — WS-BE: safe `.gitignore` mutation contract

- **Worker identity/prerequisites:** backend implementation worker; read this approved plan and inspect the current dirty diff before editing.
- **Approved context/non-goals:** implement only the server contract and real HTTP coverage above; do not stage files, refactor unrelated Git helpers, or alter queue behavior.
- **Write boundary:** `bin/pi-webui.mjs` and `tests/http-endpoints-harness.test.mjs` only.
- **Forbidden/shared paths:** all `public/`, `lib/`, plan/report, package metadata, and other test files. Existing queue hunks inside allowed files are shared baseline content and must be preserved.
- **Deliverables:** safe entry generator and serialized root `.gitignore` mutation, POST route, structured response, and fixture tests covering creation, file/folder forms, duplicates, literal escaping, newline behavior, traversal/control/kind rejection, and symlink/non-file refusal where portable.
- **Validation:** `node --check bin/pi-webui.mjs`; `node tests/http-endpoints-harness.test.mjs`. Record Windows cleanup locks separately from assertion failures.
- **Unique handoff:** `plans/archive/handoffs/git-panel-add-to-gitignore-backend-attempt-2.md`.
- **Stop/escalate:** any need to alter the response/interface, stage `.gitignore`, weaken path or symlink safety, add dependencies, or edit outside the boundary.

### Wave 2 — WS-FE: Git-tree action and focused contract tests

- **Worker identity/prerequisites:** frontend implementation worker; WS-BE source and handoff must exist, and this plan remains authoritative.
- **Approved context/non-goals:** wire the approved endpoint into existing context-menu/action behavior only; do not redesign the menu, add confirmation, or change unrelated queue/composer code.
- **Write boundary:** `public/app.js` and new `tests/git-panel-gitignore-static.test.mjs` only.
- **Forbidden/shared paths:** backend, styles, HTML, plans/reports, package metadata, and all other tests. Existing queue/composer hunks inside `public/app.js` are shared baseline content and must be preserved.
- **Deliverables:** action on file/folder menus including staged rows, request body with `path`/`kind`, busy state, accurate added/already-present feedback, refresh behavior, and focused static coverage for visibility, route/body, feedback, and regressions.
- **Validation:** `node --check public/app.js`; `node tests/git-panel-gitignore-static.test.mjs`; `node tests/mobile-static.test.mjs`.
- **Unique handoff:** `plans/archive/handoffs/git-panel-add-to-gitignore-frontend.md`.
- **Stop/escalate:** any endpoint mismatch, product wording/confirmation decision, context-menu redesign, or edit outside the boundary.

### Wave 3 — central integration and review

- Integration owner inspects actual diffs and handoffs, verifies boundaries and preservation of pre-existing dirty hunks, and runs focused/cross-workstream checks.
- Two fresh read-only reviewers from distinct provider families inspect the integrated implementation against this plan, including correctness, security, edge cases, tests, maintainability, and UX/accessibility.
- Integration owner records one disposition per finding, applies only verified accepted fixes, reruns affected checks, archives this plan, and publishes the linked report.

## Acceptance and validation contract

Required focused checks:

```sh
node --check bin/pi-webui.mjs
node --check public/app.js
node tests/git-panel-gitignore-static.test.mjs
node tests/mobile-static.test.mjs
node tests/http-endpoints-harness.test.mjs
git diff --check
```

Cross-workstream/full checks:

```sh
npm test
```

Behavioral evidence expected from the HTTP harness:

- missing `.gitignore` is created with one root-anchored file entry;
- a folder receives a trailing slash;
- repeat requests are byte-idempotent and report `added: false`;
- existing LF and CRLF content remains intact with the selected newline convention;
- special path characters are escaped literally and the intended path is ignored without broad wildcard behavior;
- traversal, absolute/root/control-character paths, invalid kinds, and unsafe `.gitignore` object types fail without outside writes;
- the response contains the refreshed Git snapshot and does not stage `.gitignore`.

UI evidence expected from static tests:

- repository context menus do not gain the action;
- every file/folder category, including the staged early-return branch, includes the action;
- request body carries both `path` and `kind`;
- success feedback distinguishes `added` from already present;
- existing load/footer refresh and busy/error behavior remains in the action flow.

Report validation after review:

```sh
python3 <html-report-skill>/scripts/validate_report.py reports/git-panel-add-to-gitignore.html --strict
```

A live browser interaction is desirable but may be unavailable because the repository primarily uses static browser contracts. Any unexecuted UI behavior is disclosed rather than inferred.

## Worker and integration trace

### Attempt 1 — blocked before implementation

- Parent run `eeb35124-21d1-44b3-8497-ee45ecc381ab`, WS-BE only; WS-FE remained unstarted.
- The fresh child could not resolve the feature-workflow skill and stopped before source/test edits. The integration owner inspected its blocked handoff and the unchanged allowed-file diff before approving replacement.
- Preserved handoff: `plans/archive/handoffs/git-panel-add-to-gitignore-backend.md`.

### WS-BE attempt 2 — qualifying backend outcome

- Parent chain `3dff1452-8775-4675-acd2-98f0e685f036`, step 1.
- Runtime: `openai-codex/gpt-5.6-sol:high` with the feature workflow injected explicitly.
- Handoff: `plans/archive/handoffs/git-panel-add-to-gitignore-backend-attempt-2.md`.
- Actual source boundary inspected: `bin/pi-webui.mjs`, `tests/http-endpoints-harness.test.mjs` only. Existing queue-delete hunks were preserved and excluded from this feature's attribution.
- Integrated result includes strict target/kind validation, literal root-anchored patterns, process serialization, byte-idempotent appends, newline preservation, unsafe-target refusal, the mutation route, and real HTTP/Git assertions.

### WS-FE — qualifying browser outcome

- Parent chain `3dff1452-8775-4675-acd2-98f0e685f036`, step 2.
- Runtime: `anthropic/claude-opus-5:medium` with the feature workflow injected explicitly.
- Handoff: `plans/archive/handoffs/git-panel-add-to-gitignore-frontend.md`.
- Actual source boundary inspected: claimed Git-panel hunks in `public/app.js` plus new `tests/git-panel-gitignore-static.test.mjs`; existing queue/composer/subagent hunks were preserved and excluded from attribution.
- Integrated result exposes the action for every file/folder category, preserves repository menus and destructive-action behavior, sends `{ path, kind }`, reports added/already-present results, and reuses Git-panel/footer refresh behavior.

The main OpenAI Codex agent remains the integration owner and independently inspected both handoffs, actual diffs, boundaries, validation evidence, and unresolved items.

## Integration acceptance results (pre-review)

| Check | Result | Evidence |
|---|---|---|
| `node --check bin/pi-webui.mjs` | Pass | Current integrated server syntax exits 0. |
| `node --check public/app.js` | Pass | Current integrated browser syntax exits 0. |
| `node tests/git-panel-gitignore-static.test.mjs` | Pass | Focused menu/action/route/feedback/busy/refresh contracts pass. |
| Git panel context/render/mobile regressions | Pass | `mobile-static`, `git-panel-render-stability-static`, and `side-panel-context-menu-static` pass. |
| Canonical HTTP harness | Environment-blocked | The real run reaches final cleanup and exits 1 on Windows `EBUSY`; it is not counted as passing. |
| Diagnostic HTTP harness | Feature assertions pass; later baseline failure | A temporary non-repository copy suppressed only known Windows permission/path assertions and made cleanup non-fatal. It continued beyond every new `.gitignore` fixture assertion, then failed later on an unrelated configured-Python-runner slash-direction expectation. The symlink fixture was skipped because Windows returned `EPERM`; non-regular target refusal executed. |
| `npm test` | Baseline-limited: 78/84 files pass | The focused Gitignore test passes. Six failures are Windows/environmental or unrelated harness failures: ConPTY availability, durable supervisor shutdown marker, HTTP cleanup `EBUSY`, Unix-socket `EACCES`, symlink `EPERM`, and launch-slot root discovery. |
| `git diff --check` | Pass | No whitespace errors in the current combined dirty tree. |
| Live browser interaction | Not run | The repository's monolithic side-panel behavior is covered by static contracts; this limitation remains for review/report disclosure. |

## Integration self-audit dispositions

| Finding | Disposition | Evidence and rationale |
|---|---|---|
| The plan's illustrative four-argument `runGitPanelAction(..., kind)` would break the existing pinned three-argument action signature. | **Accepted design adjustment** | Two internal action IDs preserve the existing signature while sending the exact approved `{ path, kind }` HTTP body. Focused and mobile static checks pass. |
| The existing Git fixture cleanup omitted `fileDiffTab`, leaving one known tab under `gitFixturesRoot`. | **Accepted and fixed** | The close list now includes `fileDiffTab`. Canonical cleanup still encounters a broader Windows `EBUSY`, so the environmental limitation remains disclosed. |
| Cross-process writers can race the process-local serializer. | **Deferred residual risk** | The approved scope guarantees in-process idempotence and fail-closed symlink/identity checks without adding a cross-process lock. |

## Rollback guidance

1. Remove the `ignore` context-menu item and `runGitPanelAction` configuration.
2. Remove `POST /api/git-changes/add-to-gitignore`, its helpers/serialization state, and focused HTTP assertions.
3. Remove the focused static test file.
4. Leave any user-created `.gitignore` entries untouched; rollback of runtime user data is manual because the endpoint intentionally edits repository content.

## Risks and open evidence

- Gitignore syntax has platform/path edge cases; root anchoring and literal escaping reduce unintended breadth, while real Git fixture tests must verify representative special characters.
- Process-local serialization does not prevent a separate editor/process from modifying `.gitignore` concurrently. Atomic replacement or conflict-aware append behavior must avoid following symlinks and minimize lost updates; the residual external-concurrency limitation will be documented.
- Adding a tracked path to `.gitignore` does not untrack it; success feedback/report guidance must state this.
- The full HTTP harness has previously encountered Windows temporary-directory `EBUSY` cleanup failures after assertions; such cleanup failures must not be reported as a passing run.
- The current worktree contains unrelated queue/compaction edits. Boundary inspection and `git diff` comparison are mandatory before counting either worker complete.

## Decision and progress record

- [x] User authorized the feature and later authorized proceeding after subagent diagnostics.
- [x] Repository evidence confirmed a complex frontend/backend/security feature.
- [x] Mandatory worker/reviewer capability preflight passed: executable workers/reviewers, async support, parent session, supervisor channel, and provider-diverse review slots are available.
- [x] Scope, endpoint, pattern, idempotence, safety, and validation decisions recorded.
- [x] Initial chain attempt `eeb35124-21d1-44b3-8497-ee45ecc381ab` classified: WS-BE stopped before source edits because the fresh child could not resolve the feature-workflow skill; its blocked handoff and unchanged allowed-file diff were inspected, WS-FE remained unstarted, and a replacement of both failed/unstarted slots was approved with the skill injected explicitly.
- [x] WS-BE implementation outcome and handoff inspected.
- [x] WS-FE implementation outcome and handoff inspected.
- [x] Integrated checks completed with Windows/environmental limitations recorded above.
- [ ] Independent review quorum completed and findings dispositioned.
- [ ] Accepted fixes revalidated.
- [ ] Plan archived and final HTML report linked/validated.
