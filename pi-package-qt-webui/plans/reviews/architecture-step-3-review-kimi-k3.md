# Review of architecture step 3

Scope: Step 3 ("serialized session actor per tab") in `pi-package-qt-webui/plans/planned/qt-webui-architecture-refactor.md`, reviewed against the current implementation in `pi-package-qt-webui/lib/backend/` (`pi-session.mjs`, `tabs.mjs`, `main.mjs`) and the existing concurrency test suite (`tests/backend-tabs.test.mjs`, `tests/backend-session.test.mjs`, `tests/session-sync-integration.test.mjs`). No files were modified.

## Verdict

Revise. The step targets the right problem — `createPiSession` (`pi-session.mjs:213`) currently mixes ~30 mutable closure fields with transport, timers, dialogs, helper calls, and transcript translation, and the tab registry (`tabs.mjs`) splices its own mutable fields (`unread`, `staleGeneration`, `preparationPromise`, `mirror`) onto the same tab object. Consolidating per-tab mutable state behind one owner with explicit transitions is the correct direction, and 3.4's lease-ordered cross-tab coordinator is a faithful formalization of the proven `setResource` algorithm in `main.mjs:586`. However, as written the step (a) silently breaks two synchronous-atomicity guarantees the session-sync reconciler depends on, (b) moves selection-derived badge state into the actor where it does not belong, (c) under-specifies mailbox bounds, timeout layering, and synchronous escape hatches that lifecycle code (`fatal`, backpressure) requires, and (d) contains one acceptance criterion ("latency within existing bounds") that cannot prove its claim without a baseline the plan never captures.

## What is sound

- **The ownership split is mostly right.** Actor owns session state; registry keeps identity, order, selection, creation, removal, and max-tab policy. This matches where the complexity actually lives and preserves the "one tab = one Pi child" invariant (`tabs.mjs:11`).
- **3.4 mirrors a battle-tested algorithm.** Stable-order lease acquisition, idle/model recheck after acquisition, reverse-order rollback, honest post-commit inconsistency reporting, and `finally`-path release correspond directly to the existing `setResource`/`rollbackResources` flow (`main.mjs:566-705`) and its fencing tests (`tests/backend-tabs.test.mjs:760-829`). Keeping those semantics is a strength, not a reinvention.
- **Control lane is a real requirement, not gold-plating.** `abort` (`pi-session.mjs:abort`) and `stop` must not queue behind a blocked `compact` (which can wait `requestTimeouts.compact`); the lane model names this correctly.
- **"Publish state only after a transition commits"** (3.2) preserves the honesty guarantees proven by `backend-session.test.mjs:610` ("resource commits … report apply, persistence, and rollback failures honestly").
- **Pure transition tests before moving process ownership** (3.1) is the right sequencing — it produces the characterization harness before the risky move.
- **The rollback rule** ("do not run old and new process owners for the same tab") is correct and matches the adapter-based migration.

## Findings

### F1 — Required — Lease/lane acquisition must be synchronously visible, or session-sync reconciliation races reopen

**Severity:** High. **Evidence:** `handleRequest` increments `mutatingTabOperations` synchronously *before* the first `await` (`main.mjs` ~lines 988-996), and `withExclusiveTabOperation` adds to `exclusiveTabOperations` synchronously (`main.mjs:547-556`). The reconciler's busy fence (`tabSessionSyncBusy`, `main.mjs:254-258`) and the stale-preparation dedup (`prepareMutation`, `tabs.mjs:390-410`; shared-promise behavior pinned by `tests/session-sync-integration.test.mjs:276-288`) rely on this: a mutation is observable as busy in the same event-loop turn it is requested. **Impact:** If actor `submit()` only enqueues and marks busy when the lane dequeues, a queued-but-unstarted mutation is invisible to `reconcileSessionChange`, which can then apply an external snapshot (`applyExternalSnapshot`, `tabs.mjs:429`) into a tab whose queued mutation assumes pre-snapshot state — exactly the race `mutatingTabOperations` exists to prevent. The same applies to cross-tab lease acquisition in 3.4: "resolve target set, then acquire leases" must not interleave `await`s between check and mark, or two concurrent global `tools_set` requests can both pass their idle checks. **Proposed amendment:** Add to 3.1/3.4: "`submit()` and lease acquisition synchronously (same event-loop turn) record pending work in the actor's published busy state; preconditions are re-validated at dequeue time. The reconciler's busy query must observe pending mailbox entries, not only the running command."

