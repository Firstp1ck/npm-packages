# Qt WebUI architecture review remediation plan

Status: planned

Source review: [Qt WebUI improvement review](../reviews/qt-webui-architecture-review.md)

Related roadmap: [Qt WebUI architecture refactor](qt-webui-architecture-refactor.md)

## Goal

Resolve findings F01 through F16 from the architecture review, restore a trustworthy passing baseline, and make the corrected ownership and resource-bound contracts the starting point for the existing architecture refactor.

This plan is a remediation plan, not a second architecture roadmap. It comes before step 1 of `qt-webui-architecture-refactor.md`. It may establish narrow boundaries that the refactor later extracts, but it does not introduce the full protocol registry, revisioned projection system, per-tab actor model, or shared headless package.

## Completion criteria

The work is complete when:

- every finding F01 through F16 has a repository regression test at the evidence level required by the review;
- all P1 correctness defects are fixed before broad code movement begins;
- backend and QML state transitions preserve the final owner, user text, and committed state under delayed or rejected operations;
- process cleanup, framing, queues, stores, catalogs, and snapshot loads have end-to-end bounds;
- `npm run check`, QML lint, package inventory, documentation checks, and required live smoke scenarios pass;
- the passing baseline and any remaining platform-only skips are recorded in this file;
- the existing architecture refactor is amended only if a remediation change alters one of its assumptions.

## Scope

### Included

- Backend lifecycle, process-group cleanup, tab/session ownership, session synchronization, stores, transport pressure, catalog scans, persisted snapshot loading, and attachments.
- QML prompt submission, drafts, session replacement, selected-tab projection, extension dialogs, transcript search, and completion.
- Test harness changes required to make the package baseline trustworthy.
- Protocol and user documentation changes caused by corrected request shapes, limits, or failure behavior.

### Excluded

- Replacing Quickshell, Node, JSONL, or the one-Pi-child-per-tab topology.
- A broad split of `main.mjs`, `pi-session.mjs`, `BackendBridge.qml`, or `shell.qml` before the defects are fixed.
- The complete backend-owned revision system and tab actor described by the architecture refactor.
- Cross-window session ownership. F09 enforces uniqueness within one backend. It does not coordinate separate Qt WebUI windows or external Pi processes.
- Guarantees for tool processes that deliberately leave the Pi-owned process group.
- Publication or dependency extraction into a new package.

## Required invariants

Keep these rules true in every change:

1. One component owns each state transition. Observers see state only after the owner has committed the transition.
2. A response may settle its own operation, but it may not overwrite a newer selected-view identity.
3. User-authored text is not destroyed until the backend has definitely accepted the operation. A timeout is an unknown outcome, not a rejection or permission to resend.
4. A mutation is reported as successful only when its result can cross the real framing path. Definite local or backend rejection leaves durable and in-memory state unchanged.
5. Each canonical session identity has at most one current or reserved owner in a backend.
6. Ordinary work cannot block abort, shutdown, fatal cleanup, or process-tree cleanup.
7. Every queue, scan, cache, file read, temporary transfer, and retry loop has a named bound and an observable failure mode.
8. Existing path confinement, permissions, rollback distinctions, unknown-key preservation, and protocol version 1 compatibility remain unless a reviewed change replaces them.
9. Tests isolate XDG state, Pi WebUI settings, session roots, process groups, and D-Bus. They must not touch the developer's files or services.
10. Each implementation change is small enough to review and leaves focused tests green. Do not mix unrelated findings merely because they touch the same large file.

## Delivery order

| Phase | Findings | Gate |
| --- | --- | --- |
| 0. Repair the gate | F16, F01 | The full runner finishes and the known crash is gone. |
| 1. Protect user intent | F02, F03, F07, F15 | Drafts, answers, and completion choices survive stale, rejected, and delayed work. |
| 2. Make view and process ownership explicit | F04, F05 | Final selection owns the view and exited Pi groups are swept before replacement. |
| 3. Bound attachment transactions | F06 | Every accepted attachment operation has a representable request, response, and snapshot. |
| 4. Serialize session identity changes | F08, F09 | Lifecycle mutations reserve one tab and one canonical session identity before awaiting. |
| 5. Bound shared resources and discovery | F10, F11, F12, F13 | Concurrent stores, output producers, catalogs, and snapshot loads have tested ceilings. |
| 6. Track transcript changes in search | F14 | Search follows real row mutations in a QML behavioral test. |
| 7. Re-establish the release baseline | all | Full checks pass and the architecture refactor can begin from the corrected contracts. |

