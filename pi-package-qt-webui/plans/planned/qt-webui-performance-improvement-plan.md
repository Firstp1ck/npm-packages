# Qt WebUI performance improvement plan

Status: planned. No implementation or performance validation has been performed for this plan.

Source: [Qt WebUI performance review](../reviews/qt-webui-performance-review.md), dated 2026-09-04, reviewed against `786ec7f`, package version `0.2.0`.

Contributor reference: [DEVELOPMENT.md](../../DEVELOPMENT.md).

## Goal

Remove repeated catalog and transcript work, bound expensive filesystem and attachment operations, and reduce unnecessary backend-to-QML traffic without weakening confinement, transcript correctness, state durability, or process cleanup.

The deliverable is a sequence of independently testable changes. Runtime measurements determine concurrency, aggregate budgets, and whether the more disruptive rendering and persistence changes proceed.

## Scope and evidence

This is a plan for the existing local Node.js backend, Qt Quick UI, and Quickshell process. It does not introduce a browser frontend, HTTP service, WebSocket transport, or new process topology.

The source review identifies scaling risks rather than a measured production ranking. Its reproducible history benchmark demonstrates increasing conversion time for 80, 800, and 4,000 input messages despite retaining only 80 rows. The reported 612-cell Markdown table is a reachable renderer output, not a measured runtime object count. Attachment arithmetic describes encoded payload size, not an RSS ceiling. Historical state-write timings are not an acceptance baseline.

Planning-time inspection confirmed the current catalog discovery path, eager history rendering, synchronous attachment reads, synchronous workspace walk, synchronous JSON store, and lifecycle fixture override. It did not rerun benchmarks, tests, or live QML profiling. Recheck source locations before implementation, especially if the [architecture refactor](qt-webui-architecture-refactor.md) lands first.

### Constraints

- Preserve managed-session canonical-path validation, attachment picker grants, workspace confinement, and unsafe-link rejection.
- Keep the 80-row transcript, existing per-part limits, bounded JSONL framing, and process-tree shutdown behavior unless a separate decision explicitly changes them.
- Do not replace Pi's authoritative session projection with an application-specific JSONL tail parser. Compaction and branch history remain Pi's responsibility.
- Keep backend mirrors authoritative for inactive tabs. Transport suppression must follow mirror application.
- Put new numeric limits in one canonical backend definition. Extend protocol/QML contract checks for values the client needs. Reconcile monitor defaults deliberately rather than adding duplicate constants.
- Do not silently tighten existing per-file attachment limits, change live Markdown presentation, or acknowledge draft saves before persistence.
- Keep fixtures, captures, and state isolated from real sessions, shared resource settings, and the desktop notification bus. Measurements must not record real prompts, attachments, or private paths.
- Change only Qt WebUI unless a dependency contract makes a separate change necessary. Do not combine this work with the architecture refactor or shared-state migration.

## Finding coverage and delivery order

| Phase | Review finding | Priority | Dependency and disposition |
| --- | --- | --- | --- |
| 0 | Lifecycle fixture blocks a reliable suite gate | Prerequisite | Isolated test-only repair |
| 1 | Missing reproducible performance baseline | Prerequisite | Instrument before optimizing |
| 2 | Repeated catalog scans and overlapping refreshes | P1 | After phase 1 |
| 3 | Full-history rendering and concurrent reconciliation | P1 | After phase 1; independent of phase 2 |
| 4 | Attachment read race, aggregate memory, child stdin buffering | P1 | After phase 1; budgets require a recorded decision |
| 5 | Unbounded synchronous fallback traversal and query sorting | P1 | After phase 1 |
| 6 | Inactive-tab progress sent then discarded | P2 | After phase 1; measure separately from rendering |
| 7 | Full-prefix streaming Markdown and conversion churn | P2 | After phases 3 and 6; presentation decision required |
| 8 | Transcript search misses row mutations | Correctness | Coordinate with phases 3 and 7; may land earlier |
| 9 | Unchanged session-list model replacement | P2 | After phase 2 and a 2,000-row UI profile |
| 10 | Topology enumeration on every open-file poll | P2 | After phase 1; independent of rendering |
| 11 | Synchronous state persistence | P2, conditional | Measurement, acknowledgement, and conflict gates first |
| 12 | Maximum table rendering | Profile first | After phase 7; implement only if profile warrants it |
| 13 | Integrated validation and documentation | Release gate | After all mandatory phases and conditional decisions |

