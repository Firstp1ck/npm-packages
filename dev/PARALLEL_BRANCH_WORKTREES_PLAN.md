# Parallel Git Branch Worktrees Plan

## Goal

Allow a user to work on multiple Git branches for the same repository on the same machine in parallel, across:

- native Pi TUI;
- Pi agent/session/runtime behavior;
- Pi Web UI local/remote multi-tab workflows.

The implementation should use Git worktrees rather than switching the active branch in a shared checkout when the user wants parallel work.

## Repository grounding

Current architecture already has most of the primitives needed:

- `pi-package-webui/bin/pi-webui.mjs`
  - Imports `SessionManager` from `@earendil-works/pi-coding-agent`.
  - Maintains one Web UI tab per spawned `pi --mode rpc` process.
  - `createTab(...)` resolves a tab `cwd`, builds Pi RPC args, optionally passes `--session`, and spawns the process with `cwd: tabCwd`.
  - `PATCH /api/tabs/<id>` changes a tab cwd by restarting its Pi RPC process while preserving the session file when possible.
  - Existing Git endpoints already cover changes, branches, workflow add/commit/push/PR helpers.
- `pi-package-webui/public/app.js`
  - Creates tabs by posting `{ cwd }` to `/api/tabs`.
  - Groups tabs by cwd and renders cwd/git footer metadata.
  - Has a footer branch picker and guided Git workflow UI that currently focus on the active tab cwd.
- `pi-extension-git-footer-status/index.ts`
  - Already reports richer Git state including `worktreeCount` and structured Web UI footer payloads.
- Pi SDK/docs
  - `cwd` is central to session/runtime creation, resource loading, built-in tool path resolution, and session storage.
  - `SessionManager` stores `cwd` in the session header and exposes `forkFrom(sourcePath, targetCwd, ...)` per docs, which is a good fit for opening a worktree with cloned/forked context.
  - `AgentSessionRuntime` can replace active sessions and rebuild cwd-bound runtime state for new/resume/fork/import flows.
- Native TUI docs/code paths
  - `FooterDataProvider` already handles worktree `.git` files and can update cwd with `setCwd(...)`.
  - `InteractiveMode` rebuilds cwd-bound extension contexts after session replacement.
- `pi-package-remote-webui/index.ts`
  - `/remote` starts Web UI with `--cwd ctx.cwd`, so remote should inherit whichever checkout/worktree the launching Pi session is in.

## Design principle

For parallel branch work, do **not** run `git switch` in an already-active shared checkout by default. Instead:

1. discover the current repository;
2. create or find a Git worktree for the target branch;
3. open that worktree as a separate Pi session/tab/process with its own cwd;
4. optionally fork/clone the current session context into the new cwd.

In-place branch switching can remain available as an explicit lightweight action, but the safe/default parallel action should be “open branch in worktree”.

## Proposed shared model

Add a shared worktree abstraction, preferably in Pi core if upstream changes are acceptable, or first as a WebUI/local utility if prototyping locally.

```ts
type GitWorktreeDescriptor = {
  repoRoot: string;
  commonGitDir: string;
  path: string;
  branch: string | null;
  head: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  current: boolean;
  createdByPi?: boolean;
  label?: string;
};

type CreateWorktreeRequest = {
  sourceCwd: string;
  branchName: string;
  baseRef?: string;
  path?: string;
  sessionMode: "empty" | "clone-current" | "fork-current" | "parent-only";
  openMode: "current-process" | "new-webui-tab" | "print-command";
};
```

Use Git as the source of truth:

- `git rev-parse --show-toplevel`
- `git rev-parse --git-common-dir`
- `git worktree list --porcelain`
- `git symbolic-ref --short HEAD`
- `git status --porcelain=v1 --branch`

A small Pi registry can augment Git data with labels/session associations, but should not be required to recover state.

## Default worktree path strategy

Recommended default:

```text
<parent-of-main-checkout>/<repo-name>.worktrees/<branch-slug>
```

Example:

```text
/home/firstpick/npm-packages
/home/firstpick/npm-packages.worktrees/feature-parallel-branches
```

Rationale:

