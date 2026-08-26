# Development guide: Qt WebUI

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Architecture

Three processes cooperate:

1. **Launcher** (`bin/qt-webui.mjs`, `lib/launcher.mjs`) resolves the package QML entry, the backend entry, and the CLI declared by the dependency-local `@earendil-works/pi-coding-agent` manifest, then spawns `quickshell` with an argument array, inherited stdio, `shell: false`, and the caller's working directory.
2. **Quickshell** owns the QML application. `qml/BackendBridge.qml` starts the backend with `QT_WEBUI_NODE_EXECUTABLE` and `QT_WEBUI_BACKEND_ENTRY`, writes protocol requests to its stdin, and reduces its events into QML state. QML never parses a raw Pi record and never starts Pi.
3. **Backend** (`lib/backend/main.mjs`) owns one Pi RPC child per tab through `tabs.mjs`, translates Pi records into bounded typed events tagged with the tab id, keeps a bounded transcript mirror per tab, renders Markdown, stores settings and window state, lists sessions, browses directories, runs Git, sends notifications, opens links, and reaps every child on shutdown.

The Pi package exposes only import-conditioned exports, so the launcher resolves its public module with ESM resolution, walks to the matching package manifest, and uses a `createRequire` rooted there to confirm package identity. It reads the `bin.pi` declaration instead of assuming a dependency layout or searching `PATH`.

### Backend modules

| Module | Responsibility |
|---|---|
| `lib/backend/protocol.mjs` | Protocol version, every numeric limit, request validation, frame constructors, link scheme policy. |
| `lib/backend/jsonl.mjs` | LF-only JSONL reader with a per-frame byte cap; oversized frames are discarded without buffering. Node `readline` is not used because it also splits on U+2028/U+2029. |
| `lib/backend/pi-session.mjs` | Pi child ownership and the state machine ported from the former `PiBridge.qml`: startup readiness, prompt acceptance and reconciliation, abort-before-start, provider errors, restart, message parts, tool lifecycle, extension dialogs. |
| `lib/backend/markdown.mjs` | Bounded Markdown-to-blocks renderer producing whitelisted Qt StyledText. |
| `lib/backend/settings.mjs` | XDG settings store with validation, 0700/0600 permissions, and atomic replace. |
| `lib/backend/process-tree.mjs` | Detached process-group spawn, SIGTERM→SIGKILL escalation, synchronous kill for fatal paths. |
| `lib/backend/desktop.mjs` | `notify-send` and `xdg-open` wrappers using argument arrays only. |
| `lib/backend/highlight.mjs` | Bounded regex tokenizer for fenced code; emits `[kind, escapedText]` pairs, never colors or markup. |
| `lib/backend/store.mjs` | Generic private JSON document store (validate on read, atomic replace, 0700/0600) plus the XDG state directory. |
| `lib/backend/state.mjs` | Window state in `$XDG_STATE_HOME/qt-webui/state.json`: drafts, recent and pinned directories, recent actions, tabs. |
| `lib/backend/sequences.mjs` | Saved prompt sequences in the config directory with per-entry validation and stable ordering. |
| `lib/backend/attachments.mjs` | In-memory composer attachments: confinement, size and type checks, exact-once consumption, message composition. |
| `lib/backend/workspace.mjs` | Workspace confinement helpers and the cached path index (`git ls-files` or a bounded walk) behind `@` completion. |
| `lib/backend/tabs.mjs` | Tab registry: one `pi-session` per tab with its own attachments, path index, and transcript mirror; tagged events; unread badges; select/close/rename/move; restart continuity; saved-layout restore. |
| `lib/backend/transcript.mjs` | Backend transcript rows: the live mirror (`createTranscriptMirror`) and `rowsFromHistory` for Pi's `get_messages`, including interruption detection. |
| `lib/backend/sessions-index.mjs` | Bounded listing of Pi's persisted sessions for a folder using Pi's directory encoding and a per-file scan budget. |
| `lib/backend/directories.mjs` | Directory listing and folder creation for the workspace picker (bounded, hidden opt-in, Git hints). |
| `lib/backend/git.mjs` | `runGit` (argument arrays, timeout, bounded output), repository/branch/worktree inspection, `planWorktree`, `createWorktree` with rollback, `removeWorktree`. |
| `lib/backend/resources.mjs` | Private global/exact-model profile store, profile validation, null-versus-empty semantics, and session → model → global → Pi-default effective resolution. |
| `lib/backend/sampling.mjs` | Sampling ranges, provider-interface capability reasons, supported-value filtering, and exact provider payload translation. |
| `lib/pi-extension/qt-webui-helper.mjs` | Pi-side capability inventory and session-history persistence; applies effective enabled tool/skill lists and supported sampling immediately before provider requests. |

## Backend protocol (version 1)

Frames are JSON objects terminated by `\n`. Every frame carries `v: 1`. Requests flow from QML to the backend; the backend answers each request exactly once by `id` and emits unsolicited events with a monotonically increasing `seq`.

