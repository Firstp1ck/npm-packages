# StarRouter Integration Plan

**Status:** Draft / potential integration  
**Target:** `pi-package-webui`  
**Related packages:** `pi-star-router`, `pi-subagents`  
**Prepared:** 2026-07-14

## 1. Purpose

Integrate StarRouter into Pi WebUI as an optional, capability-detected model-routing feature with native browser controls for main-agent and subagent routing.

The integration should preserve Pi's existing manual model and thinking controls, expose structured routing decisions and explanations, and fail safely when StarRouter is absent, unavailable, stale, or incompatible.

## 2. Goals

- Offer `pi-star-router` through the existing Optional Features package workflow.
- Detect runtime availability independently from package installation status.
- Add native per-session routing modes for the main agent.
- Display the current route, recommendation rationale, alternatives, and benchmark health.
- Support explicit subagent routing policies without silently overriding existing agent configuration.
- Preserve global/project configuration ownership and trust boundaries.
- Keep manual model selection fully functional when StarRouter is unavailable or disabled.
- Avoid parsing StarRouter's TUI widget or status text as an API.

## 3. Non-goals

- Reimplement StarRouter's scoring algorithm in Pi WebUI.
- Make WebUI the owner of StarRouter configuration files.
- Automatically enable routing after package installation.
- Automatically trust or install future StarRouter releases without review.
- Route subagents independently on every internal turn.
- Require changes to Pi core unless package-level event RPC proves insufficient.

## 4. Existing integration points

### Pi WebUI

- Optional package registry: `bin/pi-webui.mjs` (`OPTIONAL_FEATURE_PACKAGES`).
- Controlled package/update registry: `bin/pi-webui.mjs` (`WEBUI_CONTROLLED_PACKAGES`, `UPDATE_PACKAGE_NAMES`).
- Optional Features metadata and UI: `public/app.js` (`OPTIONAL_FEATURES`).
- Pi extension registration and optional dependencies: `package.json`.
- Model APIs: `/api/model`, `/api/models`, and `/api/model-cycle`.
- Thinking APIs: `/api/thinking` and `/api/thinking-cycle`.
- Model/thinking footer pickers: `public/app.js`.
- Pi event-bus bridge precedent: `webui-rpc-helper.mjs` and the existing `pi-subagents` integration.

### StarRouter

- Main routing hook: `index.ts`, `before_agent_start`.
- Routing implementation: `src/router-core.ts`, `chooseRoute()`.
- Structured route candidates and decision summaries already exist in the routing core.
- Current RPC-mode output is presentation-oriented status/widget text rather than a stable structured API.
- Global and project configuration are loaded and saved by StarRouter.
- Project configuration is restricted through `projectConfigProjection()` and `projectConfigOverride()`.

### pi-subagents

- Versioned event-bus RPC exists in `src/extension/rpc.ts`.
- Current methods are `ping`, `status`, `spawn`, `interrupt`, and `stop`.
- Existing settings support `subagents.defaultModel`, model scope, fallback models, and per-agent model/thinking overrides.

## 5. Proposed architecture

```text
Browser UI
  -> Pi WebUI HTTP endpoints
  -> active Pi tab/session
  -> webui-rpc-helper.mjs
  -> star-router:rpc:v1 event bridge
  -> StarRouter routing/configuration core
```

For subagents:

```text
pi-subagents launch resolution
  -> StarRouter route request in the parent Pi process
  -> selected model + thinking level
  -> explicit, locked route for the subagent run
```

### Architectural rules

1. StarRouter remains the source of truth for routing decisions and its configuration.
2. WebUI consumes versioned structured data and does not parse human-readable widget lines.
3. Package installation status and per-tab runtime capability are modeled separately.
4. Main-agent browser routing uses a preflight decision before the prompt is sent.
5. Subagents are routed once per run before launch.
6. Existing explicit model/thinking selections take precedence unless the user explicitly changes the routing policy.

## 6. Package integration

### Planned package changes

In `package.json`:

- Add `node_modules/pi-star-router/index.ts` to `pi.extensions`.
- Add `pi-star-router` to `optionalDependencies`.
- Initially pin the audited package version exactly, for example `1.1.0`.

In `bin/pi-webui.mjs`:

- Add `starRouter -> pi-star-router` to `OPTIONAL_FEATURE_PACKAGES`.
- Let the existing controlled-package and update registries derive it from that map.
- Return package version, installation state, update state, and restart requirements through the existing Optional Features API.

In `public/app.js`:

