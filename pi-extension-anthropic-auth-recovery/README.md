# Anthropic Auth Recovery for Pi

Helps you recover from a narrow class of Anthropic compatibility errors without changing anything automatically.

## What you can do

- Recognizes supported Anthropic compatibility errors.
- Shows a recovery option only when it matches the problem.
- Shows startup compatibility warnings only while you are signed in to an Anthropic subscription.
- Uses another authenticated model to prepare a recovery plan.
- Never applies compatibility changes automatically.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-anthropic-auth-recovery
```

Restart Pi if the package does not appear in your current session.

## How to use it

Use Pi normally. If a supported Anthropic compatibility error appears:

1. Open the offered recovery action.
2. Choose an available non-Anthropic model for the investigation.
3. Review the recovery plan it creates.
4. Decide separately whether you want any proposed compatibility patch applied.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-anthropic-auth-recovery/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
