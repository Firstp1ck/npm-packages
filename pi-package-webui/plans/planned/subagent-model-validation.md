# Deterministic Subagent Model Validation Plan

**Status:** Planned / cross-package implementation required  
**Target:** `pi-package-webui`  
**Related package:** `pi-subagents`  
**Integration owner:** Main Pi agent  
**Prepared:** 2026-07-28

## 1. Purpose

Turn the WebUI subagent launch-slot configuration from advisory prompt text into a deterministic, auditable launch policy.

Before a governed subagent starts, the system must compare its resolved model, thinking level, and fallback candidates with the launch-slot snapshot active in the parent WebUI tab. A mismatch must warn the parent model before child startup. The parent may then either retry with the configured default or explicitly justify the deviation. Every admitted fallback or deviation must remain visible in lifecycle metadata and the WebUI, and the parent must disclose intentional deviations in its final response.

## 2. Current behavior and gap

The current flow is:

```text
WebUI settings
  -> effective user/project launch slots
  -> immutable snapshot loaded at Pi session_start
  -> natural-language system-prompt instructions
  -> WebUI fills omitted models on structured subagent/subagent_gate calls
  -> WebUI wraps workflowScript runs.run/runs.all calls with the same defaults
  -> pi-subagents independently resolves primary + fallback candidates
  -> child starts
```

Relevant current implementation:

- `lib/subagent-launch-slots.mjs` validates and formats launch slots.
- `lib/subagent-launch-policy.mjs` applies ordered role defaults while preserving explicit launch models.
- `webui-rpc-helper.mjs` loads the effective slots on `session_start`, appends guidance in `before_agent_start`, and applies the defaults in `tool_call`.
- `pi-subagents/src/runs/shared/model-fallback.ts` resolves explicit model, agent model, parent inheritance, and fallback candidates.
- `pi-subagents/src/extension/schemas.ts` accepts per-launch model overrides but has no structured deviation reason.

The remaining gap is that WebUI does not validate an explicit mismatched model or attest the final runtime model. Native fallback configuration can still run models that are absent from the WebUI slots, and launch paths that bypass the helper remain unenforced.

## 3. Goals

- Validate governed subagent launch models before any child process starts.
- Warn the parent through a blocked tool result with exact expected and requested assignments.
- Let the parent retry with the configured slot model.
- Permit an intentional mismatch only with an explicit, bounded reason.
- Never silently overwrite an explicit model choice.
- Allocate multiple same-role slots deterministically.
- Validate model and thinking separately using canonical provider-qualified identities.
- Treat fallback candidates as part of the admitted launch policy.
- Cover single, parallel, chain, count, dynamic, async, RPC, slash, gate, resume, and scheduled launch paths.
- Block invalid multi-child workflows atomically so zero children start.
- Persist expected, requested, attempted, and final model information.
- Expose match, deviation, fallback, unattested, and violation states in WebUI.
- Preserve compatibility when `pi-subagents` lacks the new launch-policy capability.

## 4. Non-goals

- Automatically deciding which roles the parent should launch.
- Silently changing an explicitly requested model.
- Reimplementing `pi-subagents` model resolution in browser code.
- Using browser-only confirmation dialogs for model-generated tool calls.
- Treating an operational fallback as an unexplained caller deviation.
- Editing the installed package under `~/.pi/agent/npm/node_modules/pi-subagents` directly.
- Requiring enforcement for unrelated custom agents unless they explicitly opt into a governed builtin role.

## 5. Policy semantics

### 5.1 Governed roles

The initial governed roles are:

```text
context-builder
delegate
oracle
planner
researcher
reviewer
scout
worker
```

`advisor` must either map explicitly to the `oracle` policy or receive its own visible slot. The implementation must not leave the alias accidentally ungoverned.

Custom agents are unmanaged by default. A custom agent that shadows or declares a governed role must carry an explicit role identity in resolved launch metadata.

### 5.2 Deterministic slot allocation

Role ordinals reset for every top-level launch request.

Logical children are flattened in this order:

1. single launch;
2. top-level `tasks` array order;
3. expanded `count` copy order;
4. chain step order;
5. static parallel-task order within a chain step;
6. expanded static counts within that task;
7. bounded dynamic reservations in stable item order.

For each role:

```text
occurrence 1 -> slot 1
occurrence 2 -> slot 2
occurrence 3 -> slot 3
```

There is no implicit cycling. An occurrence beyond the configured slot count is `slot-overflow` and blocks unless covered by an explicit deviation policy.