Phases are ordered for reviewability, not as permission to edit shared files concurrently. `main.mjs`, `protocol.mjs`, `tabs.mjs`, `BackendBridge.qml`, and the QML contract tests need coordinated changes. Keep lifecycle repair, measurement infrastructure, catalog snapshots, history conversion, attachment reads, child command buffering, and UI changes in separate reviewable commits.

Deferred findings remain deferred: auxiliary Git descendants surviving direct-child termination, and hidden code/tool editor costs. Reproduce or profile them before opening implementation work. Do not present them as fixed by this plan.

## Phase 0: Repair the lifecycle test prerequisite

Files: `tests/helpers/backend-client.mjs`, `tests/backend-lifecycle.test.mjs`.

1. Add an explicit test-only Pi entry override to `startBackend`, defaulting to `fakePiEntry`. Prefer a named helper argument over changing precedence for every environment variable.
2. Pass the relative entry through that seam in the invalid-startup test. Add a missing absolute entry case if absent.
3. Preserve temporary XDG directories, isolated shared settings, smoke restrictions, detached process ownership, and the invalid session-bus address.
4. Bound startup-exit waits and ensure teardown runs even when startup does not exit as expected.
5. Run the isolated failure test, the lifecycle file, and then the full baseline suite. Record further failures rather than assuming the fixture explains all failures.

Acceptance:

- The invalid-entry cases prove the actual child received the intended entry and exits with the expected startup error.
- `debug_crash` remains refused outside smoke mode.
- Tests leave no backend, Pi fixture, or grandchild process running.
- This commit contains no production performance changes.

## Phase 1: Add reproducible measurements

Existing integration points: `main.mjs`, `sessions-index.mjs`, `session-sync.mjs`, `transcript.mjs`, `attachments.mjs`, `workspace.mjs`, `pi-session.mjs`, and QML diagnostics/smoke infrastructure.

Proposed new artifacts: `tests/performance/fixtures.mjs`, `tests/performance/run.mjs`, and focused deterministic `*.test.mjs` regressions in `tests/`. These paths do not exist yet. Keep benchmark timing runs outside the default suite; the existing runner discovers top-level `*.test.mjs` files only.

### Measurements

- Catalog: discovery passes, candidate metadata operations, body scans and bytes, peak I/O concurrency, cursor memory, refresh restarts, and time to publish a complete catalog.
- Reconciliation: source bytes, overlapping loads, validation/copy/projection/conversion durations, retained rows, Markdown calls, and tool lookup size.
- Attachments: raw retained bytes, encoded bytes, reservations, simultaneous reads, conversion/serialization time, command queue bytes, `writableLength`, and request latency.
- Workspace: visited entries/directories, collected files, open directory handles, completion candidates, build time, query time, and cancellation latency.
- Runtime: event-loop delay percentiles/maxima, RSS, heap, external/ArrayBuffer memory, outbound frame counts/bytes by event type, and startup time.
- QML: frame duration, frames over 16.7 ms on a 60 Hz display, object creation, model replacements, row mutations, layout time, and tab-switch replay latency. Record refresh rate for other displays.

Counters must be injectable or opt-in, bounded, and cheap when disabled. Never print measurement data into protocol stdout. Do not add public settings or launcher environment overrides solely for benchmarks. Dispose timers, event-loop monitors, and instrumentation with their owner.

### Fixture matrix

| Workload | Sizes and variations | Main evidence |
| --- | --- | --- |
| Catalog | 200, 2,000, and 10,000 candidates across several projects; equal mtimes; malformed and vanishing files; capped 1 MiB scans | Discovery multiplicity, page consistency, I/O bytes |
| History | 80, 800, and 4,000 messages using the review's 2,016-byte Markdown text; mixed tools/thinking/compaction; eight changed paths | Markdown calls, conversion time, load concurrency |
| Attachments | Single image; per-file boundary and one byte over; proposed prompt/global boundary; eight tabs; blocked stdin | Hard reads, aggregate accounting, memory and delay |
| Workspace | Ordinary tree; directory-heavy tree; single wide directory; depth boundary; Git success/failure/timeout/output cap | Visited work, handles, completion equivalence |
| Streaming | One and eight tabs; only one selected; prose/code/table; maximum part text; abort/error | Rendering calls, transport bytes, UI frames |
| Session list | At least 2,000 rows; idle minute ticks; same-order edits; rapid query input | Model replacements, filter latency, content correctness |
| Monitoring | Healthy watchers, root/project failures, more than 256 projects, missed events | Enumeration counts, retry timing, documented gaps |
| State | Typical and near-512 KiB validated files; repeated no-ops; draft bursts; two writers | Writes, latency, persistence conflicts |

Use unique history content for memory tests; shared strings are suitable for reproducing the CPU microbenchmark only. Generate large byte-heavy fixtures on demand rather than committing image blobs or session dumps.

