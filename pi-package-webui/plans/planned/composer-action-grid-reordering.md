# Composer action grid reordering

## Classification

**Lightweight feature.** The change is confined to the existing browser composer action bar (`public/index.html`, `public/styles.css`, and `public/app.js`), uses existing browser storage and pointer-event conventions, and does not cross a server/API contract, require migration or rollout work, or introduce material security or reliability risk.

## Outcome

Desktop users can drag the bottom composer actions into their preferred order. The order persists in browser storage and is restored across reloads and synchronized across open tabs.

## Scope and assumptions

- Use the existing dependency-free pointer-drag convention; do not add a drag-and-drop dependency.
- Use a 24-column desktop grid. Icon actions and **New** span one cell; **Compact** and **Send** span two cells.
- Preserve the existing mobile action-panel layout. Pointer and Alt+Arrow keyboard reordering are limited to the visible desktop grid.
- Keep newly introduced actions forward-compatible by appending unknown IDs to the stored order.

## Success criteria

- Every reorderable action has a stable ID and grid span.
- Pointer drag reorders visible desktop actions with a clear drag/drop affordance and suppresses accidental clicks.
- Alt+Arrow keys provide keyboard parity and announce the resulting position.
- The complete order is stored under a versioned `localStorage` key, restored on startup, and synchronized through the `storage` event.
- Focused static and Playwright coverage verifies spans, persistence, reload restore, and keyboard reordering.
