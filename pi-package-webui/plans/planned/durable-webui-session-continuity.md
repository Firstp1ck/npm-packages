# Durable WebUI Session Continuity

Status: implementation pending  
Classification: complex  
Integration owner: primary Pi session  
Date: 2026-07-26

## Goal

Keep each active Pi RPC session and its in-flight execution running while the HTTP WebUI server restarts, then reconnect the replacement server without spawning a duplicate Pi process or losing ordered output.

## Classification rationale

The preliminary **complex** classification is retained. Repository evidence shows that the HTTP server currently owns each Pi child and its piped JSONL transport (`bin/pi-webui.mjs`), while restart restoration only creates fresh children from session files. Literal continuity therefore requires a new process boundary, authenticated reconnect protocol, event buffering, lifecycle migration, and cross-platform process tests. The work has at least two meaningful implementation slices and changes runtime, persistence, security, and restart contracts.

## Measurable success criteria

1. Restarting the HTTP server while a Pi turn is active leaves the original Pi PID alive and the turn completes.
2. The replacement server attaches to the existing managed tab instead of spawning a duplicate child.
3. Output emitted while no HTTP server is attached is replayed in supervisor sequence order without duplicate command delivery.
4. Existing tab ID, title, index, cwd, session file, and running state survive reattachment.
5. `POST /api/restart` and a successful `POST /api/update` preserve Pi sessions; explicit `POST /api/shutdown` and tab close terminate the intended managed children.
6. An abrupt HTTP-server death leaves supervised Pi sessions attachable on a same-scope restart.
7. App runners remain server-owned and stop during restart; this feature does not preserve them.
8. Legacy `PI_WEBUI_RESTORE_TABS` remains an empty-supervisor fallback and does not duplicate supervised tabs.
9. Supervisor credentials and launch environments never reach browser APIs, logs, journals, or Pi child environments.
10. Focused continuity tests, existing endpoint/transport/process-tree tests, package tests, syntax checks, and `git diff --check` pass or any unrelated baseline failure is explicitly attributed.

## Approved decisions and invariants

- The user requirement is interpreted literally: active execution must continue, not merely reopen a transcript or wait for idle before restarting.
- A small detached supervisor permanently owns Pi child stdin/stdout/stderr for each child's lifetime. Node cannot reconnect a new process directly to old anonymous stdio pipes.
- Transport is per-user local IPC: Unix-domain socket in an owner-private directory on POSIX and a Node named pipe on Windows. A private random bearer token and incarnation handshake are required in addition to local transport.
- The supervisor is deliberately narrow: spawn/stop Pi children, correlate commands, retain bounded ordered events, journal bounded tab metadata, and fence server controllers. Product/business logic stays in the WebUI server.
- Commands use client request IDs and supervisor-side deduplication. Routing to Pi is exactly once within the supervisor retention window; result delivery is at least once and deduplicated by sequence/request ID.
- One attached controller is authoritative per scope. A newer successful attach fences older writers.
- A scope is derived from the private agent/config root plus WebUI port. Continuity is guaranteed for a same-scope restart, not a port migration.
- Managed Pi sessions survive an orphaned HTTP server without an active-session TTL. The supervisor may exit only when it has no managed tabs and no client after a short idle grace.
- `POST /api/shutdown` is the explicit full-stop operation. `SIGINT` remains a full stop; controlled restart/update use preserve mode. An unexpected disconnect preserves sessions. `SIGTERM` is treated as restart-safe preserve mode so service-manager restarts can reconnect; explicit shutdown remains available for termination.
- App runners are excluded and are force-stopped in both preserve and terminate server shutdown paths.
- Session files remain the durable transcript source. The event ring covers only live downtime; a ring gap triggers an authoritative state/messages refresh and a truthful warning.
- A supervisor protocol-major mismatch with live children fails closed rather than replacing the supervisor or spawning duplicates. Additive minor revisions remain compatible.
- Existing uncommitted work is preserved. No worker may stage, revert, broadly format, or rewrite unrelated hunks.

