# Workflow hardening recovery record

## Run status

- Workstream: accepted revalidation fixes C1 and C2
- Worker run: `e12130d5` inside workflow `5797c126-e1d3-4461-9285-e07b7a6235b1`
- Status: stopped after it edited the two authorized files but before it produced a handoff
- Recovery owner: main Pi integration owner
- Base revision: `128e769a628c0f0f5ced524aa21a8dbf827aa7f1`
- Result revision: uncommitted working tree on the same base

The worker became unresponsive after reading and editing. A supervisor nudge produced no decision request or final response. The integration owner inspected its session and confirmed that it had not edited outside the authorized paths, then stopped the run and validated the resulting changes directly. This record does not claim a successful worker handoff.

## Changed files recovered

- `lib/subagent-launch-policy.mjs`
- `tests/subagent-launch-policy.test.mjs`

## Recovered implementation

- Security-sensitive workflow operations no longer dispatch through user-mutable `Array`, `Set`, `Object`, `String`, or `RegExp` prototype methods after supplied workflow code starts.
- Wrapper state uses private null-prototype records, explicit indexed loops, captured intrinsic functions, and property definition rather than mutable prototype dispatch.
- Each `runs.run` parameter object is copied once into a plain null-prototype record before policy reads; policy evaluation and the original runtime receive that same snapshot.
- Each `runs.all` item is copied once before policy evaluation and forwarding.
- Existing marker ownership, lexical isolation, permit expiry, and synchronous-validation commit behavior remain intact.

## Added tests

- `runs.run` and `runs.all` still block a no-permit mismatch after poisoning `Array.isArray`, `Array.prototype.findIndex`, `Set.prototype.has/add`, and `Object.assign`.
- Poisoned intrinsics do not receive private policy state.
- Stateful Proxy/getter inputs are read once into a stable snapshot for `runs.run` and `runs.all`.
- The original runtime receives exactly the agent and model values evaluated by policy.

## Integration-owner validation

| Command | Result |
| --- | --- |
| `node tests/subagent-launch-policy.test.mjs` | exit 0, `subagent-launch-policy.test.mjs passed` |
| `node --check lib/subagent-launch-policy.mjs` | exit 0 |
| `git diff --check -- lib/subagent-launch-policy.mjs tests/subagent-launch-policy.test.mjs` | exit 0 |
| `git diff --cached --name-only` | exit 0 with no staged files |

## Residual risks

- The workflow adapter remains WebUI-local and cannot govern launch paths that bypass the helper.
- It snapshots enumerable own properties, so getters execute once during snapshot creation. The wrapper evaluates and forwards the resulting values, but it does not sandbox getter side effects.
- As documented, asynchronous/downstream launch failure does not restore a spent permit.
- Full package checks and independent revalidation remain required after this recovered fix.
