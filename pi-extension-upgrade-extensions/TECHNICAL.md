# Technical reference: Upgrade Extensions for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-extension-upgrade-extensions
```

## Requirements

The updater currently supports only string-form `npm:<package>` entries in Pi settings. Local folders, development links, object-form package entries, and other non-string/non-npm entries are not supported.

You need:

- npm available on the system;
- network access to the npm registry;
- permission for Pi to update selected packages; and
- registered package entries in Pi settings, normally `~/.pi/agent/settings.json`.

## Commands

- `/extensions-update` — check for updates and choose packages interactively.
- `/extensions-update all` — update every outdated npm package found by the check.

Selector controls:

| Key | Action |
| --- | --- |
| `Space` | Select or clear the current package |
| `a` | Select all or clear all |
| `Enter` | Start the selected updates |
| `Escape` | Cancel |
| Arrow keys or `j`/`k` | Move through the list |

## Update behavior

The extension compares installed package versions with npm, displays the available changes, and updates only the packages you confirm. After successful updates, it may offer to reload Pi.

Use the interactive command when you want to review each package. Use `all` only when you intentionally want every available update.

## Limitations

- It does not update packages installed from local paths or links, or npm packages stored as object-form settings entries.
- Registry or authentication failures are reported per package.
- Updating a package does not guarantee compatibility with unrelated local customizations.
- Running Pi sessions may need a reload or restart before new package code is active.