- Add a `StarRouter` feature entry under a new **Model routing** section.
- Explain that installation does not automatically enable routing.
- Show distinct states:
  - not installed;
  - installed, restart required;
  - loaded, disabled;
  - loaded, ready;
  - loaded, degraded;
  - installed but incompatible/unavailable.

### Package safety

- Keep the existing explicit npm-install confirmation.
- Do not enable routing automatically after installation or update.
- Show the installed and supported protocol versions.
- Require a restart after first installation or extension update.

## 7. StarRouter structured RPC contract

Add a StarRouter-owned versioned event protocol modeled after the existing subagent bridge:

```text
star-router:rpc:v1:ready
star-router:rpc:v1:request
star-router:rpc:v1:reply:<requestId>
```

### Initial methods

| Method | Purpose |
|---|---|
| `ping` | Return protocol version, methods, capabilities, and active-session state. |
| `get_state` | Return effective routing mode, dataset health, effective route, and last decision. |
| `get_settings` | Return editable settings, inherited values, scope, and source metadata. |
| `update_settings` | Apply a validated allowlisted patch through StarRouter's own persistence functions. |
| `set_session_policy` | Set or clear a per-session routing override without persisting it globally. |
| `preview_route` | Produce a bounded structured decision without applying it. |
| `commit_route` | Validate and apply a previously issued one-time decision. |
| `get_last_decision` | Return the last applied/declined route explanation. |
| `refresh_benchmarks` | Refresh routing data with bounded timeout and explicit status. |

### Capability response

The `ping` response should advertise capabilities instead of forcing WebUI to infer them from package versions:

```json
{
  "version": 1,
  "methods": ["ping", "get_state", "preview_route"],
  "capabilities": {
    "mainRouting": true,
    "sessionPolicy": true,
    "routePreview": true,
    "routeCommit": true,
    "settingsRead": true,
    "settingsWrite": true,
    "subagentRouting": false
  }
}
```

### Route decision shape

```json
{
  "decisionId": "opaque-one-time-id",
  "scope": "main",
  "policy": "ask",
  "recommended": {
    "provider": "provider-id",
    "modelId": "model-id",
    "thinkingLevel": "high"
  },
  "alternatives": [],
  "reasonLines": [],
  "confidence": 0.86,
  "objective": "balanced",
  "dataset": {
    "state": "ready",
    "updatedAt": "2026-07-14T00:00:00.000Z",
    "stale": false
  }
}
```

All arrays and external strings must have explicit size limits.

### Decision-token requirements

A route decision should be:

- opaque;
- short-lived;
- usable once;
- bound to the prompt hash;
- bound to the active session;
- bound to the StarRouter configuration revision;
- bound to the available-model catalog and benchmark-data generation.

A stale or mismatched decision must fail without changing the current model.

## 8. Pi WebUI server bridge

Add tab-scoped HTTP endpoints backed by `webui-rpc-helper.mjs`:

```text
GET  /api/star-router/capabilities
GET  /api/star-router/state
GET  /api/star-router/settings
POST /api/star-router/settings
POST /api/star-router/session-policy
POST /api/star-router/preview
POST /api/star-router/commit
POST /api/star-router/benchmarks/refresh
```

### Server requirements

- Resolve every runtime request against the requested active Pi tab.
- Reuse existing request authentication, origin, and remote-access protections.
- Apply request body and timeout limits.
- Validate response envelopes before returning data to the browser.
- Distinguish unavailable, incompatible, timed-out, and execution-failed responses.
- Never expose environment-variable values, credentials, or unrestricted filesystem paths.
- Do not provide a generic arbitrary StarRouter RPC passthrough endpoint.

## 9. Main-agent UX

### Footer control

Add a routing-mode control beside the existing model and thinking controls:

```text
Route: [Manual] [Ask] [Auto]
Current: provider/model @ high
```

- **Manual:** Existing model and thinking selectors remain authoritative.
- **Ask:** Preview a route and require native browser confirmation before submitting the prompt.
- **Auto:** Preview, commit, and apply a route before submitting the prompt.
- **Current:** Read-only route status; not a policy mode.

The footer mode is a per-tab/session override. Persistent global/project defaults belong in Settings.

### Direct model-selection behavior

When the user changes the model or thinking level while Ask/Auto is active, offer:

1. switch this session to Manual; or
2. use the selected route for the next turn only.

Do not silently allow direct controls and automatic routing to overwrite each other.

### Prompt submission flow

```text
User submits prompt
  -> request preview_route
  -> if Ask: display native confirmation
  -> commit decision
  -> verify committed provider/model/thinking
  -> send prompt
```

