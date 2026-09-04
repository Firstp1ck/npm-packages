# Review of architecture step 2

**Scope:** Step 2 ("backend-owned revisioned state") of `pi-package-qt-webui/plans/planned/qt-webui-architecture-refactor.md`, reviewed against the current Qt WebUI sources (`lib/backend/main.mjs`, `tabs.mjs`, `pi-session.mjs`, `protocol.mjs`, `session-sync.mjs`; `qml/BackendBridge.qml`, `shell.qml`) and tests (`tests/qml-contract.test.mjs`, `tab-activity-state.test.mjs`, `session-sync*.test.mjs`). Pi WebUI was checked for coupling: the only cross-package imports are resource helpers (`lib/backend/resources.mjs:5-10`, `lib/pi-extension/qt-webui-helper.mjs:2`), which Step 2 does not touch. No files were modified.

## Verdict

Revise before implementing. The direction is correct and well-targeted: it replaces at least five ad-hoc staleness mechanisms that genuinely exist today with one revision discipline, and the sequencing after Step 1's registry/stores is right. However, as written, Step 2 has two high-severity specification gaps — no backend-instance epoch for revision checks, and no defined contract for dropped/gapped patches under the existing slow-consumer drop policy — plus several acceptance criteria that cannot prove their claims and an undefined fit between the revisioned-projection model and the paginated session catalog. These are fixable with amendments, not a redesign.

## What is sound

- **The problem is real and correctly identified.** QML today duplicates backend authority for readiness, runtime, queues, dialogs, and resources (`BackendBridge.qml:931-962` `applySnapshot`), and correctness depends on event ordering (`tabs.mjs:234-244`: "The client switches on tabs.update, so it is sent before the transcript replay"), origin-tab response dropping (`BackendBridge.qml:330-334`), and three separate generation counters (theme `generation`, `BackendBridge.qml:534-545`; session catalog, `BackendBridge.qml:1097-1128`; prompt, `pi-session.mjs:410-436`; plus `staleGeneration` in `tabs.mjs:336-347`). One revision discipline replacing these is a genuine changeability win.
- **Separate revision streams** (`appRevision`, per-tab `tabRevision`, per-tab `transcriptRevision`) correctly preserve the existing dedup intent in `emitTabs` (`tabs.mjs:74-82`) — status churn must not invalidate unrelated state — and the acceptance "equal persisted snapshots do not advance transcript state unnecessarily" encodes this.
- **Additive-under-v1 protocol discipline** matches the constraint that existing event semantics stay; revision fields on events and responses are additive.
- **Conversion order is right:** low-traffic domains (settings/themes) first, transcript patches last. Transcript is the highest-traffic, highest-risk stream (`part.render`/`tool.update` are coalescable, `main.mjs:36`), and it depends on per-tab streams existing first.
- **Dual-write hazard is explicitly managed:** "Never keep both paths writing the same QML property after a domain is accepted," with per-domain rollback to a compatibility reducer. This is the correct migration posture.
- **Presentation state stays in QML** (focus, popups, scroll, unsent editor state), matching how `beginTabSwitch`/`resetTabState` (`BackendBridge.qml:921-927`) already separates ephemeral from durable state.
- **No Pi WebUI coupling** is introduced, which keeps Step 2 independent of Step 4's approval risk.

## Findings

### 1. No backend-instance epoch — revision checks are unsafe across restart (High, required)

**Evidence:** Revisions are per-domain counters owned by the backend process. The backend can restart (`backend.ready` → `hello` re-bootstrap in `BackendBridge.qml:1482-1503`; `failAllPending` at `:338-340`). After restart, counters reset toward zero. QML's rule "apply a message only when its revision is newer than the last applied revision" then fails both ways: a buffered pre-restart frame with revision 47 beats a post-restart store at revision 3 and overwrites authoritative state; and a post-restart snapshot at revision 3 is *rejected* as stale if QML kept the pre-restart high-water mark. Step 2 mentions restart handling ("Publish a complete app snapshot … after backend restart", "backend-restarted fixtures") but never defines an instance identity or reset rule.

**Impact:** The core guarantee of the step — "Replayed or delayed older messages cannot overwrite newer state" — is false across the one lifecycle event the package explicitly supports. This is a state-corruption hazard in exactly the scenario the release gate's smoke tests exercise.

**Proposed amendment:** Add a backend instance/epoch identifier (issued in `hello`/`backend.ready`, echoed in every state message). Reducers key last-applied revisions by `(epoch, domain, tab)` and reset on epoch change. Add a release-gate test: a delayed pre-restart frame with a higher revision than current must be rejected after restart.

