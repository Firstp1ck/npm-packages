# Workflow Overlay Close / Restore

Status: Complete  
Integration owner: Parent Pi session  
Related report: [Workflow Overlay Close / Restore report](../reports/workflow-overlay-close-restore.html)

## Goal and success criteria

Allow the complete Workflow overlay to be temporarily closed without clearing or stopping its workflow state, and expose an **Open** helper action on the composer Workflow control that restores it.

Success criteria:

- One **Close** action hides both specialized Workflow surfaces: the run inspector and subprocess output.
- Closing changes browser-only presentation state; it does not send `/workflow-clear`, abort a run, disable Workflow Mode, or mutate extension payloads.
- A compact **Open workflow overlay** helper appears on the Workflow control while the overlay is minimized and restores the same live data.
- Minimized state is independent per terminal tab and is discarded when that tab closes.
- Close/restore preserves keyboard continuity by moving focus to the replacement control.
- Controls expose useful labels and `aria-controls` / `aria-expanded` state.
- Existing per-widget Minimize/Restore controls remain independent.

## Classification

**Lightweight feature.** The preliminary classification is confirmed by repository evidence: the change is localized to browser markup, renderer state, scoped CSS, and static frontend contracts in `pi-package-webui`. It changes no extension protocol, server endpoint, dependency, persisted schema, security boundary, migration, or deployment behavior.

## Approved design

- Track complete-overlay minimized state in a per-tab `Set`, separate from existing inspector and subprocess minimized state.
- While minimized, omit both specialized Workflow widgets from `renderWidgets()` but retain their replayed payloads and live browser state.
- Attach exactly one **Close** action to the first rendered Workflow widget header, so it remains available whether the inspector, subprocess output, or both exist.
- Group a circular **Open** helper badge with the existing Workflow Mode button, following the visual pattern used by the app-runner help badge.
- Show the helper only when Workflow content exists and that tab's complete overlay is minimized.
- Restore focus from Close to Open and from Open to the recreated Close control after DOM replacement.

## Scope and non-goals

In scope:

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `tests/mobile-static.test.mjs`
- This plan and the final self-contained report

Non-goals:

- Clearing, pausing, aborting, or otherwise changing workflow execution.
- Persisting minimized state across page reloads.
- Replacing the existing per-widget Minimize/Restore controls.
- Changing Workflow extension payloads, APIs, or server behavior.

## Work items

1. [x] Inspect the Workflow renderers, per-tab state lifecycle, composer control patterns, CSS, and static tests.
2. [x] Implement complete-overlay close/restore state and controls.
3. [x] Add focused static contracts and run syntax/package checks.
4. [x] Obtain and disposition two independent cross-provider reviews.
5. [x] Finalize and validate `reports/workflow-overlay-close-restore.html`.

## Acceptance checks

- `node --check public/app.js`
- `node --test tests/mobile-static.test.mjs`
- `npm run check`
- Scoped `git diff --check`
- Two fresh, read-only, provider-diverse reviews of the integrated implementation
- Strict HTML report validation

## Risks and rollback

- Renderer replacement can lose focus; explicit post-render focus targeting covers both directions.
- A helper badge needs an anchor element; the grouped Workflow control keeps the existing mode button as that anchor.
- Complete-overlay state must not erase existing per-widget disclosure state; it uses an independent set and only skips rendering.
- Rollback is a direct revert of the localized HTML, JavaScript, CSS, test, plan, and report changes. No data migration is required.

## Validation record

- `node --check public/app.js`: pass.
- Feature-specific assertions in `tests/mobile-static.test.mjs`: pass; execution reached the pre-existing package-version fixture mismatch near the end of the file.
- `npm run check`: all preceding package checks passed; suite stopped at the unrelated mismatch expecting `@firstpick/pi-extension-bang-command-autocomplete` `^0.2.1` while the already-modified package files specify `^0.2.2`.
- Scoped `git diff --check`: pass.
- Two fresh read-only reviews completed with Anthropic Claude Sonnet 5 and Google Gemini 3.6 Flash, both provider-distinct from the OpenAI implementation provider.

## Independent review and dispositions

Run: `cb7c6c74-1e3d-486f-83c2-906118d5b770`.

| Reviewer | Result | Findings and integration-owner disposition |
|---|---|---|
| Anthropic Claude Sonnet 5, high thinking | Qualifying success; confidence 88/100 | No blockers. **Accepted via Google F1:** make the otherwise-unused `has-open-control` hook reserve an anchor box. **Deferred:** dedicated overlay wrapper/precise `aria-controls`, behavioral browser harness, and cosmetic placement unification are non-blocking and would broaden this localized change. |
| Google Gemini 3.6 Flash, high thinking | Qualifying success; confidence 92/100 | **Accepted F1:** reserve a `1.95rem` anchor when the mode button is unavailable; implemented and tested. **Rejected F2:** persistence is the requested minimize behavior; completion does not remove replayed content, and clearing state on transient content loss could unexpectedly reopen the overlay. **Rejected F3 severity/remediation:** the 31px helper matches the requested app-runner pattern and exceeds WCAG 2.2 AA's 24px target minimum; a 44px target is optional enhanced guidance. **Accepted F4:** remove duplicate native `title`; implemented and tested. **Deferred F5:** executable DOM coverage is desirable, but static contracts match the neighboring WebUI convention and direct call-graph review found no functional defect. |

Review artifacts:

- `.pi-subagents/artifacts/outputs/cb7c6c74-1e3d-486f-83c2-906118d5b770/.pi-subagents/reviews/workflow-overlay-close-anthropic.md`
- `.pi-subagents/artifacts/outputs/cb7c6c74-1e3d-486f-83c2-906118d5b770/.pi-subagents/reviews/workflow-overlay-close-google.md`

## Residual risks

- No browser automation harness currently clicks the live Close/Open controls; focused static contracts, direct control-flow review, and two independent reviews cover the implementation.
- The complete overlay is represented by two specialized sibling widgets, so `aria-controls` names the containing `widgetArea` rather than a dedicated wrapper.
- The Open helper intentionally preserves the existing compact app-runner helper size and visual convention.

## Existing worktree note

`pi-package-webui/package.json` and `pi-package-webui/package-lock.json` were already modified before this feature and are not part of its implementation or review scope.
