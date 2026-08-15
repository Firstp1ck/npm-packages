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

Tabs use automatic naming from the first prompt unless you provide an explicit name. Run `/summary-setup` to choose the summary model, automatic generation, title behavior, prompts, and optional latest-summary context.

Summary generation is opt-in. It uses the active user message, final assistant response, and tool names; it excludes thinking, images, tool arguments and results, credentials, and hidden provider data. Failed refreshes keep the previous successful summary.

Use `/summary`, `/summary refresh`, or `/summary workspace` to view, refresh, or compare available summaries. Turn off automatic generation to stop recurring model calls without deleting saved prompts or previous summaries.

## File viewer

The Files panel opens UTF-8 text in Source mode, renders Markdown in Preview mode, and displays supported raster images as read-only previews. Image support covers PNG, JPEG, GIF, WebP, and AVIF. SVG, PDF, video, audio, and other binary formats are not rendered in the viewer; use **Open in Default Editor** from the file row instead.

Text and image reads remain scoped to the active tab's working directory and its existing path-confinement checks. The viewer limits each file to 2 MiB. Image previews cannot be edited, searched as text, or sent as text selections. Git-originated image opens still begin in Changes mode when a bounded Git snapshot is available, with Preview available alongside it.

## Optional features

Every server start performs a bounded, read-only startup audit of optional companion packages. Missing, unregistered, or older companions appear in the Optional features panel without blocking the core Web UI.

- **Migrate…** reviews and installs selected legacy companions.
- **Later** dismisses the startup reminder while leaving migration available in settings.
- **Retry failed** retries only failed package installs.
- **Copy commands** provides manual Pi install commands.
- **Recheck** repeats the read-only package check.
- **Install all** selects every missing or unregistered companion. A section's **Install missing** selects only missing or unregistered companions in that section. Both use one confirmation, install sequentially, and continue after individual failures.
- Configurable loaded companions show separate **Enable/Disable** and **Setup** actions. Native questionnaires use the real active-session `questionnaire` tool state; **Setup** opens Tools Setup, where session access and global defaults can be managed.

Installs run one at a time and never invent percentage progress. Busy tabs are not restarted without a visible follow-up action. For unattended migration, use `--migrate-optional-features`; use `--migration-dry-run` to print the planned audit-selected migration without changing packages.

You can also install a companion directly with Pi, for example:

```bash
pi install npm:@firstpick/pi-extension-stats
```

Re-running the same `pi install npm:<package>` command is the supported update path.

## Normal and compact output

Normal output shows the full live tool and response stream. Compact output keeps the current tool status and final answer while omitting most intermediate details from the live display.

Choose the mode under **Controls → Output processing** or **Settings → Browser workflow**, then select **Compact**. The stable setting and command-line identifier is `compact-v1`. The setting affects display only; it does not change Pi prompts, tools, models, saved transcript meaning, or inference.

## Code block syntax highlighting

Fenced code blocks in agent output, release notes, session summaries, and the Markdown file preview are colored automatically from the language written after the opening fence, for example ` ```python `.

Recognized languages and their aliases:

| Language | Accepted after the opening fence |
| --- | --- |
| Python | `python`, `py` |
| JavaScript | `javascript`, `js`, `jsx`, `mjs`, `cjs`, `node` |
| TypeScript | `typescript`, `ts`, `tsx` |
| Shell | `bash`, `sh`, `shell`, `zsh` |
| PowerShell | `powershell`, `pwsh`, `ps1` |
| Windows command scripts | `cmd`, `bat`, `batch`, `dos` |
| JSON | `json`, `jsonc` |
| INI and properties | `ini`, `cfg`, `conf`, `properties` |
| TOML | `toml` |
| YAML | `yaml`, `yml` |
| Diffs and patches | `diff`, `patch` |
| SQL | `sql` |
| Stylesheets | `css` |
| Markup | `html`, `htm`, `xml`, `svg` |
| Container files | `dockerfile`, `docker` |
| C and C++ | `c`, `h`, `cpp`, `c++`, `cc`, `cxx`, `hpp`, `hxx` |
| Java | `java` |
| Go | `go`, `golang` |
| Rust | `rust`, `rs` |
| C# | `csharp`, `cs`, `c#`, `dotnet` |

Behavior and limits:

- Colors come from the active theme's **Syntax Highlighting** token group, so highlighting follows your chosen light or dark theme. Editing those tokens under **Controls → Interface → Theme → Customize…** changes code colors immediately.
- A block without a language, with an unrecognized language, or larger than 50,000 characters or 2,000 lines is shown as ordinary unhighlighted text.
- Highlighting is display only. Copying a code block, selecting text, and searching the transcript still return the exact original source, and nothing is sent anywhere for analysis.
- Coloring is intentionally approximate rather than a full language parser. Unusual constructs such as nested string interpolation, shell heredocs, PowerShell here-strings, or embedded scripts inside markup may be colored imprecisely; the code text itself is never altered.
- Fenced `mermaid` and `mmd` blocks keep rendering as diagrams instead of highlighted source.

## Codex subscription Fast mode

The optional `@firstpick/pi-extension-codex-fast-mode` companion adds a **Normal / Fast** selector under **Codex Usage**. Fast mode is off by default and applies only to the active Pi session branch. Eligible subscription-backed models may respond about 1.5× faster while using 2× Standard credits for GPT-5.4 or 2.5× for GPT-5.5/5.6. Account and model eligibility remain controlled by the provider.

## Tool and skill scopes

The browser-native tool and skill selectors offer **Session only** and **Global default** scopes. Session choices apply to the current branch and take precedence when it is resumed. Global defaults are inherited by future sessions and do not rewrite branches that already have a session choice.

When the browser page is hidden, the Web UI closes that page's live event stream so the browser cannot accumulate serialized output frames for later parsing and DOM rendering. Merely moving focus to another visible window does not pause streaming. On return, it first fetches authoritative tabs, state, and transcript snapshots, reconnects live events, and refreshes nonessential panels during browser idle time. Pending extension prompts are replayed by the server after reconnection, and completed output remains available from the authoritative transcript.

## Control Deck placement and persistence

Choose **Right**, **Left**, or **Both** under **Controls → Interface → Control Deck placement**. Right is the default. Both keeps separate collapse state and width for each side; drag a section header or focus it and use `Alt+ArrowUp` / `Alt+ArrowDown` to reorder within its assigned side, and `Alt+ArrowLeft` / `Alt+ArrowRight` to move it between sides.

With **Tab placement** set to **Sidebar**, the placement control stays active but **Both** is unavailable. **Right** presents the terminal/tabs rail on the left and the Control Deck on the right; **Left** swaps them. If **Both** was selected before switching to Sidebar, Web UI changes the Control Deck placement to **Right** and saves that valid placement.

When the viewport or active split terminal/file viewer cannot fit the selected desktop columns, Web UI uses one combined Control Deck overlay. This does not change side assignments, desktop collapse state, or saved widths. Close the overlay with its backdrop or `Escape`. Mobile **Edit** / **Done** continues to allow vertical section ordering only.

Control Deck placement, side assignment/order, accordion state, visibility, side collapse, side widths, terminal placement, terminal-rail width, and the other durable interface preferences are stored in the private Web UI settings file and mirrored to browser storage for offline startup. The right Control Deck width also maintains the older single-panel compatibility value; the left width never replaces it. Concurrent tabs reconcile named fields so one tab's clean placement change does not erase another tab's pending section move or terminal-rail resize.

## Desktop panel sizing

Every visible desktop side panel has a separator on the edge facing the workspace. This includes the right Control Deck, the Control Deck after choosing **Left**, both independently sized Control Decks after choosing **Both**, and the terminal/tabs rail on either side after choosing **Sidebar**. Drag a separator to resize its panel. Focus it and use the arrow keys for 24-pixel steps, hold `Shift` for 80-pixel steps, or use `Home` and `End` for the allowed minimum and maximum. Arrow direction follows the panel edge: move toward the outside to widen the panel.

Panel widths are limited by the available desktop workspace so the main transcript retains usable space. Left and right Control Deck widths and the terminal-rail width are cached and saved independently in the user-scoped interface layout, then restored after reloads. Resize handles are hidden for collapsed panels and in mobile, tablet, overlay, and embedded layouts.

### Backup, restore, and downgrade rollback

Before downgrading, stop the Web UI and copy `~/.pi/webui/settings.json` to a safe local backup. The prior package treats the newer two-sided layout as unknown and may replace it with defaults on its next layout write. Retained browser compatibility values provide a usable right-only fallback but do not protect server-side left/right assignments.

To restore: stop the Web UI, re-upgrade to a version that supports the two-sided Control Deck, replace `~/.pi/webui/settings.json` with the backup using the same owner and private permissions, then start the Web UI. Do not restore or edit the file while tabs are active.

