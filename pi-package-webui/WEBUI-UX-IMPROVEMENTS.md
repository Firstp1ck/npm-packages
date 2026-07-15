# Pi WebUI UX Improvement Plan — Triaged

## How to read this document

Every item is classified by actual impact, verified against the current code and screenshots:

- **[REAL]** — measurable production, onboarding, accessibility, or reliability impact today.
- **[FRICTION]** — real usability cost, but nothing breaks; users route around it.
- **[FUTURE-RISK]** — fine at current scale, becomes a real problem as the WebUI grows (more providers, extensions, commands, views).
- **[COSMETIC]** — polish. Batch these opportunistically; never schedule them ahead of REAL items.

## Verified evidence baseline (checked 2026-07-15)

| Claim | Evidence |
|---|---|
| Root font scaled down | `public/styles.css:75` → `font-size: 80%` |
| Sub-10px text is widespread | 138 declarations between `0.5rem` and `0.72rem` in `styles.css` |
| Frontend monolith | `app.js` 27,631 lines · `styles.css` 11,038 · `index.html` 909 |
| Native blocking dialogs | 35 `confirm()` call sites in `app.js` |
| No listbox a11y wiring | 0 uses of `aria-activedescendant` in `app.js` / `index.html` |
| File open needs double-click | `app.js:5705`, `app.js:5769` (`dblclick`); context menu via `contextmenu` |
| One-open accordion enforced | `app.js:1409–1443` (`setSidePanelSectionCollapsed` collapses siblings) |
| `aria-modal` without focus trap | `app.js:2552` sets `aria-modal="true"`; no trap implementation exists |
| No forced-colors support | 0 `forced-colors` media queries |
| Tests are static, not behavioral | `tests/` is harness + regex/static assertions; no keyboard/focus/flow tests |

## Executive summary

The WebUI is capability-first rather than task-first: many functions are exposed simultaneously, duplicated across surfaces, and given equal visual weight. That is mostly **friction**, not breakage.

The genuinely **real** issues are narrower and mostly about accessibility, safety of destructive/settings actions, and first-run comprehension. The dominant **future risks** are architectural: a 27k-line `app.js`, per-provider hardcoded panels, and a test suite that cannot catch behavioral regressions — these will make every future feature slower and riskier to ship.

Recommended posture: fix the REAL items and the two structural FUTURE-RISK items (modularization, behavioral tests) before any visual redesign. Cosmetic work rides along with whichever surface is being touched anyway.

## Existing strengths to preserve

- Strong command palette foundation.
- Consistent theme and recognizable visual identity.
- 44 px touch-target defaults.
- Responsive desktop/tablet/mobile layouts.
- Persistent panel and layout preferences.
- Reduced-motion support and extensive ARIA labeling.
- Remote access is closed by default with PIN auth (`Closed · local only`) — keep this default.

---

# Tier 1 — [REAL] Fix these first

## Implementation progress (updated 2026-07-15)

| Item | Status | Implemented / remaining |
|---|---|---|
| 1. Typography and minimum text size | **Implemented** | Root restored to `100%`; `--text-xs` through `--text-xl` tokens added; sub-floor declarations replaced; Comfortable/Compact browser setting added. Automated floor checks pass. **Remaining:** manual review at 100% and 200% zoom. |
| 2. Accessible file operations | **Implemented** | Files open with one click/Enter; each directory has one clickable expand arrow, a `DIR` marker, nested indentation/guides, visible selection, keyboard tree navigation, and a keyboard/touch overflow menu. The old double-click/right-click instructions were removed. |
| 3. Modal and drawer keyboard behavior | **Implemented** | Dialogs/drawers keep keyboard focus inside, close with Escape, and return focus to their trigger. Command palette and composer suggestions expose the highlighted option to assistive technology. **Remaining:** manual keyboard and screen-reader flow review. |
| 4. Settings apply and scope | **Implemented** | One Apply action changes to **Apply and reload** only when necessary; dirty-state tracking, explicit scope labels, density setting, remote-access section, and unsaved-change warning are present. |
| 5. Destructive-action confirmations | **Implemented** | Application confirmation UI explains consequences, affected state, undoability, and safer alternatives; native `confirm()` remains only as degraded fallback. Reversible actions now show a non-blocking, 10-second Undo notification with visible expiry and accessible status updates. Undo is wired to optional-feature toggles, prompt-list deletion, custom app-runner deletion, file moves/renames, and opening remote access. Irreversible actions retain confirmation. Per user review, **Close all Tabs** stays directly visible instead of living in a one-item overflow menu. |
| 6. Empty start state / Home | **Mostly implemented** | Empty transcripts render in-canvas start actions for conversation, workspace, resume, and branch worktree, plus recent workspaces and a compact context line. **Remaining:** manual first-run review and richer recent-session presentation if needed. |
| 7. Remote-access visibility | **Implemented** | Wording changed to **Open for remote access**; opening requires an exposure confirmation; open state has a persistent header indicator; detailed configuration is available under Settings → Remote access. |

