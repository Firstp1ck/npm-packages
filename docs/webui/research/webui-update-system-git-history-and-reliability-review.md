# WebUI Pi/package update system: Git history and reliability review

**Audit date:** 2026-08-07

**Repository:** `pi-coding-agent-forge`

**Audited revision:** `c2aa8dac7f9cabe61e8c56c6f3c6b89a8000d762` (`main`)

**Scope:** WebUI-driven Pi, Web UI, core-package, and optional-feature installation/update behavior.

## Executive summary

**Verdict: the current implementation is materially safer than the original updater, but it is not yet a reliable end-to-end update system.**

The latest targeted **Update Pi** path fixes an important bundled-runtime problem: it detects the Pi runtime actually used by WebUI tabs, updates a nested bundled Pi dependency directly, preserves the published WebUI manifest, and verifies the post-update Pi version. However, those protections were added only to the component endpoint. The older **Update Pi & restart** and **Update Pi + Packages & Restart** routes still use a different resolver and can update a different Pi installation from the one WebUI tabs actually run.

The broader package flow remains heuristic and in-place. It scans several npm/Bun roots, runs sequential `@latest` installs, has no durable cross-process lock, no transaction journal, no rollback, no all-component post-verification, and no health-gated activation. It also assumes npm for most non-Bun roots, regardless of whether npm, pnpm, Yarn, Bun, a wrapper, or a source checkout owns the installation.

### Most important current defect

In the default non-explicit configuration:

- WebUI tab launches use `resolvePiCommand()`, which prefers the bundled Pi CLI when present (`pi-package-webui/bin/pi-webui.mjs:9342-9380`).
- The legacy updater uses `resolvePiUpdateCommands()`, which probes and prefers the `pi` executable on `PATH` before falling back to the bundle (`pi-package-webui/bin/pi-webui.mjs:11506-11536`).

Therefore the legacy update-and-restart actions can report success after updating a global/PATH Pi while restarted WebUI tabs continue using the unchanged bundled Pi. The targeted component updater fixed this at `c2aa8da`, but the legacy route did not inherit the fix.

The audited checkout demonstrates the exact ambiguous topology: the WebUI-local dependency reports Pi `0.83.0`, while `pi` on `PATH` reports `0.84.1`.

## Methodology and inclusion criteria

The history was searched across all refs with:

- subject searches for `webui`, `update`, `pi`, `package`, and `runtime`;
- `git log -G` searches for update endpoints and symbols;
- path history for `pi-package-webui/bin/pi-webui.mjs`, update helper modules, frontend controls, tests, and README;
- direct inspection of candidate diffs;
- current-code inspection of the selected Pi CLI's package/update implementation.

A commit is listed as **core** when it changed execution, target resolution, endpoint semantics, restart behavior, verification, or the main update UI. A commit is listed as **supporting** when it changed optional-package ownership, status, migration, security, or user confirmation in a way that affects update reliability. Pure dependency/lockfile bumps and unrelated uses of the word “update” were excluded.

## Current implementation map

| Surface | Current behavior | Evidence |
|---|---|---|
| Update status | Checks Pi via `pi.dev` and WebUI via npm registry metadata; caches for 10 minutes | `pi-webui.mjs:11372-11496` |
| Active Pi version | Executes the Pi command WebUI would use and parses `--version`, with startup metadata as fallback | `pi-webui.mjs:11385-11400` |
| Targeted Pi update | Updates nested bundled Pi directly; otherwise uses selected Pi's `update --self`; verifies runtime version | `pi-webui.mjs:11742-11760`, `11782-11788`, `11907-11929` |
| Targeted WebUI update | Installs `@firstpick/pi-package-webui@latest` into the current install root; source checkouts are refused | `pi-webui.mjs:11348-11353`, `11763-11780` |
| Legacy Pi-only update | Resolves selected/PATH Pi and runs `pi update --self`, then restarts WebUI | `pi-webui.mjs:11506-11536`, `11948-11982` |
| Legacy all update | Runs Pi update plan plus detected checkout, agent, optional-root, project, npm-global, and Bun-global core tasks | `pi-webui.mjs:11640-11850` |
| Optional features | Uses selected Pi's `pi install npm:<package>` and verifies installation/registration; batches continue after individual failures | `pi-webui.mjs:2166-2287` |
| Concurrency | One in-memory privileged operation per WebUI process | `pi-webui.mjs:11340-11366`, `11938-11944`; `lib/component-update-state.mjs` |
| Update execution | Runs child commands with bounded output and timeout; stops on the first legacy task failure | `pi-webui.mjs:1836-1879`, `11858-11876`, `11960-11966` |
| Restart | Spawns a detached replacement with a fixed delay, then shuts down the old server | `pi-webui.mjs:11319-11336`, `15766-15774` |
| Browser recovery | Polls `/api/health` for roughly 20 seconds after restart | `public/app.js:41830-41847` |

