# BTW for Pi

Ask a quick side question without derailing the main conversation.

## What you can do

- Opens a small side-question view over the current session.
- Lets you ask something unrelated without losing your main task.
- Summarizes your current goal, progress, next step, and uncertainty with `/btw-status`.
- Can copy a useful answer back into the main conversation.
- Works in both the terminal and Pi Web UI.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-btw
```

Restart Pi if the package does not appear in your current session.

## How to use it

Ask a side question with `/btw <question>`. If the answer matters to the main task, use the transfer action to bring it back.

```text
/btw what was the config file name again?
```

For a quick progress check, run:

```text
/btw-status
```

`/btw-status` asks the selected model for a concise, transcript-based summary of the current goal, completed and active work, remaining todos and next step, and any blockers or uncertainty. Each run uses a fresh snapshot of the main-session transcript. The result streams under the label **Current session, goal, and todo status** in the BTW overlay or Pi Web UI output card.

Terminal overlay keys:

- `↑` / `↓` — scroll
- `PageUp` / `PageDown` — scroll faster
- `Home` / `End` — jump to top/bottom
- `Enter`, `Space`, `Esc`, `Ctrl+C` — close the overlay; if the side request is still running, it is aborted

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-btw/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
