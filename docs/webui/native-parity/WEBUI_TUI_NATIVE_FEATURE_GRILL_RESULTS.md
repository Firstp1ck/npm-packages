# Grill Me Results

Generated: 2026-06-04T19:26:12.096Z

## Plan

@pi-package-webui/WEBUI_TUI_NATIVE_FEATURE_PLAN.md

## Shared Understanding

Design interview for Web UI native TUI parity plan completed. The plan should proceed with a thin P0 foundation (machine-readable parity matrix, centralized native-command adapter, explicit security model, deterministic test harness), then implement native command/shortcut/session/auth/share/import/extension parity incrementally with per-feature guards and auditable degraded/unavailable responses. High-risk features remain localhost/trusted-context/confirmation-gated; low-risk read-only UI parity can default on. Documentation and parity matrix updates are part of every feature's definition of done.

## Questions and Answers

### 1. Can Pi Web UI rely on RPC `get_commands` or sending `/settings`-style prompts to execute built-in native TUI commands?

**Recommended answer:** No. Treat built-in TUI commands as Web UI-owned native-command equivalents: Pi RPC docs state built-in TUI commands are not included in `get_commands` and would not execute via `prompt`; current `bin/pi-webui.mjs` already lists native commands separately and only implements a subset in `handleNativeSlashCommand`. This makes the plan's P0 native-command adapter a real prerequisite, not optional cleanup.

**User answer:** Resolved by codebase/docs exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: docs/rpc.md get_commands note; pi-package-webui/bin/pi-webui.mjs NATIVE_SLASH_COMMANDS and handleNativeSlashCommand default error.

### 2. Should P0 — parity matrix + native-command adapter + security model + initial endpoint test harness be a hard gate before implementing P1 features?

**Recommended answer:** Yes, but keep it thin: create the parity matrix, central adapter shape, sensitive-command policy, and first route-test harness before shipping `/export`, then use `/export` as the first real adapter consumer. Current code already has native command handling split between `public/app.js` dialogs and `bin/pi-webui.mjs` server handling, while several advertised native commands fall through as unsupported.

**User answer:** yes.

**Status:** resolved

**Notes:** This gates P1 implementation; keep P0 intentionally lightweight to avoid blocking feature delivery.

### 3. Can the current checked-in tests provide request/response coverage for native-command server endpoints?

**Recommended answer:** No. The current `npm run check` only runs syntax checks plus `tests/mobile-static.test.mjs`, which reads files and asserts static HTML/CSS/JS/server strings. P0 needs a new route/helper test harness before endpoint-heavy features such as `/export`, bash, settings writes, session rename/delete, and auth flows.

**User answer:** Resolved by codebase exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `pi-package-webui/package.json` scripts and `pi-package-webui/tests/mobile-static.test.mjs` static file assertions.

### 4. Should the parity matrix be machine-readable and test-enforced instead of only a Markdown table?

**Recommended answer:** Yes. Use a checked-in source of truth such as `WEBUI_TUI_NATIVE_PARITY.json` or `.mjs`, then generate/render docs from it or keep Markdown manually synced with tests. This lets `npm run check` assert every native command/shortcut/UI API has an explicit status.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: parity state must be testable and should become a checked-in source of truth, not just prose.

### 5. Should the machine-readable parity matrix use a strict status taxonomy like `implemented`, `partial`, `planned`, `blocked_by_rpc`, `unsafe_pending_design`, and `intentionally_unsupported`?

**Recommended answer:** Yes. Avoid free-text status fields; allow free text only in `notes`, `differences`, and `testCoverage`.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: parity matrix statuses are enumerated/testable; descriptive nuance belongs in secondary fields.

### 6. Should the parity matrix live as a root JSON source of truth like `WEBUI_TUI_NATIVE_PARITY.json`, with tests reading it directly?

**Recommended answer:** Yes. JSON is simple, reviewable, safe to load in tests, and fits the no-build package. Keep `WEBUI_TUI_NATIVE_PARITY.md` optional/generated or manually synced later.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: root JSON becomes the machine-readable parity source of truth; Markdown can be derived or manually synced later.

### 7. Should the initial parity matrix enumerate all native TUI surfaces from the docs—commands, shortcuts, editor features, session actions, settings, and extension UI APIs—even if many are only `planned` or `blocked_by_rpc`?

**Recommended answer:** Yes. Make the matrix comprehensive from day one, so missing parity is explicit instead of invisible.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: initial matrix should be comprehensive across native commands, shortcuts, editor/session/settings surfaces, and extension UI APIs.

### 8. Should the server-side native-command adapter be the authoritative registry for command support/status, while frontend dialogs are only UX wrappers over that registry/endpoints?

**Recommended answer:** Yes. Keep one authoritative server registry for statuses, safety policy, response shape, and unsupported messages; let `public/app.js` provide nicer dialogs for commands like `/model`, `/settings`, `/resume`, and `/tree`.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: avoid divergent command support logic between `bin/pi-webui.mjs` and `public/app.js`; frontend can enhance UX but server owns authoritative command semantics.

### 9. Should unsupported native commands return a structured adapter response with status, reason, and next-best action instead of only throwing a 400 string?

**Recommended answer:** Yes. For example: `{status:"planned", reason:"blocked_by_rpc", message, nextActions:[...]}` rendered as a native command card. This preserves safety and makes gaps visible/testable.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: unsupported/degraded native features should still flow through the adapter and UI as structured, testable outcomes.

### 10. Does the current native slash-command response shape already support the planned adapter outputs such as downloads, warnings, tab metadata, clipboard text, and refresh hints?

**Recommended answer:** No. Current server responses are ad hoc `native_slash_command` payloads with fields such as `message`, `copyText`, `tab`, and `result`; the frontend mostly renders `message`, copies `copyText`, and applies tab metadata. The adapter should formalize a broader response shape before `/export` and destructive/session features depend on it.

**User answer:** Resolved by codebase exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `bin/pi-webui.mjs` `handleNativeSlashCommand`; `public/app.js` `sendPrompt` native command handling.

### 11. Should the native-command adapter response shape explicitly support all of these output types from the start: transcript card, toast/event, tab metadata, download/open URL, clipboard text, warning/confirmation requirement, and refresh hints?

**Recommended answer:** Yes. Define the full shape early even if only `/export`, `/copy`, `/new`, and `/clone` use parts of it initially.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: design adapter result envelope broadly up front so later native parity features do not invent new one-off response contracts.

### 12. Should sensitive native features (`/login`, `/logout`, `/share`, `/import`, server-side `/export <path>`, `/quit`, optional installs) be allowed only from localhost, even if the Web UI is opened to the LAN?

**Recommended answer:** Yes. LAN clients can still chat/control normal Pi RPC, but sensitive filesystem/auth/process/network operations should require localhost-origin requests plus explicit confirmation.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: localhost-only remains a hard security boundary for sensitive native operations even when the Web UI is intentionally exposed to LAN.

### 13. Should the security model classify browser download export and server-side path export differently?

**Recommended answer:** Yes. `/export` with no path should be safe as a browser download/link from the active session; `/export /path/file.html` writes on the server filesystem and should be localhost-only, path-validated, and transcript-visible.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: export UX/security splits no-path browser download from explicit server filesystem writes.

### 14. Can `!!command` bash parity be implemented through current Pi RPC without upstream changes?

**Recommended answer:** Yes. Although `docs/rpc.md` only documents `bash` as context-including, the installed RPC type declaration includes `excludeFromContext?: boolean` on `type: "bash"`, and `dist/modes/rpc/rpc-mode.js` passes `command.excludeFromContext` into `session.executeBash`. Web UI should send `{type:"bash", command, excludeFromContext:true}` for `!!cmd` and omit/false it for `!cmd`.