## Scope

### Included

- Shared supervisor protocol and private runtime-state helpers.
- Detached Pi RPC supervisor and WebUI client adapter.
- Supervised tab creation, hydration, command/event routing, replacement, close, restart/update handoff, and explicit shutdown.
- Bounded event replay, sequence deduplication, gap recovery, and browser notices.
- POSIX Unix socket and Windows named-pipe path construction/behavior.
- Focused unit/host/end-to-end tests, package checks, README operations and rollback documentation.

### Non-goals

- Surviving supervisor death, OS reboot, or machine power loss with the same active model request.
- Preserving app runners, browser drafts, SSE connections, artifact download tokens, or arbitrary extension in-memory state.
- Hot-updating/replacing the supervisor while it owns active children.
- Replaying an interrupted prompt into a fresh Pi process.
- Port-changing migration of active sessions.

## Architecture

```text
Browser(s)
    │ HTTP/SSE
    ▼
WebUI HTTP server (replaceable)
    │ authenticated local IPC; controller incarnation + cursors
    ▼
Detached RPC supervisor (stable pipe owner)
    ├── tab A Pi --mode rpc  <stdin/stdout/stderr>
    ├── tab B Pi --mode rpc  <stdin/stdout/stderr>
    └── bounded event rings + request dedupe + private tab journal
```

### Local protocol essentials

- First frame: authenticated `attach` with protocol version, scope ID, server incarnation, and optional last cursor/handoff token.
- Attach response: supervisor epoch, authoritative managed-tab snapshot, retained replay, latest/earliest cursors, and optional gap marker.
- Commands: `{type:"command", tabId, requestId, command, timeoutMs}`; duplicate retained request IDs never write to Pi twice.
- Events: `{type:"event", epoch, seq, scopeId, tabId, at, payload}` with monotonically increasing decimal sequence values.
- Lifecycle operations: create tab, update bounded metadata, replace child for cwd/reload, close tab, prepare handoff, detach controller, and shutdown scope.
- Security: bounded strict JSONL, constant-time token comparison, owner-private state, no browser exposure, no arbitrary journal path, no supervisor secrets inherited by Pi.

### Recovery semantics

1. New server discovers and authenticates to the supervisor.
2. If managed tabs exist, it hydrates server tab records from the supervisor snapshot and attaches listeners before replay.
3. It applies retained events in sequence order, then ACKs processed cursors.
4. It primes authoritative Pi state/messages through the same supervised command path.
5. If replay has a gap, it resets derived transient state from authoritative snapshots and reports condensed/missing live output; it never fabricates deltas.
6. Only an empty scope consumes legacy restore descriptors to create new supervised Pi children.

## Execution DAG / waves

```text
Wave 0: integration-owner baseline + plan
    ├── W1 supervisor foundation
    └── (dependency gate: focused W1 tests and API contract)
             └── W2 WebUI integration + E2E
                      └── integration inspection + combined tests
                               └── R1 correctness/security review
                               └── R2 architecture/edge-case review
                                        └── accepted fixes + revalidation
                                                 └── HTML report
```

## Workstream ownership

### W1 — Supervisor foundation

Worker identity: `session-continuity-w1-supervisor`  
Owner model/provider: implementation worker slot 1  
Prerequisite: this plan and recorded dirty-worktree baseline.  
Unique handoff: `.pi-subagents/session-continuity-w1-supervisor.md`

Exclusive write set:

- `lib/rpc-supervisor-protocol.mjs` (new)
- `lib/rpc-supervisor-state.mjs` (new)
- `lib/rpc-supervisor-client.mjs` (new)
- `bin/pi-webui-rpc-supervisor.mjs` (new)
- `tests/rpc-supervisor-protocol.test.mjs` (new)
- `tests/rpc-supervisor-state.test.mjs` (new)
- `tests/rpc-supervisor-host.test.mjs` (new)

