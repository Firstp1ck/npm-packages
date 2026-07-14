# ADR-001: DOCX engine boundaries

Date: 2026-07-14  
Status: Accepted

## Decision

Use `DocumentFormat.OpenXml` in a versioned, one-shot .NET sidecar as the only canonical P1 mutation and schema-validation engine. TypeScript owns path normalization, bounded ZIP intake, relationship/package manifests, semantic read models, private workspaces, source/destination hashes, output truncation, Pi schemas, and final commit. LibreOffice is rendering/conversion-only and always receives a private copy under a unique locked-down profile. LiteParse/PDFium converts exported PDFs into PNG pages and may assist read-only parsing.

Backend selection is fail closed. Missing Open XML prevents edit and production validation. Missing LibreOffice or LiteParse prevents rendering. No fallback writer may silently replace the canonical mutation engine.

## Rationale

The SDK supplies schema-aware WordprocessingML types and validation while the TypeScript package can verify every uncompressed OOXML part independently. LibreOffice provides useful pagination but a DOCX save round trip can rewrite unrelated content. Keeping it out of the native edit path makes preservation claims executable.

## Distribution

The source package contains the sidecar project. Runtime resolution accepts `PI_DOCX_ENGINE_PATH`, then CI-produced packaged executables/DLLs. Install scripts never download binaries. Broad platform support remains disabled until CI artifacts have checksums, provenance, SBOMs, license notices, and platform corpus evidence.

## Consequences

- A host without the sidecar can inspect/read/diff package content but cannot stage edits or pass production validation.
- A host without LibreOffice can edit semantically but cannot pass mandatory visual gates for layout-sensitive operations.
- Signed and active-content documents are read-only in P1.
