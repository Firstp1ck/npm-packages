# Pi Web UI Extended Usability Ideas

Date: 2026-06-12  
Scope: `pi-package-webui` plus optional companion packages loaded by the Web UI package.

## Purpose

This is a product/backlog idea bank for making Pi Web UI feel deeper, easier to discover, and more useful for daily agent work. It intentionally covers both:

1. **Core Web UI features** that should exist even with no optional companion packages.
2. **Optional-feature/companion-package features** that deepen Web UI through installable packages without making `pi-package-webui` own feature-specific business logic.

## Source context reviewed

- `README.md` current feature list and safety model.
- `OPTIONAL_FEATURE_MINIMAL_WEBUI_IMPLEMENTATION_PLAN.md` for the desired extension-owned payload architecture.
- `WEBUI_PERFORMANCE_UX_IMPROVEMENT_PLAN.md` for already planned/implemented performance and UX work.
- `WEBUI_TUI_NATIVE_FEATURE_PLAN.md` and `WEBUI_TUI_NATIVE_PARITY.json` for native TUI parity gaps.
- Pi docs: `docs/packages.md`, `docs/extensions.md`, and `docs/rpc.md`, especially package loading, extension UI, and RPC limitations.
- Round 2 (2026-06-12): re-reviewed `README.md` feature/safety sections, `public/` (service worker, PWA manifest, ~17k-line `app.js`), `lib/` server modules, and the optional companion list to find deepening gaps not yet covered below.

## Scoring rubric

| Score | Meaning |
|---:|---|
| 90-100 | Major daily usability unlock for most users; likely changes how people use Web UI. |
| 75-89 | Strong usability win for frequent users or a major persona. |
| 60-74 | Useful but more niche, polish-oriented, or dependent on other work. |
| <60 | Nice-to-have or speculative; only do after higher-impact work. |

Confidence: `H` = strongly backed by current code/docs/plans, `M` = plausible and evidence-informed, `L` = speculative or upstream-dependent.

---

## Highest-impact bets

| Rank | Idea | Area | User impact | Effort | Confidence | Why it matters |
|---:|---|---|---:|---|---|---|
| 1 | Unified command palette / quick launcher | Core UX | 96 | M | H | One searchable entry point for commands, tabs, models, sessions, runners, settings, and optional actions. |
| 2 | Generic Web UI extension payload SDK | Optional features | 95 | M-L | H | Lets optional packages ship rich browser UI without hardcoding feature logic in Web UI. |
| 3 | Session/workspace dashboard | Core UX | 93 | M-L | H | Users need a home base for sessions, cwd, model, git state, stats, and recent work. |
| 4 | Optional feature manager / marketplace | Optional features | 91 | M | H | Makes companion packages discoverable, installable, updateable, and understandable. |
| 5 | Safety/permission center | Optional/core safety | 90 | M-L | M | A browser UI must make risky actions, LAN exposure, installs, and shell actions visible and controllable. |
| 6 | Queue manager for steer/follow-up/bash | Core UX | 89 | M | H | Long-running agent work needs edit/reorder/cancel visibility, not just passive queue display. |
| 7 | Artifact and tool-output browser | Core UX | 88 | M-L | M | Tool outputs, generated files, diffs, logs, exports, and images need first-class browsing. |
| 8 | Full scoped-model editor | Native parity | 87 | M | H | Model control is high-frequency; current parity matrix marks `/scoped-models` as degraded. |
| 9 | Stats/budget dashboard upgrade | Optional features | 86 | M | M | Token/cost visibility is a practical need for heavy users. |
| 10 | Browser-native extension UI primitives | Optional features | 85 | L | M | Bridges the gap where RPC degrades TUI-only custom UI methods. |

---

