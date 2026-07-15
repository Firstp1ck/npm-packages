# Pi WebUI UX Improvement Plan

## Executive summary

The Pi WebUI is visually distinctive, feature-rich, and clearly designed for power users. Its main UX problem is that it is **capability-first rather than task-first**: many useful functions are exposed simultaneously, duplicated across surfaces, and given similar visual weight.

The result is powerful but harder to learn than necessary. The recommended direction is to preserve the existing functionality and visual identity while introducing:

- clearer task-oriented navigation;
- stronger information hierarchy;
- fewer duplicated controls;
- more readable typography;
- progressive disclosure for advanced functionality;
- better touch, keyboard, and screen-reader interactions;
- one canonical location for each feature.

## Existing strengths to preserve

- Strong command palette foundation.
- Consistent theme and recognizable visual identity.
- Useful 44 px touch-target defaults.
- Responsive layouts for desktop, tablet, and mobile.
- Persistent panel and layout preferences.
- Good keyboard handling in several menus.
- Reduced-motion support.
- Extensive ARIA labeling.
- Readily available context, Git, session, queue, and model information.
- Native browser dialogs for many focused workflows.

---

# Highest-priority improvements

## P0 — Fix typography and information density

This is the clearest usability issue across almost every screen.

`public/styles.css` sets the root font size to `80%`, while many labels use `0.56–0.72rem`. In practice, some metadata, descriptions, badges, and dashboard hints render around 7–9 px.

### Recommended changes

- Return the root font size to `100%`.
- Use approximately:
  - 14–16 px for normal interface text;
  - 12–13 px minimum for secondary metadata;
  - 16–18 px for important headings.
- Provide an optional **Compact density** mode instead of making extreme density the default.
- Reduce uppercase text and wide letter spacing in normal navigation.
- Increase contrast for muted text, placeholders, and disabled controls.
- Reserve accent colors for semantic meaning:
  - blue/teal: interactive or selected;
  - green: success;
  - yellow: warning;
  - red: destructive or error.
- Avoid assigning colors merely because actions belong to different feature categories.
- Reduce excessive glow and border effects around non-primary elements.

## P0 — Replace the empty canvas with a useful start state

The main transcript dedicates most of the viewport to an empty canvas with a faint logo when no conversation exists. New and idle users receive little guidance.

The workspace dashboard already contains relevant actions, but it is separately toggled and duplicates information from the footer, tabs, and side panel.

### Recommended empty state

When a session has no messages, show:

- **Ask Pi**, with the composer focused;
- **Open a workspace**;
- **Resume a session**;
- **Create a branch worktree**;
- recent workspaces;
- recent sessions;
- one compact line showing the current workspace, branch, model, and context.

Once a conversation begins, collapse this into a compact contextual header rather than retaining a full dashboard.

The workspace dashboard should become the canonical empty-state/home experience, not another optional layer.

## P0 — Simplify the composer

The composer currently combines many unrelated actions:

- New session;
- Compact context;
- Git workflow;
- publishing;
- skills and tools;
- options and settings;
- app runners;
- `/btw`;
- attachments;
- follow-up and steering behavior;
- send and abort.

Many are icon-only and depend on tooltips for discovery.

### Recommended persistent composer

```text
[Mode: Send / Steer / Follow-up] [Message……………………] [Attach] [Send]
                                         [More actions…]
```

### Move into a labeled “More actions” menu or command palette

- New session.
- Compact context.
- Git workflow.
- Publish workflows.
- Skills and tools.
- App runners.
- Resume, fork, export, and settings.

### Additional composer improvements

- Keep only the current delivery mode visible instead of presenting competing Follow-up and Steer actions.
- Display keyboard hints for sending and inserting a newline.
- During execution, turn Send into a clear Stop/Abort state.
- Show attached files above the input with file type, size, edit, and remove actions.
- Do not rely on icon color to communicate meaning.
- Keep attachment and send controls persistent because they are frequent actions.
- Move session lifecycle actions away from the writing surface.