### F2 — Required — `unread` and `unacknowledgedCompletion` are selection-derived and must not move into the actor

**Severity:** Medium-high. **Evidence:** 3.3 says "Move unread, completion acknowledgment, session metadata … into the actor where they describe session state." But `tabs.mjs:handleSessionEvent` sets `tab.unacknowledgedCompletion = tab.id !== activeId` and `select()` clears both fields; they are pure functions of (actor run state, registry-owned selection). **Impact:** Moving them into the actor creates a circular ownership edge — the actor needs registry selection state to maintain them, and the registry needs actor state for summaries (`summary()`, `tabs.mjs:40`). This directly violates the step's own release gate "No tab state is mutable from both the registry and actor" and will force either duplicated selection state in every actor or callback coupling from registry into actors. **Proposed amendment:** Keep `unread`/`unacknowledgedCompletion` in the registry (or derive them in the step-2 app projection from actor-published `run.end` + registry `activeId`). Amend 3.3 to move only genuinely session-scoped fields: `pendingResume`, `transitionSessionFile`, `staleSessionFile`, `staleGeneration`, `persistedMetadataJson`, `mirror`, `preparationPromise`.

### F3 — Required — The actor contract lacks the synchronous escape hatches lifecycle code needs

**Severity:** High. **Evidence:** `fatal()` calls `killAllNow()` → `registry.children()` → `killProcessTreeNow(child)` synchronously (`main.mjs:1124-1127, 1147-1156`). `engageBackpressure` calls `tab.session.pauseInput()`/`resumeInput()` on every tab synchronously (`main.mjs:88-100`). The proposed contract (`start, submit, snapshot, subscribe, stop`) has no synchronous way to enumerate live child PIDs or pause/resume child stdout. **Impact:** If child handles are only reachable through the actor's serialized lane or async snapshots, the fatal path — which must not allocate or await — cannot guarantee process-tree reaping, weakening the package's core lifecycle guarantee; backpressure engagement would either be delayed behind a blocked mutation lane (memory bound weakened) or bypass the actor (ownership violated). **Proposed amendment:** Extend the contract with a synchronous control surface: `childPid()` (or `killNow()`) and `pauseInput()/resumeInput()`, explicitly designated as control-lane operations that never enter the mailbox. Add a gate line: "fatal, EOF, and slow-consumer paths reach child processes without awaiting any lane."

### F4 — Required — Read-lane policy risks a behavior regression for concurrent state reads

**Severity:** Medium. **Evidence:** `requestState()` is *deliberately* concurrent with runs today: the reconciliation timer fires it mid-run, and the prompt-generation check discards stale activity answers (`pi-session.mjs:425-450`). `listModels` similarly serves from cache during runs (`backend-session.test.mjs:426`). 3.1's read lane says reads that call Pi "enter the serialized lane when Pi cannot safely answer them concurrently" without enumerating which. **Impact:** If `state`, `session_stats`, or `models_list` land in the serialized lane, they queue behind a blocked `compact` (up to `requestTimeouts.compact`), adding latency that does not exist today and violating the constraint "Do not change user-visible behavior merely to make a module boundary easier." **Proposed amendment:** 3.1's classification table must list, per request, "concurrent Pi read (generation-guarded)" vs "serialized read," and the gate must prove `state` during streaming and `models_list` during a run retain current latency and staleness semantics.

### F5 — Required — Command deadlines create a third, unreconciled timeout layer

**Severity:** Medium. **Evidence:** Two timeout layers exist: the transport request timer (`LIMITS.requestTimeoutMs[request.type]`, `main.mjs` ~line 975) and per-Pi-command timeouts in `sendCommand` (`pi-session.mjs:338`). Step 3 adds a per-command "deadline" without stating precedence. Multi-step operations (`session_switch` = `switch_session` + `get_messages` + `get_state`) currently share one transport timeout across several Pi timeouts. **Impact:** Ambiguous layering yields either double-timeout error codes the QML client does not expect (`timeout` vs new actor codes — 3.1 acceptance requires "existing public error codes") or deadlines that can never fire because the transport timer fires first. Mailbox bounds are similarly unspecified: 3.5 *tests* "mailbox limits and command expiration," but the contract defines no bound, overflow error, or whether read-lane submissions count — `LIMITS.maxPendingRequests` currently bounds pending Pi commands (`pi-session.mjs:341`), and the analogue must be named. **Proposed amendment:** Specify: one timeout owner per scope (transport deadline unchanged; actor deadline is advisory cancellation, not a new error source); mailbox bound and its `busy` error code; cancellation policy enum values and their mapping to `pendingPromptCancellation`-style behavior.

