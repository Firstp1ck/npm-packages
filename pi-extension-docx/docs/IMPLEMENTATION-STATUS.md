# DOCX extension implementation status

Date: 2026-07-14  
Release posture: preview; fail closed where host evidence is absent

The package implements the P0/P1 code path: seven strict tools, bounded OOXML intake/manifests, semantic stories/selectors, a versioned Open XML SDK sidecar, staged revisions, diff/validation/commit gates, isolated ONLYOFFICE-preferred rendering with LibreOffice fallback, the artifact contract, direct built-in write guards, documentation, and synthetic tests. The WebUI also implements root-confined, tab/session-bound artifact registration and a generic document viewer.

This file is evidence context only. `docs/docx-agent/PLAN.md` remains the canonical tracker.

Current host evidence: ONLYOFFICE Desktop Editors 9.4.0 `x2t` successfully converted a controlled synthetic DOCX to a valid one-page PDF; text/font extraction and LiteParse PNG rendering passed through `DocumentService`. The host still has no .NET SDK, so sidecar compilation/tests and production mutation/schema-validation remain blocked. Controlled Microsoft Word repair-prompt checks, LibreOffice interoperability where claimed, broad real-document corpus gates, and real interactive Pi mode sessions remain external and must not be marked complete merely because harnesses exist.
