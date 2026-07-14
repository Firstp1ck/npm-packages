# P1 preservation and capability matrix

| Feature/format | Inspect/read | Render | Mutate | Commit policy |
|---|---:|---:|---:|---|
| Macro-free `.docx` body text, basic tables/formatting, links, core properties | Native/bounded | LibreOffice | Open XML SDK | Allowed after all gates |
| Headers, footers, footnotes, endnotes, comments | Bounded read | LibreOffice | Not in P1 | Preserve byte-identically or refuse |
| Fields/content controls/bookmarks/revisions | Inventory/read | LibreOffice | No broad P1 mutation | Preserve; no execution/recalculation |
| Charts, SmartArt, equations, text boxes, custom XML, altChunk, embeddings | Inventory/preservation only | LibreOffice where supported | No | Hash-gated; unsupported change refuses |
| External relationships/attached templates | Inventory target only | Never dereference | No | Relationship graph must remain unchanged |
| Signed packages/VBA signatures | Inventory | Render only | No | `SIGNED_DOCUMENT` before staging |
| `.docm`/`.dotm`, VBA, ActiveX, OLE, custom UI | Inventory | Isolated render only | No | `ACTIVE_CONTENT_BLOCKED` |
| `.dotx` | Read/render | Yes | No native P1 edit | Convert only through a future explicit workflow |
| `.doc`, `.rtf`, `.odt` | Outside native package | Future conversion | Never source-edit | New `.docx` only, with loss report |
| Encrypted package | Detect | No without explicit password workflow | No | `ENCRYPTED_PACKAGE` |

Any undeclared changed part, protected-part hash change, missing relationship target, Open XML validation error, source/destination hash conflict, or unavailable required engine blocks commit.
