# Pi WebUI feature map and Qt WebUI implementation checklist

Status: in progress. Phases 0 and 1 are complete. Phase 2 is complete except for Pi- or Quickshell-blocked queue mutation, pasted images, `!` shell, skill tags, and todo state. Phase 3 is complete except for summaries, close-all, and split views. Phase 4 now includes model, thinking, command-palette, tool-profile, skill-profile, and capability-gated sampling controls; scoped model ordering, subagent model-slot defaults, and optional provider controls remain. Phases 5 and 6 have not started beyond the phase 3 worktree service. Phases 7 and 8 include Events, diagnostics, density, and usage. Phase 9 remains open. The current package check passes 114/114 tests, including both 65-marker live smokes and packed installation. The resource-profile tranche is complete under the user's explicit, scoped waiver of the unavailable provider-diverse review quorum. The broader parity plan remains active.

This plan maps the main user-facing capabilities in `@firstpick/pi-package-webui` 0.9.9 to `@firstpick/pi-package-qt-webui` 0.2.0. It is a product-parity guide, not a requirement to copy the browser interface or its implementation.

## Evidence used

The feature inventory comes from:

- `../../../pi-package-webui/README.md`
- `../../../pi-package-webui/TECHNICAL.md`
- `../../../pi-package-webui/public/app.js`
- `../../../pi-package-webui/public/index.html`
- `../../../pi-package-webui/public/styles.css`
- `../../../pi-package-webui/bin/pi-webui.mjs`
- `../../../pi-package-webui/webui-rpc-helper.mjs`
- `../../../pi-package-webui/tests/`

The Qt baseline comes from:

- `../../README.md`
- `../../TECHNICAL.md`
- `../../DEVELOPMENT.md`
- `../../qml/shell.qml`
- `../../qml/BackendBridge.qml` (formerly `PiBridge.qml`)
- `../../qml/components/`
- `../../qml/dialogs/`
- `../../lib/backend/`
- `../../tests/`

The Pi RPC contract used for the backend comes from `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` (0.84.3).

## Verification log (2026-08-25)

