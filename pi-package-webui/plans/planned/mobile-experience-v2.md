# Mobile Experience v2 — Research and Implementation Plan

Status: planned; implementation not started  
Classification: complex future feature; this artifact is research and planning only  
Integration owner: primary Pi session  
Date: 2026-07-31  
Target package: `@firstpick/pi-package-webui` v0.8.0  
Primary constraint: improve phone and tablet UX without changing the existing desktop experience

## Goal

Make Pi Web UI excellent for on-the-go agent work: capture a request, switch sessions, monitor progress, answer blockers, steer or stop work, inspect project state, and return through notifications—without turning the phone into a miniature desktop IDE and without changing desktop behavior.

## Executive recommendation

Ship a **flagged, phone-first adaptive shell** with four stable mobile destinations:

1. **Chat** — active conversation, concise run state, transcript, and composer.
2. **Sessions** — searchable open/recent sessions, project groups, and new-session actions.
3. **Activity** — running, blocked, failed, and completed agent/subagent work with direct intervention.
4. **Project** — files, Git, queue, workflows, and project-scoped actions.

Settings, usage, extensions, diagnostics, and infrequent commands remain reachable from a top-level **More/Inspector** surface and the existing command palette; they are not bottom-navigation actions.

The mobile shell should feel native through stable labeled navigation, full-screen destinations, one surface stack, safe-area/keyboard handling, 44px touch targets, browser Back/Escape semantics, compact actionable status, and progressive disclosure. It must remain a PWA/web experience—**not** a native wrapper, forked mobile frontend, or copied desktop Control Deck.

Before visual restructuring, establish browser/device characterization and fix correctness issues that disproportionately damage mobile trust: touch-target regressions, background/foreground reconciliation, offline/reconnect truthfulness, and mobile browser coverage.

## Why this direction

### What leading mobile AI products converge on

Current official product material shows a consistent mobile job model:

- **ChatGPT** keeps voice, text, images, and history in one conversation; Voice can continue in the background and supports interruption. Projects preserve long-running context across web, iOS, and Android. Scheduled work has a dedicated management surface and notifications.
- **Claude / Claude Code** treats mobile as a client for starting, monitoring, answering questions, and steering remote or local sessions. Push notifications surface completion or decisions. Cowork emphasizes cross-device continuity, background work, and approval before consequential actions.
- **Gemini Live** supports interruption, captions, camera/screen input, background/lock-screen continuation, and explicit notification-backed return paths.
- **Perplexity** organizes persistent work into Projects containing conversations, tasks, files, instructions, and tools; its model supports returning to the same body of work instead of treating every query as isolated.
- **Microsoft Copilot** uses a simple Chat → Speak path for hands-free mobile use and keeps file uploads and follow-up questions inside the same conversation.
- **Claude Code mobile and other coding-agent mobile surfaces** emphasize monitor/steer/review rather than a full mobile editor or terminal.

Platform guidance reinforces the navigation choice:

- Apple’s Human Interface Guidelines say tab bars are for navigation, not actions; labels should be present; fewer stable destinations are easier to use; critical badges should be reserved for attention-worthy state.
- Material Design 3 recommends navigation bars with **3–5 stable destinations** for compact windows and supports them in some medium-window adaptations. The tablet pattern still requires separate validation; the four-destination phone IA below is a Pi-specific design inference, not a copied competitor layout.

### Product conclusion

The phone is primarily a **capture, monitor, intervene, and review surface**. Desktop remains the deep-work surface. Mobile should expose less chrome and less raw process detail by default, while preserving full answer content, safety context, and inspectability.

## Research pattern matrix

| Product/source | Verified mobile pattern | Transfer to Pi Web UI | Evidence strength |
|---|---|---|---|
| ChatGPT Voice | Voice starts from the message bar; text/images stay in the same chat; interruption and background continuation are supported | Composer remains the durable control center; voice/dictation never creates a parallel conversation model | High · official help |
| ChatGPT Projects / Scheduled Tasks | Persistent workspaces and a dedicated task-management surface span mobile/web; task notifications are selective | Separate Sessions and Activity from the raw transcript; preserve project context and exact return targets | High · official help |
| Claude Code mobile | Start cloud work, connect to local work, inspect progress, answer questions, steer, and receive completion/decision notifications | Activity must expose explicit state and next action; local-vs-remote lifecycle must be honest | High · official docs |
| Claude Cowork mobile/web | Work follows the user, continues in background, asks for decisions, and waits for review/approval | Background work may continue only where Pi/server lifecycle allows; blockers need a direct decision surface | High · official product/docs |
| Gemini Live | Seamless voice/text transition, interruption, captions, camera/screen sharing, background and lock-screen return | Add multimodal capture and background return incrementally; captions/visible controls are mandatory | High · official help |
| Perplexity Projects | A persistent Project can contain conversations/searches, Computer tasks, files, instructions, tools, and accumulated context | A stable Project destination is a Pi-specific IA inference, not a verified Perplexity navigation pattern | Medium · official help, transfer inferred |
| Microsoft Copilot mobile | Chat → Speak is a direct hands-free flow; uploaded files remain in the chat for follow-ups | Keep voice/file entry shallow and keep follow-ups in the same transcript | High · official support |
| Apple HIG tab bars | Stable labeled destinations, navigation rather than actions, fewer tabs, critical badges only | Four labeled destinations; no Send/Settings/More action masquerading as a tab | High · official HIG |
| Material 3 navigation bar | 3–5 stable destinations for compact windows, with documented medium-window variants | Four destinations fit the proposed phone IA; tablet remains a separate prototype | High · official design guidance |

Research evidence is **high overall** for documented capabilities and platform guidance, and **medium** for transfer from those capabilities to Pi’s exact four-destination IA. Exact competitor layouts, gestures, haptics, and assistive-technology behavior require hands-on validation before copying.

## Current repository evidence

### Existing strengths to preserve

- Safe-area and keyboard groundwork already exists: `viewport-fit=cover`, `interactive-widget=resizes-content`, VisualViewport variables, and `body.mobile-keyboard-open` (`public/index.html`, `public/app.js:4214+`, `public/styles.css:12040+`).
- The PWA already has a manifest, standalone display, icons, service worker, notification click handling, and offline shell (`public/manifest.webmanifest`, `public/service-worker.js`).
- Tab switching preserves per-tab drafts/caches and uses active-tab generation fencing before reconnecting SSE (`public/app.js:7358+`, `public/app.js:11093+`).
- Side-panel overlay behavior has Escape, focus containment, backdrop handling, and focus return (`public/app.js:4036+`).
- The composer already supports attachments, files/images, follow-up/steer, queue controls, voice capability integration, guarded Abort, and mobile Enter behavior (`public/index.html:239+`, `public/app.js`, `public/styles.css:12485+`).
- Compact output negotiation already exists, but it changes visible transcript semantics and is intentionally independent of viewport (`README.md`, `public/fast-output-live.mjs`).
- Browser notifications already cover blocked tabs and optional agent completion, and foreground resume triggers authoritative refresh (`public/app.js`, asserted in `tests/mobile-static.test.mjs`).

### Problems the plan must solve

