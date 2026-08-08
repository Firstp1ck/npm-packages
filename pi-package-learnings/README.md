# Troubleshooting learnings for Pi

Keep a durable, searchable record of troubleshooting lessons that Pi can reuse later.

## What you can do

- Stores short notes about problems that were actually solved.
- Builds an index so old fixes can be found quickly.
- Lets Pi search and read relevant lessons during troubleshooting.
- Keeps the archive in a location you choose.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-package-learnings
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/learnings-setup` once. After solving a useful problem, ask Pi to save the lesson; later, ask it to search prior learnings before repeating the investigation.

1. Run `/learnings-setup` once and choose where the archive should live.
   By default, setup writes `~/.pi/agent/learnings.env`, creates or replaces the `~/.pi/agent/LEARNINGS` symlink (backing up an existing path), installs helper scripts, and enables a daily `systemd --user` sync timer at 20:00. This needs Python 3, Bash, and a systemd user session; use `--no-timer` on other systems or when you do not want the timer.
2. After solving a useful troubleshooting problem, ask Pi to save a short learning.
3. When a similar problem returns, ask Pi to search prior learnings or run:

```text
/ret-LEARNINGS NetworkManager got a DHCP lease but no default route
```

Pi returns the most relevant notes so the old fix can be checked against the current system.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-package-learnings/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
