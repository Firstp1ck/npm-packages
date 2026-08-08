# Remote access for Pi Web UI

Open an existing Pi Web UI safely to devices on a trusted local network.

## What you can do

- Opens an existing Pi Web UI to a trusted local network.
- Shows a QR code for quick phone or tablet access.
- Offers PIN protection for non-local browsers.
- Closes network access again with one command.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-package-remote-webui
```

Restart Pi if the package does not appear in your current session.

## Before you start

Install [Pi Web UI](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-package-webui/README.md) first. Remote access connects to that existing browser interface.

## How to use it

1. Run `/remote`.
2. Review the prompt for trusted-LAN access and Remote PIN protection.
3. Scan the displayed QR code from your phone or tablet.
4. Run `/remote close` when you are finished.

Useful commands:

- `/remote status` — show the server, network, and PIN-auth state.
- `/remote refresh` — redraw the QR code with the current connection details.
- `/remote auth on` / `/remote auth off` — change PIN protection.
- `/remote close` — stop exposing the Web UI to the local network.

> **Security:** Use this only on a trusted local network. Pi Web UI can control the connected Pi session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-package-remote-webui/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
