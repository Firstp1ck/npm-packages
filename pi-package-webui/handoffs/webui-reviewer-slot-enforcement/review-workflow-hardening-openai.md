# Workflow hardening revalidation

## Review

### C1 — Mutable intrinsic/prototype poisoning

**FAIL — Blocker**

The hardening removes the originally reported `findIndex`, `Set.has/add`, and `Object.assign` dispatches from an executing wrapper, but mutable prototype paths remain.

#### Blocker 1: indexed prototype setter can suppress a mismatch

- **Location:** `lib/subagent-launch-policy.mjs:276,293-296,311-316`
- Mismatch decisions are appended with:
  ```js
  decisions[decisions.length] = decision
  ```
- A workflow can install a setter on `Array.prototype["0"]`. Assignment to an empty `decisions` array invokes that inherited setter rather than creating an own element.
- The setter can receive the private decisions array as `this`. If it swallows the assignment, `decisions.length` remains zero and the mismatch reaches the original runtime.

Conceptual reproduction inside supplied workflow code:

```js
let leaked;
const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");

Object.defineProperty(Array.prototype, "0", {
  configurable: true,
  set(value) { leaked = this; }
});

try {
  return await runs.run("review", {
    agent: "reviewer",
    task: "Bypass",
    model: "other/model:high"
  });
} finally {
  if (previous) Object.defineProperty(Array.prototype, "0", previous);
  else delete Array.prototype[0];
}
```

The same decision-array path affects `runs.all`.

#### Blocker 2: persistent poisoning disables later policy calls

- **Location:** `lib/subagent-launch-policy.mjs:335,349,353`
- The module still invokes mutable methods directly:
  - `SUPPORTED_TOOLS.has(toolName)`
  - `WRAPPED_WORKFLOW_INPUTS.has(input)`
  - `WRAPPED_WORKFLOW_INPUTS.add(input)`
- A completed workflow can leave `Set.prototype.has` poisoned. A subsequent call then returns early at line 335 with an empty report, admitting an otherwise blocked mismatch.
- Poisoning `WeakSet.prototype.has` can also receive the private marker-ownership `WeakSet` as `this`, leak it, and return `true` so a new workflow is treated as already wrapped.

Conceptual cross-call reproduction:

```js
// First supplied workflow:
Set.prototype.has = () => false;
return "poisoned";

// A subsequent direct or workflow policy call:
applySubagentLaunchSlotDefaults("subagent", {
  agent: "reviewer",
  model: "other/model:high"
}, roles);
// Returns before enforcing at lib/subagent-launch-policy.mjs:335.
```

This also means a later generated wrapper can capture already-poisoned globals at `lib/subagent-launch-policy.mjs:212-224`.

#### Smallest remediation

1. Append private array elements with captured `Object.defineProperty`, not ordinary indexed assignment.
2. Populate `prepared` with captured property definition and use captured own-property checks instead of `index in prepared`.
3. Capture and bind all module-level security-sensitive intrinsic operations at module initialization, including `Set` and `WeakSet` operations.
4. Address poisoning that survives between workflows. The robust solution is realm/process isolation for supplied workflow code; otherwise a trusted pristine intrinsic bundle must be made available to every wrapper without exposing it to supplied code.

---

### C2 — Stateful Proxy/getter parameter mismatch

**FAIL overall — `runs.run` is fixed, but `runs.all` remains bypassable when combined with prototype poisoning.**

#### Correct for ordinary Proxy/getter inputs

- `__piWebuiSnapshotRecord` creates a plain copy and removes its prototype at `lib/subagent-launch-policy.mjs:228-233`.
- `runs.run` snapshots before policy evaluation, evaluates that snapshot, and forwards the identical record at `lib/subagent-launch-policy.mjs:290-296`.
- `runs.all` intends the same behavior at `lib/subagent-launch-policy.mjs:303-316`.
- Focused tests verify one-time reads and identical forwarding:
  - `tests/subagent-launch-policy.test.mjs:313-349`
  - `tests/subagent-launch-policy.test.mjs:352-384`

#### Remaining `runs.all` bypass

`prepared[index]` is installed with ordinary assignment and later selected using inherited-property-sensitive `index in prepared`:

- `lib/subagent-launch-policy.mjs:307`
- `lib/subagent-launch-policy.mjs:313`

A stateful accessor on `Array.prototype["0"]`, with a setter that swallows the prepared snapshot, can return:

1. An allowed reviewer model when policy reads `prepared[0]`.
2. A mismatching model when the original `runs.all` subsequently reads the same inherited property.

Thus the original runtime can still observe a different model from policy. `runs.run` does not have this remaining indexed-container path.

**Smallest remediation:** define each prepared item as an own data property with captured `Object.defineProperty`, and inspect only own prepared elements using a captured own-property operation.

---

## Preserved invariants

| Invariant | Result | Evidence |
|---|---|---|
| Marker ownership | **Nominal PASS, poison-resistance FAIL** | Ownership uses a module-private `WeakSet` at `lib/subagent-launch-policy.mjs:8,349-353`, and marker-spoof tests pass at `tests/subagent-launch-policy.test.mjs:235-245`. Persistent `WeakSet.prototype.has` poisoning can still subvert or leak it. |
| Workflow lexical isolation | **PASS** | Supplied code is compiled as a separate strict async function at `lib/subagent-launch-policy.mjs:207-211,325`; private-name tests are at `tests/subagent-launch-policy.test.mjs:248-271`. |
| Permit expiry | **PASS within a clean wrapper** | Expiry is checked at use at `lib/subagent-launch-policy.mjs:264-275`; delayed-expiry regression is at `tests/subagent-launch-policy.test.mjs:387-401`. |
| Synchronous-validation state commit | **PASS** | Original `run`/`all` is invoked before committing occurrence and permit state at `lib/subagent-launch-policy.mjs:296-298,316-318`; retry tests are at `tests/subagent-launch-policy.test.mjs:404-419`. |
| Omitted default filling | **PASS** | The stable snapshot receives an own model property at `lib/subagent-launch-policy.mjs:256-260`; direct and workflow coverage appears at `tests/subagent-launch-policy.test.mjs:132-148,156-180`. |
| `status`/`ref`/`refs` forwarding | **PASS by inspection** | Each delegates its argument directly to the original runtime at `lib/subagent-launch-policy.mjs:321-323`. |

## Test gaps

- `tests/subagent-launch-policy.test.mjs:274-310` poisons named methods but does not test numeric accessors/setters on `Array.prototype`.
- The poisoning test restores every modified intrinsic immediately. It does not test poisoning that survives one workflow and affects a later policy call or wrapper.
- No test poisons `WeakSet.prototype.has/add` or verifies that marker ownership remains private.
- There is no focused execution test calling wrapped `runs.status`, `runs.ref`, or `runs.refs`; forwarding is currently source-inspection-only.
- The C2 tests cover direct Proxy/getter items but not inherited stateful accessors on the `runs.all` container.

## Checks

No commands were run because this reviewer had read-only file-inspection tools and no shell execution capability. The recovery handoff reports that the focused test and syntax check previously passed, but those results were not independently rerun here.

## Residual risks

- C1 remains exploitable within one workflow and across subsequent workflows in the same realm.
- C2 remains exploitable for `runs.all` through inherited indexed accessors.
- WebUI-local enforcement does not govern paths bypassing the helper.
- Permits remain admission-spent after asynchronous/downstream failure by documented design.

**Confidence: 96/100.** The blockers follow directly from the cited indexed assignment, inherited-property lookup, and mutable prototype dispatch. Confidence is below 100 because executable reproductions could not be run.