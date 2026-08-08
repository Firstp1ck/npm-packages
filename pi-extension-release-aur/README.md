# Release AUR for Pi

Guides AUR setup, review, and publishing with explicit safety checks and confirmation.

## What you can do

- Guides initial AUR publishing setup.
- Checks package metadata and build readiness.
- Supports optional clean-build and reproducibility checks.
- Separates planning from publishing and always asks before release.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-release-aur
```

Restart Pi if the package does not appear in your current session.

## How to use it

1. Run `/release-aur-setup` once to review your local AUR setup.
2. Run `/release-aur` to create a release plan and run checks.
3. Review the result and correct any failed checks.
4. Run `/release-aur publish` only when you are ready to publish.

Nothing is published without explicit confirmation. Advanced target, chroot, reproducibility, and package-creation options are in the technical reference.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-release-aur/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
