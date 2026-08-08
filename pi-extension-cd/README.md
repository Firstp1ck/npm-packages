# cd for Pi

Makes changing directories in Pi faster with suggestions, history, and aliases.

## What you can do

- Suggests likely folders as you type.
- Learns from recently used locations.
- Supports short aliases for frequently used projects.
- Lets you browse and change folders without leaving Pi.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-cd
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/cd` and start typing a project or folder name. Pick a suggestion, or use `/cd --add <name> [dir]` to create a memorable shortcut for a location you visit often.

- `/cd [dir|alias]`
- `/cd`
- `/cd --add <name> [dir]`
- `/cd --remove <name>`
- `/cd --list`
- `/cd --status`
- `/cd --clear-history`
- `/cd-refresh`
- `/cd ..`
- `/cd ~/code/my-app`
- `/cd --add npm /home/firstpick/pi-coding-agent-forge`
- `/cd npm`

## Before you start

No setup is required. Directory history and aliases are stored locally.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-cd/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
