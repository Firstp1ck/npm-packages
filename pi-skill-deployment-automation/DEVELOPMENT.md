# Development guide: Deployment Automation

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `deployment-automation` skill to Pi's skill library.
- Guides agents to invoke the skill for Docker Compose deployments, container updates, stack health checks, rollbacks, compose-file changes, image upgrades, failed deploys, or service restart planning. Provides safe deployment and rollback workflows.
- Bundles `skills/deployment-automation/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.
