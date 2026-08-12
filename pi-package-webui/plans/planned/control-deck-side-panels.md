# Configurable Left and Right Control Deck Panels

## Goal

Let users place the WebUI Control Deck on the right, on the left, or on both sides when terminal tabs use the **Top bar** layout. Rename the existing **Left sidebar** tab-placement option to **Sidebar**. When **Sidebar** is selected, place one combined Control Deck on the left and the terminal/tabs rail on the right of the chat. Every existing Control Deck section must remain a singleton node and be movable between the two desktop panels.

## Status and classification

- **Status:** planned; no implementation is authorized by this document alone.
- **Feature class:** complex.
- **Why complex:** this crosses persistent settings, frontend DOM ownership, desktop and mobile layouts, drag/keyboard interaction, accessibility, split/file-viewer composition, offline reconciliation, tests, documentation, and PWA cache lifecycle.
- **Execution recommendation:** implement as sequential milestones with one writer because the principal files overlap heavily. Release only after the integrated browser and persistence gates pass.

## Confirmed product decisions

1. **Top-bar Control Deck placement:** `Right`, `Left`, or `Both`.
2. **Default and migration behavior:** `Right`, matching the current UI.
3. **Cross-panel movement:** pointer drag plus keyboard.
   - `Alt+Up` / `Alt+Down`: reorder within the current side.
   - `Alt+Left` / `Alt+Right`: move to the corresponding side when `Both` is active.
4. **Narrow screens:** one combined Control Deck overlay. Desktop side assignments remain saved and return unchanged when space is available again.
5. **Sidebar tab placement:** the Control Deck is combined on the left and the terminal/tabs rail is on the right of the chat. The saved Top-bar `Right` / `Left` / `Both` preference is retained, not overwritten. Keep the stored compatibility value `terminalTabs.layout: "left"`; only the user-facing label changes from **Left sidebar** to **Sidebar**.

## Recommended implementation decisions

These decisions close remaining engineering gaps without expanding the product scope:

- In `Right` or `Left` placement, show all sections in one panel and preserve the latent side assignments used by `Both`.
- In `Both`, a newly migrated user starts with every existing section on the right. The empty left panel exposes a labelled drop target rather than silently redistributing sections.
- Preserve one global deterministic section order plus a list of sections assigned left. Filtering that order yields each side's order; rendering the global order yields the narrow combined overlay.
- Keep one expanded accordion section per **latent assigned side**. Moving or expanding a section collapses only the previous expansion on that assigned side. Any combined presentation—Top/Right, Top/Left, terminal-sidebar override, or narrow overlay—may therefore show up to two expanded sections and must not rewrite expanded state. A Both → single placement → Both browser test locks this behavior.
- Collapse and width are independent per desktop side. Narrow overlay open/closed state remains transient and does not overwrite desktop collapse state.
- Keep the existing right width as a downgrade-compatible mirror. A right-width save sends v2 `panelWidths.right`, legacy `interfacePreferences.sidePanelWidth`, and the expected layout revision in **one locked PUT** so partial failure cannot diverge them; left width exists only in v2.
- Use an automatic combined-overlay presentation when the selected desktop columns plus chat, split terminal, and file viewer cannot satisfy their minimum widths. This presentation change must not modify saved placement, assignments, collapse, or widths. One canonical `isControlDeckOverlayPresentation()` predicate must cover both the existing media-query overlay and computed capacity fallback, even above 1050px.
- Do not add a section context menu: the confirmed interaction scope is drag plus keyboard.

## Current repository evidence

