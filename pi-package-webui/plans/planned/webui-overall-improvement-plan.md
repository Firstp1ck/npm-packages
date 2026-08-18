# WebUI overall improvement plan — security, reliability, usability, performance, maintainability

Status: planned — evidence gathered and verified, implementation not started  
Scope: whole `pi-package-webui` surface — browser app, HTTP/SSE server, Pi RPC integration, PWA, tests, developer workflow, documentation  
Target package: `pi-package-webui` v0.9.5 (working tree at `8aadea0`, clean)  
Created: 2026-08-18  
Supersedes/absorbs: open items of `WEBUI-EXPERIENCE-RECOMMENDATIONS.md`, `WEBUI-UX-IMPROVEMENTS.md`, `plans/planned/webui-user-noticeable-improvements.md`, and the not-yet-started stages of `plans/planned/webui-performance-smoothness.md` (see "Reconciliation")

## Goal

Move the WebUI from "feature-rich but hand-maintained" to "safe by default, hard to break, and pleasant on first contact":

1. close the two realistic paths to full compromise or total service loss (cross-site requests to a fixed local port; unhandled process-level errors);
2. make the release gate trustworthy (browser suite green and required, revision churn eliminated, CI);
3. fix the first-run and everyday-use defects a live probe still finds after today's UX pass;
4. reduce boot/network cost and memory growth without a framework migration;
5. start the maintainability program (server route table, frontend seams, storage wrapper) so future features cost less.

## How this plan was produced

1. **Baseline runs (this machine, 2026-08-18):** `npm run check` → all 183 static/harness files pass in 92 s. `npx playwright test` → **17 failed, 10 did not run, 86 passed** in 2.6 min (see REL-3).
2. **Four independent read-only audits** (server reliability/security; frontend architecture/performance/PWA; tests/DX/docs; live browser probe with axe at 1440/1024/820/390 px against `bin/pi-webui.mjs` + real Pi 0.84.2). Every finding below was checked against current line numbers; the highest-impact ones (SEC-1, SEC-2, REL-1, REL-2, UX-2, PERF-2, ARCH-1) were re-verified by hand.
3. **Cross-check** against the four existing plan documents so already-shipped work is not re-listed and stale statuses are corrected.

## Measured baseline

| Metric | Value | Source |
|---|---|---|
| Source size | `app.js` 50,093 lines · `styles.css` 19,267 · `index.html` 2,194 · `bin/pi-webui.mjs` 17,411 | `wc -l` |
| Static/harness suite | 183 files, all pass, 92 s wall clock, serial | `npm run check` |
| Browser suite | 113 tests / 24 specs; **17 failed, 10 did not run** | `npx playwright test` |
| Boot (fresh profile, localhost, 1440×900) | 56 resources, ~650 KB transferred (scripts 489 KB, CSS 77 KB, 34 API fetches 85 KB); 7 duplicate boot GET pairs; DOM 2,524 nodes, 28 `<dialog>`; TTI proxy 70–143 ms; 4 long tasks (264 ms total) at 1440 px | probe |
| Static asset caching | `cache-control: no-cache` on every asset (`bin/pi-webui.mjs:8945`) → ~22 revalidation round-trips per load | audit |
| Revision protocol | 3 hand-bumped counters (`pi-webui-pwa-v123`, `styles.css?v=132`, `app.js?v=157`); 20 test files pin the SW cache literal, 1 pins the `?v=` values; 66 SW-cache bumps in 367 commits since June | `git log`, grep |
| Console on fresh tab | 1× HTTP 403 (`/api/intercom/conversations`) → two toasts over the composer | probe |
| axe (home view) | 1 critical (`#tabBar` `role=tablist` without tabs); `/model` and `/settings` open: 2 critical + 1–2 serious | probe |
| Global error handling | server: no `unhandledRejection`/`uncaughtException` handler; client: `window.error`/`unhandledrejection` listeners removed at `markBootReady()` (`index.html:2133-2134`), none re-installed by `app.js` | grep |
| Cross-site request defence | 3 route helpers check `sec-fetch-site`/content-type (`bin/pi-webui.mjs:2587,2596,8706`); generic POST dispatch (`:17244`) parses any body as JSON; no `Origin`/`Host` validation; default port fixed at 31415 (`:187`) | audit, verified |

