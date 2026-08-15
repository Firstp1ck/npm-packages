# Development guide: Pi Web UI

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## File viewer image contract

`GET /api/files/content` keeps workspace-path confinement and the shared 2 MiB `FILE_VIEWER_MAX_BYTES` cap before reading either text or images. Text responses use `kind: "text"` with UTF-8 `content` and `language`. The explicit extension allowlist maps `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, and `.avif` to fixed MIME types; those responses use `kind: "image"`, `mimeType`, and base64 `data` without decoding the bytes as UTF-8. SVG and all unlisted binary formats continue to return `415` through the text/binary guard.

The browser accepts the same fixed MIME allowlist, creates an in-memory data URL, and renders it only in the dedicated `fileViewerImage` surface. Image viewer state is read-only with Source, Save, text search, and text-selection sending unavailable. Git opens may retain Changes mode and switch back to the image preview. Reset and non-image rendering remove the image element's `src` and alternative text so stale payloads are not retained in the DOM.

Focused contributor validation:

```bash
node --check public/app.js
node --check bin/pi-webui.mjs
node tests/file-viewer-image-static.test.mjs
node tests/git-panel-file-preview-static.test.mjs
node tests/file-viewer-search-static.test.mjs
node tests/http-endpoints-harness.test.mjs
```

## Main output loading feedback

Every `refreshMessages(tabContext)` call acquires its own object token in `mainOutputLoadingRequests` before requesting a transcript snapshot or delta and releases that exact token in `finally`. Visibility is derived only from tokens whose copied tab context still matches the active tab generation. This prevents an old tab response or one of several overlapping refreshes from hiding the current request’s status.

The transcript receives `aria-busy` immediately. The inline `#mainOutputLoading` status waits 120 ms before becoming visible, avoiding flashes on fast local responses while preserving polite assistive-technology state. It is a non-modal, pointer-transparent sibling of `#chat`; cached transcript content remains mounted and interactive. The global reduced-motion policy reduces its spinner to one effectively static iteration. Dedicated subagent output hides this main-transcript status.

Focused contributor validation:

```bash
node --check public/app.js
node tests/main-output-loading-static.test.mjs
```

The focused test protects DOM/ARIA semantics, tab-generation and overlap ownership, `try`/`finally` cleanup, non-modal styling, reduced motion, Sidebar placement, dedicated-subagent hiding, documentation, and browser/PWA cache revisions.

## Fenced code syntax highlighting

`public/syntax-highlight.mjs` is a dependency-free leaf module with no imports and no DOM access. It exports `MAX_SYNTAX_HIGHLIGHT_CHARACTERS` (50,000), `MAX_SYNTAX_HIGHLIGHT_LINES` (2,000), `SYNTAX_LANGUAGE_ALIASES`, `SUPPORTED_SYNTAX_LANGUAGES`, `normalizeSyntaxLanguage(language)`, and `tokenizeCode(code, language)`.

`tokenizeCode` returns an array of `{ type, text }` objects using a closed vocabulary: `plain`, `comment`, `keyword`, `function`, `variable`, `string`, `number`, `type`, `operator`, and `punctuation`. Twenty-three canonical profiles are driven by declarative data (keyword/type sets, comment prefixes, quote and section rules) plus dedicated bounded scanners for diff and markup. Alias lookup uses `Object.prototype.hasOwnProperty` so inherited names such as `constructor` or `__proto__` cannot resolve to a profile.

### Invariants

- **Source fidelity.** Concatenating every emitted token's `text` reproduces the normalized source string exactly. Adjacent same-type tokens are coalesced and empty tokens are never emitted. This keeps copy, transcript search, and text selection byte-identical to the previous plain rendering.
- **DOM safety.** `appendMarkdownCodeTokens` in `public/app.js` renders `plain` tokens as `document.createTextNode(...)` and every other token as `make("span", ...)`, which assigns `textContent`. No source string reaches `innerHTML`, `insertAdjacentHTML`, or `transcriptRenderer.replaceHtml`, so HTML-looking code such as `<img onerror=...>` stays inert text.
- **Bounded cost.** Tokenization is a single linear scan with no backtracking-prone regular expressions. Input above either cap returns one exact `plain` token, which bounds repeated re-tokenization of an open fence during streaming reconciliation.
- **Graceful fallback.** An unknown or missing language returns one exact `plain` token, so unrecognized fences render exactly as before.

### Integration points

`appendMarkdownCodeBlock` is the only call site; the Mermaid branch runs first and is unchanged. `applyTheme` maps the nine Pi theme syntax tokens (`syntaxComment` … `syntaxPunctuation`) to `--syntax-*` CSS custom properties, and `public/styles.css` colors `.markdown-code .syntax-*` from those variables with `var(--ctp-*)` fallbacks for the pre-theme paint. Because the module is imported eagerly by `public/app.js`, `/syntax-highlight.mjs` must stay in the service-worker `APP_SHELL`; `tests/syntax-highlighting-static.test.mjs` enforces that closure for every eagerly imported `./*.mjs` specifier.

### Testing

```bash
node tests/syntax-highlight.test.mjs
node tests/syntax-highlighting-static.test.mjs
```

`tests/syntax-highlight.test.mjs` covers all 23 profiles and 58 aliases with exact round-trip assertions, representative token classes, prototype-pollution-style alias names, malicious-looking markup source, non-string input, and exact/over-limit character and line boundaries. `tests/syntax-highlighting-static.test.mjs` covers renderer wiring, the absence of HTML sinks, theme-token mapping against `THEME_TOKEN_GROUPS`, CSS fallbacks, app-shell closure, asset/cache revision coherence, and documentation coverage. When changing browser assets, advance `styles.css?v=`, `app.js?v=`, and `CACHE_NAME` together; several static tests assert those exact values.

## Intercom conversation projection and viewer

`GET /api/intercom/conversations?tab=<tab-id>` projects bounded summaries from `SessionManager.getBranch()` for the selected server-owned session. Adding `conversation=<opaque-id>` returns one sanitized detail. Browser values never select a session path. The pure projector in `lib/intercom-conversations.mjs` accepts only structured generic Intercom records and matched native supervisor request/reply records, deduplicates protocol identities, excludes synthetic relays and attachments, and applies conversation/message/text/response bounds before serialization.

`lib/intercom-transcript-filter.mjs` is the separate normal-transcript boundary. After thinking recovery and before HTTP delta slicing, it removes structured `intercom_message` records, generic `intercom` tool-call parts, and results paired by explicit call ID or tool name. It copies only changed mixed assistant records and preserves unrelated meaningful content without mutating the RPC response. Live stream and execution guards in `public/app.js` prevent an Intercom card or event-log line from flashing before the filtered authoritative refresh; unrelated supervisor and tool activity keeps the existing path. The conversation endpoint still reads raw active-branch records independently.

`public/app.js` keeps only in-memory per-tab summaries. `refreshIntercomConversationSummaries` uses tab-generation and request-serial guards; `refreshIntercomConversationDetail` adds a separate serial plus a five-second open-dialog refresh. Switching tabs or closing the native dialog invalidates pending detail responses and cancels its timer. The renderer rebuilds message bubbles only from normalized `direction`, participant name/ID, text, and timestamp fields, assigning text with safe DOM APIs. It never renders server records wholesale. The footer tag group uses equal-width implicit grid columns for up to eight conversations, then applies a wrapped `minmax(44px, 1fr)` grid through the `dense` class for 9–32 conversations. Both modes avoid horizontal scrolling and keep shrinkable visual labels plus full `aria-label` and `title` values. Each reused button stores a compact label/count signature, so unchanged tags retain their children instead of retriggering the polite live region.

Focused contributor validation:

```bash
node tests/intercom-transcript-filter.test.mjs
node tests/intercom-main-transcript-suppression-static.test.mjs
node tests/intercom-tag-layout-static.test.mjs
node tests/intercom-conversations.test.mjs
node tests/intercom-conversations-http.test.mjs
node tests/intercom-conversation-viewer-static.test.mjs
node --check public/app.js
npx playwright test --project=chromium tests/browser/intercom-conversation-viewer.spec.mjs
```

The static viewer test covers singleton DOM/ARIA wiring, one-tag-per-ID rendering, endpoint scoping, summary/detail stale-response guards, open-dialog polling cleanup, safe text assignment, responsive reachability, asset revisions, and user/developer documentation. The Chromium flow exercises dialog focus restoration, safe peer/local bubbles, open-dialog refresh, Escape, and narrow composer-disclosure reachability against a persisted fixture session.

## Unified subagent observability

The server emits browser overview version 2 with `groups[]` (`tab` or `external`), each containing logical `runs[]` and canonical `agents[]`. Agent rows carry stable instance/run identity, launcher, provider, lifecycle status, capabilities, and an opaque output reference. Compatibility fields (`tabs`, `totalRuns`, `totalAgents`, `runningRuns`, `runningAgents`, and `totalGates`) remain during the v1 skew window. The browser prefers v2 groups and normalizes v1 tabs as a fallback.

Canonical lifecycle values are `queued`, `running`, `stale`, `lost`, `done`, `failed`, and `cancelled`. Launchers are `sdk`, `pi-rpc`, `pi-json`, `pi-print`, `interactive`, `tmux`, `pi-subagents`, `schedule`, `gate`, `workflow`, and `custom`. Counts use parent-scoped canonical instance IDs; groups, runs, workflow containers, and gate references are count-neutral. The browser recognizes the model-less `pi-subagents` `workflow` controller as a container projection, renders it with native `details`/`summary` disclosure semantics, and derives displayed counts from its child agents. Exact parent session identity maps an observation to a WebUI tab; all other valid instances are grouped as `external`.

Before accepting requests, the HTTP server snapshots inactive registry identities and filters the first canonical and v1 helper snapshots for each restored tab. Rows already stale, lost, or terminal in those startup snapshots stay suppressed; a later active transition releases that identity, and newly observed terminal rows remain available for same-generation inspection. This prevents restart replay from rematerializing old terminal views without deleting producer registry records or changing normal inspection and dismissal behavior.

