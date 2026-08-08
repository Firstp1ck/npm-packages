# Technical reference: Workbook for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Supported files

The package inspects and edits `.xlsx` and `.xlsm` workbooks. It can read sheets, render previews, update selected content, compare files, and validate the saved result.

## Safe editing flow

1. Ask Pi to inspect the workbook.
2. Read the relevant sheets and render previews when formatting matters.
3. Ask for a dry-run preview of the intended changes.
4. Review formulas, literal values, and target cells carefully.
5. Save to a new workbook.
6. Compare and validate the result before replacing any original file.

Source changes, destination changes, and unsupported edits stop the operation instead of silently overwriting newer work.

## Safety behavior

- Macros are preserved but never executed or edited.
- External links and data connections are not refreshed.
- Formula changes and literal-value changes are treated separately.
- Editing creates a new file by default.
- Overwriting requires `overwrite: true` and the current `expectedSha256`; in-place overwrite creates a recovery copy before committing.
- Unsupported workbook features or lossy changes are refused.

## Compatibility

Visual previews may differ slightly from desktop Excel. Signed macro workbooks receive extra preservation checks, and active macro content is never run.

Use the contributor guide for exact operation support, preservation checks, and document-engine internals.

## Troubleshooting

- Reinspect the source when Pi reports that it changed.
- Render the affected sheet when formatting or merged cells matter.
- Prefer a new destination when overwrite checks fail.
- Treat validation warnings as unresolved until the saved workbook is reopened and compared successfully.
