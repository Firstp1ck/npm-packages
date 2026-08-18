# WebUI user-noticeable improvements — prioritized plan

Status: in progress — hotfix, feedback, composer, panels, performance, and most polish batches implemented (2026-08-18); see "Implementation status" below  
Scope: everything a user directly sees or feels — layout, feedback, keyboard/mouse behavior, error states, load/transfer performance, mobile  
Target package: `pi-package-webui` v0.9.5 (working tree at `4b5426b`)  
Created: 2026-08-18

## How this plan was produced

1. **Live probe.** Started the dev server (`node bin/pi-webui.mjs --port 31499 --cwd /tmp/webui-scratch --no-session`) and drove it in Chromium/Playwright at 1440×900, 1600×1000, 1024×700, 820×1180 (tablet), 600×900 and 390×844 (iPhone 13 emulation). Measured boot requests, payload sizes, DOM size, and took full-resolution screenshots of the home view, Control Deck, palette, `/model`, options menu, slash/`@` suggestions, Git panel, Settings, and the mobile/tablet layouts. Sent prompts (no model server available, so the failure path was exercised).
2. **Code review.** Two parallel reviewers read `public/app.js`, `public/index.html`, `public/styles.css`, `public/*.mjs` and `bin/pi-webui.mjs` for the composer/transcript and for Control Deck/Git/Files/dialogs, verifying every claim against current line numbers. (A third reviewer for startup/PWA/network aborted; that scope was covered manually — see items P1-12, P3-11.)
3. **Cross-check** against `WEBUI-EXPERIENCE-RECOMMENDATIONS.md` (P0-xx…P2-xx) and `WEBUI-UX-IMPROVEMENTS.md` (Tier items) so already-tracked work is flagged and its current status re-verified.

Everything below was verified in the current source or reproduced in the browser unless marked *(likely)*.

### Measured baseline (fresh browser profile, localhost)

| Metric | Value |
|---|---|
| `app.js` / `styles.css` / `index.html` on the wire | 2,266,662 B / 592,774 B / 163,285 B raw; static assets are served brotli-compressed (`app.js` → 416,575 B), `cache-control: no-cache` + ETag |
| Boot API requests | **57** requests, of which ~30 are exact duplicates (`/api/models` ×2, `/api/commands` ×2, `/api/tools` ×2, `/api/themes` ×2, `/api/settings` ×2, `/api/files` ×2, `/api/subagents` ×5, `/api/state` ×3, `/api/messages` ×3, `/api/tabs` ×3, …) |
| Largest JSON payloads | `/api/subagents/config` 288,966 B; `/api/models` 238,286 B (×2); `/api/commands` 99,945 B (×2); `/api/tools` 61,933 B (×2). JSON is pretty-printed (`JSON.stringify(payload, null, 2)`, `bin/pi-webui.mjs:1146`) and **not** compressed |
| Slowest boot calls | `/api/claude-usage` 1,384 ms, `/api/codex-usage` 1,169 ms (non-blocking) |
| DOM at empty state | 7,691 nodes, 27 `<dialog>` elements |
| Model catalog | 378 models (348 openrouter) rendered as a flat list |
| Playwright `load` (networkidle) | ≈2.5 s on localhost |

---

## Priority list

Types: **reliability** · **usability** · **feedback** (feedback/discoverability) · **performance** · **accessibility** · **visual** (visual/polish) · **mobile** · **copy**  
Impact = how many users hit it × how badly. Effort: S ≤ ½ day, M 1–3 days, L > 3 days.  
"Tracked" = already listed in an existing plan doc (status re-verified 2026-08-18).

### P0 — broken for a large share of users; fix first

| # | Item | Type | Impact | Effort | Tracked |
|---|---|---|---|---|---|
| P0-1 | Workspace collapses to 0–25 px on every viewport ≤ 1050 px and on all touch-only devices (phones, tablets, small laptops) | reliability / mobile | critical | S | no (regression) |
| P0-2 | `/model`, `/theme`, `/resume` … selector dialogs: **Enter in the filter closes the dialog without selecting**, no arrow-key navigation, current item not scrolled into view | usability | high | S–M | no |
| P0-3 | Enter with a highlighted `/`, `@`, `!` suggestion sends the raw text (e.g. literal `/comp`) instead of accepting the suggestion | usability | high | S | no |
| P0-4 | Typing a 21st line silently rips the whole prompt out of the textarea into a `.txt` attachment | usability / reliability | high | S | no |
| P0-5 | ~215 error paths and most warnings are written only to the collapsed **Events** accordion — no toast, no badge; failures look like "nothing happened" | feedback | high | M | partially (Tier 3.5) |

### P1 — clearly felt in everyday use

