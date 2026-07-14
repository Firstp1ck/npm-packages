# `pi.artifact/v1` document contract

Tool details may contain:

```json
{
  "artifact": {
    "schema": "pi.artifact/v1",
    "kind": "document",
    "id": "uuid",
    "revisionId": "optional staged revision uuid",
    "title": "contract.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pageCount": 12,
    "manifestPath": "extension-private local path",
    "downloadPath": "extension-private local path",
    "expiresAt": "ISO-8601"
  }
}
```

Local paths are backend-private implementation data, not browser capabilities. WebUI must register only paths under configured extension-owned roots and replace them with opaque, expiring URLs bound to authenticated session, tab, artifact id, revision id, MIME type, and allowed action. Endpoints must never accept arbitrary paths. Stale, expired, cross-tab, cross-session, or mismatched revision tokens return 404/410 without path disclosure.

Schema additions are backward-compatible. Meaning changes require a new schema version. This package currently emits the contract for integration testing; WebUI recognition is a P2 gate and is not implied by emission alone.
