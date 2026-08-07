# Technical reference: Skill Lifecycle for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-package-skill-lifecycle
```

## Included workflows

The package combines related skill-management capabilities:

- per-skill memory for reusable local observations;
- skill-bank inventory and cleanup planning;
- skill package evaluation;
- drafting reusable skills from repeated workflows; and
- refinement proposals based on failed runs or corrections.

The normal lifecycle is:

```text
remember → audit → evaluate → create → refine
```

Broader troubleshooting notes belong in `@firstpick/pi-package-learnings`. General source-patch packaging belongs in `@firstpick/pi-skill-patch-md`.

## Safety

Generated skill drafts remain disabled until separately reviewed and enabled. Audits and refinement runs produce reports or proposals rather than deleting skills, changing production behavior, publishing packages, or pruning links automatically.

Do not place API keys, credentials, private user data, or tokens in per-skill memory.

## Troubleshooting

- Ask Pi to evaluate a draft before enabling it.
- Use the skill-bank audit when two skills appear to cover the same work.
- Use a refinement proposal after a real skill failure or user correction, not for an ordinary application bug.
- Review every proposed package or settings change separately.