## Core Web UI ideas

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Unified command palette** | 96 | M | H | `Ctrl/Cmd+K` overlay that searches slash commands, native commands, settings, tabs, sessions, app runners, optional feature actions, docs links, and recent prompts. Should expose keyboard-first actions and fuzzy search. |
| **Session/workspace dashboard** | 93 | M-L | H | A start/home view with open tabs, recent sessions, cwd, model, git state, token/cost snapshot, active runners, optional feature health, and one-click resume/new/fork. |
| **Queue manager** | 89 | M | H | Dedicated panel for pending steer/follow-up/bash items: reorder, cancel one item, edit before run, convert steer↔follow-up, attach files, and show delivery semantics. Needs upstream/RPC support for exact queue mutation where unavailable. |
| **Artifact and tool-output browser** | 88 | M-L | M | Persistent side drawer for generated files, diffs, shell logs, images, exports, PR docs, release logs, and full tool outputs. Add copy/download/open/re-run actions. |
| **Prompt/workflow library** | 86 | M | M | Browser-native prompt snippets with variables, pinned prompts, recent prompts, project prompts, and companion prompt packages. Import from `prompts/` and expose search + favorites. |
| **First-run onboarding and feature discovery** | 85 | S-M | H | Explain tabs, cwd, optional features, `/tools`, `/skills`, model controls, LAN warning, app runners, PWA install, and guided workflows. Avoid modal spam; use checklist + dismissible tips. |
| **Full scoped-model editor** | 87 | M | H | Searchable model/provider table, enable/disable, reorder cycle order, save project/global scope, explain patterns, test effective cycle. Closes a current degraded parity gap. |
| **Resume/tree deepening** | 84 | M-L | H | Rename/delete/archive sessions, favorite sessions, path display toggle, sort modes, branch labels, tree filters, folding, and branch summaries. Existing matrix marks these as partial/degraded areas. |
| **Advanced settings editor** | 83 | M | H | Expand `/settings` with project/global source visibility, advanced sections, validation, dirty-state diff, and restart/reload impact labels. |
| **Keyboard shortcut manager** | 82 | M | H | Browser-safe keybinding table, conflicts, per-user overrides, import native action IDs where possible, and `/hotkeys` parity. |
| **Attachment manager** | 82 | M | M | Image lightbox, metadata, remove/reorder before submit, paste history, attachment inventory per message, and server-backed image URLs instead of inline base64 for large sessions. |
| **Workspace runner dashboard** | 81 | M | M | Upgrade detected app runners into saved tasks: run, stop, restart, logs, ports, env labels, last exit, custom `.pi-webui-runners.json` editor. |
| **Reliability/status center** | 80 | S-M | M | One panel for RPC health, reconnects, server logs, tab process PID, event lag, failed requests, reload/restart actions, and optional-package install logs. |
| **Mobile/PWA deepening** | 79 | M | M | Bottom navigation, compact side panel, install guidance, offline shell/error state, notification setup, touch-friendly file picker, and mobile-safe command palette. |
| **Transcript intelligence** | 78 | M | M | Beyond search: filter by role/tool/date, pinned messages, bookmarks, copy section, collapse by run, jump to last user/assistant/tool error. |
| **Conversation checkpoints** | 77 | M | M | Browser-native bookmarks and labels for important turns; feed into `/tree` labels where possible. Useful before risky edits or releases. |
| **Diff/review mode for edits** | 77 | L | M | Aggregate file edits from tool calls into a review panel with file path, hunks, copy patch, open file, and maybe reverse hints. |
| **Notification rules** | 74 | S-M | M | Per-event notification toggles: blocked extension UI, agent done, bash done, release done, errors only, quiet mode. |
| **Local docs/help overlay** | 72 | S | H | Searchable help for Web UI controls, shortcuts, native command behavior, optional features, and security warnings. |
| **Theme/customization presets** | 68 | S-M | M | Layout density, font size, bubble style, code wrapping, background presets, and import/export appearance settings. |

---

## Optional feature and companion-package ideas

