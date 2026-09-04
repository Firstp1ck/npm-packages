# Qt WebUI architecture refactor

Status: planned; amended to preserve the remediation contracts

This plan covers the four recommended architecture steps:

1. Split the current implementation into feature-oriented modules without changing its process topology.
2. Make the backend the authoritative state owner and give QML revisioned projections.
3. Give each tab a serialized session actor.
4. Extract stable shared logic into a headless package used by Qt WebUI and Pi WebUI.

The steps are ordered. Each one must leave the package releasable before the next begins. Steps 1 through 3 apply only to Qt WebUI. Step 4 crosses the Qt WebUI and Pi WebUI packages and starts only after the local boundaries have proved stable.

## Goal

Reduce coordination risk without replacing the parts that already work well. Keep the existing Quickshell process, local Node backend, package-local Pi RPC children, bounded JSONL transport, security checks, and process-tree cleanup.

The target architecture has these ownership rules:

- QML owns layout, focus, popup state, selection, scrolling, and other short-lived presentation state.
- The Node backend owns application, tab, session, transcript, resource, and persistence state.
- A tab actor owns all mutable state and operations for one Pi session.
- A cross-tab coordinator owns transactions that affect more than one tab.
- A protocol registry owns request metadata, validation, timeouts, scope, and mutation policy.
- Shared packages contain only stable logic that has no Qt, DOM, HTTP, or process-lifecycle dependency.

## Evidence before remediation

The refactor addresses four concentrated files:

| File | Size at review | Main issue |
| --- | ---: | --- |
| `lib/backend/main.mjs` | 1,218 lines | Transport, routing, synchronization, resource transactions, and lifecycle share one closure. |
| `lib/backend/pi-session.mjs` | 1,493 lines | Pi transport, mutable session state, transcript translation, helper calls, dialogs, and model controls share one owner. |
| `qml/BackendBridge.qml` | 1,816 lines | Backend process control, request correlation, every client action, state projection, catalogs, and event reduction are combined. |
| `qml/shell.qml` | 1,749 lines | Window composition and feature controllers are combined. |

Protocol facts are also repeated across `protocol.mjs`, `main.mjs`, `BackendBridge.qml`, and static QML contract tests. Session facts such as readiness, activity, runtime, queues, dialogs, resources, and errors are represented in both backend and QML mutable state.

## Independent review record

The earlier plan recorded four independent Pi review processes using `openrouter/moonshotai/kimi-k3`, one per step. Those full reports are no longer retained in this working tree. The scores below are historical context, not independently reproducible evidence for the current implementation.

The scores below assess each step as originally written, before the amendments in this revision.

| Step | Changeability | Maintainability | Combined impact | Verdict |
| --- | ---: | ---: | ---: | --- |
| 1 | 7/10 | 7/10 | 7/10 | Revise |
| 2 | 7/10 | 6/10 | 6/10 | Revise |
| 3 | 7/10 | 7/10 | 7/10 | Revise |
| 4 | 7/10 | 6/10 | 6/10 | Revise |

The amendments below accept the reviewers' required findings. Optional suggestions were accepted where they clarify ownership or make a gate testable. Step 4's shared package remains conditional on its audit and explicit storage-ownership decision.

## Constraints

- Preserve the three-level runtime topology: Quickshell, one Node backend, and one Pi RPC child per tab.
- Do not add a network listener.
- Do not change user-visible behavior merely to make a module boundary easier.
- Keep protocol version 1 during structural extraction. Additive revision fields may be introduced under version 1. Removing or changing existing event semantics requires a deliberate protocol version change.
- Keep current bounds, timeouts, path confinement, atomic persistence, and shutdown behavior until a separately reviewed change replaces them.
- Never combine a responsibility move with a behavior rewrite in the same commit or review unit.
- Run release checks on Linux or WSL with package dependencies installed. The package is Linux-only, and its permission, symlink, process, and Wayland tests do not establish a valid baseline on Windows.
- Preserve unrelated working-tree changes.

## Baseline gate

The architecture-review remediation establishes the behavior that extraction must preserve:

- Operation settlement runs for its origin even after selection changes. Prompt and dialog timeouts retain text and never retry automatically; draft cleanup uses revision guards and a locked compare-and-set.
- Backend selection generations fence snapshots and replay. Step 2 must extend that contract rather than reintroducing response-owned selection.
- Session mutation reservations are synchronous and survive awaits. A backend-private canonical identity index includes transitions and closing owners. Actors must adopt these rules before replacing them.
- Process owners survive leader exit until group cleanup completes. Transport extraction must retain both-stream reader pauses, ordinary admission limits, reserved controls, and the bounded slow-consumer exit.
- Attachment metadata is negotiated additively under protocol v1; old clients retain bounded legacy results. Preserve pre-commit size checks and bounded text reads.
- Catalog cursors address immutable bounded scans. Snapshot workers have input, output, heap, concurrency, queue, and deadline limits with parent-owned cleanup.
- Qt documents use latest-read mutations under kernel-owned locks. The stable `.lock` inode is intentional; shared-package extraction must not unlink it or introduce another owner for the same file.