| # | Item | Type | Impact | Effort | Tracked |
|---|---|---|---|---|---|
| P1-1 | Composer menus (Options, Publish, Native commands, App runner) open on `:hover`/`:focus-within`; Escape "doesn't work" while the button keeps focus/hover, menus flap open when tabbing or mousing across the toolbar; menu items float without a container over footer chips | usability | high | S–M | no |
| P1-2 | Command palette result titles are clipped at the top (row height 15.5 px for 16 px text) | visual | high | S | no |
| P1-3 | "Core ready · N optional features ready" banner is a fixed overlay covering the header/Control Deck title on **every** load for 5 s, even when there is nothing to do | feedback | med–high | S | no |
| P1-4 | A failed run produces 8 separate transcript cards (4× "Assistant error", 3× "Auto retry", 1× "Auto retry failed"), the message is just "Connection error." with no provider/URL/next step, there is no one-click Retry / Change model, and after reload the user prompt dangles with no failure marker | feedback / reliability | high | M | partially (P1-07) |
| P1-5 | Controls-panel Model / Thinking selects snap back to the current value on any status refresh before Apply is pressed; Apply then does nothing; footer pickers apply on click while Controls need Apply (two behaviours for one setting) | reliability / usability | high | S | partially (Tier 2) |
| P1-6 | Git panel actions (stage/unstage/discard/ignore/refresh) are right-click only — no touch or keyboard-discoverable menu; the panel copy says "Right-click rows for actions" | mobile / accessibility | high | S | no |
| P1-7 | Without the optional `pi-prompts-git-pr` package the Guided Git button is hidden, so core users cannot commit or push from the UI at all (the manual "Commit input" path does not need the package) | usability | high | S–M | no |
| P1-8 | File viewer discards unsaved edits without warning (open another file, Close, cwd change, page unload); skill editor / attachment-text editor / prompt-list dialogs drop edits on Escape | reliability | high | S | partially (Tier 1.4, Settings only) |
| P1-9 | Dropping a file anywhere except the composer navigates the browser tab away from the app (no document-level `dragover`/`drop` guard) | reliability | high | S | no |
| P1-10 | Desktop composer drafts and attachments are lost on reload; no `beforeunload` warning while the composer is non-empty | reliability | med | S–M | no |
| P1-11 | Shift+Tab is hijacked globally (cycles thinking level + inserts a transcript card) so reverse keyboard navigation is broken outside text fields; Ctrl/Cmd+P, +O, +T are swallowed as well | accessibility | high | S | no |
| P1-12 | Boot makes 57 API calls (~30 duplicates) and ships ~1.5 MB of uncompressed, pretty-printed JSON; `/api/models` (238 KB) is fetched twice — noticeable on remote-access / phone connections and on every reload | performance | med–high | M | no |
| P1-13 | Markdown renderer mangles common LLM output: `snake_case` → italics, nested lists flattened, bare URLs not linked, 4-backtick fences shown literally | visual | high | M | no |
| P1-14 | Abort needs a 3 s hold; a click/tap does nothing lasting and the only hint is a `title` | usability / mobile | med | S | no |
| P1-15 | During a run four actions appear (Send, Steer, Follow-up, Abort); Send never changes label/tooltip and silently acts as one of the others | feedback | med | S | partially (Tier 2) |
| P1-16 | Typography floor regressed: `.subagent-source-badge` 0.58 rem (~9 px), footer meta 0.66 rem, several mobile rules 0.72–0.74 rem; `tests/mobile-static.test.mjs` floor assertion currently fails | accessibility | med | S | yes (P0-01, regressed) |

### P2 — worthwhile polish and consistency

| # | Item | Type | Impact | Effort | Tracked |
|---|---|---|---|---|---|
| P2-1 | Model selector: 378 flat rows, no provider grouping / favourites / recents, current model badge not scrolled into view, "context 1000000" not humanised, whole list re-rendered per keystroke | usability | med | M | no |
| P2-2 | Thinking blocks are always fully expanded in normal mode; no per-block collapse, only global show/hide | usability | med | S | no |
| P2-3 | Attachment tray shows no image thumbnails although preview URLs are created | visual | med | S | no |
| P2-4 | Large attachments (≤ 64 MB) are base64-encoded into one JSON body on Send: UI freeze, no progress, no cancel | performance / feedback | med | M | no |
| P2-5 | Slash popup opens for any absolute path typed mid-sentence ("look at /etc/hosts") and steals ArrowUp/Down even with 0 matches; `@` path lookups fire one request per keystroke | usability | low–med | S | no |
| P2-6 | Run indicator is a polite live region rewritten every second (elapsed-time ticker) and `#chat` is still `aria-live` → continuous screen-reader chatter | accessibility | med | S | partially (P1-02) |
| P2-7 | Long transcripts: every message stays in the DOM with heavy blurred shadows/glows; streaming bubble repaints a large glow every frame | performance | med | M | partially (P2-01/02) — CSS mitigation untracked |
| P2-8 | Native `window.prompt/confirm/alert` count has grown to 19 (workspace name, move/rename file, PR branch, publish repo, tag, amend, rename session…); 15 of 27 `<dialog>`s have no accessible name; terminal tab strip lacks arrow-key semantics; forced-colors rules exist only for the mobile shell | accessibility / usability | med | M | yes (P1-03/04/05, open) |
| P2-9 | Only one Control Deck section can be open at a time (cannot see Files and Git together) | usability | med | S | yes (P2-03) |
| P2-10 | "Session" means three things (open tabs on mobile, Pi session reset via "New", stored sessions in `/resume`); desktop says "tabs", phone says "sessions" | copy | med | S | partially (Tier 4) |
| P2-11 | Files panel: no "New file / New folder"; move/rename is a raw full-path `window.prompt` | usability | med | M | no |
| P2-12 | Command palette misses whole feature areas (Guided Git, Git changes, Files, App runners, Theme, Show/reset controls, Toggle thinking); placeholder promises "sessions" that are not indexed; unranked, no recents | feedback | med | S (items) / M (ranking) | partially (P2-04) |
| P2-13 | Thinking pickers offer all seven levels for every model; a downgrade ("requested max, set high") is reported only in Events | feedback | low–med | S–M | no |
| P2-14 | Git Changes dialog: any Stage/Unstage/Discard rebuilds the whole diff, re-expands every file, drops focus to `<body>`, no busy state (double-click fires twice) | usability / performance | med | M | no |
| P2-15 | App-runner widget rebuilds the whole widget area (up to 1,000 ANSI-parsed lines) plus the tab strip up to ~8×/s while a dev server is chatty | performance | med | M | no |
| P2-16 | "Hide this control" (right-click) has no Undo and no visible restore path (Controls ▸ Interface / palette have no "Show all controls") | feedback | med | S | no |
| P2-17 | Every tab close opens a full confirmation even for idle tabs | usability | low–med | S | partially (Tier 1.5) |
| P2-18 | Ctrl+C with no selection wipes the whole prompt with no undo | reliability | med | S | no |
| P2-19 | Ctrl/Cmd+F is swallowed while any modal `<dialog>` is open (no find, no usable search) | usability | low–med | S | no |
| P2-20 | Footer chips truncate the model to `MODEL (lmstu…` at moderate widths — the provider prefix eats the useful part; the composer action row wraps so **Send** sits alone on a second row at ~640 px chat width | visual | med | S | no |

