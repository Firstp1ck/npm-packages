# Complex Feature Plan: Unified Subagent Observability in Pi Web UI

**Goal:** Make the WebUI **Subagents** section count, display, and open agent runs created through every supported Pi-core and extension/package launch method documented in [`docs/PI-SUBAGENT-LAUNCH-METHODS.md`](../../docs/PI-SUBAGENT-LAUNCH-METHODS.md), without misclassifying unrelated Pi sessions or double-counting the same child.

**Classification:** Complex. The feature adds a cross-process observability contract, changes the WebUI helper/server/browser data model, adds SDK and subprocess adapters, crosses package boundaries, and must preserve security, restart continuity, deduplication, and existing `pi-subagents` behavior.

**Status:** Planned; no implementation authorized by this document alone.

**Integration owner:** Parent Pi agent. The integration owner owns this plan, cross-workstream contracts, final schema decisions, integration, reviewer-finding dispositions, verification, and archival.

## 1. Outcome and success criteria

1. The Subagents section can represent agent instances launched through:
   - Pi SDK `createAgentSession()`;
   - `pi --mode rpc`;
   - `pi --mode json -p`;
   - `pi -p`;
   - a separate interactive Pi/tmux process;
   - `pi-subagents` `subagent({ workflowScript })`;
   - `/run`, prompt-workflow recipes, and other `pi-subagents` command adapters;
   - `pi-subagents` schedules once a scheduled run actually launches;
   - `subagent_gate`;
   - `pi-subagents` event-bus RPC `spawn`;
   - `workflow_run`;
   - a cooperating custom extension/tool.
2. Every logical child instance is counted once even when several observers report it—for example a `subagent_gate` attempt also visible through `pi-subagents` fleet/status.
3. The overview identifies the launch family and useful origin, such as **SDK**, **Pi RPC**, **Pi JSON**, **Pi print**, **interactive/tmux**, **pi-subagents**, **schedule**, **gate**, **workflow**, or **custom**.
4. Each openable row opens the existing read-only overlay or Subagent terminal view with the best available bounded transcript/output and telemetry. Missing evidence is shown as unavailable, never invented.
5. Capabilities are explicit per run/agent. Cancel, refresh, copy, or future steer actions appear only when the owning provider supports them.
6. Existing `pi-subagents`, retained runs, gates, workflows, launch-slot configuration, overlay/tab selection, auto-clear, and restart behavior remain compatible.
7. WebUI restart recovers active registered runs when their producer or durable registry still reports them; stale heartbeats become `unknown` and then `lost`, never silently `done`.
8. Arbitrary local process scanning is not used. An independent SDK/CLI/tmux process must cooperate through a registration adapter or an explicit local attach command.
9. Overview and open-output payloads remain bounded, validated, secret-conscious, and do not expose raw prompts, command lines, environment values, credentials, or arbitrary host paths.
10. Focused tests, full `pi-package-webui` checks, package checks for touched producers, two independent reviews, and documentation updates complete before the plan is archived.

## 2. Current architecture and gap

### Existing path

```text
pi-subagents events/status/RPC ─┐
subagent tool lifecycle hooks ──┼─> webui-rpc-helper.mjs
workflow snapshot event ────────┤       │
subagent_gate updates ──────────┘       │ setStatus("webui-subagents", v1 JSON)
                                        v
                              Pi RPC extension_ui_request
                                        v
                                bin/pi-webui.mjs
                       normalizeWebuiSubagentPayload()
                                        v
                            GET /api/subagents
                            GET /api/subagents/output
                                        v
                         public/app.js Subagents panel
                         overlay or view-only tab
```

`webui-rpc-helper.mjs` currently tracks foreground and async `pi-subagents` runs, fleet-recovered entries, retained completed runs, workflow live snapshots, and gate attempts. `bin/pi-webui.mjs` stores one normalized v1 status per WebUI tab and aggregates it. `public/app.js` counts agents, renders rows grouped by parent tab, and opens output by routing back through the owning tab's helper.

### Gap

Pi core does not have a universal subagent registry. SDK sessions and independently spawned Pi processes do not automatically identify themselves as children, identify a parent WebUI tab, or expose a safe output locator. Automatic process enumeration cannot reliably distinguish:

- a child from an unrelated Pi session;
- one logical child observed through multiple wrappers;
- a print process from an ordinary shell command;
- a tmux-owned interactive session from a user's primary session.

Therefore full coverage requires **cooperative registration**, not process-name heuristics.

## 3. Scope and non-goals

### In scope

- A versioned canonical **agent-run observation** schema.
- A provider registry and deduplicating aggregator.
- In-process event-bus registration for cooperating extensions and SDK callers.
- A private cross-process registry plus adapter library/CLI for Pi SDK and Pi subprocess methods.
- Existing `pi-subagents`, gate, and workflow adapters migrated to the canonical schema.
- Overview/count/source/capability changes in the WebUI Subagents section.
- Unified open-output resolution for session JSONL, structured event capture, and bounded plain output.
- Explicit attach/reporting support for independent interactive/tmux Pi sessions.
- Retention, heartbeat, stale/lost lifecycle, restart recovery, tests, and documentation.

### Non-goals

- Treating every Pi process on the machine as a subagent.
- Scanning the OS process table, tmux server, arbitrary directories, or all Pi session files to infer parentage.
- Automatically controlling independently owned processes.
- Turning the Subagents panel into a launcher for all methods.
- Making print-mode output equivalent to a structured Pi transcript.
- Exposing raw child prompts, full command lines, credentials, environment variables, or unrestricted filesystem paths to the browser.
- Replacing `pi-subagents`, `workflow_run`, or Pi's SDK/RPC APIs.
- Counting scheduled definitions before they launch an agent instance.
- Counting a gate, workflow, or orchestration group itself as an additional agent.

## 4. Architectural decisions and invariants

| ID | Decision / invariant |
| --- | --- |
| D1 | Use cooperative registration. No process-name or tmux-pane autodiscovery. |
| D2 | Model **group**, **logical run**, and **agent instance** separately. Counts are based on canonical agent-instance IDs only. |
| D3 | Keep launch mechanism and observation provider separate. Example: `launcher=gate`, `provider=pi-subagents`, so deduplication does not depend on UI labels. |
| D4 | Every producer supplies or derives a stable `instanceId`. Aggregation keys by parent scope plus `instanceId`; weaker identities are marked provisional and never merged solely by agent name/model/time. |
| D5 | A source adapter may enrich an existing instance but may not create another count for the same `instanceId`. Field precedence is capability/evidence based, not last-writer-wins. |
| D6 | Overview snapshots never contain prompts, commands, arbitrary paths, or full output. Output is fetched on demand through an opaque server-owned locator. |
| D7 | Open views are read-only in v1. Controls are capability driven; only the current `pi-subagents` owner retains cancel behavior initially. |
| D8 | Scheduled jobs count only after launch. `/run`, prompt recipes, and event-bus RPC are origin metadata on their resulting child, not additional agent records. |
| D9 | Gate attempts reference canonical instances. They remain visible as gate history but do not add to `totalAgents`. |
| D10 | Workflow calls become canonical agent instances. The workflow container is a group/run, not an agent. |
| D11 | External or unassigned runs appear under a synthetic **External agents** group until a valid parent session/tab correlation is supplied. |
| D12 | Registry writers own one record file per producer/run and update it atomically. The WebUI never executes producer-supplied commands. |
| D13 | A heartbeat lapse transitions `running → stale → lost`; only an explicit terminal event produces `done`, `failed`, or `cancelled`. |
| D14 | Existing v1 tab status remains accepted during migration. The server emits a v2 browser overview and retains v1 response fields for one compatibility release. |

## 5. Canonical data contract

Create `pi-package-webui/lib/agent-run-protocol.mjs` as the single validator/normalizer shared by the WebUI server, WebUI helper, tests, and adapters.

### 5.1 Agent instance