Phases are ordered by dependency. Changes within a phase may be prepared independently, but integrate them sequentially because several findings touch `BackendBridge.qml`, `shell.qml`, `main.mjs`, and `tabs.mjs`.

# Phase 0: repair the gate

## 0.1 Fix the invalid-entry lifecycle harness, F16

Primary files:

- `tests/helpers/backend-client.mjs`
- `tests/backend-lifecycle.test.mjs`

Work:

- [ ] Add an explicit `piCliEntry` test option to `startBackend()`. Keep the safe fixture as the default and assign the explicit option after generic environment merging.
- [ ] Do not permit an arbitrary `env` object to silently replace this protected test seam.
- [ ] Register teardown for every spawned backend immediately after creation, before waiting for readiness or exit.
- [ ] Give invalid-entry exit waits a short named bound and include stderr plus recent events in timeout failures.
- [ ] Run the invalid-entry case directly and prove that `relative/pi.js` reaches backend validation instead of starting the fixture.

Acceptance:

- The invalid-entry backend exits with code 64 within the test bound.
- A `backend.fatal` event explains that the Pi entry must be absolute.
- No fixture Pi or descendant remains after the test.
- The lifecycle test cannot hang indefinitely when startup validation regresses.

Focused check:

```bash
node --test --test-name-pattern='missing Pi entry fails fast' tests/backend-lifecycle.test.mjs
```

## 0.2 Commit dialog cancellation state before events, F01

Primary files:

- `lib/backend/pi-session.mjs`
- `lib/backend/tabs.mjs`
- `tests/backend-session.test.mjs`

Work:

- [ ] Capture pending dialog cancellation records without notifying observers.
- [ ] Clear the dialog map and order as one committed state transition.
- [ ] Emit `extension.cancelled` from the captured records only after the state is internally consistent.
- [ ] Keep snapshot construction strict enough to expose future map/order invariant breaks. Do not solve the crash only by filtering missing entries.
- [ ] Cover one and several pending dialogs on spontaneous exit, explicit restart or replacement, and backend shutdown.

Acceptance:

- Event subscribers can call `snapshot()` synchronously for every cancellation and observe no dangling dialog IDs.
- Every pending request emits at most one cancellation.
- Answering a cancelled request returns `stale_request`.
- The backend remains alive after an ordinary Pi exit unless the enclosing lifecycle requires shutdown.

Focused check:

```bash
node --test --test-name-pattern='pending dialogs are cancelled' tests/backend-session.test.mjs
```

## Phase 0 gate

- [ ] Run all lifecycle and backend-session tests with `--test-concurrency=1`.
- [ ] Run `npm run check` once. Record every remaining failure rather than treating the old 300-second timeout as a baseline.
- [ ] Confirm the runner reaches a final summary even if another test fails.

# Phase 1: protect user intent

Create small transition helpers or QML controller objects when that makes the behavior directly testable. Do not start the broad QML module split from the architecture roadmap in this phase.

## 1.1 Add a prompt submission lifecycle, F02

Primary files:

- `qml/BackendBridge.qml`
- `qml/shell.qml`
- `qml/components/Composer.qml` if submission state belongs at the editor boundary
- `qml/SmokeDriver.qml`
- `tests/qml-contract.test.mjs`
- `tests/qml-smoke.test.mjs`
- `tests/backend-session.test.mjs`

Required states:

```text
idle -> admitted -> accepted
                  -> rejected
                  -> unknown
```

Work:

- [ ] Make `sendPrompt()` distinguish local admission from backend acceptance. An empty request ID is a definite local rejection.
- [ ] Record the request ID, origin tab, session generation, draft key, submitted text, mode, and attachment IDs for every admitted submission.
- [ ] Add a settlement hook that runs for the originating submission even after a tab change. Keep view-specific callbacks guarded by the active tab.
- [ ] Clear the composer and saved draft only after an accepted response, and only when the current draft key and editor value still match the submitted version.
- [ ] On `busy`, `not_ready`, `not_running`, `limit_exceeded`, `invalid_request`, or `pi_error`, retain or restore the submitted text without overwriting newer edits.
- [ ] On timeout, mark the outcome unknown, preserve the text, and do not resend automatically.
- [ ] Ignore a late response only when a newer generation has superseded the operation. Still settle the original submission record.
- [ ] Keep prompt transcript semantics unchanged. Do not use the presence of `message.user` as proof of Pi acceptance.

Acceptance:

- Client request saturation, backend `busy`, Pi rejection, delayed acceptance, timeout, tab change, and backend restart preserve recoverable text.
- A late success cannot clear text typed after submission.
- An accepted request is sent once.
- Draft persistence follows the same accepted/rejected result as the visible editor.

