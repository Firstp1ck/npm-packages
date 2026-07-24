# Workflow Overlay Navigation

Status: Complete  
Integration owner: Parent Pi session

Related report: [Workflow Overlay Navigation report](../reports/workflow-overlay-navigation.html)

## Goal and success criteria

Make the workflow subprocess overlay easier to scan and scroll without changing the workflow extension protocol.

Success criteria:

- Run status, active phase, task progress, and output truncation are presented as labeled groups instead of an undifferentiated pill row.
- Truncated output clearly explains that the visible history is limited.
- The overlay has one clear vertical scrolling boundary, while terminal horizontal scrolling remains local.
- Scrolling up pauses automatic follow-to-bottom behavior; returning near the bottom resumes it.
- Wheel/trackpad scrolling can transition naturally from the terminal to the containing workflow area at a terminal boundary.
- Existing output expand/collapse behavior and workflow actions remain intact.
- Focused static checks, the full package test suite, two independent reviews, and the final HTML report pass.

## Classification

**Lightweight feature.** The preliminary classification is confirmed by repository evidence: the change is localized to the existing subprocess renderer in `public/app.js`, its workflow-specific rules in `public/styles.css`, and static frontend contract assertions in `tests/mobile-static.test.mjs`. It does not change extension payloads, server APIs, dependencies, persistence, security boundaries, or deployment behavior.

## Approved design

- Add a subprocess-specific widget class so layout changes do not affect npm, AUR, app-runner, or workflow-inspector widgets.
- Render metadata as labeled status groups: **Run**, **Phase**, **Tasks**, and conditionally **Output**.
- Replace the ambiguous `truncated` label with `Limited history` plus a visible explanation so keyboard and touch users receive the same detail as pointer users.
- Keep the containing workflow area vertically bounded, reserve a non-shrinking slot up to the existing 68dvh/44rem allowance, retain 26rem for the surrounding shell and transcript on shorter desktop viewports, and hide horizontal overflow there.
- Preserve per-tab workflow terminal position in browser memory. Follow the live tail only while the user is at/near the bottom; retain their reading position after they scroll upward.
- Let vertical overscroll propagate from the workflow terminal to the outer workflow area. Keep terminal horizontal scrolling local for long log lines.
- Add a small live follow-state message below the terminal so automatic behavior is discoverable.
- Preserve the current default-expanded output and all command buttons.

## Scope and non-goals

In scope:

- `public/app.js`: metadata structure and workflow-terminal follow state.
- `public/styles.css`: workflow-specific hierarchy, scroll boundaries, and responsive behavior.
- `tests/mobile-static.test.mjs`: focused source/CSS contracts.
- This plan and the final self-contained report.

Non-goals:

- Changing workflow subprocess payloads or retention limits.
- Reworking the workflow inspector or raw-script dialog.
- Redesigning shared release/app-runner widgets.
- Adding dependencies or browser-side persistence.

## Work items

1. [x] Inspect current renderer, scroll containers, CSS cascade, and tests.
2. [x] Approve localized metadata and scroll-follow design.
3. [x] Implement renderer and workflow-specific styling.
4. [x] Add focused assertions and run targeted/full checks.
5. [x] Obtain and disposition two independent cross-provider reviews.
6. [x] Create and validate `reports/workflow-overlay-navigation.html`.

## Acceptance checks

- `node --check public/app.js`
- `node --test tests/mobile-static.test.mjs`
- `npm run check`
- `git diff --check -- pi-package-webui/public/app.js pi-package-webui/public/styles.css pi-package-webui/tests/mobile-static.test.mjs pi-package-webui/plans/workflow-overlay-navigation.md pi-package-webui/reports/workflow-overlay-navigation.html`
- Two fresh, read-only, distinct-provider reviews of the integrated diff.
- Strict HTML report validation.

## Risks and rollback

- Scroll events fired by programmatic restoration could incorrectly change follow state; restoration will apply state after layout and derive following only from actual distance to bottom.
- Multiple tabs must not share scroll positions; state keys include the active tab and workflow widget key.
- Shared widget CSS is easy to regress; all new behavior is scoped under `.workflow-subprocess-widget` or the existing workflow-area selector.
- Rollback is a direct revert of the localized app/CSS/test changes; no data or protocol migration exists.

## Acceptance results

| Check | Result | Evidence |
|---|---|---|
| `node --check public/app.js` | Pass | Exit 0 |
| `node --test tests/mobile-static.test.mjs` | Pass | TAP: 1 test, 1 pass, 0 failures |
| `npm run check` | Pass | All 41 test files passed after final review fixes |
| Workflow live CSS cascade guard | Pass | Dedicated live-workflow selector excludes shared `overflow: auto` and declares `overflow-x: hidden; overflow-y: auto` |
| Repeated hard-reload computed-layout probe | Pass | Five fresh reloads at 1600×1000 kept the workflow slot at 407px; five at 2544×1383 kept it at 704px. Both retained transcript space and local horizontal overflow. |
| `git diff --check -- ...` | Pass | No whitespace errors in implementation, tests, plan, or report |
| Strict HTML validation | Pass | `validate_report.py reports/workflow-overlay-navigation.html --strict`: no errors or warnings |