The browser opens both overlay and view-only terminal modes through `GET /api/subagents/output?group=<group-id>&run=<run-id>&agent=<instance-id>`. Helper, session JSONL, structured event, plain-log, and metadata-only output dispatch stays server-owned. Mutations use the canonical group/run/agent selection and are checked against owner capabilities; no browser value is interpreted as a host path. Provider snapshots use the process-local `firstpick:webui-agent-runs:v1` event. SDK extensions may use `trackPiAgentSessionEventBus`, which owns only observation (not the session), emits complete canonical snapshots, heartbeats while running, and exposes bounded observation errors. In v1, a producer removal ID is producer-wide: it removes that instance ID across every parent scope owned by that producer. Cross-process records live in the scope-bound private registry. See `lib/agent-run-protocol.mjs`, `lib/agent-run-registry.mjs`, `lib/agent-run-adapters.mjs`, `webui-rpc-helper.mjs`, and the subagent aggregation/output handlers in `bin/pi-webui.mjs`.

Focused contributor validation:

```bash
node --check public/app.js
node tests/subagent-workflow-section-static.test.mjs
node tests/subagent-observability-static.test.mjs
node tests/mobile-static.test.mjs
node tests/agent-run-protocol.test.mjs
node tests/agent-run-registry.test.mjs
node tests/agent-run-adapters.test.mjs
node tests/agent-run-launcher.test.mjs
node tests/subagents-helper.test.mjs
node tests/subagent-reliability-integration.test.mjs
node tests/http-endpoints-harness.test.mjs
npx playwright test --project=chromium tests/browser/subagent-observability.spec.mjs
```

## Control Deck side-panel architecture

The durable interface envelope is schema version 2 and the private Web UI settings envelope is version 7. `layout.sidePanel` contains `placement`, atomic `sectionLayout` (`order` plus `leftSectionIds`), `collapsedSectionIds`, `hiddenSectionIds`, side-specific `collapsedPanels`, and side-specific `panelWidths`. Validation rejects unknown patch fields, duplicate section IDs, left IDs absent from the global order, invalid placements, and widths outside 320–4096 pixels. Version-1 reads migrate to right placement, no left assignments, right-only legacy collapse/width, and preserve every unrelated layout field; stale version-1 writes are rejected.

`public/index.html` owns one left shell, one central workspace wrapper, and one right shell. Each `[data-side-panel-section]` remains a singleton. `reconcileControlDeckHosts()` is the only desktop/combined owner: it derives Right/Left/Both/overlay presentation, moves canonical sections without cloning, rehosts singleton version/Edit/Open Issue chrome, and leaves latent side assignments unchanged. Sidebar tab placement remains orthogonal: Right puts the terminal rail before the chat and the Control Deck after it, Left reverses those sides, and Both retains both Control Deck shells with the terminal rail after the chat. The central `.workspace-column` independently composes chat, split terminal, and file viewer. Mobile Experience v2 may temporarily project canonical section content only while the combined Control Deck is closed; opening the canonical overlay unmounts that projection first.

The browser structural cache is `pi-webui-control-deck-layout-v2`. Updates are read-modify-write by named subfield. Storage events and server snapshots adopt only clean siblings; active section drag fences `sectionLayout`, active panel resize fences `panelWidths`, and dirty siblings remain local. New pending records use the v4 prefix and immutable record version 4. Startup also reads old v3 records and translates `sectionOrder`, `collapsedSectionIds`, `hiddenSectionIds`, and `collapsed`; the old key remains until the translated mutation is acknowledged. Revision-guarded PUTs retry one conflict. A right-width patch includes both v2 `panelWidths.right` and legacy `sidePanelWidth` in the same locked request; left width never writes the legacy mirror.

### Control Deck validation map

- `tests/control-deck-side-panels-static.test.mjs`: singleton DOM/ARIA, host reconciler, workspace/rail geometry, journal and field-aware cache contracts.
- `tests/side-panel-section-reorder-static.test.mjs`, `tests/side-panel-resize-static.test.mjs`, and `tests/persistent-ui-layout-static.test.mjs`: movement, workspace-facing resize handles, independent left/right width and collapse, pending, and reconciliation behavior.
- `tests/browser/control-deck-side-panels.spec.mjs`: placement matrix, right/left/both Control Deck resizing, Sidebar rail swapping and resizing, cross-side keyboard movement, independent collapse/width persistence, overlay, singleton ARIA, and reload.
- `tests/browser/persistent-ui-layout.spec.mjs`: schema-v2 server ownership, stale reads, failed writes, conflicts, cache clearing, and restart.

Run focused validation with `node --check public/app.js`, the static tests above, and `npx playwright test --project=chromium tests/browser/control-deck-side-panels.spec.mjs tests/browser/persistent-ui-layout.spec.mjs`. Run `npm run check` and `npm test` before integration acceptance.