### Verification status

- `npm run check`: **passed** (19/19 test files).
- Typography-floor grep: **passed**.
- File double-click/right-click instructional checks: **passed**.
- Native confirmation check: **passed** except the intentional degraded fallback.
- Undo structure/integration checks: **passed** for expiry, async reversal, optional features, prompt lists, custom app runners, file moves, and remote access.
- Browser-level zoom, touch, focus-trap, Undo timing, and screen-reader checks: **still manual / pending**.

## 1. Typography and minimum text size (accessibility failure)

**Why real:** `font-size: 80%` root plus 138 sub-`0.72rem` declarations means metadata, badges, and hints render at ~7–9 px. That fails WCAG readability expectations, breaks at 200% zoom, and directly hurts every user on every screen. This is the single highest-leverage fix.

- Return root font size to `100%`.
- Enforce a floor: no interface text below `0.75rem` (12 px effective).
- 14–16 px body, 12–13 px minimum metadata, 16–18 px headings.
- Ship density as an explicit **Comfortable / Compact** toggle instead of making extreme density the only mode.
- Introduce typography tokens so the floor is enforceable in review:

```css
--text-xs: 0.75rem;  /* absolute floor */
--text-sm: 0.875rem;
--text-md: 1rem;
--text-lg: 1.125rem;
--text-xl: 1.25rem;
```

**Verification:** grep for `font-size: 0\.[0-6]` returning zero matches; manual check at 100% and 200% zoom.

## 2. File operations require double-click / right-click (touch users locked out)

**Why real:** `app.js:5705/5769` bind `dblclick` to open, `contextmenu` for actions. Touch and keyboard-only users cannot open or manage files at all — a functional gap, not a preference.

- Single-click (or Enter) opens a file; separate chevron target expands folders.
- Always-available per-row overflow menu for rename/move/delete (touch + keyboard reachable).
- Proper tree keyboard semantics on the existing `role="tree"` (`index.html:525`): Arrow keys, Home/End, Enter, roving `tabindex`.
- Visible selected state distinct from hover.
- Hide the instructional paragraph ("Double-click… Right-click…") once interactions are self-evident.

## 3. `aria-modal` without a focus trap (screen-reader hazard)

**Why real:** `app.js:2552` sets `aria-modal="true"` on the side panel in drawer mode but no focus trap exists. Screen readers hide background content from the accessibility tree while keyboard focus can still wander into it — an actively broken state, worse than omitting `aria-modal`.

- Implement one shared modal/drawer primitive: focus trap, Escape close, focus return to trigger.
- Apply it to the mobile inspector drawer, settings dialog, directory picker, and command palette.
- Add `aria-activedescendant` + stable option IDs to command palette and autocomplete lists (currently zero usages).

## 4. Settings apply/scope ambiguity (misconfiguration risk)

**Why real:** Two competing terminal actions (**Apply** vs **Apply & reload tab**) plus four badge scopes (Now / Browser / Reload / TUI) mean users cannot predict whether a change took effect, applies to this tab, or silently requires a reload. This causes real misconfiguration, not just confusion.

- One primary action: **Apply**, which self-escalates to **Apply and reload** only when a changed field requires it.
- Track dirty fields; only prompt for reload when a *changed* field needs it.
- Make scope explicit per field in plain text ("This tab", "This browser", "Global", "Native TUI") instead of badge legend decoding.
- Warn before closing with unsaved changes.
- Do not expose the same setting in both the Control Deck and `/settings` without a single source of truth — duplicated writers will drift as settings grow.

