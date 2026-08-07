# Upgrade Extensions for Pi

Check and update npm-installed Pi extensions from inside Pi.

## What you can do

- Checks npm-installed Pi extensions for updates.
- Lets you choose one, several, or all updates.
- Shows what will change before updating.
- Reports completed, skipped, and failed updates clearly.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-upgrade-extensions
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/extensions-update` to review available updates and select packages. Use `/extensions-update all` only when you really want every available update.

- `/extensions-update` — checks for updates, then shows a multi-select list of outdated extensions.
- `/extensions-update all` — checks for updates and updates all outdated extensions directly.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-upgrade-extensions/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