These should follow the existing direction: **optional packages own their behavior; Web UI renders generic payloads and dispatches declared safe actions.**

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Generic Web UI extension payload SDK** | 95 | M-L | H | Define a stable schema, validator, renderer catalog, action contract, examples, and tests. Extensions emit `checklist`, `stepper`, `log`, `summary`, `resource-toggle`, `footer`, and `artifact` payloads. |
| **Optional feature manager / marketplace** | 91 | M | H | Upgrade side panel into discover/install/update/enable/disable view with package descriptions, versions, changelog links, trust warnings, install root, and reload-required state. |
| **Safety/permission center** | 90 | M-L | M | Optional safety guard dashboard for dangerous shell, protected file edits, LAN exposure, optional installs, export/share/import, and release publishing. Keep sensitive actions localhost/confirmation-gated. |
| **Browser-native extension UI primitives** | 85 | L | M | Provide reusable browser primitives that map current RPC extension UI into richer forms: dialogs, steppers, tables, resource toggles, logs, confirmations, and editor-like inputs. Do not promise arbitrary TUI `ctx.ui.custom()` parity without upstream support. |
| **Migrate release-npm/release-aur widgets to extension-owned payloads** | 84 | M-L | H | Release packages emit structured log/status/action payloads; Web UI removes hardcoded parsing/rendering after parity. Critical for maintainability. |
| **Move guided Git workflow into an extension-owned workflow package** | 83 | L | H | Web UI renders a generic stepper/log/action payload; extension owns stage/message/branch/PR state and git commands. Reduces Web UI server endpoints and business logic. |
| **Stats dashboard upgrade** | 86 | M | M | From stats command/status to browser dashboard: token trend, provider/model cost, session/project totals, budget alerts, CSV/JSON export, anomaly warnings. |
| **Skill and tool scope visualizer** | 84 | M | H | Deepen `/skills` and `/tools`: provenance, active/inactive reason, prompt footprint, reload needed, branch/session persistence, search by package, and quick presets. |
| **Git status/repo panel** | 83 | M | M | Extend git-footer-status into a browsable repo panel: branch, dirty files, staged files, ahead/behind, recent commits, safe actions to open guided Git workflow. |
| **Artifact package** | 82 | M | M | Optional package that standardizes generated artifacts: files, reports, screenshots, exports, patches, release logs, PR drafts. Web UI displays them in the artifact browser. |
| **Workflow presets package** | 81 | M | M | Save model + thinking + tools + skills + cwd + runners + prompt template as named presets, e.g. `review`, `release`, `research`, `fast edit`. |
| **Test/watch companion** | 80 | M | M | Optional package that watches test commands, shows pass/fail widgets, lets user rerun failed tests, and summarizes failures into the next prompt. |
| **Release center** | 79 | L | M | Unified browser hub for NPM, AUR, GitHub releases, changelogs, version bumping, package status, dry-run output, and publish confirmations. Built from release extensions, not core Web UI. |
| **Theme gallery package deepening** | 72 | S-M | M | Preview all installed themes, live compare, install/update theme bundles, theme metadata, accessibility contrast notes. |
| **Extension developer tools** | 76 | M | M | Inspect raw extension UI requests, widgets/status payloads, schema validation errors, payload replay fixtures, and optional-feature detection state. |
| **Optional package author starter kit** | 73 | S-M | H | Templates and examples for creating Web UI-aware extensions with payload emitters, tests, README badges, and package metadata. |
| **Context/memory inspector package** | 78 | M | M | Show loaded skills, prompt templates, context files, active tools, system prompt sections, and what will be sent next. Must avoid leaking sensitive content by default. |
| **Project onboarding package** | 75 | M | M | Detect repo type and offer setup: recommended tools/skills, runners, prompts, safety paths, project settings, and `.pi-webui-runners.json`. |

---

## Round 2 deepening ideas (added 2026-06-12)

New ideas that do not duplicate the tables above. Same scoring rubric. Overlaps with existing entries are called out explicitly.