1. **Navigation is adapted desktop chrome, not mobile information architecture.** Phone sessions live in a wrapped `42dvh` tab popover; the Control Deck remains eleven accordions; composer actions contain nested floating menus.
2. **Information density remains capability-first.** Header, overview, footer, session details, queue, subagents, provider usage, commands, and events duplicate state across several surfaces.
3. **The keyboard mode is volatile.** It hides header, widgets, status, inspector trigger, and secondary actions while automatically closing surfaces and moving the transcript.
4. **Touch targets regress below the product’s base 44px floor.** Mobile rules include 28–40px controls and compact density can reduce controls further.
5. **“Less verbose” has no product-level implementation.** Thinking visibility and `compact-v1` exist, but there is no presentation model that hides redundant mobile chrome while preserving complete answer semantics.
6. **Task state is fragmented.** Running/blocking/completed state exists across tabs, subagents, widgets, events, and notifications, but there is no canonical mobile Activity view.
7. **The browser harness is insufficient for a redesign.** `tests/mobile-static.test.mjs` is extensive but mostly source/VM contracts; there is no package-owned Playwright/axe/device flow.
8. **Static assets are manually coupled.** New imported browser modules must be added to the server allowlist and service-worker app shell, and cache identity must remain coherent.
9. **Mobile is commonly remote.** The product binds to loopback by default; trusted-LAN/PIN access has explicit security limits. Mobile features must not encourage unsafe exposure or imply hosted-cloud durability.
10. **The worktree is currently dirty in shared frontend files.** Future implementation must establish and preserve the pre-existing baseline; this plan does not authorize staging, rewriting, or reverting it.

Line references reflect the current 2026-07-31 working tree and may shift when existing changes land.

## Product principles

1. **Phone is a command center, not a miniature IDE.**
2. **Conversation remains home.** Modal/task surfaces must return to the same transcript and draft.
3. **Navigation and actions are distinct.** Bottom destinations navigate; composer/app-bar controls act.
4. **Explicit task state beats raw streaming output.** Users should know `running`, `needs input`, `failed`, or `done` without reading tool logs.
5. **Progressive disclosure reduces verbosity without deleting truth.** Final answers, safety consequences, scope labels, errors, and remote-exposure warnings remain intact.
6. **One transient surface at a time.** No sheet → popover → dialog stacks.
7. **Width chooses architecture, with one explicit compact-landscape-phone posture rule; pointer capability otherwise chooses hit-area/hover treatment.** Existing wide coarse-pointer desktop behavior remains unchanged until separately approved.
8. **Desktop is a frozen contract.** Mobile work is root-scoped, flag-gated, and verified against desktop equivalence.
9. **The server is authoritative.** Offline UI may preserve drafts and cached metadata but must not fabricate task continuation or auto-replay ambiguous mutations.
10. **Accessibility defines completion.** Touch, keyboard, VoiceOver/TalkBack, focus, reduced motion, contrast, and announcements are first-class acceptance gates.

## User jobs and success criteria

| Mobile job | Success criterion |
|---|---|
| Start work | User can choose/create a session, add context, and send a prompt with one hand without opening the Control Deck |
| Switch work | User can find and switch among 10+ grouped sessions in under three interactions while preserving drafts and scroll state |
| Monitor work | User can identify running, blocked, failed, and completed work from Chat, Sessions, and Activity without reading raw logs |
| Intervene | User can answer a blocker, steer, queue a follow-up, retry, or abort through a visible tap-confirm path; hold-to-abort remains an optional fast path |
| Review output | Final answer is readable first; tool logs, thinking, diffs, and raw metadata are available through disclosures |
| Inspect project | Files, Git, queue, and workflow state are reachable from one Project destination |
| Leave and return | Browser background/foreground, PWA resume, or notification click restores the exact session/run and reconciles server truth |
| Work with keyboard open | Active session/run state, input mode, attachments, and primary action remain visible and unobscured |
| Use assistive technology | Every flow is operable via touch, hardware keyboard, VoiceOver/TalkBack, and visible non-gesture controls |
| Stay on desktop | At desktop widths, shell layout, controls, shortcuts, storage, and flows are unchanged with mobile flags on or off |

## Target mobile information architecture

```text
Mobile application
├─ Chat (bottom destination)
│  ├─ active-session app bar
│  ├─ actionable run-status strip
│  ├─ transcript and contextual progress cards
│  └─ composer
├─ Sessions (bottom destination)
│  ├─ search
│  ├─ running / needs-input priority rows
│  ├─ project/custom groups
│  ├─ recent/open sessions and subagent views
│  └─ new session / choose folder / worktree
├─ Activity (bottom destination)
│  ├─ needs input
│  ├─ running
│  ├─ failed / retryable
│  └─ completed / dismissed
├─ Project (bottom destination)
│  ├─ Files
│  ├─ Git
│  ├─ current queue
│  ├─ saved prompt sequences
│  └─ workflows / app runner
└─ More / Inspector (app-bar action, not a destination tab)
   ├─ model / effort / context
   ├─ usage
   ├─ extensions
   ├─ settings by scope
   ├─ command palette
   ├─ diagnostics / events
   └─ remote / server controls
```

### Bottom navigation specification

- Four stable labeled items: **Chat**, **Sessions**, **Activity**, **Project**.
- Each item uses icon + one-word label and a selected state that is not color-only.
- Badges are reserved for actionable state:
  - Sessions: blocked/needs-input count, not total session count.
  - Activity: active or failed/blocked count.
  - Project: conflict/error indicator, not ordinary changed-file totals unless useful.
- Each badge is included in its navigation item’s accessible name (for example, `Activity, 2 need attention`). Badge refreshes are visual/state updates and do not create duplicate lifecycle announcements.
- The navigation bar never contains Send, New, Settings, or other actions.
- The Chat composer sits above the navigation bar and safe area.
- When the software keyboard opens, the navigation bar may temporarily collapse while the composer remains visible; a compact active-session/run strip must remain. It restores without scroll jump when the keyboard closes.
- Full-screen modal/workflow surfaces may cover navigation while active; Back/Close returns to the previously selected destination.
- Android browser/PWA Back dismisses the top transient surface before leaving the application. iOS browser/installed PWA always exposes equivalent visible Back/Close controls because no uniform system-Back event exists. Both paths call the same reducer transition and are tested.

### App bar specification

- Minimum 44px hit targets.
- Chat title control: activity glyph + project/session name; tap opens Sessions.
- Right-side actions: search/command palette and More/Inspector.
- Persistent, high-priority indicators: remote access open, offline/reconnecting, blocker/approval needed.
- Remove duplicated idle metrics and raw IDs.
- Plan default: move **Close all Tabs** to the Sessions action menu on phones while preserving the existing running-work warning and confirmation. Desktop placement remains unchanged.

## Mobile presentation and verbosity model

“Less verbose” is implemented as **presentation hierarchy**, not silent mutation of prompts, model output, or stored transcripts.

### Independent axes

1. **Layout density** — existing Comfortable/Compact browser setting.
2. **Mobile presentation** — `Essential | Detailed` display of chrome and process detail.
3. **Output processing** — existing `normal | compact-v1` protocol/renderer behavior.
4. **Model answer style** — not changed by this initiative unless Pi later exposes a canonical per-session setting.

### Default `Essential` mobile presentation

Visible by default:

- active session and work state;
- latest user prompt and complete final assistant answer;
- one compact current-run card (`Running · step · elapsed`) or blocker card;
- errors, warnings, approvals, remote exposure, and consequential confirmations;
- queue count only when nonzero;
- model/context only when actionable or explicitly opened;
- primary composer controls.

Collapsed by default:

- thinking/reasoning details;
- completed intermediate tool calls and results;
- repetitive event log entries;
- raw run IDs, paths, provider metadata, and telemetry;
- zero-value cost/queue/change metrics;
- completed subagent internals after a concise outcome summary is available.

Rules:

- Final user/assistant content is never truncated or summarized solely because the viewport is narrow.
- Long code, diffs, logs, artifacts, and tool output use labelled disclosures with copy/open actions.
- Safety consequences, scope labels (`This tab`, `This browser`, `Server`), destructive-action context, and remote-access warnings are never removed for brevity.
- `Essential` does **not** enable `compact-v1`; users may choose compact output separately and must retain the documented semantic warning.
- `Detailed` restores full process detail without changing server state.
- Per-card disclosure state may be remembered per tab; global mobile presentation is browser-scoped under a new versioned key.
- A future model-level “concise answer” preference requires a separate product/API decision because it changes conversation behavior across devices.

### Run/progress card

Collapsed form:

```text
● Running · reviewing tests · 1m 24s                 ›
```

Blocked form:

```text
! Needs your decision · allow write to package.json  Review
```

Completed form:

```text
✓ Completed · 3 files changed · tests passed         View
```

Expanded content may include current/previous steps, subagents, tool logs, validation, artifacts, and controls. Periodic elapsed-time updates are visual only and must not spam live regions.

## Destination UX specifications

### 1. Chat

- Preserve the existing authoritative transcript and composer; do not create a second mobile transcript model.
- Add a compact lifecycle strip for running/blocked/offline/queue/context-warning state.
- Use progressive disclosure for thinking, tools, bash, diffs, and subagent internals.
- Preserve existing user-intent scroll behavior. Opening the keyboard must not force a user who intentionally scrolled away to the bottom; show **Latest** instead. Phase 0 must characterize the existing VisualViewport heuristic (`prompt focus` plus viewport-shrink thresholds) on software keyboards, hardware keyboards, rotation, iOS browser, and installed PWA.
- Keep one visible primary action:
  - idle: Send;
  - running: Send with current `Follow-up` or `Steer` mode;
  - Abort remains separate: tap opens a clear confirm action; the existing three-second hold and keyboard Escape path remain optional fast alternatives.
- Keep attachment, current mode, nonzero queue, and More accessible with keyboard open.
- Replace nested composer menus with one bottom action sheet whose child pages replace content and provide Back.

### 2. Sessions

- Full-screen destination, not a wrapped dropdown.
- Search input at top; current session selected and scrolled into view.
- Priority group at top for `Needs input` and `Running`.
- Group rows by project/custom group; group headings are disclosures, individual session rows are selectable options/tabs.
- Row content: activity state, short session title, project/cwd basename, optional model label, last activity.
- New actions: current directory, choose directory, worktree, resume session.
- Preserve `switchTab()` draft/cache/SSE/generation-fence behavior.
- Returning to Chat restores prompt focus only when appropriate; keyboard selection should return focus predictably.
- Close-one/group/all actions live in row/group overflow menus with existing running-work warnings and confirmations.

### 3. Activity

Canonical state groups:

1. **Needs input** — extension UI blockers, approvals, questions.
2. **Running** — parent turns, subagent runs, workflows, app runners where relevant.
3. **Failed** — retryable/inspectable failures.
4. **Completed** — recent outcomes, dismissible without deleting session history.

Each item shows task/session identity, state, elapsed/finished time, current action or concise result, and exact next action. Selecting an item deep-links to its Chat/run output or decision surface. Notifications target the same identity.

Activity must consume existing tab/subagent/widget state; it must not invent a second lifecycle authority. A small pure selector/view model is preferred.

### 4. Project

- Top-level topic selector: Files, Git, Queue, Workflows.
- Files and viewers remain full-screen on phones with sticky Back/Close and actions.
- Git prioritizes conflict, changed-file summary, review/diff, then mutations; dangerous actions retain confirmations.
- Queue separates **Current queue** from **Saved prompt sequences**.
- Workflow/app-runner state uses compact cards and opens full-height surfaces.
- Project destination uses the active session’s project; switching sessions updates it through existing active-tab fencing.

### 5. More / Inspector

One full-height sheet or full-screen surface with task-oriented topics:

- Session: model, effort, context, compaction, session actions.
- Usage: providers in one topic.
- Extensions.
- Settings: grouped by This tab / This browser / Server / Native TUI.
- Commands: command palette entry; do not remove the current Commands section until parity/discoverability is proven.
- Diagnostics: events, update/server actions, advanced IDs/paths.

Reuse canonical controls and action functions. Do not duplicate settings writers. Desktop Control Deck markup and behavior remain present and unchanged during the first mobile rollout.

## Mobile-specific capabilities

### P0/P1 capabilities

1. **Deep-linked active-client notifications**
   - V1 scope is explicit: notifications may be created while a Web UI page/service-worker client is active; true Web Push after all clients close is out of scope because the repository has no Push subscription/server/VAPID path.
   - Notify only for completion, failure, and human decision/blocker.
   - Ask permission after a user starts work that can continue without attention, never on first visit.
   - Use versioned notification data: `{ v: 1, route, tabId, runId?, blockerId? }`; values are opaque IDs only—never titles, prompts, cwd, filenames, or credentials.
   - When a client exists, the service worker focuses it and sends `pi-webui:navigate:v1` through `postMessage`; without a client it opens a URL carrying the same bounded target. The app authenticates/reconnects, reconciles server state, validates the target, then navigates.
   - Stale/missing targets fall back visibly to Activity or Sessions with an explanation.
   - Provide an in-app Activity fallback when notifications are unavailable, denied, or the app was fully closed. A future true-Web-Push feature requires a separate security/privacy architecture and approval.

2. **Background/foreground continuity**
   - Separate client connection state from Pi/server task state.
   - On `visibilitychange`, `pageshow`, or notification return, refresh tabs/state/messages and reconcile selected run before declaring status.
   - Show `Reconnecting`, `Continued while away`, `Paused/offline`, or `Needs attention` truthfully.

3. **Offline drafts and recovery**
   - Cache shell, per-session text draft, selected destination, and bounded recent session/activity metadata.
   - V1 stores attachment metadata only; browser `File` objects are not recoverable after reload. Restored attachment chips show **Reselect required** and never imply the binary is still available. IndexedDB blob persistence is out of scope until quota, expiry, privacy, and clear-data rules are approved.
   - Do not auto-submit queued prompts after ambiguous disconnect.
   - A failed send shows `Not sent`, Retry, and Discard; retry uses an idempotency/request identity contract before automatic replay is considered.
   - Offline shell never claims that Pi is running when the backend cannot be reached.

4. **Unified context capture**
   - One Add Context sheet: Camera, Photos, Files, Paste text.
   - Preview chips show type, size, upload/preparation state, remove/edit.
   - Permission prompts are contextual and preceded by a reason.
   - Start with current file/image capabilities; live camera/screen sharing is a later, separately approved feature.

5. **PWA install education**
   - Contextual, dismissible install guidance after repeat use or explicit menu action.
   - Never block first load or core browser use.
   - Feature-detect platform support and explain iOS/Android differences without claiming universal install/push support.

### P2 enhancements after the core validates

- Editable dictation with visible transcript before send.
- Full voice conversation only after captions, mute/end, interruption, privacy, background, and failure behavior are validated.
- Web Share Target / share-to-prompt experiment where platform support is sufficient.
- Optional swipe-to-dismiss or pull-to-refresh only as redundant affordances with visible button/keyboard parity.
- Haptics only in a future native wrapper decision; do not use `vibrate()` as assumed cross-platform UX.
- Live camera/screen sharing only with a demonstrated coding-agent use case, explicit consent, persistent indicator, and stop control.

## Phone, tablet, and desktop behavior

### Phone (`<=720 CSS px`, plus compact landscape-phone posture)

Mobile v2 activates when width is `<=720px`, or when `(pointer: coarse) and (hover: none) and height <=500px and width <=950px`. The second rule keeps common 844×390 and 932×430 phone rotations in the phone shell while excluding ordinary tablets/desktops. Phase 0 must validate foldables and unusual devices before the rule becomes default.

