# Pi WebUI feature map and Qt WebUI implementation checklist

Status: in progress. The Desktop chat MVP and the first model, thinking, and context controls are implemented in the 0.2.0 worktree. Phase 0 is complete; phases 1, 2, and 4 are partial; phases 3, 5, and 6 have not started; phases 7–9 contain groundwork rather than complete workflows. The expanded live smoke currently fails after opening the model picker, so this tranche is not release-verified.

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
- [x] Corrected two plan assumptions found during implementation: (1) dropping "non-essential" records is not enough for a slow consumer. State transitions must never be dropped, so the backend pauses Pi's stdout instead (see "Slow consumers" in `DEVELOPMENT.md`). (2) A SIGKILLed backend cannot reap anything, so Pi is responsible for its own tool children once its stdin closes. This is documented as a known limit and covered by a test rather than claimed as solved.

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
| Sessions and workspaces | Multiple isolated tabs, grouped working directories, resume, rename, summaries, per-tab drafts, split terminals, directory switching, branch worktrees, and restart continuity | Not started (one session per window; session name shown) |
| Conversation transcript | Streaming Markdown, fenced-code highlighting, diagrams, thinking sections, rich tool cards, grouped tool activity, compact output, copy and search | Markdown, thinking, tool cards, compact mode, copy, and search done; no syntax highlighting, diagrams, or grouped tool activity |
| Composer and context | Multiline prompts, file and image attachments, clipboard paste, editable text attachments, slash commands, `@` paths, `!` user shell, tracked-skill tags, and conversation tags | Multiline prompt with send/steer/follow-up/abort; no attachments, completion, tags |
| Run control and queues | Send, abort, steer, follow-up, queued prompts, saved prompt sequences, todo progress, workflow state, and context compaction | Send, abort, steer, follow-up, read-only queue display, and manual context compaction done; automatic compaction and retries surface as notices |
| Models and thinking | Model picker, thinking-effort picker, scoped model ordering, model cycling, model-specific defaults, capability-gated sampling parameters, and optional Codex Fast mode | Searchable model picker, thinking-effort picker, and cycling done; scoped ordering, defaults, sampling controls, and Fast mode not started |
| Tools, skills, commands, and extension UI | Session/global/model tool and skill profiles, command palette, command suggestions, resource inheritance, and typed select/confirm/input/editor requests from extensions | Typed extension dialogs done; notify, title, editor-text, and bounded plain or structured status requests handled; profiles and palette not started |
| Files | Searchable tree, Git ignored-state hints, text editing, Markdown preview, image preview, file search, create/rename/move/delete, and open in the default editor | Not started |
| Git and worktrees | Repository status, branch switching and creation, worktrees, staged/unstaged/untracked views, diffs, stage/unstage, history, commit, push, pull-request flow, and confirmations | Not started |
| Project runners and terminals | Detect package scripts and project runners, custom runners, live ANSI output, progress-line reconciliation, pinned output, and terminal placement | Not started |
| Subagents | Managed and external agent runs, workflow grouping, lifecycle and telemetry, output views, cancel/dismiss/clear actions, model-slot defaults, and persisted-session attachment | Not started |
| Agent conversations | Read-only views for direct Intercom and supervisor conversations, with bounded sanitized history | Not started |
| Events and diagnostics | Bounded event history, severity and type filters, compact/detailed rows, jump to transcript, session-tree navigation, notices, and health information | Transient notices with a bounded in-memory history; no Events view yet |
| Control Deck and dashboard | Project/session overview, reorganizable sections, resizable panels, files, usage, extensions, settings, events, queues, Git, and agents | Not started |
| Themes and interface | Built-in and custom themes, semantic syntax colors, density, control visibility, panel placement, durable layout, keyboard resizing, and reduced motion | Automatic light/dark palette, density (compact/comfortable), persisted display settings |
| Usage and optional companions | Provider usage, token/cost statistics, optional package discovery and setup, `/btw`, voice, remote access, release tools, and companion-provided panels | Status from already-loaded extensions can appear in grouped footer segments; discovery, setup, usage cards, and companion workflows have not started |
| Reliability and access | Session reconnection, bounded streams and files, safe path handling, update/rollback plans, keyboard navigation, screen-reader labels, touch/mobile layouts, and offline browser shell | Backend and Pi restart, bounded streams, keyboard paths, accessible names, 200% scaling smoke; no session reconnection or update flow |

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
2. The backend owns filesystem, Git, runner, session, package, and subagent-registry operations. — settings, notifications, and links done; the rest arrive with their phases
3. QML owns presentation, selection state, focus, dialogs, and short-lived view state. — done
4. Every mutating request has an operation ID, typed result, visible error, and explicit confirmation policy. — done for the current request set; link opening requires confirmation
5. Paths remain confined to the selected workspace unless the user explicitly chooses another directory. — no path operations exist yet
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
  settings.mjs      XDG settings store
  process-tree.mjs  process-group spawn and termination
  desktop.mjs       notify-send / xdg-open