**User answer:** Resolved by codebase/docs exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts` bash command includes `excludeFromContext`; `dist/modes/rpc/rpc-mode.js` forwards it; `docs/rpc.md` still documents bash/abort_bash basics.

### 15. For `/export` with no explicit path, should the Web UI auto-download the HTML file or only render a transcript card with a download link?

**Recommended answer:** Do both: create the export, show a native command card with path/link/copy actions, and trigger a browser download when permitted. If auto-download is blocked, the visible link remains the fallback.

**User answer:** do both

**Status:** resolved

**Notes:** Decision: no-path `/export` should produce a transcript-visible result and attempt a browser download with fallback link.

### 16. Should `/export /tmp/foo.html` write exactly to that server-side path instead of also downloading to the browser?

**Recommended answer:** Yes. Treat explicit paths as “server write” semantics matching native Pi. Report the written path and offer copy/open-if-safe actions, but do not auto-download unless the user asks through the browser link/action.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: explicit `/export <path>` preserves native server-side write semantics; browser download is not automatic for explicit paths.

### 17. Should `/export` support `.jsonl` as a raw session export by copying/downloading the active session file, rather than converting through RPC `export_html`?

**Recommended answer:** Yes. Use RPC `export_html` only for HTML; for `.jsonl`, expose/copy the current `state.sessionFile` with path validation and localhost-only rules for server-side writes.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/export` has two format paths: HTML via RPC `export_html`; JSONL via active persisted session file copy/download.

### 18. For explicit `/export <path>`, should relative paths resolve against the active tab cwd?

**Recommended answer:** Yes. Match user expectation from terminal Pi: absolute paths stay absolute; relative paths resolve from the active tab’s cwd. Require `.html` or `.jsonl`, reject directories/unsupported extensions, and make the resolved path visible before/after writing.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: explicit export paths resolve like terminal working-directory paths, scoped to the active tab cwd for relative paths.

### 19. Should `/export` refuse to overwrite an existing explicit server-side file unless the user confirms?

**Recommended answer:** Yes. For `/export /path/file.html` or `.jsonl`, detect existing files and require explicit browser confirmation before overwrite. No-path browser downloads can use browser filename conflict behavior.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: explicit server-side export overwrites require confirmation; browser-download exports rely on browser filename conflict behavior.

### 20. Should `/export` create temporary/no-path exports in a Web UI-managed temp directory with short-lived download tokens, rather than exposing arbitrary filesystem paths directly?

**Recommended answer:** Yes. Keep downloads scoped to generated export artifacts, expire them, and serve only via opaque IDs/tokens.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: browser download endpoints should not expose arbitrary path reads; use Web UI-managed artifacts and opaque short-lived IDs/tokens.

### 21. For `!`/`!!` bash, should Web UI intercept only composer submissions whose trimmed message starts with `!`, and not slash commands or text containing `!` later?

**Recommended answer:** Yes. Use exact leading syntax: `!!cmd` means exclude from LLM context; `!cmd` means include in next prompt context; require non-empty `cmd`.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: bash parity is composer-leading syntax only; no broad text parsing.

### 22. Should direct `!`/`!!` bash execution be allowed from LAN clients when the Web UI is intentionally opened to the network?

**Recommended answer:** Yes, treat it like normal Web UI control, not like auth/import/share. But make the no-auth LAN warning explicit that users can run direct shell commands.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: direct bash is allowed under intentional Web UI network exposure; documentation/warnings must explicitly state LAN clients can run shell commands through the tab.

### 23. Can current Web UI rendering display `bashExecution` transcript messages once they are present in Pi messages?

**Recommended answer:** Yes. `public/app.js` already treats `bashExecution` as an action transcript message, renders `$ command` plus output in a collapsible card, estimates token impact, and supports feedback reactions. The missing piece is composer interception/server endpoint/live active bash state, not basic rendering.

**User answer:** Resolved by codebase exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `public/app.js` references `bashExecution` in token estimate, message title, collapsible rendering, action transcript classification, and feedback.

### 24. Should `!`/`!!` bash render a transient live card immediately, then reconcile with persisted `bashExecution` messages after refresh?

**Recommended answer:** Yes. RPC `bash` does not emit a `BashExecutionMessage` event, so the browser needs immediate local feedback while the request is running, then refresh messages/state after completion to show the persisted session entry.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web UI should provide immediate transient bash UI and reconcile with persisted RPC/session messages after completion.

### 25. Can Web UI send RPC `abort_bash` while an RPC `bash` request is still awaiting completion?

**Recommended answer:** Yes. Pi RPC input handling dispatches each JSONL line with `void handleInputLine(line)` instead of serializing/awaiting prior commands, and `abort_bash` calls `session.abortBash()` while `bash` awaits `session.executeBash(...)`. Web UI's `PiRpcProcess` also supports multiple pending request IDs. So abortable bash can use a separate `/api/abort-bash` endpoint against the same tab.

**User answer:** Resolved by codebase exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `dist/modes/rpc/rpc-mode.js` input loop and bash/abort_bash cases; `bin/pi-webui.mjs` PiRpcProcess pending map with per-request IDs.

### 26. Should the same Abort button/Escape path abort an active user bash command when bash is running, before falling back to agent abort?

**Recommended answer:** Yes. Treat active bash as a distinct run state, but route the existing abort affordance to `abort_bash` when `activeBash` is true; otherwise use normal agent abort.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: active user bash takes precedence for shared abort affordances; normal agent abort remains fallback.

### 27. Does native Pi TUI allow user bash commands while the agent is streaming?

**Recommended answer:** Yes. Native interactive mode treats bash during streaming as deferred/pending UI: it adds the BashExecutionComponent to `pendingMessagesContainer` and records the result through `session.executeBash`/`recordBashResult`. Web UI parity should allow `!`/`!!` during active runs and render them as active/pending bash cards rather than blocking them.

**User answer:** Resolved by codebase exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `dist/modes/interactive/interactive-mode.js` `handleBashCommand` uses `isDeferred = this.session.isStreaming`, pending container, and executeBash with excludeFromContext.

### 28. Should Web UI allow only one active user bash command per tab at a time?

**Recommended answer:** Yes. Even if RPC can accept concurrent lines, keep Web UI state simple and TUI-like: one active bash per tab, abortable; additional `!`/`!!` submissions should be queued or rejected with “wait/abort current bash.”

**User answer:** yes

**Status:** resolved

**Notes:** Decision: active user bash state is tab-scoped and single-flight.

### 29. If a user submits another `!`/`!!` while bash is already running in that tab, should Web UI reject it rather than queue it?

**Recommended answer:** Yes. Reject with a clear message: “A bash command is already running; abort or wait before starting another.” This avoids hidden command queues and keeps abort semantics obvious.

**User answer:** queue it

**Status:** resolved

**Notes:** Decision differs from recommendation: implement a tab-scoped queued user-bash flow instead of rejection when active bash is already running.

### 30. For queued `!`/`!!` bash commands, should they run FIFO per tab, with queued cards visible and individually cancellable before they start?

**Recommended answer:** Yes. FIFO is predictable; visible queued cards avoid hidden shell side effects; cancellation before start keeps the queue safe.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: user-bash queue is tab-scoped FIFO; queued commands are visible and can be cancelled before execution.

### 31. When bash commands are queued, should the shared Abort/Escape control abort only the currently running bash command, while queued bash commands remain queued unless cancelled individually?

**Recommended answer:** Yes. Keep Abort/Escape scoped to active execution; add separate queued-card cancel controls for commands that have not started.

**User answer:** yes, add possibility to abort all via "shift+Esc"

**Status:** resolved

**Notes:** Decision extends recommendation: Escape aborts active bash only; queued bash cards remain individually cancellable; add Shift+Escape as an abort-all affordance.

### 32. Should `Shift+Escape` abort all queued/running user bash commands only, or all Web UI work including agent run, follow-up queue, and extension dialogs?

**Recommended answer:** Scope `Shift+Escape` to user bash only: abort the running bash and clear queued bash commands in the active tab. Keep broader agent/queue/dialog cancellation separate to avoid surprising data loss.

