# Workflow Subprocess Minimize / Restore

Status: Complete  
Integration owner: Parent Pi session  
Related report: [Workflow Subprocess Minimize / Restore report](../reports/workflow-subprocess-minimize-restore.html)

## Goal and success criteria

Add a clear minimize/restore control to the **Workflow Subprocesses** output card without changing the workflow extension protocol.

Success criteria:

- The expanded card retains its current metadata, actions, output disclosure, and live-follow behavior.
- A visible button minimizes the subprocess output and changes to **Restore**.
- Minimized state survives live browser-side rerenders independently per terminal tab.
- Restoring recreates the existing output view and preserves its browser-memory scroll/follow state.
- The control exposes `aria-controls`, `aria-expanded`, an explicit accessible label, and focus restoration after DOM replacement.
- A tab close discards that tab's minimize state.
- Restored workflow content sizes the outer widget area intrinsically up to a viewport-safe cap; when all workflow cards are minimized, the specialized sizing rule is released.

## Classification

**Lightweight feature.** The preliminary classification is confirmed by repository evidence: the behavior is localized to the existing browser renderer in `public/app.js`, workflow-specific CSS in `public/styles.css`, and static frontend contracts in `tests/mobile-static.test.mjs`. It adds no protocol, server, persistence, dependency, security-boundary, migration, or deployment change.

## Approved design

- Follow the existing Workflow Inspector minimize/restore convention.
- Store one ephemeral minimized flag per browser tab; default to restored/expanded.
- Keep the subprocess title, run metadata, workflow actions, and toggle visible while minimized; omit the terminal body from the rendered card until restored.
- Retain the existing inner output `<details>` expansion state as a separate control.
- Restore focus to the replacement minimize/restore button after rerender.
- Apply intrinsic workflow sizing only while at least one workflow widget is not minimized: `flex: 0 0 auto` follows rendered content, while a viewport-safe `max-height` becomes the scroll boundary for long output.
- Reuse existing button colors and mobile 44px touch sizing.

## Scope and non-goals

In scope:

- `public/app.js`
- `public/styles.css`
- `tests/mobile-static.test.mjs`
- This plan and the final HTML report

Non-goals:

- Persisting minimize state across page reloads.
- Changing subprocess payloads, retention, commands, or run lifecycle.
- Reworking the Workflow Inspector, output `<details>` control, or shared release widgets.

## Work items

1. [x] Inspect the current subprocess renderer and inspector disclosure convention.
2. [x] Implement per-tab minimize/restore state, accessible control, and compact layout.
3. [x] Run syntax, focused, full-package, and scoped diff checks.
4. [x] Obtain two qualifying independent reviews and disposition findings.
5. [x] Create and validate the self-contained HTML report.

## Acceptance checks

- `node --check public/app.js`
- `node --test tests/mobile-static.test.mjs`
- `npm run check`
- Scoped `git diff --check`
- Two fresh, read-only, provider-diverse reviews of the integrated implementation
- Strict HTML report validation

## Risks and rollback

- Live widget updates replace DOM nodes; explicit per-tab state and post-render focus restoration prevent the control from resetting or losing keyboard continuity after activation.
- The card-level minimize control must remain distinct from the terminal's existing output `<details>` disclosure; labels and separate state make that distinction explicit.
- The historical fixed workflow slot left empty space below short output. The final selector excludes minimized-only cards and uses intrinsic height for restored content, bounded by desktop and mobile maximum heights.
- Rollback is a direct revert of the localized state, renderer, CSS, and contract assertions. No data migration is required.

## Acceptance results

| Check | Result | Evidence |
|---|---|---|
| `node --check public/app.js` | Pass | Exit 0 |
| `node --test tests/mobile-static.test.mjs` | Pass | TAP: 1 test, 1 pass, 0 failures |
| `npm run check` | Pass | All 41 package test files passed after the intrinsic-height follow-up |
| Headless Chrome geometry probe | Pass | At 1600×1000, the outer area measured 289px for 2 lines, 535px for 80 lines, 270px for 1 line, and 224px with output collapsed |
| Scoped `git diff --check` | Pass | No whitespace errors in implementation, tests, plan, or report |
| Strict HTML report validation | Pass | `validate_report.py --strict`: no errors or warnings; one overview table and one accessible SVG diagram |
| Feature classification | Confirmed lightweight | Browser renderer, scoped CSS, and static contracts only; no protocol/server/dependency change |