A single later tool call starts again at slot 1. Slots govern one top-level invocation, not a session-global round-robin queue.

### 5.3 Model and thinking comparison

Persisted slot models remain unsuffixed canonical `provider/model` identities. At validation time:

- split only recognized terminal thinking suffixes;
- resolve model identity canonically through `pi-subagents`;
- compare model and thinking separately;
- never switch providers while canonicalizing a qualified model;
- treat `thinking: null` as unconstrained thinking;
- require an explicit slot thinking value to match the resolved launch effort.

### 5.4 Decisions

| Decision | Meaning | Launch action |
|---|---|---|
| `exact` | Primary model and constrained thinking match the slot | Allow |
| `unmanaged-role` | Agent has no governed role | Allow and mark unmanaged |
| `model-omitted` | Slot has an explicit model but launch resolution does not select it | Block with correction |
| `model-mismatch` | Resolved primary differs from slot | Block unless justified |
| `thinking-mismatch` | Model matches but constrained effort differs | Block unless justified |
| `slot-overflow` | More role occurrences than slots | Block unless justified |
| `count-cannot-represent-slots` | One counted task would span heterogeneous slot routes | Block; require explicit tasks |
| `dynamic-cannot-represent-slots` | One dynamic template cannot represent reserved heterogeneous routes | Block or require explicit strategy/deviation |
| `allowed-deviation` | Mismatch has valid structured authorization | Allow, warn, and audit |
| `fallback` | Runtime used an admitted fallback after a retryable model failure | Allow and disclose |
| `unattested` | Legacy or incomplete metadata prevents proof | Do not fabricate a match; show warning |
| `violation` | Actual model is outside the admitted candidate set or launch digest drifted | Fail the policy gate or mark run invalid |

## 6. Parent warning and correction flow

For direct model-generated `subagent` calls, a mismatched request must be blocked before execution. The blocked tool result is the warning channel to the parent model.

Example:

```text
Subagent model policy blocked this launch.

reviewer occurrence 2
  expected slot: reviewer/<stable-slot-id>
  expected model: anthropic/claude-opus-5:high
  requested model: openrouter/moonshotai/kimi-k3:high
  policy revision: <revision>

Retry with the expected model, or submit a bounded model-deviation reason
and disclose the choice in the final response.
```

The result should include stable machine-readable decision codes and a bounded corrected assignment list, not only prose.

The validator must never silently mutate a mismatching explicit model. An omitted model may also be blocked and corrected rather than silently filled, so the final tool call remains an auditable statement of intent.

## 7. Explicit deviation contract

### 7.1 Durable upstream schema

Add the following optional field to single launches and every child-bearing schema in `pi-subagents`:

```json
{
  "modelDeviation": {
    "reason": "The user explicitly requested this model for this review angle."
  }
}
```

Requirements:

- `reason` is non-empty, trimmed, local-only audit data with a strict size limit.
- Never infer the reason from `task`, `label`, `phase`, or conversational prose.
- A top-level value applies only where a child does not supply its own value.
- A task-level value on `count` covers every expanded copy but is recorded separately for every occurrence.
- A dynamic-template value covers each materialized item and remains bound to the admitted reservation.
- Invalid or oversized values fail schema validation.

### 7.2 Transitional WebUI-only permit

Until the upstream schema is available, WebUI may register a temporary tool such as:

```text
approve_subagent_model_deviation(role, requestedModel, reason)
```

It returns a one-use, short-lived permit bound to:

- parent session ID;
- active slot revision and helper generation;
- role and role occurrence;
- requested model and thinking;
- normalized launch fingerprint;
- expiration time.

The exact next matching launch consumes the permit. Any mutation, reload, session replacement, timeout, or successful consumption invalidates it.

This is an MVP compatibility mechanism, not the final cross-package contract.

## 8. Validation architecture

### Gate A: configuration validation

Keep the current save-time checks and add:

- per-slot allowed fallback models and thinking validation;
- duplicate fallback removal;
- optional provider-family diversity warnings for multi-reviewer slots;
- an explicit policy mode such as `guidance`, `warn`, or `enforce`;
- versioned migration for existing launch-slot settings.

Configuration validation must use the active tab's available-model registry and supported thinking map.

### Gate B: immutable active-tab snapshot

Replace the guidance-only cache with an immutable session policy snapshot containing:

- protocol version;
- parent session ID;
- helper generation;
- project key and scope source;
- inherited/explicit scope state;
- active slot revision;
- ordered role slots and admitted fallbacks;
- load timestamp.

