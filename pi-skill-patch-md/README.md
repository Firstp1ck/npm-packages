# @firstpick/pi-skill-patch-md

A Pi skill and local runner for versioned patch lifecycle packages.

## Lifecycle

```bash
PATCHCTL=skills/patch-md/scripts/patchctl.mjs
node "$PATCHCTL" status   --patch /path/to/PATCH.md
node "$PATCHCTL" plan     --patch /path/to/PATCH.md
node "$PATCHCTL" apply    --patch /path/to/PATCH.md --plan-hash <reviewed-hash>
node "$PATCHCTL" verify   --patch /path/to/PATCH.md
node "$PATCHCTL" rollback --patch /path/to/PATCH.md --confirm
```

Schema v2 adds:

- a machine-readable `patch.manifest.json`;
- deterministic plan hashes;
- runtime/package discovery;
- semantic fingerprints and fail-closed version handling;
- idempotent, transactional application;
- offline verification and receipt-based rollback.

Legacy prose-only documents may be read with `patch_md_extract.mjs --no-strict` for migration, but cannot be trusted for apply.

## Native approval dialog

The package also registers the `patch_apply_with_approval` tool. After an agent reviews a fresh `patchctl plan`, it can call this tool with the `PATCH.md` path and exact plan hash.

The tool:

1. recomputes the plan and rejects stale or blocked hashes;
2. displays a native Pi confirmation dialog in TUI or WebUI RPC mode with the patch, targets, writes, risks, and exact hash;
3. refuses to apply without interactive confirmation;
4. invokes `patchctl apply` directly with argument vectors, never shell interpolation;
5. relies on `patchctl` to recompute the plan again immediately before transactional mutation.

Selecting **Yes** applies only that exact reviewed plan. Selecting **No**, **Cancel**, closing the dialog, or running without an interactive UI changes nothing. The tool does not install packages or run live-provider verification.

## Install

```bash
pi install npm:@firstpick/pi-skill-patch-md
```

## Test

```bash
npm test
```