## Core update history

| Date | Commit | Change and significance |
|---|---|---|
| 2026-06-06 | `14b0f5c` | Added WebUI restart/stop controls and the detached replacement-server mechanism later reused by updates. This is a prerequisite, not yet an updater. |
| 2026-06-09 | `5988f3f` | Introduced update checks, `/api/update-status`, localhost-only `/api/update`, confirmation UI, `pi update`, and automatic restart. This was the first WebUI updater. |
| 2026-06-11 | `8cd4195` | Expanded one Pi command into multiple direct npm/Bun tasks across checkout, agent, global, and WebUI roots. This introduced broad root discovery and non-transactional multi-root mutation. |
| 2026-06-16 | `1e81339` | Fixed hoisted Pi CLI resolution and reused Node-based CLI invocations for updates. This addressed installations where Pi was adjacent to, not nested under, WebUI. |
| 2026-06-19 | `9d6c99b` | Made the default update Pi-only and added an explicit all mode. At that point `pi update --all` was assumed rather than capability-probed. |
| 2026-06-20 | `76394cc` | Documentation-only clarification of Pi-only versus all-mode behavior and the endpoint. No execution fix. |
| 2026-07-02 | `05b11f8` | “Improve update system”: restored broad direct package-root tasks only for all mode, added agent/project/optional roots, expanded package discovery, and improved optional-install diagnostics. |
| 2026-07-03 | `77979e3` | Aligned confirmation text, docs, and static tests with the expanded all-update scope. No transactional protection was added. |
| 2026-07-14 | `033b117` | Added `pi update --help` capability probing. Uses `--all` when supported and otherwise `--self` followed by `--extensions`. Added `lib/update-commands.mjs`. |
| 2026-07-15 | `66c7847` | Added Windows-safe npm CLI resolution through Node instead of relying on `CreateProcess` to execute `npm.cmd`. Added `lib/npm-command.mjs`. |
| 2026-07-15 | `91cd386` | Replaced raw browser confirmation with the structured confirmation dialog for update/restart actions. UX/safety change only. |
| 2026-07-18 | `7143be5` | Moved update actions into the reorganized Control Deck server group. No updater semantics changed. |
| 2026-07-31 | `a88848f` | Normalized Windows Pi shims, put the selected Pi installation first on `PATH`, and preferred npm bundled with that installation for direct package tasks. This fixed stale/unrelated npm selection. |
| 2026-08-03 | `d7f4189` | Added separate background **Update Pi** and **Update Web UI** component actions, exact request validation, process-local state, single-flight coordination, source-checkout refusal for WebUI self-update, and bounded/redacted failures. |
| 2026-08-04 | `d44645a` | Moved optional-feature install/update ownership to Pi (`pi install npm:...`), added registration verification/batches, and excluded known optional features from direct npm/Bun root updates. |
| 2026-08-05 | `ccb737a` | Added optional-feature audit/migration coordination. WebUI updates now persist a pending-upgrade marker before mutation; all-mode updates do the same before restart. |
| 2026-08-06 | `58d9063` | Corrected the Pi details dialog to show release notes for the available release rather than always the installed release. Discovery/UX fix. |
| 2026-08-07 | `c2aa8da` | Added active-runtime version detection, direct nested/bundled Pi updating with manifest preservation, and post-update Pi version verification. This fixes the targeted component path, but not the legacy resolver split. |

## Supporting optional-package history

