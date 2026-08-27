# Expandable status overlay

Status: in progress

## Goal

Replace the always-visible status rows below the prompt with one compact control. Opening that control must show every status group, entry label, value, detail, icon, and tone currently supplied by Pi, Git, usage statistics, and extensions.

## Classification

Lightweight feature. The change is one presentation slice in the existing QML shell. It keeps the current `statusGroups` data contract, adds no backend or persisted setting, needs no migration, and has no material security or reliability risk. A direct parent implementation is the smallest safe path because delegated work would add coordination without a separate workstream.

## Screenshot observations

- The prompt and response controls already have clear visual priority.
- The persistent framed status rows consume several lines beneath those controls and pull attention away from the transcript.
- The current rows use the app's flat violet-charcoal palette, thin frames, monospace labels, and rectangular geometry. The replacement should keep those relationships.
- The screenshot does not establish keyboard behavior, long-value handling, narrow-window layout, light mode, or reduced motion. Existing project components and tokens own those decisions.

## Scope and decisions

- Add a compact `Status` control to the response-control strip. Show the total entry count and indicate the open state.
- Open a non-modal, focusable drop-up inside `contentRoot`. Escape and outside clicks close it, then focus returns to the trigger.
- Use a scrollable vertical structure: panel heading, summary, named groups, and full-width entries.
- Show entry labels and values without elision. Show optional detail text directly instead of hiding it in a tooltip.
- Keep icons and semantic error, warning, success, and normal value colors.
- Remove the persistent status flow. Do not change status publishing, grouping, or usage calculations.
- Reuse `Theme.qml` tokens and existing popup geometry conventions. Do not add palette literals or decorative effects.

## Success criteria

- No status group remains permanently below the prompt.
- The trigger appears only for an active session with status entries.
- The overlay stays within the main content bounds and has a bounded, scrollable height.
- Every current group and every entry field remains visible when expanded, including long values and optional details.
- Pointer and keyboard activation work. Escape and outside clicks close the overlay, and focus returns to the trigger.
- Static QML contracts, `qmllint`, focused package checks, Markdown diff checks, and a live smoke run pass or any unavailable check is reported.

## Expected files

- `qml/components/StatusOverlay.qml`
- `qml/shell.qml`
- `tests/qml-contract.test.mjs`
- `DEVELOPMENT.md`

## Non-goals

- Backend status changes
- New settings or persistence
- Status editing, filtering, or search
- Changes to model, thinking, compaction, or transcript-density controls