## P0 — Redesign the Control Deck information architecture

The side panel exposes many accordion sections with nearly identical visual importance. The implementation allows only one section to stay open, preventing comparison and causing repeated navigation.

Several sections duplicate other interfaces:

- **Commands** duplicates the command palette.
- **Events** is primarily a developer log.
- **Controls** overlaps `/settings`.
- **Session** repeats dashboard and footer data.
- Codex and Claude usage are separate despite representing the same user task.

### Proposed inspector structure

Use a small navigation rail or tabs instead of ten equal accordions.

#### Context

- Session title and status.
- Model and thinking level.
- Context usage.
- Current queue.
- Active subagents.

#### Files

- Workspace tree.
- Changed, hidden, and ignored-file filters.

#### Usage

- Codex, Claude, and future providers together.

#### Extensions

- Optional features and integrations.

#### Diagnostics

- Event log.
- Server controls.
- Raw session identifiers and paths.

Global **Settings** should be a separate dialog or page.

### Sections to consolidate or remove

- Remove the side-panel Commands section and make the command palette canonical.
- Move Events under Diagnostics.
- Merge Codex Usage and Claude Usage into Usage.
- Merge Session, Queue, and Subagents into Context, with count/status badges.
- Move server and remote-network configuration into Settings or Diagnostics.

## P0 — Consolidate repeated status information

The same model, context, session, queue, CWD, and Git state appear in the dashboard, footer, side panel, and tab metadata.

The footer is especially dense and competes visually with the composer.

### Recommended footer

Use one compact, clickable status strip:

```text
~/npm-packages • main • 3 changes | GPT-5.6 • xhigh • Context 0%
```

### Behavior

- Hide zero-value metrics such as `$0.00` until relevant.
- Clicking a status opens its corresponding detail panel.
- Show active-run status near the composer or transcript.
- Put advanced runtime metadata behind a disclosure.
- Avoid repeating the same metric in the dashboard, footer, and inspector.
- Prioritize workspace, branch, changes, model, context, and run state.

---

# Flow-specific improvements

## Directory picker

The current picker includes ambiguous controls such as **Tab**, **Default**, **Root**, and “Fast pick added.” Directory rows are oversized while navigation context is weak.

### Recommended changes

- Rename “Choose CWD” to **Choose working folder**.
- Add clickable breadcrumbs, for example:

  ```text
  Home / npm-packages / package-name
  ```

- Replace ambiguous buttons with:
  - Back;
  - Up;
  - Home;
  - Current workspace.
- Rename “Fast picks” to **Favorites** or **Pinned folders**.
- Show “Pinned” as a state, not as a disabled button.
- Use a compact folder list with folder icons.
- Add optional modification metadata where useful.
- Add controls for:
  - showing hidden folders;
  - showing ignored folders;
  - recursive search.
- Hide or deprioritize `.git`, `node_modules`, build output, and similar directories by default.
- Make “Create folder” a secondary action rather than a permanent full row.
- Support Enter to open a folder.
- Use a clear **Select this folder** action.
- Preserve keyboard focus when moving between directories.
- Show loading and permission errors inline without losing the current location.

Relevant implementation: `public/app.js` around the path-picker rendering and directory-loading functions.

## Command palette

The command palette is currently one of the strongest interactions and should become the main navigation mechanism.

### Recommended enhancements

- Group results by:
  - Actions;
  - Tabs;
  - Models;
  - Sessions;
  - Commands.
- Show recent and frequently used actions before the user types.
- Show keyboard shortcuts on the right.
- Add fuzzy ranking instead of simple token containment.
- Show the result count.
- Use stable icons rather than repeating an “ACTION” category column.
- Add favorites or pinned commands.
- Preserve selection when results refresh.
- Improve screen-reader announcement of active results using stable option IDs and `aria-activedescendant`.
- Consider showing recently used workspaces and sessions directly.
- Keep the command palette available from both the keyboard and one clearly labeled visual affordance.

