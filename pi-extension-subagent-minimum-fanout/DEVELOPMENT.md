# Development guide: Subagent Minimum Fanout for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

The package-local tests cover static child and worker counting, mixed-role bypass attempts, reviewer route normalization and diversity, dynamic fanout, execution aliases, schedules, exempt management actions, malformed input, and non-subagent pass-through.

## Guard contract

The extension inspects Pi `tool_call` events for the `subagent` tool. Static counting covers direct launches, `tasks` entries and positive integer `count` values, direct chain steps, static `parallel` groups, execution aliases, and schedules. Dynamic `expand` contributes zero guaranteed launches. Worker counts are tracked separately from total children.

Reviewer diversity requires separate static reviewer entries with explicit provider-qualified model routes. Case and thinking suffixes are normalized before provider/model comparison. Reviewer `count > 1` and dynamic reviewer expansion fail closed because they cannot prove route diversity statically. Management, status, control, recovery, and non-schedule actions are exempt.

Malformed input fails closed. Keep these rules synchronized with the supported `subagent` schema and the package-local tests.

## Additional implementation details

Pi discovers `subagent-minimum-fanout.ts` through the package manifest.
