# Git Panel Render Stability (flicker + collapse-state reset during agent runs)

Related report: [Git Panel Render Stability report](../reports/git-panel-render-stability.html)

## Objective and success criteria

Stop the side-panel Git section—and the workspace dashboard/context meter in the same render fan-out—from flickering or losing collapse state while an agent is running.

Success criteria:

- Poll/activity-driven `renderTabs()` calls do not rebuild the Git panel DOM unless rendered inputs change.
- Folder `<details>` choices survive legitimate rebuilds while preserving top-level-open/deeper-closed defaults.
- Workspace dashboard and context meter use equivalent cheap input-signature guards.
- Focused syntax/static checks and strict report validation pass.
- The full repository check is run and any unrelated failure is recorded without changing package metadata.

## Scope and non-goals

In scope: localized render guards and persisted Git-folder overrides in `public/app.js`, source-level regression assertions, reviewer disposition, and this plan/report pair.

Non-goals:

- No polling cadence or SSE redesign.
- No keyed-DOM/virtual-DOM rewrite.
- No visual/styling changes.
- No refactor of other `replaceChildren` sites.
- No package/package-lock repair.
- No jsdom/browser dependency or unrelated `card.tabTitle` repair.

## Root cause (verified in source)

1. `syncTabPolling()` polls `/api/tabs` about every 1.5 seconds while a tab is working; activity events can also schedule tab renders.
2. `renderTabs()` fans out to `renderWorkspaceDashboard()`, `renderContextMeter()`, and `renderGitPanel()` on every tick.
3. `renderGitPanel()` previously rebuilt cards with `replaceChildren(...)` on each call.
4. Folder open state originally lived only on rebuilt `<details>` elements, so a rebuild restored defaults instead of the user's choice.

## Approved decisions and architecture

- Build cheap JSON render signatures from values that affect each renderer and skip DOM replacement when the signature and a small DOM-integrity fallback match.
- Keep `gitPanelState.openFolders` as a map keyed by `root\0category\0path`, but store **only user overrides** from `defaultOpen = depth === 0`.
- Initialize `details.open` from a stored override or the default. On `toggle`, delete the key when the state equals the default; otherwise store the Boolean override. This makes delayed programmatic toggle events idempotent.
- Prune folder overrides for removed roots with the existing live-root cleanup. Exact live-path pruning is intentionally not added.
- Keep sibling guards localized in `renderContextMeter()` and `renderWorkspaceDashboard()`.
- Implementation model: `openai-codex/gpt-5.6-sol` (user-directed override).

### Render flow

`poll/SSE → renderTabs() → renderer signature → unchanged + DOM intact ? skip replacement : rebuild`

Necessary Git side effects—state pruning, context-menu cleanup, and repository discovery—remain ordered around the guard as verified by both reviewers.

## Work items and dependencies

1. [x] Add the Git panel render signature and pre-rebuild skip guard.
2. [x] Persist Git folder state and canonicalize the map to user overrides only.
3. [x] Add/complete guards for the workspace dashboard and context meter.
4. [x] Add focused static regression coverage, including canonical override behavior and removal of dead `sectionExpanded` input.
5. [x] Update the pre-existing mobile static assertion to recognize the approved `defaultOpen` form; no unrelated mobile behavior changed.
6. [x] Obtain and disposition two qualifying independent reviews; replace the failed Google attempt.
7. [x] Run required checks and record the single known unrelated full-suite failure.
8. [x] Create and strictly validate the linked self-contained HTML report.

Dependencies/merge order: implementation → focused tests → independent reviews → accepted fixes → checks → report/plan finalization. One writer owns all edits.

## Implementation map

- `public/app.js`
  - `gitPanelState`: persisted `openFolders` map and render-signature cache.
  - `renderGitPanelFolder()`: depth default, stored override restore, delete-on-default/store-on-override canonicalization.
  - `renderGitPanel()`: stale-state pruning, comprehensive signature, DOM-integrity fallback, and removal of always-true `sectionExpanded` signature member.
  - `renderContextMeter()`: complete visible/input signature before emptying or rebuilding.
  - `renderWorkspaceDashboard()`: complete dashboard signature including tab indicators, context/theme, and model/session presence.
- `tests/git-panel-render-stability-static.test.mjs`: focused structural checks for state, canonical override rules, pruning, dead-member absence, and guard ordering.
- `tests/mobile-static.test.mjs`: one existing Git-folder assertion updated from direct `depth === 0` assignment to the equivalent named `defaultOpen` implementation.

## Acceptance tests and results

| Check | Result | Evidence |
|---|---|---|
| `node --check public/app.js` | Pass | Exit 0; no output. |
| `node --test tests/git-panel-render-stability-static.test.mjs` | Pass | TAP: 1 test, 1 pass, 0 fail. |
| `npm run check` | Expected unrelated failure | Syntax checks pass; 28/29 test files pass. `mobile-static.test.mjs:1751` fails only because package-lock root contains optional companion `@firstpick/pi-extension-bang-command-autocomplete` at `^0.2.1`, while the assertion expects `undefined`. Package/package-lock were not changed for this task. |
| `git diff --check -- public/app.js tests/git-panel-render-stability-static.test.mjs plans/git-panel-render-stability.md reports/git-panel-render-stability.html` | Pass | Exit 0; no whitespace errors. |
| Strict HTML validator | Pass | `validate_report.py ... --strict`: validation passed. |

The first `npm run check` after canonicalization exposed a directly affected pre-existing mobile source assertion that required the literal `details.open = depth === 0`. Its narrow regex was updated to accept `const defaultOpen = depth === 0`; rerunning then reached exactly the known unrelated package-lock assertion above.

