# Development guide: Remote access for Pi Web UI

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

1. Reuse a running Pi Web UI on `127.0.0.1:31415`, or start one for the current working directory.
2. Ask whether to activate Remote PIN auth when it is currently off.
3. Open the Web UI listener to the local network through the existing Web UI `/api/network/open` endpoint.
4. Show a terminal QR code, the LAN URL, and the current Remote PIN auth state.
5. Scan the QR code from your phone and use the normal Pi Web UI. If Remote PIN auth is enabled and the local server reports the PIN, the QR code opens an auth link that signs in automatically; the displayed PIN remains a manual fallback.
## Development

```bash
cd pi-package-remote-webui
npm test
npm run check
```

## Preserved package internals

Mobile connection helper for [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

This package adds the `/remote` slash command and Remote WebUI browser controls for `@firstpick/pi-package-webui`. It opens Web UI to a trusted local network, manages Remote PIN auth, and shows a QR code so a phone can connect quickly.

> **Security:** Pi Web UI can control the Web UI/Pi session. `/remote` asks whether to activate Remote PIN authentication before showing the QR code. Use `/remote` only on trusted local networks and close LAN access when done.

## Install

```bash
pi install npm:@firstpick/pi-package-remote-webui
```

Restart Pi after installation so the `/remote` command is loaded. `/remote` expects `@firstpick/pi-package-webui` to be installed in the same Pi/npm environment or available from this checkout; install `@firstpick/pi-package-webui` first if Pi cannot locate `pi-webui`. The QR renderer (`qrcode-terminal`) is a runtime dependency of this Pi package and is installed with the package. For local checkout development, run `npm install` in this package directory instead of installing `qrcode-terminal` globally.

## Usage

```text
/remote
```

## Commands

```text
/remote
/remote status
/remote refresh
/remote close
/remote auth on
/remote auth off
/remote --port 31500
/remote --name mobile
/remote --yes
```

| Command | Behavior |
|---|---|
| `/remote` | Start/reuse Web UI, confirm LAN access, ask whether to activate Remote PIN auth, open LAN access, and show QR plus auth state. |
| `/remote status` | Show Web UI online/network state, LAN URLs, and auth state. |
| `/remote refresh` | Re-read current LAN URL/auth state and redraw the QR widget. |
| `/remote close` | Close Web UI LAN exposure and clear the QR widget. |
| `/remote auth on` / `/remote auth off` | Enable or disable Remote PIN auth through the same package-owned control path used by the Web UI browser controls. |
| `/remote --port 31500` | Use another Web UI port. |
| `/remote --name mobile` | Name the initial Web UI tab when this package starts the server. |
| `/remote --yes` | Skip prompts and activate Remote PIN auth automatically before opening LAN access. |

## Remote PIN auth

`/remote` checks the Web UI server's auth state before opening LAN access:

- If Remote PIN auth is off, `/remote` asks whether to activate it.
- `/remote --yes` treats the auth prompt as accepted and activates it automatically.
- Enabling it generates a random 4-digit PIN.
- Non-local browser clients must authenticate before reaching Web UI.
- Localhost clients can always use the UI and toggle the setting through `/remote auth on|off` or the optional Remote WebUI side-panel controls.

The `/remote` QR widget shows `Remote PIN auth: off` or `Remote PIN auth: on · PIN 1234` when the Web UI server reports it. When a PIN is available, the QR code targets `/remote-auth#pin=1234` so the phone can authenticate automatically without typing the PIN; the fragment is scrubbed by the auth page before it posts to the server. In Web UI RPC sessions this package also announces a structured Remote WebUI controls payload so the browser can show/hide LAN and PIN controls with the same optional-feature toggle as `/remote`. You can also start Web UI with auth already enabled by using `pi-webui --remote-auth` or `/webui-start --remote-auth` from `@firstpick/pi-package-webui`.

## Caveat

This package does not mirror the exact live TUI conversation into the phone. It connects mobile to the existing Pi Web UI package, which starts/uses Pi RPC tabs with the same Pi installation, working directory, settings, packages, and session storage.

## Network safety

`/remote` intentionally uses `pi-package-webui`'s direct LAN mode instead of a reverse proxy, preserving Web UI's current localhost-vs-remote trust boundaries. Remote PIN auth remains a package-owned explicit control and a trusted-LAN convenience gate, not hardened multi-user authentication. Use `/remote close` when you are done.