Record commit, Node/Qt/Quickshell versions, CPU, OS, display, storage, fixture seed, warm-up, repetitions, and raw samples. Use at least five measured runs for CPU microbenchmarks. Report cold-process and warmed runs separately without claiming that restarting a process clears the OS page cache.

### Acceptance policy

Deterministic operation counts and bounds are CI gates. Machine-dependent timing and memory numbers are comparison evidence, not universal hard thresholds. Establish agreed latency/memory budgets after collecting the baseline and before selecting production constants. Each optimization must show its targeted operation reduction and no unexplained regression in the relevant repeated runtime measurements.

## Phase 2: Reuse catalog membership across pages

Files: `lib/backend/sessions-index.mjs`, `lib/backend/main.mjs`, `lib/backend/protocol.mjs`, `qml/BackendBridge.qml`; tests in `backend-tabs.test.mjs` and `qml-contract.test.mjs`, plus focused catalog tests if needed.

### Backend changes

1. Separate candidate discovery/sorting from page-content scanning. Create a backend-owned snapshot service rather than a module-global cache shared accidentally between tests or roots.
2. For all-scope offset zero, build one canonical, deduplicated, stably sorted membership snapshot. Return an opaque cursor alongside existing pagination fields. Subsequent pages supply that cursor and offset.
3. Specify cursor length/shape, scope/root binding, maximum count, total candidate/path-byte budget, lifetime, and cleanup. Keep candidate metadata only, not complete session bodies.
4. Record exact bounds after benchmarking. On capacity overflow, return a clear bounded error or an explicitly approved truncated result; do not silently omit catalog entries or fall back to rescanning every page.
5. Treat missing, expired, and foreign cursors as an explicit stale-request condition. Define a bounded client restart policy. Preserve the legacy workspace picker response and document behavior for offset-only all-scope requests.
6. Advance offsets by snapshot candidates, even when content scans fail. Files created after snapshot construction belong to the next pass. Revalidate confinement before opening a page entry because a pathname can change after discovery.
7. Keep open-tab association and settlement evaluation fresh per page. Snapshot membership and ordering are stable; file contents and annotations are not frozen. Preserve the no-op settlement write guard.
8. Introduce separate bounded metadata and content-scan worker pools only after snapshot correctness passes. Benchmark concurrency 1, 8, and 16. Preserve output order and cap descriptors, in-flight read bytes, and queued tasks.
9. Release snapshots on completion where retry semantics permit, expiry, explicit abandonment if supported, and shutdown. Abort pending work when its owner is gone.

### QML refresh scheduling

- Retain the previous complete catalog while gathering new pages.
- Allow one active paging pass and one dirty flag. Invalidations during a pass mark it dirty instead of discarding every slow callback and starting another scan.
- Publish a completed valid pass, then schedule one follow-up if dirty. Continuous events must not prevent publication.
- Keep generation checks for backend restart, root/scope changes, and genuine abandonment. Do not tie a global pass to the selected tab.
- Clear busy/dirty state on timeout, error, and backend exit. Bound automatic cursor-expiry retries; retain the previous catalog and expose failure instead of looping forever.

Acceptance:

- A 2,000-candidate refresh performs one discovery and ten page slices, rather than ten discoveries. Ordinary candidate body scans occur once per pass, within the existing per-file byte cap.
- Mtime changes between pages do not cause missing or duplicate snapshot members. Equal-mtime ordering is stable.
- Vanished, replaced, escaping, unreadable, and malformed entries cannot stop page progress or bypass confinement.
- Expiry, cursor capacity, stale responses, continuous invalidations, tab changes, and backend restart have deterministic tests.
- Settlement/open-tab annotations remain correct without triggering a refresh/write loop.

## Phase 3: Bound reconciliation and render retained history only

Files: `lib/backend/session-sync.mjs`, `lib/backend/transcript.mjs`, `lib/backend/tabs.mjs`, `lib/backend/main.mjs`; tests in `backend-tabs.test.mjs`, `session-sync.test.mjs`, `session-sync-integration.test.mjs`, and `thinking-output.test.mjs`.

