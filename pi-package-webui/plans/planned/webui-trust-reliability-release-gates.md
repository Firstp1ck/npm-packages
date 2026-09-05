# WebUI trust boundaries, RPC reliability, and release gates

Status: proposed; planning and baseline checks complete; implementation not authorized or started.

Prepared: 2026-09-05.

Baseline: repository commit `8175e8cd0b3d8f2c860120a0bad0a7aedf46bc1f`, branch `main`, clean working tree before and after the baseline runs. Package version: `0.10.4`. Node: `v22.23.2`.

Planning owner: main Pi session, working directly without delegated planning.

## Purpose and authority

Make requests to WebUI pass a consistent trust boundary, prevent a broken Pi pipe from hanging a tab or crashing the server, and make the test gate reliable enough to support subsequent interaction-performance work.

This is a new plan derived from current source, current fixtures, fresh test runs, and an isolated HTTP probe. Earlier plans are treated as outdated and are not inputs, dependencies, or evidence. Their files are left untouched.

The user's authorization covers producing this plan. It does not authorize implementation, authentication changes on a running server, network exposure, dependency installation, publication, deployment, or repository-host settings changes. The implementation decisions below are proposals to approve with the implementation scope.

All paths below are relative to `pi-package-webui/` unless explicitly marked repository-relative. Source symbols are the durable anchors; line numbers refer to the baseline above.

## Recommended delivery

Deliver the work in bounded stages:

1. Repair the known static-test revision mismatch and establish a failure ledger.
2. Introduce central request admission, including compatible updates to first-party HTTP callers.
3. Harden remote PIN admission and preserve manual and QR login compatibility.
4. Bound direct-mode RPC writes and handle pipe failures deliberately in both execution modes.
5. Resolve the browser baseline and establish a required local/CI gate.
6. Only then measure tab switching and resizing and select one justified optimization.

Stages 1–5 form the proposed reliability release. Stage 6 is a separate, measurement-only follow-up, not permission for a performance rewrite. Targeted security fixes need not wait for unrelated browser repairs, but the combined release must satisfy the final gates.

## Fresh baseline and evidence limits

### Checks actually run

| Check | Current result | Meaning |
| --- | --- | --- |
| `npm run check` | Exit 1; 21 of 202 test files failed, 181 passed | The configured syntax chain completed. Every reported failing file stopped at an assertion expecting stylesheet revision `152`; `public/index.html` now references `153`. Further failures could be masked until these assertions are repaired. |
| `npm run test:browser -- --project=chromium --workers=2` | Exit 1; 104 passed, 17 failed, 9 did not run; 4.1 minutes | One current full Chromium run, not a flake-rate estimate. Unexecuted tests are not passes. |
| Isolated HTTP probe against fake Pi | Cross-site plain-text model mutation: 200; unrecognized Host with matching Origin: 200; same-origin JSON control: 200 | Fake Pi logged three `set_model` commands. The invalid requests reached command dispatch, not just a permissive response handler. |
| Twelve incorrect PIN attempts against the isolated server | Twelve 403 responses; no `Retry-After`, no 429 | Confirms unthrottled validation in that sequence. This was loopback testing, not a distributed or LAN load test. |
| Git state before/after tests | Clean, unchanged HEAD | No production changes were made while planning. |

The HTTP probe used a random loopback port, a temporary working directory, temporary settings and agent directory, `PI_WEBUI_RPC_SUPERVISOR=0`, and `tests/fixtures/fake-pi.mjs`. It changed only the fake model, never executed a real shell command, never opened LAN access, and removed its temporary server state afterward. It supplied HTTP headers directly; it did not demonstrate exploitability in a real browser under that browser's private-network policies.

Local diagnostic artifacts, not durable completion evidence:

- `/tmp/webui-plan-check-pLFY6Q.log`
- `/tmp/webui-plan-browser-jRKzs8.log`
- `/tmp/webui-fresh-plan-request-probe.mjs`
- Playwright failure artifacts under `test-results/`, which later runs may overwrite.

The summarized observations in this plan survive those temporary files. Implementation must add committed regression tests instead of depending on the temporary probe. Do not publish raw fixture logs without checking for temporary PINs, cookies, paths, and other sensitive values.

### Current-source findings