## 1.2 Make in-place session replacement a composer transaction, F03

Primary files:

- `qml/shell.qml`
- `qml/BackendBridge.qml`
- `qml/SmokeDriver.qml`
- `tests/qml-contract.test.mjs`
- `tests/qml-smoke.test.mjs`

Work:

- [ ] Separate a committed session replacement from a draft-key change caused by the first durable filename of a new session.
- [ ] Before a committed A to B replacement, stop the 600 ms debounce and save A under A's key.
- [ ] After the replacement commits, install B's session identity, clear the editor, and restore B only if the replacement generation is still current.
- [ ] Leave A's editor and timer state intact when replacement is cancelled or rejected.
- [ ] When an unsaved session acquires its first durable filename, move or resave its current draft under the durable key without clearing it.
- [ ] Prevent an old timer callback from writing A's text under B's key.

Acceptance:

- A and B retain separate drafts across switch, new-session, cancellation, delayed responses, and edits made inside the debounce window.
- Promoting a workspace draft to a new durable session key preserves the visible text.
- Repeated A to B to A transitions cannot restore a stale intermediate draft.

## 1.3 Keep extension dialogs open until settlement, F07

Primary files:

- `qml/dialogs/ExtensionDialog.qml`
- `qml/BackendBridge.qml`
- `lib/backend/protocol.mjs`
- `tests/qml-contract.test.mjs`
- `tests/qml-smoke.test.mjs`
- `tests/backend-session.test.mjs`

Required states:

```text
open -> submitting -> accepted -> closed
                   -> rejected -> open
                   -> unknown
open/submitting/unknown -> cancelled -> closed
```

Work:

- [ ] Expose the backend's 16,384-character answer limit to the dialog and validate before request admission.
- [ ] Replace the pre-acknowledgement `answered` flag with explicit submitting and settlement state.
- [ ] Keep the entered value while submitting and after definite rejection.
- [ ] Close on accepted response, `stale_request`, `extension.answered`, or `extension.cancelled`.
- [ ] Treat timeout as unknown. Preserve the value and do not issue a second answer automatically.
- [ ] Ensure the settlement path still runs when selection changes and suppresses ordinary view callbacks.
- [ ] Keep exactly-once signal and popup behavior for terminal outcomes.

Acceptance:

- Boundary values, local admission failure, `invalid_request`, cancellation, timeout, late success, and a tab change retain the correct text and terminal state.
- A definite rejection leaves a still-pending dialog actionable.
- A terminal dialog does not reopen.
- Backend acceptance is described as backend acceptance, not proof that Pi processed the answer.

## 1.4 Bind completion choices to their query, F15

Primary files:

- `qml/components/Composer.qml`
- `qml/shell.qml`
- `tests/qml-contract.test.mjs`
- `qml/SmokeDriver.qml`
- `tests/qml-smoke.test.mjs`

Work:

- [ ] Give each result set an identity containing completion kind, exact token/query, and generation.
- [ ] Invalidate selectable results synchronously when the token, query, kind, or cursor context changes. Do not wait for the debounce.
- [ ] Keep loading separate from result availability.
- [ ] Make Tab and Enter consume input while a current completion is loading, without accepting an old result or sending the prompt.
- [ ] Retain stale-response rejection for delayed backend replies.

Acceptance:

- Query and kind changes, delayed replies, dismissal, and Tab or Enter before completion never insert an earlier result.
- Clearing old results during loading never sends the composer text by accident.

## Phase 1 gate

- [ ] Add behavioral tests for the transition helpers. Structural regular-expression assertions alone are not sufficient.
- [ ] Run focused backend, QML contract, and QML smoke tests.
- [ ] Verify that every timeout path preserves text and never schedules an automatic retry.

# Phase 2: make view and process ownership explicit

## 2.1 Make selection events authoritative, F04

Primary files:

- `lib/backend/main.mjs`
- `lib/backend/tabs.mjs`
- `qml/BackendBridge.qml`
- `tests/backend-tabs.test.mjs`
- `tests/qml-contract.test.mjs`
- `qml/SmokeDriver.qml`
- `tests/qml-smoke.test.mjs`

Contract:

- The backend increments a selection generation whenever selected-tab identity commits.
- `tabs.update`, transcript replay records, and selection snapshots carry that generation.
- Only selection events may change selected-view identity.
- A response settles its request and may fill the view only when both tab ID and selection generation still match.

Work:

- [ ] Add the committed selection generation to tab summaries and every replay associated with a selection.
- [ ] Stop `applySnapshot()` from calling `beginTabSwitch()`.
- [ ] Split snapshot handling into request settlement and guarded projection application.
- [ ] Reject all session, runtime, attachment, dialog, and transcript fields from an obsolete selection before mutating any QML state.
- [ ] Record the requested target and generation in the pending `tab_select` operation. Do not reuse the previously active tab as its origin.
- [ ] Cover close and empty-selection transitions with the same generation contract.

Acceptance:

- Batched A to B, A to B to A, delayed response, same-tab revisit, and intervening close scenarios end with the final selection's transcript and session state.
- No stale snapshot can clear or partially replace the current transcript, attachments, runtime, or dialogs.
- Duplicate current-generation snapshots are idempotent.

## 2.2 Sweep process groups after spontaneous Pi exit, F05

Primary files:

- `lib/backend/pi-session.mjs`
- `lib/backend/process-tree.mjs`
- `tests/fixtures/fake-pi-rpc.mjs`
- `tests/backend-lifecycle.test.mjs`

Work:

- [ ] Keep an immutable process-owner record containing the leader, process-group identity, and cleanup promise until cleanup finishes.
- [ ] Route explicit stop, restart, startup failure, and spontaneous exit through one idempotent cleanup operation.
- [ ] After leader exit, sweep the retained group and wait through the existing bounded escalation path.
- [ ] Delay automatic replacement startup until the previous owner's cleanup promise settles.
- [ ] Prevent an old exit listener from clearing or killing a newer owner.
- [ ] Keep fatal `killNow` and backend shutdown independent of ordinary session work.

Acceptance:

- Killing only the fixture Pi leader causes its same-group tool child to terminate within the shutdown bound.
- The backend remains usable and starts at most one replacement after cleanup.
- Explicit restart still starts the new child only after the old tree is gone.
- Repeated exit and stop notifications are idempotent.

## Phase 2 gate

- [ ] Run tab, session, lifecycle, QML contract, and live QML tab-switch smoke tests.
- [ ] Capture PIDs in failure output so leaked descendants can be cleaned and diagnosed.

# Phase 3: bound attachment transactions

## 3.1 Define one attachment wire contract, F06

Primary files:

- `lib/backend/attachments.mjs`
- `lib/backend/protocol.mjs`
- `lib/backend/main.mjs`
- `qml/BackendBridge.qml`
- `qml/shell.qml`
- `qml/dialogs/TextEditDialog.qml`
- `tests/backend-composer.test.mjs`
- `tests/backend-tabs.test.mjs`
- `tests/qml-contract.test.mjs`
- `qml/SmokeDriver.qml`
- `tests/qml-smoke.test.mjs`
- `TECHNICAL.md`
- `DEVELOPMENT.md`

Chosen direction:

- Attachment lists and tab snapshots contain bounded metadata only.
- Text content is fetched for one attachment on demand.
- Add and edit operations preflight the exact encoded request or response before state changes.
- `maxTextAttachmentBytes` means UTF-8 source bytes, not JavaScript character count.
- If the complete edit frame does not fit the inbound budget, QML rejects it before submission and keeps the editor open. Do not add chunking unless product requirements later demand support for every byte pattern up to the storage limit.

Work:

- [ ] Define a metadata shape with ID, bounded name, media kind, byte count, edited state, and any prompt-consumption fields the UI needs. Exclude text and image payloads.
- [ ] Add a session-scoped bounded text-read request for the edit dialog. Reject image reads through this request.
- [ ] Calculate UTF-8 and encoded-frame bytes with one tested policy on each side of the bridge.
- [ ] Validate store size, encoded request size, encoded response size, and snapshot size before mutation.
- [ ] Change add, update, remove, prompt consumption, snapshots, and events to return metadata-only lists.
- [ ] Build a complete success frame before committing when a mutation's result still depends on variable-size data.
- [ ] Return a correlated local error for an edit that cannot fit. Do not let the JSONL reader silently discard an admitted request.
- [ ] Preserve the edit text after local or backend rejection. Treat a timeout after admission as an unknown outcome and refresh metadata before another mutation.
- [ ] Keep attachment count, workspace confinement, symlink checks, MIME signature checks, exact-once consumption, and image limits unchanged.

Acceptance:

- Three maximum-size text attachments produce representable add results and tab snapshots.
- ASCII, multibyte, quotes, backslashes, control characters, and boundary-minus-one/boundary/boundary-plus-one edits are accepted or rejected before submission according to the documented wire rule.
- Definite size rejection leaves the attachment store unchanged.
- Add, edit, remove, prompt consumption, tab selection, and hello pass through the actual JSONL framing code without post-commit `limit_exceeded` replacement.
- QML can edit a fetched text attachment without storing all attachment contents in the selected-tab projection.

