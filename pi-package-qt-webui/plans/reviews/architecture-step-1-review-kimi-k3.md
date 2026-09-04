# Review of architecture step 1

## Verdict

Step 1 is directionally correct, correctly sequenced ahead of Steps 2–4, and unusually honest about its riskiest surface (the regex-pinned static QML contract tests). Its dependency-direction rule, per-extraction rollback, and "no behavior rewrite inside a move" constraint are the right guardrails for a codebase whose correctness currently lives in subtle closure-shared state in `main.mjs` (generation-checked session reconciliation, backpressure that pauses Pi children, exclusive/mutating operation fencing) and in a 1,123-line static test suite that pins functions to specific files.

However, the step as written has four material weaknesses: (1) the QML side of the canonical protocol registry is under-specified and the generation strategy chosen has real packaging and test-fidelity consequences the plan does not weigh; (2) `pi-session.mjs` — the second-largest file in the plan's own evidence table — has no Step 1 work package, leaving the target `features/session/` module unexplained; (3) the existing `npm run check` script silently stops syntax-checking backend code once the target subdirectories exist; and (4) several acceptance criteria are unmeasurable ("equivalent behavioral coverage", "no request-specific business rules"). None of these are fatal. All are fixable with plan edits before implementation begins. **Revise, then accept.**

## What is sound

- **Sequencing.** Doing boundary extraction (Step 1) before state ownership (Step 2) and actors (Step 3) is right. The current concurrency guards (`exclusiveTabOperations`, `mutatingTabOperations`, `registryPathGeneration`, `sessionSyncGeneration`) are exactly the kind of implicit coupling that must be made visible as named middleware before an actor model can replace them. The plan's Gate A ("same behavior, smaller ownership units") is the correct exit condition.
- **Baseline gate.** Requiring recorded characterization coverage and smoke traces *before* touching anything is essential here, because the existing `qml-contract.test.mjs` is structural, not behavioral: it asserts e.g. `functionBody(shell, "paletteActions")` and `functionBody(bridge, "refreshSessionCatalog")` exist in specific files. Any honest move of palette or catalog logic breaks these by construction, and without a recorded behavioral baseline there is no way to distinguish "test pinned to a file location" from "test pinned to a behavior".
- **Protocol v1 preservation.** The constraint "additive revision fields may be introduced under version 1; removing or changing existing event semantics requires a deliberate protocol version change" matches the evidence: `validateRequest` rejects `frame.v !== PROTOCOL_VERSION`, the bridge asserts `frame.v !== protocolVersion`, and the contract test cross-checks `PROTOCOL_VERSION`, `LIMITS`, and `REQUEST_TYPES` against QML literals. Step 1 does not touch this. Correct.
- **Transport extraction injection points.** "Inject output, clocks, timers, and fatal callbacks so transport tests do not start Pi" matches how `createBackend` already parameterizes `input`, `output`, `exit`, `onFatal`, and clocks — the extraction extends an existing seam rather than inventing one.
- **Lifecycle preservation.** The plan keeps startup, stdout failure, stdin EOF, signal handling, and `killProcessTreeNow` ownership outside feature handlers, which is where the current `fatal()`/`shutdown()`/`killAllNow()` triple lives. Not moving this in Step 1 is the right call; it is the highest-blast-radius code in the package.
- **Compatibility facade.** Keeping `BackendBridge.qml` as a forwarding facade while callers migrate one domain at a time is the only viable strategy given that `shell.qml` (1,749 lines) and every dialog bind directly to `bridge.*` properties and signals. A big-bang bridge replacement would be unreviewable.

## Findings

### F1 — High: QML protocol metadata generation is under-specified and the obvious implementation is the wrong one

**Evidence.** Work package 1.1 says "Generate or derive the QML protocol constants and request metadata from the same registry" and "Commit generated QML artifacts when runtime generation would complicate packaging." But the QML side cannot import JavaScript. The duplicated facts today are QML *source literals* — `readonly property int protocolVersion: 1`, `maxTranscriptRows: 80`, the `sessionScopedRequestTypes` object literal, `defaultRequestTimeoutMs` — each pinned by regex in `qml-contract.test.mjs` ("QML limits match the backend protocol budget"). Meanwhile a runtime derivation channel already exists: `hello` and `backend.ready` both carry `limits: LIMITS`, and the bridge already has `requestTimeouts` and `timeoutFor(type)` which prefers configured values over the default. Timeout and scope metadata therefore do not need source generation at all; they can be applied from the hello payload, leaving generation only for what must be static (bounded-model limits used before hello completes, e.g. `maxTranscriptRows` used by `appendRow`).

