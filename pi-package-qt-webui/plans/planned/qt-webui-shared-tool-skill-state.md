# Qt WebUI shared tool and skill state

**Status:** planned  
**Classification:** complex  
**Integration owner:** parent Pi session `subagent-chat-01a0426c-e15e-7c8a`  
**Final report:** [../../reports/qt-webui-shared-tool-skill-state.html](../../reports/qt-webui-shared-tool-skill-state.html)

## Goal

Make Qt WebUI use Pi Web UI's current tool and skill profile implementation so a selection saved in either interface is the selection the other interface reads and applies.

## Classification rationale

The preliminary complex classification is confirmed. The change crosses two published package contracts, replaces Qt WebUI's independent global/model persistence for two resource kinds, aligns persisted Pi session-entry schemas, requires compatibility handling for existing Qt profiles, and needs separate storage/helper and backend/integration validation workstreams. Sampling remains on Qt WebUI's existing path and must not regress.

## Success criteria

1. Qt WebUI global and exact-model tool/skill profiles read and write Pi Web UI's canonical `resourceDefaults` in `~/.pi/webui/settings.json`, including `PI_WEBUI_SETTINGS_FILE` test/deployment overrides.
2. Pi Web UI reads a Qt WebUI-saved global/model selection without translation, and Qt WebUI reads a Pi Web UI-saved selection on its next resource-state refresh. Opening either resource selector performs that refresh.
3. Qt WebUI session tool/skill choices use Pi Web UI's `webui-tools-config` and `webui-skills-config` version-2 branch entries. `null` writes inherit mode; `[]` remains an intentional empty enabled list; legacy disabled-skill entries remain readable.
4. Existing Qt WebUI session entries and `resources.json` tool/skill profiles remain readable as migration fallbacks, but all new tool/skill writes use the Pi Web UI contract. Existing sampling profiles continue to use Qt WebUI's `resources.json` and `qt-webui-resources` session data.
5. Unknown/unavailable names are preserved in canonical global/model profiles using Pi Web UI's current normalization/update helpers rather than silently deleted.
6. Existing idle-only, multi-tab application, rollback, durability, and fail-closed behavior remains intact.
7. Focused storage/helper, backend, multi-tab, package, documentation, and full package checks pass without overwriting unrelated uncommitted work.

## Scope

- Add Pi Web UI as an explicit runtime dependency of Qt WebUI and consume its current resource-selection and settings update modules.
- Adapt `lib/backend/resources.mjs` to combine shared Pi Web UI tool/skill defaults with Qt-local sampling profiles.
- Adapt `lib/pi-extension/qt-webui-helper.mjs` to read/write Pi Web UI session entry types while retaining Qt sampling and legacy fallback support.
- Update backend integration where store reads/writes become canonical and asynchronous.
- Add compatibility and cross-package contract tests.
- Update Qt WebUI user and contributor documentation and Pi Web UI contributor documentation only where the shared ownership contract needs to be explicit.

## Non-goals

- Sharing Qt-only sampling profiles, themes, display settings, session settlement, or model ordering with Pi Web UI.
- Introducing a network service or direct process-to-process coupling between the two UIs.
- Making two concurrently active Pi processes safe writers of the same session file; existing session reconciliation and idle-only guards remain authoritative.
- Redesigning either resource selector UI.
- Changing Pi's native package enable/disable settings; this feature covers the enabled tool/skill profiles exposed by the two WebUIs.

## Approved decisions and invariants

- **Canonical owner:** `@firstpick/pi-package-webui` remains the single implementation owner for tool/skill default normalization, exact-model profile shape, settings path, locking, atomic writes, and legacy settings import.
- **Dependency:** Qt WebUI imports the shipped Pi Web UI modules through an explicit npm dependency instead of copying their logic.
- **Refresh semantics:** both selectors already load state when opened; each backend state request reads the latest canonical file before applying it. No background network synchronization is added.
- **Session schema:** new Qt writes use Pi Web UI's version-2 explicit/inherit entries. Legacy Qt session entries are fallback input only.
- **Migration:** On the first Qt resource read, legacy Qt tool/skill values are copied into canonical null scopes under Pi Web UI's locked latest-snapshot updater, without overwriting canonical values or deleting legacy data. A bounded local completion marker makes this idempotent and ensures later canonical clears stay cleared.
- **Sampling isolation:** sampling remains Qt-owned and must retain its current persistence and provider-capability behavior.
- **One writer:** because the shared repository is dirty, implementation workers run sequentially in the shared tree. They must preserve all pre-existing staged and unstaged changes.

## Rejected or deferred options

- **Copy Pi Web UI helpers into Qt WebUI:** rejected because it creates two implementations that can drift.
- **Move the contract into a third package now:** deferred as unnecessary repository-wide churn; direct package reuse meets the requested ownership.
- **Delete Qt's legacy resource data after migration:** rejected because rollback and downgrade safety require non-destructive retained data.
- **Indefinite legacy fallback whenever canonical state is null:** rejected after W1 escalation because Pi Web UI removes all-inherit exact-model profiles; indefinite fallback could resurrect a legacy Qt value after a user explicitly clears the canonical profile.
- **Continuous filesystem push into already-open dialogs:** deferred; explicit state requests and selector-open refreshes are the existing safe interaction boundary.

