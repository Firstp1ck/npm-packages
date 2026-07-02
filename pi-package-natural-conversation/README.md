# @firstpick/pi-package-natural-conversation

Natural Conversation Mode for the Pi TUI: a safety controller plus an opt-in, package-owned native audio loop (microphone → VAD → STT → prompt dispatch → TTS playback).

The package is standalone — it never depends on `pi-package-webui`. It reuses the same provider HTTP contracts and env vars as the WebUI Phase-4 fallback routes, so one local whisper/Piper setup serves both loops.

## Commands

```text
/talk                # toggle conversation safe mode
/talk on             # enable safe mode (auto-starts audio if configured)
/talk off            # stop audio, then restore previous tools/thinking
/talk status         # safe-mode constraints + native audio status
/talk setup          # interactive setup wizard (providers, calibration, consent)
/talk audio on       # start the native audio loop (requires safe mode on)
/talk audio off      # stop the native audio loop, keep safe mode on
/talk pause          # stop the capture process without leaving audio mode
/talk resume         # resume capture
/talk doctor         # probe mic, speaker, STT, and TTS
/talk doctor mic     # probe a single target (mic|speaker|stt|tts)
/talk voice          # list Piper voices (current, downloaded, downloadable)
/talk voice <id>     # switch voice; downloads it first if needed (with progress)
/talk metrics        # last-turn stage timings
```

Aliases: `/voice`, `/conversation`.

## Safe mode (Phase 1, unchanged)

When enabled, the controller:

- stores current active tools and thinking level in process memory;
- forces thinking level to `off`;
- limits active tools to `read`, `grep`, `find`, and `ls`;
- blocks non-allowlisted tool calls defensively;
- blocks `!`/`!!` user shell commands;
- appends concise read-only spoken-response guidance to the system prompt;
- shows a `Voice: <state>` footer status when UI is available.

When disabled, it restores the previous active tools and thinking level where still available.

## Native audio loop (Phase 5)

Opt-in and off by default. Run `/talk setup` once; it probes your environment, checks providers with live round-trips, calibrates the microphone threshold, and only writes `~/.pi/agent/voice.json` (mode 0600) after an explicit consent summary.

Setup guides you beyond the package itself. If no STT endpoint is answering, the wizard offers **guided local whisper provisioning**: it detects whether `whisper-server` is installed (and if not, shows the exact install command for your system — e.g. `sudo pacman -S whisper-cpp-vulkan` on Arch, `brew install whisper-cpp` on macOS, a source build otherwise — then re-checks; it never runs package managers itself), finds ggml models already on disk (including ones downloaded by other whisper tools such as hyprwhspr) or downloads one after a size warning, and — with your confirmation — installs and enables a user systemd service (`whisper-server.service`) so the server survives reboots, verifying the endpoint with a real round-trip. Declining the service shows the manual start command instead.

Voices can be changed anytime with `/talk voice <id>` (tab-complete lists the catalog). A voice that is not on disk is downloaded first — progress is shown in the `Voice:` status line — verified with a test synthesis, persisted to `voice.json`, and applied live to a running audio session without restarting it. The WebUI exposes the same switch as a dropdown next to its End-conversation button.

For a natural voice, the TTS step offers **guided Piper provisioning** the same way: detect the user-installed `piper` binary (install hints: `yay -S piper-tts-bin` or `pipx install piper-tts`; Piper is GPL, so it is never bundled), reuse `.onnx` voices already on disk or download one from a small catalog (English and German voices, ~63–110 MB, after a size warning), then verify with a real test synthesis. No server or service is needed — the companion execs piper per utterance, and espeak-ng remains the automatic fallback.

Architecture: the extension supervises a companion child process (`lib/native-audio-companion.mjs`, plain Node, same interpreter Pi runs on) speaking JSONL over stdio. Audio bytes never cross the pipe and the companion has zero Pi API access — every transcript enters Pi as an ordinary user message, so all safe-mode guards apply unchanged.