qml/
  BackendBridge.qml, Theme.qml, shell.qml, SmokeDriver.qml
  components/       AppButton, StatusBadge, StatusSegment, WorkingIndicator, NoticeBar, Composer, SearchBar, EmptyState, TranscriptRow, MarkdownBlocks, ToolCard
  dialogs/          AppDialog, ExtensionDialog, LinkDialog, PickerDialog
```

Still to add with later phases: `workspace.mjs`, `files.mjs`, `git.mjs`, `runners.mjs`, `subagents.mjs`, and `qml/models/`, `qml/views/`.

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
- [ ] Add language-aware code styling and copy-code actions. — copy done; code blocks show the language label but have no syntax highlighting yet
- [x] Render thinking separately and let the user show or hide it.
- [x] Render tool calls as lifecycle cards with safe argument summaries, status, duration, and errors.
- [x] Keep fast token streaming without rebuilding the whole transcript per delta. (per-row `setProperty`, 80 ms render cadence)
- [x] Add normal and compact transcript modes.
- [x] Add transcript search with next, previous, match count, and visible highlighting. — whole-row highlighting; no inline match highlighting
- [x] Add message and selection copy actions. — message copy, code-block copy, tool-output copy, and text selection inside code and tool output
- [x] Preserve scroll position when reading history; auto-follow only when already near the bottom.
- [ ] Add a useful empty state with a resume action. — keyboard guidance and restart are implemented; the header already shows workspace and model; resume arrives with phase 3
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
- [ ] Add a visible live queue with remove, reorder, and restore-to-composer actions. — queue is displayed read-only
- [ ] Add saved prompt sequences with create, rename, load, reorder, delete, and run actions distinct from the live queue.
- [ ] Preserve a draft per session.
- [ ] Add file selection through the desktop portal or native Qt dialog.
- [ ] Support pasted files and images with size/type validation.
- [ ] Show attachment chips with preview, edit for text, and remove actions.
- [ ] Add `/` command completion and keyboard navigation.
- [ ] Add `@` workspace-path completion.
- [ ] Add `!` user-shell support only after a visible safety design and exact argument-handling contract are approved.
- [ ] Show active skill tags and open the selected skill file.
- [ ] Show todo goal, progress, checklist, and current item.
- [x] Add compact/context controls without crowding the primary prompt path. — a header action runs bounded manual compaction while idle; automatic compaction and retry events remain visible as notices

Acceptance gate:

- [ ] Attachments never escape configured size, type, or workspace rules.
- [ ] Suggestions expose stable accessible selection and never send on accidental completion acceptance.
- [ ] Queued, steering, follow-up, and saved-sequence messages retain their distinct Pi semantics. — steering and follow-up are verified; saved sequences have not started
- [ ] Saved sequences persist safely, validate every entry, and never run from a destructive list action.

### Phase 3: sessions and workspaces

- [ ] Add a tab model with one isolated Pi session per tab.
- [ ] Group tabs by working directory without hiding the active session.
- [ ] Add new, close, close-all, rename, duplicate/split, and reorder actions.
- [ ] Warn before closing a busy session and explain what is terminated.
- [ ] List and resume persisted Pi sessions.
- [ ] Add automatic titles and optional session summaries.
- [ ] Add a working-directory picker with direct path entry, recent and pinned folders, search, Back, Up, Home, and create-folder actions.
- [ ] Allow a tab to change directory only through a confirmed lifecycle transition.
- [ ] Create branch worktrees through a backend contract with path-aware confirmation, rollback on partial failure, and tests for spaces, detached HEAD, conflicts, no remotes, and nested worktrees; open successful worktrees in new tabs.
- [ ] Restore open tabs, directories, names, and drafts after a normal Qt WebUI restart.
- [ ] Represent interrupted requests honestly after process or machine failure.

Acceptance gate:

- [ ] Tabs cannot leak transcript, model, queue, tool, or workspace state into one another.
- [ ] Restart recovery reconnects or restores only sessions backed by authoritative state.
- [ ] Closing or restoring a tab cannot orphan backend processes.
- [ ] Worktree failures leave the original repository unchanged or report every residual path and recovery action.

### Phase 4: models, thinking, tools, skills, and command palette — partially done

- [x] Add searchable model selection using Pi's reported provider/model inventory.
- [x] Add supported thinking-effort selection.
- [ ] Add capability-gated sampling controls for temperature, top-p, frequency and presence penalties, seed, top-k, and min-p.
- [ ] Preserve unsupported sampling values without applying or discarding them, and fail closed when capability discovery is stale or unavailable.
- [ ] Add model cycling and clear current/effective-model labels. — cycling and the current model label are done; effective-model and scoped-state labels are not
- [ ] Add session, global, and exact-model tool profiles.
- [ ] Add session, global, and exact-model skill profiles.
- [ ] Preserve the inheritance order and distinguish inherited defaults from an intentionally empty selection.
- [ ] Add a keyboard-first command palette for actions, tabs, models, sessions, and Pi commands.
- [ ] Add grouped results, stable ranking, recent actions, shortcuts, and invalidation when capabilities change.
- [ ] Add model-slot defaults for built-in subagent roles only when the launch path can enforce them safely.
- [ ] Expose optional provider controls, such as Codex Fast mode, only when the matching capability is installed and active.

Acceptance gate:

- [ ] A model change refreshes dependent thinking, sampling, tool, and skill state without stale UI. — the backend refreshes and tests the thinking level after a model change; sampling, tool, and skill state do not exist yet
- [ ] Sampling tests cover each supported parameter, unsupported-value preservation, capability loss, reset, validation, and exact request serialization.
- [ ] Profile edits show their scope and whether a Pi session reload is required.
- [ ] Every palette action remains reachable without a pointer.

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
- [ ] Add an Events view with severity/type filters, retention bounds, repeat grouping, copy, clear, and jump-to-message. — the bridge already keeps a bounded notice model (20 entries) to build on
- [ ] Add queue, todo, workflow, and gate status views.
- [ ] Add an advanced diagnostics view for process IDs, session IDs, paths, protocol health, and recent errors. — `hello` already reports backend pid, queue stats, and drop counts

Acceptance gate:

- [ ] Restart reconstruction never labels stale metadata as a running process.
- [ ] Conversation views exclude tool arguments/results, reasoning, attachments, and private session records.
- [ ] Unsupported controls are hidden rather than presented as no-op buttons.

### Phase 8: dashboard, settings, themes, usage, and companions

- [ ] Add one compact dashboard for project, session, model, context, Git, queue, and active agents.
- [ ] Use one canonical state selector for each repeated status value.
- [ ] Add resizable and collapsible desktop panels with durable sizes and placement.
- [x] Add comfortable and compact density settings.
- [ ] Expand the semantic theme token set for transcript, syntax, diff, status, focus, warning, and destructive states. — transcript, code, status, focus, warning, and destructive tokens exist; syntax and diff tokens arrive with highlighting and Git
- [ ] Add built-in theme selection and custom-theme import only after validation and preview are available.
- [ ] Respect reduced motion, high contrast, and Qt palette changes. — Qt palette changes are respected; reduced motion and high contrast are not
- [ ] Add provider usage cards when Pi or a companion exposes supported usage data.
- [ ] Add optional companion discovery with clear installed, enabled, loaded, update, and reload-required states. — bounded status from already-loaded extensions is rendered; discovery and lifecycle state are not
- [ ] Open companion setup through typed capability contracts rather than package-specific QML conditionals.
- [ ] Add `/btw`, voice, statistics, release, or remote-access companions only as separate, capability-gated workstreams.

Acceptance gate:

- [ ] Layout and theme settings survive restart without hiding essential recovery controls. — display settings survive restart; no layout settings yet
- [ ] A missing or broken companion cannot block core chat startup.
- [ ] Light, dark, high-contrast, and reduced-motion smoke checks pass. — light and dark only

### Phase 9: hardening and release parity

- [ ] Audit and extend the per-phase QML interaction tests for focus, dialogs, tabs, menus, tree navigation, composer modes, and destructive actions.
- [ ] Add backend tests for every read and mutation boundary. — every current boundary is tested; extend with each phase
- [ ] Add long-session, many-tab, large-tree, slow-consumer, and process-crash stress tests. — slow-consumer and process-crash exist
- [ ] Profile QML object count, transcript update cost, backend memory, and startup time before optimizing.
- [ ] Audit and tune the retention limits already defined by each phase for transcripts, events, runner output, diffs, thumbnails, and agent output.
- [ ] Add structured logging with secret and prompt-content redaction.
- [ ] Audit every shipped view for missing accessibility names, roles, focus order, shortcuts, announcements, and scale behavior; fix gaps before broad parity. — current buttons expose accessible names, focus rings, and checked state for active toggles; the broad audit remains open
- [ ] Verify behavior under 200% scaling and common fractional Wayland scale factors. — 200% is verified in the smoke suite; fractional factors are not
- [ ] Verify packaging from a clean npm install with Quickshell 0.3 and the newest supported release. — packed-install test covers the npm side; only Quickshell 0.3.1 is available locally
- [ ] Update `README.md`, `TECHNICAL.md`, and `DEVELOPMENT.md` in the same change as each user-visible tranche. — the current user docs still omit the new model, thinking, cycling, and compaction controls, and `TECHNICAL.md` still says model selection is unavailable

Acceptance gate:

- [ ] `npm test` and `npm run check` pass from a clean checkout. — current worktree result is 77/79; both live smokes time out after opening the model picker
- [ ] The live smoke suite covers startup, prompt, stream, tool, abort, restart, model and thinking changes, compaction, session restore, and one representative file/Git flow. — the new model-picker path currently blocks both smokes; session restore and file/Git flows arrive with phases 3, 5, and 6
- [x] Known parity gaps remain listed explicitly rather than implied complete.

## Suggested release slices

### Desktop chat MVP — implemented for 0.2.0

Phases 0 and 1, plus the safe parts of phase 2 (run modes, read-only queue, and manual compaction), provide the daily chat client. The first phase 4 controls add model and thinking selection and cycling. Attachments remain open, and the expanded smoke must pass before this newer tranche is release-ready.

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
- Rich Markdown, code, diff, ANSI, and image rendering can become injection or resource-exhaustion paths. Markdown is covered; diffs, ANSI, and images must follow the same escaped, bounded, whitelisted approach.
- Multi-session process ownership is the first large lifecycle jump. One-session ownership is built and tested; phase 3 must generalize it before adding broad panel state.
- Optional companions change capabilities at runtime. The Qt UI needs discovery contracts, not hardcoded assumptions.
- The expanded smoke reaches the model picker but does not complete selection. Until that path passes at normal and 200% scale, the model, thinking, and compaction tranche is implemented but not release-verified.

## Confidence

Confidence: 96/100 for the feature inventory and 94/100 for the implementation mapping. The backend and static QML evidence is strong, but release confidence is lower because both live smokes currently stop after opening the model picker.
