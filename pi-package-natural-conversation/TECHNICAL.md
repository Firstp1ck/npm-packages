# Technical reference: Natural Conversation Mode for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Natural Conversation Mode adds opt-in microphone input, speech recognition, and spoken replies while keeping Pi in a constrained conversation-safe mode.

The package is standalone and does not require `pi-package-webui`. A configured local whisper/Piper setup and the same provider environment variables can also be reused by Web UI voice features. Internal controller and provider contracts are documented in `DEVELOPMENT.md`.

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
/talk style          # list spoken style presets (current one marked)
/talk style <preset> # switch style: natural | concise | casual | pair-programmer | coach | quiet
/talk tools          # show the conversation tool allowlist
/talk tools allow <tool> [...]  # allow extra read-only tools (e.g. brave_search)
/talk tools deny <tool> [...]   # remove previously allowed extras
/talk metrics        # last-turn stage timings
```

Aliases: `/voice`, `/conversation`.

## Safe mode

When enabled, the controller:

- stores current active tools and thinking level in process memory;
- forces thinking level to `off`;
- limits active tools to `read`, `grep`, `find`, and `ls` — plus any extras from `tools.allow` in `voice.json` (`/talk tools allow brave_search` for web search; only add tools that cannot write or run commands);
- blocks non-allowlisted tool calls defensively;
- blocks `!`/`!!` user shell commands;
- appends concise read-only spoken-response guidance to the system prompt;
- shows a `Voice: <state>` footer status when UI is available.

When disabled, it restores the previous active tools and thinking level where still available.

## Native audio loop

Opt-in and off by default. Run `/talk setup` once; it probes your environment, checks providers with live round-trips, calibrates the microphone threshold, and only writes `~/.pi/agent/voice.json` (mode 0600) after an explicit consent summary.

Setup guides you beyond the package itself. If no STT endpoint is answering, the wizard offers **guided local whisper provisioning**: it detects whether `whisper-server` is installed (and if not, shows the exact install command for your system — e.g. `sudo pacman -S whisper-cpp-vulkan` on Arch, `brew install whisper-cpp` on macOS, a source build otherwise — then re-checks; it never runs package managers itself), finds ggml models already on disk (including ones downloaded by other whisper tools such as hyprwhspr) or downloads one after a size warning, and — with your confirmation — installs and enables a user systemd service (`whisper-server.service`) so the server survives reboots, verifying the endpoint with a real round-trip. Declining the service shows the manual start command instead.

Voices can be changed anytime with `/talk voice <id>` (tab-complete lists the catalog). A voice that is not on disk is downloaded first — progress is shown in the `Voice:` status line — verified with a test synthesis, persisted to `voice.json`, and applied live to a running audio session without restarting it. The WebUI exposes the same switch as a dropdown next to its End-conversation button.

For a natural voice, the TTS step offers **guided Piper provisioning** the same way: detect the user-installed `piper` binary (install hints: `yay -S piper-tts-bin` or `pipx install piper-tts`; Piper is GPL, so it is never bundled), reuse `.onnx` voices already on disk or download one from a small catalog (English and German voices, ~63–110 MB, after a size warning), then verify with a real test synthesis. No server or service is needed — the companion execs piper per utterance, and espeak-ng remains the automatic fallback.

- **Capture chain:** `pw-record` → `parecord` → `arecord` → `ffmpeg` (first found wins; pin an explicit argv in `voice.json`). Raw s16le 16 kHz mono.
- **Voice activity detection:** calibrated during setup. Speech thresholds, pre-roll, minimum speech duration, hangover, and maximum utterance length are tunable in `voice.json`.
- **Speech recognition:** use a local endpoint such as whisper.cpp (`whisper-server -m <model.bin> --host 127.0.0.1 --port 8178`, then `PI_VOICE_STT_URL=http://127.0.0.1:8178/inference`) or let `/talk setup` provision it.
- **Spoken replies:** use Piper, a configured local TTS endpoint, or `espeak-ng`. `espeak-ng` is the automatic fallback. `tts.keepWarm` keeps Piper ready for lower latency, and temporary audio is deleted after playback. Playback uses the first available `pw-play`, `paplay`, `aplay`, or `ffplay` command.
- **Noise filtering:** known speech-recognition artifacts from noise-only audio are dropped, while genuinely spoken matching phrases are retained.
- **Turn taking:** the microphone pauses while Pi transcribes or speaks. Assistant text is spoken, tool cards are skipped, and fenced code is announced as omitted.
- **Sentence streaming:** with `tts.streamSentences` (default on), completed sentences are spoken while the rest of the answer is still being generated — the first sentence starts as soon as it ends, not when the whole answer does. Text inside an open code fence is held until the fence closes, interrupted turns stop voicing immediately, and the final answer is never spoken twice. On hosts without `message_update` delta events this degrades automatically to final-answer-only speech.
- **Interruptions:** speech during a busy turn is delivered safely after the current tool call. In headphones mode, `bargeIn.cancelOnSpeechStart` can stop playback when sustained voice is detected. Raise `confirmMs` or `marginDb`, or disable that option, if ordinary noise causes unwanted cutoffs. Speaker mode remains transcript-based to avoid self-cancellation.
- **Acknowledgements (opt-in):** with `native.acknowledgement.enabled`, a short spoken phrase ("Got it, one second.") fills the dead air — but only when the answer takes longer than `delayMs` (default 700 ms). Fast turns, very short prompts, and turns where TTS is already playing are never acknowledged, so it stays out of the way instead of becoming a verbal tic. Phrases rotate and are configurable.
- **Spoken styles:** `/talk style <preset>` appends one style instruction to the conversation prompt — `concise`, `casual`, `pair-programmer`, `coach`, or `quiet`; `natural` (default) keeps the baseline spoken guidance only. The choice persists in `voice.json` and applies live from the next answer.
- **Silence events:** if an assistant answer ends with a question and you stay silent past the timeout (default 8 s), one conservative silence event is sent — same wording as the WebUI loop.
- **Hosted providers (optional):** Groq/OpenAI STT and OpenAI TTS exist behind three explicit gates — `native.allowRemoteProviders`, recorded hosted consent, and the env API key. There is never a silent local→hosted fallback.

