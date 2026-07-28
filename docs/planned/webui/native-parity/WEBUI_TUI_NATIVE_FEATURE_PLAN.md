# Pi Web UI Native TUI Feature Parity Plan

Date: 2026-06-04

## Goal

Make Pi Web UI feel like a browser-native version of Pi's interactive TUI. New work should prioritize native TUI parity before adding Web-only workflows.

Success means a user can move between terminal Pi and Pi Web UI without losing core commands, shortcuts, session controls, queue behavior, extension UI affordances, or safety semantics.

## Sources reviewed

- Pi interactive/TUI feature docs: `/home/firstpick/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/README.md`
- Pi TUI component docs: `/home/firstpick/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Pi keybinding docs: `/home/firstpick/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md`
- Pi RPC docs and RPC limitations: `/home/firstpick/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
- Pi settings/session/extension docs: `docs/settings.md`, `docs/session-format.md`, `docs/extensions.md` under the same package
- Current Web UI implementation: `bin/pi-webui.mjs`, `public/app.js`, `public/index.html`, `public/styles.css`, `tests/mobile-static.test.mjs`, `README.md`

## Priority rubric

| Priority | Meaning | Release stance |
|---|---|---|
| P0 | Foundation or safety prerequisite for multiple native features | Do first; blocks reliable parity work |
| P1 | High-frequency native TUI feature missing or only partially implemented | Ship before Web-only enhancements |
| P2 | Power-user/native polish feature; important but not blocking daily Web UI use | Ship after P1 core parity |
| P3 | Nice-to-have or Web-specific enhancement | Only after native parity backlog is healthy |

## Current parity snapshot

### Strong coverage today

- RPC chat, streaming assistant text, streamed thinking display, tool/bash-like action cards, queue/compaction events, and active-run indicators.
- Isolated browser terminal tabs backed by separate `pi --mode rpc` subprocesses.
- Prompt, steer, follow-up, abort, new session, manual compact, model, and thinking controls.
- File attachments through picker, drag/drop, paste, and inline RPC image support for supported image types.
- Slash-command autocomplete and `@` path suggestions from the active tab cwd.
- Browser-native dialogs for many native commands: `/model`, `/settings`, `/theme`, `/fork`, `/clone`, `/resume`, `/tree`; `/login` and `/logout` are safe guidance only.
- Native parity foundation: `WEBUI_TUI_NATIVE_PARITY.json`, `GET /api/native-parity`, matrix-derived command discovery, structured native-command responses, and `tests/native-parity.test.mjs`.
- Initial `/export` parity: no-path HTML browser download via short-lived opaque token, plus explicit new `.html`/`.jsonl` server-side writes.
- Initial `!`/`!!` bash parity: composer interception, include/exclude context flags, transient bash cards, active bash abort, and one-active-per-tab FIFO queuing.
- Core browser-safe native shortcut defaults: `Ctrl/Cmd+L`, `Ctrl/Cmd+P`, `Shift+Ctrl/Cmd+P`, `Shift+Tab`, `Ctrl/Cmd+T`, `Ctrl/Cmd+O`, `Alt+Enter`, degraded `Alt+Up`, and guarded `Ctrl/Cmd+C` prompt clear.
- Extension UI RPC bridge for `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`, `select`, `confirm`, `input`, and `editor`.
- Side panel, optional companion package state, themes/custom backgrounds, footer telemetry, mobile/PWA shell, and browser notifications.

### Partial native coverage

- `/settings` covers key runtime controls, but not the full native settings surface.
- `/export` works for no-path downloads and new explicit paths, but overwrite confirmation UI and full trusted-context policy are still pending.
- `!`/`!!` bash works for active/queued commands, but per-item queued cancellation and runtime LAN shell warnings are still pending.
- Core shortcuts are implemented as browser-safe defaults, but full action-ID/user keybinding integration and double-Escape action are still pending.
- `Alt+Up` restores the latest observed queue snapshot to the composer, but cannot clear Pi's RPC queue or restore attachments until upstream RPC exposes that state/control.
- `/tree` supports session-tree navigation but not full TUI parity for filters, folding, label editing, and label timestamp toggles.
- `/resume` supports session picking, but not full TUI parity for delete, rename, sort, path display, and named-only filters.
- `/scoped-models` currently points to the footer picker instead of providing a full enabled-model editor.
- `/hotkeys` returns Web UI-specific help, not the configured native keybinding table.
- Browser theme selection works, but native TUI theme switching through Pi's own theme API is degraded in RPC mode.