| Date | Commit | Change and significance |
|---|---|---|
| 2026-06-03 | `609aa60` | Introduced localhost-only optional companion installation from WebUI and made companions optional dependencies. |
| 2026-06-06 | `3ca4d29` | Fixed optional-feature installation so it would not prune a global package. Evidence of early root-ownership problems. |
| 2026-06-06 | `4e3b71f` | Made optional-feature root selection fail closed when no safe root could be established. |
| 2026-06-10 | `7d15089` | Centralized localhost/trust guards for native WebUI mutation routes, including package actions. |
| 2026-06-12 | `e5a2783` | Added package discovery/status across safe npm and Bun roots and surfaced installed/update/running/failure state. |
| 2026-08-04 | `9c3cf72` | Detected top-level-resource versus Pi-package duplicate registrations and blocked installs that would preserve duplicate loading. |
| 2026-08-05 | `ccb737a` | Added durable optional-feature migration state, revision-bound mutations, sequential migration, partial results, and idle-tab restart behavior. |

Catalog-only additions, package version bumps, lockfile-only commits, and unrelated UI “live update” commits were intentionally excluded because they did not change updater semantics.

## What is already implemented well

1. **Localhost-only mutation routes.** `/api/update` and `/api/component-update` are in the canonical localhost-only route registry (`lib/trust-boundaries.mjs:13-31`).
2. **Argument-array execution.** Package names and flags are passed as spawn arguments rather than interpolated shell commands, limiting command-injection risk.
3. **Bounded execution.** Update commands have timeouts and bounded output; component errors are bounded and redact common credential formats.
4. **Single-flight inside one process.** Legacy and component jobs reject overlapping starts in one server process.
5. **Source-checkout refusal for targeted WebUI self-update.** The component path fails closed rather than overwriting a development checkout.
6. **Windows shim handling.** npm and Pi `.cmd`/JavaScript shims are normalized to executable Node+CLI invocations.
7. **Pi-owned optional features.** Known optional companions are no longer directly mutated by the broad npm/Bun root scanner.
8. **Bundled Pi verification.** The latest targeted Pi update re-reads the active runtime version before reporting success.
9. **Partial optional-feature reporting.** Optional batch installs continue after individual failures and expose per-package results.

These are meaningful improvements; they should be retained in a replacement design.

## Reliability findings

### F1 — Critical: legacy updates can target the wrong Pi installation

**Evidence**

- Tab startup: `resolvePiCommand()` prefers bundled Pi unless `--pi`/`PI_WEBUI_PI_BIN` was explicit (`pi-webui.mjs:9367-9380`).
- Legacy updater: `resolvePiUpdateCommands()` prefers working `pi` on `PATH` (`pi-webui.mjs:11506-11536`).
- Legacy endpoint does not re-read or verify the active runtime after updating (`pi-webui.mjs:11948-11982`).
- The targeted component path has the bundled-runtime fix (`pi-webui.mjs:11742-11760`, `11918-11924`), proving the two paths are inconsistent.

**Impact:** false success and repeat update prompts after restart. This is likely the highest-value explanation for observed unreliability.

**Minimum fix:** resolve the active runtime once, place its identity in an update plan, use that plan for every Pi action, and verify the exact same executable/package root afterward. The legacy Pi-only path should call the same planner/executor as the targeted Pi component action.

### F2 — High: core updates are in-place and non-transactional

`resolveUpdateTasks({ all: true })` can mutate Pi, the WebUI checkout/install root, agent root, configured optional root, every active project root, npm global root, and Bun global root. `runPiUpdateAndPrepareRestart()` executes these sequentially and stops on the first failure. Earlier successful mutations remain applied.

There is no snapshot, staging root, transaction journal, rollback, or “resume from verified step” contract.

**Impact:** mixed versions after permission, network, disk, registry, or package-manager failure. A retry starts from an unknown partial state.

### F3 — High: installation ownership is inferred too weakly

The updater special-cases a Bun global WebUI root, but otherwise uses npm-style `install --prefix` tasks. It does not establish whether the existing WebUI/core root is owned by npm, pnpm, Yarn, Bun, a wrapper, or a source/package-manager environment.

The selected upstream Pi self-updater already contains substantially stronger owner detection, realpath comparison, global-root checks, writability checks, and package-manager-specific commands (`pi-coding-agent/dist/config.js:27-280`). WebUI duplicates only a subset of that logic.

Official npm documentation also distinguishes local `npm install --prefix` behavior from global `npm install -g` behavior:

