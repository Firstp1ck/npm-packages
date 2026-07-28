# PATCH.md — Pi session-scoped model and reasoning effort

## Purpose

Keep ordinary model and reasoning-effort changes in the active Pi session instead of persisting them as shared settings defaults. The patch changes only the supported compiled `@earendil-works/pi-coding-agent` 0.82.1 runtime layout and is deliberately fail-closed for every other version or semantic layout.

### Root cause

`AgentSession` records model and thinking-level changes in its session history, but the same ordinary selection paths also call the shared settings manager's `setDefaultModelAndProvider(...)` and `setDefaultThinkingLevel(...)`. The native interactive model selector has an additional independent default-model write. Those writes make one session's last selection become the startup default read by other or future sessions.

### Expected outcome

A model or effort change appends exactly one matching session-history entry and changes only the active session. Separate histories can therefore retain and resume different profiles, while the configured `defaultProvider`, `defaultModel`, and `defaultThinkingLevel` remain static startup defaults for fresh sessions. Unknown, partial, ambiguous, or drifted runtimes are blocked without writes.

## Lifecycle

**Manifest:** `./patch.manifest.json`

The v2 manifest and `scripts/lifecycle.mjs` are the executable source of truth. `patchctl` discovers the native and WebUI dependency graphs, deduplicates package roots by real path, performs semantic classification, and prepares every required target before an atomic apply.

## Scope (exact files changed)

Files or logical targets:
1. `target:agent-session`
2. `target:native-model-selector`

## Change 1 — Keep AgentSession selection persistence session-local

**Files:**
- `target:agent-session`

### What was changed

For each supported `dist/core/agent-session.js`, remove only the three ordinary `setDefaultModelAndProvider(...)` calls in direct/scoped/available model selection and the ordinary `setDefaultThinkingLevel(...)` call. Preserve the model and thinking history appends, active in-memory state, capability clamp, events, extension event, and model-triggered effort re-clamp. Applicable content transforms once; content that already satisfies all postconditions is an exact no-op.

### Why

Session history is the resumable source of a session's selected profile. Removing its parallel shared-default writes prevents a tab, terminal, or RPC session from changing defaults inherited by another session.

## Change 2 — Keep native selector selection out of shared defaults

**Files:**
- `target:native-model-selector`

### What was changed

For each supported `dist/modes/interactive/components/model-selector.js`, remove only its independent `setDefaultModelAndProvider(...)` call. Preserve selector close/callback ordering and unrelated settings calls. The lifecycle requires the exact semantic anchors and rejects missing or duplicate anchors.

### Why

Patching only `AgentSession` would leave native interactive selection able to overwrite the same shared model defaults.

## Verification steps

Run from `.` after setting `PATCHCTL` to the trusted `patchctl.mjs` supplied by the patch-md skill:

```bash
node "$PATCHCTL" status --patch ./PATCH.md
node "$PATCHCTL" plan --patch ./PATCH.md
node "$PATCHCTL" verify --patch ./PATCH.md
npm test
```

Expected:
- Status, plan, and verify are read-only; do not run apply during routine inspection.
- Every discovered native/WebUI target is semantically classified. Unknown versions, missing files, partial states, duplicate anchors, and drift block mutation.
- The test suite is credential-free and verifies transformed runtime behavior: two session histories diverge and resume independently, while the shared defaults file remains byte-identical and a fresh session inherits its configured defaults.
- Syntax, semantic postconditions, receipt hash binding (when a receipt exists), and test fixtures run locally with no provider request, network access, billing, credential, user-settings, or installed-runtime mutation.

## Rollback

```bash
node "$PATCHCTL" rollback --patch ./PATCH.md --confirm
```

- Rollback requires an apply receipt, validates each current after-hash, restores only matching receipt backups atomically, and refuses to overwrite drifted targets.
- Restart native Pi and every WebUI RPC child process after a successful rollback so loaded modules do not retain the previous runtime code.

## Operational notes

- `defaultProvider`, `defaultModel`, and `defaultThinkingLevel` remain configured startup defaults; ordinary session selections no longer update them. Existing sessions retain their own in-memory/history profile, and fresh sessions inherit the configured values.
- Before any apply, run fresh read-only `status` and `plan`, inspect every target and risk, obtain explicit approval for installed-package mutation, and apply only the exact reviewed hash: `node "$PATCHCTL" apply --patch ./PATCH.md --plan-hash "<fresh-reviewed-plan-hash>"`.
- Restart native Pi and all WebUI RPC child processes after apply. A running process may keep already-loaded compiled modules until restarted.
- Package upgrades can overwrite the installed transform or change its compiled layout. Re-run status and plan, review the new hash and semantic diagnostics, and never silently reapply an old approval; unsupported or drifted layouts must remain blocked.
- Native-only installations are valid. WebUI discovery covers the executable, repository sibling, standard agent npm directory, and global npm root; nonstandard installations must provide `PI_PATCH_WEBUI_ROOTS`, `PI_PATCH_WEBUI_ENTRIES`, or `PI_WEBUI_PI_BIN`, then confirm the reviewed plan includes every intended `webui-rpc` target.
- Concurrent writers to the same session history file are out of scope. This patch isolates distinct session histories; it does not add locking or conflict resolution for two writers sharing one JSONL history.
- No live-provider, network, billing, credential, or real-user-settings validation is performed. Provider behavior and paid/live requests remain explicitly deferred for separately approved manual validation.