### Missing or intentionally degraded native coverage

- Native commands: `/import`, `/share`, `/changelog`, and `/quit`.
- Full browser auth for `/login` and `/logout`.
- Native external editor flow (`Ctrl+G` / `$VISUAL` or `$EDITOR`).
- Startup header/resource overview showing loaded context files, prompts, skills, extensions, and shortcuts.
- TUI-only extension UI APIs in RPC mode: `ctx.ui.custom()`, overlays, `setWorkingMessage()`, `setWorkingVisible()`, `setWorkingIndicator()`, `setFooter()`, `setHeader()`, `setEditorComponent()`, `addAutocompleteProvider()`, `setToolsExpanded()`, and `getEditorText()`.

## Key architectural constraint

Pi RPC mode intentionally does not expose all TUI internals. Per `docs/rpc.md`, built-in interactive commands are not included in `get_commands`, and several TUI-specific extension APIs are no-ops or degraded in RPC mode.

Therefore Web UI parity must use two tracks:

1. **Implement browser-native equivalents** for built-in TUI commands and controls using existing RPC commands, session files, AuthStorage, and server-side helpers.
2. **Add or request upstream RPC protocol support** for features that cannot be faithfully implemented from current RPC events, especially arbitrary `ctx.ui.custom()` components and extension-provided custom editor/footer/header/autocomplete behavior.

## Priority list

### P0 — Parity foundation and safety

1. **Create a native feature parity matrix and keep it tested**
   - Status: implemented initial matrix in `WEBUI_TUI_NATIVE_PARITY.json`; enforced by `tests/native-parity.test.mjs` and static checks.
   - Track each TUI command, shortcut, editor feature, session action, and extension UI method.
   - Add test assertions so newly implemented parity is not accidentally removed.
   - Output: `docs`/plan table plus static tests in `tests/mobile-static.test.mjs` or a new targeted test file.

2. **Build a consistent native-command adapter layer**
   - Status: implemented initial server-authoritative adapter with structured success/unavailable responses, native downloads, clipboard text, and matrix-derived command metadata.
   - Centralize Web UI handling for native commands rather than scattering logic across `public/app.js` and `bin/pi-webui.mjs`.
   - Define a common response shape for native command results: transcript message, toast/event, tab metadata updates, downloads, clipboard text, warnings, and follow-up refresh hints.
   - Files: `bin/pi-webui.mjs`, `public/app.js`.

3. **Define the Web UI security model for sensitive native features**
   - Status: initial guard taxonomy and localhost/trusted-context rules are encoded in the parity matrix and README; per-feature confirmation UIs remain ongoing.
   - `/login`, `/logout`, `/share`, `/import`, `/export`, `/quit`, optional installs, and network exposure need explicit trust boundaries.
   - Preserve the current no-auth warning and localhost-only protections for sensitive operations.
   - Do not accept raw API keys in the browser until a dedicated secret-handling design exists.

4. **Add a small integration-test harness for tab-scoped RPC actions**
   - Status: static/native parity harness is in place; true HTTP/RPC integration tests are still pending.
   - Static tests are useful, but native parity needs request/response tests for server endpoints.
   - Start with pure server helper tests where possible, then add lightweight local server tests if practical.

### P1 — Core native TUI parity

1. **Implement `!command` and `!!command` user bash parity**
   - Status: initial parity implemented; remaining gaps are per-item queued cancellation, confirmation/warning polish, and runtime LAN shell warning UI.
   - Native behavior:
     - `!cmd` runs shell command and includes output in the next LLM context.
     - `!!cmd` runs shell command without sending output to the LLM context.
     - Bash should be abortable.
   - Implemented:
     - Detect leading `!`/`!!` in composer before normal prompt send.
     - Add server endpoint backed by RPC `bash` and `abort_bash`.
     - Render `bashExecution` transcript cards and preserve include/exclude-from-context metadata.
     - Add active bash state and abort affordance distinct from agent abort.
     - Serialize bash through one-active-per-tab FIFO queue on server and frontend.
   - Files: `public/app.js`, `bin/pi-webui.mjs`, `public/styles.css`, tests.
   - Acceptance:
     - `!pwd` creates a bash execution card and output affects the next prompt.
     - `!!pwd` creates a card but is excluded from LLM context.
     - Long-running bash can be aborted.
     - Additional bash submissions queue behind the active command.

