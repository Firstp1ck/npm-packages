# Complex Feature Plan: Pi-managed WebUI Optional Features

**Goal:** Make `@firstpick/pi-package-webui` install only its core runtime dependencies, manage every optional Pi feature as a separately registered Pi package, and provide safe per-feature, per-section, and all-feature installation controls.

**Classification:** Complex. The change crosses npm packaging, Pi package registration, WebUI RPC resource loading, localhost-only backend routes, browser state/UI, migration behavior, documentation, and integration tests. It has two meaningful implementation slices and requires independent review.

**Integration owner:** Parent Pi agent. Only the integration owner updates this plan, accepts worker results, dispositions review findings, runs integrated checks, and archives the plan after verified completion.

**Final report:** [`../../reports/webui-optional-features-pi-install.html`](../../reports/webui-optional-features-pi-install.html)

## 1. Success criteria

1. Installing `npm:@firstpick/pi-package-webui` does not install any `@firstpick/*` optional-feature package.
2. WebUI keeps required runtime dependencies, including `@firstpick/pi-utils`; `node-pty` remains the sole optional dependency because it is a native WebUI runtime enhancement rather than a Pi package.
3. Optional-feature package operations use the selected Pi CLI and exact unpinned source `pi install npm:<package>`; the feature path does not invoke `npm install` directly.
4. A separately configured Pi package loads in native TUI and WebUI RPC tabs after reload without duplicate loading.
5. Existing per-row Install/Update behavior remains, backed by Pi installation and registration status.
6. The panel exposes **Install all** for all missing/unregistered features and **Install missing** in each section. Bulk operations are bounded, confirmed once, sequential, continue after individual failures, and report per-row plus aggregate results.
7. Localhost/trust restrictions, exact package allowlisting, bounded output, timeouts, and copyable fallback commands remain enforced.
8. Focused tests and the full `pi-package-webui` check pass; two implementation handoffs, two fresh read-only reviews, finding dispositions, and the final HTML report are recorded.

## 2. Scope and non-goals

### In scope

- `pi-package-webui/package.json` dependency/resource cleanup.
- A server-owned optional-feature catalog independent of npm dependency declarations.
- Pi settings-aware package status and Pi CLI install/update execution.
- WebUI resource loading from normal configured Pi packages.
- Single and batch install routes and browser controls.
- Migration copy, tests, and README updates.

### Non-goals

- Publishing, version bumping, installing packages on this workstation, or modifying user Pi settings.
- Project-scoped `pi install -l`; WebUI actions use normal user-scoped `pi install`.
- Uninstall/remove controls, automatic installation without confirmation, or parallel package writes.
- New update-all/check-for-updates product surfaces beyond the existing per-row update behavior.
- Changing optional-feature enable/disable semantics after a package is loaded.

## 3. Approved decisions and invariants

| ID | Decision / invariant |
|---|---|
| D1 | `@firstpick/pi-utils`, Pi core, Mermaid, and Typebox remain regular runtime dependencies. `node-pty` remains the only `optionalDependency`. |
| D2 | Remove every optional companion from WebUI's `pi.extensions`, `pi.skills`, `pi.prompts`, and `pi.themes`; retain only WebUI-owned resources. |
| D3 | Keep a server-owned allowlisted catalog `{featureId, packageName, expectedSpec}` so status/update compatibility no longer depends on `optionalDependencies`. Browser presentation metadata remains in `public/app.js`. |
| D4 | WebUI RPC tabs load enabled resources resolved from Pi settings. Optional packages must not be filtered merely because WebUI understands them; only the WebUI package itself is excluded to prevent self-loading duplication. |
| D5 | `installed` and `configured` are distinct. A hoisted/legacy package that is present but absent from Pi settings is installable/registerable, not considered ready after reload. |
| D6 | Single and batch operations invoke the selected Pi executable with `install npm:<package>`. Re-running this command is also the supported update path. |
| D7 | Bulk operations accept only allowlisted feature IDs, deduplicate them, cap them to the catalog size, and execute sequentially to avoid settings/npm-root races. |
| D8 | Global label is **Install all**. Section label is **Install missing**, which precisely describes the section-scoped action. Buttons install only missing or unregistered packages, not updates. |
| D9 | One confirmation covers a batch. Individual failures do not stop remaining installs. One reload prompt appears after the batch finishes. |
| D10 | Existing dirty-tree changes outside assigned paths are preserved. No worker edits this plan or shared package locks. |