## Reconciliation with existing plans

| Existing item | Actual status (verified 2026-08-18) | Disposition here |
|---|---|---|
| EXP P0-01 typography floor | Done (re-done today as UN P1-16) | closed |
| EXP P0-02 service-worker closure/cache lifetime/revisions | Cache writes now inside `waitUntil`, bounded network-first fetch, closure currently complete — but **no closure contract test**, 3 manual counters, mermaid outside the closure | ARCH-1, PERF-3, REL-8 |
| EXP P1-01 Playwright/axe harness | **Done** (24 specs, `@axe-core/playwright` present) — doc still says `TODO`, which falsely blocks ~10 dependent items | DOCS-1 |
| EXP P1-02 live-region consolidation | Partly (UN P2-6); 67 `aria-live` regions remain in `index.html` | A11Y-2 |
| EXP P1-03/04/05 tab semantics, dialogs, forced-colors | Mostly done today (UN P2-8); remaining native calls and axe criticals | A11Y-1, A11Y-3 |
| EXP P1-06 SSE slow-client bounds | **Done in code** (`bin/pi-webui.mjs:1378-1473`, `tests/sse-backpressure-harness.test.mjs`); doc says `TODO` | DOCS-1 |
| EXP P1-07 request timeouts / safe retry | Open on both sides | REL-4, REL-5 |
| EXP P2-01/02 transcript memory budget | Open; plus a newly found unbounded per-tab Set | PERF-5 |
| EXP P2-03/04 IA + palette | Mostly done today (UN P2-9, P2-12) | closed except Settings navigation (UX-9) |
| EXP P2-05 folder picker | Copy done; breadcrumbs open | UX-10 |
| EXP P2-06 modularization | Not started; seams now measured | ARCH-3 |
| EXP P2-07 skip link / heading | Open | A11Y-3 |
| UX-IMPROVEMENTS Tier 1–4 | Implemented; its evidence table is stale in 5 of 10 rows | DOCS-1 |
| UN (today) P1-7, P2-4, P2-10, P2-20, P3-3/4/6/7/10/11 | Open as listed there | UX-8, UX-9, UX-10, PERF-6, REL-4 |
| UN P1-1 hover/focus menus | Escape fixed; **reopens on focus return and can fire actions** | UX-1 |
| UN P1-4 failure cards | Retry/Change model work; identical cards still not collapsed | UX-6 |
| PERF-SMOOTHNESS F1–F18 | Stage 0–3 not started; F18 partly moot (CSS is cleaner than assumed) | referenced from PERF-4/PERF-5; not duplicated |
| OUTPUT-STREAMING Phases 0–2 | Landed | none |

## Priority list

Types: **security** · **reliability** · **usability** · **performance** · **accessibility** · **architecture** · **test/DX** · **docs**. Effort: S ≤ ½ day, M 1–3 days, L > 3 days. "New" = not tracked in any existing plan.

### P0 — fix before the next release