1. Add a backend-wide snapshot-load semaphore. Start measurement at concurrency 1 and 2. Retain per-path serialization and coalesce waiting revisions by owned path so eight tabs cannot create an unbounded backlog.
2. Recheck ownership, pending revision, generation, and busy state after waiting for a slot and after loading. Release permits on every outcome and cancel queued work on close/shutdown.
3. Refactor `rowsFromHistory()` into bounded plain-row construction followed by rich rendering of retained text/thinking rows.
4. Associate tool IDs with the actual retained normalized rows. Delete lookup entries on eviction. A late result for an evicted tool must not resurrect it or retain historical row objects.
5. Preserve thinking merging, empty-thinking omission, part/text limits, tool error output, bash execution rows, interruption detection, row order, and complete message counts. Do not simply slice the last 80 input messages.
6. Replace `assertCompleteJsonl()`'s retained entry array with one remembered header and incremental validation state. Still validate every record, including discarded historical records.
7. Measure streaming validation/copying as a separate follow-up. Preserve the private isolated copy, complete-final-line rule, malformed-record diagnostics, source-length checks, revision stability, and cleanup on parser failure.
8. If streaming validation is adopted, define handling for a single very large JSONL record. A chunked read alone does not bound record parsing, and Pi's authoritative parser can still retain the whole history. Do not claim a process-wide load bound or add an undocumented session-size rejection.
9. Keep equality suppression and stale-child mutation fencing. Avoiding unnecessary Markdown does not justify skipping projection or weakening revision acknowledgement.

Acceptance:

- Markdown calls are bounded by retained renderable rows, at most 80 with the default limit, for all benchmark history sizes.
- Plain history traversal remains proportional to input history; the plan does not promise constant total conversion time.
- Tool lookup size never exceeds the retained window. Tests cover results before/after eviction and reused or malformed IDs according to existing behavior.
- Compaction, branching, partial writes, malformed old records, equal projections, active-run deferral, newer revisions, and closing tabs preserve existing semantics.
- Concurrent loads never exceed the selected bound; no permits or temporary files leak on rejection or shutdown.

## Phase 4: Bound attachment memory and the Pi command channel

Files: `lib/backend/attachments.mjs`, `lib/backend/pi-session.mjs`, `lib/backend/tabs.mjs`, `lib/backend/main.mjs`, `lib/backend/protocol.mjs`, composer/bridge error handling; tests in `backend-composer.test.mjs`, `backend-session.test.mjs`, and fixture support.

### Budget decision

Before implementation, record separate limits for per-file source bytes, per-prompt source/encoded bytes, backend-wide retained attachment bytes, concurrent reads, individual serialized Pi commands, per-child queued bytes, and backend-wide queued command bytes. Account for text attachments and UTF-8 edits as well as images.

Use base64 length `4 * ceil(sourceBytes / 3)` plus a conservative JSON-envelope/text-escaping allowance for admission. Measure overlap between raw buffers, base64 strings, JSON strings, and writable buffering. Logical reservations bound admitted work, not total process RSS.

Keep the existing 5 MiB image and 256 KiB text limits unless an explicit user-facing decision changes them. Aggregate limits and their refusal messages require approval and documentation. Do not infer that the backend-to-QML queue also bounds backend-to-Pi commands.

### Read and ownership changes

1. Make attachment loading asynchronous and thread the promise through request dispatch. Reserve both an attachment slot and byte capacity before starting I/O so concurrent adds cannot oversubscribe limits.
2. Open a checked regular-file handle, validate its identity and workspace/picker permission, and read with an explicit ceiling. Allow only a bounded sentinel byte beyond the limit to detect growth; check actual length before publishing.
3. Test path replacement and symlink races. Resolve/check/open must refer to the same permitted file, not merely repeat pathname checks that can race again. Close the handle on every path.
4. Keep the immutable snapshot that the user reviewed. Never reread the path when sending. Preserve image signature checks, strict UTF-8 text validation, and binary rejection.
5. Enforce byte limits when editing text, including multibyte input. Resize reservations atomically before replacing content.
6. Define reservation ownership across add, remove, clear, update, prompt admission, consumption, Pi acknowledgement, timeout, restart, and tab close. Reject stale/duplicate attachment IDs without double charging or double consumption.
7. Compare retaining raw buffers until send with retaining base64 immediately. Choose from measured peaks, not the assumption that async reads remove CPU-heavy encoding.

### Child stdin changes

1. Replace unchecked `writeRaw()` calls with an ordered bounded writer. Stop submitting further chunks when `stdin.write()` returns false and resume on `drain`.
2. Reserve command capacity before composition/base64 conversion/serialization. Verify exact serialized size against the reservation before enqueueing.
3. Track application-queued bytes separately from bytes already owned by the writable stream. Release each reservation exactly once on completion, failure, or teardown.
4. Cover all Pi commands, not prompts alone. Define admission for abort and other control commands while a large prompt is queued. Do not interleave bytes inside one JSONL frame or reorder already accepted commands.
5. If an accepted frame stalls, enforce a deadline and explicit child failure/termination path rather than unbounded buffering. A partially written prompt cannot safely be retried as though nothing was sent.
6. Preserve pending-response correlation and exactly-once prompt/attachment semantics. Pre-admission refusals retain attachments and give QML an unambiguous retryable result; post-write failures follow an explicitly documented uncertainty/consumption policy.

