# Technical reference: Omarchy Plugin

Advanced user information for the `omarchy-plugin` skill.

[Back to README](README.md) · [Contributor guide](DEVELOPMENT.md)

## Scope and routing

Use this skill for Omarchy Quattro plugin authoring, validation, troubleshooting, source review, and Marketplace preparation. It covers manifest and QML agreement, user-owned development copies, runtime lifecycle evidence, permanent namespacing, repository readiness, and preparation of submission material.

It is not the right workflow for:

- unrelated Hyprland plugins;
- generic QML work with no Omarchy plugin contract; or
- a request that only installs an existing plugin.

## Requirements

Static review needs the plugin source plus JSON and text inspection. Depending on the requested depth, useful optional tools are:

- `omarchy plugin validate` for manifest and repository-layout checks;
- `qmllint` with the installed Omarchy shell imports for QML checks;
- `omarchy plugin list --json` for read-only inspection of discovered plugins; and
- a running Omarchy Quattro session for interaction and lifecycle checks.

The skill records unavailable tools and omitted checks rather than treating them as passes. Re-check the [official development guide](https://omarchyplugins.com/develop.html), [official publishing guide](https://omarchyplugins.com/publish.html), and current official shell/plugin reference before relying on runtime or submission requirements.

## Development workspace

Develop in a user-owned ordinary directory beneath:

```text
$HOME/.config/omarchy/plugins/<development-id>/
```

Do not edit packaged Omarchy source. A clone created with `omarchy plugin clone` is not a read-only copy operation: it is discovered and enabled and can immediately replace the cloned built-in in the active interface. The skill explains that consequence and requires existing authorization or explicit confirmation before running the command.

Keep the clone-generated ID and clone metadata during development. Before sharing, adopt a stable namespace controlled by the author, update matching identifiers consistently, remove clone-only metadata, and validate again. Third-party plugin IDs cannot use the reserved `omarchy.*` namespace.

## Validation levels

### Read-only and static checks

The default workflow can:

- parse the root manifest;
- compare each declared kind with its entry-point key and file;
- reject unsafe paths, filename-capitalization mismatches, missing files, and symlinks;
- inspect QML lifecycle and nested-component ownership;
- review dependencies, executables, installers, services, privileges, network access, and commands; and
- run available static validators without changing the active shell.

A details panel loaded internally by a bar widget normally remains part of the `bar-widget` contract. It needs a separate `panel` kind only when Omarchy must load it as a standalone panel entry point.

### Runtime checks

Runtime checks may cover discovery, appearance, pointer and keyboard interaction, open/close routes, Escape behavior, repeated use, disable/re-enable, shell restart, and removal/restoration. Enable, disable, rescan with runtime impact, restart, removal, and similar lifecycle operations change state. The skill performs them only when already authorized or after explicit confirmation.

A plugin must use the existing Omarchy shell. Never start another Quickshell process to test or troubleshoot it.

## Safety and publication boundary

Plugins execute unsandboxed with your permissions in the shared shell process. Static validation and Marketplace listing checks do not establish that source code is secure. Review the complete repository, including assets, dependencies, setup steps, command execution, services, privileges, network behavior, and remote builds.

The skill can prepare repository files, a validation summary, category, tags, and Marketplace submission text. Unless already authorized, it stops before creating or making a remote repository public, pushing code or tags, opening or submitting an issue, or publishing a release. Preparation does not imply permission to submit.

## Compatibility and limitations

- Runtime contracts and Marketplace requirements can change after this package release; live official documentation remains authoritative.
- Static checks cannot prove arbitrary unsandboxed plugin code is safe or compatible at runtime.
- Live validation depends on an Omarchy Quattro environment and installed optional tools.
- Marketplace automation validates listing structure, not plugin security, and maintainer approval remains separate.
- Installing this skill does not install, enable, disable, publish, or submit an Omarchy plugin.

## Troubleshooting

If a plugin is not discovered, first confirm its exact development ID, user-owned folder, manifest validity, kind/entry-point agreement, path capitalization, and symlink-free tree. If it is discovered but fails to load, inspect existing shell logs and QML diagnostics without launching a second shell process. If a nested panel opens incorrectly, verify that the entry point forwards the current Quattro open/close lifecycle and required host context.

Record the commands actually run, their exit results, the environment, and every omitted check. Do not report safety, compatibility, or Marketplace acceptance without matching evidence.
