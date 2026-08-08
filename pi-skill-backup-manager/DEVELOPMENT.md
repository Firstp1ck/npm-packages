# Development guide: Backup Manager

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `backup-manager` skill to Pi's skill library.
- Guides agents to invoke the skill for backup health checks, restore testing, NAS/Gitea backup integrity, 3-2-1 strategy review, backup script audits, or verifying repositories and archives can be restored safely.
- Bundles `skills/backup-manager/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.
