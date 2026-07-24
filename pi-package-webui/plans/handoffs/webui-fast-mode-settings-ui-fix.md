# WebUI Fast Mode — Browser Settings UI Completion Fix

## Blocker fixed

The final acceptance artifact identified one approved-contract blocker: `/settings` did not expose the persisted server output-mode default in **Browser workflow**. This handoff records the narrowly scoped remediation only; it changes neither server configuration/API behavior nor Pi `SettingsManager` payloads.

## UI and API contract implemented

- **Placement:** `/settings` now includes an **Output processing** select in **Browser workflow** with `normal` and `compact-v1` options and a `server` badge.
- **Scope and copy:** The control explains that it is the server default for new/auto-negotiated WebUI connections; compact reduces local output-processing and live fidelity, restores rich final output, does not change model inference or token generation, and uses server semantic barriers without restarting Pi.
- **Read path:** Opening `/settings` separately calls `GET /api/webui-output-mode` without tab scoping. The select uses `persistedDefault`; displayed metadata identifies the persisted default, effective mode, source, and a CLI/environment override when applicable.
- **Unavailable API:** If the independent API cannot be loaded, the UI remains normal-default, disables the unpersistable selector, and shows a visible nonfatal diagnostic while ordinary Pi settings remain usable.
- **Write path:** A changed selector makes `PUT /api/webui-output-mode` with exactly `{ outputModeDefault }`, then performs a fresh `GET /api/webui-output-mode` and refreshes the displayed metadata. The normal `/api/settings` apply request and close/refresh behavior remain intact.
- **Isolation:** `collectNativeSettingsPayload()` intentionally does not include output mode; this server setting is never sent through Pi `SettingsManager`.

## Changed files

- `pi-package-webui/public/app.js`
- `pi-package-webui/tests/fast-mode-client-static.test.mjs`
- `pi-package-webui/plans/handoffs/webui-fast-mode-settings-ui-fix.md`

## Regression coverage

`fast-mode-client-static.test.mjs` now statically proves:

1. normal/compact-v1 options and Browser workflow placement;
2. server badge and approved copy;
3. unscoped GET, changed-value PUT body, and post-PUT GET refresh;
4. persisted/effective/source/override metadata display;
5. normal-default plus visible unavailable-API diagnostic;
6. exclusion from `collectNativeSettingsPayload()`; and
7. preservation of the existing native `/api/settings` apply path.

## Commands and results

| Command | Result |
| --- | --- |
| `cd pi-package-webui && node --check public/app.js && node tests/fast-mode-client-static.test.mjs && node tests/streaming-ui-coupling.test.mjs` | PASS — syntax check and focused browser/static regressions passed; browser work ledger remained `516.625` scan ratio with 512 normal vs 103 compact modeled writes. |
| `cd pi-package-webui && node tests/fast-mode-sse-harness.test.mjs && node tests/fast-mode-output-work.test.mjs` | PASS — API/SSE harness passed; deterministic production metric ratio `2.927574`, semantic SHA-256 `74c47d64c4a1b2100af15d0b6e73e4ae96cbaf68f1e0ab49c34eed7c2858d10f`. |
| `cd pi-package-webui && npm run check` | PASS — all 46 test files passed. |
| `git diff --check && test -z "$(git diff --cached --name-only)"` | PASS — whitespace-clean diff and no staged files after the correction handoff was added. |

## Residual risks

- No interactive browser paint/session was performed; UI behavior is covered structurally and by the existing server API/SSE harness rather than an end-to-end browser driver.
- The fallback diagnostic is intentionally conservative: it shows normal and disables writes when the independent output-mode API is unavailable, rather than guessing server state.