**User answer:** Scope Shift+Escape to user bash only

**Status:** resolved

**Notes:** Decision: Shift+Escape is a user-bash-only abort-all shortcut for the active tab.

### 33. How does native/RPC Pi order user bash results when bash completes during an active agent run?

**Recommended answer:** Native/RPC defers bashExecution messages while `session.isStreaming` is true: `recordBashResult` queues them in `_pendingBashMessages` and flushes them after `agent_end`, preserving tool_use/tool_result ordering. Web UI should account for this when showing transient bash cards during active runs.

**User answer:** Resolved by codebase exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `dist/core/agent-session.js` `recordBashResult`, `_pendingBashMessages`, and `_flushPendingBashMessages`; interactive mode pending bash UI.

### 34. Should Web UI match native ordering for `!`/`!!` during an active agent run: show transient/queued UI immediately, but only let completed bash results enter persisted LLM context after the active run finishes?

**Recommended answer:** Yes. This matches Pi internals and avoids corrupting in-flight tool-call ordering.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web UI transient UI may show bash immediately, but persisted/session/LLM ordering follows Pi's deferred pending bash behavior during active runs.

### 35. If an agent run is active and the user submits `!`/`!!`, should the first queued bash command start immediately in parallel with the agent run, or wait until the agent is idle?

**Recommended answer:** Start immediately. Native Pi allows bash while streaming and defers persistence/context ordering internally, so Web UI should match that behavior while still showing it as pending/transient.

**User answer:** Start immediately

**Status:** resolved

**Notes:** Decision: user bash execution may run concurrently with an active agent run; persistence/context ordering remains handled by Pi's deferred bash mechanism.

### 36. Should queued bash commands after the first also start immediately in parallel, or run serially one at a time per tab?

**Recommended answer:** Run serially one at a time per tab. This honors the earlier single-active-bash decision while still allowing the first bash to run during an agent run.

**User answer:** Run serially one at a time per tab

**Status:** resolved

**Notes:** Decision: user bash queue executes serially per tab; at most one active bash process/request at a time for a tab.

### 37. Does current Web UI already expose persistent Pi settings read/write helpers for expanded `/settings` and `/scoped-models`?

**Recommended answer:** No. Current server only reads settings JSON to resolve `enabledModels` for `/api/scoped-models`; it has no `/api/settings` read/write endpoint. Current `/settings` dialog applies runtime RPC controls and browser-local toggles only. The plan needs new safe settings merge/write helpers.

**User answer:** Resolved by codebase/docs exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `bin/pi-webui.mjs` `configuredScopedModelPatterns` reads settings; no `/api/settings`; `public/app.js` `openNativeSettingsDialog` posts runtime endpoints only. Pi `docs/settings.md` defines global/project settings and merge precedence.

### 38. Does current Web UI already support native model/thinking cycling RPC commands and keyboard manager behavior?

**Recommended answer:** No. Pi RPC supports `cycle_model` and `cycle_thinking_level`, but current `bin/pi-webui.mjs` does not expose POST endpoints for them, and `public/app.js` only has basic Enter/Escape/suggestion key handling rather than a context-aware keybinding manager.

**User answer:** Resolved by codebase/docs exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: Pi RPC docs/dist include `cycle_model` and `cycle_thinking_level`; `bin/pi-webui.mjs` `commandFromPost` lacks cycle endpoints; `public/app.js` keydown handlers are limited to Escape and prompt/suggestion behavior.

### 39. For expanded `/settings`, should Web UI write persistent settings to project scope by default (`.pi/settings.json`) rather than global scope?

**Recommended answer:** Yes. Default writes should be project-scoped because the Web UI tab is cwd/session-oriented and project overrides already take precedence. Add an explicit scope selector for global vs project.

**User answer:** no, user should be able to choose.

**Status:** resolved

**Notes:** Decision differs from recommendation: settings writes must not assume a default-only scope; the user must be able to choose the target settings scope.

### 40. Should `/settings` have a top-level scope selector (`Global`, `Project`) that applies to all persistent changes in that save operation?

**Recommended answer:** Yes. Start with one scope selector per save. Per-field scope controls are powerful but likely too complex for the first parity pass.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: expanded `/settings` persistent saves use a top-level Global/Project scope selector for each save operation.

### 41. When `/settings` changes both runtime state and persistent settings, should Web UI apply runtime-safe changes immediately and also save the selected scope for future sessions?

**Recommended answer:** Yes. For fields with RPC setters, apply immediately and persist if requested; for settings requiring reload/restart, save and clearly label “requires `/reload`” or restart.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: settings UI must distinguish runtime-apply, reload-needed, and restart-needed changes while saving selected persistent scope when requested.

### 42. Should `/settings` include a runtime-only mode so users can change current tab state without writing any settings file?

**Recommended answer:** Yes. Provide `Runtime only` alongside `Global` and `Project`. This preserves current quick-setting behavior and avoids accidental persistent config edits.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: settings save/apply target options are Runtime only, Global, and Project; runtime-only keeps current no-file-write behavior.

### 43. For `/settings`, should fields that are currently overridden by project settings show their effective value plus source (`global`, `project`, `runtime/browser`)?

**Recommended answer:** Yes. Otherwise users cannot tell why a global edit may not affect the active tab.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: settings UI must show effective values and source/scope metadata for override clarity.

### 44. Should expanded `/settings` eventually expose every documented setting from Pi `docs/settings.md`, with unsafe/advanced fields gated or read-only, rather than only the high-frequency subset in the plan?

**Recommended answer:** Yes. Use sections and safety classifications so the UI can be comprehensive without making dangerous fields easy to change.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/settings` parity target is comprehensive documented settings coverage, organized/gated by section and safety, not only high-frequency controls.

### 45. Should settings that can alter command execution or local environment—`shellPath`, `shellCommandPrefix`, `npmCommand`, resource paths/packages, and `sessionDir`—be in an Advanced section with explicit confirmation for edits?

**Recommended answer:** Yes. These affect execution, package loading, or session storage; make them visible but gated.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: sensitive/advanced settings are visible but gated behind Advanced and explicit edit confirmation.

### 46. Should Advanced settings edits use structured controls where practical but fall back to a validated JSON editor for arrays/objects like `packages`, `extensions`, `skills`, `prompts`, `themes`, `thinkingBudgets`, and `retry.provider`?

**Recommended answer:** Yes. Avoid building bespoke controls for every nested setting initially; validate JSON shape before saving.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: advanced/nested settings can use JSON-editor fallback with validation, while common scalar settings use structured controls.

### 47. Should Web UI create a timestamped backup before writing `settings.json`?

**Recommended answer:** Yes. For both global and project settings writes, write atomically and keep a small backup like `settings.json.webui-backup-YYYYMMDD-HHMMSS`.

**User answer:** yes, only keep most 3 backups

**Status:** resolved

**Notes:** Decision: Web UI settings writes must be atomic, create timestamped backups, and prune to the most recent 3 backups per settings file.

### 48. Should `/scoped-models` write to the same selected settings scope model as `/settings` (`Runtime only`, `Global`, `Project`), or always to settings files?

**Recommended answer:** Use only `Global`/`Project` for `/scoped-models`; no `Runtime only` unless Pi exposes a runtime scoped-model override. Model cycling scope is fundamentally persisted via `enabledModels`.

**User answer:** Use only Global/Project for /scoped-models

**Status:** resolved

**Notes:** Decision: `/scoped-models` persists `enabledModels` to either Global or Project settings; runtime-only is not part of first design.

### 49. For `/scoped-models`, should the default selected scope be the scope where the current effective `enabledModels` came from?

**Recommended answer:** Yes. If project settings define `enabledModels`, default to Project; otherwise if global defines it, default to Global; if none exists, default to Project for project-local Web UI use but let the user switch.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/scoped-models` scope selector defaults to effective source; if no existing source, default Project but keep switchable.

