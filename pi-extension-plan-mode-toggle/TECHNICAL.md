# Technical reference: Plan Mode Toggle for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md)

Plan mode workflow extension for Pi.

## What it does

- Toggle plan mode with `Ctrl+Q` or `/plan-mode on|off|status`.
- Optionally select a dedicated planning model with `/plan-model`.
- Runs a mandatory planning questionnaire before transforming prompts.
- Forces structured `PLAN.md` planning output and checks for web evidence links.
- Archives `PLAN.md` snapshots to `~/.pi/agent/docs/<topic>/PLAN.md`.

## Install

```bash
pi install npm:@firstpick/pi-extension-plan-mode-toggle
```

## Configuration

No required configuration beyond runtime requirements.

## Requirements

- `brave_search` tool must be available in Pi.
- `BRAVE_SEARCH_API_KEY` must be set in Pi environment.

## Commands

- `/plan-mode on|off|status`
- `/plan-model [select|provider/model-id]`

## Shortcuts

- `Ctrl+Q` — toggle/arm plan mode.

## Example view

```text
/plan-mode on
Plan mode enabled. Your next request will be turned into a PLAN.md first.

Ctrl+Q
Plan mode armed for the next prompt.

/plan-model select
Pick planning model:
  gpt-5-codex
  gemini-3-pro
  claude-sonnet
```

Plan mode is useful when the next task needs deliberate research, sequencing, or review before code changes begin.
