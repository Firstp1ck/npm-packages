# ADR-001: DOCX engine boundaries

Date: 2026-07-14  
Status: Accepted

## Decision

Use `DocumentFormat.OpenXml` in a versioned, one-shot .NET sidecar as the only canonical P1 mutation and schema-validation engine. TypeScript owns path normalization, bounded ZIP intake, relationship/package manifests, semantic read models, private workspaces, source/destination hashes, output truncation, Pi schemas, and final commit. ONLYOFFICE Desktop Editors `x2t` is the preferred local PDF renderer; LibreOffice remains a supported fallback. Both are rendering/conversion-only and receive private copies in isolated workspaces. LiteParse/PDFium converts exported PDFs into PNG pages and may assist read-only parsing.

Backend selection is fail closed. Missing Open XML prevents edit and production schema validation. Missing both supported office renderers, or missing LiteParse, prevents rendering. `PI_DOCX_RENDERER` may pin `onlyoffice` or `libreoffice`; automatic selection prefers ONLYOFFICE. No rendering backend may become a fallback writer or silently replace the canonical mutation engine.

## Rationale

The SDK supplies schema-aware WordprocessingML types and validation while the TypeScript package can verify every uncompressed OOXML part independently. ONLYOFFICE and LibreOffice provide useful pagination, but an office-suite DOCX save round trip can rewrite unrelated content. Keeping both out of the native edit path makes preservation claims executable. The installed ONLYOFFICE 9.4.0 `x2t` converter was verified locally with generated XML, a user font-cache snapshot, DOCX-to-PDF output, extracted PDF text/fonts, and LiteParse PNG output.

## Distribution

The source package contains the sidecar project. Runtime resolution accepts `PI_DOCX_ENGINE_PATH`, then CI-produced packaged executables/DLLs. Install scripts never download binaries. Broad platform support remains disabled until CI artifacts have checksums, provenance, SBOMs, license notices, and platform corpus evidence.

## Consequences

- A host without the sidecar can inspect/read/diff package content but cannot stage edits or pass production validation.
- A host without ONLYOFFICE or LibreOffice can edit semantically but cannot pass mandatory visual gates for layout-sensitive operations.
- Signed and active-content documents are read-only in P1.
