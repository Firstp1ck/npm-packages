# Pi Web UI User-Reach Priority Implementation Plan

Date: 2026-06-13  
Scope: `pi-package-webui` and companion packages only where they unlock broad Web UI usage.

## Goal

Implement the features that the largest share of users will touch most often first.

This plan intentionally prioritizes **broad user reach and repeated daily use** over novelty, internal elegance, or feature-specific depth. Optional-package and niche workflow work should not outrank core Web UI flows unless it unlocks many high-reach features.

## Source docs reviewed

- `docs/webui/roadmap/WEBUI_EXTENDED_USABILITY_IDEAS.md`
- `docs/webui/performance/WEBUI_PERFORMANCE_UX_IMPROVEMENT_PLAN.md`
- `docs/webui/native-parity/WEBUI_TUI_NATIVE_FEATURE_PLAN.md`
- `lib/WEBUI_TUI_NATIVE_PARITY.json`
- `docs/webui/optional-features/OPTIONAL_FEATURE_MINIMAL_WEBUI_IMPLEMENTATION_PLAN.md`
- `docs/webui/research/deep-research-report.md`
- `docs/webui/native-parity/WEBUI_TUI_NATIVE_FEATURE_GRILL_RESULTS.md`

## Priority model

Use this decision rule for all new Web UI work:

> If most users use a surface frequently, implement and polish that surface before specialized optional workflows.

Scoring fields:

| Field | Weight | Meaning |
|---|---:|---|
| Reach | 3x | How many Web UI users benefit: nearly everyone > frequent coding users > power users > niche package users. |
| Frequency | 2x | How often the feature is used: every turn/session/day > occasional > rare. |
| Friction removed | 2x | How much current pain/confusion the feature removes. |
| Dependency unlock | 1x | Whether it unlocks several other high-reach features. |
| Risk/complexity penalty | -1x | Security, destructive actions, upstream RPC gaps, or high implementation complexity. |

No real usage telemetry is present in the docs, so current ranking is inferred from: core chat/session/model/file workflows, TUI parity priority, existing degraded/unsupported matrix entries, and competitor feature surfaces. Add local usage counters early so future rankings can be evidence-based.

## What users likely use most

Rank core workflows by expected frequency:

1. Prompting, reading streaming output, retrying/refining answers.
2. Finding commands/actions/settings quickly.
3. Managing context length, compaction, active runs, and queues.
4. Resuming/navigating sessions and workspaces.
5. Switching models/thinking/tools/skills.
6. Inspecting files, diffs, tool outputs, artifacts, and attachments.
7. Searching old turns/sessions.
8. Managing optional packages/features.
9. Exporting/importing/sharing/releasing/publishing.

Therefore, ranks 1-7 should dominate implementation priority unless a safety fix blocks them.

## Top priority backlog

### P0 — Broadest reach, every-session value