Remediation passed its final gate in the working tree above `708449044bba2a8227623cc4e4639fcff8098049`: 262 tests passed with no failures or skips, including all six live Quickshell tests. The required focused groups passed 96 backend tests and 77 UI/unit/package/documentation tests. QML lint passed. The package dry run contained 102 files and had SHA-1 `b8d7d8ecc9db264463e56199f6170cd1dca000b2`. Runtime versions were Node `v22.23.2`, Qt `6.11.2`, and Quickshell `0.3.1`. The completed remediation record is retained locally under `plans/archive/qt-webui-architecture-review.md`; implementation contracts and regression suites are documented in [DEVELOPMENT.md](../../DEVELOPMENT.md).

The four stages below remain separate work, not part of remediation. Re-run the baseline after a clean dependency install before beginning extraction.

Before step 1 begins:

- [ ] Run `npm ci --ignore-scripts` in `pi-package-qt-webui` on Linux or WSL.
- [x] Run `npm run check` and record the passing count, skipped live tests, Node version, Qt version, Quickshell version, and revision.
- [x] Run `qmllint -I /usr/lib/qt6/qml qml/*.qml qml/components/*.qml qml/dialogs/*.qml`.
- [x] Run `npm pack --dry-run --json` and retain the package file inventory.
- [x] Record current request, event, shutdown, tab-switch, session-sync, and resource-rollback behavior as characterization tests where coverage is missing.
- [x] Record a clean smoke trace for the default, 200 percent scale, and model-order scenarios.

If the baseline is not green, classify each failure before refactoring. Fix only failures that block trustworthy comparison.

# Step 1: feature-oriented modular monolith

Feasibility: 9/10

## Outcome

Keep the same runtime behavior while turning the backend entry point, QML bridge, and shell into composition roots around feature modules. This step establishes boundaries. It does not introduce actors, replace event semantics, or split the mutable internals of `pi-session.mjs`; that work belongs to step 3.

## Target backend structure

```text
lib/backend/
  bootstrap.mjs
  protocol/
    limits.mjs
    requests.mjs
    events.mjs
    validation.mjs
  transport/
    jsonl-server.mjs
    outbound-queue.mjs
  application/
    command-router.mjs
    command-context.mjs
  features/
    tabs/
    session/             compatibility facade around pi-session.mjs until step 3
    transcript/
    session-catalog/
    resources/
    workspace/
    appearance/
    themes/
  adapters/
    process-tree.mjs
    filesystem-store.mjs
    desktop.mjs
    git.mjs
  main.mjs
```

Names may change during implementation, but dependency direction may not:

```text
main/bootstrap -> application -> features -> adapters
                         |
                         +-> protocol
transport ----------------> protocol
```

Features must not import `main.mjs`, transport internals, or another feature's private files. Cross-feature work goes through an explicit application service or public feature interface.

## Target QML structure

```text
qml/
  infrastructure/
    BackendProcess.qml
    ProtocolClient.qml
  stores/
    AppStore.qml
    ActiveSessionStore.qml
    SessionCatalogStore.qml
    NotificationStore.qml
  controllers/
    ComposerController.qml
    PaletteController.qml
    SessionNavigationController.qml
    ResourceController.qml
  features/
    composer/
    transcript/
    sessions/
    resources/
    status/
  BackendBridge.qml
  shell.qml
```

`BackendBridge.qml` remains as a compatibility facade during this step. Existing components continue to call it while implementation moves behind it. By the end of step 1 it may contain only forwarding properties, signals, and methods. Step 2 removes each forwarding group when its domain store becomes authoritative; no new feature may add logic to the facade.

## Work packages

### 1.1 Create the canonical protocol registry

- [ ] Represent every request once with its type, timeout, client-routing scope, mutation class, validator, and handler key. Client-routing scope and mutation class are independent fields.
- [ ] Validate the registry at startup and fail fast when an entry lacks a timeout, scope, mutation class, validator, or resolvable handler.
- [ ] Derive `REQUEST_TYPES`, timeout lookup, session-scoped routing metadata, and mutation middleware from that registry.
- [ ] Move limits into a protocol-owned module without changing values.
- [ ] Deliver request timeouts, routing scope, and post-startup limits to QML through `backend.ready` and `hello`; changing them must not require a hand edit to QML.
- [ ] Generate a committed QML artifact only for values needed before `hello`, such as framing and initial rendering bounds.
- [ ] Add regeneration and no-diff validation to `npm run check` when a generated artifact is required.
- [ ] Preserve explicit event payload validation and reserved-key checks.

Acceptance:

- Adding a request requires one registry entry and its handler implementation.
- Startup rejects a dangling handler or incomplete registry entry before reading requests.
- No hand-maintained request list remains in `main.mjs` or `BackendBridge.qml`.
- The bridge applies hello-delivered request metadata verbatim, and backend timeout or routing changes require no QML edit.
- Registry tests assert that every existing timeout remains equal to the recorded baseline.

### 1.2 Extract backend transport

- [ ] Move inbound JSONL framing, request correlation, timeout settlement, response creation, outbound queue accounting, event coalescing, and backpressure into transport modules.
- [ ] Inject output, clocks, timers, fatal callbacks, and `onBackpressureChange(paused)` so transport tests do not start Pi or know about the tab registry.
- [ ] Expose a read-only transport statistics snapshot for `hello` and diagnostics.
- [ ] Keep essential-event and slow-consumer behavior byte-for-byte compatible.
- [ ] Keep startup, stdout failure, stdin EOF, and shutdown ownership outside feature handlers.

