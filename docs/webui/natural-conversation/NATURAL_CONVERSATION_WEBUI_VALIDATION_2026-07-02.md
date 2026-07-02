# Natural Conversation WebUI Validation — 2026-07-02

Goal: runtime-validate Natural Conversation Mode through a REAL Web UI tab backed by the REAL `pi` binary (Phase 2 checklist item "Runtime-test Natural Conversation through a real WebUI tab"). This complements the 2026-07-01 TUI/RPC validation; no fake-pi test fixture was involved.

## Environment

- `pi` 0.80.3 (`/home/firstpick/.npm-global/bin/pi`), Node v22.23.1, Web UI 0.5.9 (dev mode from `pi-package-webui/bin/pi-webui.mjs`).
- Offline: `PI_OFFLINE=1` plus forwarded `--offline`; no model or API keys were used. Slash commands, `get_state`, `get_commands`, and the `webui-rpc-helper` tool inspection all work offline.
- The Natural Conversation package was forwarded into every tab as a directory extension (same pattern that passed TUI validation); the user's curated `~/.pi/agent` resources were suppressed with forwarded `--no-*` flags so `/talk` could only come from the repo package.

Exact launch command (fresh scratch workdir per run, random port 32000–52000):

```sh
PI_OFFLINE=1 PI_WEBUI_SETTINGS_FILE=<work>/webui-settings.json node bin/pi-webui.mjs \
  --cwd <work>/workspace --host 127.0.0.1 --port <port> \
  --pi /home/firstpick/.npm-global/bin/pi --no-session -- \
  --offline --no-context-files \
  --no-extensions --no-skills --no-prompt-templates --no-themes \
  --thinking high \
  --extension /home/firstpick/npm-packages/pi-package-natural-conversation
```

Real pi accepted `--thinking high` in RPC mode; the `/api/settings` fallback was not needed.

## Checks

All 11 checks passed in two consecutive script runs (11/11, exit 0 both times).

| # | Check | Result | Key observed values |
|---|---|---|---|
| 1 | Server healthy with real pi | PASS | `/api/health` → `ok=true piRunning=true`; first tab spawned by the real binary |
| 2 | Feature detection on tab A | PASS | `available=true`, `commands=[talk, voice, conversation]`, `mode.enabled=false`; `packageInstalled=true` observed (dev-mode Web UI resolves the workspace package root; recorded, not asserted) |
| 3 | Baseline tab A | PASS | `thinkingLevel=high`; active tools `{bash, edit, find, grep, ls, read, write}` |
| 4 | Create tab B (`POST /api/tabs`) | PASS | HTTP 201; tab B baseline `thinkingLevel=high` |
| 5 | Enable mode (`POST /api/conversation-mode enabled:true`) | PASS | HTTP 200, `mode.enabled=true`, `uiState=listening` |
| 6 | Constraint enforcement (real helper truth) | PASS | `GET /api/state` → `thinkingLevel=off`; `GET /api/tools` active tools exactly `{find, grep, ls, read}` |
| 7 | Tab isolation | PASS | Tab B `thinkingLevel=high` (unchanged), `mode.enabled=false`, `POST /api/bash` HTTP 200 |
| 8 | Web UI guards while enabled | PASS | `/copy` via `/api/prompt` → 409 (message names Natural Conversation); `POST /api/settings thinkingLevel=high` → 409; `POST /api/bash` → 409; `/talk status` via `/api/prompt` → 200 |
| 9 | Disable restores baselines | PASS | HTTP 200; `thinkingLevel=high` restored; active tools restored to `{bash, edit, find, grep, ls, read, write}` |
| 10 | Restart semantics (`POST /api/restart` after re-enable) | PASS | Outcome: **mode clearly turned off**. Restored tab A (same id) reported `mode.enabled=false` with the fresh pi process unconstrained (`thinkingLevel=high`, full tool set) — never "enabled but unconstrained" |
| 11 | Status-event path (`/talk on|off` through `/api/prompt`) | PASS | `/talk on` → 200, feature endpoint observed the package `setStatus` event: `enabled=true`, `statusText="Voice: listening"`; `/talk off` → 200, cleared to `enabled=false` |