1. `POST /api/update/plan` resolves moving release metadata once, records exact target versions, active runtime identities, proven owners, exact argument-array commands, refusals, and a SHA-256 plan digest in the private update journal.
2. The confirmation names that exact plan digest. `POST /api/update/apply` accepts only its `transactionId` and `planDigest`; it never accepts paths, commands, registries, versions, or `latest` from the browser.
3. Apply acquires the cross-process install lock, revalidates active identities, executes with whole-process-tree timeouts, re-reads every changed target, and records ordered receipts with `success`, `partial`, `failed`, or `rolled-back` outcomes.
The authenticated `GET /api/interface-preferences` response includes normalized `preferences`, versioned `layout`, and an opaque `layoutRevision`. `PUT /api/interface-preferences` remains compatible with width-only `{ "sidePanelWidth": 612 }` writes. Layout patches require the latest revision in `expectedLayoutRevision`, merge only named fields, and are limited to 32 KiB; stale revisions return `409`, unsupported media types `415`, oversized bodies `413`, and invalid or unknown fields `400`. The `terminalTabs` layout record owns tab placement, custom groups, and the bounded desktop `sidebarWidth`; the client journals those subfields independently so resizing cannot overwrite concurrent group or placement changes. Browser local storage remains a non-destructive compatibility cache. Semantic file moves, prompt attachments, and follow-up queue mutations are not stored in the interface-layout envelope.
Pi Web UI normally runs Pi RPC tabs under a narrow detached supervisor. Restarting only the HTTP Web UI—through `/webui-start` on the same URL, **Restart**, a successful **Update & restart**, `POST /api/restart`, or a restart-safe service-manager `SIGTERM`—preserves each managed Pi PID, tab identity, cwd, session file, running state, and active model turn. Output produced while the HTTP server is absent is replayed in supervisor order. The browser rejects duplicate or older replay records; if the bounded live buffer has a gap, it refreshes tabs, state, and the durable transcript from Pi and warns that buffered live output may be incomplete.
- Use `/webui-status detailed`, `GET /api/health`, or `GET /api/webui-status?detailed=1` for diagnostics. Public supervisor diagnostics are limited to enabled/attached state and managed-tab count; private credentials and paths are intentionally omitted. A browser warning about incomplete buffered output means authoritative tabs/state/messages were requested, not that missing live deltas were reconstructed.
- Use the side-panel **Stop** action or localhost-only `POST /api/shutdown` for an explicit full stop. Explicit tab close terminates only that managed Pi child; explicit shutdown and `SIGINT` terminate the scope's managed Pi children. Do not use restart/update when the intent is to terminate active work.
- Normal authenticated shutdown removes the private scope state. Do not manually delete runtime files, sockets, pipes, journals, or PID records while managed tabs may be live. For cleanup, explicitly shut down first, verify the Web UI/scope has no managed tabs, and let normal startup clean stale empty state; removing private state for a live supervisor destroys the safe attachment path and can risk duplicate processes.
- To opt out or roll back, first perform explicit shutdown and verify no managed tabs remain. Then set `PI_WEBUI_RPC_SUPERVISOR=0` and restart, or install the previous Web UI package before restarting. Never disable, downgrade, change the continuity port, or remove private runtime state while a supervisor still owns live tabs. Re-enable by removing the opt-out and starting normally; continuity begins for newly supervised Pi tabs.
Compact mode keeps live output lightweight, coalesces sustained live DOM/scroll flushes to at most once every 100 ms, preserves Markdown formatting for live and reconciled thinking, and displays only the current transient tool status as a compact labeled row with a state pill; each new tool or assistant delta replaces that status instead of retaining a tool-call history. Final reconciliation keeps visible thinking formatted and renders the final assistant response as Markdown while omitting intermediate tool calls, results, diffs, images, and raw details. The existing final `/api/messages` transcript remains authoritative. Compact mode does not change Pi generation, prompts, tools, models, providers, inference, stored transcript semantics, or the normal renderer.
- `PI_VOICE_STT_URL` enables a local STT endpoint for `POST /api/stt/transcribe`; Web UI forwards audio as multipart form data.
- `PI_VOICE_TTS_URL` enables a local TTS endpoint for `POST /api/tts/speech`; Web UI forwards `{ text, voice, format }` JSON.
- `PI_VOICE_STT_PROVIDER=groq|openai` selects hosted STT when no request provider is supplied; set `GROQ_API_KEY` or `OPENAI_API_KEY` server-side.
- `PI_VOICE_TTS_PROVIDER=openai` selects hosted OpenAI TTS when no request provider is supplied; set `OPENAI_API_KEY` server-side.
- `PI_VOICE_GROQ_STT_MODEL`, `PI_VOICE_OPENAI_STT_MODEL`, `PI_VOICE_OPENAI_TTS_MODEL`, `PI_VOICE_OPENAI_TTS_VOICE`, `PI_VOICE_OPENAI_TTS_FORMAT`, `PI_VOICE_TTS_VOICE`, and `PI_VOICE_TTS_FORMAT` tune fallback models/voices/formats.
- `PI_VOICE_PROVIDER_TIMEOUT_MS` controls outbound fallback-provider timeout. API keys are never sent from the browser; remote/LAN raw-audio STT uploads must include explicit per-request microphone-streaming consent.
- Pathless `pi-webui` startup: the server opens first, then the browser prompts for the first terminal CWD.
- Multi-tab Pi sessions with isolated processes, working directories, prompt drafts, activity state, per-tab settings, and a workspace dashboard for common actions.
- The Subagents side panel includes a separate **Agent models** editor above the live monitor. It stores WebUI-owned launch slots for the eight builtin roles (`context-builder`, `delegate`, `oracle`, `planner`, `researcher`, `reviewer`, `scout`, and `worker`): every role keeps a non-removable base slot, while added same-role slots copy a model/thinking draft but retain independent stable IDs. Choose **User default** or **This project**; projects inherit user defaults until saved, and **Use user defaults** removes a project override. Select `Default / inherit` to inherit both values, or an active-tab provider-qualified model and its supported thinking levels. Saves are revision-checked and localhost-only; saved assignments guide only future delegation after **Reload active tab**, never running children. The configuration form has independent load/draft/error state, so its controls are not reset by live subagent monitoring.
- Tracked subagent output can open in the existing non-blocking overlay/widget or in a dedicated **Subagent** terminal tab, selected from the Subagents side-panel section and saved in the browser. The side-panel monitor keeps each status dot, agent type, provider/model, thinking effort, and run action on one compact line; a model-less `pi-subagents` workflow controller becomes a collapsible run header with its child-agent rows nested beneath it and excluded from agent counts. Run IDs, source/mode, elapsed state, and current-tool details live in the selected output view instead of being duplicated inline. Subagent tabs are view-only, reuse the bounded live transcript at the normal full terminal width, show the pulsing **Agent is running:** card with current child activity, and close without stopping or interrupting the child run; use the parent terminal for interaction. Dedicated **Subagent** terminal tabs show exactly six telemetry cards: PI, measured token speed, context, model, effort, and input/output tokens from a bounded recent session scan; unavailable or legacy evidence remains `—` or `unknown` rather than an estimate. The package also registers a generic `subagent_gate` tool that launches task slots through pi-subagents RPC v1, enforces a required success quorum, and performs bounded reason-aware retries only when declared safe; the side panel retains gate quorum, attempt, provider, and failure-class history after children finish.
- Subagent payload v1 normalization preserves only the public recovery contract: `source: "recovered"`, boolean `provisional`/`controllable`, and fleet `version`/`totalActive`/`omitted` aggregates. Raw fleet entries, prompts, and paths are not copied to the HTTP overview. Canonical v2 gives a recovered provisional row an opaque helper-owned, read-only output handle so the browser can open its bounded metadata view; the response explicitly marks detailed output unavailable until a run locator is observed. Cancel, dismiss, clear-finished selection, and retained terminal materialization remain blocked. Legacy v1 fallback rows remain status-only. Browser overview refreshes use one shared in-flight promise plus a queued bit; any refresh request received during a request guarantees a trailing fetch before the promise settles, including timer, visibility-resume, cancel, and dismiss callers. `tests/subagents-helper.test.mjs` and `tests/subagent-reliability-integration.test.mjs` cover recovery privacy, read-only openability, interaction gating, static rendering contracts, and overlapping-refresh state.
- Unified command palette (`Ctrl/Cmd+K`) for commands, tabs, models, sessions, settings, app controls, and frequent Web UI actions.
- Automatic tab naming from the first prompt, with `--name <name>` still available for an explicit initial tab name.
- Opt-in branch-aware session titles and Markdown summaries through `/summary` and `/summary-setup`, with a dedicated background model, private persistent setup, silent post-settlement updates, explicit-name protection, optional latest-only context injection, and a non-blocking Web UI overlay.
- Streaming chat transcript with Markdown, syntax-highlighted fenced code blocks, copy buttons for fenced code blocks, rendered Mermaid diagrams from fenced `mermaid`/`mmd` code blocks, thinking output, tool/bash cards, queue and compaction events, edit-and-retry from user prompts, transcript search, copy buttons, and guarded abort controls that require holding Esc or the Abort button for 3 seconds. An accepted RPC prompt releases browser routing ownership immediately; canonical Pi streaming state then owns the running indicator. This lets background extension commands such as `/release-npm` settle without a stale agent card, and a successful abort releases the same routing ownership before state reconciliation.
- Prompt composer with uploads, drag/drop/paste, inline image support, generated text attachments for long input or clipboard text, editable text attachments, slash-command autocomplete, and `@` file/path references with live suggestions.
- Leading `!` and `!!` user-bash commands from the composer, serialized per tab; `!` keeps output in the next model context and `!!` excludes it. When the optional `@firstpick/pi-extension-bang-command-autocomplete` companion is loaded, the browser composer also suggests `!`/`!!` shell commands through `GET /api/bang-suggestions?tab=<tabId>&query=<command>`. When the optional `@firstpick/pi-extension-fish-user-bash` companion is loaded, Web UI user-bash execution emits the Pi `user_bash` event so the companion can provide the selected shell backend.
- Optional Natural Conversation Mode shell for the standalone `@firstpick/pi-package-natural-conversation` package: when `/talk` (or `/voice`/`/conversation`) is loaded in the active Pi tab, Web UI shows per-tab Start/End controls, a read-only voice-mode chip, and backend guards that keep thinking `off` while blocking unsafe Web UI actions.
- Browser voice loop for Natural Conversation Mode (`public/voice-conversation.mjs`): while the mode is active in a tab, the browser's Web Speech APIs listen for speech, send final transcripts as normal prompts, and speak Pi's final answers. The microphone pauses while answers are spoken (echo prevention), speech during final-output streaming becomes a steering interruption, speech during tool execution is queued until the tool phase ends, and silence after a spoken question sends a single structured silence event. Remote (non-localhost) sessions keep the microphone off until the per-tab `Allow remote microphone streaming` consent is granted; only text transcripts ever reach the Pi host on the browser-default path. Opt-in server-side fallback routes are available for local/Groq/OpenAI STT and local/OpenAI TTS when configured with server-side env vars; remote/LAN raw-audio STT fallback uploads require explicit per-request consent.
- Browser-native Pi dialogs for `/model`, `/settings`, `/summary-setup`, `/safety-guard-setup`, `/git-workflow-setup`, `/theme`, `/fork`, `/clone`, `/name`, `/resume`, `/tree`, `/login`, `/logout`, `/scoped-models`, `/tools`, and `/skills`, plus an on-demand `/summary` Markdown overlay and native-command adapter output for `/copy`, `/session`, `/new`, `/compact`, `/reload`, and `/export`. Safety Guard Setup includes the opt-in auto-review toggle and active-tab authenticated model/supported-thinking selectors; auto-review remains off by default, and enabled saves reject unavailable selections.
- Runtime `/tools` and `/skills` selectors backed by the hidden Web UI RPC helper, with explicit **Session only** and **Global default** scopes. Session choices persist on the current branch and take precedence; global defaults are inherited by future sessions without rewriting existing branches. Disabled skills are removed from the system prompt, and tracked `SKILL.md` files can be opened/edited from skill tags. Responsive fitting keeps visible and hidden tag sets disjoint; the `+X` disclosure renders the hidden set in an upward, bounded popup and preserves selection, outside-dismissal, `Escape`, and focus-return behavior.
- Session resume/switch, metadata rename, and localhost-only safe delete with active/open-tab/session-directory guards.
- Model, thinking, session, workspace, theme, optional-feature, Codex usage, optional Remote WebUI, update/restart/stop, event, notification, thinking-visibility, terminal-tab-layout, and custom-background controls in collapsible side-panel sections.
- A side-panel **Git** section mirrors the repositories represented by every open terminal tab/group. Repository cards are shown directly—without session-name parent disclosures—and always use the Git-root or cwd basename as their title. One repository can be expanded at a time. First/stale expansion refreshes local status after a five-minute cache window, while live filesystem updates use a debounced server watcher and SSE invalidation to refresh visible repositories without periodic Git polling or an automatic network `git fetch`. Its compact Changes tree groups conflicted, staged, modified, and untracked paths with additions/deletions; right-click a repository, folder, or file (or press Shift+F10/the Context Menu key) for View Diff, refresh, stage/unstage, and confirmed discard/delete actions. History lists the latest 30 commits and opens bounded read-only commit diffs.
- Persistent context-window meter with manual compact and auto-compaction controls near the composer; side-panel thinking changes made while a tab is busy are queued for the next prompt.
- Side-panel theme picker backed by optional `@firstpick/pi-themes-bundle` themes plus Pi-native project/global custom themes. **Customize…** provides all 51 required color tokens, variables, optional `thinkingMax`/export colors, synchronized advanced JSON, valid-only live preview, scope badges, and explicit target-bound overwrite confirmation.
- Per-tab cwd changes, a clickable footer cwd picker, directory creation/search in the picker, saved path fast picks, server-persisted fast picks, and restart-safe restoration of open tabs. When the optional stats and git-footer companions are loaded, clicking the footer **PI** token metric dispatches `/calibrate` in the background and refreshes the metric after the isolated calibration sample is recorded.
- Detected app runner dropdown for the active tab cwd, including Cargo, Bun, npm/npx/pnpm, Python/uv, Go/Golang, Zig, C/C++, Docker Compose, root/dev/scripts shell scripts, and other common project runners with live output pinned at the top of the terminal. Stream chunks pass through a terminal-line reducer: LF/CRLF commit scrollback, bare CR replaces the current live line, backspace edits that line, and ANSI sequences remain intact for the browser's safe SGR renderer. This is line-oriented terminal behavior rather than a full VT100 cursor grid. Running app runners expose line-oriented stdin in the widget for interactive scripts. Projects can add browseable custom runners in `.pi-webui-runners.json` with a command (default `./`) plus a relative path to the file to run. The same dialog also configures project discovery paths: project-relative directories that are scanned one level deep (no subdirectories) for `.sh`, `.bash`, `.zsh`, `.fish`, and `.py` files plus extensionless files with a bash/sh, zsh, fish, or Python shebang. Python candidates use `uv run` and/or the available `python3`/`python` interpreter. Discovered scripts extend the built-in root, `dev/`, `scripts/`, and `dev/scripts/` detection and run from the resolved project root.
- Guided Git workflow for existing repos and new repos with persistent model/reasoning preferences, review-first staging, an optional manual staged repository-review gate from `aur-review`, generated or typed commit messages, explicit push/PR confirmation, and optional PR worktrees. When the review extension is loaded/enabled, both `git add .` and accepting the current staged set send `/aur-review start --scope staged --origin guided-git` to the same tab. Only its matching approval advances to message generation. The browser and server recheck the approved domain-separated staged-content hash before message generation, commit, and PR-worktree transfer; drift, missing hashes, or hash-check errors return to Stage and require a new review. A decline returns to staging and rejects an unchanged declined staged hash until corrected content is restaged. Guided Git never stages, commits, or pushes remediation automatically. The extension remains the decision authority; direct API callers are not granted an approval by this browser workflow.
- Browser support for Pi extension UI prompts, widgets, status updates, `/btw` side-question output widgets with optional context transfer/live steering, browser notifications when a tab needs an extension UI response, and an optional side-panel toggle for agent-done notifications.
- Localhost-only exact Pi/Web UI update plans with digest-bound confirmation, fail-closed owner refusals, cross-process locking, durable receipts, side-by-side managed Web UI candidates, stable pointer-aware launch, changed-boot-identity reconnect, and automatic health-gated rollback. Combined plans also include update-available Pi-registered optional packages and retain per-package partial receipts. A separate verified Pi executable delegates to that exact executable's self-updater and fails verification if it does not reach the confirmed version; managed targets remain strictly pinned. The former broad package-root scan and `pi update --all`/fallback mutation path is disabled.
- Feedback reactions (`👍`, `👎`, `?`) on final assistant output plus tool/bash action cards, which can ask Pi to create or update a LEARNING.
- Mobile-friendly layout, PWA install support where the browser allows it, backend-offline recovery, and a dedicated server-restart overlay while confirmed restart/update actions run.
Web UI keeps a packaged parity matrix at `lib/WEBUI_TUI_NATIVE_PARITY.json` and exposes it at `GET /api/native-parity`.
Discovery-path rules: at most 24 paths and direct children only (no recursive walk). Shell discovery supports `.sh`, `.bash`, `.zsh`, `.fish`, and matching extensionless shebang files. Python discovery supports `.py` and extensionless Python-shebang files, exposing `uv run` and/or the available `python3`/`python` interpreter. Required interpreters must be installed locally; duplicates and built-in overlaps do not duplicate menu entries. Absolute, drive/UNC, `..`, null-byte, missing, non-directory, or symlinked-outside-the-project paths are rejected. Stale or invalid stored paths surface diagnostics in the dialog instead of being scanned. `POST /api/app-runner-config` accepts either `{ "runner": { ... } }` or `{ "searchPaths": [...] }` (not both in one request) and preserves the other field.
- `GET /api/health` and `GET /api/webui-status?detailed=1` for server health, network exposure, tabs, sessions, models/providers, update state, and recent events.
- `GET /api/tabs`, `POST /api/tabs`, `PATCH /api/tabs/<tabId>`, and tab close/delete routes for multi-tab lifecycle management.
- `GET /api/messages?tab=<tabId>&since=<index>` for transcript snapshots or delta refreshes.
- `POST /api/prompt`, `POST /api/follow-up`, `POST /api/steer`, `POST /api/bash`, `POST /api/abort`, and `POST /api/abort-bash` for tab-scoped Pi interaction.
- `POST /api/attachments` for uploaded/generated prompt attachments and inline images.
- `GET /api/path-suggestions?tab=<tabId>&query=<path>` for `@` file/path references with live suggestions.
- `GET /api/bang-suggestions?tab=<tabId>&query=<command>` for optional `@firstpick/pi-extension-bang-command-autocomplete` `!`/`!!` command suggestions.
- `GET /api/path-fast-picks` and `POST /api/path-fast-picks` for server-persisted cwd fast picks.
- `GET /api/native-parity` for the packaged native TUI/Web UI parity matrix.
- `GET /api/settings`, `POST /api/settings`, `GET /api/tools`, `POST /api/tools`, `GET /api/skills`, and `POST /api/skills` for browser-native Pi settings/tool/skill selectors.
- `GET /api/safety-guard/config` and `POST /api/safety-guard/config` for browser-native persisted Safety Guard Setup. The tab-scoped `GET` includes authenticated models plus a per-model supported-thinking map; `POST` validates the effective enabled auto-review selection before writing.
- `GET /api/skill-file` and localhost-only `POST /api/skill-file` for guarded `SKILL.md` editing from tracked skill tags.
- `GET /api/sessions`, `GET /api/session-tree`, `POST /api/switch-session`, `POST /api/session-rename`, and localhost-only `POST /api/session-delete` for resume/tree/session metadata flows.
- `GET /api/auth-providers` and localhost-only `POST /api/auth-logout` for provider-auth status and stored-credential removal.
- `GET /api/app-runners`, `POST /api/app-runner`, `POST /api/app-runner/input`, `POST /api/app-runner/stop`, `GET/POST/DELETE /api/app-runner-config`, and `GET /api/app-runner-files` for detected and custom project runners. `POST /api/app-runner-config` replaces project discovery paths with `{ "searchPaths": [...] }` or saves a custom runner with `{ "runner": { ... } }`; invalid path submissions fail atomically and leave the stored configuration unchanged.
- `GET /api/git-root`, `GET /api/git-panel`, and `GET /api/git-commit?hash=<full-hash>` for compact per-terminal-group repository discovery, local status/history snapshots, and bounded read-only commit diffs. `POST /api/git-changes/stage-all` and `POST /api/git-changes/unstage-all` complement the guarded path-level staging routes.
- Authenticated `GET`/`PUT /api/session-summary/preferences` for the allowlisted persistent profile projection and confirmed saves, plus authenticated `POST /api/session-summary/generate` for active-tab `/summary` dispatch. Mutations require same-origin JSON and bounded bodies; authenticated remote clients are allowed by the approved summary policy.
- `GET /api/git-changes`, `POST /api/git-changes/pull`, `GET /api/git-branches`, `POST /api/git-branch`, and `/api/git-workflow/*` for browser Git status, diff, branch, init, commit, push, and PR helpers.
- `POST /api/action-feedback?tab=<tabId>` for feedback on final assistant output and action cards.
- `GET /api/optional-features` for the cached revisioned startup-audit snapshot, including phase, sanitized source/state, summary, reconnect-safe progress, and restart disposition.
- Localhost-only `POST /api/optional-feature-install` for installing or updating one known optional companion through Pi.
- Localhost-only `POST /api/optional-feature-install-batch` for a bounded allowlisted `featureIds` batch. It requires the current audit `revision`, installs sequentially, reports ordered per-feature and aggregate results, and accepts `migration: true` for the combined restore flow.
- Localhost-only `POST /api/optional-feature-migration/recheck` for a bounded read-only audit and `POST /api/optional-feature-migration/dismiss` for persisted **Later** state.
- `GET /api/git-workflow/staged-content?tab=<tabId>` for the read-only bounded staged-content hash used by Guided Git approval binding.
- `GET /api/update-status`, localhost-only `POST /api/update/plan`, `POST /api/update/apply`, `GET /api/update/transactions/<transactionId>`, and `POST /api/update/rollback` for exact planning, digest-bound apply, durable receipts/status, and confirmation-bound rollback. Legacy `POST /api/update` and `POST /api/component-update` mutation return `410 Gone`.
- `GET /api/network`, localhost-only `POST /api/network/open`, localhost-only `POST /api/network/close`, `GET /api/remote-auth`, `POST /api/remote-auth`, and localhost-only `POST /api/remote-auth/settings` for trusted-LAN exposure and optional 4-digit PIN authentication when serving non-local browser clients.
On hosts with WebKit's system libraries installed, provision it and include its project explicitly with `npx playwright install webkit && PI_WEBUI_TEST_WEBKIT=1 npm run test:browser`. The browser suite is intentionally separate from `npm test`; it covers browser-only geometry, flag/rollback, and scoped axe checks without making ordinary Node/static tests download browser engines.
When enabled, each click obtains a fresh Turnstile token and UUID-v4, then posts only `{ schemaVersion, idempotencyKey, turnstileToken, issue }` to `POST /v1/submissions`. `issue` is the selected structured wizard state (`categoryId`, `componentId`, `templateId`, `summary`, and declared fields); editable canonical title/body, repository, labels, verdicts, callback URLs, and credentials are never sent. The returned status capability remains only in an opaque in-memory refresh handle for the open dialog. Nothing in this flow uses `localStorage`, `sessionStorage`, cookies, or draft persistence.