### 50. Should `/scoped-models` save ordered explicit model IDs (`provider/model`) rather than broad wildcard patterns generated from provider toggles/searches?

**Recommended answer:** Yes. Preserve manually-entered patterns if the user edits pattern mode, but the browser checklist/reorder UI should save an ordered explicit list for predictable Ctrl+P cycling.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: default visual scoped-models editor saves ordered explicit model identifiers; advanced/manual pattern mode may preserve user-entered patterns.

### 51. Should `/scoped-models` include an Advanced pattern mode where users can directly edit `enabledModels` patterns like `claude-*` or `openai/gpt-*`, separate from the visual checklist?

**Recommended answer:** Yes. Default to visual checklist/reorder, but include Advanced pattern mode so existing wildcard configs are not lost or oversimplified.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/scoped-models` needs both a visual explicit-model checklist/reorder UI and an advanced direct-pattern editor for `enabledModels`.

### 52. When saving from visual `/scoped-models`, should Web UI warn if it would replace existing wildcard patterns with explicit model IDs?

**Recommended answer:** Yes. Show a clear “convert patterns to explicit list?” confirmation, because this can change future behavior when providers add new matching models.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: converting wildcard/pattern-based `enabledModels` to explicit model IDs requires an explicit confirmation.

### 53. Should Web UI intentionally intercept browser-reserved shortcuts like `Ctrl+P` for model cycling when the app has focus?

**Recommended answer:** Yes. For native parity, intercept documented Pi shortcuts inside the Web UI, but provide visible alternatives/buttons and document browser conflicts.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web UI will intercept browser-reserved native Pi shortcuts while focused, with button/menu fallbacks and documented conflicts.

### 54. Should the first keyboard-manager implementation read user customizations from `~/.pi/agent/keybindings.json`, or ship native default shortcuts first and add custom keybinding support later?

**Recommended answer:** Ship native defaults first, but design the manager around action IDs so reading `keybindings.json` can be added without rewiring.

**User answer:** ship native defaults first, but design the manager around action IDs so reading keybindings.json can be added without rewiring

**Status:** resolved

**Notes:** Decision: first keyboard manager uses native default bindings, internally keyed by namespaced action IDs for later user override support.

### 55. Should shortcut handling be active inside the prompt textarea for app-level actions like `Ctrl+P`, `Shift+Tab`, `Ctrl+O`, `Ctrl+T`, `Alt+Enter`, and `Alt+Up`?

**Recommended answer:** Yes for app-level Pi actions, with explicit exceptions for normal text editing and browser/paste behavior. The prompt is the primary focused surface, so shortcuts must work there.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: app-level native shortcuts should work while prompt textarea is focused, subject to explicit text-editing/browser-reserved exceptions.

### 56. Should `Ctrl+C` clear the prompt editor only when there is no text selection, preserving normal copy behavior when text is selected?

**Recommended answer:** Yes. This is the safest browser adaptation of native `app.clear`.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: browser `Ctrl+C` clear-editor behavior is guarded by selection state to preserve normal copy semantics.

### 57. Should Web UI implement native double `Ctrl+C` quit behavior?

**Recommended answer:** No for the first parity pass. Preserve `Ctrl+C` for copy/clear-editor only, and make quit explicit via `/quit` or a button because browser semantics make double-`Ctrl+C` too easy to trigger accidentally.

**User answer:** no

**Status:** resolved

**Notes:** Decision: do not implement double-Ctrl+C quit initially; quit remains explicit.

### 58. Should Web UI implement native double-Escape action (`tree`, `fork`, or `none`) using the persisted `doubleEscapeAction` setting?

**Recommended answer:** Yes. Single Escape keeps cancel/abort behavior; double Escape triggers the configured action when safe and not inside a modal.

**User answer:** no

**Status:** resolved

**Notes:** Decision differs from recommendation: do not implement double-Escape action initially, even though the native setting exists. Document as intentionally unsupported/deferred for Web UI to avoid conflicts with browser/modal abort behavior.

### 59. Should `/settings` still expose `doubleEscapeAction` as a documented native setting but mark it TUI-only / not applied in Web UI?

**Recommended answer:** Yes. Since we decided not to implement double-Escape in Web UI, the setting should be visible with a clear “affects terminal TUI only” note.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `doubleEscapeAction` remains visible in comprehensive settings parity but must be labeled TUI-only/not applied by Web UI.

### 60. Should `Shift+Escape` for user-bash abort-all be implemented even though double-Escape is not implemented?

**Recommended answer:** Yes. They are separate semantics: `Shift+Escape` is an explicit Web UI bash-queue safety shortcut; double-Escape is a native TUI navigation shortcut we decided not to port initially.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: implement Shift+Escape for user-bash abort-all independently from double-Escape, which remains unsupported/deferred in Web UI.

### 61. Should `Alt+Up` restore queued steering/follow-up messages to the editor and remove them from the queue when possible?

**Recommended answer:** Yes. Match native queue retrieval: restore queued text into the composer, preserve attachments only if Web UI still has them available, and warn when images/files cannot be restored.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: implement native queue retrieval semantics for steering/follow-up messages, including best-effort attachment restoration and warnings for unrestorable files/images.

### 62. Should `Alt+Up` restore all queued messages into the composer at once, or only the most recent queued message?

**Recommended answer:** Restore all queued messages in FIFO order, separated clearly, because native wording says “queued messages” and this avoids leaving hidden queue state behind.

**User answer:** Restore all queued messages in FIFO order, separated clearly, because native wording says “queued messages” and this avoids leaving hidden queue state behind.

**Status:** resolved

**Notes:** Decision: Alt+Up restores all queued steering/follow-up messages FIFO into the composer with clear separators.

### 63. Can current Pi RPC directly implement both `Ctrl+P` forward and `Shift+Ctrl+P` backward model cycling?

**Recommended answer:** Only forward is directly exposed. RPC has `cycle_model` with no direction field, while interactive mode calls `session.cycleModel("forward"|"backward")`. Web UI should implement backward itself using scoped/available model data plus `set_model`, or request upstream RPC direction support. Forward can use RPC `cycle_model` or the same browser/server cycle helper for consistency.

**User answer:** Resolved by codebase/docs exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `dist/modes/rpc/rpc-types.d.ts` `type: "cycle_model"` has no direction; `dist/modes/rpc/rpc-mode.js` calls `session.cycleModel()`; interactive mode passes direction.

### 64. For model cycling, should Web UI implement both forward and backward cycling in its own server helper using scoped models + `set_model`, instead of relying on RPC `cycle_model` for forward only?

**Recommended answer:** Yes. One Web UI helper gives symmetric forward/back behavior and can respect the same ordered scoped-model list saved by `/scoped-models`.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web UI model cycling endpoint/helper should handle forward and backward itself, using scoped/effective ordered model list and `set_model`.

### 65. When no scoped models are configured, should Web UI model cycling cycle through all available models?

**Recommended answer:** Yes. Match native fallback behavior: scoped list if non-empty; otherwise all available models.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: model cycle list is effective scoped model list when non-empty, otherwise all available models.

### 66. If the current active model is not in the cycle list, should cycling jump to the first/last cycle-list model rather than erroring?

**Recommended answer:** Yes. `Ctrl+P` should select the first cycle-list model; `Shift+Ctrl+P` should select the last. Show a small status message explaining the active model was outside scope.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: cycling from an out-of-scope current model wraps into the cycle list boundary with an explanatory status/transcript message.

### 67. Should `Shift+Tab` thinking cycling use RPC `cycle_thinking_level` and show a warning/status if the current model does not support thinking?

**Recommended answer:** Yes. This matches native behavior and RPC directly supports it.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: implement Shift+Tab via RPC `cycle_thinking_level`; warn/status when unavailable for the current model.

### 68. Should `Ctrl+T` toggle thinking visibility globally for the browser/tab transcript using the existing Web UI `thinkingOutputVisible` setting?

**Recommended answer:** Yes. The Web UI already has a persisted thinking visibility toggle; wire `Ctrl+T` to the same behavior and update visible buttons/status.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Ctrl+T maps to existing browser thinking-output visibility toggle, not a separate per-message behavior.

### 69. Should `Ctrl+O` global tool expansion apply to tool results, tool executions, and user bash cards, or only LLM tool output?

**Recommended answer:** Apply to tool results, tool executions with internal output details, and user bash cards. This makes the shortcut useful across all TUI-like action output.

**User answer:** Apply to tool results, tool executions with internal output details, and user bash cards. This makes the shortcut useful across all TUI-like action output.

**Status:** resolved

**Notes:** Decision: global tool expansion state covers persisted tool result collapsers, tool execution internal output details, and user bash cards.

### 70. Should the global tool expansion state persist per browser across tabs/reloads, or be per Pi tab/session?

**Recommended answer:** Per browser. It’s a UI display preference like thinking visibility/theme, not session content.

**User answer:** Per browser

**Status:** resolved

**Notes:** Decision: global tool expansion/collapse is a browser-local preference shared across tabs/reloads, not persisted in Pi session/settings.

### 71. Should `Ctrl+O` set a persistent global mode for new future cards too, not just toggle currently rendered cards?

**Recommended answer:** Yes. Existing and newly created action cards should follow the current global expansion preference until the user toggles again.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Ctrl+O updates a persistent browser-local global expansion preference that applies to both existing cards and future action cards.

### 72. Should user manually expanding/collapsing an individual tool/bash card override the global `Ctrl+O` mode for that card only?

**Recommended answer:** Yes. Global mode sets defaults/bulk state, but individual card interaction should still be respected until the next global toggle.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: individual action-card expansion state can override the global preference per card until the next global Ctrl+O bulk toggle.

### 73. What does current Web UI `/tree` support from the codebase?

**Recommended answer:** It is partial: the server opens the active session file with `SessionManager`, flattens `manager.getTree()` into nodes with id/parent/depth/type/role/label/timestamp/title/text/childCount/currentLeaf, and navigation uses a hidden `/webui-tree-navigate` prompt with summarize/customInstructions/replaceInstructions/label. The browser renders a searchable flat selector with summarize and optional label fields. Missing native parity includes fold/unfold UI state, filter modes, keyboard tree actions, direct label edit/clear controls, and label timestamp toggles.

**User answer:** Resolved by codebase exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `bin/pi-webui.mjs` `getSessionTreeData`, `flattenSessionTree`, `navigateSessionTree`; `public/app.js` `openNativeTreeSelector`; `SessionManager` supports labels and label timestamps via `appendLabelChange`/`getTree`.

### 74. What does current Web UI `/resume` support from the codebase?

**Recommended answer:** It is partial: `/api/sessions` calls `SessionManager.list` or `listAll`, sorted by modified time, limited to 200, normalized with path/id/name/cwd/created/modified/messageCount/firstMessage/parent/current. The browser supports current/all scope, search, and switch-session. Missing native parity includes sort mode toggle, path display toggle, named-only filter, rename, and safe delete/trash handling.

**User answer:** Resolved by codebase exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `bin/pi-webui.mjs` `getSessionSelectorData`/`normalizeSessionInfo`; `public/app.js` `openNativeResumeSelector`; `SessionManager.list/listAll` sort by modified descending.

### 75. For `/tree`, should Web UI implement native filter modes exactly as documented: `default`, `no-tools`, `user-only`, `labeled-only`, and `all`?

**Recommended answer:** Yes. Use the same names as Pi settings/keybindings so `treeFilterMode` can be reused and the parity matrix stays clear.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web `/tree` filter mode enum matches native Pi exactly.

### 76. Should Web UI `/tree` default to the persisted Pi `treeFilterMode` setting when available?

**Recommended answer:** Yes. Use effective settings source for default, with an in-dialog filter control that can change the current view without immediately writing settings.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web `/tree` should initialize from effective `treeFilterMode` but dialog filter changes are view-local unless explicitly saved through settings.

### 77. Should `/tree` filter changes inside the dialog be temporary view state only, with a separate “Save as default” action if the user wants to persist `treeFilterMode`?

**Recommended answer:** Yes. This avoids accidental settings writes while still making the default easy to update.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/tree` filter selection is temporary dialog state by default; provide a distinct save-default action for persisted `treeFilterMode`.