Deliverables:

- Versioned IPC schemas, cursor/request validation, bounded framing, secret stripping, and constant-time authentication.
- Private state/socket/named-pipe discovery and race-safe detached supervisor startup.
- Managed Pi transport, request dedupe, ordered bounded event replay, controller fencing, metadata journal, child replacement/close/scope shutdown.
- WebUI-side adapter API usable without changing `bin/pi-webui.mjs` yet.
- Focused tests and a concise exported API contract in the handoff.

Forbidden/shared paths: do not edit `bin/pi-webui.mjs`, browser files, fixtures, `package.json`, README, this plan, or W2 tests. Stop if integration requires a product decision or incompatible change to existing public HTTP behavior.

### W2A — WebUI server integration

Worker identity: `session-continuity-w2a-server`  
Owner model/provider: OpenAI implementation fallback after the original Anthropic W2 slot failed twice before edits with `429 rate_limit_error`.  
Prerequisite: W1 handoff inspected and focused tests passing.  
Unique handoff: `.pi-subagents/session-continuity-w2a-server.md`

Exclusive write set:

- `bin/pi-webui.mjs`
- `package.json`

Deliverables:

- Initialize/attach the supervisor before initial tabs, hydrate managed tabs without duplicate spawn, and adapt all existing `PiRpcProcess` call sites.
- Supervise create/send/writeRaw/replace/close and retain bounded tab metadata.
- Split preserve-vs-terminate shutdown behavior, add restart/update handoff and explicit scope shutdown, stop app runners, and retain the safe empty-scope legacy fallback.
- Wire runtime syntax checks in `package.json`.

Forbidden/shared paths: consume W1 exports without editing W1-owned files; do not edit browser files, fixtures, tests, README, unrelated server features, this plan, or reports. Report contract mismatches instead of silently changing W1 files.

### W2B — Continuity UX and operations guidance

Worker identity: `session-continuity-w2b-ux`  
Owner model/provider: OpenAI implementation fallback, sequential after W2A.  
Prerequisite: W2A handoff inspected, server syntax valid, and W1 focused tests passing.  
Unique handoff: `.pi-subagents/session-continuity-w2b-ux.md`

Exclusive write set:

- `public/app.js`
- `README.md`

Deliverables:

- Page-lifetime supervisor epoch/sequence deduplication and explicit gap/reconnection UI handling using additive server event fields.
- Authoritative refresh plus truthful visible warning on replay gaps.
- Operations, security, compatibility, limitations, cleanup, and rollback documentation.

Forbidden/shared paths: do not edit W1 files, server files, fixtures/tests, unrelated UI, this plan, reports, or sibling packages. Escalate an insufficient server event contract instead of crossing ownership.

### W2C — Deterministic continuity acceptance harness

Worker identity: `session-continuity-w2c-e2e`  
Owner model/provider: OpenAI implementation fallback, sequential after W2B.  
Prerequisite: W2A server integration and W2B UX handoffs inspected.  
Unique handoff: `.pi-subagents/session-continuity-w2c-e2e.md`

Exclusive write set:

- `tests/fixtures/fake-pi.mjs`
- `tests/durable-rpc-supervisor-harness.test.mjs` (new)

Deliverables:

- Opt-in deterministic delayed-streaming/PID/command/termination fixture behavior with unchanged defaults.
- Same-Pi-PID controlled-restart and abrupt-server-loss/relaunch acceptance coverage, one command write, ordered catch-up, tab identity, and explicit shutdown reaping.

Forbidden/shared paths: do not edit W1, server, browser, README, package metadata, other tests, this plan, reports, or sibling packages. Escalate a missing server contract instead of weakening assertions.

### W2D — Test isolation and timeout compatibility hardening

Worker identity: `session-continuity-w2d-hardening`  
Owner model/provider: OpenAI implementation fallback, sequential after W2C.  
Prerequisite: W2A integration and W2C harness contract available.  
Unique handoff: `.pi-subagents/session-continuity-w2d-hardening.md`