StarRouter's later `before_agent_start` hook should consume the committed decision instead of calculating and applying a second route.

### Failure behavior

On RPC timeout, stale decision, missing capability, benchmark failure, or lost connection:

- keep the current route;
- do not send the prompt until the user chooses whether to continue manually when confirmation was expected;
- present a concise recoverable error;
- offer **Continue with current model** and **Cancel**.

### Decision display

Add a compact chip to routed assistant turns:

```text
Routed: provider/model · high · Balanced
```

A details drawer should show:

- selected route and routing policy;
- recommendation rationale;
- top alternatives;
- objective and constraints;
- benchmark cache age and degraded state;
- exact/degraded model identity match;
- automatic, approved, pinned, fallback, or manual source.

## 10. Settings UX

Add a **Model routing / StarRouter** settings panel when the capability is available.

### Basic settings

- Persistent routing default: Off / Ask / Auto.
- Save scope: Global / Project.
- Routing provider/model pool.
- Objective: Balanced / Quality / Cheapest / Fastest.
- Benchmark status and refresh action.
- Auto-accept warning.

### Advanced settings

- Existing StarRouter thresholds and filters.
- Model-family and model allow/deny controls.
- Preset selection.
- Data source/cache metadata.

### Scope behavior

- Clearly display inherited values and their source.
- Clearly warn when `.pi/model-router.json` supplies project overrides.
- Keep global-only fields unavailable in project scope.
- Send validated setting patches to StarRouter; do not edit configuration files directly from WebUI.

## 11. Subagent routing

### Proposed policy model

Global subagent default:

```text
Inherit existing configuration
StarRouter — route once per run
Pinned model + thinking level
```

Per-agent override:

```text
Inherit
StarRouter
Pinned model + thinking level
```

### Precedence

1. Explicit model/thinking supplied in the spawn request.
2. Per-agent pinned policy.
3. Per-agent StarRouter policy.
4. Global subagent routing policy.
5. Existing `pi-subagents` default/profile/agent resolution.

The UI must display the effective source so that users can understand why a route was selected.

### Launch behavior

- Request a StarRouter route in the parent Pi process before launching the child.
- Include the task prompt, agent name/role, selected profile, available model scope, and allowed constraints.
- Pass the selected model and thinking level explicitly to the child.
- Lock the selected route for that run.
- Preserve configured fallback models.
- Record planned, actual, and fallback routes in subagent status metadata.
- Do not allow child StarRouter instances to reroute every internal turn unless a future explicit mode supports it.

### Required pi-subagents work

Potential additions include:

- capability-advertised configuration read/update RPC methods;
- routing policy fields for defaults and per-agent overrides;
- a StarRouter route request during launch resolution;
- structured route metadata in spawn/status responses;
- an explicit route-lock marker for child sessions.

These changes should be implemented in `pi-subagents`, not by WebUI directly editing its settings files.

### Confirmation policy

Do not block tool-driven subagent launches on a browser-only confirmation dialog. Initial subagent modes should be limited to:

- inherit/pinned; or
- explicitly enabled automatic routing.

A future Ask mode may be added for browser-initiated launches if the launch protocol supports a two-step approval flow.

## 12. Security and trust boundaries

- Default routing to disabled after installation.
- Default main-agent routing to Ask when first enabled.
- Require separate explicit opt-in for automatic subagent routing.
- Keep project configuration restrictions enforced by StarRouter.
- Validate every committed provider/model against Pi's current available-model catalog.
- Validate thinking levels against the selected model's supported map.
- Never return secret environment values through state/settings RPC.
- Render all model names, benchmark labels, and rationale text as text, not HTML.
- Bound RPC payload sizes, candidate counts, reason lines, and timeouts.
- Reject unknown RPC methods and unsupported protocol versions.
- Keep package install/update confirmation and restart warnings.
- Fail closed to the current or pinned route; never silently auto-accept after an error.
- Record routing source and fallback behavior locally without introducing remote telemetry.

## 13. Compatibility strategy

WebUI should capability-detect each tab and support:

| StarRouter state | WebUI behavior |
|---|---|
| Not installed | Show Optional Features install action; keep manual controls. |
| Installed, not loaded | Show restart required. |
| Loaded without structured RPC | Mark native integration unavailable; do not parse widgets. |
| RPC protocol supported | Enable supported controls only. |
| Newer unsupported protocol | Show incompatible-version message; preserve manual controls. |
| Router degraded/offline | Show health state and manual fallback. |

The same capability approach applies independently to `pi-subagents`.

## 14. Implementation phases

