# Development guide: Qt WebUI

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Architecture

Three processes cooperate:

1. **Launcher** (`bin/qt-webui.mjs`, `lib/launcher.mjs`) resolves the package QML entry, the backend entry, and the CLI declared by the dependency-local `@earendil-works/pi-coding-agent` manifest, then spawns `quickshell` with an argument array, inherited stdio, `shell: false`, and the caller's working directory.
2. **Quickshell** owns the QML application. `qml/BackendBridge.qml` starts the backend with `QT_WEBUI_NODE_EXECUTABLE` and `QT_WEBUI_BACKEND_ENTRY`, writes protocol requests to its stdin, and reduces its events into QML state. QML never parses a raw Pi record and never starts Pi.
3. **Backend** (`lib/backend/main.mjs`) owns the Pi RPC child, translates Pi records into bounded typed events, renders Markdown, stores settings, sends notifications, opens links, and reaps its whole process tree on shutdown.

The Pi package exposes only import-conditioned exports, so the launcher resolves its public module with ESM resolution, walks to the matching package manifest, and uses a `createRequire` rooted there to confirm package identity. It reads the `bin.pi` declaration instead of assuming a dependency layout or searching `PATH`.

### Backend modules

| Module | Responsibility |
|---|---|
| `lib/backend/protocol.mjs` | Protocol version, every numeric limit, request validation, frame constructors, link scheme policy. |
| `lib/backend/jsonl.mjs` | LF-only JSONL reader with a per-frame byte cap; oversized frames are discarded without buffering. Node `readline` is not used because it also splits on U+2028/U+2029. |
| `lib/backend/pi-session.mjs` | Pi child ownership and the state machine ported from the former `PiBridge.qml`: startup readiness, prompt acceptance and reconciliation, abort-before-start, provider errors, restart, message parts, tool lifecycle, extension dialogs. |
| `lib/backend/markdown.mjs` | Bounded Markdown-to-blocks renderer producing whitelisted Qt StyledText. |
| `lib/backend/settings.mjs` | XDG settings store with validation, 0700/0600 permissions, and atomic replace. |
| `lib/backend/process-tree.mjs` | Detached process-group spawn, SIGTERM→SIGKILL escalation, synchronous kill for fatal paths. |
| `lib/backend/desktop.mjs` | `notify-send` and `xdg-open` wrappers using argument arrays only. |

## Backend protocol (version 1)

Frames are JSON objects terminated by `\n`. Every frame carries `v: 1`. Requests flow from QML to the backend; the backend answers each request exactly once by `id` and emits unsolicited events with a monotonically increasing `seq`.

Request: `{"v":1,"id":"q-7","type":"prompt","message":"…","mode":"send"}`
Response: `{"v":1,"kind":"response","id":"q-7","ok":true,"data":{…}}` or `{"v":1,"kind":"response","id":"q-7","ok":false,"error":{"code":"busy","message":"…"}}`
Event: `{"v":1,"kind":"event","seq":42,"type":"part.render",…}`

Event payloads must not use the reserved frame keys `v`, `kind`, `type`, or `id`; `makeEvent` throws otherwise (this caught the `part.begin` `kind` collision during development).

### Requests

| Type | Fields | Result |
|---|---|---|
| `hello` | — | protocol version, backend pid, cwd, limits, session snapshot, settings, queue stats |
| `prompt` | `message`, `mode` (`send`, `steer`, `followUp`) | `{mode, messageId}` after Pi accepts; `busy` while a `send` is active; `pi_error` when Pi rejects |
| `abort` | — | `null`; `not_running` when idle |
| `state` | — | runtime metadata from `get_state` |
| `restart` | — | terminates the Pi tree and starts a new child |
| `extension_response` | `requestId` plus exactly one of `value`, `confirmed`, `cancelled` | echoes the answer; `stale_request` if not pending; `invalid_request` for a value outside the offered options or a wrong shape |
| `settings_get` / `settings_set` | `values` object with schema-checked keys | current settings and file path |
| `open_link` | `url` | `xdg-open` result; rejected for disallowed schemes |
| `notify` | `title`, `body` | `notify-send` result |
| `shutdown` | — | graceful shutdown, exit 0 |
| `debug_crash` | — | smoke mode only: raises an uncaught exception to exercise the fatal path |