2. **Implement `/export`**
   - Status: initial parity implemented; remaining gap is overwrite confirmation/trusted-context UI for explicit paths.
   - Native behavior: export current session, HTML by default, optional path/format.
   - Implemented:
     - Use RPC `export_html` for HTML export.
     - For explicit `.jsonl`, copy or expose the current session file through a safe localhost-only download endpoint.
     - Add browser download and transcript-visible result.
   - Files: `bin/pi-webui.mjs`, `public/app.js`.
   - Acceptance:
     - `/export` downloads or links an HTML export.
     - `/export /tmp/foo.html` writes server-side path and reports it when the target is new.
     - Errors are shown as native command cards.

3. **Expand `/settings` to native parity**
   - Native settings to cover:
     - model/thinking defaults where appropriate;
     - hide thinking output;
     - steering/follow-up mode;
     - transport selection;
     - auto-compaction;
     - auto-retry and retry provider caps where available;
     - double-Escape action;
     - tree filter default;
     - editor padding/autocomplete size;
     - image handling preferences;
     - session directory visibility;
     - shell/npm command info as read-only or explicitly editable if safe.
   - Plan:
     - Add `/api/settings` read/write helpers that merge global/project settings safely.
     - Separate session-runtime changes from persistent settings writes.
     - Keep advanced settings behind an "Advanced" section.
   - Files: `bin/pi-webui.mjs`, `public/app.js`, `public/styles.css`.
   - Acceptance:
     - Web `/settings` can configure the high-frequency native settings without manual JSON edits.
     - Changes either apply immediately or clearly say `/reload`/restart is needed.

4. **Implement full `/scoped-models` editor and model cycling**
   - Status: model cycling shortcut/server helper is implemented; full visual editor/persistence remains pending.
   - Native behavior:
     - `Ctrl+P` cycles forward through enabled/scoped models.
     - `Shift+Ctrl+P` cycles backward.
     - `/scoped-models` enables/disables models, toggles providers, reorders cycle order, saves with `Ctrl+S`.
   - Current gap: footer picker shows scoped models but `/scoped-models` is informational.
   - Plan:
     - Build a browser editor for `enabledModels` patterns.
     - Add enable-all, clear-all, provider toggle, search, reorder, and save actions.
     - Add keyboard shortcuts for cycle forward/backward and an endpoint for RPC `cycle_model` if available.
   - Files: `bin/pi-webui.mjs`, `public/app.js`, `public/styles.css`.
   - Acceptance:
     - User can edit and persist model cycle scope from Web UI.
     - `Ctrl+P` / `Shift+Ctrl+P` change models when focus is not in a conflicting input.

5. **Complete native keyboard shortcut parity**
   - Status: core browser-safe defaults implemented; action-ID/user keybinding config, double-Escape action, and exact queue clearing remain pending.
   - High-value shortcuts:
     - `Ctrl+L`: model selector. **Implemented as `Ctrl/Cmd+L`.**
     - `Ctrl+P` / `Shift+Ctrl+P`: cycle scoped models. **Implemented as `Ctrl/Cmd+P` and `Shift+Ctrl/Cmd+P`.**
     - `Shift+Tab`: cycle thinking level. **Implemented.**
     - `Ctrl+T`: collapse/expand thinking blocks. **Implemented as browser thinking visibility toggle.**
     - `Ctrl+O`: collapse/expand tool output globally. **Implemented.**
     - `Alt+Enter`: follow-up queue. **Implemented.**
     - `Alt+Up`: restore queued messages to editor. **Degraded: restores observed text snapshot only.**
     - `Escape`: abort/cancel; double Escape opens configured action (`tree`, `fork`, or none). **Single Escape implemented; double Escape pending.**
     - `Ctrl+C`: clear editor; double Ctrl+C should be carefully mapped because browser semantics differ. **Guarded clear implemented; double Ctrl+C intentionally not mapped.**
   - Plan:
     - Introduce a Web UI keybinding manager with context-aware guards for text inputs, dialogs, mobile, and browser-reserved shortcuts.
     - Read user keybindings if feasible; otherwise document browser-safe defaults and expose overrides later.
   - Acceptance:
     - Shortcuts work in the browser without breaking normal text editing.
     - Browser-reserved conflicts are documented.