| Rank | Feature | Why it is high reach | MVP acceptance | Source signals | Confidence |
|---:|---|---|---|---|---:|
| 1 | **Unified command palette / quick launcher** | Nearly every user needs one searchable entry point for commands, settings, tabs, models, sessions, runners, docs, and optional actions. It also makes hidden features discoverable. | `Ctrl/Cmd+K`; fuzzy search; execute slash/native commands; open settings/model/session surfaces; list optional actions with unavailable/degraded labels. | `WEBUI_EXTENDED_USABILITY_IDEAS.md` ranks it #1, impact 96. | 92/100 |
| 2 | **Context window meter + compaction control** | Context exhaustion affects almost every serious session and is currently hard to predict. This is small-to-medium effort with universal value. | Live per-tab token/context meter; projected compaction point; manual compact button; breakdown by transcript/attachments/system/queued items. | Round 2 idea impact 90; every-user value. | 90/100 |
| 3 | **Remaining all-user performance/scale polish** | Performance affects every user, especially long sessions/mobile. Already-implemented P0 perf work proves this class of work pays off. | Coalesced snapshot refresh; `content-visibility`/lazy tool-output fill; loading skeletons; reduced-motion coverage; publish-time minification; perf marks/budget test. | `WEBUI_PERFORMANCE_UX_IMPROVEMENT_PLAN.md` P1/P2 remaining items. | 88/100 |
| 4 | **First-run/help/hotkeys discovery layer** | Every new user needs to learn Web UI affordances, shortcuts, safety state, optional features, and native-vs-browser differences. | Dismissible checklist; searchable help overlay; `/hotkeys` upgraded from Web-only help toward effective bindings; command palette indexes help entries. | Extended ideas impact 85; parity matrix marks `/hotkeys` degraded. | 86/100 |
| 5 | **Message edit-and-retry / fork from prior user message** | One of the most expected chat affordances; used by broad users when prompts are imperfect. Makes session tree/fork semantics discoverable. | Edit past user message; rerun as fork; visible branch label; keep original immutable transcript; confirmation if active run would be affected. | Round 2 idea impact 89; `/fork` is degraded in parity matrix. | 88/100 |

### P1 — Core daily control surfaces

| Rank | Feature | Why it is high reach | MVP acceptance | Source signals | Confidence |
|---:|---|---|---|---|---:|
| 6 | **Session/workspace dashboard MVP** | Users need a home base for open tabs, recent sessions, cwd, model, git state, active runs, stats, and resume/new/fork. | Default dashboard/start view; recent/open sessions; cwd/model/status chips; one-click resume/new/fork; active runner indicators. | Extended ideas rank #3, impact 93. | 88/100 |
| 7 | **Queue manager for steer/follow-up/bash** | Long-running agent work is core to Pi; users need to see, edit, reorder, cancel, and understand pending work. | Dedicated queue panel; pending steer/follow-up/bash cards; edit/cancel where supported; clear degraded labels for upstream RPC gaps; queued bash cancel/abort-all polish. | Extended ideas impact 89; parity matrix marks queue restore and bash flows degraded. | 86/100 |
| 8 | **Full scoped-model editor** | Model choice is high-frequency for serious users and current parity is degraded. | Searchable model/provider table; enable/disable; reorder cycle order; save to Global or Project; explain effective source; `Ctrl/Cmd+P` cycle remains consistent. | Extended ideas impact 87; parity matrix `/scoped-models` degraded P1. | 89/100 |
| 9 | **Resume/tree deepening** | Session reuse and branch navigation are central to Web UI, especially after edit/retry and forks. | `/resume`: sort, path toggle, named filter, compact paths. `/tree`: filters, fold state, labels, timestamp toggles, explicit summary opt-in. | Extended ideas impact 84/83; parity matrix `/resume` and `/tree` degraded P1. | 86/100 |
| 10 | **Retry assistant turn with different model/thinking** | Common power move once model controls exist; useful for comparing quality without manual copy/paste. | Action on assistant turn; choose model/thinking; rerun as fork; show comparison branch metadata. | Round 2 idea impact 83; depends on model editor/fork. | 82/100 |

### P2 — Coding workflow breadth

