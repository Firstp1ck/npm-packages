# Technical reference: Deployment Automation

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for Docker Compose deployments, container updates, stack health checks, rollbacks, compose-file changes, image upgrades, failed deploys, or service restart planning. Provides safe deployment and rollback workflows.

## Install

```bash
pi install npm:@firstpick/pi-skill-deployment-automation
```

## Requirements and operational safety

The shipped workflow targets Docker Engine with the Compose plugin. Some health and troubleshooting checks also use `curl`, `jq`, or `ss`; unavailable helpers should be reported instead of silently assumed.

Planning and status checks can be read-only. Starting/stopping containers, changing Compose files, removing volumes, pruning images/system data, and applying a rollback are mutating actions that require approval. Capture the previous image tag/digest or retained Compose version before deployment; without that state, an executable rollback is not guaranteed.

## Example view

```text
User: Plan this Compose deployment and rollback. Check prerequisites and health probes, but do not restart services, pull images, or prune data.
Agent: Produces a read-only deployment plan with explicit approval gates and rollback prerequisites.
```
