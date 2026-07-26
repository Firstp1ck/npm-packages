# Pi WebUI Experience Improvement Plan

- **Plan status:** Active
- **Last verified:** 2026-07-26
- **Package:** `@firstpick/pi-package-webui` v0.7.6
- **Verified revision:** `14a94d5a979a4ac0db89c03c9d260d45f1ac52bd`
- **Scope:** User experience, accessibility, information architecture, performance, reliability, offline behavior, and maintainability.

## Objective

Deliver the smallest evidence-backed changes that restore the release baseline, make offline behavior coherent, improve accessibility and transport reliability, and establish browser-level regression coverage before larger information-architecture or modularization work.

## Tracking conventions

### Status

| Status | Meaning |
|---|---|
| `TODO` | Approved backlog item; work has not started. |
| `IN PROGRESS` | An owner is actively implementing the item. |
| `BLOCKED` | A named dependency or decision prevents progress. |
| `VERIFY` | Implementation is complete; acceptance gates still need to pass. |
| `DONE` | Acceptance gates passed and evidence is recorded. |
| `DEFERRED` | Intentionally postponed; rationale must be recorded. |

### Priority

- **P0:** Directly evidenced release or offline-correctness blocker.
- **P1:** Significant accessibility or reliability gap with a concrete implementation path.
- **P2:** Improvement whose user/performance benefit is unmeasured, or work gated by profiling, usability validation, or earlier coverage.

When an item changes, update its **Status**, **Owner**, **Last update**, and **Verification record**. Do not mark an item `DONE` from source inspection alone when its gate requires a browser, assistive technology, or load harness.

## Verified baseline

| Check | Current result | Evidence |
|---|---|---|
| Test suite | **54/55 test files pass**; `mobile-static.test.mjs` fails. | `tests/mobile-static.test.mjs:297-301`; parent and both reviewers reproduced the failure with `npm test`. |
| Typography floor | One interface declaration is below the declared `0.75rem` floor. | `public/styles.css:76-77,7360-7364`. |
| Offline import closure | Three eager modules imported by `app.js` are absent from `APP_SHELL`. | `public/app.js:1-5`; `public/service-worker.js:2-17,74-76`. |
| Runtime service-worker writes | Cache writes are not attached to the fetch-event lifetime. | `public/service-worker.js:45-52,63-76`. |
| SSE backpressure | SSE writes ignore `res.write()` backpressure; no queue cap or stalled-client policy was found. | `bin/pi-webui.mjs:1144-1149,12434-12482`. |
| Browser/a11y automation | Package tests are Node/static harnesses; no package-owned Playwright or axe dependency exists. | `tests/run-all.mjs:7-15`; `package.json`. A separate developer Puppeteer driver exists at `dev/scripts/voice-browser-validation.mjs`, so the previous “no browser flow anywhere” wording was too broad. |
| Native browser dialogs | **13** native `prompt`/`confirm`/`alert` calls: 12 qualified as `window.*`, one unqualified `prompt`, comprising 11 direct interactions and 2 compatibility fallbacks. | Current call sites: `public/app.js:3024,3064,7321,13410,13485,13556-13558,17847,20220,20255,21820,23350,27702`. |
| Dialog names | 17 native `<dialog>` elements; only one has an explicit `aria-label`/`aria-labelledby`. | `public/index.html:865-1158`. |
| Forced colors | No `forced-colors` or `prefers-contrast` rules found. | `public/styles.css`. |
| Touch targets | Coarse/mobile rules override the product's global 44px floor with 28–36px controls. | `public/styles.css:11423-11458,11655-11702`. |
| Live transcript | `#chat` and several adjacent surfaces are live regions. | `public/index.html:113-123`. |
| Tab semantics | Terminal and Stats tablists lack complete roving focus, keyboard, and ownership semantics. | `public/index.html:66,994`; `public/app.js:9404-9518,19247-19261`. |
| Frontend size | `app.js`: 33,035 lines / 1,480,594 B; CSS: 13,787 / 406,459 B; HTML: 1,173 / 86,849 B. | Measured with `wc -l -c`. Size is verified; startup impact is not yet profiled. |
| API execution bounds | Shared `api()` has no default timeout/retry policy; most callers provide no timeout signal. | `public/app.js:3771-3801`. |
| Inactive transcript cache | Full message arrays remain cached for every live tab without a byte/count budget. | `public/app.js:580,8172-8173,29102-29116`. Memory impact is not yet profiled. |