- avoids nested worktrees inside the main checkout;
- keeps all parallel checkouts discoverable near the repository;
- avoids writing under `.git` internals;
- works with Web UI cwd tabs and Pi session cwd-based storage.

Allow explicit custom paths for advanced users.

## Core/Pi agent implementation plan

### 1. Add a shared Git worktree service

Target if changing upstream Pi core:

- `packages/coding-agent/src/core/git-worktrees.ts` or equivalent;
- export from `@earendil-works/pi-coding-agent`.

Local prototype target if staying in this repo first:

- `pi-package-webui/lib/git-worktrees.mjs`;
- later upstream to Pi core.

Responsibilities:

- discover repo/worktree metadata from a cwd;
- list worktrees;
- validate branch names and paths;
- create a new worktree:
  - existing branch: `git worktree add <path> <branch>`;
  - new branch: `git worktree add -b <branch> <path> <baseRef>`;
- detect branch already checked out elsewhere and return “open existing worktree” guidance;
- remove/prune worktrees only with explicit clean/force checks;
- return structured errors usable by TUI/RPC/Web UI.

### 2. Session creation/fork behavior for a new worktree

For Web UI and TUI parity, support these session modes:

- `empty`: start a new session in the target worktree cwd;
- `parent-only`: new session with `parentSession` metadata pointing to the source session;
- `clone-current`: duplicate the active session branch into a session file for the target cwd;
- `fork-current`: fork from a selected/active entry into a session file for the target cwd.

Preferred default: `clone-current` for “continue this task on a new branch”, with `empty` exposed as an option.

Implementation direction:

- Use existing `SessionManager.forkFrom(sourceSessionFile, targetCwd, sessionDir?)` if it fits.
- If it cannot clone the current active path exactly, add a core helper such as `SessionManager.cloneToCwd(sourceSessionFile, targetCwd, { leafId })`.
- Ensure the new session header stores `cwd: <worktree path>`.

### 3. Optional core CLI support

Consider adding `pi --cwd <path>` to core Pi CLI.

Benefits:

- easier process spawning from TUI/extensions;
- consistent with `pi-webui --cwd`;
- makes generated “open this worktree” commands portable.

Without this, commands can still use `cd <path> && pi`, and Web UI can keep spawning processes with `spawn(..., { cwd })`.

## Web UI implementation plan

### 1. Backend API

Add endpoints in `pi-package-webui/bin/pi-webui.mjs`:

- `GET /api/git-worktrees?tab=<id>`
  - list worktrees for the active tab repo;
  - include current tab cwd, current branch, common git dir, occupied branches.
- `POST /api/git-worktrees`
  - body: `{ tab, branchName, baseRef?, path?, sessionMode?, openTab?: true }`;
  - creates or opens a worktree;
  - if `openTab`, creates a new Web UI tab with `cwd: worktreePath` and optional prepared session file.
- `POST /api/git-worktrees/open`
  - body: `{ tab, path, sessionMode? }`;
  - opens an existing worktree in a new tab or changes current tab cwd.
- `DELETE /api/git-worktrees`
  - body: `{ tab, path, force?: false, prune?: false, confirmed: true }`;
  - only after clean/no-active-tab checks.

Add events:

- `webui_worktree_created`
- `webui_worktree_opened`
- `webui_worktree_removed`

Extend tab metadata with optional Git workspace info:

```ts
{
  gitWorkspace: {
    repoRoot,
    worktreePath,
    branch,
    worktreeCount,
    isMainWorktree
  }
}
```

### 2. Browser UI surfaces

In `pi-package-webui/public/app.js`:

- Add “New branch worktree…” to:
  - new-tab menu;
  - command palette;
  - footer branch picker;
  - workspace dashboard Git section.
- Update existing footer branch picker:
  - show branches checked out in another worktree;
  - offer “Open existing worktree” instead of failing;
  - make “Create branch in new worktree” the recommended path for parallel work;
  - keep “switch current worktree branch” as an advanced/explicit action.
- Update guided Git workflow:
  - PR branch creation should offer worktree mode before `git switch -c` in the current cwd;
  - if user selects worktree mode, create/open new tab and continue commit/PR flow there.
