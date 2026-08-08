# Technical reference: Pi Web UI

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Requirements

- Node.js 22.19 or newer
- Pi installed and configured
- A modern browser

## Install

```bash
pi install npm:@firstpick/pi-package-webui
```

Restart Pi after installation.

## Start from Pi

```text
/webui-start
```

The usual address is <http://127.0.0.1:31415/>.

Common options:

```text
/webui-start 31500
/webui-start --no-open
/webui-start --name browser
/webui-start --remote-auth --host 0.0.0.0
```

- `--host <host>` changes the listening address.
- `--port <port>` changes the port.
- `--no-open` prevents automatic browser opening.
- `--no-session` starts without loading a saved Pi session.
- `--name <name>` names the first tab.
- `--remote-auth` enables PIN protection for non-local browsers.
- Arguments after `--` are passed to Pi.

Check a running Web UI with `/webui-status`. Add `detailed` to include tabs, sessions, models, and recent events.

## Standalone launcher

```bash
npm install -g @firstpick/pi-package-webui
pi-webui
```

Useful options:

- `--cwd <path>` chooses the first project folder.
- `--pi <command>` chooses the Pi executable.
- `--host` and `--port` change the listening address.
- `--output-mode normal|compact-v1` chooses the default output style.
- `--remote-auth` enables PIN protection for non-local browsers.
- `--migration-dry-run` previews optional-feature migration without changing packages.

If `--cwd` is omitted, the browser asks which project to open first.

## Settings and storage

User settings are stored in `~/.pi/webui/settings.json` by default. An older `~/.config/pi-webui/settings.json` is imported once when the new file does not yet exist.

Common overrides:

- `PI_WEBUI_HOST` and `PI_WEBUI_PORT` set the default address.
- `PI_WEBUI_PI_BIN` selects the Pi executable.
- `PI_WEBUI_REMOTE_AUTH=1` starts with PIN protection enabled.
- `PI_WEBUI_OUTPUT_MODE=normal|compact-v1` sets the default output style.
- `PI_WEBUI_SETTINGS_FILE` chooses another settings file.
- `PI_SESSION_SUMMARY_CONFIG_FILE` chooses another session-summary profile.
- `PI_WEBUI_FAST_PICKS_FILE` chooses another saved-folder list.

Private runtime and recovery files should not be edited or removed while Web UI tabs are active.

## Updates and rollback

The Pi and Web UI update controls show a plan before making changes. The confirmed plan is rejected if it becomes stale or no longer matches the running installation.

Web UI updates keep the previous working version available. If the replacement does not become healthy, the launcher restores the previous version automatically. Installations that cannot be identified safely are left unchanged and receive manual guidance instead.

A short interruption is possible during restart; zero downtime is not promised.

## Session continuity

Restarting only the Web UI normally keeps managed Pi tabs, working folders, saved sessions, and active work connected to the replacement server.

Continuity requires the same Pi configuration location and Web UI port. It does not preserve browser drafts, app-runner processes, or an active model request across a machine restart, power loss, explicit shutdown, or supervisor failure. Saved transcript history can still be reopened afterward.

Use **Stop** when you intend to terminate managed tabs. Do not manually delete runtime state while tabs are active.

## Session titles and summaries

Run `/summary-setup` to choose the summary model, automatic generation, title behavior, prompts, and optional latest-summary context.

Summary generation is opt-in. It uses the active user message, final assistant response, and tool names; it excludes thinking, images, tool arguments and results, credentials, and hidden provider data. Failed refreshes keep the previous successful summary.

Use `/summary`, `/summary refresh`, or `/summary workspace` to view, refresh, or compare available summaries. Turn off automatic generation to stop recurring model calls without deleting saved prompts or previous summaries.

## Optional features

The Web UI checks optional companion packages when it starts. Missing or older companions appear in the Optional features panel.

- **Migrate…** reviews and installs selected legacy companions.
- **Later** dismisses the startup reminder while leaving migration available in settings.
- **Retry failed** retries only failed package installs.
- **Copy commands** provides manual Pi install commands.
- **Recheck** repeats the read-only package check.

Installs run one at a time and never invent percentage progress. Busy tabs are not restarted without a visible follow-up action.

## Normal and compact output

Normal output shows the full live tool and response stream. Compact output keeps the current tool status and final answer while omitting most intermediate details from the live display.

Choose the mode under **Controls → Output processing** or **Settings → Browser workflow**. The setting affects display only; it does not change Pi prompts, tools, models, saved transcript meaning, or inference.

## Mobile layout