- `public/index.html:108-690` places terminal navigation inside `.chat-panel`, followed by split terminal, file viewer, backdrop, and one `#sidePanel` in `.layout`.
- `public/styles.css:321-357` defines a right-only outer grid and enumerates split/file-viewer/collapsed column combinations.
- `public/styles.css:5075-5199` turns `terminalTabs.layout === "left"` into an inner left rail through `body.terminal-tabs-left`.
- `public/app.js:4641-4710` persists terminal placement as only `top` or `left` and toggles `body.terminal-tabs-left`.
- `public/app.js:3703-3888` assumes every `[data-side-panel-section]` has one parent under `elements.sidePanel`; current pointer and keyboard movement is vertical only.
- `public/app.js:6715-6750` has one global side-panel collapsed state and one mobile drawer lifecycle.
- `public/app.js:11885-12252` provides local-first durable layout, named subfield generations, pending journals, revision-guarded server reconciliation, and bounded conflict retry.
- `public/app.js:12482-12643` persists and resizes one right-side width; pointer delta and keyboard arrows assume the resize edge is on the left.
- `lib/ui-layout-settings.mjs` owns the version-1 server schema and revision hash. Its `sidePanel` currently contains `sectionOrder`, collapsed/hidden section IDs, and one `collapsed` flag.
- `lib/git-workflow-preferences.mjs:154-183` normalizes legacy `sidePanelWidth` separately and reads `uiLayout` through the schema helper.
- `public/app.js:1517-1573` and `1787-2036` rehost canonical side-panel content for Mobile Experience v2. A second ownership path must not race a new dual-panel reconciler.
- `public/styles.css:13927-14025` already changes the Control Deck to one overlay at `max-width: 1050px`; phone/coarse-pointer rules repeat the drawer pattern later in the file.
- `tests/browser/persistent-ui-layout.spec.mjs` already verifies stale reads, failed writes, restart, localStorage clearing, resize, section order, terminal placement, file viewer, and server ownership.
- `tests/side-panel-section-reorder-static.test.mjs`, `tests/side-panel-resize-static.test.mjs`, `tests/persistent-ui-layout-static.test.mjs`, and `tests/mobile-static.test.mjs` encode the current right-only assumptions.
- The recently completed Controls redesign in `public/index.html`, `public/styles.css`, and `public/app.js` must be preserved: one setting per two-column row, viewport-safe label tooltips, stable IDs, and responsive behavior.

## Target behavior matrix

| Terminal tab placement | Saved Control Deck placement | Effective desktop presentation |
| --- | --- | --- |
| Top bar | Right | Combined sections in one right panel |
| Top bar | Left | Combined sections in one left panel |
| Top bar | Both | Assigned sections in independent left and right panels |
| Sidebar | Right / Left / Both | Combined Control Deck on the left; terminal/tabs rail on the right of chat; saved preference retained |
| Any | Narrow/capacity fallback | One combined overlay; desktop assignments retained |

Embedded split mode continues hiding Control Deck and terminal navigation as it does today; exiting embedded mode restores the effective presentation from saved state.

## Persistence model and migration

### Version-2 layout envelope

Bump `UI_LAYOUT_VERSION` and browser `UI_LAYOUT_SCHEMA_VERSION` to `2`. Extend `layout.sidePanel` to:

```json
{
  "placement": "right",
  "sectionLayout": {
    "order": ["controls", "files", "git"],
    "leftSectionIds": []
  },
  "collapsedSectionIds": [],
  "hiddenSectionIds": [],
  "collapsedPanels": {
    "left": false,
    "right": false
  },
  "panelWidths": {
    "left": 384,
    "right": 384
  }
}
```

Server defaults may remain nullable so absence can be distinguished from a valid local cache; the effective client defaults are `placement: "right"`, no left assignments, both panels expanded, and 384-pixel widths.

### Invariants

- `placement` is only `right`, `left`, or `both`.
- `sectionLayout` is atomic.
- `order` and `leftSectionIds` are bounded, unique string lists.
- Every `leftSectionIds` entry must occur in `order`.
- Right membership is `order - leftSectionIds`; a section cannot appear on both sides.
- Newly introduced DOM sections absent from `order` append to the right in document-defined order.
- Unknown historical section IDs may remain in the persisted order for forward/backward compatibility but do not create DOM nodes.
- `panelWidths.left/right` use the existing 320–4096 pixel validation bounds.
- `collapsedSectionIds` and `hiddenSectionIds` retain their existing meaning.
- Unknown fields and malformed partial patches fail closed.

