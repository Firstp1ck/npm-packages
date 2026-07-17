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

## Install

```bash
pi install npm:@firstpick/pi-skill-patch-md
```

## Test

```bash
npm test
```