### F6 — Required — `abort` semantics during `compacting` are undefined in the new state machine

**Severity:** Medium. **Evidence:** Today `compact()` sets `session.active = true` (`pi-session.mjs:~715`), so `abort()` during a manual compact sends a real `abort` command to Pi. The listed actor states include `compacting`, and 3.5 lists "shutdown during compaction" but not "abort during compaction." **Impact:** Whether the control lane honors, rejects, or defers abort during `compacting` is an observable behavior; an unspecified choice here is exactly the kind of accidental semantic change the plan's constraints forbid. **Proposed amendment:** 3.1's transition table must pin abort-from-every-state behavior to current outcomes, with a test.

### F7 — Required — Ownership of the reconcile loop and session-path projection is unassigned across the registry/actor split

**Severity:** Medium-high. **Evidence:** `sessionPaths()` (`tabs.mjs:457`) merges `sessionFile`, `pendingResume`, `transitionSessionFile` — two of which 3.3 moves into the actor — and feeds `updateMonitoredPaths` (`main.mjs:225`), whose generation checks (`registryPathGeneration`, `sessionSyncGeneration`, `main.mjs:310-330`) then span two owners. `applyExternalSnapshot` mutates mirror, runtime metadata, and stale generation — all actor-bound — yet is driven by the session-sync coordinator outside the actor. **Impact:** The plan says session-file changes "reduce through the same actor-owned state transition layer," which is right, but never says how the *coordinator-initiated* external projection enters the actor's lane, nor how the registry computes monitored paths without reading actor-owned fields. This is the step's least-specified seam and the one with the most existing race-guard machinery. **Proposed amendment:** Add a work package: "External session-file projection enters the actor as a mutation-lane command carrying the revision key; the registry consumes actor-published session-path projections for `sessionPaths()`; `registryPathGeneration` and the actor's stale generation are compared only inside the coordinator, never by the registry mutating actor state." Extend the gate's "generation checks" coverage to name this path explicitly.

### F8 — Optional — The full actor + lanes + leases may be more machinery than a single-threaded runtime needs

**Severity:** Low (challenge, not defect). **Evidence:** Node's event loop already serializes; the genuine requirements are (a) explicit state machine, (b) non-blocking control path, (c) ordered cross-tab fencing. A per-tab promise-chain serializer with a control bypass plus a reducer would satisfy these with fewer concepts than immutable command records + three lanes + leases + subscribe. **Impact:** Over-modeling raises the cost of 3.1's "list every tab-scoped request and classify" and of every future command addition (record type, lane, deadline, cancellation policy, preconditions). **Proposed amendment:** Keep the design, but require 3.1 to demonstrate, for two representative commands (e.g., `prompt`, `extension_response` — the latter is an uncorrelated fire-and-forget write, `pi-session.mjs:answerDialog`), that the command-record ceremony pays for itself; simplify the contract (e.g., drop per-command deadline in favor of lane policy) where it does not.

### F9 — Optional — Sequencing vs. Step 2's compatibility period is ambiguous

**Severity:** Low. **Evidence:** "Depends on step 2 state ownership" does not say whether Step 2's bounded compatibility period (2.2/2.4, old events retired per-domain) must be complete. **Impact:** Starting 3.1 while transcript still dual-publishes means transition tests must model both event dialects; waiting for full retirement serializes the two largest steps. **Proposed amendment:** State explicitly which Step 2 domains must be fully cut over before 3.2 begins (tab readiness/queues/dialogs at minimum; transcript patches may lag since the mirror stays the replay source).

### F10 — Optional — Missing documentation gate

**Severity:** Low. **Evidence:** Repo rules (`AGENTS.md`) place internal architecture (actors, lanes, leases, state machines) in `DEVELOPMENT.md`. Step 3's gate has no docs line. **Proposed amendment:** Add: "`DEVELOPMENT.md` documents the actor contract, lane rules, state machine, and coordinator protocol; `git diff --check` passes for docs."

## Missing tests or gates