Relevant implementation: `public/app.js` around `renderCommands`, `commandPaletteCoreItems`, and `renderCommandPaletteList`.

## Workspace dashboard

The dashboard currently duplicates header actions, footer status, tab state, session state, and inspector data.

### Recommended changes

- Make it the default experience only when the transcript is empty or when explicitly opening Home.
- Replace generic metrics with task-oriented actions and recent activity.
- Once a session is active, collapse it into a compact contextual header.
- Do not show the same model, context, session, and queue data in four locations.
- Keep open-tab switching in the primary tab interface.
- Make the home/dashboard button visually and textually understandable rather than relying only on a house icon.

## Control panel

The current Controls section mixes runtime controls, appearance, remote access, server administration, and notifications.

### Recommended changes

- Keep only frequently changed context controls in the inspector:
  - model;
  - thinking level;
  - context state.
- Move appearance into Settings → Appearance.
- Move remote access into Settings → Remote access.
- Move server actions into Diagnostics or Administration.
- Move notifications into Settings → Notifications.
- Avoid separate “Set model” and “Set thinking” buttons if a selection can apply immediately or through one shared Apply action.
- Clearly distinguish per-tab settings from global settings.

## Files

The current helper text requires double-click and right-click. Those interactions are weak on touch devices and not obvious to new users.

### Recommended changes

- Single-click a file to open it.
- Use a separate chevron target to expand folders.
- Add an always-available row overflow menu for touch and keyboard users.
- Add filters for:
  - changed;
  - untracked;
  - hidden;
  - ignored.
- Hide the long instructional paragraph behind a help icon.
- Consider a dedicated Files pane instead of constraining file operations to the narrow inspector.
- Implement proper tree keyboard behavior:
  - Arrow Up/Down;
  - Arrow Left/Right;
  - Home/End;
  - Enter;
  - roving focus.
- Add a visible selected-file state that is distinct from hover.
- Clearly distinguish opening a file from selecting it for an operation.
- Provide touch-accessible rename, move, open, and delete actions.
- Show ignored folders such as `node_modules` only on request.

Relevant implementation: `public/app.js` around the file-tree item click, double-click, and context-menu handlers.

## Optional features

This area behaves more like an extension manager than a side-panel status section.

### Redesign it as “Extensions”

- Add search.
- Filter by:
  - Enabled;
  - Disabled;
  - Update available;
  - Incompatible.
- Use compact one-line rows:

  ```text
  Feature name · status · version · overflow menu
  ```

- Put package compatibility and descriptions in expandable details.
- Replace repeated prominent Disable buttons with a row overflow menu.
- Provide Undo after disabling an extension.
- Show update availability and compatibility problems clearly.
- Move the GitHub feature-request message to a footer or help area.
- Keep category counts but avoid large nested cards for every enabled feature.
- Distinguish installed, enabled, loaded, and reload-required states in plain language.

## Session

Raw UUIDs and filesystem paths wrap across multiple lines and dominate the current Session section.

### Show user-facing information first

- Session name or generated conversation title.
- Running or idle status.
- Workspace.
- Message count.
- Last activity.
- Model and thinking level only if not already visible nearby.

### Primary actions

- Rename.
- Resume.
- Fork.
- Export.
- New session.

Move the following into **Advanced details** with copy buttons:

- UUID;
- JSON path;
- PID;
- transport state;
- internal tab ID.

## Queue

“Prompt lists” and queued messages are conceptually different but currently share one panel.

### Split them into two concepts

#### Current queue

- Messages waiting for the active run.
- Steering messages.
- Follow-up messages.
- Remove or reorder where supported.

#### Saved prompt sequences

- Reusable multi-step prompt lists.
- Create, save, load, rename, duplicate, and run.