### Migration

Implement migration in `lib/ui-layout-settings.mjs` and invoke it through `normalizeWebuiSettings` in `lib/git-workflow-preferences.mjs`:

- v1 `sectionOrder` → v2 `sectionLayout.order`.
- v1 sections are assigned right (`leftSectionIds: []`).
- v1 `collapsed` → `collapsedPanels.right`; left defaults expanded.
- legacy `interfacePreferences.sidePanelWidth` → `panelWidths.right`; left uses the default width.
- v1 collapsed-section and hidden-section lists carry forward unchanged.
- Every unchanged v1 layout field also carries forward: `composerActions`, `footerScopedModelOrder`, `terminalTabs` (layout and custom groups), and `fileViewerWidth`.
- A missing or malformed v1 field migrates to the safe nullable/default value without invalidating unrelated valid fields in the envelope.
- Bump `WEBUI_SETTINGS_VERSION` from 6 to 7 if the repository's persisted-settings convention still uses that monotonic version at implementation time.
- Preserve unknown future raw `uiLayout` envelopes during unrelated settings writes, matching `tests/webui-settings-locking.test.mjs`.

The v2 API should reject stale v1 layout writes after upgrade rather than reinterpret them and risk destroying side assignments. Legacy width-only PUTs remain accepted. Coherent PWA asset revisioning and a visible refresh path limit mixed-client time.

### Browser cache and pending journal

Add one versioned structural key, for example `pi-webui-control-deck-layout-v2`, containing `placement`, `sectionLayout`, `collapsedPanels`, and `panelWidths`. Keep the current collapsed-section and hidden-section keys.

- Read old `pi-webui-side-panel-section-order-v1`, `pi-webui-side-panel-collapsed`, and `pi-webui-side-panel-width` once when v2 state is absent.
- Retain old keys for downgrade safety. Mirror right collapse/width where practical, but do not let old keys overwrite established v2 state.
- Advance the pending-journal prefix. Translate **all** valid v3 side-panel mutations—`sectionOrder`, `collapsedSectionIds`, `hiddenSectionIds`, and `collapsed`—into their v2 paths. Retain each translated pending identity until server acknowledgement; test upgrade after failed order, accordion, visibility, and panel-collapse writes.
- Mark `sectionLayout` as one dirty subfield so cross-panel movement cannot be split into competing left/right saves.
- Keep placement, section layout, panel collapse, panel widths, collapsed sections, and hidden sections as named sibling subfields for stale-read reconciliation.
- Update the structural local cache with read-modify-write operations per named subfield. Storage events use field-aware adoption: skip locally dirty or actively manipulated subfields, adopt safe siblings without echo writes, and test concurrent placement versus section-layout changes in two same-origin tabs.
- A pointer drag persists once on drop. Provisional DOM moves during drag do not create network writes.
- Include active section drag and either panel resize in `durableUiLayoutInteractionActive("sidePanel")` so a server snapshot cannot move nodes during interaction.

## DOM and layout architecture

### Singleton sections

Keep every current `[data-side-panel-section]` and every descendant ID exactly once. Do not clone Controls or generate duplicate section markup.

Refactor `.layout` into three conceptual columns:

1. left Control Deck shell;
2. a central workspace wrapper containing chat, split terminal, and file viewer;
3. right Control Deck shell.

The central wrapper preserves split-terminal and file-viewer composition independently from Control Deck placement, avoiding a combinatorial outer-grid selector matrix.

Add unique shell/body hooks such as:

- `#sidePanelLeft`, `#sidePanelBodyLeft`, `#sidePanelLeftResizeHandle`;
- existing `#sidePanel` as the right shell and canonical narrow overlay, plus `#sidePanelBodyRight`;
- unique left/right collapse and expand controls;
- labelled empty drop zones in each body;
- one movement live region.

