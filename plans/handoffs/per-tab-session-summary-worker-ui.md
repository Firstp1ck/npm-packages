# W1 Functional UI Handoff — Per-tab Session Summary

## Identity and status

- Workstream: W1 functional UI (`worker-ui`)
- Retry context: diagnostic retry of failed run `316623dd-c644-456c-8cf2-d79e49cd04d1`, step 0; the prior attempt made no product changes
- Current run: output attempt 2 (`727f83ba-fc73-4ecd-9c0c-e032a6f88e2e`)
- Status: implemented and locally validated; awaiting parent integration and W2 presentation/regression work
- Classification: complex, retained from the canonical plan because the feature crosses static markup, dynamic per-tab/catalog/state rendering, setup target continuity, styling, and browser regression coverage across two implementation workstreams
- Integration owner: parent Pi session (`019fd211-b14b-70a9-969e-f32dbdf556c0`)

## Revisions

- Base revision: `fc1ca625363066747915bc8f8e224ed7597a8d09`
- Result revision: `fc1ca625363066747915bc8f8e224ed7597a8d09` plus the unstaged working-tree changes listed below (worker did not commit or stage)

## Changed files and summary

- `pi-package-webui/public/index.html`
  - Removed the workspace-header `#summaryHeaderButton`.
  - Removed the composer-actions `#summaryActionButton`.
- `pi-package-webui/public/app.js`
  - Removed static summary element bindings and click handlers.
  - Added reusable `createTerminalTabSessionSummaryButton(tab)` controls to regular Pi tabs and each grouped Pi tab menu item; subagent render paths are untouched.
  - Bound clicks directly to `tab.id` without calling `switchTab`.
  - Derived visibility from each tab's command catalog and disabled/annotated controls from each tab's generating/failure/latest/empty summary state.
  - Added `aria-controls`, `aria-busy`, tab-specific accessible labels/tooltips, and the stable `terminal-tab:<tabId>:summary` continuity key.
  - Scheduled tab re-rendering when summary state or any tab command catalog changes.
  - Passed the clicked tab ID into `/summary-setup`, captured it before confirmation/save, supplied it explicitly to preference persistence, and reused it for first-summary projection and generation.
- `plans/handoffs/per-tab-session-summary-worker-ui.md`
  - This worker evidence record.

## Validation commands and exit codes

1. `node --check pi-package-webui/public/app.js`
   - Exit code: `0`
   - Output: none (syntax valid).
2. Focused static assertion command:
   ```bash
   node --input-type=module <<'NODE'
   import fs from 'node:fs';
   import assert from 'node:assert/strict';
   const html = fs.readFileSync('pi-package-webui/public/index.html', 'utf8');
   const app = fs.readFileSync('pi-package-webui/public/app.js', 'utf8');
   assert.equal(html.includes('summaryHeaderButton'), false);
   assert.equal(html.includes('summaryActionButton'), false);
   assert.equal(app.includes('summaryHeaderButton'), false);
   assert.equal(app.includes('summaryActionButton'), false);
   assert.equal((app.match(/createTerminalTabSessionSummaryButton\(tab\)/g) || []).length, 3);
   assert.match(app, /openSessionSummaryForTab\(tab\.id\)/);
   assert.match(app, /openNativeSessionSummarySetupDialog\(\{ initialData: response\.data, tabId \}\)/);
   assert.match(app, /tabId: targetTabId/);
   assert.match(app, /terminal-tab:\$\{tabId\}:summary/);
   console.log('focused per-tab summary inspection passed');
   NODE
   ```
   - Exit code: `0`
   - Output: `focused per-tab summary inspection passed`.
3. `git diff --check -- pi-package-webui/public/index.html pi-package-webui/public/app.js`
   - Exit code: `0`
   - Output: none; an immediately repeated evidence wrapper printed `git diff --check exit=0`.
4. `git diff -- pi-package-webui/public/index.html pi-package-webui/public/app.js`
   - Exit code: `0`
   - Read-only inspection confirmed only the approved W1 product files changed and the intended direct-tab/setup bindings are present.
5. `git status --short && printf '%s\n' '--- staged ---' && git diff --cached --name-only && printf '%s\n' '--- revision ---' && git rev-parse HEAD`
   - Exit code: `0`
   - No staged files were listed; base/result revision was `fc1ca625363066747915bc8f8e224ed7597a8d09`.

## Omissions

- No tests were added or updated: test ownership belongs to W2 and tests were explicitly outside this worker's write boundary.
- Playwright, static test, and full package suites were not run: the canonical DAG assigns updated presentation/regression coverage to W2 after W1 integration. This worker ran the required syntax check and focused read-only inspection only.
- No browser interaction evidence was collected; W2/central integration must verify inactive-tab non-activation, grouped menus, responsive layout, generating state, and overlay focus behavior in-browser.

## Deviations, assumptions, and unresolved decisions

- Deviations: none from the approved W1 direction or write boundary.
- Assumption: an individual tab launcher is rendered only after that tab's command catalog has loaded and exposes `summary`, matching the approved catalog-driven visibility rule.
- Assumption: the group representative remains launcher-free because the canonical plan requires one control per session on grouped menu items rather than a duplicate on the representative.
- Unresolved decisions: none introduced by W1.

## Residual risks

- W2 must add compact layout styling for `.terminal-tab-summary-button`; W1 intentionally did not edit CSS.
- Browser validation is still required for tight/dense/mobile layouts and for focus restoration after state-driven tab re-renders.
- Existing static/browser expectations still refer to the old controls until W2 updates them.

## Integration notes

- Integrate W1 before W2 as specified by the canonical DAG.
- W2 can target `.terminal-tab-summary-button`, `aria-busy`, and the `terminal-tab:<tabId>:summary` continuity identity.
- The summary launcher is intentionally appended only by `renderTerminalTab` and `renderTerminalTabGroupItem`; subagent terminal tab functions were not modified.
- No protocol, API endpoint, persistence shape, dependency, package metadata, CSS, test, canonical plan, or report changes were made.