### Additional changes

- For an empty queue, explain how to add a follow-up.
- Link directly to the composer mode control.
- Use consistent capitalization, such as “Load list.”
- Avoid showing disabled actions without explaining what enables them.
- Show queue count in the Context navigation badge.

## Commands section

The side-panel command list duplicates the command palette but provides a less capable interaction.

### Recommendation

- Remove it from the default side panel.
- Use the command palette as the canonical launcher.
- If retained, show only:
  - favorites;
  - recent commands;
  - project-specific commands.

## Events

The raw repeated event feed is useful for diagnostics, not as a top-level user feature.

### Recommended changes

- Move it under Diagnostics.
- Add severity filters.
- Group repeated events, for example: “12 files attached.”
- Add Copy and Clear actions.
- Add timestamps only where useful.
- Surface relevant user-facing events as transient notifications or toasts instead.
- Keep raw low-level entries available for troubleshooting.

## Provider usage

Codex Usage and Claude Usage should represent one user task.

### Recommended changes

- Merge them into a single Usage view.
- Use provider cards with:
  - current period usage;
  - remaining allowance;
  - reset time;
  - refresh state;
  - error or authentication state.
- Fetch usage lazily when the view opens.
- Add warning badges when limits are approaching.
- Avoid separate top-level navigation entries for every provider.

## Settings

The settings field grouping is reasonable, but the settings UX overlaps side-panel controls and presents two competing final actions: **Apply** and **Apply & reload tab**.

### Recommended changes

- Use a left-side category list or tabs.
- Add settings search.
- Make setting scope explicit:
  - This tab;
  - Browser;
  - Global;
  - Native TUI.
- Track changed fields.
- Mark only changed reload-required fields.
- Use one primary action:
  - **Apply** normally;
  - **Apply and reload** when necessary.
- Auto-save purely browser-local preferences where safe.
- Move Model and Theme shortcuts into navigation rather than the dialog footer.
- Keep advanced TUI-only options collapsed.
- Add Restore default at category or field level.
- Warn before leaving with unsaved changes.
- Explain badges such as Now, Browser, Reload, and TUI through a small legend or plain scope text.
- Avoid duplicating the same setting in the Control Deck and the settings dialog.

Relevant implementation: `public/app.js` around the native settings helpers and `openNativeSettingsDialog`.

---

# Navigation and interaction consistency

## Top tab bar

- Keep per-tab close controls.
- Move **Close all tabs** into an overflow menu because it is destructive and low frequency.
- Keep confirmation when tabs contain active work, unsaved state, or running processes.
- Consider Undo after bulk closing when technically possible.
- Label split view clearly or expose it through an overflow menu.
- Make the current tab and activity state more visually prominent than inactive metadata.
- Use the same capitalization for “New tab” everywhere.

## Icon-only controls

- Keep ARIA labels, but do not treat them as a substitute for discoverability.
- Use visible labels for important or unfamiliar actions.
- Use tooltips as supplemental help only.
- Keep one consistent icon for each repeated concept.
- Show keyboard shortcuts in tooltips and menus.

## Microcopy

Standardize terminology:

- “Web UI,” not mixed “WebUI” and “Web UI,” except in technical package names.
- “Working folder” for user-facing labels; reserve `cwd` for advanced details.
- “Favorites” or “Pinned folders,” not “Fast picks.”
- “Load list,” not mixed title capitalization.
- “Open for remote access,” rather than “Open to network.”
- “Extensions,” rather than “Optional features,” if the area manages packages.
- “New session” and “New tab” should clearly describe different outcomes.

## Feedback and destructive actions

The implementation uses many native `window.confirm` dialogs. They are safe but visually inconsistent and often contain dense technical text.

### Recommended changes

- Use consistent application confirmation dialogs for complex or destructive actions.
- State:
  - what will happen;
  - what data or process is affected;
  - whether it can be undone;
  - the safe alternative, where relevant.