### P3 — small polish, batch opportunistically

| # | Item | Type | Impact | Effort | Tracked |
|---|---|---|---|---|---|
| P3-1 | Resume dialog: raw ISO timestamps, "/resume" title, Rename/Delete reopens the dialog and loses filter/scroll, no Enter/double-click to resume | visual | low | S | no |
| P3-2 | Git panel / workflow copy leaks internals ("Run /git-staged-msg", "Waiting for agent_end…", "Open from the footer CHANGES chip…") | copy | low | S | partially (Tier 4) |
| P3-3 | Working-folder picker still says "Fast picks", no breadcrumbs | usability | low | S | yes (P2-05) |
| P3-4 | File viewer and diff have no syntax highlighting or line numbers although a tokenizer ships and is used for chat code fences | visual | low–med | M | no |
| P3-5 | Transcript images cannot be enlarged/opened | usability | low | S | no |
| P3-6 | Settings dialog is one long scroll with an explanatory "Scopes" box on top and no section navigation | usability | low | S–M | no |
| P3-7 | Mobile shell v2 (opt-in `?mobileShell=v2`): chat area collapses to ~60 px, composer sits mid-screen above a large void, "FOLLOW-UP" tag overlaps the input border | mobile | low today (opt-in), high if v2 becomes default | M | partially (mobile-v2 handoffs) |
| P3-8 | Mobile message header: timestamp overlaps the copy/retry buttons on the user bubble at 390 px | visual / mobile | low | S | no |
| P3-9 | Options-menu items have no container surface; they overlay footer chips ("CONTEXT" visible through the gaps) | visual | low | S | no (part of P1-1) |
| P3-10 | `/api/claude-usage` and `/api/codex-usage` take >1 s at boot; ensure they never gate any first-paint or footer state *(likely fine — verify)* | performance | low | S | no |
| P3-11 | Shared `api()` still has no default timeout/retry policy; half-open requests can leave busy state | reliability | low–med | M | yes (P1-07) |


## Implementation status (2026-08-18)

Verification: `npm run check` (all 183 static/harness files pass), `npx playwright test tests/browser/user-noticeable-fixes.spec.mjs` (7 pass), manual browser probe of the affected surfaces at 390/820/1024/1440 px (layout, palette, `/model`, toast + Events badge, failure cards, Git ⋯ menu, multi-open sections, New file flow, model chip). README/TECHNICAL updated for the changed shortcuts, notices, and section behaviour. Asset revisions advanced to `app.js?v=157`, `styles.css?v=132`, `pi-webui-pwa-v123`.