### Phase 0 — Contract and proof of concept

- [ ] Agree on the StarRouter RPC envelope, methods, error codes, and capability response.
- [ ] Prototype `ping`, `get_state`, and `preview_route` through a live WebUI Pi tab.
- [ ] Verify that prompt preflight and commit can run before the normal prompt request without deadlocking Pi RPC.
- [ ] Define one-time decision consumption by `before_agent_start`.
- [ ] Decide initial package version pinning and update policy.

**Exit criterion:** WebUI can receive and validate a structured route preview from StarRouter without parsing UI text.

### Phase 1 — Optional package integration

- [ ] Add the optional dependency and Pi extension resource.
- [ ] Register StarRouter in server and browser Optional Features registries.
- [ ] Add install/update/restart states.
- [ ] Add package and capability status tests.

**Exit criterion:** StarRouter can be installed and updated through the existing workflow, and WebUI distinguishes installed from loaded/ready.

### Phase 2 — Read-only native integration

- [ ] Implement the versioned StarRouter event bridge.
- [ ] Add WebUI helper and HTTP state/capability endpoints.
- [ ] Display router state, dataset health, current route, and last decision.
- [ ] Add bounded schema validation and compatibility handling.

**Exit criterion:** WebUI provides reliable read-only routing status with safe absence/degradation behavior.

### Phase 3 — Main-agent routing

- [ ] Add per-session Manual / Ask / Auto policy.
- [ ] Implement preview, native confirmation, commit, and prompt submission sequencing.
- [ ] Add one-turn manual override behavior.
- [ ] Add route chips and the explanation drawer.
- [ ] Add global/project settings through StarRouter-owned RPC.
- [ ] Cover timeout, stale-token, unavailable-model, and offline-dataset cases.

**Exit criterion:** Main-agent routes can be safely previewed and applied without duplicate rerouting or regressions to manual controls.

### Phase 4 — Subagent routing

- [ ] Agree on StarRouter-to-subagents route request and route-lock contracts.
- [ ] Add default and per-agent routing policy support to `pi-subagents`.
- [ ] Route once before spawn and preserve explicit overrides/fallbacks.
- [ ] Expose planned/actual/fallback route metadata in status.
- [ ] Add WebUI subagent policy selectors and effective-source display.

**Exit criterion:** Explicitly opted-in subagents receive one stable route per run with deterministic precedence and visible provenance.

### Phase 5 — Hardening and polish

- [ ] Complete accessibility and keyboard navigation.
- [ ] Add benchmark refresh and cache-age UX.
- [ ] Add local route history if approved.
- [ ] Run compatibility tests across supported Pi, StarRouter, and pi-subagents versions.
- [ ] Review security boundaries and update user documentation.

**Exit criterion:** Integration is documented, accessible, security-reviewed, and covered by regression tests.

## 15. Expected file changes

### `pi-package-webui`

- `package.json` — optional dependency and extension registration.
- `bin/pi-webui.mjs` — optional package metadata, tab-scoped StarRouter APIs, validation, and error mapping.
- `webui-rpc-helper.mjs` — versioned StarRouter event-bus client and capability tracking.
- `public/app.js` — state, routing controls, preflight flow, dialogs, settings, and decision display.
- `public/index.html` or equivalent WebUI markup — routing controls and settings containers.
- WebUI stylesheet files — route chips, mode control, dialog, health states, and responsive layout.
- `tests/` — package, bridge, endpoint, UI-state, security, and regression tests.
- `README.md` — installation, safety defaults, routing modes, and troubleshooting.

### `pi-star-router`

- `index.ts` — register structured RPC and consume committed browser decisions.
- New `src/rpc.ts` or equivalent — protocol schemas, dispatch, capability response, and bounded validation.
- `src/router-core.ts` — expose preview/commit-safe operations where necessary.
- Tests for RPC contracts, decision tokens, session policy, and failure behavior.
- Documentation for third-party clients.

### `pi-subagents`

- `src/extension/rpc.ts` — capability-advertised config/routing methods if needed by WebUI.
- Agent/settings code — routing policy model and precedence.
- Spawn lifecycle — route request, explicit model/thinking, route lock, and metadata.
- Status schemas and tests — planned/actual/fallback route reporting.

## 16. Test plan

### Unit and contract tests

- Protocol version and capability negotiation.
- Malformed request/reply handling.
- Unknown method and unsupported-version handling.
- Payload bounds and external-string sanitization.
- Decision expiry, one-time use, prompt binding, and session binding.
- Settings patch allowlist and project/global scope restrictions.
- Model/thinking validation against Pi's available catalog.