| ID | Finding and current anchor | Consequence | Confidence |
| --- | --- | --- | --- |
| H1 | `bin/pi-webui.mjs`: `createServer` at 16458, `readJsonBody` at 1261, generic POST dispatch near 17991 | JSON parsing is not central request authorization. The probe confirms that neither cross-site plain text nor an unrecognized Host stops the tested mutation. | 99/100 for server acceptance; browser exploitability not tested |
| H2 | `lib/trust-boundaries.mjs`: `isLocalRequest`, `requireLocalhostRoute`; server `requireAppendSystemRequest` near 15740 | Useful existing route guards must remain. Socket-local status does not establish that a request came from the trusted browser origin. | 98/100 |
| A1 | Server `generateRemotePin`, `enableRemoteAuth`, login branch near 16473 | Four decimal digits, seven-day cookie lifetime, and no attempt limiter in the handler. PIN generation already uses `randomInt` and comparison already uses `timingSafeEqual`; preserve both. | 99/100 |
| A2 | `../pi-package-remote-webui/lib/remote-core.mjs`: `openNetwork`, `closeNetwork`, `remoteAuthQrUrl` | The companion sends POSTs without JSON headers/bodies for network control and recognizes only four-digit QR PINs. Server-only hardening would break first-party compatibility. | 99/100 |
| R1 | Server `PiRpcProcess.writeRaw` near 1152, `attachJsonlReader`, `attachTextReader`, `start` | Direct mode waits on `drain` without a close/error/deadline race. ChildProcess errors are handled, but its stream readers and stdin lack dedicated pipe-error handling. | 98/100 from source; direct backpressure reproduction still required |
| R2 | `bin/pi-webui-rpc-supervisor.mjs`: `commitChild`, `write`, `command`; `tests/rpc-supervisor-host.test.mjs` | Supervised one-way writes already have a timeout and stdin error handling. Its host test passed and covers replacement after backpressure. Reader-error behavior and resource cleanup still need targeted assessment. | 98/100 |
| R3 | Server `shutdown` near 18111 and signal registration | Graceful shutdown exists, with a force-exit timer. Preserving sessions means detaching the supervisor; direct children are stopped even when preservation is requested. Do not promise equal survival in the two modes. | 98/100 |
| G1 | `package.json`, `tests/run-all.mjs`, `playwright.config.mjs` | Browser tests are a separate opt-in script. The test-file runner has no per-file timeout. Playwright retries once in CI. No active repository GitHub Actions workflows were found. | 98/100 |
| G2 | `public/index.html`, `public/service-worker.js`, current failed static tests | Many unrelated tests pin one CSS URL number. The service worker already uses bounded network-first fetching and offline fallback. Fix test coherence without replacing a working cache strategy. | 99/100 |
| P1 | `public/app.js`: `scheduleTabsRender`, `switchTab`, `updateSidePanelResize`, stream diagnostics | Tab renders already have an animation-frame coalescer; streaming already has PerformanceObserver diagnostics. Resize applies width on every pointer event. Potential interaction cost exists, but no interaction timing baseline was collected here. | 95/100 for structure; priority unmeasured |

### Browser failure inventory

These are fresh failures, not accepted diagnoses. Each needs a disposition based on an isolated rerun and current intended behavior.

| Spec | Failed cases in this run |
| --- | --- |
| `control-deck-side-panels.spec.mjs` | Right/Left/Both, sidebar rail, independent state, overlay, ARIA, reload |
| `controls-layout.spec.mjs` | Aligned controls and viewport-safe tooltips |
| `feature-decision-output-popup.spec.mjs` | Decision replay; legacy/malformed payload handling |
| `guided-git-fallback.spec.mjs` | Pre-response fallback lifecycle correlation |
| `interaction-continuity.spec.mjs` | Composer autosizing; output selection through settlement; tooltip/pointer/dropdown/stale-context continuity |
| `mobile-foundation.spec.mjs` | Legacy phone navigation; mobile continuity; tablet layout; desktop equivalence; sidebar actions |
| `persistent-ui-layout.spec.mjs` | Delayed GET versus newer acknowledged PUT |
| `session-summary.spec.mjs` | Inactive/grouped tab summary scope and busy state |
| `side-panel-section-reorder.spec.mjs` | Pointer and keyboard reorder persistence |
| `stream-output-isolation.spec.mjs` | Normal desktop stream; observed forbidden mutations on `span.run-indicator-elapsed` |

