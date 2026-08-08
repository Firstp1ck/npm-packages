# Development guide: Todo Progress for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Runtime flow

The extension parses agent-authored Markdown checklist markers from assistant messages, mirrors matched items into the widget, and strips those lines from the visible assistant message. It injects the current goal/list into subsequent model context so the stripped checklist remains available to the agent.

A newly delivered user message resets the prior goal/list, which prevents queued follow-ups from being mistaken for steering context. A replacement checklist supersedes prior widget state. Any normal final assistant response clears active display state, including partial progress. Aborted, failed, length-limited, and tool-use endings can remain in the Pi session for redraw, reload, or resume.

## Verification

```bash
npm test
npm pack --dry-run --json
```
