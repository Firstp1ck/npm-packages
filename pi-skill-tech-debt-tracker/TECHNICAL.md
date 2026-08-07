# Technical reference: Tech Debt Tracker

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for tasks involving identifying, categorizing, prioritizing, or planning technical debt work, debt sprints, cleanup backlogs, TODO consolidation, or long-term maintainability risks. Tracks debt with severity/effort.

## Install

```bash
pi install npm:@firstpick/pi-skill-tech-debt-tracker
```

## Storage and report-only mode

By default, the workflow records debt in the host workspace’s `MEMORY.md` under a Tech Debt Registry section. Confirm that location before allowing writes. When no memory file is available, or when persistence is unwanted, request a report-only backlog instead.

## Example view

```text
User: Turn these TODOs and workarounds into a prioritized report-only debt backlog. Do not update workspace memory.
Agent: Groups the debt, scores impact and effort, and returns sequencing without persistent writes.
```