### 78. Should `/tree` fold/unfold state be dialog-local and reset each time `/tree` opens?

**Recommended answer:** Yes for first implementation. Persisting fold state across sessions adds complexity and is not necessary for parity basics.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/tree` fold state is local to an open dialog instance and resets when reopened.

### 79. Should `/tree` support label edit/clear directly on the selected node, backed by `SessionManager.appendLabelChange`, without navigating?

**Recommended answer:** Yes. Native `Shift+L` edits labels independently of navigation, and the codebase has append-only label support.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web `/tree` should support label edit and clear actions on selected nodes without requiring navigation.

### 80. Should `/tree` label timestamp visibility (`Shift+T`) be a dialog-local display toggle, not a persisted setting?

**Recommended answer:** Yes. Show/hide label timestamps during the open tree dialog; reset on reopen unless later native evidence shows persistence.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web `/tree` label timestamp visibility is an open-dialog display toggle and not persisted.

### 81. Should `/tree` navigation keep the current behavior where selecting a user message restores its text into the composer after navigation?

**Recommended answer:** Yes. The current Web UI already does this for tree/fork-style flows, and it matches the plan’s “continue from there” behavior.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web `/tree` navigation should keep restoring selected user-message text into the composer when applicable.

### 82. For `/tree`, should branch summarization remain opt-in per navigation via a checkbox, rather than automatically following `branchSummary.skipPrompt`?

**Recommended answer:** Yes. Keep summarization explicit in the Web UI because it can call the model and spend tokens; `branchSummary.skipPrompt` can be shown as context but should not silently summarize.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: Web `/tree` branch summarization remains an explicit per-navigation opt-in; no silent model calls based on default settings.

### 83. For `/resume`, should session delete use trash/noninvasive delete by default, and only hard-delete if trash is unavailable or explicitly requested?

**Recommended answer:** Yes. Session deletion is destructive; prefer trash, require confirmation, and never delete the active session without switching/closing first.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/resume` delete defaults to noninvasive trash semantics, requires confirmation, and must guard active-session deletion.

### 84. Should `/resume` make delete unavailable for the active session in the active tab, but allow deleting sessions that are open in other tabs only after warning which tab uses them?

**Recommended answer:** Yes. Protect the active tab hard; for sessions open elsewhere, require confirmation and ideally close/switch that tab first.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: active tab's current session cannot be deleted from `/resume`; sessions open in other tabs require explicit warning/confirmation and tab-awareness.

### 85. Should `/resume` rename use Pi’s append-only `session_info` entry (`appendSessionInfo`) rather than renaming the `.jsonl` file?

**Recommended answer:** Yes. Native session names are session metadata; file renames are riskier and can break open-tab restoration.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/resume` rename appends session_info metadata to the session file; it does not rename the JSONL file.

### 86. Should `/resume` named-only filter mean “sessions with a non-empty `session_info` name”, not sessions whose first message happens to look title-like?

**Recommended answer:** Yes. Use explicit session metadata for named-only behavior.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: named-only filter is based on explicit non-empty session metadata name, not inferred labels/first messages.

### 87. Should `/resume` sort modes include at least modified time, created time, and name, matching native sort-toggle intent?

**Recommended answer:** Yes. Start with these three; keep current modified-desc as default.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/resume` sort modes include modified time, created time, and name; default remains modified-desc.

### 88. Should `/resume` path display default to hidden/compact, with a toggle to show full session file paths and cwd?

**Recommended answer:** Yes. Keep the selector readable by default, but expose full paths on demand for power users.

**User answer:** yes

**Status:** resolved

**Notes:** Decision: `/resume` defaults to compact/hidden paths and provides a path/cwd visibility toggle.