Acceptance:

- Transport tests cover malformed frames, oversized frames, duplicate IDs, timeouts, dropped coalescable events, backpressure, drain, and closed output.
- Transport modules know nothing about tabs, sessions, resources, Git, or themes.
- The injected backpressure callback pauses and resumes every Pi child through the application layer.
- `hello` and diagnostics retain the baseline transport statistic fields and meanings.

### 1.3 Extract backend application services

- [ ] Write an existing-file mapping before moving code. For each backend module, name its target module, whether it moves unchanged or splits, and its allowed imports.
- [ ] Keep `pi-session.mjs` behind a feature facade without splitting its mutable internals. Mark the Pi RPC adapter and actor decomposition as step 3 deliverables.
- [ ] Move handler dispatch into a command router.
- [ ] Express tab resolution, stale-session preparation, exclusive-operation checks, and error mapping as named middleware.
- [ ] Move session synchronization from `main.mjs` into a session-sync coordinator.
- [ ] Move resource apply, rollback, commit, and reconciliation into a resource transaction coordinator.
- [ ] Keep `main.mjs` responsible only for dependency construction, signal registration, startup, and shutdown.
- [ ] Replace the top-level `lib/backend/*.mjs` syntax glob with a recursive, cross-platform Node syntax-check script in the first change that creates a backend subdirectory.

Acceptance:

- The mapping accounts for every current backend module and identifies intentionally deferred splits.
- No feature handler closes over unrelated backend state as defined by the dependency map.
- Session synchronization and resource transaction tests instantiate their coordinators directly.
- A controlled snapshot-load interleaving test preserves session-sync generation checks across a tab or session change.
- A directly instantiated resource coordinator test covers apply, commit, rollback, and post-commit reconciliation failures.
- `main.mjs` contains no request-specific business rules, verified by router registration tests and review.
- A package-contract test proves that every `lib/**/*.mjs` file receives a syntax check.

### 1.4 Split the QML bridge behind a compatibility facade

- [ ] Move `Process`, JSONL parsing, pending request correlation, timeout sweeping, and backend restart handling into infrastructure objects.
- [ ] Move transcript projection, notices, session catalog, and active-session state into separate stores.
- [ ] Move feature commands into controllers.
- [ ] Keep existing bridge properties, functions, and signals as forwarding aliases until all callers migrate.
- [ ] Move one domain at a time and run focused QML and smoke tests after each move.

Acceptance:

- Backend transport can be tested with a fake line source without constructing the full shell.
- Domain stores do not start processes or open dialogs.
- Controllers do not own visual items or focus.

### 1.5 Reduce `shell.qml` to composition

- [ ] Move palette construction and dispatch into `PaletteController.qml`.
- [ ] Move search calculation into a transcript search controller or transcript feature component.
- [ ] Move model, thinking, and composer picker orchestration into feature controllers.
- [ ] Move session, worktree, draft, attachment, and link workflows behind named controller signals.
- [ ] Leave window layout, bindings, keyboard shortcuts, focus transfer, and component composition in `shell.qml`.

Acceptance:

- `shell.qml` does not construct backend request payloads.
- Feature workflows can be tested without parsing function bodies from `shell.qml`.
- Existing accessible names, roles, shortcuts, and focus-return behavior remain unchanged.

## Testing changes

- [ ] Add unit tests for the protocol registry, transport, router middleware, sync coordinator, and resource coordinator.
- [ ] Record every static QML assertion removed or moved and map it to a facade, controller, store, smoke, accessibility, or structural replacement.
- [ ] Keep each existing static assertion until its mapped replacement passes in the same change.
- [ ] Test controller and store behavior through stable inputs, outputs, properties, and signals rather than private function location.
- [ ] Keep visual, accessibility, bounds, accidental-send prevention, and wiring checks that genuinely inspect QML structure.

## Step 1 release gate

- [ ] `npm run check` passes with the baseline scenarios and recursively syntax-checks every runtime `.mjs` file.
- [ ] `qmllint` passes for all old and new QML directories.
- [ ] `npm pack --dry-run --json` includes every new runtime file and matches the baseline inventory except for reviewed additions and moves.
- [ ] Protocol generation, when needed, is reproducible and clean under the standard check.
- [ ] Registry completeness and handler-resolution tests pass.
- [ ] No request, event, limit, or timeout exists in more than one hand-maintained registry.
- [ ] Removed static assertions have an itemized, passing replacement with no loss of smoke markers or accessibility and security assertion categories.
- [ ] `BackendBridge.qml` contains no domain implementation, and new features cannot depend on its compatibility internals.
- [ ] No user documentation changes are required unless observable behavior changed.

## Rollback

Each extraction keeps the compatibility facade and original protocol. Revert the latest module move and restore its forwarding call. Do not revert unrelated completed extractions.

# Step 2: backend-owned revisioned state

Feasibility: 8/10

Depends on step 1.

## Outcome

The backend becomes the only authority for application and session state. QML receives validated snapshots and patches identified by monotonic revisions. QML retains only presentation state.

## State model

Use an opaque `backendInstanceId` created once per backend process plus separate revision streams:

- `appRevision` for tabs, settings, appearance, theme, and global catalog invalidation status.
- `tabRevision` per tab for readiness, activity, runtime, queues, dialogs, resources, attachments, and errors.
- `transcriptRevision` per tab for transcript reset and row patches.