- Keep native confirmation as a fallback.
- Use optimistic feedback plus Undo for reversible changes.
- Use toasts for success and lightweight failures.
- Keep detailed errors in Diagnostics.
- Avoid requiring confirmation for harmless, easily reversible actions.

---

# Accessibility improvements

The implementation already includes reduced-motion handling, many ARIA labels, and 44 px targets. The remaining concerns are interaction semantics and readability.

## Priorities

- Correct the extremely small text first.
- Ensure the mobile inspector behaves as a true modal drawer:
  - dialog semantics;
  - focus trap;
  - Escape close;
  - return focus to the trigger.
- Do not depend on hover tooltips for discovering icon actions.
- Add complete keyboard semantics to file trees and listboxes.
- Test at 200% browser zoom.
- Add high-contrast and forced-colors support.
- Validate contrast in every bundled theme.
- Ensure selected, focused, hovered, disabled, and active states remain distinguishable without color alone.
- Use stable IDs and `aria-activedescendant` for command-palette and autocomplete selection.
- Announce important run, queue, and error-state changes without making the entire transcript excessively chatty.
- Verify that dynamic updates do not unexpectedly move focus.
- Ensure touch-only users can access every context-menu operation.

---

# Mobile improvements

The responsive implementation contains substantial mobile-specific handling, but the number of nested menus remains high.

## Recommended changes

- Replace nested mobile composer dropdowns with one bottom action sheet.
- Use a full-screen tab switcher on mobile instead of a dense wrapped popover.
- Keep only message input, attachment, mode, send, and abort persistent.
- Hide low-priority status chips while the keyboard is open.
- Use one mobile navigation drawer with Context, Files, Usage, Extensions, Settings, and Diagnostics.
- Ensure the drawer traps focus and can be dismissed by swipe, backdrop, close control, and Escape where available.
- Keep destructive actions away from the thumb’s primary send area.
- Verify safe-area handling on iOS and installed PWA mode.
- Avoid controls smaller than 44 px unless they are part of a larger clearly tappable target.
- Ensure file actions do not require right-click or hover.

Responsive behavior is concentrated in the media-query sections of `public/styles.css`.

---

# Proposed target interface

```text
┌ Workspace / tabs ───── Command palette ─── Activity ─ Settings ┐
├─────────────────────────────────────────────┬──────────────────┤
│                                             │ Context          │
│ Conversation / useful empty state           │ Files            │
│                                             │ Usage            │
│                                             │ Extensions       │
│                                             │ Diagnostics      │
├─────────────────────────────────────────────┴──────────────────┤
│ Mode ▾  Message…                         Attach   More   Send   │
├ Workspace • branch • changes │ model • context • run status ──┤
```

This structure preserves power-user capability while giving each feature one canonical home.

---

# Design-system recommendations

## Typography tokens

Introduce a small set of semantic typography tokens instead of many one-off sizes:

```css
--text-xs: 0.75rem;
--text-sm: 0.875rem;
--text-md: 1rem;
--text-lg: 1.125rem;
--text-xl: 1.25rem;
```

No essential interface text should be below `--text-xs`.

## Spacing and density

- Define comfortable and compact density modes.
- Use consistent 4/8 px spacing increments.
- Reduce nested card padding before reducing text size.
- Prefer dividers and spacing over putting every group inside another bordered card.

## Color and elevation

- Reduce the number of simultaneous accent colors.
- Use glow for focus, active processes, or special moments—not every control.
- Reduce nested translucent surfaces that blur hierarchy.
- Make the primary action clearly dominant.
- Keep destructive actions visually distinct but not permanently prominent.

## Component consistency

Create canonical patterns for:

- primary, secondary, ghost, and danger buttons;
- icon buttons;
- segmented controls;
- status badges;
- inspector navigation;
- list rows;
- empty states;
- loading states;
- error states;
- confirmation dialogs;
- bottom action sheets;
- searchable selectors.