The earlier unscoped repository-count provenance has been removed as a quality claim: `git ls-files` currently reports 182 tracked files, while the goal-focused explorer index contains 143 files. Counts must always state their command and scope.

## Priority list

### P0 — restore release and offline correctness

| Order | ID | Work item | Status | Owner | Effort | Depends on | Completion gate | Last update |
|---:|---|---|---|---|---|---|---|---|
| 1 | **P0-01** | Restore the typography floor and green suite | `TODO` | — | S | — | All 55 test files pass; compact tool header visually checked | 2026-07-26 |
| 2 | **P0-02** | Make service-worker precaching, writes, and revisions coherent | `TODO` | — | M | — | Import-closure tests pass; cache writes are event-lifetime-safe; installed offline/update smoke passes | 2026-07-26 |

### P1 — accessibility and reliability

| Order | ID | Work item | Status | Owner | Effort | Depends on | Completion gate | Last update |
|---:|---|---|---|---|---|---|---|---|
| 1 | **P1-01** | Add package-owned Playwright and axe smoke coverage | `TODO` | — | M–L | P0-02 for offline checks | Required headless flow passes; axe has no serious/critical violations in scoped views | 2026-07-26 |
| 2 | **P1-02** | Replace transcript streaming announcements with one lifecycle announcer | `TODO` | — | S–M | P1-01 | No token-delta announcements; lifecycle transitions verified with a screen reader | 2026-07-26 |
| 3 | **P1-03** | Complete terminal and Stats tab semantics | `TODO` | — | M | P1-01 | Keyboard matrix and axe ownership checks pass | 2026-07-26 |
| 4 | **P1-04** | Replace direct native dialogs and name every application dialog | `TODO` | — | M | P1-01 | Only approved compatibility fallbacks remain; dialog focus/validation tests pass | 2026-07-26 |
| 5 | **P1-05** | Add forced-colors support and audit contrast/touch targets | `TODO` | — | M | P1-01 | Forced-colors manual check, rendered contrast audit, and target-size policy check pass | 2026-07-26 |
| 6 | **P1-06** | Bound SSE slow-client buffering | `TODO` | — | M | — | Stalled-client harness proves byte/time bounds; healthy-client ordering remains correct | 2026-07-26 |
| 7 | **P1-07** | Add request-class timeouts and safe retry UI | `TODO` | — | M–L | P1-01 | Half-open requests leave busy state; non-idempotent mutations are never replayed | 2026-07-26 |

### P2 — evidence-gated UX and maintainability

| Order | ID | Work item | Status | Owner | Effort | Depends on | Completion gate | Last update |
|---:|---|---|---|---|---|---|---|---|
| 1 | **P2-01** | Profile startup and multi-tab memory before optimization | `TODO` | — | S–M | P1-01 | Reproducible baseline records parse/compile/boot and heap behavior | 2026-07-26 |
| 2 | **P2-02** | Add an inactive-tab transcript budget if profiling justifies it | `BLOCKED` | — | M–L | P2-01 | Budget/eviction tests and authoritative reactivation refetch pass | 2026-07-26 |
| 3 | **P2-03** | Prototype and validate Control Deck/status consolidation | `TODO` | — | M–L | P1-01, P2-04 before Commands removal | Capability parity, keyboard access, persisted-state migration, and usability check pass | 2026-07-26 |
| 4 | **P2-04** | Improve command-palette ranking, grouping, recents, and index invalidation | `TODO` | — | M | P1-01 | Deterministic ranking/invalidation tests and keyboard behavior pass | 2026-07-26 |
| 5 | **P2-05** | Narrowly improve the working-folder picker | `TODO` | — | S–M | P1-01 | Back/breadcrumb/pinned/hidden-filter navigation and inline errors pass | 2026-07-26 |
| 6 | **P2-06** | Incrementally extract frontend modules after profiling and coverage | `BLOCKED` | — | L–XL | P0-02, P1-01, P2-01 | One feature per change; behavior parity and before/after measurements recorded | 2026-07-26 |
| 7 | **P2-07** | Finish low-priority accessibility structure and tooltip audit | `TODO` | — | S | P1-01 | Skip link/heading structure verified; remaining hover-only tooltips have focus equivalents | 2026-07-26 |