A state message identifies its backend instance, domain, owner, and revision:

```json
{
  "v": 1,
  "kind": "event",
  "type": "state.tab",
  "backendInstanceId": "opaque-run-id",
  "tab": "tab-2",
  "revision": 47,
  "state": {}
}
```

Reducers key their high-water marks by `(backendInstanceId, domain, tab)`. A complete bootstrap snapshot establishes a new instance before any later event can apply. Frames from an older instance are rejected even when their revision is numerically higher.

Every domain has one projection builder. That builder alone compares semantic state, mints revisions after successful commits, and publishes snapshots or patches. Cross-tab derived values such as activity state remain backend-owned. QML derives only presentation values from validated store state.

Patch and backpressure rules:

- App and tab state publications are essential complete replacements for the keys they carry.
- Transcript reset, remove, and final-row operations are essential.
- A non-final transcript row update may be coalesced only by `(backendInstanceId, tab, rowId)` and carries a complete replacement row, never a text delta.
- A drop report identifies every affected revision stream. QML marks those streams unsynchronized and requests bounded fresh snapshots.
- An unexplained revision gap in a non-self-healing stream triggers the same resynchronization. QML never guesses the missing mutation.

## Work packages

### 2.1 Define ownership and public state shapes

- [ ] Inventory every mutable property in `BackendBridge.qml`.
- [ ] Classify each property as backend state, backend-derived projection, or presentation-only state.
- [ ] Define bounded app, active-tab, transcript, and catalog-invalidation projection shapes. Keep notices as validated transient events rather than revisioned state.
- [ ] Define backend selectors for cross-tab values such as activity state, effective resource state, and notification suppression.
- [ ] Define QML selectors only for presentation derivation such as labels and visibility.
- [ ] Keep focus, popup visibility, search input, picker selection, scroll position, and unsent editor widget state in QML.
- [ ] Retain bounded summaries for at most `LIMITS.maxTabs` tabs in QML, but retain a full session and transcript projection only for the active tab. Selection always installs a complete snapshot, even when its revision equals a previously discarded projection.
- [ ] Add a mechanical ownership manifest used by a contract test to name the owner of every store property.

Acceptance:

- The ownership contract test accounts for every mutable bridge/store property.
- Backend readiness, runtime, queues, dialogs, resources, and errors exist only in their backend projection stores, not as writable copies in views, controllers, or the compatibility facade.
- QML does not infer backend state from unrelated flags or event order.
- QML projection row and byte bounds are recorded and tested across the maximum tab count.

### 2.2 Add backend revisions without removing current events

- [ ] Create and publish `backendInstanceId` in `backend.ready`, `hello`, every projection message, and every projection-bearing response.
- [ ] Add monotonic revisions through one projection builder per app, tab, and transcript domain.
- [ ] Publish a complete app snapshot at hello and after backend restart.
- [ ] Publish complete tab snapshots on selection and bounded tab patches after state changes.
- [ ] Add transcript revisions to reset, append, update, remove, and replay operations under the patch rules above.
- [ ] Classify every projection message as essential or coalescable in the protocol registry.
- [ ] Extend drop diagnostics with affected instance, domain, tab, and revision range so QML can resynchronize the right stream.
- [ ] Route every session-scoped response to the tab recorded in its pending-request entry. Mutating responses return that owner plus the committed projection revision.
- [ ] Settle a mutation's presentation-level pending state only after its response arrives and the matching store reaches the returned revision. If that cannot happen before the client deadline, request a snapshot rather than applying response data directly.
- [ ] Keep current version 1 events during a bounded compatibility period.

Acceptance:

- Fault-injection tests prove that failed state and resource commits publish no revision advance.
- Equal persisted snapshots do not advance transcript state unnecessarily.
- A delayed frame from an older backend instance cannot apply after restart, even when it carries a higher revision.
- Forced transport drops and unexplained gaps cause bounded resynchronization and converge to the backend snapshot.
- Essential/coalescable classification has a protocol contract test.
- A delayed read response for tab A updates tab A's store or is discarded with that store, never the currently active tab B.

### 2.3 Convert QML stores one domain at a time

Recommended order:

1. settings, appearance, and themes;
2. tabs and active-session summary;
3. queues, runtime, errors, and resources;
4. dialogs and attachments;
5. session catalog;
6. transcript patches.

For each domain:

- [ ] Add a reducer that validates backend instance, owner, revision, bounds, and gap policy.
- [ ] Switch consumers from bridge flags to the domain store.
- [ ] Add delayed, duplicated, reordered, dropped, tab-switched, and backend-restarted fixtures.
- [ ] Add a committed-only revision test for that domain before removing its old path.
- [ ] Remove the old mutation path after the domain has full behavioral coverage.

The session catalog remains paged request/response data. Its revisioned projection carries invalidation and loading status only. Each page request records the catalog revision at fetch time; QML merges the page only while that revision still matches. Invalidation during pagination cancels the merge and starts a fresh bounded pass.

Acceptance:

- Session-scoped responses route by their recorded owner rather than mutating whichever tab is active later.
- Backend restart replaces projections from one authoritative bootstrap snapshot and resets high-water marks through `backendInstanceId`.
- Switching away discards the full active transcript projection. Switching back installs a complete snapshot before patches can apply.
- Catalog invalidation during pagination cannot mix pages from different revisions.
- Reset functions clear presentation state only. They do not reconstruct backend truth manually.