- <https://docs.npmjs.com/cli/install/>
- <https://docs.npmjs.com/cli/v11/configuring-npm/folders/>

**Impact:** a pnpm/Yarn-managed or linked installation can be mutated with npm, resulting in stale links, unexpected manifests/locks, or an install that does not update the launcher actually used.

**Minimum fix:** fail closed unless the owner and exact owned root are proven. Do not direct-update foreign roots.

### F4 — High: verification is incomplete and asymmetric

Only the targeted Pi component path verifies a version after update.

Not verified:

- targeted WebUI installed version;
- legacy Pi-only result;
- any direct npm/Bun task;
- all-mode package versions/registration;
- launcher resolution after WebUI update;
- candidate server startup before old server shutdown.

The expected Pi version is also optional: if release lookup fails, a zero-exit update can be treated as success without proving any version change.

**Impact:** command exit `0` is treated as installation success even when the wrong root was changed or nothing effective changed.

### F5 — High: locking and job state are process-local

`piUpdateInProgress` and `ComponentUpdateState` exist only in memory. The README explicitly acknowledges that background job state is process-local.

Two WebUI processes pointing at the same install can update concurrently. A crash or restart loses the job state, command history, and whether a package manager is still running. Optional-feature migration state is durable, but the core updater has no equivalent journal or cross-process lock.

**Impact:** duplicate writers, lock contention, corrupted partial state, and unsafe blind retries.

### F6 — High: restart is not health-gated and has no rollback

After package commands return zero, the old process spawns a detached replacement with a fixed 1.2-second delay. The old process then shuts down. It does not wait for the replacement to bind, complete startup audit, report expected versions, or pass a compatibility check.

The browser polls health after the old process has already committed to shutdown. Failure leaves the user offline; it cannot restore the old package state.

**Impact:** a syntactically valid but non-starting release strands the WebUI until manual repair.

### F7 — High: update timeout kills only the direct child

`runCommand()` calls `child.kill("SIGKILL")` on timeout. It does not terminate the package manager's process tree. npm, pnpm, Bun, or Pi may have spawned descendants that continue writing after WebUI reports a timeout.

The repository already contains process-tree termination logic for app runners, but the updater does not use it.

**Impact:** orphaned package-manager children, lingering locks, and mutations continuing after a failed result is shown.

### F8 — Medium: mutable `latest` targets are not bound to the displayed plan

Status and execution are separate network operations. The UI displays versions fetched from `pi.dev`/npm, while direct tasks later install `@latest`. Registry configuration used by npm may differ from `PI_WEBUI_NPM_REGISTRY_URL`, and `latest` can move between check and apply.

**Impact:** the installed artifact may differ from the reviewed/advertised version; post-verification cannot reliably explain what was intended.

### F9 — Medium: legacy all mode can mutate source checkouts

Targeted WebUI self-update correctly refuses source/development mode. Legacy all mode still calls `currentWebuiPackageUpdateTask()`, which updates declared Pi/WebUI dependencies in the checkout using `@latest`.

**Impact:** a WebUI maintenance button can rewrite a working tree's manifest and lockfile, creating unrelated Git changes and potentially breaking a developer checkout.

### F10 — Medium: WebUI update migration state is written before success

`persistOptionalFeaturePendingUpgrade()` writes `pendingUpgrade` before the WebUI package command runs. A failed update leaves the pending marker. This may be conservative, but the record cannot distinguish “upgrade started and failed before package change” from “new WebUI installed and migration pending.”

**Impact:** confusing or unnecessary migration prompts after failed/no-op updates.

### F11 — Medium: three overlapping update models have drifted

The code now has:

1. legacy Pi/update-all plus restart;
2. targeted Pi/WebUI background component updates;
3. Pi-owned optional-feature install/update/migration.

They have different resolution, verification, persistence, restart, and failure semantics. The most recent fix applied only to model 2. The large `pi-webui.mjs` module owns HTTP, UI state, package discovery, command resolution, execution, migration, and restart orchestration, making this drift easy to reintroduce.

**Impact:** fixes do not propagate consistently and tests can validate one surface while another remains broken.

### F12 — Medium: package discovery is heuristic and incomplete

The root scanner recognizes package names by prefix/pattern and scans only configured roots plus projects represented by current/restorable tabs. Symlinked manager layouts and inactive projects can be missed; unrelated matching packages can be included.

