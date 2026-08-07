# Robust WebUI Update System

Status: approved for implementation
Classification: complex
Integration owner: parent Pi session (`PI_SESSION_ID=019fdc2c-c5cc-7b37-b5b6-6db07877ef37`)
Baseline: `c2aa8dac7f9cabe61e8c56c6f3c6b89a8000d762`
Source recommendation: [`../../docs/webui/research/webui-update-system-recommended-implementation.md`](../../docs/webui/research/webui-update-system-recommended-implementation.md)
Final report: [`../../reports/webui-update-system.html`](../../reports/webui-update-system.html)

## Classification rationale

The preliminary classifier selected `complex`, and repository evidence confirms it. The work has at least two meaningful implementation slices, crosses the WebUI server, browser, launcher, package-manager, process, persistence, and restart contracts, introduces durable transaction state and a managed-runtime migration path, and carries material reliability and Windows safety risk. The required behavioral tests also benefit from distinct transactional-core and integration/activation ownership.

## Verified diagnosis

The recommendation is directionally correct. Current evidence confirms:

- Tab spawning and active-version measurement prefer the bundled runtime through `resolvePiCommand()`, while the legacy updater can prefer PATH Pi through `resolvePiUpdateCommands()`.
- Only the Pi component path verifies a post-update version; WebUI and legacy success can still mean only exit code 0.
- Legacy all-update scans source, agent, project, npm-global, and Bun-global roots without proving ownership.
- Update state and exclusion are process-local.
- Timeout kills only the direct child in the updater despite an existing process-tree utility.
- Restart uses a fixed delay and the browser accepts any health response within roughly 20 seconds.
- Restore descriptors are capped at 30 and passed directly in an environment variable.
- No immutable plan, journal, cross-process lock, side-by-side runtime, health-gated activation, or rollback exists.

Architecture verification found one material omission in the recommendation: `current.json` is inert unless both the npm CLI and `/webui-start` route through a stable pointer-aware launcher, and a normal temporary-port server boot has unwanted RPC/tab/migration side effects. The implementation below corrects those omissions rather than following phase 2 verbatim.

## Outcome and measurable success criteria

Deliver one verified update engine for active Pi and WebUI updates.

1. Tab launch, planning, update targeting, and verification use one canonical active-runtime identity; a separate PATH Pi is reported but untouched.
2. Update confirmation binds to a persisted exact-target plan digest; apply never re-resolves `@latest`.
3. Source, pnpm, Yarn, linked, opaque, or unknown owners fail closed with bounded manual guidance; automatic broad root scanning is removed.
4. Every changed target is re-read and verified. Exit 0 without the promised version or any version change is failure.
5. Update command timeout terminates the whole process tree and waits for command closure.
6. A private atomic journal and cross-process install lock survive crashes and reject concurrent writers.
7. Core outcomes support `success`, `partial`, `failed`, and `rolled-back` with per-target receipts.
8. `/api/health` exposes a random per-boot identity. Browser restart success requires a changed identity within a visible budget of at least 90 seconds.
9. Restart descriptors travel through a private bounded read-once temp file and support at least 125 tabs.
10. Startup retries `EADDRINUSE` with bounded backoff.
11. Managed WebUI candidates stage under the agent directory, are verified without attaching to the live RPC supervisor, and activate through a stable launcher/helper with atomic pointer rollback.
12. Source checkouts and the live runtime tree remain byte-unchanged on refused or failed staging paths.
13. Focused unit/subprocess/browser tests cover the recommendation's 16 acceptance scenarios to the highest locally achievable rung; Windows-only omissions are explicit.
14. The full WebUI package check passes, or every unrelated/pre-existing failure is isolated and recorded.

## Scope

- Phase 0 correctness and restart hardening.
- Phase 1 exact-target plans, fail-closed ownership, journals, lock, reconciliation, receipts, and unified verification.
- Phase 2 pointer-aware managed runtime, side-effect-free candidate probe, stable activation helper, health gate, rollback, and retained previous runtime.
- Backend API, browser confirmation/reconnect/receipts, launcher integration, documentation, and focused tests.

## Non-goals

- Upstream implementation of `pi update plan/apply/verify --json` (phase 3).
- Automatic pnpm/Yarn/source/linked-install mutation.
- Full transitive dependency reproducibility beyond exact top-level target versions and recorded package metadata.
- Zero-downtime proxy promotion; rollback restores reachability after a bounded interruption.
- Killing healthy managed Pi/RPC work merely to force a runtime-version convergence.
- Publishing, installing, releasing, pushing, or changing user/global Pi configuration.
- Modifying the three untracked research inputs.