### 2.4 Retire ordering contracts

- [ ] Remove reliance on `tabs.update` arriving before transcript replay.
- [ ] Replace origin-tab callback dropping with origin-tab routing into the owning store plus backend-instance and revision checks.
- [ ] Replace feature-specific generation counters where domain revisions provide the same protection.
- [ ] Keep picker generation counters when they protect presentation state rather than backend state.
- [ ] Keep notice delivery as bounded events and document that it is not part of state convergence.
- [ ] Remove compatibility events only after all consumers have moved. Bump the protocol version if existing event meaning or required fields change incompatibly.

## Step 2 release gate

- [ ] Unit tests cover stale, duplicate, missing, dropped, and out-of-order revisions for every domain.
- [ ] A restart test rejects a buffered old-instance frame whose revision exceeds the new instance's revision.
- [ ] A forced-drop test proves final QML projection equality with an authoritative backend snapshot.
- [ ] Tab-switch integration tests delay read and mutation responses and events across at least two tabs.
- [ ] Session catalog tests cover invalidation in the middle of pagination.
- [ ] Session-sync tests prove that external projection and local mutation produce deterministic, post-commit revisions.
- [ ] State and resource rollback tests prove that failed transactions do not publish committed state.
- [ ] Ownership contract tests prevent writable backend authority from returning to the facade, controllers, or views.
- [ ] Live smoke tests cover backend restart, tab switch during delayed work, transcript streaming, forced resynchronization, and extension dialogs.
- [ ] QML retains only bounded tab summaries and one full active-tab projection.

## Rollback

Retain old events until each domain cutover is accepted. Roll back one domain to its compatibility reducer if needed. Never keep both paths writing the same QML property after a domain is accepted.

# Step 3: serialized session actor per tab

Feasibility: 7/10

Depends on step 2 state ownership. The actor publishes the revisioned tab and transcript projections defined there.

## Outcome

One actor owns each tab's Pi process, session state, transcript, dialogs, attachments, stale-session state, and operation scheduling. The tab registry owns tab identity, order, selection, creation, removal, persisted layout, and selection-derived unread/completion acknowledgment. It may derive those badges from actor events, but it cannot mutate actor-owned session state.

Before actor migration begins, step 2 must have completed the tab readiness, runtime, queue, dialog, resource, and error store cutovers. Transcript compatibility events may remain only behind the established projection facade.

## Actor contract

Each actor exposes:

```text
start
submit(command)
snapshot
subscribe
stop
pauseInput
resumeInput
killNow
childPid
```

`pauseInput`, `resumeInput`, `killNow`, and `childPid` are synchronous control operations. Fatal cleanup and slow-consumer backpressure never wait for an actor mailbox or expose the raw child handle.

Commands are immutable records with an operation ID, lane, expected state preconditions, and a cancellation policy. The existing transport timeout remains the public request deadline. Actor cancellation is internal cleanup and must not introduce a competing public timeout or error code.

The actor accepts at most `LIMITS.maxPendingRequests` ordinary queued commands. Overflow returns the existing `busy` code. Abort is coalesced to at most one pending control action, and shutdown is idempotent, so ordinary mailbox pressure cannot prevent cleanup.

The actor has three execution lanes:

1. A serialized mutation lane for prompts, session replacement, model changes, resource changes, compaction, rename, and stale-session preparation.
2. A control lane for abort, shutdown, process exit, fatal cleanup, and input pause/resume. Control work must not wait behind a long mutation.
3. A read lane for snapshots and safe cached or generation-guarded reads. The command inventory must name which Pi reads remain concurrent and which enter the mutation lane.

`submit()` and lease acquisition record pending work synchronously in the same event-loop turn. Busy queries include queued and running mutations. Preconditions are checked again when work begins. Pi events, session-file changes, and command completions reduce through the same actor-owned state transition layer before projections are published.

## Work packages

### 3.1 Specify commands and state transitions

- [ ] List every current tab-scoped request and classify its lane, preconditions, transport timeout, cancellation behavior, state effects, and whether any Pi read may remain concurrent under a generation guard.
- [ ] Define explicit actor states for starting, ready, running, compacting, rebinding, restarting, stopping, stopped, and failed.
- [ ] Model pending dialogs, helper calls, prompt acceptance, abort-before-start, and stale-session preparation as substates rather than unrelated flags.
- [ ] Define legal transitions and existing public error results.
- [ ] Pin abort behavior from every state. In particular, preserve abort during compaction and the current `not_running` result while rebinding when no run is active.
- [ ] Define cancellation-policy values, mailbox accounting, overflow behavior, and cleanup of queued commands during close and restart.
- [ ] Add pure transition tests before moving process ownership.

Acceptance:

- Invalid transitions fail with the existing public error codes.
- Shutdown and abort remain available while ordinary mutations are blocked.
- `state` during streaming and cached `models_list` during a run preserve their current concurrency and stale-result behavior.
- A submitted mutation is visible to session synchronization as busy before the next asynchronous turn.

### 3.2 Move one `pi-session` responsibility at a time

Recommended order:

1. operation queue and state reducer;
2. Pi command correlation and lifecycle;
3. prompt and run lifecycle;
4. transcript and tool projection;
5. extension dialogs and helper calls;
6. model, thinking, compaction, and session replacement;
7. attachments, workspace index, and stale-session preparation.

- [ ] Keep adapters for existing `createPiSession` callers during migration.
- [ ] Replace mutable closure fields with actor state managed by transitions.
- [ ] Publish state only after a transition commits.
- [ ] Make timer creation and cancellation part of state entry and exit handling.

### 3.3 Reduce the tab registry

- [ ] Store actor references rather than session objects plus parallel mutable session fields.
- [ ] Move session metadata, pending resume, transition path, stale generation, persisted metadata, mutation preparation, and transcript mirror into the actor.
- [ ] Keep tab order, selected tab ID, persisted layout, maximum-tab policy, unread count, and completion acknowledgment in the registry or backend app projection because those values depend on selection.
- [ ] Consume actor-published run and input events to derive registry badges without copying actor state.
- [ ] Make selection request a replay or snapshot from the actor rather than reconstructing state in the registry.
- [ ] Have actors publish their owned current, pending-resume, and transition session paths. The registry aggregates those read-only projections for monitoring.

Acceptance:

- The registry cannot mutate actor-owned session state directly.
- Actors do not copy registry selection state.
- Closing a tab removes it from selection, rejects queued ordinary commands, disposes subscriptions, and stops its actor while still guaranteeing process cleanup.

### 3.4 Add external projection and cross-tab coordination

External session-file projection enters the owning actor as a mutation-lane command carrying the monitored revision key. The session-sync coordinator compares registry ownership generation and actor stale generation around controlled asynchronous loads; neither the registry nor coordinator mutates the actor's mirror or runtime metadata directly.

Resource profile changes may affect several actors.

- [ ] Resolve the complete target actor set before acquiring leases.
- [ ] Acquire all leases synchronously in stable tab-ID order or fail without holding a partial set; queued and held leases are immediately visible to busy queries.
- [ ] Recheck idle state and model identity after all leases are held and again before commit where an external read intervenes.
- [ ] Read current helper and stored state, prepare changes, apply to actors, commit storage, and reconcile retained values.
- [ ] Publish committed revisions only after the transaction reaches an honest result.
- [ ] Roll back actors in reverse order when pre-commit work fails.
- [ ] Report post-commit runtime inconsistency explicitly when canonical storage cannot be rolled back safely.
- [ ] Release every lease in `finally` paths and retry deferred external session projection afterward.
- [ ] Test two competing broader profile transactions so only one can pass acquisition and revalidation.

### 3.5 Add deterministic concurrency tests

- [ ] Inject a scheduler, fake clock, or barriers around Pi replies, helper replies, file revisions, store commits, actor lease acquisition, startup readiness, prompt reconciliation, render cadence, and helper timeouts.
- [ ] Cover abort during prompt acceptance and compaction, shutdown during compaction, session change during stale preparation, process exit during helper calls, and resource rollback across several tabs.
- [ ] Cover same-turn busy visibility, two competing cross-tab transactions, actor mailbox limits, queued-command rejection on close/restart, and internal command cancellation.
- [ ] Prove no actor accepts a normal mutation after stopping begins.
- [ ] Prove abort and shutdown dispatch through the control path before a deliberately blocked mutation resolves.
- [ ] Prove fatal cleanup and backpressure can kill, pause, and resume children without awaiting a lane.
- [ ] Keep existing concurrency assertions at equal or greater strength; moving a test may not weaken its assertion.

## Step 3 release gate

- [ ] Existing backend lifecycle, session, tab, resource, and sync tests pass against actors without weaker assertions.
- [ ] New schedule-controlled tests cover every race currently guarded by `exclusiveTabOperations`, `mutatingTabOperations`, `preparationPromise`, and generation checks.
- [ ] Deterministic barriers prove that abort and shutdown dispatch without waiting for a blocked mutation; process shutdown still meets `LIMITS.shutdownGraceMs`.
- [ ] Mailbox, subscriber, timer, and control-action bounds are tested.
- [ ] No tab state is mutable from both the registry and actor, and selection-derived badges remain outside actors.
- [ ] External session projection and monitored-path publication cross the coordinator/actor boundary only through their documented commands and projections.
- [ ] Process-tree cleanup remains unchanged and passes fatal, EOF, signal, restart, and forced-close tests.
- [ ] `DEVELOPMENT.md` documents actor states, lane rules, synchronous controls, timeout ownership, mailbox bounds, and cross-tab leases.
- [ ] Live QML behavior remains unchanged.

## Rollback

Migrate actor responsibilities behind the existing tab/session interfaces. Roll back the latest responsibility to its adapter if needed. Do not run old and new process owners for the same tab.

# Step 4: shared headless core for Qt WebUI and Pi WebUI

Feasibility: 6/10

Depends on stable interfaces from steps 1 through 3. Working package name: `@firstpick/pi-ui-core`. Final naming and publication require a separate approval.

## Outcome

Qt WebUI and Pi WebUI consume public contracts from a small headless package. The first tranche moves pure resource-selection logic. Removing Qt WebUI's remaining dependency on Pi WebUI is a separate storage tranche and occurs only if its security review approves moving the shared lock and atomic document updater. No tranche may expand silently to meet the broader dependency goal.

