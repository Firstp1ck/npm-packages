# Development guide: Release Aur for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Arch guidance encoded

This workflow follows these ArchWiki rules/guidance:

- AUR write access requires an SSH key pair; the public key must be added to the AUR account profile and the private key configured for `aur.archlinux.org`.
- A dedicated AUR SSH key is preferred over reusing an existing key so it can be revoked independently.
- AUR uploads should be reviewed carefully before submission.
- New AUR package repositories are initialized by cloning `ssh://aur@aur.archlinux.org/<pkgbase>.git`.
- `.SRCINFO` must be regenerated when `PKGBUILD` metadata changes.
- When upstream `pkgver` is bumped, `pkgrel` resets to `1` and checksum arrays must match the new sources.
- At least `PKGBUILD` and `.SRCINFO` must be committed and pushed.
- AUR accepts pushes to `master`.
- Package testing should include `makepkg`, package content inspection, dependency review, and `namcap` sanity checks.
- Reproducibility can be checked with `makerepropkg`/`repro` when feasible.

## Preserved package internals

`/release-aur` streams workflow output through Pi extension widgets using Web UI-compatible text payloads. In Pi Web UI, the companion renderer shows a scrollable AUR release card with phase, compact/expanded line counts, elapsed time, and `Toggle output`/`Abort` actions.