### Microphone shutdown guarantees

`/talk pause`, `/talk audio off`, `/talk off`, session shutdown, and unexpected Pi exit terminate the managed microphone process before normal tools/thinking are restored. Audio failures degrade to safe text-only conversation mode and never widen tool access. Contributor-level teardown and stale-process cleanup mechanics are documented in `DEVELOPMENT.md`.

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
             "rate": 1.0, "timeoutMs": 20000, "fallback": "espeak-ng",
             "streamSentences": true, "keepWarm": true },
    "headphones": false,
    "bargeIn": { "enabled": false, "selfEchoOverlap": 0.6, "cancelOnSpeechStart": true,
                 "confirmMs": 250, "marginDb": 5 },
    "acknowledgement": { "enabled": false, "delayMs": 700,
                         "phrases": ["Got it, one second.", "Okay, let me check.", "One moment."] },
    "silence": { "enabled": true, "timeoutMs": 8000 },
    "allowRemoteProviders": false
  },
  "style": { "preset": "natural" },
  "tools": { "allow": [] },
  "consent": { "nativeAudioAcceptedAt": null, "hostedSttAcceptedAt": null, "hostedTtsAcceptedAt": null }
}
```

### Turn-taking latency tuning

The single biggest "feels robotic" factor is `vad.hangoverMs` — how long the VAD waits after you stop talking before it closes the utterance and sends it to STT. Lower is snappier, but too low splits one sentence into two turns at every thinking pause:

- `800` (default): safe, noticeably laggy.
- `500`: good balance for most speakers — recommended starting point.
- `400`: try it if 500 feels stable; go back up if your sentences get split.

Keep `minSpeechMs` at `300` (false-trigger guard) and tune `silence.timeoutMs` only after the VAD feels right. After each change, verify with `/talk doctor mic`, a few live turns, and `/talk metrics`.

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
