# Technical reference: Subagent Minimum Fanout for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Enforces deterministic delegation policy for model-initiated Pi `subagent` tool calls. It blocks executions that declare fewer than two statically guaranteed child launches, prevents a lone implementation worker from being hidden among non-worker children, and requires multiple reviewers to use distinct explicit provider/model routes.

## Install

```bash
pi install npm:@firstpick/pi-extension-subagent-minimum-fanout
```

## Behavior

The extension checks model-initiated `subagent` executions before they start:

- One-child executions are blocked; work directly or declare at least two necessary children.
- Any execution that delegates implementation must declare at least two implementation workers.
- Parallel reviewers must use separate, explicit provider/model routes.
- Dynamic fanout cannot satisfy a minimum that must be known before execution.
- Scheduled executions follow the same minimum, while management, status, control, and recovery actions are unaffected.

Malformed or incompatible execution input fails closed with guidance to work directly or submit a compliant workflow. Calls to other tools are unaffected; exact supported workflow shapes and counting rules are documented in `DEVELOPMENT.md`.

## Recommended policy

Use this package only when a two-or-more-child delegation rule and cross-provider reviewer policy are appropriate for your workflow. It enforces static cardinality and declared reviewer routes, not task quality or the provider ultimately reached after runtime fallback. Each child should still be necessary and meaningfully distinct. Do not split work into separate one-child calls to evade the rule, and prefer direct work when delegation is unnecessary.

## Requirements and compatibility

- A compatible Pi runtime and `subagent` extension. Review compatibility after either component changes its execution schema.

The package has no configuration, commands, network access, file access, or persistent state. If an installed subagent implementation changes its action or workflow schema, review the behavior and tests before relying on this guard.

## Limitations

This is an extension-level guard for model-initiated `subagent` tool calls. It does not intercept human slash commands, extension-to-extension RPC, or any execution path that does not emit that Pi event. It cannot prove that declared children are useful, independent, actually launched after the tool accepts a request, or remain provider-distinct after a child performs an internal model fallback.

## Security and privacy

- The extension evaluates only the in-memory subagent tool-call input.
- It sends no data over the network and does not read, write, or persist files.
- Blocking is deliberately conservative for malformed execution input; verify compatibility after Pi or subagent-tool upgrades.

## License

MIT
