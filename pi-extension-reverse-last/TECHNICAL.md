# Technical reference: Reverse Last for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Session-local undo for Pi `write` and `edit` file changes.

## What it does

- Captures pre-change file snapshots for successful `write`/`edit` tool calls.
- Maintains a per-session undo stack.
- Restores one or multiple recent changes with a command.

## Install

```bash
pi install npm:@firstpick/pi-extension-reverse-last
```

## Configuration

- `PI_REVERSE_LAST_STATE_DIR` (optional)
  - Override undo state storage directory.
  - Accepts absolute paths or home-relative paths.
  - Default: `~/.pi/agent/state/reverse-last`

## Commands

- `/reverse-last [count]` — undo last successful file changes in current session.

## Tools

- `reverse_last` — undo the most recent write/edit file changes captured in this session.

## Example view

This is a quick escape hatch for recent Pi `write`/`edit` changes in the current session.
