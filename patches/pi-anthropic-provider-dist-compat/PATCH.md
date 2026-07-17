# PATCH.md — Pi Anthropic Agent SDK dist compatibility fallback

## Purpose

Provide a conservative binary/dist fallback for Anthropic OAuth request compatibility when no upstream-supported Pi transport is available. The patch resolves only the `pi-ai` implementations actually used by native Pi TUI and WebUI RPC runtimes.

### Root cause

Installed Pi runtimes may retain a legacy Claude Code OAuth request identity. Package updates overwrite manual edits, package layouts differ, and blindly patching every matching `node_modules` copy can alter dormant or unrelated packages.

### Expected outcome

Every discovered runtime is classified before mutation. Known legacy layouts are transformed transactionally, already-patched or upstreamed layouts are no-ops, and unknown versions/layouts fail without partial writes.

## Lifecycle

**Manifest:** `./patch.manifest.json`

The manifest and `scripts/lifecycle.mjs` are the executable source of truth. The request profile can be overridden at runtime with `PI_ANTHROPIC_AGENT_SDK_VERSION`, `PI_ANTHROPIC_AGENT_SDK_BUILD`, and `PI_ANTHROPIC_AGENT_SDK_ENTRYPOINT` without editing installed files again.

## Scope (exact files changed)

Files or logical targets:
1. `target:native-pi-ai-anthropic`
2. `target:webui-pi-ai-anthropic`

## Change 1 — Discover actual runtime dependency graphs

**Files:**
- `target:native-pi-ai-anthropic`
- `target:webui-pi-ai-anthropic`

### What was changed

Resolve native Pi from the executable path and WebUI from its actual child coding-agent package. Resolve `@earendil-works/pi-ai` from each coding-agent root, deduplicate shared package roots, record package versions and hashes, and select only implementations containing the expected Anthropic request symbols.

### Why

Absolute user paths and exhaustive `node_modules` searches become stale and can modify package copies that no running Pi surface uses.

## Change 2 — Apply a semantic, idempotent OAuth transform

**Files:**
- `target:native-pi-ai-anthropic`
- `target:webui-pi-ai-anthropic`

### What was changed

For supported legacy layouts only, replace the legacy OAuth identity with a marked Agent SDK compatibility profile, deduplicated beta set, session header, long OAuth cache default, billing attribution block, and Agent SDK identity block. Every semantic anchor must match exactly once and every postcondition must hold exactly once.

### Why

Version ranges are only a first gate. Semantic fingerprints prevent an apparently compatible but structurally changed future package from being modified.

## Change 3 — Make application transactional and rollback-safe

**Files:**
- `target:native-pi-ai-anthropic`
- `target:webui-pi-ai-anthropic`

### What was changed

Prepare all transformed files, run syntax and semantic checks, create mode-0600 backups, then atomically replace targets. Apply receipts record target roles, package versions, paths, modes, and before/after hashes. Rollback refuses drifted targets.

### Why

A multi-runtime patch must not leave native Pi patched while WebUI remains partially or incorrectly modified.

## Verification steps

Run from `.`:

```bash
PATCHCTL="${HOME}/.pi/agent/skills/patch-md/scripts/patchctl.mjs"
node "$PATCHCTL" status --patch ./PATCH.md
node "$PATCHCTL" plan --patch ./PATCH.md
node "$PATCHCTL" verify --patch ./PATCH.md
```

Expected:
- Native Pi is discovered; WebUI is discovered when installed.
- Required unknown targets block apply.
- Syntax, semantic postconditions, and local no-secret HTTP capture pass after apply.
- No external network or Anthropic billing is used.

## Rollback

```bash
PATCHCTL="${HOME}/.pi/agent/skills/patch-md/scripts/patchctl.mjs"
node "$PATCHCTL" rollback --patch ./PATCH.md --confirm
```

- Rollback restores only files whose current hashes equal the receipt's after-hashes.
- Backups must match recorded before-hashes.

## Operational notes

- Review a fresh plan and apply with `patchctl apply --plan-hash <hash>`.
- A package update should produce drift/applicable status, never silent reapplication.
- The compatibility request profile is not a documented Anthropic protocol contract.
- Live Anthropic verification is intentionally manual because it may consume credit or usage billing.
- Restart native Pi and WebUI child RPC processes after apply or rollback.