Shell chrome may be duplicated only with unique IDs/data hooks and shared behavior. Refactor version/build and Open Issue controls to update/bind all shell-local instances, or move singleton shared chrome to the effective primary shell. In `Both`, prefer right as the primary chrome host; in `Left` or terminal-sidebar override, use left. The implementation must not hide version/update/Open Issue access merely because the right shell is inactive.

Desktop shells should be `aside` landmarks, not two simultaneous modal dialogs. In Both mode their accessible names must be distinguishable—**Left Control Deck** and **Right Control Deck**—while the active combined overlay is simply **Control Deck**. The existing drawer primitive may assign `role="dialog"` and `aria-modal="true"` only to that active overlay.

### Host reconciler

Create one `reconcileControlDeckHosts()` ownership path in `public/app.js`:

- discover section nodes at document scope rather than only below `elements.sidePanel`;
- compute the effective presentation from terminal placement, saved Control Deck placement, viewport mode, and available width;
- expose one canonical `isControlDeckOverlayPresentation()` result and route transient collapse, drawer modal activation, backdrop, body locking, resize visibility, Escape, and focus return through it;
- move singleton section nodes into the appropriate body in persisted order;
- preserve focus, expanded/hidden state, form values, event handlers, and scroll intent;
- coordinate with `mobileCanonicalMountContent` so only one owner may rehost a section or its content at a time;
- no-op when the DOM already matches desired ownership.

Recommended helpers:

- `normalizeControlDeckPlacement`;
- `readStoredControlDeckLayout` / `cacheControlDeckLayout`;
- `controlDeckSectionRecords`;
- `effectiveControlDeckPresentation`;
- `reconcileControlDeckHosts`;
- `moveControlDeckSection`;
- `setControlDeckPanelCollapsed`;
- `syncControlDeckPlacementControl`;
- `updateControlDeckResizeHandles`.

## Interaction design

### Placement control

Add **Control Deck placement** beside **Tab placement** under Controls → Interface:

- options: Right, Left, Both;
- status: saved in the user's durable WebUI layout;
- when Tab placement is **Sidebar**, keep the selection visible but disabled and explain: “Sidebar placement active: Control Deck is left and terminal/tabs are right. Your Top-bar placement is preserved.”
- switching back to Top bar immediately restores the saved selection.

Preserve the current Controls row grid, tooltip initialization, IDs, labels, and responsive collapse.

### Pointer movement

Generalize the current six-pixel-threshold pointer drag:

- identify target body and nearest visible header midpoint;
- support dropping before/after a section and into an empty panel;
- show target-side and insertion markers;
- update DOM provisionally without cloning;
- save atomic `sectionLayout` only at pointer-up;
- suppress the accidental post-drag accordion click and return focus to the moved toggle.

### Keyboard movement

On a focused section toggle:

- `Alt+Up/Down` reorders among visible sections on the current side;
- `Alt+Left/Right` moves to that side only in `Both` desktop presentation;
- prevent browser history navigation only after the focused Control Deck shortcut is recognized;
- preserve focus on the same singleton toggle;
- update `aria-keyshortcuts`, title text, mobile edit hint, and the live region;
- announce section label, destination side, and ordinal position.

Hidden sections retain assignment/order but are skipped as move targets. In combined overlay/mobile Edit mode, only vertical reordering is available; horizontal movement is intentionally disabled so narrow presentation cannot rewrite desktop assignment.

## Collapse, accordion, and width behavior

- Replace one desktop `side-panel-collapsed` assumption with side-specific state/classes.
- In Top/Right or Top/Left, the visible panel uses its own saved collapse and width.
- In Top/Both, collapse and resize are independent.
- In **Sidebar** tab placement, the combined left panel uses left collapse/width while the Top-bar placement remains untouched.
- Narrow/capacity overlay starts closed as today and uses transient drawer state; it does not persist over desktop collapse values.
- Scope one-expanded-section behavior to each section's latent assigned side, not merely its current DOM body. All combined presentations may show the two side-local expansions; opening a section collapses only the expanded peer with the same latent assignment and never rewrites the other side.