**Impact:** “Update all” is neither a complete inventory nor a narrowly deterministic plan.

## Test assessment

Focused tests run during this audit all passed:

```text
node pi-package-webui/tests/update-commands.test.mjs
node pi-package-webui/tests/npm-command.test.mjs
node pi-package-webui/tests/component-update-state.test.mjs
node pi-package-webui/tests/component-update-api-static.test.mjs
node pi-package-webui/tests/control-deck-component-updates-static.test.mjs
```

What they establish:

- update flag planning and `--all` fallback text;
- Windows npm/Pi command-path normalization;
- in-memory component state and error redaction;
- static endpoint/source contracts;
- frontend lifecycle and request shape.

What they do **not** establish:

- that the package manager owning an actual installation is selected;
- that the active Pi runtime and updated Pi target are identical in legacy mode;
- real npm/pnpm/Yarn/Bun installation outcomes;
- post-update WebUI/package verification;
- permission, proxy, offline, disk-full, or locked-native-file behavior;
- timeout process-tree cleanup;
- crash recovery, concurrent servers, rollback, or restart health gating;
- recovery from a successful package install followed by startup failure.

The browser component test intercepts `/api/component-update` and simulates status transitions; it deliberately does not execute an updater. The component API tests are primarily regular-expression/static-source assertions. Current green tests therefore do not prove end-to-end update reliability.

## Recommended robust solution

### Recommendation: replace in-process root mutation with one transactional updater

Do not keep extending the three current paths independently. Introduce one update planner/executor used by every WebUI update action, with an external bootstrap process for activation.

### Required architecture

#### 1. One inventory and one immutable plan

Create a planner that returns a serializable plan containing:

- transaction ID and creation time;
- active WebUI entrypoint/package root and exact version;
- active Pi command, realpath/package root, exact version, and ownership type;
- configured package inventory from Pi, not directory-name scanning;
- installation owner (`managed-webui-runtime`, `pi`, `npm`, `pnpm`, `yarn`, `bun`, `source`, or `unknown`);
- exact target versions, registry URLs, integrity hashes, commands, writable roots, required disk space, and restart policy;
- unsupported/ambiguous topology reasons.

The user confirmation must be bound to this exact plan. Execution must use exact versions such as `package@0.84.1`, never a new `@latest` lookup.

#### 2. Fail closed on ambiguous ownership

| Installation | Automatic behavior |
|---|---|
| Managed WebUI runtime | Stage and switch transactionally |
| Bundled Pi inside managed WebUI runtime | Treat as part of the compatible core bundle |
| Explicit/independent Pi | Delegate to that exact Pi executable's updater; verify same realpath/version afterward |
| Pi-managed optional packages | Delegate only to Pi package management; record per-package results |
| npm/pnpm/Yarn/Bun global install not yet migrated | Use an owner-specific adapter only after proving ownership/root; otherwise show exact manual command |
| Source checkout | Refuse automatic mutation and show source workflow |
| Unknown or mixed owner | Refuse; never guess |

Remove the broad direct scan of agent/project/global roots from the default update path. Pi should own Pi-registered packages. A future Pi machine-readable package API is preferable to WebUI filesystem inference.

#### 3. Side-by-side staging for WebUI and bundled Pi

A small stable launcher/updater outside the package being replaced should:

1. download/install exact versions into `~/.pi/webui/runtimes/<transaction-id>/`;
2. verify package names, versions, integrity, required files, Node engine, and compatible Pi/WebUI versions;
3. run syntax checks and a candidate `--self-test`/health probe on a temporary loopback port;
4. atomically replace a small `current.json` pointer (or equivalent platform-safe pointer) only after validation;
5. start the candidate and wait for expected `/api/health` identity;
6. keep the previous runtime and restore the pointer if startup fails;
7. garbage-collect old versions only after a retention window.

Side-by-side installs avoid overwriting files used by running Node/native modules and work better on Windows than replacing the live package directory.

#### 4. Durable lock and transaction journal

Store a private journal such as `~/.pi/agent/webui/updates/<transaction-id>.json` with states:

```text
planned -> preflighted -> staging -> verified -> activating -> healthy
                                              -> failed
                                 activating -> rolled-back
```

