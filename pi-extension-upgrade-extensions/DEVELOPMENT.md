# Development guide: Upgrade Extensions for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Update flow

The extension reads `packages` from Pi’s agent settings as `string[]` and filters only values beginning with `npm:`. Object-form package entries, local paths, and links are currently unsupported; keep the advanced-user limitation synchronized with this parser behavior.

For each supported entry, the extension:

1. parses the npm package spec;
2. queries `npm view <package> version --json`;
3. compares the installed and registry versions;
4. presents outdated candidates in the selector or update-all path;
5. runs `pi install npm:<package>@latest` for confirmed candidates; and
6. offers a Pi reload after successful updates.

Update execution is sequential. Preserve per-package error reporting and do not broaden accepted settings shapes without adding normalization and tests.

## Important implementation points

- `getAgentSettingsPath()` resolves the active Pi settings file.
- `parseNpmSpec()` extracts package names and installed specifiers.
- `queryLatestVersion()` shells out to npm with bounded argument arrays.
- `runPackageUpdate()` delegates installation to the Pi CLI rather than mutating package storage directly.
- Selector state must remain stable while updates run and cancellation must perform no installs.

## Verification

```bash
node --experimental-strip-types --check index.ts
npm pack --dry-run --json
```