An interactive live-run click-through was not available. The saved evidence combines source inspection, CSS cascade analysis, focused contracts, the full package suite, two independent reviews of the minimize/restore feature, and a real headless Chrome geometry probe of the intrinsic-height follow-up.

## Intrinsic-height follow-up supersession

The initial minimize/restore report described the then-current fixed reserved workflow slot. A subsequent user screenshot showed that this reservation outlived short rendered output and left visible blank space below the workflow summary and TODO progress widget. The final sizing contract supersedes only that historical layout behavior:

- `.widget-area:has(.workflow-widget:not(.minimized))` now uses `flex: 0 0 auto` so its block size follows rendered workflow content.
- `--workflow-overlay-max-height: min(44rem, 68dvh)` bounds desktop growth; the existing mobile/coarse-pointer layout overrides the cap to `34dvh`.
- The workflow subprocess terminal changed from fixed `height: clamp(12rem, 34dvh, 26rem)` to `max-height` with the same clamp, so short logs shrink while long logs retain a local scrollbar.
- Headless Chrome verified growth, shrinkage, and collapse at 1600×1000: 289px (2 lines), 535px (80 lines), 270px (1 line), and 224px (collapsed).
- Per-tab minimize state, ARIA attributes, focus restoration, hidden-body rendering, commands, and scroll/follow recovery remain unchanged and valid.

## Independent review quorum and dispositions

Run: `c763a4fe-aaa1-4afb-b224-12629a6a2229`. Both qualifying outputs were fresh-context, read-only reviewer runs at high thinking and assessed the integrated implementation. The successful model-author families—MoonshotAI and Qwen—are distinct from each other and from the OpenAI implementation provider.

| Reviewer | Authoritative runtime model | Verdict | Findings and parent disposition |
|---|---|---|---|
| Child 0 | `openrouter/moonshotai/kimi-k3:high` | Clean; no blockers; confidence 90/100 | **Deferred:** pre-existing closed-tab scroll-map cleanup and inherited passive-rerender focus loss are outside this feature. **Deferred:** an exact 44px CSS assertion is optional because the rule was directly verified and the feature contract is already covered. |
| Child 1 | `openrouter/qwen/qwen3.7-plus:high` | Clean; no blockers; confidence 92/100 | **Rejected:** adding `aria-hidden` duplicates the native `hidden` accessibility behavior and creates avoidable dual state. **Rejected:** the claimed double class-space does not occur; the live/log ternary always emits a class before the optional minimized token. |

The first slot initially attempted `anthropic/claude-sonnet-5:high` and `anthropic/claude-opus-4-8:high`; both failed before producing output with account rate-limit responses. The successful Kimi fallback is the qualifying reviewer, regardless of the generated artifact's stale self-identification.

Review artifacts:

- `.pi-subagents/artifacts/outputs/c763a4fe-aaa1-4afb-b224-12629a6a2229/.pi-subagents/reviews/workflow-subprocess-minimize-restore-anthropic.md` (Kimi fallback output; filename was allocated before fallback)
- `.pi-subagents/artifacts/outputs/c763a4fe-aaa1-4afb-b224-12629a6a2229/.pi-subagents/reviews/workflow-subprocess-minimize-restore-qwen.md`

No finding required a production or test change after the qualifying integrated review.

## Execution record

The repository already contained unrelated uncommitted WebUI changes, including the completed Workflow Overlay Navigation and Workflow Raw-Data Inspector work. This feature uses targeted edits and preserves those changes. The implementation owner independently inspected the feature hunks and retained ownership of review dispositions, final validation, plan state, and report generation.