Guidance and validation must come from this same snapshot. Saving settings does not modify it. Only `/reload`, session replacement, or a new session loads a new snapshot.

The UI must compare persisted and active revisions and show `reload required` based on server/runtime evidence, including after browser refresh.

### Gate C: WebUI `tool_call` precheck

Add a defensive `pi.on("tool_call")` handler in `webui-rpc-helper.mjs`:

- ignore management/control actions;
- inspect direct `subagent` execution calls;
- flatten single/tasks/static-chain shapes;
- compare them with the active snapshot;
- block actionable mismatches before the tool executes;
- validate and consume transitional deviation permits;
- return expected assignments and policy revision.

This gate gives immediate feedback for ordinary parent-model tool calls. It must be documented as partial coverage because native slash, RPC, deferred, and dynamically materialized execution can bypass a WebUI-only listener.

### Gate D: authoritative `pi-subagents` admission

Add a generic, capability-negotiated launch-policy interface to upstream `pi-subagents`.

Suggested event protocol:

```text
subagents:launch-policy:v1:register
subagents:launch-policy:v1:unregister
subagents:launch-policy:v1:request
subagents:launch-policy:v1:reply:<requestId>
```

`pi-subagents` constructs one complete resolved launch plan after schema, chain, context, model, thinking, fallback, and clarify resolution but before:

- spawn-budget consumption;
- worktree creation;
- async runner creation;
- child process startup.

Each logical child in the request includes:

- structural location and role occurrence;
- selected agent runtime name, source, and definition digest;
- explicit-versus-omitted model intent;
- canonical primary model and thinking;
- ordered fallback candidates;
- count copy index;
- dynamic reservation information;
- deviation metadata;
- launch-contract digest.

The policy provider returns `allow`, `allow-with-warning`, or `block` plus structured decisions. A blocked multi-child request starts zero children.

The same admission path must cover:

- direct tool calls;
- foreground and async execution;
- slash bridges;
- RPC `spawn`;
- saved chains and prompt workflows;
- `subagent_gate` attempts;
- clarified launches after edits;
- scheduled runs when they actually fire.

Resume must verify the persisted original admission instead of allocating a new slot silently.

### Gate E: fallback admission

Fallback policy must become part of the same source of truth as the slot primary.

Extend each slot with an ordered `fallbackModels` list or an equivalent admitted-candidate policy. At admission time, compare the resolved native candidate list against the slot's admitted candidates.

Rules:

- primary plus configured slot fallbacks are admitted;
- duplicate primary/fallback candidates are normalized away;
- a fallback not admitted by the slot blocks in enforce mode;
- retry occurs only for existing `pi-subagents` retryable provider/model failures;
- task/tool failures never trigger model fallback;
- an admitted fallback is classified separately from a caller deviation.

Existing native fallback settings that conflict with WebUI slots must be migrated, removed, or explicitly displayed as external candidates. They must not remain a hidden second routing policy.

### Gate F: launch binding and attestation

Persist a bounded `modelPolicy` ledger with every child:

```text
admission id and digest
policy provider and slot revision
stable slot id and role occurrence
expected model/thinking
requested model/thinking
admitted candidate list
decision and deviation reason
attempted models and model attempts
final effective model/thinking
fallback classification
```

Immediately before spawn, recompute the admission digest against the final launch binding. Drift in model, thinking, fallback candidates, selected agent definition, or policy revision blocks startup.

At start and completion, classify the run as:

- `slot-matched`;
- `justified-deviation`;
- `admitted-fallback`;
- `unattested`;
- `policy-violation`.

Persist the ledger in foreground results, async `status.json`, `events.jsonl`, metadata artifacts, and retained WebUI summaries.

## 9. Count, chain, and dynamic behavior

### Static count

Expand counts during admission.

- `count: 2` may proceed when both assigned role slots have equivalent model/thinking expectations.
- A count spanning heterogeneous slots blocks with `count-cannot-represent-slots` and instructs the parent to create separate task entries.

### Static chain

Reserve role ordinals across the entire chain before the first step starts. A mismatch in a later static step blocks the whole chain atomically.

### Dynamic fanout

The current one-template model cannot safely express heterogeneous slots.

Before the first chain child starts:

- reserve up to the bounded `maxItems`;
- permit one template only when every reserved slot expectation is equivalent;
- otherwise require static tasks, a future explicit slot strategy, or a justified template deviation;
- allow materialized cardinality below the reservation;
- never allow materialization above it;
- bind stable item keys to reserved role occurrences.

