# @firstpick/pi-package-webui

Local browser UI for [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

![Pi Web UI main window showing multi-tab chat, streaming output, footer status, composer, and side controls](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_MainWindow_v0.4.8.png)

Pi Web UI gives you a local browser companion for Pi: multi-tab chat, streaming output, model controls, uploads, slash-command helpers, workspace navigation, and optional extension widgets.

> **Security:** Pi Web UI can control the spawned Pi session and run anything that session is allowed to run. It binds to `127.0.0.1` by default. Trusted-LAN opening/closing and Remote PIN auth controls are owned by the optional `@firstpick/pi-package-remote-webui` companion; when enabled, Remote PIN auth persists for later Web UI starts.

## Requirements

- Node.js `>=22.19.0`
- Pi installed and configured
- A modern browser with Server-Sent Events support

## Install

Install the package into Pi:

```bash
pi install npm:@firstpick/pi-package-webui
```

Restart Pi after installation so the Web UI commands are loaded.

## Start from Pi

Run this inside Pi:

```text
/webui-start
```

Open the printed URL, usually <http://127.0.0.1:31415/>. The command opens your browser automatically unless you pass `--no-open`.

Check a running Web UI with:

```text
/webui-status
/webui-status detailed
```

### `/webui-start` options

```text
/webui-start [port] [options] [-- <pi args...>]
```

```text
  [port]             Port shortcut
  --host <host>      HTTP bind host (default: 127.0.0.1)
  --port <port>      HTTP port (default: 31415)
  --no-open          Do not open the browser automatically
  --no-session       Start Pi RPC with --no-session
  --name <name>      Initial Web UI tab name
  --remote-auth      Enable startup PIN authentication for non-local clients
  --no-remote-auth   Disable startup PIN authentication
  -- <pi args...>    Extra arguments forwarded to Pi RPC
```

Examples:

```text
/webui-start
/webui-start 31500
/webui-start --port 31500 --no-open
/webui-start --remote-auth --host 0.0.0.0
/webui-start --name browser -- --model anthropic/claude-sonnet-4-5:high
```

Running `/webui-start` again on the same URL restarts the server and restores currently open Web UI tabs from their session files when possible.

### `/webui-status` options

```text
/webui-status [detailed] [port] [--port N] [--host HOST]
```

`/webui-status` reports the URL, online state, network exposure, and Remote PIN auth state. `detailed` adds tabs, sessions, models/providers, and recent backend events.

## Standalone CLI

Use the CLI when you want to start the Web UI without first opening terminal Pi:

```bash
npm install -g @firstpick/pi-package-webui
pi-webui
```

```text
pi-webui [options] [-- <pi args...>]
```

```text
  --host <host>       HTTP bind host (default: 127.0.0.1)
  --port <port>       HTTP port (default: 31415)
  --cwd <path>        Start the first Pi terminal in this working directory
  --pi <command>      Pi executable to spawn (default: bundled dependency, then "pi")
  --no-session        Start Pi RPC with --no-session
  --name <name>       Initial Web UI tab name
  --remote-auth       Enable startup PIN authentication for non-local clients
  --no-remote-auth    Disable startup PIN authentication
  -h, --help          Show help
  -v, --version       Print version
```

If `--cwd` is omitted, the server starts first and the browser asks for the first terminal CWD.

Examples:

```bash
pi-webui
pi-webui --cwd ~/src/my-project
pi-webui --host 0.0.0.0 --remote-auth --cwd ~/src/my-project
pi-webui --port 3000 -- --model anthropic/claude-sonnet-4-5:high
PI_WEBUI_PI_BIN=/path/to/pi pi-webui --no-session
```

Environment variables:

- `PI_WEBUI_HOST` and `PI_WEBUI_PORT` set the default bind address.
- `PI_WEBUI_PI_BIN=/path/to/pi` selects the Pi executable when `--pi` is not passed.
- `PI_WEBUI_REMOTE_AUTH=1` starts with Remote PIN authentication enabled.
- `PI_WEBUI_SETTINGS_FILE=/path/to/settings.json` overrides persisted Web UI settings such as the Remote PIN auth preference.
- `PI_WEBUI_OPTIONAL_FEATURE_INSTALL_ROOT=/path/to/package-root` overrides the npm prefix used for optional companion installs.
- `PI_WEBUI_FAST_PICKS_FILE=/path/to/paths.json` overrides saved cwd fast-pick storage.
- `PI_WEBUI_NPM_BIN=/path/to/npm` selects the npm executable used by optional feature install/update actions.

## Main features

- Pathless `pi-webui` startup: the server opens first, then the browser prompts for the first terminal CWD.
- Multi-tab Pi sessions with isolated processes, working directories, prompt drafts, activity state, per-tab settings, and a workspace dashboard for common actions.
- Unified command palette (`Ctrl/Cmd+K`) for commands, tabs, models, sessions, settings, app controls, and frequent Web UI actions.
- Automatic tab naming from the first prompt, with `--name <name>` still available for an explicit initial tab name.
- Streaming chat transcript with Markdown, copy buttons for fenced code blocks, rendered Mermaid diagrams from fenced `mermaid`/`mmd` code blocks, thinking output, tool/bash cards, queue and compaction events, edit-and-retry from user prompts, transcript search, copy buttons, and guarded abort controls that require holding Esc or the Abort button for 3 seconds.
- Prompt composer with uploads, drag/drop/paste, inline image support, generated text attachments for long input or clipboard text, editable text attachments, slash-command autocomplete, and `@` file/path references with live suggestions.
- Leading `!` and `!!` user-bash commands from the composer, serialized per tab; `!` keeps output in the next model context and `!!` excludes it.
- Browser-native Pi dialogs for `/model`, `/settings`, `/theme`, `/fork`, `/clone`, `/name`, `/resume`, `/tree`, `/login`, `/logout`, `/scoped-models`, `/tools`, and `/skills`, plus native-command adapter output for `/copy`, `/session`, `/new`, `/compact`, `/reload`, and `/export`.
- Runtime `/tools` and `/skills` selectors backed by the hidden Web UI RPC helper; skill toggles persist on the session branch, disabled skills are removed from the system prompt, and tracked `SKILL.md` files can be opened/edited from skill tags.
- Session resume/switch, metadata rename, and localhost-only safe delete with active/open-tab/session-directory guards.
- Model, thinking, session, workspace, theme, optional-feature, Codex usage, optional Remote WebUI, update/restart/stop, event, notification, thinking-visibility, terminal-tab-layout, and custom-background controls in collapsible side-panel sections.
- Persistent context-window meter with manual compact and auto-compaction controls near the composer; side-panel thinking changes made while a tab is busy are queued for the next prompt.
- Side-panel theme picker backed by optional `@firstpick/pi-themes-bundle` themes when loaded.
- Per-tab cwd changes, a clickable footer cwd picker, directory creation/search in the picker, saved path fast picks, server-persisted fast picks, and restart-safe restoration of open tabs.
- Detected app runner dropdown for the active tab cwd, including Cargo, Bun, npm/npx/pnpm, Python/uv, Go/Golang, Zig, C/C++, Docker Compose, root/dev/scripts shell scripts, and other common project runners with live output pinned at the top of the terminal. Running app runners expose line-oriented stdin in the widget for interactive scripts. Projects can add browseable custom runners in `.pi-webui-runners.json` with a command (default `./`) plus a relative path to the file to run.
- Guided Git workflow for existing repos and new repos: initialize, create README/.gitignore, initial commit, rename to `main`, add a GitHub remote, pull fetched incoming changes, stage, generate or type commit messages, push, and optionally create a PR.
- Browser support for Pi extension UI prompts, widgets, status updates, `/btw` side-question output widgets with optional context transfer/live steering, browser notifications when a tab needs an extension UI response, and an optional side-panel toggle for agent-done notifications.
- Localhost-only Pi/Web UI update checks with a top-right update notification and confirmed restart actions: **Update Pi & restart** runs `pi update` for Pi-only updates, while **Update Pi + Packages & Restart** runs `pi update --all` for Pi plus configured packages.
- Feedback reactions (`👍`, `👎`, `?`) on final assistant output plus tool/bash action cards, which can ask Pi to create or update a LEARNING.
- Mobile-friendly layout, PWA install support where the browser allows it, backend-offline recovery, and a dedicated server-restart overlay while confirmed restart/update actions run.

## Native Pi command coverage

Web UI keeps a packaged parity matrix at `lib/WEBUI_TUI_NATIVE_PARITY.json` and exposes it at `GET /api/native-parity`.

| Status | Commands and behavior |
| --- | --- |
| Implemented | `/model`, `/settings`, `/tools`, `/skills`, `/copy`, `/name`, `/session`, `/clone`, `/logout`, `/new`, `/compact`, and `/reload` use browser-native dialogs or structured native-command cards. |
| Degraded / browser-specific | `/theme` changes the browser Web UI theme only; `/scoped-models` points to the footer scoped-model picker; `/export` supports no-path HTML downloads plus explicit new `.html`/`.jsonl` server paths; `/hotkeys` lists Web UI shortcuts; `/fork`, `/tree`, `/login`, and `/resume` have browser flows with documented gaps. |
| Unsupported in Web UI | `/import`, `/share`, `/changelog`, and `/quit` return structured unavailable output instead of raw HTTP errors. |

Sensitive native flows use shared trust-boundary guards: localhost-only APIs, trusted-context checks for LAN clients, confirmation-oriented dialogs, and session-directory confinement for session file operations.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Open the command palette. |
| `Ctrl/Cmd+L` | Open the model selector. |
| `Ctrl/Cmd+P` / `Shift+Ctrl/Cmd+P` | Cycle scoped or available models forward/backward. |
| `Shift+Tab` | Cycle thinking effort. |
| `Ctrl/Cmd+T` | Toggle thinking-output visibility. |
| `Ctrl/Cmd+O` | Toggle global expansion for tool and bash output cards. |
| `Alt+Enter` | Queue the composer as a follow-up. |
| `Alt+Up` | Restore the latest observed steering/follow-up queue snapshot into the composer. |
| hold `Esc` | Abort active user bash first, then active agent work. |
| `Ctrl/Cmd+C` in an empty, focused composer | Clear the prompt. |
| `Ctrl/Cmd+F` | Search the transcript. |

## Feature gallery (screenshots from v0.4.8)

These screenshots show the v0.4.8 Web UI surfaces. Current implementations include the additional native-command, shortcut, attachment, Git, app-runner, server-control, and safety features documented above. Unless noted otherwise, actions apply to the active tab and its current working directory.

### Main window

![Pi Web UI main window showing multi-tab chat, streaming output, footer status, composer, and side controls](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_MainWindow_v0.4.8.png)

- **What it is:** The primary Web UI workspace for Pi, with terminal tabs, chat transcript, live assistant output, footer metrics, prompt composer, attachments, and side-panel controls in one browser view.
- **What you can do:** Run multiple Pi sessions, send prompts or follow-ups, monitor tokens/cache/cost/context/git/model state, attach files, launch quick actions, and control the active session without returning to the terminal.

### Workspace dashboard

![Pi Web UI workspace dashboard showing the active project, model, session cards, and quick actions](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_Workspace_v0.4.8.png)

- **What it is:** The project home base for an active Web UI tab, combining cwd, model, context, git, queue, session, and activity status.
- **What you can do:** Start or resume work, verify the tab is pointed at the right project, jump into common session/workspace actions, and spot queued or active work before prompting.

### Control panel

![Pi Web UI side control panel with model, session, workspace, theme, update, optional feature, and usage controls](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_ControlPanel_v0.4.8.png)

- **What it is:** The side rail for Web UI state and settings, including model, thinking effort, session/workspace controls, theme, optional companions, Remote WebUI, updates, notifications, and usage widgets.
- **What you can do:** Change model or effort, compact/manage sessions, toggle notifications, check or install optional packages, run confirmed updates/restarts, and manage remote/PIN controls when the remote companion is loaded.

### Working-directory picker

![Pi Web UI working-directory picker with recent paths, saved directories, and create-directory action](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_CWDpicker_v0.4.8.png)

- **What it is:** A browser-native cwd chooser used at first launch and for per-tab working-directory changes.
- **What you can do:** Search and browse project paths, choose recent or saved directories, create a new directory, and start or move a Pi tab into the selected workspace.

### App runners

![Pi Web UI app runner selector showing detected project runners and custom runner creation](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_AppRunner_v0.4.8.png)

- **What it is:** A project runner detector for common stacks plus browseable custom runners from `.pi-webui-runners.json`.
- **What you can do:** Launch dev servers, tests, builds, scripts, and custom commands from the active cwd, pass arguments, watch pinned live output, and send line-oriented stdin to interactive runners.

### Queue manager

![Pi Web UI queue panel with prompt-list controls and queued-message status](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_Queues_v0.4.8.png)

- **What it is:** The queue surface for follow-up prompts, steering messages, user bash work, and loaded prompt lists while a tab is busy or ready.
- **What you can do:** Create or load prompt lists, run batches when supported, see pending queued messages, and decide whether prompts sent during an active run should steer the current agent or wait as follow-ups.

### Thinking effort picker

![Pi Web UI thinking effort picker showing off, minimal, low, medium, high, and xhigh choices](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_Effort_v0.4.8.png)

- **What it is:** A browser picker for Pi's model thinking/reasoning effort setting.
- **What you can do:** Switch between `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`, confirm the effective effort in the footer, and tune speed/cost/quality before sending a prompt.

### Scoped models

![Pi Web UI scoped models picker listing provider models and the current effective model](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_ScopedModels_v0.4.8.png)

- **What it is:** A Web UI editor for `/scoped-models`, project/global model scope rules, and model cycling order.
- **What you can do:** Search available models, enable or disable scoped entries, inspect the effective model source, and save model choices so future prompts and tabs use the intended provider/model.

### Tools setup

![Pi Web UI tools setup dialog listing available tools with enable and disable controls](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_ToolsSetup_v0.4.8.png)

- **What it is:** A browser-native `/tools` setup dialog for active and available Pi tools.
- **What you can do:** Search tools, inspect descriptions and availability, enable or disable tool access for the active session, and adjust capability exposure without leaving the browser.

### Skills setup

![Pi Web UI skills setup dialog listing installed skills and activation controls](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_SkillSetup_v0.4.8.png)

- **What it is:** A browser-native `/skills` setup dialog for installed Pi skills.
- **What you can do:** Find skills by name or description, review what each skill is for, enable or disable skills for the active session, and make skill activation more transparent before asking Pi to work.

### Optional features

![Pi Web UI optional features list showing companion packages and install or update states](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_OptionalFeatures_v0.4.8.png)

- **What it is:** A companion-package manager for Web UI-aware extensions, prompts, themes, and optional dashboards.
- **What you can do:** See whether each companion is enabled, disabled, installed-but-not-loaded, missing, or updateable; install/update known packages from localhost; and reload affected tabs when a feature becomes available.

### `/btw` side questions

![Pi Web UI BTW widget showing a side-question input and live side-thread output](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_BTW_v0.4.8.png)

- **What it is:** A Web UI widget for the optional `/btw` side-question extension, keeping quick questions separate from the main agent flow.
- **What you can do:** Ask short side questions without derailing the main chat, inspect live output, steer or stop the side thread, and transfer useful context back into the main prompt when needed.

### Guided Git workflow

![Pi Web UI guided Git workflow showing staged changes, generated commit messages, and PR controls](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_GitWorkflow_v0.4.8.png)

- **What it is:** A guided browser workflow for staging changes, generating commit messages, committing, pushing, and optionally creating a pull request.
- **What you can do:** Run the stage/message/commit/push steps, choose generated short or long commit messages, type a manual message, create or confirm PR branch names, review generated PR text, and push only after confirmation.

### Git branch picker

![Pi Web UI git branch picker showing the current branch and create-branch action](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_GitBranches_v0.4.8.png)

- **What it is:** A footer branch picker backed by the active tab's current Git repository.
- **What you can do:** View the current branch/repo, switch local branches, create and switch to a new branch, and get warnings when a branch change could affect active agent work.

### Git diff viewer

![Pi Web UI Git Changes dialog showing repository status, file list, and side-by-side diff rows](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_GitDiff_v0.4.8.png)

- **What it is:** A browser diff dialog for current Git changes in the active workspace.
- **What you can do:** Review staged, unstaged, untracked, and incoming changes; jump between files; see additions/deletions with line numbers; and inspect text previews before asking Pi to edit, commit, or create a PR.

### Codex usage

![Pi Web UI Codex usage widget showing subscription usage windows and reset timers](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_CodexUsage_v0.4.8.png)

- **What it is:** A side-panel usage widget for Codex-family subscription-backed models.
- **What you can do:** Refresh usage, monitor short-window and weekly limits, see reset timing, and decide whether to switch models or delay large prompts.

### Pi stats dashboard

![Pi Web UI stats dashboard showing token, cost, cache, model, and daily usage analytics](https://raw.githubusercontent.com/Firstp1ck/npm-packages/main/pi-package-webui/images/Webui_Pistats_v0.4.8.png)

- **What it is:** The browser overlay from the optional stats companion, summarizing token, cost, cache, prompt/context, model, session, and command usage.
- **What you can do:** Filter by time range, refresh analytics, review daily/model/session breakdowns, inspect cost and cache behavior, and calibrate prompt estimates for more accurate local usage visibility.

Useful browser endpoints exposed by the local server include:

- `GET /api/health` and `GET /api/webui-status?detailed=1` for server health, network exposure, tabs, sessions, models/providers, update state, and recent events.
- `GET /api/tabs`, `POST /api/tabs`, `PATCH /api/tabs/<tabId>`, and tab close/delete routes for multi-tab lifecycle management.
- `GET /api/messages?tab=<tabId>&since=<index>` for transcript snapshots or delta refreshes.
- `POST /api/prompt`, `POST /api/follow-up`, `POST /api/steer`, `POST /api/bash`, `POST /api/abort`, and `POST /api/abort-bash` for tab-scoped Pi interaction.
- `POST /api/attachments` for uploaded/generated prompt attachments and inline images.
- `GET /api/path-suggestions?tab=<tabId>&query=<path>` for `@` file/path references with live suggestions.
- `GET /api/path-fast-picks` and `POST /api/path-fast-picks` for server-persisted cwd fast picks.
- `GET /api/native-parity` for the packaged native TUI/Web UI parity matrix.
- `GET /api/settings`, `POST /api/settings`, `GET /api/tools`, `POST /api/tools`, `GET /api/skills`, and `POST /api/skills` for browser-native Pi settings/tool/skill selectors.
- `GET /api/skill-file` and localhost-only `POST /api/skill-file` for guarded `SKILL.md` editing from tracked skill tags.
- `GET /api/sessions`, `GET /api/session-tree`, `POST /api/switch-session`, `POST /api/session-rename`, and localhost-only `POST /api/session-delete` for resume/tree/session metadata flows.
- `GET /api/auth-providers` and localhost-only `POST /api/auth-logout` for provider-auth status and stored-credential removal.
- `GET /api/app-runners`, `POST /api/app-runner`, `POST /api/app-runner/input`, `POST /api/app-runner/stop`, `GET/POST/DELETE /api/app-runner-config`, and `GET /api/app-runner-files` for detected and custom project runners.
- `GET /api/git-changes`, `POST /api/git-changes/pull`, `GET /api/git-branches`, `POST /api/git-branch`, and `/api/git-workflow/*` for browser Git status, diff, branch, init, commit, push, and PR helpers.
- `POST /api/action-feedback?tab=<tabId>` for feedback on final assistant output and action cards.
- `GET /api/optional-features` for optional companion package install/update status.
- `POST /api/optional-feature-install` for installing or updating known optional companion packages from the side panel.
- `GET /api/update-status`, localhost-only `POST /api/restart`, and localhost-only `POST /api/update` for checking Pi/Web UI updates and restarting the Web UI. Use `POST /api/update?all=1` to run `pi update --all` for Pi plus configured packages.
- `GET /api/network`, localhost-only `POST /api/network/open`, localhost-only `POST /api/network/close`, `GET /api/remote-auth`, `POST /api/remote-auth`, and localhost-only `POST /api/remote-auth/settings` for trusted-LAN exposure and optional 4-digit PIN authentication when serving non-local browser clients.

For local development, run the checkout helper directly, for example:

```bash
./dev/scripts/start-webui.sh --dev --cwd /path/to/project
```

Run `../dev/scripts/sync-pi-package-symlinks.sh` first when developing companion packages from this workspace. The Web UI manifest loads companions through `node_modules/` paths, and the sync script links those paths to the top-level dev packages so only one copy is loaded.

## Optional companion packages

A normal Pi/npm install includes the optional companion packages unless optional dependencies are disabled. Each Web UI tab curates Pi resources from the Web UI package that started the server, while preserving unrelated user/project resources. Companion packages installed as global/npm-prefix siblings of the started Web UI package are reused when the Web UI package does not have its own nested optional dependency copy, avoiding duplicate loads while keeping global `pi-webui` launches working. Startup checks loaded Pi capabilities directly through RPC-visible commands and live widget events, then the side panel shows each optional feature as enabled, disabled, installed-but-not-loaded, update-available, or install-needed. Installing or updating a feature is an explicit, warned action with running/failure feedback in the row and activity log; it is localhost-only, limited to known packages, and requires reloading the active Pi tab after installation.

When the standalone global `pi-webui` launcher is used, optional companion installs target the npm prefix containing the Web UI package when that prefix is safe, otherwise the Pi agent npm root if it contains Web UI. Override the target explicitly with `PI_WEBUI_OPTIONAL_FEATURE_INSTALL_ROOT=/path/to/package-root` when needed.

Optional companions:

- `@firstpick/pi-extension-btw` — ephemeral `/btw` side-question command with a TUI overlay, Web UI live output widget, and Transfer Context action.
- `@firstpick/pi-prompts-git-pr` — guided Git commit/push workflow.
- `@firstpick/pi-extension-release-npm` — NPM publish menu and release widgets.
- `@firstpick/pi-extension-release-aur` — AUR publish menu and release widgets.
- `@firstpick/pi-extension-workflows` — `/workflow` runtime with non-blocking Web UI subprocess-output widgets.
- `@firstpick/pi-extension-safety-guard` — interactive guardrails for dangerous bash commands and protected file edits.
- `@firstpick/pi-extension-setup-skills` — TUI `/skills` setup command alongside WebUI-native skill toggles.
- `@firstpick/pi-extension-todo-progress` — todo-progress rendering.
- `@firstpick/pi-extension-tools` — TUI `/tools` active-tool manager alongside WebUI-native tool toggles.
- `@firstpick/pi-package-remote-webui` — `/remote` trusted-LAN QR helper plus the optional browser controls for opening/closing LAN access and Remote PIN auth.
- `@firstpick/pi-extension-git-footer-status` — richer extension-owned git/footer status, including the structured Web UI footer payload.
- `@firstpick/pi-extension-stats` — stats commands and status data.
- `@firstpick/pi-themes-bundle` — Web UI and Pi theme resources.

## Guided Git workflow

The Git workflow button runs local git commands in the active Pi working directory. It now covers both empty/new projects and existing repositories.

For a new project, the browser flow can:

1. Run `git init` when the active cwd is not yet a repository.
2. Check for `README.md` and `.gitignore`.
3. Create and stage starter `README.md`/`.gitignore` files without overwriting existing files.
4. Create an initial commit.
5. Rename the branch to `main`.
6. Add a GitHub remote from a confirmed `owner/repo`.
7. Push the initialized branch when you confirm the remote target.

For an existing repository, the workflow can:

1. Show staged, unstaged, untracked, and fetched incoming changes.
2. Fast-forward pull fetched incoming commits when the repository is safely behind.
3. Run `git add .`.
4. Send `/git-staged-msg` to Pi and read generated commit message files from `dev/COMMIT/`.
5. Use a generated short/long message, a generated single-file default such as `updated file.txt`, or a manual **Commit input** message.
6. Run `git push`.

After the message is generated, **Create PR** asks Pi to generate `dev/COMMIT/staged-branch-name.txt`, lets you confirm or edit the `type/feature-name` branch, then switches with `git switch -c` before committing. In PR mode, choose **Commit short**, **Commit long**, or type a message and use **Commit input**, then **Push and Create PR** pushes the branch, sends `/pr`, shows the generated `dev/PR/<branch>.md` description for editing/confirmation, and creates the pull request with `gh pr create`. Use **Manual branch** to skip agent branch-name generation and type the branch directly.

Use the workflow process buttons to jump directly to **Initialize**, **Stage**, **Message**, **Commit**, **Push**, or PR steps when earlier work was already completed manually. Selecting **Message** lets you either run `/git-staged-msg` or type a commit message and use **Commit input** directly. Selecting **Commit** loads the current generated files from `dev/COMMIT/` before enabling the commit choices. A yellow dot means that process was selected or is available but its action has not completed in this workflow; green means the process action completed.

This requires `/git-staged-msg` and `/pr` from `@firstpick/pi-prompts-git-pr`; branch-name generation uses `/git-branch-name` when available and otherwise sends an equivalent inline prompt. Creating the PR also requires an authenticated GitHub CLI (`gh`). Review the generated commit message, branch name, remote URL, and PR description before committing, pushing, or creating a PR.

## Mobile and PWA notes

- The mobile composer starts as a compact `Ask Pi…` input and grows as you type.
- Installable PWA support, blocked-tab browser notifications, and optional agent-done notifications require browser service-worker/notification support and usually require `localhost` or HTTPS.
- Plain `http://<LAN-IP>` can show the app, but some browsers disable PWA install and notifications there.

## Network safety

- Default bind is localhost-only: `127.0.0.1:31415`.
- When `@firstpick/pi-package-remote-webui` is loaded and enabled, the side-panel **Remote WebUI** controls dispatch through `/remote`: opening rebinds the server to `0.0.0.0`, shows LAN URLs when available, and toggles to "Close for network".
- The optional **Remote PIN auth** toggle is off by default on first use. When enabled through `/remote auth on` or the Remote WebUI controls, the server saves that preference, generates a fresh random 4-digit PIN for each server start, shows it in the Remote WebUI controls and `/webui-status`, and requires it from non-local browser clients.
- Localhost clients stay frictionless and can toggle Remote PIN auth through the remote companion; changing the toggle persists the preference and disconnects existing event streams so remote clients must re-authenticate after enablement.
- `--host 0.0.0.0` also exposes the Web UI to the local network; pass `--remote-auth` to start with PIN auth already enabled.
- Any connected browser client with access (and the PIN, if enabled) can control Pi and run Web UI bash actions as the Web UI process user.
- Remote PIN auth is a simple trusted-LAN HTTP gate, not hardened multi-user authentication; do not expose it to untrusted networks.
- The Web UI update endpoint is restricted to localhost, because it runs package update commands and restarts the server.
- Treat Pi Web UI as a local companion, not a hardened multi-user web service.

## Troubleshooting

- **`/webui-start` is missing:** restart Pi after installing the package.
- **Wrong port or existing server:** use `/webui-status detailed`, or start on another port with `/webui-start --port 31500`.
- **Optional feature is disabled or missing:** check the side panel, install the companion package if needed, then run `/reload` in the active Pi tab.
- **Remote browser asks for a PIN:** read it from the optional **Remote WebUI** side-panel controls, `/webui-status`, `/remote status`, or the local Web UI server log. Disable the toggle from localhost to remove the PIN gate.
- **PWA install or notifications are unavailable:** use `localhost` or HTTPS; browser support varies on LAN HTTP URLs.