Check 6 asserts on the truth reported by the `webui-rpc-helper` extension inside the real pi process (`pi.getAllTools()`/`pi.getActiveTools()` and RPC `get_state`), not on any Web UI cache.

## Observed evidence (trimmed)

Constraint enforcement on tab A while enabled:

```text
GET /api/state?tab=A   -> data.thinkingLevel: "off"
GET /api/tools?tab=A   -> active: ["find", "grep", "ls", "read"]   (all: bash, edit, find, grep, ls, read, workflow_run, workflow_status, write)
```

Guard response for a non-NC slash command while enabled:

```json
{
  "ok": false,
  "error": "Natural Conversation Mode is active; slash commands are blocked from the Web UI shell. Leave the mode first with /talk off."
}
```

Restart flow (`POST /api/restart` restarts the whole Web UI, replacing every tab's pi process; tab ids are restored):

```text
POST /api/restart -> { "ok": true, "message": "Pi Web UI restarting", "restorableTabCount": 2 }
after restart: GET /api/features/natural-conversation?tab=A
  -> available: true, mode.enabled: false, uiState: "off"
  GET /api/state?tab=A -> thinkingLevel: "high"; tools back to full baseline set
```

Status-event path:

```text
POST /api/prompt {"message":"/talk on"}  -> 200
GET /api/features/natural-conversation   -> mode.enabled: true, statusText: "Voice: listening"
POST /api/prompt {"message":"/talk off"} -> 200
GET /api/features/natural-conversation   -> mode.enabled: false, statusText: ""
```

## Rerun

```sh
node /home/firstpick/npm-packages/pi-package-webui/dev/scripts/natural-conversation-webui-validation.mjs --pi /home/firstpick/.npm-global/bin/pi
```

The script boots the server itself in a throwaway work dir, runs all 11 checks, prints a PASS/FAIL table, exits nonzero on any failure, and kills both the original and the restarted (detached) server process even on failure. Options: `--pi CMD`, `--port N`, `--work-dir DIR` (kept when given), `--keep-work-dir`.

## Result

Passed for the Web UI shell integration of the standalone package:

- Capability detection surfaced `/talk`, `/voice`, `/conversation` from the forwarded package extension without the Web UI importing the package.
- Enabling the mode forced thinking off and limited active tools to exactly `read`, `grep`, `find`, `ls` inside the real pi process; a second tab stayed fully unconstrained.
- Web UI guards returned 409 for non-NC slash commands, settings changes, and user bash while enabled; NC-owned `/talk` commands stayed allowed.
- Disabling restored the recorded thinking level (`high`) and the full baseline tool set.
- After a Web UI restart the restored tab reported the mode off with an unconstrained fresh pi process (the accepted "mode clearly turns off" semantics).
- `/talk on|off` sent as ordinary prompts drove the Web UI mode state through the package's status events.

## Caveats

- Fully offline run: no model responses were exercised, so no ordinary (model-bound) prompt was sent; conversational output quality is out of scope here. STT/TTS provider routes remain a separate pending item.
- `packageInstalled=true` was observed because the dev-mode Web UI resolves optional feature packages from the repo workspace root; `available` (driven by RPC-visible commands) is what gates the feature, and only it was asserted.
- The tab still loads the Web UI's own bundled extension manifest (btw, workflows, safety-guard, etc.) by design; the baseline/restore comparison uses the recorded observed tool set, so this does not affect the assertions.
- `POST /api/restart` restarts the whole Web UI server (there is no per-tab restart endpoint); this still replaces tab A's underlying pi process, which is the semantics under test.
- Automated HTTP-level validation of the Web UI shell contract; no human-driven browser session (browser microphone/speaker runtime validation remains pending).