- Mobile Experience v2 flag may activate.
- Four-item bottom navigation.
- Full-screen Sessions/Activity/Project; full-height More sheet.
- Single bottom action sheet, no nested popovers.
- Full-screen file/dialog/workflow surfaces.
- Composer and compact active-session strip remain keyboard-safe.
- 44px minimum targets; safe-area padding on fixed edges.

### Tablet (`721–1050 CSS px`, excluding compact landscape-phone posture)

Implemented only after phone preview evidence:

- Separate `tabletShellV2` flag.
- Recommended: navigation rail or stable top destinations, not phone bottom navigation copied blindly.
- Inspector as a right-side sheet (`min(30rem, 72vw)`), not nearly full-screen.
- Visible horizontally scrollable session tabs may remain.
- File/chat coexistence in landscape is a product decision; safest initial behavior is full-screen file replacement.
- 44px targets on coarse pointers; fine-pointer layouts may retain desktop density.

### Desktop (`>=1051 CSS px`)

- Existing grid, side panel, tab strip/left layout, split terminal, resizable file viewer, footer, composer, dialogs, shortcuts, and settings remain unchanged.
- Mobile root state is inactive; mobile event handlers do not mutate desktop storage.
- Feature flag on/off produces equivalent desktop layout and behavior.
- Current wide coarse-pointer behavior remains unchanged until a separate approved migration. Recommendation for that future decision: width chooses architecture and coarse pointer only enlarges targets.

## State, route, and deep-link contract

Use a pure, explicit shell reducer and keep connection state separate from agent/run lifecycle:

```text
viewportMode   = phone | tablet | desktop
posture        = regular | compactLandscapePhone
featureMode    = legacy | preview | v2
connection     = online | reconnecting | offline | restarting
keyboard       = closed | open
route          = chat | sessions | activity | project
surface        = none | more | actionSheet | file | dialog
surfacePage    = root | child-id
activityItem   = queued | running | blocked | failed | completed | cancelled | dismissed
```

`activityItem` is per run/work item, not one global shell state. Connection states overlay lifecycle truth rather than replacing it; for example a run may remain `running` while the client is `offline`, but the UI labels it unverified until reconciliation.

Invariants:

- One route and at most one transient surface are interactive.
- Dialog/restart/offline surfaces supersede ordinary sheets.
- The reducer is the only writer of v2 surface visibility; legacy booleans become derived/delegated state while v2 is active.
- Route changes preserve active session, draft, attachments, transcript scroll, and server work.
- Breakpoint/posture changes preserve route when available, close only incompatible transient surfaces, and do not mutate Pi/server state or desktop preferences.
- Back closes `dialog → child page → sheet → route history → app exit` in the documented order.
- Active-tab generation fencing remains mandatory for async updates.

### Versioned navigation target

```json
{
  "v": 1,
  "route": "chat | sessions | activity | project",
  "tabId": "opaque-id",
  "runId": "optional-opaque-id",
  "blockerId": "optional-opaque-id"
}
```

- URL form uses bounded query keys `mobileRoute`, `tab`, `run`, and `blocker`; notification data uses the JSON form. No private titles, prompts, paths, filenames, credentials, or raw payloads are encoded.
- Route changes, sheet roots, and sheet child pages create app-owned `history.pushState` entries. Close/Escape/Android Back uses `history.back()` when the top entry is app-owned; visible iOS Back/Close calls the same transition.
- Reload validates the target after authentication/PIN and authoritative reconciliation. Unknown/stale targets fall back to Activity (run/blocker) or Sessions (tab) with a visible notice.
- Existing clients receive targets through service-worker `postMessage`; new clients receive the bounded URL target.

Recommended future module: `public/mobile-shell-state.mjs` with pure unit tests. Browser rendering/action functions remain in existing modules until incremental extraction is safe.

## Key transition contract

| From | Event | To | Required effects |
|---|---|---|---|
| Chat | tap session title | Sessions | close queue/action sheet/More; focus search/current row |
| Sessions | choose session | Chat | invoke existing tab switch; preserve old draft; restore target; reconcile SSE/state |
| Any route | tap bottom destination | target route | close transient surface; retain selected session and draft |
| Chat | tap More | More root | close competing menus; focus heading/first action |
| More root | choose topic | More child | replace content; show Back; no nested popover |
| Any surface | Back/Escape/Close | previous state | restore trigger focus and scroll |
| Chat | prompt focus + keyboard detected | Chat focus mode | keep session/run/mode strip, input, attachments, primary action; hide only nonessential chrome |
| Focus mode | keyboard closes | Chat | restore nav/chrome without scroll or selection jump |
| Idle | submit | Running | optimistic prompt; lifecycle announcement once; authoritative state follows |
| Running | submit Follow-up/Steer | Running | route through existing behavior; show visible mode and queue result |
| Running | tap Abort → confirm, hold Abort, or keyboard abort | cancelled / failed | preserve the three-second hold as a fast path, provide tap-confirm parity, and announce result once |
| Any | backend unreachable | Offline | preserve draft; show truthful recovery; no automatic mutation replay |
| Any | notification click | exact target | start/focus client, authenticate, reconcile, then select tab/run/blocker |
| Phone | resize to tablet/desktop | target legacy/v2 shell | close transient mobile surfaces; preserve server/tab state; restore desktop preferences |

## Desktop-isolation architecture

### Feature flags

- URL override: `?mobileShell=v2|legacy` (highest precedence and usable even when the UI is broken).
- Browser preference: `pi-webui-mobile-shell-v2 = preview | legacy`.
- Package default: `MOBILE_SHELL_V2_DEFAULT = false|true` in the shell-state module.
- Tablet uses separate `?tabletShell=v2|legacy`, `pi-webui-tablet-shell-v2`, and package default.

Precedence is URL override → browser preference → package default. There is no remote/server kill switch in v1 because no feature-flag delivery channel exists; adding one would be a separate API/security decision. Do not reuse density, output-mode, side-panel, or tab-layout storage. Unknown values fail to legacy.

### CSS isolation

- Add a dedicated final mobile layer/file; all selectors require a root state such as `html[data-mobile-shell="v2"]` and a width media query.
- No unscoped edits to shared desktop `.layout`, `.chat`, `.message`, `.composer`, `.terminal-tabs`, or `.side-panel` rules.
- Tablet selectors require a separate root flag.
- Coarse-pointer overrides may increase targets and disable hover effects only.
- Preserve legacy mobile selectors while preview is opt-in; remove them only after default-on stability and rollback coverage.

### JavaScript isolation

- One width/posture classifier and pure reducer.
- Existing actions remain authoritative: `switchTab`, prompt routing, queue mutation, file/Git actions, settings, notifications, SSE.
- Feature off executes current paths exactly.
- The reducer is the only v2 surface-state writer. Recorded legacy event sequences must produce equivalent visibility before v2 destinations replace them.
- Explicitly gate legacy mobile mutations while v2 is active, including keyboard auto-close/forced-scroll in `updateVisualViewportVars`, mobile tab expansion, footer expansion/pickers, dropdown-bound calculations, composer-action state, and `syncMobileChatToBottomForInput`. Maintain an enumerated call-site test so legacy behavior cannot run underneath v2.
- Teardown restores neutral state without touching desktop preferences.
- Every new imported public module requires all four wiring changes: `package.json` syntax check, `bin/pi-webui.mjs` static allowlist, `public/service-worker.js` `APP_SHELL` plus coherent cache revision, and import/boot closure tests.

### DOM strategy

- One canonical instance of every setting/action.
- Add mobile route containers and navigation landmarks, but reuse existing render data/action functions.
- Avoid duplicating the entire transcript, Control Deck, or desktop shell.
- If existing nodes must be reparented, record anchors and restore exact ordering/focus/state before leaving mobile v2; test listener, value, and focus preservation.
- Desktop markup may gain hidden mobile-only landmarks, but computed desktop layout and action inventory must remain equivalent.

