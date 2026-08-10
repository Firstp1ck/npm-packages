# Development guide: Subagent Review Diversity for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

The package-local tests cover single-worker and workflow pass-through, reviewer route normalization and diversity, dynamic reviewer fanout, execution aliases, schedules, exempt management actions, malformed input, and non-subagent pass-through.

## Guard contract

The extension inspects Pi `tool_call` events for the `subagent` tool. It does not enforce minimum child or worker cardinality. Direct workers, task arrays, legacy chains, schedules, `workflowScript`, dynamic fanout, and malformed non-reviewer inputs pass through without a fanout block.

Reviewer diversity requires separate static reviewer entries with explicit provider-qualified model routes. Case and thinking suffixes are normalized before provider/model comparison. Reviewer `count > 1` and dynamic reviewer expansion fail closed because they cannot prove route diversity statically. Management, status, control, recovery, and non-schedule actions are exempt.

Static request analysis remains only to identify reviewer launch shapes. Keep it synchronized with the supported `subagent` schema and package-local tests.

## Additional implementation details

Pi discovers `subagent-minimum-fanout.ts` through the package manifest. The historical package name remains unchanged for installation compatibility.
