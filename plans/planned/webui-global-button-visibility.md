# Web UI global button and tag visibility

**Status:** Planned — awaiting implementation approval  
**Integration owner:** Parent Pi session `Configurable Button Visibility`  
**Feature class:** Complex (global persisted schema + multiple UI surfaces + contextual interactions + browser tests/docs)  
**Final report:** [reports/webui-global-button-visibility.html](../../reports/webui-global-button-visibility.html)

## Goal

Let users globally hide and restore the requested Web UI controls and composer input-frame tag types using accessible context menus, while keeping **Send** permanently available.

## Measurable success criteria

1. Right-clicking empty space in each marked host region opens one menu containing every visibility item, grouped by region, with checked/unchecked state.
2. Right-clicking a visible registered control opens an action to hide that specific control.
3. The menu provides **Show all** and **Reset defaults** actions.
4. Changes apply immediately in the active page and persist in the global Web UI settings file for later tabs, workspaces, and browser clients.
5. Existing capability/state gating remains authoritative: choosing “show” never forces an unavailable control to appear.
6. **Send** is never registered as toggleable and remains visible.
7. Mouse, Context Menu key, Shift+F10, arrow/home/end navigation, Escape, outside-click dismissal, focus return, and viewport-bounded positioning are covered.
8. Unit/static tests and a Chromium user-flow test pass; relevant documentation describes the global scope and recovery actions.

## Approved product decisions

- Persistence scope is **global**, not per workspace or browser.
- Menus include **Show all** and **Reset defaults**.
- `btw` means the **/btw side question** button.
- “Different tag types” means independently toggleable tag categories on the prompt input frame.
- **Send** is intentionally excluded and must remain visible.
- Defaults show every registered item when its existing capability/state conditions allow it.

## Visibility catalog

Stable preference keys are independent of DOM IDs. A hidden-key set is persisted; an absent key means “use the default,” currently visible.

### Workspace toolbar

- `workspace.save` — Save workspace
- `workspace.command-palette` — Command palette
- `workspace.overview` — Show workspace overview
- `workspace.close-all-tabs` — Close all tabs

### Control Deck

- `control-deck.sponsor` — Sponsor
- `control-deck.open-issue` — Open Issue

### Composer actions

- `composer.new` — New
- `composer.compact` — Compact
- `composer.guided-git` — Guided Git workflow
- `composer.publish` — AUR/npm release dropdown
- `composer.tools-skills` — Tools/skills setup dropdown
- `composer.common-options` — Common options
- `composer.app-runner` — App runner
- `composer.steer` — Steer
- `composer.follow-up` — Follow-up
- `composer.btw` — /btw side question

### Prompt input-frame controls

- `input.workflow` — Workflow controls as one unit
- `input.attach-files` — Attach files

### Prompt input-frame tag types

- `tag.prompt-behavior` — Follow-up/Steer busy-prompt behavior tag
- `tag.skills` — session skill tags
- `tag.agent-conversations` — Intercom agent-conversation tags
- `tag.feature-category` — feature-category tag
- `tag.voice-mode` — natural-conversation/voice tag
- `tag.workflow-mode` — workflow-mode tag

The catalog may gain future stable keys. Unknown stored keys are retained within existing bounded-list safety limits but have no rendering effect until recognized.

## Scope

- Extend the existing durable `uiLayout` contract with one global visibility field and migrate the current schema without losing existing layout state.
- Add one reusable visibility registry and one context-menu implementation.
- Bind the marked empty host regions and registered controls without taking over unrelated context menus.
- Apply user hiding with a dedicated CSS class rather than mutating capability-owned `hidden` attributes.
- Reflow the composer action grid when a visibility preference changes.
- Update user and contributor documentation at the correct repository documentation layers.

## Non-goals

- Hiding Send, tabs, Control Deck sections, version badges, side-panel collapse/edit controls, mobile navigation, or arbitrary unregistered elements.
- Changing whether a capability is installed or available.
- Per-workspace, per-tab, per-browser, or per-model visibility profiles.
- Dragging/reordering controls beyond the existing composer-action ordering behavior.
- Replacing existing file, Git, Git-footer, or Control Deck section context menus.

## Design and invariants

### Persistence

- Add `controlVisibility: { hiddenIds: string[] | null }` to the durable `uiLayout` envelope and advance its schema version with explicit migration from the current version.
- Store the same bounded list in local storage as the immediate/offline cache; reconcile through `GET/PUT /api/interface-preferences` using the existing revision-guarded writer.
- Treat `null` as no explicit preference/defaults and `[]` as an explicit “show all” state; both currently render all catalog items.
- Preserve unknown future layout envelopes during unrelated settings writes, matching current forward-compatibility behavior.

### Rendering

- A registered item is user-hidden only when its stable key is in `hiddenIds`.
- Use a `webui-user-hidden` class (`display: none !important`) so visibility preferences compose with, rather than overwrite, runtime `hidden` state.
- “Show” removes only the preference class; it does not clear a runtime `hidden` attribute.
- Reapply state after durable snapshot adoption and after relevant dynamic UI rendering; static tag containers make tag-category hiding independent of individual dynamic tag instances.
- **Send** has no visibility key/data attribute and no hide path.

### Context menu

- Empty registered host region: grouped `menuitemcheckbox` entries for the full catalog plus **Show all** and **Reset defaults**.
- Registered visible item: focused menu with **Hide <label>**, plus recovery actions.
- Ignore right-clicks inside unrelated links, inputs, textareas, selects, editable content, open submenus, and elements owned by existing specialized context menus unless the direct target is a registered visibility item.
- Support keyboard-equivalent invocation and restore focus to a surviving trigger or a safe host fallback.