## Phase 3 gate

- [ ] Run composer, tabs, session, QML contract, QML smoke, docs contract, and package contract tests.
- [ ] Search protocol docs and tests for stale claims that attachment lists contain full text.
- [ ] Confirm the package still uses protocol version 1 only if the change is additive and old required field meanings remain compatible. Otherwise stop for a protocol-version review.

# Phase 4: serialize session identity changes

## 4.1 Reserve tab mutations before awaiting, F08

Primary files:

- `lib/backend/main.mjs`
- `lib/backend/tabs.mjs`
- `lib/backend/pi-session.mjs`
- `lib/backend/session-sync.mjs`
- `tests/session-sync-integration.test.mjs`
- `tests/backend-tabs.test.mjs`
- `tests/backend-session.test.mjs`

Work:

- [ ] Introduce one synchronous per-tab mutation reservation used by explicit session replacement, automatic startup resume, stale rebind, restart, and resource operations that change session state.
- [ ] Make reservation visible to busy checks in the same event-loop turn, before any Pi or history await.
- [ ] Coalesce compatible stale preparation behind one promise. Reject incompatible work with the existing public error contract.
- [ ] Recheck tab generation, session identity, stale revision, run state, and ownership immediately before commit.
- [ ] Release reservations in `finally` and trigger deferred synchronization afterward.
- [ ] Keep abort, shutdown, fatal cleanup, and direct process controls outside the ordinary reservation queue.

Acceptance:

- Barrier tests hold automatic resume and stale rebind at each await, then submit prompt, switch, new-session, restart, and resource requests.
- No incompatible Pi commands overlap.
- Older history cannot overwrite a newer transcript.
- Busy state becomes observable before the next asynchronous turn.
- Cancellation and thrown errors release the reservation exactly once.

## 4.2 Enforce one canonical session owner, F09

Primary files:

- `lib/backend/tabs.mjs`
- `lib/backend/sessions-index.mjs`
- `lib/backend/main.mjs`
- `tests/backend-tabs.test.mjs`
- `tests/session-sync-integration.test.mjs`

Chosen direction:

- Maintain a backend-private index from canonical `managedSessionPath().identity` to the tab that currently owns or has reserved that identity.
- `tab_open` reuses and selects an existing owner.
- `session_switch` rejects a target owned or reserved by another tab with a bounded `busy` response that identifies the owning tab through existing safe summary fields.

Work:

- [ ] Reserve canonical identity synchronously before resume or switch awaits.
- [ ] Include current paths, startup resumes, stale rebinds, and explicit transition targets in the ownership index.
- [ ] Resolve symlink aliases and alternate path spellings through `managedSessionPath()` before lookup.
- [ ] Move the reservation atomically from old identity to new identity only when replacement commits.
- [ ] Release failed, cancelled, closed, and superseded reservations without dropping a current owner.
- [ ] Make session synchronization route revisions to the indexed owner and acknowledge only after that owner accepts or deliberately defers the revision.

Acceptance:

- Direct paths and symlink aliases cannot produce duplicate owners.
- Active-owner plus idle-owner attempts follow the same rule.
- Concurrent opens and switches have one winner and no leaked reservation.
- Closing the owner permits a later tab to acquire the identity.
- Ownership details do not expose private canonical identity values to QML.

## Phase 4 gate

- [ ] Run deterministic session-sync, backend-tabs, backend-session, resource transaction, restart, and close tests.
- [ ] Document the reservation and canonical-owner contracts in `DEVELOPMENT.md`.
- [ ] Compare the resulting boundary with step 3 of the architecture refactor. Amend that plan only where the new verified contract changes its assumptions.

# Phase 5: bound shared resources and discovery

## 5.1 Make Qt-owned document updates cross-process safe, F10

Primary files:

- `lib/backend/store.mjs`
- `lib/backend/settings.mjs`
- `lib/backend/state.mjs`
- `lib/backend/sequences.mjs`
- Qt-owned resource storage in `lib/backend/resources.mjs`
- focused store tests in `tests/backend-units.test.mjs` and feature suites

Work:

- [ ] Inventory every Qt-owned document and every read, modify, write caller. Classify files as shared between windows or intentionally per-window.
- [ ] Keep current layouts, drafts, settings, sequences, and Qt sampling shared unless a separate user-facing design approves per-window identities.
- [ ] Add a bounded cross-process update primitive that acquires a file-specific lock, reads the latest valid snapshot, applies one synchronous mutation, validates it, and atomically replaces the document.
- [ ] Preserve 0700 directories, 0600 files, unknown keys, atomic replacement, and existing malformed-file behavior.
- [ ] Define lock acquisition timeout, retry cadence, owner metadata, stale-owner detection, and owner-only release.
- [ ] Move callers away from separate `read()` plus `write()` transactions. A lock around only `write()` does not prevent lost updates.
- [ ] Keep lock files and temporary files out of packed user data and clean them after normal completion.

