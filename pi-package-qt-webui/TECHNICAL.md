# Qt WebUI technical reference

Advanced user guidance for requirements, commands, runtime behavior, settings, security, and troubleshooting.

[Back to README](README.md) · [Contributor guide](DEVELOPMENT.md)

## Requirements and compatibility

- Linux on a Wayland desktop session
- Quickshell 0.3 or newer available as `quickshell`
- Node.js 22.19 or newer
- Working Pi credentials and provider configuration in your existing Pi agent directory
- Optional: `notify-send` for desktop notifications and `xdg-open` for opening links

Other operating systems, X11-only sessions, and Quickshell releases older than 0.3 are not supported. Qt WebUI provides one Pi session per window; sessions, tabs, file browsing, Git views, and model selection are not available yet.

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

The header shows the workspace directory, the session name when Pi reports one, and, after Pi is ready, the active provider and model ID followed by the thinking effort, for example `openai-codex/gpt-5.6-sol · thinking high`. Status values published by extensions appear in the footer under the prompt editor: structured footer metrics (for example from `@firstpick/pi-extension-git-footer-status`) as two framed groups, session metrics and Git, with a tooltip on each value; other extension statuses form a third group, **Extensions**, labelled by the extension that set them (structured payloads show their title, with the description as a tooltip). The `cwd` status from `pi-extension-cd` is not repeated because the header already shows the workspace. Terminal color codes are removed, and metrics that repeat the header (workspace, model) are not shown twice. The line is hidden while model information is unavailable and cleared when Pi restarts or exits. Long values are shortened visually to fit the window.

The transcript shows your prompts, Pi's answers, thinking sections, and tool cards in the order they arrive. Answers render Markdown headings, paragraphs, bold, italic, strikethrough, inline code, lists, task lists, quotes, tables, horizontal rules, and fenced code blocks with a language label and a **Copy** button. Thinking sections appear in a distinct color and can be hidden with **Hide thinking** or `Ctrl+T`. Tool cards show the tool name, a short summary of its arguments, a running/done/failed state, the duration, and the output behind **Show output**.

**Compact** (`Ctrl+Shift+M`) tightens spacing and hides tool argument summaries. **Search** (`Ctrl+F`) matches the original text of messages and tool output, highlights the current match, and moves with **Next**, **Previous**, `Enter`, and `Shift+Enter`. **Copy** on a message copies its original text, not the styled rendering.

The transcript follows new output while you are near the bottom and stops following when you scroll up to read history.

## Prompts, steering, and follow-ups

`Enter` sends the prompt while Pi is idle; `Shift+Enter` inserts a new line. While Pi is working the editor stays available: `Enter` or **Steer** delivers a steering message after the current tool calls finish, and `Alt+Enter` or **Follow-up** queues a message for after the run ends. An animated indicator under the last transcript entry shows the current activity while a run is active. **Abort** (or `Ctrl+Shift+X`) stops the active run; an abort sent before Pi acknowledges the prompt is applied as soon as the run starts. Queued messages are listed above the editor.

Prompts are limited to 8,192 characters; the editor shows a counter near the limit and refuses longer text.

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

The file is rewritten atomically. An unreadable or invalid file is ignored with a notice and the defaults apply. Qt WebUI stores nothing else; Pi keeps its own session files in your Pi agent directory.

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

### Notifications or links do not work

Install `libnotify` (for `notify-send`) and `xdg-utils` (for `xdg-open`). Notifications are only sent while the window is unfocused and while the `desktopNotifications` setting is enabled.

### The color scheme does not match the desktop

Qt WebUI prefers the color scheme reported by the XDG desktop portal and falls back to Qt. Confirm the portal result with `busctl --user call org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.Settings Read ss org.freedesktop.appearance color-scheme`. The final number is `1` for dark, `2` for light, and `0` for no preference. If the portal cannot be read, confirm that other Qt applications see the expected theme and that your session exports the intended Qt platform theme.

### Development changes do not reload

Use `qt-webui dev` for the globally installed package or `npm run dev` from a source checkout. Edit the QML files selected by that command and check Quickshell's terminal output for load errors. Native reload cannot recover from every syntax error until the file is corrected.

## Contributor information

Implementation architecture, environment contracts, and validation commands are in [DEVELOPMENT.md](DEVELOPMENT.md).
