# Technical reference: Release npm for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-extension-release-npm
```

## Authentication

Publishing requires an npm account and an access token with permission for the selected packages.

Run `/release-npm-setup`, paste the token into Pi’s private input, and let the setup verify the npm account. You can also configure npm authentication yourself before using the release command.

Never paste an npm token into a normal chat prompt or commit it to the repository.

## Workspace requirements

Run `/release-npm` from the package workspace root. Packages must be direct child folders and contain valid npm package information.

Release readiness expects:

- a valid package name, version, and license;
- a README;
- valid Pi extension entries when the package provides extensions; and
- the files referenced by the package metadata.

Nested package folders are not discovered.

## Commands

- `/release-npm-setup` — configure and verify npm authentication.
- `/release-npm` — find release candidates, run checks, and show a publish plan.
- `/release-toggle` — switch between compact and detailed progress.
- `/release-abort` — stop the current release.
- `/release-npm-logs` — open a saved release report.

## Release flow

1. The extension checks npm authentication.
2. It finds packages whose local versions differ from the registry.
3. It prepares version changes and runs package-readiness checks.
4. Pi shows the exact packages and versions that would be published.
5. You choose all, selected packages, or cancel.
6. Only the confirmed package list is published.

The release output stays visible while Pi remains usable. Reports are stored under `~/.pi/agent/release-npm-logs/`.

## Safety and limitations

- Nothing is published before confirmation.
- Failed checks remain visible and block unsafe candidates.
- The package list is fixed before confirmation instead of being rediscovered during publishing.
- This extension is designed for this repository’s package layout, not every possible npm workspace.
- Stopping a release may leave already published packages published; inspect the saved report before retrying.

## Troubleshooting

- Run `/release-npm-setup` again when npm authentication fails.
- Confirm that the current folder is the workspace root.
- Check package names and versions when a candidate is unexpectedly skipped.
- Open `/release-npm-logs` after a partial or failed run.