Do not automatically classify the elapsed-time mutations as harmless or weaken isolation assertions. Determine whether they are independent timer activity or stream-caused updates and encode that distinction behaviorally. Likewise, do not change element-count expectations until the intended UI is verified.

## Scope boundaries

### Included in the reliability release

- Central HTTP authority, origin, fetch-metadata, and mutation media-type admission.
- Compatibility updates for first-party clients affected by stricter admission or PIN length.
- Bounded, testable remote-login throttling and session lifetime.
- Direct RPC write deadlines, stream error handling, and cleanup tests.
- Careful assessment and bounded fatal-exit handling, without claiming recovery from unknown corrupted state.
- Static revision-test repair, browser-failure disposition, local verification commands, and CI configuration.
- User and contributor documentation for changes actually delivered.

### Not included

- A new routing/model-validation system, provider-usage integrations, onboarding, or other product additions.
- Arbitrary reverse-proxy or public-internet deployment support.
- Removal of currently supported authenticated remote shell behavior. Retain its warnings and existing route restrictions; changing that privilege is a separate product decision.
- Automatically enabling PIN protection or LAN access on existing installations.
- Global HTTP timeout/retry changes, two-hour prompt-contract changes, automatic command replay, or SSE transport migration.
- A frontend framework migration, complete server route-table rewrite, cache-policy replacement, or transcript virtualization.
- Automatic child restart, destructive session cleanup, or guarantees that direct-mode Pi children survive a server exit.
- Fixing every aesthetic or feature issue encountered by the browser suite. Escalate materially broader product changes.

## Design decisions proposed for implementation

### D1. One early HTTP admission boundary, existing route authorization afterward

Introduce a small testable policy module, proposed `lib/http-request-policy.mjs`. The server owns its configuration; the module performs pure normalization and decisions. The normal request path becomes:

```text
HTTP request
  -> validate request target and independently allowed Host authority
  -> apply origin / fetch-metadata policy for this route class
  -> require allowed mutation media type before reading the body
  -> existing remote authentication
  -> existing localhost, feature, confirmation, and path guards
  -> bounded body parsing and schema validation
  -> handler / Pi RPC
```

Recovery and remote-login routes may have their existing specialized authentication ordering, but must not bypass authority/origin/media-type admission. Missing capability or parse failure is not permission to fall back to an unguarded route.

Policy requirements:

- Build the allowed authority set independently of the incoming Host. Include loopback authorities at the actual listening port, explicitly configured bind host/literal, and local interface addresses deliberately exposed through the network-open flow. Never admit `0.0.0.0` or `::` as a wildcard for arbitrary Host values.
- Normalize hostname case, IPv6 brackets, and effective port with one parser. Reject invalid/duplicate/conflicting Host values, userinfo, embedded delimiters, and a request-target authority that disagrees with Host. No per-request DNS resolution or trust in a hostname merely because it resolves to loopback.
- For an Origin that is present, compare the full normalized scheme/host/port against the independently admitted request origin. Reject `Origin: null`, malformed/multiple values, and cross-origin requests. Different localhost aliases are not interchangeable browser origins.
- For browser API traffic, reject explicit `Sec-Fetch-Site: cross-site` and `same-site`; same-site is not same-origin. Preserve same-origin traffic. Treat `none` according to the route/method, not as a universal authorization token.
- Permit native first-party HTTP clients without Origin/fetch metadata only when authority, media type, and existing authorization checks pass. Document that origin checks defend against browsers, not hostile software already running as the user.
- Require `application/json`, allowing charset parameters, for JSON mutation routes including login. A bodyless mutation is still required to declare JSON, and parsing may retain its existing empty-object behavior. Do not exempt empty POSTs by default.
- Inventory any genuinely non-JSON endpoints and encode exact method/path/media-type exceptions. No broad upload-prefix exemption. Check PUT/PATCH/DELETE as well as POST, and identify any GET route that actually mutates state.
- Apply authority validation to static documents and sensitive API reads as well. Normal direct navigation to the app must keep working; do not block every cross-site document navigation by treating it like an API mutation.
- Do not add permissive CORS responses. OPTIONS must not authorize a mutation, allocate a tab, or trigger Pi work.
- Do not trust `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-For`, or `X-Forwarded-Proto` from arbitrary requests. The first release targets direct loopback/LAN access. Stop for an explicit trusted-proxy design if a supported caller requires one.
- Return bounded machine-readable rejection codes, useful 4xx responses, and sanitized diagnostics. Do not echo cookies, PINs, tokens, or whole request bodies.