Rejected/deferred: retaining companion `optionalDependencies`; direct npm installation from WebUI; automatic install on WebUI startup; parallel Pi installs; version bump/publication; project-local installs.

## 4. Architecture

```text
Optional Features panel
  ├─ per-row Install/Update ─┐
  ├─ Install missing (group) ├─> localhost-only WebUI route
  └─ Install all ────────────┘        │
                                      v
                           allowlisted feature IDs
                                      │
                              sequential queue
                                      │
                       selected Pi CLI resolution
                                      │
                     pi install npm:@firstpick/...
                                      │
                 ~/.pi/agent/settings.json + Pi npm root
                         │                         │
                  native Pi TUI             WebUI RPC tab
                                      (normal Pi resource resolution)
```

The WebUI server owns package identity, command execution, status verification, and batch results. The browser owns grouping, confirmation, progress presentation, and reload prompts. Pi remains the canonical installer and settings writer.

## 5. Execution DAG and workstreams

### Wave 0 — plan and contracts (integration owner)

- Finalize this plan, inspect dirty-tree boundaries, and launch two sequential workers in one shared tree (`concurrency: 1`).

### Wave 1 — two mandatory implementation outcomes

#### WS-A Backend/package worker

**Prerequisite:** this plan approved; no frontend assumptions beyond the route contract below.

