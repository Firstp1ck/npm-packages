# Safety Guard for Pi

Adds confirmation and path protection around commands and edits that could cause serious damage.

![Safety guard confirmation prompt](https://unpkg.com/@firstpick/pi-extension-safety-guard/images/safety_guard_v0.1.9.png)

## What you can do

- Recognizes commands that can delete data or rewrite history.
- Protects important files from unexpected edits.
- Shows why an action was stopped before asking for confirmation.
- Can optionally request a second model review for risky actions.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-safety-guard
```

Restart Pi if the package does not appear in your current session.

## How to use it

Safety Guard works automatically.

1. When a warning appears, read the risk explanation and command preview.
2. Confirm only when the action and affected files are exactly what you intended.
3. Reject it when anything is unclear, then ask Pi for a safer approach.

Run `/safety-guard-setup` to choose protected command groups and paths. Optional second-model review is available but remains off until you enable it.

## Before you start

No setup is required. Run `/safety-guard-setup` if you want to change protected command groups, protected paths, or optional automatic review. Automatic review is off by default.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-safety-guard/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