6. **Bring `/tree` closer to native parity**
   - Native behavior:
     - Search by typing.
     - Fold/unfold branch segments.
     - Filter modes: default, no-tools, user-only, labeled-only, all.
     - Label entries with `Shift+L` and toggle label timestamps with `Shift+T`.
     - Optional branch summary before navigation.
   - Current gap: Web UI can navigate tree with summary/label inputs but lacks the full navigator model.
   - Plan:
     - Enrich `/api/session-tree` with node type, labels, child counts, active path, timestamps, and filter support.
     - Add fold state, filter controls, label edit/clear actions, and keyboard parity in the browser tree dialog.
     - Use the existing internal `webui-tree-navigate` helper for final navigation.
   - Acceptance:
     - User can find, filter, label, and navigate branches with behavior matching TUI semantics.

7. **Bring `/resume` closer to native parity**
   - Native behavior:
     - Browse current-cwd or all sessions.
     - Toggle path display, sort mode, named-only filter.
     - Rename session.
     - Delete session with trash/noninvasive safeguards.
   - Current gap: Web UI lists and switches sessions but lacks rename/delete/filter parity.
   - Plan:
     - Extend `/api/sessions` with sorting/filter metadata and safe delete/rename endpoints.
     - Prefer trash for deletes when available; require confirmation and localhost-only server handling.
     - Make delete unavailable for the active session unless switching first.
   - Acceptance:
     - Web resume selector supports current/all scope, search, sort, path visibility, named filter, rename, and safe delete.

8. **Implement safe `/login` and `/logout` browser flows**
   - Native behavior: OAuth/login provider selection and logout/removal.
   - Current gap: Web UI intentionally shows guidance only.
   - Plan:
     - Keep raw API-key entry out of scope initially.
     - Implement OAuth providers through server-side `AuthStorage` and provider registry where possible.
     - Browser should open provider auth URL or display device/login code; server stores tokens.
     - `/logout` should show configured providers and clear selected provider credentials only after confirmation.
   - Acceptance:
     - OAuth subscription providers can be refreshed from Web UI without pasting secrets into the browser.
     - API-key providers still show safe non-secret guidance unless a reviewed secret UX is added.

### P2 — Power-user native parity

1. **Implement `/import`**
   - Support importing a JSONL session file through upload or server path.
   - Validate session file header/version before switching.
   - Record a native command transcript card and refresh the active tab.

2. **Implement `/share`**
   - Native behavior: share session as a secret GitHub gist with HTML link.
   - Needs a careful auth and privacy prompt.
   - Plan:
     - Prefer reusing native Pi share internals if exposed; otherwise export HTML and call a server-side GitHub/Gist helper.
     - Always show exactly what will be uploaded and require explicit confirmation.
   - Acceptance:
     - No accidental public uploads.
     - Secret gist URL is shown only after success.

3. **Implement `/changelog`**
   - Show Pi changelog entries in a native command dialog/card.
   - Prefer the same data source native Pi uses.
   - Add filtering for current/newer versions if available.

4. **Implement `/quit` semantics**
   - Decide whether Web `/quit` stops only the active tab's Pi RPC process or the entire Web UI server.
   - Suggested behavior:
     - `/quit` in a tab stops that tab after confirmation if work is active.
     - Add separate explicit "Shutdown Web UI server" action for server shutdown.
   - Acceptance:
     - Behavior is not surprising and does not accidentally kill all tabs.