| ID | Item | Type | Effort | New |
|---|---|---|---|---|
| SEC-1 | Central cross-site request guard: no `Origin`/`Host`/content-type check on ~130 mutating routes; `/api/bash`, `/api/prompt`, `/api/files/*`, git discard/undo are reachable by a drive-by page at the fixed default port 31415 (no tab id → first tab) | security | S–M | yes |
| SEC-2 | Remote PIN is 4 digits with no attempt limit, no lockout, 7-day token; a guessed PIN reaches `/api/bash` (not localhost-gated) | security | S | yes |
| REL-1 | No `unhandledRejection`/`uncaughtException` handler in the server; 36 fire-and-forget sites → one miss kills every tab | reliability | S | yes |
| REL-2 | `PiRpcProcess` stdout/stderr/stdin have no `error` listeners; `writeRaw` awaits `drain` with no timeout (`/api/extension-ui-response` can hang forever) | reliability | S | yes |
| REL-3 | Browser suite is red (17 failed / 10 not run) and is not part of `npm run check` or any CI; today's UX pass changed behaviour the specs still assert (multi-open sections, control-row count, sidebar action count, `#fileViewerPane` on tablet, stream-isolation forbidden mutations, session-summary disabled state…) | test/DX | M | yes |
| UX-1 | Focus-opened composer menus (Publish/Native/Options/App runner) reopen over the prompt when focus returns from a dialog/palette; the probe clicked the prompt centre and hit **AUR Release**; ~20 hidden menu items are in the Tab order | usability / safety | M | partly (UN P1-1) |
| UX-2 | Every fresh tab shows two toasts "sessionPath must stay inside the Pi session directory" (403 from `/api/intercom/conversations`) when `~/.pi` is a symlink: `canonicalSessionPath` realpaths the dir but falls back to the unresolved path for the not-yet-created session file (`lib/session-actions.mjs:15-35`) | reliability / first-run | S | yes |

### P1 — clearly felt or structurally important

| ID | Item | Type | Effort | New |
|---|---|---|---|---|
| REL-4 | No request-class timeouts on either side: `api()` (`app.js:8654`) has no deadline; server sets no `headersTimeout`/`requestTimeout`; prompt requests hold sockets up to 2 h (`bin/pi-webui.mjs:192`) | reliability | M–L | tracked (EXP P1-07) |
| REL-5 | Client has no post-boot global error surface: `index.html:2133` removes the boot handlers, `app.js` installs none → sync render exceptions are silent | reliability | S | yes |
| REL-6 | Unbounded `tabs.size` on the direct RPC path and unbounded `sseClients` per tab (`bin/pi-webui.mjs:11059,11067`); combined with SEC-1 = fork bomb | reliability | S | yes |
| REL-7 | No auto-restart after a Pi child crash; direct-path `stop()` uses `child.kill()` on a non-detached child (orphans tool subprocesses) while the supervisor path uses `terminateProcessTree` | reliability | M | yes |
| REL-8 | SSE frames carry no `id:`/`retry:`; reconnect never reads `Last-Event-ID`; deltas during a gap are lost silently (supervisor already has a sequence/replay ring to copy) | reliability | M | yes |
| ARCH-1 | Replace the 3 hand-bumped revision counters with server-side content hashes (`etag = sha1(raw)` already exists at `bin/pi-webui.mjs:8909`) injected into `index.html`/`service-worker.js`; replace ~23 exact-string test assertions with one coherence test; add an import-closure contract test | architecture / test | M | partly (EXP P0-02) |
| PERF-1 | Serve hashed assets with `immutable` caching (after ARCH-1); keep `no-cache` only for `/` and the SW | performance | S | yes |
| PERF-2 | Boot: 552 `querySelector` calls at module evaluation + ~62 top-level init calls, no critical/deferred split; 28 dialogs parsed eagerly with zero `<template>` | performance | M | partly (PERF-SMOOTH F1) |
| UX-3 | Toast stack overlays the composer at every width (640×188 px over `#promptInput` at 1440; entire composer on phones) | usability | S | yes |
| UX-4 | Desktop default layout: Control Deck 52 % of a 1440 px viewport; Send wraps alone onto a second row even at 1440×900 | usability | S | partly (UN P2-20) |
| UX-5 | `/model` lists all 378 models although Pi has 22 scoped (`enabledModels`); no "Scoped" group/default filter | usability | S–M | yes |
| UX-6 | Mobile: opening a file leaves `#fileViewerPane` behind the deck overlay (nothing appears to happen); "More" sheet is icon-only; identical failure cards still not collapsed; Shift+Tab trapped in the composer; tab order starts at `#attachButton` and visits the deck before the tab bar | usability / a11y | S each | partly |
| TEST-1 | Add CI (GitHub Actions): `npm run check` per changed package + browser suite; add `test:all`; per-file timeout and `--filter` in `tests/run-all.mjs`; shared Playwright server fixture (24 copies of a 55-line `beforeAll` today) | test/DX | M | yes |
| TEST-2 | Rebalance the suite away from regex-on-source: 120 of 183 files read source text; 89 read `app.js`; several assert element counts or declaration order. Policy: new behaviour gets a harness/browser test; static tests only for contracts (closure, revision, docs layers) | test/DX | L (incremental) | yes |
| A11Y-1 | axe criticals: `#tabBar role=tablist` without tabs on empty state; `#fileTreeRoot role=tree` without items when collapsed; `#nativeSelectorList` unnamed; `#noticeToastStack` `aria-label` on a role-less div | accessibility | S | yes |
| DOCS-1 | Correct stale statuses (EXP P1-01, P1-06 done; UX-IMPROVEMENTS evidence table wrong in 5/10 rows), then archive `WEBUI-UX-IMPROVEMENTS.md` and fold EXP's open rows into this plan; move troubleshooting/settings locations from `DEVELOPMENT.md` to `TECHNICAL.md`; document `node-pty` and "Pi not installed" behaviour for users | docs | S–M | yes |

