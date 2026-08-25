# Qt WebUI

Use Pi in a Linux desktop window built with Quickshell and Qt Quick.

## What you can do

- Send prompts and read assistant answers as they stream, rendered as Markdown with headings, lists, tables, quotes, links, and copyable code blocks.
- See what Pi is doing: thinking sections you can show or hide, and a card for every tool call with its status, duration, and output.
- Answer questions from Pi extensions in native dialogs: pick an option, confirm, type a value, or edit text.
- Steer a running task, queue a follow-up, or abort it; restart Pi or the local backend after a failure.
- Search the transcript, copy any message, and switch between comfortable and compact rows.
- Get a desktop notification when a run finishes or Pi needs input while the window is in the background.
- See the active provider, model ID, and thinking effort in the header, plus status chips from extensions such as the Git footer.
- Work in the project directory where you started `qt-webui`, and follow the desktop's light or dark color scheme.

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

Type a prompt and press `Enter` (`Shift+Enter` adds a new line). While Pi is working, `Enter` sends a steering message and `Alt+Enter` queues a follow-up; the **Abort** button stops the run, and an animated indicator under the last entry shows that Pi is still working. When an extension asks a question, a dialog opens with the choices; `Escape` cancels it.

Useful shortcuts:

- `Ctrl+F` searches the transcript; `Enter` and `Shift+Enter` move between matches.
- `Ctrl+T` shows or hides thinking sections.
- `Ctrl+Shift+M` switches between comfortable and compact rows.
- `Ctrl+L` returns focus to the prompt.

Links in answers open in your default application only after you confirm the full address. Your display choices are saved between sessions.

For QML development, start the packaged source configuration with native reload enabled:

```bash
qt-webui dev
```

From a source checkout, use `npm run dev` instead. Saving a QML file while either development command is running lets Quickshell reload the configuration.

## Before you start

Qt WebUI requires Linux, a Wayland desktop session, Quickshell 0.3 or newer, and Node.js 22.19 or newer. It uses your existing Pi credentials and settings; it never asks you to enter provider secrets.

Pi runs with access to the directory where you launch the app. Review prompts, tool cards, and extension dialogs just as you would in Pi's terminal interface, because approved tools can read or change project files.

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for complete commands, requirements, settings, security behavior, limitations, and troubleshooting information.