Acceptance:

- Growing/replaced files cannot cause an unbounded read or publish oversized content.
- Concurrent adds across eight tabs, text growth, failed validation, removal, timeout, and shutdown never exceed or leak reservations.
- A child that stops reading stdin triggers bounded buffering and deadline behavior. Other tabs and diagnostics remain responsive within the agreed measured budget.
- Tests cover `write(false)`, delayed `drain`, write error, child exit, oversize command, queue capacity, abort while blocked, and teardown during serialization/write.
- Encoding and serialization cost are reported separately from I/O improvements. Worker offload is a later measured option, not assumed part of this phase.

## Phase 5: Make workspace completion bounded and asynchronous

Files: `lib/backend/workspace.mjs`, `lib/backend/protocol.mjs`, owning tab cleanup; tests in `backend-composer.test.mjs` and focused workspace tests.

1. Replace recursive `readdirSync()` traversal with an iterative async walk using incremental directory reads.
2. Bound visited entries, visited directories, depth, collected files, open handles, pending directories, and elapsed time. Count skipped entries toward visited work.
3. Carry cancellation from tab disposal/backend shutdown and invalidate stale builds with a generation check. Share one in-flight build per root; one abandoned query must not cancel work still needed by another caller.
4. Preserve skipped-directory rules and symlink confinement. Avoid whole-directory materialization before a budget check.
5. Define truncation honestly. Preserve ranking for the collected set, sort bounded batches/results deterministically, and document that the subset from an interrupted filesystem enumeration may vary. A globally lexicographic subset cannot be promised without scanning the whole directory.
6. Precompute path/basename lowercase values and combined candidate records once per cached index. Bound derived directory/candidate storage as well as source files.
7. Replace full match sorting with bounded top-50 selection using the same score, path-length, and locale tie-break rules. Continue counting all matches within the bounded index.
8. Keep Git output/time caps and test fallback after failure. Report the actual source as `walk` when Git failed. Treat Git-subdirectory detection as a separate small decision if changing it.

Acceptance:

- Directory-heavy and wide fixtures stop at explicit work budgets, yield to backend requests, and close every handle.
- Cancellation, timeout, disappearing paths, depth edges, symlink escape, and stale cache publication have coverage.
- Suggestions match the old scorer for untruncated fixtures, including ties and empty queries; `total` remains the match count for indexed candidates.
- Overflow returns a bounded partial result with `truncated: true` or a specified error, never silent unbounded work.

## Phase 6: Suppress inactive progress after mirror updates

Files: `lib/backend/tabs.mjs`, `qml/BackendBridge.qml`; tests in `backend-tabs.test.mjs`, `backend-session.test.mjs`, and `tab-activity-state.test.mjs`.

1. Apply each event to the tab mirror before checking whether its heavy progress payload should be forwarded.
2. Suppress inactive `part.render` and `tool.update` traffic, including any final part payload if the mirror already retains its authoritative result.
3. Keep lifecycle, error, notice, dialog, badge, tool completion, run completion, and tab summary events. Do not suppress all inactive-tab traffic.
4. Audit consumers of `eventReceived` and document its changed observable stream. Coordinate protocol documentation/tests; additive fields alone do not make an event-semantics change automatically compatible.
5. Preserve selection ordering: `tabs.update`, authoritative reset/replay, then subsequent live events. An empty active selection means no tab needs heavy progress transport.

Acceptance:

- Captured outbound inactive heavy-event count is zero while backend mirror content stays current.
- Switching immediately before/after render, tool completion, and run completion replays the latest content without gaps or duplicate rows.
- Notices, extension input, unread/activity badges, settled-session notification rules, and active-tab output are unchanged.
- Report savings in bytes, serialization/transport, and QML work separately from upstream Markdown/mirror costs.

## Phase 7: Reduce streaming Markdown work

Files: `lib/backend/pi-session.mjs`, `lib/backend/markdown.mjs`, `lib/backend/transcript.mjs`, `qml/BackendBridge.qml`, `qml/components/TranscriptRow.qml`, `qml/components/MarkdownBlocks.qml`.

### Decision gate

Profile full-prefix rendering, serialization, QML parsing, delegate creation, and row invalidation separately. Recommend plain streaming with rich final content if the user accepts the presentation change. Otherwise retain live Markdown and prototype an adaptive cadence/incomplete-tail update only when its parser correctness and measured benefit justify the added complexity.

