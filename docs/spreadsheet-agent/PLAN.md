# Pi Agent XLSX/XLSM Workbook Editor — Implementation Plan

Date: 2026-07-14
Status: Planning complete; implementation not started
Target package: `pi-extension-workbook` / `@firstpick/pi-extension-workbook`

## Progress tracker

The checkboxes in [Priority implementation plan](#priority-implementation-plan) are the canonical tracker. Update them in place; do not maintain a second task list elsewhere.

Legend:

- `[x]` complete and verified
- `[-]` actively being implemented
- `[ ]` not started or blocked

Planning completed:

- [x] Clarify that this is an agent-facing workbook capability, not a browser spreadsheet editor.
- [x] Review Pi extension/tool conventions, RPC behavior, current spreadsheet parsing, workbook-engine options, and `.xlsm` risks.

## Goal

Give Pi agents dedicated tools to inspect, visually understand, edit, format, diff, and validate `.xlsx` and `.xlsm` workbooks without requiring a user-facing spreadsheet UI.

The agent must be able to make rich formatting changes while preserving workbook structure and, for `.xlsm`, preserving embedded VBA and related active-content parts unless the user explicitly requests a separate macro-code operation in a future feature.

## Non-goals for the first production release

- No browser/WebUI spreadsheet editor.
- No automatic VBA execution.
- No automatic external-link refresh, data-connection refresh, or formula-driven network access.
- No silent conversion from `.xlsm` to `.xlsx`.
- No best-effort save that can silently discard unsupported workbook parts.
- No VBA source editing until preservation, signing, and security behavior have a separate reviewed design.
- No requirement to emulate every Excel UI interaction; the public interface is an agent-oriented tool API.

## Success criteria

A release is acceptable only when all of these are true:

1. Pi can inspect workbook metadata, sheets, used ranges, values, formulas, styles, merges, dimensions, defined names, tables, charts, conditional formats, validations, links, and macro status with bounded output.
2. Pi can request a focused range view as structured data and a PNG preview returned as an image tool-result block.
3. Pi can apply a transactional list of value, formula, layout, and formatting operations.
4. `.xlsx` and `.xlsm` outputs open in desktop Excel without a repair prompt.
5. For `.xlsm`, `xl/vbaProject.bin` and other protected active-content parts remain present and byte-identical unless a future explicit macro-edit operation says otherwise.
6. Unsupported or lossy operations fail closed before the source file is overwritten.
7. Default edits create a new output file; in-place overwrite requires an explicit parameter and always uses atomic replacement plus recovery data.
8. Same-file mutations participate in Pi's `withFileMutationQueue()` so parallel tool calls cannot overwrite one another.
9. Tools work in TUI, print/JSON, and RPC/WebUI sessions without requiring interactive dialogs.
10. All large outputs are truncated to Pi limits and link to complete temporary JSON, image, or report artifacts.

## Current baseline

- Pi WebUI can upload `.xlsx` and `.xlsm` as ordinary attachments and provides the agent with their local paths.
- `pi-docparser` can extract spreadsheet content and render through host conversion tools, but it is a read-oriented document parser rather than a semantic workbook editor.
- Pi's existing text file viewer intentionally rejects binary workbook files; this plan does not change that viewer.
- The new capability should be an independently installable Pi package that registers agent tools with `pi.registerTool()`.

## Architecture decision

### 1. Build an agent tool package, not a UI component

Create a package with a small extension entry point, a versioned workbook-operation schema, backend adapters, an OOXML integrity layer, a companion skill, and fixture-driven tests.

Proposed layout:

```text
pi-extension-workbook/
├── index.ts
├── package.json
├── README.md
├── LICENSE
├── src/
│   ├── schemas.ts
│   ├── paths.ts
│   ├── output.ts
│   ├── capabilities.ts
│   ├── tools/
│   │   ├── inspect.ts
│   │   ├── read.ts
│   │   ├── render.ts
│   │   ├── edit.ts
│   │   ├── diff.ts
│   │   └── validate.ts
│   ├── core/
│   │   ├── transaction.ts
│   │   ├── operation-plan.ts
│   │   ├── ooxml-manifest.ts
│   │   ├── macro-integrity.ts
│   │   └── workbook-diff.ts
│   └── backends/
│       ├── interface.ts
│       ├── ooxml-safe.ts
│       ├── excel-native.ts
│       └── aspose.ts
├── workers/
│   └── excel-native.ps1
├── skills/
│   └── workbook-editor/
│       └── SKILL.md
└── tests/
    ├── fixtures/
    ├── unit/
    ├── integration/
    └── corpus/
```

The package manifest should expose `./index.ts` through `pi.extensions` and the workbook skill through `pi.skills`. Pi runtime packages belong in `peerDependencies`; workbook engines belong in runtime or optional dependencies according to the selected backend.

Use `@firstpick/pi-utils` as the shared base for `resolveUserPath`/`stripAtPathPrefix`/`expandTilde`, binary-capable `writeFileAtomic`/`writeFileAtomicSync`, and `runCommand`/`killGracefully`. Add workbook-specific wrappers only for guarantees those helpers do not currently provide, notably file and parent-directory `fsync`, tested Windows replacement behavior, abort propagation, and cleanup of the worker-owned process tree.

### 2. Stable agent-facing tool surface

| Tool | Mutation | Purpose |
|---|---|---|
| `workbook_inspect` | No | Return workbook/sheet metadata, feature inventory, macro status, package warnings, hashes, and engine capabilities. |
| `workbook_read` | No | Read a bounded sheet/range as JSON, Markdown, or CSV-like text with optional formulas and normalized style descriptors. |
| `workbook_render` | No | Render selected sheets/ranges to PNG and return image blocks plus saved artifact paths. |
| `workbook_edit` | Yes | Dry-run or atomically apply a versioned array of workbook operations to a new file or explicit overwrite target. |
| `workbook_diff` | No | Compare workbook values, formulas, styles, structure, OOXML parts, and macro-protected parts. |
| `workbook_validate` | No | Reopen and validate format consistency, references, package structure, output extension, macros, and engine-specific invariants. |

A later `workbook_create` tool may be added after the editing contract is stable. It must reuse the same operation schema instead of inventing a second formatting API.

### 3. Agent workflow

The skill and tool guidelines should drive this sequence:

1. `workbook_inspect` before editing an unfamiliar workbook.
2. `workbook_read` for the exact sheets/ranges involved.
3. `workbook_render` when visual layout or formatting matters.
4. `workbook_edit` with `dryRun: true` for a proposed operation plan.
5. `workbook_edit` to a new output path after the dry run is valid.
6. `workbook_validate`, then `workbook_diff` and focused rendering.
7. Overwrite the original only when the user explicitly requested it and all gates pass.

### 4. Versioned declarative operation model

`workbook_edit` should accept a schema version and an ordered operation list. Operations are applied as one transaction: either every operation succeeds and validation passes, or no destination is committed.

Initial operation families:

- Values and formulas: set/clear values, set formulas, fill/copy ranges, preserve cached values where supported.
- Font: family, size, bold, italic, underline, strike, color, superscript/subscript.
- Fill: solid, pattern, foreground/background color.
- Border: each edge, diagonal, style, color.
- Alignment: horizontal/vertical, wrap, shrink-to-fit, indentation, text rotation.
- Number formats: built-in and custom formats with locale-aware preservation.
- Protection: locked/hidden cell flags without changing workbook passwords implicitly.
- Layout: row height, column width, hidden state, autofit policy, merge/unmerge, freeze panes.
- Structure: insert/delete rows and columns, rename/reorder/create/delete sheets with explicit safeguards.
- Range metadata: hyperlinks, comments/notes, data validation, conditional formatting, tables, filters, and defined names.
- Objects added in later phases: images, charts, sparklines, shapes, pivots, slicers, and print/page setup.

Use strict TypeBox schemas and import `StringEnum` from `@earendil-works/pi-ai` for enum parameters so the tools remain compatible with Google-backed models. Include `prepareArguments()` only for backwards-compatible migration of stored calls after a schema version change.

### 5. Backend adapter strategy

No single open-source Node library currently satisfies maximum formatting fidelity, rich rendering, and safe `.xlsm` round-tripping. The public tool contract must therefore be backend-independent.

| Backend | Intended role | Strength | Main risk |
|---|---|---|---|
| OOXML integrity/surgical backend | Mandatory on every platform | Inventories and hashes package parts; preserves untouched ZIP entries; supports narrow fail-safe XML edits. | Rich editing requires substantial standards work. |
| Native Microsoft Excel adapter | Preferred high-fidelity backend on supported Windows interactive hosts | Excel owns formatting, formulas, charts, pivots, rendering, and `.xlsm` serialization. | Windows/Excel dependency; COM can hang; Microsoft does not support unattended service automation. |
| Aspose.Cells adapter | Candidate high-fidelity cross-platform backend | Broad formatting, rendering, formulas, charts, and VBA APIs from Node.js via Java. | Commercial license, Java/native dependency, deployment and Node-version compatibility. |
| SheetJS CE | Candidate semantic reader/helper only | Reads XLSX/XLSM and exposes raw VBA blobs. | Not the canonical high-fidelity writer for this requirement. |
| openpyxl / ExcelJS | Prototype or test helper only | Convenient common cell/style APIs. | Known round-trip gaps; openpyxl warns unsupported shapes can be lost, and neither is accepted as a general `.xlsm` fidelity boundary. |

Backend selection rules:

1. Inspect the file and requested operations before selecting an engine.
2. Use an explicitly requested backend when it passes capability checks.
3. Prefer native Excel on a supported interactive Windows host if the P0 corpus proves it reliable.
4. Otherwise use a licensed high-fidelity cross-platform adapter when installed.
5. Use the OOXML surgical backend only for operations it explicitly declares safe.
6. Refuse the edit if no backend can preserve the file's detected features. Never silently fall back to a lossy writer.

P0 must run bounded feasibility spikes across the candidate backends, select one primary mutation backend, and validate that backend against the corpus. Optional alternative or cross-platform mutation adapters remain P3 work and are not P0 release dependencies merely because they were evaluated.

### 6. Native Excel worker constraints

If the native adapter is selected:

- Run Excel in a short-lived, isolated worker process rather than directly inside the extension.
- Require an interactive logged-in Windows user; do not advertise it as an unattended server backend.
- Set `Application.AutomationSecurity` to `msoAutomationSecurityForceDisable` before opening any workbook.
- Disable link updates, data refresh, events, and automatic macro execution.
- Use manual calculation unless the user explicitly requests a safe recalculation operation in a future design.
- Detect modal dialogs, password prompts, Protected View, and worker timeouts; fail rather than hang Pi.
- Always close the workbook and call `Quit()` in `finally`; kill only the worker-owned Excel process after a timeout.
- Never attach to or terminate an unrelated user Excel process.
- Return a capability/error report when Excel is absent or unavailable.

These controls require implementation and adversarial tests, including a harmless `Auto_Open`/`Workbook_Open` sentinel that must not run, a connection-refresh sentinel that must not be contacted, and verification that timeout cleanup does not terminate an unrelated Excel process.

### 7. OOXML and macro integrity layer

Before any mutation, create a package manifest containing path, content type, relationship targets, size, CRC where available, and SHA-256 for every ZIP part.

Classify protected active content from content types and the resolved relationship graph across the whole package. Use canonical paths as a minimum detection floor and diagnostic aid, not as the sole classifier:

```text
xl/vbaProject.bin
xl/vbaProjectSignature.bin
xl/activeX/**
xl/ctrlProps/**
xl/embeddings/**
customUI/**
associated .rels entries
[Content_Types].xml active-content declarations
```

Post-save gates:

1. Confirm extension and workbook content type agree.
2. Confirm `.xlsx` has no unexpected VBA project.
3. Confirm `.xlsm` still has its macro-enabled content type and VBA relationship.
4. Require every protected part identified from the baseline content-type/relationship graph to remain present and byte-identical by default.
5. Detect missing ActiveX, embedded object, custom ribbon, signature, relationship, or external-link parts.
6. Reopen through the selected engine and run package/XML validation.
7. Keep the candidate output separate and refuse original-file replacement when any gate fails.

A backend that changes a protected part during a no-op round trip must not advertise `.xlsm` mutation capability. It may qualify only after P0 independently proves a lossless, relationship-aware original-part transplant followed by complete revalidation; semantic equivalence alone does not waive the byte-identity gate.

Macro behavior for the first release is **preserve, inventory, and verify**. It does not mean execute or rewrite VBA source.

### 8. Structured and visual views for the agent

`workbook_read` should compress repeated styles into a style table and reference style IDs from cells. A focused response should include:

- Displayed value and underlying value.
- Formula and last cached result when available.
- Number format and normalized style ID.
- Merge ownership and hidden row/column state.
- Conditional-format and validation references.
- Warnings for truncated ranges, unsupported objects, hidden/very-hidden sheets, links, and macros.

`workbook_render` should return PNG image blocks using the same result shape pattern as `document_screenshot`, plus paths to full-size files. Rendering backends may be native Excel, Aspose, or a deterministic internal SVG/raster range renderer. The response must identify which renderer was used and its known fidelity limits.

Large workbook data must be written to a temporary JSON artifact. Model-visible output must respect Pi's 50 KB / 2,000-line limit and say exactly what was omitted.

### 9. Transaction and file-safety model

Every mutation must:

1. Normalize leading `@`, `~`, relative, and absolute paths.
2. Resolve the real source and destination paths.
3. Acquire `withFileMutationQueue()` for the real destination path for the whole read-modify-write window.
4. Record source SHA-256. A dry run returns it, and every non-dry-run commit requires a matching `expectedSha256` or fails with a conflict.
5. Copy the source to a private transaction directory.
6. Apply all operations to the copy.
7. Validate and diff the copy.
8. Write a sibling temporary destination, flush it, and atomically replace only after all gates pass.
9. Preserve a recovery copy for explicit in-place overwrites.
10. Return source/output hashes, engine, operation summary, warnings, validation status, and recovery path in `details`.

Default output naming should be non-destructive, for example `report.pi-edited.xlsx` or `report.pi-edited.xlsm`. Existing destinations require `overwrite: true`.

### 10. Security boundaries

- Macros are never executed by default or as a side effect of open, render, validate, or save.
- External links, Power Query, data connections, and DDE are never refreshed automatically.
- Formula strings beginning with `=`, `+`, `-`, or `@` are treated explicitly as formulas or text according to the operation type; no ambiguous CSV-style coercion.
- Passwords are optional sensitive inputs and must never appear in logs, tool-result details, snapshots, or fixture output.
- Reject ZIP traversal entries, encrypted/unsupported packages, decompression bombs, unreasonable XML sizes, and oversized shared-string/style tables using configurable limits.
- Honor `AbortSignal` and set hard timeouts for workers and rendering.
- Do not install Java, Excel, Python, LibreOffice, or licenses automatically. A doctor command reports missing capabilities and setup guidance.
- A future VBA mutation/execution tool requires a separate threat model and explicit user confirmation; it must not be added to `workbook_edit` casually.

## Priority model

| Priority | Meaning |
|---|---|
| P0 | Fidelity and safety foundations that block all mutation work. |
| P1 | Minimum agent workflow: inspect, read, render, edit common cells/styles, validate. |
| P2 | Feature-rich formatting and workbook semantics expected in daily work. |
| P3 | Advanced Excel objects, scale, cross-platform breadth, and polish. |
| P4 | Explicit VBA-code capabilities; separately reviewed and disabled by default. |

## Priority implementation plan

### P0 — Fidelity, package, and safety foundation

- [ ] Scaffold `pi-extension-workbook` with package metadata, extension entry point, skill directory, tests, and `check`/`test`/`pack:dry` scripts.
- [ ] Define the versioned `WorkbookEngine`, capability, workbook-operation, tool-result, and error contracts.
- [ ] Reuse `@firstpick/pi-utils` for user-path handling, atomic-write primitives, and process lifecycle; add and test the missing `fsync`, binary replacement, abort, and owned-process-tree guarantees.
- [ ] Implement temporary artifact handling, output truncation, cancellation, and safe error redaction.
- [ ] Implement bounded OOXML package intake: traversal rejection, encryption handling, compressed/uncompressed size and ratio limits, entry-count limits, and XML/shared-string/style limits.
- [ ] Build a legal test corpus covering `.xlsx` and `.xlsm`: styles, themes, merges, formulas, charts, tables, pivots, conditional formats, validations, images, links, protection, hidden sheets, VBA, signed VBA, ActiveX, embeddings, custom ribbons, non-canonical active-part names, and harmless macro/connection sentinels.
- [ ] Implement OOXML ZIP inventory, content-type/relationship-driven protected-part classification, SHA-256 manifests, and macro-integrity comparison.
- [ ] Run bounded feasibility spikes for native Excel, Aspose.Cells, and OOXML-surgical editing; select one primary mutation backend and defer optional alternatives to P3.
- [ ] If native Excel is selected, implement the isolated worker safeguards in section 6 and prove that macros, events, links, and connections do not execute or refresh.
- [ ] Run and document the selected backend's full corpus bakeoff, including Excel repair prompts, visual diffs, macro hashes, signatures, unsupported-part loss, runtime requirements, performance, and licensing.
- [ ] Record the production backend decision in an ADR and define fail-closed, per-file backend capability rules.
- [ ] Implement explicit literal-value versus formula operations and test leading `=`, `+`, `-`, and `@` input without backend-dependent coercion.
- [ ] Implement transaction staging, mandatory `expectedSha256` for commits, per-destination `withFileMutationQueue()`, durable atomic commit, explicit overwrite, and recovery copies.
- [ ] If native Excel is selected, provision a controlled interactive Windows validation host and repair-dialog/macro-nonexecution harness without presenting it as unattended server support.
- [ ] Add `/workbook-doctor` and a non-mutating capability probe for engines, licenses, renderers, and host dependencies.

P0 exit gate: the bounded OOXML read/integrity pipeline passes the corpus, and one selected primary mutation backend passes the no-op round trip without source overwrite, Excel repair prompts, protected-part changes, macro execution, or external-data refresh. Any additional backend remains disabled for mutation until it independently passes the same gate.

### P1 — Agent-viewable and safely editable MVP

- [ ] Implement `workbook_inspect` with bounded workbook, sheet, feature, engine, package, link, and macro metadata.
- [ ] Implement `workbook_read` for targeted ranges with values, formulas, cached results, style IDs, merges, dimensions, and hidden-state metadata.
- [ ] Implement `workbook_render` for focused ranges/sheets with PNG image blocks and explicit renderer/fidelity metadata.
- [ ] Implement `workbook_edit` dry-run planning and core operations: values, formulas, clear, copy/fill, font, fill, border, alignment, number format, merge, row height, and column width.
- [ ] Implement non-destructive save, explicit in-place overwrite, strict `.xlsx`/`.xlsm` extension handling, and macro-preservation gates.
- [ ] Implement `workbook_validate` and `workbook_diff` for values, formulas, styles, dimensions, structure, OOXML parts, and macros.
- [ ] Add compact tool renderers and progress updates without relying on TUI-only APIs.
- [ ] Write `skills/workbook-editor/SKILL.md` with inspect-before-edit, render-when-visual, dry-run-first, validate-after-edit, and macro-safety routing.
- [ ] Verify all tools in TUI, print/JSON, and RPC/WebUI modes.

P1 exit gate: an agent can inspect, render, edit, and verify representative `.xlsx` and `.xlsm` files while VBA remains byte-identical and outputs open cleanly in Excel.

### P2 — Feature-rich formatting and workbook semantics

- [ ] Complete font, fill/pattern, border/diagonal, alignment, text rotation, rich text, number-format, and protection support.
- [ ] Add row/column insert/delete, hide/unhide, grouped outlines, autofit policies, freeze panes, sheet create/delete/rename/reorder, tab colors, and view settings.
- [ ] Add conditional formatting with priority/stop-if-true handling and range-safe rule updates.
- [ ] Add data validation, tables, filters, sorts, defined names, hyperlinks, comments/notes, and threaded-comment preservation policy.
- [ ] Add image insertion/replacement, chart creation/style updates, chart data-source changes, and chart rendering verification.
- [ ] Add print area, print titles, margins, orientation, scaling, headers/footers, page breaks, and workbook theme handling.
- [ ] Add sheet/range templates and copy-format operations so agents can reproduce existing styles instead of reconstructing every property.
- [ ] Add semantic and rendered golden tests for every formatting operation on both `.xlsx` and `.xlsm`.

P2 exit gate: the formatting operation matrix is documented, fixture-tested, visually verified, and identical for `.xlsx` and `.xlsm` except for macro-specific constraints.

### P3 — Advanced features, scale, and portability

- [ ] Add safe support or explicit preservation-only policies for PivotTables, pivot caches, slicers, timelines, sparklines, shapes, form controls, and embedded objects.
- [ ] Define formula-calculation behavior, unsupported-function reporting, iterative calculation settings, array/dynamic formulas, and cached-result policy without refreshing external data.
- [ ] Add workbook/sheet protection editing with redacted password handling and explicit destructive warnings.
- [ ] Add streaming/read-only paths for large workbooks, bounded shared-string/style parsing, progress updates, cancellation tests, and memory budgets.
- [ ] Add deterministic preview caching keyed by workbook hash, sheet/range, renderer, and render options.
- [ ] Deliver and test the selected cross-platform high-fidelity backend or clearly document platform capability tiers.
- [ ] Add package installation diagnostics, README compatibility matrix, migration notes, and dry-run packaging verification.

P3 exit gate: capability reports accurately predict supported edits across platforms, and unsupported advanced objects are preserved or rejected without silent loss.

### P4 — Separately reviewed VBA capabilities

- [ ] Add read-only VBA metadata inspection only if the selected backend can expose module names, references, signatures, and project protection without executing code.
- [ ] Produce a separate threat model and design proposal before exposing VBA source extraction or replacement.
- [ ] Keep VBA execution out of the default package; any future executor must be a separately installed, disabled-by-default tool with explicit per-run confirmation and isolation.

P4 exit gate: no VBA mutation or execution ships merely because `.xlsm` preservation is supported.

## Test and verification strategy

### Unit tests

- Path normalization, extension/content-type matching, operation validation, literal/formula separation, leading formula-character handling, style normalization, range parsing, and output truncation.
- ZIP traversal/encryption/decompression limits, OOXML manifests, relationship resolution, non-canonical protected-part classification, and protected-part hash comparison.
- Transaction rollback, mandatory expected-hash conflicts, overwrite guards, durable-write behavior, recovery paths, cancellation, and worker timeout/owned-process handling.

### Fixture and integration tests

- Open/inspect/read/render/edit/diff/validate each corpus file.
- Run each edit against `.xlsx` and the equivalent `.xlsm` fixture.
- Verify every protected part discovered through content types/relationships before and after each mutation.
- Prove harmless auto-open/event sentinel macros never run and external links/data connections never refresh during inspect, render, validate, edit, or save.
- Reopen outputs using the selected backend and an independent validator.
- If native Excel is selected, use a controlled interactive Windows validation host to detect repair/recovery dialogs or automation errors and verify worker ownership/cleanup.
- Compare normalized semantic snapshots and rendered PNGs with reviewed tolerances.

### Pi integration tests

- Mock `ExtensionAPI` and assert all six tools register with strict schemas, prompt snippets, and named guidelines.
- Verify mutation tools use `withFileMutationQueue()` for the complete transaction window.
- Verify custom tool results remain bounded and full artifacts are available by path.
- Exercise calls in RPC mode without any TUI-only dialog dependency.
- Verify thrown errors set tool failure correctly and do not leak passwords or workbook contents beyond requested ranges.

### Required future checks

```bash
npm --prefix pi-extension-workbook run check
npm --prefix pi-extension-workbook test
npm --prefix pi-extension-workbook run pack:dry
git diff --check
```

Do not publish until P0 and P1 exit gates pass and the package tarball contains every runtime worker, skill, and fixture required outside development.

## Key risks and mitigations

| Risk | Mitigation |
|---|---|
| A writer silently drops unsupported Excel parts | Pre/post OOXML manifest, capability checks, independent reopen, fail-closed save. |
| `.xlsm` macros or signatures are damaged | Protected-part byte hashes, strict macro policy, corpus coverage, no original overwrite on mismatch. |
| Native Excel hangs or opens a dialog | Short-lived worker, interactive-session requirement, hard timeout, owned-process cleanup, capability doctor. |
| A macro or external connection executes during inspection | Force-disable automation macros, disable events/links/refresh, never use macro execution APIs. |
| Commercial backend creates deployment lock-in | Stable backend interface, mandatory OOXML integrity core, documented licensing/capability tiers. |
| Large ranges overwhelm model context | Focused selectors, style deduplication, truncation, full temp artifacts, image previews. |
| Parallel agent calls lose edits | `withFileMutationQueue()`, expected hashes, transactional destination writes. |
| Formula engines alter results unexpectedly | Preserve formulas/caches by default, no implicit recalculation, explicit capability warnings. |
| Agent requests an unsupported rich feature | Per-file/per-operation capability plan and dry-run refusal before mutation. |

## References reviewed

- Pi extension and custom-tool documentation, including `StringEnum` import guidance: `@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi package documentation: `@earendil-works/pi-coding-agent/docs/packages.md`
- Pi RPC behavior: `@earendil-works/pi-coding-agent/docs/rpc.md`
- Pi extension examples: `@earendil-works/pi-coding-agent/examples/extensions/`
- Shared path/write/process helpers: `pi-utils/src/paths.ts`, `pi-utils/src/json.ts`, and `pi-utils/src/process.ts`
- Open Packaging Conventions fundamentals: <https://learn.microsoft.com/en-us/previous-versions/windows/desktop/opc/open-packaging-conventions-overview>
- SheetJS VBA documentation: <https://docs.sheetjs.com/docs/csf/features/vba/>
- openpyxl load/save limitations: <https://openpyxl.readthedocs.io/en/3.1/tutorial.html>
- Aspose.Cells for Node.js via Java: <https://docs.aspose.com/cells/nodejs-java/>
- Microsoft Excel automation security: <https://learn.microsoft.com/en-us/office/vba/api/excel.application.automationsecurity>
- Microsoft unattended Office automation considerations: <https://support.microsoft.com/en-us/visio/considerations-for-server-side-automation-of-office>

## First implementation action

Start P0 by scaffolding `pi-extension-workbook`, defining the backend-neutral contracts, and creating the fidelity corpus plus OOXML manifest before writing any production workbook mutation path.
