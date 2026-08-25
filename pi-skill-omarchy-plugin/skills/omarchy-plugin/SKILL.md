---
name: omarchy-plugin
description: Develop, validate, troubleshoot, review, and prepare Omarchy Quattro plugins for Marketplace submission. Use for Omarchy plugin manifests, plugin kinds and QML entry points, cloned plugin development, lifecycle verification, namespacing, or publication readiness; not for unrelated Hyprland plugins, generic QML, or merely installing an existing plugin.
license: MIT
compatibility: Portable Agent Skills-style skill. Static work needs JSON and text inspection; live lifecycle checks require an Omarchy Quattro environment and its optional validation tools.
---

# Omarchy Plugin

Guide an Omarchy Quattro plugin from a clearly chosen shell contract to a validated, reviewable repository and Marketplace-ready submission. The official development and publishing guides are the primary product sources. Re-check the official Omarchy shell/plugin reference before relying on a runtime detail because Quattro contracts can evolve.

## When to Use

Use for requests to:

- design or implement an Omarchy Quattro plugin;
- select a plugin kind and matching QML entry point;
- review or troubleshoot a plugin manifest, QML lifecycle, or repository;
- validate a plugin folder or assess Marketplace readiness;
- prepare publication files or submission content without submitting it.

Do not route here for unrelated Hyprland plugins, generic QML work with no Omarchy plugin contract, or a request that only installs an existing plugin.

## Inputs

Establish the intended behavior, plugin kind, interaction pattern, working folder, current manifest and QML files, dependencies or commands, target namespace, and whether the user has authorized runtime or external side effects. Ask for missing code or diagnostics rather than inventing them.

## Ordered Decision Workflow

Follow these decisions in order. Do not skip ahead from an uncertain contract to implementation or publication.

1. **Set the safety and authorization boundary**
   - Treat inspection, source review, manifest parsing, path checks, and static validation as the default.
   - Omarchy plugins execute **unsandboxed with the user's permissions inside the shared, long-running shell process**. Review every dependency, executable, installer, network call, and shell command before use; avoid unnecessary privileges.
   - A plugin must use the existing shell. **Never start a second Quickshell process for a plugin.**
   - Obtain the user's explicit confirmation before cloning when it will enable or replace an active component, enabling, disabling, restarting, rescanning when it changes runtime state, removing, installing, pushing a repository, opening or submitting an issue, publishing, or causing any other external side effect not already authorized.
   - Completion: the proposed next action is read-only, already authorized, or paused for confirmation.

2. **Choose one plugin contract**
   - Match the behavior to one or more supported kinds and make every declared kind agree with its `entryPoints` key and file.
   - A panel loaded internally by a bar widget is part of that `bar-widget`; do not declare a second `panel` kind unless Omarchy must load a standalone panel entry point.
   - Prefer a built-in plugin with the same kind and interaction pattern as the structural reference. Do not copy its identity or assume a superficially similar component has the same lifecycle.
   - Completion: kinds, entry-point keys, filenames, and nested-component ownership are explicit.

3. **Choose a user-owned development workflow**
   - Work under `$HOME/.config/omarchy/plugins/<development-id>/`, never in packaged Omarchy source.
   - `omarchy plugin clone` is not read-only: the official guide says it discovers and enables the copy and can replace the cloned built-in immediately. Describe that consequence and get explicit confirmation before running it unless the user already authorized it.
   - Keep the exact clone-generated ID and `omarchy.clonedFrom` while developing. Read [references/DEVELOPMENT-WORKFLOW.md](references/DEVELOPMENT-WORKFLOW.md) before proposing clone or runtime commands.
   - Completion: edits target a user-owned ordinary directory and the clone consequence is authorized.

4. **Define and implement the manifest/QML agreement**
   - Require a root `manifest.json` with valid `schemaVersion`, `id`, `name`, `version`, `author`, `description`, `kinds`, and `entryPoints`; include kind-specific metadata and license where applicable.
   - Entry points must be safe relative paths with exact filename capitalization, and referenced files must exist. Plugin trees must contain **no symlinks**.
   - Keep a consistent module identity across related QML files. For a bar widget with an internal panel, the bar entry point loads the panel and forwards the open/close state and lifecycle expected by Quattro.
   - Completion: the manifest and QML expose one coherent runtime contract.