| # | Status | Notes |
|---|---|---|
| P0-1 | **Done** | `styles.css`: default two-column rule wrapped in `:where()` so overlay/collapsed rules win; Playwright asserts full-width workspace at 390/820/1024 px. |
| P0-2 | **Done** | Native selector dialogs: form `submit` intercepted (Enter selects the highlighted item), Arrow/Home/End/PageUp/PageDown navigation with `aria-activedescendant`, current item highlighted and scrolled into view; model list grouped by provider, current model pinned first, context humanised (P2-1). |
| P0-3 | **Done** | Enter accepts the highlighted `/`, `@`, `!` suggestion unless the token already equals it; keyboard hint row added to the popup. |
| P0-4 | **Done** | Typing no longer converts the prompt into an attachment; only large pastes do. |
| P0-5 | **Done** | `warn`/`error` events show a non-blocking toast stack (max 3, deduped, "Events" shortcut) plus an unread badge on the Events section header; explicit extension toasts surface for all levels; transcript-visible errors opt out (`notify: false`). |
| P1-1 | **Done (scoped)** | Hover/focus-opened composer menus get a `menu-dismissed` state: Escape closes and keeps them closed until the pointer/focus leaves; trigger focus restored. Hover/focus opening itself is intentional (tests) and kept. |
| P1-2 | **Done** | Palette rows use `grid-template-rows: minmax(min-content, auto)`; titles no longer clipped. |
| P1-3 | **Done** | Healthy "ready" audits no longer render the fixed banner; action-required/partial/degraded/migrating still do. |
| P1-4 | **Done** | One live "auto retry" card that updates in place; identical consecutive error cards collapse with a repeat counter; failure text includes provider/model; **Retry** and **Change model…** actions on failure cards; persisted `stopReason: "error"`/`"aborted"` render a marker after reload; redundant transient error cards drop once the authoritative failure exists (8 cards → 2). |
| P1-5 | **Done** | Controls Model/Thinking selects keep the user's unapplied choice through status refreshes; Apply shows a pending state and clears when applied or when the live state matches. |
| P1-6 | **Done** | ⋯ overflow button on Git panel repository rows and file rows opens the same action menu; copy no longer says "right-click only". |
| P1-7 | **Partial** | Guided Git button stays visible (disabled, with install hint) when the companion package is merely missing; hidden only when the user disabled the feature. Commit/push without the package still needs the workflow to run without generation (deferred, M). |
| P1-8 | **Done** | Discard-edits confirmations for the file viewer (open other file, Close, cwd change), skill editor and attachment editor (Cancel/Escape); `beforeunload` guard for unsaved viewer edits and pending file attachments. |
| P1-9 | **Done** | Window-level `dragover`/`drop` guard forwards files to attachments instead of navigating away. |
| P1-10 | **Done** | Per-tab composer drafts persist in `localStorage` (desktop; mobile v2 keeps its own store) and restore on boot. |
| P1-11 | **Done** | Ctrl/Cmd+P/T/O/C and Shift+Tab chords only act while the composer has focus; Ctrl+K/L, Alt+Enter, Alt+Up stay global. |
| P1-12 | **Done** | JSON responses compact + brotli/gzip when accepted (`/api/models` 238 KB → 9.8 KB); identical in-flight GETs share one fetch; boot no longer repeats the full refresh on the first `webui_connected`/`pageshow`; subagent launch-slot config loads lazily. Boot: 57 → 37 requests, ~1.5 MB → ~85 KB transferred. |
| P1-13 | **Done** | Emphasis flanking rules (`snake_case` safe), bare-URL autolinks, indentation-based nested lists with continuation lines, ``` `{3,}` ``` and `~~~` fences (streaming tail scanner updated to match). |
| P1-14 | **Done** | Hold shortened to 1.2 s; a quick tap shows "Hold to abort" instead of doing nothing. |
| P1-15 | **Done** | Send relabels to **Queue** / **Steer** while Pi is running, with an explanatory tooltip. |
| P1-16 | **Done** | All sub-0.75 rem declarations use `var(--text-xs)`; `tests/mobile-static.test.mjs` is green again (its stale assertions were also brought up to date). |
| P2-1 | **Done** | See P0-2. |
| P2-2 | **Done** | Persisted thinking renders as a collapsed `<details>` with a one-line preview; state remembered per block and tab. |
| P2-3 | **Done** | Image attachments show a thumbnail; click opens a lightbox. |
| P2-4 | Open | Upload progress/cancel (M). |
| P2-5 | **Done** | No slash popup for path-like tokens; arrows only intercepted when there are choices; `@` lookups debounced 120 ms. |
| P2-6 | **Done** | Elapsed-time ticker moved to an `aria-hidden` span; live region announces activity changes only. |
| P2-7 | **Partial** | Streaming glow reduced to a single small-blur shadow; card shadows dropped on touch/narrow viewports. `content-visibility` deliberately not applied (scroll-anchoring risk in the transcript reconciler; revisit with profiling per P2-01). |
| P2-8 | **Mostly done** | All 27 dialogs have `aria-labelledby`; terminal tab strip has Arrow/Home/End roving focus; forced-colors rules for core controls; 8 native `prompt()` sites replaced by the in-app prompt dialog. Remaining native calls: publish repo name/visibility, git-footer setup username, worktree base choice, and the documented `confirm()` fallbacks. |
| P2-9 | **Done** | Control Deck sections open/close independently; persisted collapsed set honoured. |
| P2-10 | Open | Terminology unification (mobile nav label is asserted by existing browser tests). |
| P2-11 | **Done** | `POST /api/files/create` (localhost-only, confined to the tab cwd, never overwrites); "New file…/New folder…" in the row menu plus a toolbar **New file** button; Move/Rename and the other simple text prompts (workspace name, amend message, tag, session rename, feedback note, PR branch) now use an in-app prompt dialog with validation instead of `window.prompt`. |
| P2-12 | **Done** | Palette gained Guided Git, Git changes, Files/Git/Events sections, `/theme`, thinking/tool output toggles, show/reset controls; prefix/word-start ranking; placeholder corrected. |
| P2-13 | **Done** | Unsupported thinking levels are disabled/labelled in the footer picker and Controls select; downgrades surface as a warning toast. |
| P2-14 | **Done** | Git Changes dialog remembers per-file fold state, disables the acted-on button while in flight (no double fire), and restores focus after re-render. |
| P2-15 | **Done** | Streaming app-runner updates append only new lines to the existing widget (and re-render the tab strip only when the run lifecycle changes); full re-render remains the fallback for structural changes. |
| P2-16 | **Done** | Hiding a control offers Undo; "Show all controls" / "Reset control visibility" in the palette. |
| P2-17 | **Done** | Closing one idle tab skips the confirmation and offers Undo (`POST /api/tabs/reopen` restores it from the server-side closed-tab record); tabs with running work still confirm. |
| P2-18 | **Done** | Ctrl+C clear goes through the editing command (browser Ctrl+Z works) and offers Undo. |
| P2-19 | **Done** | Ctrl/Cmd+F is left to the browser while a modal dialog is open. |
| P2-20 | **Partial** | Model labels are `id · provider` everywhere so footer truncation keeps the model name; the Send-wraps-alone layout at ~640 px is unchanged. |
| P3-1 | **Done** | Relative timestamps, "Resume a session" title, filter preserved across rename/delete; Enter/arrows via P0-2. |
| P3-2 | **Done** | Workflow copy: "Generate commit message", "Regenerate PR text", "Waiting for Pi to finish…", clearer Git Changes empty state. |
| P3-3 | **Done (copy)** | "Pin this folder" / "Pinned folders"; breadcrumbs still open. |
| P3-4 | Open | Viewer/diff syntax highlighting (M). |
| P3-5 | **Done** | Transcript images open in the lightbox. |
| P3-6 | Open | Settings section navigation. |
| P3-7 | Open | Mobile shell v2 layout (opt-in). |
| P3-8 | **Done** | Mobile bubbles reserve room for both the copy and edit/retry buttons; the timestamp no longer sits under them. |
| P3-9 | **Done (via P1-1)** | Menus close deterministically; container styling unchanged. |
| P3-10 | Open | Verify usage endpoints never gate first paint. |
| P3-11 | Open | `api()` default timeouts (P1-07). |

