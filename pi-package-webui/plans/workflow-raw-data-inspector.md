# Workflow Raw-Data Inspector Improvement Plan

Status: Complete  
Date: 2026-07-23  
Integration owner: Parent Pi session  
Final report: [`../reports/workflow-raw-data-inspector.html`](../reports/workflow-raw-data-inspector.html)

## Goal

Replace the generic editable-looking workflow source preview with a large, clearly read-only, syntax-highlighted inspector that makes TypeScript workflow scripts easier to scan, search, copy, and return from without changing the extension protocol.

## Classification

**Complex feature.** The preliminary classification is confirmed by repository evidence: the feature crosses the generic extension-UI request renderer (`public/app.js`), shared modal/responsive styling (`public/styles.css`), and frontend contract tests (`tests/mobile-static.test.mjs`). It has two meaningful implementation slices—behavior/rendering and presentation/acceptance coverage—and must preserve the blocking extension response contract while changing user-facing semantics.

## Success criteria

1. The workflow source-preview request is recognized narrowly from the existing workflow inspection title and does not change unrelated `editor` dialogs.
2. The desktop inspector uses substantially more viewport space while remaining usable on mobile and short viewports.
3. The workflow source is rendered as non-editable text with line numbers and TypeScript syntax highlighting; no source content is inserted through unsafe HTML.
4. The viewer exposes source metadata, source search with match navigation/status, a wrap toggle, and copy-to-clipboard feedback.
5. The primary exit action is human-readable (`Back to approval`) and returns the original source unchanged; cancelling the workflow remains an explicit secondary action.
6. Existing generic editor behavior remains unchanged for all non-workflow requests.
7. `npm test` and syntax checks pass, and independent reviewers find no unresolved blocker/high-severity issues.

## Approved design decisions and invariants

- **Specialize at the WebUI boundary:** detect only `editor` requests whose normalized title starts with `Raw workflow script` and contains the existing inspection-only wording. Do not change the workflows extension protocol or title.
- **Read-only means structurally read-only:** use semantic code-display elements, not a disabled or editable textarea. The original `request.prefill` remains the response value.
- **No formatter that can alter source:** improve human readability through line structure, metadata, spacing, syntax colors, search, wrapping, and line numbers. Do not run a lossy TypeScript pretty-printer or mutate source before copying/responding.
- **No new runtime dependency:** use a small DOM-safe tokenizer that creates text nodes/spans. Never syntax-highlight with untrusted `innerHTML`.
- **Protocol preservation:** `Back to approval` sends a normal `extension_ui_response` with the original value. `Cancel workflow` keeps the existing cancelled response behavior.
- **Accessibility:** viewer controls require labels/titles, search status is announced, code is keyboard-scrollable, and token colors must retain readable contrast in the existing theme variables.
- **Responsive behavior:** desktop may approach the viewport bounds; mobile keeps the existing bottom-sheet convention and sticky actions.

## Scope

### In scope

- Specialized workflow preview rendering in `public/app.js`.
- Large desktop and responsive mobile presentation in `public/styles.css`.
- Source metadata, line numbers, safe syntax highlighting, search navigation, soft-wrap toggle, copy feedback, and clearer exit actions.
- Static frontend contract assertions in `tests/mobile-static.test.mjs`.
- Final plan evidence and self-contained HTML report.

### Non-goals

- Editing or saving workflow scripts from the inspector.
- Changing `pi-extension-workflows` approval logic or its UI API.
- Adding Monaco, CodeMirror, highlight.js, Prism, or another dependency.
- Full TypeScript parsing, AST-based formatting, or semantic validation.
- Redesigning all generic extension editor dialogs.

## Execution DAG and ownership

```text
W1 Behavior/rendering ──► W2 Presentation/tests ──► Integration verification
                                               ├──► Reviewer A
                                               └──► Reviewer B
Review dispositions/fixes ──► Final verification ──► HTML report
```

### W1 — Specialized read-only renderer

- Worker run: implementation worker 1 — run `6f365339-7971-4042-a159-6979c2aaac42`, child 0, completed
- Prerequisite: this plan approved
- Write boundary: `public/app.js` only
- Forbidden/shared paths: `public/styles.css`, `tests/**`, this plan, reports
- Deliverables:
  - narrow workflow-preview detection;
  - DOM-safe TypeScript token rendering with line rows/numbers;
  - metadata, search navigation/status, wrapping, and copy controls;
  - original-source response via `Back to approval`;
  - unchanged generic editor fallback.