### 2. No contract for dropped or gapped patches under slow-consumer drops (High, required)

**Evidence:** The outbound queue drops non-essential frames when over budget (`main.mjs:105-135`; `COALESCABLE_EVENTS = {"part.render","tool.update"}` at `main.mjs:36`). Step 2 says QML "applies a message only when its revision is newer" — i.e., gaps are tolerated — but never states (a) which state messages are essential vs. coalescable, (b) whether patches must be self-contained full replacements, or (c) what happens on a detected gap. Today this is accidentally safe for streaming text because `handlePartRender` (`BackendBridge.qml:1461-1473`) replaces the whole row payload each time, so a later patch heals an earlier drop. That invariant is nowhere written down, and new patch types (e.g., row `remove`, queue updates) may not be self-healing.

**Impact:** Silent, persistent divergence between backend truth and QML projection — worse than today's behavior, where dropped coalescable frames only lose intermediate pixels of an eventually-restated row. The release-gate bullet "missing … revisions" tests existence of gap tests, but the *behavioral contract* they must verify is undefined, so the tests can't prove convergence.

**Proposed amendment:** State three invariants in 2.2: (a) every published patch fully replaces the keys it touches (no deltas); (b) state messages are classified per stream — transcript row patches coalescable per `(tab, rowId)` keeping the latest, tab/app patches essential or coalesced per `(domain, tab)`; (c) on a revision jump greater than one for a non-self-healing stream, QML requests a fresh snapshot for that domain/tab. Add a forced-drop convergence test (drive the queue over budget, assert final projection equality with backend state).

### 3. Session catalog does not fit the pushed-projection model (Medium, required)

**Evidence:** The catalog is paginated and on-demand: `sessions_list` takes `offset` (`protocol.mjs` `sessions_list` validation; `LIMITS.maxSessionListEntries: 200`, `maxSettledSessions: 2048`), and QML merges pages under a client-side generation counter (`BackendBridge.qml:1097-1128`). Conversion item 5 lists "session catalog" as a revisioned domain without saying whether pages become pushed state (bounds problem — up to 2048 settled entries) or stay request/response (then what does its revision mean, and what protects page-merge ordering once the generation counter is retired under 2.4?).

**Impact:** Either an unbounded projection that violates the step's own "bounded projection shapes" goal, or a hybrid whose staleness guard is silently weaker than today's generation counter.

**Proposed amendment:** Scope the revisioned catalog projection to *status/invalidation only* (the current `sessions.changed` semantics plus a revision). Keep paged reads as request/response tagged with the catalog revision at fetch time; a page response is merged only if the store's catalog revision still matches. State this explicitly in 2.1/2.3 and add a test for invalidation mid-pagination.

### 4. Retiring origin-tab dropping breaks read-response routing unless responses become routable (Medium, required)

**Evidence:** Responses carry no tab or revision (`makeResponse(id, data)`, `protocol.mjs`). The origin-tab guard (`BackendBridge.qml:330-334`) currently *drops* late session-scoped responses. 2.4 replaces dropping with "revision and owner checks," and 2.2 adds revision metadata only to *mutating* command responses. But session-scoped *reads* also mutate QML today: `tab_select`/`tab_open` responses call `applySnapshot` (`BackendBridge.qml:964-998`), and picker reads are guarded by `originTab` + `composerPickerGeneration` (`shell.qml` per `qml-contract.test.mjs:566-571`). With per-tab stores, the correct evolution is originTab-as-*routing-key* into the origin tab's store, not removal — but the plan doesn't say responses retain a routing key, and "owner checks" can't work if a response can't name its owner.

**Impact:** Either late read responses still target the active tab (regression of the bug originTab dropping prevents), or implementors keep the drop behavior and the 2.4 acceptance "a tab switch does not require callbacks to mutate whichever tab happens to be active later" is only half-achieved.

**Proposed amendment:** In 2.2, require every session-scoped response to be routable to its origin tab (client-side pending-entry key is sufficient; it already exists at `BackendBridge.qml:312`). Amend 2.4 to "replace origin-tab callback *dropping* with origin-tab *routing* into per-tab stores plus revision checks," and add a test that a delayed `state` response for tab A updates tab A's store while tab B is active.

### 5. Per-tab projection lifecycle and QML memory bounds are undefined (Medium, required)