Request: `{"v":1,"id":"q-7","type":"prompt","message":"…","mode":"send","tab":"tab-1"}` — session-scoped requests may carry `tab`; without it the active tab is used. Global requests (settings, links, sequences, drafts, directories) ignore it.
Response: `{"v":1,"kind":"response","id":"q-7","ok":true,"data":{…}}` or `{"v":1,"kind":"response","id":"q-7","ok":false,"error":{"code":"busy","message":"…"}}`
Event: `{"v":1,"kind":"event","seq":42,"type":"part.render",…}`

Event payloads must not use the reserved frame keys `v`, `kind`, `type`, or `id`; `makeEvent` throws otherwise (this caught the `part.begin` `kind` collision during development).

### Requests

| Type | Fields | Result |
|---|---|---|
| `hello` | — | protocol version, backend pid, cwd, limits, session snapshot, settings, queue stats |
| `prompt` | `message`, `mode` (`send`, `steer`, `followUp`), optional `attachments` (ids) | `{mode, messageId}` after Pi accepts; `busy` while a `send` is active; `pi_error` when Pi rejects; attachments are consumed only after the prompt is known to be acceptable, text attachments become labelled fenced blocks below the message, images travel in Pi's `images` field |
| `commands_list` | — | `{commands, omitted}` from `get_commands`: `name`, `description`, `source` (`extension`, `prompt`, `skill`), `location`, `path`; bounded to 512, deduplicated by name |
| `path_complete` | `query` (≤ 256 characters) | `{suggestions: [{path, directory}], total, truncated, source}`; ranked basename prefix → path prefix → substring → subsequence, at most 50 |
| `draft_get` / `draft_set` | `key` (session file or workspace), `text` (≤ 8,192) | the stored draft; an empty text deletes it; 64 drafts are kept, oldest evicted |
| `sequences_list` / `sequence_save` / `sequence_delete` / `sequence_move` / `sequence_run` | `sequenceId`, `name` (≤ 64), `entries` (1–16 × ≤ 8,192), `delta` (±1) | the sequence list after each mutation; `sequence_run` sends entry 1 as a prompt and the rest as follow-ups and returns `{sent, queued}`; `stale_request` for unknown ids, `limit_exceeded` beyond 32 sequences |
| `attachment_add` / `attachment_update` / `attachment_remove` | `path` (absolute), `granted` (picker-chosen), `attachmentId`, `text` | the attachment list; `rejected` outside the workspace unless granted, for symlinks that escape, non-files, invalid UTF-8, or image signature mismatches; `limit_exceeded` above 8 attachments, 256 KiB text, or 5 MiB images |
| `tabs_list` | — | `{tabs: [{id, cwd, name, sessionFile, sessionName, statusKind, statusText, ready, active, unread, needsInput, pid}], activeTab, maxTabs}` |
| `tab_open` | optional `cwd`, `sessionPath`, `name` | opens and selects a tab (`limit_exceeded` above 8; `rejected` for a missing folder); resumes `sessionPath` once Pi is ready; returns `{tab, session, attachments}` (a snapshot) |
| `tab_select` | `tab` | emits `tabs.update`, then `transcript.reset` and one `transcript.row` per mirrored row, then answers with the snapshot |
| `tab_close` | `tab`, `force` | `busy` while the tab's run is active unless `force`; stops the Pi tree; the last tab is replaced by a fresh one; returns `{closed, activeTab, pid}` plus the new active tab's snapshot |
| `tab_rename` / `tab_move` | `name` (≤ 64) / `delta` (±1) | rename also calls `set_session_name` (a failure is a notice, the local name still changes); move reorders |
| `sessions_list` | — | `{sessions: [{path, id, name, cwd, created, modified, ageMs, messageCount, firstMessage, scanTruncated}], omitted, directory, current, cwd}` for the tab's folder; 200 entries, 1 MiB scanned per file |
| `session_switch` | `sessionPath` (absolute `.jsonl`) | `switch_session`, then `get_messages` replayed as `transcript.reset` + `transcript.row` events, then `get_state`; `busy` while active; `pi_error` when an extension cancels; returns `{sessionFile, sessionName, rows, messageCount, interrupted}` |
| `session_new` | — | `new_session`, `transcript.reset`, fresh state; `busy` while active |
| `directory_list` / `directory_create` / `directory_pin` | `path`, `showHidden` / `path`, `name` / `path` | `{path, parent, entries: [{name, path, hidden, git}], hiddenCount, omitted, home, recent, pinned}`; creation validates the name and refuses existing folders; pin toggles the pinned list |
| `open_path` | `path` (absolute) | `xdg-open` for an existing regular file (`rejected` otherwise); suppressed in smoke mode; the shell confirms the exact path first |
| `session_stats` | — | `get_session_stats` normalized to `{userMessages, assistantMessages, toolCalls, totalMessages, tokens: {input, output, cacheRead, cacheWrite, total}, cost, context: {tokens, contextWindow, percent} | null}` |
| `recent_action` | `action` (identifier ≤ 128) | pushes the key to the state store's recents (20 kept, most recent first) and returns the list; `hello` also returns it |
| `diagnostics` | — | backend pid, uptime, RSS, queue statistics, tab list, recent actions, file paths, limits |
| `worktrees_list` / `worktree_plan` / `worktree_create` | `branch`, `base`, `path`, `confirmed: true`, `openTab` | plan returns `{root, branch, path, base, detachedBase, nested, problems}` without changes; create requires `confirmed` (`invalid_request` otherwise), runs `git worktree add -b`, rolls back on failure, and opens the new tab when `openTab` is not false |
| `abort` | — | `null`; `not_running` when idle |
| `state` | — | runtime metadata from `get_state` |
| `restart` | — | terminates the Pi tree and starts a new child |
| `extension_response` | `requestId` plus exactly one of `value`, `confirmed`, `cancelled` | echoes the answer; `stale_request` if not pending; `invalid_request` for a value outside the offered options or a wrong shape |
| `settings_get` / `settings_set` | `values` object with schema-checked keys | current settings and file path |
| `open_link` | `url` | `xdg-open` result; rejected for disallowed schemes |
| `notify` | `title`, `body` | `notify-send` result |
| `models_list` | — | `{models, omitted, current}`; models are normalized to `provider`, `id`, `name`, `reasoning`, `acceptsImages`, `contextWindow`, `maxTokens`, deduplicated by `provider/id`, and bounded to 256 (a notice reports the omitted count); allowed during a run |
| `model_set` | `provider`, `modelId` | `{model, thinkingLevel, resources}` after `set_model`, a fresh `get_state`, and a fail-closed resource refresh; core model success remains successful when `resources.available` is false |
| `model_cycle` | — | `{changed, model, thinkingLevel, scoped, resources}`; `changed: false` when Pi returns no model |
| `thinking_levels` | — | `{levels, current}`; only levels from `THINKING_LEVELS` survive, in canonical order, `["off"]` when empty |
| `thinking_set` | `level` (one of `THINKING_LEVELS`) | `{level, resources}`; `busy` while active; `pi_error` when the model rejects it |
| `thinking_cycle` | — | `{changed, level, resources}` |
| `resources_state` | — | `{available, model, thinkingLevel, profiles, sessionDurability, effective, tools, skills, sampling, problems, path}`; `sessionDurability` is `{durable, reason}`; `available: false` with a bounded error when helper/capability state is unavailable |
| `tools_set` | `scope` (`session`, `model`, `global`), `enabledTools` (`string[]` or `null`) | validated applied resource state; `null` inherits and `[]` intentionally enables none |
| `skills_set` | `scope`, `enabledSkills` (`string[]` or `null`) | validated applied resource state; public and persisted profiles always use enabled names (the helper alone translates to Pi's internal disabled set) |
| `sampling_set` | `scope`, `params` (partial sampling object or `null`) | validated applied resource state; null values remove keys, unsupported values remain stored/effective but are omitted from `sampling.applied` |
| `compact` | optional `instructions` (≤ 1,024 characters) | `{tokensBefore, estimatedTokensAfter, summary}` (summary ≤ 512 characters); the session is `active` with status `Compacting…` until Pi answers, so `prompt`, model, thinking, and further `compact` requests get `busy`; failure clears the busy state and posts a notice |
| `shutdown` | — | graceful shutdown, exit 0 |
| `debug_crash` | — | smoke mode only: raises an uncaught exception to exercise the fatal path |

Error codes: `invalid_request`, `unsupported_version`, `unknown_request`, `limit_exceeded`, `duplicate_request`, `busy`, `not_ready`, `not_running`, `pi_error`, `stale_request`, `timeout`, `rejected`, `internal_error`.

### Events

Every event a Pi session produces carries `tab`; `backend.*`, `settings.changed`, `events.dropped`, global notices, and `tabs.update` do not. A successful profile mutation emits `resources.changed` with `tab`, `scope`, `field`, and the full validated applied `state` for every affected tab. `tabs.update` (`{tabs, activeTab, maxTabs}`) is sent only when a summary changed, and always before the transcript replay of a newly selected tab so the client switches first; `transcript.reset` clears the tab's transcript and `transcript.row` (`row` in the client's row shape) rebuilds it, one row per frame. Session events: `backend.ready`, `backend.closing`, `backend.fatal`, `backend.backpressure`, `events.dropped`, `notice`, `settings.changed`, `pi.started`, `pi.status` (`statusKind`, `text`, `ready`, `active`), `pi.error` (empty message clears), `pi.runtime` (`provider`, `modelId`, `modelName`, `modelReasoning`, `thinkingLevel`, `sessionId`, `sessionName`, `sessionFile`, `messageCount`; emitted after every state read and after model or thinking changes, which merge into the existing session identity), `pi.exit`, `message.user` (`text`, `mode`, `attachments`: bounded file names), `message.begin`, `part.begin` (`partKind` `text` or `thinking`), `part.render` (`text`, `blocks` for text parts, `final`, `truncated`), `part.remove`, `message.end`, `tool.start` (`summary` is a bounded plain-text argument digest), `tool.update`, `tool.end` (`ok`, `durationMs`, `output`, `error`), `run.start`, `run.end` (`ok`, `aborted`), `queue.update`, `extension.request`, `extension.answered`, `extension.cancelled`, `extension.notify`, `extension.status` (`key`, `text`, and `chips`: a `setStatus` whose text is a `firstpick.git-footer-status.footer` version 1 JSON payload becomes up to 18 bounded plain-text chips from its `main` and `meta` arrays; any other JSON object with a `type` becomes its `title` as `text` and `description` as `hint`; other text stays as `text`), `composer.setText`, `window.title`.

