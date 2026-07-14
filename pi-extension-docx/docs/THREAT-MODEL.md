# DOCX threat model

## Assets

Source documents, staged revisions, destination files, recovery copies, host filesystem paths, document passwords, browser artifacts, and process/network boundaries.

## Trust boundaries and controls

- **ZIP/XML intake:** bounded archive, entry, XML, total-size, and compression-ratio limits; traversal, case-conflicting duplicate, encrypted-member, unsupported method, malformed header/CRC, DTD, and entity rejection.
- **Relationships:** complete graph validation; external targets are inventoried but never opened. Missing internal targets fail intake.
- **Active content:** macros, VBA signatures, ActiveX, OLE, custom UI, embedded packages, and attached templates are classified from paths, content types, and relationship types. P1 mutation refuses them.
- **Sidecar:** one request per owned process, JSON-only stdout, protocol negotiation, hard timeout, abort propagation, bounded output, and stderr redaction. It never renders or executes Word.
- **Office renderers:** active-content packages and non-hyperlink external relationships are rejected before process launch. ONLYOFFICE `x2t` receives generated task XML, a private source copy, private HOME/temp paths, and a private snapshot of its per-user font metadata. LibreOffice receives a private source copy/profile with macro security level 3 and link updates disabled. Both are PDF-export-only owned processes with hard timeout, process-tree termination, bounded output, and cleanup; neither output can become the edited DOCX.
- **Transactions:** private `0700` workspace, mandatory apply hash, staged-only edit, post-edit protected-part comparison, schema reopen, destination mutation queue, just-in-time hash rechecks, sibling durable write, rollback/recovery.
- **Passwords/secrets:** no password schema is exposed in P1. Error and stderr paths redact password/token-shaped values.
- **WebUI/artifacts:** `pi.artifact/v1` describes files but does not authorize host-path access. A WebUI registry must replace paths with expiring session/tab/revision-bound tokens before browser delivery.

## Abuse cases

ZIP bombs, path traversal, duplicate-part smuggling, XML entities, malformed relationships, macro sentinels, external HTTP/UNC/file targets, DDE/field refresh, attached templates, signed-package invalidation, symlink destination swaps, parallel lost updates, stale staged revisions, destination races, process hangs, oversized tool results, cross-tab artifact access, and renderer network activity.

## Residual risks

ONLYOFFICE and LibreOffice sandboxing is process/workspace based rather than a mandatory OS container; the renderer can still read host font files named by its font metadata. Font substitution and pagination differ from Microsoft Word. The initial TypeScript XML reader is semantic rather than an Open XML schema validator. Production release therefore requires the sidecar plus controlled renderer/network-sentinel and Microsoft Word corpus evidence. LibreOffice interoperability remains a release gate only where that format/host is claimed, not a local rendering dependency.
