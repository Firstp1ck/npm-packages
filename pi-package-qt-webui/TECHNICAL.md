# Qt WebUI technical reference

Advanced user guidance for requirements, commands, runtime behavior, security, and troubleshooting.

[Back to README](README.md) · [Contributor guide](DEVELOPMENT.md)

## Requirements and compatibility

- Linux on a Wayland desktop session
- Quickshell 0.3 or newer available as `quickshell`
- Node.js 22.19 or newer
- Working Pi credentials and provider configuration in your existing Pi agent directory

Other operating systems, X11-only sessions, and Quickshell releases older than 0.3 are not supported. Version 1 provides a single plain-text session and does not render Markdown, images, or rich tool cards.

Qt WebUI reads the XDG desktop portal's color-scheme preference at startup, then falls back to Qt's current preference when the portal has no answer. It uses the built-in dark palette when the desktop asks for dark mode and the built-in light palette when the desktop asks for light mode. Qt preference changes update the open window without restarting Pi.

## Install and commands

Install the standalone command with npm:

```bash
npm install -g @firstpick/pi-package-qt-webui
```

| Command | Result |
|---|---|
| `qt-webui` | Opens Qt WebUI for the current directory. |
| `qt-webui dev` | Opens the packaged QML source and lets Quickshell reload it when files change. |
| `npm run dev` | Opens development mode from a source checkout. |

The launcher accepts no other options. Start it after changing to the project directory you want Pi to use. Spaces in directory names are supported.

Development mode does not add a separate file watcher or restart loop. Quickshell watches the selected source configuration and performs its native reload when QML changes.

## Runtime and security behavior

Qt WebUI starts one local Pi process for the window and uses the Pi version installed with this package. It does not search for or run a global `pi` command. Closing Quickshell ends the local Pi process.

The app does not open a network listener. Prompts remain data passed to the local Pi process, which then contacts the provider configured in Pi. Qt WebUI does not collect or store provider credentials. Pi still has the project and tool access granted by your existing configuration, so inspect tool activity before allowing consequential work.

`SIGINT` and `SIGTERM` sent to the launcher are forwarded to Quickshell. The command exits with Quickshell's exit result, which makes failures visible to scripts and terminals.

## Troubleshooting

### Quickshell cannot be started

Confirm that version 0.3 or newer is installed and visible on your `PATH`:

```bash
quickshell --version
```

Run the command inside a Wayland desktop session. A missing executable produces a launcher error explaining this requirement.

### The Pi entry cannot be resolved

Reinstall `@firstpick/pi-package-qt-webui` so its npm dependencies are restored. The launcher intentionally does not fall back to an unrelated global Pi installation.

### Pi cannot access the intended project

Close the app, change to the project directory, and start `qt-webui` again. The working directory is captured at startup.

### The color scheme does not match the desktop

Qt WebUI prefers the color scheme reported by the XDG desktop portal and falls back to Qt. Confirm the portal result with `busctl --user call org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.Settings Read ss org.freedesktop.appearance color-scheme`. The final number is `1` for dark, `2` for light, and `0` for no preference. If the portal cannot be read, confirm that other Qt applications see the expected theme and that your session exports the intended Qt platform theme.

### Development changes do not reload

Use `qt-webui dev` for the globally installed package or `npm run dev` from a source checkout. Edit the QML files selected by that command and check Quickshell's terminal output for load errors. Native reload cannot recover from every syntax error until the file is corrected.

## Contributor information

Implementation architecture, environment contracts, and validation commands are in [DEVELOPMENT.md](DEVELOPMENT.md).
