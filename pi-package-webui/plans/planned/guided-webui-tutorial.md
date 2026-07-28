# Guided WebUI Tutorial Plan

## Goal

Add an accessible, responsive guided tutorial to Pi WebUI that spotlights only the controls needed for the current step, explains each feature in an existing Markdown-rendered chatbox, runs once for a fresh installation, and later runs only for newly registered feature steps.

## Current repository evidence

- The WebUI is a vanilla browser application centered in `pi-package-webui/public/app.js`, with static structure in `public/index.html` and styling in `public/styles.css`.
- `public/app.js` already has a shared `elements` lookup, modal/focus infrastructure, side-panel section state, browser `localStorage` helpers, version detection, and a bounded Markdown renderer (`renderMarkdown`, `appendMarkdown`, `renderContent`).
- The primary tutorial targets are already represented by stable elements such as `#promptInput`, `#sendButton`, `#tabBar`, `#commandPaletteButton`, `#workspaceDashboardToggleButton`, `#sidePanel`, `#toggleSidePanelButton`, and `data-side-panel-section` sections.
- The existing tests are predominantly Node static checks plus selected browser/server harnesses. `package.json` uses `node --check` and `node tests/run-all.mjs` as the package gates.
- Browser preferences use `localStorage`, while global WebUI settings are persisted through the WebUI settings file and server helpers imported by `bin/pi-webui.mjs`.
- WebUI/package versions are exposed by `/api/health`; version changes currently drive update/release-note behavior and must not be used as a reason to replay the whole tutorial.

## Product decisions

1. **A tutorial feature is identified by a stable ID, not by package version.** Updating the WebUI does not replay completed steps.
2. **A newly added registry ID is shown as one new step.** Existing completed IDs remain completed, so a release containing one new feature does not restart the old tour.
3. **Persist completion globally for the WebUI installation.** Use the existing WebUI settings file rather than only `localStorage`; `localStorage` is browser-profile-specific and would show the tour again in another browser. Keep a browser fallback only if the server capability is unavailable, and make the fallback explicitly best-effort.
4. **Completion is recorded per feature only after the user advances past or explicitly skips that feature.** Closing the tutorial early must not mark unseen steps complete.
5. **The tutorial is non-destructive and should not trigger feature actions automatically.** It may open a required drawer/section for positioning, but it must not send prompts, run commands, install packages, update Pi, open remote access, or mutate workspace/Git state.
6. **Use the existing Markdown renderer.** Tutorial copy is trusted, package-owned Markdown; render it through `renderMarkdown`/`appendMarkdown` instead of injecting HTML.
7. **Prefer stable semantic hooks over long CSS selectors.** Each target gets a `data-tutorial-target="<id>"` hook or an explicit registry resolver for dynamic content.

## Proposed data model

Add a tutorial registry near the other WebUI feature registries in `public/app.js` (extract to a module only if the implementation work makes that seam safe):

```js
const WEBUI_TUTORIAL_SCHEMA_VERSION = 1;

const WEBUI_TUTORIAL_FEATURES = [
  {
    id: "composer",
    title: "Start with a prompt",
    markdown: "...",
    target: { selector: '[data-tutorial-target="composer"]' },
    prepare: "none",
  },
  // Additional stable feature IDs follow.
];
```

Each entry should validate/normalize:

- `id`: lowercase, stable, unique, bounded length.
- `title`: short accessible heading.
- `markdown`: bounded trusted Markdown copy.
- `target`: selector or resolver returning one or more connected elements.
- `prepare`: optional named preparation action, never arbitrary code from data.
- Optional `placement`: preferred panel side (`top`, `right`, `bottom`, `left`, `auto`).
- Optional `when`: named capability predicate for features that may be hidden/unavailable.

Persist state in the WebUI settings object under a namespaced property such as:

```json
{
  "guidedTutorial": {
    "schemaVersion": 1,
    "completedFeatureIds": ["composer", "control-deck"],
    "dismissedFeatureIds": [],
    "lastSeenRegistryRevision": 1
  }
}
```

The registry itself remains code-owned. Do not persist Markdown or selectors, which would create stale executable UI metadata.

## Implementation phases

### Phase 1 — Confirm target inventory and contracts

- Enumerate the initial tutorial steps from the current WebUI, keeping the first release short and task-oriented. Recommended initial IDs: `composer`, `terminal-tabs`, `workspace-overview`, `command-palette`, `control-deck`, `files`, `git`, `optional-features`, and `session-or-queue` where the feature is present.
- Add stable `data-tutorial-target` hooks to `public/index.html` for static regions and to dynamic renderers in `public/app.js` for generated controls/cards.
- Define which steps are conditional when a feature is hidden, unavailable, or disabled. A missing target must skip that feature for the current run rather than trapping the user.
- Decide and document whether the first-run tour starts automatically after boot or after a small non-blocking welcome prompt. Recommended behavior: automatically start after the initial tab and essential layout are ready, with a clear “Skip tutorial” action.