Exclusive write set:

- `tests/run-all.mjs`
- `tests/app-runner-process-tree-harness.test.mjs`
- `tests/rpc-supervisor-protocol.test.mjs`

Deliverables:

- Isolate app-runner harness supervisor state under its temporary agent directory and prove cleanup.
- Keep legacy package-suite harnesses on direct RPC mode unless they explicitly opt into supervisor coverage, preventing restart-preserving test fixtures from leaking detached processes.
- Cover the existing two-hour prompt timeout and the bounded 24-hour supervisor maximum.

Forbidden/shared paths: do not edit runtime, W2C files, other tests, UI/docs, this plan, reports, or sibling packages.

## Integration-owner checks

For each workstream, inspect the actual diff, write boundary, handoff, API assumptions, focused tests, and dirty-baseline preservation. Integrate sequentially in the shared worktree. After W2, verify:

- the server no longer owns Pi stdio in supervised mode;
- restart/update never call managed-tab stop paths;
- explicit shutdown and tab close still reap managed children;
- app runners stop in both modes;
- no supervisor token/path appears in public API payloads or child environment;
- fallback cannot spawn a duplicate when the supervisor reports live tabs;
- package/update version skew fails closed.

## Acceptance checks

Targeted sequence:

1. `node --check bin/pi-webui-rpc-supervisor.mjs`
2. `node --check lib/rpc-supervisor-protocol.mjs`
3. `node --check lib/rpc-supervisor-state.mjs`
4. `node --check lib/rpc-supervisor-client.mjs`
5. `node tests/rpc-supervisor-protocol.test.mjs`
6. `node tests/rpc-supervisor-state.test.mjs`
7. `node tests/rpc-supervisor-host.test.mjs`
8. `node tests/durable-rpc-supervisor-harness.test.mjs`
9. `node tests/http-endpoints-harness.test.mjs`
10. `node tests/transport-hardening-harness.test.mjs`
11. `node tests/app-runner-process-tree-harness.test.mjs`
12. `npm test`
13. `npm run check`
14. `npm pack --dry-run`
15. `git diff --check -- pi-package-webui`

Critical E2E assertions:

- HTTP server PID changes; supervisor and active Pi PID do not.
- A command accepted before disconnect is logged once and completes after reconnect.
- Replayed event sequences are ordered and deduplicated.
- Multi-tab metadata survives.
- SIGKILL of only the HTTP server remains recoverable.
- Explicit shutdown reaps all managed Pi children and allows idle supervisor exit.
- A stale socket/state/PID never authorizes attachment or signals an unrelated PID.
- Protocol mismatch with live tabs blocks duplicate startup.

Windows named-pipe behavior requires automated coverage where available and explicit manual validation if the current environment cannot run Windows.

## Independent review quorum

After integrated validation, obtain two fresh read-only reviewer runs from providers distinct from each other and from the primary implementation provider. Each reviews architecture, correctness, security, exact-once routing, replay/gap behavior, lifecycle semantics, tests, maintainability, plan compliance, and dirty-worktree scope. Record run IDs/models/providers and every finding disposition (`accepted`, `rejected`, `deferred`, `needs verification`) here before completion.

### Review record

#### Preliminary independent review gate (non-qualifying acceptance wrapper)

The first `subagent_gate` requested two fresh read-only reviewers with distinct providers, but the gate reported `0/2` qualifying because its generic acceptance wrapper treated the concurrently staged shared-worktree baseline as a review failure. The review bodies are still substantive advisory evidence but do **not** count toward the mandatory quorum.

