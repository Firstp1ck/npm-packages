# Qt WebUI technical reference

Advanced user guidance for requirements, commands, runtime behavior, settings, security, and troubleshooting.

[Back to README](README.md) · [Contributor guide](DEVELOPMENT.md)

## Requirements and compatibility

- Linux on a Wayland desktop session
- Quickshell 0.3 or newer available as `quickshell`
- Node.js 22.19 or newer
- Working Pi credentials and provider configuration in your existing Pi agent directory
- Optional: `notify-send` for desktop notifications and `xdg-open` for opening links

Other operating systems, X11-only sessions, and Quickshell releases older than 0.3 are not supported. Qt WebUI runs one Pi session per tab, up to eight tabs per window; file browsing and Git status views are not available yet.

Qt WebUI reads the XDG desktop portal's color-scheme preference at startup, then falls back to Qt's current preference when the portal has no answer. It uses the built-in dark palette when the desktop asks for dark mode and the built-in light palette when the desktop asks for light mode. Qt preference changes update the open window without restarting Pi.

The launcher defaults `QT_NO_XDG_DESKTOP_PORTAL=1` for Quickshell because this app does not use Qt's desktop-services portal bridge. This prevents Qt's host-registry startup warning without hiding other `qt.qpa.services` warnings. The launcher still reads the portal's color scheme before Quickshell starts. A custom QML build that needs Qt's portal bridge can opt back in with `QT_NO_XDG_DESKTOP_PORTAL=0 qt-webui`.

## Install and commands

Install the standalone command with npm:

```bash
npm install -g @firstpick/pi-package-qt-webui
```

| Command | Result |
|---|---|
| `qt-webui` | Opens Qt WebUI for the current directory. |
| `qt-webui dev` | Opens the packaged QML source and lets Quickshell reload it when files change. |
| `npm run dev` | Opens development mode from a source checkout. |

The launcher accepts no other options. Start it after changing to the project directory you want Pi to use. Spaces in directory names are supported.

Development mode does not add a separate file watcher or restart loop. Quickshell watches the selected source configuration and performs its native reload when QML changes.

## The window

