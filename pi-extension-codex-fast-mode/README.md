# Codex Fast Mode for Pi

Adds an easy on/off switch for subscription-backed Codex Fast mode.

## What you can do

- Turns supported Codex Fast mode on or off for the current session.
- Shows whether Fast mode is currently active.
- Applies only to supported subscription-backed Codex requests.
- Leaves other models and providers unchanged.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-codex-fast-mode
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/fast-mode on` for a supported Codex session and `/fast-mode status` to confirm it. Turn it off when you prefer standard credit use.

- `/fast-mode` toggles Fast mode.
- `/fast-mode on` enables it.
- `/fast-mode off` disables it.
- `/fast-mode status` reports the current session-branch setting.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-codex-fast-mode/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
