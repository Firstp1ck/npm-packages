# Qt WebUI

Use Pi in a Linux desktop window built with Quickshell and Qt Quick.

## What you can do

- Send prompts and read assistant answers as they stream, rendered as Markdown with headings, lists, tables, quotes, links, and syntax-highlighted, copyable code blocks.
- Attach text files and images to a prompt, complete `/` commands and `@` workspace paths while typing, keep an unsent draft per session, and save prompt sequences you run again later.
- See what Pi is doing: thinking sections you can show or hide, and a card for every tool call with its status, duration, and output.
- Answer questions from Pi extensions in native dialogs: pick an option, confirm, type a value, or edit text.
- Steer a running task, queue a follow-up, or abort it; restart Pi or the local backend after a failure.
- Work in a focused desktop layout with workspace tabs in a left rail, a readable centered conversation, and an elevated prompt editor.
- Search the transcript, copy any message, and switch between Detailed and Compact transcript rows.
- Get a desktop notification when a run finishes or Pi needs input while the window is in the background.
- See the active provider, model ID, and thinking effort beside the prompt, plus status chips from extensions such as the Git footer.
- Choose a model from Pi's current scoped-model list, drag explicitly scoped models into a preferred order that persists across restarts, and set thinking effort from drop-ups above the prompt control strip; configure tool, skill, and sampling profiles or compact long conversations from the same strip.
- Open several projects in tabs, each with its own Pi session, resume any saved session for a folder, and start a Git worktree for a new branch in its own tab.
- Reach every action, tab, model, session, and Pi command from one keyboard-first palette (`Ctrl+K`), watch context and token usage in the footer, and review events and diagnostics without leaving the window.
- Work in the project directory where you started `qt-webui` (your tabs come back after a restart), follow live desktop light/dark changes, or choose a saved light/dark override and reduced motion from the command palette.

## Install

Install it as a Pi package to add the `/qt-webui-start` command:

```bash
pi install npm:@firstpick/pi-package-qt-webui
```

For a standalone terminal command instead, install it globally with npm:

```bash
npm install -g @firstpick/pi-package-qt-webui
```

## How to use it

After installing the Pi package, start Pi in the project you want to open:

```bash
cd ~/projects/example
pi
```

Then enter this command inside Pi:

```text
/qt-webui-start
```

The command starts Qt WebUI for Pi's current working directory and returns immediately, leaving Pi open. With the global npm installation, run `qt-webui` from the project directory instead.

Choose a workspace tab from the left rail, then type in the prompt editor below the centered conversation and press `Enter` (`Shift+Enter` adds a new line). The prompt control defaults to **Steer mode**. Switch it to **Follow-up mode** when you want `Enter` and the nearby run action to queue the next prompt instead; `Alt+Enter` always queues a follow-up. The **Abort** button stops the run, and three animated dots under the last entry show that Pi is still working. The three-line **More options** menu below the prompt holds Resources, display preferences, Events, and Diagnostics without crowding the main window. When an extension asks a question, a dialog opens with the choices; `Escape` cancels it.

Useful shortcuts:

- `Ctrl+F` searches the transcript; `Enter` and `Shift+Enter` move between matches.
- `Ctrl+T` shows or hides thinking sections.
- `Ctrl+Shift+M` switches between **Detailed** and **Compact** transcript rows.
- `Ctrl+L` returns focus to the prompt.
- `Ctrl+M` opens Pi's scoped-model list above the model control. When Pi supplies an explicit scope, drag the **≡** handle or press `Ctrl+Shift+Up` / `Ctrl+Shift+Down` to reorder it. `Ctrl+E` opens thinking effort; `Ctrl+Shift+P` and `Ctrl+Shift+E` cycle through the model and effort lists.
- `Ctrl+Shift+R` opens **Resources** from the **More options** menu for enabled tools, enabled skills, and model-supported sampling values.
- `Ctrl+Shift+A` attaches files and `Ctrl+Shift+S` opens your saved prompt sequences.
- Type `/` to complete a command or `@` to complete a workspace path; `Tab` or `Enter` completes without sending.
- `Ctrl+N` opens a tab in the same folder, `Ctrl+O` picks another folder, `Ctrl+W` closes the tab, `Ctrl+Tab` switches tabs, `Ctrl+Shift+O` resumes a saved session, `Ctrl+Shift+N` starts a new one, and `Ctrl+Shift+B` creates a Git worktree.
- `Ctrl+K` opens the command palette, where you can cycle Automatic/Light/Dark appearance and reduced motion; `Ctrl+Shift+L` opens event history and `Ctrl+Shift+D` opens diagnostics.

Links in answers open in your default application only after you confirm the full address. Your display choices are saved between sessions.

For QML development, start the packaged source configuration with native reload enabled:

```bash
qt-webui dev
```

From a source checkout, use `npm run dev` instead. Saving a QML file while either development command is running lets Quickshell reload the configuration.

## Before you start

Qt WebUI requires Linux, a Wayland desktop session, Quickshell 0.3 or newer, and Node.js 22.19 or newer. It uses your existing Pi credentials and settings; it never asks you to enter provider secrets.

Pi runs with access to the directory where you launch the app. Review prompts, tool cards, extension dialogs, and resource profiles just as you would in Pi's terminal interface, because enabled tools and skills can read or change project files. An empty profile intentionally disables every item in that category; **Inherit** does not. If Pi is using an ephemeral session, Qt WebUI warns that a session profile applies only until that session ends instead of claiming it was saved.

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for complete commands, requirements, settings, security behavior, limitations, and troubleshooting information.
