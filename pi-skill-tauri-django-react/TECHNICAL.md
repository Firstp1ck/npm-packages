# Technical reference: Tauri + Django + React

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-skill-tauri-django-react
```

No skill-specific configuration is required.

## Expected project areas

The exact folder names may differ, but Pi needs to identify:

- the Django backend and its startup entry point;
- the React frontend and build settings;
- the Tauri configuration and Rust application shell;
- desktop packaging scripts; and
- any web-only deployment path.

A typical project keeps these as separate backend, frontend, and Tauri folders under one project root.

## Required toolchains

Projects normally need:

- Python and the Django dependencies;
- Node.js and the frontend dependencies;
- Rust and Cargo;
- the Tauri command-line tools; and
- a backend packager such as PyInstaller when Django ships with the desktop app.

Platform packaging may require additional operating-system tools.

## Important integration checks

- Confirm when and how the Django backend starts and stops.
- Keep desktop and web connection addresses separate.
- Review cross-origin and sign-in settings for both deployment modes.
- Ensure the packaged app can locate static files and the backend executable.
- Test light and dark appearance in both desktop and browser builds.
- Verify updates and application shutdown do not leave backend processes running.

## Troubleshooting

When desktop behavior differs from the browser, provide Pi with the operating system, build mode, relevant startup output, and the matching backend/frontend configuration. Avoid sharing secrets from environment files or signing configuration.

The contributor guide contains the packaged scaffold and validation helper details.