1. **Synchronous busy visibility (F1):** a test that submits a mutation and, in the same tick, asserts the reconciler observes the tab as busy; and that two racing global `tools_set` transactions cannot both pass idle checks. Not explicitly in 3.5's list.
2. **Concurrent cross-tab transactions:** 3.5 lists single-transaction races but not two competing coordinators (lease contention, stable-order acquisition, loser's `busy` code).
3. **Mailbox semantics on lifecycle edges:** queued commands must be rejected (not executed) when the actor restarts or its tab closes mid-queue; "closing a tab … still guarantees process cleanup" (3.3) needs the queued-work variant.
4. **Timer control in the deterministic scheduler (3.5):** the current race surface includes `promptReconciliationMs`, `startupReadinessMs`, `renderCadenceMs`, and helper timeouts (`pi-session.mjs`); 3.5's injection list ("Pi replies, helper replies, file revisions, store commits, lease acquisition") omits timers. 3.2's "timers as state entry/exit" is necessary but not sufficient — the scheduler must control clock advancement.
5. **Abort/shutdown latency gate is unprovable as written:** "remain within existing bounds" has no measured baseline; the Baseline gate captures counts, not latency. Either record baseline abort/shutdown latencies in the characterization step or replace with concrete thresholds (e.g., abort dispatched within N ms while a mutation is blocked).
6. **Subscriber lifecycle bounds:** `subscribe` needs a test that tab close disposes subscriptions and that a slow internal subscriber cannot grow actor memory (mirroring the outbound-queue guarantee in `main.mjs:writeFrame`).
7. **No-weakening gate:** require that existing concurrency tests (`backend-tabs.test.mjs:760`, `session-sync-integration.test.mjs`) pass *unmodified in assertion strength* against actors — "pass against actors" alone permits silent softening during adapter work.

## Future changeability score: 7/10

After implementation as written, a routine tab-scoped feature touches the protocol registry (step 1), one command/transition module, and its tests — one cohesive module plus registry entry. Deductions: every new command pays actor-record ceremony (F8), cross-tab features coordinate actor + coordinator + reconciler seams (F7), and the read-lane rule invites case-by-case latency negotiation (F4).

## Maintainability score: 7/10

One owner per tab's mutable state, explicit transitions, deterministic scheduler tests, and honest publish-after-commit are strong diagnostic foundations. Deductions: unspecified synchronous-atomicity rules (F1, F3) and timeout layering (F5) are exactly where heisenbugs would hide; the badge-state misassignment (F2) would recreate cross-owner mutation the gate claims to forbid.

## Combined impact score: 7/10

High-value consolidation with real correctness risk concentrated in four specifiable gaps; all are addressable within the step's existing work packages without changing the design's shape.

## Recommended plan edits

1. (F1) Add to 3.1 and 3.4: synchronous busy/lease visibility and dequeue-time precondition re-validation; gate test for same-tick reconciler fencing.
2. (F2) Amend 3.3: `unread`/`unacknowledgedCompletion` stay registry/projection-derived; enumerate the exact fields that move.
3. (F3) Extend the actor contract with synchronous control operations (`childPid`/`killNow`, `pauseInput`/`resumeInput`); gate the fatal/EOF/slow-consumer paths.
4. (F4) Require the 3.1 classification table to name concurrent-vs-serialized reads explicitly, with latency-parity tests for `state` and `models_list` during runs.
5. (F5) Specify timeout ownership, mailbox bound + overflow code, and cancellation-policy vocabulary before 3.2 begins.
6. (F6) Pin abort-from-`compacting` and abort-from-`rebinding` behavior in the transition table.
7. (F7) Add a work package assigning the external-snapshot projection path and session-path publication across the registry/actor/coordinator seam.
8. (F9) State which step-2 domains must be fully retired before 3.2 starts.
9. (Gate) Replace the latency-bounds criterion with measured baselines or concrete ms thresholds; add timer control to 3.5's scheduler injection list; add a no-weakening clause for existing concurrency tests.
10. (F10) Add a `DEVELOPMENT.md` update line to the step-3 release gate.

## Final recommendation

**Revise.** The design direction, lane separation, and coordinator algorithm are sound and well-grounded in the existing code's proven invariants. Accept after amending the plan with the required findings F1-F7: none require redesign — all are specification gaps at seams where the current code carries subtle, test-pinned guarantees (synchronous fencing, process-tree reachability, concurrent reads, timeout ownership) that the actor rewrite could silently lose.
