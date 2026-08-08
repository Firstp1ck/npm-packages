# Tools for Pi

Turn Pi tools on or off from an interactive selector.

![Interactive active-tool manager](https://unpkg.com/@firstpick/pi-extension-tools/images/tools_v0.1.2.png)

## What you can do

- Shows every tool available to the current Pi session.
- Lets you turn individual tools on or off.
- Uses an interactive selector instead of manual settings edits.
- Makes the new tool selection visible immediately.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-tools
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/tools`, select the tools Pi should be allowed to use, and save. Use the selector again whenever the task needs a different tool set.

- `/tools` — open a TUI to enable/disable individual tools, then press `Ctrl+S` to save or `q` to cancel.
- `/tools list` — print active/inactive tools grouped by source extension.
- `/tools enable <tool...>` — enable one or more tools.
- `/tools disable <tool...>` — disable one or more tools.
- `/tools reset` — enable all currently available tools.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-tools/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
