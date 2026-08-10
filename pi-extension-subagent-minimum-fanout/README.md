# Subagent Review Diversity for Pi

Checks that independent subagent reviewers use distinct model providers without restricting worker fanout.

## What you can do

- Launch one worker or several workers as the task requires.
- Run sequential or parallel workers through normal subagent workflows.
- Require multiple reviewers to use separate provider/model routes.
- Get a clear explanation when reviewer diversity is rejected.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-subagent-minimum-fanout
```

Restart Pi if the package does not appear in your current session.

## How to use it

There is no setup for everyday use. The extension checks model-initiated subagent requests automatically.

Worker and workflow launch counts are not restricted. When one execution launches multiple reviewers, declare a different explicit provider/model route for each reviewer.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-subagent-minimum-fanout/TECHNICAL.md) for complete commands, compatibility, security, and troubleshooting information.