## Preserved detailed implementation reference

Local browser UI for [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

Pi Web UI gives you a local browser companion for Pi: multi-tab chat, streaming output, model controls, uploads, slash-command helpers, workspace navigation, and optional extension widgets.

> **Security:** Pi Web UI can control the spawned Pi session and run anything that session is allowed to run. It binds to `127.0.0.1` by default. Trusted-LAN opening/closing and Remote PIN auth controls are owned by the optional `@firstpick/pi-package-remote-webui` companion; when enabled, Remote PIN auth persists for later Web UI starts.

## Requirements

- Node.js `>=22.19.0`
- Pi installed and configured
- A modern browser with Server-Sent Events support

## Install

Install the package into Pi:

```bash
pi install npm:@firstpick/pi-package-webui
```

Restart Pi after installation so the Web UI commands are loaded.

## Start from Pi

Run this inside Pi:

```text
/webui-start
```

Open the printed URL, usually <http://127.0.0.1:31415/>. The command opens your browser automatically unless you pass `--no-open`.

Check a running Web UI with:

```text
/webui-status
/webui-status detailed
```

### `/webui-start` options

```text
/webui-start [port] [options] [-- <pi args...>]
```

```text
  [port]             Port shortcut
  --host <host>      HTTP bind host (default: 127.0.0.1)
  --port <port>      HTTP port (default: 31415)
  --no-open          Do not open the browser automatically
  --no-session       Start Pi RPC with --no-session
  --name <name>      Initial Web UI tab name
  --remote-auth      Enable startup PIN authentication for non-local clients
  --no-remote-auth   Disable startup PIN authentication
  -- <pi args...>    Extra arguments forwarded to Pi RPC
```

Examples:

```text
/webui-start
/webui-start 31500
/webui-start --port 31500 --no-open
/webui-start --remote-auth --host 0.0.0.0
/webui-start --name browser -- --model anthropic/claude-sonnet-4-5:high
```

Running `/webui-start` again on the same URL restarts the HTTP server. By default, supervised Pi tabs—including an active model turn—continue in their original Pi processes and reconnect to the replacement server; session-file restoration remains the fallback when no managed tabs exist.

### `/webui-status` options

```text
/webui-status [detailed] [port] [--port N] [--host HOST]
```

`/webui-status` reports the URL, online state, network exposure, and Remote PIN auth state. `detailed` adds tabs, sessions, models/providers, and recent backend events.

### Transactional Pi and Web UI updates

The **Pi** and **Web UI** version tags still show `available`, `running`, `succeeded`, or `failed`, but every mutation now uses one server-owned transaction path:

Ownership is fail-closed. Source, linked, pnpm, Yarn, opaque, nested, and unknown installations produce bounded manual guidance and are not mutated. The removed legacy updater no longer scans agent, project, npm-global, or Bun-global roots. Only localhost may create, apply, or roll back a transaction.

The installed package is a stable bootstrap. A Web UI candidate installs side-by-side under `<PI_CODING_AGENT_DIR>/webui/runtimes`, runs a side-effect-free candidate probe, and is selected through private atomic `current.json`/`previous.json` pointers. A separate activation helper switches the pointer, restarts through the stable launcher, waits at least 90 seconds for the expected version and a changed per-boot identity, and automatically restores the previous pointer when health fails. The live RPC supervisor remains separate; an incompatible supervisor with healthy managed work still fails closed.

Restart descriptors use a private owner-readable random file, are read and deleted once, and support up to 256 descriptors. Startup retries transient `EADDRINUSE` with bounded backoff. Retention preserves current, previous, locked, journal-referenced, and recent healthy runtimes; zero downtime is not promised, but automatic rollback restores the previous reachable runtime after a bounded interruption.

## Standalone CLI

Use the CLI when you want to start the Web UI without first opening terminal Pi:

```bash
npm install -g @firstpick/pi-package-webui
pi-webui
```

```text
pi-webui [options] [-- <pi args...>]
```

```text
  --host <host>       HTTP bind host (default: 127.0.0.1)
  --port <port>       HTTP port (default: 31415)
  --cwd <path>        Start the first Pi terminal in this working directory
  --pi <command>      Pi executable to spawn (default: bundled dependency, then "pi")
  --no-session        Start Pi RPC with --no-session
  --name <name>       Initial Web UI tab name
  --remote-auth       Enable startup PIN authentication for non-local clients
  --no-remote-auth    Disable startup PIN authentication
  --output-mode <mode>  Web UI output default: normal or compact-v1
  --migrate-optional-features  Migrate audit-selected legacy optional features
  --migration-dry-run  Print the startup migration plan without package mutation
  -h, --help          Show help
  -v, --version       Print version
```

If `--cwd` is omitted, the server starts first and the browser asks for the first terminal CWD.

Examples:

```bash
pi-webui
pi-webui --cwd ~/src/my-project
pi-webui --host 0.0.0.0 --remote-auth --cwd ~/src/my-project
pi-webui --port 3000 -- --model anthropic/claude-sonnet-4-5:high
pi-webui --output-mode compact-v1
PI_WEBUI_PI_BIN=/path/to/pi pi-webui --no-session
```

Environment variables:

- `PI_WEBUI_HOST` and `PI_WEBUI_PORT` set the default bind address.
- `PI_WEBUI_PI_BIN=/path/to/pi` selects the Pi executable when `--pi` is not passed.
- `PI_WEBUI_REMOTE_AUTH=1` starts with Remote PIN authentication enabled.
- `PI_WEBUI_OUTPUT_MODE=normal|compact-v1` sets the server default for newly auto-negotiated browser connections.
- `PI_WEBUI_RPC_SUPERVISOR=0` opts out to the legacy server-owned Pi transport only when the current scope has no live managed tabs. Use explicit shutdown before disabling or downgrading; fallback startup refuses to create duplicate direct children for a live managed scope.
- Pi Web UI automatically injects a loopback `PI_WEBUI_RECOVERY_URL` and a bearer `PI_WEBUI_RECOVERY_TOKEN` into spawned Pi RPC processes. Managed RPC children receive a lower-privilege credential derived from the private supervisor token, so retained tabs stay authorized across server-only restarts without persisting another secret. The authenticated endpoint can only create a separate plan-only recovery tab; keep any manually supplied token private.
- `PI_WEBUI_SETTINGS_FILE=/path/to/settings.json` authoritatively overrides the private Web UI settings file (normally `~/.pi/webui/settings.json`) and disables automatic import from the old XDG location.
- `PI_SESSION_SUMMARY_CONFIG_FILE=/path/to/session-summary.json` overrides the private session-summary profile (normally `~/.pi/agent/session-summary.json`), primarily for isolated tests or managed deployments.
- `PI_WEBUI_FAST_PICKS_FILE=/path/to/paths.json` overrides saved cwd fast-pick storage.
- Optional feature install/update actions use the selected Pi executable (`--pi` or `PI_WEBUI_PI_BIN`) so registration and package storage stay owned by Pi.
- `--migrate-optional-features` is the explicit unattended opt-in for migrating every audit-selected legacy companion sequentially. Migration never starts implicitly from an environment variable.
- `--migration-dry-run` prints the sanitized startup audit/migration snapshot and performs no optional package or settings mutation. If both migration flags are supplied, dry-run wins.
- `PI_BANG_AUTOCOMPLETE_INCLUDE_HISTORY=1` lets optional bang-command autocomplete include local fish/bash/zsh history executables.
- `PI_BANG_AUTOCOMPLETE_RUNTIME_STORE_PATH=/path/to/runtime.json` overrides the runtime store shared with `@firstpick/pi-extension-bang-command-autocomplete`.

### Persistent session titles and summaries

The package registers `/summary` and `/summary-setup` in native Pi and explicitly loads the same extension in each Web UI tab. The feature is opt-in: loading the package makes no summary-model request until setup is reviewed and confirmed. Setup defaults to `openai-codex/gpt-5.6-luna` with `low` reasoning when that authenticated model is available; it never silently falls back to another provider or model.

`/summary-setup` selects the dedicated model/reasoning level, automatic generation, generated-title behavior, editable title and Markdown-summary prompts, and optional latest-summary context injection. Preferences are stored privately in `~/.pi/agent/session-summary.json`. The immutable code-owned system instruction is not editable. The browser exposes the same profile through **Common Pi options → Session Summary Setup**; the first Summary-button click opens setup, and confirmed setup immediately generates the first result.

After each true settled agent turn, enabled automatic generation runs as a bounded background request without starting another agent turn or delaying Pi's settled state. It sends active-branch user text, final assistant text, and tool names only. Thinking, images, tool arguments/results, credentials, hidden metadata, and previous summary control/display entries are excluded. One validated JSON response supplies both a title candidate and Markdown summary. Requests have a 90-second limit, no automatic retry, and a five-minute automatic-failure cooldown; manual **Refresh** may retry after the underlying problem is corrected.

Successful summaries are append-only, branch-aware Pi session state. Native `/summary` shows basic Markdown output. Web UI automatic updates remain silent; its header/composer Summary action opens a non-blocking sanitized Markdown overlay with copy and refresh controls. The last successful result survives provider, timeout, parse, and stale-branch failures. Generated names never overwrite explicit `/name`, `--name`, or browser tab names. The first eligible generated title applies immediately; later changed candidates require the configured cadence (three settled user turns by default) and the title prompt tells the model to retain the name unless the primary goal or scope changed substantially.

Main-agent context injection is off by default. When explicitly enabled, exactly one latest active-branch summary is added ephemerally as reference-only data; historical, display, and RPC summary messages are filtered out. Authenticated remote Web UI clients may configure and trigger summaries after the same privacy/cost confirmation. No credentials, raw transcript, or provider payload is returned through the summary HTTP APIs. To pause recurring calls without deleting prompts or prior results, turn off **Generate automatically** in setup. To roll back operationally, keep it off and use `/summary` only when needed.

#### Workspace Session Summaries and Peer Coordination

The extension exposes `/summary workspace` and the agent-facing `workspace_session_summaries` tool to discover summaries from other Pi sessions in the same canonical working directory.

- **Live Transport & Availability:** When the optional `pi-intercom` extension bus is present, connected same-CWD peers exchange summaries over namespace `firstpick/session-summary/v1` without transcript pollution or model turns. When pi-intercom is absent or disconnected, the feature falls back to read-only persisted session discovery and explicitly reports that live peer status is unavailable.
- **Privacy & Safety:** The shared projection never includes raw transcript entries, thinking, images, tool arguments/results, provider payloads, or session-file metadata. Before live publication and display, bounded generated-summary prose is redacted for recognized credential families, labelled secret/token values, private-key blocks, and Unix/Windows session paths. Because generated prose is free text, detection cannot prove that every semantically sensitive string is a credential; treat connected same-user, same-CWD peers as the local trust boundary and avoid placing secrets in prompts or summaries.
- **Coordination Semantics:** Tool output and guidelines instruct agents to compare semantic overlap across goals, files/symbols, decisions, and next steps, and to coordinate via `intercom` before performing writes when material overlap exists or ownership is unclear. Summaries never send automatic messages, apply locks, or assign ownership automatically.

Troubleshooting:

- If the configured model or authentication is unavailable, run `/login` or choose another explicitly available model in `/summary-setup`; the previous successful result is retained.
- A malformed or unsupported future config fails closed and is never overwritten automatically. Correct or move the private config, then rerun setup.
- In `--no-session` mode, generation can work in memory but is reported as non-durable.
- `/summary refresh` or the overlay **Refresh** action forces a bounded manual update without provider fallback.
- `/summary workspace` displays same-canonical-CWD workspace summaries from active live peers and persisted session files.

### Optional-feature startup audit and migration

Every Web UI server start performs one bounded, read-only startup audit of optional features before the first normal Pi RPC tab starts. HTTP diagnostics and the browser are available immediately: the persistent status surface shows **Checking optional features…** and elapsed time while the browser reads the server-owned cached snapshot. The browser never scans package directories or Pi settings itself. A successful audit reports a truthful **Core ready · N optional features ready** summary and automatically dismisses that non-actionable confirmation after five seconds; actionable, degraded, and failed states remain visible until resolved. Fresh minimal installs and upgrades whose companions are already registered or enabled as top-level resources require no confirmation.

When an older bundled Web UI feature needs restoration, the banner offers **Migrate…** and **Later**. **Migrate…** opens the single combined confirmation—there is no separate review screen. Previously enabled features are preselected, previously disabled features and features disabled in this browser are not, and the expandable **Choose features** area can adjust the batch. **Later** persists the dismissal so the migration banner does not return on every server start; a non-blocking **Migrate…** action remains in the Optional features panel.

Confirmed installs run one at a time through the selected Pi CLI. Progress is server-owned and reconnect-safe: the UI reports `Installing N of M: <name>`, elapsed time, ordered per-package results, and bounded localhost installer-output tails without inventing percentages. A browser refresh or SSE reconnect fetches the current cached snapshot rather than restarting the operation. Partial failure preserves successful rows and provides **Retry failed** plus **Copy commands**. On full success, an idle affected tab restarts automatically with a visible notice. If it is busy, work is not interrupted and a deferred **Restart tab** action appears.

Duplicate package/top-level ownership is never loaded twice. The audit safely excludes the top-level copy, and the conflict alert names only source kinds (`Pi package` and `top-level resource`), never raw host paths. **Copy recommended fix** copies the safe ownership recommendation: keep the registered package canonical, disable/remove the duplicate top-level extension/skill/prompt/theme alias, then **Recheck**. The current backend intentionally exposes no browser mutation route for alias removal.

Troubleshooting:

- **Recheck** reruns the bounded read-only audit after a timeout, malformed settings fix, or manual ownership repair. Degraded mode keeps the minimal core usable while optional companions stay excluded.
- **Retry failed** reruns only failed migration packages; successful registrations remain intact. **Copy commands** copies exact allowlisted `pi install npm:<package>` commands for manual host-side diagnostics.
- `pi-not-found`, permission, network, timeout, and post-install verification failures remain per-package terminal states with an actionable hint and bounded output tail.
- A stale confirmation is rejected with `409`; the browser silently refetches and retries when the candidate set is unchanged, or reopens the same combined confirmation when choices materially changed.
- Remote authenticated browsers may view sanitized audit status but cannot start installs, migration, dismissal, or recheck mutations; perform those actions from localhost.

### Persistent interface settings

Pi Web UI stores user-scoped settings in `~/.pi/webui/settings.json` by default. When that file is absent, a valid prior `$XDG_CONFIG_HOME/pi-webui/settings.json` (or `~/.config/pi-webui/settings.json`) is imported once without modifying or deleting the old file. An existing new file always wins, including when it is malformed, and `PI_WEBUI_SETTINGS_FILE` remains isolated from this migration. Writes use a private same-directory temporary file, atomic replacement, and a bounded same-host process lock; newly created settings files and directories use private permissions on supported platforms.

### Durable Pi session continuity

Continuity is scoped to the resolved private Pi agent/config root and Web UI port. A replacement server must use the same root and port; changing ports creates a different scope and does not migrate active tabs. The supervisor communicates only over per-user local IPC (an owner-private Unix-domain socket on POSIX or a local named pipe on Windows) with a private random credential and incarnation fencing. Runtime state and metadata are private (`0700` directory and `0600` files on POSIX), bounded, and secret-key sanitized. Supervisor credentials, IPC paths, and raw private state are not exposed to browser APIs, server diagnostics, logs, or Pi child environments.

Updates preserve already-running supervised Pi processes, so an active tab continues with the Pi/runtime code it already loaded. Newly created or explicitly reloaded tabs use the newly installed versions. Additive supervisor protocol-minor changes are compatible; a protocol-major mismatch with live children fails closed instead of replacing the supervisor or spawning duplicates. Roll forward to a compatible Web UI rather than killing a healthy supervisor that owns active work.

Continuity deliberately excludes app runners: restart and update stop their process trees, and they must be started again after reconnection. It also does not preserve browser drafts, SSE connections, arbitrary extension memory, or an active request across supervisor failure, OS reboot, power loss, or machine restart. Session files can still restore durable transcript history after those failures, but they cannot resume the same in-flight model request.

### Compact live output mode

Normal output is the default. In the sidebar, open **Controls → Output processing**, select **Compact**, and click **Apply**. The same persisted server default is also available under **Settings → Browser workflow → Output processing**. Alternatively, set `--output-mode compact-v1`, `PI_WEBUI_OUTPUT_MODE=compact-v1`, or `outputModeDefault` directly. Precedence is explicit CLI flag, then environment variable, then the persisted setting, then `normal`.

The browser negotiates `compact-v1` per EventSource connection (`outputMode=auto&outputModeProtocol=1`), so normal and compact clients can share one Pi tab. A browser only enables compact handling after the protocol-1 acknowledgement; an older server gets one normal-mode reconnect instead. The server default applies only to `auto` clients, and active auto streams change representation at a semantic boundary.

The included compact-mode metric measures deterministic post-parse serialized JSON byte-work only (`R + 2×S`) and semantic parity; it does not claim wall-clock improvement, lower DOM CPU, reduced network latency, or higher model token/s.

### Codex subscription Fast mode

The optional `@firstpick/pi-extension-codex-fast-mode` companion adds `/fast-mode` and a **Normal / Fast** selector under **Codex Usage**. Fast mode is off by default and scoped to the active Pi session branch. The browser asks the extension to change mode and renders the extension-published `codex-fast-mode` status; it does not inspect ChatGPT credentials or rewrite provider requests itself.

When enabled, the extension marks only subscription-backed `openai-codex` requests using `openai-codex-responses` with `service_tier: "priority"`. Supported models may respond about 1.5× faster while spending 2× Standard credits for GPT-5.4 or 2.5× for GPT-5.5/5.6. Upstream account and model eligibility remains authoritative. Mode changes are blocked while the active tab is busy, and disabling the optional feature turns Fast mode off before hiding its integration.

## Main features

### Custom themes

Open **Controls → Interface → Theme → Customize…** to start from the current browser theme. The responsive dialog exposes visual controls for Pi’s exact 51 required theme tokens and optional `thinkingMax`, variables, export colors, and advanced JSON. Valid edits stay synchronized and preview immediately; malformed JSON, invalid values, missing variables, and cycles remain editable but do not replace the last valid preview and cannot be saved.

Preview is temporary: it does not write local storage, a theme file, Pi settings, or the browser’s Light/Dark slots. **Cancel** (including Escape) restores the opening WebUI theme, scheme presentation, meta color, and that theme’s custom background. **Reset draft** returns to the initial editor draft without changing saved settings. Light, Dark, and Auto continue to behave exactly as the normal theme picker defines them; only an explicit normal picker choice uses the existing persistent selection path.

Save destinations are server-derived:

- **This project** writes `<active trusted cwd>/.pi/themes/<name>.json` and is disabled unless Pi has a saved trusted-project decision for that active tab.
- **Global themes** writes `<PI_CODING_AGENT_DIR>/themes/<name>.json` (normally `~/.pi/agent/themes/<name>.json`).

An existing same-scope target requires a second confirmation naming the exact scope and file. Changing the draft, name, or destination invalidates that confirmation; a changed-on-disk file is not overwritten from stale confirmation. Bundled and opposite-scope name collisions are rejected. Saving refreshes the WebUI catalog and adds a **Project** or **Global** badge, but deliberately does not select the theme or mutate Pi/browser settings. To use the file in Pi TUI, run `/reload` or restart Pi, then choose the custom theme with `/theme`; no disruptive reload is triggered automatically.

## Native Pi command coverage

| Status | Commands and behavior |
| --- | --- |
| Implemented | `/model`, `/settings`, `/summary`, `/summary-setup`, `/safety-guard-setup`, `/git-workflow-setup`, `/tools`, `/skills`, `/copy`, `/name`, `/session`, `/clone`, `/logout`, `/new`, `/compact`, and `/reload` use browser-native dialogs, the summary overlay, or structured native-command cards. |
| Degraded / browser-specific | `/theme` changes the browser Web UI theme only; `/scoped-models` points to the footer scoped-model picker; `/export` supports no-path HTML downloads plus explicit new `.html`/`.jsonl` server paths; `/hotkeys` lists Web UI shortcuts; `/fork`, `/tree`, `/login`, and `/resume` have browser flows with documented gaps. |
| Unsupported in Web UI | `/import`, `/share`, `/changelog`, and `/quit` return structured unavailable output instead of raw HTTP errors. |

Sensitive native flows use shared trust-boundary guards: localhost-only APIs, trusted-context checks for LAN clients, confirmation-oriented dialogs, and session-directory confinement for session file operations.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Open the command palette. |
| `Ctrl/Cmd+L` | Open the model selector. |
| `Ctrl/Cmd+P` / `Shift+Ctrl/Cmd+P` | Cycle scoped or available models forward/backward. |
| `Shift+Tab` | Cycle thinking effort. |
| `Ctrl/Cmd+T` | Toggle thinking-output visibility. |
| `Ctrl/Cmd+O` | Toggle global expansion for tool and bash output cards. |
| `Alt+Enter` | Queue the composer as a follow-up. |
| `Alt+Up` | Restore the latest observed steering/follow-up queue snapshot into the composer. |
| hold `Esc` | Abort active user bash first, then active agent work. |
| `Ctrl/Cmd+C` in an empty, focused composer | Clear the prompt. |
| `Ctrl/Cmd+F` | Search the transcript. |

## Interface reference

Product screenshots are maintained in the [user-facing README](README.md#feature-gallery). The notes below preserve detailed behavior for contributor reference. Unless noted otherwise, actions apply to the active tab and its current working directory.

### Main window

- **What it is:** The primary Web UI workspace for Pi, with terminal tabs, chat transcript, live assistant output, footer metrics, prompt composer, attachments, and side-panel controls in one browser view.
- **What you can do:** Run multiple Pi sessions, send prompts or follow-ups, monitor tokens/cache/cost/context/git/model state, attach files, launch quick actions, and control the active session without returning to the terminal.

### Workspace dashboard

- **What it is:** The project home base for an active Web UI tab, combining cwd, model, context, git, queue, session, and activity status.
- **What you can do:** Start or resume work, verify the tab is pointed at the right project, jump into common session/workspace actions, and spot queued or active work before prompting.

### Control panel

- **What it is:** The side rail for Web UI state and settings, including model, thinking effort, session/workspace controls, theme, optional companions, Remote WebUI, updates, notifications, and usage widgets.
- **What you can do:** Change model or effort, compact/manage sessions, toggle notifications, check or install optional packages, run confirmed updates/restarts, and manage remote/PIN controls when the remote companion is loaded.

### Working-directory picker

- **What it is:** A browser-native cwd chooser used at first launch and for per-tab working-directory changes.
- **What you can do:** Search and browse project paths, choose recent or saved directories, create a new directory, and start or move a Pi tab into the selected workspace.

### App runners

- **What it is:** A project runner detector for common stacks plus browseable custom runners and project discovery paths from `.pi-webui-runners.json`.
- **What you can do:** Launch dev servers, tests, builds, scripts, and custom commands from the active cwd, pass arguments, watch pinned live output, and send line-oriented stdin to interactive runners. Windows runners use ConPTY through the optional `node-pty` dependency so Bash/Node scripts receive a real TTY; set `PI_WEBUI_APP_RUNNER_PTY=off` to force the pipe fallback.
- **Project discovery paths:** The app-runner dialog stays reachable even when nothing is detected, so you can add extra directories to scan for shell and Python scripts. Paths are project-local and relative to the resolved project root (`.` means the project root itself), are browseable from the dialog, and are saved beside custom runners.

`.pi-webui-runners.json` uses a backward-compatible version 2 shape; a missing `searchPaths` array simply means no extra directories are scanned:

```json
{
  "version": 2,
  "searchPaths": ["tools", "ops/scripts"],
  "runners": [
    { "id": "start-dev", "label": "Start dev", "command": "./", "path": "dev/scripts/start.sh", "args": [] }
  ]
}
```

### Queue manager

- **What it is:** The queue surface for follow-up prompts, steering messages, user bash work, and loaded prompt lists while a tab is busy or ready.
- **What you can do:** Create or load prompt lists, run batches when supported, see pending queued messages, and decide whether prompts sent during an active run should steer the current agent or wait as follow-ups.

### Thinking effort picker

- **What it is:** A browser picker for Pi's model thinking/reasoning effort setting.
- **What you can do:** Switch between `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, confirm the effective effort in the footer, and tune speed/cost/quality before sending a prompt.

### Scoped models

- **What it is:** A Web UI editor for `/scoped-models`, project/global model scope rules, and model cycling order.
- **What you can do:** Search available models, enable or disable scoped entries, inspect the effective model source, and save model choices so future prompts and tabs use the intended provider/model.

### Tools setup

- **What it is:** A browser-native `/tools` setup dialog for active and available Pi tools.
- **What you can do:** Search tools, inspect descriptions and availability, then use **Session only** to change the current branch immediately or **Global default** to save the tool allowlist inherited by future sessions.

### Skills setup

- **What it is:** A browser-native `/skills` setup dialog for skills available in the active Pi tab.
- **What you can do:** Find skills by name or description, then use **Session only** to change automatic invocation on the current branch or **Global default** to save the skill allowlist inherited by future sessions.

Session-specific choices always win when their branch is resumed or selected in `/tree`. Saving a global default does not mutate currently open sessions. Global defaults are stored in the Pi Web UI settings file (normally `~/.pi/webui/settings.json`).

### Optional features

- **What it is:** A Pi package manager for Web UI-aware extensions, prompts, themes, and optional dashboards. Optional companions are separate from the Web UI core install.
- **What you can do:** See whether each companion is enabled, disabled, registered, local, migratable, missing, conflicting, or updateable; use separate **Enable/Disable** and **Setup** actions for configurable loaded companions; keep per-row Install/Update actions; restore previous companions through one combined confirmation; use panel-level **Install all** or section-level **Install missing** for missing/unregistered packages only; and recover partial failures with **Retry failed** or **Copy commands**. Native questionnaires read and update the active session's real `questionnaire` tool state, while **Setup** opens the complete session/global Tools Setup dialog. Batches run sequentially through Pi, continue after individual failures, and auto-restart an idle affected tab while deferring **Restart tab** when it is busy.

### `/btw` side questions

- **What it is:** A Web UI widget for the optional `/btw` side-question extension, keeping quick questions separate from the main agent flow.
- **What you can do:** Ask short side questions without derailing the main chat, inspect live output, steer or stop the side thread, and transfer useful context back into the main prompt when needed.

### Guided Git workflow

- **What it is:** A guided browser workflow for staging changes, generating commit messages, committing, pushing, and optionally creating a pull request.
- **What you can do:** Run the stage/message/commit/push steps, choose generated short or long commit messages, type a manual message, create or confirm PR branch names, review generated PR text, and push only after confirmation.

### Git branch picker

- **What it is:** A footer branch picker backed by the active tab's current Git repository.
- **What you can do:** View the current branch/repo, switch local branches, create and switch to a new branch, and get warnings when a branch change could affect active agent work.

### Git diff viewer

- **What it is:** A browser diff dialog for current Git changes in the active workspace.
- **What you can do:** Review staged, unstaged, untracked, and incoming changes; jump between files; see additions/deletions with line numbers; and inspect text previews before asking Pi to edit, commit, or create a PR.

### Codex usage

- **What it is:** A side-panel usage widget for Codex-family subscription-backed models.
- **What you can do:** Refresh usage, monitor short-window and weekly limits, see reset timing, and decide whether to switch models or delay large prompts.

### Pi stats dashboard

- **What it is:** The browser overlay from the optional stats companion, summarizing token, cost, cache, prompt/context, model, session, and command usage.
- **What you can do:** Filter by time range, refresh analytics, review daily/model/session breakdowns, inspect cost and cache behavior, and calibrate prompt estimates for more accurate local usage visibility.

Useful browser endpoints exposed by the local server include:

For local development, run the checkout helper directly, for example:

```bash
./dev/scripts/start-webui.sh --dev --cwd /path/to/project
```

The `--dev` helper checks this checkout's local npm dependencies before launch, applies available local updates, and force-refreshes `@earendil-works/pi-coding-agent` to the latest npm version so stale bundled Pi runtime packages do not break extension loading. Set `PI_WEBUI_DEV_SKIP_UPDATE=1` to skip this preflight for offline or intentionally pinned local testing.

### Browser checks

The package-owned Playwright/axe harness starts the real `pi-webui` server with the hermetic fake-Pi fixture. Provision the pinned engines once, then run the suite:

```bash
npx playwright install chromium
npm run test:browser
```

When developing a companion package from this workspace, register that package with Pi from its absolute local path (for example, `pi install /path/to/pi-extension-stats`) and reload the affected native Pi/Web UI tabs. Optional companions are resolved from Pi settings rather than the Web UI manifest.

## Optional companion packages

Installing `npm:@firstpick/pi-package-webui` installs the Web UI core only; optional companions are independently registered Pi packages. Web UI tabs load enabled resources resolved from normal Pi settings, while excluding the Web UI package itself from re-loading. Startup checks loaded Pi capabilities directly through RPC-visible commands, tools, themes, and live widget events. The side panel separately reports physical installation and Pi registration, plus enabled top-level resources. A companion already enabled through `~/.pi/agent/extensions`, `skills`, `prompts`, or `themes` is treated as locally available and is excluded from install batches; attempting to register its npm package is blocked because both paths would load the same resource twice. Legacy/hoisted package files without either a Pi settings entry or an enabled top-level resource remain installable so Pi can register them canonically.

Use a per-row **Install** or **Update** action for one package. **Install all** selects every missing/unregistered feature, while each section's **Install missing** selects only missing/unregistered features in that group; neither bulk action installs updates. A batch has one confirmation, runs sequentially, continues after failures, and keeps bounded diagnostics in each row and the activity log. The server automatically restarts an idle affected tab after full success; a busy tab is never interrupted and instead exposes one deferred **Restart tab** action. All browser install and migration actions are localhost-only and limited to the server allowlist.

You can install any published companion separately from a terminal with its exact unpinned Pi source, then reload Pi/Web UI tabs:

```bash
pi install npm:@firstpick/pi-extension-stats
```

Replace the package name with the companion listed below. Re-running the same `pi install npm:<package>` command is the supported update path. `@firstpick/pi-extension-aur-review` is not published yet; from this workspace, use `pi install /home/firstpick/pi-coding-agent-forge/pi-extension-aur-review` until its npm source becomes available.

Optional companions:

- `@firstpick/pi-package-natural-conversation` — standalone `/talk` Natural Conversation Mode package. Web UI does not import or load it directly; it detects the package through RPC-visible `/talk`, `/voice`, or `/conversation` commands and renders the optional shell only for tabs where those commands are available.
- `@firstpick/pi-extension-bang-command-autocomplete` — `!`/`!!` shell-command autocomplete. Native Pi TUI autocomplete still uses the companion provider; Web UI uses its own browser endpoint because RPC autocomplete providers do not reach the browser composer.
- `@firstpick/pi-extension-fish-user-bash` — fish/user-shell backend for `!`/`!!` user bash. Web UI emits Pi `user_bash` from the RPC helper so the companion can supply shell operations before default bash execution.
- `@firstpick/pi-extension-btw` — ephemeral `/btw` side-question command with a TUI overlay, Web UI live output widget, and Transfer Context action.
- `@firstpick/pi-prompts-git-pr` — guided Git commit/push workflow.
- `@firstpick/pi-extension-release-npm` — NPM publish menu and release widgets.
- `@firstpick/pi-extension-release-aur` — AUR publish menu and release widgets.
- `@firstpick/pi-extension-aur-review` — Deterministic manual repository/Git review with working-tree standalone snapshots, staged Guided Git snapshots, and a specialized browser card. Install from `/home/firstpick/pi-coding-agent-forge/pi-extension-aur-review` locally for now; npm installation is valid only after publication.
- `@firstpick/pi-extension-workflows` — `/workflow` runtime with non-blocking Web UI subprocess-output widgets.
- `@firstpick/pi-extension-feature-system-prompt` — feature-request classification and routing, with lightweight/complex decisions shown in the Web UI composer.
- `@firstpick/pi-extension-safety-guard` — configurable guardrails for dangerous bash commands and protected file edits, with native `/safety-guard-setup` controls.
- `@firstpick/pi-extension-setup-skills` — TUI `/skills` setup command alongside WebUI-native skill toggles.
- `@firstpick/pi-extension-todo-progress` — todo-progress rendering.
- `@firstpick/pi-extension-tools` — TUI `/tools` active-tool manager alongside WebUI-native tool toggles.
- `@firstpick/pi-package-remote-webui` — `/remote` trusted-LAN QR helper plus the optional browser controls for opening/closing LAN access and Remote PIN auth.
- `@firstpick/pi-extension-git-footer-status` — richer extension-owned git/footer status, including the structured Web UI footer payload.
- `@firstpick/pi-extension-stats` — stats commands and status data.
- `@firstpick/pi-themes-bundle` — Web UI and Pi theme resources.

## Guided Git workflow

The Git workflow button runs local git commands in the active Pi working directory. It covers both empty/new projects and existing repositories.

Before first use, run `/git-workflow-setup` in Pi or choose **Common Pi Options → Guided Git Setup** in the browser. Select an exact authenticated `provider/modelId`, a supported reasoning effort, and the workflow defaults described below. The browser preselects the active tab model when possible, but saving is always explicit. Preferences are stored globally in the Pi Web UI settings file (normally `~/.pi/webui/settings.json`), not in browser storage.

For a new project, the browser flow can:

1. Run `git init` when the active cwd is not yet a repository.
2. Check for `README.md` and `.gitignore`.
3. Create and stage starter `README.md`/`.gitignore` files without overwriting existing files.
4. Create an initial commit.
5. Rename the branch to `main`.
6. Add a GitHub remote from a confirmed `owner/repo`.
7. Push the initialized branch when you confirm the remote target.

For an existing repository, the workflow can:

1. Show staged, unstaged, untracked, and fetched incoming changes.
2. Fast-forward pull fetched incoming commits when the repository is safely behind.
3. Review/select files, preserve a non-empty staged set, or explicitly opt into `git add .`.
4. Generate `/git-staged-msg` with the configured model, supported reasoning effort, language, and scope policy, then restore the tab's prior model/effort. Each request is correlated to its originating tab and a before-generation snapshot of both message files; the browser advances only when both non-empty files are fresh and stable for that exact generation.
5. Use the preferred generated short/long message, a generated single-file default such as `updated file.txt`, or a manual **Commit input** message.
6. Show an optional pre-commit verification reminder, then require explicit confirmation before push and PR delivery actions.

The saved setup includes:

- one generation profile reused for commit messages, branch names, and PR descriptions;
- English or German output, short or long default commit choice, and automatic/never/required Conventional Commit scope;
- review/select (recommended), preserve-staged, or explicit stage-all behavior;
- ask/current-branch/PR-worktree delivery highlighting; and
- optional pre-commit verification reminders.

If the configured model or effort is unavailable, generation stops and asks you to update setup; it never silently substitutes another model. Footer and Guided Git pushes send the active tab's current `HEAD` to the same-named branch on the preferred remote and set that branch as the upstream instead of retaining a potentially mismatched upstream. Guided Git never force-pushes automatically. Git hooks and signing configuration continue to run normally.

After the message is generated, **Create PR** asks Pi to generate `dev/COMMIT/staged-branch-name.txt`, lets you confirm or edit the `type/feature-name` branch, then switches with `git switch -c` before committing. In PR mode, choose **Commit short**, **Commit long**, or type a message and use **Commit input**, then **Push and Create PR** pushes the branch, sends `/pr`, shows the generated `dev/PR/<branch>.md` description for editing/confirmation, and creates the pull request with `gh pr create`. Use **Manual branch** to skip agent branch-name generation and type the branch directly.

Use the workflow process buttons to jump directly to **Initialize**, **Stage**, **Message**, **Commit**, **Push**, or PR steps when earlier work was already completed manually. Selecting **Message** lets you either run `/git-staged-msg` or type a commit message and use **Commit input** directly. Selecting **Commit** loads the current generated files from `dev/COMMIT/` before enabling the commit choices. Manual preview remains available for existing files, while an active generation uses bounded single-flight polling so duplicate timer, reconnect, and `agent_end` signals cannot race or surface a stale pair. A yellow dot means that process was selected or is available but its action has not completed in this workflow; green means the process action completed.

This requires `/git-staged-msg` and `/pr` from `@firstpick/pi-prompts-git-pr`; branch-name generation uses `/git-branch-name`. Creating the PR also requires an authenticated GitHub CLI (`gh`). Review the generated commit message, branch name, remote URL, and PR description before committing, pushing, or creating a PR.

## Open Issue bot

The **Open Issue** Control Deck action always keeps **Copy complete issue** available. Automated submission is intentionally disabled by default and sends no request unless a deployment supplies the public configuration below before `app.js` loads. These are public routing values only—never put a Cloudflare secret, OpenAI key, GitHub App credential, status capability, or repository-write token in this object.

```html
<script>
  window.__PI_WEBUI_ISSUE_BOT_CONFIG__ = Object.freeze({
    enabled: true,
    gatewayBaseUrl: "https://issue-intake.example.com",
    turnstileSiteKey: "public-turnstile-site-key",
    privateSecurityReportUrl: "https://github.com/OWNER/REPOSITORY/security/advisories/new"
  });
</script>
```

Replace the disabled object in the deployed `public/index.html`, or inject the same object in the hosting HTML before the package's default configuration block. The client accepts only an HTTPS gateway/base URL without credentials, query, or fragment; a syntactically invalid or incomplete configuration fails closed and leaves the button disabled. `turnstileSiteKey` and the private-report URL are public values. The configured intake must allow the exact WebUI `Origin`; do not use a wildcard CORS policy. If a Content Security Policy is present, permit `https://challenges.cloudflare.com` for the Turnstile script/frame requests as documented by Turnstile.

The dialog shows queued/checking/created/rejected/review/unavailable/unknown status in a persistent live region. It polls the capability endpoint with bounded exponential delays (initial server delay, capped at 10 seconds) for at most two minutes, then offers **Refresh status** rather than continuing in the background. Closing the dialog aborts Turnstile, admission, or polling. A created result must be a validated `https://github.com/<owner>/<repo>/issues/<number>` link and opens with `noopener noreferrer`. Sensitive-content outcomes show only the configured private-report destination; the wizard never echoes the submitted security text. Rejection, review, unavailable, unknown, and polling-timeout paths retain the copy fallback.

Keep this browser configuration disabled until the gateway's exact-origin CORS policy, Turnstile hostname/action checks, private reporting URL, staging canary, quotas, and both gateway kill-switch decisions have passed review. Browser enablement does not bypass `ISSUE_BOT_ADMISSION_ENABLED` or `ISSUE_BOT_CREATE_ENABLED`; production creation remains a separate operator approval.

## Mobile and PWA notes

- The mobile composer starts as a compact `Ask Pi…` input and grows as you type.
- The flagged phone experience is opt-in with `?mobileShell=v2`; use `?mobileShell=legacy` for the immediate rollback. It provides labelled **Chat**, **Sessions**, **Activity**, and **Project** destinations, plus a full-height **More** surface. Sessions preserve the existing tab switch/draft/SSE behavior; Activity and Project reuse the existing blocker, workflow, file, Git, queue, and settings actions rather than creating mobile copies.
- **Essential** and **Detailed** in More only change phone presentation and progressive disclosures. They never truncate final answers, remove safety/scope/remote warnings, enable `compact-v1`, or change stored transcript/model output. The phone action sheet keeps attachments, queue, session actions, voice entry, and a tap-confirm Abort path available without nested menus.
- Continuity is browser-scoped: text drafts, the selected destination, and bounded attachment metadata survive reloads. Attachment bytes are never persisted; restored chips say **Reselect required**. A send that the server did not confirm is never replayed automatically and exposes only manual **Retry** (with the original request identity) or **Discard**.
- **Add Context** unifies Camera, Photos, Files, and Paste text over the existing attachment path. Camera/photo permissions remain browser-controlled and are requested only after the user chooses that source; Files and Paste text remain fallbacks.
- Browser notifications cover blockers, completion, and failure only while a Web UI client/service worker is active. They carry versioned opaque tab/run/blocker targets and reconcile server state before navigation. This is not Web Push after every client closes; Activity is the in-app fallback.
- Tablet adaptation is independently opt-in at 721–1050 CSS px with `?tabletShell=v2`; use `?tabletShell=legacy` to roll it back without changing the phone flag. It uses a destination rail, a bounded right inspector, pointer-aware targets, and full-screen files by default.
- Installable PWA support, blocked-tab browser notifications, and optional agent-done notifications require browser service-worker/notification support and usually require `localhost` or HTTPS. Install education is contextual and dismissible; browser/PWA use is never blocked.
- Plain `http://<LAN-IP>` can show the app, but some browsers disable PWA install and notifications there. None of these features changes the existing remote-access/authentication model.

## Network safety

- Default bind is localhost-only: `127.0.0.1:31415`.
- When `@firstpick/pi-package-remote-webui` is loaded and enabled, the side-panel **Remote WebUI** controls dispatch through `/remote`: opening rebinds the server to `0.0.0.0`, shows LAN URLs when available, and toggles to "Close for network".
- The optional **Remote PIN auth** toggle is off by default on first use. When enabled through `/remote auth on` or the Remote WebUI controls, the server saves that preference, generates a fresh random 4-digit PIN for each server start, shows it in the Remote WebUI controls and `/webui-status`, and requires it from non-local browser clients.
- Localhost clients stay frictionless and can toggle Remote PIN auth through the remote companion; changing the toggle persists the preference and disconnects existing event streams so remote clients must re-authenticate after enablement.
- `--host 0.0.0.0` also exposes the Web UI to the local network; pass `--remote-auth` to start with PIN auth already enabled.
- Any connected browser client with access (and the PIN, if enabled) can control Pi and run Web UI bash actions as the Web UI process user.
- Remote PIN auth is a simple trusted-LAN HTTP gate, not hardened multi-user authentication; do not expose it to untrusted networks.
- The Web UI update endpoint is restricted to localhost, because it runs package update commands and restarts the server.
- Treat Pi Web UI as a local companion, not a hardened multi-user web service.

## Troubleshooting

- **`/webui-start` is missing:** restart Pi after installing the package.
- **Wrong port or existing server:** use `/webui-status detailed`, or start on another port with `/webui-start --port 31500`.
- **Optional feature is disabled, missing, or unregistered:** check the side panel, use its Pi install action (or manually run the displayed `pi install npm:<package>` command), then run `/reload` in the active Pi tab.
- **Pi install/update fails:** copy the bounded row diagnostics and displayed Pi command. Run that command on the Web UI host to inspect full Pi/npm output and verify that the selected Pi executable can update user package settings.
- **Remote browser asks for a PIN:** read it from the optional **Remote WebUI** side-panel controls, `/webui-status`, `/remote status`, or the local Web UI server log. Disable the toggle from localhost to remove the PIN gate.
- **PWA install or notifications are unavailable:** use `localhost` or HTTPS; browser support varies on LAN HTTP URLs.

## Update safety

Pi and Web UI updates are planned before they run. The confirmation identifies the exact planned versions, and the update is rejected if that plan becomes stale. Web UI updates keep the previous working version available and restore it automatically when the new version does not become healthy.

## Session continuity

Restarting only the Web UI normally keeps managed Pi tabs, working directories, session files, and active work connected. A machine restart, power loss, supervisor failure, or explicit shutdown cannot preserve an in-progress model request; the saved transcript can still be reopened afterward.

## Settings and private data

Web UI settings are stored under `~/.pi/webui/` by default. Private runtime state, update records, authentication data, and supervisor details are not exposed to browsers. Do not delete private runtime files while managed tabs are still active.
