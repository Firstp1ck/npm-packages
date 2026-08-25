# Omarchy Quattro plugin development workflow

Use this reference after the top-level skill selects the development path. It condenses the official [development guide](https://omarchyplugins.com/develop.html) (marked stable and updated 13 August 2026 when this reference was written). Re-check that guide and the official Omarchy shell/plugin reference before implementation; the shell reference is authoritative for the current runtime contract.

## Safety preflight

An Omarchy plugin is not an isolated application. It runs unsandboxed with the user's permissions in the shared, long-running Omarchy shell process. A crash, blocking operation, unsafe command, or conflicting global state can affect the shell and every loaded plugin.

Before editing or running anything:

- inventory QML/JavaScript imports, executables, dependencies, installers, services, privileges, file writes, network calls, and remote build steps;
- inspect every proposed dependency and command; do not execute opaque install snippets;
- avoid unnecessary privileges and never put credentials in the repository;
- use the already-running shell and **never start a second Quickshell process**;
- reject any plugin tree containing a symlink;
- separate read-only/static checks from actions that mutate the running shell;
- get explicit confirmation for clone, install, enable, disable, rescan with runtime impact, restart, removal, or any other runtime change unless that exact action is already authorized.

## 1. Select the kind and entry point

Choose by runtime behavior, not by a preferred filename. Each declared kind needs the corresponding key in `entryPoints`, and the path must resolve to an ordinary file inside the plugin repository.

| Plugin kind | `entryPoints` key | Conventional entry file | Runtime role |
| --- | --- | --- | --- |
| `bar-widget` | `barWidget` | `BarWidget.qml` | Item in the active bar |
| `panel` | `panel` | `Panel.qml` | Standalone floating surface |
| `overlay` | `overlay` | `Overlay.qml` | Fullscreen surface |
| `menu` | `menu` | `Menu.qml` | Summoned menu |
| `service` | `service` | `Service.qml` | Headless singleton |
| `bar` | `bar` | `Bar.qml` | Full bar replacement |

Use a built-in example only when its kind and interaction pattern match. Preserve the structural contract, not the example's identity, content, author, or description.

### Nested panel decision

A details panel loaded by a bar widget is not automatically a standalone `panel` plugin kind. In that pattern:

- the manifest declares `bar-widget` and maps `entryPoints.barWidget` to the bar entry file;
- the bar entry file loads the panel with a relative URL;
- both QML files use the same module identity;
- the bar entry point forwards `opened` and the open/close/toggle lifecycle expected by the shell;
- the panel receives its bar, anchor, and host context from the entry point;
- Escape and panel-switch behavior are connected through the current Quattro panel contract.

Declare a separate `panel` kind only when Omarchy itself must load a standalone `entryPoints.panel`. Re-check the current shell reference rather than copying lifecycle code from an outdated example.

## 2. Work in a user-owned clone

The intended workspace is an ordinary directory beneath:

```text
$HOME/.config/omarchy/plugins/<development-id>/
```

Never edit packaged Omarchy source. Choose a built-in plugin with the same contract, then explain the clone's consequence before asking to run it:

```bash
omarchy plugin clone <matching-built-in-id> --edit
```

This command is a runtime side effect: according to the official development guide, it creates a user-owned copy, discovers and enables it, and may immediately replace the cloned built-in in the active UI. Run it only after specific authorization. Use the exact ID the command prints; do not assume the placeholder in an example.

During development:

- keep the clone-generated ID consistently in the folder, manifest, module names, and shell commands;
- retain the clone-generated `omarchy.clonedFrom` value so disabling or removing the clone can restore the built-in;
- edit only the user-owned copy;
- account for automatic reload on save;
- do not force discovery or restart merely as a routine first step.

## 3. Establish the manifest contract

A Marketplace-oriented root `manifest.json` requires these core fields:

| Field | Check |
| --- | --- |
| `schemaVersion` | Supported manifest contract version; the cited guides use `1` |
| `id` | Unique development ID now, permanent controlled namespace before sharing |
| `name` | Human-readable, not copied placeholder identity |
| `version` | Current release value; publishing guide says Marketplace display accepts up to 64 characters |
| `author` | Actual plugin author |
| `description` | Short, accurate behavior summary |
| `kinds` | Non-empty supported capabilities |
| `entryPoints` | Matching key and safe relative QML path for every declared kind |

Add kind-specific metadata required by the current shell contract. Record the plugin's license where the contract supports it, and include a repository-root license before Marketplace submission.

Agreement checks:

1. Parse JSON without comments or trailing commas.
2. Confirm every kind maps to its exact entry-point key.
3. Confirm every entry path is relative, remains inside the plugin root, matches case on disk, and names an ordinary file.
4. Confirm the tree contains no symlinks, including assets and nested directories.
5. Reject `omarchy.*` for third-party IDs; that namespace is reserved.
6. Confirm manifest ID, QML module identity, IPC/routing names, documentation, and commands all agree.
7. Retain `omarchy.clonedFrom` only for the development clone; remove it when adopting the permanent independent identity.

## 4. Review implementation before execution

Trace each declared entry point and any nested imports. Check:

- lifecycle methods and visible/open state are available where Quattro routes interaction or shell commands;
- loaders handle unavailable items and inject required host context after loading;
- click, keyboard, Escape, focus, and panel-switch paths are explicit where applicable;
- timers, processes, sockets, file watchers, and subscriptions have bounded work and cleanup;
- synchronous work cannot block the shared shell;
- process arguments and external input are validated rather than interpolated into a shell command;
- errors fail locally and do not destabilize global shell state;
- dependency, permission, setup, service, installer, network, and build requirements are documented.

## 5. Run read-only static checks

Set paths from actual values rather than copying a placeholder:

```bash
PLUGIN_ID="<exact-development-id>"
PLUGIN_DIR="$HOME/.config/omarchy/plugins/$PLUGIN_ID"
```

Then run only available checks and record their exit codes:

```bash
python3 -m json.tool "$PLUGIN_DIR/manifest.json" >/dev/null
find "$PLUGIN_DIR" -type l -print
omarchy plugin validate "$PLUGIN_DIR"
qmllint -I "$OMARCHY_PATH/shell" \
  "$PLUGIN_DIR/<entry-point>.qml" "$PLUGIN_DIR/<nested-component>.qml"
```

Interpretation:

- `json.tool` must parse successfully.
- `find` must print nothing; any output is a validation failure, not a candidate to follow or package.
- `omarchy plugin validate` should accept the manifest and repository layout.
- `qmllint` should cover every entry point and relevant nested QML file with the installed shell imports.

Also inspect paths and manifest agreement directly; tool success does not replace source review. If `python3`, `omarchy`, `qmllint`, or the shell import path is unavailable, mark that check not run and do not infer success.

## 6. Run authorized lifecycle checks

First perform read-only inspection where available:

```bash
omarchy plugin list --json
```

Confirm the exact ID, declared kinds, and enabled state. Any next command that opens, closes, enables, disables, rescans, restarts, or removes a component changes runtime state and needs existing authorization or fresh explicit confirmation.

For an authorized interactive test, verify the behaviors relevant to the chosen kind:

1. discovered and listed under the exact ID;
2. loads and appears in the intended location;
3. primary pointer and keyboard interactions work;
4. shell summon/open and hide/close routes work, if exposed;
5. Escape closes a panel and focus returns correctly;
6. repeated open/close and panel switching do not leave stale state;
7. disable and re-enable cleanly;
8. shell restart loads cleanly without duplicate processes or state;
9. removal restores expected built-in behavior for a development clone.

The official bar-widget example uses the existing shell routes below, but use them only when they match the plugin contract and are authorized:

```bash
omarchy-shell shell summon "$PLUGIN_ID" '{}'
omarchy-shell shell hide "$PLUGIN_ID"
```

On failure, distinguish:

- missing folder or wrong ID;
- manifest path/capitalization mismatch;
- plugin validates but discovery is stale;
- plugin is listed but QML fails to load;
- nested panel state or lifecycle is not forwarded.

Inspect a bounded portion of existing shell logs when authorized. Do not launch another shell instance to obtain diagnostics.

## 7. Adopt the permanent identity

After development and before repository preparation:

- choose a stable reverse-domain or forge-based namespace the author controls, such as `io.github.<account>.<plugin>`;
- never use the reserved third-party-forbidden `omarchy.*` prefix;
- update folder/repository expectations, manifest ID, QML module identity, IPC/routing identifiers, README commands, and tests together;
- remove clone-only `omarchy.clonedFrom` metadata;
- search for the old development ID and all upstream placeholder identity;
- repeat static validation and, when authorized, lifecycle validation.

Continue with [PUBLISHING-CHECKLIST.md](PUBLISHING-CHECKLIST.md). Renaming files, moving code to a repository, committing, pushing, changing repository visibility, and submitting are separate actions; do not silently treat preparation as authorization for external effects.