Use `--side-panel-left-width` and `--side-panel-right-width`, retaining `--side-panel-width` as a compatibility fallback. Generalize pointer and keyboard resizing per edge:

- left panel pointer width grows with movement to the right; right panel grows with movement to the left;
- keyboard arrows describe physical edge movement consistently and retain Home/End and Shift acceleration;
- separators expose side-specific `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext`;
- maximum-width calculation reserves the other visible panel, central chat minimum, active split terminal, active file viewer, padding, and gaps;
- clamp during resize; use combined-overlay fallback only when even minimum widths do not fit;
- hide resize separators in overlay/embedded modes.

## Terminal right-rail behavior

When `terminalTabs.layout === "left"`, retain the persisted value for compatibility but change the effective visual layout:

- inventory every direct `.chat-panel` child and assign it deliberately: terminal backdrop, workspace dashboard, widget area, subagent terminal view, chat search bar, context meter, transcript, run indicator, feedback tray, jump-to-latest control, status bar, Git workflow panel, and composer;
- all non-terminal content uses the left inner column in its intended row, including overlay/backdrop semantics;
- `.terminal-tabs-shell` occupies the right inner column for the full chat height;
- border, gradient, and chevron direction are mirrored;
- tab-group and new-tab menus open inward with `right: 100%` and a hover bridge on the left;
- workspace action tooltips open inward/above and remain visible on hover and keyboard focus;
- Close all, remote indicator, grouping, drag/drop, split buttons, dense tabs, and current action target sizes remain unchanged;
- menu and tooltip stacking must not be clipped by `.chat-panel` or terminal-shell overflow.

## Narrow-screen and mobile ownership

At the existing tablet/mobile breakpoint, and at computed capacity fallback:

1. Suspend any route-specific `mobileCanonicalMountContent` ownership that conflicts with the Control Deck.
2. Move all canonical section nodes into the canonical combined overlay in global `sectionLayout.order`.
3. Preserve left assignment, widths, collapse state, hidden state, expanded state, and current focus identity.
4. Keep legacy mobile Edit/Done behavior and touch-safe scrolling. Edit mode permits vertical order only.
5. Reuse the current backdrop, Escape handling, focus trap/return, safe-area spacing, and touch target sizes.
6. On overlay close or route change, let the ownership arbiter restore the relevant Mobile Experience v2 projection.
7. When desktop capacity returns, restore exact left/right hosts from saved assignment without recreating nodes.

Mobile Experience v2 should expose one clear Control Deck entry/surface rather than independent left/right drawers. Existing Files, Git, Queue, Settings, and More routes may still project canonical content when the combined Control Deck is closed, but ownership must be serialized.

## Implementation milestones

### Milestone 1 — Schema and migration

**Files**

- `lib/ui-layout-settings.mjs`
- `lib/git-workflow-preferences.mjs`
- `tests/ui-layout-settings.test.mjs`
- `tests/git-workflow-preferences.test.mjs`
- `tests/http-endpoints-harness.test.mjs`
- `tests/webui-settings-locking.test.mjs`

**Work**

- Add v2 normalization, validation, partial merge, migration, revision behavior, and settings-version update.
- Preserve future-version raw envelopes and width-only endpoint compatibility.
- Carry forward and test the complete v1 envelope: side-panel state, composer order/grid, footer model order, terminal layout/groups, and file-viewer width.
- Test duplicate/cross-side IDs, invalid widths/placement, v1 migration, partial patches, and stable hashes.

**Gate**

- Existing v1 settings normalize to right-only behavior without losing any layout field, including order, visibility, accordion state, width, composer layout, footer order, terminal layout/groups, or file-viewer width.
- Invalid input cannot mutate persisted state.

