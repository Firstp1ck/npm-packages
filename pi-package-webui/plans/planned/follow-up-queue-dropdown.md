# Follow-up queue dropdown implementation plan

## Goal

Move queued follow-up prompts out of the sticky last/current-prompt preview and into a collapsible, non-modal overlay above the composer. Make every pending follow-up editable by default and reorderable with drag-and-drop plus keyboard/touch-accessible move controls.

## Approved product decisions

- The overlay floats above the composer and never changes transcript/composer layout.
- It is non-modal: only the overlay itself captures interaction; outside click and `Escape` collapse it.
- Queued follow-up text is shown in editable textareas by default.
- Edits save on blur or `Ctrl/Cmd+Enter`; `Escape` restores the authoritative server value.
- Drag/drop persists ordering immediately. Move Up/Down controls provide keyboard and touch parity.
- Both Pi-runtime and WebUI compaction-held follow-ups are supported through source-specific atomic mutation paths.
- The existing Control Deck Queue section remains available as a canonical queue overview.
- Steering prompts are visible in the Control Deck but are not editable/reorderable in this feature.

## Existing constraints

- `public/app.js`, `public/index.html`, and `public/styles.css` already contain unrelated, uncommitted file-viewer work. Queue edits must be narrow and preserve those hunks.
- Pi exposes no public item-level queue mutation API. Runtime mutation therefore needs guarded access to the same paired private arrays already used by `queue-remove`.
- Runtime queue events and WebUI compaction queue events currently share one browser rendering path and need explicit source metadata.
- The installed `node_modules` Pi version may be stale relative to `package-lock.json`; private-layout capability checks must fail closed.

## Workstream B1 — atomic queue mutation backend

**Owner / write boundary**

- `webui-rpc-helper.mjs`
- `bin/pi-webui.mjs`
- Backend-focused tests and fake-Pi harness updates only

**Deliverables**

1. Add a `queue-mutate` helper action for Pi-runtime follow-ups.
2. Require `source`, `kind`, complete expected `steering`/`followUp` arrays, and an operation-specific expected target.
3. Validate tracking arrays and underlying agent queue messages before any assignment.
4. Implement synchronous atomic operations:
   - `edit`: update exactly one text part while preserving role, timestamp, images, and other content.
   - `move`: apply the same final-index permutation to tracking strings and message objects.
5. Emit exactly one queue update on success and none on stale/invalid/desynchronized input.
6. Add `/api/queue/mutate` with bounded body parsing and HTTP `409` for authoritative stale conflicts.
7. Decorate runtime snapshots with `source: "pi-runtime"`.
8. Add a source-specific compaction mutation path:
   - maintain a monotonic compaction queue revision;
   - expose `source: "webui-compaction"`, revision, and draining state;
   - reject while draining or when the revision/full snapshot is stale;
   - edit a follow-up item in place, preserving images/command metadata;
   - reorder follow-up items among the existing follow-up slots, leaving steering slots fixed;
   - broadcast one authoritative compaction queue update after success.
9. Preserve `/api/queue/remove` compatibility while preventing source confusion in the new surface.

**Backend seam contract**

Request:

```json
{
  "source": "pi-runtime | webui-compaction",
  "kind": "followUp",
  "expected": { "steering": [], "followUp": [] },
  "revision": 0,
  "operation": {
    "type": "edit | move",
    "index": 0,
    "from": 0,
    "to": 1,
    "expectedText": "old",
    "text": "new"
  }
}
```

`to` is the final zero-based index after removal. `revision` is required for compaction source and omitted for runtime source.

Success returns HTTP 200 with `{ mutated: true, source, queue }`. Stale or draining conflicts return HTTP 409 with `{ mutated: false, reason, queue }`; the returned queue is authoritative.

## Workstream F1 — composer dropdown and editable ordering UI

**Prerequisite**

- B1 seam implemented and focused backend tests green.

**Owner / write boundary**

- Queue-specific regions of `public/index.html`, `public/app.js`, and `public/styles.css`
- Frontend-focused tests only
- Do not modify existing file-viewer search/selection logic or tests

**Deliverables**