## Approved decisions and invariants

1. **Managed launch contract:** both the package CLI and `/webui-start` route through a minimal pointer-aware launcher. The installed package becomes a stable bootstrap; managed candidates are side-by-side runtimes.
2. **Stable activation boundary:** a narrow helper under the stable bootstrap package owns pointer switch, shutdown/start, health gate, and rollback. It is separate from `pi-webui-rpc-supervisor.mjs` and never lives only inside the candidate.
3. **Candidate probe:** use a dedicated side-effect-free probe mode; do not start normal tabs, attach/fence the RPC supervisor, run migrations, open a browser, or mutate durable settings on a temporary port.
4. **Update All semantics:** automatic scope is active Pi, active WebUI, and explicitly Pi-owned registered optional packages. Heuristic package roots become refusals/manual instructions.
5. **Private state root:** use `<PI_CODING_AGENT_DIR>/webui`, defaulting to `~/.pi/agent/webui`, with `runtimes`, `updates`, `locks`, and private temp state beneath it.
6. **Plan immutability:** exact top-level versions, resolved identities, registry, strategies, refusals, and a canonical digest are immutable after confirmation. Do not claim frozen transitive resolution.
7. **Apply contract:** a client supplies only `transactionId` plus `planDigest`; server-owned plans supply paths, commands, registries, and versions. Active identities and ownership are revalidated after lock acquisition.
8. **Explicit Pi:** resolvable explicit executables may delegate only to that exact executable and must verify the same canonical identity. Opaque/non-normalizable executables refuse automatically.
9. **Continuity policy:** if the live RPC supervisor is protocol-major incompatible, activation refuses rather than terminating healthy work. Health reports the runtime selected for new tabs; already-running tabs may retain older loaded code.
10. **Availability language:** automatic rollback restores service after bounded interruption; zero downtime is not promised.
11. **Retention:** keep current plus previous known-good runtime; retain one additional healthy runtime for seven days when disk cleanup permits. Never collect current, previous, locked, journal-referenced, or running roots.
12. **Rollback UX:** automatic rollback is mandatory. A localhost-only, confirmation-bound manual rollback receipt may be exposed after successful activation.
13. **Restore files:** random private filename, owner-only permissions where supported, bounded schema/size, read once, delete after parse, and stale sweep.
14. **Security:** retain localhost-only mutation routes, strict request validation, argument-array spawning, bounded secret-redacted results, no real package-manager/registry writes in tests, and no child subagent fanout.
15. **One writer per shared tree:** implementation workers run sequentially. Workers do not edit this plan or the final report.

## Assumptions

- The user authorization to “verify and implement” approves the documented phases 0–2 and the repository-compatible corrections above.
- The existing installed package may remain as the stable bootstrap while the active server/runtime version advances through the private pointer.
- Exact target metadata is available from the same configured endpoints used by update status; plan creation fails closed if a required target cannot be resolved.
- Tests use injected fake registries/package managers and temporary agent directories.

## Explicitly rejected or deferred options

- Extending the current three independent update paths: rejected because resolver, verification, and persistence drift already caused false success.
- Keeping broad root scanning behind the normal Update All button: rejected because visibility does not establish ownership safety.
- Normal temporary-port server startup as candidate verification: rejected because it can create tabs and a separate RPC supervisor.
- Reusing the RPC supervisor for activation: rejected as unrelated lifecycle/security coupling.
- In-place rename swap of loaded runtime files: rejected because it retains Windows lock and mid-swap spawn failure classes.
- Full transitive immutability: deferred pending integrity/lock design beyond the source recommendation.
- Phase 3 upstream Pi CLI contract: deferred external work.

## Execution DAG and ownership

The dirty tree contains only user-owned untracked research inputs, so automatic worktrees are not allowed. Writers run sequentially in the shared tree. One orchestration request must statically declare both implementation workers.

### Wave 0 — baseline

Integration owner records Git state and runs focused existing updater tests before writes.

### Wave 1 — WS-A: pure update domain and transaction core

Owner: implementation worker A (first sequential worker run)

Write boundary:

- `pi-package-webui/lib/update/resolver.mjs`
- `pi-package-webui/lib/update/owners.mjs`
- `pi-package-webui/lib/update/plan.mjs`
- `pi-package-webui/lib/update/executor.mjs`
- `pi-package-webui/lib/update/verify.mjs`
- `pi-package-webui/lib/update/journal.mjs`
- `pi-package-webui/tests/update-resolver.test.mjs`
- `pi-package-webui/tests/update-owners.test.mjs`
- `pi-package-webui/tests/update-plan.test.mjs`
- `pi-package-webui/tests/update-executor-process-tree-harness.test.mjs`
- `pi-package-webui/tests/update-verify.test.mjs`
- `pi-package-webui/tests/update-journal-harness.test.mjs`
- `pi-package-webui/tests/fixtures/update/**`
- `plans/handoffs/webui-update-system-core.md`

