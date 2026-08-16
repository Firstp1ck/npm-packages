# Pi Web UI

Run Pi in a local browser with multi-session tabs, streaming output, model controls, file uploads, Git workflows, and optional companion features.

[![npm version](https://img.shields.io/npm/v/%40firstpick%2Fpi-package-webui?color=cb3837&logo=npm)](https://www.npmjs.com/package/@firstpick/pi-package-webui)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 22.19+](https://img.shields.io/badge/Node.js-22.19%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Pi package](https://img.shields.io/badge/Pi-package-6c5ce7)](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

![Pi Web UI main window showing multi-tab chat, streaming output, footer status, composer, and side controls](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_MainWindow_v0.4.8.png)

**Optional feature needed:** None — the main window is included in Pi Web UI core. Companion widgets appear only when their packages are installed.

Pi Web UI keeps the normal Pi agent experience while giving you more room to manage sessions, inspect work, and control common workflows. It listens on localhost by default, runs alongside Pi, and can be opened from Pi or with a standalone launcher.

## What you can do

| Area | Highlights |
| --- | --- |
| **Sessions and workspaces** | Run several isolated Pi sessions, resume prior work, switch projects, preserve per-tab drafts, add another tab directly from the tab strip, and create branch worktrees. |
| **Live agent work** | Follow streaming Markdown with syntax highlighting for code blocks, thinking, tool output, queues, todo progress, managed agent runs, and direct agent-to-agent conversations without leaving the browser. |
| **Models and controls** | Change models and thinking effort, manage scoped models, configure tools and skills, and use the command palette. |
| **Files and prompts** | Upload or paste files and images, edit text attachments, use slash-command suggestions, browse project files, and reference project paths with `@`. |
| **Git workflows** | Inspect changes, switch branches, review diffs, stage work, generate commit messages, push, and prepare pull requests through guided steps. |
| **Project utilities** | Launch detected app runners, manage working directories, search files and transcripts, and customize themes. |
| **Companion features** | Add stats, remote access, voice, `/btw`, richer Git status, themes, release tools, and other supported Pi packages. |
| **Desktop and mobile** | Use a full desktop workspace with resizable left and right side panels, or a compact phone layout with touch-friendly navigation and controls. |

## Quick start

### Requirements

- Node.js 22.19 or newer
- [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) installed and configured
- A modern browser

### Install into Pi

```bash
pi install npm:@firstpick/pi-package-webui
```

Restart Pi, then run:

```text
/webui-start
```

Open the printed address, usually <http://127.0.0.1:31415/>. The browser normally opens automatically.

Check the server at any time with:

```text
/webui-status
/webui-status detailed
```

### Your first session

1. Start the Web UI with `/webui-start`.
2. Confirm the working directory in the footer or choose another project.
3. Select a model and thinking effort.
4. Enter a prompt, attach context if needed, and follow the live response.
5. Open the Control Deck for sessions, Git, app runners, themes, updates, and optional features. Under **Controls → Interface**, choose **Top bar** or **Sidebar** for terminal tabs, then choose **Right**, **Left**, or **Both** for the Control Deck. In **Sidebar**, **Both** is unavailable; choosing **Right** or **Left** swaps the Control Deck and terminal/tabs rails across the chat.
6. On desktop, drag the workspace-facing edge of any visible Control Deck—or the terminal/tabs rail in **Sidebar**—to choose a comfortable width. In **Both**, resize the left and right Control Decks independently; widths return on your next visit.

When session history is still loading, the main window shows **Loading agent output…** with a small inline spinner. Existing transcript content and controls remain available; no popup interrupts your work.

Tracked skills appear as compact tags above the composer. Select a named tag to open its skill file; when space is limited, select the **+X** tag to expand the remaining selectable tags upward.

Open **Subagents** to follow agent runs launched by managed extensions or registered SDK, RPC, JSON, print, interactive, tmux, workflow, schedule, gate, and custom integrations. Runs linked to an open WebUI terminal stay in that terminal’s group; other registered runs appear under **External agents**. Each agent row shows its launch source and lifecycle, and only offers output or controls that its owner supports. A `pi-subagents` workflow appears as a collapsible **Workflow** header with its model-powered agents nested inside, rather than as another agent row. Starting or restarting the server reconnects active runs without reopening stale, lost, or already-finished rows from an earlier server run.

Independent Pi processes do not appear automatically. Start them through `pi-webui agent run`, attach a persisted session with `pi-webui agent attach`, or use a cooperating registration adapter. See [TECHNICAL.md](TECHNICAL.md#subagent-observability) for supported commands and limitations.

When agents exchange direct Intercom messages or use native subagent-supervisor coordination, one compact tag per conversation appears beneath the composer. Up to eight tags share one row; denser groups wrap into a compact grid instead of creating a horizontal scrollbar. Long names shorten with an ellipsis, while the full name remains available to assistive technology and on hover. Select a tag to open a read-only chat view showing the two agent names or IDs and their messages. Generic Intercom transport calls and received Intercom records stay out of the main agent-output transcript, while attachments, tool output, and reasoning remain excluded from the chat view.

Useful shortcuts:

- `Ctrl/Cmd+K` opens the command palette.
- `Ctrl/Cmd+L` opens the model selector.
- `Ctrl/Cmd+F` searches the active file, transcript, or subagent output and highlights every match.
- `Alt+Enter` queues the composer as a follow-up.
- Hold `Esc` to abort active work.
- In the Control Deck, use `Alt+Up` / `Alt+Down` to reorder a section. In **Both**, use `Alt+Left` / `Alt+Right` to move it between sides.

## Feature gallery

Screenshots below show the v0.4.8 interface. Newer releases may contain additional controls while keeping the same core workflows.

### Sessions and workspace

#### Workspace dashboard

![Pi Web UI workspace dashboard showing the active project, model, session cards, and quick actions](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_Workspace_v0.4.8.png)

**Optional feature needed:** None — included in Pi Web UI core.

See the active project, model, context, Git state, queue, sessions, and common actions in one place.

#### Control panel

![Pi Web UI side control panel with model, session, workspace, theme, update, optional feature, and usage controls](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_ControlPanel_v0.4.8.png)

**Optional feature needed:** None — the control panel is included in Pi Web UI core. Companion-specific sections require their corresponding packages.

Manage the current session, workspace, model, theme, notifications, updates, usage, and optional packages. The **Controls** section keeps each setting on one compact name/value row; point to or focus a setting name for plain-language help.

#### Working-directory picker

![Pi Web UI working-directory picker with recent paths, saved directories, and create-directory action](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_CWDpicker_v0.4.8.png)

**Optional feature needed:** None — included in Pi Web UI core.

Browse, search, save, or create project directories and open them in the active Pi tab.

#### Files panel

**Optional feature needed:** None — the Files panel is included in Pi Web UI core.

Browse and search the files of the active project, open them in the viewer, and use the row menu for file actions. The viewer edits text, previews Markdown, and displays PNG, JPEG, GIF, WebP, and AVIF images read-only. In a Git repository, files and folders that Git ignores stay listed and fully usable, but appear greyed out so generated output such as `node_modules` or build folders is easy to tell apart. Point at a greyed row to see the “Ignored by Git” hint in its tooltip.

#### Queue manager

![Pi Web UI queue panel with prompt-list controls and queued-message status](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_Queues_v0.4.8.png)

**Optional feature needed:** None — queues and prompt lists are included in Pi Web UI core.

Review follow-ups, steering messages, user-bash work, and prompt lists while a tab is busy.

### Models, tools, and skills

#### Thinking effort

![Pi Web UI thinking effort picker showing off, minimal, low, medium, high, and xhigh choices](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_Effort_v0.4.8.png)

**Optional feature needed:** None — included in Pi Web UI core.

Choose the supported reasoning effort before sending the next prompt. Local models that return tagged `<think>…</think>` reasoning keep that content in the Thinking card, including literal tag examples inside the reasoning.

#### Scoped models

![Pi Web UI scoped models picker listing provider models and the current effective model](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_ScopedModels_v0.4.8.png)

**Optional feature needed:** None — included in Pi Web UI core.

Search available models and control project or global model scope and cycling order.

#### Tools setup

![Pi Web UI tools setup dialog listing available tools with enable and disable controls](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_ToolsSetup_v0.4.8.png)

**Optional feature needed:** None — the browser tools setup is included in Pi Web UI core.

Enable tools for the current session, save a global default, or configure an exact model profile. Selecting that model automatically applies its tool profile unless the session has its own tool selection.

#### Skills setup

![Pi Web UI skills setup dialog listing installed skills and activation controls](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_SkillSetup_v0.4.8.png)

**Optional feature needed:** None — the browser skills setup is included in Pi Web UI core.

Find installed skills and manage session, global, or exact-model activation. Selecting a configured model automatically applies its skill profile unless the session has its own skill selection.

### Project automation and Git

#### App runners

![Pi Web UI app runner selector showing detected project runners and custom runner creation](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_AppRunner_v0.4.8.png)

**Optional feature needed:** None — app runners are included in Pi Web UI core.

Launch detected development servers, tests, builds, scripts, and project-defined runners with pinned live output. ANSI colors are rendered safely, while progress written with carriage returns updates in place instead of filling the log with duplicate status lines.

#### Guided Git workflow

![Pi Web UI guided Git workflow showing staged changes, generated commit messages, and PR controls](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_GitWorkflow_v0.4.8.png)

**Optional feature needed:** `@firstpick/pi-prompts-git-pr` for generated commit messages, branch names, and pull-request content. `@firstpick/pi-extension-aur-review` optionally adds the staged-review gate.

Move through review, staging, commit-message generation, commit, push, and pull-request steps with explicit confirmations.

#### Git branch picker

![Pi Web UI git branch picker showing the current branch and create-branch action](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_GitBranches_v0.4.8.png)

**Optional feature needed:** None — branch and worktree controls are included in Pi Web UI core.

Switch branches, create a branch, or create a parallel branch worktree for isolated work.

#### Git diff viewer

![Pi Web UI Git Changes dialog showing repository status, file list, and side-by-side diff rows](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_GitDiff_v0.4.8.png)

**Optional feature needed:** None — the Git status and diff viewer are included in Pi Web UI core.

Inspect staged, unstaged, untracked, and incoming changes before asking Pi to commit or publish them.

### Optional companions and usage

#### Optional features

![Pi Web UI optional features list showing companion packages and install or update states](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_OptionalFeatures_v0.4.8.png)

**Optional feature needed:** None — the package manager panel is included in Pi Web UI core; each listed companion is installed separately.

Install, update, enable, disable, or configure supported companion packages from one panel.

#### `/btw` side questions

![Pi Web UI BTW widget showing a side-question input and live side-thread output](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_BTW_v0.4.8.png)

**Optional feature needed:** `@firstpick/pi-extension-btw`.

Ask a quick side question without derailing the main agent flow, then transfer useful context back when needed.

#### Codex usage

![Pi Web UI Codex usage widget showing subscription usage windows and reset timers](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_CodexUsage_v0.4.8.png)

**Optional feature needed:** None for usage reporting — included in Pi Web UI core for supported Codex authentication. The Normal/Fast selector requires `@firstpick/pi-extension-codex-fast-mode`.

Monitor subscription usage windows and reset times for supported Codex models.

#### Pi stats

![Pi Web UI stats dashboard showing token, cost, cache, model, and daily usage analytics](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_Pistats_v0.4.8.png)

**Optional feature needed:** `@firstpick/pi-extension-stats`.

Explore token, cost, cache, model, session, and daily usage through the optional stats companion.

## Optional features

Open **Optional features** in the side panel to discover Web UI-aware companions. Configurable companions expose separate **Enable/Disable** and **Setup** actions, so configuration remains available without forcing a feature on. The loaded **TUI Skills command** and **TUI Tools command** rows provide **Setup** buttons for the browser-native Skills Setup and Tools Setup dialogs.

Popular additions include:

- Remote Web UI for trusted-LAN access and PIN protection
- Pi stats and richer Git/footer status
- Natural Conversation Mode and voice controls
- `/btw` side questions
- Additional themes, release workflows, safety controls, and prompt tools

Optional companions are installed separately and remain governed by normal Pi package settings.

## Standalone launcher

You can start the browser UI without opening terminal Pi first:

```bash
npm install -g @firstpick/pi-package-webui
pi-webui
```

Choose a project immediately:

```bash
pi-webui --cwd ~/src/my-project
```

If you omit `--cwd`, the browser asks which project to open first.

## Keep it private

> [!WARNING]
> Pi Web UI can do anything the connected Pi session is allowed to do. It listens only on `127.0.0.1` by default. Do not expose it directly to an untrusted network.

Use the optional Remote Web UI package when you need trusted-LAN access and PIN protection. Treat that PIN as a convenience for a trusted network, not as hardened multi-user authentication.

## Technical details

Core updates use a persisted exact-target plan bound to a plan digest. The server verifies package ownership before mutation, supports npm-hoisted bundled Pi installs, and refuses plans with no accepted targets without entering the restart flow.

> **Before downgrading:** stop the Web UI and back up `~/.pi/webui/settings.json`. Older releases do not understand the two-sided Control Deck layout and can overwrite it. Re-upgrade before restoring the backup.

See [TECHNICAL.md](TECHNICAL.md) for complete commands, configuration, update and rollback behavior, session continuity, security, compatibility, mobile behavior, and troubleshooting.

Contributor-only architecture, API, and testing information lives in [DEVELOPMENT.md](DEVELOPMENT.md).
