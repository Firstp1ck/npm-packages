# WS-A Backend/Package Handoff: Pi-managed WebUI Optional Features

## Identity and status

- Worker: WS-A backend/package implementation worker
- Status: implemented and focused validation passed
- Canonical plan: `plans/planned/webui-optional-features-pi-install.md` (read-only in this workstream)
- Approved decisions: D1-D10 followed
- Base revision: `1897d26e2caacdec031dd470780bd2beeab3ee45`
- Result revision: `1897d26e2caacdec031dd470780bd2beeab3ee45` (working-tree changes only; no commit created)

## Changed files

1. `pi-package-webui/package.json`
   - Removed all `@firstpick/*` optional companions.
   - Kept core runtime dependencies unchanged, including `@firstpick/pi-utils`.
   - Kept `node-pty` as the sole optional dependency.
   - Removed companion extension/skill/prompt/theme resource paths; retained only WebUI-owned `./index.ts`.
2. `pi-package-webui/lib/optional-feature-catalog.mjs` (new)
   - Added the explicit 19-entry server allowlist with `{ featureId, packageName, expectedSpec }`.
3. `pi-package-webui/bin/pi-webui.mjs`
   - Uses the catalog instead of dependency declarations for package identity and compatibility status.
   - Reports physical `installed`, Pi `configured`, and combined `ready` separately.
   - Resolves configured packages from Pi user/project settings and validates installed manifests by exact package name.
   - Excludes only the WebUI package from normally resolved tab resources, allowing separately configured companion resources to load once.
   - Replaced optional-feature npm-prefix installation with the selected Pi CLI and exact `install npm:<package>` arguments.
   - Preserved the existing single route and its diagnostics.
   - Added a localhost-only sequential batch route with raw-size cap, exact allowlisting, stable deduplication, continuation after failure, ordered per-feature results, aggregate counts, bounded output, timeout, and copyable command diagnostics.
4. `pi-package-webui/tests/http-endpoints-harness.test.mjs`
   - Added a selected-Pi fixture that records exact CLI calls, simulates registration/install roots, and injects a controlled failure.
   - Added focused endpoint mode (`PI_WEBUI_OPTIONAL_FEATURES_FOCUS=1`) covering manifest cleanup, catalog/status semantics, exact Pi invocation, configured-resource single loading, validation bounds, localhost guard, deduplication, sequential execution, and partial-failure continuation/diagnostics.
   - Retained the same assertions in the normal harness path for later integrated runs.
5. `plans/handoffs/webui-optional-features-backend.md`
   - This handoff.

No files outside the assigned write boundary were modified by this worker.

## Route/status contract for WS-B and integration

### `GET /api/optional-features`

Each feature now includes:

- `featureId`
- `packageName`
- `expectedSpec`
- compatibility alias `declaredSpec` (same value, retained for the current frontend)
- `installed`
- `configured`
- `ready` (`installed && configured`)
- `installedVersion`, `installedRoot`, `updateAvailable`, `updateReason`

### `POST /api/optional-feature-install`

Input remains `{ featureId, tab? }`. It runs the selected Pi invocation with exact Pi arguments:

```text
install npm:<allowlisted-package-name>
```

Success returns the prior shape with `data.status` carrying the new status fields. Failures still expose top-level `optionalFeatureInstall` with `kind`, `featureId`, `packageName`, `command`, `exitCode`, `timedOut`, `message`, `hint`, and bounded `outputTail`.

### `POST /api/optional-feature-install-batch`

Input:

```json
{ "featureIds": ["gitFooterStatus", "statsCommand"], "tab": "optional-tab-id" }
```

Success HTTP response:

```json
{
  "ok": true,
  "data": {
    "featureIds": ["gitFooterStatus", "statsCommand"],
    "results": [
      { "ok": true, "featureId": "gitFooterStatus", "data": {} },
      {
        "ok": false,
        "featureId": "statsCommand",
        "packageName": "@firstpick/pi-extension-stats",
        "error": "...",
        "optionalFeatureInstall": {}
      }
    ],
    "total": 2,
    "succeeded": 1,
    "failed": 1
  }
}
```