- Kimi/OpenRouter runs `6a1c87c3-0f7d-4636-bcae-7ea10ed1a874` and `7d917a79-fa30-4b7c-b917-8a2b7d905d9c`: fresh, read-only; verdict **BLOCK**.
- Anthropic/Claude runs `c2649937-01c7-468d-af5b-a66b6b03e40e` and `d3c83e8d-ce2e-4d91-9826-1589836bbd90`: fresh, read-only; verdict **BLOCK**.
- The integration owner independently reproduced/verified the accepted findings below. A new qualifying two-provider review is required after fixes, with review acceptance configured not to reject pre-existing/concurrent staging.

Finding dispositions:

| ID | Finding | Disposition | Evidence / action |
|---|---|---|---|
| R1 | Supervised `writeRaw` waits for a response that `extension_ui_response` never emits | **accepted** | Direct/supervised parity violation verified in `SupervisorPiRpcProcess.writeRaw`; add a deduplicated fire-and-forget supervisor operation and supervised endpoint coverage. |
| R2 | Generic secret sanitizer truncates/strips live Pi command, response, and event payloads | **accepted** | Reproduced: arrays cap at 256, strings at 64 KiB, `tokens` keys disappear. Restrict sanitization to metadata/persistence and add byte-exact live transport tests. |
| R3 | Cursor-less attach after abrupt HTTP death returns no replay and `gap:false` | **accepted** | Product relaunch has no handoff cursor; return retained replay with truthful gap and assert through the relaunched server path. |
| R4 | Count-only replay can exceed the single-frame limit and strand attach | **accepted** | Byte-bound retained events and keep the transport frame large enough for one bounded Pi JSONL record; test replay bounds/gap. |
| R5 | FIFO request dedupe can evict unresolved long commands | **accepted** | Never evict unresolved entries; prune settled entries or reject new work at the hard bound. |
| R6 | Attach has no timeout and ignores untagged pre-attach errors | **accepted** | Reject attach on supervisor error and add a bounded timeout/test. |
| R7 | Transient connection errors can cause live state/socket deletion and split-brain startup | **accepted** | Fail closed on reset/pipe errors; under startup lock refuse replacement while recorded supervisor PID is alive; add fault/stale-state tests. |
| R8 | Old supervisor shutdown can delete a newer instance's state | **accepted** | Remove state/socket only when on-disk `instanceId` still matches. |
| R9 | Live events between attach and hydration can be dropped/reordered | **accepted** | Add explicit client/server startup buffering and ordered drain before normal live dispatch, or force a gap refresh on discontinuity. |
| R10 | Browser checks `supervisorGap` while server sends `supervisorReplayGap` | **accepted** | Align field name and focused static behavior. |
| R11 | `webui_supervisor_reconnected` is emitted on every SSE connect | **deferred** | Cosmetic/noise only; current authoritative refresh is safe and bounded. Revisit after correctness fixes. |
| R12 | Mid-run supervisor reconnection is absent | **deferred** | Supervisor death is an explicit non-goal; server restart is the supported recovery path. Documented residual risk. |
| R13 | ACK is not durably persisted | **deferred** | Current bounded replay uses handoff cursor and gap semantics. Durable ACK persistence is not required after R3; avoid scope expansion. |
| R14 | Concurrently staged unrelated files violate worker no-staging evidence | **rejected as feature defect / recorded process risk** | Workers and parent did not stage; another shared-worktree session staged the baseline during review. Do not unstage without owner authorization; report this in final artifacts. |
| R15 | Windows named-pipe behavior unexecuted | **deferred manual gate** | POSIX validation is complete; Windows remains a stated residual risk rather than a false completion claim. |
| R16 | Child-exit persistence can recreate state after explicit supervisor shutdown | **accepted** | Reproduced in three durable runs. Persistence is now serialized, suppressed once closing starts, awaited before instance-safe removal, and the durable harness passes twice after the fix. |

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Supervisor becomes a single point of failure | High | Keep it feature-frozen and narrow; fail honestly; active continuity is scoped to HTTP-server restarts only. |
| Duplicate prompt after ambiguous disconnect | High | Supervisor-side retained request IDs; never auto-replay from transcript. |
| Replay loss or duplicate UI mutation | High | Epoch/sequence envelopes, ACKs, browser dedupe, explicit gap refresh. |
| Old/new server overlap | High | Controller incarnation fencing and one-time handoff; do not rely on startup sleep. |
| Leaked local authority token | High | 0700/0600 storage, private IPC, constant-time auth, secret stripping, no argv/browser/log exposure. |
| Pi child orphan after supervisor crash | High | Spawn process groups where supported, use shared process-tree termination, retain PID/start metadata for diagnostic cleanup without trusting PID alone. |
| Blocking extension UI request during downtime | Medium | Retain/replay request event; preserve existing child timeout semantics and expose expiration truthfully. |
| Update protocol skew | High | Stable major v1; additive minor only; fail closed while live tabs exist. |
| Dirty worktree conflicts | High | Sequential workers, disjoint ownership, no broad formatting/staging/revert, integration-owner diff inspection. |
| Windows lifecycle differences | Medium | Named pipe transport and process-tree helper; manual Windows gate if no CI. |