5. **Native `/hotkeys` parity with configured keybindings**
   - Current `/hotkeys` is Web UI specific.
   - Plan:
     - Add an endpoint to return native keybinding IDs, defaults, and user overrides.
     - Render grouped sections from `docs/keybindings.md` semantics.
     - Include browser/Web UI overrides and conflicts.

6. **Tool expansion parity**
   - Status: implemented initial global browser-local toggle via `Ctrl/Cmd+O`; hint polish remains optional.
   - Native `Ctrl+O` toggles tool output expansion.
   - Implemented:
     - Maintain a global tool expansion state and apply it to existing/new tool cards.
     - Persist per-browser preference.
   - Remaining:
     - Show richer keybinding hints on collapsed cards.

7. **Queue retrieval parity**
   - Status: degraded implementation via `Alt+Up`; exact native parity needs upstream RPC queue clear/attachment access.
   - Native `Alt+Up` restores queued messages to the editor.
   - Implemented:
     - Track queue contents from `queue_update` events.
     - Add restore-to-editor action for steering/follow-up queue text.
   - Remaining:
     - Clear the upstream RPC queue after restore.
     - Preserve images/attachments where possible, or warn when not restorable.

8. **Startup header/resource inspector**
   - Native TUI startup header shows shortcuts, loaded context files, prompts, skills, and extensions.
   - Plan:
     - Add a side-panel section or `/resources` native dialog showing loaded resources.
     - Use RPC/extension data where available; otherwise read safe startup metadata from server process.

9. **External editor parity**
   - Native `Ctrl+G` opens `$VISUAL`/`$EDITOR`.
   - Browser plan:
     - Server creates a temp draft file and opens configured editor on localhost only.
     - Browser polls or receives completion and loads edited text into composer.
     - This must be opt-in and clearly local-machine only.

### P2/P3 — Extension TUI parity track

These features are important but constrained by current RPC limitations.

1. **Working message/indicator bridge**
   - TUI APIs: `setWorkingMessage()`, `setWorkingVisible()`, `setWorkingIndicator()`.
   - RPC status: currently no-op/degraded.
   - Plan:
     - Propose upstream RPC `extension_ui_request` methods for working message/visibility/indicator.
     - Until then, support Web UI-specific extension events only for first-party companions if needed.

2. **Custom header/footer bridge**
   - TUI APIs: `setHeader()`, `setFooter()`.
   - RPC status: no-op.
   - Plan:
     - Add a serializable footer/header protocol: text lines plus placement/style hints.
     - Keep arbitrary terminal components out of scope until a generic component protocol exists.

3. **Custom editor bridge**
   - TUI API: `setEditorComponent()`.
   - RPC status: no-op; browser textarea cannot run terminal component logic.
   - Plan:
     - Support common modes as browser-native features first, especially modal/vim-like editor mode.
     - Explore an extension-provided browser editor plugin API only after core parity.

4. **Autocomplete provider bridge**
   - TUI API: `addAutocompleteProvider()`.
   - RPC status: no direct browser bridge.
   - Plan:
     - Add an RPC protocol for extension autocomplete suggestions and application.
     - Maintain built-in slash/path suggestions as the base provider.

5. **Arbitrary `ctx.ui.custom()` and overlays**
   - TUI API supports components, overlays, focus, keyboard input, IME cursor markers.
   - RPC status: `custom()` returns `undefined`.
   - Plan options:
     - Short term: map common dialog patterns (`select`, `confirm`, `input`, `editor`) to Web UI, which already exists.
     - Medium term: add a serializable component schema for lists, settings, loaders, markdown, forms, and logs.
     - Long term: upstream generic component event protocol if truly needed.
   - Risk: trying to emulate arbitrary terminal component rendering in the browser can become brittle; prefer semantic UI descriptions.

## Implementation phases

### Phase 0 — Baseline and tests

- [x] Create a checked-in parity matrix from this plan.
- [x] Add tests that assert every listed native command has an explicit Web UI status.
- [-] Add tests for native-command guard messages so unsupported commands fail clearly. Static coverage exists; HTTP/RPC coverage remains pending.

### Phase 1 — Native command adapter and quick wins