5. **Validate statically before runtime checks**
   - Parse JSON, inspect the file tree, reject symlinks, check required fields, check kind/entry-point agreement, confirm every referenced file, and review dependencies and commands.
   - When available, use `omarchy plugin validate <folder>` and lint all QML entry points and nested QML with `qmllint` against the installed shell imports. These checks inspect code; they do not prove runtime safety.
   - Do not claim a tool passed when it is unavailable or was not run. Record exact omissions.
   - Completion: static findings are fixed or reported with command evidence and limitations.

6. **Verify the runtime lifecycle only with authorization**
   - In an authorized Omarchy Quattro session, verify discovery, enabled state, appearance, interaction, shell open/close routes where relevant, Escape behavior, disable/re-enable, shell restart, and removal/restoration behavior.
   - Exercise the plugin through the existing Omarchy shell; never launch another Quickshell instance. Inspect shell logs on failures and distinguish manifest discovery errors from QML lifecycle errors.
   - Runtime disable, re-enable, restart, and removal are state changes and require existing authorization or a fresh explicit confirmation.
   - Completion: lifecycle outcomes and any environment-dependent omissions are recorded.

7. **Replace development identity with permanent identity**
   - Before sharing, choose a stable namespace controlled by the author, update the manifest and all matching module/routing identifiers consistently, and remove clone-only `omarchy.clonedFrom` metadata.
   - Third-party plugin IDs **must not use the reserved `omarchy.*` namespace**. Do not reuse upstream placeholder IDs, authors, repository URLs, or descriptions.
   - Re-run static checks and any authorized lifecycle checks after renaming.
   - Completion: one permanent ID is used everywhere and no clone-only identity remains.

8. **Prepare, review, and stop at the publication boundary**
   - Read [references/PUBLISHING-CHECKLIST.md](references/PUBLISHING-CHECKLIST.md). Prepare a public-repository-ready root manifest, README, license, safe install/removal guidance, and optional preview.
   - Review all code, assets, dependencies, setup steps, services, privileges, installers, network use, and remote builds. Marketplace validation checks listing structure, **not plugin security**.
   - Validate the exact commit intended for submission and prepare the repository link, category, and tags.
   - Stop before making the repository public, pushing, opening the Marketplace issue form, submitting an issue, or publishing unless that specific external side effect is already authorized or the user explicitly confirms it.
   - Completion: readiness is evidence-backed and no unauthorized external action occurred.

## Output Contract

Report:

- selected kind(s), entry point(s), and nested-component decision;
- manifest, path, symlink, QML, dependency, and command-review findings;
- static commands and exit results;
- authorized runtime lifecycle evidence and omitted checks;
- permanent namespace and repository-readiness findings;
- requested confirmation or the exact publication boundary where work stopped;
- residual risk, especially that unsandboxed source remains the author and user's responsibility.

Never describe Marketplace acceptance, plugin safety, or runtime compatibility as verified without corresponding evidence.

## Pi Adapter

- In Pi, use the available file-reading, editing, and command tools for bounded inspection and validation, following the active repository instructions.
- Prefer read-only diagnostics. Ask before any runtime or external side effect not already authorized.
- Do not install or enable this skill, change Pi settings, or modify Omarchy, Quickshell, or Hyprland state merely because this skill was loaded.

## References

- [Development workflow](references/DEVELOPMENT-WORKFLOW.md) — plugin contracts, user-owned cloning, manifest/QML checks, and lifecycle verification.
- [Publishing checklist](references/PUBLISHING-CHECKLIST.md) — permanent identity, repository safety, and Marketplace readiness.
- Official development guide: <https://omarchyplugins.com/develop.html>
- Official publishing guide: <https://omarchyplugins.com/publish.html>