## Workstream details

### P0-01 — Restore the typography floor and green suite

**Evidence verdict:** Confirmed by both reviewers and the parent; confidence **100/100**.

**Scope**

- Replace `.compact-tool-shell .message-role { font-size: 0.72rem; }` with `var(--text-xs)`.
- Do not weaken or remove the floor assertion.

**Acceptance and verification**

- [ ] `node tests/mobile-static.test.mjs` exits 0.
- [ ] `npm test` reports all 55 test files passed.
- [ ] Compact normal/fast tool-role labels remain readable and truncate without layout regression.

**Risk:** The release-confidence impact is verified. “Hard to read” was not measured with users and should not be presented as a completed readability study.

### P0-02 — Service-worker correctness

**Evidence verdict:** Missing eager imports and detached cache writes are confirmed; real-browser offline failure/update behavior is source-derived but not yet reproduced. Confidence **98/100** for the defects, **80/100** for observed user impact.

**Scope**

1. Immediately add the missing eager closure: `aur-review-payload.mjs`, `guided-git-command-state.mjs`, and `guided-git-review-state.mjs`.
2. Add a recursive contract test proving every static import reachable from `app.js` is both server-served and precached.
3. Attach runtime `cache.put()` work to `event.waitUntil()` or return/await it through the fetch handler.
4. Replace independently maintained cache/query revisions with one generated revision source or content hashes. If no build step is introduced, add a contract test that enforces coordinated revisions.
5. Keep future lazy modules inside the same closure/revision policy.

**Acceptance and verification**

- [ ] Import-closure test fails when a reachable eager module is removed from `APP_SHELL`.
- [ ] Static-server allowlist test covers the same closure.
- [ ] Fetch-event test proves runtime cache writes remain inside the event lifetime.
- [ ] Fresh install can load once online, then cold-reload offline without a module fetch failure.
- [ ] Online update followed by offline reload serves one coherent asset revision.
- [ ] Activation removes obsolete caches only after the replacement is ready.

**Risks:** `skipWaiting`, multiple open clients, and cache-name churn can produce mixed revisions. A generated graph is preferred only if its build/release step becomes canonical; a closure test plus shared manifest is the smaller immediate fix.

### P1-01 — Browser and accessibility smoke harness

**Evidence verdict:** The package lacks owned browser/axe automation; a separate developer Puppeteer flow exists and should be reused where practical. Confidence **99/100**.

**Scope**

- Add a hermetic server/fake-Pi fixture.
- Add Playwright smoke coverage for first load, prompt/stream completion, reconnect reconciliation, dialogs/focus, terminal and Stats keyboard navigation, mobile viewport, and offline/update behavior.
- Add axe checks for stable critical views.
- Keep visual regression as a later, small matrix rather than blocking the initial harness.

**Acceptance and verification**

- [ ] `npm run test:browser` runs headlessly from a clean checkout.
- [ ] CI caches/installs the browser deterministically.
- [ ] Animations, timestamps, and generated IDs are controlled for stable assertions.
- [ ] Serious/critical axe findings are zero or explicitly waived with rationale.

### P1-02 — Streaming lifecycle announcements

**Evidence verdict:** Competing live regions are source-confirmed; screen-reader overload remains unmeasured until manual execution. Confidence **94/100**.

**Scope and gates**

- [ ] Remove `aria-live` from `#chat`.
- [ ] Add one atomic lifecycle announcer for started, tool running, completed, and failed states.
- [ ] Deduplicate reconnect/replay transitions.
- [ ] Verify token deltas announce nothing and one lifecycle message is emitted per state transition with at least one screen reader.