The server rejects non-arrays, unknown IDs, and raw arrays larger than the 19-entry catalog before running commands. It deduplicates without reordering, runs one Pi command at a time, and returns HTTP 200 with per-item failures so the frontend can render the complete batch outcome. An empty array is a valid no-op batch with zero counts.

## Validation evidence

Commands were run from repository root.

| Command | Exit | Result |
|---|---:|---|
| `node --check pi-package-webui/lib/optional-feature-catalog.mjs && node --check pi-package-webui/bin/pi-webui.mjs && node --check pi-package-webui/tests/http-endpoints-harness.test.mjs` | 0 | All changed JavaScript modules parsed successfully. |
| `PI_WEBUI_OPTIONAL_FEATURES_FOCUS=1 node pi-package-webui/tests/http-endpoints-harness.test.mjs` | 0 | Printed `http-endpoints-harness.test.mjs passed`; focused route/resource/status/batch assertions passed. |
| `node - <<'NODE' ...catalog/manifest assertions... NODE` | 0 | Printed `catalog and manifest assertions passed`; verified 19 unique IDs/packages, WebUI-only manifest resources, sole optional `node-pty`, and required runtime dependencies. |
| `git diff --check -- pi-package-webui/package.json pi-package-webui/lib/optional-feature-catalog.mjs pi-package-webui/bin/pi-webui.mjs pi-package-webui/tests/http-endpoints-harness.test.mjs` | 0 | No whitespace errors. |
| `git diff --cached --name-only` | 0 | No output; no staged files. |

### Earlier validation attempts

Several normal (non-focused) endpoint-harness attempts exited 1 before reaching or completing the new focused assertions. Initial attempts surfaced Windows cleanup locking from the generated selected-Pi wrapper; the harness cleanup was made deterministic. A later normal-path attempt stopped at the existing workflow-policy fixture because Node 24 refuses type stripping for `@firstpick/pi-utils` TypeScript under `node_modules`; another reached the existing Mermaid vendoring assertion and received HTTP 500. These broad-harness/environment failures were not treated as passing and were not masked. The final focused command above passed independently.

## Omissions

- Did not run the full non-focused endpoint harness, `npm test`, `npm run check`, browser tests, or pack checks to completion; those are central integration checks assigned to the integration owner.
- Did not modify package locks, frontend code, README, root package files, the canonical plan, or the localhost route registry outside this workstream boundary.
- Did not install real packages or modify user Pi settings; tests use isolated temporary agent/settings roots.

## Assumptions and deviations

- No deviation from D1-D10.
- Existing declared compatibility ranges were preserved in the catalog. Features previously present in the browser/server catalog but absent from `optionalDependencies` use the current sibling package versions: aur review `^0.1.1`, questionnaire `^0.1.0`, and Natural Conversation `^0.1.4`.
- A matching Pi user or project package source counts as `configured`, including filtered package objects; readiness still requires a validated physical package root.
- Legacy `PI_WEBUI_OPTIONAL_FEATURE_INSTALL_ROOT` discovery/update support remains for existing installations, but optional-feature single/batch installation no longer uses it or invokes npm directly.

## Residual risks

1. Full integrated package checks remain required; the normal endpoint harness currently has unrelated/current-environment failures described above.
2. Catalog/browser parity should be checked after WS-B changes; the backend catalog is now authoritative for identity/specs while browser presentation metadata remains separate by D3.
3. The integration owner should verify the selected installed Pi distribution persists unpinned `npm:<package>` sources in the settings shape recognized by the status parser; focused tests cover string sources and the implementation also handles object sources.
4. The separate localhost route registry does not contain the new batch path because it is outside WS-A's write boundary; the route enforces `requireLocalhost(...)` directly and the focused LAN assertion passes.

## Integration notes

- WS-B should select rows where `!status.installed || !status.configured` (equivalently `!status.ready`) for Install all/Install missing; updates remain per-row.
- WS-B should consume `data.results`, `data.total`, `data.succeeded`, and `data.failed`, and use each failed row's `optionalFeatureInstall.command/hint/outputTail` for diagnostics.
- The integration owner should inspect the dirty tree before accepting; unrelated pre-existing modifications remain in root/README/dev/plan paths and were not touched here.
- No staged files were present at handoff time.