### D2. Migrate clients explicitly rather than weakening admission

Update the remote companion's `openNetwork`/`closeNetwork` calls to send a JSON declaration and `{}`. Inventory bodyless mutations in WebUI's extension, launcher, recovery tools, and tests; update each concrete caller.

Six-digit PINs require coordinated changes to server generation/validation, inline login form and hash reader, local UI copy, companion QR generation, and corresponding tests. The updated QR helper may accept the documented legacy four-digit form when displaying an older server, but the new server must generate and accept only its current six-digit PIN. No downgrade after validation failure.

Document the minimum compatible companion release. Old companion network-control requests should receive an actionable rejection rather than an unsafe exception. Implementation may change sibling source only within this identified compatibility boundary. Installation and publishing remain separate approvals.

### D3. Remote authentication has explicit bounded behavior

Proposed initial constants, centralized in a server-only module such as `lib/remote-auth-policy.mjs`:

| Setting | Proposed value / rule |
| --- | --- |
| PIN | Six zero-padded decimal digits from `randomInt(0, 1_000_000)` |
| Per-peer failures | Five failures in a 15-minute window; subsequent attempts return 429 until expiry |
| Global validation budget | Token bucket, burst 30 validations, refill 30/minute |
| Peer identity | Normalized socket peer address, including IPv4-mapped IPv6; never forwarded headers |
| Limiter storage | At most 4,096 peer records; expire idle records, retain live bans; if capacity is exhausted, reject untracked login attempts with 429 rather than bypassing limits |
| Authentication lifetime | Fixed 12 hours, not extended by ordinary requests |
| Reset boundaries | Fresh generation on enable/re-enable and network reopening; network close invalidates cookies/PIN and clears limiter state |

Additional rules:

- Apply admission and rate limits before PIN comparison or cookie issuance. Count malformed PIN submissions against the failure budget once their bounded body is parsed.
- Use an injected monotonic clock in limiter tests. Return integer `Retry-After` for the most restrictive active limit. Never hold an HTTP request open with long backoff sleeps.
- Successful login clears that peer's failure record but does not reset the global budget. Existing authenticated requests are not subjected to login throttling.
- Do not create an account-wide long lockout. Distributed attempts and shared NATs can still cause short denial of login; document this trade-off and allow local re-enable/close as the explicit recovery path.
- Keep PIN comparison timing-safe. Preserve `HttpOnly`, SameSite protection, no-store auth responses, and local-only PIN disclosure. Do not put credentials in query strings or logs added by this work. The QR PIN remains in a fragment and is removed before submission.
- Do not label plain HTTP LAN transport encrypted. Stronger PIN admission does not solve traffic interception; recommend trusted LAN or independently secured transport, not public exposure.
- Preserve the user's saved PIN-enabled preference. No automatic migration to open or closed network mode.

The six-digit format, 12-hour lifetime, and throttle values are deliberate proposed user-visible changes, not already-approved runtime settings. Approve them with Stage 3 or revise this decision table before implementation.

### D4. Separate write completion from Pi response completion

For `PiRpcProcess`, a one-way write succeeds when Node reports completion of that write, not when an unrelated `drain` happens or when Pi sends a response. A write callback does not prove that Pi processed the command.

Proposed contract:

- Capture the child and stdin instance for each write. Never let an old child's event resolve a new child's operation.
- Use a bounded write deadline, initially matching the verified supervisor one-way-write budget unless focused load tests justify a different value. Keep that constant separate from prompt/RPC-response deadlines.
- Race write completion against stdin error/close, child exit, cancellation where supported, and deadline. All paths settle exactly once and remove operation listeners/timers.
- Install long-lived stdin/stdout/stderr error handling promptly after spawn. Handle stream errors separately from ChildProcess errors and from the already-protected server stderr mirror.
- Make failed pending RPC requests settle once; a later reply or callback cannot resurrect them. Preserve wire order and exact one-way payloads.
- Do not hold an admission queue until a Pi response arrives. An extension UI answer must pass while the prompt that requested it is awaiting a response.
- Treat timeout or pipe failure after bytes were accepted as an indeterminate delivery, not proof of non-execution. Never automatically resend a prompt, shell command, or UI response. Keep the extension blocker unresolved unless delivery is acknowledged; surface a recoverable transport error and reconcile authoritative state on the user's next action.
- Bound further admission to a stalled pipe so concurrent requests cannot accumulate indefinitely. Specify and test byte/entry limits before introducing a queue; do not add an unbounded FIFO merely to serialize writes.
- Keep supervisor timeout, replacement, replay ownership, and response/admission separation intact. Improve shared helpers only where the two transports truly have the same contract.