Error codes: `invalid_request`, `unsupported_version`, `unknown_request`, `limit_exceeded`, `duplicate_request`, `busy`, `not_ready`, `not_running`, `pi_error`, `stale_request`, `timeout`, `rejected`, `internal_error`.

### Events

`backend.ready`, `backend.closing`, `backend.fatal`, `backend.backpressure`, `events.dropped`, `notice`, `settings.changed`, `pi.started`, `pi.status` (`statusKind`, `text`, `ready`, `active`), `pi.error` (empty message clears), `pi.runtime`, `pi.exit`, `message.user`, `message.begin`, `part.begin` (`partKind` `text` or `thinking`), `part.render` (`text`, `blocks` for text parts, `final`, `truncated`), `part.remove`, `message.end`, `tool.start` (`summary` is a bounded plain-text argument digest), `tool.update`, `tool.end` (`ok`, `durationMs`, `output`, `error`), `run.start`, `run.end` (`ok`, `aborted`), `queue.update`, `extension.request`, `extension.answered`, `extension.cancelled`, `extension.notify`, `extension.status` (`key`, `text`, and `chips`: a `setStatus` whose text is a `firstpick.git-footer-status.footer` version 1 JSON payload becomes up to 18 bounded plain-text chips from its `main` and `meta` arrays; any other JSON object with a `type` becomes its `title` as `text` and `description` as `hint`; other text stays as `text`), `composer.setText`, `window.title`.

`part.render` is emitted at most every 80 ms per streaming part and once more with `final: true` after `message_end`, whose content is authoritative. Parts that streamed but are missing from the final message are removed.

### Limits

All numbers live in `LIMITS` in `lib/backend/protocol.mjs`; `tests/qml-contract.test.mjs` asserts the QML copies match.

| Budget | Value |
|---|---|
| Inbound / outbound frame | 256 KiB (Pi records: 4 MiB) |
| Outbound queue before backpressure | 4 MiB or 2,000 unflushed records |
| Pending requests (each direction) | 64; request ids ≤ 96 characters |
| Request timeouts | prompt 30 s, restart 20 s, abort/state 10 s, others 5 s; the client also enforces the same deadlines |
| Pi startup readiness | 15 s (`QT_WEBUI_PI_STARTUP_TIMEOUT_MS` test seam) |
| Prompt reconciliation | 150 ms after acceptance without `agent_start` |
| Shutdown grace | 3 s SIGTERM, then SIGKILL |
| Transcript | 80 rows, 8,192 characters per text/thinking part, 64 parts per message |
| Tool cards | 64-character name, 256-character summary, 4,096-character output |
| Errors / notices | 512 characters; runtime metadata 160 characters |
| Markdown | 8,192 input characters, 200 blocks, nesting depth 4, 50 table rows × 12 columns, 200 list items |
| Dialogs | 16 pending, 64 options × 256 characters, 256-character title, 4,096-character message, 16 KiB values |
| Settings file | 64 KiB |

### Slow consumers

Coalescable events (`part.render` before `final`, `tool.update`) are dropped while the outbound queue is over budget and reported later through `events.dropped`. Essential events are never dropped: when a write leaves the queue over budget the backend pauses the Pi child's stdout and resumes it on `drain`, emitting `backend.backpressure`. Node emits `drain` before invoking write callbacks, so the engagement condition is bytes-only and requires the write to have returned `false`.

## Markdown policy

`renderMarkdown` produces `heading`, `paragraph` (with `quote` flag), `code`, `listItem`, `table`, `rule`, and `notice` blocks. Inline text becomes StyledText built only from escaped text and the tags `<b>`, `<i>`, `<s>`, `<tt>`, `<br>`, and `<a href>`. Raw HTML is escaped, images become `[image: alt]` placeholders, and links keep only `http`, `https`, and `mailto` targets without credentials; other links stay as their literal Markdown. QML renders `styled` with `Text.StyledText`, code and tool output with read-only plain-text editors, and everything else as `Text.PlainText`. Link activation always goes through `LinkDialog` and then the backend's `open_link`.

## Lifecycle and process ownership

The backend spawns Pi with `detached: true` so Pi leads its own process group; `terminateProcessTree` signals the group, escalates to SIGKILL after the grace period, and sweeps the group again once the leader exits. Shutdown runs on stdin EOF (Quickshell exited), `SIGINT`, `SIGTERM`, `SIGHUP`, the `shutdown` request, and stdout `EPIPE`. Uncaught exceptions emit `backend.fatal`, kill the tree synchronously, and exit 70. A relative or missing Pi entry exits 64 before starting anything.