- [x] Confirmed the 0.1.0 baseline claims below against the shipped QML and the passing 32-test suite before changing anything.
- [x] Confirmed `pi-package-webui` is at 0.9.9 and that its feature families in the table match its README, TECHNICAL headings, `app.js` renderers, and `webui-rpc-helper.mjs` dialog handling. Its Markdown renderer is hand-written (no `marked`), which supports the decision to write a bounded renderer in the backend rather than share browser code.
- [x] Confirmed the Pi RPC event shapes (`message_update` delta types, `tool_execution_*`, `extension_ui_request` methods and response shapes, `queue_update`, `agent_settled`) against `docs/rpc.md` before designing the backend translation.
- [x] Implemented phase 0, most of phase 1, and the non-attachment parts of phase 2 (see checkboxes). The two open phase 1 items are syntax highlighting and the resume action in the empty state.
- [x] Added the latest desktop polish: `Enter` sends or steers, `Shift+Enter` inserts a line, active view toggles expose checked state, restart has visible progress, the transcript has a working indicator, and installed extensions can publish bounded plain or structured status entries in the footer.
- [x] Verified the earlier desktop-chat slice with 73 passing tests (backend units 17, backend session 15, backend lifecycle 6, launcher 12, package 5, packed install 1, docs 4, QML contract 11, and two live Quickshell smokes including `QT_SCALE_FACTOR=2`).
- [x] Added bounded model inventory and selection, thinking-level selection, model and thinking cycling, a keyboard-first picker, and manual context compaction. Backend and QML tests cover capability changes, invalid values, busy-state rejection, large inventories, compaction results, and failure recovery.
- [x] Recorded the latest verification result: 77 of 79 tests pass (backend units 19, backend session 18, backend lifecycle 6, launcher 12, package 5, packed install 1, docs 4, QML contract 12). Both live Quickshell smokes time out after `QT_WEBUI_SMOKE_MODEL_PICKER`; `qmllint` remains clean. `npm run check` therefore fails and must not be treated as a release gate yet.
- [x] 2026-08-26: implemented the phase 4 model and thinking slice plus phase 2 manual compaction on the existing backend boundary: `models_list`, `model_set`, `model_cycle`, `thinking_levels`, `thinking_set`, `thinking_cycle`, and `compact` requests with numeric limits (256 models, 8 levels, 1,024-character instructions, 512-character summary, 120 s compaction timeout), a keyboard-first `PickerDialog`, header model and thinking buttons, `Ctrl+M`/`Ctrl+E` pickers and `Ctrl+Shift+P`/`Ctrl+Shift+E` cycling, and a **Compact context** action. Backend coverage: 19 unit tests (validation at each limit and one over; model and level normalization) and 18 session tests (selection, rejection by Pi, capability-driven thinking reset, `busy` during runs and compaction, the 256-model bound, compaction success and failure) pass; the QML contract suite (12) and docs contract pass; `qmllint` is clean. The live Quickshell smoke gained six markers (`MODEL_PICKER`, `MODEL_SELECTED`, `THINKING_PICKER`, `MODEL_CYCLED`, `THINKING_CYCLED`, `CONTEXT_COMPACTED`) and exact captured-command assertions; its last run reached `MODEL_SELECTED` and exposed an ordering race (runtime events precede the response, so a chained change saw `modelActionPending`), which is fixed in the driver's `advanceModels`, but the suite was not re-run after that fix at the user's request. Run `npm run check` before shipping this tranche.
- [x] Checked the Pi RPC contract for the remaining phase 2 queue items: `docs/rpc.md` 0.84.3 offers no command to remove or reorder queued steering and follow-up messages, so a live queue with remove/reorder needs a Pi-side capability first; the read-only queue display stays.
- [x] 2026-08-26 (phase 3): the backend now owns one Pi child per tab (`tabs.mjs`, `transcript.mjs`, `sessions-index.mjs`, `directories.mjs`, `git.mjs`); events carry `tab`; the client rebuilds a selected tab from the backend mirror (`tabs.update` → `transcript.reset`/`transcript.row` → snapshot response). New QML: `TabStrip`, `DirectoryDialog`, `ConfirmDialog`, `InputDialog`, a sessions picker, and tab shortcuts. `tests/backend-tabs.test.mjs` (8 tests) and seven new smoke markers cover tabs, resume, directories, and worktrees. Two lessons recorded in `DEVELOPMENT.md`: test backends must isolate `XDG_STATE_HOME` (otherwise they restore each other's tabs), and the smoke workspace name `<b>project</b>` contains a slash.
- [x] 2026-08-26 (later): verified the previous tranche — the uncommitted picker (`answered` flag, pick before close), table (`tableFlick` id), and driver (`advanceModels`) fixes make all 79 tests pass, including both live smokes. Then implemented the remaining phase 1 and phase 2 items on the same boundary: syntax highlighting, drafts, saved sequences, `/` and `@` completion, and file attachments (backend modules `highlight.mjs`, `store.mjs`, `state.mjs`, `sequences.mjs`, `attachments.mjs`, `workspace.mjs`; QML `CompletionPopup`, `SequencesDialog`, `TextEditDialog`, composer chips). New coverage: `tests/backend-composer.test.mjs` (10 tests) and nine new smoke markers; `npm run check` passes 90/90 with `--test-concurrency=1` (the parallel runner made two timing-sensitive session tests flaky while Quickshell ran).
- [x] Corrected two plan assumptions found during implementation: (1) dropping "non-essential" records is not enough for a slow consumer. State transitions must never be dropped, so the backend pauses Pi's stdout instead (see "Slow consumers" in `DEVELOPMENT.md`). (2) A SIGKILLed backend cannot reap anything, so Pi is responsible for its own tool children once its stdin closes. This is documented as a known limit and covered by a test rather than claimed as solved.
- [x] 2026-08-26 parity refresh: `npm --prefix pi-package-qt-webui run check` ran 101 tests; 100 passed and one static QML contract failed because `BackendBridge.qml` did not issue the newly declared `resources_state` request. Both live Quickshell smokes passed all 58 markers, including the default and 200% runs. `sampling.mjs`, `resources.mjs`, the Pi-side helper extension, and the resource request validators were present, but `main.mjs`, QML, focused tests, and user documentation did not expose the resource controls yet.
- [x] 2026-08-26 phase 4 resource profiles: two serial workers connected backend dispatch, helper-backed session overrides, global and exact-model persistence, effective source resolution, enabled tool/skill controls, all seven sampling controls, a keyboard-first `ResourceProfilesDialog`, durability warnings, docs, and default/200% smoke coverage. The integration owner accepted and fixed six P1 review findings covering stale tab callbacks, cross-tab reconciliation, transaction honesty, helper response ordering, session durability, and lifecycle locking. Final parent verification: `npm run check` 114/114, both live smokes 65 markers, package dry-run 73 files with the new dialog included, Markdown/diff checks clean, and no staged files. The user explicitly waived only the unavailable provider-diverse review quorum for this phase 4 tranche.

## Current Qt baseline (0.1.0, verified)

Qt WebUI already had a useful thin-client foundation:

- [x] Launch one package-local Pi process in RPC mode.
- [x] Start Pi with the directory from which `qt-webui` was launched as its working directory.
- [x] Send a plain-text prompt.
- [x] Stream assistant text and reconcile it with the final response.
- [x] Show user and assistant messages in a bounded transcript.
- [x] Show ready, running, tool, stopped, and error status.
- [x] Show the active provider, model ID, and thinking effort.
- [x] Abort active work.
- [x] Restart Pi after startup or process failure.
- [x] Follow the desktop light or dark preference.
- [x] Exercise launcher, package, QML contract, and live smoke paths.

## Main Pi WebUI features

| Feature family | Main behavior in Pi WebUI | Qt status (0.2.0) |
| --- | --- | --- |
| Sessions and workspaces | Multiple isolated tabs, grouped working directories, resume, rename, summaries, per-tab drafts, split terminals, directory switching, branch worktrees, and restart continuity | Isolated tabs, folders, resume, rename, per-session drafts, worktree creation, and restart restore done; summaries, close-all, and split terminals remain |
| Conversation transcript | Streaming Markdown, fenced-code highlighting, diagrams, thinking sections, rich tool cards, grouped tool activity, compact output, copy and search | Markdown, syntax highlighting, thinking, tool cards, compact mode, copy, and search done; no diagrams or grouped tool activity |
| Composer and context | Multiline prompts, file and image attachments, clipboard paste, editable text attachments, slash commands, `@` paths, `!` user shell, tracked-skill tags, and conversation tags | Multiline run modes, file/image attachments, editable text attachments, per-session drafts, saved sequences, and `/`/`@` completion done; no pasted files/images, `!` shell, active skill tags, or conversation tags |
| Run control and queues | Send, abort, steer, follow-up, queued prompts, saved prompt sequences, todo progress, workflow state, and context compaction | Send, abort, steer, follow-up, read-only queue display, saved sequences, and manual context compaction done; queue mutation, todo, and workflow state remain unavailable |
| Models and thinking | Model picker, thinking-effort picker, scoped model ordering, model cycling, model-specific defaults, capability-gated sampling parameters, and optional Codex Fast mode | Searchable model and thinking pickers, cycling, and capability-gated sampling profiles at session/global/exact-model scope done; scoped ordering, model-specific picker defaults, and Fast mode remain |
| Tools, skills, commands, and extension UI | Session/global/model tool and skill profiles, command palette, command suggestions, resource inheritance, and typed select/confirm/input/editor requests from extensions | Tool and skill profiles with explicit inheritance/effective-source labels, command suggestions, palette, skill-file opening, typed extension dialogs, notify, title, editor-text, and bounded status requests done |
| Files | Searchable tree, Git ignored-state hints, text editing, Markdown preview, image preview, file search, create/rename/move/delete, and open in the default editor | Not started beyond workspace path completion and confirmed opening of reported skill files |
| Git and worktrees | Repository status, branch switching and creation, worktrees, staged/unstaged/untracked views, diffs, stage/unstage, history, commit, push, pull-request flow, and confirmations | Confirmed branch worktree creation with rollback is done; repository status, diffs, mutations, history, commit, push, and pull-request flows remain |
| Project runners and terminals | Detect package scripts and project runners, custom runners, live ANSI output, progress-line reconciliation, pinned output, and terminal placement | Not started |
| Subagents | Managed and external agent runs, workflow grouping, lifecycle and telemetry, output views, cancel/dismiss/clear actions, model-slot defaults, and persisted-session attachment | Not started |
| Agent conversations | Read-only views for direct Intercom and supervisor conversations, with bounded sanitized history | Not started |
| Events and diagnostics | Bounded event history, severity and type filters, compact/detailed rows, jump to transcript, session-tree navigation, notices, and health information | Bounded Events view with severity/text filters, repeat grouping, copy, and clear plus a diagnostics report done; no type filter, transcript jump, or session tree |
| Control Deck and dashboard | Project/session overview, reorganizable sections, resizable panels, files, usage, extensions, settings, events, queues, Git, and agents | No dashboard; usage, events, diagnostics, queue, settings, and extension status exist as separate controls |
| Themes and interface | Built-in and custom themes, semantic syntax colors, density, control visibility, panel placement, durable layout, keyboard resizing, and reduced motion | Automatic light/dark palette, syntax tokens, compact/comfortable density, and persisted display settings done; custom themes, panel layout, high contrast, and reduced motion remain |
| Usage and optional companions | Provider usage, token/cost statistics, optional package discovery and setup, `/btw`, voice, remote access, release tools, and companion-provided panels | Context, token, and cost usage plus grouped status from already-loaded extensions done; discovery, setup, and companion workflows remain |
| Reliability and access | Session reconnection, bounded streams and files, safe path handling, update/rollback plans, keyboard navigation, screen-reader labels, touch/mobile layouts, and offline browser shell | Multi-tab session restore, backend/Pi restart, bounded streams and attachments, path confinement, keyboard paths, accessible names, and 200% scaling smoke done; no update flow or broad fractional-scale audit |

## Product decisions for the Qt client

The Qt client should match useful workflows, not browser-specific machinery.

### Keep in scope

- Local Linux desktop use.
- Native Quickshell and Qt Quick navigation.
- Pi session, transcript, model, tool, skill, file, Git, runner, queue, and subagent workflows.
- Desktop notifications, native file dialogs, default-application launching, and portal integration where they improve the desktop experience.
- Keyboard-first operation and accessible Qt controls.

### Do not copy by default

- The HTTP server and browser SSE transport.
- PWA installation, service workers, browser caching, or mobile-browser layouts.
- LAN exposure and remote PIN authentication.
- Browser-local storage synchronization.
- Browser update-restart supervision when npm or Pi package updates can use a separate desktop flow.

These can become separate requirements later. They should not block local desktop parity.

## Recommended architecture

Do not grow the QML bridge into a large mix of protocol parsing, Git commands, filesystem mutation, package management, and UI state.

Use a package-local Node backend process with a versioned JSON-lines protocol:

1. The backend owns the Pi RPC child and translates raw Pi records into bounded, typed events. — done (`lib/backend/pi-session.mjs`)
2. The backend owns filesystem, Git, runner, session, package, and subagent-registry operations. — settings, notifications, links, attachments, workspace indexing, directories, sessions, tabs, and worktree creation done; files, broad Git, runners, packages, and subagents arrive with their phases
3. QML owns presentation, selection state, focus, dialogs, and short-lived view state. — done
4. Every mutating request has an operation ID, typed result, visible error, and explicit confirmation policy. — done for the current request set; link opening requires confirmation
5. Paths remain confined to the selected workspace unless the user explicitly chooses another directory. — done for attachments and workspace completion; native folder/file choices and confirmed worktree paths are explicit exceptions
6. No command, path, or prompt is interpolated into shell text. Use argument arrays and `shell: false`. — done and tested
7. The backend owns a process group or equivalent process-tree cleanup strategy. — done and tested (`tests/backend-lifecycle.test.mjs`); limit: a SIGKILLed backend relies on Pi stopping its own children

Implemented modules:

```text
lib/backend/
  main.mjs          request dispatch, outbound queue, backpressure, lifecycle
  protocol.mjs      version, limits, validation, frame constructors, link policy
  jsonl.mjs         strict LF JSONL reader with frame cap
  pi-session.mjs    Pi child ownership and event translation
  markdown.mjs      bounded Markdown → blocks with whitelisted StyledText
  highlight.mjs     bounded syntax tokens
  settings.mjs      XDG settings store
  store.mjs         atomic bounded JSON stores
  state.mjs         drafts, tabs, directories, and recent actions
  sequences.mjs     saved prompt sequences
  attachments.mjs   confined text and image attachments
  workspace.mjs     confined path indexing and completion
  tabs.mjs          one isolated Pi session per tab
  transcript.mjs    live mirrors and persisted-history translation
  sessions-index.mjs, directories.mjs, git.mjs
  process-tree.mjs  process-group spawn and termination
  desktop.mjs       notify-send / xdg-open
  sampling.mjs, resources.mjs  phase 4 groundwork, not yet dispatched to QML
lib/pi-extension/
  qt-webui-helper.mjs  phase 4 Pi-side tool, skill, and sampling groundwork
qml/
  BackendBridge.qml, Theme.qml, shell.qml, SmokeDriver.qml
  components/       shared transcript, composer, completion, status, and tab controls
  dialogs/          shared app, extension, picker, directory, session-adjacent, event, and diagnostic dialogs
```

Still to add with later phases: the backend/QML integration for resource profiles, `files.mjs`, broad Git operations, `runners.mjs`, `subagents.mjs`, and the larger `qml/models/` and `qml/views/` layouts.

Share focused, UI-independent logic with Pi WebUI where practical. Do not import its browser application or duplicate the 30,000-line frontend.

## Rules for every phase

A phase is not ready to implement until its limits and accessibility contract are written next to the affected protocol and tests.

- [x] Define numeric byte, record, queue, timing, and retention limits for each new data path before implementation. (`LIMITS` in `protocol.mjs`, mirrored in `DEVELOPMENT.md`)
- [x] Preserve the current 80-row transcript, 8,192-character message, and 512-character visible-error limits until a tested replacement budget is approved.
- [x] Add boundary fixtures at the limit and one unit over it, plus truncation, rejection, cleanup, and recovery expectations. (`tests/backend-units.test.mjs`, `tests/backend-session.test.mjs`)
- [x] Give every new control an accessible name, role, state, focus order, keyboard path, and focus-return behavior in the same phase that adds it. (`tests/qml-contract.test.mjs`)
- [x] Test the phase's primary workflow without a pointer and at 200% scaling before its release slice can ship. (smoke runs at `QT_SCALE_FACTOR=2`; dialogs are driven through their keyboard-handler entry points — no synthesized key events yet)
- [x] Treat untrusted Markdown, ANSI, diffs, paths, images, tool data, and process output as bounded data rather than executable markup or shell text. (Markdown policy tests; ANSI and diffs arrive with phase 6)

## Phased implementation checklist

### Phase 0: backend and UI foundations — done

- [x] Define a versioned backend request, response, and event protocol.
- [x] Move Pi process ownership and RPC parsing from QML into the Node backend.
- [x] Preserve current prompt, stream, abort, restart, runtime-info, and error behavior during the move.
- [x] Add the phase 0 QML bridge models for messages, tools, queues, notices, and dialogs. Session, file, Git, runner, and agent models arrive with their phases.
- [x] Add request correlation, explicit per-operation timeouts, cancellation, stale-response rejection, and byte-and-record-bounded event queues.
- [x] Define the first protocol budget, including the maximum JSON-lines frame, queued records, queued bytes, request duration, and shutdown grace period.
- [x] Add one reusable application dialog with initial focus, focus containment, Escape handling, validation, and focus return. (`AppDialog`)
- [x] Add reusable buttons, list rows, status badges, empty states, notices, and loading states. Split panes arrive with the phase 8 panel layout.
- [x] Add settings storage under the normal XDG config/state locations with private permissions.
- [x] Add protocol contract tests and a fake backend for deterministic QML tests. — deterministic QML tests use the real backend with the fake Pi fixture, which exercises more code than a fake backend would
- [x] Add lifecycle handling for stdin EOF, normal window close, `SIGINT`, `SIGTERM`, startup failure, backend crash, bounded graceful shutdown, forced process-tree cleanup, and child reaping.
- [x] Keep the current live Quickshell smoke test as a release gate.

Acceptance gate:

- [x] Existing 0.1.0 behavior passes unchanged through the new backend boundary. (same fixture scenarios, same capture expectations: prompt order, two aborts, exact dialog answers)
- [x] Protocol tests exercise each recorded numeric limit, one-over-limit rejection, delayed/duplicate/out-of-order records, queue overflow, and cleanup.
- [x] Normal close and abrupt backend or Quickshell death terminate and reap the backend, Pi, and every child process within the recorded shutdown bound. — abrupt backend SIGKILL is the documented exception: Pi stops its own children on EOF

### Phase 1: useful daily chat — mostly done

- [x] Store complete bounded message parts instead of flattening every assistant message to text.
- [x] Render Markdown headings, lists, links, quotes, tables, and fenced code under an explicit untrusted-content policy.
- [x] Disable raw HTML and automatic resource fetching, allow only approved URL schemes, bound parse depth/input/rendered objects, and open external links only after deliberate user activation.
- [x] Add language-aware code styling and copy-code actions. — `highlight.mjs` tokenizes C-family, Python, Ruby, shell, JSON, YAML, TOML, CSS, markup, SQL, and diff blocks into escaped semantic tokens (8,192 characters / 4,000 tokens per block); QML maps kinds to theme colors inside `<pre>`; **Select text** swaps in the plain editor; copy returns the original text; `syntaxHighlighting` setting
- [x] Render thinking separately and let the user show or hide it.
- [x] Render tool calls as lifecycle cards with safe argument summaries, status, duration, and errors.
- [x] Keep fast token streaming without rebuilding the whole transcript per delta. (per-row `setProperty`, 80 ms render cadence)
- [x] Add normal and compact transcript modes.
- [x] Add transcript search with next, previous, match count, and visible highlighting. — whole-row highlighting; no inline match highlighting
- [x] Add message and selection copy actions. — message copy, code-block copy, tool-output copy, and text selection inside code and tool output
- [x] Preserve scroll position when reading history; auto-follow only when already near the bottom.
- [x] Add a useful empty state with a resume action. — **Resume a session** and **Open a folder** buttons plus the tab shortcuts appear once Pi is ready
- [x] Implement queued extension `select`, `confirm`, `input`, and `editor` requests with exact-once typed responses, explicit cancellation, focus handling, and cleanup on close or session loss.
- [x] Add desktop notifications for completion, failure, and queued extension questions when the window is unfocused.

Acceptance gate:

- [x] Recorded fixtures for stream bytes, chunk count, message parts, Markdown depth, rendered objects, and update cadence stay within the phase's latency and memory budgets.
- [x] Raw HTML, remote resources, disallowed schemes, oversized/deep Markdown, and automatic external launching are rejected or rendered inert.
- [x] Copy and search return original text rather than styled or elided text.
- [x] Keyboard and screen-reader users can identify message role, tool state, run completion, and extension-request state.
- [x] Extension requests answer once, cancel cleanly, retain exact option/input values, and cannot survive their owning session.

### Phase 2: composer, attachments, commands, and run modes — partially done

- [x] Support send, steer, follow-up, and abort as explicit composer modes.
- [ ] Add a visible live queue with remove, reorder, and restore-to-composer actions. — queue is displayed read-only; blocked on Pi: RPC 0.84.3 has no remove/reorder commands
- [x] Add saved prompt sequences with create, rename, load, reorder, delete, and run actions distinct from the live queue. — `sequences.mjs` (32 × 16 entries, validated on read and write) and `SequencesDialog`; Run sends entry 1 and queues the rest as follow-ups; Delete arms then confirms and never runs
- [x] Preserve a draft per session. — `state.mjs` drafts keyed by session file (else workspace), saved 600 ms after typing stops, restored only into an empty editor
- [x] Add file selection through the desktop portal or native Qt dialog. — `QtQuick.Dialogs.FileDialog` (`Ctrl+Shift+A`); picker-chosen files are granted, every other path is confined to the workspace
- [ ] Support pasted files and images with size/type validation. — blocked on Quickshell: it exposes clipboard text only, so image paste has no data source; typed or completed `@` paths plus the picker cover files
- [x] Show attachment chips with preview, edit for text, and remove actions. — chips show name, kind, size, and edited state; `TextEditDialog` edits text attachments; images are validated by signature; up to 8 per prompt
- [x] Add `/` command completion and keyboard navigation. — `commands_list` from `get_commands`; `CompletionPopup` with Up/Down/Tab/Enter/Escape; accepting only edits the text
- [x] Add `@` workspace-path completion. — `workspace.mjs` index (`git ls-files` in repositories, bounded walk elsewhere); 50 ranked suggestions; directories complete with a trailing `/`
- [ ] Add `!` user-shell support only after a visible safety design and exact argument-handling contract are approved. — not started; Pi's `bash` RPC command exists, but the safety design is not approved
- [ ] Show active skill tags and open the selected skill file. — skills appear as `/skill:name` completions with their description; opening the skill file arrives with the command palette
- [ ] Show todo goal, progress, checklist, and current item. — no Pi RPC or extension contract supplies todo state; blocked on a typed capability
- [x] Add compact/context controls without crowding the primary prompt path. — a header action runs bounded manual compaction while idle; automatic compaction and retry events remain visible as notices

Acceptance gate:

- [x] Attachments never escape configured size, type, or workspace rules. — `tests/backend-composer.test.mjs`: traversal, symlink escape, oversized, wrong signature, binary, invalid UTF-8, non-file, and the 8-attachment bound
- [x] Suggestions expose stable accessible selection and never send on accidental completion acceptance. — `CompletionPopup` list items carry `Accessible.selected`; the QML contract proves `acceptCompletion` never calls `trySend`; the smoke proves no `/review` prompt is sent
- [x] Queued, steering, follow-up, and saved-sequence messages retain their distinct Pi semantics. — the backend test and smoke capture show `prompt` then `follow_up` commands for a sequence
- [x] Saved sequences persist safely, validate every entry, and never run from a destructive list action. — 0600 file, per-entry validation on read, delete/move/save paths contain no run call (QML contract)

### Phase 3: sessions and workspaces — done except summaries, close-all, and split views

- [x] Add a tab model with one isolated Pi session per tab. — `tabs.mjs` registry (8 tabs), every session event tagged with `tab`, per-tab attachments, path index, and an 80-row transcript mirror; the bridge materializes only the active tab
- [x] Group tabs by working directory without hiding the active session. — the strip names tabs by folder (tooltip shows the full path); the active tab is always shown
- [ ] Add new, close, close-all, rename, duplicate/split, and reorder actions. — new (`Ctrl+N`), open folder (`Ctrl+O`), close (`Ctrl+W`), rename (`F2`, also `set_session_name`), duplicate through `Ctrl+N`, and reorder (`tab_move`, keyboard entry through the palette) are done; close-all and split views are not offered
- [x] Warn before closing a busy session and explain what is terminated. — backend refuses with `busy` unless `force`; `ConfirmDialog` (Cancel focused first) explains that the run is aborted and the Pi process stops
- [x] List and resume persisted Pi sessions. — `sessions-index.mjs` reads Pi's session directory with Pi's encoding (cross-checked in tests); `session_switch` replays `get_messages` into rows
- [ ] Add automatic titles and optional session summaries. — titles come from the tab name, the Pi session name, or the folder; summaries need a model call and are deferred
- [x] Add a working-directory picker with direct path entry, recent and pinned folders, search, Back, Up, Home, and create-folder actions. — `DirectoryDialog` over `directory_list`/`directory_create`/`directory_pin`
- [x] Allow a tab to change directory only through a confirmed lifecycle transition. — decided more strictly: a tab never changes directory; a new folder always opens a new tab, so no session is silently replaced
- [x] Create branch worktrees through a backend contract with path-aware confirmation, rollback on partial failure, and tests for spaces, detached HEAD, conflicts, no remotes, and nested worktrees; open successful worktrees in new tabs. — `git.mjs` `planWorktree` + `createWorktree` (`worktree_create` requires `confirmed: true`); tests cover spaces, detached HEAD, existing branch, nested path, a repository with no remotes, and rollback with a failing `worktree add`
- [x] Restore open tabs, directories, names, and drafts after a normal Qt WebUI restart. — `state.json` tabs; `registry.restore()` skips missing folders, resumes session files, and selects the launch folder; drafts are keyed by session file
- [x] Represent interrupted requests honestly after process or machine failure. — `rowsFromHistory` marks tool calls without results as interrupted and a trailing user message or aborted/failed reply produces a warning notice

Acceptance gate:

- [x] Tabs cannot leak transcript, model, queue, tool, or workspace state into one another. — `resetTabState` on every switch; `tests/backend-tabs.test.mjs` proves tagged events and per-tab prompts; the smoke switches tabs and checks the replayed transcript and workspace
- [x] Restart recovery reconnects or restores only sessions backed by authoritative state. — only saved tabs whose folder exists are restored; session files that no longer exist start fresh; the fixture-backed restore test checks the replayed history
- [x] Closing or restoring a tab cannot orphan backend processes. — `tab_close` awaits `terminateProcessTree`; the test waits for the closed tab's Pi pid to disappear; `stopAll` and the forced kill cover every tab
- [x] Worktree failures leave the original repository unchanged or report every residual path and recovery action. — rollback removes the created folder and branch; residual paths are named in the error

### Phase 4: models, thinking, tools, skills, and command palette — partially done

#### Active tranche: resource profiles and sampling controls

Classification: complex. This tranche crosses the backend protocol, persisted resource profiles, the Pi-side helper extension, per-tab runtime state, QML controls, tests, and user documentation. It also changes which tools and skills Pi can use and how provider requests are serialized.

Integration owner: the parent Pi session. Workers must not edit this plan or the final report.

Implementation status: complete. Code, focused tests, full tests, live smokes, package dry-run, documentation, accepted review fixes, strict HTML report validation, and the scoped review-quorum waiver are recorded. The broader parity plan stays active for later phases.

Success criteria:

- `resources_state`, `tools_set`, `skills_set`, and `sampling_set` work for session, global, and exact-model scopes while Pi is idle.
- Session values override exact-model values, which override global values, which override Pi defaults. `null` means inherit; an empty tool or skill selection means intentionally none.
- The client shows effective values and their source, disables unsupported sampling parameters with a reason, preserves unsupported stored values, and refreshes resource state after model or thinking changes.
- Resource changes fail closed when the helper or capability state is unavailable, never run during an active model request, and do not leak between tabs.
- Numeric limits, one-over-limit cases, helper timeouts, capability loss, reset, exact payload serialization, keyboard access, focus return, and the default and 200% live flows have coverage.
- `npm run check`, package dry-run, Markdown checks, two independent reviews, and the strict HTML report validator pass.

Scope and invariants:

- Keep the existing version 1 JSON-lines protocol and the package-local Pi helper boundary.
- Use the existing `resources.json` store for global and exact-model profiles. Keep session overrides in Pi session history through the helper, separate from the effective values applied from broader scopes.
- Persist tool and skill profiles as enabled-name lists. The helper may translate the effective skill list to Pi's internal disabled-skill set, but that internal representation must not reverse `null` and empty-list inheritance semantics.
- Do not add scoped model ordering, subagent model-slot defaults, Codex Fast mode, shell execution, package installation, or release work in this tranche.
- Do not apply unsupported sampling values or discard them from persisted profiles. Unknown provider APIs support no sampling controls.
- Apply tool and skill changes only after an explicit user action. Show scope and inheritance before saving.

Execution waves:

1. **Backend integration worker** owns `lib/backend/`, `lib/pi-extension/`, backend fixtures, and backend-focused tests. It connects storage, helper state, effective resolution, request dispatch, refresh after model/thinking changes, validation, and failure handling. Unique handoff: runtime-managed `handoffs/phase4-backend.md`.
2. **QML and documentation worker** starts after wave 1 settles. It owns `qml/`, QML/smoke/docs tests, `README.md`, `TECHNICAL.md`, and `DEVELOPMENT.md`. It adds keyboard-first profile controls, effective/source labels, unsupported reasons, user-flow coverage, and documentation. Unique handoff: runtime-managed `handoffs/phase4-qml-docs.md`.
3. The integration owner inspects both changes and runs the affected and full checks.
4. Two fresh, read-only reviewers from provider families different from each other and the primary implementation provider inspect the integrated result. Every finding receives an `accepted`, `rejected`, `deferred`, or `needs verification` disposition here before fixes.

Rollback: revert this tranche's backend dispatch, QML controls, tests, and docs together. The helper and `resources.json` reader must continue to ignore invalid or unavailable profile data without blocking core chat startup. No migration deletes stored values.

Final report: [Phase 4 resource profiles report](../../reports/phase4-resource-profiles.html).

Review findings and dispositions:

Review attempt 1 used the configured three-reviewer gate. The architecture reviewer completed as run `291d131a-b81e-4d46-8d52-50a1fc215779` with `openai-codex/gpt-5.6-sol:high`; its report is the runtime artifact `reviews/phase4-architecture.md`. The DeepSeek and Kimi reviewer slots exhausted their two read-only attempts: OpenRouter returned the workspace monthly-key limit, the Anthropic fallback returned rate-limit errors, and the Cursor fallback rejected the API key. Only one review output qualified, from the same provider family as the primary implementation worker.

Waiver: after reviewing the completed implementation, 114-test result, both live smokes, package dry-run, accepted-fix evidence, and strict report validation, the user explicitly selected **Waive this review quorum**. This waiver applies only to the missing provider-diverse reviewer quorum for the phase 4 resource-profile tranche. It does not waive any test, finding disposition, clean-checkout requirement, later parity phase, release, publication, or deployment gate.

| Finding | Disposition | Evidence and required action |
| --- | --- | --- |
| Delayed resource responses can overwrite the active state after a tab switch | accepted | `BackendBridge.request` records no originating tab and `settlePending` invokes callbacks after `activeTabId` changes. Bind session-scoped callbacks to their origin and test delayed reads and writes across a switch. |
| Global and exact-model changes leave other matching tabs on stale applied profiles | accepted | `setResource` applies only to the requesting session. Reconcile every affected idle tab before commit, and refuse broader-scope changes while an affected tab is active. |
| A save can report failure after helper or persisted state already changed | accepted | `setResource` applies, persists, then performs another required helper round trip; rollback failure is swallowed. Build the response from validated apply results, keep commit ordering explicit, and test each failure point. |
| Early helper errors can reject an unobserved promise and trigger fatal backend shutdown | accepted | `helperCall` creates the answer promise before awaiting the Pi prompt response, but does not attach its rejection path immediately. Coordinate both legs and clean up the losing leg on every outcome. |
| Session history persistence failures are reported as successful saves | accepted | The helper suppresses every `appendEntry` error. Return an explicit durability result or a real error and show it in backend/QML state. |
| The plan still describes resource profiles as unfinished | accepted | Update checkboxes, verification evidence, and release status after accepted fixes, validation, and the review gate settle. |
| Broader-profile locking does not fence compaction or session lifecycle transitions | accepted | Follow-up review run `5adc5cd0-c375-434f-b98e-145fdcf6fd4f` verified four original P1 findings but showed `compact`, restart, close, switch, and new-session handlers bypassing the per-tab resource lock. Centralize the exclusive-operation check and add delayed reconciliation coverage for each lifecycle request. |

Accepted-fix verification: worker runs `21bf3456-2777-4980-ae09-5d548c23fe5a` and `0ed2f526-351f-4acb-8f22-6c1d2747a00a` implemented every accepted finding. Parent inspection confirmed origin-tab callback fencing, all-target profile reconciliation, transaction rollback reporting, coordinated helper completion, explicit session durability, and lifecycle exclusion. The final 114-test run includes delayed commit and rollback cases for compaction, restart, close, session switch, and new session. No accepted finding remains open. The unavailable provider-diverse review quorum is covered by the scoped user waiver above.

- [x] Add searchable model selection using Pi's reported provider/model inventory.
- [x] Add supported thinking-effort selection.
- [x] Add capability-gated sampling controls for temperature, top-p, frequency and presence penalties, seed, top-k, and min-p. — session/global/exact-model controls use backend capability reasons and exact provider payload translation
- [x] Preserve unsupported sampling values without applying or discarding them, and fail closed when capability discovery is stale or unavailable. — unsupported values stay in profiles, unknown APIs apply none, and helper/capability loss disables edits without blocking core chat
- [x] Add model cycling and clear current/effective-model labels. — `Ctrl+Shift+P` / `Ctrl+Shift+E`; the header shows the values Pi confirmed (a model change re-reads state so a reset thinking level is shown, not assumed); Pi's `isScoped` flag is passed through but not yet labelled — cycling and the current model label are done; effective-model and scoped-state labels are not
- [x] Add session, global, and exact-model tool profiles. — enabled-name lists, intentional none, inheritance, cross-tab reconciliation, and session durability are implemented and tested
- [x] Add session, global, and exact-model skill profiles. — enabled-name lists remain public while the helper translates effective values to Pi's internal disabled set
- [x] Preserve the inheritance order and distinguish inherited defaults from an intentionally empty selection. — session → exact model → global → Pi defaults is shown in QML; `null` means inherit and `[]` means intentionally none
- [x] Add a keyboard-first command palette for actions, tabs, models, sessions, and Pi commands. — `Ctrl+K` over `PickerDialog`; commands are inserted into the prompt, never sent; skill files open after confirmation through `open_path`
- [x] Add grouped results, stable ranking, recent actions, shortcuts, and invalidation when capabilities change. — grouped rows with fixed order, recents first (`recent_action`, 20 kept), shortcuts in the detail column, models/sessions/commands reloaded on every open
- [ ] Add model-slot defaults for built-in subagent roles only when the launch path can enforce them safely.
- [ ] Expose optional provider controls, such as Codex Fast mode, only when the matching capability is installed and active.

Acceptance gate:

- [x] A model change refreshes dependent thinking, sampling, tool, and skill state without stale UI. — model/thinking responses carry fresh resource state, tab callbacks are origin-bound, and broader profiles reconcile affected tabs before commit
- [x] Sampling tests cover each supported parameter, unsupported-value preservation, capability loss, reset, validation, and exact request serialization.
- [x] Profile edits show their scope and whether a Pi session reload is required. — the dialog names session/exact-model/global scope and applies changes immediately while idle; ephemeral session state is labelled non-durable
- [x] Every palette action remains reachable without a pointer. — the palette is a `PickerDialog` (filter, arrows, Enter, Escape) and every action it lists also has a shortcut or a header button

### Phase 5: files and project navigation

- [ ] Add a lazy, searchable workspace tree.
- [ ] Mark hidden and Git-ignored entries without removing them.
- [ ] Add keyboard tree navigation and a pointer-accessible row menu.
- [ ] Open UTF-8 text, Markdown, and supported raster images with explicit size limits.
- [ ] Add source and Markdown preview modes.
- [ ] Add text search, selection, edit, save, and conflict detection.
- [ ] Add create, rename, move, duplicate, and delete operations with clear confirmation and undo where practical.
- [ ] Add "Open in default application" through the desktop portal.
- [ ] Refresh affected nodes from filesystem events without rescanning the whole workspace.
- [ ] Keep every read and mutation confined to the active workspace unless a native picker grants another path.

Acceptance gate:

- [ ] Symlink, traversal, stale-file, oversized-file, and permission-denied cases have tests.
- [ ] External edits cannot be silently overwritten.
- [ ] File operations work with keyboard, mouse, and touchpad input.

### Phase 6: Git, worktrees, runners, and terminals

- [ ] Show repository, branch, upstream, ahead/behind, and dirty state.
- [ ] List staged, unstaged, untracked, conflicted, and incoming changes.
- [ ] Add bounded unified and side-by-side diff views.
- [ ] Add stage, unstage, discard, and untracked-delete actions with path-aware confirmation.
- [ ] Reuse the Phase 3 worktree service for branch/worktree inspection and management rather than adding a second creation path.
- [ ] Add bounded commit history and commit diff inspection.
- [ ] Add guided review, commit-message generation, commit, push, and pull-request preparation as explicit steps.
- [ ] Never retry Git mutations automatically.
- [ ] Detect common package scripts and project runners.
- [ ] Support project-defined runners through a validated config file.
- [ ] Add runner terminals with safe ANSI rendering, carriage-return progress replacement, stop/restart, copy, and output bounds.
- [ ] Keep runner and Git child processes owned by the backend lifecycle.

Acceptance gate:

- [ ] Git tests cover ignored files, upstream divergence, partial mutation failures, and reuse of the already-tested Phase 3 worktree contract.
- [ ] Destructive actions name the affected paths and provide no false success after partial failure.
- [ ] Terminal rendering treats process output as data, never executable rich text.

### Phase 7: subagents, conversations, workflows, and diagnostics

- [ ] Show managed subagent runs grouped under the owning Qt session.
- [ ] Show registered external runs separately and label stale, lost, failed, cancelled, and completed states accurately.
- [ ] Group workflow controllers and children without counting the controller as an agent.
- [ ] Show bounded telemetry only when the producer supplies evidence.
- [ ] Add read-only output views and only show cancel, refresh, dismiss, or detach actions supported by the owner.
- [ ] Add clear-finished and opt-in auto-clear without deleting producer artifacts.
- [ ] Show direct Intercom and supervisor conversations in a bounded, sanitized read-only view.
- [ ] Add an Events view with severity/type filters, retention bounds, repeat grouping, copy, clear, and jump-to-message. — `EventsDialog` (`Ctrl+Shift+L`) covers 200 kept notices with tab labels, severity and text filters, consecutive-repeat grouping, copy, and clear; type filters and jump-to-message remain unavailable because notices carry no transcript row reference
- [ ] Add queue, todo, workflow, and gate status views. — the live queue strip exists; todo, workflow, and gate views need a typed capability from Pi or an extension
- [x] Add an advanced diagnostics view for process IDs, session IDs, paths, protocol health, and recent errors. — `DiagnosticsDialog` (`Ctrl+Shift+D`) over the `diagnostics` request plus client counters, with copy

Acceptance gate:

- [ ] Restart reconstruction never labels stale metadata as a running process.
- [ ] Conversation views exclude tool arguments/results, reasoning, attachments, and private session records.
- [ ] Unsupported controls are hidden rather than presented as no-op buttons.

### Phase 8: dashboard, settings, themes, usage, and companions

- [ ] Add one compact dashboard for project, session, model, context, Git, queue, and active agents.
- [ ] Use one canonical state selector for each repeated status value.
- [ ] Add resizable and collapsible desktop panels with durable sizes and placement.
- [x] Add comfortable and compact density settings.
- [ ] Expand the semantic theme token set for transcript, syntax, diff, status, focus, warning, and destructive states. — transcript, syntax, status, focus, warning, and destructive tokens exist; diff-specific tokens arrive with Git
- [ ] Add built-in theme selection and custom-theme import only after validation and preview are available.
- [ ] Respect reduced motion, high contrast, and Qt palette changes. — Qt palette changes are respected; reduced motion and high contrast are not
- [x] Add provider usage cards when Pi or a companion exposes supported usage data. — the **Usage** footer group shows context fill, tokens, and cost from `get_session_stats`, refreshed after each run and on tab selection
- [ ] Add optional companion discovery with clear installed, enabled, loaded, update, and reload-required states. — bounded status from already-loaded extensions is rendered; discovery and lifecycle state are not
- [ ] Open companion setup through typed capability contracts rather than package-specific QML conditionals.
- [ ] Add `/btw`, voice, statistics, release, or remote-access companions only as separate, capability-gated workstreams.

Acceptance gate:

- [ ] Layout and theme settings survive restart without hiding essential recovery controls. — display settings survive restart; no layout settings yet
- [ ] A missing or broken companion cannot block core chat startup.
- [ ] Light, dark, high-contrast, and reduced-motion smoke checks pass. — light and dark only

### Phase 9: hardening and release parity

- [ ] Audit and extend the per-phase QML interaction tests for focus, dialogs, tabs, menus, tree navigation, composer modes, and destructive actions.
- [ ] Add backend tests for every read and mutation boundary. — every current boundary is tested, including the model, thinking, and compaction requests; extend with each phase
- [ ] Add long-session, many-tab, large-tree, slow-consumer, and process-crash stress tests. — slow-consumer and process-crash exist
- [ ] Profile QML object count, transcript update cost, backend memory, and startup time before optimizing.
- [ ] Audit and tune the retention limits already defined by each phase for transcripts, events, runner output, diffs, thumbnails, and agent output.
- [ ] Add structured logging with secret and prompt-content redaction.
- [ ] Audit every shipped view for missing accessibility names, roles, focus order, shortcuts, announcements, and scale behavior; fix gaps before broad parity. — current buttons expose accessible names, focus rings, and checked state for active toggles; the broad audit remains open
- [ ] Verify behavior under 200% scaling and common fractional Wayland scale factors. — 200% is verified in the smoke suite; fractional factors are not
- [ ] Verify packaging from a clean npm install with Quickshell 0.3 and the newest supported release. — packed-install test covers the npm side; only Quickshell 0.3.1 is available locally
- [x] Update `README.md`, `TECHNICAL.md`, and `DEVELOPMENT.md` in the same change as each user-visible tranche. — current docs cover models, thinking, compaction, resource profiles and durability, composer features, tabs, worktrees, palette, usage, Events, and diagnostics

Acceptance gate:

- [ ] `npm test` and `npm run check` pass from a clean checkout. — the current integrated working tree passes 114/114 and the packed-install test passes; a separate clean-checkout run remains
- [ ] The live smoke suite covers startup, prompt, stream, tool, abort, restart, model and thinking changes, compaction, session restore, and one representative file/Git flow. — both 65-marker smokes pass at default and 200% scale and cover resource profiles, session restore, and worktree creation; a representative phase 5 file workflow and broader phase 6 Git flow remain
- [x] Known parity gaps remain listed explicitly rather than implied complete.

## Suggested release slices

### Desktop chat MVP — implemented for 0.2.0

Phases 0 and 1, the implemented phase 2 composer features, and the completed phase 4 model, thinking, tool, skill, and sampling controls provide the daily chat client. Attachments, drafts, sequences, completion, resource profiles, cycling, and compaction are implemented, and both expanded smokes pass. The phase 4 tranche is release-verified under its scoped review-quorum waiver. The broader phase 9 clean-checkout and remaining parity gates still apply.

### Workspace MVP

Add phases 3 through 5 after each phase's numeric-bound and accessibility gates pass. At this point the Qt client can replace the browser UI for normal single-developer project work.

### Engineering cockpit

Add phases 6 and 7. This brings Git, runners, subagents, conversations, workflows, and diagnostics into the desktop client.

### Broad parity

Add phases 8 and 9. Optional companions remain capability-gated and should not hold the core client hostage.

## Definition of parity

Do not call the Qt client feature-complete merely because every Pi WebUI panel has a Qt screen. Broad parity means that a user can complete the same core workflows with equivalent state safety, failure visibility, keyboard access, and test coverage. Browser-only transport and mobile features are excluded unless their requirements are approved separately.

## Main risks

- Pi WebUI combines a mature backend with a very large browser client. Copying its UI code or endpoint layout would import browser-specific complexity into QML.
- Direct Pi RPC does not provide every file, Git, package, session, and subagent service needed for parity. The backend boundary now exists; each new service must extend the versioned protocol and its limits.
- Rich Markdown, code, diff, ANSI, and image rendering can become injection or resource-exhaustion paths. Markdown, syntax tokens, and attachment images are bounded; diffs and runner ANSI still need the same escaped, bounded treatment.
- Multi-session process ownership and restart restoration are built and tested. The next lifecycle risk is keeping future file, Git, runner, and agent state isolated per tab.
- Optional companions change capabilities at runtime. The Qt UI needs discovery contracts, not hardcoded assumptions.
- Resource profiles can change tool and skill availability across tabs. The implementation now reconciles affected idle tabs transactionally and fences lifecycle operations, but future profile changes must preserve those cross-tab and rollback contracts.
- Provider-diverse review was unavailable because OpenRouter exhausted its workspace key limit, Anthropic returned rate limits, and the Cursor fallback rejected its API key. The user waived that quorum only for this tranche; future complex work must obtain its own quorum or separate explicit waiver.

## Confidence

Confidence: 98/100 for the feature inventory and 97/100 for the implementation mapping. Repository files, docs, 114 passing tests, package contents, both live smokes, accepted review fixes, and the scoped waiver agree on the resource-profile workflows. Tranche release confidence is 94/100; the remaining uncertainty is the waived provider-diverse perspective and the broader phase 9 clean-checkout gate.
