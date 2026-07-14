---
name: docx-editor
description: Safely inspect, search, render, edit, diff, validate, and commit Microsoft Word DOCX files with the dedicated docx_* tools. Use for DOCX/DOTX/DOCM/DOTM document work; enforces dry-run-first edits, active-content refusal, preservation checks, and save-as by default.
license: MIT
compatibility: Requires @firstpick/pi-extension-docx. Mutation requires its Open XML .NET sidecar; rendering requires ONLYOFFICE Desktop Editors or LibreOffice plus LiteParse.
---

# DOCX editor

## Required workflow

1. Call `docx_inspect` before editing an unfamiliar document. Keep `sourceSha256`, feature/security inventory, and capability report.
2. Call `docx_read` for only the relevant stories/blocks. Use returned paragraph IDs, paths, hashes, bookmarks, controls, or strict text anchors.
3. Call `docx_render` when pagination, layout, tables, images, headers/footers, or formatting matter. Keep page selections small.
4. Call `docx_edit` with `dryRun: true`; use exact preconditions and expected counts. Resolve ambiguity rather than broadening an edit.
5. Call `docx_edit` with `dryRun: false` and `expectedSourceSha256` to create a staged revision. This tool must not receive a destination.
6. Call `docx_validate` and `docx_diff` against source and staged paths. Render focused before/after pages for visually sensitive operations.
7. Call `docx_commit` to a new `.docx` path by default.
8. Overwrite the source only when the user explicitly asked, hashes still agree, every gate passes, and interactive confirmation is available. Require a recovery path in the result.

## Safety rules

- Never use built-in text `edit` or `write` on DOCX/DOCM/DOTX/DOTM.
- Never execute macros, OLE, fields, links, DDE, or attached templates. Never claim they were executed or refreshed.
- Treat `.docm`/`.dotm`, active content, and signatures as read/render only. Do not bypass `SIGNED_DOCUMENT` or `ACTIVE_CONTENT_BLOCKED`.
- Do not mutate raw XML, XPath, arbitrary ZIP parts, or page-number selectors.
- Do not silently convert formats. Legacy/template conversion must create a new `.docx` and report losses.
- Stop on `LOSSY_OPERATION`, protected-part changes, unavailable mandatory engines, validation failures, source/destination conflicts, or ambiguous selectors.
- Keep hidden/deleted metadata out of model-visible output unless the user explicitly asks to inspect it.

## Verification

A successful tool return is not enough. Confirm source and staged/output hashes, declared changed parts, protected-part stability, Open XML validation, independent reopen, semantic diff, and required render checks. Report renderer/font warnings and any host gate that was not run.
