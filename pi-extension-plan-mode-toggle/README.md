# Plan Mode Toggle for Pi

Adds a planning mode for thinking through a change before code is written.

## What you can do

- Switches Pi into a planning-first mode.
- Can use a dedicated model for planning.
- Asks for important decisions before writing a plan.
- Checks plan quality before implementation begins.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-plan-mode-toggle
```

Restart Pi if the package does not appear in your current session.

## How to use it

Turn planning on with `/plan-mode on`, describe the change, and answer the planning questions. Review the resulting plan before switching back to implementation work.

- `/plan-mode [on|off|status]` — enable, disable, or inspect plan mode.
- `/plan-model [select|provider/model-id]` — choose or configure the planning model.

## Before you start

Brave Search is optional. Configure the Brave Search extension first if you want planning mode to use current web results.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-plan-mode-toggle/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