| Rank | Feature | Why it reaches many coding users | MVP acceptance | Source signals | Confidence |
|---:|---|---|---|---|---:|
| 11 | **Inline file viewer** | Coding users frequently need to inspect mentioned paths, tool outputs, and diff paths without leaving the browser. | Click `file:line`, `@` refs, tool paths; read-only syntax-highlighted drawer; line numbers; copy/download; no write side effects. | Round 2 idea impact 88. | 87/100 |
| 12 | **Artifact and tool-output browser** | Generated files, diffs, logs, images, exports, release logs, and patches need a common browser surface. | Side drawer with artifacts/tool outputs; filter by type/tab/session; copy/download/open/re-run actions; safe path handling. | Extended ideas impact 88; optional artifact package impact 82. | 83/100 |
| 13 | **Attachment manager + image-by-reference** | Screenshots/images are frequent debugging inputs and currently can bloat message payloads. | Reorder/remove before send; lightbox; metadata; server-backed attachment URLs instead of inline base64; cache-safe download route. | Extended ideas attachment manager impact 82; performance plan P2-4. | 82/100 |
| 14 | **Global cross-session search** | Users need to find prior decisions/work across projects once session counts grow. | Search all session files; ranked matches; open/resume jumped to matched turn; command palette entry. | Round 2 idea impact 87. | 85/100 |
| 15 | **Transcript intelligence polish** | Per-transcript search exists; users still need filters, bookmarks, permalinks, collapse-all, and jump controls. | Filter by role/tool/date; bookmarks/permalinks; collapse-all thinking/tool cards; jump to last user/assistant/error. | Extended ideas impact 78; round 2 collapse/permalinks impact 70. | 80/100 |

### P3 — Optional ecosystem and companion-package leverage

These are important, but should follow core high-frequency flows unless they are needed as implementation substrate for a P0-P2 item.

| Rank | Feature | Why it matters | MVP acceptance | Source signals | Confidence |
|---:|---|---|---|---|---:|
| 16 | **Generic Web UI extension payload SDK/renderers** | Not directly used by every user, but it unlocks many optional features without hardcoding business logic into Web UI. | Stable payload schema/validator; generic renderers for log/checklist/stepper/resource-toggle/summary/artifact/footer; generic action dispatch; tests and example extension. | Optional-feature plan Phase 1; extended ideas rank #2, impact 95. | 91/100 |
| 17 | **Optional feature manager / marketplace upgrade** | Many users need to discover, enable, disable, update, and understand companion packages. | Package list with installed/available/update states; descriptions/versions; trust warnings; reload-required labels; changelog links. | Extended ideas rank #4, impact 91. | 88/100 |
| 18 | **Skill and tool scope visualizer** | `/tools` and `/skills` are implemented, but provenance, prompt footprint, active reason, and presets improve frequent power-user control. | Search/filter; provenance; active/inactive reason; prompt footprint; branch/session persistence; quick presets. | Optional ideas impact 84; parity matrix tools/skills implemented but target behavior asks for provenance. | 84/100 |
| 19 | **Stats/budget dashboard upgrade** | Heavy users need cost/token visibility; broad enough for active users but less universal than command/session/message controls. | Token/cost trend; model/provider totals; session/project totals; budget alerts; CSV/JSON export. | Extended ideas impact 86. | 80/100 |
| 20 | **Browser-native extension UI primitives** | Useful once optional packages grow; keep semantic and constrained to avoid arbitrary TUI emulation. | Dialog/table/log/form/stepper primitives mapped to payload SDK; validation errors visible. | Extended ideas impact 85; parity matrix extension UI degraded/unsupported entries. | 78/100 |

### P4 — Lower reach, higher risk, or specialized workflows

Do these after P0-P3 unless real usage data proves otherwise.

| Feature group | Priority reason | Implementation stance |
|---|---|---|
| `/export` overwrite completion, `/import`, `/share` | Valuable, but less frequent and security-sensitive. | Implement carefully after core command/session surfaces; keep localhost/trusted-context/confirmation gates. |
| `/login` browser OAuth/API-key flows | Important for setup, but sensitive and not daily. | OAuth/device-code first; API keys only with reviewed trusted-context UX and never browser storage/logs/transcripts. |
| Guided Git workflow migration | Useful, but specialized compared with core chat/session/model/file flows. | Move to extension-owned stepper after payload SDK. |
| Release NPM/AUR widgets and Release Center | High-risk publishing workflows for a narrow user subset. | Migrate to generic payloads for maintainability; do not outrank broad core UX. |
| Theme gallery/customization, voice/TTS, scheduled prompts, i18n, A/B same-prompt diff | Nice-to-have or audience-specific. | Build only after higher-reach backlog or clear demand. |
| Arbitrary `ctx.ui.custom()` parity | Risk of brittle terminal-component emulation. | Prefer semantic payload primitives; keep arbitrary rendering unsupported until upstream protocol is mature. |
| `/quit`, `/changelog` | Low-frequency or read-only convenience. | Small opportunistic tasks, not roadmap drivers. |