## 5. Destructive actions via 35 native `confirm()` dialogs

**Why real:** blocking dialogs with dense technical strings for actions like **Close all tabs** (which sits as a permanently prominent header button). The safety mechanism works, but comprehension is poor exactly where stakes are highest.

- One application confirmation dialog pattern for destructive/complex actions stating: what happens, what is affected, whether it is undoable, and the safe alternative.
- Move **Close all tabs** into an overflow menu; keep confirmation when tabs have running work.
- Prefer optimistic action + Undo for reversible operations (e.g. disabling an extension) over confirmation.
- Keep native `confirm()` only as a degraded fallback.

## 6. Empty start state gives no onboarding (introduction impact)

**Why real:** the default view is a near-empty canvas with a faint logo; all guidance lives behind the separately-toggled dashboard, the Control Deck, and icon-only buttons. First-run users have no visible path to "start work". This directly gates adoption.

- When the transcript is empty, render the start state in the canvas itself: focused composer, **Open a workspace**, **Resume a session**, **Branch worktree**, recent workspaces/sessions, and one compact line with workspace · branch · model · context.
- Make the workspace dashboard *be* this empty state / Home, not an extra toggled layer duplicating footer and inspector data.
- Once a conversation starts, collapse to a compact contextual header.

## 7. Remote-access state must stay unmistakable (production/security)

**Why real:** "Open to network" is one click inside a routine controls panel. The current default (closed, PIN auth) is correct, but as the WebUI gains features this is the one control whose misuse has security consequences.

- Rename to **Open for remote access** and require an explicit confirmation stating the exposure (interface, port, auth mode).
- Show a persistent, visually distinct indicator (header-level, not buried in an accordion) whenever the listener is open to the network.
- Move remote-access configuration into Settings → Remote access; keep only the open/closed status + toggle visible.

---

# Tier 2 — [FRICTION] Real usability cost, schedule after Tier 1

## Composer overload

The composer mixes writing actions with session lifecycle (New session, Compact, Git workflow, publish, skills, runners, `/btw`) as icon-only buttons.

- Persistent: mode selector (Send / Steer / Follow-up as one control), input, Attach, Send.
- Everything else behind a labeled **More actions** menu and the command palette.
- Send becomes Stop/Abort during a run.
- Show attached files above the input with type/size/remove.
- Keyboard hints for send vs newline.

## Control Deck information architecture

Ten equal-weight accordions with enforced single-open (`app.js:1422`) prevent comparing related info and cause repeated navigation. Several sections duplicate other surfaces.

Target structure — a small nav rail/tabs instead of accordions:

- **Context** — session title/status, model, thinking, context usage, queue (badge), subagents (badge).
- **Files** — tree with changed/hidden/ignored filters.
- **Usage** — all providers together (see Tier 3 scaling note).
- **Extensions** — current "Optional features".
- **Diagnostics** — events log, server controls, raw IDs/paths.

Consolidations:

- **Remove the Commands section** — it duplicates the command palette with a weaker interaction; palette becomes canonical.
- **Events → Diagnostics** — it is a developer log (screenshot shows repeated raw "attached 1 file from clipboard" lines); group repeats, add Copy/Clear.
- **Codex Usage + Claude Usage → Usage.**
- **Session + Queue + Subagents → Context**, with UUIDs, JSON path, PID behind "Advanced details" + copy buttons (raw paths currently wrap across 4+ lines and dominate the section).
- **Controls appearance/remote/server/notifications → Settings**; keep only model, thinking, and context state in the inspector. Drop the redundant Set model / Set thinking buttons if selection can apply directly.

## Duplicated status surfaces

Model, context, session, queue, CWD, and Git state appear in the dashboard, footer, side panel, and tab metadata. Pick one canonical, clickable status strip:

```text
~/npm-packages • main • 3 changes | gpt-5.6 • xhigh • Context 0%
```

- Hide zero-value metrics (`$0.00`, `queue 0`) until relevant.
- Clicking a segment opens the corresponding detail view.
- Each metric rendered by exactly one code path — duplicated renderers are also a consistency bug factory (see Tier 3).

## Directory picker