## Accessibility and platform requirements

- 44×44 CSS px hit area on phones and coarse pointers, including Compact density.
- Text floor remains 12px; prompt/body approximately 16px.
- No hover-, voice-, or gesture-only action. Abort has visible tap-confirm parity; hold remains optional.
- Remove `aria-live` from `#chat` and route started/blocked/completed/failed/offline/reconnected announcements through one dedicated atomic lifecycle announcer. Token, elapsed, badge-count, and metric updates are silent.
- Full keyboard support: roving focus for navigation/destinations, Home/End, Enter/Space, Escape, predictable focus return.
- Group headings are disclosures, not tabs; individual destinations/sessions have complete semantics.
- Destination badges are reflected in accessible names without duplicate live announcements.
- Visible focus, selected, warning, error, and destructive state in forced colors.
- 200% text resize for all flows. All flows reflow at 400% / 320 CSS px without two-dimensional page scrolling; horizontal scrolling is allowed only for essential code, tables, and diffs.
- `prefers-reduced-motion` removes required travel/animation.
- VoiceOver/TalkBack verification for navigation, composing, blocker review, and full-screen surfaces.
- One scroll container per full-screen route/sheet; sticky headers/actions; contained overscroll.
- iOS safe areas and visible in-app Back/Close, plus Android keyboard/system Back, are tested in browser and installed PWA.
- Existing voice entry points remain in the capability inventory and must survive action-sheet replacement.
- Sessions, Activity, Project, and More each define loading, empty, error, retry, and permission-denied states.
- Remote/LAN microphone, camera, file, and notification permissions remain contextual and revocable.

## Phased implementation plan

### Phase 0 — Baseline, correctness, dependencies, and test harness (blocking)

**Objective:** make mobile change verifiable and resolve or explicitly no-go every correctness defect that would invalidate UX conclusions.

Entry decisions/defaults: all plan defaults in the decision table below are selected; any override must be recorded before its owning phase. Reconcile overlapping active plans and land/stash the current shared-file work through its owning session before mobile implementation begins.

Deliverables:

1. Capture current screenshots and behavior at phone, compact landscape phone, tablet, fine-pointer desktop, coarse-pointer desktop, keyboard-open/closed, light/dark, browser/PWA.
2. Create a capability/action inventory for every current Control Deck/composer/tab/voice action and empty/error state.
3. Add package-owned Playwright/axe wiring: `@playwright/test` and `@axe-core/playwright` as locked dev dependencies, `playwright.config.mjs`, hermetic fake-Pi/server fixtures, `test:browser` script, and documented Chromium/WebKit provisioning/cache commands. WS0 owns `package.json` and `package-lock.json` for this purpose.
4. Characterize VisualViewport keyboard heuristics, foreground/background, notification limitations, and offline/reconnect behavior.
5. Restore and enforce the 44px touch-target policy before Phase 1. Every changed static assertion records `intent preserved | superseded | obsolete` in implementation evidence.
6. Re-verify service-worker import closure/write lifetime, request timeouts, SSE backpressure, and transcript memory. Each item receives one disposition: fixed before Phase 1; proven non-applicable; or explicitly deferred with owner, evidence, threshold, and no-go condition. Any unresolved High defect blocks Phase 1. Memory optimization may defer only when profiling shows nonmaterial impact.
7. Reconcile dependency contracts with durable session continuity and other active shared-file plans; record which request identity, replay, reconnect, and notification APIs v2 reuses.
8. Record the dirty-worktree baseline and do not stage/revert unrelated changes.

Exit gates:

- Browser harness installs/runs from a clean checkout with pinned dependencies and documented browser provisioning.
- Existing mobile and three fine-pointer desktop golden flows are reproducible; coarse-pointer desktop is separately characterized against its current baseline.
- Full package baseline is green or every failure is attributed and accepted as a no-go/defer decision.
- No unresolved High correctness/a11y defect remains.
- Action inventory and overlapping-plan dependency table are complete.

### Phase 1 — Shell foundation, routes, and isolation

**Objective:** land no-visible-change infrastructure behind executable client-side flags.

Deliverables:

- width classifier plus compact-landscape-phone posture rule;
- exact URL/browser/package flag precedence and `?mobileShell=legacy` emergency rollback;
- pure route/surface reducer, versioned navigation target, service-worker message contract, and Back/Escape/history stack;
- reducer ownership of all v2 surfaces plus legacy-handler suppression under flag-on;
- root attributes and scoped CSS layer;
- desktop flag-on/off equivalence tests;
- four-place static asset wiring and closure tests for new modules;
- local diagnostics for route/surface/focus invariant failures, with no user content.

Exit gates:

- flag off is current behavior;
- fine-pointer desktop is equivalent at 1280×800, 1440×900, and 1920×1080; coarse-pointer desktop is byte/behavior equivalent to its recorded legacy baseline;
- 719/720/721, 1049/1050/1051, and 390×844 ↔ 844×390 rotation preserve route, tab, draft, and active run;
- flag-on phones bypass every enumerated legacy mobile mutation;
- reducer replay tests prove one-surface visibility and no dual authority;
- URL rollback closes v2 surfaces without restarting or mutating sessions, including with an open draft/run.

### Phase 2 — Phone app bar, navigation, Sessions, and parity routes

**Objective:** replace the mobile tab popover with stable navigation and ensure all four destinations are functional before any user preview.

Deliverables:

- four-item bottom navigation;
- compact app bar and persistent remote/offline/blocker indicators;
- full-screen Sessions route with search, grouping, activity, new actions, and empty/error/retry states;
- parity-level Activity route over existing running/blocker/completed data;
- parity-level Project route exposing existing Files/Git/Queue/Workflow actions;
- complete navigation/session semantics and focus management;
- versioned exact-target route identity;
- no change to desktop tab strip or backend tab lifecycle.

Exit gates:

- no inert/placeholder destination exists;
- 10+ grouped sessions remain usable at 320px;
- selecting a session preserves old/new drafts, scroll anchors, attachments, and SSE state;
- blocked/running sessions are identifiable without opening each chat;
- desktop tab screenshots/shortcuts unchanged.

### Phase 3 — Chat density, progress, composer, and action sheet

**Objective:** make mobile less verbose and more controllable without changing transcript truth.

Deliverables:

- Essential/Detailed mobile presentation setting;
- canonical compact run/progress/blocker cards;
- thinking/tool/bash/diff progressive disclosure;
- remove `aria-live` from `#chat` and add the dedicated lifecycle announcer;
- stable keyboard focus mode retaining active session/run/mode/attachments/primary action;
- explicit suppression of legacy forced-scroll/auto-close behavior under v2;
- one bottom action sheet with replace-in-place child pages and voice-entry parity;
- tap-confirm Abort plus existing hold/keyboard fast paths;
- 44px composer targets and safe-area/VisualViewport behavior;
- user-intent scroll preservation and Latest behavior.

Exit gates:

- final answer and user content remain complete;
- safety/scope/destructive text remains visible;
- no nested mobile popover stack;
- Send/Steer/Follow-up/Abort are reachable with keyboard open at 320–430px;
- after keyboard close, the same transcript anchor remains visible and stable-layout scroll delta is <=1 CSS px;
- no token/elapsed/badge update is announced.

### Phase 4 — Full Activity and Project destinations

**Objective:** replace parity adapters with task-first agent work and project context before preview.

Deliverables:

