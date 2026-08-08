# Technical reference: Dolt Database Version Control

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A portable Agent Skill / Pi package for researching, evaluating, and applying [Dolt](https://github.com/dolthub/dolt), the Git-like version-controlled SQL database.

## Install

```bash
pi install npm:@firstpick/pi-skill-dolt-database-version-control
```

## Configuration

No required configuration.

The skill may ask to verify current Dolt details from official docs before making version-, platform-, or production-readiness claims.

## Example view

```text
User: Should we use Dolt for branchable customer configuration data?
Agent: Invokes `dolt-database-version-control`, checks the use case against Dolt fit criteria, proposes an adoption shape, lists risks, and recommends validation steps.
```
