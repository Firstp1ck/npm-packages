# Bug: Minimum-fanout guard rejects valid two-worker `workflowScript` runs

### Short Summary

The minimum-fanout extension rejects a statically declared `runs.all([...])` workflow containing two `worker` launches. This blocks the current documented `workflowScript` execution API and also causes a two-task `subagent_gate` request to fail as a configuration error.

### Body

#### Environment

- Package: `@firstpick/pi-extension-subagent-minimum-fanout`
- Observed package version: `0.1.4`
- Runtime: Pi with `pi-subagents` and the WebUI `subagent_gate` tool enabled

#### Reproduction

1. Call the `subagent` tool with two literal worker entries in `runs.all`:

```js
const results = await runs.all([
  {
    key: "backend-patch",
    agent: "worker",
    task: "Produce the backend implementation artifact."
  },
  {
    key: "frontend-patch",
    agent: "worker",
    task: "Produce the frontend implementation artifact."
  }
]);
return results;
```

2. Observe that the call is rejected before either child starts:

```text
Blocked by the zero-or-multiple delegation policy: every execution needs at least two statically guaranteed child launches, and any workflow that launches the worker agent needs at least two statically guaranteed worker launches.
```

3. As a fallback, call `subagent_gate` with two `worker` tasks, `requiredSuccesses: 2`, and `maxAttemptsPerTask: 1`.

4. Observe the gate result:

```text
Subagent gate failed: 0/2 qualifying successes.
Attempts: 2.
Failures: worker#1 configuration, worker#1 configuration.
```

#### Expected behavior

- A literal `runs.all` array with two distinct `worker` entries is recognized as two statically guaranteed children and two statically guaranteed workers.
- A `subagent_gate` request containing two worker task slots can satisfy the same policy without each internal slot being rejected as an isolated single-worker call.
- A workflow containing only one worker remains blocked.
- Dynamic workflow code whose launch count cannot be proven remains fail-closed.

#### Actual behavior

- Every tested two-worker `workflowScript` form was classified as non-compliant, including a direct `return runs.all([...])` and `const results = await runs.all([...]); return results;`.
- No child started, so rephrasing tasks or changing worker ownership could not resolve the blocker.
- The quorum helper also failed both slots during configuration.

#### Likely cause

`analyzeExecution()` in `pi-extension-subagent-minimum-fanout/subagent-minimum-fanout.ts` currently counts only legacy/direct input fields:

- `input.chain`
- `input.tasks`
- `input.agent`

The current `subagent` execution contract exposes `workflowScript` instead. A call containing only `workflowScript` falls through to `indeterminate` with zero guaranteed children, even when the script contains a literal two-entry `runs.all` call.

`subagent_gate` appears to launch its task slots through RPC as separate direct child requests. The minimum-fanout guard then treats each slot as a forbidden single-worker execution instead of evaluating the gate's statically declared task set as one fanout.

#### Impact

- Valid multi-worker workflows cannot run while the guard is enabled.
- Complex feature workflows that mandate two implementation-worker outcomes cannot proceed.
- The documented fallback for bounded retries and success quorums does not bypass or coordinate with the fanout guard.
- Users must either disable/waive the safety gate or abandon delegation, even though their requested shape satisfies the policy.

#### Suggested acceptance criteria

- [ ] Add an explicit integration contract between `pi-subagents` and the minimum-fanout extension for authoritative static launch metadata, or conservatively analyze literal `workflowScript` launch shapes.
- [ ] Allow a literal `runs.all` array containing two worker entries.
- [ ] Allow two unconditional sequential worker launches when both are statically guaranteed by the workflow.
- [ ] Continue blocking one worker, one worker hidden among non-worker children, and dynamic-only fanout.
- [ ] Make a two-worker `subagent_gate` request compatible with minimum-fanout enforcement.
- [ ] Add regression tests covering `workflowScript` and `subagent_gate`, not only legacy `tasks` and `chain` payloads.
- [ ] Include the detected launch counts/mode in the block diagnostic so false classifications are immediately visible.
