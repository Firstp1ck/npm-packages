# Small Modal Reliability for Pi

Gives smaller language models a clearer task loop, scratchpad, and verification routine.

## What you can do

- Gives smaller models a clearer step-by-step task loop.
- Tracks progress and repeated actions.
- Adds scratchpad and verification habits.
- Offers simple profiles for lighter or stricter guidance.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-small-modal-reliability
```

Restart Pi if the package does not appear in your current session.

## How to use it

Start a guided task with `/reliability on`, work normally, and check `/reliability status` when needed. Use `/reliability verify` before finishing and `/reliability off` to leave the mode.

## Before you start

The reliability mode is off by default. Start it with `/reliability on`; advanced profiles and model orchestration are documented in the technical reference.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-small-modal-reliability/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