## Subagent observability

The **Subagents** panel accepts managed `pi-subagents` and workflow runs plus cooperating SDK, Pi RPC, JSON, print, interactive/tmux, schedule, gate, and custom launchers. It groups exact parent-session matches with their WebUI terminal and places unmatched registered runs under **External agents**. Counts include retained instances that became terminal during the current server run; the status line separately reports running and stale instances. Gate history refers to its child and does not add another count.

At server start or restart, only queued or running agents reconnect from prior state. Pre-existing stale, lost, done, failed, and cancelled rows are not loaded into terminal groups or **External agents**. A run that becomes stale, lost, or terminal after the current server starts remains visible for inspection and normal clearing.

Use the WebUI wrapper when launching Pi subprocesses that should be visible:

```bash
pi-webui agent run --launcher rpc -- pi --mode rpc --no-session
pi-webui agent run --launcher json -- pi --mode json -p --no-session "Review this change"
pi-webui agent run --launcher print -- pi -p --no-session "Review this change"
```

The command prints its resolved registration port and scope. If WebUI uses a non-default port, pass the same value with `--port <webui-port>` or set `PI_WEBUI_PORT`; the CLI does not discover running WebUI processes or scopes automatically.

Attach a persisted independent session read-only with:

```bash
pi-webui agent attach --session <session-id-or-session-file> --name "Independent review"
```

Unwrapped SDK sessions and independently started Pi/tmux processes are intentionally invisible: Pi has no safe universal parent-child discovery, and WebUI does not scan processes or tmux panes. Use the supplied tracking adapter, wrapper, reporter integration, or explicit attach. An attached session without live heartbeat evidence is shown as stale rather than assumed running.

Output quality depends on the source. Session and structured-event sources can provide a transcript; print mode provides only bounded plain output; metadata-only registrations truthfully report that output is unavailable. Controls are owner-declared: unsupported cancel, refresh, copy, and dismissal actions are hidden.

Tracked subagent output can open in the normal non-blocking overlay or in a dedicated **Subagent** terminal tab. Both views are read-only. Closing a projected terminal tab only closes that view; it does not stop or interrupt the child run.

Each tracked row can show exactly six telemetry cards: PI, measured token speed, context, model, effort, and input/output tokens from a bounded recent session scan. Unavailable or legacy evidence remains `—` or `unknown` rather than being estimated.

**Clear finished** and **Auto-Clear** can hide terminal external-agent projections from WebUI. Stale or lost sessions added with `pi-webui agent attach` remain visible for inspection and provide a row-level **Detach persisted session from WebUI** action. Clearing or detaching does not delete or modify the producer-owned registry record, output artifact, process, or session; those remain subject to their normal private retention policy.

Registry state uses the WebUI state directory (`$XDG_STATE_HOME/pi-webui/`, or `~/.local/state/pi-webui/`) and is private to the local user and WebUI scope. Do not expose WebUI directly to an untrusted network or manually edit registry files while runs are active. Browser requests use opaque output identifiers and cannot select host paths.

Troubleshooting:

- Keep the same WebUI port and Pi agent configuration directory across a restart so active registered runs reconnect to the same scope. For a non-default port, pass `--port` to every `pi-webui agent` command or set `PI_WEBUI_PORT`.
- A **stale** row has missed heartbeat evidence; **lost** means the longer loss threshold elapsed without an explicit terminal event. Neither means success.
- If an expected independent run is absent, confirm it used a wrapper/tracking adapter or attach it explicitly; process discovery is intentionally unavailable.
- If output says unavailable, the producer registered metadata but no bounded output source. Restarting the browser cannot reconstruct evidence the producer never registered.

## Agent conversation viewer

Direct `pi-intercom` messages and native subagent-supervisor coordination appear as conversation tags beneath the composer for the active tab. Each tag represents one direct two-agent conversation. Select it to open a large, read-only chat dialog; keyboard focus remains inside the dialog until it closes and then returns to the tag when that tag is still present.

The viewer reconstructs conversations from the active branch of the persisted Pi session, so supported history returns after a browser or WebUI restart. Compacted or bounded-away history may be marked unavailable. While the dialog is open, WebUI periodically checks for new persisted messages; tab changes and rapid selections discard stale responses.