A persistent left rail holds Qt WebUI identity, Pi status, workspace tabs, folder actions, session actions, and secondary utilities. The compact main header shows the session name, active workspace directory, and transcript search. A wrapping control strip below the prompt editor shows the active provider and model ID followed by the thinking effort, for example `openai-codex/gpt-5.6-sol` and `thinking high`, alongside resource, compaction, and transcript-view controls. The model and thinking values are buttons: see [Models, thinking effort, and compaction](#models-thinking-effort-and-compaction).

The conversation and prompt editor share a centered maximum width instead of stretching across the full window. Assistant messages use the quiet conversation surface, while your messages and thinking sections remain visually distinct. The prompt editor stays in the normal page flow, with a raised surface and visible focus border, so suggestions, attachments, queues, notices, and status remain usable at the minimum window size.

Status values published by extensions appear in the footer under the prompt editor: structured footer metrics (for example from `@firstpick/pi-extension-git-footer-status`) as two framed groups, session metrics and Git, with a tooltip on each value; other extension statuses form a third group, **Extensions**, labelled by the extension that set them (structured payloads show their title, with the description as a tooltip). The `cwd` status from `pi-extension-cd` is not repeated because the main header already shows the workspace. Terminal color codes are removed, and metrics that repeat the header (workspace, model) are not shown twice. The line is hidden while model information is unavailable and cleared when Pi restarts or exits. Long values are shortened visually to fit the window.

The transcript shows your prompts, Pi's answers, thinking sections, and tool cards in the order they arrive. Answers render Markdown headings, paragraphs, bold, italic, strikethrough, inline code, lists, task lists, quotes, tables, horizontal rules, and fenced code blocks with a language label and a **Copy** button. Code in common languages (JavaScript, TypeScript, Python, shell, JSON, YAML, TOML, CSS, HTML, SQL, Rust, Go, C-family, diffs, and more) is syntax highlighted; **Select text** switches a block to a plain selectable view and back, and **Copy** always copies the original code. Blocks longer than 8,192 characters and unknown languages stay plain. Thinking sections appear in a distinct color and can be hidden with **Hide thinking** or `Ctrl+T`. Tool cards show the tool name, a short summary of its arguments, a running/done/failed state, the duration, and the output behind **Show output**.

**Compact** (`Ctrl+Shift+M`) tightens spacing and hides tool argument summaries. **Search** (`Ctrl+F`) matches the original text of messages and tool output, highlights the current match, and moves with **Next**, **Previous**, `Enter`, and `Shift+Enter`. **Copy** on a message copies its original text, not the styled rendering.

The transcript follows new output while you are near the bottom and stops following when you scroll up to read history.

## Tabs, sessions, and worktrees

Each tab is one Pi session in one folder. The vertical tab list in the left rail shows every tab with a status dot (grey while Pi starts, green when ready, blue while working, red after an error), an unread count for answers that finished while another tab was shown, and an **input** badge when an extension in that tab is waiting for an answer. Tabs are named after their folder until you rename them (`F2`), which also stores the name as the Pi session name. **New tab** (`Ctrl+N`) opens another tab in the same folder with a fresh session; **Open folder** (`Ctrl+O`) opens the folder picker. `Ctrl+Tab` and `Ctrl+Shift+Tab` cycle through tabs and `Ctrl+1` to `Ctrl+8` jump to a tab.

The folder picker lists subfolders of the current path with a **git** mark for repositories, accepts a typed path, offers **Back**, **Up**, **Home**, hidden folders, **Pin**, and **New folder**, and shows pinned and recent folders as shortcuts. **Open this folder** starts a new tab there; nothing changes until you choose. A tab never changes its folder: to work elsewhere, open another tab.

Switching tabs shows that tab's transcript (the last 80 entries), status, model, queues, pending extension questions, and attachments as they are; the unsent prompt is kept per tab. Runs keep going in tabs you are not looking at, and a notice tells you when a background tab finishes, fails, or needs input. Closing a tab (`Ctrl+W` or its **×**) stops that tab's Pi process; if the tab is still working, a confirmation explains that the run is aborted first. Closing the last tab replaces it with a fresh session in the same folder.

Your open tabs, their folders, session files, and names are saved and restored the next time Qt WebUI starts: each restored tab resumes its session, folders that no longer exist are skipped with a notice, and the folder you launched from is selected (a tab is added for it when needed).

**Sessions** (`Ctrl+Shift+O`, or **Resume a session** in an empty tab) lists the sessions Pi saved for the tab's folder, newest first, with the name or first prompt and the message count (up to 200 sessions). Choosing one loads its history into the tab; when the last exchange looks unfinished (an unanswered prompt or an aborted answer), a notice says so instead of presenting it as complete. `Ctrl+Shift+N` starts a new session in the tab; the previous one stays saved. Both actions wait until the tab is idle.

**Worktree** (`Ctrl+Shift+B`) creates a new branch and checks it out in a separate folder, then opens that folder in a new tab. You enter the branch name, and a confirmation shows the exact branch, the base it starts from, and the folder that will be created (next to the repository, named `<repository>-<branch>`). Nothing is created until you confirm. Existing branches, existing folders, and repositories without commits are refused before anything runs, and a failed creation removes what it started so the repository is left unchanged; anything it could not remove is named in the error.

## Command palette, usage, events, and diagnostics

**Palette** (`Ctrl+K`) lists every action with its shortcut, the open tabs, the configured models, the ten most recent saved sessions for the folder, Pi's commands, and the skill files Pi reports. Type to filter (the group name matches too), use the arrow keys, and press `Enter`. Actions you used recently move to the top in a **Recent** group. Choosing a Pi command inserts `/name ` into the prompt so you can add arguments; nothing is sent until you press `Enter` in the prompt. Choosing a skill file asks for confirmation and then opens it with your default application. Models, sessions, and commands are reloaded each time the palette opens, so the list follows Pi's current configuration.

The footer shows a **Usage** group once Pi reports statistics for the tab: the context-window fill in percent (amber from 75%, red from 90%; a dash right after compaction until the next answer), the token total with a breakdown in the tooltip, and the cost Pi calculated. It refreshes after every run and whenever a tab is shown.

**Events** (`Ctrl+Shift+L`) lists the last 200 notices from every tab, including background tabs, with the time and the tab they came from. Filter by severity (**All**, **Info**, **Warning**, **Error**) or by text; repeated identical events collapse into one row with a count. **Copy** puts the listed events on the clipboard as plain text and **Clear** empties the history.

**Diagnostics** (`Ctrl+Shift+D`) shows a plain-text report: backend process ID, uptime, and memory; the launch and active folders; Pi's state, model, and session file; request and event counters for the client and the backend; the settings, state, and sequence file paths; every tab with its Pi process ID; and the last ten errors. **Copy** puts the report on the clipboard for a bug report.

## Prompts, steering, and follow-ups

`Enter` sends the prompt while Pi is idle; `Shift+Enter` inserts a new line. While Pi is working the editor stays available: `Enter` or **Steer** delivers a steering message after the current tool calls finish, and `Alt+Enter` or **Follow-up** queues a message for after the run ends. An animated indicator under the last transcript entry shows the current activity while a run is active. **Abort** (or `Ctrl+Shift+X`) stops the active run; an abort sent before Pi acknowledges the prompt is applied as soon as the run starts. Queued messages are listed above the editor.

Prompts are limited to 8,192 characters; the editor shows a counter near the limit and refuses longer text.

## Completion, attachments, drafts, and sequences

Typing `/` at the start of the prompt lists the commands Pi reports: extension commands, prompt templates, and skills (`/skill:name`). Typing `@` anywhere lists workspace paths that match the word after it; inside a Git repository ignored files are left out, and at most 50 suggestions are shown. `Up` and `Down` move through the suggestions, `Tab` or `Enter` completes the word without sending, and `Escape` closes the list. A completed directory ends with `/` so you can keep typing into it. Commands are read from Pi once per session and again after a restart.

**Attach** (or `Ctrl+Shift+A`) opens a file picker. Files chosen there can come from anywhere; paths typed elsewhere must stay inside the workspace. Text files must be valid UTF-8 up to 256 KiB and are sent below your prompt as a labelled code block; PNG, JPEG, GIF, and WebP images up to 5 MiB are sent to the model as images when it accepts them. Up to eight files can be attached at once. Each attachment appears as a chip with its name and size; **Edit** changes the text of a text attachment before sending and **Remove** drops it. Attachments are sent with the next prompt, steering message, or follow-up, are shown on that message in the transcript, and are consumed once: a file edited after attaching is sent as it was when attached.

The prompt you have not sent yet is saved as a draft shortly after you stop typing and restored the next time the same session is shown with an empty editor. Drafts are kept per Pi session file, so switching sessions later keeps each session's unsent text.

**Sequences** (or `Ctrl+Shift+S`) keeps named lists of prompts. **New** and **Edit** take a name and one prompt per paragraph (up to 16 prompts); **Run** sends the first prompt and queues the rest as follow-ups so Pi works through them in order; **Load into prompt** copies the prompts into the editor instead; **Move up** and **Move down** reorder; **Delete** asks for a second press to confirm and never runs anything. Up to 32 sequences are saved. In the list, `Enter` runs the highlighted sequence.

## Models, thinking effort, and compaction

The model button beneath the prompt editor (or `Ctrl+M`) lists every model configured in Pi with its provider, ID, display name, and capabilities (thinking, images, context size). Type to filter, use the arrow keys, and press `Enter` to switch; the current model is marked. `Ctrl+Shift+P` cycles to the next configured model without opening the list. The thinking button (or `Ctrl+E`) lists the effort levels the current model supports, from `off` to `max`; `Ctrl+Shift+E` cycles through them. When a model does not support thinking, the list contains only `off` and cycling reports that there is nothing to cycle.

Changing the model can change the thinking effort, because Pi applies the new model's supported levels; the prompt control strip always shows the values Pi confirmed. Both controls are disabled while Pi is working, and a change that Pi rejects is shown as a notice with Pi's reason. Choosing the entry that is already active does nothing. Up to 256 models are listed; the dialog says how many more are configured.

**Resources** (`Ctrl+Shift+R`) opens profiles for enabled tools, enabled skills, and sampling values. First choose the scope:

- **Session** overrides only the current Pi session. It stays with a persisted session; for an ephemeral session the dialog warns that the override applies only until the session ends.
- **This model** applies to the exact active provider/model pair when its sessions inherit.
- **Global** applies when neither the session nor exact model supplies a value.

Session values win over exact-model values, which win over global values, which finally leave Pi's own defaults in place. The dialog always shows the effective value and its source. For tools and skills, **Inherit** means “use the next scope”; **None** is an intentional empty enabled list and prevents any item in that category from being used. Select individual names and choose **Save tools** or **Save skills** to apply them. Session changes take effect immediately in the idle tab. Exact-model and global changes are applied to every affected idle tab before they are saved; the change is refused if any affected tab is working. No Pi reload is required.

The **Sampling** section offers temperature, top-p, frequency and presence penalties, seed, top-k, and min-p. A blank field inherits. Only values declared by the active provider interface can be edited or sent; every unavailable field is disabled with the provider's reason. A value saved for another model or before a capability change stays visible and stored, but is not sent while unsupported. Resource controls are disabled while Pi is working, while a model/resource change is pending, or when the helper cannot report complete current capabilities. **Refresh** retries capability discovery. Model, thinking, and tab changes refresh the shown profiles and support state.

**Compact context** appears in the prompt control strip once the transcript has content. It asks Pi to summarize older conversation so the context stays within the model's window, shows **Compacting…** until Pi answers, and then reports the token counts before and after. Prompts and model changes are refused while compaction runs. If compaction fails, Pi's error appears in the error panel and the session stays usable. Pi's automatic compaction and retries continue to appear as notices.

## Extension dialogs

When a Pi extension asks a question, a modal dialog opens with the question's title and text:

- **Select** lists the options; use the arrow keys and `Enter`, or click an option.
- **Confirm** offers **Yes** and **No**.
- **Input** offers a single-line field; `Enter` submits.
- **Editor** offers a multi-line field; `Ctrl+Enter` saves.

`Escape` or **Cancel** declines the request. Each request is answered exactly once, and pending requests are cancelled automatically when Pi exits or the window closes. Extension notifications appear as short notices at the bottom of the window.

## Notifications and links

When the window is not focused, Qt WebUI sends a desktop notification through `notify-send` when a run finishes or fails and when an extension needs your input. Notifications are skipped when `notify-send` is not installed.

Links in answers never open automatically. Activating a link shows the full address and opens it with `xdg-open` only after you choose **Open link**. Only `http`, `https`, and `mailto` addresses are accepted; other schemes stay plain text. Images referenced in answers are shown as text placeholders and are never downloaded.

## Settings and storage

Display choices are saved in `$XDG_CONFIG_HOME/qt-webui/settings.json` (usually `~/.config/qt-webui/settings.json`) with owner-only permissions:

| Setting | Default | Meaning |
|---|---|---|
| `compactTranscript` | `false` | Use compact transcript rows. |
| `showThinking` | `true` | Show thinking sections. |
| `desktopNotifications` | `true` | Send desktop notifications while the window is unfocused. |
| `syntaxHighlighting` | `true` | Highlight fenced code blocks. |

The file is rewritten atomically. An unreadable or invalid file is ignored with a notice and the defaults apply. Saved prompt sequences live next to it in `sequences.json`; global and exact-model resource profiles live in `resources.json`; and unsent drafts, open tabs, and pinned and recent folders live in `$XDG_STATE_HOME/qt-webui/state.json` (usually `~/.local/state/qt-webui/state.json`), all with owner-only permissions. Session resource profiles stay in Pi's own saved session history rather than the shared profile file. If Pi reports that a session is ephemeral, the profile remains in memory only and the dialog shows that it is not durably saved. Sessions are listed from Pi's own session directory for the folder (`~/.pi/agent/sessions/`, or `$PI_CODING_AGENT_DIR/sessions/`). Attachments stay in memory until they are sent, and Pi keeps its own session files in your Pi agent directory.

## Runtime and security behavior

Qt WebUI starts one local backend process for the window, and that backend starts one Pi process with the Pi version installed with this package. It does not search for or run a global `pi` command. Closing the window ends the backend, Pi, and any tool processes Pi started, waiting up to three seconds before forcing termination. If the backend stops unexpectedly the window shows the exit code and **Restart** starts it again.

The app does not open a network listener. Prompts remain data passed to the local Pi process, which then contacts the provider configured in Pi. Qt WebUI does not collect or store provider credentials. Pi still has the project and tool access granted by your existing configuration, so inspect tool cards before allowing consequential work.

Everything Pi and its extensions produce is treated as untrusted text. Raw HTML in answers is shown literally, only a fixed set of inline styles is rendered, and dialog titles, options, tool output, and notices are displayed as plain text. Long content is shortened at fixed limits: 80 transcript rows, 8,192 characters per message part, 4,096 characters of tool output, and 512 characters per error.

`SIGINT` and `SIGTERM` sent to the launcher are forwarded to Quickshell. The command exits with Quickshell's exit result, which makes failures visible to scripts and terminals.

## Keyboard reference

| Keys | Action |
|---|---|
| `Enter` | Send the prompt, or steer the active run |
| `Shift+Enter` | Insert a new line in the prompt |
| `Alt+Enter` | Queue a follow-up while Pi is working |
| `Ctrl+Shift+X` | Abort the active run |
| `Ctrl+F` | Open transcript search; `Enter` next, `Shift+Enter` previous, `Escape` close |
| `Ctrl+T` | Show or hide thinking sections |
| `Ctrl+Shift+M` | Toggle compact rows |
| `Ctrl+L` | Focus the prompt editor |
| `Ctrl+M` | Choose a model; `Ctrl+Shift+P` cycles to the next model |
| `Ctrl+E` | Choose the thinking effort; `Ctrl+Shift+E` cycles through the levels |
| `Ctrl+Shift+R` | Open tool, skill, and sampling resource profiles |
| `Ctrl+Shift+A` | Attach files |
| `Ctrl+Shift+S` | Open saved prompt sequences |
| `Ctrl+N` / `Ctrl+O` | New tab in the same folder / open another folder in a new tab |
| `Ctrl+W` | Close the tab (asks first while Pi is working) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` / `Ctrl+1`–`Ctrl+8` | Switch tabs |
| `Ctrl+Shift+O` / `Ctrl+Shift+N` | Resume a saved session / start a new session in the tab |
| `Ctrl+Shift+B` | Create a Git worktree for a new branch in a new tab |
| `F2` | Rename the tab and its Pi session |
| `Ctrl+K` | Open the command palette |
| `Ctrl+Shift+L` / `Ctrl+Shift+D` | Open the event history / the diagnostics report |
| `/`, `@` | Suggest commands or workspace paths; `Tab` or `Enter` completes without sending, `Escape` closes |
| `Tab` / `Shift+Tab` | Move between controls; dialogs keep focus until closed |
| `Escape` | Cancel the open dialog |

## Troubleshooting

### Quickshell cannot be started

Confirm that version 0.3 or newer is installed and visible on your `PATH`:

```bash
quickshell --version
```

Run the command inside a Wayland desktop session. A missing executable produces a launcher error explaining this requirement.

### The Pi entry cannot be resolved

Reinstall `@firstpick/pi-package-qt-webui` so its npm dependencies are restored. The launcher intentionally does not fall back to an unrelated global Pi installation.

### The window says the backend exited

Choose **Start backend**. If it happens again, start `qt-webui` from a terminal: backend messages are shown as notices in the window and Quickshell's terminal output includes the QML log.

### Pi does not become ready

Pi has fifteen seconds to answer the first state request. If it does not, the window shows **Pi did not report readiness in time** and **Restart Pi** tries again. Restarting shows **Restarting…** on the button and a notice until Pi reports ready again. Check that Pi starts in the same directory from a terminal and that your provider configuration is valid.

### Pi cannot access the intended project

Close the app, change to the project directory, and start `qt-webui` again. The working directory is captured at startup.

### A model or thinking level cannot be selected

The prompt control strip's model and thinking controls are disabled while Pi is working or while another change is still being confirmed. If Pi rejects a change, the notice shows Pi's reason, for example a thinking level that the selected model does not support or a model that is no longer configured. The models offered come from Pi's own configuration; add or remove models in Pi, then reopen the list.

### Resource profiles are unavailable or a sampling field is disabled

Resource changes require idle affected Pi sessions and complete capability information from the bundled helper. Wait for current runs or model changes to finish, then open **Resources** and choose **Refresh**. A disabled sampling field shows the provider-interface reason; its stored value is preserved and will become active again only on a model that declares support. Unknown provider interfaces fail closed and receive no optional sampling values. If the dialog says a session profile is not durable, the override is active only for that ephemeral session; use a persisted Pi session if it must survive restart. If the entire profile stays unavailable after refresh, restart Pi in that tab; core prompts and model changes remain usable without resource editing.

### Saved tabs did not come back

Tabs are restored from `state.json` when the backend starts. A tab whose folder was deleted is skipped with a notice, and a tab whose session file is gone starts a new session in the same folder. At most eight tabs are restored.

### A worktree cannot be created

The tab's folder must be inside a Git repository with at least one commit, the branch name must be valid for Git, and the target folder must not exist. The confirmation shows the exact folder; choose a different branch name if it is taken. If Git fails while creating the worktree, Qt WebUI removes the folder it created and deletes the new branch; the error names anything it could not clean up.

### A file cannot be attached

Only regular files are accepted: text must be valid UTF-8 without NUL bytes and at most 256 KiB, and images must be real PNG, JPEG, GIF, or WebP files of at most 5 MiB. A file outside the workspace is refused unless it was chosen through the picker. Choose **Remove** on a chip to free one of the eight attachment slots.

### Notifications or links do not work

Install `libnotify` (for `notify-send`) and `xdg-utils` (for `xdg-open`). Notifications are only sent while the window is unfocused and while the `desktopNotifications` setting is enabled.

### The color scheme does not match the desktop

Qt WebUI prefers the color scheme reported by the XDG desktop portal and falls back to Qt. Confirm the portal result with `busctl --user call org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.Settings Read ss org.freedesktop.appearance color-scheme`. The final number is `1` for dark, `2` for light, and `0` for no preference. If the portal cannot be read, confirm that other Qt applications see the expected theme and that your session exports the intended Qt platform theme.

### Development changes do not reload

Use `qt-webui dev` for the globally installed package or `npm run dev` from a source checkout. Edit the QML files selected by that command and check Quickshell's terminal output for load errors. Native reload cannot recover from every syntax error until the file is corrected.

## Contributor information

Implementation architecture, environment contracts, and validation commands are in [DEVELOPMENT.md](DEVELOPMENT.md).