- Validation: `node --check public/app.js`
- Handoff artifact: `.pi-subagents/workflow-raw-data-inspector-w1.md`

### W2 — Presentation and acceptance coverage

- Worker run: implementation worker 2 — run `6f365339-7971-4042-a159-6979c2aaac42`, child 1, completed
- Prerequisite: W1 integrated in the shared worktree
- Write boundary: `public/styles.css`, `tests/mobile-static.test.mjs`
- Forbidden/shared paths: `public/app.js`, this plan, reports
- Deliverables:
  - large viewport-aware dialog and readable code surface;
  - token, toolbar, search, line-number, matched-line, wrapping, focus, and mobile styles;
  - static assertions covering specialization, read-only behavior, safe token rendering, controls, original-value response, and responsive styling.
- Validation: `node tests/mobile-static.test.mjs`
- Handoff artifact: `.pi-subagents/workflow-raw-data-inspector-w2.md`

## Integration and acceptance checks

The integration owner will inspect both worker diffs and write boundaries before accepting them, then run:

```bash
node --check public/app.js
node tests/mobile-static.test.mjs
npm test
```

Manual/structural acceptance:

- Confirm generic `editor` requests still create `.dialog-editor` textareas.
- Confirm workflow preview creates no textarea and response uses the untouched `request.prefill`.
- Confirm rendering APIs use `textContent`/text nodes rather than highlighted `innerHTML`.
- Confirm desktop and mobile CSS do not overflow the visual viewport.
- If browser execution is available, open a workflow approval source preview and exercise search, next/previous, wrap, copy, cancel, and back-to-approval.

### Integration record

- W1 handoff: `.pi-subagents/artifacts/outputs/6f365339-7971-4042-a159-6979c2aaac42/.pi-subagents/workflow-raw-data-inspector-w1.md`
- W2 handoff: `.pi-subagents/artifacts/outputs/6f365339-7971-4042-a159-6979c2aaac42/.pi-subagents/workflow-raw-data-inspector-w2.md`
- Accepted-finding fix handoff: `.pi-subagents/artifacts/outputs/8cc856ce-23d5-4be0-a5df-c1dabd6244a0/.pi-subagents/workflow-raw-data-inspector-fix.md`
- Integration-owner inspection: accepted W1's `public/app.js` workflow-preview helpers/branch and W2's `public/styles.css` / `tests/mobile-static.test.mjs` workflow-script hunks. Both honored their write boundaries. Unrelated concurrent changes in the shared root were not attributed to or modified by this feature.
- Source preservation/security check: highlighted fragments are emitted through `document.createTextNode` or the existing `make(..., text)` helper; no source-derived `innerHTML` is used. The approval response sends the untouched `request.prefill`.
- Validation on the integrated worktree, 2026-07-23:
  - `node --check public/app.js` — passed.
  - `node tests/mobile-static.test.mjs` — passed (`mobile static checks passed`).
  - `npm test` — passed (all 41 test files).
  - scoped `git diff --check` — passed.
  - post-fix `npm test` — passed again (all 41 test files).
  - strict HTML report validation — passed with no errors or warnings.
- Browser/manual viewport interaction was unavailable and remains a residual validation item rather than a test failure.

## Review quorum

After integrated verification, obtain two fresh, read-only reviewers from provider families distinct from each other and from the OpenAI implementation provider. Each reviewer must assess architecture, correctness, security, edge cases, tests, maintainability, accessibility, responsive behavior, and plan compliance.

### Review record

| Reviewer | Run/model/provider | Findings | Disposition |
|---|---|---|---|
| A | `8cc856ce-23d5-4be0-a5df-c1dabd6244a0`, final-review child 1; Anthropic Claude Sonnet 5, high thinking | Accepted Enter blocker confirmed resolved; no new blockers; deferred cosmetic tokenizer/search notes only | **Accepted — quorum member** |
| B | `8cc856ce-23d5-4be0-a5df-c1dabd6244a0`, final-review child 2; OpenRouter/Qwen 3.7 Plus, high thinking (model confirmed by orchestrator status) | No blockers; UX, accessibility, responsive layout, protocol, tests, and fix passed; cosmetic notes only | **Accepted — quorum member** |

