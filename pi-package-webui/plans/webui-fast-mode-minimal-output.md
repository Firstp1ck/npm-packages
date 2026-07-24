# WebUI Fast Mode Transient Output

**Classification:** Lightweight correction. The change stays within the existing browser fast-mode renderer, focused tests, cache identity, and user-facing copy. It does not change transport, persistence, inference, or stored transcript semantics.

**Report:** [Final HTML report](../reports/webui-fast-mode-minimal-output.html)

## Goal

When the acknowledged WebUI output mode is `compact-v1`, preserve Markdown formatting for live and reconciled visible thinking and render the final assistant response as Markdown. During execution, show at most the current transient tool status; replace it when a new tool or assistant delta begins, and omit all intermediate tool calls/results after final reconciliation.

## Invariants

- Stored messages and `/api/messages` remain authoritative and unchanged.
- Fast mode changes presentation only; it does not alter prompts, model context, tools, or generation.
- Final assistant text uses the existing Markdown renderer.
- Thinking remains Markdown-formatted and visible when the existing transcript visibility setting is enabled.
- Tool arguments, results, diffs, images, raw details, and historical status rows are omitted in fast mode; current activity uses one compact labeled row with a state pill.
- Normal mode retains the existing rich renderer unchanged.
- Mode remains part of the keyed transcript render epoch.
- Unrelated workflow-overlay and dependency-update edits in the dirty worktree are not part of this correction.

## Implementation

- `public/app.js`
  - Render compact final assistant text with `appendMarkdown` and live thinking with `renderThinkingMarkdown`.
  - Keep only assistant/thinking display parts during compact reconciliation.
  - Exclude direct and live tool rows from compact transcript items.
  - Remove the previous compact tool shell before creating a new one and when new assistant/tool-call deltas arrive.
- `tests/fast-mode-client-static.test.mjs`
  - Guard Markdown rendering, thinking retention, tool-row omission, and single transient shell replacement.
- `public/index.html`, `public/service-worker.js`, and `README.md`
  - Update behavior copy and browser cache identities.

## Validation record

- Focused syntax and fast-mode tests: PASS.
- Deterministic compact transport metric: PASS, ratio `2.927574`; semantic SHA-256 unchanged (`74c47d64…58d10f`).
- Full `npm run check`: 45/46 test files passed. `mobile-static.test.mjs` fails on an unrelated dirty-worktree dependency expectation (`^0.2.1` expected versus `^0.2.2` configured).
- `git diff --check`: PASS.

## Residual limitation

No live browser visual inspection was performed. The rendering and replacement contract is covered by focused static assertions and the existing transport/live-output suites.

## Rollback

Revert the compact transcript renderer/filtering, transient shell replacement, cache-buster changes, copy, and focused assertions as one unit. No data rollback is required.
