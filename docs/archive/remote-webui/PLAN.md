## Plan: `pi-package-remote-webui`

## Implementation Progress

- [x] Plan captured in this file.
- [x] Implement package manifest, extension command, and reusable core helpers.
- [x] Add tests for argument parsing, status formatting, QR/widget output, and mocked WebUI control.
- [x] Run package checks and record results.

### Verification Log

- `cd pi-package-remote-webui && npm test` — passed 14/14 tests.
- `cd pi-package-remote-webui && npm run check` — passed syntax check for `lib/remote-core.mjs` and 14/14 tests.
- `cd pi-package-remote-webui && npm pack --dry-run` — package dry-run succeeded and includes 9 files.

### Recommendation

Create `pi-package-remote-webui` as a **thin Pi extension package** that reuses the existing `@firstpick/pi-package-webui` server primitives instead of building a second mobile UI, while owning `/remote` and the browser Remote WebUI control payload.

The package should add one main command:

```text
/remote
```

That command should:

1. Start or reuse the Pi Web UI server.
2. Open it to the local network using the existing WebUI network endpoint.
3. Pick a LAN URL.
4. Render a QR code in Pi.
5. Let the user scan the QR code on mobile and use the existing Pi Web UI.

This should be a UX wrapper around the current WebUI package, not a fork of it.

---

## Important caveat

Current `pi-package-webui` does **not** mirror the live terminal/TUI session. It starts Pi in RPC mode for WebUI tabs.

So the first version of `/remote` should mean:

> “Open a mobile WebUI connected to this Pi installation, current working directory, settings, packages, and session storage.”

It should **not** promise:

> “The phone controls the exact same live terminal conversation.”

That would require deeper Pi/WebUI core changes or a dedicated bridge.

---

## Package structure

```text
pi-package-remote-webui/
  package.json
  index.ts
  README.md
  LICENSE
  tests/
    remote-args.test.mjs
    remote-webui-control.test.mjs
```

Suggested package name:

```json
{
  "name": "@firstpick/pi-package-remote-webui",
  "keywords": ["pi-package", "pi", "webui", "remote", "mobile", "qr"],
  "pi": {
    "extensions": ["./index.ts"]
  },
  "dependencies": {
    "@firstpick/pi-package-webui": "^0.3.8",
    "qrcode-terminal": "^0.12.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

---

## `/remote` command design

### Default

```text
/remote
```

Behavior:

1. Probe `http://127.0.0.1:31415/api/health`.
2. If no WebUI server is running, start `pi-webui` from `@firstpick/pi-package-webui`.
3. Ensure it is open to LAN via:

```http
POST /api/network/open
```

4. Poll:

```http
GET /api/network
```

5. Use the first available LAN URL, e.g.

```text
http://192.168.1.42:31415/
```

6. Render QR code plus text:

```text
Pi Remote WebUI

Scan with your phone:

<QR CODE>

http://192.168.1.42:31415/

Remote PIN auth: off

Trusted LAN only. Remote PIN auth is off; anyone with this URL can control Pi/WebUI.
Close with: /remote close
```

Use `ctx.ui.setWidget()` so the QR remains visible after the command finishes.

---

## Command options

```text
/remote
/remote status
/remote close
/remote refresh
/remote auth on
/remote auth off
/remote --port 31500
/remote --name mobile
/remote --yes
```

### Recommended meanings

| Command | Behavior |
|---|---|
| `/remote` | Start/reuse WebUI, open to LAN, show QR |
| `/remote status` | Show WebUI status, LAN URLs, whether network is open |
| `/remote close` | Call `/api/network/close`, clear QR widget/status |
| `/remote refresh` | Re-read LAN URLs and redraw QR |
| `/remote auth on` / `/remote auth off` | Toggle Remote PIN auth through the remote package-owned control path |
| `/remote --port 31500` | Use another WebUI port |
| `/remote --name mobile` | Name the initial WebUI tab |
| `/remote --yes` | Skip confirmation warning |

---

## Security model

Use the existing WebUI direct LAN mode for v1.

Do **not** put a reverse proxy in front of WebUI for v1, because WebUI currently uses the real client address to distinguish localhost clients from remote LAN clients. A proxy would make mobile requests look like localhost unless carefully redesigned, weakening WebUI’s current trust boundaries.

