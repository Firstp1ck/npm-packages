# VBA capability threat model and design boundary

Status: reviewed design boundary; no VBA source extraction, mutation, or execution is implemented.

## Assets

- Workbook confidentiality and integrity.
- Byte identity of VBA projects, signatures, ActiveX, embeddings, custom UI, and associated relationships/content declarations.
- Host integrity, user Excel processes, certificate stores, and Office Trust Center policy.
- Agent and model context, which must not receive unrequested VBA source or secrets.

## Adversaries and failure modes

- Malicious `Workbook_Open`, `Auto_Open`, event, DDE, XLM, link, Power Query, or connection payloads.
- Parser confusion from non-canonical relationship targets, malformed compound files, oversized streams, encryption, or signature structures.
- Accidental signature invalidation or active-part loss during save.
- Prompt injection embedded in module names, comments, source text, or forms.
- Password, certificate, or source leakage through logs, snapshots, errors, and tool details.
- Native automation attaching to or terminating an unrelated Excel process.

## Current boundary

`ooxml-safe` may report:

- presence, path, size, content type, relationship provenance, and SHA-256 of protected VBA/signature parts;
- whether the package advertises macro-enabled content;
- that module/reference/project-protection metadata is unavailable with the selected backend.

It does not parse MS-OVBA streams, expose source, request passwords, execute macros, alter signatures, or transplant active parts. The read-only metadata task is intentionally closed as unavailable rather than approximated from untrusted binary strings.

## Preconditions for a future metadata extractor

1. A memory-safe, bounded Compound Binary/MS-OVBA parser with explicit encryption and decompression limits.
2. Independent fixtures for protected, signed, malformed, non-canonical, and multilingual projects.
3. No Excel launch and no VBA execution API.
4. Output allowlist limited to module names/types, reference identities, signature metadata, and project-protection status; source remains excluded.
5. Prompt-injection labeling and strict output truncation.
6. Fuzzing, security review, and no regression to protected-part byte identity.

## Preconditions for source extraction or replacement

Source capability must be a separately installed package and contract. It requires explicit per-run user confirmation, destination-only writes, secret redaction, provenance, signature invalidation warnings, signer/certificate design, isolated analysis, and a fresh legal/security review. It must never be added as another `workbook_edit` operation.

## Execution remains prohibited

No default or optional code in this package may call `Application.Run`, enable macros/events, lower Trust Center policy, install certificates, or refresh external data. Any future executor requires a separate sandboxed product, disabled by default, with explicit confirmation on every run.
