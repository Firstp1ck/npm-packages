# Verification evidence

Date: 2026-07-14

## Verified locally

- `npm run check`: TypeScript compilation, extension/package structure, seven tool registrations, mutation-queue guard, and skill checks pass.
- `npm test`: unit/integration suite passes, including bounded OOXML intake, semantic/package diff, output limits/privacy, transactions, rendering policy, and a real ONLYOFFICE render when available.
- `npm run test:corpus`: seven bounded policy cases plus the synthetic feature-inventory matrix pass.
- `npm run test:pi-modes`: registration and non-interactive overwrite refusal pass in the print/JSON harness; the harness explicitly does not claim real TUI/RPC coverage.
- `npm run pack:dry`: the npm tarball includes the extension, docs/notices, skill, TypeScript backends, and .NET source project.
- `npm --prefix ../pi-package-webui run check`: all WebUI static/HTTP harness files pass, including document artifact registration, tab confinement, path stripping, manifests, pages, downloads, and byte ranges.
- `git diff --check -- pi-extension-docx pi-package-webui docs/docx-agent/PLAN.md`: passes.

## ONLYOFFICE renderer evidence

Host package `onlyoffice-bin` 9.4.0-1 provides `/opt/onlyoffice/desktopeditors/converter/x2t`. Its generated per-user `AllFonts.js` and `font_selection.bin` are copied into a private render workspace. A controlled macro-free DOCX was converted through generated task XML to PDF, then checked for:

- successful zero exit;
- valid `%PDF-` output with one page;
- expected extracted text;
- embedded/subset Liberation Sans reported by `pdffonts`;
- a valid LiteParse/PDFium PNG page;
- `pi.artifact/v1` creation;
- private input, HOME, temp, font-metadata, PDF, and PNG paths.

Automatic renderer selection now prefers ONLYOFFICE and retains LibreOffice only as an optional fallback. `PI_DOCX_RENDERER=onlyoffice|libreoffice|auto` can pin selection.

## Open gates

- The host has .NET runtimes but no .NET SDK. The Open XML sidecar has not been compiled or executed here, so native mutation, `OpenXmlValidator`, no-op SDK round trips, and production validation remain blocked.
- Node is v22.23.1 while this package declares Node 24+; local `tsx` tests pass but the supported Node floor is not verified on this host.
- Real TUI/RPC sessions, controlled renderer network-sentinel tests, broad real-document corpus checks, and interactive Microsoft Word repair-prompt validation remain external.
- LibreOffice is absent. No LibreOffice interoperability claim is made from this host evidence.