### P2 — worthwhile, schedule after P1

| ID | Item | Type | Effort | New |
|---|---|---|---|---|
| ARCH-2 | Server route table (`Map<"METHOD /path", {guard, handler}>`) replacing the 210-line `if`-chain and per-request rebuilt `GIT_*_ROUTES` objects; makes SEC-1/localhost guards declarative; then extract git (~1.1k lines), app-runner (~1.4k), files/workspace (~0.9k) modules | architecture | L | yes |
| ARCH-3 | Frontend extraction, one seam per change, best-first by measured coupling: Stats overlay (`app.js:29740-31000`, 8 element handles, no I/O), Chat search (`:49204-49500`), File viewer, Command palette, File tree, Theme customizer, Optional features; defer Subagents (44 tab-state touchpoints) | architecture | M each | tracked (EXP P2-06) |
| ARCH-4 | Tab-scoped store registry: teardown at `app.js:15469-15499` deletes 30 Maps by hand and omits at least 7 (`actionEntrySeenKeysByTab`, `promptHistoryByTab`, `lastUserPromptByTab`, …) | architecture / memory | S | yes |
| ARCH-5 | `storage` wrapper for the ~45 `localStorage` keys / 105 call sites: schema+version+fallback, quota-failure surfacing; cap or move custom background data URLs (unbounded per-theme dict, `app.js:9873-9881`) | architecture / reliability | M | yes |
| ARCH-6 | Structured server logging (`level, event, fields` NDJSON to stderr + optional rotating file under the agent dir, `PI_WEBUI_LOG_LEVEL`), request log line, correlation ids | reliability / DX | M | yes |
| PERF-3 | Mermaid (`/vendor/mermaid/…`) is outside the SW closure → diagrams fail offline; add a runtime cache rule or an explicit online-only placeholder | performance / PWA | S | yes |
| PERF-4 | SW update UX: listen for `updatefound`/`controllerchange`, surface the existing `updateNotification` panel, drop unconditional `skipWaiting` | reliability / PWA | S | yes |
| PERF-5 | `actionEntrySeenKeysByTab` grows forever (240-char keys per rendered action, never pruned); then execute EXP P2-01 profiling → optional inactive-tab transcript budget | performance / memory | S + M | partly |
| PERF-6 | Duplicate boot GET pairs still present (optional-features, themes, tabs, state, messages, intercom, tools); upload progress/cancel for large attachments (UN P2-4); `content-visibility`/`contain` on transcript bubbles after profiling (UN P2-7) | performance | S–M | partly |
| SEC-3 | Hardening headers: CSP with hashes for the 2 inline scripts / 1 inline style (or nonces via ARCH-1's template pass), `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors` | security | M | yes |
| SEC-4 | Threat-model housekeeping: `/api/app-runner-config` and `/api/bash` are not localhost-gated (three RCE paths for a PIN-authenticated remote client — decide and document); recovery endpoint accepts arbitrary `cwd`; `writePathFastPicks` bypasses the settings lock/fsync discipline | security | S | yes |
| A11Y-2 | Consolidate 67 `aria-live` regions (+22 in `app.js`) into one polite + one assertive queued announcer; respect `prefers-reduced-motion` in the 53 rAF-driven motions (0 references in `app.js`) | accessibility | M | partly (EXP P1-02) |
| A11Y-3 | Skip link + one top-level heading; focus return to `<body>` after `/settings` Escape and dirty-guard Cancel; 29×29 px message buttons on mobile; faint 15 %-alpha focus ring | accessibility | S | partly (EXP P2-07) |
| UX-7 | Copy/jargon pass: `/reload` interpolates the tab title into sentences (3 cards for one command); footer chips "PI 23k tok", "GIT+ 🕒 1m", "CONTEXT 0.0%/1.0M (auto)"; Settings "Transport: sse / websocket", "HTTP idle timeout", empty "Remote access" card; onboarding "tab constellation"; mobile hides the model chip behind "Details" | usability / copy | S–M | partly (UN P2-10) |
| UX-8 | Commit/push without the optional git-pr package (UN P1-7): let the guided workflow run with the manual "Commit input" path when no generation model is available | usability | M | tracked |
| UX-9 | Settings dialog section navigation (UN P3-6); tooltip clipped at the left viewport edge on the running-state composer; "Open Issue" pill covering deck content on mobile | usability | S–M | partly |
| UX-10 | Folder-picker breadcrumbs/back history (EXP P2-05); viewer/diff syntax highlighting + line numbers (UN P3-4) — the tokenizer already ships | usability | M | tracked |
| TEST-3 | `node --check` chain misses 4 `public/*.mjs` (incl. the new `stream-*` modules) and 28 of 41 `lib/*.mjs` → glob loop; drop `tests/` (3.1 MB) from `package.json.files`; add `jsconfig.json` (`checkJs` for `lib/`) and Prettier for `public/` | test/DX | S | yes |
| DOCS-2 | README: 20 screenshots are `v0.4.8` at package v0.9.5 (`pi.image` too); trim the gallery, re-shoot 3–4 current views, move reference prose to `TECHNICAL.md`; add `--help` to `bin/pi-webui-launcher.mjs` | docs | M | yes |

### P3 — opportunistic

| ID | Item | Type | Effort |
|---|---|---|---|
| ARCH-7 | Remove 8 dead `elements` lookups and ~18 unreferenced top-level functions (two are kept alive only by source-text assertions in `tests/mobile-static.test.mjs`); replace the three hardcoded 15-term "any dialog open" chains (`app.js:15777,49141,49466`) with one `anyModalOpen()` | S |
| PERF-7 | Boot loader failure path re-downloads the 601 KB stylesheet with `cache: "no-store"` to probe status (`index.html:2181`) → `HEAD` or `link.onerror` | S |
| PERF-8 | 11 `body:has(…)` selectors force document-scoped invalidation during streaming; review only after PERF-6 profiling | S |
| UX-11 | Mobile shell v2 layout (UN P3-7, opt-in) | M |

## Details for P0 and selected P1 items

### SEC-1 · Central cross-site request guard — `bin/pi-webui.mjs:1208-1226`, `:9101-9105`, `:15088-15098`, `:17244-17250`
- **Symptom.** A page on any origin can `fetch("http://127.0.0.1:31415/api/bash", {method:"POST", mode:"no-cors", headers:{"content-type":"text/plain"}, body:'{"command":"…"}'})`. `text/plain` is a CORS simple request (no preflight); `readJsonBody` never checks content type; `getRequestedTab` falls back to the first tab when no id is supplied; the response is opaque but the command has already run. The same applies to `/api/prompt`, `/api/files/content`, `/api/git-changes/discard-file`, `/api/git-undo/last-commit`. Only three helpers (`requireWorkflowPolicyJsonRequest`, `requireSessionSummaryJsonRequest`, `requireCustomThemeJsonRequest`) check `sec-fetch-site`. No `Host` check → DNS rebinding also defeats those three.
- **Fix.** One guard in the `createServer` callback before dispatch: for every non-GET/HEAD/OPTIONS request (a) require `Content-Type: application/json` (or the specific multipart types the upload routes accept), (b) reject when `sec-fetch-site` is present and not `same-origin`/`none`, (c) reject when `Origin`, if present, is not the served origin, (d) reject when `Host` is not `localhost`/`127.*`/`[::1]`/the bound host with the bound port. Add a header token (`x-pi-webui-request`) minted into `index.html` as defence in depth once ARCH-1's template pass exists. Keep the existing per-route helpers; they become redundant, not wrong.
- **Acceptance.** `tests/transport-hardening-harness` gains cases: cross-site simple POST → 403 with no command sent to the fake Pi; wrong `Host` → 400/403; same-origin JSON POST unaffected; the browser suite stays green; remote PIN flow unaffected.

### SEC-2 · Remote PIN hardening — `bin/pi-webui.mjs:15357-15368`, `:15760-15767`
- **Fix.** 6–8 digit or word-list PIN; per-source-IP exponential backoff and lockout after ~5 failures; SSE/Events alert on repeated failures; shorter token TTL, rotate on network close. Document in `TECHNICAL.md` remote-access section.
- **Acceptance.** Harness: 6 wrong attempts → 429 with `Retry-After`; correct PIN after lockout window succeeds; existing `remote-auth-settings` harness green.

### REL-1 · Process-level handlers — `bin/pi-webui.mjs:17410-17411`
- **Fix.** `process.on("unhandledRejection")` and `process.on("uncaughtException")` → structured log (ARCH-6 or `console.error` until then) → `shutdown(reason, {preserveSessions:true})` so the supervisor keeps Pi children and browsers reconnect. Do the same in `bin/pi-webui-rpc-supervisor.mjs` if absent.
- **Acceptance.** Harness injects a rejected promise via a test-only hook and asserts the server logs and either survives or exits through the shutdown path with sessions preserved.

### REL-2 · Child stream error listeners and bounded `writeRaw` — `bin/pi-webui.mjs:1054-1068`, `:1123-1128`, `:1137-1143`, `:17230`
- **Fix.** `on("error")` for stdout/stderr readers and `child.stdin`; race the `drain` wait against `close`/`error` and a timer; give `/api/extension-ui-response` the same timeout as `send()`. Bring `stop()` to parity with the supervisor (`detached` spawn + `terminateProcessTree`) — see REL-7.
- **Acceptance.** Harness kills the fake Pi mid-write and asserts the server survives, the tab reports `pi_process_exit`, and no request hangs > timeout.

### REL-3 · Browser suite red and ungated
- **Symptom.** 17 specs fail after today's changes; the run is opt-in (`test:browser`), not in `check`, and there is no CI. Failures are a mix of stale expectations (multi-open sections in `control-deck-side-panels.spec.mjs:262`, 13→14 control rows in `controls-layout.spec.mjs:77`, 4→3 sidebar actions in `mobile-foundation.spec.mjs:762`, `.side-panel` strict-mode duplicate) and probable regressions (`stream-output-isolation.spec.mjs:307` forbidden mutations, `session-summary.spec.mjs:324` inactive summary button enabled, `mobile-foundation.spec.mjs:720` tablet `#fileViewerPane` hidden — consistent with UX-6, `interaction-continuity.spec.mjs:522` running-status geometry, `persistent-ui-layout.spec.mjs:981`).
- **Fix.** Triage each of the 17 into "update expectation" vs "fix code" and record the decision in the commit; then TEST-1 so this cannot recur.
- **Acceptance.** `npx playwright test` fully green twice in a row locally; CI runs it on every push to `main`.

### UX-1 · Focus-opened composer menus — `styles.css` `:focus-within` rules (~`10343`, `10505`), `app.js` menu-dismissed logic (~`38147`)
- **Symptom.** Close the palette or any dialog → focus returns to the trigger → panel opens on `:focus-within` and covers `#promptInput`; `elementFromPoint` at the prompt centre resolves to `#releaseAurButton`. Escape's `menu-dismissed` state is cleared on `focusout`, so the next focus return reopens it. Closed panels' items remain tabbable.
- **Fix.** Drive visibility from explicit open state only (click/Enter/Space/ArrowDown); hover may pre-open on fine pointers after a delay but never on focus alone; `inert` on closed panels; keep `menu-dismissed` until pointer leaves *and* a real interaction happens. Update the browser specs that currently assert hover/focus opening.
- **Acceptance.** Playwright: open palette → Escape → no composer menu is open and `#promptInput` is the element at its own centre; Tab count through the composer excludes closed menu items.

### UX-2 · Session-path 403 on fresh tabs — `lib/session-actions.mjs:15-35`
- **Fix.** Canonicalise `dirname(target)` with `realpath` and re-join the basename when the file does not exist yet; unit test with a symlinked session dir. Additionally, the intercom refresh should not `error`-toast a 403 on a fresh tab (downgrade to Events `info` until the session file exists).
- **Acceptance.** Fresh tab under a symlinked `~/.pi` shows no toast; harness covers symlink + missing file.

### REL-4 · Request classes and timeouts (both sides)
- Inventory endpoints as read / bounded mutation / long-running mutation / streaming. Client `api()`: default deadline per class via `AbortController`, retry only bounded idempotent GETs, distinguish timeout from backend-offline, always return controls from busy state (the GET-dedupe map already clears in `.finally`). Server: explicit `headersTimeout`/`requestTimeout`; long-running mutations return 202 + correlation id and report over SSE; abort the RPC when `req` closes.
- **Acceptance.** Half-open and duplicate-mutation harnesses (as specified in EXP P1-07); no non-idempotent replay.

### ARCH-1 · Content-hash revisions and closure contract
- Serve `/`, `/index.html`, `/service-worker.js` through a template pass substituting `{{APP_REV}}`/`{{CSS_REV}}`/`{{CACHE_REV}}` from the sha1 the static handler already computes; `APP_SHELL` entries carry the same hashes. Replace the 20 `pi-webui-pwa-v123` literals and `boot-failure-diagnostics.test.mjs:68,87,235` with a single test asserting (a) all three revisions are derived, (b) the SW `APP_SHELL` equals the recursive static import closure of `app.js` (+ `index.html` references). Then PERF-1 (`immutable` caching).
- **Acceptance.** Editing `styles.css` requires zero test edits; removing an eager import from `APP_SHELL` fails the closure test; installed PWA loads offline after one online visit.

### PERF-2 · Boot split — `app.js:33-586`, `:50008-50093`, `index.html` dialogs
- (a) lazy memoising `elements` proxy; (b) `bootCritical()` (composer, tab bar, transcript, SSE) then `bootDeferred()` in `requestIdleCallback` (stats, theme customizer, optional features, subagent config); (c) dialogs into `<template>`, hydrated on first open. Measure before/after with the probe script (TTI proxy, long tasks, DOM nodes) and record in the report.

## Delivery sequence

1. **Security & survival (P0, ~1 week):** SEC-1 → REL-1 → REL-2 → SEC-2 → UX-2 → REL-6. Ship as one patch release; note in `TECHNICAL.md` remote-access and security sections.
2. **Trustworthy gate (P0/P1, ~1 week):** REL-3 triage → TEST-1 (CI + fixture + runner timeouts) → ARCH-1 (revision hashes + closure test) → PERF-1 → TEST-3. After this step every asset change stops touching test files.
3. **First-contact usability (P0/P1, ~1 week):** UX-1 → UX-3 → UX-4 → UX-6 → A11Y-1 → UX-5 → REL-5. Re-run the probe script at the four viewports and attach screenshots to the report.
4. **Reliability depth (P1, ~1–2 weeks):** REL-4 → REL-8 → REL-7 → ARCH-6 → PERF-4 → PERF-3.
5. **Performance & memory (P1/P2):** PERF-2 → PERF-5 → ARCH-4 → PERF-6 → then decide on `webui-performance-smoothness.md` Stage 1 with real numbers.
6. **Maintainability program (P2, ongoing, one seam per change):** ARCH-2 route table (unlocks SEC-3 nonces and declarative guards) → ARCH-3 frontend seams (Stats overlay, Chat search first) → ARCH-5 storage wrapper → TEST-2 policy → ARCH-7 dead code.
7. **Docs (parallel, small):** DOCS-1 immediately after step 1; DOCS-2 with the next release; each step updates README/TECHNICAL/DEVELOPMENT per `../AGENTS.md` layers.

## Verification contract

- After every step: `npm run check` (all files) and `npx playwright test` green; `node --check` glob covers all `public/*.mjs` and `lib/**/*.mjs`.
- New harnesses required: cross-site POST rejection, PIN lockout, unhandled-rejection survival, child stream error survival, `writeRaw` timeout, tab/SSE caps, symlinked session dir, revision coherence + import closure, SW offline load, `api()` half-open, SSE `Last-Event-ID` replay.
- Probe script (`/tmp/webui-probe/probe*.mjs` pattern — to be committed under `dev/scripts/webui-probe.mjs`) re-run at 1440/1024/820/390 before/after steps 3 and 5; record TTI proxy, transferred bytes, DOM nodes, long tasks, axe critical/serious counts, screenshots.
- No item is marked done from source inspection alone when its gate is a browser, screen reader, or load harness.

## Non-goals and anti-recommendations

- No framework migration, bundler, or TypeScript rewrite of `app.js`; extraction stays incremental and behind the existing leaf-module pattern.
- No transcript virtualization before PERF-5 profiling shows rendering as the bottleneck.
- No weakening of the closed-by-default remote access, PIN, localhost-only mutation classes, digest-bound update flow, or path confinement.
- Do not "fix" the red browser specs by deleting assertions; each of the 17 needs an explicit update-vs-regression decision.
- Do not add a fourth manual revision counter or new exact-literal revision assertions while ARCH-1 is pending.

## Decisions needed from the maintainer

1. **Remote threat model (SEC-4):** should `/api/bash` and `/api/app-runner-config` be localhost-only (recommended), or remain available to PIN-authenticated remote clients with an explicit warning?
2. **PIN format (SEC-2):** 6-digit numeric vs short word code; token TTL.
3. **Menu opening (UX-1):** click/keyboard-only (recommended) vs delayed hover on fine pointers.
4. **CI provider and matrix (TEST-1):** GitHub Actions on `main` + PRs; Chromium only, WebKit nightly?
5. **Archive `WEBUI-UX-IMPROVEMENTS.md` and fold `WEBUI-EXPERIENCE-RECOMMENDATIONS.md` into this plan (DOCS-1)?**

## Probe incident record (2026-08-18)

During the live probe, a click on the composer's centre landed on the AUR Release menu item that had reopened over the prompt (UX-1) and started the `release-aur` extension in **plan** mode against `~/aur-packages/hyprland-simple-setup-git`. Nothing was published; `git status` there is clean and the last commit is unchanged (`711761f`). The probe's cleanup also killed an unrelated `pi-webui.mjs --port 4199 --cwd /tmp/piwebui-probe --no-session` instance (a scratch instance, not the maintainer's main server on 31415, which is still running). Both are recorded here because UX-1 caused the first and TEST-1's shared fixture should prevent the second (unique ports, targeted PIDs).