`part.render` is emitted at most every 80 ms per streaming part and once more with `final: true` after `message_end`, whose content is authoritative. Parts that streamed but are missing from the final message are removed.

Resource mutations lock every affected tab and recheck that each is idle. Global changes target every open tab; exact-model changes target every tab currently using that provider/model. The backend reads and validates each helper state, applies the prospective effective profile to every target, and only then atomically updates `resources.json`. It builds responses from the validated helper apply results and committed store state, without a post-commit helper call. An apply or store failure rolls every attempted helper back; rollback failure is returned explicitly with an inconsistent-state warning. One centralized per-tab guard fences prompts, saved sequences, compaction, Pi restart, tab close, session switch, and new-session requests until reconciliation and any rollback settle. The lifecycle handlers hold the same guard while they run, so a broader profile transaction cannot start across them either.

`pi-session.helperCall` observes the helper-notify promise before sending the command prompt. A helper answer wins even if it precedes Pi's prompt acknowledgement; a prompt rejection/timeout rejects and clears the helper leg; helper timeout or error clears the pending Pi command; Pi exit rejects both through their normal handlers. The helper writes session-history state before changing its in-memory session/effective state. A real append failure is returned as an error; only `sessionManager.isPersisted() === false` skips the append and returns `durable: false` with a user-facing reason.