### Milestone 2 — DOM hosts and single-panel layouts

**Files**

- `public/index.html`
- `public/styles.css`
- `public/app.js`
- focused static tests

**Work**

- Add unique left/right shells and central workspace wrapper.
- Implement structural cache and host reconciler.
- Deliver Top/Right, Top/Left, and terminal-sidebar Control Deck-left/terminal-right behavior.
- Preserve shared header/footer actions and Controls UI.

**Gate**

- No duplicate IDs or broken `aria-controls`.
- Returning from terminal sidebar to Top bar restores saved Control Deck placement.
- Right-rail menus/tooltips work by pointer and keyboard.

### Milestone 3 — Both-mode movement and side-local state

**Files**

- `public/app.js`
- `public/styles.css`
- reorder/resize/static tests

**Work**

- Add atomic cross-panel pointer and keyboard movement.
- Add empty drop zones, movement announcements, per-side accordion policy, collapse, and resize.
- Integrate structural subfields with complete v3 journal translation, stale reads, field-aware storage events, concurrent-tab reconciliation, and conflict handling.
- Save right width and its legacy mirror atomically in one revision-guarded endpoint update.

**Gate**

- Every current section moves in both directions without cloning or state loss.
- Independent collapse/resize and offline/reload/cross-tab behavior pass.

### Milestone 4 — Combined responsive presentation

**Files**

- `public/app.js`
- `public/styles.css`
- mobile and browser tests

**Work**

- Add capacity calculation and one overlay-presentation predicate used by modal, backdrop, collapse, body-locking, resize, and focus paths—including fallback above 1050px.
- Serialize ownership with legacy mobile and Mobile Experience v2 projection.
- Verify repeated viewport/mode changes, split terminal, file viewer, focus, and Edit/Done.

**Gate**

- Desktop assignments survive all narrow/overlay transitions.
- Canonical content is never duplicated, orphaned, or simultaneously owned.

### Milestone 5 — Documentation, cache lifecycle, and integrated review

**Files**

- `README.md`
- `TECHNICAL.md`
- `DEVELOPMENT.md`
- `public/index.html`
- `public/service-worker.js`
- affected revision assertions

**Work**

- Update documentation at the required layers.
- Increment app/style query revisions and PWA cache name together.
- Run the full integrated validation and independent review.

**Gate**

- Existing users remain right-only until they opt in.
- Matching HTML/CSS/JS assets load after service-worker refresh.
- No accepted reviewer finding remains unresolved.

## Planned file changes

| File | Planned responsibility |
| --- | --- |
| `public/index.html` | Left/right shells, central workspace wrapper, placement control, unique ARIA hooks, drop zones/live region, asset revisions |
| `public/styles.css` | Outer and central grids, left/right panel styles, right terminal rail, drop markers, independent resize/collapse, combined overlay |
| `public/app.js` | Effective presentation, singleton host ownership, cache migration, placement control, drag/keyboard movement, collapse/resize, mobile coordination, durable reconciliation |
| `public/service-worker.js` | Coherent PWA cache revision |
| `lib/ui-layout-settings.mjs` | v2 schema, v1 migration, validation, merge, stable revision |
| `lib/git-workflow-preferences.mjs` | settings migration and legacy width seeding |
| `tests/ui-layout-settings.test.mjs` | schema and migration unit tests |
| `tests/git-workflow-preferences.test.mjs` | settings migration and preservation |
| `tests/http-endpoints-harness.test.mjs` | v2 persistence, rejection, conflict, width compatibility |
| `tests/webui-settings-locking.test.mjs` | concurrent updates and future envelope preservation |
| `tests/persistent-ui-layout-static.test.mjs` | v2 local-first/pending-journal contracts |
| `tests/browser/persistent-ui-layout.spec.mjs` | durable restart/cache-clear/stale-read behavior with v2 state |
| `tests/side-panel-section-reorder-static.test.mjs` | cross-panel drag/keyboard contracts |
| `tests/side-panel-resize-static.test.mjs` | side-specific width and ARIA contracts |
| `tests/mobile-static.test.mjs` | combined overlay and Edit/Done ownership contracts |
| `README.md` | brief user-facing capability and first-use path |
| `TECHNICAL.md` | complete user options, shortcuts, responsive behavior, compatibility and rollback |
| `DEVELOPMENT.md` | schema, ownership, reconciliation, layout architecture, and contributor validation |

