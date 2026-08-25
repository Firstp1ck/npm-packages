# Omarchy Plugin

Develop, validate, review, and prepare Omarchy Quattro plugins with a safety-first workflow grounded in the official authoring guides.

## Helpful when

- You are choosing an Omarchy plugin kind, manifest entry point, and QML lifecycle.
- You want to review or troubleshoot a plugin before changing the running shell.
- You are preparing a plugin repository and Marketplace submission material without submitting it yet.

## What to share with Pi

- The behavior you want, the intended plugin kind, and how users should interact with it.
- The plugin folder or its manifest, QML files, assets, dependencies, commands, and current diagnostics.
- The namespace you control and whether you authorize any runtime changes or external publication steps.

## Try asking

> Review this Omarchy Quattro bar-widget plugin and its nested panel. Check its manifest, QML lifecycle, dependencies, namespace, and Marketplace readiness, but do not enable, restart, push, or submit anything.

## What you'll get

- A clear kind, entry-point, and nested-component decision.
- Static validation and safety findings with exact checks, omissions, and residual risks.
- Repository and submission-readiness guidance that stops before unauthorized external actions.

## Keep in mind

Omarchy plugins run unsandboxed with your permissions inside the shared, long-running shell process. Review all source, dependencies, and commands. The skill defaults to read-only inspection and asks before runtime changes, repository pushes, issue submission, publication, or other external side effects.

## Install

When this package is available from npm, install it with:

```bash
pi install npm:@firstpick/pi-skill-omarchy-plugin
```

Installing the skill does not install, enable, or submit an Omarchy plugin.

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for advanced usage, requirements, safety behavior, compatibility, and limitations.