### Still open after this pass

- **P1-7** (commit/push without the companion package): the guided workflow's state machine assumes a generation model; running it with the manual "Commit input" path only is a medium change — button now stays discoverable with the install hint.
- **P2-4** upload progress/cancel (needs a `FormData` upload path server-side), **P3-4** viewer/diff highlighting, **P3-6** settings navigation, **P3-7** mobile shell v2 layout, **P3-3** picker breadcrumbs, **P3-11** `api()` timeouts (P1-07): unchanged, all M-effort.
- **P2-7** `content-visibility` and **P2-20** Send-row wrapping: intentionally not changed (transcript scroll-anchoring risk; composer grid ordering is covered by its own tests) — revisit with profiling / a composer layout pass.
- **P2-10** terminology: mobile nav label "Sessions" is asserted by the existing mobile browser specs; rename together with those specs.

Boot probe after P1-12 (fresh profile, localhost): 37 API requests (was 57), 85 KB transferred (was ~1.5 MB uncompressed JSON), remaining duplicates are the authoritative continuity refresh (`state`/`messages`/`tabs`) plus `optional-features`, `themes`, `tools`, `subagents`, `intercom` pairs.

---

## Details

### P0-1 · Layout collapses on ≤ 1050 px and touch devices — `styles.css:355`

- **Symptom.** On any viewport ≤ 1050 px, on any `(pointer: coarse) and (hover: none)` device, or whenever the Control Deck no longer fits (`SIDE_PANEL_OVERLAY_QUERY`, `app.js:1494`; `isControlDeckOverlayPresentation`, `app.js:3989-4004`), the body gets `control-deck-overlay side-panel-collapsed`. The main grid then resolves to `grid-template-columns: 0px 390px` (phone), `25px 747px` (820 px tablet), `244px …` (1024 px laptop) — the workspace column has (almost) no width and the hidden side-panel column takes the rest. Reproduced with fresh profiles at 390, 600, 820, 1024 px. The tablet screenshot shows a 72 px strip of vertically stacked letters next to a blank page.
- **Cause.** `body:not(.control-deck-left):not(.control-deck-both) .layout { grid-template-columns: minmax(0,1fr) minmax(20rem, var(--side-panel-right-width, var(--side-panel-width))) }` (`styles.css:355`, specificity 0,3,1) beats `body.control-deck-overlay .layout { grid-template-columns: minmax(0,1fr) }` (`styles.css:364`, 0,2,1). The collapsed rule at `:358` only matches `.side-panel-right-collapsed`, but overlay mode sets `.side-panel-collapsed`. Introduced with the Right/Left/Both Control Deck feature (`5779ecd`, `13e569f`).
- **Verified fix.** Injecting `body.control-deck-overlay .layout { grid-template-columns: minmax(0,1fr) !important }` in the running page restores the full mobile layout (composer, footer, transcript all usable).
- **Fix.** Raise specificity of the overlay/collapsed rules (e.g. `body.control-deck-overlay:not(.x) .layout` or reorder + `:where()` on the default rule), and add a Playwright assertion that `.workspace-column` width ≥ 90 % of viewport at 390 / 820 / 1024 px with the panel collapsed.
- **Acceptance.** Legacy phone, tablet and ≤ 1050 px desktop show the composer and transcript at full width with the deck collapsed; opening the deck overlays it; `tests/browser` covers all three widths.

### P0-2 · Native selector dialogs: Enter closes without selecting; no keyboard navigation

- **Symptom.** Ctrl/Cmd+L → type `haiku-4-5-2025` (one match) → Enter → dialog closes, model unchanged (reproduced). From the filter box the only way to pick is mouse or tabbing through up to 378 buttons. The "current" badge exists but the list is not scrolled to it.
- **Cause.** `#nativeCommandDialog` uses `<form method="dialog">` (`index.html:1709`); the search `<input>` is the only text field, so implicit submission closes the dialog. `renderNativeSelectorItems` (`app.js:40581-40616`) creates plain buttons; there is no `keydown` handler for Arrow/Enter (only `cancel`/`close` at `app.js:47219-47224`). Applies to `/model`, `/theme`, `/resume`, `/skills`, `/tools`, session summary and every other `openNativeCommandDialog` with a search box.
- **Fix.** Intercept `submit` on the form (Enter selects the active/first filtered item); add roving `aria-activedescendant` ArrowUp/Down/Home/End on the search input; `scrollIntoView({block:"center"})` for the active item on open; render list incrementally or with `content-visibility: auto`.
- **Acceptance.** Type + Enter selects; arrows move highlight; opening shows the current item; Playwright test for `/model` and `/theme`.

