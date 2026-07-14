# ADR-0001: Use a bounded OOXML-surgical engine as the primary backend

- Status: Accepted for the declared bounded capability; publication remains gated only by signed-VBA fixture evidence
- Date: 2026-07-14

## Decision

Use the pure TypeScript `ooxml-safe` engine as the selected cross-platform mutation backend for its explicitly declared operations. Keep native Excel and Aspose.Cells unavailable for public mutation unless either independently passes the protected-part, no-op fidelity, repair-dialog, macro-nonexecution, external-refresh, and deployment gates.

## Rationale

The OOXML engine preserves every untouched ZIP part byte-for-byte after decompression, rejects ambiguous or unsupported changes before commit, and runs in Pi's normal Node process without opening Excel, executing VBA, refreshing links, requiring Java, or requiring a commercial license. Its public contract is capability-driven and fail-closed: bounded support is not presented as full Excel UI equivalence.

The engine supports declared surgical operations across values/formulas, rich formatting, dimensions/layout, bounded structural changes, sheet lifecycle, conditional formats, validations, names/links/notes/tables, PNG images, charts, print/theme settings, protection, and calculation metadata. Pivots, caches, slicers, timelines, arbitrary shapes, controls, ActiveX, embeddings, threaded comments, custom UI, and external connections are inventory/preservation-only unless a narrower operation proves the required parts mutable.

## Evidence

The selected engine passes:

- strict TypeScript, package, skill, and worker-safety checks;
- 24 unit/integration/semantic/golden tests on `.xlsx` and `.xlsm`;
- TUI, print, JSON, and RPC mode harnesses with a local mock provider;
- controlled desktop-Excel opening of source and edited `.xlsx`/`.xlsm` with macro/link/event controls;
- a rich locally generated corpus containing charts, tables, pivots, images, shapes, controls, ActiveX, an OLE embedding, custom ribbon XML, protection, hidden sheets, unsigned VBA, and external-link/connection sentinels;
- UI-aware repair-dialog monitoring with zero detected modal windows, zero macro sentinel executions, and zero connection-sentinel requests;
- dry-run packaging with all runtime workers, skill, and documentation.

See `IMPLEMENTATION-STATUS.md`, `tests/corpus/LAST-CORPUS-BAKEOFF.json`, `tests/corpus/LAST-EXCEL-HOST-REPORT.json`, and `tests/corpus/LAST-PI-MODES.json`.

The sole production-publication blocker is independent evidence from a legally sourced signed-VBA `.xlsm`. The `test:signed-vba` harness is complete and intentionally reports `SKIP` when no fixture is supplied; it never creates/imports certificates or changes Trust Center settings.

## Native Excel feasibility result

A short-lived candidate worker was implemented with `AutomationSecurity=ForceDisable`, disabled events and link updates, manual calculation, source-hash checks, exact `Application.Hwnd` process ownership, cancellation/timeouts, and PID/start-time-verified cleanup. No certificate-store or Trust Center setting was changed. The harness and cleanup gates passed on Excel 16.0 build 20131.

Native Excel did **not** pass strict no-op fidelity:

- The `.xlsx` no-op round trip added package parts and created styled empty cells at `B2` and `C2`, so semantic no-op qualification failed.
- The `.xlsm` no-op round trip changed `xl/vbaProject.bin`.
- Native `.xlsm` editing also changed protected package declarations/relationships and the VBA project.
- Candidate outputs opened cleanly, macro sentinels did not execute, source hashes stayed unchanged, and timeout cleanup killed only the worker-owned Excel PID; those safety results do not waive fidelity failures.

Decision: keep native Excel mutation disabled for both formats. Do not add protected-part transplantation without a separate relationship-aware design and complete revalidation. Machine-readable evidence is in `tests/corpus/LAST-NATIVE-BAKEOFF.json`.

## Consequences

- `ooxml-safe` is the enabled Tier 1 backend on Node.js 24+ across Windows, Linux, and macOS for its declared operation matrix.
- Every edit remains inspect-first, dry-run-first, hash-guarded, queued, transactional, independently validated, and recoverable for explicit in-place writes.
- Formula caches are preserved; formulas are inventoried but never locally evaluated, and external data is never refreshed.
- Shared/array/data-table/spill formula regions and ambiguous advanced objects fail closed.
- Native Excel remains a disabled diagnostic/validation candidate, not a public mutation backend.
- Aspose remains an optional deferred Tier 3 adapter; no commercial dependency is required for the selected deliverable.
- Any backend that changes a protected part during no-op cannot advertise mutation capability for that file/format.
