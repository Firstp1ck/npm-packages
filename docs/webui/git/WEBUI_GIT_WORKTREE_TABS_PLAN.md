# WebUI Git Worktree Tabs Plan

## Goal

Add a user-friendly way to open a branch in a separate Git worktree per WebUI tab/terminal, so branch changes in one tab do not unexpectedly affect other tabs using the same repository checkout.

Use the user-facing phrase **isolated working copy**. Keep **Git worktree** as secondary/help text for technical users.

## Current behavior

The GIT footer dropdown currently switches branches by running `git switch` in the active tab's Git working tree. Because a Git branch is shared by every terminal/tab using that same working tree folder, switching branches affects all tabs that point at the same checkout.

Existing branch switching/creation lives in `pi-package-webui`:

- Browser UI: `public/app.js`
- Styling: `public/styles.css`
- Server endpoints: `bin/pi-webui.mjs`
- Static checks: `tests/mobile-static.test.mjs`

This responsibility should remain in `pi-package-webui` because WebUI owns tab cwd, terminal restart/new-tab behavior, and browser-facing UX. `pi-extension-git-footer-status` should remain responsible for publishing footer status data.

## User model

Explain the choice as two modes:

### Shared folder branch

> Uses this same project folder. Switching branches here affects every WebUI tab and terminal that uses this folder.

Actions:

- Switch to existing branch in this folder
- Create new branch in this folder

### Isolated working copy

> Opens the branch in its own folder. Other tabs stay on their current branch.

Actions:

- Open existing branch in isolated working copy
- Create new branch in isolated working copy

Recommended default action: **Open in new tab**.

Secondary action, behind confirmation: **Move this tab here**.

## Proposed UI

Extend the GIT card dropdown with sections:

```text
Git branches
Current: main · /home/me/project

Shared folder branch
[Create new branch form]
[existing branch buttons]

Isolated working copy
[Create isolated working copy]
[Open existing branch in isolated working copy]
```

Suggested compact footer badges:

```text
GIT main · shared by 3 tabs
GIT feat/login-ui · isolated
```

Suggested tooltip copy:

- Shared:
  > This tab shares `/path/project` with 3 tabs. Switching branches here changes the files seen by all of them.

- Isolated:
  > This tab uses an isolated working copy at `/path/project-feat-login-ui`. Branch changes here do not affect tabs using `/path/project`.

## Backend design

Add WebUI server helpers/endpoints in `bin/pi-webui.mjs`.

### `GET /api/git-worktrees`

Input: active tab cwd.

Behavior:

1. Resolve Git root with existing `getGitRoot(cwd)`.
2. Run:
   ```bash
   git worktree list --porcelain
   ```
3. Parse worktree path, HEAD, branch, bare/detached flags.
4. Cross-reference WebUI tabs by cwd/root containment.
5. Return normalized data:

```json
{
  "root": "/home/me/project",
  "currentWorktree": "/home/me/project",
  "worktrees": [
    {
      "path": "/home/me/project",
      "branch": "main",
      "detached": false,
      "current": true,
      "tabCount": 2
    },
    {
      "path": "/home/me/project-feat-login-ui",
      "branch": "feat/login-ui",
      "detached": false,
      "current": false,
      "tabCount": 1
    }
  ]
}
```

### `POST /api/git-worktree`

Input:

```json
{
  "branch": "feat/login-ui",
  "createBranch": true,
  "base": "HEAD",
  "path": "optional explicit target path",
  "openMode": "new-tab"
}
```

Behavior:

1. Resolve active Git root.
2. Validate branch with existing `cleanGitBranchName()` and `validateGitBranchName()`.
3. Pick a safe default path if none is supplied:
   - sibling of root;
   - sanitized repo name + branch suffix;
   - e.g. `/home/me/project-feat-login-ui`.
4. Validate target path:
   - must not exist unless intentionally reusing an existing worktree;
   - must stay inside an allowed parent/sibling area;
   - no path traversal.