**Evidence:** Today QML keeps only the active tab's transcript and resets on switch (`beginTabSwitch` → `resetTabState`, `BackendBridge.qml:921-927`); the backend mirror replays on select (`tabs.mjs:128-132`, `:236-244`). With per-tab `transcriptRevision`, the plan doesn't say whether inactive-tab projections are retained in QML (memory: `maxTabs: 8` × `maxTranscriptRows: 80` rows with `blocksJson`) or dropped and re-snapshotted. If dropped, the last-applied revision for that tab must also be reset — otherwise a re-selection snapshot at an equal revision is wrongly rejected, or a stale delayed patch reapplies onto a fresh store.

**Impact:** A subtle class of tab-switch bugs (the exact class the step's fixtures target) and an unquantified memory regression risk, with no gate measuring either.

**Proposed amendment:** Define the lifecycle explicitly (recommended: drop transcript projection on switch away, reset that tab's transcript high-water mark, re-snapshot on selection — mirroring today's replay economics). Add a release-gate bound: maximum retained projection bytes/rows in QML, asserted in a contract test.

### 6. Revision minting location is unspecified, which undermines the "committed-only" guarantee and Step 3 (Medium, required)

**Evidence:** 2.2 says "Add monotonic revisions to registry and session projections" but not *where* revisions are minted. Today state mutations are scattered across closures in `main.mjs` (session-sync reconciliation at `main.mjs:177-365`), `tabs.mjs` (`handleSessionEvent`, `:181-232`), and `pi-session.mjs`. If handlers bump revisions inline, "revisions increase only after committed state changes" is unenforceable, and Step 3 — which requires actors to "publish state only after a transition commits" — inherits a mess.

**Impact:** Rework in Step 3 and a likely source of revision-ordering bugs (revision bumped, then mutation throws → gap; or mutation commits without a bump → stale client).

**Proposed amendment:** Add a 2.2 work-package line: each domain has exactly one projection builder that owns revision minting and emission, called after the underlying store commit succeeds. Acceptance: a fault-injection test where a failed commit (e.g., resource rollback, `state.saveTabs` throw at `tabs.mjs:84-92`) publishes no revision advance.

### 7. Several acceptance criteria cannot prove their claims (Low, required)

- 2.1 "Every mutable value has one named owner" and "QML does not infer backend state from unrelated flags or event order" name no verification method. Given the package's existing mechanism (static property/regex assertions in `tests/qml-contract.test.mjs`, e.g. `:894`'s list of cleared fields, `:481-484` originTab assertions), the natural proof is a mechanical ownership contract test enumerating store properties → owning domain. **Amendment:** require that test.
- Release gate "QML owns no duplicate copy of backend readiness, runtime, queue, dialog, or resource authority" is aspirational without a named inspection. **Amendment:** a contract test asserting those property names exist only in the domain stores, not in bridge/controllers/views.
- 2.2 "Revisions increase only after committed state changes" is stated per-domain in acceptance but the corresponding tests live only in the release gate. **Amendment:** tie each domain's cutover acceptance to its own committed-only test.

### 8. Revision metadata on mutating-command responses has no stated consumer (Low, optional)

**Evidence:** 2.2 "Return resulting revision metadata from mutating commands" — no work package says what QML does with it. There is a plausible consumer: replacing ad-hoc pending-flag clearing (`modelActionPending`, `resourceActionPending`, `resourceLoading` reset in `pi.started`/`pi.exit` handlers, `BackendBridge.qml:1536-1557`) with "clear pending flag when store revision ≥ returned revision." But unstated, it risks becoming dead protocol surface that constrains Step 3.

**Proposed amendment:** Either name the consumer (pending-flag settlement on applied revision) with a test, or drop the checkbox.

### 9. Notices are classified as a projection but are transient events (Low, optional)

**Evidence:** 2.1 defines "notice projection shapes," yet notices (`postNotice`, `handleInactiveTabEvent`, `BackendBridge.qml:1311-1330`) are fire-and-forget toasts, and the conversion order omits them. Revisioning transient notifications adds ordering machinery with no divergence problem to solve.

**Proposed amendment:** Keep notices as validated events; remove "notice" from the projection shapes or justify what state a notice projection owns.

### 10. Selector ownership is unstated (Low, optional)

**Evidence:** "Define selectors for derived values such as activity state" (2.1). `activityState` is currently computed backend-side in tab summaries (`tabs.mjs:56-67`) and covered by `tests/tab-activity-state.test.mjs`. If selectors also live in QML, derived-value drift — one of the bugs this step exists to kill — returns.

**Proposed amendment:** State the rule: derived values consumed across tabs or by badges are computed once in the backend projection; QML selectors are pure functions over store state for presentation-only derivation.

## Missing tests or gates