---

# Implementation architecture recommendations

The frontend currently places substantial functionality in large files:

- `public/app.js`: approximately 27,566 lines;
- `public/styles.css`: approximately 11,008 lines;
- `public/index.html`: approximately 909 lines.

Major UX changes will be safer if these are split into cohesive modules while retaining the current vanilla frontend architecture.

## Suggested modules

- `shell/`
  - tabs;
  - global navigation;
  - responsive inspector.
- `composer/`
  - input;
  - modes;
  - attachments;
  - action sheet.
- `palette/`
  - indexing;
  - ranking;
  - rendering;
  - keyboard behavior.
- `inspector/`
  - Context;
  - Files;
  - Usage;
  - Extensions;
  - Diagnostics.
- `settings/`
  - schema;
  - scope handling;
  - dirty-state tracking;
  - rendering.
- `files/`
  - tree;
  - search;
  - viewer;
  - file actions.
- `design-system/`
  - tokens;
  - buttons;
  - dialogs;
  - list rows;
  - badges;
  - typography.

## Testing recommendations

- Keep existing static wiring tests where useful.
- Add behavioral tests for:
  - keyboard navigation;
  - focus restoration;
  - modal focus trapping;
  - command-palette ranking;
  - single-click file opening;
  - mobile action-sheet behavior;
  - unsaved settings;
  - destructive-action confirmation.
- Add automated accessibility checks.
- Add visual regression screenshots for desktop, tablet, mobile, light, and dark themes.
- Test at 100%, 200%, and narrow viewport zoom scenarios.
- Add user-flow tests rather than relying primarily on regex assertions over source files.

---

# Suggested delivery sequence

## Phase 1 — Readability and immediate clarity

1. Increase typography and contrast.
2. Introduce comfortable and compact density modes.
3. Replace the empty canvas with the useful start state.
4. Consolidate the footer into one status strip.
5. Move Commands and Events out of the default Control Deck.
6. Address critical keyboard, focus, and touch-accessibility gaps.

## Phase 2 — Primary workflow simplification

1. Simplify the composer.
2. Make the command palette the canonical launcher.
3. Reorganize the inspector around Context, Files, Usage, Extensions, and Diagnostics.
4. Remove duplicated model, session, queue, and context displays.
5. Improve tab-bar hierarchy and move Close all tabs into overflow.

## Phase 3 — Focused tool redesigns

1. Redesign the working-folder picker.
2. Redesign Files for single-click, touch, and keyboard operation.
3. Redesign Optional features as Extensions.
4. Separate current queue from saved prompt sequences.
5. Replace raw session metadata with user-facing session management.

## Phase 4 — Settings and system consistency

1. Create one unified settings experience.
2. Clarify setting scopes and reload requirements.
3. Consolidate application confirmation dialogs and notifications.
4. Standardize terminology, capitalization, icons, and component states.
5. Add high-contrast and forced-colors support.

## Phase 5 — Architecture and validation

1. Modularize the large frontend files.
2. Introduce design tokens and canonical components.
3. Add accessibility and behavioral tests.
4. Add visual regression coverage.
5. Run structured usability tests with both new and experienced Pi users.

---

# Success criteria

The redesign should be considered successful when:

- a new user can start or resume work without opening the Control Deck;
- common actions are understandable without hovering over icons;
- each feature has one canonical location;
- no essential interface text renders below 12 px;
- the main composer exposes only frequent writing actions;
- files can be opened and managed without double-click or right-click;
- the command palette replaces duplicated command lists;
- settings clearly indicate scope and reload requirements;
- mobile users can access every action without nested hover-dependent menus;
- keyboard and screen-reader users can operate trees, listboxes, dialogs, and drawers predictably;
- the application retains its power-user capabilities without presenting all of them simultaneously.
