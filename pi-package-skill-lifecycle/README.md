# @firstpick/pi-package-skill-lifecycle

Self-contained Pi package for skill lifecycle management.

## What is bundled

This package intentionally groups the skill-management tools that work together:

- `@firstpick/pi-extension-memory-helper` — daily memory plus per-skill memory tools.
- `vendor/pi-skill-skill-bank-manager` — read-only skill inventory, overlap, and prune/merge planning.
- `vendor/pi-skill-skill-evaluator` — SKILL.md quality gate, routing fixture checks, safety checks, and tests.
- `vendor/pi-skill-skill-creator` — disabled skill drafts from reusable workflows.
- `vendor/pi-skill-skill-refinement-loop` — per-skill memory plus PATCH.md-style refinement proposals from failures/corrections.
- `references/SKILL-LIFECYCLE-POLICY.md` — package-bundled lifecycle policy used directly by the lifecycle skills.

The component package resources are vendored under `vendor/` so this package can be published as one npm package without relying on sibling checkout paths. The package also exposes the evaluator CLI wrappers `skill_eval_run` and `skill_eval_all` through its root npm `bin` metadata.

These belong together because they implement the same lifecycle:

```text
remember → audit/manage → evaluate → create → refine
```

Related but not bundled by default:

- `@firstpick/pi-package-learnings` — broader troubleshooting archive, not skill-specific lifecycle infrastructure.
- `@firstpick/pi-skill-patch-md` — generic source patch documentation, useful but not required by the refinement-loop tool.

## Install

```bash
pi install npm:@firstpick/pi-package-skill-lifecycle
```

For local development only:

```bash
pi install ./pi-package-skill-lifecycle
```

## Production vs development fixtures

Repository-level `tests/routing/` fixtures are development/evaluation data. They are not needed for Pi runtime use and are not loaded by this package.

Production/package routing fixtures that a published skill needs should live inside that skill package, for example:

```text
skills/<skill-name>/tests/routing.json
skills/<skill-name>/references/
```

## Publishing note

This package is self-contained for the related skill lifecycle resources: component package contents are vendored under `vendor/`, the package-level policy is bundled under `references/`, and the `pi` manifest references the vendored Pi resources directly.

Before publishing this bundle, verify the packed tarball contains the referenced `vendor/...` resources. The vendored directories are the canonical publishable source for these lifecycle skills/tools; there are no separate top-level `pi-skill-skill-*` packages to publish. The only non-Pi-core runtime dependency is the published shared helper package `@firstpick/pi-utils`.

## Safety

All destructive lifecycle actions are plan-only by default. The bundle adds tools and skills, but it does not auto-enable generated drafts, delete skills, prune symlinks, or publish packages.
