# Plan: Pi-managed Optional Features for pi-package-webui

Goal: Stop bundling optional features as npm `optionalDependencies`. Install, update, and
verify every optional feature exclusively through the Pi CLI (`pi install npm:...` /
`pi update npm:...`) from the Web UI "Optional features" section, with full per-feature and
bulk actions and clear user feedback. Never invoke npm directly.

## 1. Current-state findings (verified)

- `pi-package-webui/package.json` `optionalDependencies` contains 15 `@firstpick` packages
  plus `node-pty`.
- UI catalog `OPTIONAL_FEATURES` (`public/app.js` ~line 970) contains 17 features.
  **Coverage check result: every `@firstpick` optional dependency is already present in the
  "Optional features" section.** The section additionally lists two packages that are
  already pi-install-only: `@firstpick/pi-extension-aur-review` (`aurReview`) and
  `@firstpick/pi-package-natural-conversation` (`naturalConversation`).
- Not in the section: `node-pty` (native PTY module, not a Pi package — see decision D2)
  and `@firstpick/pi-utils` (regular dependency, explicitly excluded by requirements).
- Server map `OPTIONAL_FEATURE_PACKAGES` (`bin/pi-webui.mjs` ~line 356) mirrors the UI list.
- Current install path (`installOptionalFeaturePackage`) shells out to
  `npm install --prefix <installRoot> <pkg>` — this is what must be removed.
- `package.json` `pi.extensions` / `pi.skills` / `pi.prompts` / `pi.themes` reference
  `node_modules/@firstpick/...` paths of the optional dependencies. After removing the
  optional deps these paths no longer exist and must be dropped from the manifest.
- Update infrastructure already exists and is reusable:
  - `resolvePiCommand()` / `resolvePiUpdateCommands()` (~line 8247/9857) resolve the Pi
    executable (explicit `--pi-bin`, PATH, or bundled fallback).
  - `checkLatestNpmPackageStatus()` queries the npm **registry over HTTPS** (no npm CLI)
    for latest versions — allowed under the "never use npm directly" rule.
  - `resolveInstalledPackageRoot()` already scans `~/.pi/agent/npm/node_modules` (the Pi
    user install root) among its candidate roots.

## 2. Decisions

- **D1 — Single management channel:** All optional-feature installs/updates run
  `pi install npm:@firstpick/PACKAGE_NAME` and `pi update npm:@firstpick/PACKAGE_NAME`
  via the resolved Pi executable. Remove `resolvedNpmCommand` usage from the optional
  feature path entirely (`PI_WEBUI_NPM_BIN` stays only for unrelated legacy flows, or is
  removed if nothing else uses it).
- **D2b — `@firstpick/pi-utils` stays** as a regular `dependency` of the Web UI; it is a
  library requirement, not an optional feature, and is never listed in the panel.
- **D2 — `node-pty` stays** as the only remaining `optionalDependency`. It is a native
  runtime capability of the Web UI terminal, not a Pi package, and cannot be installed via
  `pi install`. It is intentionally not an "Optional feature".
- **D3 — Version checks use the npm registry HTTPS API** (reuse
  `checkLatestNpmPackageStatus`), never the npm CLI.
- **D4 — Installed state** = package resolvable in a known root (priority:
  `~/.pi/agent/npm/node_modules`, project `.pi/npm`, workspace/dev symlinks) **plus**
  capability detection (RPC commands/widgets) stays as the "active in Pi" signal.
  A bundled legacy copy inside the webui `node_modules` is reported as
  `installed (legacy bundle)` with a prompt to install via Pi (see §7 migration).
- **D6 — No special-cased features.** `naturalConversation` behaves like any other
  optional feature for status, install, update, and bulk actions; remove its dedicated
  route gating and package-set exclusions from the feature-management path.
- **D5 — One package operation at a time.** Bulk actions run sequentially through a queue
  to avoid concurrent `npm install` runs inside `~/.pi/agent/npm` (lock contention).

## 3. Workstream A — package manifest (`pi-package-webui/package.json`)

1. Delete all 15 `@firstpick/*` entries from `optionalDependencies`; keep `node-pty`.
   Keep `@firstpick/pi-utils` untouched — it is a regular `dependency` and must remain one.
2. Remove every `node_modules/@firstpick/...` entry from `pi.extensions`, `pi.skills`,
   `pi.prompts`, `pi.themes`. Keep only `./index.ts` (and any first-party paths).
