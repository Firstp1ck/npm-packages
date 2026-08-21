# Accepted reviewer fixes revalidation

## Review

### Per-finding disposition

| Finding | Result | Evidence |
|---|---|---|
| **A1 — Marker spoofing** | **PASS** | Wrapper trust is module-private: `WRAPPED_WORKFLOW_INPUTS` is a `WeakSet`, and wrapping checks object membership rather than marker text (`lib/subagent-launch-policy.mjs:6,308-314`). Spoof regressions cover both `runs.run` and `runs.all` (`tests/subagent-launch-policy.test.mjs:235-245`). |
| **A2 — Workflow isolation** | **FAIL / BLOCKER** | The separately constructed strict async function prevents lexical access to generated identifiers (`lib/subagent-launch-policy.mjs:208-215,285`; tests at `tests/subagent-launch-policy.test.mjs:248-271`). However, wrapper-private state remains reachable through mutable shared intrinsics: after user code replaces `Array.prototype.findIndex`, the call `__piWebuiDeviations.findIndex(...)` passes the private deviations array as `this` (`lib/subagent-launch-policy.mjs:240`). The replacement can leak that array and return `0`, admitting a reviewer mismatch even when no permit exists. No prototype-poisoning regression exists. |
| **A3 — Permit expiry at use** | **PASS** | Descriptors require bounded `expiresAt` (`lib/subagent-launch-policy.mjs:46-80`), direct matching checks `expiresAt > now` (`:102-106`), and the workflow adapter captures a clock and checks expiry at each child use (`:215,239-241`). The helper preserves expiry (`webui-rpc-helper.mjs:2166-2173`). Delayed-use tests appear at `tests/subagent-launch-policy.test.mjs:274-289` and `tests/subagents-helper.test.mjs:295-347`. Subject to the A2 prototype-poisoning blocker. |
| **A4 — Synchronous rejection state** | **PASS** | Both adapters clone state, invoke the original runtime, and commit only after it returns without throwing synchronously (`lib/subagent-launch-policy.mjs:255-279`). Retry tests cover `run` and `all` (`tests/subagent-launch-policy.test.mjs:291-306`). |
| **B1 — Exact interactive confirmation** | **PASS** | Approval requires `hasUI === true`, a confirmation function, and confirmation result exactly `true`; it displays occurrence, requested model, duration, and reason, then revalidates snapshot revision/generation (`webui-rpc-helper.mjs:2182-2253`). No-UI, rejection, and exact-dialog tests are at `tests/subagents-helper.test.mjs:235-262`. |
| **B2 — Snapshot-read failure** | **PASS** | Failure state is recorded and cleared only after a successful load (`webui-rpc-helper.mjs:2278-2303`). Reviewer-bearing direct calls and all nonempty workflow scripts are classified for blocking (`:2262-2275`) and blocked in the tool hook (`:2665-2675`); non-reviewer direct calls continue. Tests cover block, preservation, and reload recovery (`tests/resource-defaults-helper.test.mjs:110-126`). |
| **B3 — Workflow lease restoration limitation** | **PASS (documentation)** | `TECHNICAL.md:251` explicitly says leasing spends the permit even if unused or failed and requires replacement authorization. Contributor behavior is consistent at `DEVELOPMENT.md:147-150`. |
| **B4 — Direct permit restoration limitation** | **PASS (documentation)** | `TECHNICAL.md:251` explicitly says downstream failure does not restore a directly admitted permit. `DEVELOPMENT.md:147-150` documents admission-based consumption and the synchronous/asynchronous boundary. |

### New evidence-backed findings

#### Blocker — user-controlled prototype dispatch leaks private permit state and bypasses admission

- **Location:** `lib/subagent-launch-policy.mjs:208-215,240-241,262-263,277-278`
- **Evidence:** Supplied workflow code runs before guarded child methods are called. It can replace `Array.prototype.findIndex`; the wrapper later dispatches through that mutable prototype on the private deviations array. The replacement receives the private array as `this` and can return `0`, causing the wrapper to treat an unauthorized mismatch as permitted. Mutable `Set.prototype.add/has` and global `Object.assign` dispatch also permit consumption/commit semantics to be subverted.
- **Test gap:** No `Proxy`, prototype-poisoning, `findIndex`, or intrinsic-mutation test exists in `tests/subagent-launch-policy.test.mjs`.
- **Smallest remediation:** Do not dispatch through user-mutable intrinsics after supplied code starts. Use indexed loops and null-prototype private records, or capture all required intrinsic operations before invoking user code and call those captured functions. Add no-permit mismatch regressions for both `runs.run` and `runs.all` after prototype poisoning.

#### Blocker — stateful `Proxy` parameters can pass policy with one model and reach `runs.run` with another

- **Location:** `lib/subagent-launch-policy.mjs:224-246,255-261`
- **Evidence:** `__piWebuiPrepare` reads `params.agent` and `params.model` repeatedly, then returns the original object for explicit matches. A supplied workflow can pass a stateful `Proxy` that reports the configured model during wrapper reads and a mismatched model when the unchanged proxy reaches the original runtime.
- **Smallest remediation:** Snapshot `runs.run` parameters into one plain record before any policy reads, enforce against that snapshot, and pass the same snapshot to the original runtime. Add a stateful getter/Proxy regression proving the runtime receives exactly the model the policy evaluated.

### Correct

- Marker text is now diagnostic only.
- Expiry and synchronous-commit fixes are coherent and have focused regressions.
- Confirmation and snapshot-failure handling fail closed as requested.
- B3/B4 limitations are accurately and prominently documented in advanced user and contributor documentation.

### Overall result

**FAIL — two workflow policy bypass blockers remain.** Six accepted findings pass, B3/B4 documentation passes, but A2 is not fully resolved.

## Checks and gaps

- Manually inspected the plan, both original reviews, accepted-fix handoff, final implementation, focused tests, and affected documentation.
- No shell or Git commands were available in this read-only reviewer environment.
- The fix handoff attests that the three focused test files, syntax checks, and scoped diff checks passed.
- `npm run check`, full `npm test`, and browser tests were not rerun after the accepted fixes.
- The current Git diff and staged-file state were not independently queried; changed-file information below comes from the fix handoff.

## Residual risks

- WebUI-local enforcement does not cover paths bypassing the helper.
- Sequential workflow launches cannot roll back an earlier child.
- Permits remain intentionally admission-spent after asynchronous/downstream failure.
- Exact model matching may reject fuzzy aliases accepted upstream.
- The prototype-poisoning and stateful-Proxy bypasses currently defeat workflow reviewer admission.

**Confidence: 97/100.** The blockers follow directly from JavaScript dispatch and object-identity behavior in the generated wrapper. Confidence is below 100 because executable reproductions and Git commands could not be run.