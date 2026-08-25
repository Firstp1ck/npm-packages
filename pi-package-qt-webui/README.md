# Qt WebUI

Use Pi in a small Linux desktop window built with Quickshell and Qt Quick.

## What you can do

- Send prompts and read assistant text as it streams.
- See when Pi is running or using a tool.
- Abort active work and restart Pi after a process failure.
- Work in the project directory where you started `qt-webui`.
- Follow the desktop portal's light or dark color-scheme preference, with Qt as a fallback.
- Edit QML in development mode and use Quickshell's native reload.

## Install

```bash
npm install -g @firstpick/pi-package-qt-webui
```

## How to use it

Open a Wayland session, change to the project you want Pi to work on, and start the window:

```bash
cd ~/projects/example
qt-webui
```

For QML development, start the packaged source configuration with native reload enabled:

```bash
qt-webui dev
```

From a source checkout, use `npm run dev` instead. Saving a QML file while either development command is running lets Quickshell reload the configuration. The first version shows plain text rather than rendered Markdown or rich tool cards.

## Before you start

Qt WebUI requires Linux, a Wayland desktop session, Quickshell 0.3 or newer, and Node.js 22.19 or newer. It uses your existing Pi credentials and settings; it never asks you to enter provider secrets.

Pi runs with access to the directory where you launch the app. Review prompts and tool activity just as you would in Pi's terminal interface, because approved tools can read or change project files.

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for complete commands, requirements, security behavior, limitations, and troubleshooting information.
