# WebUI Update System — Findings and Recommendation

Date: 2026-08-07 · Analyzed at HEAD `c2aa8da` · Scope: the "Update Pi" / "Update Pi + Packages" mechanism in `pi-package-webui`

## Summary

The update system has gone through **12 commits over two months** (2026-06-09 → 2026-08-07) and currently ships **two parallel mechanisms**: the legacy "Update Pi & restart / Update all & restart" flow (`POST /api/update`) and the newer background "component update" flow (`POST /api/component-update`, added 2026-08-03). The plumbing (Windows shim handling, command resolution, single-flight locking, localhost gating) is careful, but the legacy flow — the one users actually click — has four compounding defects that fully explain "it never reliably updates Pi and packages":

1. **It often updates a different Pi installation than the one the WebUI runs** (PATH `pi` vs. the bundled nested runtime).
2. **"Update all" never touches the nested bundled runtime** — the fix for this (commit `c2aa8da`) only landed on the component-update path.
3. **It verifies nothing** — exit code 0 counts as success, then the server restarts.
4. **It races its own restart** — a fixed 1.2 s start delay vs. up to ~4 s port hold, single `listen` attempt, and a 20 s client reconnect budget.

Result: the update "succeeds", the server restarts (or doesn't come back), and the update banner reappears with the same old version — indefinitely.

**A robust solution is not yet fully implemented.** Commit `c2aa8da` (today) fixed the core wrong-target + no-verification problem, but **only for the "pi" target of the component-update path**. The recommendation below is to finish that architectural migration and retire the legacy path.

---

## 1. Commit history of the update system

All 12 commits that touched the mechanism (verified complete via `git log --follow` on `lib/update-commands.mjs`, `lib/npm-command.mjs`, `lib/component-update-state.mjs`):

| Date | Commit | What it did | What it was reacting to |
|---|---|---|---|
| 2026-06-09 | `5988f3f` | Initial flow: `/api/update-status` (10-min cache, pi.dev + npm registry checks), localhost-only `POST /api/update` → `pi update` → restart server | — (shipped with: version read once at startup from the nested manifest, no verification, restart coupled to update) |
| 2026-06-11 | `8cd4195` | Multi-root pipeline: `pi update` + npm installs across WebUI root, agent root, npm global, Bun global | `pi update` alone left the WebUI package stale, so the update banner never cleared |
| 2026-06-16 | `1e81339` | Resolve Pi CLI via `require.resolve.paths` instead of a hard-coded nested path | Global installs hoist `pi-coding-agent` beside `pi-package-webui`; the nested path didn't exist, updater fell back to PATH `pi` |
| 2026-06-19 | `9d6c99b` | **Reversal:** removed the multi-root pipeline; self-only `pi update` by default, `pi update --all` behind a separate button | The shotgun approach was fail-prone — any one root (npm perms, missing Bun, network) failed the whole update |
| 2026-07-02 | `05b11f8` | **Reversal of the reversal:** multi-root npm tasks back under "all" mode, plus optional-feature and per-project `.pi/npm` roots; big error-classification layer (npm-not-found / permission / network / timeout) | Opaque npm failures in the field; `pi update --all` alone left package roots stale |
| 2026-07-03 | `77979e3` | Docs/UI text describing the expanded "all" scope | Users confused about what the update would touch |
| 2026-07-14 | `033b117` | `lib/update-commands.mjs`: probe `pi update --help` for `--all`; default became `pi update --self`; fallback `--self` + `--extensions` | Pi CLI flag drift across versions — bare `pi update` updated everything on some versions; `--all` didn't exist on others → hard failures |
| 2026-07-15 | `66c7847` | `lib/npm-command.mjs`: find `npm-cli.js` and run it via `node` instead of spawning `npm` | `spawn npm ENOENT` on Windows — Node's `spawn()` can't execute the `npm.cmd` shim |
| 2026-07-31 | `a88848f` | Resolve Windows `pi.cmd`/`pi.ps1` shims to `node …\cli.js`; prepend the selected install dir to PATH; prefer npm bundled with the selected Pi | Same shim spawn failure for `pi`; stale `%APPDATA%\npm\npm.cmd` earlier on PATH redirected updates to a *different* installation — updates "succeeded" but updated the wrong install |
| 2026-08-03 | `d7f4189` | **New architecture:** `POST /api/component-update` — per-component (`pi` / `webui`) background jobs, 202 + polling, no restart, single-flight state machine, secret-redacting errors, dev-checkout protection | The monolithic "update everything then kill the server mid-HTTP-response" design; raw npm output leaking; dev checkouts being clobbered |
| 2026-08-06 | `58d9063` | Release notes show the *available* version, not the installed one | UI showed release notes for the version you already had |
| 2026-08-07 | `c2aa8da` | **The core fix:** read the actual runtime version via `pi --version` (not startup-cached manifest); update the *nested bundled* runtime directly (`npm install --prefix <packageRoot> --no-save --package-lock=false`); **verify post-update that the runtime version actually advanced** | The deepest bug finally named: `pi update --self` updates Pi's own installation, but the WebUI spawns tabs from its bundled nested copy — "success" while the WebUI keeps running the old runtime, banner reappears forever. Also `npm install` had been rewriting the published `package.json` |

### Recurring failure patterns

- **Windows shim/spawn failures (3 rounds):** `npm.cmd` ENOENT → `pi.cmd` ENOENT → stale PATH shims shadowing the right npm → `Path` vs `PATH` env duplication. Every fix converged on "resolve the real `.js` entrypoint and run it through Node."
- **"Which installation am I updating?" ambiguity (5 rounds):** bundled vs. hoisted vs. PATH vs. explicit `--pi-bin`. Worst symptom: updates that succeed but target a different installation than the one serving tabs — invisible until `c2aa8da` added verification.
- **Scope flip-flopping (4 reversals):** single command → all-roots shotgun → self-only → all-roots again → per-component minimal. Sequential fail-fast execution meant any one root failed the entire update.
- **Pi CLI flag drift:** the updater depends on an external CLI whose flags changed across releases, forcing runtime `--help` probing.
- **No success verification for ~2 months:** exit code 0 = success. Only fixed yesterday/today, and only on one path.
- **Update-then-restart coupling:** the server kills itself 20 ms after answering the update request; failures mid-restart leave the user staring at a dead overlay.

---

## 2. Current implementation (HEAD `c2aa8da`)

### Two parallel mechanisms

**A. Legacy `POST /api/update[?all=1]`** (side panel "Update Pi & restart" / "Update all & restart"; `bin/pi-webui.mjs:15766`, handler `runPiUpdateAndPrepareRestart` at `bin/pi-webui.mjs:11948`):
- One long-held synchronous HTTP request; on success the server calls `shutdown()` 20 ms after responding and re-spawns itself detached with tab state serialized into the `PI_WEBUI_RESTORE_TABS` env var.
- Pi command resolution (`resolvePiUpdateCommands`, `bin/pi-webui.mjs:11506`): explicit `--pi` wins; otherwise **probe PATH `pi --version` (3 s) and prefer PATH pi**; fall back to the bundled nested runtime.
- "All" mode adds sequential npm/Bun tasks across up to six root types (WebUI install root, `~/.pi/agent/npm`, optional-feature root, per-tab `<cwd>/.pi/npm`, npm global, Bun global), commands shaped like `npm install --prefix <root> --ignore-scripts --min-release-age=0 <pkg>@latest`.
- **First task failure aborts everything (HTTP 500). No rollback. No verification. Success = every exit code 0, then restart.**

**B. Component updates `POST /api/component-update {target: "pi"|"webui"}`** (Control Deck version tags; `bin/pi-webui.mjs:15756`):
- Returns 202, runs in the background, UI polls `/api/update-status` at 1 s.
- `pi` target: updates the **bundled nested runtime in place** when that's what tabs actually use, then **re-reads `pi --version` and fails the job if the version didn't advance** (`bin/pi-webui.mjs:11918-11924`).
- `webui` target: npm/Bun install of `@firstpick/pi-package-webui@latest`; no restart, no verification ("Restart the Web UI to use the update").
- Single-flight lock shared with the legacy path; secret-redacting bounded error messages; refuses self-update from dev checkouts.

### Concrete weaknesses (file:line at HEAD)

| # | Weakness | Where |
|---|---|---|
| W1 | **Split-brain resolution:** the updater prefers PATH `pi`, but tab-spawning and version measurement prefer the bundled nested runtime — the legacy flow can update an installation the WebUI never uses | `bin/pi-webui.mjs:11514-11522` vs `9367-9380`, `11385-11399` |
| W2 | **"Update all" never updates the nested bundled runtime** — `currentBundledPiComponentUpdateTask` is only wired into the component route; root scans only look one level into `node_modules`, so the standard global-install nesting is invisible | `bin/pi-webui.mjs:11818-11850`, `11565-11598` |
| W3 | **Legacy path has zero post-update verification** (component-pi path has it) | `bin/pi-webui.mjs:11948-11983` |
| W4 | **Fail-fast sequential tasks, no rollback** → partial updates (Pi updated, packages not; earlier roots on `@latest`, later ones stale) | `bin/pi-webui.mjs:11869`, `11962` |
| W5 | **Restart race:** fixed 1.2 s start delay vs. up to ~4 s old-process port hold; single `listen` attempt, no EADDRINUSE retry | `bin/pi-webui.mjs:11319-11338`, `16701-16713`, `16746-16789` |
| W6 | **Client reconnect races:** if the long request drops mid-update, `/api/health` polling can hit the *still-updating old server* and declare success; the 40 × 500 ms ≈ 20 s budget is shorter than a slow cold start | `public/app.js:7698-7710`, `41830-41849` |
| W7 | **In-place self-update of running code** — npm rewrites the running server's own tree and the runtime tabs spawn from; Windows EBUSY/EPERM exposure, no retry, tabs can spawn mid-swap | `bin/pi-webui.mjs:11640-11651`, `11742-11761` |
| W8 | **Manifest/lockfile drift:** non-bundled npm tasks write `dependencies` + lockfiles into target roots (incl. project `.pi/npm` and the global prefix parent); `@latest` ignores declared semver ranges | `bin/pi-webui.mjs:11627-11638`, `11679-11687` |
| W9 | **Windows spawn edges remain:** pnpm/volta/scoop shim layouts aren't rescued (→ `EINVAL` on modern Node); bare `"npm"` PATH fallback; timeout kills only the direct child, no tree-kill | `lib/npm-command.mjs:96-119`, `179-185`; `bin/pi-webui.mjs:1856-1858` |
| W10 | **3 s probe cliffs:** slow `pi --version` silently falls back to the stale startup manifest version and nondeterministically flips which installation gets updated | `bin/pi-webui.mjs:11385-11399`, `11515` |
| W11 | `--min-release-age=0` is not a real npm flag (Bun's `--minimum-release-age` is) | `bin/pi-webui.mjs:11630`, `11700` |
| W12 | `--ignore-scripts` everywhere: right security default, but native postinstalls are silently skipped → undetectable partial installs | `bin/pi-webui.mjs:11630`, `11700`, `11732`, `11755` |
| W13 | Job state is process-local: a crash mid-update reports idle afterwards; two server instances can update the same roots concurrently | `bin/pi-webui.mjs:11340-11343` |
| W14 | Tab restore state in an env var (`PI_WEBUI_RESTORE_TABS`) — Windows ~32 KB env limits can break restart with many tabs | `bin/pi-webui.mjs:11322` |

### What's already solid (don't re-invent)

- Windows shim normalization to `node <cli.js>` for pi and npm, with PATHEXT handling and PATH-key-casing preservation (`lib/npm-command.mjs`).
- PATH pinning per task so `pi` and `npm` come from the same installation.
- `pi update --help` capability probing with `--self`/`--extensions` fallback (`lib/update-commands.mjs`).
- The `c2aa8da` bundled-runtime task: correct root targeting, `--no-save --package-lock=false`, Bun topology detection, **post-update version verification**.
- Single-flight locking with 409s across both mechanisms; localhost-only routes; strict body validation; secret-redacting bounded errors; dev-checkout fail-closed.
- Timeouts and output caps on every spawned command; ENOENT classified with actionable hints.
- Session continuity across restart (tab snapshot + detached RPC supervisor handoff).

---

## 3. Recommendation: finish the migration to verified component updates

The repo already contains the right architecture in embryo (`d7f4189` + `c2aa8da`): per-component background jobs, targeting the runtime the WebUI *actually executes*, with post-update version verification. The robust solution is to **make that the only mechanism** and fix the remaining gaps, rather than continuing to patch the legacy flow.

### Phase 1 — Converge on one mechanism (highest impact)

1. **Rebuild `/api/update` on top of the component-update engine, then delete the legacy task pipeline.** "Update Pi & restart" becomes: component-update `pi` (verified) → optional component-update `webui` → restart. One code path, one set of invariants. This retires W1–W4 in a single move.
2. **One resolution function, used everywhere.** Whatever resolution decides which runtime tabs spawn from must be the same function that decides what gets updated and what gets version-checked. The current PATH-first updater vs. bundled-first runner split (W1) is the single most likely cause of "never works." If PATH pi and the bundled runtime differ, update the bundled one (it's what the UI uses) and *say so* in the UI ("PATH pi v0.80.1 is separate; run `pi update` in a terminal to update it").
3. **Verify every target, not just `pi`.** After a `webui` update, re-read the installed `@firstpick/pi-package-webui/package.json` version from disk and fail the job if it didn't advance. Verification is the only thing that ever surfaced the wrong-target bug — make it unconditional.

### Phase 2 — Make the restart reliable

4. **Replace the fixed-delay restart with a handshake.** New process retries `listen` on EADDRINUSE with backoff (e.g., 250 ms × 40 ≈ 10 s) instead of one attempt after a blind 1.2 s sleep. Old process releases the port *before* spawning the successor where possible (close server → spawn → exit).
5. **Give the client a truthful reconnect signal.** Add a build/boot identifier (e.g., server start timestamp + package version) to `/api/health`. The client stores the pre-update identifier and only declares "restarted" when the identifier *changes* — this kills the "old server answered the poll" false success (W6). Raise the reconnect budget to ≥ 90 s with visible progress.
6. **Move tab-restore state out of the environment** into a temp file whose path is passed in env (fixes W14 and removes the size cliff).

### Phase 3 — Make package updates atomic-ish and honest

7. **Stage-then-swap for the bundled runtime:** `npm install` into a temp directory, verify (`node <staged>/dist/cli.js --version`), then rename the old runtime dir aside and move the staged one in, with retry-on-EBUSY (Windows AV/indexer) and rollback of the rename on failure. Block new tab creation for the few seconds the swap takes. This addresses W7 and gives you rollback for free (keep the old dir until the next successful update).
8. **Continue-on-error with per-root results.** Run all package-root tasks, collect `{root, ok, error}` per task, and report a scoreboard instead of aborting on the first failure. Partial success is normal in a multi-root world; hiding it is what made failures opaque.
9. **Stop mutating target manifests:** use `--no-save --package-lock=false` (or `npm update <pkg>` within declared ranges) for *all* roots, not just the bundled one — project `.pi/npm` dirs and the global prefix should never gain stray `package.json`/lockfile edits (W8). Drop the fake `--min-release-age=0` npm flag (W11).
10. **Persist job state** (`~/.pi/webui-update-state.json` or similar): write `{jobId, target, startedAt, pid}` at start and the outcome at the end. On startup, if a job is marked running but its pid is dead, mark it "interrupted — verify versions." Fixes the amnesia in W13 and enables cross-instance locking via the same file.

### Phase 4 — Hardening

11. Raise the version-probe timeouts (3 s → 10 s) and treat probe failure as "unknown", never as "use the stale startup manifest" (W10).
12. Tree-kill on task timeout (Windows: `taskkill /T /F`; the repo already has `lib/process-tree.mjs` from the app-runner work — reuse it) (W9).
13. Detect and warn on pnpm/volta/scoop shim layouts that `resolvePiCommandInvocation` can't normalize, instead of letting `spawn` fail with `EINVAL` (W9).
14. Surface skipped postinstall scripts: after `--ignore-scripts` installs, note in the result when the installed package declares install scripts, so native-dependency breakage is diagnosable (W12).

### Suggested order of work

| Step | Effort | Risk retired |
|---|---|---|
| 1. Rebuild `/api/update` on the component engine; unify resolution; verify all targets | Medium | W1, W2, W3, W4 — the "never works" core |
| 2. Restart handshake + boot-id health check + longer client budget | Small | W5, W6 — "update killed my server" |
| 3. Per-root scoreboard + `--no-save` everywhere + persisted job state | Small–Medium | W4, W8, W13 |
| 4. Stage-then-swap bundled runtime | Medium | W7, rollback capability |
| 5. Hardening items 11–14 | Small each | W9–W12 |

Steps 1–2 alone should make the visible behavior go from "never reliable" to "reliable with honest errors": the update targets the runtime the UI actually runs, refuses to claim success unless the version provably advanced, and the restart either completes verifiably or reports precisely where it stopped.