Ambiguous controls (**Tab**, **Default**, **Root**, "Fast pick added"), oversized rows, weak location context.

- Rename to **Choose working folder**; add clickable breadcrumbs (`Home / npm-packages / …`).
- Buttons: Back, Up, Home, Current workspace. "Fast picks" → **Pinned folders**; show pinned as a state, not a disabled button.
- Compact rows with folder icons; deprioritize `.git`, `node_modules`, build output by default with a "show hidden/ignored" toggle.
- Enter opens; explicit **Select this folder**; preserve focus across navigation; inline loading/permission errors.
- "Create folder" as secondary action, not a permanent row.

## Queue: two concepts in one panel

"Prompt lists" (reusable sequences) and the live queue (steering/follow-ups for the active run) are different things.

- Split: **Current queue** (view/remove/reorder pending messages) vs **Saved prompt sequences** (create/load/run).
- Empty queue explains how to add a follow-up and links to the composer mode control.
- Don't show disabled actions (Run) without stating what enables them.

## Command palette upgrades

Already the strongest interaction; make it canonical.

- Group results (Actions / Tabs / Models / Sessions / Commands); recents before typing; shortcuts on the right.
- Fuzzy ranking instead of token containment ([FUTURE-RISK]: linear containment degrades as extension commands multiply — screenshot already shows dozens of `/`-commands).
- Stable option IDs + `aria-activedescendant` (Tier 1 item 3); preserve selection across refresh.

---

# Tier 3 — [FUTURE-RISK] Fine today, expensive later

These do not hurt the current user much, but every one of them compounds with each new feature. The first two are the highest-value engineering investments in this document.

## 1. Frontend monolith (reliability risk for all future work)

`app.js` at 27,631 lines and `styles.css` at 11,038 lines means every feature touches one file, merge conflicts are constant, and no change is locally verifiable. This is the root cause that makes all other improvements risky to ship.

Split into cohesive modules while keeping the vanilla (no-framework) architecture:

- `shell/` — tabs, navigation, responsive inspector.
- `composer/` — input, modes, attachments, action sheet.
- `palette/` — indexing, ranking, rendering, keyboard.
- `inspector/` — Context, Files, Usage, Extensions, Diagnostics.
- `settings/` — schema, scope handling, dirty tracking.
- `files/` — tree, search, viewer, actions.
- `design-system/` — tokens, buttons, dialogs, list rows, badges.

Do this incrementally: extract one module per Tier 1/2 fix you ship, rather than a big-bang rewrite.

## 2. Test suite cannot catch behavioral regressions

Current tests are static/regex assertions over source plus server harnesses. None of the Tier 1 fixes (focus traps, keyboard trees, single-click open, settings dirty-state) can be verified by them, and future refactors of the monolith will be blind.

- Add behavioral tests (Playwright or similar) for: keyboard navigation, focus restore, modal trapping, palette ranking, single-click file open, unsaved-settings warning, destructive-action confirmation.
- Add automated a11y checks (axe) and visual regression screenshots (desktop/tablet/mobile × light/dark).
- Keep static tests only where they are genuinely cheaper.

## 3. Per-provider hardcoded panels do not scale

**Codex Usage** and **Claude Usage** are separate top-level sections. Every future provider adds another accordion.

- One **Usage** view rendering provider cards from data: period usage, remaining allowance, reset time, auth/error state.
- Lazy-fetch when opened; warning badges near limits.

## 4. Optional features list will outgrow its layout

The screenshot already shows large nested cards per feature with repeated prominent **Disable** buttons. At 30+ extensions this becomes unusable.

- Rename to **Extensions**; compact one-line rows (`name · status · version · overflow menu`), search, and filters (Enabled / Disabled / Update available / Incompatible).
- Details (compatibility, expected version ranges) in an expandable section.
- Undo after disable instead of confirmation.
- Distinguish installed / enabled / loaded / reload-required in plain language.

## 5. Events log growth

The raw feed already shows unbounded repeated entries. Cap retention, group repeats ("attached 12 files"), add severity filters and Copy/Clear, and surface user-relevant events as toasts instead. Keep the raw log under Diagnostics.

## 6. No design tokens → theme drift

