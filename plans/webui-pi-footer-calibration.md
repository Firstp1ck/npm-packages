# WebUI PI Footer Calibration

## Objective and success criteria

Make the WebUI `git-footer-status` PI metric a persistent button that starts the stats extension's exact `/calibrate` probe without using the composer, shows an in-flight state, and refreshes the displayed calibrated initial prompt token estimate after the probe finishes.

Success means:

- The PI card is actionable when WebUI PI calibration visibility is enabled, including after an earlier calibration.
- One click dispatches `/calibrate` to the owning tab; duplicate clicks are ignored while it is running.
- The card exposes busy state and the WebUI remains usable while the isolated probe runs.
- Completion triggers an immediate forced `git-footer-refresh`, whose status payload updates the card value.
- Existing footer visibility controls, tab scoping, and old `calibrate-current` payload compatibility remain intact.
- Relevant package tests and syntax checks pass.

## Scope

### In scope

- `pi-extension-git-footer-status`: advertise the PI card's calibration action on every settled estimate, not only an uncalibrated estimate.
- `pi-package-webui`: dispatch `/calibrate`, maintain per-tab busy state, and await a footer refresh after completion.
- Focused regression tests and documentation comments/tooltips.

### Non-goals

- Changing calibration math, persistence, or the stats extension's isolated probe.
- Adding a new server endpoint or changing Pi's RPC protocol.
- Making the native TUI footer clickable.
- Running calibration while the owning tab is already streaming or compacting.

## Approved decisions and assumptions

- The user's click is the explicit request to incur the small probe call, so no second confirmation dialog is shown.
- The button always runs exact `/calibrate`; `/calibrate current` remains available elsewhere but is not the PI card behavior.
- Legacy `calibrate-current` footer payloads remain allowlisted and are treated as requests for the canonical `/calibrate` probe.
- `sendPrompt` with an explicit command is the established tab-scoped RPC path and does not alter composer contents.
- The `/calibrate` handler awaits its isolated probe. Therefore, after `sendPrompt` resolves, a forced `git-footer-refresh` can read the newly persisted calibration sample.

## Architecture and interfaces

1. `git-footer-status` builds a structured PI chip with `action: "calibrate-probe"` whenever `webui-pi-calibration` is visible and the estimate is settled.
2. WebUI normalizes the action through its existing allowlist and renders the metric as a `<button>`.
3. `runGitFooterPiCalibration()` guards the tab, dispatches `/<resolved calibrate command>`, and leaves the card `aria-busy` while the command and refresh are in flight.
4. `requestGitFooterWebuiPayload()` returns its request promise while preserving fire-and-forget compatibility for existing callers.
5. The awaited `/git-footer-refresh --webui-silent` publishes a fresh structured payload; the existing `setStatus` handler caches and rerenders it.

## Work items

1. **Footer action contract** — update PI action/title generation in `pi-extension-git-footer-status/index.ts`.
2. **WebUI interaction** — simplify PI calibration to exact `/calibrate`, await forced refresh, and keep per-tab busy state in `pi-package-webui/public/app.js`.
3. **Regression coverage** — update focused static assertions and add extension contract coverage where practical.
4. **Verification** — run package tests and syntax checks.
5. **Independent review** — obtain two read-only reviews from distinct non-primary provider families; resolve material findings.
6. **Delivery artifacts** — update this plan and save `reports/webui-pi-footer-calibration.html`.

Dependencies and merge order: 1 → 2 → 3 → 4 → 5 → 6. One implementation owner edits the shared worktree; reviewers are read-only.

## Acceptance tests

- Source contract proves the settled PI chip always emits `calibrate-probe` when enabled.
- Source contract proves the PI click path resolves `calibrate`, dispatches only `/${commandName}`, and does not dispatch `current`.
- Source contract proves completion awaits a forced footer refresh with `allowDuringRun: true`.
- The rendered action sets `aria-busy` while its tab is calibrating.
- `node --check pi-package-webui/public/app.js` passes.
- `pi-package-webui` focused/full tests pass.
- `pi-extension-git-footer-status` tests pass.

## Risks

- Pi RPC command completion semantics are relied upon to identify probe completion; existing `/calibrate` implementation awaits `newSession(...sendUserMessage...)`, so this is supported by current code.
- A stale tab/session can invalidate the follow-up refresh; existing request error containment reports a warning and later state events still request footer refreshes.
- Older extension payloads may still advertise `calibrate-current`; compatibility normalization prevents a dead button while enforcing the new exact command.

## Status

- [x] Repository flow traced.
- [x] Interaction and state-update design resolved.
- [x] Implementation complete.
- [x] Focused tests pass; full WebUI suite has two Windows-environment failures unrelated to this diff.
- [ ] Review 1 complete and findings resolved.
- [ ] Review 2 complete and findings resolved.
- [ ] HTML report complete.

## Review findings and dispositions

Pending.

## Verification results

- `node --test pi-extension-git-footer-status/tests/*.test.mjs` — **PASS**, 17/17 tests.
- `node --check pi-package-webui/public/app.js` — **PASS**.
- `node --test pi-package-webui/tests/mobile-static.test.mjs` — **PASS**.
- `git diff --check` — **PASS**.
- `cd pi-package-webui && npm test` — **28/30 test files passed**. Two unrelated Windows host limitations failed:
  - `http-endpoints-harness.test.mjs`: cleanup hit `EBUSY` removing a temporary merge-conflict directory.
  - `staged-content-hash-contract.test.mjs`: Windows denied creation of a test symlink with `EPERM`.

## Report

Final report: [`../reports/webui-pi-footer-calibration.html`](../reports/webui-pi-footer-calibration.html)