## Implementation phases

### Phase A — Reach measurement and high-confidence all-user wins

1. Add local-only feature usage counters:
   - command invocations;
   - dialog opens;
   - shortcut use;
   - queue actions;
   - session navigation;
   - model changes;
   - optional feature opens.
2. Do not send telemetry externally by default.
3. Expose counters in a local status/debug panel and allow manual export for development.
4. Ship P0 ranks 1-4: command palette, context meter, remaining performance polish, help/hotkeys discovery.

Acceptance:

- Future priority reviews can answer “what are users using most?” from local evidence.
- No privacy regression: usage counters are local, non-secret, and user-visible.
- `npm --prefix /home/firstpick/npm-packages/pi-package-webui run check` passes.

### Phase B — Core interaction loop

1. Message edit-and-retry.
2. Workspace/session dashboard MVP.
3. Queue manager.
4. Scoped-model editor.
5. Resume/tree deepening.
6. Retry-with-different-model.

Acceptance:

- Prompt refinement, session navigation, queue control, and model control are browser-native and discoverable from the command palette.
- Degraded parity entries in `WEBUI_TUI_NATIVE_PARITY.json` are updated when features graduate.

### Phase C — Coding workflow breadth

1. Inline file viewer.
2. Artifact/tool-output browser.
3. Attachment manager and image-by-reference delivery.
4. Global cross-session search.
5. Transcript intelligence polish.

Acceptance:

- Users can inspect common coding outputs without leaving Web UI.
- Large sessions and image-heavy sessions remain bounded in network/DOM cost.

### Phase D — Optional ecosystem after core UX is strong

1. Generic extension payload SDK/renderers/actions.
2. Optional feature manager/marketplace.
3. Skill/tool scope visualizer.
4. Stats/budget dashboard.
5. Extension developer/debug tools.

Acceptance:

- Optional features are discoverable and self-service.
- Web UI renders generic payloads; optional packages own feature-specific business logic.

## Deprioritization rules

A feature should not be promoted above the current P0/P1 list unless at least one is true:

1. Local usage counters show it is used more often than a current higher-ranked item.
2. It fixes a safety/security problem affecting common flows.
3. It unblocks at least two P0/P1 features.
4. It is a very small opportunistic task with low risk and no roadmap drag.

## Already implemented / do not re-prioritize

Do not spend new roadmap capacity on these except for regressions or polish:

- Incremental transcript rendering.
- Static asset compression and ETag caching.
- Incremental streaming markdown rendering.
- Delta endpoint for `/api/messages`.
- Per-transcript search/filter baseline.
- Remote PIN auth toggle / `--remote-auth` baseline.
- Core browser-safe model/thinking/tool shortcuts already listed as implemented in the parity matrix.

## Minimum verification for any roadmap item

Run at least:

```bash
npm --prefix /home/firstpick/npm-packages/pi-package-webui run check
git diff --check
```

For security-sensitive items, also add/extend server endpoint tests and manual checks for localhost vs LAN behavior.

## Current recommendation

Start with this order:

1. Command palette MVP.
2. Context window meter + compaction control.
3. Remaining performance/scale polish.
4. First-run/help/hotkeys discovery.
5. Message edit-and-retry.
6. Workspace/session dashboard MVP.
7. Queue manager.
8. Full scoped-model editor.
9. Resume/tree deepening.
10. Inline file viewer.

This gives the broadest user reach before investing heavily in specialized release, Git, share/import, theme, or arbitrary extension UI work.
