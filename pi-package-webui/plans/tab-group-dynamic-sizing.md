# Dynamic Tab-Group Sizing

## Goal

Open terminal tab groups must grow to reveal every tab in the group without an internal group-menu scrollbar.

## Classification

**Lightweight feature.** The change is one CSS behavior adjustment plus static regression coverage. It does not change JavaScript, persisted state, interfaces, dependencies, security boundaries, migrations, or deployment behavior. Repository inspection confirmed that the existing menu, ancestor overflow, left-sidebar, and mobile rules already support content-driven growth.

## Scope

- Change the base `.terminal-tab-group-menu` from a capped scroll container to content-driven sizing.
- Preserve desktop dropdown, dense-strip, left-sidebar flyout, mobile inline expansion, keyboard focus, and ARIA behavior.
- Add static contracts for uncapped menu growth and ancestor anti-clipping behavior.

### Non-goals

- Redesign tab grouping or drag-and-drop behavior.
- Add JavaScript sizing logic.
- Reintroduce a viewport-height cap or internal scrollbar for extreme group sizes.
- Modify unrelated worktree changes.

## Decisions and invariants

1. Use CSS intrinsic growth: `max-height: none` and `overflow: visible`.
2. Keep the existing absolute desktop/left-sidebar positioning and static mobile positioning.
3. Keep ancestor `overflow: visible` behavior while a group is open so desktop menus are not clipped by the tab strip.
4. Accept that unusually large desktop groups can extend beyond the viewport; adding an internal scrollbar would contradict the requested behavior.

## Success criteria

- [x] A multi-tab group renders all group items at their natural height.
- [x] The group menu does not create its own scrollbar.
- [x] Desktop, dense, left-sidebar, and mobile CSS cascades remain coherent.
- [x] Static tests guard both intrinsic menu growth and the desktop anti-clipping rule.
- [x] The package test suite passes.
- [x] Two independent provider-diverse reviewers report no blockers.

## Implementation map

| File | Change |
|---|---|
| `public/styles.css` | Removed the menu height cap, internal overflow scrolling, and obsolete thin-scrollbar styling. |
| `tests/mobile-static.test.mjs` | Added a rule-bounded intrinsic-growth assertion, strengthened the ancestor overflow assertion, and updated the add-action expectation wording. |

## Validation

- `node tests/mobile-static.test.mjs` — passed after implementation and after review-driven test hardening.
- `npm test` — all 41 test files passed.
- `git diff --check -- pi-package-webui/public/styles.css pi-package-webui/tests/mobile-static.test.mjs` — passed.
- Live browser rendering was not performed; CSS cascade behavior was inspected statically by the integration owner and both reviewers.

## Independent review quorum

Top-level run: `9e4a5895-db5c-4ebe-99b2-f8803eb7c6b3`

| Reviewer output | Provider / model | Focus | Verdict |
|---|---|---|---|
| Child 0 | Anthropic / `claude-opus-4-8` (high) | Layout correctness, cascade, accessibility, maintainability | Pass; no blockers |
| Child 1 | OpenRouter (Moonshot) / `moonshotai/kimi-k3` (high) | Tests, edge cases, desktop/dense/sidebar/mobile behavior | Pass; no blockers |

The implementation owner used OpenAI Codex, so both reviewer providers were distinct from the implementation provider and from each other.

## Finding dispositions

| Finding | Disposition | Rationale / action |
|---|---|---|
| Very large desktop groups may extend beyond the viewport. | **Accepted as residual risk** | This follows directly from the explicit no-internal-scroll requirement. No change made. |
| The initial static assertion could cross CSS rule boundaries and did not verify ancestor anti-clipping behavior. | **Accepted and fixed** | Replaced broad matching with `[^}]*` and asserted `overflow: visible` in the relevant `:has(...)` block; targeted test passed. |
| Hovering a left-sidebar group can suspend outer sidebar scrolling. | **Deferred** | Pre-existing behavior, not introduced by this change, and outside the approved scope. |

## Rollback

Restore `.terminal-tab-group-menu` to `max-height: min(60vh, 24rem)`, `overflow: auto`, and `scrollbar-width: thin`, then update the static contract. No data or migration rollback is required.

## Report

See [Dynamic Tab-Group Sizing Feature Report](../reports/tab-group-dynamic-sizing.html).
