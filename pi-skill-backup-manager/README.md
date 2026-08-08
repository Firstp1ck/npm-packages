# Backup Manager

Find out whether your backups are complete, current, and likely to work when you need them.

## Helpful when

- You have not tested a restore recently.
- Important files or services may be missing from backups.
- You want to review a home server, NAS, or repository backup plan.

## What to share with Pi

- What must be protected
- Where backups are stored
- Any backup scripts, schedules, or recent reports

## Try asking

> Review my backup setup and tell me whether I could restore my important data today. Show me the biggest gaps first.

## What you’ll get

- A simple backup health summary
- Missing coverage and restore risks
- A prioritized improvement and restore-test plan

## Keep in mind

A file listing is not proof that recovery works. Use HTTPS for remote APIs, keep live tokens out of chat and logs, and require confirmation before pushes, deletions, or restore actions. The strongest check is a real restore test using safe, separate storage.

## Install

```bash
pi install npm:@firstpick/pi-skill-backup-manager
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-backup-manager/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