Use a cross-process lock tied to install identity, with PID/start-time/nonce metadata and stale-lock recovery. Persist every step before executing it. On startup, reconcile incomplete transactions before allowing another update.

#### 5. Verify every changed target

A successful result requires:

- active WebUI launcher resolves to the expected runtime;
- `/api/health` reports the expected WebUI and Pi versions;
- exact active Pi `--version` matches the plan;
- Pi package inventory confirms intended package versions/registration;
- no package-manager child remains active;
- migration marker corresponds to a proven WebUI version transition.

Return `partial` rather than `success` when independent package updates have mixed outcomes.

#### 6. External restart/rollback supervision

The updater/launcher—not the package being replaced—must own activation. The old server should stay available until the candidate is ready to bind, or a stable supervisor should proxy/swap after candidate health. If health fails, retain the old runtime and provide a one-click/manual rollback receipt.

#### 7. Machine-readable Pi update contract

The clean long-term boundary is an upstream Pi API/CLI such as:

```text
pi update plan --json
pi update apply --plan <file> --json
pi update verify --plan <file> --json
```

It should expose install ownership, exact versions, package roots, package-manager commands, progress, and postconditions. WebUI should orchestrate and render this contract, not reconstruct Pi package-manager rules.

## Suggested rollout

### Phase 0 — urgent correctness patch

1. Route legacy Pi-only updates through the same active-runtime planner used by targeted **Update Pi**.
2. Verify active Pi after every legacy Pi update and before restart.
3. Verify targeted WebUI's installed package version before reporting success.
4. Disable legacy direct root scanning by default; keep it behind an explicitly labeled expert/manual mode until ownership adapters exist.
5. Refuse automatic source-checkout mutation in every path.
6. Use process-tree termination for timed-out update commands.
7. Clear or classify pending migration state when WebUI mutation never completed.

### Phase 1 — unify and make recoverable

Extract the updater from `pi-webui.mjs` into focused modules, for example:

```text
lib/update/inventory.mjs
lib/update/plan.mjs
lib/update/owners.mjs
lib/update/executor.mjs
lib/update/journal.mjs
lib/update/verify.mjs
```

Make all endpoints use the same plan and durable cross-process lock. Add exact-version and failure-injection integration tests.

### Phase 2 — side-by-side managed runtime

Add the stable launcher/updater and migrate supported installations to a private versioned WebUI runtime root. Retain one or two known-good versions and implement health-gated activation/rollback.

### Phase 3 — upstream Pi integration

Adopt a machine-readable Pi update plan/apply/verify contract and delete WebUI's direct Pi-package root scanner.

## Required acceptance tests for the replacement

1. Default topology with both bundled Pi and a different PATH Pi: only the active bundled runtime changes.
2. Explicit `--pi`: only that realpath changes and is verified.
3. npm, pnpm, Yarn, and Bun global fixtures: correct owner adapter or explicit fail-closed result.
4. Source checkout: no files change.
5. Exact target moves after planning: execution still installs the confirmed version.
6. Network loss during download: old runtime remains active.
7. Permission/disk failure during staging: no activation occurs.
8. Crash at every journal phase: restart reconciles safely.
9. Two WebUI processes: only one acquires the install lock.
10. Timeout with spawned descendants: the whole process tree terminates.
11. Candidate syntax/startup/health failure: automatic rollback succeeds.
12. Command exits zero without changing version: verification fails.
13. WebUI succeeds but one optional package fails: result is `partial`, with per-package receipts.
14. Windows test with loaded native dependency: side-by-side update succeeds without replacing the live directory.

## Final recommendation

**Implement Phase 0 immediately, then move to the side-by-side transactional design.** The current `c2aa8da` fix is valuable but local: it makes the targeted bundled-Pi action safer without resolving the legacy wrong-target path, package-manager ownership, atomicity, restart rollback, or end-to-end verification.

Until Phase 0 lands, the most dependable operational policy is:

- use targeted **Update Pi**, not legacy **Update Pi & restart**, when WebUI has a bundled Pi runtime;
- update WebUI with the package manager that installed it, then restart manually;
- let Pi update Pi-registered/optional packages;
- avoid **Update Pi + Packages & Restart** for mixed, linked, pnpm/Yarn, source-checkout, or otherwise ambiguous installations.
