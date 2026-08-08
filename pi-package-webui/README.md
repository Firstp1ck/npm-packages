# Pi Web UI

Use Pi from a local browser with tabs, streaming responses, uploads, model controls, Git helpers, and optional companion features.

![Pi Web UI main window showing multi-tab chat, streaming output, footer status, composer, and side controls](https://raw.githubusercontent.com/Firstp1ck/pi-coding-agent-forge/main/pi-package-webui/images/Webui_MainWindow_v0.4.8.png)

## What you can do

- Work in several Pi sessions at once.
- Change models and thinking effort without leaving the browser.
- Upload files and images, use slash-command suggestions, and manage follow-up prompts.
- Resume sessions, switch projects, and use guided Git helpers.
- Add optional themes, statistics, remote access, voice features, and other companion packages.

## Install

```bash
pi install npm:@firstpick/pi-package-webui
```

Restart Pi after installation.

## Start it

Inside Pi, run:

```text
/webui-start
```

Open the printed address, usually <http://127.0.0.1:31415/>. Check a running server with `/webui-status`.

You can also install the standalone launcher:

```bash
npm install -g @firstpick/pi-package-webui
pi-webui
```

If no working directory is supplied, the browser asks which project to open first.

## Keep it private

Pi Web UI can do anything the connected Pi session is allowed to do. It listens only on `127.0.0.1` by default. Do not expose it directly to an untrusted network. Use the optional Remote Web UI package when you need trusted-LAN access and PIN protection.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-package-webui/TECHNICAL.md) for command-line options, settings, update and rollback behavior, session continuity, security, compatibility, and troubleshooting.