Required new focused tests:

- `tests/control-deck-side-panels-static.test.mjs` — singleton DOM, side-specific landmarks, ownership, shortcuts, and overlay-predicate contracts.
- `tests/browser/control-deck-side-panels.spec.mjs` — the full placement, cross-panel movement, rail, accordion-transition, responsive ownership, and accessibility matrix.

Do not put endpoint payloads, schema internals, source maps, or contributor commands in `README.md` or `TECHNICAL.md`; those belong in `DEVELOPMENT.md` under repository documentation policy.

## Verification plan

### Unit and static contracts

- v1 → v2 migration and effective right-only defaults;
- malformed placement, cross-side duplicates, missing order membership, oversized lists, invalid widths, and unknown keys;
- partial merge and revision hash changes for placement, assignment, collapse, and widths;
- complete v1 envelope preservation plus future-layout-version preservation during unrelated settings writes;
- translation and acknowledgement of every valid v3 side-panel pending mutation;
- atomic right-width + legacy-width persistence and field-aware concurrent-tab cache adoption;
- singleton IDs and valid `aria-controls`/`aria-describedby` targets;
- Controls two-column rows and viewport-safe tooltips remain present;
- asset query revisions and service-worker cache identity remain coherent.

### Browser interaction matrix

- Top bar × Right / Left / Both, including Both → Right/Left → Both with two latent expanded sections preserved;
- Sidebar placement and restoration to Top bar, including the renamed option label and unchanged stored `left` compatibility value;
- pointer drag within and across panels, including an empty side;
- `Alt+Up/Down/Left/Right`, focus continuity, click suppression, and live announcements;
- hidden sections retain assignment but are skipped as move targets;
- independent panel collapse and pointer/keyboard resize;
- Both with split terminal, file viewer, and both together;
- right-rail new-tab/group menus, tooltips, tab drag/drop, Close all, and workspace actions;
- 1680px desktop, computed overlay fallback above 1050px, 1050px tablet, 700px phone, and coarse pointer;
- legacy mobile and Mobile Experience v2 ownership transitions;
- localStorage clear, failed PUT, stale GET, 409 retry, process restart, and fresh browser context;
- duplicate-ID/ARIA checks and Axe scan for visible desktop and overlay states;
- keyboard-only overlay open/close, focus trap, Escape, and focus return.

### Commands

From `pi-package-webui`:

```bash
npm run check
npm test
npx playwright test tests/browser/persistent-ui-layout.spec.mjs tests/browser/control-deck-side-panels.spec.mjs
```

From the repository root after documentation changes:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Also perform a manual visual pass in light and dark themes for Right, Left, Both, right terminal rail, capacity fallback, and mobile overlay. Confirm no horizontal clipping at the supported minimum widths.

## Acceptance criteria

