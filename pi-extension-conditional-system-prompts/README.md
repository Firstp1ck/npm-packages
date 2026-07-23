# @firstpick/pi-extension-conditional-system-prompts

Conditionally appends local system-prompt files to a Pi agent turn.

## Install

```bash
pi install npm:@firstpick/pi-extension-conditional-system-prompts
```

Pi discovers `conditional-system-prompts.ts` through the package manifest.

## Behavior

Before an agent starts, the extension appends the following files from Pi's agent directory when their conditions match:

| Condition | Required external file |
| --- | --- |
| Pi is running on Windows | `APPEND_WINDOWS.md` |
| The selected tools include `subagent` | `APPEND_SUBAGENTS.md` |

When both conditions apply, the Windows prompt is appended first, followed by the subagent prompt. Existing system-prompt content is retained, and loaded prompt text is cached for the extension lifetime.

## Configuration and requirements

This package intentionally does not publish either `APPEND_*.md` file. Create and maintain the required files in Pi's agent directory using your own policy content. Pi normally uses its standard agent directory; `PI_CODING_AGENT_DIR` can select a different agent directory when supported by Pi.

After changing a required prompt file, reload Pi so the extension cache is rebuilt. No additional package configuration is provided.

## Security and privacy

- Prompt files stay local; this package does not send their contents anywhere.
- The extension reads only the two filenames listed above from Pi's configured agent directory.
- Treat those files as trusted configuration: their content is appended to the agent's system prompt and can influence tool use and runtime behavior.
- Do not store credentials or other secrets in prompt files unless that exposure is intentional for the Pi session.

## Failure behavior and limitations

A matching condition requires its corresponding file. If the file is missing or unreadable, Pi receives the underlying file-read error during `before_agent_start`; this preserves the extension's fail-fast behavior rather than silently running without the configured policy. Non-Windows sessions without `subagent` selected do not read either file.

The extension does not validate prompt content, manage file permissions, watch for changes, or decide which tools Pi should enable.

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

The focused tests cover platform and selected-tool routing, prompt composition order, per-instance caching, and missing-file behavior.

## License

MIT