3. Keep the per-feature expected version specs available to the server by moving them into
   a new explicit map (e.g. `lib/optional-features.mjs` exporting
   `OPTIONAL_FEATURES = [{ id, packageName, minVersion, label }]`), since
   `optionalFeatureDeclaredSpec()` currently reads them from `optionalDependencies`.
   This becomes the single source of truth shared by server and (mirrored constant in)
   `public/app.js`.
4. Bump minor version; changelog/README notes (§8).

## 4. Workstream B — server (`bin/pi-webui.mjs`)

Replace the npm-based installer with a Pi-based feature manager:

1. **Command runner:** `runPiPackageCommand(kind, packageName)` →
   `pi install npm:<pkg>` or `pi update npm:<pkg>` using `resolvePiCommand`-style
   resolution (same explicit/PATH/bundled fallback order as `resolvePiUpdateCommands`),
   `timeoutMs: 5 min`, bounded output capture.
2. **Failure classification** (adapt `optionalFeatureInstallFailureKind/Hint`):
   `pi-not-found`, `permission`, `network`, `timeout`, `pi-exit`, `status-check`,
   each with an actionable hint and the exact copyable `pi install npm:...` command.
   Drop npm-specific hints (`PI_WEBUI_NPM_BIN`, install-root env) from this path.
3. **Status:** extend `optionalFeaturePackageStatus()` to return
   `{ featureId, packageName, installed, installedVersion, installedRoot, managedByPi,
   latestVersion, latestCheckedAt, updateAvailable, updateReason }`.
   `latestVersion` comes from a cached registry check (TTL ~10 min, `?force=1` bypass).
   `managedByPi` = resolved root under a Pi install root or listed in
   `~/.pi/agent/settings.json` `packages`.
4. **Endpoints** (all localhost-only, reuse `isLocalRequest` guard). `naturalConversation`
   is treated exactly like every other feature: drop the special
   `ensureNaturalConversationRouteAllowed` gating and the `NATURAL_CONVERSATION_FEATURE_ID`
   exclusion from `WEBUI_CONTROLLED_PACKAGES` in the install/update/status paths.
   - `GET  /api/optional-features` — statuses (registry data from cache).
   - `POST /api/optional-features/check-updates` — force registry refresh for all
     features; returns per-feature `latestVersion`/`updateAvailable`.
   - `POST /api/optional-features/install` `{featureId}`.
   - `POST /api/optional-features/update` `{featureId}` (`pi update npm:<pkg>`; if the
     settings spec is version-pinned, report `pinned` and surface
     `pi install npm:<pkg>@<latest>` as the manual command instead of silently failing).
   - `POST /api/optional-features/install-all` — installs every not-installed feature.
   - `POST /api/optional-features/update-all` — updates every installed feature with
     `updateAvailable`.
   - Bulk endpoints stream/poll progress: respond with an operation id; expose
     `GET /api/optional-features/operations/<id>` returning per-feature
     `queued|running|verifying|done|failed` plus messages (mirrors the existing
     update-task pattern used for Pi self-update).
5. **Post-operation verification:** after each `pi` command, re-run
   `optionalFeaturePackageStatus` and require `installed && installedVersion` (and for
   updates: version advanced or already latest). On mismatch → `status-check` failure.
6. **Cleanup of related constants:** rebuild `WEBUI_CONTROLLED_PACKAGES` /
   `UPDATE_PACKAGE_NAMES` from the new `lib/optional-features.mjs`; verify the
   "Update Pi + Packages & Restart" flow (`pi update --all` / `--extensions`) now also
   covers pi-installed optional features and no longer scans for bundled copies it
   should not touch.

## 5. Workstream C — UI (`public/app.js` + `public/index.html` + styles)

Optional features panel rework:

1. **Per-feature row:** label, description, capability status (loaded/not loaded),
   `installedVersion → latestVersion` badge, and buttons:
   - `Install` (when not installed) → POST install.
   - `Update` (when installed && updateAvailable) → POST update.
   - Disabled state with tooltip while any queue operation is active.
2. **Toolbar buttons:**
   - `Check for updates` → POST check-updates, then re-render badges; show summary
     ("3 updates available" / "everything up to date").
   - `Update all` (enabled when ≥1 `updateAvailable`) → update-all operation.
   - `Install all` (enabled when ≥1 not installed) → install-all operation.
