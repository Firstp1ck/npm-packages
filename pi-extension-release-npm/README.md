# Release npm for Pi

Guides this workspace’s npm release process and asks before publishing.

## What you can do

- Finds packages that are ready to release.
- Plans and checks required version updates.
- Runs package readiness checks before publishing.
- Requires confirmation before anything is published.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-release-npm
```

Restart Pi if the package does not appear in your current session.

## How to use it

1. Run `/release-npm-setup` once if npm publishing is not configured.
2. Run `/release-npm` to find release candidates and perform the checks.
3. Review the package list, planned versions, and any failures.
4. Confirm publishing only when the plan is correct.

Useful controls:

- `/release-toggle` — switch between the short and detailed progress view.
- `/release-abort` — stop the active release.
- `/release-npm-logs` — open a saved release report.

The exact workspace layout, release scripts, and publishing rules are documented in the technical reference.

## Before you start

This extension is designed for the package workspace described in the technical reference. Run the planning form first; publishing always requires confirmation.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-release-npm/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