### Conversation and composer deepening

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Context window meter + compaction control** | 90 | S-M | H | Per-tab live meter: tokens used vs. model limit, predicted auto-compaction point, manual compact button, and a breakdown view (system prompt, skills, transcript, attachments, queued items). Every user hits context limits; today compaction is only visible as an event. |
| **Message edit-and-retry (fork from any user message)** | 89 | M | H | Edit a past user prompt and re-run as a fork from that point, mapped onto `/fork` + `/tree` semantics. The single most-expected chat-UI affordance that is missing; also makes the tree feature discoverable. |
| **Retry assistant turn with a different model** | 83 | M | H | Action on the last assistant message: re-run with another model/thinking level (as fork). Pairs naturally with the scoped-model editor and the A/B compare idea below. |
| **Rich rendering: Mermaid + KaTeX + code highlight themes** | 78 | S-M | H | Render mermaid blocks and LaTeX in the transcript, with sandboxed/lazy rendering so long sessions stay cheap. Frequent for research/architecture sessions. |
| **Draft history and prompt undo** | 73 | S | M | Per-tab ring buffer of sent prompts and abandoned drafts; `ArrowUp` recall in empty composer; restore draft after accidental reload (drafts already persist per tab — extend to history). |
| **Collapse-all controls + message permalinks** | 70 | S | H | One toggle to collapse/expand all thinking + tool cards; stable `#msg-N` anchors for sharing positions within a session and for the transcript-search results. |

### Code-centric workflows

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Inline file viewer** | 88 | M | H | Click any path in `@` references, tool cards, or diffs to open a read-only syntax-highlighted viewer drawer with line numbers, jump-to-line from `file:line` strings, and copy/download. Foundation for the artifact browser and diff/review mode above. |
| **Code block actions** | 80 | S-M | M | On transcript code blocks: copy, save to file (confirmation-gated), run in bash queue, and "ask Pi to apply this". Turns answers into actions without retyping. |
| **Interactive terminal pane (xterm.js)** | 79 | M-L | M | Optional real PTY per tab instead of one-shot bash cards, for REPLs, watch modes, and TUIs. Same trust level as the session; keep behind an explicit toggle and reuse runner output pinning. |
| **Open-in-editor links** | 72 | S | M | Localhost-only: open `file:line` in a configured editor (`vscode://`, `$EDITOR` command). Cheap, high-frequency convenience for local development. |

### Multi-tab and multi-agent orchestration

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Subagent/orchestration panel** | 82 | M-L | M | Surface `pi-subagents`-style runs: which subagents are active per tab, chain/parallel/async status, per-agent transcripts, and cancel/inspect actions. Extension-owned payloads; Web UI renders generic run/stepper/log shapes. |
| **Tab management deepening** | 81 | S-M | H | Pin tabs, drag reorder, color labels/groups, `Ctrl+1..9` switching, recently-closed-tab restore, and "new tab from template" (cwd+model+first prompt; overlaps with the workflow presets package, which should own templates). |
| **Split view / compare two tabs** | 74 | M | M | Side-by-side transcripts on wide screens, synced scrolling optional. Useful for migration work and model comparison. |
| **A/B same-prompt run with diff** | 68 | M | L | Send one prompt to two tabs/models and diff the answers. Niche but unique to a browser UI; build only after retry-with-model exists. |

### Search, memory, and knowledge

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Global cross-session search** | 87 | M | H | Extend the implemented per-transcript search (P2-1) to all session files across projects: query → ranked matches → open as resumed session jumped to the matched turn. Natural dashboard/command-palette citizen. |
| **Memory & LEARNINGS browser (optional package)** | 79 | M | M | Browse/search `MEMORY.md`, daily memory, rule notes, and LEARNINGS from the Web UI; the existing feedback reactions already create LEARNINGS — close the loop by making them inspectable. Writes confirmation-gated; localhost-only by default. |
| **Pinned knowledge sidebar** | 66 | S-M | L | Pin files/snippets/notes per project that are one click from the composer (insert as `@` ref or quote). Defer until prompt library exists. |

### Remote access, auth, and collaboration

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Optional auth token/PIN for non-localhost binds** | Implemented | M | H | Implemented as the side-panel **Remote PIN auth** toggle plus `--remote-auth` startup option. It generates a 4-digit PIN for non-localhost clients while keeping localhost frictionless. Still documented as trusted-LAN convenience, not multi-user hardening. |
| **Web push notifications when the page is closed** | 76 | M | M | The service worker already exists; add push subscription so agent-done/blocked-UI events reach mobile even with the PWA backgrounded. Requires HTTPS/localhost constraints per platform. |
| **Transcript export with redaction** | 75 | S-M | M | Export session as Markdown/HTML with a secret-scrubbing pass (env-style tokens, key patterns) and attachment handling. Safer stepping stone toward `/share` parity. |
| **Read-only spectator mode** | 71 | M | M | Per-server toggle issuing view-only links (no prompt/bash/action dispatch). Useful for pairing/demos on LAN; depends on the auth layer above. |

