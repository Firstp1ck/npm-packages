# WS-A handoff — WebUI optional-feature migration backend

## Identity and status

- Workstream: **WS-A — backend/startup/migration engine**
- Run role: sole WS-A implementation worker
- Status: **implementation complete; ready for integration-owner inspection and WS-B consumption**
- Feature classification: **complex**, confirmed because the change crosses startup ordering, persistent migration state, RPC resource resolution, mutation security/concurrency, update continuity, HTTP/SSE contracts, and failure recovery.
- Base Git revision: `9c3cf721385c8548f02b097c10b6f383f8112578`
- No commit was created.
- No files are staged.

## Prerequisite notes

- The canonical plan was read in full and D1–D18 were treated as binding.
- The feature-development workflow and complex-feature contract were loaded successfully from `~/.pi/agent/skills/feature-development-workflow/` before implementation.
- Requested `/home/firstpick/npm-packages/context.md` and `/home/firstpick/npm-packages/plan.md` were absent (`ENOENT`). The canonical plan contained the actionable approved context, so implementation proceeded against it.
- `plans/planned/webui-optional-feature-startup-audit-and-migration.md` was already modified in the inherited working tree. WS-A did not edit it because it is outside this worker's write boundary.

## Changed files

- `pi-package-webui/lib/optional-feature-migration.mjs` (new)
  - schema-v1 atomic/private store for `lastSuccessfulAudit`, `pendingUpgrade`, and persisted dismissal;
  - immutable revisioned audit snapshots, 10-second whole-audit deadline, sanitized degraded state;
  - fresh/upgrade/unknown classification and registered/local/legacy/missing/update/conflict/disabled/unknown feature classification;
  - stale-revision guard, one in-flight audit, one server mutation lock, reconnect-safe progress snapshot, and dynamic RPC exclusion set.
- `pi-package-webui/bin/pi-webui.mjs`
  - composes the existing status/install machinery rather than replacing it;
  - binds HTTP before the audit, exposes startup diagnostics, and delays initial RPC creation until the bounded audit completes;
  - excludes every catalog-owned optional package in checking/degraded mode and only conflicting top-level ownership in conflict mode while retaining the registered package as canonical;
  - extends the existing optional-feature GET/batch routes and adds localhost-only recheck/dismiss routes;
  - revision-guards batch mutation, serializes all optional installs with one lock, publishes progress, re-audits after mutation, preserves partial results, and auto-restarts an idle affected tab after a fully successful batch;
  - writes pending-upgrade evidence before WebUI component updates and `pi update --all`;
  - adds `--migrate-optional-features` and `--migration-dry-run` explicit CLI flags.
- `pi-package-webui/tests/optional-feature-migration.test.mjs` (new)
  - covers classification, prior inventory, private/atomic normalized persistence, sanitized immutable snapshots, revision conflicts, dismissal, mutation exclusion, timeout fallback, malformed state fallback, and mutation locking.
- `pi-package-webui/tests/http-endpoints-harness.test.mjs`
  - adds cached audit/recheck expectations, path-sanitization checks, stale revision rejection, conflict-safe RPC args, sequential partial failure/progress recovery, remote mutation rejection, and successful idle-tab auto-restart coverage.
- `plans/handoffs/webui-optional-feature-migration-backend.md` (new)
  - this handoff.

## Implementation behavior

### Startup and fallback

1. HTTP listens first.
2. `GET /api/optional-features` immediately returns the server-owned cached snapshot (`phase: "checking"` initially).
3. `/api/health` returns `503`, `ok: false`, and `startupPhase` until the audit and initial RPC startup finish; tab creation is also rejected with `503` during this window.
4. The whole audit (status collection plus private-state read/write) has a 10,000 ms deadline.
5. Success creates a revisioned snapshot and then starts/restores RPC tabs.
6. Timeout/error produces `phase: "degraded"`; new RPC args exclude all catalog-owned optional package resources and retain core only.
7. A conflict excludes the non-package/top-level copy from new RPC args while retaining the registered package copy. No settings mutation occurs.

### Persistence

Default private file:

```text
${PI_CODING_AGENT_DIR:-~/.pi/agent}/webui/optional-feature-migration.json
```

Test/controlled override: `PI_WEBUI_OPTIONAL_FEATURE_MIGRATION_FILE`.

