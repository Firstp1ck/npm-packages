# Technical reference: Plan Executor for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md)

Autonomous `PLAN.md` checklist executor for Pi.

## What it does

- Reads markdown checklist items (`- [ ]` / `- [x]`).
- Prompts you to choose a plan when `/execute-plan` is run without arguments.
- Lets you preview the highlighted plan from the picker with `v` before executing it.
- Discovers `./PLAN.md` plus plan-mode archives in `~/.pi/agent/docs/<topic>/PLAN.md`.
- Keeps steering execution until unchecked items are completed.
- Lets you abort an active executor with `Esc`, `Ctrl+C`, or `/stop-plan`.
- Marks completed plans with `.plan-executor-complete` next to the plan file.
- Hides completed plans from the picker.

## Install

```bash
pi install npm:@firstpick/pi-extension-plan-executor
```

## Configuration

No required configuration.

## Commands

- `/execute-plan [path|topic]` — start execution loop.
  - no argument: show a picker with all incomplete plans from `./PLAN.md` and `~/.pi/agent/docs/*/PLAN.md`; press `v` on a highlighted plan to preview it
  - path argument: execute that path when it exists
  - topic argument: execute `~/.pi/agent/docs/<topic>/PLAN.md` when no direct path exists
  - completed plans are marked with `.plan-executor-complete` and omitted from the picker
- `/stop-plan` — stop active loop. Active execution can also be aborted with `Esc` or `Ctrl+C`.
- `/plan-status` — show current progress.

## Tools

- `start_plan_executor` — start autonomous plan execution for a PLAN.md checklist.
- `stop_plan_executor` — stop active autonomous plan execution.
- `plan_executor_status` — inspect current autonomous plan executor state.

## Example view

```text
/execute-plan
Choose a plan to execute
  workspace: PLAN.md (1/4 done)
› archive: ~/.pi/agent/docs/brave-search-setup/PLAN.md (2/5 done)
  archive: ~/.pi/agent/docs/release-workflow-cleanup/PLAN.md (0/3 done)

↑↓ navigate • enter execute • v view plan • esc/ctrl+c cancel

Preview: ~/.pi/agent/docs/brave-search-setup/PLAN.md
   1 │ # Brave Search setup
   2 │ - [x] Inspect current implementation
   3 │ - [x] Add API-key prompt
   4 │ - [ ] Run final verification

Plan executor started: ~/.pi/agent/docs/brave-search-setup/PLAN.md (Esc/Ctrl+C to abort)

Plan completed and marked done: ~/.pi/agent/docs/brave-search-setup/PLAN.md (5/5)
```

Use this when you already have a checklist in the workspace, or when plan mode has archived one under `~/.pi/agent/docs/<topic>/PLAN.md`. Completed plans are marked and stay out of the next picker so the list stays focused on unfinished work.