Acceptance:

- Two child processes preserve independent sequence, sampling, settings, draft, and layout mutations against one isolated store.
- Lock timeout returns a bounded actionable error without modifying the document.
- A stale lock from a confirmed dead owner recovers safely.
- A live slow owner is not mistaken for a stale owner.
- Crash and partial-write tests retain the last valid document.

## 5.2 Apply output pressure to all producers, F11

Primary files:

- `lib/backend/main.mjs`
- `lib/backend/pi-session.mjs`
- `lib/backend/jsonl.mjs`
- `tests/backend-session.test.mjs`
- `tests/backend-lifecycle.test.mjs`

Work:

- [ ] Inventory every output producer, including Pi stdout, Pi stderr, backend stdin requests, timers, filesystem monitors, helper completions, and shutdown diagnostics.
- [ ] Make transport pressure a shared admission signal. Pause readable producers where safe and reject or defer new ordinary work before it can create another essential response.
- [ ] Reserve a small named control budget for shutdown and fatal diagnostics.
- [ ] Bound already-admitted request work and essential records by count and bytes.
- [ ] Add a drain deadline. If lossless delivery cannot recover within that deadline, enter one controlled slow-consumer shutdown path instead of growing memory or dropping essential records.
- [ ] Keep coalescable streaming records droppable under the current policy and report drops after recovery.
- [ ] Expose current and peak queue, producer pause, admitted work, and slow-consumer shutdown counters in diagnostics.

Acceptance:

- A stalled consumer under sustained Pi stderr and request traffic stays below the documented queue and admitted-work ceiling.
- Drain resumes all paused producers without losing accepted essential records.
- Control shutdown remains available under pressure.
- A consumer that never drains exits through the documented bounded path.
- RSS and queue peaks are measured in the stress test and included in assertion failures.

## 5.3 Replace live-offset catalog paging with a stable bounded scan, F12

Primary files:

- `lib/backend/sessions-index.mjs`
- `lib/backend/protocol.mjs`
- `lib/backend/main.mjs`
- `qml/BackendBridge.qml`
- `tests/backend-tabs.test.mjs`
- `tests/qml-contract.test.mjs`
- `TECHNICAL.md`
- `DEVELOPMENT.md`

Contract:

- The first all-sessions request starts or joins one bounded scan and returns an opaque cursor plus the first page.
- Later pages read the same immutable scan result.
- Filesystem invalidation starts a new generation but does not mutate an in-progress result.
- QML keeps the old complete catalog until a new complete bounded pass succeeds.

Work:

- [ ] Add named limits for visited candidates, retained rows, retained bytes, concurrent scans, cursor lifetime, scan deadline, and cache entries.
- [ ] Enumerate each candidate at most once per scan and cache only bounded metadata keyed by file revision.
- [ ] Return `truncated`, `omitted`, or equivalent bounded status when discovery reaches a limit.
- [ ] Reject expired or invalid cursors with `stale_request`; QML then starts a fresh generation.
- [ ] Cancel or supersede obsolete client pagination without partially replacing the visible catalog.
- [ ] Remove client accumulation beyond the backend's declared total retention budget.
- [ ] Keep canonical path deduplication, settlement, open-tab association, and project-trust boundaries.

Acceptance:

- Mutating recency between page one and page two cannot omit or duplicate a row in that scan.
- Large synthetic catalogs demonstrate bounded files visited, memory, cache size, and wall time.
- Repeated pages do not rescan the candidate tree.
- Cursor expiry, filesystem invalidation, cancellation, and backend restart preserve the last complete client catalog until replacement succeeds.

## 5.4 Bound persisted snapshot input and concurrency, F13

Primary files:

- `lib/backend/session-sync.mjs`
- `lib/backend/main.mjs`
- `lib/backend/protocol.mjs`
- `tests/session-sync.test.mjs`
- `tests/session-sync-integration.test.mjs`
- `TECHNICAL.md`
- `DEVELOPMENT.md`

Work:

- [ ] Add a named maximum snapshot input byte count and aggregate concurrent-load budget.
- [ ] Read through a byte-counting stream or bounded descriptor loop. Do not rely only on `stat` before `readFile`.
- [ ] Reject growth beyond the bound without truncating or modifying the source JSONL.
- [ ] Limit concurrent snapshot loads with a small queue whose length and aggregate reserved bytes are bounded.
- [ ] Apply a total load deadline and cancel obsolete queued work by path revision or ownership generation.
- [ ] Preserve the last complete transcript and emit one coalesced useful notice per path, revision, and error class.
- [ ] Keep Pi's `SessionManager` compaction-aware projection. If an isolated copy remains necessary, create it only after the bounded read and remove it in `finally`.

Acceptance:

- Oversized, growing, malformed, unstable, timed-out, and superseded files leave the source and last valid view unchanged.
- Concurrent oversized files cannot exceed the aggregate reservation.
- A new valid revision retries immediately after an older bounded failure.
- Peak RSS is measured for the oversized-file test.

## Phase 5 gate

- [ ] Run multi-process store tests, slow-consumer stress tests, synthetic catalog tests, and snapshot memory tests separately before the full suite.
- [ ] Verify that every new limit appears once in backend protocol ownership and in advanced user documentation only when users can encounter it.
- [ ] Review lock, cursor, and snapshot temporary files for permissions and guaranteed cleanup.

# Phase 6: track transcript changes in search

## 6.1 Invalidate search by transcript revision, F14

Primary files:

- `qml/BackendBridge.qml`
- `qml/shell.qml`
- the extracted search controller if phase 1 introduced one
- `qml/SmokeDriver.qml`
- `tests/qml-smoke.test.mjs`
- `tests/qml-contract.test.mjs`

Work:

- [ ] Increment a transcript content revision on append, row update, removal, reset, replay, and eviction.
- [ ] Recompute an active query from that revision, with a short coalescing timer for streaming updates.
- [ ] Store the selected match by `rowId`. Derive its current list index after each recomputation.
- [ ] Define fallback selection when the selected row disappears, preferring the next match and then the previous match.
- [ ] Reset revision ownership on tab selection so updates from an inactive tab cannot invalidate the active search.

Acceptance:

- A real QML behavioral test covers append, streaming update, final update, removal, reset, replay, and transcript-cap eviction while the query remains unchanged.
- Search never points at a numeric index whose row no longer matches.
- Streaming coalescing does not miss the final row state.

## Phase 6 gate

- [ ] Run QML lint, QML contract tests, and live QML search smoke tests.
- [ ] Keep static wiring assertions only where they still test a meaningful declaration. Do not use them as substitutes for row-mutation behavior.

# Phase 7: re-establish the release baseline

## 7.1 Documentation and contract reconciliation

- [ ] Update `README.md` only for user-visible setup, safety, or workflow changes.
- [ ] Update `TECHNICAL.md` for user-facing attachment behavior, limits, catalog truncation, lock failures, snapshot fallback, and troubleshooting.
- [ ] Update `DEVELOPMENT.md` for protocol fields, request results, state transitions, reservations, process ownership, locks, pressure policy, cursor behavior, test seams, and failure contracts.
- [ ] Update docs-contract tests after the prose is correct. Do not preserve stale text merely to satisfy a regular expression.
- [ ] Check the existing architecture refactor for assumptions changed by remediation. Keep its four-stage roadmap instead of copying those stages here.
- [ ] Remove or repair links in the refactor plan to review reports that are not retained in the working tree before claiming its review evidence is available.

## 7.2 Required verification

Run from `pi-package-qt-webui` on Linux or WSL with package dependencies installed:

```bash
node --test --test-concurrency=1 \
  tests/backend-lifecycle.test.mjs \
  tests/backend-session.test.mjs \
  tests/backend-tabs.test.mjs \
  tests/backend-composer.test.mjs \
  tests/session-sync.test.mjs \
  tests/session-sync-integration.test.mjs

node --test --test-concurrency=1 \
  tests/qml-contract.test.mjs \
  tests/qml-smoke.test.mjs \
  tests/backend-units.test.mjs \
  tests/package-contract.test.mjs \
  tests/docs-contract.test.mjs

qmllint -I /usr/lib/qt6/qml qml/*.qml qml/components/*.qml qml/dialogs/*.qml
npm run check
npm pack --dry-run --json
```

From the repository root:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Also run live Quickshell scenarios where the environment supports them:

- prompt rejection, delayed acceptance, and timeout without text loss;
- in-place session replacement during the draft debounce window;
- extension-dialog rejection, cancellation, and late settlement;
- rapid A to B to A selection with delayed responses;
- completion query changes followed by Tab and Enter;
- search updates during streaming, removal, reset, and eviction;
- backend restart after a spontaneous Pi leader exit.

## 7.3 Baseline record

