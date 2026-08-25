# Pi WebUI feature map and Qt WebUI implementation checklist

Status: planned

This plan maps the main user-facing capabilities in `@firstpick/pi-package-webui` 0.9.9 to `@firstpick/pi-package-qt-webui` 0.1.0. It is a product-parity guide, not a requirement to copy the browser interface or its implementation.

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
- `../../qml/PiBridge.qml`
- `../../qml/components/Composer.qml`
- `../../qml/components/ChatMessage.qml`
- `../../tests/`

## Current Qt baseline

Qt WebUI already has a useful thin-client foundation:

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

The current client is intentionally small. It does not yet retain full session history, render Markdown, expose tool details, handle extension dialogs, or provide workspace features.

## Main Pi WebUI features

| Feature family | Main behavior in Pi WebUI | Qt status |
| --- | --- | --- |
| Sessions and workspaces | Multiple isolated tabs, grouped working directories, resume, rename, summaries, per-tab drafts, split terminals, directory switching, branch worktrees, and restart continuity | Not started |
| Conversation transcript | Streaming Markdown, fenced-code highlighting, diagrams, thinking sections, rich tool cards, grouped tool activity, compact output, copy and search | Basic plain text only |
| Composer and context | Multiline prompts, file and image attachments, clipboard paste, editable text attachments, slash commands, `@` paths, `!` user shell, tracked-skill tags, and conversation tags | Basic prompt and send only |
| Run control and queues | Send, abort, steer, follow-up, queued prompts, saved prompt sequences, todo progress, workflow state, and context compaction | Abort only |
| Models and thinking | Model picker, thinking-effort picker, scoped model ordering, model cycling, model-specific defaults, capability-gated sampling parameters, and optional Codex Fast mode | Current values are read-only |
| Tools, skills, commands, and extension UI | Session/global/model tool and skill profiles, command palette, command suggestions, resource inheritance, and typed select/confirm/input/editor requests from extensions | Extension UI requests are cancelled |
| Files | Searchable tree, Git ignored-state hints, text editing, Markdown preview, image preview, file search, create/rename/move/delete, and open in the default editor | Not started |
| Git and worktrees | Repository status, branch switching and creation, worktrees, staged/unstaged/untracked views, diffs, stage/unstage, history, commit, push, pull-request flow, and confirmations | Not started |
| Project runners and terminals | Detect package scripts and project runners, custom runners, live ANSI output, progress-line reconciliation, pinned output, and terminal placement | Not started |
| Subagents | Managed and external agent runs, workflow grouping, lifecycle and telemetry, output views, cancel/dismiss/clear actions, model-slot defaults, and persisted-session attachment | Not started |
| Agent conversations | Read-only views for direct Intercom and supervisor conversations, with bounded sanitized history | Not started |
| Events and diagnostics | Bounded event history, severity and type filters, compact/detailed rows, jump to transcript, session-tree navigation, notices, and health information | One visible error panel only |
| Control Deck and dashboard | Project/session overview, reorganizable sections, resizable panels, files, usage, extensions, settings, events, queues, Git, and agents | Not started |
| Themes and interface | Built-in and custom themes, semantic syntax colors, density, control visibility, panel placement, durable layout, keyboard resizing, and reduced motion | Automatic light/dark palette only |
| Usage and optional companions | Provider usage, token/cost statistics, optional package discovery and setup, `/btw`, voice, remote access, release tools, and companion-provided panels | Not started |
| Reliability and access | Session reconnection, bounded streams and files, safe path handling, update/rollback plans, keyboard navigation, screen-reader labels, touch/mobile layouts, and offline browser shell | Partial process recovery only |

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

Do not grow `PiBridge.qml` into a large mix of protocol parsing, Git commands, filesystem mutation, package management, and UI state.

Use a package-local Node backend process with a versioned JSON-lines protocol:

1. The backend owns the Pi RPC child and translates raw Pi records into bounded, typed events.
2. The backend owns filesystem, Git, runner, session, package, and subagent-registry operations.
3. QML owns presentation, selection state, focus, dialogs, and short-lived view state.
4. Every mutating request has an operation ID, typed result, visible error, and explicit confirmation policy.
5. Paths remain confined to the selected workspace unless the user explicitly chooses another directory.
6. No command, path, or prompt is interpolated into shell text. Use argument arrays and `shell: false`.
7. The backend owns a process group or equivalent process-tree cleanup strategy. It must reap Pi, Git, runner, and helper children after normal close, EOF, launcher signals, startup failure, backend crash, or forced termination.

Suggested modules:

```text
lib/backend/
  main.mjs
  protocol.mjs
  pi-session.mjs
  workspace.mjs
  files.mjs
  git.mjs
  runners.mjs
  subagents.mjs
  settings.mjs
qml/
  bridges/
  models/
  views/
  components/
  dialogs/
```

Share focused, UI-independent logic with Pi WebUI where practical. Do not import its browser application or duplicate the 30,000-line frontend.

## Rules for every phase

A phase is not ready to implement until its limits and accessibility contract are written next to the affected protocol and tests.

