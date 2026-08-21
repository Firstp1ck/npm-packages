# Security and documentation review fallback

- **Reviewer run:** `7f12317b`, resumed from `d6bc5abb`
- **Provider/model:** LM Studio / `qwen/qwen3.8-27b:high`
- **Mode:** fresh-context, read-only
- **Status:** completed after a provider-timeout recovery and supervisor wrap-up request
- **Confidence:** 72/100 overall; individual code findings at least 85/100
- **Source log:** `/tmp/pi-subagents-uid-1000/async-subagent-runs/7f12317b/subagent-log-7f12317b.md`

The reviewer inspected the plan, both implementation handoffs, the pure policy and slot code, and the helper permit sections. It did not run commands or inspect the test and documentation diffs.

## Findings

### F1: model-callable approval lacks runtime proof of user authorization

**Severity:** Low, acknowledged design limitation.  
**Affected:** `approve_subagent_model_deviation` registration and `approveSubagentModelDeviation` in `webui-rpc-helper.mjs`.

The tool relies on its description and prompt guidelines. A model can call it without a runtime check that the user approved the exact occurrence and model. The smallest stronger remediation is an explicit user-confirmation channel; otherwise the boundary must remain prominent in user documentation.

### F2: reviewer enforcement fails open when the slot snapshot is unavailable

**Severity:** Medium.  
**Affected:** `loadSubagentLaunchSlotGuidance` failure path and the `tool_call` early return in `webui-rpc-helper.mjs`.

When settings cannot be read, `subagentLaunchSlotRoles` becomes `null` and reviewer mismatches proceed without enforcement. The reviewer recommends a visible validation-unavailable warning or fail-closed reviewer behavior.

### F3: a workflow permit lease is non-recoverable

**Severity:** Low.  
**Affected:** workflow permit removal in the helper `tool_call` hook.

All active descriptors are removed when embedded into one wrapper. A workflow that fails before consumption loses the permit. This matches the planned one-wrapper lease but needs explicit documentation unless recovery is added.

### F4: a direct permit is not restored after downstream execution failure

**Severity:** Low.  
**Affected:** direct `consumedDeviationIds` removal in the helper `tool_call` hook.

The helper consumes at policy admission, before downstream child success is known. A later tool failure does not restore the permit. This should be documented or handled by a failure-restoration mechanism.

## Verified behavior

- Revision and helper-generation invalidation are present.
- Deviation reasons stay in local in-memory permit state and are not embedded in workflow descriptors.
- Direct one-use matching, bounds, omitted reviewer defaults, and unchanged non-reviewer behavior are internally consistent.
- The implementation remains WebUI-local and does not claim upstream admission coverage.

## Gaps

The reviewer did not run tests, inspect the test files, inspect the documentation diffs, or verify active-tool selection. The integration owner independently ran the focused tests, `npm run check`, `npm test`, and diff checks.
