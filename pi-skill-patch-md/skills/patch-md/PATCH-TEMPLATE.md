# PATCH.md — <short patch title>

## Purpose

<what this patch fixes or improves, in 1-3 sentences>

### Root cause

<concrete mechanism causing the issue>

### Expected outcome

<observable behavior after the patch>

## Lifecycle

**Manifest:** `./patch.manifest.json`

The v2 manifest is the machine-readable execution source of truth. This document explains intent and evidence; `patchctl` performs status, plan, apply, verify, and rollback.

## Scope (exact files changed)

Path variables:

- `<VAR_NAME>=<value or expression>`

Files or logical targets:
1. `target:<stable-target-id>`
2. `<relative/path/when-static>`

## Change 1 — <short change title>

**Files:**
- `target:<stable-target-id>`
- `<relative/path/when-static>`

### What was changed

<semantic transformation and pre/postconditions; do not rely only on prose snippets>

### Why

<reason this change is needed>

## Verification steps

Run from `<patch directory>`:

```bash
node /path/to/patchctl.mjs status --patch ./PATCH.md
node /path/to/patchctl.mjs plan --patch ./PATCH.md
node /path/to/patchctl.mjs verify --patch ./PATCH.md
```

Expected:
- Every required runtime is classified.
- Unknown versions/layouts fail closed.
- Verification is offline unless separately approved.

## Rollback

```bash
node /path/to/patchctl.mjs rollback --patch ./PATCH.md --confirm
```

- Rollback uses the apply receipt and refuses to overwrite drifted files.

## Operational notes

- Review the plan hash before apply.
- Apply with `patchctl apply --plan-hash <hash>`.
- Never silently reapply after a package update.
