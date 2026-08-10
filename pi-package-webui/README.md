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
| **Sessions and workspaces** | Run several isolated Pi sessions, resume prior work, switch projects, preserve per-tab drafts, and create branch worktrees. |
| **Live agent work** | Follow streaming Markdown, thinking, tool output, queues, todo progress, subagents, and context usage without leaving the browser. |
| **Models and controls** | Change models and thinking effort, manage scoped models, configure tools and skills, and use the command palette. |
| **Files and prompts** | Upload or paste files and images, edit text attachments, use slash-command suggestions, and reference project paths with `@`. |
| **Git workflows** | Inspect changes, switch branches, review diffs, stage work, generate commit messages, push, and prepare pull requests through guided steps. |
| **Project utilities** | Launch detected app runners, manage working directories, search files and transcripts, and customize themes. |
| **Companion features** | Add stats, remote access, voice, `/btw`, richer Git status, themes, release tools, and other supported Pi packages. |
| **Desktop and mobile** | Use a full desktop workspace or a compact phone layout with touch-friendly navigation and controls. |

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
5. Open the side panel for sessions, Git, app runners, themes, updates, and optional features.

Useful shortcuts:

- `Ctrl/Cmd+K` opens the command palette.
- `Ctrl/Cmd+L` opens the model selector.
- `Ctrl/Cmd+F` searches the active file, transcript, or subagent output and highlights every match.
- `Alt+Enter` queues the composer as a follow-up.
- Hold `Esc` to abort active work.

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

Manage the current session, workspace, model, theme, notifications, updates, usage, and optional packages.

#### Working-directory picker

![Pi Web UI working-directory picker with recent paths, saved directories, and create-directory action](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_CWDpicker_v0.4.8.png)

**Optional feature needed:** None — included in Pi Web UI core.

Browse, search, save, or create project directories and open them in the active Pi tab.

#### Queue manager

![Pi Web UI queue panel with prompt-list controls and queued-message status](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_Queues_v0.4.8.png)

**Optional feature needed:** None — queues and prompt lists are included in Pi Web UI core.

Review follow-ups, steering messages, user-bash work, and prompt lists while a tab is busy.

### Models, tools, and skills

#### Thinking effort

![Pi Web UI thinking effort picker showing off, minimal, low, medium, high, and xhigh choices](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_Effort_v0.4.8.png)

**Optional feature needed:** None — included in Pi Web UI core.

Choose the supported reasoning effort before sending the next prompt.

#### Scoped models

![Pi Web UI scoped models picker listing provider models and the current effective model](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_ScopedModels_v0.4.8.png)

**Optional feature needed:** None — included in Pi Web UI core.

Search available models and control project or global model scope and cycling order.

#### Tools setup

![Pi Web UI tools setup dialog listing available tools with enable and disable controls](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_ToolsSetup_v0.4.8.png)

**Optional feature needed:** None — the browser tools setup is included in Pi Web UI core.

Enable tools for the current session or save the allowlist inherited by future sessions.

#### Skills setup

![Pi Web UI skills setup dialog listing installed skills and activation controls](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_SkillSetup_v0.4.8.png)

**Optional feature needed:** None — the browser skills setup is included in Pi Web UI core.

Find installed skills and manage session-specific or global activation.

### Project automation and Git

#### App runners

![Pi Web UI app runner selector showing detected project runners and custom runner creation](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_AppRunner_v0.4.8.png)

**Optional feature needed:** None — app runners are included in Pi Web UI core.

Launch detected development servers, tests, builds, scripts, and project-defined runners with pinned live output.

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

Open **Optional features** in the side panel to discover Web UI-aware companions. Configurable companions expose separate **Enable/Disable** and **Setup** actions, so configuration remains available without forcing a feature on.

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

See [TECHNICAL.md](TECHNICAL.md) for complete commands, configuration, update and rollback behavior, session continuity, security, compatibility, mobile behavior, and troubleshooting.

Contributor-only architecture, API, and testing information lives in [DEVELOPMENT.md](DEVELOPMENT.md).