If the backend itself is killed with SIGKILL it cannot signal anything; Pi then sees EOF on stdin and is responsible for stopping its own tool processes, which the fixture models by terminating its grandchild on `end`. `tests/backend-lifecycle.test.mjs` proves each path with a fixture grandchild (`sleep 300`).

In QML, the bridge treats a backend exit as an error state, fails every pending request, cancels dialogs, and offers **Restart**, which starts a fresh backend. During `Qt.quit` the bridge sends `shutdown` first and stops the process after a short grace period.

## QML structure

- `qml/shell.qml` — window, header, search, transcript list with follow-output logic, queue strip, notices, composer, dialogs, and the smoke driver loader.
- `qml/BackendBridge.qml` — backend process, request correlation with client-side deadlines, event reduction, transcript `ListModel`, dialog queue, settings, notifications, clipboard.
- `qml/Theme.qml` — the only palette owner; semantic tokens for surfaces, status, code, quotes, tables, thinking, dialogs, focus, and search.
- `qml/components/` — `AppButton`, `StatusBadge`, `NoticeBar`, `Composer`, `SearchBar`, `EmptyState`, `TranscriptRow`, `MarkdownBlocks`, `ToolCard`.
- `qml/dialogs/` — `AppDialog` (modal, focus containment, Escape, focus return), `ExtensionDialog` (exactly-once answers), `LinkDialog`.
- `qml/SmokeDriver.qml` — loaded only when `QT_WEBUI_SMOKE_MODE=1`.

Transcript rows are flat: one row per user message, text part, thinking part, or tool call, keyed by `rowId`. Streaming updates call `ListModel.setProperty` on the affected row only; `MarkdownBlocks` re-parses that row's `blocksJson` and rebuilds its block delegates. Search runs over row text and tool output and highlights whole rows.

Every control has an accessible role and name; `AppButton` draws a focus ring and activates from the keyboard. Dialogs are `Popup`s with `modal: true`, `focus: true`, an explicit initial focus item, and focus return to the composer.

## Launcher-to-QML environment contract

Only these launcher-owned values are passed with the `QT_WEBUI_` prefix:

| Name | Contract |
|---|---|
| `QT_WEBUI_CALLER_CWD` | Absolute caller working directory used for the backend and Pi child. |
| `QT_WEBUI_QML_ENTRY` | Absolute selected `shell.qml` path. |
| `QT_WEBUI_BACKEND_ENTRY` | Absolute backend entry (`lib/backend/main.mjs`). |
| `QT_WEBUI_NODE_EXECUTABLE` | Absolute Node.js executable used to start the backend and the Pi CLI module. |
| `QT_WEBUI_PI_CLI_ENTRY` | Absolute dependency-local Pi CLI module, read by the backend. |
| `QT_WEBUI_DEVELOPMENT_MODE` | `1` for `qt-webui dev`; otherwise `0`. |
| `QT_WEBUI_SYSTEM_COLOR_SCHEME` | Normalized XDG portal result: `dark`, `light`, or `unknown`. |

Before adding those values, the launcher removes every inherited environment key whose name starts with `QT_WEBUI_`. This prevents caller-controlled variables from activating internal test behavior or overriding launcher-owned paths. The live smoke harness can add its fixture values (`QT_WEBUI_SMOKE_MODE`, `QT_WEBUI_SMOKE_CAPTURE_PATH`, `QT_WEBUI_SMOKE_STATE_PATH`, `QT_WEBUI_THEME_MODE`, `QT_WEBUI_PI_STARTUP_TIMEOUT_MS`, `QT_WEBUI_PI_REQUEST_TIMEOUT_MS`) only through an explicit launcher test seam; the installed `qt-webui` bin never reads that seam from the environment. The backend honors `QT_WEBUI_PI_REQUEST_TIMEOUT_MS` and `debug_crash` only in smoke mode.

Path values must be non-empty, contain no NUL byte, and fit within 16 KiB when UTF-8 encoded. The backend passes the Pi CLI entry and `--mode rpc` as separate process arguments and never interpolates paths, prompts, or dialog values into shell text.

