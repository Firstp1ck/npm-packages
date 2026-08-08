# Technical reference: Conditional System Prompts for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-extension-conditional-system-prompts
```

## What is loaded

| Situation | Added guidance |
| --- | --- |
| Pi is running on Windows | The local `APPEND_WINDOWS.md` policy |
| Delegation tools are enabled | A short instruction to load the enabled `subagent-governance` skill |

When both apply, Windows guidance is added first. Unrelated sessions receive neither addition.

## Setup

- Keep `APPEND_WINDOWS.md` in the configured Pi agent directory when Windows guidance is needed.
- Install and enable `subagent-governance` before using delegated agents.
- Reload Pi after changing the extension, skill selection, or Windows policy.

No separate delegation-policy prompt file is required.

## Privacy and safety

The Windows policy stays local and is read only on Windows. Treat it as trusted configuration because its text becomes part of Pi’s system guidance.

The delegation addition contains no private data. It points Pi to the installed governance skill instead of copying the entire policy into every conversation.

## Failure behavior

- A missing Windows policy causes a visible error on Windows but is ignored on other systems.
- Missing or unreadable governance files stop delegation and show a configuration error.
- This package checks that required guidance is available; it does not replace runtime safety guards or manage Pi settings.