### Phase 2 — Add installation-scoped persistence API

- Reuse the existing WebUI settings read/write utilities in `lib/git-workflow-preferences.mjs` or the canonical settings helper already used by `bin/pi-webui.mjs`; do not create a second settings file.
- Add a narrow server endpoint in `bin/pi-webui.mjs`, preferably `GET /api/webui-tutorial` and `PATCH /api/webui-tutorial`, returning only normalized tutorial state. Keep it scoped to the same WebUI installation/settings root and do not expose filesystem paths or unrelated settings.
- Validate schema version, ID format, bounded array length, unknown IDs, and duplicate IDs server-side. Unknown historical IDs may be retained for forward compatibility but must never activate a step.
- Use an optimistic revision or equivalent compare-and-save check so two browser tabs cannot overwrite each other’s completed IDs. Merge completed/dismissed ID sets on save.
- Return a safe capability/error response for older servers. The client should continue without blocking the WebUI and use the documented browser fallback only when necessary.
- Add endpoint tests for first read, valid merge, invalid payloads, unknown IDs, concurrent/revision conflict behavior, and settings-file preservation.

### Phase 3 — Build the spotlight/tutorial surface

- Add a dedicated tutorial layer to `public/index.html`, outside the normal layout stacking contexts:
  - a full-viewport scrim/backdrop;
  - a spotlight/highlight surface for the current target bounds;
  - a tutorial explanation panel with heading, step count, Markdown body, Previous/Next, Skip, and Close/Finish actions;
  - a live-region/status element for step changes.
- Add `tutorial-*` styles in `public/styles.css`. The layer must work in light/dark themes, respect safe-area insets, and remain usable at narrow/mobile widths.
- Implement a spotlight manager in `public/app.js` that:
  - resolves the current target;
  - scrolls it into view when needed;
  - measures it with `getBoundingClientRect()`;
  - repositions on resize, scroll, side-panel changes, and target DOM updates;
  - clamps the Markdown panel inside the viewport;
  - highlights multiple target elements only when a step explicitly requires a coordinated group.
- Use CSS geometry or a four-region scrim/clip-path approach that leaves the target visible without relying on a fragile global `filter` or changing the target’s layout. The target must sit above the scrim while the explanation panel sits above both.
- During an active step, make non-tutorial UI inert or pointer-blocked so users cannot accidentally invoke unrelated actions. Preserve the tutorial controls themselves and the current target’s intended interaction. Do not permanently change `disabled`, hidden, or collapsed state on application controls.
- Integrate with existing dialog/focus conventions rather than opening a second native modal dialog. Save the previously focused element, focus the tutorial heading or primary tutorial action, trap focus within the tutorial layer, support Escape to close/skip, and restore focus when finished.
- Render the step body with the existing Markdown functions, and keep external links/buttons safe and bounded. Add a visually hidden plain-text label/status for screen readers.

### Phase 4 — Handle preparation and progression

- Add a small allowlisted preparation map for steps that require existing UI state, for example:
  - expand the Control Deck;
  - open a named side-panel section;
  - close menus/drawers that would cover the target;
  - switch out of embedded/split view only if the current mode makes the target unreachable.
- Preparation must preserve the user’s prior collapsed/expanded state and restore it when the tutorial closes unless the user intentionally changed it while following the step.
- If a target is unavailable after preparation, show a non-blocking “This feature is not available in the current view” state with Skip and Close; never loop indefinitely.
- On Next, persist the current feature ID before advancing. On Previous, do not remove completion state; the user is revisiting a completed step.
- On Skip, mark only that feature as dismissed/seen according to the chosen product semantics, and ensure dismissed steps do not reappear on every reload. Recommended semantics: skipped IDs count as seen for the current installation but remain distinguishable from completed IDs for future “Review tutorial” support.
- On Finish/Close, merge state with the server and clear the tutorial layer, observers, timers, and event listeners.
- If the registry contains unacknowledged IDs after an update, start at the first eligible new ID and present it as a single-step mini-tour. Never replay all prior IDs merely because `webuiVersion` changed.

### Phase 5 — Add a re-entry path and update behavior

- Add a “Replay tutorial” or “What’s new” action in an existing low-risk location, likely the Control Deck header/version area or command palette. This action is explicit and may replay completed steps without changing their persisted status.
- Keep normal startup silent once all current registry IDs are seen.
- Add an optional `introducedIn`/release-note label only for display; it must not be the identity or replay key.
- Ensure service-worker/app-shell cache busting continues to load the new markup/styles/scripts together. Update the existing `public/index.html` app/style version query values and service-worker cache identity as required by the current asset policy.