### Required v1 behavior

Before opening the WebUI to LAN, show a confirmation that remote browsers can control the Web UI/Pi session and that Remote PIN auth is off by default unless enabled through `/remote auth on` or the Remote WebUI browser controls.

Default should be “No” unless `/remote --yes` is provided.

### Remote PIN auth

Remote PIN auth enforcement remains implemented in `pi-package-webui`, so the localhost-vs-remote trust semantics remain server-owned, but the user-facing controls are owned by this package:

- Remote PIN auth is off by default.
- `/remote auth on` generates a random 4-digit PIN; `/remote auth off` disables the gate.
- Non-local clients are challenged before accessing Web UI routes and APIs.
- Localhost clients can toggle the setting and see the PIN through `/remote status` or the package-owned Remote WebUI browser controls.
- `/remote` reads the reported auth state from `/api/network` and includes it in the QR widget.

Startup auth is also available through:

```text
pi-webui --remote-auth
/webui-start --remote-auth
```

---

## Implementation flow

### 1. Resolve WebUI binary

In `index.ts`, locate the bundled WebUI CLI:

```ts
@firstpick/pi-package-webui/bin/pi-webui.mjs
```

Use `createRequire(import.meta.url).resolve(...)` or a safe package-root fallback.

---

### 2. Probe existing server

Check:

```http
GET http://127.0.0.1:<port>/api/health
```

Accept only responses with:

```json
{
  "ok": true,
  "webuiVersion": "..."
}
```

---

### 3. Start WebUI if needed

Spawn:

```bash
node path/to/pi-webui.mjs --host 127.0.0.1 --port <port> --cwd <ctx.cwd>
```

Do not open the desktop browser.

Wait until `/api/health` succeeds.

---

### 4. Open LAN access

Call from localhost:

```http
POST http://127.0.0.1:<port>/api/network/open
```

Then poll:

```http
GET http://127.0.0.1:<port>/api/network
```

until:

```json
{
  "open": true,
  "networkUrls": ["http://192.168.x.x:31415/"]
}
```

If no LAN address is found, show a helpful error.

---

### 5. Render QR

Use `qrcode-terminal` or a tiny local QR helper.

Display with:

```ts
ctx.ui.setWidget("pi-remote-webui", lines, { placement: "aboveEditor" });
ctx.ui.setStatus("pi-remote-webui", "remote webui open");
ctx.ui.notify("Pi Remote WebUI ready", "info");
```

---

### 6. Close remote mode

`/remote close` should:

1. Call:

```http
POST http://127.0.0.1:<port>/api/network/close
```

2. Clear:

```ts
ctx.ui.setWidget("pi-remote-webui", undefined);
ctx.ui.setStatus("pi-remote-webui", undefined);
```

Do not kill the WebUI server unless an explicit future option like `/remote stop` is added.

---

## Testing plan

### Unit tests

Test:

- Argument parsing.
- Port validation.
- URL selection from multiple LAN URLs.
- QR text generation.
- Status formatting.
- Confirmation-required behavior.

### Mock WebUI tests

Use a local mock HTTP server for:

- `/api/health`
- `/api/network`
- `/api/network/open`
- `/api/network/close`

Verify `/remote` calls endpoints in the correct order.

### Manual acceptance test

1. Install package locally:

```bash
pi install ./pi-package-remote-webui
```

2. Restart Pi.
3. Run:

```text
/remote
```

4. Confirm warning.
5. Scan QR on phone.
6. Verify Pi WebUI loads.
7. Send a prompt from mobile.
8. Run:

```text
/remote close
```

9. Verify mobile disconnects or can no longer reach the WebUI.

---

## Acceptance criteria

- `/remote` starts from a normal Pi TUI session.
- QR code is visible and scannable from terminal.
- Mobile browser opens existing Pi WebUI.
- No separate mobile UI is built.
- `/remote close` closes LAN exposure.
- User is warned that Remote PIN auth is off by default unless enabled through `/remote auth on` or the Remote WebUI browser controls.
- QR/widget output shows Remote PIN auth state and PIN when enabled.
- Existing WebUI remote trust boundaries remain intact.