```json
{
  "version": 1,
  "instanceId": "opaque-stable-id",
  "runId": "logical-run-id",
  "parentInstanceId": null,
  "parentSessionId": "optional-pi-session-id",
  "launcher": "sdk",
  "provider": "webui-registry",
  "origin": "createAgentSession",
  "name": "reviewer",
  "status": "running",
  "startedAt": 1786528800000,
  "updatedAt": 1786528812000,
  "endedAt": null,
  "model": "anthropic/claude-sonnet-4",
  "thinking": "high",
  "activityState": "tool",
  "currentTool": "read",
  "capabilities": {
    "open": true,
    "refresh": true,
    "cancel": false,
    "steer": false
  },
  "outputRef": {
    "kind": "registry-artifact",
    "id": "opaque-server-resolved-id"
  }
}
```

### 5.2 Allowed enums

- `launcher`: `sdk`, `pi-rpc`, `pi-json`, `pi-print`, `interactive`, `tmux`, `pi-subagents`, `schedule`, `gate`, `workflow`, `custom`.
- `provider`: bounded package/protocol identifier; known built-ins include `pi-subagents`, `workflow-run`, `webui-registry`, and `webui-helper`.
- `status`: `queued`, `running`, `stale`, `done`, `failed`, `cancelled`, `lost`.
- `outputRef.kind`: `helper`, `session-jsonl`, `rpc-events`, `json-events`, `plain-log`, `registry-artifact`, `none`.

Unknown future enum values fail closed at ingestion until the schema version is explicitly supported.

### 5.3 Group/run structure

The browser v2 overview uses groups rather than assuming every run belongs to an open WebUI tab:

```json
{
  "version": 2,
  "groups": [
    {
      "id": "tab:<tab-id>",
      "kind": "tab",
      "tabId": "<tab-id>",
      "title": "Auth work",
      "cwdLabel": "project",
      "runs": []
    },
    {
      "id": "external",
      "kind": "external",
      "title": "External agents",
      "runs": []
    }
  ],
  "counts": {
    "totalRuns": 4,
    "totalAgents": 6,
    "runningAgents": 2,
    "staleAgents": 1,
    "byLauncher": { "sdk": 1, "pi-subagents": 4, "interactive": 1 }
  }
}
```

For one compatibility release, retain `tabs`, `totalRuns`, `totalAgents`, `runningRuns`, `runningAgents`, and `totalGates` at the top level.

### 5.4 Identity and deduplication

Use this precedence:

1. Exact producer-supplied canonical `instanceId`.
2. Exact child Pi `sessionId` plus a per-execution generation ID.
3. Existing `pi-subagents` child run ID/index identity.
4. Workflow call ID.
5. Provisional provider-scoped ID when no stronger identity exists.

Never deduplicate by display name, model, prompt hash, PID alone, or close timestamps. When a stronger identity arrives for a provisional row, record an alias and migrate the row without incrementing counts.

Field merge precedence:

- lifecycle owner controls terminal status;
- structured child-session evidence controls model/thinking/telemetry;
- current owner controls capabilities;
- newest bounded activity controls current tool/activity;
- output resolution prefers session JSONL, then structured events, then plain log.

## 6. Registration and adapter architecture

### 6.1 In-process provider event

Add a process-local event-bus contract:

```text
firstpick:webui-agent-runs:v1
```

A complete snapshot carries `producerId`, `complete: true`, and bounded runs/instances. An incremental form carries `complete: false` plus upserts/removals. `webui-rpc-helper.mjs` validates it through the shared protocol and publishes the merged status.

Use this for:

- custom extensions;
- SDK sessions created from an extension in the active Pi process;
- `pi-extension-workflows`;
- future in-process orchestration packages.

A malformed provider snapshot is ignored and reported through bounded diagnostics; it cannot clear another provider's rows.

### 6.2 Private cross-process registry

Add an owner-private registry below the WebUI private state root, for example:

```text
~/.pi/webui/agent-runs/<scope-id>/<producer-id>/<record-id>.json
~/.pi/webui/agent-runs/<scope-id>/<producer-id>/<record-id>.events.jsonl
```

Requirements:

- directories/files use private permissions where supported;
- record names are server/helper generated safe IDs;
- one producer owns one record; no shared read-modify-write file;
- snapshots are written by temporary file plus atomic replacement;
- event logs have strict byte/line caps and rotation;
- server reads only validated files below the canonical registry root;
- `outputRef` cannot redirect the browser to arbitrary paths;
- stale/corrupt records produce diagnostics and are quarantined or ignored, not executed;
- retention prunes terminal records after the configured finished-run window.

