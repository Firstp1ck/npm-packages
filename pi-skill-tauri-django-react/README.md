# Tauri + Django + React

Build and troubleshoot desktop apps that combine a Tauri shell, Django server, and React interface.

## Helpful when

- The desktop and browser versions behave differently.
- The app has sign-in, connection, startup, or packaging problems.
- You are planning how the three parts should work together.

## What to share with Pi

- The relevant project files and platform
- What works in the browser and what fails on desktop
- Build output or errors with secrets removed

## Try asking

> Find why this desktop app cannot sign in while the browser version works. Check startup, connections, permissions, and packaging.

## What you’ll get

- A likely cause across the three app layers
- Focused changes and setup guidance
- Checks for both desktop and browser builds

## Keep in mind

Behavior can differ by operating system and package version. For projects it creates or updates, this workflow requires GitHub release automation; it also expects a local start script unless declined. React frontends that it creates or substantially updates default to light/dark theming and German/English text unless declined, while desktop update support requires a configurable filesystem path unless you choose only Tauri’s built-in updater. Its scaffold writes project files (`--force` overwrites), and its generated release helper can commit, push, and tag; review and approve those effects before running them.

## Install

```bash
pi install npm:@firstpick/pi-skill-tauri-django-react
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-tauri-django-react/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