### P1-03 — Terminal and Stats tab semantics

**Evidence verdict:** Confirmed. Confidence **99/100**.

**Scope and gates**

- [ ] Reuse/extract the existing Git-panel roving-tab pattern.
- [ ] Add stable IDs, selected-only `tabindex="0"`, Arrow/Home/End behavior, focus transfer, `aria-controls`, and named tabpanels.
- [ ] Define grouped terminal controls correctly as tabs, disclosures, or separate controls rather than mixing semantics.
- [ ] Verify top, left, mobile, and grouped layouts without breaking drag/drop.

### P1-04 — Application dialogs and accessible names

**Evidence verdict:** Confirmed; the old count of 12 was stale. Confidence **100/100**.

**Scope and gates**

- [ ] Migrate rename/move, commit/tag, repository/branch, feedback, and session-name interactions first.
- [ ] Give all 17 existing dialogs explicit accessible names.
- [ ] Preserve only documented compatibility fallbacks; add an AST/static policy test for direct native calls.
- [ ] Verify initial focus, Escape/cancel, validation, consequences, busy state, error recovery, and focus return.

**Risk:** Two current native calls are fallbacks for missing `<dialog>` support. Remove them only if dropping that compatibility path is deliberate.

### P1-05 — Forced colors, contrast, and target sizes

**Evidence verdict:** Missing forced-colors rules, unnamed dialogs, and sub-44px product-floor overrides are confirmed. Raw Catppuccin overlay contrast is low on opaque backgrounds, but effective composited/custom-theme contrast is not yet measured. Confidence **96/100** for static gaps, **75/100** for rendered contrast impact.

**Scope and gates**

- [ ] Add a usable `forced-colors: active` presentation for controls, focus, selection, dialogs, and status.
- [ ] Define the product target-size policy and document justified compact exceptions; do not misstate 44px as the WCAG AA minimum.
- [ ] Measure rendered normal-text contrast across supported themes and fix failures against the 4.5:1 target.
- [ ] Verify with a forced-colors browser/manual run and coarse-pointer viewport coverage.

### P1-06 — SSE slow-client bounds

**Evidence verdict:** Missing backpressure handling is confirmed; system-wide latency/memory impact is unmeasured. The reviewers disagreed on P0 versus P1. Parent disposition: **P1** until a slow-consumer harness demonstrates release-blocking impact. Confidence **97/100** for the gap, **72/100** for current user impact.

**Scope**

1. Add a deterministic slow-response harness.
2. Stop normal writes after `res.write()` returns false; resume on `drain`.
3. Track an explicit per-client queued-byte/time limit and evict clients that exceed it.
4. Preserve ordered final/error/control events and clean up timers/listeners.
5. Treat token-delta coalescing as a separate, conditional optimization because it changes event semantics.

**Acceptance and verification**

- [ ] Stalled clients remain under the documented cap or are disconnected within the documented bound.
- [ ] Healthy clients receive complete, ordered normal and compact output.
- [ ] Keepalives do not bypass a blocked queue.
- [ ] Cleanup removes listeners, queues, and intervals.

### P1-07 — Request timeouts and safe retry

**Evidence verdict:** Confirmed gap; production hangs are not measured. The reviewers disagreed on P1 versus P2. Parent disposition: **P1** because half-open requests can leave core controls indefinitely busy, while implementation must remain conservative. Confidence **97/100**.

**Scope and gates**

- [ ] Inventory endpoints as read, bounded mutation, long-running mutation, or streaming.
- [ ] Give request classes explicit bounds; allow justified caller overrides.
- [ ] Automatically retry only bounded idempotent reads.
- [ ] Never replay commit, push, update, worktree, or other non-idempotent operations automatically.
- [ ] Distinguish timeout from backend-offline state and return controls from busy state.
- [ ] Add half-open and duplicate-mutation harnesses.

### P2-01/P2-02 — Measure, then budget transcript memory

**Evidence verdict:** Full-array retention is confirmed; material mobile memory pressure is not. Confidence **97/100** for behavior, **70/100** for impact.

**Decision gate**