WebUI-managed Pi tabs receive a non-secret registry location/scope identifier. If a write capability/token is required, use a dedicated least-privilege registration credential—not the supervisor, recovery, remote-auth, or browser credential.

### 6.3 SDK adapter

Add a small exported helper, tentatively:

```typescript
trackPiAgentSession({
  session,
  registry,
  instanceId,
  runId,
  parentSessionId,
  name,
  launcher: "sdk"
})
```

It subscribes to `AgentSession` events and records:

- accepted start and settled/abort/error lifecycle;
- assistant/tool event stream in bounded normalized form;
- model/thinking and usage when available;
- session ID without exposing the session file path to the browser;
- heartbeat while running;
- cleanup/dispose semantics.

For an SDK session created inside a Pi extension, provide an event-bus registry adapter instead of requiring filesystem transport. For an SDK session in another application, use the private cross-process registry explicitly.

Creating an unwrapped `AgentSession` remains invisible by design; the docs must state this clearly.

### 6.4 Pi subprocess adapter

Add a reusable subprocess observer used by wrappers/tests:

- **RPC mode:** parse strict LF-delimited RPC events; retain a bounded normalized stream and settled state.
- **JSON mode:** parse JSONL lifecycle events; map message/tool/usage events.
- **Print mode:** record process start/exit, bounded stdout/stderr tail, model metadata supplied by the caller, and no structured tool/telemetry claims.

The adapter must not parse shell command strings to infer mode. The caller declares `launcher` and supplies an argv array. It uses `shell: false`, bounded output, abort propagation, and process-tree cleanup only when the caller owns the process.

Provide either a supported CLI wrapper or a documented library seam, for example:

```text
pi-webui agent run --launcher rpc -- pi --mode rpc --no-session
pi-webui agent run --launcher json -- pi --mode json -p --no-session "..."
pi-webui agent run --launcher print -- pi -p --no-session "..."
```

Exact command naming is finalized during implementation after checking CLI compatibility. The wrapper must never claim control over a process it did not start.

### 6.5 Interactive/tmux attach

Independent interactive sessions cannot be discovered safely. Support two explicit paths:

1. Start the Pi process with a lightweight reporter extension that writes heartbeat and session-event snapshots to the registry.
2. Attach an existing persisted Pi session using a localhost-only CLI action such as:

```text
pi-webui agent attach --session <session-id-or-file> [--pid <pid>] [--name <label>] [--parent-session <id>]
```

Constraints:

- resolve session IDs/files through Pi's session APIs and configured session roots;
- do not accept an arbitrary transcript/log path from the browser;
- PID, when supplied, is status evidence only and is not cancellation authority;
- without a reporter/heartbeat, status is `stale` or `unknown`, not assumed running;
- opening is a read-only mirror of the persisted session;
- tmux pane control and keystroke injection are out of scope.

### 6.6 Existing extension adapters

- **`pi-subagents`:** map tool hooks, async events, status/fleet RPC, retained artifacts, `/run`, prompt recipes, event-bus spawn, and scheduled launches to canonical instances. Use launch-origin metadata when available; otherwise show `pi-subagents` without guessing.
- **Schedules:** do not list schedule definitions. Set `launcher=schedule` only on actual launched runs when receipts expose that origin.
- **`subagent_gate`:** keep the gate card/history, but map each attempt's `runId` to the canonical child `instanceId`. Failed pre-launch attempts remain gate history and do not create agent counts.
- **`workflow_run`:** replace the bespoke live-only snapshot with the common event protocol. Publish stable workflow-call instance IDs, terminal lifecycle, retained output references, and model/thinking when known. Preserve prompt/command redaction.
- **Custom extensions:** document the common provider event and optional registry writer. Unknown tools are not inspected heuristically.

## 7. WebUI helper and backend changes

### 7.1 `webui-rpc-helper.mjs`

Refactor provider-specific maps behind a canonical aggregator:

- register `pi-subagents`, workflow, gate, and generic event providers;
- preserve provider ownership and source aliases;
- apply identity upgrades/deduplication;
- publish a versioned `PI_WEBUI_SUBAGENTS_V2` status while retaining v1 parsing support;
- persist only safe retained summary/opaque locator metadata in Pi session entries;
- resolve helper-owned output through provider dispatch;
- expose capability-aware cancel/dismiss responses;
- distinguish `stale`/`lost` from terminal success.

Do not let a complete snapshot from one producer clear another producer's records.

### 7.2 Cross-process registry reader

Add `lib/agent-run-registry.mjs` in the WebUI server:

- discover only the current private scope registry;
- validate and normalize records;
- maintain a bounded in-memory index;
- watch when reliable and reconcile periodically as fallback;
- map `parentSessionId` to an open WebUI tab when exact;
- place unmatched records in the external group;
- preserve records through HTTP-server restart;
- age heartbeat state deterministically;
- return opaque output handles.

### 7.3 Server overview

Change `webuiSubagentsData()` to merge:

1. per-tab helper observations;
2. private cross-process registry observations;
3. workflow/custom provider observations not already present.

It returns v2 `groups` plus compatibility fields. Counts use deduplicated canonical instances. Add bounded diagnostics such as unsupported providers, invalid records, and omitted counts without exposing paths.

### 7.4 Open-output resolver

Evolve the endpoint to identify a group/provider instead of requiring an owning tab:

```text
GET /api/subagents/output?group=<group>&run=<run>&agent=<instance>
```

Keep `?tab=...` compatibility for current clients.

Server dispatch:

- helper-owned instance → existing `webui-helper subagent-output`;
- session JSONL → bounded session parser;
- RPC/JSON events → normalized registry artifact reader;
- print/plain → bounded log-tail reader;
- workflow → workflow retained artifact/provider;
- no locator → metadata-only view with a truthful unavailable message.

All locator resolution is server-owned. Browser input never selects a host path.

### 7.5 Controls

Make routes capability-driven:

- existing `/api/subagents/cancel` remains only for owner-supported instances/runs;
- dismiss removes a WebUI retained projection, not producer artifacts or external sessions;
- external attach detach is a separate explicit localhost action;
- v1 does not add generic terminate/steer for SDK, RPC, print, or tmux runs.

## 8. Browser changes

Update `public/index.html`, `public/app.js`, and `public/styles.css`:

1. Replace the help text that mentions only `subagent` and `subagent_gate` with concise wording explaining that managed and registered Pi agent runs appear here.
2. Render v2 groups:
   - normal WebUI parent tabs;
   - **External agents** for registered unassigned SDK/process/tmux runs.
3. Add a compact launcher/source badge per run or agent without expanding the current dense row excessively.
4. Preserve the agent name, model, thinking, status dot, and open chevron.
5. Render `queued`, `running`, `stale`, `lost`, `done`, `failed`, and `cancelled` distinctly and accessibly.
6. Keep overlay/tab preference. Both use the unified output endpoint.
7. Show only supported actions. Metadata-only rows can still open to explain why output is unavailable.
8. Count all visible canonical instances once. Keep top-level `totalAgents` compatibility and show running/stale breakdown in section status text.
9. Gate cards reference/open the canonical target but do not increase the badge count.
10. Preserve focus/scroll continuity, auto-clear behavior for terminal records, mobile grouping, copy behavior, and tab-group rendering.

Recommended source labels:

| Launcher | UI label |
| --- | --- |
| `sdk` | SDK |
| `pi-rpc` | Pi RPC |
| `pi-json` | Pi JSON |
| `pi-print` | Pi print |
| `interactive` | Pi session |
| `tmux` | tmux |
| `pi-subagents` | pi-subagents |
| `schedule` | scheduled |
| `gate` | gate |
| `workflow` | workflow |
| `custom` | custom |

## 9. Method coverage matrix