- **Capture chain:** `pw-record` → `parecord` → `arecord` → `ffmpeg` (first found wins; pin an explicit argv in `voice.json`). Raw s16le 16 kHz mono.
- **VAD:** energy-based, 512-sample frames, adaptive noise floor, 300 ms pre-roll, 300 ms minimum utterance, 800 ms hangover, 30 s cap. Calibrated by setup, tunable in `voice.json`.
- **STT:** `local-endpoint` (Phase-4 contract: multipart `file` upload, tolerant `{text}` parse). whisper.cpp fits: `whisper-server -m <model.bin> --host 127.0.0.1 --port 8178`, then `PI_VOICE_STT_URL=http://127.0.0.1:8178/inference` — or let `/talk setup` provision this for you (see above).
- **TTS:** `piper` (natural neural voices; execs the user-installed piper binary per utterance, no server), `local-endpoint` (JSON `{text, voice?, format}` → audio), or `espeak-ng` — with espeak-ng as the automatic runtime fallback that works with nothing installed. Playback chain: `pw-play` → `paplay` → `aplay` → `ffplay`.
- **Turn taking:** half-duplex — the mic gate closes while transcribing and speaking (plus a 250 ms tail guard). Only final assistant text is spoken, never tool cards; fenced code blocks are read as "code block omitted".
- **Interruptions:** transcripts captured while the agent is streaming are coalesced (cap 3, drop-oldest) and delivered as a `steer` message after the current tool call finishes.
- **Silence events:** if an assistant answer ends with a question and you stay silent past the timeout (default 8 s), one conservative silence event is sent — same wording as the WebUI loop.
- **Hosted providers (optional):** Groq/OpenAI STT and OpenAI TTS exist behind three explicit gates — `native.allowRemoteProviders`, recorded hosted consent, and the env API key. There is never a silent local→hosted fallback.

### No-orphan-microphone guarantees

1. Graceful teardown escalation: `shutdown` → stdin EOF → SIGTERM (process group) → SIGKILL, on `/talk audio off`, `/talk off`, and session shutdown — always before tools/thinking are restored.
2. Dead-man switch: the companion watches its stdin; if the Pi process dies for any reason, the companion kills its capture/playback children and exits.
3. Stale pidfile sweep under `$XDG_RUNTIME_DIR/pi-voice/` at every audio start and doctor run.

`/talk pause` kills the capture process outright — "paused" provably means no mic process. Audio failures degrade to safe text-only conversation mode; they never widen tool access.

## Configuration

`~/.pi/agent/voice.json` (written by `/talk setup`; never contains secrets):

```jsonc
{
  "version": 1,
  "native": {
    "enabled": false,
    "autoStartWithTalkOn": true,
    "capture": { "tool": "auto", "command": null, "device": null, "sampleRateHz": 16000 },
    "playback": { "tool": "auto", "command": null, "device": null },
    "vad": { "startDb": 9, "thresholdDb": null, "hangoverMs": 800, "minSpeechMs": 300,
             "maxUtteranceMs": 30000, "preRollMs": 300, "engine": "energy" },
    "stt": { "provider": "local-endpoint", "url": null, "language": "auto", "timeoutMs": 30000 },
    "tts": { "provider": "local-endpoint", "url": null, "modelPath": null, "voice": null,
             "rate": 1.0, "timeoutMs": 20000, "fallback": "espeak-ng" },
    "headphones": false,
    "bargeIn": { "enabled": false, "selfEchoOverlap": 0.6 },
    "silence": { "enabled": true, "timeoutMs": 8000 },
    "allowRemoteProviders": false
  },
  "consent": { "nativeAudioAcceptedAt": null, "hostedSttAcceptedAt": null, "hostedTtsAcceptedAt": null }
}
```

Environment overrides (same names as the WebUI Phase-4 routes; env wins over `voice.json`):

```sh
PI_VOICE_STT_URL=http://127.0.0.1:8178/inference
PI_VOICE_TTS_URL=http://127.0.0.1:8179/speech
GROQ_API_KEY=...     # hosted STT (requires recorded consent)
OPENAI_API_KEY=...   # hosted STT/TTS (requires recorded consent)
```

API keys are environment-only; the config validator drops unknown keys on save, so secrets can never persist in `voice.json`.

## Privacy and safety rules

- No microphone outside safe mode: the audio loop refuses to spawn unless the controller is enabled.
- Audio stays local unless you explicitly configure and consent to a remote or hosted provider (non-loopback URLs require `allowRemoteProviders` plus an extra confirm naming the host).
- Raw audio lives only in companion memory; logs and metrics never contain transcript text.
- Transcripts enter the session as ordinary user messages — same visibility as typing.

## Install

```bash
pi install npm:@firstpick/pi-package-natural-conversation
```

For local development from this monorepo:

```bash
pi -e ./pi-package-natural-conversation
```

## Verification

```bash
npm run check --prefix pi-package-natural-conversation
```

Runs syntax checks plus the full test suite: config validation, VAD frame-exact transitions, WAV round-trips, provider contract tests against stub servers, companion integration with fake capture/playback tools (including the stdin dead-man switch), orchestrator supervision/dispatch tests, controller silence-event tests, and setup wizard tests with scripted dialogs.
