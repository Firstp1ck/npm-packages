# @firstpick/pi-extension-subagent-minimum-fanout

Enforces deterministic delegation policy for model-initiated Pi `subagent` tool calls. It blocks executions that declare fewer than two statically guaranteed child launches, prevents a lone implementation worker from being hidden among non-worker children, and requires multiple reviewers to use distinct explicit provider/model routes.

## Install

```bash
pi install npm:@firstpick/pi-extension-subagent-minimum-fanout
```

Pi discovers `subagent-minimum-fanout.ts` through the package manifest.

## Behavior

The extension inspects each model `tool_call` for the `subagent` tool:

- A direct child launch counts as one and is blocked.
- `tasks` entries count their positive integer `count` values; invalid or omitted counts conservatively count as one.
- A `chain` counts direct static steps and statically declared `parallel` tasks.
- If any declared launch uses the `worker` agent, the same request must statically guarantee at least two `worker` launches; a worker plus reviewers, planners, or other roles is blocked.
- Two or more `reviewer` launches in one request must be separate entries with explicit `provider/model` values. Thinking suffixes and case are normalized before comparison, and both provider prefixes and complete model routes must be pairwise distinct.
- A reviewer entry with `count > 1`, or a dynamic reviewer `expand`, is blocked because it cannot statically prove model/provider diversity.
- Dynamic `expand` fanout contributes zero guaranteed children or workers, so it cannot establish either minimum.
- `action: "single"`, `"parallel"`, and `"tasks"` use the same checks case-insensitively when they describe an execution.
- `action: "schedule"` is treated as a new deferred execution and must meet the same minimum.
- Management, status, control, recovery, and other non-schedule actions pass through.

Malformed or unexpected `subagent` inputs fail closed: they are blocked with guidance to work directly or submit one statically compliant workflow. Reviewer diversity also covers static top-level tasks, static chain steps, static parallel chain groups, execution aliases, schedules, and packaged agent names ending in `.reviewer`. Calls to other tools are unaffected.

## Recommended policy

Use this package only when a two-or-more-child delegation rule and cross-provider reviewer policy are appropriate for your workflow. It enforces static cardinality and declared reviewer routes, not task quality or the provider ultimately reached after runtime fallback. Each child should still be necessary and meaningfully distinct. Do not split work into separate one-child calls to evade the rule, and prefer direct work when delegation is unnecessary.

## Requirements and compatibility

- A Pi runtime that exposes the extension `tool_call` hook and `isToolCallEventType` helper.
- A `subagent` tool whose direct, `tasks`, `chain`, `parallel`, `expand`, `model`, and action shapes follow the semantics described above.

The package has no configuration, commands, network access, file access, or persistent state. If an installed subagent implementation changes its action or workflow schema, review the behavior and tests before relying on this guard.

## Limitations

This is an extension-level guard for model-initiated `subagent` tool calls. It does not intercept human slash commands, extension-to-extension RPC, or any execution path that does not emit that Pi event. It cannot prove that declared children are useful, independent, actually launched after the tool accepts a request, or remain provider-distinct after a child performs an internal model fallback.

## Security and privacy

- The extension evaluates only the in-memory subagent tool-call input.
- It sends no data over the network and does not read, write, or persist files.
- Blocking is deliberately conservative for malformed execution input; verify compatibility after Pi or subagent-tool upgrades.

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

The package-local tests cover static child and worker counting, mixed-role bypass attempts, reviewer route normalization and diversity, dynamic fanout, execution aliases, schedules, exempt management actions, malformed input, and non-subagent pass-through.

## License

MIT