Record these values after all gates pass:

| Item | Result |
| --- | --- |
| Revision | Pending |
| Node version | Pending |
| Qt version | Pending |
| Quickshell version | Pending |
| `npm run check` | Pending |
| QML lint | Pending |
| Package inventory | Pending |
| Live smoke scenarios | Pending |
| Platform-only skips | Pending |
| Peak slow-consumer queue and RSS | Pending |
| Peak catalog scan rows, bytes, time, and RSS | Pending |
| Peak snapshot-load bytes and RSS | Pending |

Do not mark the plan complete with `npm run check` incomplete or timed out. Classify every skip and state why it does not weaken a required acceptance check.

# Finding traceability

| Finding | Main implementation package | Required proof |
| --- | --- | --- |
| F01 | 0.2 | Synchronous cancellation snapshots stay consistent. |
| F02 | 1.1 | Rejected and unknown prompts preserve current or recoverable text without duplicate send. |
| F03 | 1.2 | In-place session replacement keeps drafts separated across debounce races. |
| F04 | 2.1 | Final selection owns every selected-view field under reordered responses. |
| F05 | 2.2 | Spontaneous leader exit sweeps the retained process group before restart. |
| F06 | 3.1 | Attachment add, edit, remove, and snapshots fit real frame bounds before commit. |
| F07 | 1.3 | Rejected dialogs remain actionable and terminal dialogs close once. |
| F08 | 4.1 | Resume and stale rebind reserve mutation ownership before awaiting. |
| F09 | 4.2 | Canonical paths and aliases have one backend owner or reservation. |
| F10 | 5.1 | Two processes preserve independent updates through latest-read locked mutation. |
| F11 | 5.2 | Stderr and request traffic cannot exceed the slow-consumer ceiling. |
| F12 | 5.3 | One stable scan survives changes between pages with bounded work and retention. |
| F13 | 5.4 | Oversized and growing snapshots retain the last valid view within memory bounds. |
| F14 | 6.1 | Real QML search follows row mutations and eviction by row ID. |
| F15 | 1.4 | Completion acceptance requires an exact current result identity. |
| F16 | 0.1 | The intended invalid backend starts, exits 64, and leaves no process. |

# Commit and rollback strategy

Prefer one reviewed commit per numbered work package. F02 and F03 may share a transition helper, but keep their tests and acceptance evidence distinct. F08 and F09 may share reservation infrastructure, but land per-tab mutation ownership before canonical cross-tab ownership.

For every commit:

1. Add the smallest failing repository regression test that reproduces the finding.
2. Implement the fix without unrelated extraction.
3. Run focused tests plus syntax or QML lint for touched runtime files.
4. Inspect the process table, temporary files, and isolated stores when the change owns resources.
5. Update user or contributor documentation in the same commit when behavior or protocol changed.
6. Record any changed assumption in this plan.

Rollback is code-only unless a documented migration is introduced. Store and protocol changes must remain backward-readable throughout this plan. If a work package cannot preserve that property, stop and write a separate migration and rollback plan before implementation.

# Risks and stop conditions

- Stop if a proposed fix requires replacing the runtime topology. Return to architecture review rather than hiding the change inside remediation.
- Stop if attachment changes require incompatible protocol semantics that cannot be additive under version 1. Review a protocol version bump first.
- Stop if a store lock cannot distinguish a live owner from a stale owner without unsafe deletion.
- Stop if output pressure can deadlock shutdown or prevent fatal process cleanup.
- Stop if unique session ownership would discard an existing tab without explicit user action. Reject or reuse; never silently steal.
- Stop if catalog or snapshot bounds would silently truncate a Pi history file. Report a bounded fallback and preserve the source.
- Stop if a static QML test is the only evidence for focus, signal, keyboard, dialog, or row-mutation behavior.
- Preserve unrelated working-tree changes and the existing deleted review/handoff files. Do not restore or remove them as part of this plan.

# Handoff to the architecture refactor

After phase 7 passes, update the baseline gate in `qt-webui-architecture-refactor.md` with the recorded revision and results. Start its step 1 only after confirming:

- prompt, dialog, draft, selection, and completion transitions have stable testable interfaces;
- transport extraction will preserve the new all-producer pressure policy;
- session facade extraction will preserve synchronous mutation and canonical identity reservations;
- revisioned state work will extend, not replace, the narrow selection generation introduced for F04;
- actor work will adopt the verified process-owner cleanup contract;
- shared-package work will not bypass the new Qt store transaction rules or duplicate lock ownership.

The corrected behavior is the new baseline. The architecture refactor must move it without weakening its tests.