Process-level handling is a safety net, not the primary fix. First fix the known stream failure paths. If adding fatal handlers, use one reentrant-safe, bounded shutdown path and fail nonzero rather than continuing after an unknown uncaught exception. Handle failures before initialization completes without temporal-dead-zone errors. Supervised children may be detached; direct children cannot be promised survival. Never send shutdown to a shared supervisor from a fatal server-only recovery path.

### D5. A green gate must mean behavior was checked

- Replace the 21 duplicated fixed-revision checks with one focused asset-coherence contract plus existing freshness/offline behavior tests. Keep each feature test's real layout or wiring assertions.
- The coherence test checks that referenced assets exist, module imports are covered by the app shell where required, revision references are internally valid, and served updated assets/offline fallback behave correctly. Do not just replace every `152` with `153`, delete test files, or accept any arbitrary URL without behavioral coverage.
- Do not change production asset routing, introduce immutable caches, or add a build framework in this stage.
- Add a local `test:all` command that runs syntax/static/harness checks and the complete required Chromium suite. Keep fast commands available for development.
- Give the Node test-file runner a configurable finite deadline, explicit timeout/error reporting, and correct child cleanup. Initial default: 180 seconds per file, with a documented larger allowance only for a named measured harness. A timed-out file fails the run.
- Use fixture-only CI with no production agent directory, credentials, account calls, or package publication. Provision dependencies from lockfiles. Current browser fixtures need an isolation audit before CI: some inherit environment/settings and some bind LAN addresses for auth tests.
- Create a repository-level GitHub Actions workflow for this package and the remote companion compatibility tests. Proposed matrix: Ubuntu, supported Node 22 and 24 lines; Chromium on both initially. Validate optional native dependency behavior and do not silently remove it to get green results.
- Read-only repository permissions, no deployment secrets, bounded job time, cancellation of superseded CI runs, and reviewed pinned action revisions. Cache dependency downloads, not private agent state.
- Produce one consistently named required result even when paths are unaffected, so a path-filtered workflow does not leave required checks pending. Include shared files/lockfiles that can affect the package.
- Configure branch protection only with separate owner approval. A committed YAML workflow alone is not proof that merging is gated.
- Retry-pass tests are classified as flaky, not indistinguishably green. The release baseline must pass twice consecutively with `--retries=0`; retain traces on failures and redact artifacts before upload.

## Implementation stages and exit criteria

### Stage 1. Baseline repair and test ownership

Allowed writes: affected test assertions, a focused asset-coherence test/helper, `tests/run-all.mjs` if the timeout is needed to bound subsequent checks, contributor documentation, and the execution ledger.

Tasks:

- Preserve the current baseline results and inspect each of the 21 fixed-revision failures.
- Consolidate revision checks without removing behavior assertions.
- Rerun all 202 files, record any newly exposed failure separately, and build a browser-failure ledger with test, symptom, expected behavior, cause, owner, proposed fix, and verification.
- Isolate each browser failure; repeat suspected timing cases without increasing arbitrary sleeps.
- Record actual fixture cleanup and environment isolation before adding CI.

Exit: static/harness gate green, or every unrelated residual failure explicitly recorded before any security-only interim patch. No security or RPC change can add an unexplained failure. The final release still requires the complete gate green.

### Stage 2. Central request admission

Prerequisites: approve D1/D2, confirm allowed access modes and first-party caller inventory.

Allowed writes: new HTTP policy module and tests, narrow server admission wiring, affected native/client callers, remote companion bodyless-POST migration, corresponding docs.

Required acceptance:

- The baseline cross-site `text/plain` request and attacker-authority request return a bounded 4xx and send zero commands to fake Pi.
- Same-origin JSON, IPv4/IPv6 loopback, approved LAN origins, login page, SSE, PWA navigation, and first-party native JSON requests remain functional.
- Wrong port, null/malformed Origin, same-site sibling origin, conflicting authority, spoofed forwarded headers, and CORS preflight cannot admit mutations.
- Test unauthenticated and authenticated requests. Possessing a valid remote cookie does not bypass origin or localhost rules.
- Test a localhost-only mutation, ordinary RPC mutation, login, recovery-token callback, bodyless native operation, PUT preference save, and a representative non-POST handler.
- Rejections happen before body/RPC/resource side effects, including tab creation, network rebinding, filesystem writes, and spawn-budget changes where applicable.

Exit: policy unit matrix, HTTP harness, companion compatibility tests, and focused browser normal-path checks pass. A real browser cross-origin test is added; the planning probe alone is not its substitute.

### Stage 3. Remote PIN admission

Prerequisites: Stage 2 accepted; approve D3 constants and the coordinated companion compatibility boundary.

Allowed writes: server-only auth policy, server login/status/form wiring, local browser copy, companion QR handling, tests and docs.

Required acceptance:

- Six-digit generation includes leading-zero coverage. Invalid formats never authenticate.
- Fake-clock tests cover exactly five failed comparisons, the next request rejected, window expiry, success reset, capacity bounds, global exhaustion/refill, and IPv4-mapped address equivalence.
- 429 includes `Retry-After`; no login-side sleep or unbounded map growth.
- Same peer cannot reset limits by spoofing forwarded headers. Many peers cannot bypass the global budget.
- Login grants a cookie with the proposed fixed lifetime. Expiry, re-enable, close, and reopen invalidate old cookies. Existing authenticated use continues while login is rate-limited.
- Manual login and QR login pass for the coordinated versions; older companion behavior fails actionably, never weakens server validation.
- PIN/cookie are absent from remote status, error responses, telemetry, and stored settings. Local authorized disclosure remains available.

Exit: auth unit/harness matrix, manual/QR browser scenarios, companion tests, and docs agree on exactly one policy.

### Stage 4. RPC pipe lifecycle

Prerequisites: record direct/supervised mode contracts and the verified supervisor timeout constant; no dependency on a global HTTP retry feature.

Allowed writes: bounded direct `PiRpcProcess` extraction/helper if necessary, server transport wiring, narrowly required supervisor reader/error handling, transport fixtures/tests, contributor docs.

Required acceptance:

- Fake stdin pauses reading, rejects a write, closes before completion, exits during a write, and stays permanently backpressured. Every direct operation resolves or rejects within its bound.
- Test true/false return values from `write`, synchronous throw, asynchronous callback error, callback/exit race, and callback after timeout.
- Repeated failure cycles leave no growth in pending entries, timers, or stream listeners.
- An unanswered prompt does not prevent its extension UI response from being written.
- A write timeout does not cause duplicate commands or a false `webui_extension_ui_resolved` event.
- Other tabs and `/api/health` stay usable after a known tab-local pipe error. Replacement/close is possible without replaying ambiguous work.
- Existing supervisor backpressure/replacement tests remain green. The protected stderr-mirror and oversized-JSONL tests continue passing.
- Fatal-handler tests, if that part ships, run in disposable processes and verify nonzero bounded exit, single cleanup, initialization safety, and supervisor ownership. Do not deliberately fault the developer's running WebUI.

Exit: focused direct/supervised transport tests and endpoint tests pass, with explicit residual delivery uncertainty documented. The operation is not described as exactly-once execution merely because callbacks settle once.

### Stage 5. Browser gate and release evidence

Prerequisites: accepted targeted security/RPC changes and a current failure ledger.

Allowed writes: narrowly justified browser bug fixes, affected fixtures and tests, package scripts, repository CI workflow, docs. Every production fix must have an explicit current-behavior rationale and avoid unrelated redesign.

Tasks and acceptance:

- Disposition every baseline failure as production defect, outdated expectation, fixture/isolation defect, or needs verification. Record evidence, not just a changed assertion.
- Run every previously unexecuted test; no hidden serial skip counts as completion.
- Complete harness isolation and cleanup before introducing CI. Prefer one small shared server fixture for new/changed tests; do not migrate every browser spec in the same patch.
- Add the local combined gate, runner bounds, and CI configuration from D5.
- Full syntax/static/harness and Chromium runs pass twice on the same integrated revision without retries. Record Node/browser versions, worker count, command, and outcomes.
- Capture at least one successful actual CI run before claiming CI works. Obtain separate branch-protection approval before claiming enforcement.

