# Technical reference: Workflows for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Commands

```text
/workflow list
/workflow run <workflow-name> [json-args]
/workflow status [run-id]
/workflow pause <run-id>
/workflow resume <run-id> [json-args]
/workflow abort [run-id]
/workflow retry <run-id> <call-id>
/workflow save <run-id> --user|--project
/workflow worktrees <run-id>
/workflow apply <run-id>
/workflow cleanup <run-id>
/workflow mode once|on|off|status
/workflow format <trusted-workflow-path>
/workflow import-claude <path>
/workflow bundle export <run-id> <bundle-path>
/workflow bundle import <bundle-path> --user|--project
/workflow schedule list
/workflow schedule add <id> <workflow-name> <ISO-time> [json-args]
/workflow schedule remove <id>
/workflow schedule run-due
/workflow-setup
```

Use `/workflows` to select and inspect active or historical runs, and `/workflow-clear` to clear the visible workflow status. `format` rewrites a trusted user/project workflow, `import-claude` validates a supported Claude-shaped workflow without silent rewriting, bundles export/import portable workflow run packages, and schedules manage deferred workflow runs. Review overwrite, trust, and schedule details before using these mutating commands.

## Workflow locations

- Bundled workflows: package `workflows/`
- User workflows: `~/.pi/agent/workflows/`
- Trusted-project workflows: `.pi/workflows/`
- Run history: `~/.pi/agent/workflow-runs/`

`PI_CODING_AGENT_DIR` changes the user-level Pi directory. Project workflows are loaded only for projects Pi already trusts.

## Running and controlling work

Start with `/workflow list`, then run a workflow by name. Runs continue in the background and can be checked, paused, resumed, or stopped.

A generated workflow requires confirmation before its first run. Pi can remember approval only for the exact unchanged workflow and safety policy.

Paused runs finish work already in progress but start no new steps. Retrying is limited to the selected failed step; write actions are not retried automatically.

## Workflow Mode

`/workflow mode on` asks Pi to turn substantial requests into reusable workflows. `/workflow mode once` applies only to the next request, and `/workflow mode off` returns to normal behavior.

Workflow Mode does not grant file-writing, shell, or network access. Those abilities still require explicit user or trusted-project permission.

## Safety and permissions

- Read-only work is the default.
- File changes, shell commands, and network use start denied.
- Project permissions can narrow, but never increase, user-level permission.
- Each writing worker uses a separate Git worktree.
- Applying worktree changes to the target project requires confirmation.
- Shell access is restricted to explicitly allowed programs and simple commands.
- A program allowed to run can still have broad effects; allow only programs you trust.
- Time, token, cost, concurrency, and worker limits can stop a run.

User policy: `~/.pi/agent/workflow-policy.json`

Trusted-project policy: `.pi/workflow-policy.json`

The complete policy format and workflow-authoring interface are in the contributor guide.

## Saving and migration

Save a successful workflow explicitly:

```text
/workflow save <run-id> --user
/workflow save <run-id> --project
```

Existing files are not overwritten without confirmation. Project saves require a trusted project.

Older JSON workflows remain readable for migration but are deprecated. New workflows use JavaScript. Use the contributor guide when creating or converting workflow files.

## Troubleshooting

- Use `/workflow status` to find the failed or blocked step.
- Check whether the project is trusted before using project workflows.
- Review permission ceilings when writing, shell, or network actions are denied.
- Use `/workflow worktrees` before applying or cleaning isolated changes.
- A budget stop keeps partial evidence but does not automatically continue.
