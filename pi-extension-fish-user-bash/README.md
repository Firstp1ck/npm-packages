# Fish User Bash for Pi

Runs Pi’s `!` and `!!` commands through Fish instead of the default shell.

## What you can do

- Runs Pi’s `!` and `!!` commands through Fish.
- Keeps normal agent tool commands unchanged.
- Supports a custom Fish path when needed.
- Uses the same visible command experience inside Pi.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-fish-user-bash
```

Restart Pi if the package does not appear in your current session.

## How to use it

Use `!command` or `!!command` exactly as you normally would in Pi. The extension sends those commands through Fish automatically.

- `/user-bash-shell` — print the currently resolved shell path.

## Before you start

Fish must be installed and available as `fish`. You can use the technical configuration if Fish lives at a non-standard path.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-fish-user-bash/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
