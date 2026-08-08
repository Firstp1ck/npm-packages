# Hyprland Wiki Local for Pi

Lets Pi search a local copy of the official Hyprland Wiki first.

## What you can do

- Searches a local copy of the official Hyprland Wiki.
- Returns focused sections with local source paths.
- Helps with monitors, input, rules, plugins, and common Wayland issues.
- Includes setup, status, and quick health checks.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-hyprland-wiki-local
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/hyprwiki-local-setup` once. Then ask Pi about a Hyprland problem normally; use `/hyprwiki-status` if you want to check the local documentation copy.

- `/hyprwiki-status` — reports repository path, Git remote/revision, page count, and cache freshness.
- `/hyprwiki-local-setup` — clones or fast-forward updates `~/.hyprwiki`.
- `/hyprwiki-smoke-test` — runs compact parser/search/extract/read checks against representative Hyprland topics.

## Before you start

Run `/hyprwiki-local-setup` once. It downloads the official Hyprland Wiki to `~/.hyprwiki` and updates that copy on later runs.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-hyprland-wiki-local/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