Do not silently switch presentation. Record the decision and before/after fixture results here before proceeding.

### Preferred plain-streaming implementation

1. Carry bounded original text plus explicit streaming/final state. QML must use `Text.PlainText` or the corresponding plain editor mode, never automatic rich-text detection.
2. Do not HTML-escape a plain-text value. Test literal tags, entities, links, angle brackets, and raw Markdown.
3. Render/highlight final content once per distinct final value. Deduplicate equal part-end/message-end finalization, but rerender if authoritative final content differs.
4. Finalize on abort and failure as well as ordinary completion. Preserve removal of empty thinking and streamed parts absent from the final message. Cover restart, inactive replay, and external history projection.
5. Remove redundant stringify/parse conversions. Choose one validated block representation shared by mirror/live/replay paths. A canonical `blocksJson` string is the smaller change; a structured model needs explicit bounds and QML-role validation.
6. Adopt one logical row update instead of several `setProperty()` calls only if profiling shows fewer invalidations without breaking bindings.
7. Keep per-part text bounds and ordering. Measure aggregate eight-tab work; the existing 80 ms per-part cadence is not a global frame budget.

Acceptance:

- On the plain-streaming path, intermediate text updates invoke no Markdown parser/highlighter. Equal final events do not duplicate rich rendering.
- Rich final content and history obey existing Markdown safety, highlighting, selection, and copy policies.
- Streaming search, scrolling/follow-output, thinking visibility, late final events, truncation, and replay remain correct.
- One-tab and eight-tab traces show the relevant CPU/transport/frame changes. If the approved strategy fails its measured goal, retain the prior implementation and record why.

## Phase 8: Fix transcript search invalidation

Files: `qml/BackendBridge.qml`, `qml/shell.qml`, `qml/components/SearchBar.qml` if needed; QML contracts and live smoke coverage.

1. Add a transcript content revision or explicit mutation signal. Increment it for append, remove, clear/reset, replacement, and searchable text/tool-output changes.
2. Do not rely on the alias `onTranscriptModelChanged` notification for mutations inside the long-lived `ListModel`.
3. Debounce rescans while search is open. Coalesce a replay or a logical row update rather than scanning after every individual role assignment.
4. Rescan immediately when search opens or its query changes as required by existing interaction. Reconcile the current match after eviction/removal and clear stale highlights on tab switch.
5. Prevent recursive invalidation when updating search-highlight roles. Those updates must not count as searchable-content changes.

Acceptance:

- Search finds newly streamed text and tool output, removes evicted matches, and refreshes after external projection and tab replay.
- Closed search performs no content rescans. A burst of row updates produces one scheduled scan per debounce interval.
- Verify behavior in live QML, not static source checks alone.

## Phase 9: Avoid unchanged session-list model replacement

Files: `qml/components/SessionList.qml`, with bridge changes only if needed; QML contracts and live smoke coverage.

1. Separate enrichment/search-key computation from filtering and publication. Recompute each derived value when its actual inputs change.
2. Compare order and all relevant row content before replacing Working/Settled arrays. Include names, previews, settlement, timestamps/labels, open-tab association, selection, and activity/input/error annotations used by delegates.
3. Preserve five-minute activity-sort grace and prune obsolete sort keys even when publication is skipped.
4. Recompute searchable text for catalog fields, tab-derived names/paths, and home-path display changes. Debounce filter input without persisting the query.
5. Keep minute-based labels correct. A minute tick that changes a displayed label is a real update, not a no-op.
6. Profile the existing array-backed model at 2,000 rows before considering a different model type.

Acceptance:

- Identical content/order causes no model assignment or delegate reconstruction.
- Same-order rename, preview, settlement, timestamp, tab, and activity changes appear immediately at the appropriate refresh.
- Sort grace, obsolete-key pruning, Working/Settled grouping, empty-query restore, selection, and keyboard navigation retain their behavior.
- Record model assignments and UI frame times, not just comparison-function timings.

## Phase 10: Separate topology cadence from open-file polling

Files: `lib/backend/session-sync.mjs`; tests in `session-sync.test.mjs` and `session-sync-integration.test.mjs`.

1. Keep the two-second bounded open-session revision poll.
2. Refresh project topology from root watcher events and a separate healthy fallback. Benchmark/configure a fallback in the review's 30-to-60-second range.
3. Track root and desired project watcher health independently. Setup failure or a later watcher error schedules fast bounded recovery, even when the root watcher is still healthy.
4. Coalesce topology refreshes and prevent overlapping scans. Bound retry work and avoid spinning forever for projects deliberately outside the watcher cap.
5. Remove all new timers/watchers during graceful, forced, and fatal cleanup.
6. Document that topology polling manages directories/watchers, not complete closed-session contents. Missed closed-file events and projects beyond the 256-watcher cap remain catalog-freshness limitations unless a separate reconciliation design addresses them.

