# Development guide: Conditional System Prompts for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

Tests cover selected-tool routing, Windows ordering, Windows caching, fail-closed bridge language, and Windows-only missing-file behavior.

## Additional implementation details

Pi discovers `conditional-system-prompts.ts` through the package manifest. The `subagent-governance` skill must also be enabled when the `subagent` tool is available.

## Preserved implementation and format details

Conditionally appends the local Windows policy and a short, fail-closed routing bridge to the enabled `subagent-governance` skill.

## Install

```bash
pi install npm:@firstpick/pi-extension-conditional-system-prompts
```

## Behavior

Before an agent starts, the extension applies these conditions:

| Condition | Appended content |
| --- | --- |
| Pi is running on Windows | Local `APPEND_WINDOWS.md` from the configured agent directory |
| Selected tools include `subagent` | Built-in bridge requiring the parent to load `subagent-governance` with `read` |

When both conditions apply, the Windows prompt is appended first, followed by the governance bridge. Existing system-prompt content is retained. Only the Windows file is read and cached.

The governance bridge preserves progressive disclosure rather than duplicating policy text. Before injecting it, the extension resolves the advertised `<location>` for `subagent-governance` from `<available_skills>` and verifies that both its `SKILL.md` and Pi adapter are readable and non-empty. The bridge directs the parent to that adapter and keeps the installed `pi-subagents` skill authoritative for runtime mechanics.

## Configuration and requirements

- Maintain `APPEND_WINDOWS.md` only when Windows routing is needed.
- Enable `subagent-governance` through Pi settings or a package entry.
- Reload Pi after changing the extension, settings, skill, or Windows prompt.

No external subagent-policy prompt file is required or read.

## Security and privacy

- The Windows prompt stays local; this package does not send its contents anywhere.
- The extension reads only `APPEND_WINDOWS.md` and only when Pi is running on Windows.
- Treat that file as trusted configuration because its content is appended to the system prompt.
- The governance bridge contains no private data and does not read the skill body itself.

## Failure behavior and limitations

A Windows turn requires `APPEND_WINDOWS.md`; a missing or unreadable file propagates the file-read error. Non-Windows turns never read it.

A turn with `subagent` selected receives the skill bridge without reading an external prompt. If the enabled governance skill is missing from the current system prompt, or its advertised `SKILL.md` or Pi adapter is unavailable, unreadable, or empty, the extension injects a model-visible configuration-error policy requiring delegation to stop until configuration is restored.

The extension validates availability, not policy semantics. It does not manage settings or replace hard fanout enforcement; runtime fanout guards remain separate.

## License

MIT