### Limits

All numbers live in `LIMITS` in `lib/backend/protocol.mjs`; `tests/qml-contract.test.mjs` asserts the QML copies match.

| Budget | Value |
|---|---|
| Inbound / outbound frame | 256 KiB / 1 MiB (Pi records: 4 MiB) |
| Outbound queue before backpressure | 4 MiB or 2,000 unflushed records |
| Pending requests (each direction) | 64; request ids ≤ 96 characters |
| Request timeouts | prompt 30 s, restart 20 s, abort/state 10 s, others 5 s; the client also enforces the same deadlines |
| Pi startup readiness | 15 s (`QT_WEBUI_PI_STARTUP_TIMEOUT_MS` test seam) |
| Prompt reconciliation | 150 ms after acceptance without `agent_start` |
| Shutdown grace | 3 s SIGTERM, then SIGKILL |
| Transcript | 80 rows, 8,192 characters per text/thinking part, 64 parts per message |
| Tool cards | 64-character name, 256-character summary, 4,096-character output |
| Errors / notices | 512 characters; runtime metadata 160 characters |
| Markdown | 8,192 input characters, 200 blocks, nesting depth 4, 50 table rows × 12 columns, 200 list items |
| Dialogs | 16 pending, 64 options × 256 characters, 256-character title, 4,096-character message, 16 KiB values |
| Settings file | 64 KiB |
| Models and thinking | 256 models; provider 64, model ID 128, model name 96 characters; 8 thinking levels |
| Compaction | 1,024-character instructions, 512-character summary, 120 s request timeout |
| Highlighting | 8,192 characters and 4,000 tokens per code block; over either, the block stays plain |
| Drafts and state | 8,192 characters per draft, 64 drafts, 20 recent entries per list, 256 KiB state file |
| Sequences | 32 sequences × 16 entries, 64-character names, 1 MiB file |
| Commands | 512 commands, 64-character names, 256-character descriptions |
| Attachments | 8 per prompt, 256 KiB text, 5 MiB images, 128-character names |
| Workspace index | 20,000 entries, depth 16, 50 suggestions, 256-character query, 5 s cache, 5 s `git ls-files` timeout, 8 MiB output |
| Tabs | 8 tabs, 64-character names, one transcript mirror of 80 rows each, 16 saved tabs in state |
| Sessions | 200 listed, 1 MiB scanned per file, 160-character previews |
| Directories | 500 entries per listing, 255-character folder names |
| Git | 10 s per command (60 s for `worktree add`), 4 MiB output, 64 worktrees, 128-character branch names |
| Palette and events | 128-character action keys, 20 recent actions, 200 notices kept in the client |
| Resource profiles | 512 tool or skill names, 64 exact-model profiles, 256 KiB file, 512 KiB helper response, 10 s helper timeout |

### Slow consumers

Coalescable events (`part.render` before `final`, `tool.update`) are dropped while the outbound queue is over budget and reported later through `events.dropped`. Essential events are never dropped: when a write leaves the queue over budget the backend pauses the Pi child's stdout and resumes it on `drain`, emitting `backend.backpressure`. Node emits `drain` before invoking write callbacks, so the engagement condition is bytes-only and requires the write to have returned `false`.

