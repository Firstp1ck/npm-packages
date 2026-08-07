# Code Security

Look for realistic security problems before they put users, data, or systems at risk.

## Helpful when

- You changed sign-in, permissions, payments, or sensitive data handling.
- You want to check for exposed passwords or keys.
- You are preparing an application or service for release.

## What to share with Pi

- The files, branch, or project to review
- What the software protects and who can access it
- Any known concerns or likely threats

## Try asking

> Review this sign-in change for security problems. Show evidence, explain the real-world risk, and suggest the smallest safe fix.

## What you’ll get

- Prioritized findings with evidence
- A clear explanation of who or what could be affected
- Practical fixes and ways to verify them

## Keep in mind

A review can find important risks, but it cannot prove complete security. Redact any discovered secret values, and require explicit approval before installing scanners, changing dependencies, rewriting Git history, rotating credentials, or force pushing.

## Install

```bash
pi install npm:@firstpick/pi-skill-code-security
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-code-security/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