Acceptance:

- With no watcher events or failures, fake-time tests show about one or two topology fallback enumerations per minute, excluding startup, while open-file polling remains about 30 per minute.
- Root failure, project failure, directory removal/recreation, overflow, and shutdown recover or stop as specified.
- The maximum missed-topology recovery delay is explicit; no test or documentation claims complete global freshness.

## Phase 11: Gate and redesign state persistence carefully

Files: `lib/backend/store.mjs`, `lib/backend/state.mjs`, `lib/backend/tabs.mjs`, `lib/backend/main.mjs`, and every affected caller. Audit other users of the generic store before changing its API.

### Required decisions

- Is measured write frequency/latency sufficient to justify a persistence redesign? If not, defer it with the baseline attached.
- Does successful `draft_set` continue to mean that atomic replacement completed? Recommended answer: yes. Queueing alone is not a successful save.
- How do cooperating backend instances coordinate latest-value read/merge/write, including a deferred flush?
- How are non-cooperating external edits detected and reported? A revision check before mutation does not prevent a later deferred overwrite, and advisory locking alone cannot protect against arbitrary editors.
- What happens when shutdown cannot flush before its deadline? Define a visible error/exit policy without delaying child cleanup indefinitely.

### Implementation after approval

1. Establish explicit validated-state ownership. Cache reads only with a defined external-change invalidation/conflict policy.
2. Preserve no-op settlement behavior and skip writes when the authoritative serialized state is unchanged.
3. Serialize asynchronous atomic writes. Coalesce pending draft values only under a defined ordering rule; do not drop unrelated state mutations or acknowledge a request whose effect was never included in a committed state.
4. Merge logical mutations against the latest coordinated state at commit time. Do not flush an old whole-document cache over another instance's newer data.
5. Use unique private temporary files and preserve 0700 directories/0600 files. Clean up temporary files on errors. Do not describe rename as an `fsync` durability guarantee.
6. Resolve waiting save responses only after their durability condition is met. Keep write failures observable and bound retry queues.
7. Flush with a shutdown deadline alongside process cleanup. A failed/timed-out flush must not prevent TERM-to-KILL escalation or leave unresolved request promises.
8. Keep file format/schema unchanged unless separately justified. Limit the initial change to window state rather than silently changing sequences/settings/resource-store contracts.

Acceptance:

- Repeated no-ops cause no disk replacements; draft bursts reduce writes without false successful-save acknowledgements.
- Deterministic tests cover two backend writers, an edit between scheduling and flush, same-key conflicts, unrelated-key merging, read/permission/rename failures, malformed/oversized data, and shutdown timeout.
- Cached state cannot hide write failure or overwrite a detected conflict silently.
- If external-edit semantics cannot be preserved or explicitly approved, defer persistent caching/debouncing rather than claiming a safe redesign.

## Phase 12: Profile maximum tables before changing rendering

Files if justified: `qml/components/MarkdownBlocks.qml`, related transcript delegates, smoke/performance fixtures.

1. Reproduce the reachable 12-header-cell plus 50-by-12-body-cell table within the text cap.
2. Profile visible tables, nearby cached transcript rows, repeated scrolling, tab replay, and maximum tables following streaming finalization.
3. Record actual object counts, creation/layout time, memory, and slow frames. Do not equate 612 renderer cells with a measured QObject count.
4. If material, compare virtualized table rows against one selectable preformatted fallback for large tables. Record the threshold and user-visible trade-off before implementation.
5. Preserve selection/copy, safe text/link behavior, keyboard access, accessible labels, and transcript scrolling. Avoid nested scrolling that traps navigation.

Acceptance:

- Either land a measured improvement with behavior coverage, or record a justified no-change decision with traces.
- Do not lower table limits merely to improve a benchmark without approval.

## Phase 13: Integrated verification and documentation

### Commands already available

Run from `pi-package-qt-webui/`. These are future implementation gates, not checks claimed by this planning task.

After the phase-0 fixture repair:

```bash
timeout --kill-after=5s 35s node --test --test-concurrency=1 \
  --test-timeout=25000 \
  --test-name-pattern='debug_crash is refused outside smoke mode and a missing Pi entry fails fast' \
  tests/backend-lifecycle.test.mjs
```

