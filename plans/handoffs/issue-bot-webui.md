# WS-3 WebUI Issue Bot Handoff

- **Workstream:** WS-3 — WebUI gateway-client integration
- **Status:** implementation complete for the assigned boundary; ready for integration inspection, with full-package validation blocked by the local dependency/test baseline described below
- **Authority:** [`../issue-bot.md`](../issue-bot.md) and [`issue-bot-contracts.md`](./issue-bot-contracts.md)
- **Deployment:** not attempted; browser and gateway defaults remain disabled
- **Shared-worktree state:** uncommitted; no staged files

## Delivered behavior

- Added `public/issue-bot-client.mjs`, a dependency-injected browser adapter. It sends only the v1 structured wizard envelope (`schemaVersion`, fresh UUID-v4 `idempotencyKey`, fresh Turnstile token, and `{categoryId, componentId, templateId, summary, fields}`), with `credentials: "omit"`. It never sends canonical title/body, repository, labels, verdicts, callback URLs, or credentials.
- The adapter validates exact admission/poll response shapes, public status/reason allowlists, opaque submission/capability formats, and confirmed GitHub URLs (`https://github.com/<owner>/<repo>/issues/<same-positive-number>`). Unexpected/invalid responses fail closed to the safe `unavailable` state.
- Status capability retention is an opaque closure-backed refresh handle only. It is never written to browser storage, a cookie, URL, or UI. Polling uses the gateway-provided initial delay, capped exponential backoff (10 seconds maximum), and a two-minute bound; a timeout exposes manual **Refresh status** rather than background polling.
- The wizard now creates the client from the public runtime configuration, disables duplicate/in-flight submission, shows a persistent dialog live region for queued/checking/created/rejected/review/unavailable/unknown states, aborts Turnstile/admission/polling when the dialog closes, and preserves **Copy complete issue** for every failure or terminal state.
- Created issue URLs are set only after client validation and use `target="_blank" rel="noopener noreferrer"`. Sensitive-content results show the configured private reporting URL without displaying submitted prose.
- `index.html` exposes only a disabled-by-default public configuration object. `README.md` documents the exact values, strict HTTPS gateway requirement, exact-origin CORS, Turnstile/CSP needs, state flow, two-minute bound, and launch gates. No account IDs, route values, or secret values were guessed.
- Added the client module to the server static allowlist, PWA shell, cache version, syntax check, and static coverage.

## Public operator configuration

Set this object before `app.js` loads (replace the disabled deployment placeholder or inject it before the default block):

```js
window.__PI_WEBUI_ISSUE_BOT_CONFIG__ = Object.freeze({
  enabled: true,
  gatewayBaseUrl: "https://issue-intake.example.com",
  turnstileSiteKey: "public-turnstile-site-key",
  privateSecurityReportUrl: "https://github.com/OWNER/REPOSITORY/security/advisories/new"
});
```

All four entries are public. The client fails closed unless `enabled === true`, the gateway URL is HTTPS/no credentials/no query/no fragment, and the Turnstile key is syntactically valid. Configure the intake Worker with the exact WebUI `Origin` (not `*`), matching Turnstile hostname/action rules, and its own disabled-by-default admission flag. Do not enable this UI flag until the gateway staging canary, quotas, private-report destination, exact CORS policy, and the separate `ISSUE_BOT_ADMISSION_ENABLED` / `ISSUE_BOT_CREATE_ENABLED` approvals have passed. Browser enablement cannot override either gateway kill switch.

## Files changed by WS-3

- `pi-package-webui/public/issue-bot-client.mjs` (new)
- `pi-package-webui/public/app.js` (narrow Open Issue wizard integration only)
- `pi-package-webui/public/index.html` (public runtime placeholder and wizard result markup)
- `pi-package-webui/public/styles.css` (narrow wizard status styling)
- `pi-package-webui/public/service-worker.js`
- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/package.json`
- `pi-package-webui/tests/issue-bot-client.test.mjs` (new)
- `pi-package-webui/tests/open-issue-wizard-static.test.mjs`
- `pi-package-webui/README.md`
- `plans/handoffs/issue-bot-webui.md`

The worktree already contained unrelated, unstaged terminal-tab edits in `public/app.js` and an unrelated untracked `tests/terminal-tab-workspace-static.test.mjs` before WS-3. They were not edited by this workstream. `services/**`, `issue-wizard-state.mjs`, the parent plan, and reports were not edited.

## Tests and validation evidence

| Command | Result | Evidence |
| --- | --- | --- |
| `cd pi-package-webui && node tests/issue-bot-client.test.mjs` | Passed | Fake injected Turnstile/fetch/UUID coverage proves disabled fail-closed config, exact structured POST envelope, fresh UUID source, in-memory-only capability handle, safe created URL, exact-response rejection, bounded timeout/manual refresh, and abort cancellation. |
| `cd pi-package-webui && node tests/open-issue-wizard-static.test.mjs` | Passed | Covers client separation, safe configuration, structured-state-only transfer, close abort, duplicate guard, live status, private-security link, copy fallback, static allowlist, PWA cache/version, and syntax-check registration. |
| `cd pi-package-webui && node tests/issue-wizard-state.test.mjs` | Passed | Existing canonical state/builder and offline seam remain unchanged and valid. |
| `cd pi-package-webui && node --check public/issue-bot-client.mjs && node --check public/app.js && node --check bin/pi-webui.mjs && git diff --check` | Passed | Changed JavaScript parses and diff has no whitespace errors. |
| Focused issue-bot persistence/credential scan plus `git diff --check` and staged-file check | Passed | No WebUI issue-bot storage/cookie/private credential references or credential-value patterns; no staged files. |
| `cd pi-package-webui && npm test` | Blocked / failed outside WS-3 | 14/71 existing package tests fail because `@earendil-works/pi-coding-agent` and `typebox` are unavailable from this package installation, preventing server harness startup. `mobile-static.test.mjs` also rejects pre-existing `styles.css:7477` `font-size: 0.72rem`; that line is byte-identical to `HEAD`. |
| `cd pi-package-webui && npm run check` | Blocked / failed outside WS-3 | Syntax checks and the focused issue-bot/static tests passed before the same 14 full-suite dependency/baseline failures. |

## Residual risks and integration requirements

1. No real browser/Turnstile/gateway staging run was possible in this bounded local workstream. Before enablement, verify the production Turnstile site key, allowed hostnames/action, CSP, exact CORS origin, and gateway response headers against the deployed WebUI origin.
2. Full package tests cannot currently establish a clean baseline because required package dependencies are not installed/resolvable locally; restore the declared package dependencies and separately resolve the pre-existing mobile typography assertion before relying on a green full suite.
3. The client is intentionally conservative about confirmed GitHub URLs and current public reason codes. Any future public-envelope or GitHub Enterprise contract change requires a versioned contract update and focused tests; do not loosen URL/reason validation ad hoc.
4. The browser has no durable status recovery after a dialog/page close by design. This avoids capability persistence; users can retain the copy fallback and operators can inspect content-free gateway status records.
5. No deployment, resource creation, secret configuration, gateway kill-switch change, or production issue creation occurred.
