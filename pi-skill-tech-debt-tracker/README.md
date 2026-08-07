# Technical Debt Tracker

Turn recurring maintenance problems into a clear, prioritized cleanup list.

## Helpful when

- TODOs and workarounds are scattered across a project.
- The same problems keep slowing down changes.
- You need to choose what cleanup work is worth doing next.

## What to share with Pi

- Known problems, TODOs, or project files
- How each problem affects users or the team
- Time, staffing, and release constraints

## Try asking

> Turn these maintenance problems into a prioritized cleanup backlog. Explain impact, effort, dependencies, and a sensible order.

## What you’ll get

- A grouped debt inventory
- Priority based on impact and effort
- Suggested sequencing and ownership

## Keep in mind

Priorities depend on real business and team constraints. By default, the workflow records debt in the host’s `MEMORY.md` Tech Debt Registry; confirm that location or request a report-only backlog when no memory file is available.

## Install

```bash
pi install npm:@firstpick/pi-skill-tech-debt-tracker
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-tech-debt-tracker/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
