# Development guide: Tauri Django React

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `tauri-django-react` skill to Pi's skill library.
- Guides agents to invoke the skill for Tauri + Django + React desktop apps.
- Covers backend lifecycle, hybrid auth, frontend integration, local SQLite configuration, installer/update flows, packaging, and platform gotchas.
- Bundles `skills/tauri-django-react/SKILL.md` plus helper scripts used by the skill.

## Preserved advanced implementation details

A Pi skill for Tauri + Django + React desktop apps, especially backend lifecycle, CORS/auth, frontend integration, local-first desktop patterns, build packaging, updates, and platform-specific gotchas.

## Install

```bash
pi install npm:@firstpick/pi-skill-tauri-django-react
```

## Configuration

No required configuration.

## Expected project structure

The skill targets projects that combine Tauri, Django, and React. The exact layout can vary, but the included examples and helper scripts assume a project root with separate backend, frontend, and Tauri areas.

Typical layout:

```text
project-root/
  backend/
    manage.py
    tauri_entry.py
    pyinstaller.spec
  frontend/
    package.json
    src/
  src-tauri/
    tauri.conf.json
    Cargo.toml
  scripts/
    start.sh
    build-backend.sh
    build-backend.ps1
    release.sh
  .github/workflows/
    release.yml
```

The skill package also bundles helper scripts relative to the installed skill directory:

```text
skills/tauri-django-react/
  SKILL.md
  scripts/
    scaffold.py
    validate.py
```

Manual usage example:

```bash
python3 /path/to/installed/package/skills/tauri-django-react/scripts/validate.py \
  --project-root /path/to/project \
  --format json
```

The generated or validated project usually needs standard toolchains installed separately: Python/Django dependencies, Node frontend dependencies, Rust/Cargo, Tauri CLI, PyInstaller, and optionally Waitress for packaged backends.

## Helper interfaces

The package exposes no top-level CLI or model tool. The bundled `scaffold.py` and `validate.py` command-line helpers are contributor/project-generation entry points documented above.

## Example view

```text
User: Validate this Tauri, Django, and React project’s startup, authentication, build, release, and updater integration without changing files.
Agent: Runs the validation helper and maps failures to the affected application layer.
```
