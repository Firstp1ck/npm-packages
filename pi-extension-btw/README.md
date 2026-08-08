# BTW for Pi

Ask a quick side question without derailing the main conversation.

## What you can do

- Opens a small side-question view over the current session.
- Lets you ask something unrelated without losing your main task.
- Can copy a useful answer back into the main conversation.
- Works in both the terminal and Pi Web UI.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-btw
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/btw`, type the side question, and close the overlay when finished. If the answer matters to the main task, use the transfer action to bring it back.

- `/btw what was the config file name again?`
- `↑` / `↓` — scroll
- `PageUp` / `PageDown` — scroll faster
- `Home` / `End` — jump to top/bottom
- `Enter`, `Space`, `Esc`, `Ctrl+C` — close the overlay; if the side request is still running, it is aborted

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-btw/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