- [ ] Define numeric byte, record, queue, timing, and retention limits for each new data path before implementation.
- [ ] Preserve the current 80-row transcript, 8,192-character message, and 512-character visible-error limits until a tested replacement budget is approved.
- [ ] Add boundary fixtures at the limit and one unit over it, plus truncation, rejection, cleanup, and recovery expectations.
- [ ] Give every new control an accessible name, role, state, focus order, keyboard path, and focus-return behavior in the same phase that adds it.
- [ ] Test the phase's primary workflow without a pointer and at 200% scaling before its release slice can ship.
- [ ] Treat untrusted Markdown, ANSI, diffs, paths, images, tool data, and process output as bounded data rather than executable markup or shell text.

## Phased implementation checklist

### Phase 0: backend and UI foundations

- [ ] Define a versioned backend request, response, and event protocol.
- [ ] Move Pi process ownership and RPC parsing from QML into the Node backend.
- [ ] Preserve current prompt, stream, abort, restart, runtime-info, and error behavior during the move.
- [ ] Add QML bridge models for sessions, messages, tools, queues, files, Git, runners, and agents.
- [ ] Add request correlation, explicit per-operation timeouts, cancellation, stale-response rejection, and byte-and-record-bounded event queues.
- [ ] Define the first protocol budget, including the maximum JSON-lines frame, queued records, queued bytes, request duration, and shutdown grace period.
- [ ] Add one reusable application dialog with initial focus, focus containment, Escape handling, validation, and focus return.
- [ ] Add reusable buttons, list rows, status badges, split panes, empty states, notices, and loading states.
- [ ] Add settings storage under the normal XDG config/state locations with private permissions.
- [ ] Add protocol contract tests and a fake backend for deterministic QML tests.
- [ ] Add lifecycle handling for stdin EOF, normal window close, `SIGINT`, `SIGTERM`, startup failure, backend crash, bounded graceful shutdown, forced process-tree cleanup, and child reaping.
- [ ] Keep the current live Quickshell smoke test as a release gate.

Acceptance gate:

- [ ] Existing 0.1.0 behavior passes unchanged through the new backend boundary.
- [ ] Protocol tests exercise each recorded numeric limit, one-over-limit rejection, delayed/duplicate/out-of-order records, queue overflow, and cleanup.
- [ ] Normal close and abrupt backend or Quickshell death terminate and reap the backend, Pi, and every child process within the recorded shutdown bound.

### Phase 1: useful daily chat

- [ ] Store complete bounded message parts instead of flattening every assistant message to text.
- [ ] Render Markdown headings, lists, links, quotes, tables, and fenced code under an explicit untrusted-content policy.
- [ ] Disable raw HTML and automatic resource fetching, allow only approved URL schemes, bound parse depth/input/rendered objects, and open external links only after deliberate user activation.
- [ ] Add language-aware code styling and copy-code actions.
- [ ] Render thinking separately and let the user show or hide it.
- [ ] Render tool calls as lifecycle cards with safe argument summaries, status, duration, and errors.
- [ ] Keep fast token streaming without rebuilding the whole transcript per delta.
- [ ] Add normal and compact transcript modes.
- [ ] Add transcript search with next, previous, match count, and visible highlighting.
- [ ] Add message and selection copy actions.
- [ ] Preserve scroll position when reading history; auto-follow only when already near the bottom.
- [ ] Add a useful empty state with workspace, model, and resume actions.
- [ ] Implement queued extension `select`, `confirm`, `input`, and `editor` requests with exact-once typed responses, explicit cancellation, focus handling, and cleanup on close or session loss.
- [ ] Add desktop notifications for completion, failure, and queued extension questions when the window is unfocused.

Acceptance gate:

- [ ] Recorded fixtures for stream bytes, chunk count, message parts, Markdown depth, rendered objects, and update cadence stay within the phase's latency and memory budgets.
- [ ] Raw HTML, remote resources, disallowed schemes, oversized/deep Markdown, and automatic external launching are rejected or rendered inert.
- [ ] Copy and search return original text rather than styled or elided text.
- [ ] Keyboard and screen-reader users can identify message role, tool state, run completion, and extension-request state.
- [ ] Extension requests answer once, cancel cleanly, retain exact option/input values, and cannot survive their owning session.

### Phase 2: composer, attachments, commands, and run modes

- [ ] Support send, steer, follow-up, and abort as explicit composer modes.
- [ ] Add a visible live queue with remove, reorder, and restore-to-composer actions.
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
- [ ] Add compact/context controls without crowding the primary prompt path.

Acceptance gate:

- [ ] Attachments never escape configured size, type, or workspace rules.
- [ ] Suggestions expose stable accessible selection and never send on accidental completion acceptance.
- [ ] Queued, steering, follow-up, and saved-sequence messages retain their distinct Pi semantics.
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

### Phase 4: models, thinking, tools, skills, and command palette