### P0-3 · Enter sends raw text instead of the highlighted suggestion — `app.js:48649-48675`

- **Symptom.** `/comp` shows `/compact` highlighted; Enter sends the literal `/comp` (reproduced: user message "/comp" appears, run starts). Only Tab accepts and nothing on screen says so.
- **Cause.** `shouldSendPromptFromEnter` is evaluated before the suggestion branch; `hideCommandSuggestions()` then `sendPrompt`.
- **Fix.** If `commandSuggest` is visible with ≥ 1 item, Enter (no modifier) → `insertCommandSuggestion()`; Ctrl/Cmd+Enter still sends; add a footer hint "↑↓ navigate · Enter/Tab accept · Esc close".

### P0-4 · 21st line converts the prompt into an attachment — `app.js:48689-48695`, `9338-9346`, `1467`

- **Symptom.** While composing (Shift+Enter for line 21) the textarea empties and a `webui-input-<timestamp>.txt` pill appears; inline editing is gone; only an Events line explains it (reproduced).
- **Fix.** Apply `moveLongPromptInputToAttachment` only on paste (already at `9475`) or on Send; if kept for typing, show an inline notice with "Undo / keep inline".

### P0-5 · Errors and warnings only reach the collapsed Events accordion — `app.js:17540-17552`

- **Symptom.** Palette actions, model apply, git-panel opens, file open, thinking apply, copy-path, worktree ops, attachment skips, clipboard failures, SSE drops, extension toasts, "prompt cleared" all fail silently unless the Events section (bottom of the Control Deck, collapsed, single-open accordion) is expanded. `grep -c 'addEvent(.*"error")'` = 215; `addTransientMessage` is used in ~47 places; extension `toast`s are routed to `addEvent` (`app.js:37812-37814`).
- **Fix.** Route `warn`/`error` through a small non-blocking toast (reuse `#undoToast` styling, stack ≤ 3, auto-dismiss, "Show events" link) and add an unread-error badge on the Events section toggle (`index.html:1202-1210`). Keep Events as the log.

### P1-1 · Composer menus open on hover/focus-within — `styles.css:10343-10345`, `10505-10507`, `app.js:38147-38159`

- **Symptom.** After Escape `aria-expanded` becomes `false` but the panel stays visible while the trigger has focus or the pointer rests on it (reproduced: `optionsMenu` 216×400 px still rendered). Tabbing through the toolbar pops each menu open; moving the mouse across the row flashes menus; the open menu overlaps the slash-suggestion list and footer chips because it has no container background.
- **Fix.** Drive visibility from `.open` only (JS state); keep hover as a *delayed* intent at most on fine pointers; give `.composer-publish-menu-panel` an opaque surface + border; close on outside click / focus leaving the menu.

### P1-2 · Command palette titles clipped — `styles.css:16803-16848`, `16320-16332`

- **Symptom.** Screenshot shows the top of every result title cut off ("New tab", "Choose directory…"). Measured: label height 15.5 px for 16 px font, `overflow: hidden`; grid rows `15.5px 15.48px` because the `kind` cell spans two rows with `line-height: 1.35` at `--text-xs`.
- **Fix.** Give `.command-palette-item-label` an explicit `line-height: 1.3` and let rows be `auto`; or drop `overflow:hidden` on the label and clip only horizontally.

### P1-3 · Startup banner overlay — `app.js:38943-39040`, `3340`, `styles.css:3968-3975`

- **Symptom.** `position: fixed; z-index: 190` card at top-center covers the tab strip / Control Deck title on every load for `OPTIONAL_FEATURE_READY_AUTO_DISMISS_MS = 5000` even in the all-good "ready" phase ("Core ready · 20 optional features ready / Optional feature audit complete."). On phones it covers the whole header.
- **Fix.** Don't render a banner for `ready`; show at most a subtle inline chip in the Control Deck version row. Keep the overlay for `action-required`, `partial`, `degraded`, `migrating`.

### P1-4 · Failure presentation and recovery

- **Symptom.** One unreachable provider produced 8 transcript cards (`ASSISTANT ERROR` ×4, `AUTO RETRY` ×3, `AUTO RETRY FAILED`) each with copy buttons; the text is "Connection error." with no provider/base URL/hint (here: LM Studio at localhost:1234 not running); no "Retry now", "Change model" or "Open settings" action (`app.js:46548-46551` → `surfaceRuntimeDiagnostic` → `37880-37885`, no actions); after reload only the user prompt remains — no visible sign the turn failed.
- **Fix.** Collapse the retry sequence into a single card updated in place ("Retrying 2/3 in 4 s…"); include provider/model and, where known, the endpoint; add Retry / Edit & retry / Change model buttons; persist a compact "failed" marker with the user prompt (or re-derive from session events) so it survives reload.

### P1-5 · Controls-panel selects revert before Apply — `app.js:26874-26928`, `44123-44133`, `47559-47611`