- Parent directory is created with mode `0700` when new.
- Writes use an exclusive temporary file, mode `0600`, atomic rename, and final `0600` chmod.
- Only normalized schema-v1 inventory, pending-upgrade, and dismissal fields survive writes.
- Installer output, credentials, auth material, and unrestricted paths are never persisted.

## Browser-facing API contract for WS-B

All successful responses retain the existing `{ "ok": true, "data": ... }` envelope.

### `GET /api/optional-features`

Cached/read-only; it does not scan or mutate. `data` is:

```js
{
  phase,          // "checking" | "ready" | "action-required" | "migrating" | "partial" | "complete" | "degraded"
  revision,       // "pending" while initial checking, otherwise "sha256:<64 lowercase hex>"
  installKind,    // "fresh" | "upgrade" | "unknown"
  summary: {
    ready,
    migratable,
    missing,
    conflicts,
    disabled,
    unknown
  },
  features: [{
    featureId,
    packageName,
    expectedSpec,
    declaredSpec,
    installed,
    configured,
    locallyConfigured,
    resourceConflict,
    ready,
    installedVersion,
    legacyEvidence,
    disabled,
    updateAvailable,
    updateReason,
    state,                // "registered" | "local-resource" | "legacy-migratable" | "missing" |
                          // "update-available" | "conflict" | "disabled" | "unknown"
    sourceKind,           // "pi-package" | "top-level-resource" | "legacy-webui-bundled" | "none"
    previouslyAvailable,
    previouslyEnabled,
    selectedByDefault
  }],
  progress: null | {
    phase,
    migration,
    startedAt?,
    completedAt?,
    elapsedMs?,
    currentFeatureId,
    currentPackageName,
    index,
    total,
    completed,
    remaining,
    succeeded?,
    failed?,
    autoRestarted?,
    restartDeferred?,
    reason?,
    results: [{ featureId, packageName, ok, kind, message }]
  },
  completedAt,
  diagnostic,     // null, or sanitized { kind, message } in degraded mode
  reason
}
```

Host-only fields such as `installedRoot`, `topLevelResources`, configured package paths, and legacy paths are intentionally absent. Progress snapshots intentionally contain categorized/sanitized result summaries, not raw installer output. Localhost mutation responses retain the existing bounded installer details.

### `POST /api/optional-feature-install-batch`

Localhost-only. Required body:

```js
{
  tab?,
  featureIds: ["allowlistedFeatureId", ...],
  revision: "sha256:<current GET revision>",
  migration: true | false // optional; true for the one-confirmation migration flow
}
```

- A missing/stale revision returns `409`; WS-B must refetch the GET snapshot before showing/applying again.
- A concurrent optional mutation returns `409` busy.
- Selection remains allowlisted, bounded, deduplicated, ordered, and sequential.
- Per-feature failure does not stop later features.
- Response `data` retains `{ featureIds, results, total, succeeded, failed }` and adds:

```js
restart: {
  autoRestarted: boolean,
  restartDeferred: boolean,
  reason?: "tab-busy" | "restart-failed"
}
```

- A fully successful non-empty batch auto-restarts the affected tab when idle. Busy/prompting/queued tabs are not interrupted and return `restartDeferred: true`.
- **Integration requirement:** the current pre-WS-B `public/app.js` batch call does not send `revision`; WS-B must include the cached revision before the combined install/migration UI can apply batches.

### Existing `POST /api/optional-feature-install`

- Remains localhost-only and uses `installOptionalFeaturePackage`.
- Now participates in the same server mutation lock and triggers a post-install audit.
- It does not require a browser-supplied revision; the batch route is the revision-bound migration apply path.

### `POST /api/optional-feature-migration/recheck`

Localhost-only. Body `{}`. Runs one bounded read-only audit (or joins the current one) and returns the complete new snapshot in `data`.

### `POST /api/optional-feature-migration/dismiss`

Localhost-only. Body:

```js
{ revision: "sha256:<current revision>" }
```

Persists the current legacy-migratable feature set as dismissed, clears its default selections, and returns the updated snapshot. Stale revision returns `409`. A conflict remains `action-required`; otherwise phase becomes `ready` while the feature rows remain available for a later manual Migrate action.

### Health/startup contract

During audit/startup:

```js
GET /api/health -> HTTP 503
{ ok: false, startupPhase: "checking" | "degraded" | ... }
```

After initial RPC setup: existing health response semantics resume with HTTP 200 and `ok: true`.

### SSE/event contract

Existing `/api/events` clients receive server events after a tab/SSE client exists. Reconnect truth always comes from the GET snapshot.