### WebUI API tests

- Installed versus loaded versus ready states.
- Correct active-tab routing.
- Missing helper or StarRouter capability.
- Timeout and extension restart behavior.
- Authentication/origin protections for new endpoints.
- No environment values or unrestricted paths in responses.

### Main-agent integration tests

- Manual mode remains unchanged when StarRouter is absent.
- Ask mode approve, alternative selection, keep-current, and cancel.
- Auto mode applies exactly one route.
- Manual selection while Auto is active.
- Stale preview after settings/model-catalog change.
- Dataset unavailable/degraded behavior.
- Model or thinking application failure.
- Tab switching during preview or confirmation.

### Subagent integration tests

- Explicit spawn route wins.
- Per-agent policy wins over global subagent default.
- StarRouter is called only when policy permits it.
- Route is selected once and locked for the run.
- Fallback models remain available.
- Planned, actual, and fallback route metadata are accurate.
- Child sessions do not reroute unexpectedly.
- StarRouter unavailable falls back to existing `pi-subagents` resolution.

### Compatibility matrix

Test combinations of:

- StarRouter absent / old without RPC / current RPC / newer unsupported RPC.
- pi-subagents absent / current / routing-capable.
- local WebUI / remote WebUI.
- global config / project config / session override.
- fresh benchmark data / stale cache / offline/no cache.

## 17. Acceptance criteria

- StarRouter is optional and does not affect existing users unless installed and enabled.
- Package installation, update, restart, and runtime capability states are accurate.
- WebUI never parses StarRouter widget/status text for routing data.
- Manual model and thinking controls remain usable and predictable.
- Ask mode never changes the route without an explicit decision.
- Auto mode is opt-in and visibly reports each applied route.
- Routing failures preserve the current or pinned route.
- Global/project settings are persisted only by StarRouter.
- Project configuration cannot set restricted global-only fields through WebUI.
- Subagents are routed only when explicitly enabled and at most once per run.
- Explicit subagent model/thinking choices retain precedence.
- New APIs pass authentication, validation, payload-bound, and XSS tests.
- Existing Pi WebUI test suites continue to pass.

## 18. Risks and mitigations

| Risk | Mitigation |
|---|---|
| StarRouter blocks waiting for TUI confirmation in RPC mode | Use browser preflight and one-time commit rather than the TUI choice screen. |
| Model is routed twice | Bind and consume committed decisions in `before_agent_start`. |
| Direct selectors conflict with automatic routing | Make routing policy explicit and require Manual or one-turn override. |
| Package installed but extension not loaded | Model package and runtime capability separately; show restart state. |
| Project configuration influences routing unexpectedly | Show effective source and preserve StarRouter's project projection restrictions. |
| Tool-driven subagents bypass browser settings | Integrate routing into `pi-subagents` launch resolution, not only browser spawn UI. |
| Subagent model changes during a run | Route once and lock the child route. |
| Compromised/stale benchmark data produces unsafe selections | Keep Ask as the recommended default, show data health, validate available models, and retain manual fallback. |
| Future package update differs from audited code | Initially pin the audited release and require deliberate review/update. |
| Extension/API version drift | Use versioned envelopes and capability-based UI. |

## 19. Open decisions

1. Should the first WebUI release pin `pi-star-router@1.1.0` exactly or allow a reviewed compatible range?
2. Will the structured RPC contract be accepted upstream by StarRouter, maintained as a patch, or implemented through a separate adapter extension?
3. Should `commit_route` apply the route inside StarRouter or return a verified route for WebUI to apply through existing model/thinking APIs?
4. How should one-turn manual overrides be represented and consumed?
5. Where should optional local route history live, and should it persist at all?
6. Should benchmark refresh be user-triggered only or also follow StarRouter's existing refresh policy?
7. Should subagent routing policy live in StarRouter config, pi-subagents config, or a deliberately split ownership model?
8. Is browser-confirmed Ask mode needed for subagents, or are inherit/pinned/auto sufficient?
9. What minimum StarRouter and pi-subagents protocol versions will Pi WebUI support?
10. Does remote WebUI require additional permission prompts before settings changes or automatic routing?

## 20. Recommended initial scope

Implement Phases 0 through 3 first:

1. Optional package installation and restart handling.
2. Structured StarRouter capability/state bridge.
3. Read-only route and benchmark status.
4. Main-agent Manual / Ask / Auto routing.
5. Native route confirmation and explanation UI.

Defer subagent routing until the main-agent contract is stable and the required `pi-subagents` ownership and precedence rules have been agreed.