| Method | Detection/registration | Count | Open evidence | Control in v1 |
| --- | --- | --- | --- | --- |
| SDK `createAgentSession()` | SDK tracking helper; event bus in-process or registry cross-process | One per registered execution instance | Structured subscribed events; optional trusted session JSONL | None |
| `pi --mode rpc` | Declared subprocess adapter/wrapper | One per child process/session execution | RPC event capture or trusted session JSONL | Owner adapter may abort internally; WebUI exposes none initially |
| `pi --mode json -p` | Declared subprocess adapter/wrapper | One | JSON event capture | None after launch; owner handles abort |
| `pi -p` | Declared subprocess adapter/wrapper | One | Bounded stdout/stderr | None |
| Interactive Pi | Reporter extension or explicit attach | One | Trusted persisted session JSONL | None |
| tmux Pi | Reporter/attach; no tmux scanning | One | Trusted persisted session JSONL | None |
| `subagent` `workflowScript` | Existing hooks/events/RPC mapped to canonical provider | Per real child | Existing artifacts/session JSONL | Existing cancel/interrupt behavior |
| `/run` and prompt recipes | Same underlying `pi-subagents` instance; origin metadata if available | No extra count | Same as child | Same as child |
| Schedule | Actual launch receipt only | Per launched child | Same as child | Same as child |
| `subagent_gate` | Gate update references canonical child | Child once; gate zero | Existing child output | Existing child control only |
| Event-bus RPC `spawn` | Same `pi-subagents` instance; RPC origin if available | No extra count | Same as child | Same as child |
| `workflow_run` | Common provider event | Per running/retained workflow call | Retained bounded event/session artifact | Workflow controls stay in workflow UI |
| Custom extension/tool | Common provider event or registry writer | Per declared canonical instance | Provider snapshot/artifact | Only declared safe capability; none by default |

## 10. Workstreams and execution order

### WS-A — Protocol, registry, and adapter foundation

**Primary files:**

- `pi-package-webui/lib/agent-run-protocol.mjs` (new)
- `pi-package-webui/lib/agent-run-registry.mjs` (new)
- `pi-package-webui/lib/agent-run-adapters.mjs` or a narrowly split equivalent (new)
- `pi-package-webui/bin/pi-webui-launcher.mjs` / CLI module as required
- focused new unit tests

**Deliverables:** canonical schema, validation, identity/dedupe rules, private registry, heartbeat aging, SDK tracking helper, subprocess observer, and explicit attach interface.

**Stop condition:** escalate if implementation requires exposing a general unauthenticated HTTP writer, reusing supervisor/recovery credentials, or accepting arbitrary browser-selected paths.

### WS-B — Existing provider migration

**Primary files:**

- `pi-package-webui/webui-rpc-helper.mjs`
- `pi-package-webui/lib/subagent-gate.mjs`
- `pi-extension-workflows/src/webui-subagents.ts`
- corresponding package tests

**Deliverables:** canonical provider adapter, v1 compatibility, gate reference dedupe, workflow terminal/retained output support, and generic custom-extension event ingestion.

**Dependency:** WS-A schema stable.

### WS-C — Server aggregation and open resolver

**Primary files:**

- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/webui-rpc-helper.mjs` only for agreed bridge changes
- `pi-package-webui/tests/http-endpoints-harness.test.mjs`
- supervisor/restart tests if the registry integrates with continuity

**Deliverables:** v2 overview, grouping, compatibility fields, registry merge, source counts, opaque output dispatch, capability-aware actions, and restart recovery.

**Dependency:** WS-A; coordinate with WS-B on provider output dispatch.

### WS-D — Browser UI and documentation

**Primary files:**

- `pi-package-webui/public/app.js`
- `pi-package-webui/public/index.html`
- `pi-package-webui/public/styles.css`
- `pi-package-webui/tests/mobile-static.test.mjs`
- browser tests as warranted
- `pi-package-webui/README.md`
- `pi-package-webui/TECHNICAL.md`
- `pi-package-webui/DEVELOPMENT.md`
- `docs/PI-SUBAGENT-LAUNCH-METHODS.md`

**Deliverables:** v2 groups, launcher labels, lifecycle states, count breakdown, unified open behavior, responsive/accessibility coverage, and correct user/developer documentation layers.

**Dependency:** WS-C response contract stable.

### Integration policy

- Use one writer per shared working tree.
- WS-A and WS-D can be isolated if their files do not overlap; WS-B and WS-C share `webui-rpc-helper.mjs` and must be sequential or integrated by one owner.
- The integration owner inspects every handoff and actual diff, resolves schema changes centrally, and runs cross-package checks.

## 11. Test plan

### Protocol and identity tests

- accept every supported launcher and lifecycle state;
- reject unknown versions, unsafe IDs, oversized fields, path traversal, and malformed capabilities;
- merge duplicate observations with the same canonical instance ID;
- do not merge same-name/model concurrent agents;
- upgrade provisional IDs without increasing count;
- gate/workflow/container records do not add agent counts;
- complete snapshots clear only their own producer.

### Registry tests

- private canonical root and safe record names;
- atomic concurrent records from separate producers;
- corrupt/partial record isolation;
- heartbeat `running → stale → lost` timing;
- explicit terminal state wins over heartbeat aging;
- retention/pruning bounds;
- restart/reload reconstruction;
- arbitrary output/session paths rejected;
- symlink escape rejected;
- output/event caps enforced.

### Adapter tests

- SDK lifecycle, tool events, usage, abort, dispose, and in-memory session;
- RPC strict LF framing including CRLF normalization and Unicode line separators inside JSON;
- JSON mode event mapping;
- print stdout/stderr truncation and exit failure;
- reporter/attach session resolution;
- process cancellation only when adapter owns the process;
- child secrets/commands never appear in overview snapshots.

### Existing-provider regression tests

- foreground and async `pi-subagents` runs;
- fleet recovery and nested children;
- `/run`/RPC/schedule aliases do not double count;
- retained complete/failed/cancelled rows;
- gate attempts reference existing children and pre-launch failures add no agent;
- workflow running and terminal retained calls open correctly;
- malformed cross-extension snapshots cannot clear valid rows.

### HTTP tests

Extend `tests/http-endpoints-harness.test.mjs` for:

- v2 groups and compatibility fields;
- per-launcher counts;
- external group;
- helper and registry output dispatch;
- metadata-only open response;
- capability-gated cancel/dismiss;
- localhost/auth/trust boundaries;
- no host path disclosure;
- stale/lost status normalization;
- server restart recovery.

### Browser/static tests

- all launcher labels and lifecycle classes;
- badge counts canonical instances only;
- status text shows total/running/stale accurately;
- external group rendering;
- gate references do not duplicate rows/counts;
- overlay and tab open modes for helper, registry, plain, and unavailable output;
- capability-driven controls;
- focus, scroll continuity, auto-clear, mobile group dropdown, and accessible names;
- source metadata does not overflow compact rows.

### Commands

At minimum after implementation:

```bash
npm test --prefix pi-package-webui
npm run check --prefix pi-package-webui
npm pack --dry-run --json --prefix pi-package-webui
npm test --prefix pi-extension-workflows
npm pack --dry-run --json --prefix pi-extension-workflows
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Run the focused browser suite when UI behavior cannot be proven statically. Run WebKit only under the package's documented opt-in environment.

## 12. Documentation plan

- **WebUI README:** add a plain-language feature bullet and practical Subagents-panel usage; state that external/native Pi agents must be registered or attached.
- **WebUI TECHNICAL:** document supported launch families, lifecycle/open limitations, reporter/attach usage, settings/locations users need, and troubleshooting.
- **WebUI DEVELOPMENT:** document schemas, provider events, registry storage format, identity merge, HTTP contracts, security boundaries, source map, and test commands.
- **Launch-method reference:** add a support column/link explaining automatic, adapter-based, or manual-attach observability.
- Do not place event payloads, internal paths, schemas, or test commands in README/TECHNICAL when they belong in DEVELOPMENT under repository documentation rules.

## 13. Security and privacy review checklist

- [ ] No browser-controlled arbitrary path reads.
- [ ] No raw prompts, command lines, argv, environment values, or credentials in overview.
- [ ] Open output is bounded and normalized before browser delivery.
- [ ] Registry root is private, canonical, symlink-safe, and scope-bound.
- [ ] Registration credential, if needed, is dedicated and least privilege.
- [ ] Supervisor/recovery/remote-auth secrets are not reused.
- [ ] Remote browsers cannot attach/register arbitrary local sessions.
- [ ] Custom provider snapshots cannot remove or control another provider's rows.
- [ ] PID evidence does not grant termination authority.
- [ ] Cancel/steer controls appear only for verified owning providers.
- [ ] Retention and stale/lost transitions cannot claim false success.

