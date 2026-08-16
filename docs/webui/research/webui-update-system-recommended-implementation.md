# WebUI Update System — Recommended Robust Implementation

**Date:** 2026-08-07 · **Baseline:** `c2aa8da` (`main`)

**Sources synthesized:**

- `docs/webui/research/webui-update-system-findings-2026-08-07.md` (incremental engineering plan, weaknesses W1–W14)
- `docs/webui/research/webui-update-system-git-history-and-reliability-review.md` (architectural audit, findings F1–F12)

## 1. How the two analyses compare

Both documents independently reach the same diagnosis at the same revision, which gives high confidence in the root cause:

| Point of agreement | Findings doc | Research doc |
|---|---|---|
| Core bug: updater resolves PATH `pi`, tabs run the bundled runtime | W1 | F1 (Critical) |
| Verification exists only on the component-pi path; must be unconditional | W3 | F4 |
| Legacy + component + optional-feature paths have drifted; converge on one engine | Phase 1 | F11 |
| Restart is a blind fixed delay with no health gate and no rollback | W5, W6 | F6 |
| Job state and locking are process-local; crashes cause amnesia | W13 | F5 |
| Timeout kills only the direct child, not the process tree | W9 | F7 |
| In-place mutation of running code is unsafe (Windows EBUSY, mid-swap tab spawns) | W7 | F2 |
| Manifest/lockfile pollution of target roots | W8 | F9 |

Where they diverge, one side has the stronger answer:

| Decision | Findings doc says | Research doc says | Winner and why |
|---|---|---|---|
| Multi-root package updates | Keep them; continue-on-error with a per-root scoreboard | Remove the broad root scan from the default path; fail closed on unproven ownership; delegate Pi-registered packages to Pi | **Research doc.** A scoreboard makes failures *visible*; fail-closed ownership makes the worst failures (npm mutating a pnpm/Yarn/linked/source root) *impossible*. Scoreboard reporting is still kept — for the roots that pass ownership checks. |
| Runtime replacement | Stage in temp dir, verify, rename old aside, move staged in, retry on EBUSY | Side-by-side versioned runtimes under `~/.pi/webui/runtimes/<txn>/` with an atomic pointer switch and retained previous version | **Research doc.** Rename-swap still mutates the live install path and fights Windows file locks; a pointer switch never touches files the running process has open, and rollback is a pointer restore, not a reverse rename. |
| Version targets | `@latest` installs | Immutable plan with exact pinned versions (`package@0.84.1`) resolved at plan time and confirmed by the user | **Research doc.** Kills the check/apply race (F8) and makes post-verification meaningful: "did I get the version I promised" instead of "did something change". |
| Restart reconnect signal | Boot identity (start timestamp + version) in `/api/health`; client declares success only when the identity *changes*; ≥90 s budget; EADDRINUSE listen retry with backoff | Health-gated activation supervised externally | **Both.** The research doc's supervisor owns activation; the findings doc's boot-identity handshake is the concrete mechanism the client and supervisor use to prove the *new* process answered. Adopt both. |
| Tab restore across restart | Temp file, path passed via env (env-var size cliff W14) | Not addressed | **Findings doc.** Adopt as-is. |
| Probe timeouts | 3 s → 10 s; probe failure means "unknown", never "use the stale cached manifest" | Not addressed at this level | **Findings doc.** Adopt as-is. |
| Delivery strategy | Ordered phases, smallest-risk-retired-first, ship the "never works" fix immediately | Phase 0 urgent patch, then transactional design | **Both agree in shape.** Ship the resolver/verification fix now; build the transactional system next; don't block the urgent fix on the architecture. |

**Verdict:** the research doc's architecture (fail-closed ownership, immutable plans, side-by-side staging, journal) is the robust foundation — it eliminates whole failure classes rather than mitigating them. The findings doc supplies the concrete mechanics (boot-identity handshake, listen retry, temp-file tab restore, probe semantics, reuse of `lib/process-tree.mjs`) and the pragmatic ordering. The recommendation below is that combination.

