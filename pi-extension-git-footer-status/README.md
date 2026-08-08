# Git Footer Status for Pi

Shows Git state, token use, context use, and model information in Pi’s footer.

![Status bar with metrics and git context](https://unpkg.com/@firstpick/pi-extension-git-footer-status/images/Statusbar_v0.1.5.png)

## What you can do

- Shows the current Git branch and changed-file state.
- Displays model, context, token, and cost information.
- Warns about ongoing Git operations or sync state.
- Refreshes automatically and can also be refreshed on demand.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-git-footer-status
```

Restart Pi if the package does not appear in your current session.

## How to use it

The footer appears automatically and updates as you work. In the Web UI, click **SYNC** to apply pending remote changes: when both pull and push are available, it attempts the fast-forward-only pull first and offers the push only after that pull succeeds.

- `/git-footer-refresh` — refresh the Git and usage information now.
- `/git-footer-visibility` — choose which footer items are shown.
- `/git-footer-visibility status` — review the current visibility choices.

The visibility screen lets you change the terminal and Web UI separately. Command-line shortcuts for changing several items at once are in the technical reference.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-git-footer-status/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
