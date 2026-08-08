# Mobile Git footer overlay and terminal-group dropdown plan

Status: planned  
Classification: complex  
Integration owner: parent Pi session  
Report: [reports/mobile-footer-terminal-groups.html](../../reports/mobile-footer-terminal-groups.html) (created after verification)

## Goal

Make the legacy-phone Git footer Details view a full-screen, explicitly minimizable overlay with refresh available only inside it, and make mobile terminal-group rows act as accessible dropdown buttons.

## Classification rationale

The injected preliminary classification was `lightweight`, but repository evidence materially contradicts it. The request has two meaningful implementation slices with independent interaction/state contracts: Git footer overlay ownership and terminal-group dropdown behavior. Both cross `public/app.js`, `public/styles.css`, browser/static tests, accessibility semantics, and responsive desktop/mobile isolation. The feature is therefore `complex` under the feature workflow contract.

## Success criteria

1. On the legacy phone/coarse-pointer layout, tapping **Details** opens the Git footer as a full-screen overlay bounded by the visual viewport and safe-area insets.
2. The expanded overlay exposes a top-positioned button whose visible label is only `−`, whose accessible label is “Minimize Git footer details,” and whose activation returns to the compact footer.
3. On mobile, the Git footer refresh control is hidden and non-interactive while Details is collapsed and is available inside the expanded overlay. Desktop refresh behavior remains unchanged.
4. The full-screen requirement applies only to the Git footer Details overlay, per the user’s clarification. Terminal drawer, composer More, Control Deck, follow-up queue, dialogs, and other temporary surfaces are non-goals.
5. On mobile, regular and subagent terminal-group title buttons show a dropdown affordance and toggle their group list instead of switching directly to the active member. Individual terminals are selected from the expanded list.
6. Desktop group hover/focus behavior and desktop title-click switching remain unchanged; mobile-v2 ownership remains unchanged.
7. Buttons expose synchronized `aria-expanded`, usable labels, 44px mobile targets, Escape/outside behavior consistent with the existing drawer, and no duplicate terminal controls.
8. Focused static and Chromium browser checks cover collapsed/expanded footer state, full-screen geometry, refresh placement, minimize semantics, regular/subagent group dropdown contracts, desktop isolation, and syntax/diff hygiene.

## Scope and non-goals

### In scope

- `public/app.js`
- `public/styles.css`
- focused static/browser tests under `tests/`
- `README.md` and `TECHNICAL.md`
- this plan, worker handoffs, and final report

### Non-goals

- Server, RPC supervisor, extension protocol, Git command, or persistence changes.
- Changes to Git footer payload keys or `/git-footer-refresh` behavior.
- Full-screen conversion of any overlay other than legacy-mobile Git footer Details.
- Desktop/tablet/mobile-v2 layout changes.
- Redesign of ungrouped terminal tabs or terminal grouping rules.
- Modification, reversion, staging, or inclusion of unrelated concurrent RPC-supervisor and contributor-document work.

## Decisions and invariants

- Approved user decision: only the Git footer Details surface becomes full-screen.
- Approved user decision: on mobile, the group title itself toggles the dropdown; it does not switch to the current group member.
- Assumption: “refresh only in the detailed overlay” is mobile-scoped because desktop has no collapsed Details overlay. Desktop refresh remains available.
- Invariant: regular and subagent terminal groups receive the same mobile disclosure semantics.
- Invariant: individual terminal/subagent selection still closes or updates the group list through existing state paths.
- Invariant: existing canonical nodes and event handlers are reused; no duplicate footer payload or terminal state is introduced.
- Invariant: prior uncommitted mobile compact-layout and touch-tooltip changes are preserved.

## Execution DAG

```text
Plan + dirty-baseline record
  └─ WS1 mobile Git footer full-screen overlay
       └─ WS2 mobile terminal-group dropdown behavior + docs
            └─ central integration and focused/full validation
                 └─ Reviewer A + Reviewer B (fresh, read-only)
                      └─ accepted fixes + revalidation
                           └─ final HTML report and archive
```

The repository is dirty. Both workers run sequentially in the shared working tree under one statically declared workflow; no automatic worktrees are permitted. Only one writer runs at a time.

## Workstreams

### WS1 — Mobile Git footer Details overlay

Owner: implementation worker 1.

Write boundary:
- `public/app.js`
- `public/styles.css`
- `tests/mobile-static.test.mjs`
- focused browser coverage only if required for the footer fixture
- unique handoff: `plans/handoffs/mobile-footer-overlay.md`

Deliverables:
- full-screen legacy-phone footer-details overlay;
- top `−` minimize control with accessible label;
- refresh visible/interactive only while the mobile overlay is expanded;
- desktop and mobile-v2 isolation;
- focused source/browser assertions where the existing fake-Pi fixture supports Git footer payloads.

Validation:
- `node --check public/app.js`
- affected focused static tests
- relevant Chromium browser test if available
- `git diff --check`

