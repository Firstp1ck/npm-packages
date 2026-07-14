---
name: workbook-editor
description: Use when inspecting, reading, rendering, editing, formatting, diffing, or validating local .xlsx and .xlsm Excel workbooks. Provides fail-closed workbook tools with dry-run planning, SHA-256 conflict protection, PNG previews, and byte-identity checks for VBA and other protected OOXML parts. Do not use for CSV-only work or for executing/editing VBA.
---

# Workbook Editor

Use the six `workbook_*` tools for semantic and visual workbook work. Treat every workbook as potentially hostile active content.

## Required workflow

1. Call `workbook_inspect` before editing an unfamiliar workbook. Review validation warnings, external relationships, protected parts, and engine capabilities.
2. Call `workbook_read` for the exact sheet/range. Call `workbook_render` whenever layout, fills, borders, dimensions, or visual comparison matter.
3. Build an ordered operation list and call `workbook_edit` with `dryRun: true`. Save the returned `sourceSha256`.
4. Commit to a new output path by default. Set `dryRun: false` and pass the exact `expectedSha256` from the current inspection/dry run.
5. Call `workbook_validate` on the result, using the source as `baselinePath` for `.xlsm` or active-content work.
6. Call `workbook_diff` and render the affected range. Report the output and any recovery path.

## Operation intent

- Use `setValue` for literal text, numbers, booleans, or null. Leading `=`, `+`, `-`, and `@` remain text when passed as strings.
- Use `setFormula` only for formulas. External-workbook, URL, DDE, `WEBSERVICE`, `FILTERXML`, and RTD constructs are rejected.
- Use `setStyle` for explicit font, fill, border, alignment, number-format, or cell-protection patches.
- Use `copyRange` for same-sized range templates; set optional `sourceSheet` for cross-sheet copies. Use `copyFormat` when only styles should be reproduced and `fillRange` to translate ordinary relative A1 formulas from one source cell.
- Shared, array, data-table, and spill formula regions are preservation-only. Value/content edits that intersect them fail closed; inspect formula inventory before restructuring formula-heavy sheets.
- Use `clear`, dimensions, merge, and unmerge operations only after reading existing merges and layout.

## Safety rules

- Never execute macros. Preservation does not imply that VBA was reviewed, trusted, or safe.
- Never request VBA source mutation or workbook macro execution through these tools; those capabilities are intentionally absent.
- Never refresh external links, Power Query, DDE, or data connections.
- Never silently convert `.xlsm` and `.xlsx`; output extension must match source.
- Never omit `expectedSha256` on a commit or retry a conflict using an old hash.
- Never overwrite in place unless the user explicitly asked. In-place writes require `overwrite: true` and return a recovery copy.
- Do not suggest lossy fallback libraries when the engine rejects an unsupported operation.
- Keep ranges focused. Full structured results are stored in temporary artifacts when model-visible output is truncated.

## Backend policy

The enabled backend is `ooxml-safe`, a bounded surgical implementation. It changes only operation-declared OOXML parts and verifies protected parts after saving; per-file package mutability checks can reject an otherwise supported operation. Native Excel may appear in `/workbook-doctor`, but mutation is disabled because the bounded bakeoff changed merged-cell styles during `.xlsx` no-op serialization and changed `xl/vbaProject.bin` during `.xlsm` no-op serialization. Aspose is an optional deferred tier.

## Verification expectations

A successful edit is not complete until:

- `workbook_validate` reports `ok: true`;
- `workbook_diff` shows only operation-declared OOXML changes;
- protected-part changes are empty;
- the focused PNG preview is visually reasonable when formatting changed;
- any warnings, truncation, unsupported rich objects, or missing native Excel repair-prompt check are disclosed.
