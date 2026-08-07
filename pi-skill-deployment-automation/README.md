# Deployment Automation

Plan safer application updates with clear checks, failure handling, and a way back.

## Helpful when

- You are updating services or containers.
- A previous deployment failed or caused downtime.
- You want a repeatable release and rollback process.

## What to share with Pi

- The deployment files or current setup
- What is changing
- Health checks, downtime limits, and rollback needs

## Try asking

> Review this deployment update. Give me a safe step-by-step plan with health checks, stop conditions, and rollback instructions.

## What you’ll get

- A deployment plan in the right order
- Checks before and after each risky step
- A clear rollback path

## Keep in mind

Deployments can affect real users and data. Pi should ask before making external or destructive changes.

## Install

```bash
pi install npm:@firstpick/pi-skill-deployment-automation
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-deployment-automation/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
