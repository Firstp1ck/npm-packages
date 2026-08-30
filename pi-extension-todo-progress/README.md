# Todo Progress for Pi

Shows a live checklist for prompts that contain several steps or goals.

![Todo progress widget](https://unpkg.com/@firstpick/pi-extension-todo-progress/images/todo_progress_v0.1.8.png)

## What you can do

- Creates a small checklist for multi-step requests.
- Marks the active item while work is happening.
- Updates the list only when progress changes.
- Clears completed progress after the final response.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-todo-progress
```

Restart Pi if the package does not appear in your current session.

## How to use it

Give Pi a request with several steps. The checklist appears automatically, tracks the active item, and clears after the completed response.

- Use `/goal <one-sentence goal>` to set the current todo-progress goal and start the agent with it.
- Use `/goal` to enter a goal in a prompt, then start the agent with it.
- Use `/todo-progress-status` to check whether the widget is loaded, visible, and tracking a goal or list.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-todo-progress/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
