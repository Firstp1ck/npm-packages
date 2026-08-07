# Technical reference: DOCX for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Requirements

- Node.js 24 or newer
- .NET 8 SDK for the document engine
- ONLYOFFICE Desktop Editors or LibreOffice for visual rendering

Build the local document engine once:

```bash
dotnet build engine/DocxEngine.sln -c Release
```

Run `/docx-doctor` to check the document engine, renderer, fonts, platform, and workspace.

## Renderer selection

Automatic mode prefers ONLYOFFICE and falls back to LibreOffice. Override it with:

```text
PI_DOCX_RENDERER=onlyoffice
PI_DOCX_RENDERER=libreoffice
```

Use `ONLYOFFICE_X2T_PATH` or `LIBREOFFICE_PATH` when the application is installed in a non-standard location. Launch ONLYOFFICE once if its user font cache has not yet been created.

## Safe editing flow

1. Ask Pi to inspect the source document.
2. Read only the relevant content and render pages when layout matters.
3. Ask for a preview of the intended change.
4. Review the preview and source-change warning.
5. Create a new output document.
6. Compare and validate the output before using it.

Overwriting the source requires additional confirmation and creates a recovery copy. A changed source or destination stops the edit rather than silently replacing newer work.

## Supported changes

The package supports common text, paragraph, table-cell, row, formatting, hyperlink, and document-property changes. Unsupported or ambiguous edits are refused.

Signed documents, encrypted files, active content, and changes likely to lose unsupported Word features are blocked.

## Rendering and compatibility

ONLYOFFICE and LibreOffice previews can differ from Microsoft Word. Rendering is for practical layout review, not a promise of pixel-identical output.

Macros and active content are never executed. External content is not fetched during rendering. Documents with unsafe or unsupported relationships may be refused.

## Troubleshooting

- Run `/docx-doctor` when inspection or rendering reports a missing dependency.
- Check the selected renderer and font availability when layout differs.
- Reinspect the source when Pi reports that it changed.
- Save to a new file when overwrite protection blocks the destination.
- Use the contributor guide for supported selector, operation, error-code, and preservation matrices.