- Add a worktree badge in the footer/workspace dashboard.
- For multiple tabs in the same repo but different worktrees, group by repository first and cwd/worktree second if useful.

### 3. Remote Web UI behavior

No separate remote architecture is required if the local Web UI backend owns the worktree APIs. Remote clients hit the same endpoints.

Safety defaults:

- creating/opening worktrees can be allowed for authenticated/trusted Web UI clients;
- removing worktrees should require explicit confirmation and probably localhost-only unless you choose otherwise;
- never auto-install dependencies in a new worktree from a remote client.

## Native TUI implementation plan

### 1. Add a native command

Add `/worktree` (or `/branches`) in Pi core/native TUI.

Suggested subcommands/flows:

- `/worktree` opens a selector:
  - list current repo worktrees;
  - create branch worktree;
  - open existing worktree in current Pi process;
  - print command to open in another terminal/tmux pane.
- `/worktree new <branch> [base]`
- `/worktree open <branch-or-path>`
- `/worktree list`

### 2. Opening modes

Native TUI is a single interactive process, so “parallel” needs either another terminal/process or a replacement of the current runtime.

Support both:

- **Open here**: switch current Pi runtime/session cwd to the selected worktree.
- **Open separately**: print a ready command, e.g. `cd <worktree> && pi --session <prepared-session>` or `pi --cwd <worktree> --session <prepared-session>` if `--cwd` is added.

Optional later enhancement: detect tmux and offer to spawn a new pane/window.

### 3. Footer and status

Existing `FooterDataProvider` already handles worktree `.git` files. Add small UX polish:

- show a worktree marker when cwd is a linked worktree;
- include worktree path in `/session` or `/worktree list` output;
- refresh footer after creating/opening worktrees.

## Safety rules

- Do not overwrite existing non-empty target directories.
- Do not use `git worktree add --force` by default.
- If branch is already checked out in another worktree, show/open that worktree instead of forcing.
- Worktree removal must:
  - refuse when a Web UI tab/RPC/app runner is active in that path;
  - refuse dirty worktrees unless `force` is explicitly confirmed;
  - clearly state it deletes files under the worktree path.
- Keep dependency installation/bootstrap manual.
- Treat submodules and nested repositories conservatively; show warnings.
- Keep all path operations normalized and, for destructive actions, realpath-checked.

## Testing plan

### Core/service tests

Use temporary Git repositories to verify:

- no repo detection;
- normal repo detection;
- linked worktree detection (`.git` file);
- list parsing from `git worktree list --porcelain`;
- new branch worktree creation;
- existing branch worktree opening;
- branch already checked out elsewhere;
- dirty worktree removal refusal;
- custom path validation.

### Web UI tests

Extend `pi-package-webui/tests/http-endpoints-harness.test.mjs`:

- create a temp git repo;
- create two worktree-backed tabs;
- assert `/api/git-worktrees` lists both;
- assert each tab reports distinct cwd/branch;
- assert branch picker payload marks occupied branches;
- assert close/remove guards refuse active tabs;
- assert session file for opened tab has target worktree cwd.

Run:

```bash
cd /home/firstpick/npm-packages/pi-package-webui
npm test
npm run check
```

### Native TUI/manual tests

- From a repo, run `/worktree new feature/foo`.
- Open it “here” and confirm footer cwd/branch changes.
- Open it in a second terminal/Pi process and confirm both branches can be edited independently.
- Confirm `/resume` lists sessions under the correct cwd/worktree.

## Suggested implementation phases

1. **Decision pass**: answer the questions below.
2. **Shared service prototype**: implement worktree discovery/list/create in `pi-package-webui/lib/git-worktrees.mjs` with tests.
3. **Web UI backend**: add `/api/git-worktrees*` endpoints and session-file preparation for target cwd.
4. **Web UI frontend**: add worktree list/create/open dialogs and footer branch-picker integration.
5. **Guided Git workflow update**: make PR branch creation worktree-aware.
6. **Native TUI/core**: upstream shared service, add `/worktree`, optionally add `pi --cwd`.
7. **Polish**: docs, screenshots, parity matrix, remove/prune guardrails.

## Decision questions for Firstpick

Please answer these before implementation:

1. **Core vs WebUI-first:** Should worktree support be implemented upstream in Pi core first, or prototyped in `pi-package-webui` and upstreamed later?
2. **Default path:** Is the recommended default `<repo-parent>/<repo-name>.worktrees/<branch-slug>` acceptable?
3. **Session default:** When opening a new branch worktree, should the default session be `empty`, `parent-only`, `clone-current`, or `fork-current`?
4. **Native TUI parallel UX:** For native TUI, should `/worktree` primarily switch the current process, print a command for a second process, or try tmux integration?
5. **Branch picker default:** Should Web UI’s footer branch picker make “open/create worktree” the default action and demote in-place `git switch` to advanced?
6. **Worktree removal:** Should Web UI/TUI support removing worktrees in v1, or should v1 only create/open/list and leave removal to manual Git commands?
7. **Remote clients:** Should authenticated remote Web UI clients be allowed to create worktrees, or should create/remove be localhost-only?
8. **Dependency bootstrap:** Should Pi ever offer to run install/bootstrap commands in a new worktree, or keep that fully manual?
9. **Registry:** Do you want a Pi-specific worktree registry with labels/session associations, or should v1 derive everything from `git worktree list` plus session files?
10. **CLI `--cwd`:** Should core Pi gain `--cwd <path>` as part of this feature?
11. **PR workflow:** When creating a PR branch from Web UI, should it always use a new worktree by default, or ask each time?
12. **Naming:** What command/name do you prefer: `/worktree`, `/branch-worktree`, `/workspace`, or something else?

---

## Appended improvements (review pass, grounded in current code)

This section reviews the plan against the actual implementation in
`pi-package-webui/bin/pi-webui.mjs`, `pi-extension-git-footer-status/index.ts`,
the bundled SDK (`@earendil-works/pi-coding-agent`), and `lib/trust-boundaries.mjs`.
It records verified facts, corrections, gaps, and opinionated defaults.

Confidence: 86/100. Drivers down: native TUI / Pi-core internals are read from
docs and `dist/` only (no upstream source in this repo); concurrency behavior of
the shared object store is reasoned, not benchmarked.

### A. Critical correction: session header `cwd` must be rewritten, not reused

`updateTabCwd(id, cwd)` (around `pi-webui.mjs:5666`) restarts the tab in the new
cwd but **reuses the same session file** (`tabRestorableSessionFile(tab)` passed
back as `--session`). Pi session headers store an absolute `cwd` (confirmed in
`SessionManager.forkFrom`, which writes `cwd: resolvedTargetCwd` into the header).

Consequence: if a worktree tab simply changes cwd while keeping the source
session file, the session header `cwd` will point at the *old* checkout while the
RPC process runs in the worktree. That mismatch corrupts cwd-bound assumptions
(session storage dir, resource/tool path resolution, `/resume` grouping).

Fix: opening a worktree must **prepare a fresh session file rooted at the
worktree path** before spawning, never reuse the source path in place. Use
`SessionManager.forkFrom(sourceSessionFile, worktreePath)` (it already mints a
new id, sets `cwd`, sets `parentSession`, and copies non-header entries) and pass
the returned file as `sessionFile` to `createTab(...)`. The new endpoints should
not route worktree opens through `updateTabCwd`'s reuse path.

### B. Default-path strategy must resolve the MAIN worktree, not the current one

`getGitRoot(cwd)` uses `git rev-parse --show-toplevel`, which returns the
toplevel of the **current (possibly linked) worktree**, not the main checkout.
The proposed default `<repo-parent>/<repo-name>.worktrees/<branch-slug>` is only
correct relative to the *main* worktree; deriving it from a linked worktree would
produce nested `*.worktrees/foo.worktrees/bar` paths and divergent locations.

Resolve the main worktree deterministically:

- `git rev-parse --git-common-dir` → the shared `.git`; its parent directory is
  the main worktree root (when not bare).
- Or take the first entry of `git worktree list --porcelain` (the main worktree
  is always listed first).

Compute `repo-name` and the `.worktrees` parent from that main root, and detect
the "already inside a `.worktrees/...` dir" case to keep all worktrees siblings.
Also key the registry/grouping on `git-common-dir`, which is stable across every
linked worktree, rather than on `--show-toplevel`.