- [x] Add centralized command adapter in `bin/pi-webui.mjs`.
- [-] Implement `/export`. Initial no-path/new-path support is done; overwrite confirmation remains pending.
- [ ] Add `/quit` decision and minimal safe implementation.
- [x] Improve unsupported-command messaging with next-best actions.

### Phase 2 — Editor and queue parity

- [-] Implement `!`/`!!` bash commands and abort bash. Initial active/queued support is done; per-item queued cancellation and warning polish remain pending.
- [-] Implement keyboard manager for core shortcuts. Browser-safe defaults are done; action-ID/user keybinding config and double-Escape remain pending.
- [-] Add queue retrieval (`Alt+Up`) and clearer queue editing. Text snapshot restore is done; RPC queue clear/attachment restore remain pending.
- [x] Add global tool expand/collapse.

### Phase 3 — Settings and model parity

- [ ] Expand `/settings`.
- [-] Implement full `/scoped-models` editor. Model cycle shortcuts/helpers are done; full editor/persistence remains pending.
- [-] Add model/thinking cycling shortcuts and persistent visible status. Cycling shortcuts are done; status/persistence polish remains pending.

### Phase 4 — Session navigation parity

- Expand `/tree` filters, folding, labels, timestamp toggles.
- Expand `/resume` filters, sort, path toggle, rename, delete.
- Add `/import`.

### Phase 5 — Auth/share/resource parity

- Implement safe OAuth `/login` and `/logout`.
- Implement `/share` after export/auth foundation is stable.
- Add `/changelog` and startup/resource inspector.

### Phase 6 — Extension TUI bridge

- Propose or implement RPC extension UI protocol additions.
- Prioritize semantic bridge methods before arbitrary component rendering:
  1. working message/indicator;
  2. header/footer text lines;
  3. autocomplete provider;
  4. settings/list/loader component schemas;
  5. generic custom component protocol only if still needed.

## Feature cards

### `/export`

- Priority: P1
- Current state: degraded/mostly implemented. `/export` creates an HTML browser download with a short-lived token; explicit new `.html`/`.jsonl` paths write server-side. Overwrite confirmation is pending.
- Backend: RPC `export_html`; safe session file download for JSONL.
- Frontend: native command result card with automatic download and transcript-visible result.
- Tests: static/native parity coverage exists; HTTP route tests for invalid path/download metadata remain pending.

### `!` and `!!` bash

- Priority: P1
- Current state: degraded/mostly implemented. Leading `!`/`!!` composer interception, include/exclude flags, active abort, transient output cards, and one-active-per-tab FIFO queuing are in place.
- Backend: RPC `bash`, `abort_bash`; preserve include/exclude context semantics; server-side FIFO serialization.
- Frontend: composer interception, bash-running state, queued bash cards, output card, abort control.
- Tests: static/native parity coverage exists; runtime queue/abort smoke testing remains recommended.

### Full `/settings`

- Priority: P1
- Current state: partial Web UI dialog.
- Backend: add safe settings read/write helpers; expose runtime-only vs persistent fields.
- Frontend: sections: Model/Thinking, Queue, Compaction, Retry, Display, Session, Advanced.
- Tests: render controls, post endpoints, invalid values rejected.

### `/scoped-models`

- Priority: P1
- Current state: informational dialog plus footer scoped picker.
- Backend: read/write enabled model patterns; resolve providers/models.
- Frontend: searchable table, provider toggles, reorder, save/apply.
- Tests: model list, pattern save, reorder, cycle shortcuts.

### `/tree`

- Priority: P1
- Current state: partial selector.
- Backend: richer tree data, labels, filters, navigation endpoint.
- Frontend: keyboardable tree with filter/fold/label controls.
- Tests: filter modes, label edit, branch summary option.

### `/resume`

- Priority: P1
- Current state: partial selector.
- Backend: session list with sort/filter metadata, rename/delete endpoints.
- Frontend: current/all toggle, sort/path/named toggles, safe delete confirmation.
- Tests: session list, delete guard, rename, switch.

### `/login` and `/logout`

- Priority: P1/P2 depending on provider.
- Current state: guidance only.
- Backend: AuthStorage/provider OAuth flow, no browser-stored secrets.
- Frontend: provider picker, browser/device login, logout confirmation.
- Tests: provider list, auth URL/status flow, logout clears selected provider.

