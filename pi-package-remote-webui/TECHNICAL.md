# Technical reference: Remote access for Pi Web UI

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Requirements and install

Install Pi Web UI first, then install this companion:

```bash
pi install npm:@firstpick/pi-package-webui
pi install npm:@firstpick/pi-package-remote-webui
```

Restart Pi afterward.

## Commands

- `/remote` — start or reuse Web UI, review LAN and PIN protection, then show a QR code.
- `/remote status` — show Web UI, network, and PIN status.
- `/remote refresh` — refresh the connection details and QR code.
- `/remote close` — close LAN access and clear the QR card.
- `/remote auth on` / `/remote auth off` — enable or disable PIN protection.
- `/remote --port 31500` — use another Web UI port.
- `/remote --name mobile` — name the first Web UI tab.
- `/remote --yes` — enable PIN protection and open LAN access without the normal prompts.

## PIN protection

When PIN protection is off, `/remote` asks whether to enable it before opening LAN access. Enabling it creates a random four-digit PIN for non-local browsers.

The QR code can carry the PIN to the sign-in page so a phone can connect without manual typing. The displayed PIN remains available as a fallback.

Localhost access remains available even when PIN protection is enabled.

## Network safety

Use remote access only on a trusted local network. PIN protection is a convenience gate, not hardened multi-user authentication.

Run `/remote close` when finished. Avoid direct internet exposure; use a properly secured private network or tunnel when access must cross networks.

## Limitations

This package connects a phone or tablet to Pi Web UI. It does not mirror the exact terminal screen. The browser uses Pi sessions with the same installation, settings, working folders, and saved session storage.

## Troubleshooting

- Use `/remote status` when the QR code is stale or the browser cannot connect.
- Confirm both packages are installed in the same Pi environment.
- Check the selected port and local firewall when the phone cannot reach the host.
- Re-enable PIN protection before reopening LAN access if it was turned off temporarily.