## Execution DAG

```text
W1 shared storage + session contract
                 |
                 v
W2 backend integration + compatibility/docs
                 |
                 v
Parent central integration and cross-workstream validation
                 |
                 v
R1 + R2 independent read-only reviews
                 |
                 v
Accepted fixes, revalidation, HTML report, archive
```

## Workstreams and ownership

### W1 — Shared persistence and Pi session-entry compatibility

**Worker boundary:**

- `pi-package-qt-webui/package.json`
- `pi-package-qt-webui/package-lock.json` if generated/required
- `pi-package-qt-webui/lib/backend/resources.mjs`
- `pi-package-qt-webui/lib/pi-extension/qt-webui-helper.mjs`
- `pi-package-qt-webui/tests/backend-units.test.mjs`
- `pi-package-qt-webui/tests/package-contract.test.mjs`
- `pi-package-qt-webui/tests/packed-install.test.mjs`

**Deliverables:** canonical Pi Web UI storage adapter; version-2 shared session entries; legacy fallback; focused unit/package tests.  
**Handoff:** `plans/handoffs/qt-shared-resource-state-w1.md`

### W2 — Backend transaction integration, cross-package behavior, and documentation

Starts only after W1 is integrated and inspected.

**Worker boundary:**

- `pi-package-qt-webui/lib/backend/main.mjs`
- `pi-package-qt-webui/tests/backend-session.test.mjs`
- `pi-package-qt-webui/tests/backend-tabs.test.mjs`
- `pi-package-qt-webui/tests/helpers/backend-client.mjs`
- `pi-package-qt-webui/README.md`
- `pi-package-qt-webui/TECHNICAL.md`
- `pi-package-qt-webui/DEVELOPMENT.md`
- `pi-package-webui/DEVELOPMENT.md`

**Deliverables:** asynchronous canonical store integration; latest-file reads on state refresh; cross-UI compatibility fixtures; preserved transactions/rollback; documentation.  
**Handoff:** `plans/handoffs/qt-shared-resource-state-w2.md`

## Acceptance checks

- Focused Node tests for `backend-units`, `backend-session`, `backend-tabs`, package contracts, packed install, and docs contracts.
- Pi Web UI resource-selection and settings tests covering the imported contract.
- Qt WebUI `npm run check`.
- Pi Web UI focused resource-selection/mobile static checks when its documentation or contract assumptions change.
- `npm pack --dry-run --json` for Qt WebUI.
- `git diff --check` for affected files and repository Markdown.
- Tests must isolate `PI_WEBUI_SETTINGS_FILE`; no test may read or mutate the developer's real `~/.pi/webui/settings.json`.
- Inspect the staged/unstaged split before and after each worker; preserve unrelated changes, including session synchronization, D-Bus cleanup, session-card interaction, and deferred ordering work.

## Integration and rollback

The integration owner inspects each worker's actual diff and handoff before starting the next worker. W1 must preserve the public Qt backend resource shape so W2 can change only orchestration and tests. If canonical persistence fails, the backend must report failure and roll applied runtime state back as it does today. Rollback of the feature is code-only: restore Qt's package dependency, resource adapter, helper entry handling, backend async calls, and docs; legacy `resources.json` data is retained, so no user-data rollback is required. Canonical Pi Web UI settings are never deleted.

## Risks

- Pi Web UI internal subpath changes could break Qt WebUI; package tests and the explicit dependency pin/range must surface that compatibility failure.
- Cross-process writes must use Pi Web UI's lock and latest-snapshot merge; bypassing it can lose unrelated settings.
- Legacy Qt and canonical profiles can disagree; canonical values win when set, with Qt data only a fallback.
- Tests can accidentally touch real user settings unless `PI_WEBUI_SETTINGS_FILE` is isolated.
- Session entries appended by two concurrently active processes remain subject to existing session reconciliation constraints.

## Decision and progress record

- 2026-08-27: Confirmed complex classification from repository evidence.
- 2026-08-27: Selected Pi Web UI settings/session schemas as canonical per user direction.
- 2026-08-27: Chose sequential shared-tree workers because the repository contains extensive pre-existing uncommitted work and isolated dirty-tree fanout is unsafe.
- 2026-08-27: Workspace peers reported completed Qt changes; their files are released with explicit preservation requirements.
- 2026-08-27: Approved W1's lazy, one-time, non-destructive migration marker after confirming canonical absence cannot distinguish never-configured from explicitly cleared exact-model state.
- 2026-08-27: W1 implemented the canonical dependency, combined storage adapter, shared session entry schemas, migration safety, and focused tests in its seven-file boundary. Parent inspection confirmed the boundary and independently reran 37 focused tests plus syntax and diff checks successfully. The harness marked the run failed only because the pre-existing dirty tree made its auto-required `no-staged-files` evidence impossible; no W1 staging action occurred.

## Review record

Pending two fresh-context, read-only reviewers from distinct provider families after integration. Every finding will be recorded here with run/model, file or symbol, evidence, severity, and one disposition.