### `/share`

- Priority: P2
- Current state: missing.
- Dependencies: `/export`, auth/privacy confirmation.
- Backend: native share implementation or GitHub gist helper.
- Frontend: upload preview, confirmation, secret URL result.
- Tests: dry-run helper where possible, privacy confirmation required.

### `/import`

- Priority: P2
- Current state: missing.
- Backend: upload/path validation, SessionManager open/switch.
- Frontend: file picker or path input, validation warnings, switch result.
- Tests: valid/invalid JSONL, version handling, switch cancellation.

### `/changelog`

- Priority: P2
- Current state: missing.
- Backend: source same changelog data as native Pi.
- Frontend: searchable/version-grouped dialog or transcript card.
- Tests: renders current version and handles missing changelog.

### `/quit`

- Priority: P2
- Current state: missing/ambiguous.
- Decision needed: active tab quit vs whole server shutdown.
- Recommended: `/quit` closes/stops active Pi tab; separate server shutdown action remains explicit.
- Tests: cannot accidentally close last tab without replacement; warns on active work.

## Testing strategy

- Keep `npm run check` as the minimum gate.
- Add server route tests for new endpoints where possible.
- Add frontend static assertions for every visible control and feature guard.
- Add fixture-driven tests for session tree/session list transforms.
- Add manual smoke checklist for browser-only features:
  - desktop Chrome/Firefox;
  - mobile viewport;
  - PWA/offline shell;
  - localhost vs LAN access;
  - active run, blocked extension dialog, and stale server restart.

## Documentation strategy

- Keep `README.md` feature list concise.
- Add a separate parity table once implementation starts, likely `WEBUI_TUI_NATIVE_PARITY.md`.
- Document intentionally unsupported/degraded TUI APIs separately so users know whether a behavior is missing, unsafe, or blocked by RPC.
- For every native command implemented in Web UI, document:
  - browser behavior;
  - differences from TUI;
  - security restrictions;
  - mobile limitations.

## Risks and open decisions

1. **RPC limitation risk**
   - Full extension TUI parity cannot be reached without upstream protocol additions or a semantic component bridge.

2. **Secret-handling risk**
   - Browser auth must not turn the no-auth local Web UI into a secret exposure surface.

3. **Keyboard conflict risk**
   - Some native shortcuts conflict with browser/OS shortcuts. Web UI needs graceful fallbacks and visible key hints.

4. **Session deletion/import risk**
   - Deleting/importing sessions is user-facing and potentially destructive. Require confirmations, prefer trash, and test edge cases.

5. **Scope creep risk**
   - Web-only enhancements should wait until P1 native parity is complete.

6. **Mobile parity risk**
   - Native shortcuts do not always map to touch keyboards. Every keyboard feature needs an accessible button/menu fallback.

## Recommended next implementation order

1. [x] P0 parity matrix + native command adapter.
2. [-] `/export` — initial download/new-path support done; overwrite confirmation remains.
3. [-] `!`/`!!` bash and abort bash — initial active/queued support done; per-item queue cancellation and warning polish remain.
4. [-] Core keyboard manager: `Ctrl+L`, `Shift+Tab`, `Ctrl+P`, `Shift+Ctrl+P`, `Ctrl+O`, `Ctrl+T`, `Alt+Enter`, `Alt+Up`, Escape/double Escape — browser-safe defaults done; action-ID config and double-Escape remain.
5. [ ] Full `/settings`.
6. [ ] Full `/scoped-models` editor.
7. [ ] Full `/tree`.
8. [ ] Full `/resume`.
9. [ ] Safe `/login`/`/logout`.
10. [ ] `/import`, `/share`, `/changelog`, `/quit`.
11. [ ] Extension TUI bridge proposals/implementation.

## Definition of done for native parity features

A native parity feature is done when:

- The Web UI behavior matches the TUI behavior or explicitly documents a difference.
- It is tab-scoped and does not leak state across terminal tabs unless intended.
- It handles stopped/restarting RPC processes gracefully.
- It has a mobile-accessible fallback when keyboard shortcuts are involved.
- It has tests or a documented manual verification path.
- README or parity docs are updated.