## Markdown policy

`renderMarkdown` produces `heading`, `paragraph` (with `quote` flag), `code`, `listItem`, `table`, `rule`, and `notice` blocks. Inline text becomes StyledText built only from escaped text and the tags `<b>`, `<i>`, `<s>`, `<tt>`, `<br>`, and `<a href>`. Raw HTML is escaped, images become `[image: alt]` placeholders, and links keep only `http`, `https`, and `mailto` targets without credentials; other links stay as their literal Markdown. QML renders `styled` with `Text.StyledText`, code and tool output with read-only plain-text editors, and everything else as `Text.PlainText`. Link activation always goes through `LinkDialog` and then the backend's `open_link`.

Code blocks additionally carry `tokens` (`[kind, escapedText]` pairs from `highlight.mjs`, or `null` for unknown languages and oversized blocks). `MarkdownBlocks.styledCode` wraps them in `<pre>` with `<font color>` taken from `Theme.syntaxColor(kind)`; `<pre>` is required because `Text.StyledText` collapses newlines and runs of spaces outside it. The highlighted view is a `Label`, so a **Select text** toggle swaps in the plain `TextEdit`; copy uses `block.text` in both views.

## Lifecycle and process ownership

Each tab's Pi child is spawned with `detached: true` so it leads its own process group; `terminateProcessTree` signals the group, escalates to SIGKILL after the grace period, and sweeps the group again once the leader exits. Shutdown runs on stdin EOF (Quickshell exited), `SIGINT`, `SIGTERM`, `SIGHUP`, the `shutdown` request, and stdout `EPIPE`. Uncaught exceptions emit `backend.fatal`, kill the tree synchronously, and exit 70. A relative or missing Pi entry exits 64 before starting anything.

If the backend itself is killed with SIGKILL it cannot signal anything; Pi then sees EOF on stdin and is responsible for stopping its own tool processes, which the fixture models by terminating its grandchild on `end`. `tests/backend-lifecycle.test.mjs` proves each path with a fixture grandchild (`sleep 300`).

Shutdown stops every tab (`registry.stopAll`); the forced path kills every child's process group. At startup `registry.restore()` reopens the saved tabs whose folders exist (resuming their session files once Pi is ready), adds a tab for the launch directory when none matches, selects it, and emits one `tabs.update`. A per-tab `restart` records the tab's session file as `pendingResume` so the new Pi child resumes it.

In QML, the bridge treats a backend exit as an error state, fails every pending request, cancels dialogs, clears the tab list, and offers **Restart**, which starts a fresh backend that restores the saved tabs. During `Qt.quit` the bridge sends `shutdown` first and stops the process after a short grace period.

## QML structure

