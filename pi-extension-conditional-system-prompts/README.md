# Conditional System Prompts for Pi

Loads only the extra system guidance that matches the current platform and enabled tools.

## What you can do

- Loads Windows-specific guidance only on Windows.
- Loads delegation safety guidance only when delegation is available.
- Keeps unrelated sessions free of extra instructions.
- Stops with a clear message if required guidance is missing.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-conditional-system-prompts
```

Restart Pi if the package does not appear in your current session.

## How to use it

There is no normal command to learn. The extension works in the background and adds the matching guidance only when the current platform or enabled tools require it.

## Before you start

The Windows prompt requires `APPEND_WINDOWS.md` in your configured Pi agent directory; it is not bundled with this package. Delegation guidance requires the governance skill to be enabled.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-conditional-system-prompts/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
