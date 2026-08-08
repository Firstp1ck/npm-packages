# Technical reference: Small Modal Reliability for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Small-LLM reliability layer for Pi. It keeps durable task state and a scratchpad, blocks repeated failed actions, and requires evidence-based verification before completion claims. Contributor-facing event flow and state-machine details are in `DEVELOPMENT.md`.

## Enable

Or inside Pi:

```text
/reliability on
/reliability on implement the checkout flow
/reliability status
/reliability verify
/reliability suggest
/reliability eval [--write]
/reliability tasks
/reliability tasks --all
/reliability resume <task_id_prefix>
/reliability archive <task_id_prefix>
/reliability profile strict|balanced|relaxed
/reliability mode adaptive|lite|supervised
/reliability --mode plan-on [goal]
/reliability --mode plan-off
/reliability --mode plan-status
/reliability context full|compact|delta
/reliability orchestrate [--run]
/reliability scratchpad
/reliability off
/reliability reset
```

The extension is opt-in by default. The default balanced profile uses adaptive supervision: simple tasks start in lite mode (task state + verification gate only), while long/multi-step work, tool errors, repeated-action blocking, strict profile, orchestration, or unsupported completion claims escalate to supervised worker-step mode. It stores task files under:

```text
.pi/tasks/{task_id}/state.json
.pi/tasks/{task_id}/scratchpad.md
.pi/tasks/{task_id}/state-events.jsonl
.pi/tasks/{task_id}/plan-mode/01-exploration.md
.pi/tasks/{task_id}/plan-mode/02-implementation-plan.md
.pi/tasks/{task_id}/plan-mode/03-summary.md
.pi/tasks/{task_id}/plan-mode/04-verification.md
.pi/tasks/{task_id}/plan-mode/05-final-report.md
.pi/tasks/{task_id}/plan-mode/failures/*.md
```

## Plan mode

`/reliability --mode plan-on [goal]` starts a single-model, fresh-session planning workflow. If a goal is provided, the extension creates a task immediately, writes plan-mode Markdown templates, starts a new session, and prompts the model to create `01-exploration.md`. Without a goal, plan mode is armed for the next user prompt.

The workflow uses fresh Pi sessions and the listed Markdown artifacts to move through exploration, planning, focused implementation, summary, verification, and final reporting. A failed verification records the issue and reopens the affected work instead of claiming completion.

Use `/reliability --mode plan-off` to stop the workflow and `/reliability --mode plan-status` to inspect artifact paths and progress.

## Configuration

Optional project config:

```json
{
  "enabled": false,
  "profile": "balanced",
  "requirePlan": true,
  "requireVerification": true,
  "maxRepeatedAction": 3,
  "scratchpadEnabled": true,
  "contextBudgetChars": 6000,
  "contextMode": "compact",
  "progressWidget": true,
  "storeRawToolLogs": false,
  "rawLogMaxChars": 50000,
  "orchestrationMode": "prompt",
  "orchestrationModels": {
    "supervisor": "provider/model-id",
    "worker": "provider/model-id",
    "verifier": "provider/model-id"
  },
  "orchestrationTools": ["read", "grep", "find", "ls"],
  "orchestrationMaxOutputChars": 50000
}
```

Save it as `.pi/reliability.json` in a trusted project. `orchestrationMode` defaults to `prompt`; separate pi subprocesses only run when `orchestrationMode` is `separate-model` and `/reliability orchestrate --run` is invoked.

## Current limits

- `/reliability eval` is an offline deterministic harness evaluation; live small-model completion-rate evaluation still requires running representative tasks with actual configured models.
- Separate supervisor/worker/verifier subprocesses are explicit and opt-in; prompt-contract mode remains the default.
- It does not rewrite or compress normal conversation history yet.
- Raw tool logs are intentionally not stored by default to avoid persisting secrets; normalized summaries are stored in state.