Deliverables:

- Canonical active-Pi/WebUI identity and separate-PATH detection.
- Fail-closed owner/refusal model.
- Canonical exact-target plan/digest.
- Bounded tree-killing executor with injected command runner seams.
- Verification/result reducer with partial receipts.
- Private atomic journal, lock, and interruption reconciliation primitives.
- Behavioral module/harness tests using only temporary fixtures.

Validation:

- Syntax-check all new modules.
- Run each new focused test/harness.
- `git diff --check` for its boundary.

Forbidden/shared paths: all existing server/browser/package files, this plan, final report, and research inputs.

Handoff: `plans/handoffs/webui-update-system-core.md` with run identity/status, base/result revision, changed files, commands and exit codes, omissions, deviations, unresolved decisions, risks, and integration notes.

Stop/escalate on any need to alter approved schemas, dependencies, ownership policy, security boundary, or files outside the boundary.

### Wave 2 — WS-B: backend, launcher, activation, browser, and end-to-end integration

Owner: implementation worker B (second sequential worker run, after WS-A handoff exists)

Write boundary:

- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/bin/pi-webui-launcher.mjs`
- `pi-package-webui/bin/pi-webui-update-supervisor.mjs`
- `pi-package-webui/lib/update/supervisor.mjs`
- `pi-package-webui/lib/component-update-state.mjs`
- `pi-package-webui/lib/update-commands.mjs`
- `pi-package-webui/index.ts`
- `pi-package-webui/package.json`
- `pi-package-webui/public/app.js`
- `pi-package-webui/public/index.html`
- `pi-package-webui/public/styles.css`
- `pi-package-webui/public/service-worker.js`
- `pi-package-webui/README.md`
- existing update/restart static and browser tests
- new `pi-package-webui/tests/update-api-harness.test.mjs`
- new `pi-package-webui/tests/update-lock-multiprocess-harness.test.mjs`
- new `pi-package-webui/tests/update-supervisor-harness.test.mjs`
- new `pi-package-webui/tests/update-tab-restore-harness.test.mjs`
- new `pi-package-webui/tests/browser/update-reconnect.spec.mjs`
- `plans/handoffs/webui-update-system-integration.md`

Deliverables:

- Replace divergent embedded resolver/update logic with WS-A contracts.
- Add plan/apply/status/rollback HTTP contracts and startup reconciliation.
- Remove broad root-scan execution and invalid npm flag paths.
- Add boot identity, identity-gated reconnect, 90-second progress, listener retry, and private high-cardinality restore handoff.
- Add stable launcher, side-effect-free candidate probe, managed runtime pointer, activation helper, health gate, rollback, and safe retention.
- Bind browser confirmation to plan digest and render refusals/receipts.
- Replace obsolete static assertions with behavioral/public-contract coverage and update README.

Validation:

- Syntax-check changed/new server, launcher, supervisor, and browser files.
- Run focused update API, lock, supervisor, restore, component, and reconnect tests.
- Run `npm --prefix pi-package-webui test` and `npm --prefix pi-package-webui run check` when feasible.
- `git diff --check`.

Forbidden/shared paths: WS-A module/test files, this plan, final report, research inputs, and unrelated packages.

Handoff: `plans/handoffs/webui-update-system-integration.md` with full worker contract evidence.

Stop/escalate rather than editing WS-A files or inventing a new product/architecture/security/dependency decision.

### Wave 3 — central integration

The integration owner inspects both actual diffs and handoffs, verifies write boundaries, resolves only against approved decisions, makes bounded integration fixes when necessary, and runs affected plus cross-workstream checks. No worker completion claim is accepted without direct inspection.

### Wave 4 — independent review quorum

Two distinct read-only, fresh-context reviewer runs inspect the integrated result. Provider families must differ from each other and from the implementation provider when available. Each covers architecture, correctness, security, edge cases, tests, maintainability, Windows/process behavior, and plan compliance. Every finding is independently verified and dispositioned in this plan as `accepted`, `rejected`, `deferred`, or `needs verification`.

### Wave 5 — accepted fixes, report, and acceptance

Only accepted findings are fixed. Revalidate affected and cross-workstream checks, create the linked self-contained HTML report, run final acceptance, and archive this plan only after all mandatory gates pass or an explicit user waiver is recorded.

## Acceptance checks

### Focused baseline/current checks

- `node pi-package-webui/tests/update-commands.test.mjs`
- `node pi-package-webui/tests/npm-command.test.mjs`
- `node pi-package-webui/tests/component-update-state.test.mjs`
- `node pi-package-webui/tests/component-update-api-static.test.mjs`
- `node pi-package-webui/tests/control-deck-component-updates-static.test.mjs`

### New domain checks

- Resolver fixtures: bundled vs PATH, explicit Pi, slow/missing/unsupported shim.
- Owner fixtures: npm/Bun accepted; pnpm/Yarn/linked/source/unknown refused with guidance.
- Plan digest and moving-latest test.
- Whole-process-tree timeout test with delayed descendant write sentinel.
- Verification no-change failure for Pi and WebUI.
- Journal atomicity, crash-state reconciliation, and lock contention.

### New integration checks

- Source checkout zero mutation across every route.
- Two WebUI processes: one install lock winner.
- Candidate syntax/startup/health failure restores previous pointer and reachability.
- Candidate probe causes no RPC/tab/migration/settings side effects.
- Boot-identity reconnect ignores the old server.
- At least 125 tabs restore from the private file and the file is deleted.
- Partial core/optional result retains ordered per-target receipts.
- Pointer containment, malformed/escaping pointer, current/previous retention, and rollback.
- Windows process tree and loaded-file/rename contention when executable in the current environment.

### Cross-workstream checks

- `npm --prefix pi-package-webui run check`
- focused Playwright update specs
- `git diff --check`
- inspect final Git status for unrelated or user-owned changes

## Integration and rollback guidance

Integration order is WS-A, WS-B, central fixes, full validation, review, accepted fixes, report. The runtime feature is fail-closed: no pointer switch until candidate verification succeeds; the activation helper persists `activating` before switching, restores `previous` on health failure, and journals `rolled-back`. Source/unknown owners never mutate. Code rollback is a normal revert of the feature changes; persisted plans/journals are versioned and ignored safely by older code. The stable launcher falls back to the installed package when the pointer is absent, malformed, escaping, or incomplete.

## Risks

- The pointer-aware launcher becomes a long-lived compatibility boundary.
- The installed extension entrypoint can outlive the managed server runtime; launcher and RPC protocol compatibility must remain backward-compatible.
- Windows rename, antivirus, loaded native modules, and process-tree semantics need real Windows evidence.
- PID reuse makes aggressive stale-lock recovery unsafe; uncertain locks fail closed.
- `--ignore-scripts` can omit native setup; receipts and candidate probes must expose/reject unusable candidates.
- Rollback after irreversible data migration would be unsafe; migrations remain after proven mutation/activation boundaries.
- The very large server/browser files increase integration risk; behavioral harnesses must replace shape-only confidence.
- Full phase 2 may reveal an unapproved packaging constraint. If so, stop at that gate and request a scoped decision rather than weakening the architecture.

## Decision and progress record

- 2026-08-07: User authorized verification and implementation of the recommendation.
- 2026-08-07: Feature and delegation policies loaded; repository baseline and user-owned untracked inputs recorded.
- 2026-08-07: Repository mapping and two independent read-only audits confirmed the preliminary `complex` classification and the split resolver, asymmetric verification, broad unsafe scan, process-local state, timeout, restart, and restore defects.
- 2026-08-07: Architecture audit approved phase 0, conditionally approved phase 1, and required a pointer-aware launcher, stable activation helper, and side-effect-free candidate probe before phase 2 could be approved.
- 2026-08-07: Integration owner approved the corrected managed-launch, Update All, private-root, continuity, retention, and bounded-availability decisions recorded above. No blocking product decision remains before implementation.
- 2026-08-07: Initial raw `subagent` advisory workflow was rejected before launch by the static fanout guard. A compliant two-slot `subagent_gate` read-only design audit then produced both required advisory outcomes; this does not count toward implementation-worker outcomes.

## Worker outcomes

Pending.

## Integration evidence

Pending.

## Independent review findings and dispositions

Pending.

## Final report and acceptance verdict

Pending. The report path is [`../../reports/webui-update-system.html`](../../reports/webui-update-system.html).

## Completion checklist

- [ ] Two qualifying implementation-worker outcomes inspected and integrated.
- [ ] Affected and cross-workstream validation current.
- [ ] Two qualifying provider-diverse fresh read-only reviewer outputs obtained, or an explicit scoped waiver recorded.
- [ ] Every reviewer finding disposition recorded and accepted fixes revalidated.
- [ ] Current self-contained HTML report mutually linked with this plan.
- [ ] Plan archived only after all non-waived completion gates pass.