With 11k lines of CSS and one-off sizes/colors everywhere, each new view diverges slightly. Introduce typography (Tier 1), spacing (4/8 px increments), and semantic color tokens (interactive / success / warning / destructive) before the surface count grows. Add `forced-colors` and high-contrast support while doing so (currently zero coverage).

## 7. Mobile menu nesting

Substantial mobile handling exists, but nested dropdowns will multiply with features.

- One bottom action sheet for composer overflow; one navigation drawer (Context / Files / Usage / Extensions / Settings / Diagnostics) using the shared modal primitive from Tier 1.
- Full-screen tab switcher instead of dense wrapped popover.
- Persistent on mobile: input, attach, mode, send/abort only.
- Verify iOS safe-area and installed-PWA behavior.

---

# Tier 4 — [COSMETIC] Batch opportunistically

Do these while touching the relevant surface for a Tier 1–3 item; never as standalone work.

- Reduce uppercase + wide letter-spacing in navigation labels.
- Reserve accent colors for semantics (interactive / success / warning / destructive); stop coloring by feature category.
- Reduce glow/border effects on non-primary elements; reserve glow for focus and active runs.
- Consistent icons per concept; visible labels for unfamiliar actions; tooltips as supplement only.
- Microcopy: "Web UI" consistently; "Working folder" (reserve `cwd` for advanced details); "Pinned folders" not "Fast picks"; "Load list" capitalization; "Open for remote access"; "Extensions" not "Optional features"; make "New session" vs "New tab" outcomes explicit.
- Same capitalization for "New tab" everywhere; label the split-view icon.
- Prefer dividers/spacing over nested bordered cards; reduce stacked translucent surfaces.

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
├ Workspace • branch • changes │ model • context • run status ───┤
```

One canonical home per feature; power-user capability preserved behind palette + More menus.

---

# Delivery sequence (impact-ordered)

## Phase 1 — Real fixes, low structural risk

1. Typography floor + root font size + density toggle (Tier 1.1).
2. Single-click/keyboard/touch file operations (Tier 1.2).
3. Shared modal primitive with focus trap; fix `aria-modal` drawer (Tier 1.3).
4. Empty-state Home in the transcript canvas (Tier 1.6).
5. Remote-access confirmation + persistent open-to-network indicator (Tier 1.7).

## Phase 2 — Safety and settings correctness

1. Settings dirty-tracking, single Apply, explicit scopes (Tier 1.4).
2. Application confirmation dialog pattern; migrate destructive `confirm()` sites; Close-all-tabs to overflow (Tier 1.5).
3. Behavioral test harness covering Phases 1–2 (Tier 3.2) — do not defer this to the end.

## Phase 3 — Structure reduction

1. Inspector reorganization: Context / Files / Usage / Extensions / Diagnostics; remove Commands section; merge provider usage (Tier 2 + 3.3).
2. Composer simplification with More menu (Tier 2).
3. Single canonical status strip; delete duplicate renderers (Tier 2).
4. Extract each touched area into modules as you go (Tier 3.1).

## Phase 4 — Focused tool redesigns

1. Working-folder picker.
2. Extensions manager layout.
3. Queue split (current queue vs saved sequences).
4. Command palette grouping/ranking/recents.
5. Session section: user-facing info first, raw IDs behind Advanced.

## Phase 5 — System consistency

1. Design tokens (spacing, color) + forced-colors/high-contrast.
2. Mobile action sheet + navigation drawer on the shared primitive.
3. Cosmetic batch (Tier 4) across all surfaces.
4. Visual regression + axe coverage; usability test with one new and one experienced user.

---

# Success criteria

- No interface text below 12 px effective; UI usable at 200% zoom.
- Files can be opened and managed by touch and keyboard alone.
- All modals/drawers trap focus, close on Escape, and restore focus.
- Settings changes are predictable: one Apply, explicit scope, reload only when required, unsaved-changes warning.
- Destructive actions state consequences and offer Undo where reversible.
- A first-run user can start or resume work without opening the Control Deck or hovering any icon.
- Network exposure state is always visible when open.
- Each metric/feature has exactly one canonical renderer and location.
- New extension/provider/command additions require no layout redesign (rows/cards scale, palette ranks).
- Behavioral tests exist for every Tier 1 fix; regressions in focus, keyboard, or destructive flows fail CI.
