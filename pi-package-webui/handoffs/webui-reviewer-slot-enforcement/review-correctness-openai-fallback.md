# WebUI reviewer-slot enforcement correctness review

## Review

### Blocker — spoofable wrapper marker bypasses all workflow enforcement

- **Affected:** `lib/subagent-launch-policy.mjs:7,200-205`
- **Violated requirement:** The policy must apply to `runs.run` and `runs.all` workflow children (`plans/planned/webui-reviewer-slot-enforcement.md:25,87`).
- **Failure mode:** `wrapWorkflowScript()` trusts a marker contained in model-supplied source:
  ```js
  if (script.includes(WORKFLOW_WRAPPER_MARKER)) return script;
  ```
  A workflow beginning with:
  ```js
  /* PI_WEBUI_SUBAGENT_LAUNCH_SLOTS_V1 */
  return runs.run("review", {
    agent: "reviewer",
    task: "Review",
    model: "unauthorized/model:high"
  });
  ```
  remains unwrapped. No reviewer decision is produced, and the original `runs.run` receives the mismatched launch.
- **Test gap:** `tests/subagent-launch-policy.test.mjs:155-157` tests idempotence only with a genuinely generated wrapper. It does not test an input script containing the public marker.
- **Smallest remediation:** Do not use source-controlled marker presence as proof of prior wrapping. Track wrapping outside the supplied script, or validate an unforgeable helper-owned wrapper state. Add marker-spoof regression tests for both `runs.run` and `runs.all`.

### Blocker — wrapped workflow source can directly access the original `runs`

- **Affected:** `lib/subagent-launch-policy.mjs:211,251-277`
- **Violated requirement:** Workflow children must pass through the reviewer adapter before reaching the original runtime.
- **Failure mode:** The wrapper binds the unguarded runtime as `__piWebuiOriginalRuns`, then places the supplied script inside a nested function in the same lexical scope:
  ```js
  const __piWebuiOriginalRuns = runs;
  return await (async (runs) => {
    // supplied script
  })(__piWebuiRuns);
  ```
  Supplied workflow source can therefore bypass the adapter:
  ```js
  return __piWebuiOriginalRuns.run("review", {
    agent: "reviewer",
    task: "Review",
    model: "unauthorized/model:high"
  });
  ```
  The call reaches the original runtime without model comparison, occurrence accounting, or permit enforcement. The source can likewise access and alter the private occurrence and consumed-permit objects.
- **Test gap:** Existing workflow tests call only the shadowed `runs` parameter (`tests/subagent-launch-policy.test.mjs:135-210`).
- **Smallest remediation:** Place the user-script function outside the closure containing the original runtime and adapter internals, with only the guarded adapter supplied as its `runs` argument. Add tests proving all generated private identifiers are inaccessible from supplied source.

### High — leased workflow permits do not expire inside a running workflow

- **Affected:** `webui-rpc-helper.mjs:2158-2171`; `lib/subagent-launch-policy.mjs:206-210,232-234`
- **Violated requirement:** Permits expire after two minutes and admit one matching launch (`plans/planned/webui-reviewer-slot-enforcement.md:24,50-51`).
- **Failure mode:** The helper prunes expiry before wrapping but passes descriptors containing only ID, role, occurrence, and requested model. The generated wrapper embeds those descriptors without `expiresAt`, and matching checks only occurrence and model. A permit leased just before expiry can therefore admit a mismatch after expiry—for example, after the workflow awaits a long-running earlier child.
- **Test gap:** `tests/subagents-helper.test.mjs:245-257` covers direct expiry before preflight. Lines 260-273 cover immediate workflow permit use, not expiry after lease.
- **Smallest remediation:** Include `expiresAt` in bounded workflow descriptors and require `expiresAt > Date.now()` when matching inside the adapter. Add a workflow test that advances time after wrapping but before `runs.run`.

### High — occurrence and permit state commit before upstream call validation

- **Affected:** `lib/subagent-launch-policy.mjs:249-255,257-269`
- **Violated requirement:** A permit is consumed only when its corresponding launch is admitted (`plans/planned/webui-reviewer-slot-enforcement.md:51`); occurrence allocation must remain deterministic.
- **Failure mode:** Both adapter methods commit occurrences and consumed deviations before invoking the original runtime. The installed workflow runtime validates calls synchronously afterward (`node_modules/.cache/jiti/workflows-scripted-workflow.46b5f54f.mjs:237-260,263-275`). If an invalid key, malformed item, sparse array, or incompatible parameter causes that validation to throw, no child is launched, but the WebUI adapter has already advanced occurrences and consumed the leased permit.
- **Reproduction:** In one workflow, attempt a permitted reviewer mismatch using an invalid key, catch the validation error, then retry with a valid key. The first call reaches no child, but the retry is treated as the next occurrence with the permit already consumed. `runs.all` has the same state drift if its original validation rejects the batch.
- **Smallest remediation:** Call the original `run`/`all` first inside `try`; commit cloned occurrence and permit state only after the original method returns without a synchronous validation error. Add retry tests using runtimes that synchronously reject malformed `run` and `all` inputs.

## Correct behavior verified by inspection

- Direct `subagent` and `subagent_gate` mismatches are reported and blocked before execution by `webui-rpc-helper.mjs:2623-2634`.
- Direct permits remain intact when another child blocks the same structured request, and are removed only after whole-request policy admission.
- Permit records contain reason, revision, generation, timestamps, and expiry; helper pruning binds them to the current revision and generation (`webui-rpc-helper.mjs:2158-2215`).
- Exact reviewer matches, omitted defaults, independent role occurrence order, explicit non-reviewer models, thinking mismatch classification, direct one-use permits, and mismatch-side `runs.all` atomicity have focused tests.
- Documentation accurately describes the intended policy and WebUI-local enforcement boundary.

## Test adequacy and validation gaps

The positive and direct structured cases are well covered, but the workflow bypass, post-lease expiry, and upstream-validation rollback cases above are absent.

This reviewer had read-only file tools and could not execute shell or Git commands. The handoffs attest that focused policy/helper tests, syntax checks, scoped diff checks, and no-staged-file checks passed. Both handoffs explicitly omitted `npm run check`, `npm test`, and other integrated checks. The plan remains marked **In progress** and its completion record remains incomplete (`plans/planned/webui-reviewer-slot-enforcement.md:3,180-188`).

## Success criteria

**Not met.** Direct structured enforcement largely meets the behavioral criteria, but two concrete workflow bypasses violate workflow coverage, leased permits can survive their expiry, and failed upstream validation can consume workflow authorization. Package-wide acceptance checks are also not evidenced in the inspected artifacts.

## Residual risks

- WebUI-only enforcement still cannot govern launch paths bypassing the helper, as explicitly accepted by the plan.
- Sequential workflow calls cannot roll back a child launched before a later mismatch.
- Exact model-string matching may reject upstream-supported fuzzy aliases.
- The current Git diff and package-wide test state were not independently executable with the available read-only tools.

**Confidence: 96/100.** The findings follow directly from the generated wrapper and installed runtime validation control flow. Confidence is below 100 because no commands or executable reproductions could be run in this review environment.