### C. `clone-current` vs `fork-current` are currently the same operation

The bundled `SessionManager.forkFrom` copies **all** non-header entries (full
history) and tags `parentSession`. There is no built-in leaf truncation, so the
plan's four session modes collapse in practice:

- `empty` → don't pass `--session` (works today).
- `parent-only` → needs a new core helper (header with `parentSession` but no
  copied entries); not currently available.
- `clone-current` and `fork-current` → **both** map to `forkFrom` today and are
  indistinguishable without a new `SessionManager.cloneToCwd(src, cwd, { leafId })`
  that truncates at a chosen leaf.

Recommendation: ship v1 with `empty` and `fork-current` (= `forkFrom`) only.
Defer `parent-only` and leaf-accurate `clone-current` until the core helper
exists, and update the `sessionMode` enum so the API never advertises a mode it
silently aliases.

### D. Reuse existing porcelain parsing instead of reimplementing

`pi-extension-git-footer-status/index.ts` already runs
`git worktree list --porcelain` and counts `worktree ` lines (around
`index.ts:429-449`). Extract a shared parser (`worktree`, `HEAD`, `branch
refs/heads/x`, `bare`, `detached`, `locked`, `prunable`) into
`lib/git-worktrees.mjs` and have both the footer extension and the new service
consume it, so worktree count and the new list endpoint never disagree.

### E. Concurrency / shared object-store races

Linked worktrees share one object database, `config`, `packed-refs`, and refs.
Per-worktree `index.lock` isolates index ops, but ref updates, `git worktree
add/remove/prune`, and any `git gc` can still race when multiple tabs operate on
the same repo. Add:

- a per-`git-common-dir` async mutex serializing **mutating** git ops
  (add/remove/prune/branch create), reusing the `runGitWorkflowCommand` payload
  pattern already in `pi-webui.mjs`;
- retry-with-backoff on `index.lock`/`cannot lock ref`/`unable to create ...lock`
  errors;
- never run an implicit `git gc`/`prune` from these endpoints.

### F. Atomic creation with rollback

`git worktree add` can succeed while a later step (session `forkFrom`, tab spawn
in `createTab`, `primeTabRpc`) fails — orphaning a `createdByPi` worktree. Wrap
creation so that, on failure after `worktree add`, an automatic
`git worktree remove --force <path>` runs **only** when the worktree is empty and
flagged `createdByPi`. Emit a `webui_worktree_create_failed` event with the
cleanup outcome.

### G. Branch-slug collisions and slashed branch names

`feature/x` and `feature-x` can slug to the same directory, and slashes create
nested dirs. Specify a collision-safe rule:

- slugify but append a short disambiguator (e.g. trailing `-<n>` or a 6-char hash
  of the full ref) when the target dir already exists for a different branch;
- store the exact `branch → path` mapping (the registry, see I) so lookups never
  rely on re-slugging;
- reject/normalize names that would escape the `.worktrees` parent (realpath
  containment check, mirroring the existing `prDescriptionPath` guard at
  `pi-webui.mjs`).

### H. Structured, machine-readable error codes

Endpoints/service should return a stable `code` alongside the human message so
the UI can branch (open-existing vs fail). Minimum set:

- `BRANCH_CHECKED_OUT_ELSEWHERE` (carry the occupying worktree path) →
  UI offers "Open existing worktree".
- `TARGET_NOT_EMPTY`, `TARGET_ESCAPES_PARENT`, `INVALID_BRANCH_NAME`.
- `DIRTY_WORKTREE`, `WORKTREE_BUSY` (active tab/RPC/app-runner),
  `IS_MAIN_WORKTREE` (refuse removing the primary checkout).
- `NOT_A_GIT_REPO`, `DETACHED_HEAD`, `BARE_REPO_UNSUPPORTED`.

### I. Registry as cache, not authority (resolves Q9)

Keep `git worktree list` as the source of truth, but persist a small
Pi-side cache keyed by `git-common-dir` holding `{ path, branch, label,
sessionFile, createdByPi, tabId }`. Treat it as advisory: reconcile against
`git worktree list --porcelain` on read, drop entries whose path is `prunable`
or missing, and never block recovery if the cache is absent or stale.