### Phase 6 — Verification and rollout

- Run static checks and the full WebUI test suite.
- Exercise the tutorial manually at desktop, narrow/mobile, light, dark, collapsed Control Deck, split terminal, empty transcript, active transcript, and unavailable optional-feature states.
- Verify a fresh settings file shows the initial tour once; reload does not replay it; changing only the WebUI version does not replay it; adding one registry ID shows only that step; completing/skipping it prevents repeat display.
- Verify two tabs cannot lose each other’s completion IDs, and that an unavailable backend/fallback does not prevent normal WebUI use.
- Verify keyboard-only navigation, Escape, focus restoration, screen-reader announcements, reduced-motion behavior, and target positioning while scrolling/resizing.
- Run package checks from `pi-package-webui`: `npm run check` and `npm test` (or the repository’s equivalent test command if the package runner changes).

## Planned files

- `pi-package-webui/public/index.html` — tutorial layer markup and semantic target hooks.
- `pi-package-webui/public/app.js` — registry, state machine, persistence client, target preparation, spotlight geometry, lifecycle, and Markdown panel rendering.
- `pi-package-webui/public/styles.css` — scrim, spotlight, panel, responsive layout, focus, and reduced-motion styles.
- `pi-package-webui/bin/pi-webui.mjs` — narrow tutorial state API and settings integration.
- Existing settings helper under `pi-package-webui/lib/` — only if the canonical helper needs a small reusable tutorial-state function.
- `pi-package-webui/tests/tutorial-state.test.mjs` — pure state normalization, merge, eligibility, and progression tests.
- `pi-package-webui/tests/tutorial-widget-static.test.mjs` — target hooks, registry IDs, Markdown renderer usage, accessibility attributes, and cache-busting contracts.
- `pi-package-webui/tests/tutorial-endpoint-harness.test.mjs` — server persistence, validation, merging, and conflict behavior.
- `pi-package-webui/README.md` — user-facing tutorial/replay behavior and troubleshooting note, if the feature is user-visible enough to document there.

## Acceptance criteria

- A new installation receives a guided tour with one explanation panel per eligible feature.
- While a step is active, unrelated UI is visibly darkened and not accidentally interactive; only the current target and tutorial controls remain emphasized/usable.
- Each step renders trusted Markdown in a chatbox-like panel and announces its title/progress accessibly.
- Completion is tracked by stable feature ID, not by WebUI/package version.
- A later release with one new registry feature shows only that feature’s step; existing completed steps are not replayed.
- Closing/skipping, reloads, multiple tabs, missing targets, responsive layout, and storage/API failures all have deterministic, non-blocking behavior.
- Existing WebUI functionality, settings, dialogs, Markdown rendering, and update behavior remain intact under `npm run check` and `npm test`.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `app.js` is a large vanilla frontend monolith | Keep the tutorial state machine and geometry helpers cohesive; extract a module only if it can be added to the guarded app-module/service-worker lists safely. |
| CSS stacking contexts or dialogs cover the spotlight | Put the tutorial root at the end of `body`, define an explicit z-index contract, and test with side-panel menus and native dialogs open. |
| Responsive target moves while a step is open | Recompute geometry with resize/scroll/`ResizeObserver` and cancel/retry boundedly when a target disappears. |
| Server settings are shared by tabs/browsers | Use normalized merge-on-save and revision/conflict handling; keep completion IDs additive. |
| Trusted Markdown accidentally expands the attack surface | Reuse the existing DOM-building Markdown renderer; do not use `innerHTML` for tutorial content or accept server-provided selectors/HTML. |
| Tutorial blocks users during a backend/offline state | Start only after essential WebUI boot, make the layer dismissible, and fail open to normal WebUI operation when state cannot be loaded. |
| New feature IDs are added without useful copy/targets | Add a registry validation test and require every entry to provide stable ID, Markdown, target, and eligibility behavior before merge. |

## Open decisions to resolve before implementation

1. Confirm whether “once per install” means shared across all browsers using the same WebUI settings file (recommended) or once per browser origin only.
2. Confirm the exact initial feature list and whether optional/extension-backed features should appear only when installed and loaded.
3. Confirm whether Skip means permanently seen or whether skipped steps should be offered again through a “What’s new”/Replay flow.
4. Confirm whether the tutorial may open/expand the Control Deck automatically, or must explain how to open it without changing layout state.
5. Confirm whether the first release needs a dedicated “What’s new” entry point or only automatic discovery of new feature IDs.
