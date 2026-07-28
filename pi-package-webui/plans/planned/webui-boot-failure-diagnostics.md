# WebUI boot-failure diagnostics

Status: in progress  
Classification: lightweight  
Integration owner: primary Pi session

## Classification rationale

The change is one cohesive browser-shell slice: replace the declarative app-module tag with a guarded inline dynamic import, display a static boot-failure panel, probe the backend and startup module graph, and add focused tests. It does not change server APIs, persisted data, authentication, deployment, or cross-package contracts, so the preliminary lightweight classification is retained.

## Goal

When the browser cannot evaluate the WebUI entry module—for example because a statically imported module returns HTTP 404—the HTML shell must remain usable and show a copyable, privacy-bounded troubleshooting report.

## Success criteria

- Missing entry modules, missing transitive static imports, and synchronous module-evaluation errors reject into a visible boot-failure panel.
- A bounded watchdog reports a stalled boot when module evaluation neither resolves nor rejects.
- The report includes sanitized page location, timestamp, browser summary, failure reason, `/api/health` status, and probed startup-asset statuses.
- Query strings, fragments, response bodies, credentials, and full health payloads are not copied into the report.
- The report is selectable and has working Copy report and Reload page controls without depending on `app.js`.
- Successful startup leaves the panel hidden and preserves existing WebUI behavior.
- Focused automated tests reproduce the earlier missing-module class and verify report/copy behavior.

## Decisions and invariants

- Keep the loader and diagnostic UI inline in `public/index.html`; loading a separate diagnostic script would recreate the same single point of failure.
- Load `app.js` with dynamic `import()` so transitive module fetch/evaluation failures are observable as a rejected promise.
- Probe only same-origin relative static imports found in `app.js`; bound probe count and time.
- Never include URL query/hash or API response bodies in copied diagnostics.
- Preserve the existing backend-offline panel for failures detected after the main app evaluates.

## Scope

- `public/index.html`: inline critical styles, failure panel, guarded loader/report builder.
- `public/service-worker.js`: keep the startup module in the offline application shell.
- `tests/boot-failure-diagnostics.test.mjs`: focused success/failure/copy/privacy contracts.
- Existing static and endpoint checks as integration evidence.

## Non-goals

- General runtime exception telemetry after successful module evaluation.
- Sending diagnostics to a remote service.
- Automatic restart, update, or mutation from the failure screen.
- Replacing existing Pi/backend runtime diagnostics.

## Acceptance checks

1. Focused Node test simulating `workflow-status-stack.mjs` HTTP 404.
2. Existing HTTP endpoint harness.
3. Module syntax checks and `git diff --check`.
4. Chrome CDP successful-start smoke test.
5. Chrome CDP forced-missing-module smoke test.

## Risks and rollback

- Risk: false failure on a very slow device. Mitigation: dynamic-import rejection is immediate; the fallback watchdog is conservative and reports a timeout rather than claiming a specific missing file.
- Risk: copied diagnostics expose sensitive URL data. Mitigation: strip query and fragment and include only selected health fields/statuses.
- Rollback: restore the prior module script tag and remove the inline panel/loader and focused test.

## Progress record

- 2026-07-26: Repository inspection completed; lightweight classification retained.
- 2026-07-26: Design selected: inline guarded dynamic import with bounded same-origin diagnostics.
- 2026-07-26: Production report successfully identified `subagent-gate-visibility.mjs` as the sole HTTP 404 despite Chrome naming `app.js` in the import error.
- 2026-07-26: Report enhanced with an immediate diagnosis, likely cause, isolated failing checks, browser transitive-import note, exact asset curl command, and visible diagnosed summary.

## Report

Final implementation report: [../reports/webui-boot-failure-diagnostics.html](../reports/webui-boot-failure-diagnostics.html)