Audit/migration event:

```js
{
  type: "webui_optional_feature_migration",
  event: "checking" | "audit-complete" | "degraded" | "progress" | "dismissed",
  snapshot: /* exact sanitized GET data snapshot */
}
```

Tab restart events:

```js
{
  type: "webui_optional_feature_restart_completed" | "webui_optional_feature_restart_deferred",
  tabId,
  tabTitle,
  autoRestarted,
  restartDeferred,
  reason?
}
```

The existing `webui_tab_reloading` / `webui_tab_reloaded` events are also emitted by an automatic restart.

## CLI contract

- `--migration-dry-run`: runs the bounded startup audit, prints the sanitized snapshot as JSON, performs no package/settings mutation, and continues normal startup.
- `--migrate-optional-features`: after the startup audit, installs every `legacy-migratable` feature sequentially through the same existing install function and mutation lock, then starts RPC.
- If both flags are supplied, dry-run wins and no optional package mutation occurs.
- No environment-only implicit migration enablement was added.

## Commands and exit codes

Final validation on the delivered tree:

| Command | Exit |
|---|---:|
| `cd pi-package-webui && node --check bin/pi-webui.mjs` | 0 |
| `cd pi-package-webui && node --check lib/optional-feature-migration.mjs` | 0 |
| `cd pi-package-webui && node tests/optional-feature-migration.test.mjs` | 0 |
| `cd pi-package-webui && PI_WEBUI_OPTIONAL_FEATURES_FOCUS=1 node tests/http-endpoints-harness.test.mjs` | 0 |
| `cd pi-package-webui && node tests/http-endpoints-harness.test.mjs` | 0 |
| `cd pi-package-webui && npm run check` | 0 (`all 108 test files passed`) |
| `cd pi-package-webui && node bin/pi-webui.mjs --help \| grep -E -- '--migrate-optional-features\|--migration-dry-run'` | 0 |
| `cd /home/firstpick/npm-packages && git diff --check` | 0 |
| `cd /home/firstpick/npm-packages && git diff --cached --name-only` | 0, empty output |

Intermediate development failures were resolved before final validation: one initial syntax-check command used the wrong working directory (exit 1); focused harness iterations exposed stale cached-audit/path assumptions and an async restart-log assertion (exit 1); the first `npm run check` had a transient random-port collision plus static expectations tied to the old startup/batch source shape (exit 1). The final repeated commands above pass.

## Deviations, assumptions, unresolved decisions, and residual risks

1. **Missing requested context files:** `context.md` and `plan.md` were absent. No replacement files were invented; the approved canonical plan was used.
2. **Detached supervisor edge:** an already-running detached RPC supervisor may own tabs created by a prior server process. The audit safely filters every newly created/replaced tab, but it does not forcibly restart an already-running managed tab because doing so could interrupt work and conflict with D17. Integration owner should decide whether a later, idle-gated reconciliation of inherited managed tabs is required.
3. **Browser-origin disabled state:** backend classification preserves disabled evidence when it exists in package status or prior inventory. The current browser-only localStorage disabled set is not server-readable. WS-B should keep such features unselected and disabled in presentation; adding a new browser-to-server persistence field would be an interface decision and was not invented in WS-A.
4. **Dry-run integration coverage:** CLI parsing/help is checked and the no-mutation branch is direct, but no separate process-level dry-run fixture was added. Module, HTTP, and full-suite coverage pass.
5. **Progress output privacy:** remote/cached snapshots omit raw installer output to satisfy D13. Existing localhost batch responses still contain bounded output tails/copyable commands. If WS-B requires live output text in the shared snapshot, it must use a separately approved sanitizer/localhost-only channel rather than exposing raw output remotely.
6. **Frontend integration gap is expected:** until WS-B sends `revision`, existing browser batch installs receive `409`. GET/single-install compatibility remains, and the full current test suite passes.
7. No real `~/.pi/agent` state was touched by tests; all migration and HTTP fixtures used temporary agent roots.

## Recommended integration sequence

1. WS-B reads this API/event contract and adds cached revision handling before any batch apply.
2. WS-B consumes `phase`, `summary`, feature `state`, `selectedByDefault`, `progress`, and restart fields without scanning the host.
3. Integration owner reviews the detached-supervisor residual above before calling D5/D16 fully closed for inherited running tabs.
4. Re-run focused migration tests, HTTP harness, full `npm run check`, and the plan's pack-content checks after WS-B integration.
