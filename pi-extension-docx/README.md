# @firstpick/pi-extension-docx

Fail-closed DOCX tools for Pi agents. The package separates semantic/package inspection, Open XML SDK mutation, LibreOffice rendering, and durable commit so unsupported content cannot be silently lost.

## Tools

- `docx_inspect` — properties, stories, outline, features, package manifest, security, engines, capabilities.
- `docx_read` — bounded story/selector/search reads; text search spans OOXML run boundaries.
- `docx_render` — isolated LibreOffice PDF export and selected LiteParse PNG pages.
- `docx_edit` — dry-run or create a private staged revision; never writes a destination.
- `docx_diff` — semantic formatting and OOXML-part comparison.
- `docx_validate` — package, schema, reopen, preservation, and optional render gates.
- `docx_commit` — queued hash-checked save-as or explicitly confirmed source overwrite.

Run `/docx-doctor` to inspect sidecar, .NET, LibreOffice, LiteParse, platform, and workspace status.

## Setup

Node 24+ is required. Build the source sidecar with a .NET 8 SDK:

```bash
dotnet build engine/DocxEngine.sln -c Release
```

At runtime the extension checks `PI_DOCX_ENGINE_PATH`, `engine/publish`, then the local Release DLL. LibreOffice may be configured with `LIBREOFFICE_PATH`. No install script downloads executables.

## Safe workflow

1. Inspect and retain `sourceSha256`.
2. Read focused blocks and render when layout matters.
3. Call `docx_edit` with `dryRun: true` and exact selectors/preconditions.
4. Call it again with `dryRun: false` and `expectedSourceSha256` to stage.
5. Diff and validate the staged path against the source.
6. Commit to a new `.docx`. Source overwrite additionally needs `inPlace: true`, `overwrite: true`, the source hash, interactive TUI/RPC confirmation, atomic replacement, and a recovery copy.

## Selectors

Supported selector kinds are `paragraphId`, `path`, `text`, `bookmark`, `contentControl`, `tableCell`, and `tableRow`. Prefer returned paragraph IDs and hashes. Structural paths are one-based. Text selectors should include occurrence/count preconditions. Page numbers are render metadata and are never sole edit selectors.

## P1 operations

`replaceText`, `insertParagraph`, `deleteParagraph`, `setTableCellText`, guarded `insertTableRow`/`deleteTableRow`, `setCharacterFormatting`, `setParagraphFormatting`, `setHyperlink`, `removeHyperlink`, and `setCoreProperties`.

Merged target rows refuse structural edits. Hyperlink insertion requires selected text to occupy one complete run. Signed or active-content documents refuse mutation. See [preservation matrix](docs/PRESERVATION-MATRIX.md).

## Structured errors

Stable codes include `SOURCE_CHANGED`, `DESTINATION_CHANGED`, `DESTINATION_EXISTS`, `UNSUPPORTED_FEATURE`, `LOSSY_OPERATION`, `SIGNED_DOCUMENT`, `ACTIVE_CONTENT_BLOCKED`, `INVALID_PACKAGE`, `VALIDATION_FAILED`, `RENDER_FAILED`, `DEPENDENCY_MISSING`, `ENCRYPTED_PACKAGE`, `LIMIT_EXCEEDED`, selector/revision errors, `CANCELLED`, `PROTOCOL_ERROR`, and `TIMEOUT`.

## Rendering fidelity

LibreOffice previews are not claimed pixel-identical to Word. Renderer version, export filter, DPI, isolation settings, and fidelity warnings are returned. The renderer receives only a private copy and never supplies edited DOCX bytes.

## Development

```bash
npm run check
npm test
npm run test:engine
npm run test:corpus
npm run test:pi-modes
npm run pack:dry
```

See [ADR](docs/ADR-001-DOCX-ENGINES.md), [threat model](docs/THREAT-MODEL.md), and [`pi.artifact/v1`](docs/ARTIFACT-PROTOCOL.md).