- Activity selectors over existing tab/subagent/widget state;
- needs-input/running/failed/completed groups with loading/empty/error/retry states;
- exact deep-links and intervention actions;
- Project topics for Files/Git/Queue/Workflows;
- full-screen file/diff/workflow surfaces with sticky headers/actions;
- Control Deck capability parity inventory remains green.

Exit gates:

- every blocker can be found and answered from Activity;
- completed/failed work can be inspected/dismissed without deleting session history;
- every existing Files/Git/Queue/Workflow action remains reachable;
- no second lifecycle/state authority is introduced;
- phone WS6 accessibility pass is green before user preview.

### Phase 5 — Mobile continuity, active-client notifications, capture, and install UX

**Objective:** deliver mobile-specific value within the existing local-PWA architecture.

Deliverables:

- notification permission after demonstrated value;
- versioned notification data and service-worker focus/open + `postMessage` exact-target contract;
- explicit active-client-only delivery copy and no true-Web-Push claim;
- in-app notification/Activity fallback;
- truthful background/foreground reconciliation;
- offline draft/retry/discard state with mutation deduplication contract;
- metadata-only attachment restoration with **Reselect required**;
- unified Camera/Photos/Files/Paste context sheet;
- contextual PWA install education;
- local diagnostics Copy/Clear.

Exit gates:

- active-client notification opens the exact reconciled run/blocker; stale targets fall back visibly;
- app-fully-closed behavior is documented as no notification delivery in v1;
- offline simulation cannot silently lose or duplicate a prompt;
- core flows work when notifications/install/camera are unavailable;
- no feature requires unsafe remote exposure;
- final phone WS6 pass is green before default-on.

### Phase 6 — Tablet adaptation (separate rollout)

**Objective:** optimize medium widths without copying phone or changing desktop.

Deliverables:

- separate tablet flag;
- navigation rail/top destination prototype;
- right-side inspector sheet;
- coarse/fine pointer adaptation;
- approved portrait/landscape file policy;
- tablet keyboard/hardware-keyboard validation.

Exit gates:

- tablet experience passes its own evidence gate;
- phone and desktop golden flows unchanged;
- tablet rollout can be disabled independently.

### Phase 7 — Optional voice/share enhancements

Proceed only after Phases 0–5 are stable and a specific user job justifies each capability.

Potential items: editable dictation, full voice conversation, share-to-prompt, live camera/screen context. Each needs its own privacy, permission, accessibility, background, and failure contract.

## Workstream ownership and merge order

### WS0 — Characterization and browser harness

Owns tests, fixtures, screenshots, action inventory, baseline/dependency report, `playwright.config.mjs`, `package.json`, and `package-lock.json` browser-test wiring only. No product behavior changes outside correcting Phase-0 High baseline defects through separately bounded work.

### WS1 — Shell state, flags, and desktop isolation

Likely paths:

- new `public/mobile-shell-state.mjs`;
- new focused tests;
- narrow integration in `public/app.js`, `public/index.html`, and a root-scoped mobile CSS layer;
- `package.json` syntax wiring, `bin/pi-webui.mjs` static allowlist, `public/service-worker.js` app shell/cache identity, and closure tests for any new asset.

Must not change mobile destination content or backend action semantics. Must explicitly gate every enumerated legacy mobile handler under v2 and make the reducer the only v2 surface-state writer.

### WS2 — Navigation and Sessions

Owns app bar, bottom navigation, Sessions route, session semantics, and new-session entry points. Reuses existing tab data and `switchTab()`.

Must not change desktop tabs, Pi process lifecycle, or prompt routing.

### WS3 — Chat and composer

Owns presentation state, run cards, disclosures, keyboard focus mode, More action sheet, and touch sizing.

Must not change `compact-v1`, model prompts, server transcript semantics, or desktop composer behavior.

### WS4 — Activity and Project

Owns view selectors, route rendering, intervention routing, Project topic mapping, and full-screen mobile wrappers.

Must not create parallel lifecycle or settings state.

### WS5 — Continuity and mobile-specific capabilities

Owns notification deep-links, offline draft/send state, context capture, install education, and local diagnostics.

Must stop for any new authentication, remote-exposure, credential, or mutation replay decision.

### WS6 — Accessibility/validation

Independent cross-cutting acceptance for every integrated surface: touch targets, semantics, focus, screen readers, live regions, zoom/reflow, contrast, reduced motion, safe areas, and browser/device flows. A phone pass gates user preview and another gates phone default-on; tablet receives its own pass before tablet preview/default-on.

### Integration rules

- One writer at a time for `public/app.js`, `public/styles.css`, and `public/index.html` in the shared worktree.
- Prefer new pure modules and focused tests; do not big-bang rewrite the frontend.
- Merge order: dependency reconciliation → WS0 → WS1 → WS2 → WS3 → WS4 → phone WS6 preview gate → user preview → WS5 → phone WS6 default-on gate → phone default-on → Phase 6 tablet adaptation → tablet WS6 gate.
- Integrate and validate one surface at a time.
- Every static assertion changed must record whether its original intent is preserved, explicitly superseded, or obsolete.
- Do not combine navigation, output protocol, backend lifecycle, and broad IA deletion in one release.

## Validation plan

### Automated layers

1. **Pure unit tests**
   - viewport classifier;
   - shell reducer and one-surface invariant;
   - Back/Escape stack;
   - route/deep-link normalization;
   - presentation selectors and Activity grouping;
   - feature-flag precedence/rollback.

2. **Static contracts**
   - all v2 selectors root-scoped;
   - no unguarded desktop selector change;
   - 44px touch targets;
   - static import/server allowlist/service-worker closure;
   - no automatic `compact-v1` or density mutation;
   - desktop storage keys untouched by mobile transitions.

3. **Playwright flows**
   - first load/select cwd;
   - send with keyboard open;
   - session switch with preserved drafts;
   - running → steer/follow-up → blocked → answer → completed;
   - Activity deep-link;
   - Project Files/Git/Queue flows;
   - More child-page Back/Escape/focus return;
   - background/resume and offline/reconnect;
   - notification target restoration where automation permits;
   - desktop flag-on/off equivalence.

4. **axe checks**
   - Chat idle/running/blocked;
   - Sessions;
   - Activity;
   - Project topics;
   - More/Settings;
   - file viewer and critical dialogs.

5. **Visual regression**
   - phone/tablet/fine-pointer desktop/coarse-pointer desktop × light/dark;
   - keyboard open/closed;
   - idle/running/blocked/offline;
   - safe-area fixtures;
   - fixed viewport, font, timestamps/IDs, and approved dynamic masks;
   - zero unexpected pixel difference for desktop flag-off/on after masks, plus exact computed checks for grid columns, panel widths, visibility, and fixed-position regions;
   - 200% text resize, 400% reflow, and custom-background contrast.

6. **Manual device checks**
   - iOS Safari current/previous major, browser + installed PWA;
   - Chrome Android current, browser + installed PWA;
   - iPadOS portrait/landscape with hardware keyboard;
   - Android Back and TalkBack;
   - iOS VoiceOver and keyboard composition;
   - touch desktop characterization.

### Device and boundary matrix

| Mode | Sizes | Required states |
|---|---|---|
| Small phone | 320×568, 360×640 | keyboard, long answer, blocker, 10+ sessions |
| Modern phone | 390×844, 430×932 | PWA, safe area, notifications, attachments |
| Phone landscape | 844×390, 932×430 | compact-landscape phone shell; rotate with open draft/surface/run; keyboard |
| Tablet | 768×1024, 820×1180, 1024×768 | touch, hardware keyboard, inspector/file |
| Desktop | 1280×800, 1440×900, 1920×1080 | flag off/on equivalence, split/file/side panel |
| Boundaries | 719/720/721 and 1049/1050/1051 | resize with open draft/surface/run |