**Impact.** If implemented as naive "generate a `Protocol.qml`" the step (a) breaks every limits assertion that reads `BackendBridge.qml` source, (b) introduces a code generator that emits QML which must itself pass `qmllint` and be committed — a new failure class the release gate must police — and (c) risks a startup window where pre-hello UI uses stale generated constants. The acceptance criterion "QML and backend timeout and scope metadata cannot drift" is actually *better* served by runtime derivation than by committed artifacts, and the plan does not say which facts take which path.

**Proposed amendment.** Split 1.1's QML bullet into two rules: (1) request timeouts, scope, and limits that are only consumed after `hello` are applied from the hello payload at runtime — no generation; (2) only pre-hello rendering bounds (transcript rows, message characters) are generated into a committed artifact, with the no-diff regeneration check wired into `npm run check`. Add an acceptance criterion: "The bridge applies hello-delivered `requestTimeoutMs` verbatim; a backend timeout change requires no QML edit."

### F2 — High: No work package covers `pi-session.mjs` or maps existing modules to the target tree

**Evidence.** The plan's own evidence table lists `pi-session.mjs` at 1,493 lines with "Pi transport, mutable session state, transcript translation, helper calls, dialogs, and model controls share one owner." The target backend structure shows `features/session/` and `adapters/pi-rpc.mjs`. Yet work packages 1.1–1.3 address only `protocol.mjs`, transport, and `main.mjs`; 1.4–1.5 are QML. Nothing in Step 1 splits `pi-session.mjs`, and Step 3's ordering ("Move one `pi-session` responsibility at a time") is about actor migration, not module extraction. There is also no mapping for the 20 existing sibling modules (`tabs.mjs`, `resources.mjs`, `settings.mjs`, `state.mjs`, `store.mjs`, `transcript.mjs`, `markdown.mjs`, `highlight.mjs`, `sampling.mjs`, `sessions-index.mjs`, `sequences.mjs`, `attachments.mjs`, `workspace.mjs`) into the target `features/` vs `adapters/` split.

**Impact.** After Step 1 "completes," the second-worst file in the evidence table is untouched, `features/session/` either doesn't exist or is an unexplained re-export of the monolith, and reviewers cannot verify the dependency-direction rule because the current modules' target homes are unstated. The completion criterion "main.mjs and shell.qml are composition roots" is achievable while the actual session complexity is unmoved — a hollow victory that also makes Step 3's starting point ambiguous.

**Proposed amendment.** Add a module-by-module mapping table to 1.3 (existing file → target location → moved-as-is vs. split). State explicitly whether `pi-session.mjs` is split in Step 1 or deliberately deferred to Step 3; if deferred, remove `features/session/` and `adapters/pi-rpc.mjs` from the Step 1 target tree or mark them as Step 3 deliverables, and adjust the Step 1 outcome statement so it does not claim boundaries it does not create.

### F3 — High: `npm run check` silently stops covering new backend subdirectories

**Evidence.** `package.json` scripts: `"check": "... && for f in lib/backend/*.mjs; do node --check \"$f\" || exit 1; done && ..."`. The glob covers only top-level `lib/backend/*.mjs`. The target structure creates `lib/backend/protocol/`, `transport/`, `application/`, `features/`, `adapters/` — none of which match the glob.

**Impact.** From the first extraction onward, syntax errors in the new modules are not caught by the gate the plan itself designates as the release check. This is a concrete weakening of the test guarantee, introduced by the step's own target layout, and it will pass unnoticed because `node --check` failure of a non-matched file is silent.

**Proposed amendment.** Add to 1.3 (or the release gate): update the `check` script to a recursive enumeration (e.g. `find lib -name '*.mjs'`) in the same commit that creates the first subdirectory, and add a package-contract assertion that the check script covers every `lib/**/*.mjs` file. Note `files: ["lib", "qml"]` already packs subdirectories recursively, so packing is safe — but the release gate's `npm pack --dry-run` inventory comparison should be kept to prove it stays safe.