1. **Epoch/restart rejection test** — delayed pre-restart frame with higher revision must not apply post-restart (the gate's "backend-restarted fixtures" must assert on epoch+revision, not just snapshot replacement).
2. **Forced-drop convergence test** — drive the outbound queue over budget (`LIMITS.maxQueuedBytes`, `main.mjs:117`), drop a patch, assert eventual projection equality; proves the self-healing invariant of Finding 2.
3. **Coalescing classification test** — which state message types are essential vs. coalescable, asserted against the transport policy.
4. **Ownership contract test** — mechanical enumeration replacing today's fragile regex assertions on bridge internals (`qml-contract.test.mjs:464,481-484,894`); this also de-risks Step 1's facade retirement.
5. **Inactive-tab projection lifecycle test** — switch away and back with interleaved patches for the departed tab; assert no stale reapplication and no rejected fresh snapshot.
6. **Catalog invalidation-mid-pagination test** (Finding 3).
7. **Late read-response routing test** (Finding 4).
8. **QML memory/bounds gate** — maximum retained projection size across `maxTabs` tabs.
9. **Committed-only revision test with fault injection** — failed `state.saveTabs` / resource rollback publishes no revision advance (the gate covers resource rollback; settings/state persistence is not covered).

## Future changeability score: 7/10

As written. One revision discipline replacing five ad-hoc mechanisms, per-domain stores, and a facade-free bridge mean most routine features (a new tab-scoped field, a new dialog kind, a new queue) would touch one projection builder and one store — a large improvement over today's four-file protocol fact duplication. Held back from 8+ by: the catalog/response-routing ambiguities (Findings 3–4), which leave two domains still requiring cross-cutting reasoning; and the unspecified revision-minting location (Finding 6), which determines whether Step 3's actor transition lands cleanly or forces a rebuild of Step 2's emission logic. With the required amendments, this becomes 8/10.

## Maintainability score: 6/10

As written. Ownership intent is excellent, but ownership *enforcement* is aspirational: the two most important acceptance claims (single owner per value; no duplicate authority in QML) have no named mechanical check, and the two highest-risk invariants (epoch safety, gap convergence) are unspecified, so defects there would be hard to prevent and hard to diagnose — a stale-overwrite across restart would present as intermittent UI corruption with no distinguishing diagnostic. The existing test culture (`qml-contract`, `session-sync` integration tests) shows the team can build these gates; the plan just doesn't require them. With amendments: 8/10.

## Combined impact score: 6/10

The step attacks the right problem with the right shape and honest rollback rules, but shipping it as written would bake two under-specified invariants into the protocol layer where they are expensive to fix later and would leak rework into Step 3.

## Recommended plan edits

Required:
1. Add a backend instance epoch to every state message; reducers key `(epoch, domain, tab)` and reset on epoch change; add the restart-rejection test to 2.2 acceptance and the release gate. *(Finding 1)*
2. In 2.2, define patch self-containment, per-stream essential/coalescing classification, and the gap policy (tolerate-with-full-replacement, else resync); add the forced-drop convergence test. *(Finding 2)*
3. Re-scope the catalog domain to revisioned invalidation + revision-tagged paged reads; state the page-merge guard. *(Finding 3)*
4. Amend 2.4 to origin-tab *routing* (not just dropping) and require all session-scoped responses to be tab-routable; add the late-read-response test. *(Finding 4)*
5. Define inactive-tab projection lifecycle and revision reset-on-drop; add a QML projection memory bound to the release gate. *(Finding 5)*
6. Require one projection builder per domain as the sole revision minter, called post-commit; add fault-injection committed-only tests per domain. *(Finding 6)*
7. Replace aspirational acceptance lines with named mechanical checks (ownership contract test; duplicate-authority property test). *(Finding 7)*

Optional:
8. Name the consumer for command-response revision metadata (pending-flag settlement) or drop the checkbox. *(Finding 8)*
9. Keep notices as events, not projections. *(Finding 9)*
10. State the selector-ownership rule (backend computes cross-tab derived values; QML selectors are presentation-pure). *(Finding 10)*

## Final recommendation

**Revise.** Accept the architecture, the stream split, the conversion order, and the dual-write discipline unchanged. Block implementation start on amendments 1–7; they are specification-level edits, not redesign, and each closes a hole that would otherwise produce either a correctness regression (restart overwrite, silent divergence, mis-routed late responses) or unprovable release-gate claims. Step 2 should not begin until the epoch, gap-convergence, and revision-minting invariants are written into the plan, because Step 3's actor transition model depends on all three.
