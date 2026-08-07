# Prompts Code Workflows for Pi

Adds ready-made prompts for reviews, bug fixes, issue work, and incident triage.

## What you can do

- Adds prompts for code review and bug fixing.
- Includes issue investigation and implementation flows.
- Provides an incident-triage prompt for urgent problems.
- Keeps each workflow reusable across projects.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-prompts-code-workflows
```

Restart Pi if the package does not appear in your current session.

## How to use it

Choose the slash command that matches the job, such as `/review`, `/fix`, or `/incident`, then give Pi the relevant repository, issue, error, or change.

- `/fix` — fix a reported issue end-to-end with verification.
- `/incident` — triage incidents with impact, severity, mitigation, and investigation plan.
- `/issue-fix` — turn an issue into root-cause analysis and implementation plan.
- `/issue-new` — draft a clean maintainer-friendly issue.
- `/review` — review code for correctness, security, performance, and maintainability.
- `/sum-issue` — summarize current feature/fix state and next step.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-package-prompts-code-workflows/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