### F4 — Medium: Backpressure coupling is not fully accounted for in the transport boundary

**Evidence.** `engageBackpressure()` in `main.mjs` iterates `allTabs()` and calls `tab.session.pauseInput()`/`resumeInput()` on drain; `writeFrame` maintains `queuedRecords`, `droppedTotal`, `maxWritableLength`, `backpressurePauses` stats that are read by `hello` and `diagnostics`. Work package 1.2 lists output, clocks, timers, and fatal callbacks for injection, and the acceptance says "Transport modules know nothing about tabs, sessions, resources, Git, or themes" — but the plan never names the injection point for the consumer-pause fan-out or the stats snapshot.

**Impact.** Two failure modes: the extracted transport secretly keeps a reference to the registry (violating its own acceptance criterion), or backpressure pause/resume is dropped or re-implemented with different timing, weakening the memory-boundedness guarantee the plan promises to keep "byte-for-byte compatible."

**Proposed amendment.** Extend the 1.2 injection list with `onBackpressureChange(paused)` and a `statsSnapshot()` read API; add acceptance: "hello and diagnostics emit the identical stats fields as the baseline, sourced from the transport module."

### F5 — Medium: Session-sync coordinator extraction is the highest-risk move and has the weakest acceptance criteria

**Evidence.** The reconciliation loop in `main.mjs` (`reconcileSessionChange`, `validateMonitoredPaths`, generation re-checks across async boundaries, bounded backoff, `pendingSessionChanges` pruning) is ~200 lines of the most race-sensitive code in the package. Work package 1.3 moves it with one acceptance bullet: "Session synchronization and resource transaction tests instantiate their coordinators directly." Existing coverage (`session-sync.test.mjs`, `session-sync-integration.test.mjs`) exercises the backend through `createBackend`, which is good, but nothing in the acceptance requires the coordinator's *extracted* interface to preserve the generation-recheck ordering (registry generation and tab generation are sampled before the async load and re-verified after).

**Impact.** A mechanically "clean" extraction that hoists the generation reads across an await, or that changes the identity comparison (`pendingSessionChanges.get(pending.path) !== pending`), passes structural review and degrades a race guard that the current tests may not deterministically trigger.

**Proposed amendment.** Add acceptance: "The extracted coordinator's generation-check sequence is asserted by a test with a controlled async boundary (snapshot load interleaved with tab switch), not only by integration tests." This is cheap because `createBackend` already injects `loadSessionSnapshot` and `sessionSyncNow`.

### F6 — Medium: "Equivalent behavioral coverage" for replaced static tests is undefined

**Evidence.** Testing changes: "Keep existing static QML assertions until equivalent behavioral coverage exists. Replace assertions that require a private function to remain in a specific file with tests against the facade or controller behavior." Roughly half of `qml-contract.test.mjs` is `functionBody(bridge, …)` / `functionBody(shell, …)` regex assertions. QML has no unit-test harness in this repo; `qml-smoke.test.mjs` drives the full shell in smoke mode. "Focused QML tests" (1.4) has no named mechanism.

**Impact.** During the facade migration there will be a window where assertions are deleted faster than behavioral replacements land, and no gate measures the delta. Given that these static tests are currently the *only* coverage for accessibility names, shortcut lists, focus-return, and "never send accidentally" invariants, silent coverage regression is the most likely way Step 1 weakens guarantees while "passing."