**Exclusive write boundary:**
- `pi-package-webui/package.json`
- `pi-package-webui/lib/optional-feature-catalog.mjs` (new)
- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/tests/http-endpoints-harness.test.mjs`
- `plans/handoffs/webui-optional-features-backend.md`

**Deliverables:** remove companion dependencies/resources; add catalog; stop filtering configured optional packages; add configured-aware status; replace npm feature installs with selected-Pi `install`; add sequential batch route accepting `featureIds`; preserve route guards, bounds, output, timeout, and partial-failure results; add backend coverage.

**Required validation:** syntax checks plus focused endpoint harness or the narrowest runnable equivalent, with commands/exit codes in the handoff.

#### WS-B Frontend/docs worker

**Prerequisite:** read this plan and WS-A's route/status contract and actual integrated files. Runs after WS-A because the shared tree is dirty and only one writer may act at a time.

**Exclusive write boundary:**
- `pi-package-webui/public/app.js`
- `pi-package-webui/public/styles.css`
- `pi-package-webui/public/index.html` only if a static toolbar mount is necessary
- `pi-package-webui/README.md`
- `pi-package-webui/tests/mobile-static.test.mjs`
- `plans/handoffs/webui-optional-features-frontend.md`

**Deliverables:** update copy from npm to Pi; add Install all and per-section Install missing controls; select only missing/unregistered features; one confirmation; call batch route; show aggregate and per-row progress/results; one reload prompt; preserve individual actions and accessibility; add static coverage and docs.

**Required validation:** JS syntax plus focused static test, with commands/exit codes in the handoff.

### Wave 2 — central integration (integration owner)

1. Inspect actual diffs and both handoffs for path compliance and interface agreement.
2. Resolve migration/status edge cases and any test drift centrally.
3. Run focused backend/frontend tests, `npm test`, `npm run check`, `npm pack --dry-run --json`, and package-content checks.
4. Confirm tarball has no optional companion packages and no companion `node_modules` resources.

### Wave 3 — independent review quorum

Launch two fresh, read-only reviewers from distinct provider families when available:

- **R1 correctness/security:** command resolution, allowlist, localhost guard, batch bounds/sequencing, settings detection, failure semantics.
- **R2 architecture/UX/tests:** package/resource boundaries, duplicate-load prevention, UI accessibility/state, migration copy, test sufficiency.

Every finding receives one disposition (`accepted`, `rejected`, `deferred`, `needs verification`) with evidence below. Accepted fixes are revalidated.

### Wave 4 — report and completion

Create the self-contained HTML report, link it here, run acceptance testing, and archive this plan to `plans/archive/` only after every completion gate is satisfied.

## 6. Route and state contract

### Status

`GET /api/optional-features` returns each allowlisted feature with at least:

```json
{
  "featureId": "gitFooterStatus",
  "packageName": "@firstpick/pi-extension-git-footer-status",
  "expectedSpec": "^0.4.3",
  "installed": true,
  "configured": true,
  "ready": true,
  "installedVersion": "0.4.5",
  "updateAvailable": false
}
```

`ready` requires Pi registration/configuration; physical presence alone is insufficient.

### Single operation

Existing `POST /api/optional-feature-install` remains compatible with `{featureId}` and uses `pi install npm:<package>` for both install and update actions.

### Batch operation

`POST /api/optional-feature-install-batch` accepts:

```json
{ "featureIds": ["gitFooterStatus", "statsCommand"] }
```

It rejects unknown/non-array/oversized input, deduplicates IDs, runs sequentially, and returns ordered per-feature results plus counts. It does not silently expand an explicit section request to other sections.

## 7. Acceptance checks

- Manifest assertions: only `node-pty` optional; required utils retained; no companion resource paths.
- Fresh-pack assertion: `npm pack --dry-run --json` contains only WebUI-owned package content.
- Server assertions: exact `pi install npm:<package>` command, selected Pi resolution, configured detection, no npm install in feature path, allowlist and localhost enforcement, sequential batch and partial failure.
- Resource assertions: normal Pi-resolved companion resources are included once in WebUI tab args.
- UI assertions: correct labels, disabled/busy states, missing-only selection, one batch confirmation, aggregate result, per-row result, one reload prompt, keyboard/ARIA-friendly buttons.
- Regression: per-row install/update, optional enable/disable, theme initialization, git footer, questionnaire/tool detection, Natural Conversation status.
- Full checks: `npm test`, `npm run check`, and focused browser/static checks where available.

## 8. Rollback and migration

Rollback is a package-version revert: restore prior manifest resource entries, optional dependencies, npm-based installer, and UI. No data migration is destructive. Existing independently configured packages remain valid.

Upgrade behavior: previously hoisted/bundled package files without a Pi settings entry are displayed as needing installation/registration. The Pi install action adopts them into canonical user settings. Users may manually run the exact copyable `pi install npm:<package>` command.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Selected Pi executable differs from WebUI's bundled runtime | Reuse established Pi command resolution and expose exact command/error. |
| Concurrent settings writes corrupt or race | Single server-side sequential batch; no browser-side parallel installs. |
| Controlled-package filter hides separately installed resources | Reduce exclusion to WebUI itself and test resource args. |
| Legacy physical package is mistaken for ready | Separate `installed`, `configured`, and `ready`. |
| Batch partially fails | Continue, return ordered results, show failures, preserve copy commands. |
| Catalog/version drift | One server catalog and static catalog parity assertions. |
| Existing unrelated dirty files are overwritten | Exclusive worker boundaries; parent integration inspection. |

## 10. Progress and evidence record

- 2026-08-04 — Preliminary `complex` classification confirmed by cross-component evidence.
- 2026-08-04 — Architecture inspected: current feature install uses `npm install --prefix`; WebUI tabs disable implicit discovery and rebuild curated resource args; optional companions are currently filtered and re-added through WebUI manifest entries.
- 2026-08-04 — Product decisions resolved: global **Install all**, section **Install missing**, missing/unregistered only, one confirmation, sequential continuation on failure, no automatic install.
- 2026-08-04 — Mandatory implementation-worker gate blocked: `subagent_gate` returned 0/2 qualifying successes and both `worker` slots failed pre-launch. No child started and no implementation files were changed by workers. The installed pi-subagents runtime/agent configuration is unavailable on this system; implementation is paused pending an explicit waiver or an approved alternative.

## 11. Worker handoffs

- Backend: blocked before launch — `plans/handoffs/webui-optional-features-backend.md`
- Frontend: blocked before launch — `plans/handoffs/webui-optional-features-frontend.md`

## 12. Review findings and dispositions

Pending integrated implementation and two qualifying reviewer runs.

## 13. Completion checklist

- [ ] Two qualifying implementation-worker outcomes inspected and accepted.
- [ ] Integrated affected and cross-workstream checks pass.
- [ ] Two qualifying independent reviews completed and every finding dispositioned.
- [ ] Accepted fixes revalidated.
- [ ] HTML report current and mutually linked.
- [ ] Acceptance verdict recorded.
- [ ] Plan moved to `plans/archive/` only after all above items pass.
