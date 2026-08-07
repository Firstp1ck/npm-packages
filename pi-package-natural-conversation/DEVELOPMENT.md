# Development guide: Natural Conversation Mode for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

Architecture: the extension supervises a companion child process (`lib/native-audio-companion.mjs`, plain Node, same interpreter Pi runs on) speaking JSONL over stdio. Audio bytes never cross the pipe and the companion has zero Pi API access — every transcript enters Pi as an ordinary user message, so all safe-mode guards apply unchanged.

## Provider and audio contracts

Local STT sends multipart audio and tolerates JSON/text transcript responses. Local TTS sends JSON containing text plus optional voice/format and expects audio bytes. Voice activity detection uses 512-sample frames, an adaptive noise floor, pre-roll, minimum-speech and hangover windows, plus pitch-periodicity/autocorrelation for barge-in confirmation. Keep these contracts synchronized with provider adapters and configuration validation.

## Companion teardown

Graceful shutdown escalates from the protocol shutdown request through stdin close, process-group termination, and finally forced termination. A dead-man stdin watcher exits the companion and its capture/playback children when Pi disappears. Startup and doctor checks sweep stale pidfiles under the private runtime directory.

## Verification

```bash
npm run check --prefix pi-package-natural-conversation
```

Runs syntax checks plus the full test suite: config validation, VAD frame-exact transitions, WAV round-trips, provider contract tests against stub servers, companion integration with fake capture/playback tools (including the stdin dead-man switch), orchestrator supervision/dispatch tests, controller silence-event tests, and setup wizard tests with scripted dialogs.

## Local development launch

```bash
pi -e ./pi-package-natural-conversation
```