- **Symptom.** Pick a model in Controls → Model or change Thinking; any `renderStatus()` (called from 15 sites, per token during a run) resets `thinkingSelect.value` and `syncModelSelectToState()`; Apply then no-ops. Footer pickers apply on click; Controls need Apply; Theme applies on change; the Controls model select hijacks `pointerdown` so the native select never opens.
- **Fix.** Track a pending user selection and skip sync while dirty (or apply on selection like the footer, dropping the two Apply buttons); show a visible "not applied" state if Apply stays.

### P1-6 · Git panel actions are right-click only — `app.js:16143-16157`, `16246-16270`, `index.html:1009`

- **Fix.** Add the same per-row/per-repo "⋯" overflow button the Files tree already has (`fileTreeOverflowButton`, `app.js:12183-12193`) reusing `showGitPanelContextMenu`; drop "Right-click rows for actions" copy. Also fixes mobile Project ▸ Git which mounts the same section.

### P1-7 · Commit/push requires the optional package — `app.js:39754-39760`, `2727-2733`, `31359`

- **Fix.** Always show the Guided Git button; when `/git-staged-msg` is absent hide only "Generate/Regenerate" and default to "Commit input"; optionally add "Commit…" to the Git panel repo menu.

### P1-8 · Unsaved edits dropped — `app.js:15045-15083`, `14987-14994`, `46461`, `46800-46818`

- **Fix.** Guard `openFileInViewer` / `closeFileViewer` / cwd change with `appConfirm` when `activeFileViewer.dirty`; `beforeunload` guard while dirty; intercept `cancel` on skill editor, attachment-text and prompt-list dialogs (reuse the settings pattern at `47219` / `40532`).

### P1-9 · Drop outside composer navigates away — `app.js:48645-48647`, `9491-9508`

- **Fix.** Document-level `dragover`/`drop` `preventDefault()` for `Files`; forward drops to `addAttachmentFiles`; optional full-window drop overlay.

### P1-10 · Drafts lost on reload — `app.js:1657-1660`, `48196`, `600`

- **Fix.** Persist per-tab drafts (debounced) to `sessionStorage`/`localStorage` on desktop too; `beforeunload` prompt when `hasComposerPayload()`.

### P1-11 · Global shortcut hijacks — `app.js:47950-47995`, `48170`

- **Fix.** Restrict Shift+Tab, Ctrl/Cmd+P, +O, +T to `event.target === elements.promptInput` (or a modifier chord); keep browser defaults elsewhere.

### P1-12 · Boot request storm and JSON size — `bin/pi-webui.mjs:1146`, boot orchestration in `app.js`

- **Symptom.** 57 requests, ~30 duplicates, ~1.5 MB uncompressed JSON on every load; `/api/models` 238 KB ×2, `/api/subagents/config` 289 KB. Static assets are brotli'd but `sendJson` writes `JSON.stringify(payload, null, 2)` with no `content-encoding` and `no-store`. Over remote access (the product's own feature) or a phone this is seconds of transfer per reload; locally it is wasted work at the moment the UI should feel snappy.
- **Fix.** (a) Compress JSON ≥ ~4 KB with the existing brotli/gzip helpers when `Accept-Encoding` allows; (b) minified JSON; (c) dedupe boot: one in-flight promise per (path, tab) and a single `refreshAll()` fan-out; (d) trim `/api/models` (drop `compat`/`cost` blobs unless requested) and let `/api/subagents/config` be lazy (only when the Subagents section is opened). Measure before/after request count and bytes.

### P1-13 · Markdown mangling — `app.js:34211-34290`, `34571-34600`, `34617`