A pixel-diff suite was not available because no Playwright or Puppeteer dependency is installed. The supplied screenshot informed the design. After a user-reported shrink regression, a temporary Chrome DevTools Protocol probe measured the real rendered slot across repeated hard reloads at medium and full-window dimensions; source contracts, the CSS cascade guard, and the package suite cover the durable implementation.

## Independent review trace and dispositions

Qualifying quorum: Google and DeepSeek, both fresh/read-only and distinct from each other and the OpenAI implementation provider. Qwen supplied an additional qualifying CSS/accessibility review.

| Provider / run | Result | Findings and disposition |
|---|---|---|
| Google / `3853d01c-8eb8-4f49-81ac-7603cea6f24d` | Qualifying success | **Accepted:** add `role="group"` to make the summary label effective. **Accepted:** replace the hover-only truncation title with visible descriptive text. Both fixes implemented and tested. |
| Anthropic / `3853d01c-8eb8-4f49-81ac-7603cea6f24d` | Failed, not counted | Timed out after 900000ms; no qualifying output. |
| Anthropic retry / `2184e22f-6dab-4368-a8cf-9c6949da3dcb` | Failed, not counted | Exceeded its turn budget. Its partial low-severity test-coverage note was independently verified, accepted, and addressed with ARIA/description/preserve-scroll assertions. |
| Mistral / `2184e22f-6dab-4368-a8cf-9c6949da3dcb` | Failed, not counted | Command failure after inspection; no qualifying output. |
| DeepSeek / `b9daa5fa-f5b0-484c-abfa-aceff9b86678` | Qualifying success | No blockers. Low-risk notes about one tiny stale state record per formerly rendered tab and optional extra micro-assertions are **deferred**; neither is a material defect. Confidence 95/100. |
| Qwen / `b9daa5fa-f5b0-484c-abfa-aceff9b86678` | Qualifying success | No blockers. Harmless legacy pill selectors and the inspector-wide outer workflow bound are **deferred** as unrelated/no-benefit cleanup. Confidence 90/100. |
| Parent cascade verification | Integrated fix | **Accepted:** the original shared live-widget selector had higher specificity and could override workflow `overflow-x: hidden`. The workflow branch was separated into a dedicated selector and covered by a focused cascade assertion. |

Review artifacts are saved beneath `.pi-subagents/artifacts/outputs/` for the run IDs above. The final integrated state was reviewed after the accessibility and CSS-specificity fixes.

## Residual risks and rollout

- No pixel-level browser comparison was available; manual acceptance on a long live workflow is still useful.
- `workflowTerminalScrollByTab` may retain one tiny state object for a formerly rendered tab until page reload. It stores only follow state and pixel position, not terminal output.
- The outer workflow slot uses `flex: 0 0` with `max(12rem, min(44rem, 68dvh, calc(100% - 26rem)))`; it cannot collapse during restoration, while the 26rem reserve leaves room for tabs, transcript, footer, and composer. The terminal retains its independent `clamp(12rem, 34dvh, 26rem)` viewport.
- Rollout requires only a WebUI reload. There is no migration, server change, payload change, or dependency change.

## Post-completion shrink regression fix

A live browser report showed that the workflow overlay appeared smaller after repeated UI resets. The reset lifecycle itself did not persist a smaller size: five forced page reloads produced identical settled geometry. The root cause was the workflow-specific `flex: 0 1 ...` rule, which explicitly allowed the shared widget area to surrender almost its entire requested basis whenever the fixed-height chat shell renegotiated space while widgets and statuses were restored. In the reproduced full workflow tab, a requested 704px basis resolved to approximately 31px; at the smaller diagnostic viewport a requested 583px basis resolved to approximately 26px.

The fix changes only workflow-area CSS and its static contract: the slot is now non-shrinking and viewport-bounded, with an explicit 26rem surrounding-shell reserve. A real headless Chrome probe then held the slot at exactly 407px across five hard reloads at 1600×1000 and 704px across five hard reloads at 2544×1383. The transcript remained visible at both sizes. No workflow payload, persistence, server, renderer, inspector, or unrelated widget behavior changed.

## Execution record

The existing unrelated `public/app.js` raw-workflow-script changes and `plans/workflow-raw-data-inspector.md` were preserved and excluded from this feature's review scope. Final report: [`../reports/workflow-overlay-navigation.html`](../reports/workflow-overlay-navigation.html).