## 10. WebUI UX and reporting

Extend the existing Subagents payload and side panel with:

- active policy mode and revision;
- persisted revision and reload-required state;
- blocked launch decisions;
- expected slot and actual model;
- deviation reason;
- admitted fallback use;
- attestation badge.

Badges:

```text
slot matched
justified deviation
fallback
unattested
policy violation
validation unavailable
```

Warnings must appear in the existing accessible live region and remain bounded.

### Final-response disclosure

The parent system guidance must require final disclosure for intentional deviations and operational fallbacks that changed the final effective model.

Example:

```text
Subagent model deviation: reviewer slot 2 expected Claude Opus 5,
but Kimi K3 was used because the user explicitly requested Kimi for that angle.
```

Do not rely solely on parent compliance. WebUI must always display the machine-recorded audit state. If strict transcript disclosure is enabled, add a compact extension-owned audit message when the parent omits it rather than fabricating parent prose.

## 11. Implementation workstreams

### Workstream A: pure WebUI policy engine

**New files**

- `lib/subagent-launch-policy.mjs`
- `tests/subagent-launch-policy.test.mjs`

**Modified files**

- `lib/subagent-launch-slots.mjs`
- `tests/subagent-launch-slots.test.mjs`

Implement pure snapshot, flattening, slot allocation, comparison, decision-code, correction, deviation-permit, and attestation-classification helpers.

### Workstream B: WebUI direct-call MVP

**Modified files**

- `webui-rpc-helper.mjs`
- `tests/subagents-helper.test.mjs`
- `README.md`

Load the immutable snapshot, inject matching guidance, add the direct `tool_call` guard, register the transitional acknowledgment tool when needed, and publish bounded policy status.

### Workstream C: upstream `pi-subagents` contract

Implement in the upstream source package and release it; do not patch the installed symlink.

Likely files:

- `src/api/launch-policy.ts` — new generic policy protocol.
- `src/extension/index.ts` — registration and lifecycle integration.
- `src/extension/rpc.ts` — capability advertisement and RPC-path coverage.
- `src/extension/schemas.ts` — `modelDeviation` fields.
- `src/shared/types.ts` — admission and attestation types.
- `src/runs/foreground/subagent-executor.ts` — atomic resolved admission.
- `src/runs/foreground/chain-execution.ts` — static-chain reservation.
- `src/runs/background/async-execution.ts` — detached launch manifest.
- `src/runs/background/subagent-runner.ts` — admitted candidate enforcement and attestation.
- `src/runs/shared/launch-contract.ts` — admission digest binding.
- dynamic, schedule, slash, RPC, and gate adapters as required to route through the same admission function.

### Workstream D: WebUI lifecycle and UI

**Modified files**

- `webui-rpc-helper.mjs`
- `bin/pi-webui.mjs`
- `public/app.js`
- `public/index.html`
- `public/styles.css`
- `tests/http-endpoints-harness.test.mjs`
- `tests/mobile-static.test.mjs` or a focused static contract file

Register the authoritative policy provider, consume attestation events, retain terminal policy metadata, expose runtime/persisted revisions, and render accessible statuses.

### Workstream E: fallback migration and documentation

**Modified files**

- WebUI settings schema and migration code in `lib/git-workflow-preferences.mjs` and `lib/subagent-launch-slots.mjs`.
- WebUI Agent models editor in `public/app.js` and related HTML/styles.
- `README.md` in both packages.
- `CHANGELOG.md` and package compatibility metadata in upstream `pi-subagents`.

Expose per-slot fallbacks, migrate existing settings safely, and document how native external fallbacks are handled.

## 12. Test plan

### Pure policy tests

Cover:

- exact primary and thinking match;
- omitted model with explicit slot;
- explicit mismatched model;
- inherit slot with omitted and explicit models;
- unconstrained versus constrained thinking;
- canonical/fuzzy spellings without provider switching;
- multiple same-role positional mapping;
- slot overflow and no cycling;
- equivalent and heterogeneous counts;
- static chain and parallel ordering;
- bounded dynamic reservations;
- valid, stale, consumed, mismatched, and expired deviation permits;
- admitted and unadmitted fallback candidates;
- legacy unattested records.

### Provider protocol tests

Cover:

- no provider capability;
- active provider allow/warn/block;
- timeout and unhealthy provider;
- duplicate/stale helper generations;
- parent session mismatch;
- provider replacement after `/reload`;
- blocked atomic plan starts zero children.