## Decision history

This step supersedes the earlier decision in [Qt WebUI shared tool and skill state](qt-webui-shared-tool-skill-state.md) that kept Pi WebUI as the implementation owner and deferred a third package. The evidence for reconsideration is now concrete: Qt imports private `lib/` paths, pulls in a much larger package to use a few functions, and needs a stable contract before further architectural work. The audit must still prove that a new package is better than adding a focused public module to `@firstpick/pi-utils`; package naming is not predetermined.

If the core is approved, the dependency rule is:

```text
@firstpick/pi-ui-core
          ^
          |
   +------+------+
   |             |
Qt WebUI      Pi WebUI
```

The core must not import either UI package, QML, browser DOM code, HTTP server code, Quickshell, or process supervisors. A named Node storage module may own cross-process file locking and atomic replacement only after the storage tranche's security review. The core remains platform-neutral, declares Node 22.19 or newer, and has no Linux-only package restriction.

## Work packages

### 4.1 Audit candidates and delivery surfaces

Classify each candidate as pure domain logic, Node storage logic, runtime adapter, generated browser artifact, or UI behavior.

First candidate:

- resource profile normalization and inheritance;
- exact provider/model identity handling;
- preservation of unavailable tool and skill names;
- `branchResourceDirective` and its versioned session-entry semantics.

Audit-only candidates that are not scheduled by their presence here:

- scoped-model normalization, which may remain Pi-owned if Qt has no matching implementation;
- sampling validation and capability filtering;
- bounded session identity helpers where both packages use identical security rules;
- normalized transcript or session-history helpers only when both clients need the same output contract.

Sampling requires a behavior-difference report before any extraction. The audit must compare model-declared parameters, Anthropic thinking behavior, payload deletion, capability reasons shown to users, and provider-specific support. Behavior alignment, documentation changes, and extraction are separate reviewed changes.

Explicit exclusions:

- Quickshell and QML stores;
- browser DOM renderers;
- HTTP, SSE, authentication, and remote-access code;
- Pi child ownership and tab actors;
- package-specific UI settings fields;
- theme presentation and desktop integration;
- Git, runner, subagent, and update supervisors unless a later audit proves a stable shared contract.

For every candidate:

- [ ] Identify current owners and callers in both packages.
- [ ] Declare every delivery surface: Node backend, Pi extension, browser module, generated artifact, or package consumer.
- [ ] Compare behavior, bounds, errors, data shapes, and truncate-versus-reject semantics.
- [ ] Produce a limit inventory with current values in both packages and proposed ownership. Shared file-format limits belong to the shared contract; changing a client-visible bound requires a separate review.
- [ ] Reject extraction when names are similar but semantics differ.
- [ ] Write the proposed public API and compatibility policy before moving code.
- [ ] Decide whether the package is new or belongs in `@firstpick/pi-utils`, based on domain cohesion, dependency weight, and release ownership.
- [ ] For browser-consumed logic, choose either a committed generated artifact with a no-diff check or no extraction. Do not introduce an undeclared browser build step.

### 4.2 Create the package and public contract

- [ ] Add `README.md`, `TECHNICAL.md` only if advanced user configuration exists, and `DEVELOPMENT.md` for implementation and contributor details under the repository documentation rules.
- [ ] Export only named public modules through `package.json` exports.
- [ ] Keep domain functions pure. Inject storage paths, clocks, filesystem calls, and locks only in a separately named Node storage module.
- [ ] Define package-owned limits only for shared contracts and add boundary fixtures for both sides of every limit.
- [ ] Require normalization and update round trips to preserve unknown keys at every envelope level, including `qtWebuiMigrations` and invented future keys.
- [ ] Add fixtures that both clients consume without importing each other's tests.
- [ ] Follow semver for core public exports. Test every UI against the lowest and highest core versions allowed by its declared range.
- [ ] Retain compatibility re-exports until repository search and packed tests show that no supported consumer uses them and a separate removal review approves the break. Do not rely on a time-based "release cycle" promise.
- [ ] Add a named import-graph check that rejects dependency cycles.

### 4.3 Move the pure resource-selection contract

- [ ] Move profile normalization, exact-model selection, unavailable-name preservation, inheritance resolution, and `branchResourceDirective` into the core package.
- [ ] Preserve exact current limits and unknown-key pass-through unless a separately reviewed bounds change lands first.
- [ ] Keep Pi WebUI compatibility re-exports while consumers migrate.
- [ ] Change Qt WebUI backend and helper imports to the core's public resource-selection export.
- [ ] Rewrite `tests/package-contract.test.mjs` and `tests/packed-install.test.mjs` to test the packed core dependency instead of fabricating Pi WebUI's private modules.
- [ ] Extend packed-install coverage so the Pi-side helper's core import resolves inside the spawned Pi environment.
- [ ] Update both packages' `DEVELOPMENT.md` ownership statements and mark the superseded plan decision.
- [ ] Run both packages' resource, session-entry, package, and packed-install tests.
- [ ] Verify that no migration changes existing user files.

Acceptance:

- Both clients produce identical resource-selection and branch-directive results from shared fixtures.
- Boundary fixtures preserve the agreed limits and truncate/reject semantics.
- Unknown migration and future keys survive normalization and round trips.
- Qt WebUI has no import of Pi WebUI's private `resource-selection.mjs`.
- Each UI passes the contract suite against the lowest and highest core versions in its supported range.