### 89. Can `/import` validate and switch to a JSONL session using current Pi/Web UI building blocks?

**Recommended answer:** Yes. Current Web UI already validates `.jsonl` path existence, opens it with `SessionManager.open(...)`, then sends RPC `switch_session`. Pi session docs define header/version structure and automatic migrations via `SessionManager`. Missing work is upload/server-path import UX, stricter header/version validation before switching, safe copy into managed session storage when needed, and transcript-visible adapter output.

**User answer:** Resolved by codebase/docs exploration before interviewing.

**Status:** resolved

**Notes:** Evidence: `bin/pi-webui.mjs` `switchTabSession`; Pi `docs/session-format.md`; `SessionManager.open`, `parseSessionEntries`, migration/version support.

### 90. For `/import`, should uploaded JSONL files be copied into Pi’s configured session directory before switching, rather than switching directly to a temp upload path?

**Recommended answer:** Yes. Import should create a durable session file under the configured session storage, validate it, then switch the tab to that durable path.

**User answer:** yes

**Status:** resolved

**Notes:** Durable copy avoids broken resumed tabs after temp cleanup and keeps imported sessions discoverable by `/resume`.

### 91. For `/import`, should the imported session keep its original `cwd` metadata if present, even if that cwd does not match the current tab/project?

**Recommended answer:** Yes — preserve original session metadata, but show a warning/badge when the imported cwd differs from the active tab cwd.

**User answer:** yes

**Status:** resolved

**Notes:** Preserving metadata avoids corrupting session provenance; cwd mismatch should be surfaced in `/resume` and switch/import confirmation UI.

### 92. For `/import`, should malformed/unsupported JSONL fail before copying or switching, with a transcript card explaining the validation error?

**Recommended answer:** Yes. Validate header/version/basic entry shape first; only copy and switch after validation succeeds.

**User answer:** yes

**Status:** resolved

**Notes:** Pre-copy validation prevents durable storage pollution and avoids switching the tab into an unusable session.

### 93. For `/share`, should Web UI initially implement only a local export/share preview rather than publishing to any remote service?

**Recommended answer:** Yes. Treat `/share` as localhost-only, confirmation-gated, and produce a local share artifact/preview first.

**User answer:** yes

**Status:** resolved

**Notes:** Avoids external side effects and privacy risk while still enabling reviewable sharing UX; remote publishing can be future work behind explicit provider/config.

### 94. For `/share`, should the local preview redact/omit tool outputs and bash outputs by default, with explicit toggles to include them?

**Recommended answer:** Yes. Default to safe/minimal sharing: user + assistant text only, then opt-in toggles for tool calls/results, bash output, metadata, and file paths.

**User answer:** yes

**Status:** resolved

**Notes:** Safer default for privacy; inclusion of potentially sensitive tool/bash output should require explicit user intent and be reflected in the preview summary.

### 95. For `/share`, should generated local preview artifacts use the same model as browser `/export`: Web UI temp directory + short-lived opaque token, not stable public file paths?

**Recommended answer:** Yes. Use short-lived local tokens and regenerate previews as needed.

**User answer:** yes

**Status:** resolved

**Notes:** Aligns `/share` with prior `/export` token model and avoids leaking stable filesystem paths or long-lived artifacts.

### 96. For `/share`, should remote publishing remain unsupported until an explicit provider/config and confirmation flow exists?

**Recommended answer:** Yes. Return structured “unsupported” output with next steps rather than silently doing local-only behavior.

**User answer:** yes

**Status:** resolved

**Notes:** Remote share has external side effects; keeping it unsupported until provider/config/confirmation exist preserves privacy and avoids accidental publication.

### 97. For `/login`, should Web UI initially support subscription/OAuth flows only through server-side `AuthStorage`/provider callbacks, while keeping raw API-key entry guidance-only?

**Recommended answer:** Yes. Browser login should open auth URLs/device codes and let the server store tokens; API keys should stay out of browser input until a dedicated secret-handling design exists.

**User answer:** no, support all

**Status:** resolved

**Notes:** User explicitly wants Web UI `/login` to support all auth modes, including API-key providers. This supersedes the earlier plan bias to keep raw API-key entry out of scope initially; follow-up security constraints are needed.

### 98. For Web UI `/login` API-key entry, should raw keys be accepted only from trusted contexts — localhost by default, or explicit HTTPS/secure deployment opt-in — and be blocked on plain LAN HTTP?

**Recommended answer:** Yes. Support all providers, but never send raw keys over untrusted browser connections.

**User answer:** yes

**Status:** resolved

**Notes:** User wants full `/login` provider support while preserving a transport trust boundary for raw API keys: localhost is allowed by default; plain LAN HTTP should block API-key submission unless a secure deployment opt-in exists.

### 99. For `/login` API-key entry, should the Web UI write keys only to server-side `AuthStorage` (`auth.json`), never browser storage, transcript cards, logs, or URL/query params?

**Recommended answer:** Yes. Treat the browser as an input surface only; redact keys everywhere else.

**User answer:** yes

**Status:** resolved

**Notes:** Raw API keys may cross the browser only as a one-shot form POST over a trusted context; backend persists through AuthStorage and all UI/log/transcript surfaces must display only provider/status, never key material.

### 100. For `/logout`, should Web UI list only credentials that Pi can actually remove from `auth.json`, and label environment/config credentials as not removable here?

**Recommended answer:** Yes. Match native semantics: `/logout` removes credentials saved by `/login`; env vars and model config remain unchanged.

**User answer:** yes

**Status:** resolved

**Notes:** Evidence from native interactive mode: logout status says it only removes credentials saved by `/login`; environment variables and models.json config are unchanged.

### 101. For `/logout`, should clearing credentials require confirmation per selected provider, and refresh available models/auth status immediately after success?

**Recommended answer:** Yes.

**User answer:** yes

**Status:** resolved

**Notes:** Confirmation prevents accidental credential removal; refresh aligns visible model/auth state after `AuthStorage.logout` and model registry refresh.

### 102. For `/login` API-key providers, should the Web UI require an explicit provider picker first, then show a masked one-shot key field with “save to `auth.json`” confirmation?

**Recommended answer:** Yes.

**User answer:** yes

**Status:** resolved

**Notes:** Provider-first flow avoids ambiguous key routing; masked one-shot entry plus explicit save confirmation matches the full-provider support decision while keeping secrets out of persistent browser state.

### 103. For `/login` OAuth/device-code flows, should Web UI support the native provider callback steps (`onAuth`, `onDeviceCode`, `onSelect`, `onPrompt`) in one server-driven browser dialog?

**Recommended answer:** Yes. This gives parity for subscription providers and custom OAuth providers without hardcoding provider-specific flows.

**User answer:** yes

**Status:** resolved

**Notes:** Native `OAuthLoginCallbacks` include auth URL, device code, prompt, select, progress/manual-code flows; Web UI should expose those as server-driven browser dialog states.

### 104. For `/changelog`, should Web UI source changelog content from the same package/documentation file native Pi uses, and render it read-only in a searchable dialog/card?

**Recommended answer:** Yes.

**User answer:** yes

**Status:** resolved

**Notes:** Keeps Web UI changelog parity tied to Pi's canonical release notes source; UI should be read-only with search/version grouping and graceful missing-source handling.

### 105. For `/changelog`, should Web UI default to showing new/current-version entries first, with a toggle to expand older/full changelog history?

**Recommended answer:** Yes.

**User answer:** yes

**Status:** resolved

**Notes:** Keeps the default changelog view compact and relevant while preserving access to full release history on demand.

### 106. For `/quit`, should `/quit` stop/close only the active Pi tab/RPC process, not shut down the whole Web UI server?

**Recommended answer:** Yes. Add a separate explicit “Shutdown Web UI server” action for whole-server shutdown.

**User answer:** yes

**Status:** resolved

**Notes:** Avoids surprising multi-tab/server shutdown from a tab-scoped native command; server shutdown should remain a separate explicit action.