- **Verified by executing the renderer:** `file_name_here` → `file<em>name</em>here`; `- a\n  - nested` renders flat; `https://…` stays plain; ````` ````md ````` fences render as a paragraph.
- **Fix.** CommonMark flanking rules for `_`/`*`, indentation-based nested lists, conservative autolinker, `` `{3,} `` fence matching; extend `tests/markdown-links.test.mjs`.

### P1-14 · Abort — `app.js:1515`, `47505-47518`, `47323-47327`

- **Fix.** Hold ≈ 1 s or click → one-tap "Stop run?" confirm; after a short tap show an inline "Hold to abort" hint.

### P1-15 · Send label during a run — `app.js:7170-7184`, `7376-7381`

- **Fix.** Relabel Send to "Queue"/"Steer" (matching the busy-behaviour tag) while `pi-run-active`, or hide the duplicate.

### P1-16 · Typography floor regression — `styles.css:3721`, `18625`, `18828`, `18867`, `18888`

- **Fix.** Replace with `var(--text-xs)`; make the floor test green again and keep it in `npm run check`.

### P2 / P3 notes (one line each; see table for evidence owners)

- **P2-1** model selector: group by provider, favourites/recents on top, humanise context ("200k"), virtualise or `content-visibility`.
- **P2-2** thinking `<details>` collapsed by default (open while streaming), remembered per bubble (`app.js:35072-35076`, `36784-36811`).
- **P2-3** render `<img src=previewUrl>` in image pills (`app.js:9219-9256`, `9317`).
- **P2-4** upload via `FormData`/XHR with per-file progress + cancel (`app.js:9894-9922`).
- **P2-5** don't open the slash popup when the query contains `/` or has 0 matches; only `preventDefault` arrows when `activeSuggestionCount() > 0`; debounce `@` lookups ~120 ms (`app.js:44242-44257`, `44445-44450`, `48660-48672`, `44501-44530`).
- **P2-6** elapsed time in an `aria-hidden` span; announce lifecycle transitions only (`app.js:36861-36903`, `index.html:303`).
- **P2-7** `content-visibility:auto; contain-intrinsic-size` on `.message`; lighter shadows on `.streaming` and on mobile (`styles.css` ~8155-8180, 8467-8470).
- **P2-8** continue P1-04 migration (most-hit: resume rename, file move, PR branch); `aria-labelledby` on the 15 unnamed dialogs (`index.html:1408,1485,1560,1580,1602,1630,1657,1675,1689,1708,1719,1730,1748,1761,1789`); roving tabindex on `#tabBar`; extend forced-colors rules beyond `html[data-mobile-shell="v2"]` (`styles.css:17828-17833`).
- **P2-9** persist a collapsed set instead of one expanded id (`app.js:4445-4468`).
- **P2-10** use "tab" for the process concept everywhere; "Resume a session" title (`app.js:1921-1943`, `42099`; `index.html:245`, `399`).
- **P2-11** "New file… / New folder…" in tree toolbar + row menu (small create endpoint); inline rename field (`index.html:1226-1231`, `app.js:13028-13034`).
- **P2-12** add missing palette actions (`app.js:44786-44811`), fix placeholder (`index.html:1669`), prefix/recency ranking (`44870-44874`).
- **P2-13** hide unsupported thinking levels from model metadata; show effective level inline (`index.html:790-798`, `app.js:18044-18047`, `47603-47606`).
- **P2-14** per-path collapsed set, busy state on the acted button, focus continuity via `captureScopedControlContinuity` (`app.js:20584-20627`, `20206-20224`, `20902-20937`).
- **P2-15** append only new app-runner lines; re-render tabs only on visible state change (`app.js:46446-46451`, `29129`, `31006`).
- **P2-16** `offerUndo` on hide; "Show all / Reset controls" in Controls ▸ Interface and palette (`app.js:13344-13349`, `13425-13437`).
- **P2-17** confirm only when `tabHasActiveAgent`, otherwise close with Undo toast (`app.js:17362-17390`).
- **P2-18** `setRangeText`/`execCommand('delete')` so undo works, or toast with "Restore" (`app.js:45319-45329`).
- **P2-19** skip the Ctrl+F override when `dialog[open]` (`app.js:48162-48168`).
- **P2-20** footer: drop `(provider)` prefix first when truncating; keep **Send** on the first row (pin it to the end of row 1 or make it the last item to wrap).
- **P3-1** `toLocaleString`/relative time; patch list in place; Enter/double-click resumes (`app.js:42098-42192`).
- **P3-2** plain labels ("Generate commit message", "Waiting for Pi to finish…") (`app.js:31828-31842`, `32620-32627`, `20632`).
- **P3-4** reuse `tokenizeCode` in a read-only overlay for the viewer and diff cells (`app.js:34504`, `20060-20067`, `index.html:672-673`).
- **P3-7** fix `.mobile-shell-v2` chat/composer height distribution before promoting v2 to default.
- **P3-11** default per-class timeouts in `api()` (`app.js:8484`) per P1-07.

---

## Suggested delivery order

1. **Hotfix batch (S, ship first):** P0-1, P0-2, P0-3, P0-4, P1-2, P1-3, P1-16, P1-9, P1-11 — all ≤ ½ day each, all high visibility, all low risk; add the three Playwright width assertions from P0-1.
2. **Feedback batch (M):** P0-5 toast + Events badge, P1-4 failure card/retry, P1-15 Send relabel, P2-16 undo, P2-13 effective thinking level.
3. **Composer batch (S–M):** P1-1 menus, P1-10 drafts, P1-14 abort, P2-5 popup rules, P2-18/P2-19 shortcuts, P2-2/P2-3 thinking + thumbnails.
4. **Panels batch (S–M):** P1-5 Controls apply, P1-6 Git overflow menu, P1-7 commit without package, P1-8 dirty guards, P2-9 multi-open, P2-14 Git dialog stability, P2-11 file create.
5. **Performance batch (M):** P1-12 boot dedupe + JSON compression, P2-7 transcript CSS containment, P2-15 app-runner append, P2-4 upload progress, P2-1 model list.
6. **Rendering + a11y batch (M):** P1-13 markdown, P2-6 live regions, P2-8 dialogs/tab strip/forced-colors, P2-12 palette coverage.
7. **Copy/polish batch:** P2-10, P2-20, P3-x.

## Verification contract

- Every P0/P1 item gets either a Playwright spec under `tests/browser/` or a static/harness test under `tests/`; the P0-1 fix must include width assertions at 390, 820 and 1024 px.
- Re-run the boot probe (request count, duplicate count, JSON bytes) after P1-12 and record before/after in this file.
- Manual pass on a real phone (legacy + v2 shell) after P0-1 and P3-7.
- Keep `npm run check` green (currently `tests/mobile-static.test.mjs` fails on the typography floor — P1-16).

## Known limitations of this review

- No model backend was reachable during the probe, so streaming/markdown/tool-card behaviour was reviewed in code (P1-13 verified by executing renderer functions), not visually during a live response.
- Line numbers refer to the working tree at `4b5426b`; `app.js` shifts frequently — search by symbol name when picking items up.