- [ ] Record heap behavior for representative long transcripts and multiple live tabs.
- [ ] If material, define a total byte/count budget with LRU eviction and a bounded inactive tail.
- [ ] On an evicted-tab activation, use the existing authoritative full-history path without corrupting delta/session keys.
- [ ] Consider viewport virtualization only after active-tab profiling identifies rendering as the bottleneck.

### P2-03/P2-04 — Information architecture and command discovery

**Evidence verdict:** Eleven sections, exclusive accordion behavior, overlapping command surfaces, and duplicated field rendering are confirmed. Reduced cognitive load and the need for one literal status surface are unvalidated design hypotheses. Parent disposition: **P2 prototype**, not direct refactor. Confidence **94/100** for structure, **70/100** for expected UX benefit.

**Sequence**

1. Allow multiple related sections to remain open and migrate persisted section state.
2. Improve palette grouping/recents and preserve command metadata.
3. Prototype task groups: Context, Files/Git, Usage, Extensions, Subagents, Diagnostics, and Settings.
4. Define a status-field ownership matrix and shared selectors; keep contextual summaries where they help.
5. Remove the Commands accordion only after palette capability/discoverability parity is demonstrated.

**Acceptance and verification**

- [ ] Every existing control and command remains reachable by keyboard.
- [ ] Scope labels and optional-extension states remain visible.
- [ ] Stored section preferences migrate safely.
- [ ] Shared selectors produce consistent status labels/actions.
- [ ] A lightweight usability check supports the final grouping before broad markup churn.

### P2-05 — Working-folder picker

**Evidence verdict:** Partly stale/resolved. “Fast picks” and missing Back/breadcrumb behavior remain; Parent/root navigation and inline error handling already exist. Confidence **99/100**.

**Narrow scope and gates**

- [ ] Rename “Fast picks” to “Pinned folders”.
- [ ] Add Back history and breadcrumb segments; clarify root/Home terminology.
- [ ] Add an explicit hidden-directory filter.
- [ ] Define whether “ignored” means hidden, Git-ignored, or application-configured before implementing ignored filtering.
- [ ] Preserve current Parent/root actions and inline permission errors.

### P2-06 — Incremental modularization

**Evidence verdict:** File size is measured; startup-cost and maintainability gains are not yet profiled. Parent disposition: **blocked** on PWA correctness, browser coverage, and profiling. Confidence **98/100** for size, **70/100** for expected performance benefit.

**Execution rule**

- Extract one low-coupling feature per change, beginning only after profiling identifies a worthwhile seam.
- Record behavior parity, raw/transferred bytes, parse/compile/interaction timing, and service-worker closure for every extraction.
- Lazy-load only dormant features whose measured startup benefit outweighs state-boundary complexity.

### P2-07 — Low-priority accessibility structure

- [ ] Add a skip link targeting the transcript/main workspace.
- [ ] Establish one meaningful visible or screen-reader-only top-level heading for the operational UI.
- [ ] Audit only the remaining tooltip selectors; many already have `:focus-visible` equivalents, so the earlier blanket concern was overstated.

## Recommendation reconciliation

| Original recommendation | Verification result | Plan disposition |
|---|---|---|
| R01 typography floor | Confirmed | P0-01, unchanged priority |
| R02 offline import closure | Confirmed; wording/line detail stale | Merged into P0-02 |
| R03 SSE buffering | Missing control confirmed; impact unmeasured | P1-06; coalescing conditional |
| R04 browser testing | Partly confirmed; separate dev Puppeteer flow exists | P1-01 package-owned harness |
| R05 Control Deck IA | Structure confirmed; UX benefit untested | P2-03 prototype |
| R06 canonical status surface | Duplication confirmed; inconsistency not demonstrated | P2-03 ownership matrix/shared selectors |
| R07 native prompts | Confirmed; current total is 13, not 12 | P1-04 |
| R08 a11y pass | Static gaps confirmed; rendered contrast needs measurement | Split across P1-04 and P1-05 |
| R09 transcript live region | Static behavior confirmed; screen-reader effect unmeasured | P1-02 |
| R10 tab semantics | Confirmed | P1-03 |
| R11 modularization | Size confirmed; benefit unprofiled | P2-06, blocked on gates |
| R12 palette | Implementation description confirmed; perf benefit unmeasured | P2-04 |
| R13 request timeouts | Confirmed | Promoted to P1-07 |
| R14 transcript memory | Retention confirmed; impact unprofiled | P2-01/P2-02 decision gate |
| R15 folder picker | Partly stale/resolved | Narrowed P2-05 |
| R16 cache lifecycle/revisions | Confirmed; priority inconsistent with R02 | Merged and promoted into P0-02 |