### 107. For `/quit`, if the active Pi tab is the last remaining tab, should Web UI create/switch to a fresh idle tab instead of leaving the server with no tabs?

**Recommended answer:** Yes. `/quit` remains tab-scoped and should not implicitly shut down the Web UI server.

**User answer:** yes

**Status:** resolved

**Notes:** Keeps Web UI server usable after tab-scoped quit; avoids overloading `/quit` with whole-server semantics.

### 108. For `/quit`, if the active tab has a running agent response, active bash, or queued user input, should Web UI require confirmation and then abort/clear only that tab’s work before stopping it?

**Recommended answer:** Yes.

**User answer:** yes

**Status:** resolved

**Notes:** Confirmation protects active work; cleanup should remain tab-scoped: abort active agent/bash, clear queued user input for that tab, stop its RPC process, then close/replace the tab.

### 109. For `/hotkeys`, should Web UI show the native keybinding action IDs + effective bindings from Pi’s keybinding config, plus a separate Web/browser-specific section?

**Recommended answer:** Yes. Native parity should be based on action IDs/effective bindings; Web-only shortcuts should be clearly labeled separately.

**User answer:** yes

**Status:** resolved

**Notes:** Keeps `/hotkeys` aligned with user-configured Pi keybindings while separating browser/Web UI-only shortcuts from native action IDs.

### 110. For `/hotkeys`, should TUI-only or not-yet-supported actions still be shown, but labeled as TUI-only or not implemented in Web UI instead of being hidden?

**Recommended answer:** Yes. It makes parity gaps visible and keeps the hotkey table auditable.

**User answer:** yes

**Status:** resolved

**Notes:** Hotkeys table should be comprehensive and transparent: include TUI-only/not-yet-web-supported action IDs with explicit support labels instead of omitting them.

### 111. For native external editor parity (`Ctrl+G` / `$VISUAL` / `$EDITOR`), should Web UI implement a browser-native expanded editor modal instead of launching a server-side terminal editor?

**Recommended answer:** Yes. Browser Web UI should not spawn `$EDITOR`; use a large modal editor with save/cancel and shortcut parity where practical.

**User answer:** yes

**Status:** resolved

**Notes:** Browser-native modal avoids spawning arbitrary server-side editors from a web client while preserving the practical purpose of external editor parity: a larger focused compose/edit surface.

### 112. For the expanded editor modal, should Save replace the composer draft only, without sending automatically?

**Recommended answer:** Yes. Keep “edit” and “submit” as separate actions; `Ctrl/Cmd+Enter` may send from the composer after save.

**User answer:** yes

**Status:** resolved

**Notes:** Expanded editor should be a draft-editing surface, not an implicit submit path; this avoids accidental sends and preserves review before dispatch.

### 113. For the Extension TUI bridge, should Web UI prioritize semantic RPC/UI methods — status/working indicators, header/footer text, autocomplete, selectors/forms/loaders — before attempting arbitrary custom TUI component rendering?

**Recommended answer:** Yes. Semantic methods are safer, testable, browser-native, and likely cover most extension needs; generic custom rendering should be last resort.

**User answer:** yes

**Status:** resolved

**Notes:** Semantic bridge methods should be the first implementation target; arbitrary custom TUI component rendering remains a later fallback only if concrete extension needs cannot be covered semantically.

### 114. For extension UI bridge methods, should blocking interactions like `select`, `confirm`, `input`, and `editor` remain tab-scoped and pause only the originating tab’s run?

**Recommended answer:** Yes. Other tabs should stay usable; the blocked tab should show clear “waiting for user input” state.

**User answer:** yes

**Status:** resolved

**Notes:** Extension UI blockers should be scoped to the originating tab/session. The tab needs visible blocked state and resume/cancel handling; unrelated tabs must remain interactive.

### 115. For the Extension TUI bridge, should every new semantic UI method use a versioned JSON schema with explicit unsupported/degraded responses, instead of ad-hoc payloads?

**Recommended answer:** Yes. Versioned schemas make extension compatibility testable and let Web UI report parity gaps cleanly.

**User answer:** yes

**Status:** resolved

**Notes:** Use schema-versioned payloads/responses for semantic extension UI methods; unsupported/degraded states should be explicit so extensions can degrade gracefully and tests can validate compatibility.

### 116. For a future generic custom component protocol, should Web UI allow only sandboxed declarative schemas, not arbitrary extension-supplied browser JavaScript?

**Recommended answer:** Yes. Avoid arbitrary JS execution in the browser; use declarative components with strict validation and capability limits.

**User answer:** yes

**Status:** resolved

**Notes:** Future generic extension rendering must be declarative/sandboxed only. Do not execute extension-supplied browser JavaScript; validate component schemas and enforce explicit capability limits.

### 117. For blocking extension UI prompts, should pending dialogs be recoverable after browser reload/reconnect as long as the originating tab/RPC process is still waiting?

**Recommended answer:** Yes. Keep pending blocker state server-side and rehydrate the dialog for reconnecting clients.

**User answer:** yes

**Status:** resolved

**Notes:** Server-side pending blocker state makes extension UI robust across browser refresh/reconnect while the originating tab/RPC process remains blocked.

### 118. For non-blocking extension UI bridge state — status, title/header/footer text, widgets, working indicators — should Web UI scope it by tab + extension + run, and clear stale state on run end, reload, or tab stop?

**Recommended answer:** Yes. It prevents stale extension UI from leaking across tabs or surviving after the originating run is gone.

**User answer:** yes

**Status:** resolved

**Notes:** Non-blocking extension UI state should have explicit tab/extension/run ownership and lifecycle cleanup at run end, RPC reload/restart, or tab stop to prevent stale cross-tab UI.

### 119. For the P0 integration-test harness, should Web UI add fixture-driven server helper tests first, then lightweight local HTTP endpoint tests only where helper tests cannot cover behavior?

**Recommended answer:** Yes. Keep tests fast and deterministic, but still cover critical request/response paths for native commands, security guards, downloads, session import/delete, and tab-scoped actions.

**User answer:** yes

**Status:** resolved

**Notes:** Prioritize deterministic helper-level tests and add HTTP tests for behavior that depends on request semantics, auth/trust checks, downloads/uploads, or tab-scoped endpoint routing.

### 120. For the test harness, should RPC-dependent behavior be tested through a mock/fake RPC tab adapter instead of launching real `pi --rpc` processes in normal CI?

**Recommended answer:** Yes. Use fake adapters for deterministic CI; reserve real RPC/browser smoke tests for optional/manual verification.

**User answer:** yes

**Status:** resolved

**Notes:** Normal CI should avoid real RPC process flakiness by testing native-command/server behavior through fake tab/RPC adapters; real pi/browser coverage can be optional smoke/manual.

### 121. For documentation, should each implemented native-parity feature update both the user-facing docs and the parity matrix, including explicit `implemented / degraded / unsupported` status, security restrictions, and browser/mobile differences?

**Recommended answer:** Yes. Keep docs and parity status tied to implementation so gaps stay visible.

**User answer:** yes

**Status:** resolved

**Notes:** Documentation updates should be part of the feature definition of done: user-facing docs plus machine/auditable parity matrix with status, security, and browser/mobile differences.

### 122. For implementation rollout, should the native-parity work be merged behind feature flags/internal guards per command, instead of one large all-or-nothing release?

**Recommended answer:** Yes. Gate risky features like `/login`, `/share`, `/import`, `/quit`, and shell execution independently so partial parity can ship safely.

**User answer:** yes

**Status:** resolved

**Notes:** Use per-feature/command guards so risky native-parity surfaces can be enabled, tested, documented, or rolled back independently rather than bundling all parity work into a single release switch.

### 123. For guarded/disabled native features, should the command stay visible but return a structured unavailable/degraded card with reason, safety restriction, and enablement path?

**Recommended answer:** Yes. Do not hide parity gaps; make disabled features auditable and actionable.