Exit: green local gate, green CI execution, all findings dispositioned, no undocumented skip/quarantine, and release documentation current. If the CI host cannot be exercised, report that gate as pending rather than pretending local success proves it.

### Stage 6. Separate interaction baseline, no speculative optimization

Start only after Stages 1–5 are accepted and this follow-up is separately authorized.

Measure tab activation, cached-content paint, structural tab renders, resize applications, storage writes, and main-thread long tasks. Reuse current diagnostics where appropriate and keep them local-only and off by default. Do not create a second `scheduleTabsRender` or rescan streaming work already handled by current modules.

Use deterministic small/large cases: 1 and 20 tabs, short and long tool-heavy transcripts, a busy subagent view, side-panel resize, and file-viewer resize. Include default desktop and narrow/coarse-pointer layouts. Use warmups and repeated interleaved samples on one browser/hardware profile; select sample count based on stability, with at least 30 measured samples for percentile claims. Save the fixture and before-change traces.

Only after measuring, propose one bounded patch:

- Coalesce resize writes once per frame if repeated pointer work is material; preserve final width, keyboard behavior, and cancellation/blur cleanup.
- Or narrow tab-render/refresh work if tab switching dominates; preserve outgoing-state capture before identity change and reject stale incoming responses.

Acceptance for selecting the next patch: a reproducible hotspot, a measurable target beyond baseline noise, a control scenario, explicit invariants, and a separate implementation approval. No blanket 30% speed claim, arbitrary debounce, virtualization, or cache eviction is authorized by this plan.

## Dependencies, ownership, and integration

```text
Stage 1: baseline repair and failure ledger
  -> Stage 2: request boundary + native caller compatibility
     -> Stage 3: PIN policy + QR compatibility
  -> Stage 4: direct/supervised RPC lifecycle
Stages 2 + 3 + 4 + browser failure fixes
  -> Stage 5: integrated gate, CI evidence, release decision
  -> separately approved Stage 6: interaction measurement
```

Default execution is sequential because the server and tests are shared. If delegation is later used, each worker receives an approved stage contract, exact write set, forbidden paths, validation commands, unique handoff artifact, and stop conditions. Concurrent writers require isolated worktrees and genuinely disjoint work. The main integration owner alone edits this plan and accepts results.

Potential narrow implementation files:

| Area | Existing files | Proposed additions |
| --- | --- | --- |
| HTTP admission | `bin/pi-webui.mjs`, `lib/trust-boundaries.mjs`, affected callers | `lib/http-request-policy.mjs`, policy unit and HTTP harness tests |
| Remote login | Server auth/form helpers, applicable `public/app.js` copy | `lib/remote-auth-policy.mjs`, focused limiter and login-browser tests |
| Companion compatibility | Repository-relative `pi-package-remote-webui/lib/remote-core.mjs` and its tests/docs | No new integration framework |
| RPC writes | `PiRpcProcess`, `bin/pi-webui-rpc-supervisor.mjs`, existing transport tests | Small reusable pipe-write helper and direct-mode fixture only if useful |
| Release gate | `tests/run-all.mjs`, `package.json`, `playwright.config.mjs`, affected static/browser tests | Asset-coherence test; repository-relative `.github/workflows/webui-checks.yml` |
| Evidence | This plan and contributor docs | Sanitized per-stage handoffs/results under `plans/evidence/webui-trust-reliability/` during execution |

Do not change `pi-subagents` or installed node_modules for this work. No protocol change is inferred from the fact that WebUI uses subagents elsewhere.

## Validation commands

Existing commands that are runnable today:

```bash
cd pi-package-webui
npm run check
npm run test:browser -- --project=chromium --workers=2 --retries=0
PI_WEBUI_RPC_SUPERVISOR=0 node tests/transport-hardening-harness.test.mjs
node tests/rpc-supervisor-host.test.mjs
node tests/durable-rpc-supervisor-harness.test.mjs
PI_WEBUI_RPC_SUPERVISOR=0 node tests/remote-auth-settings-harness.test.mjs
node tests/session-auth-harness.test.mjs
node tests/append-system-http.test.mjs
node tests/service-worker-lifecycle.test.mjs
```