## 14. Rollout and migration

1. Introduce protocol/registry and consume existing v1 helper status unchanged.
2. Migrate `pi-subagents` and workflows to canonical internal records while emitting v1-compatible fields.
3. Ship browser v2 group rendering with v1 fallback.
4. Add SDK/subprocess/reporter adapters and docs.
5. After at least one compatible release and fixture coverage, remove internal dependence on v1 maps; keep external v1 parsing only for the documented compatibility window.

No existing retained-run entry is destructively migrated. Existing v1 retained entries load as `launcher=pi-subagents`, `provider=webui-helper`, with unknown fields left unknown.

Rollback restores the current helper-only path. Cross-process registry artifacts remain inert private files and can be pruned after confirming no older/newer compatible WebUI uses them.

## 15. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Impossible automatic discovery of arbitrary SDK/process/tmux agents | Cooperative adapters and explicit attach; no misleading auto-detection claim. |
| Duplicate count from gate, workflow, fleet, and helper views | Stable canonical instance IDs, aliases, and explicit group-vs-agent semantics. |
| Registry becomes a local file-read proxy | Opaque locators, allowed roots, symlink checks, no browser paths. |
| Restart loses active external runs | Private durable records plus heartbeat reconciliation. |
| Stale record shown as success | `stale`/`lost` states; terminal success requires explicit evidence. |
| Plain print output looks structured | Source-specific view and unknown telemetry; no inferred tool/model facts. |
| Cross-package schema drift | One shared protocol module/fixture contract and versioned provider tests. |
| Existing dense panel becomes noisy | Compact source badge and details in opened view; preserve row density. |
| External process control exceeds ownership | Read-only default and explicit capability gating. |
| Event/status payload grows without bound | Per-provider, run, agent, text, event, and retention caps with omitted counts. |

## 16. Independent review and completion gates

Before completion, run two fresh read-only reviews:

1. **Correctness/architecture reviewer:** identity, dedupe, provider ownership, lifecycle, restart, migration, and source adapters.
2. **Security/UX/test reviewer:** registry trust boundary, output path safety, secrets, capability controls, accessibility, count semantics, and coverage.

Every finding receives exactly one disposition: `accepted`, `rejected`, `deferred`, or `needs verification`, with evidence. Accepted fixes are revalidated.

Completion requires:

- [ ] Canonical protocol and registry tests pass.
- [ ] All 13 coverage-matrix rows (covering the 12 documented launch mechanisms and separately tracking interactive/tmux adapters) have a tested supported path.
- [ ] Existing `pi-subagents`, gate, and workflow regressions pass.
- [ ] Count/dedupe/open behavior passes HTTP and browser/static coverage.
- [ ] Security checklist is complete.
- [ ] Full package checks and dry-run packs pass.
- [ ] User and contributor documentation is current.
- [ ] Two independent reviews are dispositioned.
- [ ] Any required final report is generated and linked.
- [ ] Plan is moved to `plans/archive/` only after verified implementation completion.

## 17. Initial evidence

- `pi-package-webui/webui-rpc-helper.mjs` currently owns foreground/async/fleet/retained/workflow/gate maps, status polling, selected-output resolution, tool lifecycle hooks, and session-entry persistence.
- `pi-package-webui/bin/pi-webui.mjs` accepts `PI_WEBUI_SUBAGENTS_V1`, aggregates per-tab runs in `webuiSubagentsData()`, and exposes overview/output/cancel/dismiss routes.
- `pi-package-webui/public/app.js` counts `totalAgents`, groups by parent tab, and opens helper-owned output in an overlay or view-only Subagent tab.
- `pi-extension-workflows/src/webui-subagents.ts` already publishes a bounded redacted process-local snapshot, but it is live-only and bespoke.
- Pi core SDK/RPC/JSON/print and independent interactive processes expose no universal parent-child registry, so arbitrary instances are not observable without cooperation.