Only participant names or IDs, message text, ordering time, and truncation notices are displayed. Attachments, tool calls and results, thinking, stdout/stderr, filesystem paths, raw session records, and automated subagent control/result relays are excluded. The initial view is limited to 32 conversations, 200 displayed messages per conversation, and bounded message/response sizes.

If an expected tag is absent, confirm that the agents used direct Intercom or native supervisor coordination in the active session branch. Generic child output and independent process logs do not become conversations.

## Mobile layout

On a phone, tap the current terminal name to open full-screen terminal navigation. Grouped terminals use their title as a dropdown for choosing one terminal or subagent view. Tap **More** to open secondary controls in a full-screen overlay. Git footer **Details** opens full-screen with refresh inside and a top `−` button. Hover-only tooltips stay hidden on touch controls. To reorder the **Control Deck**, tap **Edit**, move sections, then tap **Done**.

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

The optional Mobile Experience v2 shell remains separately controlled by its existing preview setting and is not changed by this legacy mobile layout. Tablet adaptation is independently opt-in at medium widths with `?tabletShell=v2`; use `?tabletShell=legacy` for immediate rollback without changing the phone preview flag.

## Git panel

The side-panel **Git** section groups repositories represented by open terminal tabs. Expanding a repository refreshes stale status after a five-minute cache window; live filesystem updates use server-sent events (SSE) to invalidate visible results without periodic Git polling. The context menu provides refresh, stage/unstage, and confirmed discard/delete actions. History shows the latest 30 commits and opens bounded read-only commit diffs.

## Themes

Use **Controls → Interface → Theme** to choose a theme.

### Custom themes

**Customize…** opens a visual editor for Pi's exact 51 required theme tokens, optional colors, variables, and advanced JSON. Valid changes preview immediately. Invalid or incomplete edits remain editable but cannot replace the last valid preview or be saved.

Choose **This project** to save under `.pi/themes/` in a trusted project, or **Global themes** to save under `~/.pi/agent/themes/`. Previewing or saving does not select the theme or mutate Pi/browser settings, and overwriting an existing theme requires confirmation. To activate a newly saved theme in Pi TUI, run `/reload` or restart Pi, then choose it with `/theme`.

## App runners

The runner menu detects common project commands and scripts. Projects may add `.pi-webui-runners.json` for custom runners and extra script-search folders.

Search folders must stay inside the project, cannot use `..`, and are scanned only one level deep. Invalid or missing folders are shown as diagnostics instead of being scanned.

## Remote access

Web UI listens on localhost by default. Do not expose it directly to an untrusted network.

Use `@firstpick/pi-package-remote-webui` for trusted-LAN access, QR connection details, and PIN protection. When LAN access is open, the same control toggles to "Close for network". Close LAN access when finished. PIN protection is a trusted-network convenience, not hardened multi-user authentication.

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
| `Ctrl/Cmd+F` | Search the active file, transcript, or subagent output stream; all matches are highlighted |
| `Alt+ArrowUp` / `Alt+ArrowDown` on a Control Deck section | Reorder among visible sections assigned to the same side |
| `Alt+ArrowLeft` / `Alt+ArrowRight` on a Control Deck section | Move the section between sides when desktop **Both** is active |

## Troubleshooting

- Use `/webui-status detailed` when the browser cannot reconnect or a tab looks stale.
- Keep the same port and Pi configuration location when restarting for session continuity.
- Explicitly stop managed tabs before disabling continuity or removing private runtime files.
- Use **Recheck** after fixing an optional-package or settings problem.
- If a summary model is unavailable, sign in or choose another model in `/summary-setup`.
- If compact mode is confusing, return to Normal under Output processing.
- If the Subagents section labels a child **recovered active**, Pi has authoritative evidence that the child is active but cannot yet map it to a controllable run. You can click the row to open a read-only metadata view; it explains that detailed live output remains unavailable until Pi observes the run locator. Cancel, dismiss, and automatic restored-terminal materialization remain unavailable for that provisional row. An “active children omitted upstream” count means the upstream bounded snapshot knows about more active children than it can describe individually.

## Compatibility and limitations

- Subagent recovery snapshots are bounded. Omitted children are reported as an aggregate and appear individually only after a later snapshot includes enough public metadata; private child prompts and paths are never exposed by the overview.
- App runners stop during Web UI restart and must be started again.
- An operating-system restart cannot resume the same in-progress model request.
- Some native Pi commands have browser-specific behavior or remain terminal-only.
- Remote clients have fewer package-management and local-file actions than localhost clients.
