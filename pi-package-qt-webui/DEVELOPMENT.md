# Development guide: Qt WebUI

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Architecture

`bin/qt-webui.mjs` is a thin executable wrapper around `lib/launcher.mjs`. The launcher resolves the package QML entry and the CLI declared by the dependency-local `@earendil-works/pi-coding-agent` manifest. It then spawns `quickshell` with an argument array, inherited stdio, `shell: false`, and the caller's working directory.

The Pi package exposes only import-conditioned exports, so the launcher resolves its public module with ESM resolution, walks to the matching package manifest, and uses a `createRequire` rooted there to confirm package identity. It reads the `bin.pi` declaration instead of assuming a dependency layout or searching `PATH`.

Quickshell owns the QML application process. The QML bridge owns the Pi child and starts Node with the resolved Pi CLI entry followed by `--mode rpc`. This keeps Pi's lifecycle coupled to the window and avoids a network transport.

`qml/Theme.qml` is the only palette owner. The launcher reads the XDG desktop portal's `org.freedesktop.appearance` color scheme at startup and passes the normalized result to QML. The theme uses that result first and falls back to `Qt.styleHints.colorScheme` when the portal has no preference or cannot be read. `shell.qml`, `Composer.qml`, and `ChatMessage.qml` receive the shared semantic palette and contain no literal palette colors. Qt preference changes continue to retint the window when the portal fallback is active.

The visual root explicitly belongs to `FloatingWindow.contentItem`; objects placed only in the window's default `data` list are not rendered as window content. The backing surface is marked opaque and uses the selected semantic background.

## Launcher-to-QML environment contract

Only these launcher-owned values are passed with the `QT_WEBUI_` prefix:

| Name | Contract |
|---|---|
| `QT_WEBUI_CALLER_CWD` | Absolute caller working directory used for the Pi child. |
| `QT_WEBUI_QML_ENTRY` | Absolute selected `shell.qml` path. |
| `QT_WEBUI_NODE_EXECUTABLE` | Absolute Node.js executable used to start the Pi CLI module. |
| `QT_WEBUI_PI_CLI_ENTRY` | Absolute dependency-local Pi CLI module. |
| `QT_WEBUI_DEVELOPMENT_MODE` | `1` for `qt-webui dev`; otherwise `0`. |
| `QT_WEBUI_SYSTEM_COLOR_SCHEME` | Normalized XDG portal result: `dark`, `light`, or `unknown`. |

Before adding those six values, the launcher removes every inherited environment key whose name starts with `QT_WEBUI_`. This prevents caller-controlled variables from activating internal test behavior or overriding launcher-owned paths. The live smoke harness can add its fixture values, including a forced light or dark mode, only through an explicit launcher test seam; the installed `qt-webui` bin never reads that seam from the environment.

Path values must be non-empty, contain no NUL byte, and fit within 16 KiB when UTF-8 encoded. QML must pass the Node executable, Pi CLI entry, and `--mode rpc` as separate process arguments. It must not interpolate these values or prompt content into shell text.

Normal and development mode select the package's `qml/shell.qml`. Development mode deliberately adds no watcher: Quickshell's native configuration reload owns source reload behavior.

## Process and failure behavior

The launcher installs handlers for `SIGINT` and `SIGTERM` only while Quickshell is active and forwards either signal to that child. It removes handlers after an error or close event. Numeric child exit codes pass through; signal exits become the conventional `130` or `143` status when applicable.

A missing Quickshell executable and a missing or malformed package-local Pi CLI both become actionable stderr messages. The launcher never falls back to a global Pi command.

## Source layout

- `bin/` contains the npm executable.
- `lib/` contains launcher resolution and process management.
- `qml/` contains the Quickshell UI, shared semantic theme, and Pi RPC bridge.
- `tests/` contains Node contracts, fake executables, packed-install coverage, and QML checks.

## Validation

Run the focused suite and syntax checks:

```bash
npm test
node --check bin/qt-webui.mjs
node --check lib/launcher.mjs
```

Inspect the publication allowlist without creating a tarball:

```bash
npm pack --dry-run --json
```

`tests/packed-install.test.mjs` creates a tarball under a disposable temporary directory, installs it into a temporary prefix with `npm install --ignore-scripts`, adds that prefix's bin directory to `PATH`, invokes `qt-webui` by command name against the fake Quickshell fixture, and removes the directory. It must never install globally or publish the package.

The QML contract and smoke tests are discovered automatically by `tests/run-all.mjs` when their `*.test.mjs` files are present.

## Packaging

Keep `qml`, `bin`, `lib`, user documentation, contributor documentation, tests, and `LICENSE` in the package `files` allowlist. Generate `package-lock.json` with lifecycle scripts disabled:

```bash
npm install --package-lock-only --ignore-scripts
```

Do not publish or change Pi settings as part of repository validation.