- `qml/shell.qml` — window, header, search, transcript list with follow-output logic, queue strip, notices, composer, dialogs, and the smoke driver loader.
- `qml/BackendBridge.qml` — backend process, request correlation with client-side deadlines, event reduction, transcript `ListModel`, dialog queue, settings, notifications, clipboard, and fail-closed resource state/mutations.
- `qml/Theme.qml` — the only palette owner; semantic tokens for surfaces, status, code, quotes, tables, thinking, dialogs, focus, and search.
- `qml/components/` — `AppButton`, `StatusBadge`, `NoticeBar`, `Composer` (run modes, attachment chips, completion), `CompletionPopup`, `SearchBar`, `EmptyState`, `TranscriptRow`, `MarkdownBlocks`, `ToolCard`, `TabStrip` (page-tab roles, status dot, unread and input badges, close, new tab, open folder).
- `qml/dialogs/` — `AppDialog` (modal, focus containment, Escape, focus return), `ExtensionDialog` (exactly-once answers), `LinkDialog`, `PickerDialog` (filterable list used for models and thinking levels; `picked` is emitted once and before `close()`, so `onClosed` only reports a cancellation when nothing was picked; filtering and arrow navigation never pick), `ResourceProfilesDialog` (explicit scope/section selection, bounded enabled-name lists, inheritance/effective source labels, capability-disabled sampling fields, explicit save), `SequencesDialog` (list and edit modes; Run is the only action that sends, Delete arms and then confirms), `TextEditDialog` (bounded multi-line editor used for text attachments), `EventsDialog` (filters, repeat grouping, copy, clear over the bridge's notice model), `DiagnosticsDialog` (plain-text report from `diagnostics` plus client counters), `DirectoryDialog` (folder picker; only `choose`/`chooseCurrentEntry` emit `chosen`), `ConfirmDialog` (destructive confirmations focus Cancel first; answers once), `InputDialog` (validated single-line input; never submits invalid text).

Tabs in the bridge: only the active tab is materialized. `request()` tags every frame with `activeTabId` and records that origin for session-scoped callbacks; `settlePending()` removes a response but does not invoke its state-mutating callback after another tab becomes active. `handleEvent` routes events whose `tab` differs to `handleInactiveTabEvent` (notices and desktop notifications for input requests, finished runs, errors, and exits) and never lets them touch the view. `tabs.update` with a different `activeTab` calls `beginTabSwitch`, which runs `resetTabState` (transcript, status, runtime, queues, attachments, commands, footer status, and the local dialog queue — dropped without answering, because they stay pending in the backend) and emits `tabSwitched`; the replay events then rebuild the transcript and the request's response (`applySnapshot`) restores status, runtime, error, queues, footer records, attachments, and pending dialogs (`enqueueDialog` skips ids already queued). The shell saves the previous tab's composer text under its draft key before the new tab's draft loads (`handleDraftKeyChanged`), asks `ConfirmDialog` before force-closing a working tab, and creates worktrees only from `confirmAccepted` after `worktree_plan` showed the path.

Composer completion: `completionContext()` derives the token under the cursor (`/` in the first word → command, `@word` → path) and emits `completionRequested(kind, query)`; the shell answers with command suggestions from the bridge's cached `commands_list` or, after a 120 ms debounce, `path_complete`. `acceptCompletion` only edits the text (`/name ` or `@path` with a trailing `/` for directories) and `dismissCompletion` suppresses the same token until it changes. While the list is open, Up/Down/Tab/Enter/Escape are consumed before the send handling. A QML pitfall found here: inside `onItemsChanged` a derived binding such as `count: items.length` still holds the previous value, so `CompletionPopup` reads `items.length` directly when resetting its selection.

The command palette reuses `PickerDialog` with a `group` per item. `shell.paletteItems()` builds actions (recent ones first, from `bridge.recentActions`), tabs, models, sessions, Pi commands, and skill files; `openPalette()` presents the list at once and reloads models, sessions, and commands so capability changes are reflected while it is open (`refreshPalette`). Values are prefixed (`action:`, `tab:`, `model:`, `session:`, `command:`, `skill:`); `palettePicked` dispatches them, records actions and commands through `recent_action`, inserts commands into the composer without sending, and confirms skill files before `open_path`. Actions run from a short timer after the picker closes so dialogs they open receive focus. Usage comes from `session_stats`, requested 250 ms after `run.end` and after a snapshot; the shell renders it as the **Usage** status group. The notice model keeps 200 entries with a `tab` label and a `noticeRevision` counter that the events and diagnostics dialogs bind to.

Attachments live in the backend (`attachments.mjs`) and the bridge mirrors the list; `sendPrompt` passes the ids and clears the mirror unless the backend refused before consuming them (`busy`, `not_ready`, `not_running`). `FileDialog` results are passed with `granted: true`; every other path is confined to the workspace. Drafts: `draftTimer` (600 ms) saves the composer text under `bridge.draftKey` (session file, else workspace) and `restoreDraft` fills only an empty editor for the current key.
- `qml/SmokeDriver.qml` — loaded only when `QT_WEBUI_SMOKE_MODE=1`.

Transcript rows are flat: one row per user message, text part, thinking part, or tool call, keyed by `rowId`. Streaming updates call `ListModel.setProperty` on the affected row only; `MarkdownBlocks` re-parses that row's `blocksJson` and rebuilds its block delegates. Search runs over row text and tool output and highlights whole rows.

Every control has an accessible role and name; `AppButton` draws a focus ring and activates from the keyboard. Dialogs are `Popup`s with `modal: true`, `focus: true`, an explicit initial focus item, and focus return to the composer.

The header's model and thinking buttons call `shell.openModelPicker()` / `openThinkingPicker()`, which load the inventory through the bridge and present `PickerDialog`; the bridge's `selectModel`, `cycleModel`, `setThinkingLevel`, and `cycleThinkingLevel` refuse while `active` or while a previous model/resource change is still unconfirmed, and re-selecting the current value is a no-op. Each successful response includes the backend's freshly resolved `resources`, which the bridge applies instead of guessing; tab snapshots clear resource state and issue `resources_state` for that tab. Runtime events reach the bridge before the request's response, so anything that chains a second change must wait for `modelActionPending` to clear (the smoke driver does this in `advanceModels`). `compactContext` sets `compacting` until the response arrives; the backend keeps the session busy for the same period.

`ResourceProfilesDialog` drafts one field at one explicit scope and only calls `tools_set`, `skills_set`, or `sampling_set` from **Save**. Tool/skill `listMode` keeps `inherit` (`null`) distinct from `custom` with an empty `listDraft` (`[]`). Sampling sends all seven keys as a patch so blank fields remove only that scope's values; disabled fields retain their draft text and are serialized unchanged, while the backend/helper filter unsupported values from the applied provider payload. `controlsEnabled` requires available complete state, an idle Pi session, and no pending model/resource request. The dialog remains inspectable but all edits and saves fail closed while those conditions are false. `sessionDurability.durable: false` adds an alert that the active override is not saved durably, and the bridge posts the same reason after a successful non-durable session mutation. `AppDialog` returns focus to the composer.

## Launcher-to-QML environment contract

Only these launcher-owned values are passed with the `QT_WEBUI_` prefix:

| Name | Contract |
|---|---|
| `QT_WEBUI_CALLER_CWD` | Absolute caller working directory used for the backend and Pi child. |
| `QT_WEBUI_QML_ENTRY` | Absolute selected `shell.qml` path. |
| `QT_WEBUI_BACKEND_ENTRY` | Absolute backend entry (`lib/backend/main.mjs`). |
| `QT_WEBUI_NODE_EXECUTABLE` | Absolute Node.js executable used to start the backend and the Pi CLI module. |
| `QT_WEBUI_PI_CLI_ENTRY` | Absolute dependency-local Pi CLI module, read by the backend. |
| `QT_WEBUI_DEVELOPMENT_MODE` | `1` for `qt-webui dev`; otherwise `0`. |
| `QT_WEBUI_SYSTEM_COLOR_SCHEME` | Normalized XDG portal result: `dark`, `light`, or `unknown`. |

Before adding those values, the launcher removes every inherited environment key whose name starts with `QT_WEBUI_`. This prevents caller-controlled variables from activating internal test behavior or overriding launcher-owned paths. The live smoke harness can add its fixture values (`QT_WEBUI_SMOKE_MODE`, `QT_WEBUI_SMOKE_CAPTURE_PATH`, `QT_WEBUI_SMOKE_STATE_PATH`, `QT_WEBUI_THEME_MODE`, `QT_WEBUI_PI_STARTUP_TIMEOUT_MS`, `QT_WEBUI_PI_REQUEST_TIMEOUT_MS`) only through an explicit launcher test seam; the installed `qt-webui` bin never reads that seam from the environment. The backend honors `QT_WEBUI_PI_REQUEST_TIMEOUT_MS` and `debug_crash` only in smoke mode.

Path values must be non-empty, contain no NUL byte, and fit within 16 KiB when UTF-8 encoded. The backend passes the Pi CLI entry and `--mode rpc` as separate process arguments and never interpolates paths, prompts, or dialog values into shell text.

The initial `get_state` response supplies `model.provider`, `model.id`, and `thinkingLevel`; the backend copies bounded strings into `pi.runtime` events and clears them on failed state reads, restarts, and process exits so the window never presents stale runtime metadata.

Qt 6.11 registers host applications with `org.freedesktop.host.portal.Registry` during GUI startup, which can produce a non-fatal warning; the launcher defaults the child to `QT_NO_XDG_DESKTOP_PORTAL=1` while preserving an explicit caller value. The visual root explicitly belongs to `FloatingWindow.contentItem` and the surface is opaque.

## Process and failure behavior

The launcher installs handlers for `SIGINT` and `SIGTERM` only while Quickshell is active and forwards either signal to that child. It removes handlers after an error or close event. Numeric child exit codes pass through; signal exits become the conventional `130` or `143` status when applicable.

A missing Quickshell executable and a missing or malformed package-local Pi CLI both become actionable stderr messages. The launcher never falls back to a global Pi command.

## Validation

Run the focused suite and syntax checks:

```bash
npm test
npm run check
qmllint -I /usr/lib/qt6/qml qml/*.qml qml/components/*.qml qml/dialogs/*.qml
```

Test files:

- `tests/backend-units.test.mjs` — protocol validation at each limit and one over, JSONL framing, Markdown policy and bounds, settings permissions, process-tree escalation, profile resolution/storage, sampling ranges/capabilities/payload translation, and direct helper semantics including append failure and explicit ephemeral durability.
- `tests/backend-session.test.mjs` — the real backend driven against `tests/fixtures/fake-pi-rpc.mjs`: startup noise, stale and duplicate responses, message parts, dialogs answered exactly once, streaming cadence, provider and tool errors, abort-before-start, transcript limits, protocol violations, silent Pi timeouts, slow-consumer backpressure, settings, model/thinking selection and refreshed resources, all profile scopes, unsupported sampling preservation, nth-call apply/persistence/rollback failures, early helper errors, command/helper timeouts, Pi exit, durable/ephemeral session results, helper loss, malformed profile fallback, manual compaction, and restart paths.
- `tests/backend-composer.test.mjs` — highlighting tokens and budgets, the composer request validation, command normalization, the state and sequence stores (limits, eviction, ordering, corrupt files), attachment confinement/size/type/exact-once rules, workspace confinement (traversal, symlinks) and indexing (walk and fake `git ls-files`), and one backend round trip covering commands, drafts, completion, sequences, and a prompt carrying attachments.
- `tests/backend-tabs.test.mjs` — the transcript mirror and history translation, session listing (directory encoding cross-checked against the Pi package, bounds, corrupt files), directory listing and creation, Git worktrees on real temporary repositories (spaces, detached HEAD, conflicts, nesting, rollback with a failing `worktree add`, timeouts), the tab/session/directory/worktree request validation, and backend round trips: isolated tabs with tagged events, broader resource reconciliation before an unselected tab's next turn, active affected-tab refusal, unread and input badges, replay on select, busy-close refusal and forced close, rename, last-tab replacement, restore after restart (missing folder skipped, session resumed), session listing/resume/interruption warning/new session, and a worktree opening a new tab.
- `tests/backend-lifecycle.test.mjs` — stdin EOF, `SIGTERM`, `SIGINT`, `SIGKILL`, fatal crash, and restart all reap Pi and a fixture grandchild within `shutdownGraceMs + 2 s`.
- `tests/qml-contract.test.mjs` — static contracts for the QML files, including origin-tab callback rejection, resource request fields, durability alerts, null/empty semantics, explicit scopes, effective sources, sampling reasons, disabled/bounded/accessibility state, the limit cross-check, and untrusted-content rules.
- `tests/qml-smoke.test.mjs` — real Quickshell on the current Wayland session, running the `SmokeDriver` scenario twice (default and `QT_SCALE_FACTOR=2`), asserting every marker, delayed resource read/mutation responses across tab switches, the captured Pi/helper commands, tool/skill/sampling profile application, unsupported-value preservation, exact dialog answers, and persisted setting. It skips without a Wayland display or Quickshell.
- `tests/launcher.test.mjs`, `tests/package-contract.test.mjs`, `tests/packed-install.test.mjs`, `tests/docs-contract.test.mjs` — launcher, manifest, packed install, and documentation contracts.

`tests/helpers/backend-client.mjs` spawns the backend with the fixture, keeps unmatched responses observable, and rejects pending requests when the backend exits. It isolates `XDG_CONFIG_HOME` and `XDG_STATE_HOME` per backend; without the latter, every test backend restored the tabs saved by earlier tests (this bit once). Tests that list sessions set `PI_CODING_AGENT_DIR` to a temporary agent directory.

The fixture's internal `/qt-webui-helper` command answers bounded state/apply calls, persists session overrides in memory, changes sampling capabilities with the active model, and can simulate missing, silent, delayed, nth-call failed, early-error, ephemeral, and process-exit outcomes. Helper prompts are excluded from the smoke test's user-prompt order before their JSON payloads are asserted separately.

The fixture scenarios are keyed by prompt text (`__QT_WEBUI_STREAM__`, `__QT_WEBUI_MARKDOWN__`, `__QT_WEBUI_IMMEDIATE__`, `__QT_WEBUI_PROVIDER_ERROR__`, `__QT_WEBUI_TOOL_ERROR__`, `__QT_WEBUI_FAIL__`, `__QT_WEBUI_DELAYED_ABORT__`, `__QT_WEBUI_LIMITS__`, `__QT_WEBUI_FLOOD__`, `__QT_WEBUI_GRANDCHILD__`, `__QT_WEBUI_SILENT__`, `__QT_WEBUI_EXIT__`). The startup state file drives the `failed-state` → `missing-state` → `recovered-state` restart sequence. The fixture also answers `get_available_models` (three usable models plus malformed and duplicate entries, or 300 extra with `QT_WEBUI_FIXTURE_MANY_MODELS=1`), `set_model`, `cycle_model`, `get_available_thinking_levels` (with a bogus level), `set_thinking_level`, `cycle_thinking_level`, and `compact` (failing when `customInstructions` is `__QT_WEBUI_COMPACT_FAIL__`).

The fixture answers `get_commands` with three usable commands plus malformed and duplicate entries, keys prompt scenarios on the first line of the message so attachment blocks below the prompt do not change the scenario, tracks the current session file through `switch_session` (cancelled for paths containing `cancel-me`), `new_session`, and `set_session_name`, and answers `get_messages` with a scripted history for session files containing `resume-me` (complete, with a tool call) or `interrupted` (ending with an unanswered user message). The smoke workspace is a small Git repository with `src/main.mjs`, a sibling `other` folder, and a `resume-me` session file under the temporary `PI_CODING_AGENT_DIR`. Its folder name `<b>project</b>` contains a slash, so the smoke driver derives sibling paths from `QT_WEBUI_SMOKE_STATE_PATH` rather than from the workspace path.

The smoke driver answers dialogs through the dialog's own keyboard-handler entry points (`selectOption`, `confirm`, `submitText`, `cancel`) rather than synthesized key events; a second answer must be refused. Its composer phase drives `Composer.setText`/`acceptCurrentCompletion`, `bridge.addAttachment`, the draft timer, and `SequencesDialog.runCurrent`/`deleteCurrent`, and the smoke test asserts the captured prompt, follow-up, and `get_commands` commands. Known gap: no test synthesizes real key presses.

`tests/run-all.mjs` runs test files one at a time (`--test-concurrency=1`): the live Quickshell smoke is CPU-heavy and made timing-sensitive backend tests flaky when files ran in parallel.

`tests/packed-install.test.mjs` creates a tarball under a disposable temporary directory, installs it into a temporary prefix with `npm install --ignore-scripts`, adds that prefix's bin directory to `PATH`, invokes `qt-webui` by command name against the fake Quickshell fixture, and removes the directory. It must never install globally or publish the package.

## Packaging

Keep `qml`, `bin`, `lib`, user documentation, contributor documentation, tests, and `LICENSE` in the package `files` allowlist. Generate `package-lock.json` with lifecycle scripts disabled:

```bash
npm install --package-lock-only --ignore-scripts
```

Do not publish or change Pi settings as part of repository validation.