Both reviewers were fresh-context, read-only runs. Their provider families are distinct from each other and from the OpenAI implementation/fix provider. Final artifacts:

- `.pi-subagents/artifacts/outputs/8cc856ce-23d5-4be0-a5df-c1dabd6244a0/.pi-subagents/workflow-raw-data-inspector-final-review-a.md`
- `.pi-subagents/artifacts/outputs/8cc856ce-23d5-4be0-a5df-c1dabd6244a0/.pi-subagents/workflow-raw-data-inspector-final-review-b.md`

No final-review finding required another code change. Reviewer A's already-recorded cosmetic notes remain deferred; reviewer B's equivalent observations and locale-specific search note are likewise **deferred** as non-blocking, out-of-scope polish. Reviewer B's prose self-identified the wrong model, so the plan records the orchestrator's authoritative run status (`qwen3.7-plus`) rather than that generated metadata line.

### Preliminary review attempts and finding disposition

- Review run `0732e721-9194-4fe9-9a88-1d9f6a49d367`, child 0, Anthropic Claude Sonnet 5: qualifying advisory output before fixes. It found one blocker: Enter in the search field only prevented the surrounding `method="dialog"` form submission when matches existed, so an empty/no-match Enter could close the dialog without `sendDialogResponse`, strand the pending extension request, and desynchronize `activeDialog`.
  - **Disposition: accepted.** Integration-owner verification confirmed `#extensionDialog` wraps the preview in `<form method="dialog">`, no submit guard exists for this form, and the key handler returned before `preventDefault()` when no matches existed. Minimal remediation is to suppress Enter unconditionally in this search control, then navigate only when matches exist, with a focused assertion.
- Review run `0732e721-9194-4fe9-9a88-1d9f6a49d367`, child 1, OpenRouter/xAI Grok 4.5: **non-qualifying**; it returned no substantive review and failed acceptance. It does not count toward quorum and will be replaced.
- Reviewer A's cosmetic notes on multiline block-comment coloring, line-level search granularity, and empty-source line count are **deferred**: they do not violate the approved plan, do not affect source preservation/security, and expanding the tokenizer/search semantics would add disproportionate risk. They are recorded as residual polish opportunities.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Workflow title matching affects unrelated editors | Require method `editor`, title prefix, and inspection-only phrase. |
| Tokenizer corrupts or injects source | Build DOM spans from exact text fragments; never use `innerHTML`; preserve original response separately. |
| Search or wrapping causes poor performance on long previews | Preview is already capped by the extension; render once and update only match classes/status. |
| Mobile dialog exceeds viewport | Use visual-viewport-based max dimensions and mobile bottom-sheet overrides. |
| Users confuse leaving preview with submitting edits | Replace `Submit` with `Back to approval`; label cancellation explicitly. |
| Static tests miss runtime DOM issues | Add focused structural assertions and document any unavailable manual browser check as residual risk. |

## Rollback guidance

Revert the specialized workflow-preview branch in `showNextDialog`, its helper functions, the `workflow-script-*` CSS block, and corresponding static assertions. The generic textarea editor path and extension protocol remain the fallback, so rollback requires no data migration.

## Progress and decisions

- 2026-07-23: Located source preview in generic `extensionDialog`; title originates in `pi-extension-workflows/src/launch-approval.ts`.
- 2026-07-23: Confirmed complex classification because behavior, responsive presentation, tests, and the extension response contract are coupled.
- 2026-07-23: Approved dependency-free, DOM-safe highlighting and a specialized read-only viewer; explicitly rejected editable/disabled textareas and lossy source reformatting.
- 2026-07-23: W1 and W2 completed as two sequential implementation worker runs in the shared worktree; integration owner inspected their actual scoped changes and handoffs.
- 2026-07-23: Integrated syntax check, focused static test, and all 41 package test files passed.
- 2026-07-23: Preliminary review found one Enter/form-submission blocker; integration owner accepted it, a bounded fix worker corrected it, and focused/full verification passed.
- 2026-07-23: Two provider-diverse final reviewers found no remaining blockers. Findings and dispositions are recorded above.
- 2026-07-23: Self-contained HTML report created at `reports/workflow-raw-data-inspector.html`; strict validator passed with no errors or warnings. Feature completion gate satisfied.