Use isolated temporary settings/agent directories for new harnesses. Existing standalone scripts must be audited for their defaults before relying on them outside `tests/run-all.mjs`. Run companion tests using its verified package script after touching its code. The proposed `test:all` and new test filenames become runnable only after implementation; do not report them as existing gates now.

From the repository root:

```bash
git diff --check
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

CI adds supported-version coverage. Cross-engine or Windows parity cannot be claimed from Chromium/Linux checks alone. If touched behavior is meant to remain cross-platform, add targeted Windows transport/cleanup verification and a WebKit manual-login/origin pass before making that broader claim; unavailable environments remain explicit release limitations.

## Documentation and rollout

- README: retain visible trusted-network and remote-command warnings; update the normal login experience if PIN behavior changes.
- TECHNICAL: allowed access modes/authorities, native client requirements, PIN lifetime and throttling, QR compatibility, reauthentication, and recovery from timed-out writes. No internal request schemas or test commands.
- DEVELOPMENT: request-ordering contract, normalization rules, limiter state/clock bounds, RPC completion semantics, fixture setup, tests, CI, and failure dispositions.
- Remote companion docs: minimum compatible versions and QR/manual fallback behavior. Do not promise support until its matching tests pass.

Ship the boundary and caller changes together or document a required paired upgrade. Never bypass guards for an older client. The PIN change starts with a new process/auth generation and invalidates old cookies; disclose the reauthentication requirement. No schema migration should delete unrelated settings.

Rollback must not restore a verified request-admission weakness or disable throttling silently. Prefer correcting the specific compatibility rule or temporarily closing remote access with user approval. RPC rollback may return to the existing supervised path only through the normal documented mode selection, not an automatic process-mode switch. Preserve ambiguous-command records; do not replay them to recover UI appearance.

## Stop and escalation conditions

Stop the affected stage when:

- a supported deployment depends on forwarded headers or a reverse proxy whose trust identity is not defined;
- the remote companion cannot be changed or released compatibly within approved ownership;
- a security rule would remove a documented remote operation rather than guard its origin;
- a timeout fix would retry an ambiguous mutation, discard session state, or kill unrelated processes;
- browser failure repair requires changing product behavior beyond the approved boundary;
- a live account, credential, network-exposure change, package install, release, or branch-protection change is required without explicit approval.

Record the blocker and leave verified independent work intact. Do not broaden the plan silently.

## Completion and evidence rules

The reliability implementation is complete only when:

- Central admission rejects the reproduced invalid requests before side effects, and first-party normal paths pass.
- PIN policy, QR compatibility, lifetime, limiter bounds, and privacy assertions are tested.
- Direct and supervised RPC failure behavior is bounded without command replay or response/queue deadlock.
- All baseline failures and newly exposed failures have verified dispositions; the full required suites pass twice without retries.
- CI has actually run successfully; branch-protection enforcement is either verified after approval or explicitly left pending.
- Security and correctness review of the integrated result is recorded, with every finding accepted, rejected, deferred with rationale, or marked needs verification. Unresolved security/correctness blockers prevent release.
- User/contributor documentation and compatibility notes match what shipped.
- Remaining platform and deployment limitations are stated, and no production deployment is implied by local completion.

After implementation and its approved completion gates are verified, move this plan to `plans/archive/`, which is Git-ignored. Do not archive merely because this planning task is done. Stage 6 stays a separately approved follow-up; its optional status cannot be used to hide an unfinished reliability gate.

## Execution ledger

| Date | Work | State | Evidence |
| --- | --- | --- | --- |
| 2026-09-05 | Fresh code/fixture inspection and isolated HTTP probe | Complete | Source anchors and baseline tables above; main-agent work, no old-plan inputs |
| 2026-09-05 | Current static/harness and complete Chromium baseline | Complete with failures | 181/202 files passed; Chromium 104 passed, 17 failed, 9 not run |
| 2026-09-05 | Independent new plan | Proposed | This file; no implementation changes |
| Pending | Stages 1–5 | Not started | Awaiting implementation authorization and approval of proposed compatibility/authentication decisions |
| Pending | Stage 6 | Not started, separately gated | Requires green reliability gate and separate measurement authorization |

Planning confidence: **94/100**. Server acceptance and test failures are freshly reproduced; the direct/supervised transport distinction and companion requirements are verified in current source. Confidence is lower for end-to-end exploitability, exact browser failure causes, and performance priority because those were not established by this planning pass.