1. Existing users load the same Top-bar + right Control Deck arrangement after upgrade, and every unchanged v1 layout field survives migration.
2. Top-bar users can select Right, Left, or Both and the choice survives cache clearing and server restart.
3. The tab-placement option is labelled **Sidebar**. It renders Control Deck → chat → terminal/tabs rail and restores the saved Top-bar Control Deck placement when changed back.
4. Every existing and future `[data-side-panel-section]` can be assigned and ordered on either side in Both mode by pointer and keyboard.
5. Cross-side movement never clones a section, duplicates an ID, loses form/render state, or leaves a broken ARIA reference.
6. Left and right panels collapse and resize independently while preserving a usable central workspace.
7. Tablet/mobile/capacity fallback uses one combined overlay and never changes desktop side assignments.
8. Legacy mobile Edit/Done, Controls rows/tooltips, split terminal, file viewer, terminal grouping, context menus, and mobile shell routes remain functional.
9. Local-first/offline behavior, field-aware concurrent-tab adoption, stale-read protection, bounded 409 retry, atomic right-width mirroring, and complete pending-journal migration/recovery remain intact.
10. User docs explain placement and shortcuts; implementation/API/schema details stay in `DEVELOPMENT.md`.
11. Static, unit, browser, accessibility, syntax, asset-lifecycle, and Markdown diff checks pass.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Two ownership systems move the same canonical content | One host reconciler arbitrates desktop, combined overlay, and Mobile Experience v2 projections; add repeated-transition browser tests |
| Separate side writes duplicate or lose a section | Persist one atomic `sectionLayout` with global order plus left membership |
| Both panels starve chat/split/file viewer | Clamp widths and switch presentation to a non-persisting combined overlay when minimum capacity is unavailable |
| Right terminal rail menus/tooltips open off-screen or are clipped | Mirror inward geometry and validate hover/focus behavior in Playwright |
| Alt+Left triggers browser navigation | Prevent default only for recognized focused Control Deck shortcuts in active Both mode |
| Upgrade loses an offline pending v1 mutation | Translate order, accordion, visibility, and panel-collapse v3 journal records before cleanup and test failed-write upgrade paths |
| Mixed old/new browser assets issue incompatible writes | Bump HTML app/style revisions and service-worker cache atomically; reject stale schema writes safely |
| Older rollback can overwrite the unknown v2 envelope with v1 defaults | Document and verify settings backup before downgrade; restore that backup after re-upgrade. Do not claim in-place v2 preservation without a compatibility shim and a real prior-package downgrade test |
| Static regex tests become weaker during refactor | Replace exact right-only assumptions with focused singleton, ownership, migration, and accessibility contracts rather than deleting coverage |
| Controls redesign regresses while its section moves | Keep Controls DOM singleton and retain dedicated row/tooltip tests across both panel widths |

## Rollout and rollback

- Land milestones sequentially on one integration branch; do not ship partial UI states.
- Roll out with effective `Right` default and no automatic redistribution.
- Keep v1 local keys during at least one compatibility cycle.
- **Truthful downgrade rule:** the current prior package treats v2 as unknown defaults and can overwrite the server-side v2 envelope on its next layout write. Before downgrade, back up the WebUI settings file while the server is stopped; after re-upgrading, restore that backup before starting the new server. Retained v1 browser keys provide usable right-only fallback but do not protect server-side v2 assignments.
- If non-destructive in-place downgrade becomes a hard requirement, add a separately approved compatibility shim and automated downgrade test against the exact prior package; do not infer it from retained local keys.
- After full implementation and verification, move this file from `plans/planned/` to `plans/archive/` per repository plan lifecycle policy.

## Residual open implementation checks

These are evidence checks, not product decisions:

- Confirm the exact current section count at implementation time; new sections should be discovered by data attribute, not a frozen allowlist.
- Recalculate central minimum widths against the then-current split/file-viewer CSS before fixing the capacity threshold.
- Confirm whether `WEBUI_SETTINGS_VERSION` has advanced beyond 6 and increment from the current value rather than hard-coding 7.
- Update asset revisions from their implementation-time values rather than the values observed while this plan was written.

## Planning confidence

**Confidence: 95/100.** The plan is grounded in direct inspection of the current DOM, CSS, browser controller, persistence schema, settings normalization, responsive ownership, and existing tests. Remaining uncertainty is mainly visual/capacity behavior under simultaneous Both + split terminal + file viewer, which is explicitly covered by the browser and manual validation gates.