### Observability and trust

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Turn timeline/trace view** | 80 | M | M | Per-turn waterfall: thinking time, each tool call with duration and tokens, retries, queue waits. Click to jump to the transcript item. Makes "why was that slow/expensive" answerable. |
| **Live cost/token ticker per response** | 74 | S | M | Streaming token count and estimated cost on the in-flight assistant bubble; complements the stats dashboard, which is session/period-level. |
| **Error triage panel** | 72 | S-M | M | Aggregated recent tool/bash failures across tabs with context and a one-click "ask Pi to fix" prompt prefill. Lives well inside the reliability/status center. |

### Accessibility and internationalization

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **Accessibility pass** | 77 | M | H | ARIA live regions for streaming output, focus management in dialogs/drawers, full keyboard reachability, broader `prefers-reduced-motion` (already planned as P2-3), contrast audit per theme, font scaling. Currently absent from all plans. |
| **i18n scaffolding** | 62 | M | L | Extract UI strings behind a lightweight lookup; ship English only. Only worth it if non-English demand appears. |

### New optional companion package ideas (round 2)

| Idea | Impact | Effort | Confidence | Notes / acceptance shape |
|---|---:|---|---|---|
| **HTML/artifact preview sandbox** | 84 | M | M | Render agent-generated HTML/SVG/small web apps in a sandboxed iframe (no network by default, explicit allow), with reload-on-edit. Pairs with the artifact browser; the strongest "only a browser can do this" feature. |
| **Voice input package** | 72 | M | M | Web Speech API dictation in the composer first; optional local Whisper backend later. Especially valuable on mobile PWA. |
| **Image annotation before send** | 70 | S-M | M | Draw arrows/boxes/blur on pasted screenshots before submitting. Screenshot-driven debugging is a top mobile/desktop flow. |
| **Scheduled/recurring prompts** | 68 | M | L | Cron-like "run this prompt in tab X daily" (dependency updates, report generation). High risk: confirmation-gated, localhost-only, off by default, visible run log. |
| **TTS read-aloud** | 60 | S | L | Read final assistant output aloud via SpeechSynthesis. Cheap accessibility/mobility win, limited audience. |

## Native TUI parity ideas worth prioritizing

| Surface | Current direction | Impact | Effort | Confidence | Why now |
|---|---|---:|---|---|---|
| `/scoped-models` | Degraded; needs full editor | 87 | M | H | Model switching is central and frequent. |
| `/resume` | Partial; needs rename/delete/sort/filter | 84 | M | H | Session reuse is one of the main Web UI use cases. |
| `/tree` | Partial; needs filters/folding/labels | 83 | M-L | H | Branch navigation is powerful but hard to discover. |
| `/hotkeys` | Degraded; Web-specific help only | 80 | S-M | H | Keyboard users need trustworthy shortcut discovery. |
| `/import` | Unsupported | 76 | M | H | Completes session portability; sensitive and needs validation. |
| `/share` | Unsupported | 74 | L | M | Useful but risky; start with local redacted preview only. |
| `/changelog` | Unsupported | 68 | S-M | H | Low-risk quality-of-life/read-only parity. |
| `/export` overwrite flow | Degraded | 75 | S-M | H | Explicit server writes need confirmation to finish safety semantics. |

---

## Performance and scale ideas still worth doing