At the phone/coarse-pointer breakpoint, the legacy mobile shell collapses terminal navigation and secondary composer controls by default:

- Both legacy mobile and Mobile Experience v2 use a balanced compact scale for text, cards, padding, gaps, and navigation. Interactive controls use the user-selected 40-pixel minimum; safe-area offsets remain intact. Tablet and desktop sizing are unchanged.
- Tap the current terminal summary to open full-screen terminal navigation containing terminal tabs, new-tab choices, workspace actions, and **Close all Tabs**.
- On mobile, a regular or subagent terminal-group title is a dropdown button. Open it to reveal the group list, then choose an individual terminal or subagent view. Desktop group-title clicks keep switching directly to the active group member.
- Close full-screen terminal navigation with the summary button, `Escape`, or by choosing a terminal.
- Git footer **Details** opens as a full-screen legacy-mobile overlay. Refresh is available only inside the expanded overlay; use the top `−` button or `Escape` to minimize it. The overlay packs content at the top in two labelled grids: session metrics, then workspace, Git, and runtime metadata. Odd or long cards span both columns. Desktop refresh behavior is unchanged.
- The compact composer keeps the prompt, attachment, Send, and applicable Abort, Follow-up, and Steer controls immediately available.
- Todo progress uses one overflow-safe summary line while collapsed. Tap the line to expand the goal, progress bar, checklist, and footer; native keyboard and screen-reader disclosure behavior remains available.
- Tap **More** to open grouped session, workspace, command, workflow, context, and mode controls in a full-screen legacy-mobile overlay. Use the accessible top-right `−` control or `Escape` to minimize it and return focus to **More**.
- Control Deck section reordering is always enabled on desktop: drag a section header or use `Alt+ArrowUp` / `Alt+ArrowDown`. Mobile keeps the transient **Edit** / **Done** mode so normal touch scrolling and section toggling stay protected; the resulting order continues to use the existing durable layout preference.
- Opening the software keyboard hides secondary disclosure chrome while retaining prompt entry and applicable primary run controls.
- Touch pointers do not schedule hover-only tooltips or reveal latched CSS hover hints. Fine-pointer hover and keyboard-focus help remain available where supported.
- Tablet layout, desktop tab placement, stored composer ordering, and command behavior are unchanged.

The optional Mobile Experience v2 shell remains separately controlled by its existing preview setting and is not changed by this legacy mobile layout.

## Themes

Use **Controls → Interface → Theme** to choose a theme. **Customize…** opens the visual editor.

Project themes are saved under `.pi/themes/` in a trusted project. Global themes are saved under `~/.pi/agent/themes/`. Preview changes are temporary until saved, and overwriting an existing theme requires confirmation.

Reload or restart Pi before selecting a newly saved custom theme in the terminal interface.

## App runners

The runner menu detects common project commands and scripts. Projects may add `.pi-webui-runners.json` for custom runners and extra script-search folders.

Search folders must stay inside the project, cannot use `..`, and are scanned only one level deep. Invalid or missing folders are shown as diagnostics instead of being scanned.

## Remote access

Web UI listens on localhost by default. Do not expose it directly to an untrusted network.

Use `@firstpick/pi-package-remote-webui` for trusted-LAN access, QR connection details, and PIN protection. Close LAN access when finished. PIN protection is a trusted-network convenience, not hardened multi-user authentication.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Open the command palette |
| `Ctrl/Cmd+L` | Open the model selector |
| `Ctrl/Cmd+P` | Cycle models |
| `Shift+Tab` | Cycle thinking effort |
| `Ctrl/Cmd+T` | Toggle thinking visibility |
| `Ctrl/Cmd+O` | Expand or collapse tool output |
| `Alt+Enter` | Queue a follow-up |
| `Alt+Up` | Restore the latest queued prompt |
| Hold `Esc` | Abort active work |
| `Ctrl/Cmd+F` | Search the transcript |

## Troubleshooting

- Use `/webui-status detailed` when the browser cannot reconnect or a tab looks stale.
- Keep the same port and Pi configuration location when restarting for session continuity.
- Explicitly stop managed tabs before disabling continuity or removing private runtime files.
- Use **Recheck** after fixing an optional-package or settings problem.
- If a summary model is unavailable, sign in or choose another model in `/summary-setup`.
- If compact mode is confusing, return to Normal under Output processing.

## Compatibility and limitations

- App runners stop during Web UI restart and must be started again.
- An operating-system restart cannot resume the same in-progress model request.
- Some native Pi commands have browser-specific behavior or remain terminal-only.
- Remote clients have fewer package-management and local-file actions than localhost clients.
