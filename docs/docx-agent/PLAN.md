# Pi Agent DOCX Editor and WebUI Viewer — Implementation Plan

Date: 2026-07-14  
Status: Implementation in progress; local P0/P1 code and ONLYOFFICE rendering verified, .NET/Word host gates remain
Primary target: `pi-extension-docx` / `@firstpick/pi-extension-docx`  
WebUI target: `pi-package-webui`

## Progress tracker

The checkboxes in [Priority implementation plan](#priority-implementation-plan) are the canonical tracker. Update them in place; do not maintain a second implementation checklist elsewhere.

Legend:

- `[x]` complete and verified
- `[-]` actively being implemented
- `[ ]` not started or blocked

Planning completed:

- [x] Verify current Pi core, `pi-docparser`, RPC, and Pi WebUI attachment behavior.
- [x] Compare Open XML SDK, `python-docx`, LibreOffice UNO, browser-only DOCX renderers, and ONLYOFFICE.
- [x] Select an OOXML-native edit engine plus a separate layout/rendering engine.
- [x] Define the initial safety, fidelity, WebUI, and rollout boundaries.

## Goal

Give Pi agents dedicated tools to inspect, search, visually render, safely edit, diff, validate, and save Word documents while preserving unrelated DOCX package content. Give Pi WebUI a secure document viewer for rendered pages, semantic structure, staged revisions, and before/after diffs.

The production design must prioritize document integrity and explicit capability reporting over best-effort edits. A request must fail before commit whenever the available engine cannot preserve detected features.

## Scope by format

| Format | Initial policy | Long-term policy |
|---|---|---|
| `.docx` | Native inspect, render, edit, diff, validate, and save-as target. | Full supported operation matrix with explicit preservation-only areas. |
| `.dotx` | Read-only or convert to a new `.docx` in P1. | Native template-aware support after DOCX gates pass. |
| `.docm` / `.dotm` | Inventory only; P1 rendering and mutation are blocked as active content. | Preserve macro/signature-related parts byte-identically where possible; mutation/rendering remain capability-gated. |
| `.doc`, `.rtf`, `.odt` | Convert to a new `.docx`; never edit the source in place. | Optional export back with a prominent fidelity report. |
| Encrypted documents | Detect and refuse without an explicit user-supplied password. | Isolated, ephemeral decryption with password redaction and capability checks. |

## Non-goals for the first production release

- No claim of pixel-identical Microsoft Word pagination on every platform.
- No direct binary handling added to Pi core `read`, `edit`, or `write`.
- No raw OOXML editing interface exposed to the model.
- No automatic macro, OLE, field, external-template, DDE, or linked-content execution.
- No silent conversion between `.docx`, `.docm`, or legacy formats.
- No source overwrite by default.
- No browser WYSIWYG editor built from scratch.
- No requirement for ONLYOFFICE, Collabora, Microsoft 365, or another network service in the base package.
- No unattended Microsoft Word COM automation as a production backend.
- No cloud upload by the document package unless a future separately reviewed provider is explicitly configured.

## Success criteria

A production release is acceptable only when all of these are true:

1. Pi can inventory document properties, stories, paragraphs, runs, styles, lists, tables, sections, headers/footers, images, links, fields, comments, revisions, content controls, embedded objects, macros, signatures, and external relationships with bounded output.
2. Pi can read focused semantic regions using stable selectors and can search text that spans OOXML run boundaries.
3. Pi can render selected pages to PNG and return them as image tool-result blocks in TUI and WebUI.
4. Pi can apply a versioned, transactional patch list to a staged copy without exposing raw XML to the model.
5. Outputs pass ZIP/package checks, Open XML validation, independent reopen, semantic diff, and configured render checks.
6. Untouched and protected package parts remain present and unchanged according to the operation's declared preservation contract.
7. Unsupported or lossy edits fail closed before any destination is committed.
8. Default edits create a new file. In-place overwrite requires explicit user intent, source-hash agreement, atomic replacement, and recovery data.
9. Same-file mutations use Pi's `withFileMutationQueue()` for the complete read-modify-validate-commit window.
10. Tools work in TUI, print/JSON, and RPC/WebUI modes without depending on TUI-only custom components.
11. WebUI never receives unrestricted host paths for previews or downloads; it receives validated, expiring artifact URLs.
12. Large semantic output and reports are truncated to Pi limits with complete artifacts written to temporary files.
13. A representative corpus opens without a Microsoft Word repair prompt and without a repair prompt in every renderer/interoperability suite claimed by the package.
14. Capability reports accurately distinguish native edits, preservation-only features, conversion-only formats, and unsupported operations.

## Current baseline

- Pi core `@file` processing and the built-in `read` tool treat non-image files as UTF-8 text; they do not semantically parse DOCX.
- Pi RPC accepts text and inline image content, not arbitrary binary office attachments.
- Pi WebUI already uploads `.doc` and `.docx` files to a local temporary directory and includes their paths in the prompt.
- Pi WebUI already renders image content blocks returned by generic custom tools, so a basic `docx_render` tool needs no WebUI change.
- `pi-docparser` 3.0.1 with LiteParse 2.0.1 provides read-oriented parsing, search, bounding boxes, and screenshots for office files.
- ONLYOFFICE Desktop Editors 9.4.0 is installed and its `x2t` converter passes controlled DOCX-to-PDF, text/font extraction, and LiteParse PNG integration tests. LibreOffice is absent and is no longer a local rendering dependency.
- Pi RPC `ctx.ui.custom()` is unavailable; rich browser document UI must be implemented in WebUI rather than only in a TUI extension.

## Architecture decisions

### 1. Keep DOCX capability outside Pi core

Build an independently installable Pi package with custom tools, a companion skill, a versioned patch schema, backend adapters, and fixture-driven tests. Do not override built-in `read` or `edit` globally.

The extension may block direct built-in `edit`/`write` attempts against supported office binaries and tell the agent to use the DOCX tools instead.

Proposed layout:

```text
pi-extension-docx/
├── index.ts
├── package.json
├── README.md
├── LICENSE
├── src/
│   ├── schemas.ts
│   ├── paths.ts
│   ├── output.ts
│   ├── capabilities.ts
│   ├── errors.ts
│   ├── tools/
│   │   ├── inspect.ts
│   │   ├── read.ts
│   │   ├── render.ts
│   │   ├── edit.ts
│   │   ├── diff.ts
│   │   ├── validate.ts
│   │   └── commit.ts
│   ├── core/
│   │   ├── transaction.ts
│   │   ├── workspace.ts
│   │   ├── operation-plan.ts
│   │   ├── selectors.ts
│   │   ├── ooxml-manifest.ts
│   │   ├── protected-parts.ts
│   │   ├── document-diff.ts
│   │   └── artifact-manifest.ts
│   └── backends/
│       ├── interface.ts
│       ├── openxml-sidecar.ts
│       ├── document-renderer.ts
│       ├── onlyoffice-renderer.ts
│       ├── libreoffice-renderer.ts
│       └── liteparse-reader.ts
├── engine/
│   ├── DocxEngine.sln
│   ├── DocxEngine/
│   │   ├── Program.cs
│   │   ├── Protocol/
│   │   ├── Inspect/
│   │   ├── Edit/
│   │   ├── Validate/
│   │   └── Security/
│   └── DocxEngine.Tests/
├── skills/
│   └── docx-editor/
│       └── SKILL.md
└── tests/
    ├── fixtures/
    ├── unit/
    ├── integration/
    ├── corpus/
    └── webui/
```

Use `@firstpick/pi-utils` for shared path normalization, atomic-write primitives, and process lifecycle where its guarantees are sufficient. Add DOCX-specific wrappers for transaction durability, ZIP limits, sidecar cancellation, and child-process ownership.

### 2. Use Open XML SDK as the canonical mutation engine

Use a small .NET sidecar based on `DocumentFormat.OpenXml` rather than implementing WordprocessingML directly in TypeScript.

Responsibilities:

- Parse and manipulate OOXML using strongly typed schema classes.
- Preserve markup-compatibility and unknown content whenever supported.
- Validate edited packages with `OpenXmlValidator`.
- Produce a normalized semantic snapshot and modified-part payloads.
- Return machine-readable capability and preservation reports.
- Never render, run macros, refresh links, or rely on Microsoft Word.

The sidecar should use a versioned JSON protocol over stdin/stdout. The TypeScript extension owns paths, Pi tool schemas, transaction staging, output truncation, and user-facing errors.

Start as a one-shot process for reliability. Consider a session-scoped persistent process only after profiling proves startup overhead material and shutdown behavior is fully tested.

### 3. Use ONLYOFFICE preferentially and LibreOffice optionally for rendering/conversion

Neither office suite is the canonical writer for native DOCX edits because an office-suite round trip may alter unrelated OOXML. Automatic selection prefers the locally installed ONLYOFFICE Desktop Editors `x2t` converter and falls back to LibreOffice; `PI_DOCX_RENDERER` can pin either backend. Use the selected backend for:

- DOCX-to-PDF export for page-faithful previews.
- Optional independent open/render verification.
- Future explicit import of `.doc`, `.rtf`, and `.odt` into a new DOCX after native gates pass.

ONLYOFFICE receives generated XML, a private source copy, private HOME/temp directories, and a private snapshot of its generated font metadata. LibreOffice receives a unique temporary profile, forced macro security, and disabled link updates. Both use hard timeouts, abort propagation, process-tree ownership, output limits, and worker-owned cleanup. Active-content packages and non-hyperlink external relationships are blocked before either renderer starts. Record the selected engine, fonts, DPI, isolation settings, and substitution/fidelity warnings in render metadata.

Use LiteParse/PDFium to turn the exported PDF into selected PNG page images and to provide page-based text/bounding-box search where useful.

### 4. Preserve untouched OOXML parts surgically

Before mutation, build a manifest for every ZIP entry containing:

- canonical entry path;
- content type;
- relationships and external targets;
- compressed/uncompressed size and CRC where available;
- SHA-256 of the uncompressed payload;
- classification: editable, preserved, protected, active content, signed, or unsupported.

The edit engine should return only changed part payloads where practical. Rebuild the output from the original package while transplanting changed parts, preserving every untouched payload byte-identically. A no-op edit must not rewrite the package.

Protected or high-risk content includes at minimum:

```text
word/vbaProject.bin
word/vbaProjectSignature.bin
word/embeddings/**
word/activeX/**
word/diagrams/**
word/charts/**
customUI/**
customXml/**
package and VBA signature parts
external relationships and attached templates
OLE objects, altChunk content, and unknown binary parts
```

Detection must use content types and the complete relationship graph, not path names alone.

### 5. Stable selectors and document intermediate representation

Expose a bounded semantic representation rather than OOXML nodes. It should cover document stories such as the main body, headers, footers, footnotes, endnotes, comments, and text boxes when supported.

Prefer existing `w14:paraId` values for paragraph identity. Where no persistent identifier exists, derive a selector from story, structural path, neighboring fingerprints, and expected content. Do not mutate a source merely to add IDs during inspection.

Initial selector forms:

- paragraph ID plus expected paragraph hash;
- story and structural path;
- table/row/cell path with expected cell hash;
- bookmark name;
- content-control tag/title;
- comment or revision ID;
- exact text anchor with expected occurrence count and surrounding context.

Page numbers are render-engine output, not stable OOXML identifiers, and must not be the sole edit selector.

### 6. Versioned declarative patch model

`docx_edit` accepts `schemaVersion`, `expectedSourceSha256`, `dryRun`, and an ordered operation list. The transaction succeeds completely or commits nothing.

P1 operation families:

- exact text replacement across run boundaries;
- insert paragraph before/after an anchor;
- delete a paragraph with an exact precondition;
- set text in a table cell;
- insert/delete table rows under strict merge constraints;
- set character emphasis and basic font properties;
- set paragraph style, alignment, spacing, and indentation;
- add/update/remove a hyperlink;
- update core document properties.

P2 operation families:

- lists and numbering;
- borders, shading, tabs, and advanced run properties;
- section and page settings;
- headers and footers;
- images and alternative text;
- comments and replies;
- tracked insertion/deletion plus accept/reject operations;
- footnotes/endnotes;
- bookmarks and cross-references;
- content controls and fields with explicit recalculation warnings.

Every operation declares:

- selector and expected state;
- mutation payload;
- capability required;
- parts expected to change;
- whether visual verification is recommended or mandatory.

The model must never receive a generic `set_xml`, XPath mutation, or arbitrary ZIP-part replacement operation.

### 7. Stable agent-facing tool surface

| Tool | Mutation | Purpose |
|---|---|---|
| `docx_inspect` | No | Inventory document structure, features, security risks, package hashes, engines, and capabilities. |
| `docx_read` | No | Return bounded semantic content by story, selector, outline region, or exact search query. |
| `docx_render` | No | Render selected pages to PNG and return image blocks plus artifact metadata. |
| `docx_edit` | Staged | Dry-run or apply a transactional patch list to a private staged revision; never overwrites the source. |
| `docx_diff` | No | Compare semantic content, formatting, structure, OOXML parts, protected content, and optional rendered pages. |
| `docx_validate` | No | Run package, schema, reopen, preservation, and optional render checks. |
| `docx_commit` | Yes | Save a validated staged revision to a new path or explicitly confirmed in-place destination. |

Add `office_convert` only after native DOCX gates pass. A future `docx_create` must reuse the same patch schema rather than inventing a separate authoring model.

All enum fields use `StringEnum` from `@earendil-works/pi-ai`. Tool output must follow Pi truncation guidance and store complete JSON/reports in temporary artifacts.

### 8. Agent workflow

The skill and tool guidelines enforce this sequence:

1. `docx_inspect` before editing an unfamiliar document.
2. `docx_read` for the exact stories/blocks involved.
3. `docx_render` when layout, pagination, tables, images, or formatting matter.
4. `docx_edit` with `dryRun: true` and exact preconditions.
5. `docx_edit` to create a staged revision.
6. `docx_validate`, `docx_diff`, and focused before/after rendering.
7. `docx_commit` to a new path.
8. Overwrite the source only when explicitly requested and every gate passes.

### 9. Transaction and file-safety model

Every mutation must:

1. Normalize leading `@`, `~`, relative, and absolute paths.
2. Resolve source and destination paths and reject unsafe symlink/path escapes.
3. Compute the source SHA-256 and package manifest.
4. Create a private workspace and copy the source without modifying it.
5. Apply all operations to a candidate revision.
6. Run validation and produce semantic/package diffs.
7. Acquire `withFileMutationQueue()` for the real destination path for the entire commit window.
8. Recheck the source and destination precondition hashes immediately before commit.
9. Write and flush a sibling temporary file, then atomically replace only after all gates pass.
10. Preserve a timestamped recovery copy for explicit source overwrite.
11. Return source, staged, and output hashes; changed parts; validation results; engine versions; warnings; and recovery path in tool details.

Default naming should be non-destructive, for example `contract.pi-edited.docx`. Existing destinations require explicit `overwrite: true`; overwriting the original additionally requires a real user confirmation in TUI/RPC UI. Print/JSON mode must refuse source overwrite unless an independently designed non-interactive confirmation contract is satisfied.

### 10. WebUI integration strategy

#### P1: use existing generic tool rendering

`docx_render` returns PNG image content blocks. Current WebUI generic tool cards already display those images, so basic page viewing and before/after previews require no custom browser component.

#### P2: add a generic document artifact protocol

Define a versioned tool-detail contract reusable by future PDF, presentation, and spreadsheet viewers:

```json
{
  "artifact": {
    "schema": "pi.artifact/v1",
    "kind": "document",
    "id": "doc-revision-id",
    "title": "contract.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pageCount": 12,
    "manifestPath": "...",
    "downloadPath": "...",
    "expiresAt": "..."
  }
}
```

The WebUI backend must validate artifact roots and replace every local path with an expiring tokenized URL. Generalize the existing native-download token mechanism rather than exposing arbitrary paths.

Browser viewer capabilities:

- page thumbnails and page navigation;
- zoom, fit width, and rotate view;
- text search and page hit navigation;
- semantic outline/story view;
- comments/revisions summary;
- before/after and visual-diff modes;
- download staged or committed output;
- “send selection to composer” without directly mutating the document.

WebUI must keep document actions tab-scoped and reject stale document/revision IDs. Rich actions should route through Pi tools or a versioned extension RPC bridge, not through unrestricted WebUI filesystem endpoints.

#### P4: optional WYSIWYG integration

If a human Word-like editor is required, integrate an optional ONLYOFFICE or Collabora service. Keep it outside the base package and behind explicit setup, licensing, storage-callback, JWT, locking, and conflict-resolution requirements. Agent patches remain the authoritative auditable mutation path.

### 11. Sidecar distribution

P0 should choose one of these deployment models after measuring package size and startup behavior:

1. Ship a framework-dependent .NET executable and require a current supported .NET runtime.
2. Publish self-contained binaries as platform-specific optional npm packages selected by `os`/`cpu`.
3. Use a small bootstrap package plus manually installed sidecar path.

Do not use lifecycle scripts to download or execute unverified binaries. Pi installations commonly suppress install scripts. Every shipped binary needs checksums, provenance, license notices, and CI-produced reproducible release metadata.

Target at least Windows x64, Linux x64, Linux arm64, macOS arm64, and macOS x64 before claiming broad cross-platform support.

### 12. Security boundaries

- Reject ZIP path traversal, duplicate/conflicting entries, encrypted ZIP members, unreasonable entry counts, excessive compression ratios, and oversized XML/binary parts.
- Disable DTD and external entity resolution in every XML parser.
- Never execute macros, OLE objects, external templates, fields, links, or embedded scripts during inspect, render, validate, edit, or commit.
- Inventory `file:`, UNC, HTTP(S), attached-template, DDE, and other external relationships without dereferencing them.
- Run ONLYOFFICE `x2t` with generated task XML, a private source/HOME/temp workspace, and a private font-metadata snapshot; run LibreOffice fallback with a private profile, macro security, no first-run UI, and no link refresh. Apply hard timeouts and owned-process cleanup to both.
- Treat passwords as sensitive inputs; never place them in logs, details, session entries, artifacts, or error messages.
- Detect package and VBA signatures. P1 refuses signed-document mutation; a later policy may permit an explicitly unsigned copy with a clear warning.
- Detect `.docm`/`.dotm` active content and fail closed unless the backend has independently passed macro-preservation gates.
- Bound model-visible content and redact hidden document data unless the user asked to inspect it.
- Store workspaces and renders under a package-owned temp/cache root with restrictive permissions and TTL cleanup.
- Honor `AbortSignal` and hard timeouts in the TypeScript extension, .NET sidecar, ONLYOFFICE/LibreOffice processes, and rendering pipeline.

## Priority model

| Priority | Meaning |
|---|---|
| P0 | Architecture, fidelity, security, and transaction foundations that block all mutation work. |
| P1 | Safe agent-facing DOCX MVP usable from TUI, print/JSON, and RPC/WebUI. |
| P2 | Rich Word semantics plus the first-class WebUI document artifact viewer. |
| P3 | Advanced OOXML, active-content preservation, legacy formats, scale, and broad platform packaging. |
| P4 | Optional WYSIWYG collaboration and separately reviewed high-risk capabilities. |

## Milestone dependency map

| Milestone | Depends on | Exit evidence |
|---|---|---|
| P0 foundation | None | Corpus, engine ADR, no-op fidelity, package intake, transaction, and renderer spikes pass. |
| P1 agent MVP | P0 | Inspect/read/render/edit/diff/validate/commit workflow passes all Pi modes and representative DOCX fixtures. |
| P2 rich + WebUI | P1 | Advanced semantic operations and tokenized browser viewer pass integration and visual tests. |
| P3 breadth | P2 | Capability matrix covers advanced parts, related formats, scale, and supported platforms without silent loss. |
| P4 optional editor | P2; P3 where format-specific | Optional service integration has licensing, threat-model, locking, and conflict gates. |

## Priority implementation plan

### P0 — Fidelity, engine, package, and safety foundation

- [x] Scaffold `pi-extension-docx` with package metadata, extension entry point, source layout, skill directory, .NET engine project, fixtures, and `check`/`test`/`pack:dry` scripts.
- [x] Write an ADR recording Open XML SDK as canonical mutation engine, ONLYOFFICE-preferred/LibreOffice-fallback rendering, LiteParse as read/render helper, and fail-closed backend selection.
- [x] Define versioned `DocxEngine`, capability, selector, patch-operation, artifact, tool-result, warning, and structured-error contracts.
- [x] Define stable machine-readable error codes, including `SOURCE_CHANGED`, `DESTINATION_EXISTS`, `UNSUPPORTED_FEATURE`, `LOSSY_OPERATION`, `SIGNED_DOCUMENT`, `ACTIVE_CONTENT_BLOCKED`, `INVALID_PACKAGE`, `VALIDATION_FAILED`, `RENDER_FAILED`, and `DEPENDENCY_MISSING`.
- [ ] Reuse `@firstpick/pi-utils` for path/process/atomic-write primitives and add missing binary durability, child-process ownership, abort, and Windows replacement guarantees.
- [x] Implement bounded OOXML intake: ZIP traversal and duplicate rejection, entry/count/size/ratio limits, XML entity safety, encrypted-package detection, and redacted errors.
- [x] Implement OOXML content-type and relationship graph inventory, SHA-256 manifests, external-target inventory, and protected-part classification.
- [x] Build a legally redistributable synthetic corpus covering styles, themes, lists, nested/merged tables, sections, columns, headers/footers, footnotes/endnotes, comments, revisions, content controls, fields, bookmarks, links, images, charts, SmartArt, text boxes, custom XML, embeddings, external relationships, signatures, `.docm`, encryption, and malformed packages.
- [ ] Implement the .NET JSON sidecar protocol, cancellation, timeout, protocol-version negotiation, version reporting, and stderr redaction.
- [ ] Run a no-op Open XML SDK round-trip spike and prove that unchanged parts are preserved; design surgical changed-part transplantation for any rewritten-part gaps.
- [x] Implement semantic snapshots and stable selector generation without mutating documents during inspection.
- [ ] Implement `OpenXmlValidator` integration, independent reopen checks, and package-manifest comparison.
- [x] Implement and verify an ONLYOFFICE `x2t` render spike using generated task XML, isolated workspaces, private font metadata, PDF export, selected-page PNG output, font reporting, hard timeout, and cleanup; retain LibreOffice as an optional fallback.
- [x] Add `/docx-doctor` for Open XML sidecar, .NET runtime, ONLYOFFICE/LibreOffice, LiteParse, fonts, platform support, and workspace diagnostics.
- [x] Define transaction workspace layout, TTL cleanup, source/staged revision hashes, recovery metadata, and artifact ownership.
- [x] Implement staged transactions, mandatory source-hash preconditions, destination `withFileMutationQueue()`, durable atomic commit, overwrite guards, and recovery copies.
- [x] Define and document the P1 preservation matrix for unsupported parts, signed documents, active content, fields, and legacy imports.
- [x] Define and integrate `pi.artifact/v1` in the DOCX extension and WebUI before tool details become a compatibility contract.
- [x] Run threat-model review for DOCX ZIP/XML intake, office-suite rendering, external relationships, passwords, active content, and browser artifact serving; record residual process-sandbox/network-sentinel risks.

P0 exit gate: a no-op DOCX passes package and semantic comparison without source overwrite or repair prompts; the selected engine can safely modify a staged fixture; the configured office renderer can render a controlled document without macro/link execution; invalid, signed, active-content, and oversized fixtures fail according to policy; transaction rollback leaves source and destination unchanged. ONLYOFFICE rendering is proven locally; Open XML sidecar and renderer network-sentinel evidence remain open.

### P1 — Safe agent-facing DOCX MVP

- [x] Implement `docx_inspect` with bounded properties, stories, outline, feature inventory, security warnings, package summary, engine versions, and operation capabilities.
- [x] Implement `docx_read` for selected stories, paragraphs, table cells, bookmarks, content controls, comments, and exact cross-run search with stable selectors.
- [x] Implement `docx_render` for selected pages with PNG image blocks, PDF/page artifacts, page count, renderer metadata, fonts, and fidelity warnings; verify the ONLYOFFICE path on a controlled fixture.
- [ ] Implement `docx_edit` dry-run planning with exact selector/precondition resolution and declared changed-part estimates.
- [ ] Implement P1 text operations: cross-run exact replacement, insert paragraph, delete paragraph, and replacement-count enforcement without flattening unrelated run formatting.
- [ ] Implement P1 table operations: set cell text and guarded row insertion/deletion while preserving merges outside the mutation.
- [ ] Implement P1 formatting operations: bold/italic/underline, font family/size/color, paragraph style, alignment, spacing, and indentation.
- [ ] Implement P1 hyperlink and core-property operations.
- [x] Implement staged revision creation; `docx_edit` must never overwrite source or destination paths.
- [x] Implement `docx_diff` for semantic text, run/paragraph formatting, tables, relationships, changed OOXML parts, protected parts, and optional page renders.
- [ ] Implement `docx_validate` with ZIP, content type, relationships, Open XML schema, reopen, preservation, semantic, and configured render gates.
- [x] Implement `docx_commit` with new-path default, explicit overwrite, source/destination hash checks, real UI confirmation for source overwrite, atomic replacement, and recovery copy.
- [x] Add progress updates and compact tool renderers while keeping all functionality available without TUI-only APIs.
- [x] Add guards that block built-in text `edit`/`write` against `.docx`/`.docm` and direct the agent to DOCX tools.
- [x] Write `skills/docx-editor/SKILL.md` with inspect-before-edit, focused-read, render-when-visual, dry-run-first, validate/diff-before-commit, save-as-default, and active-content rules.
- [x] Document supported selectors, operations, preservation guarantees, errors, examples, and known layout differences in README.
- [ ] Verify every tool in TUI, print, JSON, and RPC/WebUI sessions.
- [x] Verify WebUI generic tool-card image handling and DOCX image-result privacy through package/static harnesses; real browser visual review remains part of the all-modes gate.
- [ ] Run the representative P1 corpus through Microsoft Word on a controlled interactive Windows validation host and through each claimed interoperability renderer without repair prompts.

P1 exit gate: an agent can inspect, read, render, safely edit, diff, validate, and save-as representative DOCX files from every Pi mode. Unsupported constructs are preserved or rejected, no original file is changed without confirmation, and output opens cleanly in Microsoft Word and every renderer/interoperability suite claimed by the package.

### P2 — Rich DOCX semantics and first-class WebUI viewer

- [ ] Add complete run and paragraph formatting needed for daily documents: highlighting, strike, sub/superscript, borders, shading, tabs, keep rules, widows/orphans, and pagination flags.
- [ ] Add numbering/list inspection and safe list creation/update while preserving numbering definitions and style inheritance.
- [ ] Add advanced table support: width/layout, borders/shading, alignment, cell margins, vertical merges, horizontal spans, nested tables, repeating headers, and captions.
- [ ] Add section support: page size/orientation, margins, columns, page numbering, breaks, headers/footers, first/even-page variants, and link-to-previous behavior.
- [ ] Add image insertion/replacement, sizing, anchors/inline policy, relationship management, captions, and alternative text.
- [ ] Add comments: inspect, add, reply, resolve/delete where representable, and explicit unsupported modern-comment metadata warnings.
- [ ] Add tracked changes: tracked insert/delete, list revisions, accept/reject selected revisions, author/date metadata, and cross-run boundary tests.
- [ ] Add footnotes/endnotes, bookmarks, content-control updates, and field inspection/update policies without implicit field execution.
- [ ] Add document creation from a blank/template DOCX by reusing the patch schema.
- [x] Implement `pi.artifact/v1` recognition in the WebUI backend and enrich tool events with safe, expiring artifact URLs.
- [ ] Generalize native-download token handling into a root-confined artifact registry with MIME, TTL, tab, session, and revision checks.
- [x] Add WebUI artifact endpoints for manifest, page image, semantic outline/diff metadata, and download; prohibit arbitrary path parameters.
- [x] Add a browser document modal with thumbnails, page navigation, zoom/fit, text search, outline, comments/revisions summary, and staged-output download.
- [ ] Add semantic and visual before/after diff views with clear renderer/fidelity metadata.
- [ ] Add “send selection/page/block to composer” while keeping actual mutation routed through Pi tools.
- [ ] Add stale artifact/revision handling, cleanup, inactive-tab behavior, remote-auth/trust-boundary coverage, and mobile layout.
- [ ] Add WebUI static and HTTP harness tests for token confinement, expiration, cross-tab isolation, MIME headers, range/page requests, large documents, and malicious paths.
- [ ] Add semantic and rendered golden tests for every P2 operation.

P2 exit gate: daily DOCX structures can be edited transactionally, comments/revisions work within the documented matrix, and WebUI provides secure page/outline/diff viewing without filesystem path exposure or bypassing Pi mutation guards.

### P3 — Advanced OOXML, related formats, scale, and platform breadth

- [ ] Add preservation-only or supported-edit policies for text boxes, drawing anchors, charts, SmartArt, equations, bibliography, citations, glossary parts, custom XML, altChunk, and embedded objects.
- [ ] Add robust field handling for TOC, references, page numbers, dates, merge fields, and formula fields; distinguish instruction text, displayed result, lock state, and recalculation requirement.
- [ ] Add `.dotx` template-aware creation and save behavior.
- [ ] Add `.docm`/`.dotm` inventory and no-op round-trip gates; require VBA, signature, customUI, ActiveX, and embedding preservation before any mutation capability is enabled.
- [ ] Add encrypted-document support with isolated plaintext workspaces, password redaction, TTL cleanup, and explicit output-encryption capability reporting.
- [ ] Implement `office_convert` for `.doc`, `.rtf`, and `.odt` to a new DOCX with source/output hashes, renderer/import version, feature-loss inventory, and no in-place conversion.
- [ ] Add optional export back to supported legacy formats only after corpus-based fidelity thresholds and explicit user confirmation.
- [ ] Add large-document streaming, bounded semantic indexing, render caching keyed by source hash/options/fonts/engine, cancellation, and memory/time budgets.
- [ ] Publish and verify the selected .NET sidecar distribution strategy across Windows x64, Linux x64/arm64, and macOS x64/arm64.
- [ ] Add binary checksums, SBOM, provenance, third-party notices, and release verification for every platform package.
- [ ] Add controlled Microsoft Word interoperability tests for clean open/save, repair prompts, tracked changes, comments, fields, and advanced fixtures without using Word as the production mutation backend.
- [ ] Publish a platform/format/feature capability matrix generated from executable tests rather than manually maintained claims.

P3 exit gate: advanced constructs are edited, preserved, or rejected according to an executable capability matrix; legacy conversion is explicitly lossy and non-destructive; large documents remain bounded; supported platform packages install without lifecycle downloads.

### P4 — Optional WYSIWYG and separately reviewed high-risk capabilities

- [ ] Write a separate decision record comparing ONLYOFFICE and Collabora for optional local WYSIWYG editing, including license review, deployment, update ownership, resource usage, and offline behavior.
- [ ] Define the storage callback, JWT, artifact URL, save callback, version lock, and conflict-resolution protocol for an optional browser editor.
- [ ] Ensure simultaneous agent and human edits use revision hashes/locks and can never silently overwrite one another.
- [ ] Implement the selected editor integration as an optional package/service, not a base DOCX dependency.
- [ ] Add explicit user controls for opening a staged revision, importing the human-saved revision, reviewing its diff, and committing it through normal validation gates.
- [ ] Produce a separate threat model before exposing macro source extraction, replacement, signing, or any execution capability.
- [ ] Keep macro execution out of the default and optional DOCX editor packages; any future executor must be separately installed, disabled by default, isolated, and confirmed per run.
- [ ] Evaluate an optional interactive Microsoft Word adapter only for user-driven desktop workflows; never advertise it for unattended service automation.

P4 exit gate: optional WYSIWYG editing cannot bypass transaction, validation, path, authentication, licensing, or conflict safeguards. No macro execution ships as an incidental consequence of DOCM preservation.

## Test and verification strategy

### Unit tests

- Path normalization, `@` stripping, tilde handling, realpath containment, extension/content-type matching, and safe output naming.
- TypeBox schemas, `StringEnum` compatibility, protocol versions, selector resolution, expected-state conflicts, and operation ordering.
- Cross-run text matching, stable IDs, list/table paths, story addressing, and ambiguous-match refusal.
- ZIP traversal, duplicate names, compression limits, entry limits, XML entity safety, encryption detection, malformed relationships, and external-target classification.
- OOXML manifests, protected-part classification, changed-part allowlists, no-op behavior, and signature detection.
- Transaction rollback, source/destination hash conflicts, mutation queue coverage, atomic replacement, recovery copies, cancellation, timeout, and workspace cleanup.
- Output truncation, artifact paths, error redaction, and password non-disclosure.

### Fixture and integration tests

- Inspect/read/render/edit/diff/validate/commit every supported corpus fixture.
- Run each supported operation against simple and complex formatting boundaries, tables, lists, sections, headers/footers, comments, and revisions.
- Verify untouched/protected part hashes and relationship graphs after every operation.
- Verify malformed, signed, macro-enabled, encrypted, oversized, and externally linked files fail or degrade exactly as documented.
- Reopen with the Open XML engine and each claimed renderer/interoperability suite; use a controlled interactive Microsoft Word host for release gates.
- Compare normalized semantic snapshots and reviewed PNG/PDF goldens with renderer-specific tolerances.
- Prove ONLYOFFICE/LibreOffice render and validation do not execute a harmless macro sentinel, dereference external links, update attached templates, or contact a network sentinel.
- Verify font substitution and pagination differences are reported rather than hidden.

### Pi integration tests

- Mock `ExtensionAPI` and verify all seven tools register with strict schemas, prompt snippets, and tool-named guidelines.
- Verify `docx_edit` cannot write destinations and `docx_commit` owns the only commit path.
- Verify all mutations use `withFileMutationQueue()` for the complete destination commit window.
- Verify errors are thrown so failed tool results receive `isError: true`.
- Verify full reports are stored as artifacts and model-visible results remain bounded.
- Exercise TUI, print, JSON, and real RPC sessions without TUI-only dependencies.
- Verify direct built-in `edit`/`write` calls against office binaries are blocked safely.

### WebUI tests

- Generic tool-result PNG rendering for P1.
- Artifact registration, path confinement, short-lived token generation, expiry, MIME handling, and download disposition.
- Cross-tab/session/revision isolation and stale-token behavior.
- Viewer page navigation, zoom, search, outline, before/after diff, mobile layout, and inactive-tab events.
- Remote-auth/trusted-client behavior and localhost-only restrictions for any sensitive mutation-adjacent endpoint.
- Large artifact streaming without oversized SSE payloads or browser memory spikes.

### Required checks

```bash
npm --prefix pi-extension-docx run check
npm --prefix pi-extension-docx test
npm --prefix pi-extension-docx run test:engine
npm --prefix pi-extension-docx run test:corpus
npm --prefix pi-extension-docx run pack:dry

npm --prefix pi-package-webui test
npm --prefix pi-package-webui run check

dotnet test pi-extension-docx/engine/DocxEngine.sln
git diff --check
```

Use controlled, explicitly labeled commands for interactive Word validation; do not include them in unattended default CI.

Do not publish mutation capability until P0 and P1 exit gates pass and the packed package contains every runtime source, sidecar selector, skill, schema, license notice, and platform dependency required outside development.

## Key risks and mitigations

| Risk | Mitigation |
|---|---|
| A writer silently drops unsupported DOCX parts | Pre/post package manifests, surgical changed-part commit, capability checks, independent reopen, fail-closed save. |
| A text replacement destroys run formatting | Cross-run range mapping, exact preconditions, minimal run splitting, semantic/format diff, focused render checks. |
| An office renderer changes the file during rendering | Render from a private copy and export to PDF only; never use renderer-produced DOCX bytes as the native edit result. |
| Microsoft Word, ONLYOFFICE, and LibreOffice paginate differently | Record renderer/fonts, report substitutions, use semantic selectors, and avoid page-number-only edits. |
| Macros, links, fields, or OLE execute | Inventory and block active content, isolated renderer profile, no refresh, network sentinel tests, never use execution APIs. |
| Digital signatures become invalid | Detect signatures and refuse P1 mutation; later allow only an explicitly unsigned copy with clear consent. |
| Parallel agent calls lose edits | Destination mutation queue, mandatory hashes, staged revisions, and atomic commit. |
| Browser preview exposes host files | Root-confined artifact registry, expiring tokens, tab/session binding, no raw path endpoints. |
| A human and agent edit the same revision | Revision hashes, locks, import-as-new-revision, conflict diff, no last-write-wins. |
| Sidecar packaging becomes too large | Platform optional packages or framework-dependent mode; measure before choosing and avoid postinstall downloads. |
| Legacy conversion loses features | New DOCX output only, conversion report, source preserved, explicit capability/fidelity warnings. |
| Large documents exhaust memory/context | Bounded parsing, focused selectors, temp artifacts, caches, progress/cancellation, configurable hard limits. |
| An office-suite/browser editor causes license lock-in | Keep rendering behind an adapter, do not bundle ONLYOFFICE/LibreOffice, keep Open XML authoritative for mutation, and require a separate license review for WYSIWYG services. |

## Definition of done

The project is complete for its declared production scope when:

- P0 and P1 are fully checked and their exit gates have saved verification evidence.
- The public capability matrix is generated from passing corpus tests.
- No supported edit produces a repair prompt in controlled Microsoft Word or any claimed renderer/interoperability validation.
- Unsupported documents or operations refuse before commit with actionable errors.
- Source overwrite is impossible without explicit intent, hash agreement, validation, atomic replacement, and recovery data.
- Pi TUI, print/JSON, RPC, and WebUI workflows pass end-to-end.
- Security tests prove macros and external content do not execute or refresh.
- Package dry-runs include all required runtime files and license notices.
- Documentation accurately separates semantic support, render fidelity, preservation-only features, and optional WYSIWYG support.

## References reviewed

- Pi extension and custom-tool documentation: `@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi RPC behavior: `@earendil-works/pi-coding-agent/docs/rpc.md`
- Pi package filtering/distribution: `@earendil-works/pi-coding-agent/docs/packages.md`
- Pi extension examples: `@earendil-works/pi-coding-agent/examples/extensions/`
- Existing parser package: `pi-docparser` 3.0.1 / LiteParse 2.0.1
- Open XML SDK: <https://github.com/dotnet/Open-XML-SDK>
- Open XML SDK documentation: <https://learn.microsoft.com/en-us/office/open-xml/open-xml-sdk>
- Open XML SDK design limitations: <https://learn.microsoft.com/en-us/office/open-xml/open-xml-sdk-design-considerations>
- `DocumentFormat.OpenXml` package: <https://www.nuget.org/packages/DocumentFormat.OpenXml>
- ONLYOFFICE `x2t` converter configuration: <https://github.com/ONLYOFFICE/core/blob/master/X2tConverter/README.md>
- ONLYOFFICE Document Builder conversion/rendering overview: <https://api.onlyoffice.com/docs/document-builder/get-started/overview/>
- ONLYOFFICE Desktop Editors/Core license: GNU AGPL-3.0 (installed `LICENSE.txt` and <https://github.com/ONLYOFFICE/core>)
- LibreOffice SDK: <https://api.libreoffice.org/>
- LibreOffice command-line conversion filters: <https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html>
- `python-docx`: <https://python-docx.readthedocs.io/en/latest/>
- ONLYOFFICE Docs API: <https://api.onlyoffice.com/docs/>
- ONLYOFFICE licensing: <https://www.onlyoffice.com/license-faq>
- Microsoft unattended Office automation warning: <https://support.microsoft.com/en-us/visio/considerations-for-server-side-automation-of-office>

## Next implementation gate

Install or provide a .NET 8+ SDK, then compile/test the Open XML sidecar and run the no-op/changed-part/schema-validation gates. After that, run real TUI/print/JSON/RPC sessions, controlled renderer network-sentinel tests, and interactive Microsoft Word repair-prompt validation. P2 semantic operations and the remaining rich-viewer checks stay dependency-blocked until the P1 exit gate passes.
