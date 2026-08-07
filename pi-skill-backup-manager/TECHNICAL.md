# Technical reference: Backup Manager

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for backup health checks, restore testing, NAS/Gitea backup integrity, 3-2-1 strategy review, backup script audits, or verifying repositories and archives can be restored safely.

## Install

```bash
pi install npm:@firstpick/pi-skill-backup-manager
```

## Requirements and safety

Depending on the target, checks may require Git, `curl`, `jq`, SSH, GNU `find`/`date`, `shuf`, and checksum tools. Confirm availability before relying on the included examples.

Use HTTPS for API access and pass credentials through protected environment/configuration, never copied chat or command output. Inventory and checksum checks can be read-only; temporary-tree deletion, restore writes, remote pushes, and force pushes are mutating actions and require explicit approval. Perform restore tests in isolated storage and verify the restored result before replacing production data.

## Example view

```text
User: Audit this NAS and repository backup plan using read-only checks. Do not push, delete, or restore anything; give me an isolated restore-test plan.
Agent: Reviews coverage and prerequisites without mutation, then proposes a separately approved restore test.
```