## 2. Design principles

1. **One resolver, used everywhere.** The function that decides which Pi runtime tabs spawn from is the same function that decides what gets updated and what gets version-checked afterward. No second opinion, ever.
2. **An update is a transaction, not a command.** Plan (immutable, exact versions) → stage (side-by-side) → verify (candidate proven) → activate (pointer switch, health-gated) → confirm (post-activation identity check). Every step journaled before it runs.
3. **Fail closed on ambiguity.** If the installation's owner (npm/pnpm/Yarn/Bun/source/unknown) or exact root can't be proven, refuse and print the exact manual command — never guess.
4. **Success means proven, not exit 0.** Every changed target is re-read from the running system afterward. Mixed outcomes report `partial`, never `success`.
5. **The thing being replaced never orchestrates its own replacement's activation.** A small stable supervisor owns the switch and the rollback.

## 3. Target architecture

### 3.1 Module layout

Extract the updater from `bin/pi-webui.mjs` into focused modules:

```text
lib/update/resolver.mjs    # THE single active-runtime/ownership resolver
lib/update/plan.mjs        # immutable, serializable, exact-version plans
lib/update/owners.mjs      # npm / pnpm / yarn / bun / source / managed adapters
lib/update/executor.mjs    # staging + command execution (tree-kill on timeout)
lib/update/journal.mjs     # durable transaction journal + cross-process lock
lib/update/verify.mjs      # per-target post-conditions
lib/update/supervisor.mjs  # activation, health gating, rollback
```

### 3.2 The plan (immutable contract)

`POST /api/update-plan` returns a serializable plan; every update action executes a previously returned plan, and user confirmation binds to that exact plan:

```jsonc
{
  "transactionId": "txn-…",
  "createdAt": "…",
  "activePi":    { "command": "…", "realpath": "…", "packageRoot": "…", "version": "0.83.0", "owner": "bundled" },
  "activeWebui": { "entrypoint": "…", "packageRoot": "…", "version": "…", "owner": "npm-global" },
  "targets": [
    { "component": "pi",    "from": "0.83.0", "to": "0.84.1", "exactSpec": "pi-coding-agent@0.84.1", "strategy": "stage-and-switch" },
    { "component": "webui", "from": "…",      "to": "…",      "exactSpec": "@firstpick/pi-package-webui@x.y.z", "strategy": "stage-and-switch" }
  ],
  "registry": "…", "restartPolicy": "health-gated",
  "refusals": [ { "root": "…", "reason": "owner=pnpm — run: pnpm add -g …" } ]
}
```

Exact versions are resolved at plan time. Execution installs `exactSpec`, never a fresh `@latest` lookup. If `latest` moved between plan and apply, the user still gets the version they confirmed.

### 3.3 Ownership matrix (fail closed)

| Installation | Automatic behavior |
|---|---|
| Managed WebUI runtime (side-by-side root) | Stage and switch transactionally |
| Bundled Pi inside the WebUI package | Update as part of the WebUI bundle, in place of legacy `pi update --self` |
| Explicit `--pi` / `PI_WEBUI_PI_BIN` | Delegate to that exact executable's own updater; verify the same realpath afterward |
| Pi-registered optional packages | Delegate to `pi install npm:<pkg>`; per-package receipts |
| npm/Bun global roots with proven ownership | Owner-specific adapter, `--no-save --package-lock=false`, per-root receipt |
| pnpm / Yarn / linked / source checkout / unknown | **Refuse**; surface the exact manual command in the result |

The broad agent/project/global root scan is removed from the default path. If PATH `pi` differs from the active runtime, the UI updates the active runtime and says so explicitly: *"PATH pi v0.84.1 is a separate installation; run `pi update` in a terminal to update it."*

### 3.4 Side-by-side staging and activation

```text
~/.pi/webui/runtimes/
  current.json            # { "path": "txn-0007", "previous": "txn-0006" }
  txn-0006/               # previous known-good (retained for rollback)
  txn-0007/               # newly staged candidate
```