## Preserved strengths, stated conservatively

Current source contains useful mechanisms that should be regression-tested rather than treated as measured UX outcomes:

- Keyed prefix reconciliation reuses unchanged transcript DOM.
- Streaming output is scheduled/coalesced rather than fully rebuilt per token.
- Focus/page-show/online reconciliation refreshes authoritative server state.
- Static assets use compression and ETags.
- Event logs have an explicit retention bound.
- Attachment object URLs are revoked during cleanup.
- A substantial empty state and native `<dialog>` infrastructure exist.

The previous claims that the empty state is “effective,” focus trapping is proven, or transient messages are fully bounded were not supported by live usability/resource evidence and are therefore not completion claims in this plan.

## Reviewer record and finding dispositions

Two fresh-context read-only `reviewer` agents independently inspected the document and current repository. The parent then reproduced the baseline test failure, checked decisive source locations, and dispositioned reviewer disagreements above.

| Reviewer | Model | Focus | Result | Artifact |
|---|---|---|---|---|
| Reviewer 1 | `openai-codex/gpt-5.6-sol:high` | Correctness, source/test evidence, reliability, feasibility, priority | Completed; all material findings dispositioned | `.pi-subagents/artifacts/ddeebb23-19de-4b8b-965a-0e1b411d4b1f_reviewer_0_output.md` |
| Reviewer 2 | `anthropic/claude-fable-5:high` | UX, accessibility, IA, tracking quality, definitions of done | Completed; all material findings dispositioned | `.pi-subagents/artifacts/ddeebb23-19de-4b8b-965a-0e1b411d4b1f_reviewer_1_output.md` |

Key reconciliations:

- **Accepted:** Merge offline closure and cache lifecycle/revisions into one P0 service-worker epic.
- **Accepted:** Correct stale native-call count, file-count provenance, line references, browser-flow wording, and folder-picker scope.
- **Accepted:** Split broad accessibility, SSE, Control Deck, and modularization recommendations into bounded gates.
- **Accepted:** Promote request timeout/retry policy to P1 due to indefinite busy-state risk.
- **Accepted with lower priority:** SSE controls are P1 until a slow-client harness demonstrates release-blocking impact.
- **Deferred pending evidence:** IA consolidation, transcript-memory optimization, and lazy loading require usability/profiling evidence before broad implementation.
- **Rejected as unsupported completion claims:** Measured cognitive-load improvement, proven screen-reader overload, proven mobile-memory pressure, proven startup improvement, and universally effective focus/empty-state behavior.

## Delivery sequence

1. **P0-01:** restore the declared typography floor and all-green suite.
2. **P0-02:** fix service-worker closure, cache-event lifetime, and revision coherence.
3. **P1-01:** establish package-owned Playwright/axe smoke gates.
4. **P1-02 through P1-05:** ship the accessibility tranche in bounded changes.
5. **P1-06 and P1-07:** add slow-client transport bounds and request-class timeout/retry policy.
6. **P2-01:** profile startup and memory.
7. Implement P2 items only when their dependency and evidence gates are satisfied.

## Verification confidence and limitations

**Overall plan confidence: 96/100.** Source, static-structure, test, count, and size claims were independently checked by both requested reviewers and selectively reproduced by the parent. Confidence is below 100 because no installed offline browser flow, live screen reader, Windows High Contrast session, physical touch device, throttled SSE client, or browser heap/startup profile was executed during this review. Those uncertainties are now explicit acceptance gates rather than asserted outcomes.