### WS2 — Mobile terminal-group dropdowns and documentation

Owner: implementation worker 2, after WS1 and its handoff are inspectable.

Write boundary:
- `public/app.js`
- `public/styles.css`
- `tests/terminal-tab-workspace-static.test.mjs`
- `tests/mobile-compact-layout.test.mjs`
- `tests/browser/mobile-foundation.spec.mjs`
- `README.md`
- `TECHNICAL.md`
- unique handoff: `plans/handoffs/mobile-terminal-group-dropdown.md`

Deliverables:
- mobile group-title dropdown behavior for regular and subagent groups;
- visible dropdown affordance and synchronized accessibility state;
- preserved desktop click/hover/focus switching behavior;
- focused source/browser coverage and user documentation;
- preservation of WS1 behavior.

Validation:
- `node --check public/app.js`
- `node tests/terminal-tab-workspace-static.test.mjs`
- `node tests/mobile-compact-layout.test.mjs`
- focused Chromium mobile coverage
- Markdown and diff checks

## Worker handoff contract

Each handoff records workstream/run identity and status; base/result revision when applicable; changed files and implementation summary; exact commands with exit codes; omitted checks; deviations and assumptions; unresolved decisions and residual risks; integration notes; and the unique artifact path. Workers stop on unapproved product, architecture, interface, security, dependency, persistence, migration, ownership, desktop/tablet, mobile-v2, or non-Git-overlay scope decisions.

## Central integration and acceptance checks

The integration owner inspects both diffs and handoffs, verifies boundaries and invariants, then runs:

1. `node --check public/app.js`
2. affected focused static tests
3. focused Chromium legacy-phone Playwright coverage
4. full `tests/browser/mobile-foundation.spec.mjs` when practical
5. `npm test`
6. `npm run check`
7. `git diff --check`
8. Markdown diff check

Manual/browser targets: 320px and 390px; safe areas; footer collapsed/expanded; `−` at the overlay top; refresh absent collapsed and available expanded; keyboard and Escape; regular and subagent group menus; desktop at 1280/1440px; mobile-v2 unchanged.

## Independent review quorum

After integration, obtain two fresh-context, read-only reviewer outputs from distinct provider families when available:

- Reviewer A: state transitions, canonical-node reuse, desktop/mobile-v2 isolation, regression risk, tests, and security.
- Reviewer B: mobile hierarchy, full-screen geometry, focus/keyboard/accessibility, dropdown discoverability, edge cases, and maintainability.

Record each finding with reviewer identity/model, affected file/symbol, evidence/severity, and exactly one disposition: `accepted`, `rejected`, `deferred`, or `needs verification`. Revalidate every accepted fix.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Full-screen footer covers composer/transcript without modal semantics | Give the expanded footer explicit overlay geometry, top controls, predictable minimize path, and focused browser assertions. |
| Footer render fast path leaves refresh/minimize state stale | Keep visibility driven by `mobileFooterExpanded` and update controls in `setMobileFooterExpanded` without duplicating payload state. |
| Refresh disappears on desktop | Scope collapsed-only hiding to the mobile/coarse-pointer media/state contract and assert desktop availability. |
| Group title click changes desktop behavior | Branch only on the established mobile viewport gate; retain desktop switch handler. |
| Hover/focus events reopen a mobile group after explicit close | Ignore touch hover for group disclosure and make explicit mobile click state authoritative. |
| Shared dirty files contain unrelated work | Sequential writers, exact boundaries, diff inspection, no cleanup/reset/staging, and explicit preservation notes. |

## Rollback guidance

Revert only the bounded footer overlay, mobile group dropdown, focused tests, and documentation changes. No API, payload, persisted setting, server state, dependency, or migration is introduced. Existing Git footer visibility settings and terminal groups remain valid.

## Progress and decision record

- 2026-08-08: Repository evidence identified Git footer rendering in `renderGitFooterPayload`, expansion state in `setMobileFooterExpanded`, mobile footer CSS under the legacy mobile media block, and group rendering in `renderTerminalTabGroup` plus `renderSubagentTerminalTabGroup`.
- 2026-08-08: Preliminary `lightweight` classification reclassified to `complex` because two cross-cutting UI/state slices and independent accessibility/regression ownership are required.
- 2026-08-08: User clarified that only the Git footer Details overlay becomes full-screen.
- 2026-08-08: User selected group-title-as-dropdown behavior on mobile rather than a separate caret button. A visible caret/expanded affordance may be included inside that title button.
- 2026-08-08: Repository is dirty with prior mobile compact-layout/touch-tooltip changes and unrelated concurrent RPC-supervisor work; all must be preserved.

## Completion gate

Incomplete until two qualifying implementation-worker outcomes, central integration evidence, two qualifying independent reviews with current dispositions, accepted-fix revalidation, and a mutually linked self-contained HTML report are recorded. After verification, move this plan to `plans/archive/mobile-footer-terminal-groups.md`.