5. Create worktree:
   - new branch:
     ```bash
     git worktree add -b feat/login-ui /home/me/project-feat-login-ui HEAD
     ```
   - existing branch:
     ```bash
     git worktree add /home/me/project-feat-login-ui feat/login-ui
     ```
6. Return created path and branch.

Do not shell-concatenate commands. Use argv arrays, like existing branch switching.

## Frontend design

Extend `public/app.js` branch picker state:

```js
let footerWorktreeState = {
  loading: false,
  error: "",
  worktrees: [],
  currentWorktree: "",
};
```

Add UI functions:

- `loadFooterWorktrees(tabContext)`
- `renderFooterWorktreeSection(state)`
- `createFooterGitWorktree({ branch, createBranch, openMode })`
- `openWorktreeInNewTab(path)`
- `moveCurrentTabToWorktree(path)`

Reuse current branch creation form patterns:

- editable type suggestion field;
- visible `/` separator;
- live command preview;
- detailed non-technical tooltip;
- active-agent warning before moving current tab.

## Safety and confirmations

### Creating isolated worktree

Confirm text:

> Create isolated working copy?
>
> This creates a new folder for branch `feat/login-ui` and opens it in a new WebUI tab.
>
> Other tabs using `/path/project` will stay on their current branch.

### Moving current tab

Require stronger confirmation:

> Move this tab to isolated working copy?
>
> This restarts this tab in `/path/project-feat-login-ui`. Current in-flight work in this tab will be stopped. Other tabs are unchanged.

### Active agents

If agents are active in the source worktree, prefer **Open in new tab** and warn before any current-tab restart.

## Display details

In the branch picker, show existing worktrees as cards:

```text
main
/path/project
Shared by 3 tabs · current

feat/login-ui
/path/project-feat-login-ui
Isolated · 1 tab
```

For branch buttons, include action labels:

- `Switch shared folder`
- `Open isolated copy`
- `Open existing worktree`

Avoid using only `git worktree` as the visible label.

## Testing plan

Static checks in `tests/mobile-static.test.mjs`:

- worktree endpoints exist;
- no shell-concatenated git worktree commands;
- UI uses “isolated working copy” copy;
- create-isolated action opens a new tab by default;
- shared-branch warnings mention other tabs using the same folder.

Harness tests:

- parse `git worktree list --porcelain` output;
- safe target path generation;
- reject existing target path unless it maps to an existing worktree;
- validate branch names;
- ensure new-tab creation receives returned worktree cwd.

Manual verification:

1. Open two tabs in the same repo.
2. Create isolated working copy for `feat/test-worktree`.
3. Confirm new WebUI tab opens in sibling worktree path.
4. In original tab, `git branch --show-current` remains unchanged.
5. In new tab, `git branch --show-current` shows `feat/test-worktree`.
6. Switching branches in the new tab does not affect the original tab.

## Implementation phases

### Phase 1 — Read-only worktree awareness

- Add `GET /api/git-worktrees`.
- Show shared/isolated status in GIT dropdown.
- Show “shared by N tabs” warnings.

### Phase 2 — Create isolated working copy

- Add `POST /api/git-worktree`.
- Add create form/action.
- Default to opening a new WebUI tab.

### Phase 3 — Existing branch/worktree UX

- Open an existing branch in a new worktree.
- Reuse existing worktree if already present.
- Add “Move this tab here” advanced action.

### Phase 4 — Polish

- Improve footer badges.
- Add detailed tooltips.
- Add cleanup guidance for unused worktrees, but avoid destructive delete actions initially.

## Open questions

- Should the default target directory be configurable?
- Should worktrees be created beside the repo root or inside a dedicated `.worktrees/` parent?
- Should WebUI offer worktree cleanup, or only explain the terminal command?
- Should branch creation in shared folder remain the primary action, or should isolated working copy become the recommended default?