## Rollout and rollback

- Default supervised mode is enabled after tests pass; `PI_WEBUI_RPC_SUPERVISOR=0` provides a documented compatibility fallback only when no live managed scope exists.
- First upgraded launch starts an empty supervisor and creates children normally. Continuity begins for those newly supervised children.
- Downgrade/disable requires explicit `/api/shutdown` first; fallback mode must refuse to start duplicate direct children while a compatible supervisor reports live tabs.
- If a new server cannot attach but the supervisor is healthy, repair/roll forward the client. Killing the supervisor destroys active continuity.
- Remove private runtime files only after authenticated shutdown and endpoint verification show no live managed tabs.

## Progress / decision record

- 2026-07-26: Repository lifecycle traced with direct evidence and two read-only specialist artifacts.
- 2026-07-26: Pi RPC documentation and implementation verified: RPC is JSONL over stdin/stdout and stdin EOF triggers runtime shutdown.
- 2026-07-26: Literal continuity selected; session-file-only rehydration rejected as insufficient.
- 2026-07-26: Detached narrow supervisor, per-user local IPC, no active-session TTL, same-port scope, app-runner exclusion, preserve/terminate split, and full Windows named-pipe target approved by integration owner.
- 2026-07-26: Dirty shared worktree requires sequential non-overlapping workers; automatic worktree fanout is prohibited.
- 2026-07-26: W1 supervisor foundation completed with focused tests passing. The original Anthropic W2 integration run failed before edits with a transient 429, and its single allowed recovery attempt failed identically. The remaining integration was re-decomposed into distinct sequential OpenAI workstreams; no failed attempt counts as an implementation deliverable.
- 2026-07-26: W2A server integration completed after one bounded recovery from tool-budget exhaustion. Syntax, W1 tests, HTTP endpoints, and transport hardening passed. Its app-runner failure was reproduced as dependence on the non-isolated real agent directory; the same harness passes with an isolated `PI_CODING_AGENT_DIR`, so test isolation/cleanup is required before the package gate.
- 2026-07-26: W2B correctly stopped on a missing browser event contract. The integration owner added secret-free scope/epoch/sequence fields plus reconnect/gap SSE signals and restored the existing two-hour prompt timeout within a 24-hour bound; W2B then completed replay dedupe, recovery UX, and operations docs.
- 2026-07-26: W2C and W2D completed same-Pi-PID controlled/SIGKILL continuity, exactly-once, truthful gap, extension UI, large-payload, timeout, app-runner, and cleanup coverage. Preliminary reviewers found live-transport sanitization, cursor-less replay, replay-size, raw-write, startup/fencing, and shutdown races; accepted fixes were implemented in two bounded fix workstreams. The integration owner then fixed the reproduced child-exit persistence race; focused host and durable E2E tests pass, including two consecutive post-fix durable runs.

## Report

Final report: [../reports/durable-webui-session-continuity.html](../reports/durable-webui-session-continuity.html)
