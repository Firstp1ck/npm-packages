# Workflow Button Placement

**Status:** Zero-height overlay implementation validated and independently reviewed  
**Classification:** Lightweight  
**Integration owner:** Main Pi agent (`openai-codex/gpt-5.6-sol`)  
**Report:** [Workflow Button Placement report](../reports/workflow-button-placement.html)

## Goal

Keep Workflow Mode directly accessible and isolated from crowded composer actions without consuming any additional vertical layout height.

## Classification rationale

This is a bounded placement and responsive-layout refinement. It converts the existing Workflow dock from a normal-flow row into a compact overlay anchored to the prompt frame, without adding APIs, persistence, dependencies, migrations, security-sensitive paths, or component boundaries.

## Success criteria

- Workflow Mode remains directly accessible without a submenu.
- The control stays visually distinct and away from the bottom action row.
- The dock is absolutely positioned inside the prompt frame and adds zero normal-flow height.
- Desktop retains a visible “Workflow mode” label; compact mobile hides the label.
- Prompt text and context tags reserve horizontal space only while the dock is visible and the mobile keyboard is closed.
- Capability gating, active/pressed/pending state, valid ARIA state, floating tooltips, and overlay restore focus remain intact.
- The dock hides while the mobile software keyboard is open.
- Workflow Mode remains absent from Options.
- Focused assertions and JavaScript syntax validation pass.
- Two fresh-context reviewers from provider families distinct from the implementation provider approve the integrated change.

## Scope

- `public/index.html` — nest `#workflowModeControls` inside `.composer-input-row` as its first overlay child.
- `public/app.js` — preserve reviewed floating-tooltip, valid busy-state, and restore-disclosure behavior.
- `public/styles.css` — absolutely position the dock at the prompt frame’s top-right, compact its target, reserve prompt/context-tag space while visible, and provide mobile width/keyboard behavior.
- `tests/mobile-static.test.mjs` — pin zero-height overlay placement, compact sizing, prompt/context-tag reservation, mobile label/restore behavior, ARIA state, and Options absence.

## Non-goals

- Changing Workflow Mode command or status synchronization.
- Redesigning the Workflow overlay or unrelated composer controls.
- Resolving unrelated dirty-worktree changes or pre-existing static-test failures.

## Validation record

- `node --check public/app.js` — passed.
- `node --check tests/mobile-static.test.mjs` — passed.
- Focused compact-overlay assertions — passed after review-driven geometry fixes.
- `git diff --check -- public/index.html public/app.js public/styles.css tests/mobile-static.test.mjs` — passed.
- `node tests/mobile-static.test.mjs` — blocked at the pre-existing typography-floor assertion because `public/styles.css` contains `font-size: 0.72rem`; the same declaration exists at `HEAD`.

## Decision record

1. Options submenu was rejected because it removed direct access.
2. Guided Git adjacency was rejected because the crowded action row increased accidental-click risk.
3. A dedicated normal-flow dock was rejected because it consumed too much vertical space.
4. Final direction: an isolated, labeled overlay dock on the prompt frame that contributes zero layout height.

## Independent review record

Final compact-overlay run: `6bd33b19-6510-43eb-9e9a-f51bf90790fe`

| Reviewer | Provider family | Result | Disposition |
|---|---|---|---|
| Zero-height layout correctness | OpenRouter / Moonshot | Approved, no blockers | Accepted approval |
| Zero-height UX, responsiveness, and tests | Anthropic / Claude | Approved, no blockers | Accepted approval |

Historical superseded reviews:

- `f720c897-1781-46e2-bd79-c91a6acc8f47` — submenu interpretation.
- `f0cadf9d-8fea-43c0-8e04-b96ee326af7a` — Guided Git adjacency interpretation.
- `3ef93736-95e6-48c8-9f22-5bf5a40b79b8` — normal-flow dock interpretation.

## Finding dispositions

- **Accepted and fixed — keyboard-hidden prompt gutter.** Prompt text reservation is now gated by `body:not(.mobile-keyboard-open)`, so hiding the dock for mobile typing also releases its right padding.
- **Accepted and fixed — context-tag collision risk.** Added desktop and compact-mobile max-width reservations for `.composer-context-tags` while the dock is visible.
- **Accepted and fixed — mobile restore overhang.** Reduced the restore badge’s mobile top/right overhang to `-0.2rem` so it does not poke above the compact composer.
- **Accepted and fixed — thin text reservation margin.** Increased desktop prompt reservation to `min(11.5rem, 40%)`.
- **Accepted as intentional — compact target.** The isolated 2.25rem target exceeds the WCAG 24px minimum, stays separated from crowded controls, and avoids reclaiming the vertical space removed by this refinement.
- **Deferred — full static-suite typography failure.** The `0.72rem` declaration exists at `HEAD` and is unrelated to this placement change.

## Outcome

Workflow Mode is one click away in a compact overlay dock on the prompt frame. The dock contributes zero layout height, remains isolated from the action row, reserves horizontal space from prompt text and context tags, compacts on mobile, and disappears while typing with the software keyboard. State, accessibility, floating tooltips, and overlay restore behavior remain intact. Both provider-diverse reviewers approved the final implementation.

## Residual validation gap

No live browser rendering has been run after the screenshot-driven compaction. Static geometry, overlap prevention, mobile behavior, tooltips, ARIA, and focus contracts are covered by focused assertions and code inspection.