**Proposed amendment.** Define the replacement mechanism (e.g., per-domain facade-level assertions on `BackendBridge`'s stable public surface, kept green throughout migration, plus the existing smoke markers), and add a release-gate item: "The count of smoke markers and accessibility/security assertion categories covered at baseline is covered at gate A; removals are itemized in the review."

### F7 — Low: Registry acceptance omits handler resolution and dual metadata semantics

**Evidence.** Today `REQUEST_TYPES` is derived as `Object.keys(LIMITS.requestTimeoutMs)`, so a type cannot exist without a timeout; `handlers[request.type]` is looked up dynamically, so a missing handler becomes a runtime `internal_error`. The QML `sessionScopedRequestTypes` and the backend `SESSION_MUTATION_REQUESTS` are *different* classifications (client callback-dropping scope vs. mutation fencing) that the registry must keep distinct. 1.1's acceptance ("Adding a request requires one registry entry and its handler implementation") doesn't require fail-fast handler resolution or distinct scope/mutation fields.

**Proposed amendment.** Add acceptance: "Registry validation at startup rejects entries lacking a timeout, validator, scope, mutation class, or resolvable handler; scope and mutation class are independent fields; existing per-request timeout values are unchanged (asserted against the baseline)."

## Missing tests or gates

1. **Registry completeness test**: every entry has timeout/scope/mutation class/validator/handler; startup fails on a dangling handler key; timeout table equals the recorded baseline.
2. **Generation drift check in `npm run check`**: the "regeneration produces no diff" check must run in the standard gate, not only on demand.
3. **Recursive `node --check`** for `lib/**/*.mjs` (see F3) plus a package-contract assertion over it.
4. **Hello-derivation test**: bridge timeouts/scope applied from hello payload; a registry timeout change propagates with no QML edit.
5. **Transport stats fidelity test**: `hello`/`diagnostics` stats fields identical to baseline after extraction; backpressure engages a fake `onBackpressureChange` and resumes on drain, including the "drain only fires after a false write" path documented in the current code.
6. **Coordinator interleaving test** for session sync (F5) and a resource rollback test instantiating the transaction coordinator directly with failing helper applies (the current `setResource` rollback paths are only reachable through the full backend).
7. **Coverage accounting gate** (F6): itemized mapping from removed static assertions to their behavioral replacements, checked at gate A.
8. **Packed-inventory diff** retained from baseline to prove new `qml/infrastructure/`, `qml/stores/`, `qml/controllers/` files ship in the tarball.

## Future changeability score: 7/10

As written, the step produces a real dependency direction, a single protocol metadata source, and injectable seams that Steps 2 and 3 genuinely need. It loses points because the session monolith's fate is unspecified (F2), the QML metadata strategy may produce generated artifacts that are themselves a change-resistance source (F1), and the facade strategy defers — rather than eliminates — the giant-bridge problem without a dated end to the compatibility period.

## Maintainability score: 7/10

Composition roots and named middleware are clear wins, and per-extraction rollback keeps the tree releasable. Docked for the silently degrading check script (F3), undefined coverage-equivalence (F6), and acceptance criteria a reviewer cannot objectively verify ("no request-specific business rules", "knows nothing about tabs").

## Combined impact score: 7/10

High expected benefit with moderate, well-identified execution risk. The risks are concentrated in QML facade migration and the two coordinator extractions — exactly where the plan is vaguest.

## Recommended plan edits

1. Split 1.1's QML bullet into runtime-derivation (preferred, via hello) vs. committed-generation (only pre-hello bounds); wire the no-diff check into `npm run check`. (F1)
2. Add an existing-module → target-module mapping table to 1.3; state explicitly whether `pi-session.mjs` is split now or deferred, and align the target tree and outcome text accordingly. (F2)
3. Make the `check` script recursive over `lib/` in the first subdirectory-creating commit; add a package-contract test for it. (F3)
4. Name the backpressure fan-out and stats snapshot as injected transport interfaces; require hello/diagnostics payload parity with baseline. (F4)
5. Add an interleaving test requirement for the session-sync coordinator and a direct-instantiation rollback test for the resource coordinator. (F5)
6. Define the behavioral-coverage replacement mechanism and add a gate-A coverage accounting item. (F6)
7. Strengthen 1.1 acceptance: fail-fast registry validation, distinct scope vs. mutation-class fields, unchanged timeout values asserted against baseline. (F7)
8. Add a sunset condition for the `BackendBridge.qml` facade (e.g., "facade reduced to re-exports by end of Step 1, removed in Step 2 domain cutovers") so the compatibility layer cannot become permanent.

## Final recommendation

**Revise.** The architecture, sequencing, and safety posture are sound and the step should proceed — but only after edits 1–3 (which close a real test-guarantee regression and an unexplained scope gap) are incorporated, and edits 4–8 are at least acknowledged in acceptance criteria. With those amendments, this step is a solid, verifiable foundation for Steps 2–4.
