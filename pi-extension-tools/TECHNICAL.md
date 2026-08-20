# Technical reference: Tools for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Interactive active-tool manager for Pi.

![Interactive active-tool manager](https://unpkg.com/@firstpick/pi-extension-tools/images/tools_v0.1.2.png)

## Commands

- `/tools` — open a TUI to enable/disable individual tools, then press `Ctrl+S` to save or `q` to cancel.
- `/tools list` — print active/inactive tools grouped by source extension.
- `/tools enable <tool...>` — enable one or more tools.
- `/tools disable <tool...>` — disable one or more tools.
- `/tools reset` — enable all currently available tools.

Saved tool choices are stored globally in `~/.pi/agent/tools.json` (or `$PI_CODING_AGENT_DIR/tools.json`) with both `active` and `inactive` tool lists. On startup, tools named in `active` are restored and tools named in `inactive` stay off. If the file is missing, the extension falls back to the current session branch state, then Pi's current active tools.

## Newly installed tools

A tool that appears in neither list has never been seen before, which happens when you install an extension that ships tools. Those tools are switched on and recorded, and a startup message names them. Run `/tools` afterwards if you would rather turn them off.

This keeps your explicit choices intact: a tool you disabled is written to `inactive` and stays off through installs, updates, and restarts.

If `inactive` is missing from the file, for example after hand-editing it, every tool that is not listed in `active` counts as new and is switched on. To rebuild the file from scratch, run `/tools reset` and then deselect what you do not want.

The global file is the cross-session source of truth. See `DEVELOPMENT.md` for branch-state compatibility details.
