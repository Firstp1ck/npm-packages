# Reverse Last for Pi

Undo the most recent changes made through Pi’s write and edit tools.

## What you can do

- Tracks changes made through Pi’s write and edit tools.
- Shows which recent change can be undone.
- Restores one or several recent change steps.
- Keeps undo limited to changes it can safely identify.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-reverse-last
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/reverse-last` to preview and undo the latest Pi file change. Add a number when you need to reverse several recent change steps together.

- `/reverse-last [count]` — undo last successful file changes in current session.

## Before you start

No setup is required. Undo history is kept only for the current Pi session unless you configure another state directory.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-reverse-last/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
