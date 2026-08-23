# Guided Git workflow for Pi

Use one `/git-guided-workflow` command to start a careful Git flow in Pi's native terminal interface or a compatible WebUI.

## What you can do

- Keep the changes you already staged or explicitly stage all current changes in Pi's TUI.
- Write a commit message yourself without using a model.
- Ask the active Pi model for short and long Conventional Commit candidates.
- Review the exact message and staged summary before committing.
- Choose a remote and review the exact branch and refspec before pushing.
- Start the existing richer Guided Git browser flow from the same command in a compatible WebUI.

## Install

```bash
pi install npm:@firstpick/pi-extension-git-guided-workflow
```

Restart Pi and any connected WebUI tabs after installation.

## How to use it

Open Pi inside the repository you want to work with, then run:

```text
/git-guided-workflow
```

In Pi's native terminal interface:

1. Choose the current staged set or confirm **Stage all changes**.
2. Write a message manually, or choose generation when an active model is available.
3. Review the exact message and staged summary, then confirm the commit.
4. Push to the shown destination, or finish with the commit kept locally.

In a compatible WebUI, the same command asks that WebUI to open its Guided Git workflow for the originating tab. The browser flow keeps its existing staging, generation, commit, push, and optional pull-request controls. Generated commit, branch, and pull-request text in that browser flow still requires `@firstpick/pi-prompts-git-pr`.

Every Git mutation asks for confirmation. You can choose **Finish** without pushing in the native flow.

## Before you start

This extension runs Git with your user permissions in the native TUI. Review staged changes and the displayed destination carefully. It never force-pushes, but a normal push still changes a remote repository.

Manual message entry never needs a model. In the native flow, the staged diff is sent to the active model provider **only after you select message generation**. That content may contain private code or data, so do not generate a message unless sharing the complete staged diff with that provider is acceptable.

Requesting the browser workflow sends no repository path, diff, preferences, or Git data in the activation signal. The WebUI then owns its existing browser workflow and privacy behavior.

Git hooks and signing remain enabled. Hooks can change the worktree or index while a commit is being created. A timed-out push can be uncertain; the workflow will not retry it automatically.

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for requirements, complete behavior, limits, WebUI compatibility, safety, and troubleshooting. Contributors can use [DEVELOPMENT.md](DEVELOPMENT.md).