Run focused regressions during each phase:

```bash
node --test --test-concurrency=1 --test-timeout=60000 \
  tests/backend-units.test.mjs tests/backend-composer.test.mjs \
  tests/backend-tabs.test.mjs tests/backend-session.test.mjs \
  tests/session-sync.test.mjs tests/session-sync-integration.test.mjs \
  tests/thinking-output.test.mjs tests/tab-activity-state.test.mjs \
  tests/qml-contract.test.mjs
```

Include newly added focused test files explicitly until using the full runner. At integration:

```bash
timeout --kill-after=10s 15m npm run check
qmllint -I /usr/lib/qt6/qml qml/*.qml qml/components/*.qml qml/dialogs/*.qml
node --test --test-concurrency=1 --test-timeout=180000 tests/qml-smoke.test.mjs
```

`npm run check` includes syntax checks and the full test runner. Capture whether a timeout was a test deadline, an outer deadline, or a process cleanup failure. Tune the outer budget from the baseline rather than treating 15 minutes as a performance target. Packed-install tests use a disposable local prefix; do not install globally or publish.

Live QML smoke may skip without Quickshell/Wayland. Record that as missing runtime evidence, not a successful UI validation. Run QML Profiler on the target environment for phases 7, 9, and 12; static contract tests and lint do not measure frames.

### Mixed-load scenario

Run a 2,000-session refresh while eight tabs stream, one tab is selected, attachments approach the approved aggregate budget, a directory-heavy completion builds, and external sessions change. Then switch tabs, open transcript search, filter sessions, block one child stdin, and shut down.

Verify bounds, forward progress, latest-content replay, correct search, essential notifications, request timeouts, and complete resource cleanup. Compare event-loop delay, RSS/heap/external memory, outbound bytes, catalog publication, and UI frames against phase 1. Keep per-feature measurements too, so a combined improvement cannot hide a regression.

### Documentation changes with implementation

- `README.md`: add only user-visible improvements and practical usage changes; keep attachment/privacy warnings prominent if limits or handling change.
- `TECHNICAL.md`: document approved aggregate limits, refusal/retry behavior, live Markdown presentation, state save/conflict behavior, topology freshness limitations, and troubleshooting.
- `DEVELOPMENT.md`: update cursor protocol, counters, concurrency/queue budgets, reservation ownership, finalization, transcript revisions, watcher recovery, persistence contracts, fixtures, and benchmark reproduction.
- Update protocol/QML/docs contract tests with the same change. Do not place schemas, internal algorithms, or test commands in user documents.
- Keep the source review as historical evidence. Append dated implementation results here or link a separate results record rather than rewriting old measurements as new verification.

Run documentation checks from the repository root:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Check relative links, balanced fences, accurate paths, and the absence of internal-only detail in `TECHNICAL.md`.

## Rollout and rollback

- Land one measured change at a time. Keep before/after output with the corresponding commit and decision record.
- Update backend and QML together for cursor, block representation, and event-stream changes. Document whether protocol version 1 remains appropriate; incompatible semantics require an explicit compatibility decision.
- Prefer reverting an isolated optimization to adding permanent fallback modes or flags. Preserve regression tests that exposed correctness or hard-bound failures.
- Do not undo attachment read ceilings or reservation accounting to regain throughput. Tune measured concurrency/budgets without reopening the unbounded path.
- Keep state format stable so reverting scheduling does not require destructive migration. If a schema change becomes necessary, stop and add a migration/rollback plan first.
- Do not deploy a cache fallback that silently overwrites conflicting state, or a catalog fallback that silently returns to repeated scans under pressure.

## Completion record

For each phase, record implementation commit, selected constants, relevant decision, test results, benchmark fixture/command, before/after samples, and remaining limitations. Conditional phases may close as explicitly deferred only with supporting evidence and a reason.

The implementation is complete when:

1. P1 phases and the transcript-search correctness fix pass their deterministic regression gates.
2. Catalog discovery is once per paging pass; history Markdown work is bounded by retained rows; attachment reads/queues and workspace traversal obey explicit limits.
3. Adopted P2 changes show their intended operation reduction and preserve behavior under the mixed-load scenario.
4. Rendering, attachment budgets, persistence, and table decisions are recorded rather than assumed.
5. Full-suite results and live QML profiling are available, or any missing environment-dependent verification is explicitly accepted as a remaining release blocker/risk.
6. Documentation matches implemented behavior, and no real user state or unrelated working-tree changes were modified.
7. Every phase has an implementation or justified conditional disposition. Only then move this plan to `plans/archive/`. Keep the archive Git-ignored and `plans/planned/` unignored.