1. Remove the `Next follow-up` row and queue-derived title/ARIA text from the sticky last/current prompt control.
2. Add a composer-adjacent follow-up queue trigger above the main input with count and collapse state.
3. Add a sibling overlay panel positioned upward from the composer so opening it causes no layout shift.
4. Render active-tab follow-ups from `latestQueuedMessagesByTab` without maintaining a second queue model.
5. Render editable textareas immediately; save on blur or `Ctrl/Cmd+Enter`, restore on `Escape`.
6. Add drag handles and native drag/drop ordering, with composer file-drop isolation.
7. Add Move Up/Down buttons, disabled at list boundaries, and an `aria-live` status for reorder/save/conflict results.
8. Disable mutation controls while a request is in flight.
9. On HTTP 409, replace the cached/rendered snapshot with the returned authoritative queue and announce the conflict.
10. Capture the tab context before every async mutation; late responses must not repaint another active tab.
11. Integrate with mutual dropdown closure, outside click, `Escape`, focus return, tab switching, pointer-render deferral, mobile keyboard mode, viewport max-height, and reduced-motion behavior.
12. Keep the Control Deck Queue section working. Gate its existing remove control to Pi-runtime snapshots so compaction events cannot remove a same-text runtime item.

## Validation contract

### Static and unit checks

- Syntax checks for all changed JavaScript modules.
- Runtime mutation tests prove paired-array atomicity, stale rejection, duplicate safety, image/metadata preservation, one-event success, and zero-event failure.
- Compaction mutation tests prove revision conflicts, draining rejection, edit preservation, and follow-up-slot reordering.
- Frontend tests prove source retention, exact mutation payloads, active-tab isolation, conflict refresh, editable-by-default rows, overlay semantics, sticky-preview removal, accessible move controls, and DnD isolation.
- Existing mobile/static and compaction tests are updated only where the old sticky preview contract changes.

### User-flow checks

1. Queue one follow-up: trigger appears above the input; opening it does not move the composer or transcript.
2. Edit the textarea and blur: only that queued prompt changes.
3. Press `Escape` while editing: unsaved text restores; press `Escape` again: dropdown closes and focus returns to its trigger.
4. Queue multiple follow-ups: drag the last to first; displayed order and delivery order update.
5. Use Move Up/Down with keyboard and touch-sized controls; announcements describe the new position.
6. Switch tabs during an in-flight save: the response does not repaint the newly active tab.
7. Trigger a stale conflict: no wrong item changes and authoritative state replaces the draft.
8. Repeat edit/reorder while compaction owns the queue; operations persist before drain and are rejected once draining begins.
9. Verify mobile keyboard mode keeps the trigger/panel usable and bounds the overlay to the visual viewport.
10. Verify composer attachment drag/drop still accepts files and queue-row drag events do not add attachments.

### Commands

```bash
node --check webui-rpc-helper.mjs
node --check bin/pi-webui.mjs
node --check public/app.js
node tests/queue-mutation-contract.test.mjs
node tests/queue-edit-reorder-static.test.mjs
node tests/compaction-static.test.mjs
node tests/compaction-resume-harness.test.mjs
node tests/http-endpoints-harness.test.mjs
npm test
npm run check
```

A clean dependency install against the lockfile is desirable before release, but must not overwrite or normalize the user's current dirty worktree. If it is deferred, disclose the installed/locked Pi-version mismatch as a residual risk.

## Integration order

1. Capture the current dirty baseline and verify no staged changes.
2. Complete B1 and inspect its diff for write-boundary compliance.
3. Run backend-focused checks.
4. Complete F1 against the backend seam and inspect its diff for write-boundary compliance.
5. Run focused and full validation.
6. Run independent correctness and UX/accessibility review on the integrated diff.
7. Parent dispositions every finding; apply only accepted fixes through a sequential worker pass when required.
8. Re-run affected tests and inspect the final diff.
9. Generate a self-contained HTML implementation report.

## Rollback

- Frontend rollback removes the queue trigger/panel and restores only the sticky preview markup/tests; the Control Deck remains intact.
- Backend rollback removes `/api/queue/mutate`, `queue-mutate`, and compaction revision mutation while preserving existing enqueue/drain and `/api/queue/remove` behavior.
- No persisted data migration is introduced. Queue mutations affect only currently pending in-memory prompts.

## Stop/escalation rules

Stop rather than guessing if:

- the installed/locked Pi runtime lacks the private queue structures or command-session capture hook;
- mutation cannot preserve non-text/image content exactly;
- compaction has begun draining before a requested mutation;
- a worker would need to rewrite unrelated dirty file-viewer hunks;
- validation reveals a product decision outside the approved interaction contract.