### 4.4 Decide and, if approved, extract shared storage

The pure contract does not by itself remove Qt WebUI's import of `git-workflow-preferences.mjs`. Before claiming that neither UI depends on the other:

- [ ] Choose one reviewed outcome: keep a documented public Pi WebUI storage export, or move a generic locked atomic JSON document updater into a named core Node storage module.
- [ ] If storage moves, inject envelope normalization so the storage module preserves unrelated Pi WebUI settings and unknown keys.
- [ ] Preserve the existing lock name, latest-snapshot merge, stale-lock handling, owner-only permissions, atomic replacement, failure reporting, and Windows rename retry.
- [ ] Add core tests for concurrent processes, lock timeout and recovery, partial failures, atomic replacement, permissions, latest-snapshot merge, and Windows retry behavior.
- [ ] Move Pi WebUI and Qt WebUI to the same public storage API before removing either old implementation.
- [ ] Do not migrate or rewrite user data merely because code ownership changes.

Acceptance for the broader dependency goal:

- Qt WebUI has no import from `@firstpick/pi-package-webui/lib/`.
- Neither UI package depends on the other.
- Packed concurrent-writer tests prove that both clients preserve unrelated settings through the same lock and latest-snapshot updater.

If this tranche is rejected, revise the step outcome to public API stability rather than dependency removal. Do not mark the broader goal complete.

### 4.5 Consider later candidates separately

- [ ] Schedule sampling only after its behavior-difference report and any behavior alignment ship separately.
- [ ] Treat scoped-model extraction as an expected rejection unless the audit finds substantial shared logic beyond Pi's existing contract.
- [ ] Consider session identity and transcript helpers in separate changes with their own security and compatibility reviews.
- [ ] Do not create a generic `utils` module. Every export belongs to a named domain.

## Step 4 release gate

- [ ] Core package unit, boundary, import-graph, and package-contract tests pass.
- [ ] Unknown-key preservation and exact resource/session-entry compatibility fixtures pass in both clients.
- [ ] Qt WebUI `npm run check`, QML lint, and packed-install checks pass against the packed core package.
- [ ] Pi WebUI focused tests and its full required check pass against the packed core package.
- [ ] Lowest/highest supported packed-core version matrix tests pass for both clients.
- [ ] Tarball tests prove that neither UI relies on repository-relative paths or undeclared files and that the Pi-side helper resolves core imports.
- [ ] Any browser-consumed shared logic has a committed generated artifact and no-diff check; otherwise it remains owned by Pi WebUI's public modules.
- [ ] No dependency cycle exists under the named import-graph check.
- [ ] Public exports are documented and contain no UI or process-lifecycle code.
- [ ] The prior Pi WebUI ownership statement and `pi-package-webui/DEVELOPMENT.md` are updated in the same change.
- [ ] Repository README catalog and exact install names are updated if the core package is published for direct installation. If it is internal-only, document it only for contributors.
- [ ] Run `git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'`.

## Rollback

Keep compatibility re-exports in the old owner during adoption. A client can return to the compatibility export without changing persisted data. Do not delete old exports, change bounds, or migrate storage ownership until both clients have shipped successfully against the core package. The pure resource tranche and storage tranche roll back independently.

# Delivery order and decision gates

```text
Baseline
   |
   v
Step 1: boundaries and protocol registry
   |
   v
Gate A: same behavior, smaller ownership units
   |
   v
Step 2: authoritative backend state and revisions
   |
   v
Gate B: stale and reordered messages cannot corrupt QML state
   |
   v
Step 3: per-tab actors and cross-tab coordinator
   |
   v
Gate C: concurrency tests replace ad hoc lock reasoning
   |
   v
Step 4: narrow shared core extraction
   |
   v
Gate D: both packages consume public shared contracts
```

Stop after any gate if the next step lacks a demonstrated maintenance benefit. In particular, do not start the shared package merely to reduce duplicate line count.

## Rough effort

These are planning ranges, not delivery commitments:

| Step | Expected effort | Main uncertainty |
| --- | ---: | --- |
| 1 | 10 to 14 engineer-days | QML facade extraction, protocol metadata delivery, and coverage replacement |
| 2 | 10 to 15 engineer-days | Epoch-safe projections, drop recovery, and transcript patching |
| 3 | 12 to 18 engineer-days | Synchronous controls, actor scheduling, and cross-tab transactions |
| 4 | 10 to 18 engineer-days | Contract differences, storage ownership, and two-package release coordination |

Use small reviewed changes inside each range. No step should remain as a long-lived branch that combines all of its work packages.

## Completion criteria

The architecture program is complete when:

- `main.mjs` and `shell.qml` are composition roots rather than feature owners;
- protocol metadata has one canonical source;
- backend state has one owner and QML rejects stale projections by revision;
- each tab's mutable session state is owned by one actor;
- cross-tab transactions have one coordinator and deterministic concurrency tests;
- Qt WebUI and Pi WebUI share only public, stable, headless contracts;
- Linux package, QML lint, smoke, lifecycle, packed-install, and documentation checks pass;
- user-visible behavior and safety claims remain accurate in `README.md`, `TECHNICAL.md`, and `DEVELOPMENT.md`.