### Release commands

Expected commands after implementation introduces the named tests:

```bash
node --check public/mobile-shell-state.mjs
node --check public/app.js
node --check public/service-worker.js
node tests/mobile-shell-state.test.mjs
node tests/mobile-shell-static.test.mjs
node tests/mobile-static.test.mjs
node tests/chat-scroll-intent-static.test.mjs
node tests/streaming-ui-coupling.test.mjs
npm run test:browser
npm test
npm run check
npm pack --dry-run
```

Also run `git diff --check` scoped to this package and inspect service-worker/cache-version consistency.

## Measurable acceptance gates

### Navigation

- Four stable, functional destinations are visible and labelled at phone widths.
- No bottom item performs an action.
- From Chat, reaching a visible target session requires two activations (Sessions, then row); search typing is not counted. A fixture records start/end state.
- 10+ sessions are searchable/grouped without horizontal overflow.
- Back/Escape closes only the top surface and restores focus; iOS visible Back/Close and Android system Back produce the same reducer state.

### Less verbosity

- Idle/zero metadata is absent from default phone chrome.
- Running state is understandable from one compact card.
- Intermediate tool/thinking/log detail is collapsed by default but fully inspectable.
- Final answers, safety text, scope labels, errors, and confirmations remain complete.
- No viewport-based prompt or output-mode mutation occurs.

### Composer

- Prompt, attachments, mode, and primary action remain usable with keyboard open.
- No control is covered by software keyboard/safe area at required phone sizes.
- Touch targets are at least 44×44px.
- Intentional transcript scroll is not overridden.

### Activity/continuity

- Needs-input, running, failed, and completed states are explicit.
- Every notification/in-app alert resolves to the exact tab/run/blocker after reconciliation.
- Offline/disconnect tests do not silently lose or duplicate prompts.
- Server/client lifecycle is described truthfully.

### Accessibility

- No serious/critical axe violation in scoped critical flows, or explicit reviewed waiver.
- VoiceOver/TalkBack can navigate, compose, switch sessions, and answer a blocker.
- Live regions announce lifecycle changes once and not token/elapsed updates.
- Forced colors, reduced motion, 200% zoom, and hardware keyboard flows pass.

### Desktop preservation

- Fine-pointer desktop screenshots have zero unexpected difference after approved dynamic masks, and key computed layouts are exact with flags off/on. Coarse-pointer desktop is characterized separately and remains equivalent to its recorded legacy baseline.
- Existing desktop action inventory, shortcuts, side-panel state, tab layout, split/file behavior, and storage are unchanged.
- No mobile feature is default-active at desktop widths.
- Full package tests remain green.

## Rollout

1. **Characterization:** tests/screenshots/dependency disposition only.
2. **Developer canary:** `?mobileShell=v2`; may expose in-progress routes only to developers; no persistence; default off.
3. **User preview:** only after all four destinations are functional and the phone WS6 preview gate passes; browser-scoped preference; `?mobileShell=legacy` escape hatch.
4. **Phone default-on:** only after Phase 5 and the final phone WS6 gate pass; tablet remains off.
5. **Tablet preview/default-on:** separate evidence, flag, WS6 pass, and release.
6. **Legacy cleanup:** at least one stable release after phone/tablet default-on and rollback validation.

A percentage rollout is unnecessary without remote configuration. Deterministic local preview and release channels are safer for a local developer tool.

## Rollback

- `?mobileShell=legacy` overrides stored preference and package default without using the UI; unknown flag values also fail to legacy.
- Rollback removes only v2 root state and closes transient v2 surfaces.
- Tabs, drafts, sessions, attachment state, queues, active Pi turns, and server processes remain untouched.
- Desktop preferences are never rewritten.
- Legacy mobile remains available for at least one stable release after default-on.
- Browser tests perform rollback with an open draft, route, sheet, and active run.
- Package downgrade procedure: force legacy, confirm active work is unaffected, install the prior coherent package, and reload. Every release keeps `index.html` import revision, server allowlist, `APP_SHELL`, `CACHE_NAME`, and package checks coherent; mixed old-JS/new-HTML revisions fail to the boot recovery UI rather than partially activating v2.

## Selected plan defaults and phase entry decisions

These defaults make the plan internally complete. The user may override them before implementation; an override is recorded before the owning phase begins.

| Decision | Selected default | Entry gate |
|---|---|---|
| Phone Close all Tabs | Sessions overflow; preserve warning/confirmation | Phase 2 |
| Running composer | Follow-up/Steer mode selector + Send; separate Abort with tap-confirm, hold, and keyboard parity | Phase 3 |
| Tablet navigation | Separate rail/top-destination prototype, not copied phone bottom bar | Phase 6 |
| Tablet file behavior | Full-screen replacement first | Phase 6 |
| Browser history | Versioned route/surface history; Android Back and visible iOS Back share reducer | Phase 1 |
| Commands section | No deletion in v1; require palette parity evidence first | Phase 4 |
| Analytics | Local-only diagnostics; outbound telemetry off | Phase 1/5 |
| Touch desktop | Preserve recorded legacy behavior in this initiative | Phase 1 |
| Model-level concise answers | Out of scope until Pi exposes a canonical cross-device setting | Phase 3 |
| Voice/camera/screen | Preserve existing voice entry; editable dictation/files first; richer modes separate | Phase 3/7 |
| Notification delivery | Active-client notifications only; no true Web Push in v1 | Phase 5 |
| Landscape phone | Compact-landscape phone shell through explicit posture rule | Phase 1 |

## Explicit non-goals

- Native iOS/Android wrapper, Capacitor/TWA, or app-store distribution.
- Separate duplicated mobile frontend or transcript state.
- Full mobile IDE/terminal parity.
- Automatic `compact-v1`, Compact density, model, effort, or prompt changes by viewport.
- Deleting desktop Control Deck sections during the initial rollout.
- Auto-replaying ambiguous offline mutations.
- Unsafe remote-access expansion or claims that the PIN gate is hardened multi-user authentication.
- Gesture-only navigation, speculative haptics, or novelty interactions before core flows validate.
- Big-bang modularization or framework migration.

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Shared DOM/CSS regresses desktop | High | root-scoped flags, no unscoped desktop rules, desktop equivalence gate |
| Static-test churn becomes regex appeasement | High | browser behavior first; disposition original assertion intent explicitly |
| “Less verbose” hides safety/scope truth | High | immutable visibility rules for consequences, scope, errors, remote warnings |
| Client disconnect duplicates/losses prompts | High | explicit request identity, no automatic ambiguous replay, reconciliation tests |
| Activity becomes a second state authority | High | pure selectors over existing server/tab/subagent state |
| Dirty shared frontend files conflict | High | one writer, recorded baseline, narrow sequential workstreams, no staging/revert |
| Service-worker mixed revisions | High | import/allowlist/app-shell closure test and coherent cache bump |
| iOS keyboard/safe-area regressions | High | package browser harness plus physical iOS/PWA validation |
| Navigation feels native but reduces capability | Medium | action inventory and capability parity gate |
| Bottom bar competes with composer | Medium | measured keyboard/focus layouts; temporary nav collapse with retained run strip |
| Notifications unavailable on LAN HTTP/browser | Medium | feature detection and in-app Activity fallback |
| Remote mobile use increases security misunderstanding | High | preserve local default; persistent exposure warning; explicit trust-model copy |
| Monolith makes parallel implementation unsafe | High | one writer for shared files; pure modules; surface-by-surface integration |

## Source references

Official/current sources accessed 2026-07-31:

