# Plan Executor for Pi

Works through a PLAN.md checklist and keeps going until the plan is complete or needs your input.

## What you can do

- Works through checklist items in a PLAN.md file.
- Keeps going until the plan is complete or blocked.
- Shows current progress and the active item.
- Lets you stop the execution loop at any time.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-plan-executor
```

Restart Pi if the package does not appear in your current session.

## How to use it

Give the extension a PLAN.md file with checkboxes, then run `/execute-plan`. Watch progress with `/plan-status` and use `/stop-plan` whenever you want the loop to stop.

- `/execute-plan [path|topic]` — start execution loop.
- no argument: show a picker with all incomplete plans from `./PLAN.md` and `~/.pi/agent/docs/*/PLAN.md`; press `v` on a highlighted plan to preview it
- topic argument: execute `~/.pi/agent/docs/<topic>/PLAN.md` when no direct path exists
- completed plans are marked with `.plan-executor-complete` and omitted from the picker
- `/stop-plan` — stop active loop. Active execution can also be aborted with `Esc` or `Ctrl+C`.
- `/plan-status` — show current progress.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-plan-executor/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
