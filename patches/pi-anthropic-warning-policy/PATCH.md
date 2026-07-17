# PATCH.md — Retire Anthropic installed warning-copy mutations

## Purpose

Separate warning/documentation policy from provider request compatibility and retire direct edits to installed Pi documentation, settings labels, and warning suppression.

### Root cause

The previous patch mixed transport behavior with UI copy and installed documentation, causing partial stale state after package updates.

### Expected outcome

Provider compatibility status is reported by the lifecycle and recovery components while upstream warning behavior and installed docs remain untouched.

## Lifecycle

**Manifest:** `./patch.manifest.json`

## Scope (exact files changed)

Files or logical targets:
1. `policy:upstream-warning-copy`

## Change 1 — Preserve upstream warning ownership

**File:** `policy:upstream-warning-copy`

### What was changed

This lifecycle component is an explicit no-op. It supersedes the old warning suppression, settings-label rewrites, and installed documentation edits.

### Why

UI copy should not claim that an experimental private-header compatibility shim is a supported billing contract.

## Verification steps

Run from `.`:

```bash
PATCHCTL="${HOME}/.pi/agent/skills/patch-md/scripts/patchctl.mjs"
node "$PATCHCTL" status --patch ./PATCH.md
node "$PATCHCTL" verify --patch ./PATCH.md
```

Expected:
- The component reports `retired-noop`.
- No installed package files are changed.

## Rollback

```bash
printf '%s\n' 'No rollback is required because this policy component performs no writes.'
```

- Legacy warning-copy edits should be removed by reinstalling/updating Pi or by rolling back the former monolithic patch receipt.

## Operational notes

- Keep provider compatibility, recovery behavior, and warning policy as separate lifecycle components.