- OpenAI, ChatGPT Voice: <https://help.openai.com/en/articles/8400625-voice-mode-faq>
- OpenAI, Projects in ChatGPT: <https://help.openai.com/en/articles/10169521-projects-in-chatgpt>
- OpenAI, Scheduled Tasks in ChatGPT: <https://help.openai.com/en/articles/10291617-tasks-in-chatgpt>
- Anthropic, Claude Code on mobile: <https://code.claude.com/docs/en/mobile>
- Anthropic, Claude Cowork mobile/web: <https://claude.com/blog/cowork-web-mobile>
- Anthropic, Claude app release notes: <https://docs.anthropic.com/en/release-notes/claude-apps>
- Google, Gemini Live on Android: <https://support.google.com/gemini/answer/15274899?hl=en&co=GENIE.Platform%3DAndroid>
- Perplexity, “What is a Project?” (current page title; legacy URL slug): <https://www.perplexity.ai/help-center/en/articles/10352961-what-are-spaces>
- Microsoft, voice chat in Copilot mobile: <https://support.microsoft.com/en-us/topic/use-voice-to-chat-in-the-microsoft-365-copilot-app-1ca9b60e-0072-4246-ab88-c0015f8c92d4>
- Microsoft, file upload in Copilot: <https://support.microsoft.com/en-us/microsoft-copilot/file-upload-in-microsoft-copilot>
- Apple Human Interface Guidelines, Tab bars: <https://developer.apple.com/design/human-interface-guidelines/tab-bars>
- Material Design 3, Navigation bar: <https://m3.material.io/components/navigation-bar/overview>

Repository sources:

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `public/manifest.webmanifest`
- `public/service-worker.js`
- `tests/mobile-static.test.mjs`
- `tests/chat-scroll-intent-static.test.mjs`
- `tests/streaming-ui-coupling.test.mjs`
- `README.md`
- `WEBUI-EXPERIENCE-RECOMMENDATIONS.md`
- `WEBUI-UX-IMPROVEMENTS.md`

## Planning verification record

Evidence gathered:

- local repository exploration and targeted source inspection;
- current mobile/static, scroll-intent, and streaming-coupling contracts inspected;
- four independent read-only research/recon/strategy/challenge subagents;
- official web research across AI chat/agent products and Apple/Material guidance;
- current dirty-worktree and architecture constraints recorded.

No implementation or product source file was changed by this planning task. The only intended project artifact is this plan.

## Independent review disposition

The review gate obtained all three requested read-only review artifacts, but reported only `2/3` qualifying because one attempt failed provider-diversity accounting and another provider exhausted. The parent inspected all three artifacts and independently checked their repository evidence. The gate failure is recorded; it is not represented as a three-provider qualifying quorum.

| Review finding | Disposition | Plan action / rationale |
|---|---|---|
| UX B1 / Architecture F6 / Readiness B7 — landscape-phone classifier gap | accepted | Added compact-landscape phone posture, rotation contract, and gates. |
| UX M1 — `#chat` live region conflicts with single announcer | accepted | Explicit Phase 3 removal and dedicated announcer requirement. |
| UX M2 — hold-only Abort contradicts gesture parity | accepted | Added tap-confirm alternative; hold/keyboard remain fast paths. |
| UX M3 — zoom/reflow ambiguity | accepted | Split 200% text resize from 400%/320px reflow for all flows. |
| UX N1 — keyboard heuristic risk | accepted | Added explicit Phase 0 characterization and legacy-handler suppression. |
| UX N2 — badge accessibility | accepted | Added accessible-name and no-duplicate-announcement rules. |
| UX N3 — iOS/Android Back split | accepted | Added visible iOS Back/Close and Android system-Back contract. |
| UX N4 — subjective scroll/interaction gates | accepted | Defined two-activation session flow and scroll-anchor/<=1px oracle. |
| UX N5 — voice entry parity | accepted | Added capability inventory/action-sheet parity requirement. |
| UX N6 — imprecise line references | accepted | Plan warns references move; Phase 0 re-anchors after dirty work lands. |
| UX N7 — unauditable research scores | accepted | Replaced row scores with evidence-strength labels. |
| UX N8 — keep nav on tall keyboards | deferred | Device evidence decides; current default permits temporary collapse with retained run strip. |
| UX N9 — destination empty/error states | accepted | Added loading/empty/error/retry requirements. |
| Architecture F1 — legacy JS runs under v2 | accepted | WS1 enumerates and gates legacy handlers; Phase 1 tests bypass. |
| Architecture F2 — service-worker drops exact target | accepted | Added versioned data, `postMessage`, open-window URL, reconciliation, stale fallback. |
| Architecture F3 — nonexistent server kill-switch channel | accepted | Removed server switch; exact URL/browser/package precedence selected. |
| Architecture F4 — desktop coarse-pointer ambiguity | accepted | Fine-pointer equivalence and separate coarse-pointer baseline now explicit. |
| Architecture F5 — reducer/legacy dual authority | accepted | Reducer is sole v2 writer; replay/visibility tests required. |
| Architecture F7 — incomplete public-module wiring checklist | accepted | Added package check, server allowlist, SW shell/cache, closure tests. |
| Architecture F8 — regex churn process risk | accepted | Promoted assertion-intent disposition to Phase 0 gate. |
| Architecture N1 — reparenting existing nodes is feasible | accepted as supporting evidence | Canonical-node/anchor strategy retained. |
| Architecture N2 — cache revision coupling | accepted | Rollback/release coherence contract expanded. |
| Architecture N3 — uneven notification platform behavior | accepted | Active-client scope and platform fallback are explicit. |
| Architecture N4 — confidence limits | accepted | Final confidence remains bounded by absent device execution. |
| Readiness B1 — preview before Activity/Project | accepted | Phase 2 gets parity routes; user preview moved after full Phase 4 + WS6. |
| Readiness B2 — reducer missing failed/completed/error | accepted | Split shell connection from per-item lifecycle with exhaustive states. |
| Readiness B3 — history/deep-link required but undecided | accepted | Selected exact schema, history ownership, auth/reconcile/stale-target behavior. |
| Readiness B4 — browser harness wiring unowned | accepted | WS0 owns package/lock/config/script/provisioning. |
| Readiness B5 — Phase 0 could measure without resolving High defects | accepted | Every item needs fix/non-applicable/defer disposition; unresolved High blocks. |
| Readiness B6 — true push vs active-client undefined | accepted | V1 is active-client-only; true Web Push is a separate future security feature. |
| Readiness B8 — accessibility after default-on | accepted | Phone WS6 gates preview and default-on; tablet has separate pass. |
| Readiness B9 — rollback conceptual | accepted | Exact flags, storage, URL override, cache/downgrade steps, and test added. |
| Readiness E1 — overlapping shared-file plans | accepted | Dependency reconciliation and continuity contract reuse added to Phase 0. |
| Readiness E2 — acceptance oracles vague | accepted | Added fixed fixtures, interaction count, scroll, screenshot masks/threshold, computed checks. |
| Readiness E3 — offline attachment recovery | accepted | Metadata-only v1 with explicit Reselect required; blobs deferred. |
| Readiness E4 — Perplexity/Material wording | accepted | Corrected page title, qualified inference, narrowed Material claim. |
| Readiness E5 — confidence precision | accepted | Replaced matrix numbers with evidence categories. |
| Readiness E6 — approvals detached from phases | accepted | Selected defaults and owning phase entry gates recorded. |

Planning confidence after review and correction: **94/100**. Repository grounding and official capability claims exceed the confidence target. Exact competitor visual/gesture behavior is explicitly non-normative and not treated as verified. Physical iOS/Android/PWA, keyboard, and assistive-technology behavior remains the primary unresolved evidence gap and is a blocking Phase 0/WS6 obligation.
