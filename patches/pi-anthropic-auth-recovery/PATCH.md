# PATCH.md — Harden Pi Anthropic compatibility recovery

## Purpose

Install a portable global recovery extension that detects classified Anthropic compatibility failures and opens a separate read-only status/plan flow. Applying the provider patch remains a distinct, explicitly approved lifecycle action.

### Root cause

The previous recovery extension hardcoded user paths, a recovery model, localhost WebUI endpoints, and a single exact error string. It launched with `--approve` and asked the recovery agent to mutate installed packages immediately.

### Expected outcome

Native TUI and RPC/WebUI degrade safely, choose an available authenticated non-Anthropic model dynamically, never probe unauthenticated localhost endpoints, and never mutate files during automatic recovery.

## Lifecycle

**Manifest:** `./patch.manifest.json`

## Scope (exact files changed)

Files or logical targets:
1. `target:global-recovery-extension`

## Change 1 — Install the hardened recovery extension

**File:** `target:global-recovery-extension`

### What was changed

Install `src/anthropic-subscription-auth-recovery.ts` under the active Pi agent directory using source hashes, atomic replacement, mode-0600 backups, and receipt-based rollback.

### Why

The extension is shared by native TUI and WebUI RPC but must remain independently updateable from provider dist compatibility.

## Change 2 — Make automatic recovery plan-only and mode-aware

**File:** `target:global-recovery-extension`

### What was changed

Use versioned error classifiers and per-session deduplication. Select a configured non-Anthropic model from the model registry. Native TUI opens a plan-only terminal without `--approve`; RPC uses only an explicitly configured authenticated recovery endpoint and otherwise displays a manual command.

### Why

Recovery should not silently trust project resources, reuse the failing model, contact an arbitrary loopback service, or perform unreviewed global mutations.

## Change 3 — Add drift status and secure temporary handling

**File:** `target:global-recovery-extension`

### What was changed

Add `/anthropic-auth-status`, startup drift status, five-second secure endpoint timeouts, mode-0600 prompt files, delayed cleanup, safe cwd selection, and detached-spawn error handling.

### Why

Package updates should surface compatibility drift before a provider failure while preserving explicit user control.

## Verification steps

Run from `.`:

```bash
node --experimental-strip-types --check ./src/anthropic-subscription-auth-recovery.ts
node --experimental-strip-types --test ./tests/*.test.mjs
PATCHCTL="${HOME}/.pi/agent/skills/patch-md/scripts/patchctl.mjs"
node "$PATCHCTL" status --patch ./PATCH.md
node "$PATCHCTL" verify --patch ./PATCH.md
```

Expected:
- Unit tests use no external network or provider billing.
- Installed extension hash equals the reviewed source after apply.
- Recovery Pi arguments contain `--no-approve` and never `--approve`.

## Rollback

```bash
PATCHCTL="${HOME}/.pi/agent/skills/patch-md/scripts/patchctl.mjs"
node "$PATCHCTL" rollback --patch ./PATCH.md --confirm
```

- Existing extension content is restored from the receipt backup.
- A newly installed extension is removed only when its current hash still matches the receipt.

## Operational notes

- Set `PI_ANTHROPIC_RECOVERY_MODEL=provider/model` only to override dynamic model selection.
- RPC auto-open requires both `PI_WEBUI_RECOVERY_URL` and `PI_WEBUI_RECOVERY_TOKEN`. Compatible Pi Web UI versions inject a loopback URL and private bearer token into each spawned RPC process; other RPC hosts must configure both values explicitly or recovery safely falls back to a manual command.
- The automatic recovery prompt runs status and plan only.
- Reload Pi after extension apply; provider dist changes still require full runtime restart.
