# Custom message Markdown rendering

Status: implemented and independently reviewed  
Classification: lightweight feature  
Integration owner: main Pi session (`019f95e3-d8ce-7851-8844-84a4992f1a74`)

## Classification rationale

This is a one-line presentation-path change plus one focused regression check. It does not cross component contracts, add dependencies, require migration or rollout work, or introduce a new renderer. The preliminary `lightweight` classification is therefore confirmed.

## Success criteria

- Messages with `role: "custom"` use the WebUI's existing Markdown renderer.
- Assistant rendering remains unchanged.
- Other roles remain plain text or use their existing dedicated rendering paths.
- String and structured text content continue to work.
- The change adds no new HTML parsing or unsafe rendering sink.

## Scope and decisions

- Change only the generic message-body fallback in `public/app.js`.
- Reuse `renderContent(..., { markdown: true })`; do not introduce a separate parser.
- Cover the routing rule with a focused static test in `tests/custom-message-markdown-static.test.mjs`.
- Do not alter unrelated dirty working-tree changes.

## Implementation map

| File | Change |
|---|---|
| `public/app.js` | Enable the existing Markdown option for `message.role === "custom"`. |
| `tests/custom-message-markdown-static.test.mjs` | Assert that assistant and custom roles are routed to Markdown. |

## Validation evidence

- `node --check public/app.js` — passed.
- `node --check tests/custom-message-markdown-static.test.mjs` — passed.
- `node tests/custom-message-markdown-static.test.mjs` — passed.
- `git diff --check -- public/app.js tests/custom-message-markdown-static.test.mjs` — passed.
- The broad `tests/mobile-static.test.mjs` run is currently blocked by an unrelated pre-existing CSS font-floor assertion in the dirty working tree; the new focused test is independent and passed.

## Independent review quorum

1. Anthropic Claude reviewer, run `cb0551ce-78bd-40bd-956e-4591874b8cf2`, retry slot A — **Pass**, no blocker. It requested verification of array-content handling and Markdown escaping.
2. Google Gemini reviewer, resumed run `bd99f360` — **Approved**, no findings; verified string/array routing and safe DOM-based Markdown construction.

### Finding dispositions

| Finding | Disposition | Evidence |
|---|---|---|
| Array custom-message content was not verified by reviewer A. | `rejected` as a residual risk after verification | `renderContent` applies `appendMarkdown` to every `part.type === "text"` when `markdown` is true and preserves image handling. Reviewer B independently confirmed this path. |
| Markdown/XSS safety was not fully verified by reviewer A. | `rejected` as a residual risk after verification | Existing parsing constructs DOM nodes/text with `make(...)`/`textContent`; Mermaid uses `securityLevel: "strict"`. No new HTML sink was introduced. Reviewer B independently approved. |
| Static test does not exercise a browser DOM. | `deferred` (low risk) | The test protects the role-routing regression. Browser behavior is inherited from the already-used assistant Markdown path. A DOM integration test can be added if this renderer is later modularized. |

## Rollout and rollback

No migration or configuration is required. Roll back by removing `|| message.role === "custom"` and the focused test file.

## Report

[Feature completion report](../reports/custom-message-markdown.html)