| Idea | Impact | Effort | Confidence | Notes |
|---|---:|---|---|---|
| **Coalesced snapshot refresh endpoint/scheduler** | 82 | S-M | H | Existing plan notes event refresh storms. Bundle state/stats/footer/messages dirty flags into fewer round-trips. |
| **DOM cost caps for very long sessions** | 80 | M | H | Add `content-visibility`, lazy-fill expanded tool output, and optionally window old messages with "show earlier". |
| **Published asset minification** | 76 | S | H | Reduce JS/CSS parse cost while preserving no-build dev workflow. |
| **Attachment URLs instead of inline base64** | 82 | M | M | Large screenshots should not inflate every messages payload. Also enables caching/lightbox. |
| **Performance instrumentation and budgets** | 75 | S | H | `?perf=1`, `performance.mark`, and asset-size tests to prevent regressions. |
| **Loading skeletons/perceived speed** | 70 | S | M | Smooth initial load and tab switches, especially on mobile/LAN. |

---

## Suggested roadmap

### Phase 1 — Discovery and daily flow, low risk

1. Command palette MVP.
2. First-run/help/discovery layer for optional features and shortcuts.
3. Reliability/status center.
4. `/hotkeys` and scoped-model editor planning/spec.
5. Coalesced refresh scheduler and DOM cheap wins from the performance plan.

### Phase 2 — Optional-feature architecture

1. Generic extension payload validator/renderers/actions.
2. Optional package author examples and tests.
3. Migrate todo-progress to structured checklist payload.
4. Migrate release widgets to structured log/summary/action payloads.
5. Extend optional feature manager with versions, updates, changelog, trust warnings.

### Phase 3 — Power-user parity

1. Full `/scoped-models` editor.
2. Queue manager, with degraded mode where upstream queue mutation is not available.
3. Deeper `/resume` and `/tree` browser UIs.
4. Artifact/tool-output browser.
5. Stats/budget dashboard upgrade.

### Phase 4 — Workflow packages

1. Guided Git workflow as extension-owned stepper package.
2. Release center composed from release packages.
3. Safety/permission center.
4. Workflow presets package.
5. Test/watch companion.

### Phase 5 — Round 2 deepening (slot items earlier where they fit)

1. Context window meter + compaction control (cheap, every-user value — can land in Phase 1).
2. Optional auth token/PIN for non-localhost binds (prerequisite for serious LAN/mobile use — before or with Phase 3).
3. Message edit-and-retry and retry-with-model (with the `/tree`/`/resume` deepening in Phase 3).
4. Inline file viewer, then global cross-session search.
5. HTML/artifact preview sandbox and subagent/orchestration panel as companion packages after the payload SDK.
6. Accessibility pass as a cross-cutting track alongside any phase.

---

## Product principles for deciding what to build

1. **Make frequent actions one keystroke/search away.** If a feature is powerful but hidden in the side panel, it is effectively missing.
2. **Keep core Web UI generic.** Feature-specific state machines belong in companion packages; Web UI should render stable payload shapes.
3. **Make safety visible, not annoying.** LAN exposure, installs, exports, shares, shell commands, and publishing should be clear and confirmation-gated where appropriate.
4. **Prefer browser-native affordances over TUI imitation where better.** Tables, search, filters, previews, downloads, and drag/drop are strengths of the browser.
5. **Every optional feature needs discovery, health, and graceful degradation.** Users should know whether a feature is not installed, installed but not loaded, disabled, updateable, or blocked by RPC/support constraints.
6. **Performance is usability.** Long sessions, images, tool logs, and mobile parse/layout cost must stay bounded.

---

## Fast shortlist

If only five things get built next, choose:

1. **Unified command palette** — maximum daily usability win.
2. **Generic extension payload SDK/renderers** — unlocks optional features cleanly.
3. **Optional feature manager upgrade** — makes companions understandable and self-service.
4. **Full scoped-model editor** — closes a high-value parity gap.
5. **Queue manager** — makes long-running agent work controllable.

Round 2 entrants that compete for these slots:

- **Optional auth token/PIN (92)** — if LAN/mobile use matters, this jumps to the top three; everything network-facing depends on it.
- **Context window meter + compaction control (90)** — small effort, every-session value; a strong swap-in for slot 5.
- **Message edit-and-retry (89)** — the most-expected missing chat affordance; consider bundling with the Phase 3 `/tree` work.