### Execution integration tests

Cover:

- single, tasks, count, chain, static parallel, and dynamic shapes;
- foreground and async runs;
- slash, RPC, gate, prompt workflow, and schedule entry points;
- clarify edits followed by re-admission;
- resume using persisted admission;
- admitted primary, admitted fallback, justified deviation, and violation;
- metadata parity across foreground details, async status, events, and artifacts.

### WebUI tests

Cover:

- user/project inheritance and stable revision;
- saved versus active revision before and after `/reload`;
- browser refresh retaining reload-required state;
- direct `tool_call` mismatch blocking;
- correction text and structured decision codes;
- deviation acknowledgment flow;
- accessible badges and warnings;
- retained terminal attestation;
- validation-unavailable compatibility state.

### Required validation commands

In upstream `pi-subagents`:

```bash
npm test
npm run check
```

Use the actual package scripts if names differ.

In `pi-package-webui`:

```bash
npm run check
node tests/subagent-launch-policy.test.mjs
node tests/subagent-launch-slots.test.mjs
node tests/subagents-helper.test.mjs
node tests/http-endpoints-harness.test.mjs
npm test
```

Also run `git diff --check` in every modified repository.

## 13. Rollout and compatibility

1. Add capability negotiation to upstream `pi-subagents` first.
2. Ship WebUI pure-policy and direct-call MVP behind a policy-mode setting.
3. When authoritative admission capability is absent:
   - keep guidance/direct-call behavior;
   - show `validation unavailable` for uncovered paths;
   - never claim full enforcement.
4. Once capability is present and the WebUI provider registers:
   - enforce governed roles according to configured mode;
   - fail closed if an active provider becomes unhealthy;
   - preserve normal behavior when WebUI is not present and no provider is registered.
5. Default migrated installations initially to `warn` unless the user explicitly enables `enforce`.
6. After one release of warning telemetry and test coverage, consider making `enforce` the default for explicitly configured slots.

## 14. Security, privacy, and safety constraints

- Deviation reasons remain local and bounded; never include secrets.
- Policy payloads expose only required model, role, revision, and run metadata.
- Do not expose unrestricted filesystem paths to the browser.
- Do not allow stale session/provider generations to approve launches.
- Do not consume spawn budget or create worktrees before admission succeeds.
- Do not auto-retry a blocked writer launch through a different model.
- Do not silently weaken enforcement when a registered provider fails.
- Preserve explicit user intent through structured justification, not hidden mutation.

## 15. Completion gates

The feature is complete only when:

- direct model-generated mismatches warn the parent before child startup;
- the parent can retry with the exact configured assignment;
- justified deviations are structurally represented and audited;
- all supported launch entry points share authoritative admission;
- blocked multi-child requests start zero children;
- fallback candidates are admitted from the same policy source;
- attempted and final models are attested in lifecycle artifacts;
- WebUI displays active revision, reload state, and attestation status;
- final deviations/fallbacks are visible even if parent prose omits them;
- compatibility behavior is explicit when the upstream capability is unavailable;
- focused and full package tests pass;
- independent reviewers assess the integrated cross-package implementation and every finding is dispositioned;
- the implementation report is complete;
- this plan is moved from `plans/planned/` to `plans/archive/` only after all completion gates are verified.

## 16. Risks and open implementation decisions

- A WebUI `tool_call` guard is useful but incomplete; authoritative enforcement must live before spawn in `pi-subagents`.
- Dynamic heterogeneous fanout requires either blocking, explicit static tasks, or a future model-strategy schema.
- Native fallback settings currently form a second policy source and require an explicit migration strategy.
- Exact provider/model resolution should come from `pi-subagents`; duplicated fuzzy resolution would drift.
- Final-response disclosure cannot safely depend only on model obedience; machine-visible audit UI is mandatory.
- The upstream source/release location for `pi-subagents` must be confirmed before implementation; installed package files are not an acceptable write target.
- The policy-mode default for existing users (`guidance` versus `warn`) should be finalized before rollout, while explicit new configurations may default more strictly.

## 17. Evidence from the design audit

During design review, the configured oracle primary `anthropic/claude-fable-5:high` failed with HTTP 429, then native fallback attempted `anthropic/claude-opus-4-8:high`, and finally ran `openrouter/moonshotai/kimi-k3:high`. This confirms that validating only the initial tool-call model is insufficient: fallback candidates and final effective model require admission and attestation as first-class policy data.
