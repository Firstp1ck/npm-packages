# Technical reference: Todo Progress for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Auto todo/progress tracking for multi-step Pi agent work.

![Todo progress widget](https://unpkg.com/@firstpick/pi-extension-todo-progress/images/todo_progress_v0.1.8.png)

## What it does

- Requires the agent to formulate a separate one-line `Goal: ...` before creating the first todo list or starting work.
- Instructs the agent to create concise, agent-authored todos for multi-step work.
- Instructs the agent to emit checklist lines only when a list starts or an item’s text/status changes; unchanged lists are not repeated before every tool call.
- Tracks agent-authored Markdown checklist markers such as `- [ ]`, `- [-]`, and `- [x]`.
- Keeps the widget as the canonical checklist display while preserving the active goal/list for follow-up steps.
- Keeps a completed list visible long enough for the agent to check whether the goal is reached.
- If the goal is reached, the agent should produce final output; if not, it should create a new short checklist before continuing.
- Supports multiple todo lists during one agent run; each new list replaces the previous widget list.
- Clears active display state after any normal final assistant response (including partial progress) or a newly delivered user request; aborted, failed, length-limited, and tool-use endings keep it available for recovery.
- Shows up to 5 rows and supports manual scrolling/hiding.

## Install

```bash
pi install npm:@firstpick/pi-extension-todo-progress
```

## Configuration

No required configuration.

## Commands

- Use `/goal <one-sentence goal>` to set the current todo-progress goal and start the agent with it.
- Use `/goal` to enter a goal in an interactive prompt, then start the agent with it.
- Use `/todo-progress-status` to check whether the widget is loaded, visible, and tracking a goal or list.

If the agent is already running, `/goal` saves the new goal and queues it as the next follow-up instead of interrupting the active turn.

## Shortcuts

- `Ctrl+Alt+X` — hide current list.
- `Ctrl+Alt+J` / `Ctrl+Alt+K` — scroll todo list down/up.

## Example flow

```text
Goal: Update the README and verify the package still loads.
Todo 1/3 done, 1 partial
[x] Inspect package structure
[-] Update README behavior notes
[ ] Run focused checks
```

When all items are done, the widget title changes to a goal-check state:

```text
Goal: Update the README and verify the package still loads.
Todo 3/3 done · check goal
[x] Inspect package structure
[x] Update README behavior notes
[x] Run focused checks
```

At that point the agent should either produce the final answer or create the next short checklist if the goal is not yet reached.

Active widget state is persisted in the Pi session, so interrupted/failed/tool-use runs can survive terminal redraws, tab switches, reloads, and resumes until a normal final assistant response, a newly delivered user prompt, or `Ctrl+Alt+X` clears it.