1. Install exact versions into `runtimes/<txn>/` (never the live tree).
2. Verify the candidate offline: package names/versions/integrity, required files, `node <staged>/…/cli.js --version`.
3. Boot the candidate on a temporary loopback port; wait for `/api/health` to report the expected versions and a fresh boot identity.
4. Atomically rewrite `current.json` (write temp + rename).
5. Old server releases its port, then the supervisor starts (or promotes) the candidate on the real port; candidate retries `listen` on `EADDRINUSE` with backoff (250 ms × 40) instead of one blind attempt after a fixed delay.
6. If health fails, restore `current.json` to `previous` and leave a one-click rollback receipt. Old runtime dirs are garbage-collected only after a retention window.

The live directory is never mutated, so Windows EBUSY/EPERM on loaded native modules and mid-swap tab spawns cease to be failure modes; new-tab creation is paused only for the pointer switch itself.

### 3.5 Journal and cross-process lock

Durable journal at `~/.pi/agent/webui/updates/<transactionId>.json`:

```text
planned → preflighted → staging → verified → activating → healthy
                                            ↘ failed        ↘ rolled-back
```

- Every step is persisted *before* it executes.
- A cross-process lock file keyed to the install identity carries `{pid, startTime, nonce}` with stale-lock recovery, so two WebUI processes can never both mutate one install (fixes W13/F5).
- On startup, incomplete transactions are reconciled (dead-pid → `interrupted — verify versions`) before any new update is allowed.
- Migration markers (`pendingUpgrade`) are written only after the package mutation is journaled as applied, and cleared/classified when it never completed (F10).

### 3.6 Verification (every target, every path)

`success` requires all of:

- active Pi `--version` (via the single resolver) equals the plan's target;
- installed WebUI package version on disk equals the plan's target;
- post-activation `/api/health` reports the expected WebUI + Pi versions **and a boot identity different from the pre-update one** — this is what kills the "old server answered the poll" false positive (W6);
- Pi's package inventory confirms optional-package versions/registration;
- no package-manager descendant still running.

Anything less is `partial` (with per-target receipts) or `failed` — never `success`.

### 3.7 Client behavior during restart

- Before triggering an update, the client stores the current boot identity from `/api/health`.
- After activation begins, it polls and declares "restarted" only when the identity *changes*; budget ≥ 90 s with visible progress, replacing the 40 × 500 ms ≈ 20 s budget.
- Tab-restore state travels in a temp file whose path is passed via env — not in `PI_WEBUI_RESTORE_TABS` itself (Windows ~32 KB env cliff, W14).

### 3.8 Execution hardening

- Timeout kills the whole process tree (reuse `lib/process-tree.mjs`; Windows `taskkill /T /F`) (W9/F7).
- Version probes get 10 s (not 3 s); probe failure yields `unknown` — never silent fallback to the startup-cached manifest version (W10).
- Drop the nonexistent npm flag `--min-release-age=0` (W11); keep Bun's `--minimum-release-age` where applicable.
- Keep `--ignore-scripts`, but record when an installed package declares install scripts so skipped native postinstalls are diagnosable (W12).
- Detect pnpm/volta/scoop shim layouts that can't be normalized to `node <cli.js>` and refuse with a clear message instead of dying on spawn `EINVAL` (W9).

### 3.9 Long-term boundary: machine-readable Pi contract

Propose upstream:

```text
pi update plan --json
pi update apply --plan <file> --json
pi update verify --plan <file> --json
```

exposing ownership, exact versions, roots, and postconditions. When available, WebUI orchestrates and renders this contract and deletes its own Pi-root inference entirely.

## 4. What to keep from the current code

Already solid at `c2aa8da` — carry into the new modules unchanged:

- Windows shim normalization to `node <cli.js>` for pi and npm, PATHEXT and PATH-key-casing handling (`lib/npm-command.mjs`).
- Per-task PATH pinning so `pi` and `npm` come from the same installation.
- `pi update --help` capability probing with `--self`/`--extensions` fallback (`lib/update-commands.mjs`).
- The `c2aa8da` bundled-runtime task: nested-root targeting, `--no-save --package-lock=false`, Bun topology detection, post-update version check — this becomes the seed of `executor.mjs` + `verify.mjs`.
- Localhost-only routes, strict body validation, argument-array spawning, bounded/secret-redacting errors, dev-checkout fail-closed, single-flight 409s.
- Pi-owned optional-feature installs with registration verification and per-package receipts.
- Session continuity across restart (tab snapshot + detached supervisor handoff), amended per §3.7.

## 5. Rollout

### Phase 0 — urgent correctness patch (days; retires the "never works" core)

1. Extract `resolver.mjs`; make tab-spawning, update targeting, and version measurement all call it. Legacy `POST /api/update` becomes a thin wrapper over the component-update engine (component-pi → optional component-webui → restart), then the legacy task pipeline is deleted. *(W1–W4 / F1)*
2. Unconditional post-update verification for `webui` and legacy results, matching the existing pi check; expected-version missing ⇒ verification still requires the version to *change*. *(F4)*
3. Disable the broad multi-root scan by default; Pi-registered packages go through Pi; unproven roots are refused with the manual command shown. *(F3, F9)*
4. Tree-kill on timeout; 10 s probes with `unknown` fallback; drop `--min-release-age=0`. *(F7, W10, W11)*
5. Boot identity in `/api/health`; client reconnect keyed on identity change with a ≥ 90 s budget; `EADDRINUSE` listen retry; tab restore via temp file. *(W5, W6, W14)*

### Phase 1 — transactional core (unify and make recoverable)

6. `plan.mjs` with exact-version immutable plans bound to user confirmation; `owners.mjs` fail-closed adapters; `journal.mjs` durable journal + cross-process lock with startup reconciliation. *(F2, F5, F8)*

### Phase 2 — side-by-side managed runtime

7. `runtimes/<txn>/` staging, candidate health probe, atomic `current.json` switch, supervisor-owned activation, retained previous version, one-click rollback. *(F2, F6, W7)*

### Phase 3 — upstream integration

8. Adopt the `pi update … --json` contract; delete WebUI's Pi-root inference.

## 6. Acceptance tests

The replacement is done when all of these pass (superset of both documents' lists):

1. Bundled Pi + different PATH Pi: only the active bundled runtime changes; UI names the untouched PATH install.
2. Explicit `--pi`: only that realpath changes and is verified.
3. npm and Bun global fixtures: correct adapter; pnpm/Yarn/linked/source fixtures: explicit fail-closed result with the manual command.
4. Source checkout: zero files change on any path.
5. `latest` moves between plan and apply: the confirmed version is installed.
6. Network loss during staging: old runtime stays active; journal shows `failed`, not `success`.
7. Permission/disk failure during staging: no activation; no live-tree mutation.
8. Crash at every journal state: restart reconciles safely; no blind retry.
9. Two WebUI processes on one install: exactly one acquires the lock; the other gets 409/refusal.
10. Timeout with spawned descendants: whole tree terminated; no post-timeout writes.
11. Candidate fails syntax/startup/health: automatic pointer rollback; old server still reachable.
12. Command exits 0 without a version change: result is `failed` (verification), not `success`.
13. WebUI succeeds, one optional package fails: result is `partial` with per-package receipts.
14. Windows with a loaded native module: side-by-side update succeeds without touching the live directory.
15. Client reconnect: old server answering health polls during the window does **not** produce a false "restarted" (boot identity must change).
16. 100+ open tabs: restart restores them (temp-file restore, no env-size failure).

## 7. Bottom line

`c2aa8da` proved the diagnosis: updates only became honest the moment one path started verifying the runtime it actually serves. The robust implementation generalizes that insight — one resolver, exact-version transactional plans, fail-closed ownership, side-by-side activation with health-gated switch and rollback, and verification as the definition of success on every path. Phase 0 alone converts the system from "never reliably updates" to "updates the right thing or says exactly why not"; Phases 1–2 make it survive crashes, concurrency, Windows file locks, and bad releases.