## Execution DAG and ownership

### Wave 0 — baseline and coordination (integration owner)

- Preserve existing user edits.
- Wait for the active split-layout owner to finish `public/styles.css`, `tests/control-deck-side-panels-static.test.mjs`, `tests/browser/control-deck-side-panels.spec.mjs`, and cache-revision changes before the UI workstream touches shared assets.
- Record baseline focused test results where practical.

### Wave 1 — Workstream A: durable settings contract (Worker 1, sequential shared-tree writer)

**Owned files:**

- `pi-package-webui/lib/ui-layout-settings.mjs`
- `pi-package-webui/tests/ui-layout-settings.test.mjs`
- narrowly required settings-persistence tests that do not overlap the active split-layout files

**Deliverables:**

- New validated/normalized/migrated visibility field.
- Merge/revision behavior and bounded-list tests.
- No frontend, CSS, docs, plan, or report edits.

**Validation:** focused settings/unit tests and syntax checks.

**Handoff:** `.pi/subagents/handoffs/webui-button-visibility-settings.md`

### Wave 2 — Workstream B: UI, interactions, tests, and docs (Worker 2, starts only after Wave 1 integration and split-layout ownership release)

**Owned files:**

- `pi-package-webui/public/index.html`
- `pi-package-webui/public/app.js`
- `pi-package-webui/public/styles.css` outside unrelated split-layout selectors
- new visibility-focused static/browser tests
- `pi-package-webui/README.md`, `TECHNICAL.md`, and/or `DEVELOPMENT.md` according to repository documentation layering
- necessary app/PWA asset revision references after reconciling the peer’s revision bump

**Deliverables:**

- Stable registry/data bindings for the full approved catalog.
- Accessible context menu and immediate/durable state application.
- Composer reflow and runtime-gating preservation.
- Static and Chromium user-flow coverage.
- User-facing global-scope/recovery docs and contributor-only contract/test notes.

**Validation:** syntax, static visibility tests, focused Chromium test, documentation diff check.

**Handoff:** `.pi/subagents/handoffs/webui-button-visibility-ui.md`

### Wave 3 — central integration (integration owner)

- Inspect both actual diffs and handoffs.
- Confirm boundaries, migrations, no lost peer edits, Send exclusion, and cache-version consistency.
- Run affected settings/static/browser tests and the package suite as feasible.
- Record failures and unrelated pre-existing failures explicitly.

### Wave 4 — independent review quorum

Two fresh-context read-only reviewers from distinct provider families, and distinct from the primary implementation provider when available:

1. Correctness/accessibility/state-composition review.
2. Persistence/migration/tests/maintainability review.

Every finding receives one disposition: `accepted`, `rejected`, `deferred`, or `needs verification`, with evidence in this plan’s progress record. Accepted fixes go to one sequential fix worker and are revalidated.

### Wave 5 — report and completion

- Generate `reports/webui-global-button-visibility.html` using the HTML-report workflow.
- Link report and plan bidirectionally.
- Move this plan to `plans/archive/` only after all completion gates pass.

## Acceptance checks

- `node --check pi-package-webui/public/app.js`
- `node pi-package-webui/tests/ui-layout-settings.test.mjs`
- new visibility static test(s)
- focused Playwright visibility flow covering area menu, direct-button hide, Show all, Reset defaults, persistence/reload, dynamic runtime gating, keyboard access, and Send exclusion
- relevant settings/HTTP persistence harness test if the schema/API path changes
- `npm test --prefix pi-package-webui` or the repository-supported equivalent
- `git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'`
- final diff inspection confirming existing split-layout changes remain intact

## Rollback guidance

- Revert the visibility UI registry/menu and the new durable field together.
- Schema rollback must keep reading the newer envelope safely or explicitly migrate it; do not silently discard unrelated layout fields.
- Removing only CSS or only persistence code is not a safe rollback because it can leave controls hidden without a recovery menu or retain unsaved UI state.
- Existing settings are non-destructive: clearing the new hidden-key list restores all defaults.

## Risks and mitigations

- **Runtime `hidden` collisions:** use a separate class and test capability-gated controls.
- **User can hide all recovery controls:** empty-area context menus remain available; Show all/Reset defaults are always menu actions.
- **Composer grid holes/stale positions:** schedule existing grid restoration/repack after visibility changes.
- **Context-menu conflicts:** restrict host bindings and preserve specialized menus.
- **Schema migration/data loss:** explicit previous-version migration and revision/forward-compatibility tests.
- **Concurrent dirty-tree edits:** sequential writers, explicit file ownership, and peer coordination before shared CSS/cache edits.
- **Mobile behavior:** context menu targets desktop marked regions; hidden preferences still apply consistently to shared controls without removing Send.

## Decision record

- 2026-08-17: User approved global persistence.
- 2026-08-17: User approved Show all and Reset defaults.
- 2026-08-17: User defined `btw` as the `/btw side question` button.
- 2026-08-17: User defined tag scope as the multiple tag types around the input frame.
- 2026-08-17: User confirmed Send must remain visible.
- 2026-08-17: Integration owner selected a hidden-key registry composed with existing capability gating.
- 2026-08-17: Active peer owns split-layout CSS/tests/cache revisions; visibility work must not overlap until release.

## Progress and review dispositions

- Planned; implementation not started.
- Worker handoffs: pending.
- Integration evidence: pending.
- Reviewer quorum: pending.
- Finding dispositions: pending.
- Final report: pending.
