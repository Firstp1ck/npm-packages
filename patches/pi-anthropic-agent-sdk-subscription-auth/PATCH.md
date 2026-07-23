# PATCH.md — Pi Anthropic compatibility component index

## Purpose

Replace the former monolithic subscription-auth patch with independently maintained lifecycle components and a separately distributed recovery extension package.

### Root cause

The old document mixed provider dist mutation, warning/docs copy, WebUI behavior, and recovery automation across dozens of absolute package paths.

### Expected outcome

Provider compatibility and warning ownership can evolve as independent patch components, while recovery installation is handled by `@firstpick/pi-extension-anthropic-auth-recovery`. This index is read-only and reports whether its remaining patch components exist.

## Lifecycle

**Manifest:** `./patch.manifest.json`

## Scope (exact files changed)

Files or logical targets:
1. `component:provider-dist-compat`
2. `component:warning-policy`

## Change 1 — Extract provider dist compatibility

**File:** `component:provider-dist-compat`

### What was changed

Moved runtime discovery, semantic transformation, transactional application, offline capture, and rollback to `../pi-anthropic-provider-dist-compat/`.

### Why

Provider mutation has high risk and needs independent version gates and receipts.

## Change 2 — Retire warning-copy mutation

**File:** `component:warning-policy`

### What was changed

Moved warning ownership to the explicit no-op policy in `../pi-anthropic-warning-policy/`.

### Why

Installed docs and upstream warnings should not be coupled to an experimental compatibility shim.

## Verification steps

Run from `.`:

```bash
PATCHCTL="${HOME}/.pi/agent/skills/patch-md/scripts/patchctl.mjs"
node "$PATCHCTL" status --patch ./PATCH.md
node "$PATCHCTL" verify --patch ./PATCH.md
```

Expected:
- Both indexed component PATCH.md files exist.
- This index reports zero writes.
- Recovery is installed independently with `pi install npm:@firstpick/pi-extension-anthropic-auth-recovery` when needed.

## Rollback

```bash
printf '%s\n' 'Roll back the independently applied component receipt; this index performs no writes.'
```

- Component receipts remain independent.
- Removing the recovery package is handled through Pi package management, not this patch index.

## Operational notes

- Do not apply this index as a substitute for reviewing component plans.
- Provider live verification remains separately approved and potentially billable.