- [ ] Add searchable model selection using Pi's reported provider/model inventory.
- [ ] Add supported thinking-effort selection.
- [ ] Add capability-gated sampling controls for temperature, top-p, frequency and presence penalties, seed, top-k, and min-p.
- [ ] Preserve unsupported sampling values without applying or discarding them, and fail closed when capability discovery is stale or unavailable.
- [ ] Add model cycling and clear current/effective-model labels.
- [ ] Add session, global, and exact-model tool profiles.
- [ ] Add session, global, and exact-model skill profiles.
- [ ] Preserve the inheritance order and distinguish inherited defaults from an intentionally empty selection.
- [ ] Add a keyboard-first command palette for actions, tabs, models, sessions, and Pi commands.
- [ ] Add grouped results, stable ranking, recent actions, shortcuts, and invalidation when capabilities change.
- [ ] Add model-slot defaults for built-in subagent roles only when the launch path can enforce them safely.
- [ ] Expose optional provider controls, such as Codex Fast mode, only when the matching capability is installed and active.

Acceptance gate:

- [ ] A model change refreshes dependent thinking, sampling, tool, and skill state without stale UI.
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
- [ ] Add an Events view with severity/type filters, retention bounds, repeat grouping, copy, clear, and jump-to-message.
- [ ] Add queue, todo, workflow, and gate status views.
- [ ] Add an advanced diagnostics view for process IDs, session IDs, paths, protocol health, and recent errors.

Acceptance gate:

- [ ] Restart reconstruction never labels stale metadata as a running process.
- [ ] Conversation views exclude tool arguments/results, reasoning, attachments, and private session records.
- [ ] Unsupported controls are hidden rather than presented as no-op buttons.

### Phase 8: dashboard, settings, themes, usage, and companions

- [ ] Add one compact dashboard for project, session, model, context, Git, queue, and active agents.
- [ ] Use one canonical state selector for each repeated status value.
- [ ] Add resizable and collapsible desktop panels with durable sizes and placement.
- [ ] Add comfortable and compact density settings.
- [ ] Expand the semantic theme token set for transcript, syntax, diff, status, focus, warning, and destructive states.
- [ ] Add built-in theme selection and custom-theme import only after validation and preview are available.
- [ ] Respect reduced motion, high contrast, and Qt palette changes.
- [ ] Add provider usage cards when Pi or a companion exposes supported usage data.
- [ ] Add optional companion discovery with clear installed, enabled, loaded, update, and reload-required states.
- [ ] Open companion setup through typed capability contracts rather than package-specific QML conditionals.
- [ ] Add `/btw`, voice, statistics, release, or remote-access companions only as separate, capability-gated workstreams.

Acceptance gate:

- [ ] Layout and theme settings survive restart without hiding essential recovery controls.
- [ ] A missing or broken companion cannot block core chat startup.
- [ ] Light, dark, high-contrast, and reduced-motion smoke checks pass.

### Phase 9: hardening and release parity

- [ ] Audit and extend the per-phase QML interaction tests for focus, dialogs, tabs, menus, tree navigation, composer modes, and destructive actions.
- [ ] Add backend tests for every read and mutation boundary.
- [ ] Add long-session, many-tab, large-tree, slow-consumer, and process-crash stress tests.
- [ ] Profile QML object count, transcript update cost, backend memory, and startup time before optimizing.
- [ ] Audit and tune the retention limits already defined by each phase for transcripts, events, runner output, diffs, thumbnails, and agent output.
- [ ] Add structured logging with secret and prompt-content redaction.
- [ ] Audit every shipped view for missing accessibility names, roles, focus order, shortcuts, announcements, and scale behavior; fix gaps before broad parity.
- [ ] Verify behavior under 200% scaling and common fractional Wayland scale factors.
- [ ] Verify packaging from a clean npm install with Quickshell 0.3 and the newest supported release.
- [ ] Update `README.md`, `TECHNICAL.md`, and `DEVELOPMENT.md` in the same change as each user-visible tranche.

Acceptance gate:

- [ ] `npm test` and `npm run check` pass from a clean checkout.
- [ ] The live smoke suite covers startup, prompt, stream, tool, abort, restart, session restore, and one representative file/Git flow.
- [ ] Known parity gaps remain listed explicitly rather than implied complete.

## Suggested release slices

### Desktop chat MVP

Ship phases 0 and 1, plus the safe parts of phase 2, after their numeric-bound and accessibility gates pass. This creates a credible daily chat client with rich output, tool visibility, search, attachments, and desktop notifications.

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
- Direct Pi RPC does not provide every file, Git, package, session, and subagent service needed for parity. The backend boundary must be designed before adding many views.
- Rich Markdown, code, diff, ANSI, and image rendering can become injection or resource-exhaustion paths. Treat all agent and process output as untrusted data.
- Multi-session process ownership is the first large lifecycle jump. Build and test it before adding broad panel state.
- Optional companions change capabilities at runtime. The Qt UI needs discovery contracts, not hardcoded assumptions.

## Confidence

Confidence: 94/100. The feature list is grounded in the current package documentation, frontend files, backend entry points, tests, and the complete Qt QML baseline. The remaining uncertainty is mainly implementation-level: some Pi WebUI behavior is coupled to private browser/server helpers and will need a reusable local service contract rather than a direct QML port.