3. **Feedback states** (extend existing `optionalFeatureInstallStates` machinery):
   - queued → `Installing… (12s)` live elapsed timer → `Verifying…` →
     success (`Installed 0.4.4` / `Updated to 0.4.5` + "Reload the Pi tab to load new
     resources" hint) or failure (message + hint + copyable `pi install npm:...` command).
   - Bulk operations show an aggregate progress line (`Installing 3/9: Safety guard…`)
     and per-row states; failures do not abort the rest of the queue, summary lists
     succeeded/failed features.
   - All transitions also logged to the activity/event log (`addEvent`).
4. Replace any UI copy mentioning npm ("run the copied npm command…") with the pi command
   equivalents.

## 6. Workstream D — remove npm usage

1. Delete `installOptionalFeaturePackage`'s npm path, `resolvedNpmCommand` call for
   features, `optionalDependencyInstallRoot`'s npm-prefix semantics (keep the root
   detection only as far as status scanning needs it).
2. Audit remaining `PI_WEBUI_NPM_BIN` / `npm install --prefix` references
   (README ~line 133, update tasks around line 10001) and remove or re-scope them.
3. Grep gate before review: no `npm install`, `npm-cli`, `resolvedNpmCommand` reference
   remains in the optional-feature code path.
4. Remove `naturalConversation` special-casing (`NATURAL_CONVERSATION_FEATURE_ID` filter in
   `WEBUI_CONTROLLED_PACKAGES`, `ensureNaturalConversationRouteAllowed` on the install
   route) so it flows through the same manager as all other features.

## 7. Workstream E — migration & compatibility

1. **Existing installs:** users updating pi-package-webui lose the bundled optional
   packages (no longer optionalDependencies). On startup/status load, if a feature was
   previously active (capability detected or legacy bundle found) but not pi-managed,
   surface a one-time notice in the panel: "Feature X is a legacy bundled copy /
   missing — install via Pi" with the Install button highlighted.
2. Legacy bundled copies still resolve via `resolveInstalledPackageRoot` → report
   `managedByPi: false` and offer `Install` (pi install takes over; Pi's separate module
   roots mean no collision).
3. Document `pi install -l` (project scope) as out of scope for v1; all Web UI actions use
   user scope (default `pi install`).

## 8. Workstream F — docs & tests

1. README: rewrite the Optional features section — installation now exclusively via the
   Web UI panel or manual `pi install npm:@firstpick/<pkg>`; remove
   `PI_WEBUI_NPM_BIN`/install-root guidance from that section; document the new buttons.
2. Tests (`tests/run-all.mjs` suite):
   - unit: pi command construction (`install`/`update`, spec formatting), failure
     classification, status merge (installed/legacy/managed/updateAvailable), pinned-spec
     handling, bulk queue sequencing and partial-failure summary.
   - route: endpoint guards (localhost-only), operation-id polling contract.
   - `npm run check` syntax gate for all touched files.

## 9. Acceptance criteria

- [ ] `optionalDependencies` contains only `node-pty`; `@firstpick/pi-utils` remains in
      `dependencies`; `pi.*` manifest has no `node_modules/@firstpick/...` entries.
- [ ] Every former optional dependency (15 packages) plus `aurReview` and
      `naturalConversation` appears in the Optional features panel with working
      Install/Update buttons.
- [ ] Install/update runs only the Pi CLI; zero npm CLI invocations in the feature path.
- [ ] "Check for updates", "Update all", and "Install all" buttons work and report
      per-feature progress, success, and failure with copyable pi commands.
- [ ] Fresh `pi install npm:@firstpick/pi-package-webui` yields a working Web UI with no
      optional features; installing a feature from the panel makes it active after a Pi
      tab reload, and its status shows the installed version.
- [ ] All tests plus `npm run check` pass.

## 10. Sequencing

1. A (manifest + shared feature catalog module) — everything else depends on it.
2. B (server endpoints + pi runner) — behind existing route guards.
3. C (UI) — consumes B's contract.
4. D (npm removal) + E (migration notices) — after B/C are functional.
5. F (docs/tests) — finalize; run full suite.

Risks: `pi update npm:<pkg>` behavior on pinned specs (handled via D4/§4.4 fallback);
lock contention in `~/.pi/agent/npm` (mitigated by D5 sequential queue); users on old Pi
versions without per-package `pi update` support → detect via `pi update --help` (same
probe pattern as `piUpdateCommandSupportsAll`) and fall back to `pi install npm:<pkg>`.