The initial `get_state` response supplies `model.provider`, `model.id`, and `thinkingLevel`; the backend copies bounded strings into `pi.runtime` events and clears them on failed state reads, restarts, and process exits so the window never presents stale runtime metadata.

Qt 6.11 registers host applications with `org.freedesktop.host.portal.Registry` during GUI startup, which can produce a non-fatal warning; the launcher defaults the child to `QT_NO_XDG_DESKTOP_PORTAL=1` while preserving an explicit caller value. The visual root explicitly belongs to `FloatingWindow.contentItem` and the surface is opaque.

## Process and failure behavior

The launcher installs handlers for `SIGINT` and `SIGTERM` only while Quickshell is active and forwards either signal to that child. It removes handlers after an error or close event. Numeric child exit codes pass through; signal exits become the conventional `130` or `143` status when applicable.

A missing Quickshell executable and a missing or malformed package-local Pi CLI both become actionable stderr messages. The launcher never falls back to a global Pi command.

## Validation

Run the focused suite and syntax checks:

```bash
npm test
npm run check
qmllint -I /usr/lib/qt6/qml qml/*.qml qml/components/*.qml qml/dialogs/*.qml
```

Test files:

- `tests/backend-units.test.mjs` — protocol validation at each limit and one over, JSONL framing, Markdown policy and bounds, settings permissions, process-tree escalation.
- `tests/backend-session.test.mjs` — the real backend driven against `tests/fixtures/fake-pi-rpc.mjs`: startup noise, stale and duplicate responses, message parts, dialogs answered exactly once, streaming cadence, provider and tool errors, abort-before-start, transcript limits, protocol violations, silent Pi timeouts, slow-consumer backpressure, settings, restart paths.
- `tests/backend-lifecycle.test.mjs` — stdin EOF, `SIGTERM`, `SIGINT`, `SIGKILL`, fatal crash, and restart all reap Pi and a fixture grandchild within `shutdownGraceMs + 2 s`.
- `tests/qml-contract.test.mjs` — static contracts for the QML files, including the limit cross-check and the untrusted-content rules.
- `tests/qml-smoke.test.mjs` — real Quickshell on the current Wayland session, running the `SmokeDriver` scenario twice (default and `QT_SCALE_FACTOR=2`), asserting every marker, the captured Pi commands, the exact dialog answers, and the persisted setting. It skips without a Wayland display or Quickshell.
- `tests/launcher.test.mjs`, `tests/package-contract.test.mjs`, `tests/packed-install.test.mjs`, `tests/docs-contract.test.mjs` — launcher, manifest, packed install, and documentation contracts.

`tests/helpers/backend-client.mjs` spawns the backend with the fixture, keeps unmatched responses observable, and rejects pending requests when the backend exits.

The fixture scenarios are keyed by prompt text (`__QT_WEBUI_STREAM__`, `__QT_WEBUI_MARKDOWN__`, `__QT_WEBUI_IMMEDIATE__`, `__QT_WEBUI_PROVIDER_ERROR__`, `__QT_WEBUI_TOOL_ERROR__`, `__QT_WEBUI_FAIL__`, `__QT_WEBUI_DELAYED_ABORT__`, `__QT_WEBUI_LIMITS__`, `__QT_WEBUI_FLOOD__`, `__QT_WEBUI_GRANDCHILD__`, `__QT_WEBUI_SILENT__`, `__QT_WEBUI_EXIT__`). The startup state file drives the `failed-state` → `missing-state` → `recovered-state` restart sequence.

The smoke driver answers dialogs through the dialog's own keyboard-handler entry points (`selectOption`, `confirm`, `submitText`, `cancel`) rather than synthesized key events; a second answer must be refused. Known gap: no test synthesizes real key presses.

`tests/packed-install.test.mjs` creates a tarball under a disposable temporary directory, installs it into a temporary prefix with `npm install --ignore-scripts`, adds that prefix's bin directory to `PATH`, invokes `qt-webui` by command name against the fake Quickshell fixture, and removes the directory. It must never install globally or publish the package.

## Packaging

Keep `qml`, `bin`, `lib`, user documentation, contributor documentation, tests, and `LICENSE` in the package `files` allowlist. Generate `package-lock.json` with lifecycle scripts disabled:

```bash
npm install --package-lock-only --ignore-scripts
```

Do not publish or change Pi settings as part of repository validation.
