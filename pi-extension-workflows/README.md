# Workflows for Pi

Run saved, repeatable Pi workflows without putting all workflow logic in one large prompt.

## What you can do

- Runs reusable workflows stored as files.
- Shows progress, pauses, resumes, and retries.
- Supports safe worktree-based changes when a workflow needs them.
- Lets successful runs be saved as reusable workflows.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-workflows
```

Restart Pi if the package does not appear in your current session.

## How to use it

List the workflows available to you:

```text
/workflow list
```

Run one by name:

```text
/workflow run my-workflow
```

Control a run with:

- `/workflow status <run-id>` — check progress.
- `/workflow pause <run-id>` — pause it.
- `/workflow resume <run-id>` — continue it.
- `/workflow abort <run-id>` — stop it.
- `/workflow-setup` — review workflow settings.

Saving runs, retrying individual steps, importing workflows, and worktree handling are described in the technical reference.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-workflows/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