Manual browser behavior remains unexecuted because the repository has no browser/jsdom harness for these functions.

## Independent review trace

### Qualifying reviewer A — Anthropic

- Run ID: `bc028140-aa0c-4ad6-add2-b2e005c63e71`, reviewer 0.
- Exact model: `anthropic/claude-opus-4-8:high` (Claude Opus 4.8).
- Provider/model family: Anthropic / Claude.
- Verdict: **approve**; confidence 88/100.
- Reviewer checks: `node --check public/app.js` passed; focused test passed; full target diff and four render/state paths inspected.

Verified-correct observations (no action): snapshot `loadedAt` invalidates changed Git content; top-level child-count fallback matches one card/element; pruning/menu cleanup/discovery side effects remain safe; badge/status values are represented; context-menu guard protects triggers; context-meter and dashboard signatures cover rendered inputs; keys separate root/category/path; section re-expand, repository toggle, view switch, and busy-state handling were reasoned correct.

Findings and dispositions:

1. **Minor: dead folder paths can remain for a still-live repository — deferred.** Canonical storage now limits entries to actual user overrides. Exact live-path pruning would require duplicating or threading tree traversal and is disproportionate for this fix. Residual bounded-by-user-interaction memory risk remains.
2. **Minor: asynchronous programmatic `<details>` toggle can write defaults — accepted and fixed.** `defaultOpen` is explicit; default-valued toggles delete the key, and only deviations are stored. A delayed programmatic event is harmless/idempotent.
3. **Nit: `sectionExpanded` is always true in the signature — accepted and fixed.** The local/signature member was removed because the function already returns while collapsed.
4. **Theme-signature inconsistency — rejected.** Git output has no theme-dependent DOM value; appearance is CSS-driven, so adding theme would not improve correctness.
5. **Unrelated `card.tabTitle` fallback issue — deferred.** It is pre-existing and outside this stability fix.
6. **Static source tests are not behavioral — accepted as evidence limitation.** Canonical behavior assertions were strengthened without introducing a new DOM dependency.

### Qualifying reviewer B — DeepSeek replacement

- Run ID: `bc06461c-de5a-4259-beef-952c2933515f`.
- Exact model: `openrouter/deepseek/deepseek-v4-pro:high` (DeepSeek v4 Pro via OpenRouter).
- Provider/model family: OpenRouter gateway / DeepSeek.
- Verdict: **approve**; confidence 92/100.
- Reviewer checks/evidence: focused static assertions passed; all salient Git signature fields were inspected; context-meter/dashboard guards and fallback behavior were inspected.

Verified-correct observations (no action): post-prune `discovering` is correct; rebuild-only badge/status updates are safe because their inputs are in the signature; redundant context auto-compaction capture is harmless; Git group details are deterministic; first-eight dashboard tab ordering/overflow behavior is represented; context-menu early return is pre-existing; all three signatures and integrity fallbacks were judged complete; key extraction and dead-root pruning were judged correct.

Findings and dispositions:

1. **Low: static tests are structural — accepted as limitation.** The focused test now asserts `defaultOpen`, delete-on-default, store-on-override, and absence of `sectionExpanded`, while retaining source-level guard-order checks.
2. **Low: add a behavioral DOM regression test — deferred.** No browser/jsdom harness exists, and adding one is disproportionate to this narrow fix. Manual-browser behavior is recorded as residual unverified risk.
3. **Maintenance risks (JSON ordering/input drift) — no action.** Reviewed objects have fixed construction order; signature/render co-location is the proportionate mitigation.

### Non-qualifying failed attempt — Google

- Run ID: `bc028140-aa0c-4ad6-add2-b2e005c63e71`, reviewer 1.
- Requested model: `google/gemini-3.1-pro-preview:high` (base model `google/gemini-3.1-pro-preview`).
- Provider/model family: Google / Gemini.
- Result: failed before review with HTTP 400 `INVALID_ARGUMENT`, reason `API_KEY_INVALID`: “API key not valid. Please pass a valid API key.”
- Disposition: **non-qualifying and replaced** by the independent DeepSeek run above; no findings were produced or counted.

## Review status

- Implementation: complete.
- Accepted review fixes: complete.
- Qualifying review gate: complete (Anthropic + DeepSeek, separate runs/provider families).
- Failed Google attempt: recorded but not counted.
- Report: complete and strictly validated.
- Full repository check: incomplete only because of the unrelated pre-existing package-lock assertion documented above.

## Residual risks

- User overrides for vanished folders can linger while the repository root remains live; canonicalization limits this to genuine user choices, but exact path pruning is deferred.
- A future rendered field could be added without updating its co-located signature, causing stale DOM until another input changes.
- Behavioral DOM timing/focus/scroll was not executed in a real browser or jsdom. The accepted delayed-toggle behavior is supported by canonical idempotence and structural assertions, not a browser test.
- The repository contains unrelated existing staged and unstaged changes. This task did not commit, unstage, or alter package/package-lock files.

## Usage and verification guidance

During an agent run, leave the Git section expanded, toggle a top-level folder closed and a nested folder open, and observe several poll cycles. The same DOM should remain stable while inputs are unchanged. Trigger a legitimate Git snapshot update and confirm the panel refreshes while the two folder choices persist. Collapse/re-expand the top-level Git section and verify defaults apply only where no override exists.

For repeatable local verification, run:

```sh
node --check public/app.js
node --test tests/git-panel-render-stability-static.test.mjs
npm run check
python3 /home/firstpick/.pi/agent/skills/html-report/scripts/validate_report.py reports/git-panel-render-stability.html --strict
```
