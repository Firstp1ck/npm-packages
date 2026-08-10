# Technical reference: Subagent Review Diversity for Pi

Advanced user setup, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Checks deterministic reviewer diversity for model-initiated Pi `subagent` tool calls. The extension does not impose a minimum child or worker count: direct single workers, sequential workers, workflow scripts, schedules, and dynamic fanout are allowed.

## Install

```bash
pi install npm:@firstpick/pi-extension-subagent-minimum-fanout
```

## Behavior

The extension checks model-initiated `subagent` executions before they start:

- One or more workers may be launched directly or through a workflow.
- Worker launch count and static fanout are not restricted.
- Multiple reviewers in one statically inspectable execution must use separate, explicit provider/model routes.
- Management, status, control, and recovery actions are unaffected.

Calls to other tools are unaffected. Exact reviewer-route normalization and supported static request shapes are documented in `DEVELOPMENT.md`.

## Recommended policy

Use this package when cross-provider reviewer independence is appropriate. It checks declared reviewer routes, not task quality or the provider ultimately reached after runtime fallback. Plans, worker sequencing, ownership, and isolation remain the responsibility of the active workflow policy and orchestration layer.

## Requirements and compatibility

- A compatible Pi runtime and `subagent` extension. Review compatibility after either component changes its execution schema.

The package has no configuration, commands, network access, file access, or persistent state. If an installed subagent implementation changes its action or workflow schema, review the behavior and tests before relying on reviewer-route checks.

## Limitations

This is an extension-level guard for model-initiated `subagent` tool calls. It does not intercept human slash commands, extension-to-extension RPC, or any execution path that does not emit that Pi event. It cannot prove that reviewers are useful, independent, actually launched after the tool accepts a request, or remain provider-distinct after a child performs an internal model fallback.

## Security and privacy

- The extension evaluates only the in-memory subagent tool-call input.
- It sends no data over the network and does not read, write, or persist files.
- Malformed input is allowed unless it contains a statically detectable reviewer-diversity violation.

## License

MIT
