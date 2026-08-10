# Lightweight Feature Plan: Optional-feature setup actions

**Goal:** Add a dedicated **Setup** action beside the enable/disable control for configurable optional features in the WebUI side panel, including Native questionnaires.

**Classification:** Lightweight. Repository evidence confirms this is one tightly coupled browser interaction slice in `pi-package-webui/public/app.js`, with focused static-test and user-documentation updates. It does not add a backend contract, migration, rollout, or material security boundary, so the preliminary lightweight classification remains correct.

**Integration owner:** Parent Pi agent.

## Success criteria

1. Configurable, detected optional features show a **Setup** button beside their normal enable/disable action.
2. Native questionnaires show **Enable** or **Disable** based on the active tab's real `questionnaire` tool state, plus a separate **Setup** button that opens the browser-native Tools Setup dialog.
3. Questionnaire enable/disable updates only the active session tool allowlist and preserves every other tool state.
4. Existing install, update, retry, reload, conflict, and copy-command actions remain unchanged.
5. Focused static tests, package checks, and documentation checks pass.

## Scope and decisions

- Add setup metadata only for optional features that already have a browser-native setup flow: Guided Git, Workflows, Safety guard, and Native questionnaires.
- Keep **Setup** available while a detected feature is disabled so users can reconfigure it.
- For Native questionnaires, use Pi's session tool state as the source of truth; do not create a second cosmetic browser-only toggle.
- Keep global tool defaults inside Tools Setup. The row-level Enable/Disable action is session-scoped and immediate.
- Do not change installation, package registration, or optional-feature catalog APIs.

## Delegation decision

No delegation. The change has one write outcome across a single tightly coupled frontend/test/docs seam. A single child is forbidden by the active zero-or-multiple rule, while two writers would manufacture unnecessary fanout and violate the distinct-outcome requirement.

## Verification

- Run the focused mobile/static test that covers optional-feature rendering.
- Run JavaScript syntax checks and the relevant package test/check command.
- Run `git diff --check` for Markdown and inspect the final diff.

## Progress

- 2026-08-10 — Preliminary `lightweight` classification confirmed from repository evidence.
- 2026-08-10 — Existing questionnaire row traced: it detects the tool through `/api/tools`, but currently collapses access control and setup into one **Tools…** button.
- 2026-08-10 — Added setup routing for Guided Git, Workflows, Safety guard, and Native questionnaires. Questionnaire row access now reads and writes the active session's real tool allowlist while preserving all other enabled tools.
- 2026-08-10 — JavaScript syntax, changed static acceptance assertions, and `git diff --check` passed. The full WebUI check ran 146 test files; 138 passed and 8 failed on pre-existing README/version expectation mismatches. `HEAD` already lacks the Git-panel README text required by one representative failure, so the package-wide gate is not attributable to this feature.

## Acceptance result

**Verdict:** FAIL for package release readiness because the repository-wide `npm run check` gate is not green. The requested feature's focused checks pass, but this plan remains in `plans/planned/` until the unrelated baseline test/documentation drift is resolved or explicitly accepted.
