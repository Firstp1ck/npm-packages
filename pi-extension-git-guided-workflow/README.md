# Guided Git workflow for Pi

Move staged changes through a careful Stage → Message → Commit → Push flow in Pi’s native terminal interface.

## What you can do

- Keep the changes you already staged or explicitly stage all current changes.
- Write a commit message yourself without using a model.
- Ask the active Pi model for short and long Conventional Commit candidates.
- Review the exact message and staged summary before committing.
- Choose a remote when necessary and review the exact branch and refspec before pushing.

## Install

```bash
pi install npm:@firstpick/pi-extension-git-guided-workflow
```

Restart Pi after installation.

## How to use it

Open Pi inside the repository you want to work with, then run:

```text
/git-guided-workflow
```

1. Choose the current staged set or confirm **Stage all changes**.
2. Write a message manually, or choose generation when an active model is available.
3. Review the exact message and staged summary, then confirm the commit.
4. Push to the shown destination, or finish with the commit kept locally.

Every Git mutation asks for confirmation. You can choose **Finish** without pushing.

## Before you start

This extension runs Git with your user permissions. Review staged changes and the displayed destination carefully. It never force-pushes, but a normal push still changes a remote repository.

Manual message entry never needs a model. The staged diff is sent to the active model provider **only after you select message generation**. That content may contain private code or data, so do not generate a message unless sharing the complete staged diff with that provider is acceptable.

Git hooks and signing remain enabled. Hooks can change the worktree or index while a commit is being created. A timed-out push can be uncertain; the workflow will not retry it automatically.

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for requirements, complete behavior, limits, safety, and troubleshooting. Contributors can use [DEVELOPMENT.md](DEVELOPMENT.md).