**User answer:** yes

**Status:** resolved

**Notes:** Disabled/guarded native commands should remain discoverable and return adapter-shaped unavailable/degraded responses with reason, safety restriction, and how to enable or what dependency is missing.

### 124. For the feature flags/internal guards, should defaults be safe-off for high-risk features (`/login` API-key entry on non-localhost, `/share` remote publish, server shutdown, optional installs) and safe-on for low-risk read-only UI parity (`/changelog`, `/hotkeys`, selectors)?

**Recommended answer:** Yes.

**User answer:** yes

**Status:** resolved

**Notes:** High-risk features should default disabled or restricted unless trust/config requirements are met; low-risk read-only parity can be enabled by default to improve discoverability without expanding side effects.

## Agreed Decisions

- P0 is a hard gate: build a tested parity matrix, adapter shape, security model, and initial endpoint/helper test harness before P1 feature work.
- Parity matrix is a root machine-readable JSON source of truth with comprehensive native surfaces, strict status taxonomy, and test enforcement.
- Native-command adapter is server-authoritative; frontend dialogs are UX wrappers. Unsupported/guarded commands return structured status, reason, safety restriction, and next actions.
- Adapter responses support transcript cards, toast/events, tab metadata, downloads/open URLs, clipboard text, warnings/confirmations, refresh hints, and degraded/unavailable states.
- Sensitive commands/features (`/login`, `/logout`, `/share`, `/import`, server-path `/export`, `/quit`, optional installs) are confirmation/trust-boundary gated; high-risk defaults are safe-off.
- `/export` no-path creates browser HTML download via Web UI temp dir + short-lived opaque token; explicit paths write server-side only; JSONL copies active session file safely; overwrites require confirmation.
- `!cmd` includes bash output in LLM context; `!!cmd` excludes it. Bash cards are visible/transient then reconciled with persisted RPC `bashExecution`; one active bash per tab with FIFO queue and per-item cancellation.
- LAN-exposed Web UI may allow bash if intentionally exposed, but UI must warn that LAN clients can run shell commands.
- Bash during active agent run starts in parallel; persisted bash messages are deferred until the active agent run finishes to preserve transcript ordering.
- `Escape` aborts active bash; `Shift+Escape` aborts running bash and clears queued user bash only. Agent abort behavior remains tab-scoped.
- `/settings` eventually exposes all documented settings with `Runtime only`, `Global`, and `Project` scopes; effective source/value are visible; runtime-safe fields apply immediately; reload/restart-needed fields are labeled.
- Settings writes are atomic, create timestamped backups, and prune to the latest 3 backups per settings file. Advanced object/array settings use structured controls where practical plus JSON fallback validation.
- `/scoped-models` uses `Global`/`Project` only, defaults to effective source or Project, saves ordered explicit `provider/model` IDs, and supports advanced wildcard patterns with conversion warnings.
- Keyboard manager ships native defaults first, action-ID based, intercepts browser-reserved shortcuts while app-focused, and keeps app-level shortcuts active in the prompt textarea when safe.
- Shortcut specifics: `Ctrl+C` clears prompt only when no text is selected; no double-`Ctrl+C` quit initially; no double-Escape action initially; `doubleEscapeAction` remains visible as TUI-only in settings.
- `Alt+Up` restores queued steering/follow-up messages FIFO into composer with clear separators and best-effort attachment restore.
- Model/thinking shortcuts use server helpers: forward/back scoped/all model cycling with out-of-scope current model jumping to first/last; `Shift+Tab` uses RPC `cycle_thinking_level`.
- Display shortcuts: `Ctrl+T` maps to thinking visibility; `Ctrl+O` toggles global expansion for tool results/executions/user bash cards with browser-local persistence and per-card override until next global toggle.
- `/tree` implements native filter modes, temporary filter changes unless saved as default, dialog-local fold state/timestamps, append-only label changes, selecting user messages restores text into composer, and summarization remains explicit opt-in.
- `/resume` supports safe trash/noninvasive delete with confirmation, guards active current session deletion, warns for other open-tab sessions, uses append-only `session_info` rename metadata, named-only filter, sort modes, compact path display by default with toggle for full paths/cwd.
- `/import` validates JSONL header/version/basic entry shape before copy/switch, copies uploaded sessions into Pi's configured session directory, preserves original cwd metadata, and warns on cwd mismatch.
- `/share` initially produces local preview/export artifacts only; remote publishing remains unsupported until explicit provider/config/confirmation flow exists.
- `/share` defaults to user+assistant text only, omitting tool/bash outputs, metadata, and file paths unless explicit toggles include them; preview artifacts use temp dir + short-lived opaque token.
- `/login` supports all provider auth modes, including API keys, but API-key entry is allowed only in trusted contexts (localhost by default or explicit secure deployment), never plain LAN HTTP.
- `/login` API keys are one-shot masked submissions after provider picker and explicit save confirmation; keys are persisted only server-side via AuthStorage/auth.json and never stored in browser state, transcripts, logs, or URLs.
- OAuth/device-code login supports native callback steps (`onAuth`, `onDeviceCode`, `onSelect`, `onPrompt`, progress/manual code) via a server-driven browser dialog.
- `/logout` lists/removes only credentials Pi can remove from auth.json; env/config credentials are labeled not removable here; each provider logout requires confirmation and refreshes auth/model state after success.
- `/changelog` uses Pi's canonical changelog source, renders read-only in searchable/version-grouped dialog/card, and defaults to new/current-version entries with full-history toggle.
- `/quit` is tab-scoped: stops/closes only the active Pi tab/RPC process, not the Web UI server; last-tab quit creates/switches to a fresh idle tab; active work requires confirmation and tab-scoped cleanup.
- `/hotkeys` shows native keybinding action IDs with effective bindings plus separate Web/browser-specific section; TUI-only/not-yet-Web actions remain visible with labels.
- External editor parity uses a browser-native expanded editor modal instead of launching server-side `$VISUAL`/`$EDITOR`; Save only updates the composer draft and does not send automatically.
- Extension TUI bridge prioritizes semantic RPC/UI methods before arbitrary custom rendering; blocking interactions are tab-scoped; schemas are versioned with explicit unsupported/degraded responses.
- Future generic custom component protocol is declarative/sandboxed only, never arbitrary extension-supplied browser JavaScript.
- Blocking extension dialogs are recoverable after browser reload/reconnect while the originating tab/RPC process is waiting; non-blocking extension UI state is scoped by tab+extension+run and cleared on run end/reload/tab stop.
- Test harness uses fixture-driven server helper tests first and lightweight local HTTP tests where request semantics matter; RPC-dependent behavior uses fake/mock tab adapters in normal CI.
- Every native-parity feature updates both user-facing docs and parity matrix with implemented/degraded/unsupported status, security restrictions, and browser/mobile differences.
- Rollout is incremental with per-command/feature guards; disabled/guarded features remain visible and return structured unavailable/degraded cards.

## Open Risks

- Browser auth expands secret-handling surface; API-key support requires strict trusted-context enforcement, redaction, no logging, and clear deployment docs.
- Remote `/share` remains intentionally unsupported pending provider/config/privacy design; users may expect native gist behavior and need clear messaging.
- Full extension TUI parity depends on upstream RPC protocol additions; arbitrary TUI component parity may remain degraded until semantic schemas prove sufficient.
- Keyboard parity conflicts with browser/OS shortcuts and mobile keyboards; every shortcut needs accessible button/menu fallback and visible support labels.
- Session delete/import/rename are user-facing and potentially destructive; trash fallback, open-tab guards, validation, and tests are mandatory.
- Real RPC/browser behavior may diverge from fake adapters; optional smoke/manual checks are still needed before release.
- Feature flags can make docs/parity stale unless tests enforce matrix/status consistency.

## Next Decision Needed

No major design decision remains from the current plan; next step is implementation planning against the saved decisions, starting with P0 parity matrix, adapter shape, security guards, and test harness.