### J. Tooling/dependency reality for new worktrees

Worktrees do **not** share `node_modules`, `.venv`, build output, or other
git-ignored artifacts. After creating one, type-check/LSP/tests/app-runner
(`appRunner*` in `pi-webui.mjs`) will fail until deps are installed. The plan
already keeps install manual — strengthen it: surface a non-blocking UI hint
("dependencies not installed in this worktree") and never auto-run installers
(reinforced for remote clients). Optionally document a copy/symlink hint for
`node_modules` where the package manager supports it.

### K. Hook into existing trust boundaries (resolves Q7)

Do not invent new localhost logic. `lib/trust-boundaries.mjs` already exposes
`LOCALHOST_ONLY_POST_ROUTES`, `requireLocalhostRoute`, and `isLocalRequest`. Add
`DELETE /api/git-worktrees` (removal) to `LOCALHOST_ONLY_POST_ROUTES`-equivalent
handling so removal is localhost-only by construction, and allow create/list/open
for trusted/authenticated clients via the existing guard model. Removal must also
call the existing `stopAppRunnerForTab(...)` / active-tab checks before deleting.

### L. Remove the same-branch / current-worktree no-ops

Guard against opening a worktree for the branch already checked out in the
requesting tab (it would immediately hit `BRANCH_CHECKED_OUT_ELSEWHERE` against
itself). The branch picker should detect "this is the current branch/worktree"
and offer nothing, or offer "switch in place" only.

### M. Additional tests to add

Beyond the plan's list:

- session header `cwd` of the prepared file equals the worktree path (not the
  source checkout) — guards regression of correction A;
- main-worktree resolution when the API is invoked **from a linked worktree**
  (correction B) — assert default path stays a sibling, not nested;
- concurrent create of two worktrees serializes and both succeed (E);
- rollback removes the worktree when tab spawn is forced to fail (F);
- slashed/colliding branch names produce distinct, contained dirs (G);
- removal refused with `IS_MAIN_WORKTREE` and with `WORKTREE_BUSY` (H/K).

### N. Iconography consistency

The footer already uses `🌳` and `📦<count>` for worktrees
(`git-footer-status/index.ts:555,622`). Reuse the same glyphs in the Web UI
badge/dialogs so native TUI and Web UI read consistently.

## Recommended answers to the decision questions

Opinionated defaults (Firstpick can override). Confidence per item in brackets.

1. **Core vs WebUI-first:** Prototype in `pi-package-webui/lib/git-worktrees.mjs`,
   then upstream the pure service to Pi core once stable. [85]
2. **Default path:** Yes — `<main-repo-parent>/<repo-name>.worktrees/<branch-slug>`,
   with corrections B (resolve main worktree) and G (collision-safe slug). [88]
3. **Session default:** `fork-current` (= `forkFrom`) as default, `empty` exposed;
   drop `clone-current`/`parent-only` from v1 until a core helper exists (C). [82]
4. **Native TUI parallel UX:** Default to "print a ready command" for a second
   process; offer "open here" as explicit; tmux detection as later polish. [80]
5. **Branch picker default:** Yes — make open/create-worktree the default for
   parallel work; keep in-place `git switch` as an explicit "advanced" action. [83]
6. **Worktree removal:** v1 = create/open/list only; expose removal behind
   localhost + confirmation in a fast-follow, not v1. [84]
7. **Remote clients:** create/open allowed for trusted/authenticated clients;
   removal localhost-only via existing trust boundaries (K). [86]
8. **Dependency bootstrap:** Keep fully manual; only show a hint (J). [90]
9. **Registry:** Git is source of truth; add an advisory cache keyed by
   `git-common-dir` (I). [85]
10. **CLI `--cwd`:** Yes, add `pi --cwd <path>` — it makes generated commands
    portable and matches `pi-webui --cwd`; low risk. [80]
11. **PR workflow:** Ask each time in v1 (remember last choice per repo); make
    worktree mode the highlighted/default option. [80]
12. **Naming:** `/worktree` (short, matches git vocabulary; `/wt` alias). [82]
